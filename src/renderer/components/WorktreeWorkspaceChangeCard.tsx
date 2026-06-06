import type {
  WorktreeCleanupInput,
  WorktreeHunkApplyInput,
  WorktreeHunkRejectInput,
  WorktreeHunkRevertInput,
  WorktreeReviewInput
} from '../../shared/domain';
import {
  worktreeReviewInput,
  worktreeReviewKey,
  type RunWorktreeReviewItem
} from '../lib/run-activity';
import { CheckIcon, CloseIcon, TrashIcon, UndoIcon } from './icons';
import { RunChangeArtifactCard } from './RunChangeArtifactCard';
import { ActionButton, DangerButton, SurfaceCard } from './ui';

function formatStatus(status: RunWorktreeReviewItem['status']) {
  switch (status) {
    case 'applied':
      return 'Applied';
    case 'rejected':
      return 'Rejected';
    case 'reverted':
      return 'Reverted';
    case 'failed':
      return 'Failed';
    default:
      return 'Pending';
  }
}

function formatCleanupStatus(status: RunWorktreeReviewItem['cleanupStatus']) {
  switch (status) {
    case 'cleaned':
      return 'Cleaned';
    case 'failed':
      return 'Failed';
    case 'refused':
      return 'Refused';
    default:
      return 'Pending';
  }
}

function shortSha(value: string | null) {
  return value && value.length > 7 ? value.slice(0, 7) : value;
}

export { worktreeReviewKey };

export function WorktreeWorkspaceChangeCard({
  change,
  isResolving = false,
  onApply,
  onReject,
  onRevert,
  onApplyHunks,
  onRejectHunks,
  onRevertHunks,
  onCleanup
}: {
  change: RunWorktreeReviewItem;
  isResolving?: boolean;
  onApply?: (input: WorktreeReviewInput) => void | Promise<void>;
  onReject?: (input: WorktreeReviewInput) => void | Promise<void>;
  onRevert?: (input: WorktreeReviewInput) => void | Promise<void>;
  onApplyHunks?: (input: WorktreeHunkApplyInput) => void | Promise<void>;
  onRejectHunks?: (input: WorktreeHunkRejectInput) => void | Promise<void>;
  onRevertHunks?: (input: WorktreeHunkRevertInput) => void | Promise<void>;
  onCleanup?: (input: WorktreeCleanupInput) => void | Promise<void>;
}) {
  const actionable = change.status === 'pending' || change.status === 'failed';
  const revertible = change.status === 'applied';
  const cleanupAvailable =
    (change.status === 'applied' || change.status === 'rejected' || change.status === 'reverted')
    && change.cleanupStatus !== 'cleaned';
  const actionInput = worktreeReviewInput(change);

  return (
    <div className="run-worktree-review-stack flex flex-col gap-3">
      <SurfaceCard
        className="run-worktree-review-card gap-0 rounded-none border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] p-0 shadow-none"
        data-testid="run-worktree-review-card"
      >
        <div className="run-worktree-review-header flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--ui-border-soft)] px-4 py-3">
          <div className="run-worktree-review-heading flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-[color:var(--ui-text-title)]">
              Worktree workspace changes
            </span>
            <span className="rounded-[var(--ui-radius-sm)] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-04)] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ui-text-subtle)]">
              {formatStatus(change.status)}
            </span>
            <span className="run-change-card-stat is-add text-[14px] font-semibold">
              +{change.insertions}
            </span>
            <span className="text-[14px] font-medium text-[color:var(--ui-text-subtle)]">-</span>
            <span className="run-change-card-stat is-remove text-[14px] font-semibold">
              -{change.deletions}
            </span>
          </div>
          {actionable && onApply && onReject ? (
            <div className="run-worktree-review-actions flex shrink-0 items-center gap-2">
              <ActionButton
                size="compact"
                leadingIcon={<CheckIcon />}
                disabled={isResolving}
                onClick={() => void onApply(actionInput)}
              >
                Apply
              </ActionButton>
              <DangerButton
                size="compact"
                leadingIcon={<CloseIcon />}
                disabled={isResolving}
                onClick={() => void onReject(actionInput)}
              >
                Reject
              </DangerButton>
            </div>
          ) : null}
          {revertible && onRevert ? (
            <div className="run-worktree-review-actions flex shrink-0 items-center gap-2">
              <DangerButton
                size="compact"
                leadingIcon={<UndoIcon />}
                disabled={isResolving}
                onClick={() => void onRevert(actionInput)}
              >
                Revert
              </DangerButton>
            </div>
          ) : null}
          {cleanupAvailable && onCleanup ? (
            <div className="run-worktree-review-actions flex shrink-0 items-center gap-2">
              <DangerButton
                size="compact"
                leadingIcon={<TrashIcon />}
                disabled={isResolving}
                onClick={() => void onCleanup(actionInput)}
              >
                Clean up
              </DangerButton>
            </div>
          ) : null}
        </div>

        <div className="run-worktree-review-body flex flex-col gap-3 px-4 py-3">
          <div className="run-worktree-review-meta grid gap-2 text-[12px] text-[color:var(--ui-text)] sm:grid-cols-2">
            <div>
              <span className="font-medium text-[color:var(--ui-text-subtle)]">Isolation</span>{' '}
              <span className="font-mono text-[color:var(--ui-text-title)]">{change.isolationMode}</span>
            </div>
            {change.branchName ? (
              <div className="min-w-0">
                <span className="font-medium text-[color:var(--ui-text-subtle)]">Branch</span>{' '}
                <span className="break-all font-mono text-[color:var(--ui-text-title)]">{change.branchName}</span>
              </div>
            ) : null}
            {change.baseSha ? (
              <div>
                <span className="font-medium text-[color:var(--ui-text-subtle)]">Base</span>{' '}
                <span className="font-mono text-[color:var(--ui-text-title)]">{shortSha(change.baseSha)}</span>
              </div>
            ) : null}
            {change.sourceWorkspaceRelativePath ? (
              <div className="min-w-0">
                <span className="font-medium text-[color:var(--ui-text-subtle)]">Workspace</span>{' '}
                <span className="break-all font-mono text-[color:var(--ui-text-title)]">{change.sourceWorkspaceRelativePath}</span>
              </div>
            ) : null}
            <div>
              <span className="font-medium text-[color:var(--ui-text-subtle)]">Files changed</span>{' '}
              <span>{change.filesChanged}</span>
            </div>
            {change.cleanupStatus !== 'pending' ? (
              <div>
                <span className="font-medium text-[color:var(--ui-text-subtle)]">Cleanup</span>{' '}
                <span>{formatCleanupStatus(change.cleanupStatus)}</span>
              </div>
            ) : null}
          </div>

          {change.changedPaths.length > 0 ? (
            <div className="run-worktree-review-paths flex flex-col gap-1">
              {change.changedPaths.map((path) => (
                <div
                  key={`${change.id}:${path}`}
                  className="break-all font-mono text-[12px] leading-5 text-[color:var(--ui-text-title)]"
                >
                  {path}
                </div>
              ))}
            </div>
          ) : null}

          {change.errorReason ? (
            <div className="rounded-[var(--ui-radius-md)] border border-[color:var(--ui-danger-border)] bg-[color:var(--ui-danger-soft)] px-3 py-2 text-[12px] text-[color:var(--ui-danger-text)]">
              {change.errorReason}
            </div>
          ) : null}

          {change.cleanupErrorReason ? (
            <div className="rounded-[var(--ui-radius-md)] border border-[color:var(--ui-danger-border)] bg-[color:var(--ui-danger-soft)] px-3 py-2 text-[12px] text-[color:var(--ui-danger-text)]">
              {change.cleanupErrorReason}
            </div>
          ) : null}
        </div>
      </SurfaceCard>
      <RunChangeArtifactCard
        label="Worktree diff"
        artifact={change.artifact}
        worktreeHunkReview={{
          baseInput: actionInput,
          decision: change.hunkDecision ?? null,
          isResolving,
          onApplyHunks,
          onRejectHunks,
          onRevertHunks
        }}
      />
    </div>
  );
}
