import type {
  RunEvent,
  WorktreeCleanupStatus,
  WorktreeReviewDecision,
  WorktreeReviewStatus
} from '../../shared/domain';
import type { HarnessWorktreeCleanupPolicy } from './harness-worktree-session';

export type HarnessWorktreeCleanupAutomationReason =
  | 'policy_allows_review_cleanup'
  | 'applied_cleanup_remains_manual'
  | 'cleanup_decision_already_recorded'
  | 'cleanup_policy_preserves_worktree'
  | 'cleanup_policy_not_matched'
  | 'review_decision_not_successful'
  | 'worktree_session_missing';

export interface HarnessWorktreeCleanupAutomationResult {
  action: 'attempt_cleanup' | 'skip';
  reason: HarnessWorktreeCleanupAutomationReason;
  cleanupPolicy: HarnessWorktreeCleanupPolicy | null;
  existingCleanupStatus: WorktreeCleanupStatus | null;
  reviewStatus: WorktreeReviewStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanupPolicyOrNull(value: unknown): HarnessWorktreeCleanupPolicy | null {
  return value === 'preserve_until_review'
    || value === 'delete_after_apply'
    || value === 'delete_after_reject'
    || value === 'delete_after_revert'
    ? value
    : null;
}

function cleanupStatusOrNull(value: unknown): WorktreeCleanupStatus | null {
  return value === 'cleaned' || value === 'failed' || value === 'refused'
    ? value
    : null;
}

function worktreeSessionCleanupPolicyFromEvent(event: RunEvent): HarnessWorktreeCleanupPolicy | null {
  const runtimeTrace = isRecord(event.payload.runtimeTrace) ? event.payload.runtimeTrace : null;
  if (!runtimeTrace || runtimeTrace.stage !== 'worktree_session_created') {
    return null;
  }

  const detail = isRecord(runtimeTrace.detail) ? runtimeTrace.detail : null;
  const session = isRecord(detail?.harnessWorktreeSession) ? detail.harnessWorktreeSession : null;
  return cleanupPolicyOrNull(session?.cleanupPolicy);
}

function cleanupStatusFromEvent(event: RunEvent): WorktreeCleanupStatus | null {
  const decision = isRecord(event.payload.worktreeCleanupDecision)
    ? event.payload.worktreeCleanupDecision
    : null;
  return cleanupStatusOrNull(decision?.status);
}

function findCleanupPolicy(
  runEvents: readonly RunEvent[],
  reviewDecision: WorktreeReviewDecision
): HarnessWorktreeCleanupPolicy | null {
  let cleanupPolicy: HarnessWorktreeCleanupPolicy | null = null;

  for (const event of runEvents) {
    if (event.threadId !== reviewDecision.threadId || event.runId !== reviewDecision.runId) {
      continue;
    }

    cleanupPolicy = worktreeSessionCleanupPolicyFromEvent(event) ?? cleanupPolicy;
  }

  return cleanupPolicy;
}

function findExistingCleanupStatus(
  runEvents: readonly RunEvent[],
  reviewDecision: WorktreeReviewDecision
): WorktreeCleanupStatus | null {
  let status: WorktreeCleanupStatus | null = null;

  for (const event of runEvents) {
    if (event.threadId !== reviewDecision.threadId || event.runId !== reviewDecision.runId) {
      continue;
    }

    status = cleanupStatusFromEvent(event) ?? status;
  }

  return status;
}

export function evaluateHarnessWorktreeCleanupAutomation(input: {
  runEvents: readonly RunEvent[];
  reviewDecision: WorktreeReviewDecision;
}): HarnessWorktreeCleanupAutomationResult {
  const cleanupPolicy = findCleanupPolicy(input.runEvents, input.reviewDecision);
  const existingCleanupStatus = findExistingCleanupStatus(input.runEvents, input.reviewDecision);
  const skipped = (reason: Exclude<HarnessWorktreeCleanupAutomationReason, 'policy_allows_review_cleanup'>) => ({
    action: 'skip' as const,
    reason,
    cleanupPolicy,
    existingCleanupStatus,
    reviewStatus: input.reviewDecision.status
  });

  if (!cleanupPolicy) {
    return skipped('worktree_session_missing');
  }

  if (existingCleanupStatus) {
    return skipped('cleanup_decision_already_recorded');
  }

  if (input.reviewDecision.status === 'failed') {
    return skipped('review_decision_not_successful');
  }

  if (input.reviewDecision.status === 'applied') {
    return skipped('applied_cleanup_remains_manual');
  }

  if (cleanupPolicy === 'preserve_until_review') {
    return skipped('cleanup_policy_preserves_worktree');
  }

  if (
    (input.reviewDecision.status === 'rejected' && cleanupPolicy === 'delete_after_reject') ||
    (input.reviewDecision.status === 'reverted' && cleanupPolicy === 'delete_after_revert')
  ) {
    return {
      action: 'attempt_cleanup',
      reason: 'policy_allows_review_cleanup',
      cleanupPolicy,
      existingCleanupStatus,
      reviewStatus: input.reviewDecision.status
    };
  }

  return skipped('cleanup_policy_not_matched');
}
