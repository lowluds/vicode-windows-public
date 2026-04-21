import type { RunReviewEvidenceViewModel } from '../lib/run-activity';
import { RunActivityPanel } from './RunActivityPanel';
import { RunChangeArtifactCard } from './RunChangeArtifactCard';

function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}

export function RunReviewPanel({ evidence }: { evidence: RunReviewEvidenceViewModel }) {
  const changedFileCount = evidence.changeArtifact?.summary.filesChanged ?? 0;
  const thoughtEvidenceCount = evidence.thoughtEvidence.length;
  const fileEvidenceCount = evidence.fileEvidence.length;
  const commandCount = evidence.terminalCommands.length;
  const providerReportedChanges = evidence.changeArtifact?.source === 'provider_reported';
  const thoughtEvidenceIds = new Set(evidence.thoughtEvidence.map((line) => line.id));
  const fileEvidenceIds = new Set(evidence.fileEvidence.map((line) => line.id));
  const thoughtEvidenceActivity = {
    ...evidence.activity,
    thinkingLines: evidence.thoughtEvidence,
    terminalCommands: [],
    timelineItems: evidence.activity.timelineItems.filter(
      (item) => item.kind === 'thinking' && thoughtEvidenceIds.has(item.line.id)
    ),
    activeHeading: null
  } as const;
  const fileEvidenceActivity = {
    ...evidence.activity,
    thinkingLines: evidence.fileEvidence,
    terminalCommands: [],
    timelineItems: evidence.activity.timelineItems.filter(
      (item) => item.kind === 'thinking' && fileEvidenceIds.has(item.line.id)
    ),
    activeHeading: null
  } as const;

  return (
    <section className="run-review-panel" data-testid={`run-review-${evidence.runId}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="settings-provider-copy">
          <strong>Run details</strong>
          <p>Inspect the finished thought process, workspace proof, and terminal output from this run.</p>
        </div>
        <div className="skill-meta">
          {thoughtEvidenceCount > 0 ? (
            <span>
              {thoughtEvidenceCount} {pluralize(thoughtEvidenceCount, 'thought step', 'thought steps')}
            </span>
          ) : null}
          {changedFileCount > 0 ? (
            <span>
              {changedFileCount} {pluralize(changedFileCount, 'file', 'files')} changed
            </span>
          ) : null}
          {fileEvidenceCount > 0 ? (
            <span>
              {fileEvidenceCount} {pluralize(fileEvidenceCount, 'file action', 'file actions')}
            </span>
          ) : null}
          {commandCount > 0 ? (
            <span>
              {commandCount} {pluralize(commandCount, 'shell command', 'shell commands')}
            </span>
          ) : null}
          {evidence.workedForLabel ? <span>{evidence.workedForLabel}</span> : null}
        </div>
      </div>

      {thoughtEvidenceCount > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="settings-provider-copy">
            <strong>Thought process</strong>
            <p>Review the finished reasoning and tool narrative the agent surfaced before the final answer.</p>
          </div>
          <RunActivityPanel activity={thoughtEvidenceActivity} showTerminalCommands={false} />
        </div>
      ) : null}

      {evidence.changeArtifact ? (
        <div className="flex flex-col gap-3">
          <div className="settings-provider-copy">
            <strong>File changes</strong>
            <p>
              {providerReportedChanges
                ? 'Review the provider-reported change summary before treating it as a final diff.'
                : 'Review the diff summary Vicode captured from the trusted workspace before accepting the result.'}
            </p>
          </div>
          <RunChangeArtifactCard
            artifact={evidence.changeArtifact}
            label={providerReportedChanges ? 'Provider-reported changes' : 'Changed files'}
          />
        </div>
      ) : null}

      {fileEvidenceCount > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="settings-provider-copy">
            <strong>File evidence</strong>
            <p>Review the workspace reads, searches, and writes the agent used to reach the result.</p>
          </div>
          <RunActivityPanel activity={fileEvidenceActivity} showTerminalCommands={false} />
        </div>
      ) : null}

      {commandCount > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="settings-provider-copy">
            <strong>Terminal evidence</strong>
            <p>Review the shell commands and captured output that backed this run.</p>
          </div>
          <RunActivityPanel activity={evidence.activity} showThinking={false} />
        </div>
      ) : null}
    </section>
  );
}
