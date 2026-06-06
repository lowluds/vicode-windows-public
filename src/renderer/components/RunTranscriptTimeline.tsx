import { useEffect, useState } from 'react';
import type {
  RunChangeArtifact,
  SkillDefinition,
  StagedWorkspaceHunkApplyInput,
  StagedWorkspaceHunkRejectInput,
  StagedWorkspaceHunkRevertInput,
  StagedWorkspaceReviewInput,
  WorktreeCleanupInput,
  WorktreeHunkApplyInput,
  WorktreeHunkRejectInput,
  WorktreeHunkRevertInput,
  WorktreeReviewInput
} from '../../shared/domain';
import type { RunTranscriptItem } from '../lib/run-activity';
import { resolveSkillIconByToken } from './skillIcons';
import { RunChangeArtifactCard } from './RunChangeArtifactCard';
import { StagedWorkspaceChangeCard, stagedWorkspaceReviewKey } from './StagedWorkspaceChangeCard';
import { WorktreeWorkspaceChangeCard, worktreeReviewKey } from './WorktreeWorkspaceChangeCard';
import { ChevronDownIcon, ChevronRightIcon, SkillsIcon } from './icons';
import { RunTranscriptCommandEvidence } from './RunTranscriptCommandEvidence';
import {
  RunTranscriptCommandGroup,
  RunTranscriptNestedDetailGroup
} from './RunTranscriptDetailGroup';
import { Message, MessageContent, MessageResponse } from './ai-elements/message';
import { Reasoning, ReasoningContent, ReasoningTrigger } from './ai-elements/reasoning';
import { Shimmer } from './ai-elements/shimmer';
import { Source, Sources, SourcesContent, SourcesTrigger } from './ai-elements/sources';
import { Tool, ToolContent, ToolHeader, ToolSection } from './ai-elements/tool';
import { DisclosureButton } from './ui';
import { cx } from './ui/utils';

import {
  type ActivityGroupDetailItem,
  type ActivityLineItem,
  type TerminalActivityLineItem,
  type WorkSummaryDetailItem,
  compactActivityGroupDetailItems,
  compactCompletedTranscriptActivityGroups,
  compactWorkSummaryDetailItems,
  getWorkedGroupSources,
  shouldNestAssistantSourcesWithWorkedGroup,
  summarizeActivityGroupKinds
} from './RunTranscriptTimeline.model';
import {
  formatIsolationMode,
  formatTerminalSummaryLabel,
  formatWorkingForLabel,
  getTerminalPreviewLines,
  sanitizeAssistantContent,
  stripRedundantActivityDetailLine,
  terminalToolState
} from './RunTranscriptTimeline.format';

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

function formatReasoningGroupContent(items: ActivityLineItem[]) {
  return items
    .map((item) => (item.text.trim() ? item.text.trim() : item.label.trim()))
    .filter(Boolean)
    .join('\n\n');
}

function escapeMarkdownLinkLabel(value: string) {
  return value.replace(/[[\]]/gu, (match) => `\\${match}`);
}

function buildWorkspaceReferenceHref(pathValue: string, workspaceRoot: string | null) {
  const trimmedPath = pathValue.trim();
  if (!trimmedPath) {
    return null;
  }

  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/(?!\/)\S)/u.test(trimmedPath)) {
    return trimmedPath;
  }

  if (!workspaceRoot) {
    return trimmedPath;
  }

  const normalizedPath = trimmedPath.replace(/^\.[\\/]+/u, '');
  const segments = normalizedPath.split(/[\\/]+/u).filter(Boolean);
  if (segments.length === 0 || segments.includes('..')) {
    return trimmedPath;
  }

  const trimmedRoot = workspaceRoot.replace(/[\\/]+$/u, '');
  const separator = trimmedRoot.includes('\\') ? '\\' : '/';
  return `${trimmedRoot}${separator}${segments.join(separator)}`;
}

function buildResolutionFileReferenceMarkdown(pathValue: string, workspaceRoot: string | null) {
  const href = buildWorkspaceReferenceHref(pathValue, workspaceRoot);
  if (!href) {
    return pathValue;
  }

  const label = escapeMarkdownLinkLabel(pathValue);
  return `[${label}](<${href.replace(/>/gu, '%3E')}>)`;
}

type AssistantDisclosureKind = 'context' | 'sources' | 'using';

interface AssistantDisclosureLine {
  kind: AssistantDisclosureKind;
  label: 'Context' | 'Sources' | 'Using';
  items: string[];
}

function cleanAssistantDisclosureItem(value: string) {
  return value
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^[,;:([{"']+/u, '')
    .replace(/[,;:.)\]}"']+$/u, '')
    .trim();
}

function normalizeAssistantDisclosureKey(value: string) {
  return cleanAssistantDisclosureItem(value)
    .replace(/^skill[:\s-]+/iu, '')
    .replace(/[-_]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function addSkillDisclosureKey(keys: Set<string>, value: unknown) {
  if (typeof value !== 'string') {
    return;
  }

  const normalized = normalizeAssistantDisclosureKey(value);
  if (normalized) {
    keys.add(normalized);
  }
}

function buildSkillDisclosureKeys(skills: SkillDefinition[]) {
  const keys = new Set<string>();
  for (const skill of skills) {
    addSkillDisclosureKey(keys, skill.id);
    addSkillDisclosureKey(keys, skill.name);
    addSkillDisclosureKey(keys, skill.metadata.slug);
    addSkillDisclosureKey(keys, skill.metadata.folderName);
  }
  return keys;
}

function isAssistantDisclosureLine(value: string) {
  return /^(?:Context|Referenced|Sources|Using):\s*.+$/iu.test(value.replace(/\s+/gu, ' ').trim());
}

function parseAssistantDisclosureLine(
  value: string,
  skillDisclosureKeys: Set<string>
): AssistantDisclosureLine | null {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  const match = normalized.match(/^(Context|Referenced|Sources|Using):\s*(.+)$/iu);
  if (!match) {
    return null;
  }

  const rawLabel = match[1]?.toLowerCase();
  const items = (match[2] ?? '')
    .split(/\s*,\s*/u)
    .map(cleanAssistantDisclosureItem)
    .filter(Boolean);
  if (items.length === 0) {
    return null;
  }

  if (rawLabel === 'using') {
    const skillItems = items.filter((item) => skillDisclosureKeys.has(normalizeAssistantDisclosureKey(item)));
    return skillItems.length > 0 ? { kind: 'using', label: 'Using', items: skillItems } : null;
  }

  if (rawLabel === 'sources') {
    return { kind: 'sources', label: 'Sources', items };
  }

  return { kind: 'context', label: 'Context', items };
}

function formatAssistantDisclosureLine(disclosure: AssistantDisclosureLine) {
  return `${disclosure.label}: ${disclosure.items.join(', ')}`;
}

function normalizeAssistantDisclosureText(text: string, skillDisclosureKeys: Set<string>) {
  return text
    .split(/\r?\n/gu)
    .map((line) => {
      const disclosure = parseAssistantDisclosureLine(line, skillDisclosureKeys);
      if (disclosure) {
        return formatAssistantDisclosureLine(disclosure);
      }

      return isAssistantDisclosureLine(line) ? null : line;
    })
    .filter((line): line is string => line !== null)
    .join('\n');
}

function StreamingAssistantDisclosure({ disclosure }: { disclosure: AssistantDisclosureLine }) {
  return (
    <p className="turn-reference-disclosure" data-disclosure-kind={disclosure.kind}>
      <span className="turn-reference-disclosure-label">{disclosure.label}:</span>
      <span className="turn-reference-disclosure-items">
        {disclosure.items.map((item, index) => (
          <span className="turn-reference-disclosure-item" key={`${disclosure.kind}:${item}:${index}`}>
            {index > 0 ? <span className="turn-reference-disclosure-separator">, </span> : null}
            {item}
          </span>
        ))}
      </span>
    </p>
  );
}

function renderStreamingAssistantText(text: string, skillDisclosureKeys: Set<string>) {
  const nodes: JSX.Element[] = [];
  let plainLines: string[] = [];

  const flushPlainLines = () => {
    const plainText = plainLines.join('\n').replace(/^\n+|\n+$/gu, '');
    plainLines = [];
    if (!plainText) {
      return;
    }

    nodes.push(
      <div className="whitespace-pre-wrap break-words" key={`plain:${nodes.length}`}>
        {plainText}
      </div>
    );
  };

  for (const line of text.split(/\r?\n/gu)) {
    const disclosure = parseAssistantDisclosureLine(line, skillDisclosureKeys);
    if (!disclosure) {
      if (!isAssistantDisclosureLine(line)) {
        plainLines.push(line);
      }
      continue;
    }

    flushPlainLines();
    nodes.push(
      <StreamingAssistantDisclosure
        disclosure={disclosure}
        key={`${disclosure.kind}:${nodes.length}`}
      />
    );
  }

  flushPlainLines();

  return nodes.length > 0 ? nodes : <div className="whitespace-pre-wrap break-words">{text}</div>;
}

export function RunTranscriptTimeline({
  items,
  skills,
  runState = null,
  activityStartedAt = null,
  compactActivity = true,
  suppressResolutionOutcome = false,
  stagedWorkspaceReviewResolvingKey = null,
  worktreeReviewResolvingKey = null,
  loadStagedWorkspacePreview,
  onApplyStagedWorkspaceChange,
  onRejectStagedWorkspaceChange,
  onRevertStagedWorkspaceChange,
  onApplyStagedWorkspaceHunks,
  onRejectStagedWorkspaceHunks,
  onRevertStagedWorkspaceHunks,
  onApplyWorktreeReview,
  onRejectWorktreeReview,
  onRevertWorktreeReview,
  onApplyWorktreeHunks,
  onRejectWorktreeHunks,
  onRevertWorktreeHunks,
  onCleanupWorktreeReview,
  workspaceRoot = null
}: {
  items: RunTranscriptItem[];
  skills: SkillDefinition[];
  runState?: 'running' | 'completed' | 'failed' | 'aborted' | null;
  activityStartedAt?: string | null;
  compactActivity?: boolean;
  suppressResolutionOutcome?: boolean;
  stagedWorkspaceReviewResolvingKey?: string | null;
  worktreeReviewResolvingKey?: string | null;
  loadStagedWorkspacePreview?: (input: StagedWorkspaceReviewInput) => Promise<RunChangeArtifact>;
  onApplyStagedWorkspaceChange?: (input: StagedWorkspaceReviewInput) => void | Promise<void>;
  onRejectStagedWorkspaceChange?: (input: StagedWorkspaceReviewInput) => void | Promise<void>;
  onRevertStagedWorkspaceChange?: (input: StagedWorkspaceReviewInput) => void | Promise<void>;
  onApplyStagedWorkspaceHunks?: (input: StagedWorkspaceHunkApplyInput) => void | Promise<void>;
  onRejectStagedWorkspaceHunks?: (input: StagedWorkspaceHunkRejectInput) => void | Promise<void>;
  onRevertStagedWorkspaceHunks?: (input: StagedWorkspaceHunkRevertInput) => void | Promise<void>;
  onApplyWorktreeReview?: (input: WorktreeReviewInput) => void | Promise<void>;
  onRejectWorktreeReview?: (input: WorktreeReviewInput) => void | Promise<void>;
  onRevertWorktreeReview?: (input: WorktreeReviewInput) => void | Promise<void>;
  onApplyWorktreeHunks?: (input: WorktreeHunkApplyInput) => void | Promise<void>;
  onRejectWorktreeHunks?: (input: WorktreeHunkRejectInput) => void | Promise<void>;
  onRevertWorktreeHunks?: (input: WorktreeHunkRevertInput) => void | Promise<void>;
  onCleanupWorktreeReview?: (input: WorktreeCleanupInput) => void | Promise<void>;
  workspaceRoot?: string | null;
}) {
  const [expandedTerminalId, setExpandedTerminalId] = useState<string | null>(null);
  const [expandedThinkingId, setExpandedThinkingId] = useState<string | null>(null);
  const [expandedActivityGroupId, setExpandedActivityGroupId] = useState<string | null | undefined>(undefined);
  const [expandedCommandGroupId, setExpandedCommandGroupId] = useState<string | null>(null);
  const [expandedDetailGroupId, setExpandedDetailGroupId] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const transcriptLineClassName =
    'rounded-[18px] border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-2)] px-4 py-3';
  const plainTranscriptLineClassName = 'px-1 py-0.5';
  const thinkingLineClassName = 'px-1 py-1';
  const metaClassName = 'text-[11px] font-medium text-[color:var(--ui-text-subtle)]';
  const workingForLabel = runState === 'running' ? formatWorkingForLabel(activityStartedAt, elapsedSeconds) : null;
  const renderableItems = compactActivity ? compactCompletedTranscriptActivityGroups(items, runState, workingForLabel) : items;
  const skillDisclosureKeys = buildSkillDisclosureKeys(skills);

  const renderCommandEntry = (commandItem: TerminalActivityLineItem) => (
    <RunTranscriptCommandEvidence
      commandItem={commandItem}
      expanded={expandedTerminalId === commandItem.id}
      onToggle={() => setExpandedTerminalId((current) => (current === commandItem.id ? null : commandItem.id))}
    />
  );

  const renderNestedActivityItem = (activityItem: ActivityLineItem) => (
    <RunTranscriptTimeline items={[activityItem]} skills={skills} runState={runState} compactActivity={false} workspaceRoot={workspaceRoot} />
  );

  const renderActivityGroupDetailItem = (
    detailItem: ActivityGroupDetailItem | WorkSummaryDetailItem,
    includeGuidanceThought = false
  ) => {
    if (detailItem.kind === 'assistant_note') {
      return (
        <div key={detailItem.id} className="run-transcript-activity-thought">
          {detailItem.text}
        </div>
      );
    }

    if (detailItem.kind === 'command_group') {
      return (
        <RunTranscriptCommandGroup
          key={detailItem.id}
          detailItem={detailItem}
          expanded={expandedCommandGroupId === detailItem.id}
          onToggle={() => setExpandedCommandGroupId((current) => (current === detailItem.id ? null : detailItem.id))}
          renderCommand={renderCommandEntry}
        />
      );
    }

    if (detailItem.kind === 'detail_group') {
      return (
        <RunTranscriptNestedDetailGroup
          key={detailItem.id}
          detailItem={detailItem}
          expanded={expandedDetailGroupId === detailItem.id}
          onToggle={() => setExpandedDetailGroupId((current) => (current === detailItem.id ? null : detailItem.id))}
          renderActivity={renderNestedActivityItem}
        />
      );
    }

    if (detailItem.item.activityKind === 'thinking' || (includeGuidanceThought && detailItem.item.activityKind === 'guidance')) {
      const detailText = detailItem.item.text || detailItem.item.label;
      return (
        <div key={detailItem.id} className="run-transcript-activity-thought">
          {detailText}
        </div>
      );
    }

    return (
      <div key={detailItem.id} className="run-transcript-activity-group-entry">
        {renderNestedActivityItem(detailItem.item)}
      </div>
    );
  };

  useEffect(() => {
    if (runState !== 'running' || !activityStartedAt) {
      setElapsedSeconds(0);
      return;
    }

    const startedAtMs = new Date(activityStartedAt).getTime();
    if (!Number.isFinite(startedAtMs)) {
      setElapsedSeconds(0);
      return;
    }

    const update = () => {
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - startedAtMs) / 1000)));
    };

    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [activityStartedAt, runState]);

  return (
    <div className="run-transcript-timeline flex flex-col gap-4">
      {renderableItems.map((item, index) => {
        if (item.kind === 'running_reasoning_group') {
          const reasoningContent = formatReasoningGroupContent(item.items);
          return (
            <div key={item.id} className="run-transcript-running-reasoning">
              <Reasoning
                className="run-transcript-reasoning run-transcript-reasoning-priority"
                defaultOpen={runState === 'running'}
                isStreaming={runState === 'running'}
              >
                <ReasoningTrigger
                  className="run-transcript-reasoning-trigger"
                  getThinkingMessage={() => (
                    <span className="run-transcript-reasoning-priority-summary">
                      <span className="run-transcript-reasoning-title">{item.label}</span>
                    </span>
                  )}
                />
                <ReasoningContent className="run-transcript-reasoning-content">
                  {reasoningContent}
                </ReasoningContent>
              </Reasoning>
            </div>
          );
        }

        if (item.kind === 'work_summary_group') {
          const expanded = expandedActivityGroupId === item.id;
          const workedGroupSources = getWorkedGroupSources(renderableItems, index);
          const detailItems = compactWorkSummaryDetailItems(item.items);
          return (
            <div
              key={item.id}
              className={cx(
                'run-transcript-activity-group',
                expanded && 'is-expanded',
                'is-worked-for-summary'
              )}
            >
              <DisclosureButton
                className="run-transcript-activity-group-trigger run-transcript-detail-trigger"
                align="start"
                trailingIcon={expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                onClick={() => setExpandedActivityGroupId((current) => (current === item.id ? null : item.id))}
              >
                <span className="run-transcript-activity-group-summary">
                  <span className="run-transcript-activity-group-label">{item.workedForLabel}</span>
                  <span className="run-transcript-activity-group-detail">{item.stepLabel}</span>
                </span>
              </DisclosureButton>
              {expanded ? (
                <div className="run-transcript-activity-group-body mt-3 flex flex-col gap-3">
                  {detailItems.map((detailItem) => renderActivityGroupDetailItem(detailItem, true))}
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

        if (item.kind === 'activity_group') {
          const expanded = expandedActivityGroupId === item.id;
          const detailLabel = item.workedForLabel ? null : summarizeActivityGroupKinds(item.items);
          const workedGroupSources = item.workedForLabel ? getWorkedGroupSources(renderableItems, index) : null;
          const detailItems = compactActivityGroupDetailItems(item.items);
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
                  {detailItems.map((detailItem) => renderActivityGroupDetailItem(detailItem))}
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

        if (item.kind === 'staged_workspace_change') {
          return (
            <StagedWorkspaceChangeCard
              key={item.id}
              change={item.change}
              isResolving={stagedWorkspaceReviewResolvingKey === stagedWorkspaceReviewKey(item.change)}
              loadPreview={loadStagedWorkspacePreview}
              onApply={onApplyStagedWorkspaceChange}
              onReject={onRejectStagedWorkspaceChange}
              onRevert={onRevertStagedWorkspaceChange}
              onApplyHunks={onApplyStagedWorkspaceHunks}
              onRejectHunks={onRejectStagedWorkspaceHunks}
              onRevertHunks={onRevertStagedWorkspaceHunks}
            />
          );
        }

        if (item.kind === 'worktree_workspace_change') {
          return (
            <WorktreeWorkspaceChangeCard
              key={item.id}
              change={item.change}
              isResolving={worktreeReviewResolvingKey === worktreeReviewKey(item.change)}
              onApply={onApplyWorktreeReview}
              onReject={onRejectWorktreeReview}
              onRevert={onRevertWorktreeReview}
              onApplyHunks={onApplyWorktreeHunks}
              onRejectHunks={onRejectWorktreeHunks}
              onRevertHunks={onRevertWorktreeHunks}
              onCleanup={onCleanupWorktreeReview}
            />
          );
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
          const sanitizedAssistantText = normalizeAssistantDisclosureText(
            sanitizeAssistantContent(item.text || '', Boolean(item.sources?.length)),
            skillDisclosureKeys
          );
          if (!sanitizedAssistantText.trim()) {
            return null;
          }

          const sourcesNestedWithWorkedGroup = shouldNestAssistantSourcesWithWorkedGroup(renderableItems, index);
          const streamAssistantAsPlainText = runState === 'running';

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
                  {streamAssistantAsPlainText ? (
                    renderStreamingAssistantText(sanitizedAssistantText, skillDisclosureKeys)
                  ) : (
                    <MessageResponse normalizeSource workspaceRoot={workspaceRoot}>{sanitizedAssistantText}</MessageResponse>
                  )}
                </MessageContent>
              </Message>
            </article>
          );
        }

        if (item.kind === 'resolution_summary') {
          return (
            <article
              key={item.id}
              className="run-transcript-resolution-summary"
            >
              <div className="run-transcript-resolution-label">Summary</div>
              {!suppressResolutionOutcome ? (
                <div className="run-transcript-resolution-outcome">{item.outcome}</div>
              ) : null}

              {item.filesChanged.length > 0 || item.toolsUsed.length > 0 || item.verificationCommands.length > 0 || item.remainingRisk ? (
                <div className="run-transcript-resolution-details">
                  {item.filesChanged.length > 0 ? (
                    <div className="run-transcript-resolution-section">
                      <div className="run-transcript-resolution-section-label">Changed</div>
                      <div className="run-transcript-resolution-list">
                        {item.filesChanged.map((path) => (
                          <div key={`${item.id}:${path}`} className="run-transcript-resolution-reference-line">
                            <MessageResponse
                              className="turn-content run-transcript-resolution-reference"
                              workspaceRoot={workspaceRoot}
                            >
                              {buildResolutionFileReferenceMarkdown(path, workspaceRoot)}
                            </MessageResponse>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {item.verificationCommands.length > 0 ? (
                    <div className="run-transcript-resolution-section">
                      <div className="run-transcript-resolution-section-label">Verified</div>
                      <div className="run-transcript-resolution-list">
                        {item.verificationCommands.map((command) => (
                          <div key={`${item.id}:${command}`} className="run-transcript-resolution-code-line">
                            {command}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {item.toolsUsed.length > 0 ? (
                    <div className="run-transcript-resolution-section">
                      <div className="run-transcript-resolution-section-label">Used</div>
                      <div className="run-transcript-resolution-list">
                        {item.toolsUsed.map((tool) => (
                          <div key={`${item.id}:${tool}`} className="run-transcript-resolution-code-line">
                            {tool}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {item.remainingRisk ? (
                    <div className="run-transcript-resolution-section">
                      <div className="run-transcript-resolution-section-label">Next step</div>
                      <div className="run-transcript-resolution-note">{item.remainingRisk}</div>
                    </div>
                  ) : null}
                </div>
              ) : null}
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
        const activityMetaText = item.url ?? (
          item.providerEventType === 'project_knowledge_context'
          || item.providerEventType === 'project_knowledge_referenced'
          || item.providerEventType === 'project_knowledge_using'
            ? null
            : item.path
        );
        const collapseThinking = item.activityKind !== 'thinking' && (detailText.includes('\n') || detailText.length > 180);
        const expandedThinking = expandedThinkingId === item.id;
        const activityLineClassName = cx(
          item.activityKind === 'thinking' ? thinkingLineClassName : plainTranscriptLineClassName,
          item.providerEventType === 'project_knowledge_context' || item.providerEventType === 'project_knowledge_referenced' || item.providerEventType === 'project_knowledge_using'
            ? 'run-transcript-activity-line-project-knowledge'
            : null,
          item.providerEventType === 'skills_using' || item.providerEventType === 'skills_referenced'
            ? 'run-transcript-activity-line-using-skills'
            : null
        );
        const displayTitle = item.label !== detailText && detailText.trim().length > 0 ? item.label : null;
        const triggerText = displayTitle ?? (detailText || item.label);
        if (item.activityKind === 'context_compaction') {
          return (
            <div key={item.id} className="run-transcript-context-divider" role="status" aria-label={item.label}>
              <span className="run-transcript-context-divider-label">{item.label}</span>
            </div>
          );
        }
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
                          Thinking…
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
            {activityMetaText ? (
              <div className="run-activity-thinking-meta-row mt-2">
                <span className={cx('run-activity-thinking-meta break-all', metaClassName)}>{activityMetaText}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
