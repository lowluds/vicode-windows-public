import { useState } from 'react';
import type { SkillDefinition } from '../../shared/domain';
import type { RunTranscriptItem } from '../lib/run-activity';
import { resolveSkillIconByToken } from './skillIcons';
import { RunChangeArtifactCard } from './RunChangeArtifactCard';
import { ChevronDownIcon, ChevronRightIcon, SkillsIcon } from './icons';
import { Message, MessageContent, MessageResponse } from './ai-elements/message';
import { Reasoning, ReasoningContent, ReasoningTrigger } from './ai-elements/reasoning';
import { Shimmer } from './ai-elements/shimmer';
import { Source, Sources, SourcesContent, SourcesTrigger } from './ai-elements/sources';
import { Tool, ToolContent, ToolHeader, ToolSection, type ToolState } from './ai-elements/tool';
import { DisclosureButton } from './ui';
import { cx } from './ui/utils';

function stripTrailingSourcesFooter(source: string) {
  return source.replace(/\n{2,}Sources:\s*\n(?:\s*-\s*https?:\/\/\S+\s*\n?)+$/iu, '').trim();
}

function sanitizeAssistantContent(source: string, hasStructuredSources = false) {
  const noisePatterns = [
    /^Ran [A-Za-z0-9_.:-]+(?:\s|$)/,
    /^Thinking$/i,
    /^Searched web for /i,
    /^ResourceUnavailable:?/i,
    /^Chunk ID:/i,
    /^Wall time:/i,
    /^Process exited with code /i,
    /^Original token count:/i,
    /^Output:$/i
  ];

  const filtered = source
    .replace(/<function_calls>[\s\S]*?<\/function_calls>/giu, '')
    .replace(/<parametername="[^"]+"\s*string="[^"]*">/giu, '')
    .replace(/<\/parameter>/giu, '')
    .split(/\r?\n/)
    .filter((line) => !noisePatterns.some((pattern) => pattern.test(line.trim())))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const cleaned = filtered || source;
  return hasStructuredSources ? stripTrailingSourcesFooter(cleaned) : cleaned;
}

function renderFileEditActivity(label: string, text: string) {
  const [insertions = '', deletions = ''] = text.split(' ');
  return (
    <div className="run-transcript-file-edit flex flex-wrap items-center gap-2 text-[13px] leading-6">
      <span className="text-[color:var(--ui-text-subtle)]">{label}</span>
      <span className="run-transcript-file-edit-add font-medium">{insertions}</span>
      <span className="run-transcript-file-edit-remove font-medium">{deletions}</span>
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

function normalizeActivityDetailText(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function stripRedundantActivityDetailLine(label: string, text: string) {
  const lines = text.split(/\r?\n/u);
  if (lines.length === 0) {
    return text;
  }

  const [firstLine, ...rest] = lines;
  if (normalizeActivityDetailText(firstLine) !== normalizeActivityDetailText(label)) {
    return text.trim();
  }

  return rest.join('\n').trim();
}

function formatTerminalSummaryLabel(item: {
  label: string;
  command: string | null;
  status: 'running' | 'completed' | 'stopped' | null;
  durationLabel: string | null;
}) {
  if (item.status === 'running') {
    return item.durationLabel ? `Running command for ${item.durationLabel}` : 'Running command';
  }

  const baseLabel = hasNarrativeTerminalLabel(item.label)
    ? item.label
    : item.command
      ? item.status === 'stopped'
        ? `Stopped ${item.command}`
        : `Ran ${item.command}`
      : item.label;

  if (!item.durationLabel) {
    return baseLabel;
  }

  return item.status === 'stopped' ? `${baseLabel} after ${item.durationLabel}` : `${baseLabel} for ${item.durationLabel}`;
}

function terminalToolState(status: Extract<RunTranscriptItem, { kind: 'activity_line'; activityKind: 'terminal_command' }>['status']): ToolState {
  if (status === 'running') {
    return 'input-available';
  }

  if (status === 'stopped') {
    return 'output-error';
  }

  return 'output-available';
}

type TranscriptRenderableItem =
  | RunTranscriptItem
  | {
      id: string;
      kind: 'activity_group';
      label: string;
      workedForLabel: string | null;
      items: Extract<RunTranscriptItem, { kind: 'activity_line' }>[];
    };

export function shouldNestAssistantSourcesWithWorkedGroup(
  items: TranscriptRenderableItem[],
  index: number
) {
  const currentItem = items[index];
  const previousItem = index > 0 ? items[index - 1] : null;

  return Boolean(
    currentItem &&
      currentItem.kind === 'assistant_text' &&
      currentItem.sources &&
      currentItem.sources.length > 0 &&
      previousItem &&
      previousItem.kind === 'activity_group' &&
      previousItem.workedForLabel
  );
}

function getWorkedGroupSources(
  items: TranscriptRenderableItem[],
  index: number
) {
  const nextItem = index < items.length - 1 ? items[index + 1] : null;
  if (
    nextItem &&
    nextItem.kind === 'assistant_text' &&
    nextItem.sources &&
    nextItem.sources.length > 0 &&
    shouldNestAssistantSourcesWithWorkedGroup(items, index + 1)
  ) {
    return nextItem.sources;
  }

  return null;
}

function isActivityLineItem(item: RunTranscriptItem): item is Extract<RunTranscriptItem, { kind: 'activity_line' }> {
  return item.kind === 'activity_line';
}

function isTerminalActivityLineItem(
  item: RunTranscriptItem
): item is Extract<RunTranscriptItem, { kind: 'activity_line'; activityKind: 'terminal_command' }> {
  return item.kind === 'activity_line' && item.activityKind === 'terminal_command';
}

function summarizeActivityGroup(items: Extract<RunTranscriptItem, { kind: 'activity_line' }>[]) {
  const terminalCount = items.filter((item) => item.activityKind === 'terminal_command').length;
  const inspectionCount = items.filter((item) =>
    item.activityKind === 'inspection_group'
      || item.activityKind === 'file_open'
      || item.activityKind === 'file_read'
      || item.activityKind === 'file_search'
      || item.activityKind === 'web_search'
  ).length;
  const fileChangeCount = items.filter((item) =>
    item.activityKind === 'write_group'
      || item.activityKind === 'file_edit'
      || item.activityKind === 'file_write'
      || item.activityKind === 'mkdir'
  ).length;
  const toolStepCount = items.filter((item) =>
    item.activityKind === 'tool_call'
      || item.activityKind === 'tool_result'
      || item.activityKind === 'delegation'
  ).length;

  if (items.length === 1) {
    const [item] = items;
    if (item.activityKind === 'terminal_command') {
      return '1 command';
    }
    if (inspectionCount === 1) {
      return '1 inspection step';
    }
    if (fileChangeCount === 1) {
      return '1 file change';
    }
    if (toolStepCount === 1) {
      return '1 tool step';
    }
    return '1 activity detail';
  }

  if (terminalCount === items.length) {
    return `${terminalCount} commands`;
  }

  if (inspectionCount === items.length) {
    return `${inspectionCount} inspection steps`;
  }

  if (fileChangeCount === items.length) {
    return `${fileChangeCount} file changes`;
  }

  if (toolStepCount === items.length) {
    return `${toolStepCount} tool steps`;
  }

  return `${items.length} previous steps`;
}

function summarizeActivityGroupKinds(items: Extract<RunTranscriptItem, { kind: 'activity_line' }>[]) {
  const inspectionCount = items.filter((item) =>
    item.activityKind === 'inspection_group'
      || item.activityKind === 'file_open'
      || item.activityKind === 'file_read'
      || item.activityKind === 'file_search'
      || item.activityKind === 'web_search'
  ).length;
  const fileChangeCount = items.filter((item) =>
    item.activityKind === 'write_group'
      || item.activityKind === 'file_edit'
      || item.activityKind === 'file_write'
      || item.activityKind === 'mkdir'
  ).length;
  const terminalCount = items.filter((item) => item.activityKind === 'terminal_command').length;
  const toolStepCount = items.filter((item) =>
    item.activityKind === 'tool_call'
      || item.activityKind === 'tool_result'
      || item.activityKind === 'delegation'
  ).length;
  const otherCount = items.length - inspectionCount - fileChangeCount - terminalCount - toolStepCount;
  const parts: string[] = [];

  if (inspectionCount > 0) {
    parts.push(`${inspectionCount} inspection${inspectionCount === 1 ? '' : 's'}`);
  }

  if (fileChangeCount > 0) {
    parts.push(`${fileChangeCount} edit${fileChangeCount === 1 ? '' : 's'}`);
  }

  if (terminalCount > 0) {
    parts.push(`${terminalCount} command${terminalCount === 1 ? '' : 's'}`);
  }

  if (toolStepCount > 0) {
    parts.push(`${toolStepCount} tool${toolStepCount === 1 ? '' : 's'}`);
  }

  if (otherCount > 0) {
    parts.push(`${otherCount} note${otherCount === 1 ? '' : 's'}`);
  }

  return parts.slice(0, 3).join(' · ');
}

export function compactCompletedTranscriptActivityGroups(
  items: RunTranscriptItem[],
  runState: 'running' | 'completed' | 'failed' | 'aborted' | null
): TranscriptRenderableItem[] {
  if (runState === 'running') {
    return items;
  }

  const grouped: TranscriptRenderableItem[] = [];
  let pendingActivityItems: Extract<RunTranscriptItem, { kind: 'activity_line' }>[] = [];

  const flushPending = (workedForLabel: string | null = null) => {
    if (pendingActivityItems.length === 0) {
      return;
    }

    if (pendingActivityItems.length === 1 && !workedForLabel) {
      grouped.push(pendingActivityItems[0]);
      pendingActivityItems = [];
      return;
    }

    grouped.push({
      id: `activity-group:${pendingActivityItems[0].id}`,
      kind: 'activity_group',
      label: summarizeActivityGroup(pendingActivityItems),
      workedForLabel,
      items: pendingActivityItems
    });
    pendingActivityItems = [];
  };

  for (const item of items) {
    if (isTerminalActivityLineItem(item)) {
      if (item.status === 'running') {
        flushPending();
        grouped.push(item);
        continue;
      }
      pendingActivityItems.push(item);
      continue;
    }

    if (isActivityLineItem(item)) {
      pendingActivityItems.push(item);
      continue;
    }

    if (item.kind === 'worked_for' && pendingActivityItems.length > 0) {
      flushPending(item.label);
      continue;
    }

    flushPending();
    grouped.push(item);
  }

  flushPending();

  const workedForIndex = grouped.findIndex((item) => item.kind === 'worked_for');
  if (workedForIndex >= 0) {
    const workedForItem = grouped[workedForIndex];
    const activityGroupIndex = grouped.findIndex((item) => item.kind === 'activity_group');
    if (workedForItem.kind === 'worked_for' && activityGroupIndex >= 0) {
      const activityGroup = grouped[activityGroupIndex];
      if (activityGroup.kind === 'activity_group') {
        grouped[activityGroupIndex] = {
          ...activityGroup,
          workedForLabel: workedForItem.label
        };
        grouped.splice(workedForIndex, 1);
      }
    }
  }

  return grouped;
}

export function RunTranscriptTimeline({
  items,
  skills,
  runState = null,
  compactActivity = true
}: {
  items: RunTranscriptItem[];
  skills: SkillDefinition[];
  runState?: 'running' | 'completed' | 'failed' | 'aborted' | null;
  compactActivity?: boolean;
}) {
  const [expandedTerminalId, setExpandedTerminalId] = useState<string | null>(null);
  const [expandedThinkingId, setExpandedThinkingId] = useState<string | null>(null);
  const [expandedActivityGroupId, setExpandedActivityGroupId] = useState<string | null>(null);
  const transcriptLineClassName =
    'rounded-[18px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] px-4 py-3';
  const plainTranscriptLineClassName = 'px-1 py-0.5';
  const thinkingLineClassName = 'px-1 py-1';
  const metaClassName = 'text-[11px] font-medium text-[color:var(--ui-text-subtle)]';
  const renderableItems = compactActivity ? compactCompletedTranscriptActivityGroups(items, runState) : items;

  return (
    <div className="run-transcript-timeline flex flex-col gap-4">
      {renderableItems.map((item, index) => {
        if (item.kind === 'activity_group') {
          const expanded = expandedActivityGroupId === item.id;
          const detailLabel = item.workedForLabel ? null : summarizeActivityGroupKinds(item.items);
          const workedGroupSources = item.workedForLabel ? getWorkedGroupSources(renderableItems, index) : null;
          return (
            <div
              key={item.id}
              className={cx(
                'run-transcript-activity-group',
                expanded && 'is-expanded',
                item.workedForLabel && 'is-worked-for-summary'
              )}
            >
              <DisclosureButton
                className="run-transcript-activity-group-trigger run-transcript-detail-trigger"
                align="start"
                trailingIcon={expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                onClick={() => setExpandedActivityGroupId((current) => (current === item.id ? null : item.id))}
              >
                <span className="run-transcript-activity-group-summary">
                  <span className="run-transcript-activity-group-label">{item.workedForLabel ?? item.label}</span>
                  {detailLabel ? <span className="run-transcript-activity-group-detail">{detailLabel}</span> : null}
                </span>
              </DisclosureButton>
              {expanded ? (
                <div className="run-transcript-activity-group-body mt-3 flex flex-col gap-3">
                  {item.items.map((activityItem) => (
                    <div key={activityItem.id} className="run-transcript-activity-group-entry">
                      <RunTranscriptTimeline items={[activityItem]} skills={skills} runState="running" compactActivity={false} />
                    </div>
                  ))}
                  {workedGroupSources && workedGroupSources.length > 0 ? (
                    <Sources className="run-transcript-worked-sources">
                      <SourcesTrigger className="run-transcript-worked-sources-trigger" count={workedGroupSources.length} />
                      <SourcesContent className="run-transcript-worked-sources-content">
                        {workedGroupSources.map((source) => (
                          <Source
                            key={`${item.id}:${source.url}`}
                            className="run-transcript-worked-source"
                            excerpt={source.excerpt}
                            href={source.url}
                            snippet={source.snippet}
                            title={source.title}
                          />
                        ))}
                      </SourcesContent>
                    </Sources>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        }

        if (item.kind === 'change_artifact') {
          return <RunChangeArtifactCard key={item.id} label={item.label} artifact={item.artifact} />;
        }

        if (item.kind === 'worked_for') {
          return (
            <div key={item.id} className="run-transcript-worked-for flex items-center gap-4 px-1 py-1">
              <div className="h-px flex-1 bg-[color:var(--ui-border-soft)]" aria-hidden="true" />
              <span className="text-[12px] font-medium text-[color:var(--ui-text-subtle)]">{item.label}</span>
              <div className="h-px flex-1 bg-[color:var(--ui-border-soft)]" aria-hidden="true" />
            </div>
          );
        }

        if (item.kind === 'assistant_text') {
          const sanitizedAssistantText = sanitizeAssistantContent(item.text || '', Boolean(item.sources?.length));
          if (!sanitizedAssistantText.trim()) {
            return null;
          }

          const sourcesNestedWithWorkedGroup = shouldNestAssistantSourcesWithWorkedGroup(renderableItems, index);

          return (
            <article key={item.id} className="turn turn-assistant run-transcript-message run-transcript-message-agent flex flex-col gap-3">
              {item.sources && item.sources.length > 0 && !sourcesNestedWithWorkedGroup ? (
                <Sources>
                  <SourcesTrigger count={item.sources.length} />
                  <SourcesContent>
                    {item.sources.map((source) => (
                      <Source
                        key={`${item.id}:${source.url}`}
                        excerpt={source.excerpt}
                        href={source.url}
                        snippet={source.snippet}
                        title={source.title}
                      />
                    ))}
                  </SourcesContent>
                </Sources>
              ) : null}
              <Message from="assistant" className="max-w-full">
                <MessageContent className="turn-content turn-content-assistant w-full max-w-full text-[15px] leading-7 text-[color:var(--ui-text-title)]">
                  <MessageResponse normalizeSource>{sanitizedAssistantText}</MessageResponse>
                </MessageContent>
              </Message>
            </article>
          );
        }

        if (item.kind === 'resolution_summary') {
          return (
              <article
              key={item.id}
              className="run-transcript-resolution-summary rounded-[22px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] px-5 py-4"
            >
              <div className="mb-4 text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--ui-text-subtle)]">
                Resolved
              </div>
              <div className="flex flex-col gap-4">
                <div>
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--ui-text-subtle)]">Outcome</div>
                  <div className="text-[14px] leading-6 text-[color:var(--ui-text-title)]">{item.outcome}</div>
                </div>

                {item.filesChanged.length > 0 ? (
                  <div>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--ui-text-subtle)]">Files changed</div>
                    <div className="flex flex-col gap-1.5">
                      {item.filesChanged.map((path) => (
                        <div key={`${item.id}:${path}`} className="font-mono text-[12px] leading-6 text-[color:var(--ui-text)]">
                          {path}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {item.toolsUsed.length > 0 ? (
                  <div>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--ui-text-subtle)]">Tools used</div>
                    <div className="flex flex-col gap-1.5">
                      {item.toolsUsed.map((tool) => (
                        <div key={`${item.id}:${tool}`} className="font-mono text-[12px] leading-6 text-[color:var(--ui-text)]">
                          {tool}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {item.verificationCommands.length > 0 ? (
                  <div>
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--ui-text-subtle)]">Verification</div>
                    <div className="flex flex-col gap-1.5">
                      {item.verificationCommands.map((command) => (
                        <div key={`${item.id}:${command}`} className="font-mono text-[12px] leading-6 text-[color:var(--ui-text)]">
                          {command}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {item.remainingRisk ? (
                  <div>
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--ui-text-subtle)]">Remaining risk</div>
                    <div className="text-[13px] leading-6 text-[color:var(--ui-text)]">{item.remainingRisk}</div>
                  </div>
                ) : null}
              </div>
            </article>
          );
        }

        if (item.activityKind === 'skill') {
          const token = item.label.trim().toLowerCase();
          const Icon = resolveSkillIconByToken(token) ?? SkillsIcon;
          return (
            <div key={item.id} className="run-transcript-activity-line run-transcript-activity-line-skill">
              <span className="run-transcript-inline-label" data-skill-token={token}>
                <span className="skill-pill-icon" aria-hidden="true">
                  <Icon size={12} />
                </span>
                <span>{item.label}</span>
              </span>
            </div>
          );
        }

        if (item.activityKind === 'file_edit') {
          return (
            <div key={item.id} className="run-transcript-activity-line run-transcript-activity-line-file-edit">
              {renderFileEditActivity(item.label, item.text)}
            </div>
          );
        }

        if (item.activityKind === 'terminal_command') {
          const expanded = expandedTerminalId === item.id;
          const previewLines = getTerminalPreviewLines(item.outputLines, item.status === 'running' ? 6 : 2);
          const isRunning = item.status === 'running';
          const summaryLabel = formatTerminalSummaryLabel(item);
          const terminalTitle = item.label.trim().length > 0 ? item.label : summaryLabel;
          return (
            <Tool
              key={item.id}
              className={cx(
                'run-activity-terminal-item run-transcript-terminal-tool',
                isRunning && 'is-running'
              )}
              defaultOpen={isRunning}
              onOpenChange={(open) => setExpandedTerminalId(open ? item.id : null)}
              open={isRunning ? true : expanded}
            >
              <ToolHeader
                className="run-transcript-terminal-tool-header"
                state={terminalToolState(item.status)}
                title={terminalTitle}
              />
              <ToolContent className="run-transcript-terminal-tool-content">
                <ToolSection className="run-transcript-terminal-tool-section" title="Command run">
                  {item.command ? (
                    <div className="run-activity-terminal-command-line font-mono text-[12px] text-[color:var(--ui-text-title)]">
                      $ {item.command}
                    </div>
                  ) : (
                    <div className="run-activity-terminal-output-line run-activity-terminal-output-line-empty font-mono text-[12px] text-[color:var(--ui-text-subtle)]">
                      No command text recorded.
                    </div>
                  )}
                  {item.cwd ? (
                    <div className="run-activity-terminal-cwd mt-2 break-all font-mono text-[11px] text-[color:var(--ui-text-subtle)]">
                      {item.cwd}
                    </div>
                  ) : null}
                  {item.isolationMode ? (
                    <div className="run-activity-terminal-isolation mt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--ui-text-subtle)]">
                      {formatIsolationMode(item.isolationMode)}
                    </div>
                  ) : null}
                </ToolSection>
                <ToolSection className="run-transcript-terminal-tool-section" title="What it did">
                  {previewLines.length > 0 ? (
                    previewLines.map((line, lineIndex) => (
                      <div
                        key={`${item.id}:${lineIndex}`}
                        className="run-activity-terminal-output-line whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-[color:var(--ui-text)]"
                      >
                        {line}
                      </div>
                    ))
                  ) : (
                    <div className="run-activity-terminal-output-line run-activity-terminal-output-line-empty font-mono text-[12px] text-[color:var(--ui-text-subtle)]">
                      {item.status === 'running' ? 'No output yet.' : 'No command output recorded.'}
                    </div>
                  )}
                </ToolSection>
              </ToolContent>
            </Tool>
          );
        }

        const detailText =
          item.activityKind === 'tool_call' || item.activityKind === 'tool_result' || item.activityKind === 'web_search'
            ? stripRedundantActivityDetailLine(item.label, item.text)
            : item.text;
        const collapseThinking = item.activityKind !== 'thinking' && (detailText.includes('\n') || detailText.length > 180);
        const expandedThinking = expandedThinkingId === item.id;
        const activityLineClassName = item.activityKind === 'thinking' ? thinkingLineClassName : plainTranscriptLineClassName;
        const displayTitle = item.label !== detailText && detailText.trim().length > 0 ? item.label : null;
        const triggerText = displayTitle ?? (detailText || item.label);
        if (item.activityKind === 'memory_checkpoint') {
          return (
            <div
              key={item.id}
              className={cx(
                `run-transcript-activity-line run-transcript-activity-line-${item.activityKind}`,
                activityLineClassName
              )}
            >
              <div className="run-activity-thinking-copy">
                <div className="run-activity-thinking-text text-[13px] leading-6 text-[color:var(--ui-text)]">{item.label}</div>
              </div>
              {item.path ? (
                <div className="run-activity-thinking-meta-row mt-2">
                  <span className={cx('run-activity-thinking-meta break-all', metaClassName)}>{item.path}</span>
                </div>
              ) : null}
            </div>
          );
        }
        return (
          <div
            key={item.id}
            className={cx(`run-transcript-activity-line run-transcript-activity-line-${item.activityKind}`, activityLineClassName)}
          >
            {item.activityKind === 'thinking' ? (
              <Reasoning
                className="run-transcript-reasoning"
                defaultOpen={runState === 'running'}
                isStreaming={runState === 'running'}
              >
                <ReasoningTrigger
                  className="run-transcript-reasoning-trigger"
                  getThinkingMessage={(isStreaming) =>
                    isStreaming ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="run-transcript-reasoning-title">Reasoning</span>
                        <Shimmer as="span" className="run-transcript-reasoning-status" duration={1}>
                          Thinking...
                        </Shimmer>
                      </span>
                    ) : (
                      <span className="run-transcript-reasoning-title">Reasoning</span>
                    )
                  }
                />
                <ReasoningContent className="run-transcript-reasoning-content">
                  {item.text || item.label}
                </ReasoningContent>
              </Reasoning>
            ) : detailText.trim().length === 0 ? (
              <div className="run-activity-thinking-copy">
                <div className="run-activity-thinking-text text-[13px] leading-6 text-[color:var(--ui-text)]">{item.label}</div>
              </div>
            ) : collapseThinking ? (
              <>
                <DisclosureButton
                  className="run-activity-thinking-trigger run-transcript-detail-trigger"
                  trailingIcon={expandedThinking ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  onClick={() => setExpandedThinkingId((current) => (current === item.id ? null : item.id))}
                >
                  <span className="run-activity-thinking-trigger-label truncate text-[13px] text-[color:var(--ui-text)]">{triggerText}</span>
                </DisclosureButton>
                {expandedThinking ? (
                  <div className="run-activity-thinking-expanded ui-detail-scroll mt-3 whitespace-pre-wrap rounded-[16px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-code-bg)] px-3 py-3 text-[13px] leading-6 text-[color:var(--ui-code-text)]">
                    {displayTitle ? (
                      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--ui-text-subtle)]">
                        {displayTitle}
                      </div>
                    ) : null}
                    {detailText}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="run-activity-thinking-copy">
                {displayTitle ? (
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--ui-text-subtle)]">
                      {displayTitle}
                    </div>
                  ) : null}
                <div className="run-activity-thinking-text text-[13px] leading-6 text-[color:var(--ui-text)]">{detailText}</div>
              </div>
            )}
            {item.url || item.path ? (
              <div className="run-activity-thinking-meta-row mt-2">
                <span className={cx('run-activity-thinking-meta break-all', metaClassName)}>{item.url ?? item.path}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
