import { describe, expect, it } from 'vitest';
import type {
  RunEvent,
  WorktreeCleanupDecision,
  WorktreeReviewDecision
} from '../../shared/domain';
import type {
  HarnessWorktreeCleanupPolicy,
  HarnessWorktreeSession
} from './harness-worktree-session';
import { evaluateHarnessWorktreeCleanupAutomation } from './harness-worktree-cleanup-policy';

function createHarnessWorktreeSession(
  cleanupPolicy: HarnessWorktreeCleanupPolicy
): HarnessWorktreeSession {
  return {
    threadId: 'thread-1',
    runId: 'run-1',
    projectId: 'project-1',
    sourceRepoRoot: 'C:/Users/test-user/source',
    sourceWorkspaceRoot: 'C:/Users/test-user/source/packages/app',
    sourceWorkspaceRelativePath: 'packages/app',
    worktreeRepoRoot: 'C:/Users/test-user/AppData/Local/Vicode/worktrees/project-1/run-1',
    worktreeWorkspaceRoot: 'C:/Users/test-user/AppData/Local/Vicode/worktrees/project-1/run-1/packages/app',
    branchName: 'vicode/worktree/project-1/run-1',
    baseRef: 'HEAD',
    baseSha: 'abc123',
    status: 'ready',
    cleanupPolicy,
    reviewStatus: 'pending',
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
    errorReason: null
  };
}

function createWorktreeSessionEvent(cleanupPolicy: HarnessWorktreeCleanupPolicy): RunEvent {
  const session = createHarnessWorktreeSession(cleanupPolicy);
  return {
    id: 'event-worktree-session',
    threadId: session.threadId,
    runId: session.runId,
    eventType: 'info',
    payload: {
      runtimeTrace: {
        stage: 'worktree_session_created',
        at: '2026-05-29T00:00:00.000Z',
        detail: {
          sourceWorkspaceRoot: session.sourceWorkspaceRoot,
          runtimeWorkspaceRoot: session.worktreeWorkspaceRoot,
          harnessWorktreeSession: session
        }
      }
    },
    createdAt: '2026-05-29T00:00:00.000Z'
  };
}

function createReviewDecision(
  action: WorktreeReviewDecision['action'],
  status: WorktreeReviewDecision['status'] = action
): WorktreeReviewDecision {
  return {
    action,
    status,
    threadId: 'thread-1',
    runId: 'run-1',
    isolationMode: 'git_worktree',
    branchName: 'vicode/worktree/project-1/run-1',
    baseSha: 'abc123',
    sourceWorkspaceRelativePath: 'packages/app',
    changedPaths: ['src/example.txt'],
    filesChanged: 1,
    insertions: 1,
    deletions: 1,
    errorReason: status === 'failed' ? 'Review failed.' : null,
    createdAt: '2026-05-29T00:00:01.000Z'
  };
}

function createCleanupDecisionEvent(status: WorktreeCleanupDecision['status']): RunEvent {
  return {
    id: `event-cleanup-${status}`,
    threadId: 'thread-1',
    runId: 'run-1',
    eventType: 'info',
    payload: {
      worktreeCleanupDecision: {
        action: status,
        status,
        threadId: 'thread-1',
        runId: 'run-1',
        isolationMode: 'git_worktree',
        branchName: 'vicode/worktree/project-1/run-1',
        baseSha: 'abc123',
        cleanupPolicy: 'delete_after_reject',
        reviewStatus: 'rejected',
        errorReason: status === 'cleaned' ? null : `Cleanup ${status}.`,
        createdAt: '2026-05-29T00:00:02.000Z'
      } satisfies WorktreeCleanupDecision
    },
    createdAt: '2026-05-29T00:00:02.000Z'
  };
}

describe('evaluateHarnessWorktreeCleanupAutomation', () => {
  it('requests cleanup after a rejected review when the session policy is delete_after_reject', () => {
    const result = evaluateHarnessWorktreeCleanupAutomation({
      runEvents: [createWorktreeSessionEvent('delete_after_reject')],
      reviewDecision: createReviewDecision('rejected')
    });

    expect(result).toEqual({
      action: 'attempt_cleanup',
      reason: 'policy_allows_review_cleanup',
      cleanupPolicy: 'delete_after_reject',
      existingCleanupStatus: null,
      reviewStatus: 'rejected'
    });
  });

  it('requests cleanup after a reverted review when the session policy is delete_after_revert', () => {
    const result = evaluateHarnessWorktreeCleanupAutomation({
      runEvents: [createWorktreeSessionEvent('delete_after_revert')],
      reviewDecision: createReviewDecision('reverted')
    });

    expect(result).toMatchObject({
      action: 'attempt_cleanup',
      reason: 'policy_allows_review_cleanup',
      cleanupPolicy: 'delete_after_revert',
      reviewStatus: 'reverted'
    });
  });

  it('keeps applied worktrees manual-cleanup even when a future delete_after_apply policy is present', () => {
    const result = evaluateHarnessWorktreeCleanupAutomation({
      runEvents: [createWorktreeSessionEvent('delete_after_apply')],
      reviewDecision: createReviewDecision('applied')
    });

    expect(result).toMatchObject({
      action: 'skip',
      reason: 'applied_cleanup_remains_manual',
      cleanupPolicy: 'delete_after_apply',
      reviewStatus: 'applied'
    });
  });

  it('keeps preserve_until_review sessions manual-cleanup after reject and revert', () => {
    for (const action of ['rejected', 'reverted'] as const) {
      const result = evaluateHarnessWorktreeCleanupAutomation({
        runEvents: [createWorktreeSessionEvent('preserve_until_review')],
        reviewDecision: createReviewDecision(action)
      });

      expect(result).toMatchObject({
        action: 'skip',
        reason: 'cleanup_policy_preserves_worktree',
        cleanupPolicy: 'preserve_until_review',
        reviewStatus: action
      });
    }
  });

  it('never requests cleanup for failed review decisions', () => {
    const result = evaluateHarnessWorktreeCleanupAutomation({
      runEvents: [createWorktreeSessionEvent('delete_after_reject')],
      reviewDecision: createReviewDecision('rejected', 'failed')
    });

    expect(result).toMatchObject({
      action: 'skip',
      reason: 'review_decision_not_successful',
      cleanupPolicy: 'delete_after_reject',
      reviewStatus: 'failed'
    });
  });

  it.each(['cleaned', 'failed', 'refused'] as const)(
    'does not retry automatically when a %s cleanup decision already exists',
    (status) => {
      const result = evaluateHarnessWorktreeCleanupAutomation({
        runEvents: [
          createWorktreeSessionEvent('delete_after_reject'),
          createCleanupDecisionEvent(status)
        ],
        reviewDecision: createReviewDecision('rejected')
      });

      expect(result).toMatchObject({
        action: 'skip',
        reason: 'cleanup_decision_already_recorded',
        cleanupPolicy: 'delete_after_reject',
        existingCleanupStatus: status,
        reviewStatus: 'rejected'
      });
    }
  );
});
