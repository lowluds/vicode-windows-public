import { relative, resolve } from 'node:path';

export interface WorkspacePathResolution {
  absolutePath: string;
  relativePath: string;
}

export function normalizeWorkspacePath(
  workspaceRoot: string,
  candidate: string
): WorkspacePathResolution {
  const trimmed = candidate.trim();
  if (!trimmed) {
    throw new Error('Tool path is required.');
  }

  const normalizedRoot = resolve(workspaceRoot);
  const normalizedPath = resolve(normalizedRoot, trimmed);
  const relativePath = relative(normalizedRoot, normalizedPath);

  if (relativePath === '') {
    return {
      absolutePath: normalizedPath,
      relativePath: '.'
    };
  }

  if (relativePath.startsWith('..')) {
    throw new Error(
      `Tool path must stay inside the trusted workspace: ${trimmed}`
    );
  }

  return {
    absolutePath: normalizedPath,
    relativePath: relativePath.replace(/\\/gu, '/')
  };
}
