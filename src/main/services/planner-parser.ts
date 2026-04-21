import type { StructuredPlannerPlan } from '../../shared/domain';

export function deriveStructuredPlannerPlan(markdown: string): StructuredPlannerPlan | null {
  const normalizedMarkdown = normalizePlannerMarkdown(markdown);
  const lines = normalizedMarkdown.split(/\r?\n/u);
  const titleLine = lines.find((line) => /^#\s+/u.test(line))?.replace(/^#\s+/u, '').trim() ?? null;
  const title = sanitizePlannerTitle(titleLine);
  if (!title) {
    return null;
  }

  const sections = new Map<string, string[]>();
  let currentSection = 'summary';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const headingMatch = line.match(/^##\s+(.+)$/u);
    if (headingMatch) {
      currentSection = normalizeSectionKey(headingMatch[1]);
      sections.set(currentSection, sections.get(currentSection) ?? []);
      continue;
    }

    if (/^#\s+/u.test(line)) {
      continue;
    }

    const target = sections.get(currentSection) ?? [];
    target.push(line.replace(/^[-*]\s+/u, '').trim());
    sections.set(currentSection, target);
  }

  return {
    title,
    summary: sections.get('summary') ?? [],
    keyChanges: sections.get('keychanges') ?? sections.get('implementationchanges') ?? [],
    testPlan: sections.get('testplan') ?? [],
    assumptions: sections.get('assumptions') ?? []
  };
}

function normalizeSectionKey(source: string) {
  return source.toLowerCase().replace(/[^a-z]/g, '');
}

function normalizePlannerMarkdown(markdown: string) {
  return markdown
    .replace(/([^\n])\s*(##\s*)/gu, '$1\n$2')
    .replace(/##\s*(Summary|Key Changes|Implementation Changes|Test Plan|Assumptions)\s*/giu, '\n## $1\n')
    .replace(/\n{3,}/gu, '\n\n');
}

function sanitizePlannerTitle(value: string | null) {
  if (!value) {
    return null;
  }

  const cleaned = value
    .replace(/^[\s`"'*_#-]+/gu, '')
    .replace(/^title\s*:\s*/iu, '')
    .replace(/^[\s`"'*_#-]+/gu, '')
    .replace(/\s*(?:##\s*)?(?:summary|key changes|implementation changes|test plan|assumptions)\b.*$/iu, '')
    .replace(/\s*(?:target outcome|goal|problem|context)\s*:\s*.*$/iu, '')
    .replace(/\s*(?:[-*]|\d+\.)\s+.*$/u, '')
    .replace(/[\s`"'*_#-]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

  return cleaned || null;
}
