import { Component, Suspense, lazy, useState, type ReactNode } from 'react';
import type { RunChangeArtifact, RunChangedFileArtifact } from '../../shared/domain';
import { ChevronDownIcon, ChevronRightIcon } from './icons';
import { DisclosureButton, SurfaceCard } from './ui';
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
  label
}: {
  artifact: RunChangeArtifact;
  label?: string | null;
}) {
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const summary = formatChangeSummary(artifact);
  const providerReported = isProviderReportedArtifact(artifact);

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
