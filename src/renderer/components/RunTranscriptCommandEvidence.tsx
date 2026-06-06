import type { TerminalActivityLineItem } from './RunTranscriptTimeline.model';
import {
  formatIsolationMode,
  formatTerminalSummaryLabel,
  getTerminalPreviewLines
} from './RunTranscriptTimeline.format';
import { ChevronDownIcon, ChevronRightIcon } from './icons';
import { DisclosureButton } from './ui';

function formatInlineCommandLabel(item: TerminalActivityLineItem) {
  const command = item.command?.trim();
  if (!command) {
    return formatTerminalSummaryLabel(item);
  }

  const verb = item.status === 'running'
    ? 'Running'
    : item.status === 'stopped'
      ? 'Stopped'
      : 'Ran';
  const duration = item.durationLabel
    ? item.status === 'stopped'
      ? ` after ${item.durationLabel}`
      : ` for ${item.durationLabel}`
    : '';
  return `${verb} ${command}${duration}`;
}

function formatInlineCommandStatus(status: TerminalActivityLineItem['status']) {
  if (status === 'running') {
    return 'Running';
  }

  if (status === 'stopped') {
    return 'Stopped';
  }

  if (status === 'completed') {
    return 'Completed';
  }

  return 'Recorded';
}

export function RunTranscriptCommandEvidence({
  commandItem,
  expanded,
  onToggle
}: {
  commandItem: TerminalActivityLineItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const previewLines = getTerminalPreviewLines(commandItem.outputLines, commandItem.status === 'running' ? 6 : 4);

  return (
    <div className="run-transcript-command-entry">
      <DisclosureButton
        className="run-transcript-command-entry-trigger run-transcript-detail-trigger"
        align="start"
        trailingIcon={expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        onClick={onToggle}
      >
        <span className="run-transcript-command-entry-summary">
          <span className="run-transcript-command-entry-label">{formatInlineCommandLabel(commandItem)}</span>
          <span className="run-transcript-command-entry-status">{formatInlineCommandStatus(commandItem.status)}</span>
        </span>
      </DisclosureButton>
      {expanded ? (
        <div className="run-transcript-command-entry-body">
          <div className="run-transcript-command-entry-section">
            <div className="run-transcript-command-entry-section-label">Command</div>
            {commandItem.command ? (
              <div className="run-transcript-command-entry-code">$ {commandItem.command}</div>
            ) : (
              <div className="run-transcript-command-entry-empty">No command text recorded.</div>
            )}
            {commandItem.cwd ? (
              <div className="run-transcript-command-entry-cwd">cwd: {commandItem.cwd}</div>
            ) : null}
            {commandItem.isolationMode ? (
              <div className="run-transcript-command-entry-cwd">{formatIsolationMode(commandItem.isolationMode)}</div>
            ) : null}
          </div>
          <div className="run-transcript-command-entry-section">
            <div className="run-transcript-command-entry-section-label">Output</div>
            {previewLines.length > 0 ? (
              previewLines.map((line, lineIndex) => (
                <div key={`${commandItem.id}:output:${lineIndex}`} className="run-transcript-command-entry-output">
                  {line}
                </div>
              ))
            ) : (
              <div className="run-transcript-command-entry-empty">
                {commandItem.status === 'running' ? 'No output yet.' : 'No command output recorded.'}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
