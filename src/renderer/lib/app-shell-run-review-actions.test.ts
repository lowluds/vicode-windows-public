import { describe, expect, it, vi } from 'vitest';
import type {
  StagedWorkspaceHunkApplyInput,
  StagedWorkspaceReviewInput,
  ThreadDetail,
  WorktreeCleanupInput,
  WorktreeHunkRejectInput,
  WorktreeReviewInput
} from '../../shared/domain';
import {
  applyStagedWorkspaceChangeInShell,
  applyStagedWorkspaceHunksInShell,
  applyWorktreeReviewInShell,
  cleanupWorktreeReviewInShell,
  rejectWorktreeHunksInShell,
  type AppShellRunReviewActionsHost
} from './app-shell-run-review-actions';

type Toast = {
  level: 'info' | 'warning' | 'error';
  message: string;
};

function createThread(id = 'thread-1') {
  return {
    id,
    rawOutput: 'raw'
  } as ThreadDetail;
}

function applyResolvingSetter(
  current: string | null,
  value: string | null | ((current: string | null) => string | null)
) {
  return typeof value === 'function' ? value(current) : value;
}

function createHost(overrides?: Partial<AppShellRunReviewActionsHost>) {
  let stagedKey: string | null = null;
  let worktreeKey: string | null = null;
  const toastMessages: Toast[] = [];
  const appliedThreads: ThreadDetail[] = [];
  const thread = createThread('updated-thread');
  const runs = {
    applyStagedWorkspaceChange: vi.fn(async () => ({ thread })),
    rejectStagedWorkspaceChange: vi.fn(async () => ({ thread })),
    revertStagedWorkspaceChange: vi.fn(async () => ({ thread })),
    applyStagedWorkspaceHunks: vi.fn(async () => ({ thread })),
    rejectStagedWorkspaceHunks: vi.fn(async () => ({ thread })),
    revertStagedWorkspaceHunks: vi.fn(async () => ({ thread })),
    applyWorktreeReview: vi.fn(async () => ({ thread })),
    rejectWorktreeReview: vi.fn(async () => ({ thread })),
    revertWorktreeReview: vi.fn(async () => ({ thread })),
    applyWorktreeHunks: vi.fn(async () => ({ thread })),
    rejectWorktreeHunks: vi.fn(async () => ({ thread })),
    revertWorktreeHunks: vi.fn(async () => ({ thread })),
    cleanupWorktreeReview: vi.fn(async () => ({ thread }))
  };

  const host: AppShellRunReviewActionsHost = {
    runs,
    applyReviewThread: (nextThread) => {
      appliedThreads.push(nextThread);
    },
    setStagedWorkspaceReviewResolvingKey: (value) => {
      stagedKey = applyResolvingSetter(stagedKey, value);
    },
    setWorktreeReviewResolvingKey: (value) => {
      worktreeKey = applyResolvingSetter(worktreeKey, value);
    },
    showToast: (level, message) => {
      toastMessages.push({ level, message });
    },
    ...overrides
  };

  return {
    host,
    runs,
    appliedThreads,
    toastMessages,
    getStagedKey: () => stagedKey,
    getWorktreeKey: () => worktreeKey
  };
}

const stagedInput: StagedWorkspaceReviewInput = {
  threadId: 'thread-1',
  runId: 'run-1',
  stagedEventId: 'event-1',
  stagedEventIndex: 2
};

const worktreeInput: WorktreeReviewInput = {
  threadId: 'thread-1',
  runId: 'run-1'
};

describe('app shell run-review actions', () => {
  it('applies staged workspace changes and clears the resolving key', async () => {
    const state = createHost();

    await applyStagedWorkspaceChangeInShell(state.host, stagedInput);

    expect(state.runs.applyStagedWorkspaceChange).toHaveBeenCalledWith(stagedInput);
    expect(state.appliedThreads).toEqual([expect.objectContaining({ id: 'updated-thread' })]);
    expect(state.toastMessages).toEqual([
      { level: 'info', message: 'Staged workspace changes applied.' }
    ]);
    expect(state.getStagedKey()).toBeNull();
  });

  it('uses staged hunk copy for staged hunk operations', async () => {
    const state = createHost();
    const input: StagedWorkspaceHunkApplyInput = {
      ...stagedInput,
      acceptedHunkIds: ['src/app.tsx:1']
    };

    await applyStagedWorkspaceHunksInShell(state.host, input);

    expect(state.runs.applyStagedWorkspaceHunks).toHaveBeenCalledWith(input);
    expect(state.toastMessages).toEqual([
      { level: 'info', message: 'Staged workspace hunk applied.' }
    ]);
    expect(state.getStagedKey()).toBeNull();
  });

  it('applies worktree reviews and clears the worktree resolving key', async () => {
    const state = createHost();

    await applyWorktreeReviewInShell(state.host, worktreeInput);

    expect(state.runs.applyWorktreeReview).toHaveBeenCalledWith(worktreeInput);
    expect(state.appliedThreads).toEqual([expect.objectContaining({ id: 'updated-thread' })]);
    expect(state.toastMessages).toEqual([
      { level: 'info', message: 'Worktree changes applied.' }
    ]);
    expect(state.getWorktreeKey()).toBeNull();
  });

  it('uses worktree hunk copy for hunk operations', async () => {
    const state = createHost();
    const input: WorktreeHunkRejectInput = {
      ...worktreeInput,
      hunkIds: ['src/app.tsx:3']
    };

    await rejectWorktreeHunksInShell(state.host, input);

    expect(state.runs.rejectWorktreeHunks).toHaveBeenCalledWith(input);
    expect(state.toastMessages).toEqual([
      { level: 'info', message: 'Worktree hunk rejected.' }
    ]);
    expect(state.getWorktreeKey()).toBeNull();
  });

  it('keeps cleanup on the worktree resolving path', async () => {
    const state = createHost();
    const input: WorktreeCleanupInput = {
      ...worktreeInput
    };

    await cleanupWorktreeReviewInShell(state.host, input);

    expect(state.runs.cleanupWorktreeReview).toHaveBeenCalledWith(input);
    expect(state.toastMessages).toEqual([
      { level: 'info', message: 'Worktree session cleaned up.' }
    ]);
    expect(state.getWorktreeKey()).toBeNull();
  });

  it('reports failures without applying stale thread state', async () => {
    const state = createHost({
      runs: {
        ...createHost().runs,
        applyStagedWorkspaceChange: vi.fn(async () => {
          throw new Error('nope');
        })
      }
    });

    await applyStagedWorkspaceChangeInShell(state.host, stagedInput);

    expect(state.appliedThreads).toEqual([]);
    expect(state.toastMessages).toEqual([
      { level: 'error', message: 'nope' }
    ]);
    expect(state.getStagedKey()).toBeNull();
  });
});
