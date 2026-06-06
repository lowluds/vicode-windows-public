import { useState } from 'react';
import type {
  RunChangeArtifact,
  StagedWorkspaceHunkApplyInput,
  StagedWorkspaceHunkRejectInput,
  StagedWorkspaceHunkRevertInput,
  StagedWorkspaceReviewInput
} from '../../shared/domain';
import {
  stagedWorkspaceReviewInput,
  stagedWorkspaceReviewKey,
  type RunStagedWorkspaceReviewItem
} from '../lib/run-activity';
import { CheckIcon, CloseIcon, UndoIcon } from './icons';
import { RunChangeArtifactCard } from './RunChangeArtifactCard';
import { ActionButton, DangerButton, SurfaceCard } from './ui';

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function formatStatus(status: RunStagedWorkspaceReviewItem['status']) {
  switch (status) {
    case 'applied':
      return 'Applied';
    case 'rejected':
      return 'Rejected';
    case 'failed':
      return 'Failed';
    case 'reverted':
      return 'Reverted';
    default:
      return 'Pending';
  }
}

function formatOperationKinds(change: RunStagedWorkspaceReviewItem) {
  return change.operationKinds.length > 0
    ? change.operationKinds.join(', ')
    : change.sourceToolName;
}

export { stagedWorkspaceReviewKey };

export function StagedWorkspaceChangeCard({
  change,
  isResolving = false,
  loadPreview,
  onApply,
  onReject,
  onRevert,
  onApplyHunks,
  onRejectHunks,
  onRevertHunks
}: {
  change: RunStagedWorkspaceReviewItem;
  isResolving?: boolean;
  loadPreview?: (input: StagedWorkspaceReviewInput) => Promise<RunChangeArtifact>;
  onApply?: (input: StagedWorkspaceReviewInput) => void | Promise<void>;
  onReject?: (input: StagedWorkspaceReviewInput) => void | Promise<void>;
  onRevert?: (input: StagedWorkspaceReviewInput) => void | Promise<void>;
  onApplyHunks?: (input: StagedWorkspaceHunkApplyInput) => void | Promise<void>;
  onRejectHunks?: (input: StagedWorkspaceHunkRejectInput) => void | Promise<void>;
  onRevertHunks?: (input: StagedWorkspaceHunkRevertInput) => void | Promise<void>;
}) {
  const pending = change.status === 'pending';
  const canRevert = change.status === 'applied';
  const actionInput = stagedWorkspaceReviewInput(change);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewArtifact, setPreviewArtifact] = useState<RunChangeArtifact | null>(null);
  const canPreviewDiff = change.filesChanged > 0 || change.operationKinds.some((kind) => kind !== 'mkdir');

  async function loadPreviewArtifact() {
    setPreviewOpen(true);
    if (previewArtifact || previewLoading) {
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const loader = loadPreview ?? window.vicode.runs.previewStagedWorkspaceChange;
      setPreviewArtifact(await loader(actionInput));
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Unable to load staged workspace diff preview.');
    } finally {
      setPreviewLoading(false);
    }
  }

  function togglePreview() {
    if (previewOpen) {
      setPreviewOpen(false);
      return;
    }

    void loadPreviewArtifact();
  }

  return (
    <div className="run-staged-workspace-stack flex flex-col gap-3">
      <SurfaceCard
        className="run-staged-workspace-card gap-0 rounded-none border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] p-0 shadow-none"
        data-testid="run-staged-workspace-card"
      >
        <div className="run-staged-workspace-header flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--ui-border-soft)] px-4 py-3">
          <div className="run-staged-workspace-heading flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-[color:var(--ui-text-title)]">
              Proposed workspace changes
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
          <div className="run-staged-workspace-actions flex shrink-0 items-center gap-2">
            {canPreviewDiff ? (
              <ActionButton
                size="compact"
                disabled={previewLoading}
                onClick={togglePreview}
              >
                {previewOpen ? 'Hide diff' : previewLoading ? 'Loading diff' : 'View diff'}
              </ActionButton>
            ) : null}
            {pending && onApply && onReject ? (
              <>
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
              </>
            ) : null}
            {canRevert && onRevert ? (
              <DangerButton
                size="compact"
                leadingIcon={<UndoIcon />}
                disabled={isResolving}
                onClick={() => void onRevert(actionInput)}
              >
                Revert
              </DangerButton>
            ) : null}
          </div>
        </div>

        <div className="run-staged-workspace-body flex flex-col gap-3 px-4 py-3">
          <div className="run-staged-workspace-meta grid gap-2 text-[12px] text-[color:var(--ui-text)] sm:grid-cols-2">
            <div>
              <span className="font-medium text-[color:var(--ui-text-subtle)]">Tool</span>{' '}
              <span className="font-mono text-[color:var(--ui-text-title)]">{change.sourceToolName}</span>
            </div>
            <div>
              <span className="font-medium text-[color:var(--ui-text-subtle)]">Isolation</span>{' '}
              <span className="font-mono text-[color:var(--ui-text-title)]">{change.isolationMode}</span>
            </div>
            <div>
              <span className="font-medium text-[color:var(--ui-text-subtle)]">Operations</span>{' '}
              <span>{change.operationCount} {pluralize(change.operationCount, 'operation')}</span>
            </div>
            <div>
              <span className="font-medium text-[color:var(--ui-text-subtle)]">Kinds</span>{' '}
              <span className="font-mono text-[color:var(--ui-text-title)]">{formatOperationKinds(change)}</span>
            </div>
            <div>
              <span className="font-medium text-[color:var(--ui-text-subtle)]">Files changed</span>{' '}
              <span>{change.filesChanged}</span>
            </div>
            {change.requestedPath ? (
              <div className="min-w-0">
                <span className="font-medium text-[color:var(--ui-text-subtle)]">Requested</span>{' '}
                <span className="break-all font-mono text-[color:var(--ui-text-title)]">{change.requestedPath}</span>
              </div>
            ) : null}
          </div>

          {change.changedPaths.length > 0 ? (
            <div className="run-staged-workspace-paths flex flex-col gap-1">
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
        </div>
      </SurfaceCard>
      {previewOpen ? (
        previewArtifact ? (
          <RunChangeArtifactCard
            label="Staged diff preview"
            artifact={previewArtifact}
            stagedHunkReview={{
              baseInput: actionInput,
              decision: change.hunkDecision ?? null,
              isResolving,
              onApplyHunks,
              onRejectHunks,
              onRevertHunks
            }}
          />
        ) : previewError ? (
          <div className="rounded-[var(--ui-radius-md)] border border-[color:var(--ui-danger-border)] bg-[color:var(--ui-danger-soft)] px-4 py-3 text-[13px] text-[color:var(--ui-danger-text)]">
            {previewError}
          </div>
        ) : (
          <div className="rounded-[var(--ui-radius-md)] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-04)] px-4 py-3 text-[13px] text-[color:var(--ui-text-subtle)]">
            Loading diff...
          </div>
        )
      ) : null}
    </div>
  );
}
