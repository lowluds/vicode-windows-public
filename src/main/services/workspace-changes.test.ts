import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureWorkspaceSnapshot, deriveRunChangeArtifact } from './workspace-changes';

const tempDirs: string[] = [];

function createWorkspace(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'vicode-workspace-changes-'));
  tempDirs.push(dir);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(dir, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, 'utf8');
  }

  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const current = tempDirs.pop();
    if (current) {
      rmSync(current, { recursive: true, force: true });
    }
  }
});

describe('workspace changes', () => {
  it('derives added, modified, and deleted text-file artifacts', () => {
    const workspace = createWorkspace({
      'src/app.tsx': ['const title = "Before";', 'console.log(title);'].join('\n'),
      'src/obsolete.ts': 'export const obsolete = true;\n'
    });

    const snapshot = captureWorkspaceSnapshot(workspace);
    expect(snapshot).not.toBeNull();

    writeFileSync(
      join(workspace, 'src/app.tsx'),
      ['const title = "After";', 'console.log(title);', 'console.log("done");'].join('\n'),
      'utf8'
    );
    writeFileSync(join(workspace, 'src/new-file.ts'), 'export const created = true;\n', 'utf8');
    rmSync(join(workspace, 'src/obsolete.ts'));

    const artifact = deriveRunChangeArtifact(snapshot, workspace);
    expect(artifact).not.toBeNull();
    expect(artifact?.source).toBe('workspace_diff');
    expect(artifact?.summary).toEqual({
      filesChanged: 3,
      insertions: 3,
      deletions: 2
    });
    expect(artifact?.files.map((file) => [file.path, file.status])).toEqual([
      ['src/app.tsx', 'modified'],
      ['src/new-file.ts', 'added'],
      ['src/obsolete.ts', 'deleted']
    ]);
    expect(artifact?.files[0]).toEqual(
      expect.objectContaining({
        beforeContent: ['const title = "Before";', 'console.log(title);'].join('\n'),
        afterContent: ['const title = "After";', 'console.log(title);', 'console.log("done");'].join('\n')
      })
    );
    expect(artifact?.files[1]).toEqual(
      expect.objectContaining({
        beforeContent: null,
        afterContent: 'export const created = true;\n'
      })
    );
    expect(artifact?.files[2]).toEqual(
      expect.objectContaining({
        beforeContent: 'export const obsolete = true;\n',
        afterContent: null
      })
    );
    expect(artifact?.files[0]?.previewLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'removed', text: 'const title = "Before";' }),
        expect.objectContaining({ type: 'added', text: 'const title = "After";' }),
        expect.objectContaining({ type: 'added', text: 'console.log("done");' })
      ])
    );
  });

  it('can label snapshot diffs as worktree-specific artifacts', () => {
    const workspace = createWorkspace({
      'src/app.ts': 'export const value = "before";\n'
    });

    const snapshot = captureWorkspaceSnapshot(workspace);
    expect(snapshot).not.toBeNull();

    writeFileSync(join(workspace, 'src/app.ts'), 'export const value = "after";\n', 'utf8');

    const artifact = deriveRunChangeArtifact(snapshot, workspace, { source: 'worktree_diff' });
    expect(artifact).toMatchObject({
      source: 'worktree_diff',
      summary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 1
      }
    });
  });

  it('normalizes CRLF input while keeping changed line numbers stable', () => {
    const workspace = createWorkspace({
      'src/app.ts': ['const one = 1;', 'const two = 2;', 'const three = 3;', ''].join('\r\n')
    });

    const snapshot = captureWorkspaceSnapshot(workspace);
    expect(snapshot).not.toBeNull();

    writeFileSync(
      join(workspace, 'src/app.ts'),
      ['const one = 1;', 'const two = 22;', 'const three = 3;', ''].join('\n'),
      'utf8'
    );

    const artifact = deriveRunChangeArtifact(snapshot, workspace);
    expect(artifact).toMatchObject({
      summary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 1
      }
    });
    expect(artifact?.files[0]?.previewLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'removed', oldLineNumber: 2, newLineNumber: null, text: 'const two = 2;' }),
        expect.objectContaining({ type: 'added', oldLineNumber: null, newLineNumber: 2, text: 'const two = 22;' })
      ])
    );
  });

  it('does not add insertion or deletion stats for final-newline-only changes', () => {
    const workspace = createWorkspace({
      'src/app.ts': 'export const value = true;\n'
    });

    const snapshot = captureWorkspaceSnapshot(workspace);
    expect(snapshot).not.toBeNull();

    writeFileSync(join(workspace, 'src/app.ts'), 'export const value = true;', 'utf8');

    const artifact = deriveRunChangeArtifact(snapshot, workspace);
    expect(artifact).toMatchObject({
      summary: {
        filesChanged: 1,
        insertions: 0,
        deletions: 0
      }
    });
    expect(artifact?.files[0]?.previewLines).toEqual([
      expect.objectContaining({
        type: 'context',
        oldLineNumber: 1,
        newLineNumber: 1,
        text: 'export const value = true;'
      })
    ]);
  });

  it('ignores generated folders and returns null when nothing changed', () => {
    const workspace = createWorkspace({
      'src/app.tsx': 'export const app = true;\n',
      'node_modules/pkg/index.js': 'module.exports = 1;\n',
      'out/generated.js': 'console.log("out");\n'
    });

    const snapshot = captureWorkspaceSnapshot(workspace);
    expect(snapshot).not.toBeNull();

    writeFileSync(join(workspace, 'node_modules/pkg/index.js'), 'module.exports = 2;\n', 'utf8');
    writeFileSync(join(workspace, 'out/generated.js'), 'console.log("new out");\n', 'utf8');

    expect(deriveRunChangeArtifact(snapshot, workspace)).toBeNull();
  });

  it('truncates oversized previews while keeping the summary counts', () => {
    const workspace = createWorkspace({
      'src/app.tsx': Array.from({ length: 240 }, (_, index) => `const line${index} = ${index};`).join('\n')
    });

    const snapshot = captureWorkspaceSnapshot(workspace);
    expect(snapshot).not.toBeNull();

    writeFileSync(
      join(workspace, 'src/app.tsx'),
      Array.from({ length: 240 }, (_, index) => `const line${index} = ${index + 1};`).join('\n'),
      'utf8'
    );

    const artifact = deriveRunChangeArtifact(snapshot, workspace);
    expect(artifact).not.toBeNull();
    expect(artifact?.files[0]?.previewTruncated).toBe(true);
    expect(artifact?.files[0]?.previewLines.some((line) => line.text === '...')).toBe(true);
    expect(artifact?.summary.filesChanged).toBe(1);
  });
});
