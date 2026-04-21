import { useMemo } from 'react';
import type { RunActivityViewModel, TerminalCommandViewModel, ThinkingLineViewModel } from '../lib/run-activity';
import { Reasoning, ReasoningContent, ReasoningTrigger } from './ai-elements/reasoning';
import { Shimmer } from './ai-elements/shimmer';

export interface LiveRunStatusSnapshot {
  actionLabel: string | null;
  reasoningLabel: string | null;
  reasoningText: string | null;
}

function summarizeLiveActivityLine(line: ThinkingLineViewModel | null) {
  if (!line) {
    return null;
  }

  if (line.kind === 'web_search') {
    return line.label || 'Searching the web';
  }

  if (line.kind === 'thinking') {
    return line.label || 'Thinking';
  }

  if (line.kind === 'tool_call' || line.kind === 'tool_result') {
    return line.label || 'Working';
  }

  if (line.kind === 'file_open' || line.kind === 'file_read' || line.kind === 'file_search') {
    return line.label || 'Inspecting files';
  }

  if (line.kind === 'file_write' || line.kind === 'file_edit' || line.kind === 'mkdir') {
    return line.label || 'Working';
  }

  return line.label || line.text || 'Working';
}

function summarizeTerminalCommand(command: TerminalCommandViewModel | null) {
  if (!command) {
    return null;
  }

  const normalizedCommand = command.command?.trim() ?? '';
  if (normalizedCommand.length > 0) {
    if (command.status === 'running') {
      return `Running ${normalizedCommand}`;
    }
    if (command.status === 'stopped') {
      return `Stopped ${normalizedCommand}`;
    }
    return `Ran ${normalizedCommand}`;
  }

  if (command.label.trim().length > 0) {
    return command.label;
  }

  return command.status === 'running' ? 'Running command' : 'Working';
}

function normalizeReasoningText(line: ThinkingLineViewModel | null) {
  if (!line) {
    return null;
  }

  const normalizedText = line.text.trim();
  if (normalizedText.length > 0) {
    return normalizedText;
  }

  const normalizedLabel = line.label.trim();
  return normalizedLabel.length > 0 ? normalizedLabel : null;
}

export function deriveLiveRunStatusSnapshot(
  activity: RunActivityViewModel | null
): LiveRunStatusSnapshot {
  if (!activity || activity.state !== 'running') {
    return {
      actionLabel: null,
      reasoningLabel: null,
      reasoningText: null
    };
  }

  const latestReasoningLine =
    [...activity.thinkingLines]
      .reverse()
      .find((line) => line.kind === 'thinking' && normalizeReasoningText(line)) ?? null;
  const latestActionLine =
    [...activity.thinkingLines]
      .reverse()
      .find((line) => line.kind !== 'thinking' && line.kind !== 'skill' && line.kind !== 'memory_checkpoint') ?? null;
  const latestTerminalCommand =
    [...activity.terminalCommands].reverse().find((command) => command.status === 'running') ??
    activity.terminalCommands.at(-1) ??
    null;

  const reasoningText = normalizeReasoningText(latestReasoningLine);
  const reasoningLabel = latestReasoningLine?.label?.trim() || null;
  const actionLabel =
    summarizeTerminalCommand(latestTerminalCommand) ??
    summarizeLiveActivityLine(latestActionLine) ??
    (reasoningText ? null : activity.activeHeading ?? 'Working');

  return {
    actionLabel,
    reasoningLabel,
    reasoningText
  };
}

export function shouldShowLiveRunAction(snapshot: LiveRunStatusSnapshot) {
  const actionLabel = snapshot.actionLabel?.trim() ?? '';
  return actionLabel.length > 0 && (actionLabel !== 'Thinking' || !snapshot.reasoningText);
}

export function LiveRunStatus({ activity }: { activity: RunActivityViewModel | null }) {
  const snapshot = useMemo(() => deriveLiveRunStatusSnapshot(activity), [activity]);

  if (!snapshot.actionLabel && !snapshot.reasoningText) {
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

      {snapshot.reasoningText ? (
        <Reasoning className="thread-live-status-reasoning" isStreaming>
          <ReasoningTrigger
            className="thread-live-status-reasoning-trigger"
            getThinkingMessage={(isStreaming) =>
              isStreaming ? (
                <Shimmer className="thread-live-status-thinking-text" duration={1.25}>
                  Thinking
                </Shimmer>
              ) : (
                <span className="thread-live-status-thinking-static">Reasoning</span>
              )
            }
          />
          <ReasoningContent className="thread-live-status-reasoning-content">
            {snapshot.reasoningText}
          </ReasoningContent>
        </Reasoning>
      ) : null}
    </section>
  );
}
