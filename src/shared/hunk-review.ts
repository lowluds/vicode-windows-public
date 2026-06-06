import type {
  RunChangeArtifact,
  RunChangePreviewLine,
  RunChangedFileArtifact,
  StagedWorkspaceHunkReviewDecision
} from './domain';

export const HUNK_REVIEW_PARSER_VERSION = 'hunk-v1';

const HUNK_CONTEXT_LINES = 3;
const HUNK_SPLIT_CONTEXT_GAP = HUNK_CONTEXT_LINES * 2;

export type HunkReviewSource = 'staged_workspace_preview' | 'worktree_diff';
export type HunkReviewFileStatus = RunChangedFileArtifact['status'];
export type HunkReviewStatus = 'pending' | 'accepted' | 'rejected' | 'applied' | 'failed';
export type HunkReviewOperation = 'accept' | 'reject' | 'apply' | 'revert';
export type HunkReviewDriftState = 'not_checked' | 'clean' | 'drifted' | 'unsupported';
export type HunkReviewSupportKind = 'partial' | 'all_or_nothing' | 'unsupported';

export interface HunkReviewLineRange {
  startLine: number | null;
  lineCount: number;
}

export interface RunChangeHunkArtifact {
  id: string;
  parserVersion: typeof HUNK_REVIEW_PARSER_VERSION;
  source: HunkReviewSource;
  filePath: string;
  fileStatus: HunkReviewFileStatus;
  hunkStatus: HunkReviewStatus;
  beforeRange: HunkReviewLineRange;
  afterRange: HunkReviewLineRange;
  previewLines: RunChangePreviewLine[];
  selectedOperation: HunkReviewOperation | null;
  driftState: HunkReviewDriftState;
  partialApplySupported: boolean;
  supportKind: HunkReviewSupportKind;
  unsupportedReason: string | null;
}

export interface RunChangeHunkParseResult {
  parserVersion: typeof HUNK_REVIEW_PARSER_VERSION;
  source: RunChangeArtifact['source'] | 'unknown';
  artifactSupported: boolean;
  unsupportedReason: string | null;
  hunks: RunChangeHunkArtifact[];
}

export type { StagedWorkspaceHunkReviewDecision } from './domain';

interface FilePathResolution {
  path: string;
  unsupportedReason: string | null;
}

interface HunkSupport {
  kind: HunkReviewSupportKind;
  partialApplySupported: boolean;
  driftState: HunkReviewDriftState;
  unsupportedReason: string | null;
}

function isSupportedSource(source: RunChangeArtifact['source']): source is HunkReviewSource {
  return source === 'staged_workspace_preview' || source === 'worktree_diff';
}

function isAbsoluteLocalPath(filePath: string) {
  return (
    /^[A-Za-z]:[\\/]/u.test(filePath)
    || filePath.startsWith('\\\\')
    || filePath.startsWith('//')
    || filePath.startsWith('/')
  );
}

function sanitizeFilePath(filePath: string): FilePathResolution {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    return {
      path: '[invalid-path]',
      unsupportedReason: 'File path is missing or invalid.'
    };
  }

  if (isAbsoluteLocalPath(filePath)) {
    return {
      path: '[absolute-path]',
      unsupportedReason: 'Absolute local file paths are not supported in hunk artifacts.'
    };
  }

  return {
    path: filePath.replace(/\\/gu, '/'),
    unsupportedReason: null
  };
}

function lineNumberRange(lineNumbers: number[]): HunkReviewLineRange {
  if (lineNumbers.length === 0) {
    return {
      startLine: null,
      lineCount: 0
    };
  }

  return {
    startLine: Math.min(...lineNumbers),
    lineCount: lineNumbers.length
  };
}

function deriveBeforeRange(lines: RunChangePreviewLine[]) {
  return lineNumberRange(
    lines
      .filter((line) => line.type === 'removed' && typeof line.oldLineNumber === 'number')
      .map((line) => line.oldLineNumber as number)
  );
}

function deriveAfterRange(lines: RunChangePreviewLine[]) {
  return lineNumberRange(
    lines
      .filter((line) => line.type === 'added' && typeof line.newLineNumber === 'number')
      .map((line) => line.newLineNumber as number)
  );
}

function hasAmbiguousLineNumbers(lines: RunChangePreviewLine[]) {
  const oldLineNumbers = lines
    .map((line) => line.oldLineNumber)
    .filter((lineNumber): lineNumber is number => typeof lineNumber === 'number');
  const newLineNumbers = lines
    .map((line) => line.newLineNumber)
    .filter((lineNumber): lineNumber is number => typeof lineNumber === 'number');

  return !isStrictlyIncreasing(oldLineNumbers) || !isStrictlyIncreasing(newLineNumbers);
}

function isStrictlyIncreasing(values: number[]) {
  for (let index = 1; index < values.length; index += 1) {
    if ((values[index] as number) <= (values[index - 1] as number)) {
      return false;
    }
  }
  return true;
}

function stableHash(input: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildHunkId(input: {
  source: HunkReviewSource;
  filePath: string;
  fileStatus: HunkReviewFileStatus;
  beforeRange: HunkReviewLineRange;
  afterRange: HunkReviewLineRange;
  previewLines: RunChangePreviewLine[];
}) {
  const hashInput = JSON.stringify({
    parserVersion: HUNK_REVIEW_PARSER_VERSION,
    source: input.source,
    filePath: input.filePath,
    fileStatus: input.fileStatus,
    beforeRange: input.beforeRange,
    afterRange: input.afterRange,
    previewLines: input.previewLines.map((line) => ({
      type: line.type,
      text: line.text
    }))
  });

  return `${HUNK_REVIEW_PARSER_VERSION}-${stableHash(hashInput)}`;
}

function fileSupport(file: RunChangedFileArtifact, pathResolution: FilePathResolution): HunkSupport {
  if (pathResolution.unsupportedReason) {
    return {
      kind: 'unsupported',
      partialApplySupported: false,
      driftState: 'unsupported',
      unsupportedReason: pathResolution.unsupportedReason
    };
  }

  if (file.previewTruncated) {
    return {
      kind: 'unsupported',
      partialApplySupported: false,
      driftState: 'unsupported',
      unsupportedReason: 'Partial hunk apply is unsupported for truncated previews.'
    };
  }

  if (file.status === 'added' || file.status === 'deleted') {
    return {
      kind: 'all_or_nothing',
      partialApplySupported: false,
      driftState: 'unsupported',
      unsupportedReason: `${file.status === 'added' ? 'Added' : 'Deleted'} files are all-or-nothing until partial file synthesis is explicitly supported.`
    };
  }

  return {
    kind: 'partial',
    partialApplySupported: true,
    driftState: 'not_checked',
    unsupportedReason: null
  };
}

function applyHunkSpecificSupport(baseSupport: HunkSupport, hunkLines: RunChangePreviewLine[]): HunkSupport {
  if (baseSupport.kind === 'unsupported') {
    return baseSupport;
  }

  if (hasAmbiguousLineNumbers(hunkLines)) {
    return {
      kind: 'unsupported',
      partialApplySupported: false,
      driftState: 'unsupported',
      unsupportedReason: 'Partial hunk apply is unsupported for ambiguous or overlapping line ranges.'
    };
  }

  return baseSupport;
}

function createHunk(
  source: HunkReviewSource,
  file: RunChangedFileArtifact,
  filePath: string,
  lines: RunChangePreviewLine[],
  support: HunkSupport
): RunChangeHunkArtifact {
  const beforeRange = deriveBeforeRange(lines);
  const afterRange = deriveAfterRange(lines);
  const resolvedSupport = applyHunkSpecificSupport(support, lines);

  return {
    id: buildHunkId({
      source,
      filePath,
      fileStatus: file.status,
      beforeRange,
      afterRange,
      previewLines: lines
    }),
    parserVersion: HUNK_REVIEW_PARSER_VERSION,
    source,
    filePath,
    fileStatus: file.status,
    hunkStatus: 'pending',
    beforeRange,
    afterRange,
    previewLines: lines,
    selectedOperation: null,
    driftState: resolvedSupport.driftState,
    partialApplySupported: resolvedSupport.partialApplySupported,
    supportKind: resolvedSupport.kind,
    unsupportedReason: resolvedSupport.unsupportedReason
  };
}

function changedLineIndexes(lines: RunChangePreviewLine[]) {
  const indexes: number[] = [];
  lines.forEach((line, index) => {
    if (line.type === 'added' || line.type === 'removed') {
      indexes.push(index);
    }
  });
  return indexes;
}

function groupModifiedPreviewLines(lines: RunChangePreviewLine[]) {
  const changeIndexes = changedLineIndexes(lines);
  if (changeIndexes.length === 0) {
    return [];
  }

  const groups: Array<{ firstChangeIndex: number; lastChangeIndex: number }> = [];
  let firstChangeIndex = changeIndexes[0] as number;
  let lastChangeIndex = changeIndexes[0] as number;

  for (const changeIndex of changeIndexes.slice(1)) {
    if (changeIndex - lastChangeIndex > HUNK_SPLIT_CONTEXT_GAP) {
      groups.push({ firstChangeIndex, lastChangeIndex });
      firstChangeIndex = changeIndex;
    }
    lastChangeIndex = changeIndex;
  }
  groups.push({ firstChangeIndex, lastChangeIndex });

  return groups.map((group) => {
    const start = Math.max(0, group.firstChangeIndex - HUNK_CONTEXT_LINES);
    const end = Math.min(lines.length, group.lastChangeIndex + HUNK_CONTEXT_LINES + 1);
    return lines.slice(start, end);
  });
}

function parseFileHunks(source: HunkReviewSource, file: RunChangedFileArtifact) {
  const pathResolution = sanitizeFilePath(file.path);
  const support = fileSupport(file, pathResolution);
  const groups =
    file.status === 'modified'
      ? groupModifiedPreviewLines(file.previewLines)
      : file.previewLines.length > 0
        ? [file.previewLines]
        : [];

  return groups.map((lines) => createHunk(source, file, pathResolution.path, lines, support));
}

export function parseRunChangeHunks(artifact: RunChangeArtifact): RunChangeHunkParseResult {
  const source = artifact.source ?? 'unknown';
  if (!isSupportedSource(artifact.source)) {
    return {
      parserVersion: HUNK_REVIEW_PARSER_VERSION,
      source,
      artifactSupported: false,
      unsupportedReason: `RunChangeArtifact source ${source} is not supported for hunk review.`,
      hunks: []
    };
  }

  return {
    parserVersion: HUNK_REVIEW_PARSER_VERSION,
    source,
    artifactSupported: true,
    unsupportedReason: null,
    hunks: artifact.files.flatMap((file) => parseFileHunks(source, file))
  };
}

function splitContentLines(content: string) {
  if (content.length === 0) {
    return {
      lines: [] as string[],
      trailingNewline: false
    };
  }

  const normalized = content.replace(/\r\n/gu, '\n');
  const lines = normalized.split('\n');
  const trailingNewline = lines[lines.length - 1] === '';
  if (trailingNewline) {
    lines.pop();
  }
  return {
    lines,
    trailingNewline
  };
}

function joinContentLines(lines: string[], trailingNewline: boolean) {
  const joined = lines.join('\n');
  if (trailingNewline && joined.length > 0) {
    return `${joined}\n`;
  }
  return joined;
}

interface HunkContentEdit {
  startIndex: number;
  deleteCount: number;
  expectedBeforeLines: string[];
  replacementLines: string[];
}

function hunkContentEdit(hunk: RunChangeHunkArtifact): HunkContentEdit {
  if (!hunk.partialApplySupported || hunk.supportKind !== 'partial') {
    throw new Error(hunk.unsupportedReason ?? `Hunk ${hunk.id} does not support partial apply.`);
  }

  const beforeSpanLines = hunk.previewLines.filter((line) => typeof line.oldLineNumber === 'number');
  const replacementLines = hunk.previewLines
    .filter((line) => line.type !== 'removed')
    .map((line) => line.text);

  if (beforeSpanLines.length === 0) {
    const firstAddedLine = hunk.previewLines.find((line) => line.type === 'added');
    return {
      startIndex: Math.max(0, (firstAddedLine?.newLineNumber ?? 1) - 1),
      deleteCount: 0,
      expectedBeforeLines: [],
      replacementLines
    };
  }

  const firstLineNumber = beforeSpanLines[0]?.oldLineNumber;
  if (typeof firstLineNumber !== 'number') {
    throw new Error(`Hunk ${hunk.id} is missing a stable before line range.`);
  }

  const expectedBeforeLines = beforeSpanLines.map((line, index) => {
    const expectedLineNumber = firstLineNumber + index;
    if (line.oldLineNumber !== expectedLineNumber) {
      throw new Error(`Hunk ${hunk.id} has an ambiguous or overlapping before line range.`);
    }
    return line.text;
  });

  return {
    startIndex: firstLineNumber - 1,
    deleteCount: expectedBeforeLines.length,
    expectedBeforeLines,
    replacementLines
  };
}

function assertNoOverlappingEdits(edits: HunkContentEdit[]) {
  const sorted = [...edits].sort((left, right) => left.startIndex - right.startIndex);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1] as HunkContentEdit;
    const current = sorted[index] as HunkContentEdit;
    if (previous.startIndex + previous.deleteCount > current.startIndex) {
      throw new Error('Selected hunks overlap and cannot be applied safely.');
    }
  }
}

export function synthesizeAcceptedHunkContent(file: RunChangedFileArtifact, acceptedHunks: RunChangeHunkArtifact[]) {
  if (file.status !== 'modified') {
    throw new Error(`${file.status} files are all-or-nothing and do not support partial hunk apply.`);
  }

  if (typeof file.beforeContent !== 'string') {
    throw new Error(`Modified file ${file.path} is missing beforeContent.`);
  }

  if (acceptedHunks.length === 0) {
    return file.beforeContent;
  }

  const parsed = splitContentLines(file.beforeContent);
  const edits = acceptedHunks.map(hunkContentEdit);
  assertNoOverlappingEdits(edits);

  const lines = [...parsed.lines];
  for (const edit of edits.sort((left, right) => right.startIndex - left.startIndex)) {
    const actualBeforeLines = lines.slice(edit.startIndex, edit.startIndex + edit.deleteCount);
    if (JSON.stringify(actualBeforeLines) !== JSON.stringify(edit.expectedBeforeLines)) {
      throw new Error('Selected hunk context no longer matches beforeContent.');
    }
    lines.splice(edit.startIndex, edit.deleteCount, ...edit.replacementLines);
  }

  return joinContentLines(lines, parsed.trailingNewline);
}
