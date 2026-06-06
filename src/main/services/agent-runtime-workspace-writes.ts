import {
  mkdir,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  applyPatch as applyUnifiedDiffPatch,
  diffLines,
  parsePatch
} from 'diff';
import type {
  AgentToolExecutionContext,
  StagedWorkspaceChangeSet,
  StagedWorkspaceOperation,
  StagedWorkspaceSourceToolName
} from '../../providers/agent-runtime';
import {
  normalizeWorkspacePath,
  type WorkspacePathResolution
} from './agent-runtime-workspace-paths';

function toPatchTargetPath(fileName: string) {
  return fileName === '/dev/null' ? fileName : fileName.replace(/^[ab]\//u, '');
}

const hunkHeaderPattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/u;
const workspacePatchFuzzFactor = 2;
type ParsedWorkspaceFilePatch = ReturnType<typeof parsePatch>[number];
interface PreparedWorkspacePatch {
  resolved: WorkspacePathResolution;
  beforeContent: string | null;
  nextContent: string | null;
}
interface PreparedStagedWorkspaceOperationApply {
  operation: StagedWorkspaceOperation;
  resolved: WorkspacePathResolution;
}

function isPatchFileBoundary(lines: string[], index: number) {
  const line = lines[index] ?? '';
  if (/^(?:diff --git\s|Index:\s|===================================================================)/u.test(line)) {
    return true;
  }

  return /^---\s/u.test(line) && /^\+\+\+\s/u.test(lines[index + 1] ?? '');
}

function normalizeUnifiedDiffHunkCounts(patch: string) {
  const lines = patch.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const headerMatch = lines[index]?.match(hunkHeaderPattern);
    if (!headerMatch) {
      continue;
    }

    let oldLines = 0;
    let newLines = 0;
    for (let hunkLineIndex = index + 1; hunkLineIndex < lines.length; hunkLineIndex += 1) {
      const hunkLine = lines[hunkLineIndex] ?? '';
      if (hunkHeaderPattern.test(hunkLine) || isPatchFileBoundary(lines, hunkLineIndex)) {
        break;
      }
      if (hunkLine === '' && hunkLineIndex === lines.length - 1) {
        break;
      }

      const operation = hunkLine[0];
      if (operation === '+') {
        newLines += 1;
      } else if (operation === '-') {
        oldLines += 1;
      } else if (operation === ' ') {
        oldLines += 1;
        newLines += 1;
      } else if (operation !== '\\') {
        break;
      }
    }

    const oldStart = headerMatch[1];
    const newStart = headerMatch[2];
    const suffix = headerMatch[3] ?? '';
    const oldCount = oldLines === 1 ? '' : `,${oldLines}`;
    const newCount = newLines === 1 ? '' : `,${newLines}`;
    lines[index] = `@@ -${oldStart}${oldCount} +${newStart}${newCount} @@${suffix}`;
  }

  return lines.join('\n');
}

function parseWorkspacePatch(patch: string) {
  try {
    return parsePatch(normalizeUnifiedDiffHunkCounts(patch));
  } catch (error) {
    const detail = error instanceof Error && error.message.trim() ? error.message.trim() : 'Patch could not be parsed.';
    throw new Error(
      `Patch is malformed: ${detail}. Re-read the target file and retry with a smaller patch, or use write_file for the full file content.`
    );
  }
}

function countTextLines(content: string) {
  if (content.length === 0) {
    return 0;
  }

  const lines = content.split(/\r?\n/u);
  return content.endsWith('\n') ? lines.length - 1 : lines.length;
}

function summarizeContentChange(beforeContent: string | null, afterContent: string | null) {
  let insertions = 0;
  let deletions = 0;

  for (const part of diffLines(beforeContent ?? '', afterContent ?? '')) {
    const lineCount = typeof part.count === 'number' ? part.count : countTextLines(part.value);
    if (part.added) {
      insertions += lineCount;
    } else if (part.removed) {
      deletions += lineCount;
    }
  }

  return { insertions, deletions };
}

function summarizeOperations(operations: StagedWorkspaceOperation[]) {
  return operations.reduce(
    (summary, operation) => {
      if (operation.operation === 'mkdir') {
        return summary;
      }

      const diff = summarizeContentChange(
        operation.beforeContent,
        operation.proposedAfterContent
      );

      return {
        filesChanged: summary.filesChanged + 1,
        insertions: summary.insertions + diff.insertions,
        deletions: summary.deletions + diff.deletions
      };
    },
    {
      filesChanged: 0,
      insertions: 0,
      deletions: 0
    }
  );
}

function createStagedWorkspaceChangeSet(input: {
  context: AgentToolExecutionContext;
  sourceToolName: StagedWorkspaceSourceToolName;
  requestedPath: string | null;
  changedPaths: string[];
  operations: StagedWorkspaceOperation[];
}): StagedWorkspaceChangeSet {
  return {
    threadId: input.context.threadId ?? null,
    runId: input.context.runId ?? null,
    sourceToolName: input.sourceToolName,
    isolationMode: 'patch_buffer',
    status: 'proposed',
    requestedPath: input.requestedPath,
    changedPaths: input.changedPaths,
    operations: input.operations,
    summary: summarizeOperations(input.operations)
  };
}

function splitPatchContentLines(content: string) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const hasTrailingNewline = content.endsWith('\n');
  const lines = content.split(/\r?\n/u);
  if (hasTrailingNewline) {
    lines.pop();
  }

  return {
    lines,
    newline,
    hasTrailingNewline
  };
}

function joinPatchContentLines(lines: string[], newline: string, hasTrailingNewline: boolean) {
  return `${lines.join(newline)}${hasTrailingNewline ? newline : ''}`;
}

function findUniqueLineSequence(lines: string[], sequence: string[], startIndex: number) {
  if (sequence.length === 0) {
    return null;
  }

  let matchIndex: number | null = null;
  for (let index = Math.max(0, startIndex); index <= lines.length - sequence.length; index += 1) {
    let matches = true;
    for (let sequenceIndex = 0; sequenceIndex < sequence.length; sequenceIndex += 1) {
      if (lines[index + sequenceIndex] !== sequence[sequenceIndex]) {
        matches = false;
        break;
      }
    }
    if (!matches) {
      continue;
    }
    if (matchIndex !== null) {
      return null;
    }
    matchIndex = index;
  }

  return matchIndex;
}

function applyUniqueChangedLineFallback(currentContent: string, filePatch: ParsedWorkspaceFilePatch) {
  const content = splitPatchContentLines(currentContent);
  const lines = [...content.lines];
  let searchStart = 0;
  let appliedChangeCount = 0;

  for (const hunk of filePatch.hunks) {
    let removalGroup: string[] = [];
    let additionGroup: string[] = [];

    const flushChangeGroup = () => {
      if (removalGroup.length === 0 && additionGroup.length === 0) {
        return true;
      }
      if (removalGroup.length === 0) {
        return false;
      }

      const matchIndex = findUniqueLineSequence(lines, removalGroup, searchStart);
      if (matchIndex === null) {
        return false;
      }

      lines.splice(matchIndex, removalGroup.length, ...additionGroup);
      searchStart = matchIndex + additionGroup.length;
      appliedChangeCount += 1;
      removalGroup = [];
      additionGroup = [];
      return true;
    };

    for (const line of hunk.lines) {
      const operation = line[0] || ' ';
      if (operation === '-') {
        removalGroup.push(line.slice(1));
        continue;
      }
      if (operation === '+') {
        additionGroup.push(line.slice(1));
        continue;
      }
      if (!flushChangeGroup()) {
        return false;
      }
    }

    if (!flushChangeGroup()) {
      return false;
    }
  }

  if (appliedChangeCount === 0) {
    return false;
  }

  return joinPatchContentLines(lines, content.newline, content.hasTrailingNewline);
}

export async function createWorkspaceDirectory(
  requestedPath: string,
  context: AgentToolExecutionContext
): Promise<WorkspacePathResolution> {
  const resolved = normalizeWorkspacePath(
    context.workspaceRoot,
    requestedPath
  );

  if (resolved.relativePath === '.') {
    throw new Error(
      'mkdir requires a subdirectory path inside the workspace.'
    );
  }

  await mkdir(resolved.absolutePath, { recursive: true });
  return resolved;
}

export function stageWorkspaceDirectory(
  requestedPath: string,
  context: AgentToolExecutionContext
): StagedWorkspaceChangeSet {
  const resolved = normalizeWorkspacePath(
    context.workspaceRoot,
    requestedPath
  );

  if (resolved.relativePath === '.') {
    throw new Error(
      'mkdir requires a subdirectory path inside the workspace.'
    );
  }

  return createStagedWorkspaceChangeSet({
    context,
    sourceToolName: 'mkdir',
    requestedPath: resolved.relativePath,
    changedPaths: [resolved.relativePath],
    operations: [
      {
        operation: 'mkdir',
        path: resolved.relativePath,
        beforeContent: null,
        proposedAfterContent: null,
        patchText: null
      }
    ]
  });
}

export async function writeWorkspaceTextFile(
  requestedPath: string,
  content: string,
  context: AgentToolExecutionContext
): Promise<WorkspacePathResolution> {
  const resolved = normalizeWorkspacePath(
    context.workspaceRoot,
    requestedPath
  );

  if (resolved.relativePath === '.') {
    throw new Error(
      'write_file requires a file path inside the workspace.'
    );
  }

  await mkdir(dirname(resolved.absolutePath), { recursive: true });
  await writeFile(resolved.absolutePath, content, 'utf8');
  return resolved;
}

export async function stageWorkspaceTextFile(
  requestedPath: string,
  content: string,
  context: AgentToolExecutionContext
): Promise<StagedWorkspaceChangeSet> {
  const resolved = normalizeWorkspacePath(
    context.workspaceRoot,
    requestedPath
  );

  if (resolved.relativePath === '.') {
    throw new Error(
      'write_file requires a file path inside the workspace.'
    );
  }

  const beforeContent = await readFile(resolved.absolutePath, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  });

  return createStagedWorkspaceChangeSet({
    context,
    sourceToolName: 'write_file',
    requestedPath: resolved.relativePath,
    changedPaths: [resolved.relativePath],
    operations: [
      {
        operation: 'write_file',
        path: resolved.relativePath,
        beforeContent,
        proposedAfterContent: content,
        patchText: null
      }
    ]
  });
}

async function prepareWorkspacePatches(
  patch: string,
  context: AgentToolExecutionContext
) {
  const parsed = parseWorkspacePatch(patch);
  if (parsed.length === 0) {
    throw new Error('Patch did not contain any file changes.');
  }

  const preparedPatches: PreparedWorkspacePatch[] = [];

  for (const filePatch of parsed) {
    const oldFileName = toPatchTargetPath(filePatch.oldFileName ?? '');
    const newFileName = toPatchTargetPath(filePatch.newFileName ?? '');
    if (!oldFileName && !newFileName) {
      throw new Error('Patch file header is missing target paths.');
    }

    const targetName =
      newFileName !== '/dev/null' ? newFileName : oldFileName;
    const resolved = normalizeWorkspacePath(
      context.workspaceRoot,
      targetName
    );
    const currentContent =
      oldFileName === '/dev/null'
        ? ''
        : await readFile(resolved.absolutePath, 'utf8').catch((error) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              throw new Error(
                `Patch target does not exist: ${resolved.relativePath}`
              );
            }
            throw error;
          });

    const strictNextContent = applyUnifiedDiffPatch(currentContent, filePatch, {
      fuzzFactor: workspacePatchFuzzFactor
    });
    const nextContent =
      strictNextContent === false
        ? applyUniqueChangedLineFallback(currentContent, filePatch)
        : strictNextContent;
    if (nextContent === false) {
      throw new Error(
        `Patch could not be applied to ${resolved.relativePath}. Re-read the target file and retry with fresh context, or use write_file for the full file content.`
      );
    }

    preparedPatches.push({
      resolved,
      beforeContent: oldFileName === '/dev/null' ? null : currentContent,
      nextContent: newFileName === '/dev/null' ? null : nextContent
    });
  }

  return preparedPatches;
}

export async function applyWorkspacePatch(
  patch: string,
  context: AgentToolExecutionContext
): Promise<string[]> {
  const preparedPatches = await prepareWorkspacePatches(patch, context);

  for (const prepared of preparedPatches) {
    if (prepared.nextContent === null) {
      await rm(prepared.resolved.absolutePath, { force: true });
    } else {
      await mkdir(dirname(prepared.resolved.absolutePath), { recursive: true });
      await writeFile(prepared.resolved.absolutePath, prepared.nextContent, 'utf8');
    }
  }

  return preparedPatches.map((prepared) => prepared.resolved.relativePath);
}

export async function stageWorkspacePatch(
  patch: string,
  context: AgentToolExecutionContext
): Promise<StagedWorkspaceChangeSet> {
  const preparedPatches = await prepareWorkspacePatches(patch, context);

  const operations = preparedPatches.map((prepared): StagedWorkspaceOperation => ({
    operation: prepared.nextContent === null ? 'delete' : 'apply_patch',
    path: prepared.resolved.relativePath,
    beforeContent: prepared.beforeContent,
    proposedAfterContent: prepared.nextContent,
    patchText: patch
  }));

  return createStagedWorkspaceChangeSet({
    context,
    sourceToolName: 'apply_patch',
    requestedPath: null,
    changedPaths: preparedPatches.map((prepared) => prepared.resolved.relativePath),
    operations
  });
}

async function readWorkspaceOperationContent(absolutePath: string) {
  return await readFile(absolutePath, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  });
}

export async function applyStagedWorkspaceChangeSet(
  changeSet: StagedWorkspaceChangeSet,
  context: AgentToolExecutionContext
): Promise<string[]> {
  const prepared: PreparedStagedWorkspaceOperationApply[] = [];

  for (const operation of changeSet.operations) {
    if (!operation.path || typeof operation.path !== 'string') {
      throw new Error('Approved workspace change is missing a target path.');
    }

    const resolved = normalizeWorkspacePath(context.workspaceRoot, operation.path);
    const currentContent = operation.operation === 'mkdir'
      ? null
      : await readWorkspaceOperationContent(resolved.absolutePath);

    if (operation.operation !== 'mkdir' && currentContent !== operation.beforeContent) {
      throw new Error(
        `Workspace changed after approval was requested for ${resolved.relativePath}. Re-read the file and retry the patch.`
      );
    }

    prepared.push({ operation, resolved });
  }

  for (const { operation, resolved } of prepared) {
    if (operation.operation === 'mkdir') {
      await mkdir(resolved.absolutePath, { recursive: true });
      continue;
    }

    if (operation.operation === 'delete' || operation.proposedAfterContent === null) {
      await rm(resolved.absolutePath, { force: true });
      continue;
    }

    await mkdir(dirname(resolved.absolutePath), { recursive: true });
    await writeFile(resolved.absolutePath, operation.proposedAfterContent, 'utf8');
  }

  return changeSet.changedPaths.slice();
}
