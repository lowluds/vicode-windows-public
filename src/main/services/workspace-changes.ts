import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { diffLines, type Change } from 'diff';
import type {
  RunChangeArtifact,
  RunChangePreviewLine,
  RunChangedFileArtifact
} from '../../shared/domain';

const IGNORED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'out',
  'release',
  'playwright-report',
  'test-results',
  '.vite',
  '.tmp',
  '.cache'
]);

const TEXT_FILE_EXTENSIONS = new Set([
  '.astro',
  '.bat',
  '.c',
  '.cc',
  '.cmd',
  '.conf',
  '.cpp',
  '.css',
  '.cjs',
  '.go',
  '.graphql',
  '.gql',
  '.h',
  '.hpp',
  '.htm',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.less',
  '.md',
  '.mdx',
  '.mjs',
  '.ps1',
  '.psm1',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.svg',
  '.svelte',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml'
]);

const MAX_FILE_BYTES = 256 * 1024;
const MAX_DIFF_EDIT_LENGTH = 20_000;
const DIFF_TIMEOUT_MS = 250;
const MAX_PREVIEW_LINES = 160;
const MAX_BOUNDARY_CHANGE_LINES = 48;
const EDGE_CONTEXT_LINES = 3;

interface WorkspaceSnapshotFile {
  path: string;
  content: string;
}

export interface WorkspaceSnapshot {
  rootPath: string;
  files: Record<string, WorkspaceSnapshotFile>;
}

interface DiffOperation {
  type: RunChangePreviewLine['type'];
  text: string;
}

function normalizeRelativePath(rootPath: string, filePath: string) {
  return relative(rootPath, filePath).replace(/\\/gu, '/');
}

function isEligibleTextFile(filePath: string) {
  const extension = extname(filePath).toLowerCase();
  return TEXT_FILE_EXTENSIONS.has(extension);
}

function captureWorkspaceFiles(rootPath: string, currentPath: string, files: Record<string, WorkspaceSnapshotFile>) {
  for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIR_NAMES.has(entry.name)) {
        captureWorkspaceFiles(rootPath, join(currentPath, entry.name), files);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const absolutePath = join(currentPath, entry.name);
    if (!isEligibleTextFile(absolutePath)) {
      continue;
    }

    const stats = statSync(absolutePath);
    if (stats.size > MAX_FILE_BYTES) {
      continue;
    }

    const content = readFileSync(absolutePath, 'utf8');
    const relativePath = normalizeRelativePath(rootPath, absolutePath);
    files[relativePath] = {
      path: relativePath,
      content
    };
  }
}

export function captureWorkspaceSnapshot(folderPath: string | null) {
  if (!folderPath || !existsSync(folderPath)) {
    return null;
  }

  const files: Record<string, WorkspaceSnapshotFile> = {};
  captureWorkspaceFiles(folderPath, folderPath, files);
  return {
    rootPath: folderPath,
    files
  } satisfies WorkspaceSnapshot;
}

function splitLines(content: string) {
  if (content.length === 0) {
    return [];
  }

  const lines = content.replace(/\r\n/gu, '\n').split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function buildBoundaryDiff(beforeLines: string[], afterLines: string[]) {
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const prefixContext = beforeLines.slice(Math.max(0, prefix - EDGE_CONTEXT_LINES), prefix);
  const suffixContext = afterLines.slice(
    Math.max(prefix, afterLines.length - suffix),
    Math.max(prefix, afterLines.length - suffix) + EDGE_CONTEXT_LINES
  );
  const removed = beforeLines.slice(prefix, Math.max(prefix, beforeLines.length - suffix));
  const added = afterLines.slice(prefix, Math.max(prefix, afterLines.length - suffix));

  const operations: DiffOperation[] = [
    ...prefixContext.map((text) => ({ type: 'context' as const, text })),
    ...removed.slice(0, MAX_BOUNDARY_CHANGE_LINES).map((text) => ({ type: 'removed' as const, text })),
    ...added.slice(0, MAX_BOUNDARY_CHANGE_LINES).map((text) => ({ type: 'added' as const, text })),
    ...suffixContext.map((text) => ({ type: 'context' as const, text }))
  ];

  return {
    operations,
    insertions: added.length,
    deletions: removed.length,
    truncated:
      prefix > prefixContext.length ||
      suffix > suffixContext.length ||
      removed.length > MAX_BOUNDARY_CHANGE_LINES ||
      added.length > MAX_BOUNDARY_CHANGE_LINES
  };
}

function buildLineDiff(beforeContent: string, afterContent: string) {
  const changes = diffLines(beforeContent, afterContent, {
    ignoreNewlineAtEof: true,
    stripTrailingCr: true,
    maxEditLength: MAX_DIFF_EDIT_LENGTH,
    timeout: DIFF_TIMEOUT_MS
  });
  if (!changes) {
    return buildBoundaryDiff(splitLines(beforeContent), splitLines(afterContent));
  }

  const operations = changes.flatMap(changeToOperations);

  return {
    operations,
    insertions: operations.filter((operation) => operation.type === 'added').length,
    deletions: operations.filter((operation) => operation.type === 'removed').length,
    truncated: false
  };
}

function splitDiffChangeLines(value: string) {
  if (value.length === 0) {
    return [];
  }

  const lines = value.replace(/\r\n/gu, '\n').split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function changeToOperations(change: Change): DiffOperation[] {
  const type: DiffOperation['type'] = change.added ? 'added' : change.removed ? 'removed' : 'context';
  return splitDiffChangeLines(change.value).map((text) => ({
    type,
    text
  }));
}

function attachLineNumbers(operations: DiffOperation[]) {
  const previewLines: RunChangePreviewLine[] = [];
  let oldLineNumber = 1;
  let newLineNumber = 1;

  for (const operation of operations) {
    if (operation.type === 'context') {
      previewLines.push({
        type: operation.type,
        oldLineNumber,
        newLineNumber,
        text: operation.text
      });
      oldLineNumber += 1;
      newLineNumber += 1;
      continue;
    }

    if (operation.type === 'removed') {
      previewLines.push({
        type: operation.type,
        oldLineNumber,
        newLineNumber: null,
        text: operation.text
      });
      oldLineNumber += 1;
      continue;
    }

    previewLines.push({
      type: operation.type,
      oldLineNumber: null,
      newLineNumber,
      text: operation.text
    });
    newLineNumber += 1;
  }

  return previewLines;
}

function truncatePreviewLines(lines: RunChangePreviewLine[]) {
  if (lines.length <= MAX_PREVIEW_LINES) {
    return {
      previewLines: lines,
      previewTruncated: false
    };
  }

  const headCount = Math.ceil((MAX_PREVIEW_LINES - 1) * 0.6);
  const tailCount = Math.max(0, MAX_PREVIEW_LINES - 1 - headCount);
  return {
    previewLines: [
      ...lines.slice(0, headCount),
      {
        type: 'context',
        oldLineNumber: null,
        newLineNumber: null,
        text: '...'
      },
      ...lines.slice(-tailCount)
    ],
    previewTruncated: true
  };
}

export function deriveRunChangedFileArtifact(
  path: string,
  status: RunChangedFileArtifact['status'],
  beforeContent: string | null,
  afterContent: string | null
) {
  const diff = buildLineDiff(beforeContent ?? '', afterContent ?? '');
  const numbered = attachLineNumbers(diff.operations);
  const preview = truncatePreviewLines(numbered);

  return {
    path,
    status,
    insertions: diff.insertions,
    deletions: diff.deletions,
    beforeContent,
    afterContent,
    previewLines: preview.previewLines,
    previewTruncated: diff.truncated || preview.previewTruncated
  } satisfies RunChangedFileArtifact;
}

export function deriveRunChangeArtifact(
  snapshot: WorkspaceSnapshot | null,
  folderPath: string | null,
  options: {
    source?: RunChangeArtifact['source'];
  } = {}
) {
  if (!snapshot || !folderPath || snapshot.rootPath !== folderPath || !existsSync(folderPath)) {
    return null;
  }

  const nextSnapshot = captureWorkspaceSnapshot(folderPath);
  if (!nextSnapshot) {
    return null;
  }

  const filePaths = new Set([
    ...Object.keys(snapshot.files),
    ...Object.keys(nextSnapshot.files)
  ]);
  const files: RunChangedFileArtifact[] = [];
  let insertions = 0;
  let deletions = 0;

  for (const filePath of Array.from(filePaths).sort((left, right) => left.localeCompare(right))) {
    const beforeFile = snapshot.files[filePath] ?? null;
    const afterFile = nextSnapshot.files[filePath] ?? null;
    if (beforeFile?.content === afterFile?.content) {
      continue;
    }

    const status: RunChangedFileArtifact['status'] = beforeFile && afterFile ? 'modified' : beforeFile ? 'deleted' : 'added';
    const artifact = deriveRunChangedFileArtifact(filePath, status, beforeFile?.content ?? null, afterFile?.content ?? null);
    insertions += artifact.insertions;
    deletions += artifact.deletions;
    files.push(artifact);
  }

  if (files.length === 0) {
    return null;
  }

  return {
    source: options.source ?? 'workspace_diff',
    summary: {
      filesChanged: files.length,
      insertions,
      deletions
    },
    files
  } satisfies RunChangeArtifact;
}
