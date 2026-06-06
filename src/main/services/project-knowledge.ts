import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ProjectKnowledgeIndexSnapshot } from '../../storage/project-knowledge-index-repository';
import {
  PROJECT_KNOWLEDGE_LIMITS,
  PROJECT_KNOWLEDGE_ORIENTATION_FILE_NAMES,
  isReadableProjectKnowledgeRoot,
  listProjectKnowledgeMarkdownRelativePaths,
  normalizeProjectKnowledgePath,
  scanProjectKnowledgeFolder,
  type ProjectKnowledgeScannedSection
} from './project-knowledge-scanner';

export interface ProjectKnowledgeRetrievalReason {
  rank: number;
  reason: string;
  matchedTerms: string[];
  matchedFields: string[];
}

export interface ProjectKnowledgeContextBlock {
  label: 'Project Knowledge';
  title: string;
  fileName: string;
  path: string;
  relativePath: string;
  heading: string | null;
  content: string;
  score: number;
  retrievalReason: ProjectKnowledgeRetrievalReason;
}

type ProjectKnowledgeChunk = ProjectKnowledgeScannedSection;

export interface ProjectKnowledgeIndexReader {
  getProjectKnowledgeIndexSnapshotByRootPath?: (rootPath: string) => ProjectKnowledgeIndexSnapshot | null;
  getSnapshotByRootPath?: (rootPath: string) => ProjectKnowledgeIndexSnapshot | null;
}

const DEFAULT_MAX_RESULTS = 3;
const MAX_RESULT_CHARS = 1_500;

const CASUAL_PROMPT_PATTERN =
  /^(?:(?:hi|hello|hey|yo|sup)[,\s]*)?(?:hi|hello|hey|yo|sup|how(?:'s|s| is) it going|how are you|what'?s up|thanks|thank you|ok|okay|cool|nice|great|got it|sounds good|all good)[\s.?!]*$/iu;

const OBSIDIAN_LINK_PATTERN = /\[\[([^\]]+)\]\]/giu;

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'and',
  'are',
  'can',
  'could',
  'does',
  'for',
  'from',
  'have',
  'how',
  'into',
  'just',
  'like',
  'need',
  'our',
  'please',
  'that',
  'the',
  'then',
  'there',
  'this',
  'through',
  'want',
  'what',
  'when',
  'where',
  'with',
  'would',
  'you',
  'your'
]);

function normalizeRouteKey(value: string) {
  return value
    .trim()
    .replace(/^\[\[/u, '')
    .replace(/\]\]$/u, '')
    .replace(/\.md$/iu, '')
    .replace(/[\\/]/gu, '/')
    .replace(/^\.?\//u, '')
    .toLowerCase();
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function shouldUseProjectKnowledge(prompt: string) {
  const normalizedPrompt = prompt.trim();
  return Boolean(normalizedPrompt) && !CASUAL_PROMPT_PATTERN.test(normalizedPrompt);
}

function extractExplicitRoutes(prompt: string) {
  return [...prompt.matchAll(OBSIDIAN_LINK_PATTERN)]
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean);
}

function extractQueryTerms(prompt: string) {
  return unique(
    [...prompt.toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu)]
      .map((match) => match[0])
      .filter((term) => !STOP_WORDS.has(term))
  ).slice(0, 24);
}

function countOccurrences(haystack: string, needle: string) {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let offset = 0;
  while (count < 5) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) {
      break;
    }
    count += 1;
    offset = index + needle.length;
  }
  return count;
}

function clipResultContent(content: string) {
  const trimmed = content.trim();
  if (trimmed.length <= MAX_RESULT_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_RESULT_CHARS).trimEnd()}\n\n[Truncated for Project Knowledge budget]`;
}

function scoreChunk(chunk: ProjectKnowledgeChunk, queryTerms: string[], explicitRoutes: string[]) {
  let score = 0;
  const matchedTerms = new Set<string>();
  const matchedFields = new Set<string>();

  const normalizedTitle = chunk.title.toLowerCase();
  const normalizedHeading = (chunk.heading ?? '').toLowerCase();
  const normalizedPath = chunk.relativePath.toLowerCase();
  const normalizedAliases = chunk.aliases.map((alias) => alias.toLowerCase());
  const normalizedTags = chunk.tags.map((tag) => tag.toLowerCase());
  const normalizedContent = chunk.content.toLowerCase();

  if (PROJECT_KNOWLEDGE_ORIENTATION_FILE_NAMES.has(chunk.fileName.toLowerCase())) {
    score += 3;
    matchedFields.add('orientation file');
  }

  for (const route of explicitRoutes) {
    const routeKey = normalizeRouteKey(route);
    const routeTargets = [
      normalizeRouteKey(chunk.title),
      normalizeRouteKey(chunk.heading ?? ''),
      normalizeRouteKey(chunk.relativePath),
      ...chunk.aliases.map(normalizeRouteKey)
    ];
    if (routeTargets.some((target) => target === routeKey || target.endsWith(`/${routeKey}`))) {
      score += 80;
      matchedTerms.add(route);
      matchedFields.add('explicit route');
    }
  }

  for (const term of queryTerms) {
    if (normalizedTitle.includes(term)) {
      score += 12;
      matchedTerms.add(term);
      matchedFields.add('title');
    }
    if (normalizedAliases.some((alias) => alias.includes(term))) {
      score += 10;
      matchedTerms.add(term);
      matchedFields.add('alias');
    }
    if (normalizedHeading.includes(term)) {
      score += 8;
      matchedTerms.add(term);
      matchedFields.add('heading');
    }
    if (normalizedPath.includes(term)) {
      score += 5;
      matchedTerms.add(term);
      matchedFields.add('file path');
    }
    if (normalizedTags.some((tag) => tag.includes(term))) {
      score += 5;
      matchedTerms.add(term);
      matchedFields.add('tag');
    }

    const bodyMatches = countOccurrences(normalizedContent, term);
    if (bodyMatches > 0) {
      score += Math.min(5, bodyMatches);
      matchedTerms.add(term);
      matchedFields.add('body');
    }
  }

  return {
    score,
    matchedTerms: [...matchedTerms],
    matchedFields: [...matchedFields]
  };
}

function formatRetrievalReason(matchedFields: string[], matchedTerms: string[]) {
  if (matchedFields.length === 0 && matchedTerms.length === 0) {
    return 'matched the retrieval query';
  }

  const fieldText = matchedFields.length > 0 ? `matched ${matchedFields.join(', ')}` : 'matched query terms';
  const termText = matchedTerms.length > 0 ? `: ${matchedTerms.slice(0, 8).join(', ')}` : '';
  return `${fieldText}${termText}`;
}

function selectDiverseResults<T extends { chunk: ProjectKnowledgeChunk; score: number }>(
  candidates: T[],
  maxResults: number
) {
  const selected: T[] = [];
  const selectedPaths = new Set<string>();
  for (const candidate of candidates) {
    if (selected.length >= maxResults) {
      break;
    }
    if (!selectedPaths.has(candidate.chunk.relativePath)) {
      selected.push(candidate);
      selectedPaths.add(candidate.chunk.relativePath);
    }
  }
  for (const candidate of candidates) {
    if (selected.length >= maxResults) {
      break;
    }
    if (!selected.includes(candidate)) {
      selected.push(candidate);
    }
  }
  return selected;
}

function readProjectKnowledgeChunks(rootPath: string | null | undefined) {
  const resolvedRootPath = rootPath?.trim() ?? '';
  if (!isReadableProjectKnowledgeRoot(resolvedRootPath)) {
    return [];
  }

  return scanProjectKnowledgeFolder(resolvedRootPath)
    .sections
    .slice(0, PROJECT_KNOWLEDGE_LIMITS.maxChunks);
}

function normalizeProjectKnowledgeLookupPath(relativePath: string) {
  const normalized = normalizeProjectKnowledgePath(relativePath.trim())
    .replace(/^\.?\//u, '');
  if (!normalized || normalized.startsWith('../') || normalized.includes('/../')) {
    return null;
  }
  return normalized.toLowerCase();
}

export function listProjectKnowledgeSources(rootPath: string | null | undefined, maxResults = 50) {
  const limit = Math.max(1, Math.min(Math.floor(maxResults), 50));
  return readProjectKnowledgeChunks(rootPath)
    .slice(0, limit)
    .map((chunk) => ({
      title: chunk.title,
      relativePath: chunk.relativePath,
      heading: chunk.heading
    }));
}

export function readProjectKnowledgeSection(
  rootPath: string | null | undefined,
  relativePath: string,
  heading?: string | null
) {
  const lookupPath = normalizeProjectKnowledgeLookupPath(relativePath);
  if (!lookupPath) {
    return null;
  }

  const normalizedHeading = heading?.trim().toLowerCase() ?? '';
  const chunk = readProjectKnowledgeChunks(rootPath).find((candidate) => {
    if (normalizeProjectKnowledgePath(candidate.relativePath).toLowerCase() !== lookupPath) {
      return false;
    }
    if (!normalizedHeading) {
      return true;
    }
    return (candidate.heading ?? '').toLowerCase() === normalizedHeading;
  });
  if (!chunk) {
    return null;
  }

  return {
    title: chunk.title,
    relativePath: chunk.relativePath,
    heading: chunk.heading,
    content: chunk.content.trim()
  };
}

export class ProjectKnowledgeService {
  constructor(private readonly options: { indexReader?: ProjectKnowledgeIndexReader } = {}) {}

  retrieveRelevantKnowledge(input: {
    rootPath: string | null | undefined;
    query: string;
    maxResults?: number;
  }): ProjectKnowledgeContextBlock[] {
    const rootPath = input.rootPath?.trim() ?? '';
    const query = input.query.trim();
    if (!isReadableProjectKnowledgeRoot(rootPath) || !shouldUseProjectKnowledge(query)) {
      return [];
    }

    const queryTerms = extractQueryTerms(query);
    const explicitRoutes = extractExplicitRoutes(query);
    if (queryTerms.length === 0 && explicitRoutes.length === 0) {
      return [];
    }

    const chunks =
      this.readCachedProjectKnowledgeChunks(resolve(rootPath))
      ?? readProjectKnowledgeChunks(rootPath);

    const sortedCandidates = chunks
      .map((chunk) => ({
        chunk,
        ...scoreChunk(chunk, queryTerms, explicitRoutes)
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) =>
        b.score - a.score
        || a.chunk.relativePath.localeCompare(b.chunk.relativePath)
        || (a.chunk.heading ?? '').localeCompare(b.chunk.heading ?? '')
      );
    const routeMatchedCandidates = explicitRoutes.length > 0
      ? sortedCandidates.filter((candidate) => candidate.matchedFields.includes('explicit route'))
      : [];
    const scored = selectDiverseResults(
      routeMatchedCandidates.length > 0 ? routeMatchedCandidates : sortedCandidates,
      Math.max(1, input.maxResults ?? DEFAULT_MAX_RESULTS)
    );

    return scored.map((candidate, index) => ({
      label: 'Project Knowledge',
      title: candidate.chunk.title,
      fileName: candidate.chunk.fileName,
      path: candidate.chunk.path,
      relativePath: candidate.chunk.relativePath,
      heading: candidate.chunk.heading,
      content: clipResultContent(candidate.chunk.content),
      score: candidate.score,
      retrievalReason: {
        rank: index + 1,
        reason: formatRetrievalReason(candidate.matchedFields, candidate.matchedTerms),
        matchedTerms: candidate.matchedTerms,
        matchedFields: candidate.matchedFields
      }
    }));
  }

  private readCachedProjectKnowledgeChunks(rootPath: string): ProjectKnowledgeChunk[] | null {
    const snapshot =
      this.options.indexReader?.getProjectKnowledgeIndexSnapshotByRootPath?.(rootPath)
      ?? this.options.indexReader?.getSnapshotByRootPath?.(rootPath)
      ?? null;
    if (!snapshot || snapshot.root.status !== 'ready' || !isProjectKnowledgeIndexFresh(rootPath, snapshot)) {
      return null;
    }

    const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
    return snapshot.sections
      .map((section) => {
        const source = sourceById.get(section.sourceId);
        if (!source || source.skippedReason) {
          return null;
        }
        return {
          sourceRelativePath: source.relativePath,
          ordinal: section.ordinal,
          title: source.title,
          aliases: source.aliases,
          tags: source.tags,
          fileName: source.fileName,
          path: join(rootPath, source.relativePath),
          relativePath: source.relativePath,
          heading: section.heading,
          headingDepth: section.headingDepth,
          startLine: section.startLine,
          endLine: section.endLine,
          content: section.indexedText,
          previewText: section.previewText,
          contentHash: section.contentHash
        };
      })
      .filter((chunk): chunk is ProjectKnowledgeChunk => chunk !== null)
      .slice(0, PROJECT_KNOWLEDGE_LIMITS.maxChunks);
  }
}

export function isProjectKnowledgeIndexFresh(rootPath: string, snapshot: ProjectKnowledgeIndexSnapshot) {
  const currentRelativePaths = listProjectKnowledgeMarkdownRelativePaths(rootPath);
  const indexedRelativePaths = new Set(
    snapshot.sources.map((source) => normalizeProjectKnowledgePath(source.relativePath).toLowerCase())
  );
  if (currentRelativePaths.length !== indexedRelativePaths.size) {
    return false;
  }
  for (const relativePath of currentRelativePaths) {
    if (!indexedRelativePaths.has(normalizeProjectKnowledgePath(relativePath).toLowerCase())) {
      return false;
    }
  }

  for (const source of snapshot.sources) {
    try {
      const stat = statSync(join(rootPath, source.relativePath));
      if (stat.size !== source.fileSize || Math.round(stat.mtimeMs) !== source.modifiedTimeMs) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}
