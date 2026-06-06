import { describe, expect, it } from 'vitest';
import { harnessIsolationModeSchema } from '../../shared/schemas';

describe('Diagnostics schema alignment', () => {
  it('keeps composer isolation schema aligned with explicit worktree activation', () => {
    expect(harnessIsolationModeSchema.safeParse('direct_workspace').success).toBe(true);
    expect(harnessIsolationModeSchema.safeParse('patch_buffer').success).toBe(true);
    expect(harnessIsolationModeSchema.safeParse('git_worktree').success).toBe(true);
  });
});
