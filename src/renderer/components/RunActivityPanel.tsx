import { useEffect, useMemo, useState } from 'react';
import type { RunActivityViewModel, ThinkingLineViewModel } from '../lib/run-activity';
import { resolveSkillIconByToken } from './skillIcons';
import { ChevronDownIcon, ChevronRightIcon, LoadingIcon, SkillsIcon } from './icons';
import { DisclosureButton, StatusPill } from './ui';
import { cx } from './ui/utils';

interface RunActivityPanelProps {
  activity: RunActivityViewModel;
  active?: boolean;
  showThinking?: boolean;
  showTerminalCommands?: boolean;
  showTimeline?: boolean;
}

function formatElapsedSeconds(totalSeconds: number) {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

function renderThinkingMeta(line: ThinkingLineViewModel) {
  if (line.kind === 'file_edit') {
    return null;
  }

  const meta = line.url ?? line.path ?? null;
  if (!meta) {
    return null;
  }

  return <span className="run-activity-thinking-meta break-all text-[11px] font-medium text-[color:var(--ui-text-subtle)]">{meta}</span>;
}

function renderSkillLine(line: ThinkingLineViewModel) {
  const token = line.label.trim().toLowerCase();
  const Icon = resolveSkillIconByToken(token) ?? SkillsIcon;

  return (
    <span
      className="skill-pill run-activity-skill-pill"
      data-skill-token={token}
    >
      <span className="skill-pill-icon" aria-hidden="true">
        <Icon size={12} />
      </span>
      <span className="skill-pill-label">{line.label}</span>
    </span>
  );
}

function renderFileEditLine(line: ThinkingLineViewModel) {
  const [added = '', removed = ''] = line.text.split(' ');
  return (
    <div className="run-activity-file-edit flex flex-wrap items-center gap-2 text-[13px] leading-6">
      <span className="text-[color:var(--ui-text-subtle)]">{line.label}</span>
      <span className="run-activity-file-edit-add font-medium">{added}</span>
      <span className="run-activity-file-edit-remove font-medium">{removed}</span>
    </div>
  );
}

function formatIsolationMode(value: string | null) {
  if (value === 'host_job_object_temp_profile') {
    return 'Host Job Object temp profile';
  }

  if (value === 'host_isolated_temp_profile') {
    return 'Host isolated temp profile';
  }

  return value;
}

function getTerminalPreviewLines(lines: string[], count = 2) {
  return lines
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, count);
}

function hasNarrativeTerminalLabel(label: string) {
  return /^background terminal /iu.test(label.trim());
}

function getCommandDurationLabel(startedAt: string | null, explicitDuration: string | null, status: 'running' | 'completed' | 'stopped', now: number) {
  if (status === 'running' && startedAt) {
    const startedMs = new Date(startedAt).getTime();
    if (Number.isFinite(startedMs)) {
      return formatElapsedSeconds(Math.max(1, Math.floor((now - startedMs) / 1000)));
    }
  }

  return explicitDuration;
}

function formatTerminalSummaryLabel(command: {
  label: string;
  command: string | null;
  status: 'running' | 'completed' | 'stopped';
  durationLabel: string | null;
  startedAt: string | null;
}, now: number) {
  const durationLabel = getCommandDurationLabel(command.startedAt, command.durationLabel, command.status, now);
  if (command.status === 'running') {
    return durationLabel ? `Running command for ${durationLabel}` : 'Running command';
  }

  const baseLabel = hasNarrativeTerminalLabel(command.label)
    ? command.label
    : command.command
      ? command.status === 'stopped'
        ? `Stopped ${command.command}`
        : `Ran ${command.command}`
      : command.label;

  if (!durationLabel) {
    return baseLabel;
  }

  return command.status === 'stopped' ? `${baseLabel} after ${durationLabel}` : `${baseLabel} for ${durationLabel}`;
}

export function RunActivityPanel({
  activity,
  active = false,
  showThinking = true,
  showTerminalCommands = true,
  showTimeline = true
}: RunActivityPanelProps) {
  const [expandedCommandId, setExpandedCommandId] = useState<string | null>(null);
  const [expandedThinkingId, setExpandedThinkingId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!active || !activity.startedAt) {
      setElapsedSeconds(0);
      return;
    }

    const startedAt = new Date(activity.startedAt).getTime();
    const update = () => {
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
    };

    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [active, activity.runId, activity.startedAt]);

  useEffect(() => {
    setExpandedCommandId(null);
    setExpandedThinkingId(null);
  }, [activity.runId]);

  const terminalCommands = useMemo(
    () => activity.terminalCommands.filter((entry) => entry.label.trim().length > 0),
    [activity.terminalCommands]
  );
  const timelineItems = useMemo(
    () =>
      activity.timelineItems.filter((entry) =>
        entry.kind === 'thinking' ? showThinking : showTerminalCommands
      ),
    [activity.timelineItems, showTerminalCommands, showThinking]
  );
  const visibleTerminalCommands = showTerminalCommands ? terminalCommands : [];
  const heading =
    active && showThinking
      ? activity.activeHeading
      : !active && visibleTerminalCommands.length > 0 && activity.workedForLabel
        ? `Worked for ${activity.workedForLabel}`
        : null;
  const hasContent = showTimeline && timelineItems.length > 0;
  const showOutcomeNotice = !active && activity.state !== 'completed' && Boolean(activity.outcomeMessage);
  const panelClassName = cx(
    'run-activity-panel rounded-[22px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] px-4 py-3',
    active && 'run-activity-panel-active border-[color:var(--ui-border)] bg-[color:var(--ui-surface-3)]'
  );

  const shouldCollapseThinkingLine = (line: ThinkingLineViewModel) =>
    line.kind !== 'skill' && (line.text.includes('\n') || line.text.length > 180);

  if (!heading && !hasContent && !showOutcomeNotice) {
    return null;
  }

  return (
    <section
      className={panelClassName}
      aria-live="polite"
      data-testid={active ? 'run-activity-live' : `run-activity-${activity.runId}`}
    >
      {heading ? (
        <div className="run-activity-heading pb-1">
          <div className="flex items-center gap-2">
            {active ? (
              <span className="run-activity-spinner inline-flex size-4 shrink-0 items-center justify-center text-[color:var(--ui-text-muted)]" aria-hidden="true">
                <LoadingIcon size={10} strokeWidth={2.1} />
              </span>
            ) : null}
            <span
              className={cx(
                active ? 'run-activity-heading-text run-activity-heading-text-active' : 'run-activity-heading-text',
                'text-[13px] font-medium text-[color:var(--ui-text)]'
              )}
            >
              {heading}
            </span>
            {active ? (
              <span className="run-activity-heading-time run-activity-heading-time-active text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--ui-text-subtle)]">
                {formatElapsedSeconds(elapsedSeconds)}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {showOutcomeNotice ? (
        <div className={`run-activity-outcome run-activity-outcome-${activity.state}`} role="status" aria-live="polite">
          <div className="run-activity-outcome-header">
            <StatusPill tone={activity.state}>{activity.state === 'failed' ? 'Run failed' : 'Run stopped'}</StatusPill>
            {activity.workedForLabel ? <span className="run-activity-outcome-time">{activity.workedForLabel}</span> : null}
          </div>
          <div className="run-activity-outcome-message">{activity.outcomeMessage}</div>
        </div>
      ) : null}

      {showTimeline && timelineItems.length > 0 ? (
        <div className="run-activity-timeline flex flex-col gap-3">
          {timelineItems.map((item) => {
            if (item.kind === 'thinking') {
              const line = item.line;
              const expanded = expandedThinkingId === line.id;
              const collapseLine = shouldCollapseThinkingLine(line);
              return (
                <div
                  key={item.id}
                  className={cx(
                    `run-activity-thinking-line run-activity-thinking-line-${line.kind}`,
                    line.kind === 'skill' || line.kind === 'file_edit'
                      ? 'flex items-center'
                      : 'rounded-[18px] border border-[color:var(--ui-alpha-06)] bg-[color:var(--ui-surface-3)] px-4 py-3'
                  )}
                >
                  {line.kind === 'skill' ? (
                    renderSkillLine(line)
                  ) : line.kind === 'file_edit' ? (
                    renderFileEditLine(line)
                  ) : line.kind === 'memory_checkpoint' ? (
                    <>
                      <div className="run-activity-thinking-text text-[13px] leading-6 text-[color:var(--ui-text)]">{line.label}</div>
                      {line.path ? (
                        <div className="mt-2 text-[12px] leading-5 text-[color:var(--ui-text-subtle)]">{line.path}</div>
                      ) : null}
                    </>
                  ) : collapseLine ? (
                    <>
                      <DisclosureButton
                        className="run-activity-thinking-trigger run-transcript-detail-trigger"
                        trailingIcon={expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                        onClick={() => setExpandedThinkingId((current) => (current === line.id ? null : line.id))}
                      >
                        <span className="run-activity-thinking-trigger-label truncate text-[13px] text-[color:var(--ui-text)]">{line.text}</span>
                      </DisclosureButton>
                      {expanded ? (
                        <div className="run-activity-thinking-expanded ui-detail-scroll mt-3 whitespace-pre-wrap rounded-[16px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-code-bg)] px-3 py-3 text-[13px] leading-6 text-[color:var(--ui-code-text)]">
                          {line.text}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="run-activity-thinking-text text-[13px] leading-6 text-[color:var(--ui-text)]">{line.text}</div>
                  )}
                  {renderThinkingMeta(line) ? <div className="run-activity-thinking-meta-row mt-2">{renderThinkingMeta(line)}</div> : null}
                </div>
              );
            }

            const command = item.command;
            const expanded = expandedCommandId === command.id;
            const previewLines = getTerminalPreviewLines(command.outputLines, command.status === 'running' ? 6 : 2);
            const isRunning = command.status === 'running';
            const shellPanelVisible = isRunning || expanded;
            const summaryLabel = formatTerminalSummaryLabel(command, Date.now());
            return (
              <div
                key={item.id}
                className={cx(
                  'run-activity-terminal-item',
                  isRunning
                    ? 'rounded-[18px] border border-[color:var(--ui-alpha-06)] bg-[color:var(--ui-surface-3)] px-4 py-3 is-running'
                    : 'is-collapsed-summary'
                )}
              >
                <DisclosureButton
                  data-testid={`run-command-${command.id}`}
                  className={cx(
                    'run-activity-terminal-trigger run-transcript-detail-trigger',
                    !isRunning && 'run-activity-terminal-trigger-collapsed'
                  )}
                  align={isRunning ? 'start' : 'between'}
                  trailingIcon={isRunning ? undefined : shellPanelVisible ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  onClick={() => setExpandedCommandId((current) => (current === command.id ? null : command.id))}
                >
                  <span className="run-activity-terminal-label block truncate text-[13px] font-medium text-[color:var(--ui-text)]">{summaryLabel}</span>
                </DisclosureButton>
                {shellPanelVisible ? (
                  <div className="run-activity-terminal-output ui-detail-scroll mt-1 rounded-[16px] bg-[color:var(--ui-code-bg)] p-3" aria-label={`Terminal output for ${command.command ?? 'command'}`}>
                    <div className="run-activity-terminal-output-header mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--ui-text-subtle)]">Shell</div>
                    {command.command ? <div className="run-activity-terminal-command-line mb-1 font-mono text-[12px] text-[color:var(--ui-text-title)]">$ {command.command}</div> : null}
                    {command.cwd ? <div className="run-activity-terminal-cwd mb-3 break-all font-mono text-[11px] text-[color:var(--ui-text-subtle)]">{command.cwd}</div> : null}
                    {command.isolationMode ? (
                      <div className="run-activity-terminal-isolation mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--ui-text-subtle)]">
                        {formatIsolationMode(command.isolationMode)}
                      </div>
                    ) : null}
                    {previewLines.length > 0 ? (
                      previewLines.map((line, index) => (
                        <div key={`${command.id}:${index}`} className="run-activity-terminal-output-line whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-[color:var(--ui-text)]">
                          {line}
                        </div>
                      ))
                    ) : (
                      <div className="run-activity-terminal-output-line run-activity-terminal-output-line-empty font-mono text-[12px] text-[color:var(--ui-text-subtle)]">No output yet.</div>
                    )}
                    <div className="run-activity-terminal-output-footer mt-3">
                      <span
                        className={cx(
                          `run-activity-terminal-status run-activity-terminal-status-${command.status}`,
                          'inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]'
                        )}
                      >
                        {command.status === 'running' ? 'Running' : command.status === 'stopped' ? 'Stopped' : 'Success'}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
