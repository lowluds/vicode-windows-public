import { Component, Suspense, lazy, useState, type ReactNode } from 'react';
import type {
  RunChangeArtifact,
  RunChangedFileArtifact,
  StagedWorkspaceHunkApplyInput,
  StagedWorkspaceHunkRejectInput,
  StagedWorkspaceHunkRevertInput,
  StagedWorkspaceHunkReviewDecision,
  StagedWorkspaceReviewInput,
  WorktreeHunkApplyInput,
  WorktreeHunkRejectInput,
  WorktreeHunkRevertInput,
  WorktreeHunkReviewDecision,
  WorktreeReviewInput
} from '../../shared/domain';
import { parseRunChangeHunks, type RunChangeHunkArtifact } from '../../shared/hunk-review';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, CloseIcon, UndoIcon } from './icons';
import { ActionButton, DangerButton, DisclosureButton, SurfaceCard } from './ui';
import { cx } from './ui/utils';

const MonacoDiffEditor = lazy(async () => {
  const module = await import('./MonacoDiffEditor');
  return { default: module.MonacoDiffEditor };
});

class MonacoDiffErrorBoundary extends Component<
  {
    children: ReactNode;
    fallback: ReactNode;
  },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

function formatChangeSummary(artifact: RunChangeArtifact) {
  const { filesChanged, insertions, deletions } = artifact.summary;
  const label = filesChanged === 1 ? '1 file changed' : `${filesChanged} files changed`;
  return { label, insertions, deletions };
}

function formatFileStatus(file: RunChangedFileArtifact) {
  if (file.status === 'added') {
    return 'Created';
  }
  if (file.status === 'deleted') {
    return 'Deleted';
  }
  return 'Updated';
}

function normalizeArtifactPath(path: string) {
  return path.replace(/\\/gu, '/');
}

function formatHunkRange(hunk: RunChangeHunkArtifact) {
  const range = hunk.afterRange.startLine !== null && hunk.afterRange.lineCount > 0
    ? hunk.afterRange
    : hunk.beforeRange;
  if (range.startLine === null || range.lineCount === 0) {
    return 'File change';
  }
  const endLine = range.startLine + range.lineCount - 1;
  return endLine === range.startLine ? `Line ${range.startLine}` : `Lines ${range.startLine}-${endLine}`;
}

function hunkStatusLabel(
  hunk: RunChangeHunkArtifact,
  decision: StagedWorkspaceHunkReviewDecision | WorktreeHunkReviewDecision | null
) {
  if (!decision || !decision.hunkIds.includes(hunk.id)) {
    return 'Pending';
  }
  if (decision.status === 'failed') {
    return 'Failed';
  }
  if (decision.status === 'reverted' && decision.acceptedHunkIds.includes(hunk.id)) {
    return 'Reverted';
  }
  if (decision.acceptedHunkIds.includes(hunk.id)) {
    return decision.status === 'applied' ? 'Applied' : decision.status;
  }
  if (decision.rejectedHunkIds.includes(hunk.id)) {
    return 'Rejected';
  }
  return decision.status;
}

interface BaseHunkReviewControlsProps {
  decision: StagedWorkspaceHunkReviewDecision | WorktreeHunkReviewDecision | null;
  hunks: RunChangeHunkArtifact[];
  isResolving?: boolean;
}

interface StagedHunkReviewControlsProps extends BaseHunkReviewControlsProps {
  mode: 'staged';
  baseInput: StagedWorkspaceReviewInput;
  onApplyHunks?: (input: StagedWorkspaceHunkApplyInput) => void | Promise<void>;
  onRejectHunks?: (input: StagedWorkspaceHunkRejectInput) => void | Promise<void>;
  onRevertHunks?: (input: StagedWorkspaceHunkRevertInput) => void | Promise<void>;
}

interface WorktreeHunkReviewControlsProps extends BaseHunkReviewControlsProps {
  mode: 'worktree';
  baseInput: WorktreeReviewInput;
  onApplyHunks?: (input: WorktreeHunkApplyInput) => void | Promise<void>;
  onRejectHunks?: (input: WorktreeHunkRejectInput) => void | Promise<void>;
  onRevertHunks?: (input: WorktreeHunkRevertInput) => void | Promise<void>;
}

type HunkReviewControlsProps = StagedHunkReviewControlsProps | WorktreeHunkReviewControlsProps;
type StagedHunkReviewConfig = Omit<StagedHunkReviewControlsProps, 'mode' | 'hunks'>;
type WorktreeHunkReviewConfig = Omit<WorktreeHunkReviewControlsProps, 'mode' | 'hunks'>;
type HunkReviewConfig = Omit<StagedHunkReviewControlsProps, 'hunks'> | Omit<WorktreeHunkReviewControlsProps, 'hunks'>;

function HunkReviewControls(props: HunkReviewControlsProps) {
  const {
  decision,
  hunks,
  isResolving = false
  } = props;
  if (hunks.length === 0) {
    return null;
  }

  const canRenderActions = Boolean(props.onApplyHunks && props.onRejectHunks);
  const hasAppliedDecision = decision?.action === 'applied' && decision.status === 'applied';

  return (
    <div className="run-hunk-review flex flex-col gap-2 rounded-[var(--ui-radius-md)] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-03)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-[color:var(--ui-text-title)]">
          Hunk review
        </span>
        {hasAppliedDecision && props.onRevertHunks ? (
          <DangerButton
            size="compact"
            leadingIcon={<UndoIcon />}
            disabled={isResolving}
            onClick={() => {
              if (props.mode === 'staged') {
                void props.onRevertHunks?.(props.baseInput);
                return;
              }
              void props.onRevertHunks?.(props.baseInput);
            }}
          >
            Revert hunks
          </DangerButton>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        {hunks.map((hunk, index) => {
          const status = hunkStatusLabel(hunk, decision);
          const hunkActionable = canRenderActions
            && hunk.partialApplySupported
            && hunk.supportKind === 'partial'
            && !hasAppliedDecision
            && status !== 'Applied'
            && status !== 'Rejected'
            && status !== 'Reverted';
          return (
            <div
              key={hunk.id}
              className="run-hunk-review-row flex flex-wrap items-center justify-between gap-2 rounded-[var(--ui-radius-sm)] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-1)] px-3 py-2"
              data-testid="run-hunk-review-row"
              data-hunk-id={hunk.id}
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[12px] font-medium text-[color:var(--ui-text-title)]">
                  Hunk {index + 1} - {formatHunkRange(hunk)}
                </span>
                <span className="text-[11px] text-[color:var(--ui-text-subtle)]">
                  {status}
                  {hunk.unsupportedReason ? ` - ${hunk.unsupportedReason}` : ''}
                </span>
              </div>
              {hunkActionable ? (
                <div className="flex shrink-0 items-center gap-2">
                  <ActionButton
                    size="compact"
                    leadingIcon={<CheckIcon />}
                    disabled={isResolving}
                    onClick={() => {
                      if (props.mode === 'staged') {
                        void props.onApplyHunks?.({
                          ...props.baseInput,
                          acceptedHunkIds: [hunk.id],
                          rejectedHunkIds: []
                        });
                        return;
                      }
                      void props.onApplyHunks?.({
                        ...props.baseInput,
                        acceptedHunkIds: [hunk.id],
                        rejectedHunkIds: []
                      });
                    }}
                  >
                    Apply hunk
                  </ActionButton>
                  <DangerButton
                    size="compact"
                    leadingIcon={<CloseIcon />}
                    disabled={isResolving}
                    onClick={() => {
                      if (props.mode === 'staged') {
                        void props.onRejectHunks?.({
                          ...props.baseInput,
                          hunkIds: [hunk.id]
                        });
                        return;
                      }
                      void props.onRejectHunks?.({
                        ...props.baseInput,
                        hunkIds: [hunk.id]
                      });
                    }}
                  >
                    Reject hunk
                  </DangerButton>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isProviderReportedArtifact(artifact: RunChangeArtifact) {
  return artifact.source === 'provider_reported';
}

function renderPreviewLines(file: RunChangedFileArtifact) {
  return (
    <div className="flex flex-col">
      {file.previewLines.map((line, index) => (
        <div key={`${file.path}-${index}`} className={cx('run-change-preview-line', `is-${line.type}`)}>
          <span className="run-change-preview-gutter" aria-hidden="true">
            <span>{line.oldLineNumber ?? ''}</span>
            <span>{line.newLineNumber ?? ''}</span>
          </span>
          <code className="run-change-preview-text">{line.text}</code>
        </div>
      ))}
    </div>
  );
}

export function RunChangeArtifactCard({
  artifact,
  label,
  stagedHunkReview,
  worktreeHunkReview
}: {
  artifact: RunChangeArtifact;
  label?: string | null;
  stagedHunkReview?: StagedHunkReviewConfig;
  worktreeHunkReview?: WorktreeHunkReviewConfig;
}) {
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const summary = formatChangeSummary(artifact);
  const providerReported = isProviderReportedArtifact(artifact);
  const hunkReview: HunkReviewConfig | null = stagedHunkReview
    ? { mode: 'staged', ...stagedHunkReview }
    : worktreeHunkReview
      ? { mode: 'worktree', ...worktreeHunkReview }
      : null;
  const hunkParseResult = hunkReview ? parseRunChangeHunks(artifact) : null;

  return (
    <SurfaceCard
      className="run-change-card gap-0 rounded-none border-0 bg-transparent p-0 shadow-none"
      data-testid="run-change-card"
    >
      <div className="run-change-card-header flex items-center gap-3 border-b border-[color:var(--ui-border-soft)] px-4 py-3">
        <div className="run-change-card-heading flex min-w-0 flex-1 items-center gap-2">
          <span className="run-change-card-title truncate text-[15px] font-semibold text-[color:var(--ui-text-title)]">
            {label ?? summary.label}
          </span>
          <span
            className="run-change-card-stat is-add text-[14px] font-semibold"
            data-testid="run-change-summary-additions"
          >
            +{summary.insertions}
          </span>
          <span className="text-[14px] font-medium text-[color:var(--ui-text-subtle)]">-</span>
          <span
            className="run-change-card-stat is-remove text-[14px] font-semibold"
            data-testid="run-change-summary-deletions"
          >
            -{summary.deletions}
          </span>
        </div>
        {providerReported ? (
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--ui-text-subtle)]">
            Provider reported
          </span>
        ) : null}
      </div>

      <div className="run-change-card-files flex flex-col">
        {artifact.files.map((file) => {
          const expanded = expandedPath === file.path;
          const fileHunks = hunkParseResult?.artifactSupported
            ? hunkParseResult.hunks.filter((hunk) => hunk.filePath === normalizeArtifactPath(file.path))
            : [];
          return (
            <div
              key={file.path}
              className="run-change-file border-t border-[color:var(--ui-border-soft)] bg-transparent first:border-t-0"
            >
              <DisclosureButton
                className="run-change-file-trigger rounded-none px-4 py-3 hover:bg-[color:var(--ui-alpha-03)]"
                align="start"
                trailingIcon={expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                onClick={() => setExpandedPath((current) => (current === file.path ? null : file.path))}
              >
                <span className="run-change-file-trigger-inner flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span className="run-change-file-path truncate text-[14px] font-medium text-[color:var(--ui-text-title)]">{file.path}</span>
                    <span className="run-change-file-meta flex shrink-0 items-center gap-2">
                    <span className="run-change-card-stat is-add text-[14px] font-medium">
                      +{file.insertions}
                    </span>
                    <span className="text-[14px] font-medium text-[color:var(--ui-text-subtle)]">-</span>
                    <span className="run-change-card-stat is-remove text-[14px] font-medium">
                      -{file.deletions}
                    </span>
                  </span>
                </span>
              </DisclosureButton>
              {expanded ? (
                <div
                  className="run-change-preview border-t border-[color:var(--ui-border-soft)] px-4 pb-4 pt-3"
                  data-testid={`run-change-preview-${file.path}`}
                >
                    <div className="run-change-preview-header mb-3 flex items-center justify-between gap-3">
                      <span className="run-change-preview-title text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--ui-text-subtle)]">
                        {formatFileStatus(file)} {providerReported ? 'summary' : 'diff'}
                      </span>
                      {file.previewTruncated ? (
                        <span className="run-change-preview-note text-[11px] font-medium text-[color:var(--ui-text-subtle)]">
                          {providerReported ? 'Provider summary' : 'Full file review'}
                        </span>
                      ) : null}
                    </div>
                  {hunkReview && !file.previewTruncated ? (
                    <div className="mb-3">
                      <HunkReviewControls
                        {...hunkReview}
                        hunks={fileHunks}
                      />
                    </div>
                  ) : null}
                  <div
                    className="run-change-preview-code ui-detail-scroll rounded-[16px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-code-bg)]"
                    role="region"
                    aria-label={`${file.path} diff preview`}
                  >
                    <MonacoDiffErrorBoundary fallback={renderPreviewLines(file)}>
                      <Suspense
                        fallback={
                          <div className="flex min-h-[240px] items-center justify-center text-[12px] font-medium text-[color:var(--ui-text-subtle)]">
                            Loading diff…
                          </div>
                        }
                      >
                        <MonacoDiffEditor
                          path={file.path}
                          originalValue={file.beforeContent ?? ''}
                          modifiedValue={file.afterContent ?? ''}
                        />
                      </Suspense>
                    </MonacoDiffErrorBoundary>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </SurfaceCard>
  );
}
