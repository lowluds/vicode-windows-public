import { useMemo } from 'react';
import type { RunActivityViewModel, TerminalCommandViewModel, ThinkingLineViewModel } from '../lib/run-activity';
import { Shimmer } from './ai-elements/shimmer';

export interface LiveRunStatusSnapshot {
  actionLabel: string | null;
}

function summarizeLiveActivityLine(line: ThinkingLineViewModel | null) {
  if (!line) {
    return null;
  }

  if (line.kind === 'web_search') {
    return 'Searching the web';
  }

  if (line.kind === 'thinking') {
    return 'Thinking';
  }

  if (line.kind === 'tool_call' || line.kind === 'tool_result') {
    return 'Working';
  }

  if (line.kind === 'file_open' || line.kind === 'file_read' || line.kind === 'file_search') {
    return 'Inspecting files';
  }

  if (line.kind === 'file_write' || line.kind === 'file_edit' || line.kind === 'mkdir') {
    return 'Editing files';
  }

  return 'Working';
}

function summarizeTerminalCommand(command: TerminalCommandViewModel | null) {
  if (!command) {
    return null;
  }

  if (command.status === 'running') {
    return 'Running command';
  }

  if (command.status === 'stopped') {
    return 'Stopped';
  }

  return null;
}

export function deriveLiveRunStatusSnapshot(
  activity: RunActivityViewModel | null
): LiveRunStatusSnapshot {
  if (!activity || activity.state !== 'running') {
    return {
      actionLabel: null
    };
  }

  const latestReasoningLine =
    [...activity.thinkingLines]
      .reverse()
      .find((line) => line.kind === 'thinking') ?? null;
  const latestActionLine =
    [...activity.thinkingLines]
      .reverse()
      .find((line) =>
        line.kind !== 'thinking' &&
        line.kind !== 'skill' &&
        line.kind !== 'memory_checkpoint' &&
        line.kind !== 'context_compaction'
      ) ?? null;
  const latestTerminalCommand =
    [...activity.terminalCommands].reverse().find((command) => command.status === 'running') ?? null;

  const actionLabel =
    summarizeTerminalCommand(latestTerminalCommand) ??
    summarizeLiveActivityLine(latestActionLine) ??
    summarizeLiveActivityLine(latestReasoningLine) ??
    activity.activeHeading ??
    'Working';

  return {
    actionLabel
  };
}

export function shouldShowLiveRunAction(snapshot: LiveRunStatusSnapshot) {
  const actionLabel = snapshot.actionLabel?.trim() ?? '';
  if (!actionLabel) {
    return false;
  }

  return true;
}

export function LiveRunStatus({ activity }: { activity: RunActivityViewModel | null }) {
  const snapshot = useMemo(() => deriveLiveRunStatusSnapshot(activity), [activity]);

  if (!snapshot.actionLabel) {
    return null;
  }

  const showAction = shouldShowLiveRunAction(snapshot);

  return (
    <section className="thread-live-status" aria-live="polite" data-testid="run-activity-live">
      {showAction ? (
        <div className="thread-live-status-action">
          <Shimmer className="thread-live-status-action-text" duration={1.7}>
            {snapshot.actionLabel!}
          </Shimmer>
        </div>
      ) : null}
    </section>
  );
}
