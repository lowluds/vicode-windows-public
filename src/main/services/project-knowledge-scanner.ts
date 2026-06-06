import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import {
  createProjectKnowledgeContentHash,
  parseProjectKnowledgeMarkdown
} from './project-knowledge-markdown';

export const PROJECT_KNOWLEDGE_LIMITS = {
  maxFiles: 200,
  maxChunks: 600,
  maxFileChars: 120_000,
  maxSectionChars: 2_400,
  maxDiagnostics: 200
} as const;

export const PROJECT_KNOWLEDGE_ORIENTATION_FILE_NAMES = new Set([
  'agents.md',
  'index.md',
  'readme.md',
  'vicode.md'
]);

export const PROJECT_KNOWLEDGE_IGNORED_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.next',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'temp',
  'tmp'
]);

export type ProjectKnowledgeDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface ProjectKnowledgeScanDiagnostic {
  severity: ProjectKnowledgeDiagnosticSeverity;
  code: string;
  relativePath: string | null;
  message: string;
  suggestedAction: string | null;
}

export interface ProjectKnowledgeScannedSource {
  path: string;
  relativePath: string;
  fileName: string;
  fileSize: number;
  modifiedTimeMs: number;
  contentHash: string | null;
  title: string;
  aliases: string[];
  tags: string[];
  headingCount: number;
  skippedReason: string | null;
}

export interface ProjectKnowledgeScannedSection {
  sourceRelativePath: string;
  ordinal: number;
  title: string;
  aliases: string[];
  tags: string[];
  fileName: string;
  path: string;
  relativePath: string;
  heading: string | null;
  headingDepth: number;
  startLine: number | null;
  endLine: number | null;
  content: string;
  previewText: string;
  contentHash: string;
}

export interface ProjectKnowledgeScanResult {
  rootPath: string;
  sources: ProjectKnowledgeScannedSource[];
  sections: ProjectKnowledgeScannedSection[];
  diagnostics: ProjectKnowledgeScanDiagnostic[];
}

export function isReadableProjectKnowledgeRoot(path: string | null | undefined): path is string {
  if (!path) {
    return false;
  }

  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function normalizeProjectKnowledgePath(value: string) {
  return value.replace(/\\/gu, '/');
}

export function listProjectKnowledgeMarkdownRelativePaths(rootPath: string | null | undefined): string[] {
  const resolvedRootPath = rootPath?.trim() ?? '';
  const relativePaths: string[] = [];
  if (!isReadableProjectKnowledgeRoot(resolvedRootPath)) {
    return relativePaths;
  }

  const visit = (directory: string) => {
    if (relativePaths.length >= PROJECT_KNOWLEDGE_LIMITS.maxFiles) {
      return;
    }

    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }

    for (const entry of entries) {
      if (relativePaths.length >= PROJECT_KNOWLEDGE_LIMITS.maxFiles) {
        break;
      }

      const entryPath = join(directory, entry.name);

      if (entry.name.startsWith('.') && entry.name !== '.vicode') {
        continue;
      }

      if (entry.isDirectory()) {
        if (PROJECT_KNOWLEDGE_IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) {
          continue;
        }
        visit(entryPath);
        continue;
      }

      if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.md') {
        continue;
      }

      relativePaths.push(normalizeProjectKnowledgePath(relative(resolvedRootPath, entryPath)));
    }
  };

  visit(resolvedRootPath);
  return relativePaths;
}

export function scanProjectKnowledgeFolder(rootPath: string | null | undefined): ProjectKnowledgeScanResult {
  const resolvedRootPath = rootPath?.trim() ?? '';
  const result: ProjectKnowledgeScanResult = {
    rootPath: resolvedRootPath,
    sources: [],
    sections: [],
    diagnostics: []
  };

  if (!isReadableProjectKnowledgeRoot(resolvedRootPath)) {
    addDiagnostic(result.diagnostics, {
      severity: 'error',
      code: 'root_unreadable',
      relativePath: null,
      message: 'Project Knowledge folder is missing or cannot be read.',
      suggestedAction: 'Choose an existing folder and refresh the index again.'
    });
    return result;
  }

  let markdownFilesSeen = 0;

  const visit = (directory: string) => {
    if (markdownFilesSeen >= PROJECT_KNOWLEDGE_LIMITS.maxFiles) {
      return;
    }

    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      addDiagnostic(result.diagnostics, {
        severity: 'warning',
        code: 'directory_unreadable',
        relativePath: normalizeProjectKnowledgePath(relative(resolvedRootPath, directory)),
        message: 'A directory could not be read during Project Knowledge indexing.',
        suggestedAction: 'Check folder permissions if expected markdown pages are missing.'
      });
      return;
    }

    for (const entry of entries) {
      if (markdownFilesSeen >= PROJECT_KNOWLEDGE_LIMITS.maxFiles) {
        addDiagnostic(result.diagnostics, {
          severity: 'warning',
          code: 'file_limit_reached',
          relativePath: null,
          message: `Project Knowledge indexing stopped after ${PROJECT_KNOWLEDGE_LIMITS.maxFiles} markdown files.`,
          suggestedAction: 'Split or narrow the knowledge folder if important pages were not indexed.'
        });
        break;
      }

      const entryPath = join(directory, entry.name);
      const relativePath = normalizeProjectKnowledgePath(relative(resolvedRootPath, entryPath));

      if (entry.name.startsWith('.') && entry.name !== '.vicode') {
        addDiagnostic(result.diagnostics, {
          severity: 'info',
          code: 'ignored_directory',
          relativePath,
          message: 'Hidden infrastructure folder was skipped during Project Knowledge indexing.',
          suggestedAction: null
        });
        continue;
      }

      if (entry.isDirectory()) {
        if (PROJECT_KNOWLEDGE_IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) {
          addDiagnostic(result.diagnostics, {
            severity: 'info',
            code: 'ignored_directory',
            relativePath,
            message: 'Generated or dependency folder was skipped during Project Knowledge indexing.',
            suggestedAction: null
          });
          continue;
        }
        visit(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (extname(entry.name).toLowerCase() !== '.md') {
        addDiagnostic(result.diagnostics, {
          severity: 'info',
          code: 'unsupported_extension',
          relativePath,
          message: 'Only markdown files are indexed for Project Knowledge.',
          suggestedAction: 'Move durable knowledge into .md files if it should be retrieved.'
        });
        continue;
      }

      markdownFilesSeen += 1;
      scanMarkdownFile(resolvedRootPath, entryPath, result);
    }
  };

  visit(resolvedRootPath);
  addDuplicateDiagnostics(result.sources, result.diagnostics);
  return result;
}

function scanMarkdownFile(rootPath: string, filePath: string, result: ProjectKnowledgeScanResult) {
  const relativePath = normalizeProjectKnowledgePath(relative(rootPath, filePath));
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    addDiagnostic(result.diagnostics, {
      severity: 'warning',
      code: 'file_unreadable',
      relativePath,
      message: 'Markdown file could not be read during Project Knowledge indexing.',
      suggestedAction: 'Check file permissions if this page should be indexed.'
    });
    return;
  }

  const baseSource = {
    path: filePath,
    relativePath,
    fileName: basename(relativePath),
    fileSize: stat.size,
    modifiedTimeMs: Math.round(stat.mtimeMs)
  };

  if (stat.size <= 0) {
    result.sources.push(createSkippedSource(baseSource, 'empty_file'));
    addDiagnostic(result.diagnostics, {
      severity: 'info',
      code: 'skipped_empty_file',
      relativePath,
      message: 'Empty markdown file was skipped.',
      suggestedAction: null
    });
    return;
  }

  if (stat.size > PROJECT_KNOWLEDGE_LIMITS.maxFileChars * 4) {
    result.sources.push(createSkippedSource(baseSource, 'oversized_file'));
    addDiagnostic(result.diagnostics, {
      severity: 'warning',
      code: 'skipped_oversized_file',
      relativePath,
      message: 'Markdown file is larger than the Project Knowledge index limit.',
      suggestedAction: 'Split this page into smaller topic pages with clear headings.'
    });
    return;
  }

  let markdown;
  try {
    markdown = readFileSync(filePath, 'utf8');
  } catch {
    result.sources.push(createSkippedSource(baseSource, 'read_failed'));
    addDiagnostic(result.diagnostics, {
      severity: 'warning',
      code: 'file_unreadable',
      relativePath,
      message: 'Markdown file could not be read during Project Knowledge indexing.',
      suggestedAction: 'Check file permissions if this page should be indexed.'
    });
    return;
  }

  if (!markdown.trim() || markdown.includes('\0')) {
    result.sources.push(createSkippedSource(baseSource, 'non_text_or_empty'));
    addDiagnostic(result.diagnostics, {
      severity: 'warning',
      code: 'skipped_non_text_or_empty_file',
      relativePath,
      message: 'Markdown file did not contain readable text for Project Knowledge indexing.',
      suggestedAction: null
    });
    return;
  }

  const indexedMarkdown = markdown.slice(0, PROJECT_KNOWLEDGE_LIMITS.maxFileChars);
  const parsed = parseProjectKnowledgeMarkdown({
    ...baseSource,
    markdown: indexedMarkdown,
    contentHash: createProjectKnowledgeContentHash(markdown)
  }, {
    maxSectionChars: PROJECT_KNOWLEDGE_LIMITS.maxSectionChars,
    maxChunks: PROJECT_KNOWLEDGE_LIMITS.maxChunks
  });
  result.sources.push(parsed.source);
  result.sections.push(...parsed.sections);
  for (const diagnostic of parsed.diagnostics) {
    addDiagnostic(result.diagnostics, diagnostic);
  }

  if (markdown.length > indexedMarkdown.length) {
    addDiagnostic(result.diagnostics, {
      severity: 'warning',
      code: 'file_truncated_for_index',
      relativePath,
      message: 'Only the first part of this markdown file was indexed.',
      suggestedAction: 'Split long pages into focused markdown files with clear headings.'
    });
  }
}

function createSkippedSource(
  input: {
    path: string;
    relativePath: string;
    fileName: string;
    fileSize: number;
    modifiedTimeMs: number;
  },
  skippedReason: string
): ProjectKnowledgeScannedSource {
  return {
    ...input,
    contentHash: null,
    title: basename(input.relativePath, extname(input.relativePath)),
    aliases: [],
    tags: [],
    headingCount: 0,
    skippedReason
  };
}

function addDuplicateDiagnostics(
  sources: ProjectKnowledgeScannedSource[],
  diagnostics: ProjectKnowledgeScanDiagnostic[]
) {
  const indexedSources = sources.filter((source) => !source.skippedReason);
  const titles = new Map<string, ProjectKnowledgeScannedSource[]>();
  const aliases = new Map<string, ProjectKnowledgeScannedSource[]>();

  for (const source of indexedSources) {
    const titleKey = source.title.trim().toLowerCase();
    if (titleKey) {
      titles.set(titleKey, [...(titles.get(titleKey) ?? []), source]);
    }
    for (const alias of source.aliases) {
      const aliasKey = alias.trim().toLowerCase();
      if (aliasKey) {
        aliases.set(aliasKey, [...(aliases.get(aliasKey) ?? []), source]);
      }
    }
  }

  for (const duplicateSources of titles.values()) {
    if (duplicateSources.length <= 1) {
      continue;
    }
    for (const source of duplicateSources) {
      addDiagnostic(diagnostics, {
        severity: 'warning',
        code: 'duplicate_title',
        relativePath: source.relativePath,
        message: `Page title "${source.title}" is duplicated across Project Knowledge files.`,
        suggestedAction: 'Use distinct page titles or add stronger aliases for each page.'
      });
    }
  }

  for (const [alias, duplicateSources] of aliases.entries()) {
    if (duplicateSources.length <= 1) {
      continue;
    }
    for (const source of duplicateSources) {
      addDiagnostic(diagnostics, {
        severity: 'warning',
        code: 'duplicate_alias',
        relativePath: source.relativePath,
        message: `Alias "${alias}" is duplicated across Project Knowledge files.`,
        suggestedAction: 'Use aliases that point to one canonical page whenever possible.'
      });
    }
  }
}

function addDiagnostic(
  diagnostics: ProjectKnowledgeScanDiagnostic[],
  diagnostic: ProjectKnowledgeScanDiagnostic
) {
  if (diagnostics.length >= PROJECT_KNOWLEDGE_LIMITS.maxDiagnostics) {
    return;
  }
  diagnostics.push(diagnostic);
}
