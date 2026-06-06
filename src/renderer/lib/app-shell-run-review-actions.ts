import type {
  StagedWorkspaceHunkApplyInput,
  StagedWorkspaceHunkRejectInput,
  StagedWorkspaceHunkReviewResult,
  StagedWorkspaceHunkRevertInput,
  StagedWorkspaceReviewInput,
  StagedWorkspaceReviewResult,
  ThreadDetail,
  WorktreeCleanupInput,
  WorktreeCleanupResult,
  WorktreeHunkApplyInput,
  WorktreeHunkRejectInput,
  WorktreeHunkReviewResult,
  WorktreeHunkRevertInput,
  WorktreeReviewInput,
  WorktreeReviewResult
} from '../../shared/domain';
import { formatUserErrorMessage } from './error-format';
import { stagedWorkspaceReviewKey, worktreeReviewKey } from './run-activity';

type ToastLevel = 'info' | 'warning' | 'error';
type ResolvingKeySetter = (value: string | null | ((current: string | null) => string | null)) => void;

type ThreadReviewResult = {
  thread: ThreadDetail;
};

export interface AppShellRunReviewActionsHost {
  runs: {
    applyStagedWorkspaceChange(input: StagedWorkspaceReviewInput): Promise<StagedWorkspaceReviewResult>;
    rejectStagedWorkspaceChange(input: StagedWorkspaceReviewInput): Promise<StagedWorkspaceReviewResult>;
    revertStagedWorkspaceChange(input: StagedWorkspaceReviewInput): Promise<StagedWorkspaceReviewResult>;
    applyStagedWorkspaceHunks(input: StagedWorkspaceHunkApplyInput): Promise<StagedWorkspaceHunkReviewResult>;
    rejectStagedWorkspaceHunks(input: StagedWorkspaceHunkRejectInput): Promise<StagedWorkspaceHunkReviewResult>;
    revertStagedWorkspaceHunks(input: StagedWorkspaceHunkRevertInput): Promise<StagedWorkspaceHunkReviewResult>;
    applyWorktreeReview(input: WorktreeReviewInput): Promise<WorktreeReviewResult>;
    rejectWorktreeReview(input: WorktreeReviewInput): Promise<WorktreeReviewResult>;
    revertWorktreeReview(input: WorktreeReviewInput): Promise<WorktreeReviewResult>;
    applyWorktreeHunks(input: WorktreeHunkApplyInput): Promise<WorktreeHunkReviewResult>;
    rejectWorktreeHunks(input: WorktreeHunkRejectInput): Promise<WorktreeHunkReviewResult>;
    revertWorktreeHunks(input: WorktreeHunkRevertInput): Promise<WorktreeHunkReviewResult>;
    cleanupWorktreeReview(input: WorktreeCleanupInput): Promise<WorktreeCleanupResult>;
  };
  applyReviewThread(thread: ThreadDetail): void;
  setStagedWorkspaceReviewResolvingKey: ResolvingKeySetter;
  setWorktreeReviewResolvingKey: ResolvingKeySetter;
  showToast(level: ToastLevel, message: string): void;
}

async function resolveStagedWorkspaceReview<TInput extends StagedWorkspaceReviewInput>(
  host: AppShellRunReviewActionsHost,
  input: TInput,
  action: (input: TInput) => Promise<ThreadReviewResult>,
  copy: {
    success: string;
    failure: string;
  }
) {
  const resolvingKey = stagedWorkspaceReviewKey(input);
  try {
    host.setStagedWorkspaceReviewResolvingKey(resolvingKey);
    const result = await action(input);
    host.applyReviewThread(result.thread);
    host.showToast('info', copy.success);
  } catch (error) {
    host.showToast('error', formatUserErrorMessage(error, copy.failure));
  } finally {
    host.setStagedWorkspaceReviewResolvingKey((current) => (current === resolvingKey ? null : current));
  }
}

async function resolveWorktreeReview<TInput extends WorktreeReviewInput>(
  host: AppShellRunReviewActionsHost,
  input: TInput,
  action: (input: TInput) => Promise<ThreadReviewResult>,
  copy: {
    success: string;
    failure: string;
  }
) {
  const resolvingKey = worktreeReviewKey(input);
  try {
    host.setWorktreeReviewResolvingKey(resolvingKey);
    const result = await action(input);
    host.applyReviewThread(result.thread);
    host.showToast('info', copy.success);
  } catch (error) {
    host.showToast('error', formatUserErrorMessage(error, copy.failure));
  } finally {
    host.setWorktreeReviewResolvingKey((current) => (current === resolvingKey ? null : current));
  }
}

export async function applyStagedWorkspaceChangeInShell(
  host: AppShellRunReviewActionsHost,
  input: StagedWorkspaceReviewInput
) {
  await resolveStagedWorkspaceReview(host, input, host.runs.applyStagedWorkspaceChange, {
    success: 'Staged workspace changes applied.',
    failure: 'Unable to apply staged workspace changes.'
  });
}

export async function rejectStagedWorkspaceChangeInShell(
  host: AppShellRunReviewActionsHost,
  input: StagedWorkspaceReviewInput
) {
  await resolveStagedWorkspaceReview(host, input, host.runs.rejectStagedWorkspaceChange, {
    success: 'Staged workspace changes rejected.',
    failure: 'Unable to reject staged workspace changes.'
  });
}

export async function revertStagedWorkspaceChangeInShell(
  host: AppShellRunReviewActionsHost,
  input: StagedWorkspaceReviewInput
) {
  await resolveStagedWorkspaceReview(host, input, host.runs.revertStagedWorkspaceChange, {
    success: 'Staged workspace changes reverted.',
    failure: 'Unable to revert staged workspace changes.'
  });
}

export async function applyStagedWorkspaceHunksInShell(
  host: AppShellRunReviewActionsHost,
  input: StagedWorkspaceHunkApplyInput
) {
  await resolveStagedWorkspaceReview(host, input, host.runs.applyStagedWorkspaceHunks, {
    success: 'Staged workspace hunk applied.',
    failure: 'Unable to apply staged workspace hunk.'
  });
}

export async function rejectStagedWorkspaceHunksInShell(
  host: AppShellRunReviewActionsHost,
  input: StagedWorkspaceHunkRejectInput
) {
  await resolveStagedWorkspaceReview(host, input, host.runs.rejectStagedWorkspaceHunks, {
    success: 'Staged workspace hunk rejected.',
    failure: 'Unable to reject staged workspace hunk.'
  });
}

export async function revertStagedWorkspaceHunksInShell(
  host: AppShellRunReviewActionsHost,
  input: StagedWorkspaceHunkRevertInput
) {
  await resolveStagedWorkspaceReview(host, input, host.runs.revertStagedWorkspaceHunks, {
    success: 'Staged workspace hunks reverted.',
    failure: 'Unable to revert staged workspace hunks.'
  });
}

export async function applyWorktreeReviewInShell(
  host: AppShellRunReviewActionsHost,
  input: WorktreeReviewInput
) {
  await resolveWorktreeReview(host, input, host.runs.applyWorktreeReview, {
    success: 'Worktree changes applied.',
    failure: 'Unable to apply worktree changes.'
  });
}

export async function rejectWorktreeReviewInShell(
  host: AppShellRunReviewActionsHost,
  input: WorktreeReviewInput
) {
  await resolveWorktreeReview(host, input, host.runs.rejectWorktreeReview, {
    success: 'Worktree changes rejected.',
    failure: 'Unable to reject worktree changes.'
  });
}

export async function revertWorktreeReviewInShell(
  host: AppShellRunReviewActionsHost,
  input: WorktreeReviewInput
) {
  await resolveWorktreeReview(host, input, host.runs.revertWorktreeReview, {
    success: 'Worktree changes reverted.',
    failure: 'Unable to revert worktree changes.'
  });
}

export async function applyWorktreeHunksInShell(
  host: AppShellRunReviewActionsHost,
  input: WorktreeHunkApplyInput
) {
  await resolveWorktreeReview(host, input, host.runs.applyWorktreeHunks, {
    success: 'Worktree hunk applied.',
    failure: 'Unable to apply worktree hunk.'
  });
}

export async function rejectWorktreeHunksInShell(
  host: AppShellRunReviewActionsHost,
  input: WorktreeHunkRejectInput
) {
  await resolveWorktreeReview(host, input, host.runs.rejectWorktreeHunks, {
    success: 'Worktree hunk rejected.',
    failure: 'Unable to reject worktree hunk.'
  });
}

export async function revertWorktreeHunksInShell(
  host: AppShellRunReviewActionsHost,
  input: WorktreeHunkRevertInput
) {
  await resolveWorktreeReview(host, input, host.runs.revertWorktreeHunks, {
    success: 'Worktree hunks reverted.',
    failure: 'Unable to revert worktree hunks.'
  });
}

export async function cleanupWorktreeReviewInShell(
  host: AppShellRunReviewActionsHost,
  input: WorktreeCleanupInput
) {
  await resolveWorktreeReview(host, input, host.runs.cleanupWorktreeReview, {
    success: 'Worktree session cleaned up.',
    failure: 'Unable to clean up worktree session.'
  });
}
