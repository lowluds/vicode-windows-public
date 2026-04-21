import type { RunEvent, ThreadSource } from './domain';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanText(value: string | null | undefined) {
  return value?.replace(/\s+/gu, ' ').trim() ?? '';
}

function normalizeSourceUrl(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().replace(/[),.;]+$/u, '');
  if (!/^https?:\/\//iu.test(trimmed)) {
    return null;
  }

  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function defaultSourceTitle(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./iu, '') || url;
  } catch {
    return url;
  }
}

function normalizeSourceTitle(title: string | null | undefined, url: string) {
  const cleaned = cleanText(
    title
      ?.replace(/^\d+\.\s*/u, '')
      .replace(/^(?:extracted page|page):\s*/iu, '')
      ?? ''
  );
  if (
    !cleaned
    || /^(?:research packet for|site crawl from|scope:|pages crawled:|sources reviewed:|research focus:|url:)/iu.test(cleaned)
  ) {
    return defaultSourceTitle(url);
  }

  return cleaned;
}

function normalizeSourceField(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const cleaned = cleanText(value);
  if (!cleaned || cleaned === '[page extraction unavailable]') {
    return null;
  }

  return cleaned;
}

function preferTitle(current: string, candidate: string, url: string) {
  const fallback = defaultSourceTitle(url);
  if (current === fallback && candidate !== fallback) {
    return candidate;
  }
  if (candidate === fallback && current !== fallback) {
    return current;
  }
  return candidate.length > current.length ? candidate : current;
}

function mergeTwoSources(current: ThreadSource | null, candidate: ThreadSource): ThreadSource {
  if (!current) {
    return candidate;
  }

  return {
    url: current.url,
    title: preferTitle(current.title, candidate.title, current.url),
    snippet:
      candidate.snippet && (!current.snippet || candidate.snippet.length > current.snippet.length)
        ? candidate.snippet
        : current.snippet,
    excerpt:
      candidate.excerpt && (!current.excerpt || candidate.excerpt.length > current.excerpt.length)
        ? candidate.excerpt
        : current.excerpt
  };
}

export function mergeThreadSources(...lists: Array<ThreadSource[] | null | undefined>) {
  const merged = new Map<string, ThreadSource>();

  for (const list of lists) {
    for (const source of list ?? []) {
      const current = merged.get(source.url) ?? null;
      merged.set(source.url, mergeTwoSources(current, source));
    }
  }

  return [...merged.values()];
}

export function normalizeThreadSources(value: unknown): ThreadSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: ThreadSource[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const url = normalizeSourceUrl(entry.url ?? entry.href);
    if (!url) {
      continue;
    }

    normalized.push({
      url,
      title: normalizeSourceTitle(
        typeof entry.title === 'string'
          ? entry.title
          : typeof entry.label === 'string'
            ? entry.label
            : typeof entry.name === 'string'
              ? entry.name
              : null,
        url
      ),
      snippet: normalizeSourceField(entry.snippet ?? entry.summary),
      excerpt: normalizeSourceField(entry.excerpt ?? entry.text)
    });
  }

  return mergeThreadSources(normalized);
}

function extractSourcesFromStructuredBlocks(text: string) {
  const results: ThreadSource[] = [];

  for (const block of text.split(/\n\s*\n/gu)) {
    const lines = block
      .split(/\r?\n/gu)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      continue;
    }

    const urlLineIndex = lines.findIndex((line) => /^URL:\s*/iu.test(line));
    if (urlLineIndex < 0) {
      continue;
    }

    const url = normalizeSourceUrl(lines[urlLineIndex]?.replace(/^URL:\s*/iu, ''));
    if (!url) {
      continue;
    }

    const rawTitle =
      lines.slice(0, urlLineIndex).find((line) => !/^(?:research focus:|scope:|pages crawled:|sources reviewed:)/iu.test(line))
      ?? null;
    const snippetLine = lines.find((line) => /^Search snippet:\s*/iu.test(line)) ?? null;
    const excerptLine =
      lines.find((line) => /^Extracted excerpt:\s*/iu.test(line))
      ?? lines.find((line) => /^Excerpt:\s*/iu.test(line))
      ?? null;

    results.push({
      url,
      title: normalizeSourceTitle(rawTitle, url),
      snippet: normalizeSourceField(snippetLine?.replace(/^Search snippet:\s*/iu, '')),
      excerpt: normalizeSourceField(excerptLine?.replace(/^(?:Extracted excerpt|Excerpt):\s*/iu, ''))
    });
  }

  return results;
}

function extractSourcesFromFooter(text: string) {
  const footerMatch = text.match(/(?:^|\n)Sources:\s*\n([\s\S]+)$/iu);
  if (!footerMatch) {
    return [] as ThreadSource[];
  }

  return footerMatch[1]
    .split(/\r?\n/gu)
    .map((line) => line.match(/^\s*-\s*(https?:\/\/\S+)/iu)?.[1] ?? null)
    .map((url) => normalizeSourceUrl(url))
    .filter((url): url is string => Boolean(url))
    .map((url) => ({
      url,
      title: defaultSourceTitle(url),
      snippet: null,
      excerpt: null
    }));
}

function extractSourcesFromUrlLines(text: string) {
  const results: ThreadSource[] = [];

  for (const match of text.matchAll(/(?:^|\n)URL:\s*(https?:\/\/\S+)/giu)) {
    const url = normalizeSourceUrl(match[1]);
    if (!url) {
      continue;
    }

    results.push({
      url,
      title: defaultSourceTitle(url),
      snippet: null,
      excerpt: null
    });
  }

  return results;
}

export function extractThreadSourcesFromText(text: string | null | undefined) {
  const normalized = text?.trim() ?? '';
  if (!normalized) {
    return [] as ThreadSource[];
  }

  return mergeThreadSources(
    extractSourcesFromStructuredBlocks(normalized),
    extractSourcesFromFooter(normalized),
    extractSourcesFromUrlLines(normalized)
  );
}

export function collectThreadSourcesFromRunArtifacts(events: RunEvent[], assistantOutput: string | null | undefined) {
  const results: ThreadSource[][] = [];

  for (const event of events) {
    if (event.eventType !== 'info' || !isRecord(event.payload)) {
      continue;
    }

    const activity = isRecord(event.payload.activity) ? event.payload.activity : null;
    if (!activity) {
      continue;
    }

    const activitySources = normalizeThreadSources(activity.sources);
    const activityUrl = normalizeSourceUrl(activity.url);
    const urlSources = activityUrl
      ? [{
          url: activityUrl,
          title: defaultSourceTitle(activityUrl),
          snippet: null,
          excerpt: null
        }]
      : [];
    const textSources = typeof activity.text === 'string' ? extractThreadSourcesFromText(activity.text) : [];

    results.push(activitySources, urlSources, textSources);
  }

  return mergeThreadSources(...results, extractThreadSourcesFromText(assistantOutput));
}
