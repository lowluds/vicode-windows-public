import type { ProjectKnowledgeIndexSnapshot } from '../../storage/project-knowledge-index-repository';

export interface ProjectKnowledgeSuggestedIndexDraft {
  targetRelativePath: 'INDEX.md';
  generatedAt: string;
  sourceCount: number;
  diagnosticCount: number;
  content: string;
}

function stripMarkdownExtension(relativePath: string) {
  return relativePath.replace(/\.md$/iu, '');
}

function formatList(values: string[], empty = 'none') {
  return values.length > 0 ? values.join(', ') : empty;
}

function createRouteLine(input: {
  relativePath: string;
  title: string;
  aliases: string[];
  tags: string[];
  headings: string[];
}) {
  const route = stripMarkdownExtension(input.relativePath);
  return [
    `- [[${route}]] - ${input.title}`,
    `  - aliases: ${formatList(input.aliases)}`,
    `  - tags: ${formatList(input.tags)}`,
    `  - headings: ${formatList(input.headings.slice(0, 6))}`
  ].join('\n');
}

export function createProjectKnowledgeSuggestedIndexDraft(
  snapshot: ProjectKnowledgeIndexSnapshot,
  options: { nowIso?: () => string } = {}
): ProjectKnowledgeSuggestedIndexDraft {
  const generatedAt = (options.nowIso ?? (() => new Date().toISOString()))();
  const sectionsByRelativePath = new Map<string, string[]>();
  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));

  for (const section of snapshot.sections) {
    const source = sourceById.get(section.sourceId);
    if (!source || !section.heading?.trim()) {
      continue;
    }
    const headings = sectionsByRelativePath.get(source.relativePath) ?? [];
    if (!headings.includes(section.heading.trim())) {
      headings.push(section.heading.trim());
    }
    sectionsByRelativePath.set(source.relativePath, headings);
  }

  const indexedSources = snapshot.sources
    .filter((source) => !source.skippedReason)
    .sort((first, second) => first.relativePath.localeCompare(second.relativePath));
  const skippedSources = snapshot.sources
    .filter((source) => source.skippedReason)
    .sort((first, second) => first.relativePath.localeCompare(second.relativePath));

  const routeLines = indexedSources.length > 0
    ? indexedSources.map((source) =>
        createRouteLine({
          relativePath: source.relativePath,
          title: source.title,
          aliases: source.aliases,
          tags: source.tags,
          headings: sectionsByRelativePath.get(source.relativePath) ?? []
        })
      )
    : ['- No markdown pages are currently indexed.'];

  const skippedLines = skippedSources.length > 0
    ? skippedSources.map((source) => `- ${source.relativePath}: ${source.skippedReason}`)
    : ['- none'];

  const diagnosticLines = snapshot.diagnostics.length > 0
    ? snapshot.diagnostics.slice(0, 30).map((diagnostic) => {
        const location = diagnostic.relativePath ? `${diagnostic.relativePath}: ` : '';
        const action = diagnostic.suggestedAction ? ` Suggested action: ${diagnostic.suggestedAction}` : '';
        return `- ${diagnostic.severity} ${diagnostic.code}: ${location}${diagnostic.message}${action}`;
      })
    : ['- none'];

  const content = [
    '# Project Knowledge Index',
    '',
    `Generated draft: ${generatedAt}`,
    '',
    '> Draft generated from Vicode app-owned Project Knowledge index. Review before writing anything to the knowledge folder.',
    '',
    '## Routes',
    '',
    ...routeLines,
    '',
    '## Skipped Sources',
    '',
    ...skippedLines,
    '',
    '## Diagnostics To Review',
    '',
    ...diagnosticLines,
    ''
  ].join('\n');

  return {
    targetRelativePath: 'INDEX.md',
    generatedAt,
    sourceCount: indexedSources.length,
    diagnosticCount: snapshot.diagnostics.length,
    content
  };
}
