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
      'mkdir requires a subdirectory path inside the trusted workspace.'
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
      'write_file requires a file path inside the trusted workspace.'
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
  const parsed = parsePatch(patch);
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

    const nextContent = applyUnifiedDiffPatch(currentContent, filePatch);
    if (nextContent === false) {
      throw new Error(`Failed to apply patch for ${resolved.relativePath}.`);
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
