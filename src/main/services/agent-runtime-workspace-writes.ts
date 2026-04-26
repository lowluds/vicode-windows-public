import {
  mkdir,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  applyPatch as applyUnifiedDiffPatch,
  parsePatch
} from 'diff';
import type { AgentToolExecutionContext } from '../../providers/agent-runtime';
import {
  assertBuildPlannerWorkspaceMutationAllowed,
  requiresBuildControllerQueueHelper
} from './agent-runtime-build-planner-policy';
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

  assertBuildPlannerWorkspaceMutationAllowed(resolved.relativePath, context);
  await mkdir(resolved.absolutePath, { recursive: true });
  return resolved;
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

  if (requiresBuildControllerQueueHelper(resolved.relativePath, context)) {
    throw new Error(
      `Direct queue edits are not allowed for ${resolved.relativePath}. Use .vicode/control/update_build_ticket_queue.py instead.`
    );
  }

  assertBuildPlannerWorkspaceMutationAllowed(resolved.relativePath, context);

  await mkdir(dirname(resolved.absolutePath), { recursive: true });
  await writeFile(resolved.absolutePath, content, 'utf8');
  return resolved;
}

export async function applyWorkspacePatch(
  patch: string,
  context: AgentToolExecutionContext
): Promise<string[]> {
  const parsed = parseWorkspacePatch(patch);
  if (parsed.length === 0) {
    throw new Error('Patch did not contain any file changes.');
  }

  const changedPaths: string[] = [];

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
    assertBuildPlannerWorkspaceMutationAllowed(resolved.relativePath, context);
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

    if (newFileName === '/dev/null') {
      await rm(resolved.absolutePath, { force: true });
    } else {
      await mkdir(dirname(resolved.absolutePath), { recursive: true });
      await writeFile(resolved.absolutePath, nextContent, 'utf8');
    }

    changedPaths.push(resolved.relativePath);
  }

  return changedPaths;
}
