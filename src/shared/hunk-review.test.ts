import { describe, expect, it } from 'vitest';
import type { RunChangeArtifact, RunChangePreviewLine, RunChangedFileArtifact } from './domain';
import { parseRunChangeHunks } from './hunk-review';

function line(
  type: RunChangePreviewLine['type'],
  text: string,
  oldLineNumber: number | null,
  newLineNumber: number | null
): RunChangePreviewLine {
  return {
    type,
    oldLineNumber,
    newLineNumber,
    text
  };
}

function fileArtifact(input: Partial<RunChangedFileArtifact> & Pick<RunChangedFileArtifact, 'path' | 'status' | 'previewLines'>): RunChangedFileArtifact {
  return {
    insertions: input.previewLines.filter((previewLine) => previewLine.type === 'added').length,
    deletions: input.previewLines.filter((previewLine) => previewLine.type === 'removed').length,
    beforeContent: input.beforeContent ?? 'FULL_BEFORE_CONTENT_SHOULD_NOT_LEAK',
    afterContent: input.afterContent ?? 'FULL_AFTER_CONTENT_SHOULD_NOT_LEAK',
    previewTruncated: input.previewTruncated ?? false,
    ...input
  };
}

function changeArtifact(source: RunChangeArtifact['source'], files: RunChangedFileArtifact[]): RunChangeArtifact {
  return {
    source,
    summary: {
      filesChanged: files.length,
      insertions: files.reduce((total, file) => total + file.insertions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0)
    },
    files
  };
}

describe('hunk review parser', () => {
  it('parses a staged modified file into a stable hunk with before and after ranges', () => {
    const artifact = changeArtifact('staged_workspace_preview', [
      fileArtifact({
        path: 'src/app.ts',
        status: 'modified',
        previewLines: [
          line('context', 'const keep = true;', 1, 1),
          line('removed', 'const label = "before";', 2, null),
          line('added', 'const label = "after";', null, 2),
          line('context', 'export { label };', 3, 3)
        ]
      })
    ]);

    const result = parseRunChangeHunks(artifact);

    expect(result.artifactSupported).toBe(true);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0]).toMatchObject({
      source: 'staged_workspace_preview',
      filePath: 'src/app.ts',
      fileStatus: 'modified',
      hunkStatus: 'pending',
      beforeRange: {
        startLine: 2,
        lineCount: 1
      },
      afterRange: {
        startLine: 2,
        lineCount: 1
      },
      selectedOperation: null,
      driftState: 'not_checked',
      partialApplySupported: true,
      supportKind: 'partial'
    });
    expect(result.hunks[0]?.id).toMatch(/^hunk-v1-/u);
  });

  it('accepts worktree diff artifacts without changing the source in the hunk artifact', () => {
    const artifact = changeArtifact('worktree_diff', [
      fileArtifact({
        path: 'src/worktree.ts',
        status: 'modified',
        previewLines: [
          line('removed', 'before();', 1, null),
          line('added', 'after();', null, 1)
        ]
      })
    ]);

    const result = parseRunChangeHunks(artifact);

    expect(result.artifactSupported).toBe(true);
    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0]?.source).toBe('worktree_diff');
  });

  it('parses multiple separated hunks in one modified file without merging unrelated context', () => {
    const artifact = changeArtifact('staged_workspace_preview', [
      fileArtifact({
        path: 'src/multiple.ts',
        status: 'modified',
        previewLines: [
          line('context', 'line 1', 1, 1),
          line('removed', 'line 2 before', 2, null),
          line('added', 'line 2 after', null, 2),
          line('context', 'line 3', 3, 3),
          line('context', 'line 4', 4, 4),
          line('context', 'line 5', 5, 5),
          line('context', 'line 6', 6, 6),
          line('context', 'line 7', 7, 7),
          line('context', 'line 8', 8, 8),
          line('context', 'line 9', 9, 9),
          line('removed', 'line 10 before', 10, null),
          line('added', 'line 10 after', null, 10),
          line('context', 'line 11', 11, 11)
        ]
      })
    ]);

    const result = parseRunChangeHunks(artifact);

    expect(result.hunks).toHaveLength(2);
    expect(result.hunks.map((hunk) => hunk.beforeRange.startLine)).toEqual([2, 10]);
    expect(result.hunks[0]?.previewLines.some((previewLine) => previewLine.text === 'line 10 before')).toBe(false);
    expect(result.hunks[1]?.previewLines.some((previewLine) => previewLine.text === 'line 2 before')).toBe(false);
  });

  it('produces deterministic hunk IDs and changes IDs when hunk preview content changes', () => {
    const previewLines = [
      line('removed', 'const value = 1;', 1, null),
      line('added', 'const value = 2;', null, 1)
    ];
    const artifact = changeArtifact('staged_workspace_preview', [
      fileArtifact({
        path: 'src/id.ts',
        status: 'modified',
        previewLines
      })
    ]);
    const changedArtifact = changeArtifact('staged_workspace_preview', [
      fileArtifact({
        path: 'src/id.ts',
        status: 'modified',
        previewLines: [
          line('removed', 'const value = 1;', 1, null),
          line('added', 'const value = 3;', null, 1)
        ]
      })
    ]);

    const first = parseRunChangeHunks(artifact);
    const second = parseRunChangeHunks(artifact);
    const changed = parseRunChangeHunks(changedArtifact);

    expect(first.hunks[0]?.id).toBe(second.hunks[0]?.id);
    expect(first.hunks[0]?.id).not.toBe(changed.hunks[0]?.id);
  });

  it('marks truncated previews unsupported for partial apply', () => {
    const artifact = changeArtifact('staged_workspace_preview', [
      fileArtifact({
        path: 'src/truncated.ts',
        status: 'modified',
        previewTruncated: true,
        previewLines: [
          line('removed', 'before();', 1, null),
          line('added', 'after();', null, 1)
        ]
      })
    ]);

    const result = parseRunChangeHunks(artifact);

    expect(result.hunks).toHaveLength(1);
    expect(result.hunks[0]).toMatchObject({
      partialApplySupported: false,
      supportKind: 'unsupported',
      driftState: 'unsupported',
      unsupportedReason: expect.stringContaining('truncated')
    });
  });

  it('keeps added and deleted files all-or-nothing for the first hunk model', () => {
    const artifact = changeArtifact('staged_workspace_preview', [
      fileArtifact({
        path: 'src/new.ts',
        status: 'added',
        beforeContent: null,
        afterContent: 'export const created = true;',
        previewLines: [
          line('added', 'export const created = true;', null, 1)
        ]
      }),
      fileArtifact({
        path: 'src/old.ts',
        status: 'deleted',
        beforeContent: 'export const removed = true;',
        afterContent: null,
        previewLines: [
          line('removed', 'export const removed = true;', 1, null)
        ]
      })
    ]);

    const result = parseRunChangeHunks(artifact);

    expect(result.hunks).toHaveLength(2);
    expect(result.hunks.map((hunk) => hunk.supportKind)).toEqual(['all_or_nothing', 'all_or_nothing']);
    expect(result.hunks.every((hunk) => !hunk.partialApplySupported)).toBe(true);
    expect(result.hunks.every((hunk) => hunk.driftState === 'unsupported')).toBe(true);
  });

  it('marks out-of-scope artifact sources unsupported without producing hunk artifacts', () => {
    const artifact = changeArtifact('workspace_diff', [
      fileArtifact({
        path: 'src/direct.ts',
        status: 'modified',
        previewLines: [
          line('removed', 'before();', 1, null),
          line('added', 'after();', null, 1)
        ]
      })
    ]);

    const result = parseRunChangeHunks(artifact);

    expect(result).toMatchObject({
      artifactSupported: false,
      unsupportedReason: expect.stringContaining('workspace_diff'),
      hunks: []
    });
  });

  it('does not serialize full file contents, patch text, or absolute local roots into hunk artifacts', () => {
    const artifact = changeArtifact('staged_workspace_preview', [
      fileArtifact({
        path: 'C:\\Users\\fixture-user\\project\\src\\secret.ts',
        status: 'modified',
        beforeContent: 'FULL_BEFORE_CONTENT_SHOULD_NOT_LEAK',
        afterContent: 'FULL_AFTER_CONTENT_SHOULD_NOT_LEAK',
        previewLines: [
          line('removed', 'const value = "before";', 1, null),
          line('added', 'const value = "after";', null, 1)
        ]
      })
    ]);

    const result = parseRunChangeHunks(artifact);
    const serialized = JSON.stringify(result.hunks);

    expect(serialized).not.toContain('FULL_BEFORE_CONTENT_SHOULD_NOT_LEAK');
    expect(serialized).not.toContain('FULL_AFTER_CONTENT_SHOULD_NOT_LEAK');
    expect(serialized).not.toContain('patchText');
    expect(serialized).not.toContain('C:\\Users\\fixture-user');
    expect(result.hunks[0]?.filePath).toBe('[absolute-path]');
    expect(result.hunks[0]?.supportKind).toBe('unsupported');
  });
});
