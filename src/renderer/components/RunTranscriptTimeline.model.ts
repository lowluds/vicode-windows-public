import type { RunTranscriptItem } from '../lib/run-activity';
import { sanitizeAssistantContent } from './RunTranscriptTimeline.format';
export type TranscriptRenderableItem =
  | RunTranscriptItem
  | {
      id: string;
      kind: 'running_reasoning_group';
      label: string;
      latestText: string;
      items: Extract<RunTranscriptItem, { kind: 'activity_line' }>[];
    }
  | {
      id: string;
      kind: 'activity_group';
      label: string;
      workedForLabel: string | null;
      items: Extract<RunTranscriptItem, { kind: 'activity_line' }>[];
    }
  | {
      id: string;
      kind: 'work_summary_group';
      workedForLabel: string;
      stepLabel: string;
      items: RunTranscriptItem[];
    };

export type ActivityLineItem = Extract<RunTranscriptItem, { kind: 'activity_line' }>;
export type AssistantTextItem = Extract<RunTranscriptItem, { kind: 'assistant_text' }>;
export type TerminalActivityLineItem = ActivityLineItem & { activityKind: 'terminal_command' };
export type ActivityGroupDetailItem =
  | {
      id: string;
      kind: 'activity_item';
      item: ActivityLineItem;
    }
  | {
      id: string;
      kind: 'command_group';
      label: string;
      items: TerminalActivityLineItem[];
    }
  | {
      id: string;
      kind: 'detail_group';
      label: string;
      items: ActivityLineItem[];
    };
export type WorkSummaryDetailItem =
  | ActivityGroupDetailItem
  | {
      id: string;
      kind: 'assistant_note';
      item: AssistantTextItem;
      text: string;
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
      ((previousItem.kind === 'activity_group' && previousItem.workedForLabel) ||
        previousItem.kind === 'work_summary_group')
  );
}

export function getWorkedGroupSources(
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

function isActivityLineItem(item: RunTranscriptItem): item is ActivityLineItem {
  return item.kind === 'activity_line';
}

function isAssistantTextItem(item: RunTranscriptItem): item is AssistantTextItem {
  return item.kind === 'assistant_text';
}

function isTerminalActivityLineItem(
  item: RunTranscriptItem
): item is TerminalActivityLineItem {
  return item.kind === 'activity_line' && item.activityKind === 'terminal_command';
}

function isThinkingActivityLineItem(item: RunTranscriptItem): item is ActivityLineItem {
  return item.kind === 'activity_line' && item.activityKind === 'thinking';
}

function getRedundantConcreteToolCategory(item: RunTranscriptItem) {
  const label = item.kind === 'activity_line'
    ? `${item.label} ${item.text}`.trim()
    : '';

  if (
    item.kind !== 'activity_line' ||
    (item.activityKind !== 'tool_call' && item.activityKind !== 'tool_result')
  ) {
    return null;
  }

  if (
    /^(?:failed|could not|blocked|denied|command failed|command denied|verification command denied|blocked command|blocked verification command)\b/iu.test(label)
  ) {
    return null;
  }

  if (
    item.toolName === 'run_command' ||
    item.toolName === 'exec_command' ||
    Boolean(item.command?.trim()) ||
    /^(?:calling|called|completed|failed|blocked)\s+(?:run command|run_command|exec_command)\b/iu.test(label) ||
    /^(?:command failed|command denied|verification command denied|blocked command|blocked verification command)\b/iu.test(label)
  ) {
    return 'terminal_command';
  }

  if (
    item.toolName === 'list_directory' ||
    item.toolName === 'read_file' ||
    item.toolName === 'open_file' ||
    item.toolName === 'search_files' ||
    item.toolName === 'grep_search' ||
    item.toolName === 'glob_search'
  ) {
    return 'inspection';
  }

  if (
    item.toolName === 'write_file' ||
    item.toolName === 'mkdir' ||
    item.toolName === 'create_directory' ||
    item.toolName === 'apply_patch'
  ) {
    return 'file_change';
  }

  if (item.toolName && researchToolNames.has(item.toolName)) {
    return 'research';
  }

  return null;
}

function hasInspectionEvidence(item: RunTranscriptItem) {
  return (
    item.kind === 'activity_line' &&
    (
      item.activityKind === 'inspection_group' ||
      item.activityKind === 'file_open' ||
      item.activityKind === 'file_read' ||
      item.activityKind === 'file_search'
    )
  );
}

function hasFileChangeEvidence(item: RunTranscriptItem) {
  return (
    item.kind === 'activity_line' &&
    (
      item.activityKind === 'write_group' ||
      item.activityKind === 'file_edit' ||
      item.activityKind === 'file_write' ||
      item.activityKind === 'mkdir'
    )
  );
}

function hasResearchEvidence(item: RunTranscriptItem) {
  return item.kind === 'activity_line' && item.activityKind === 'web_search';
}

function hideRedundantConcreteToolActivity<T extends RunTranscriptItem>(items: T[]): T[] {
  const hasConcreteEvidence = {
    terminalCommand: items.some(isTerminalActivityLineItem),
    inspection: items.some(hasInspectionEvidence),
    fileChange: items.some(hasFileChangeEvidence),
    research: items.some(hasResearchEvidence)
  };

  if (
    !hasConcreteEvidence.terminalCommand &&
    !hasConcreteEvidence.inspection &&
    !hasConcreteEvidence.fileChange &&
    !hasConcreteEvidence.research
  ) {
    return items;
  }

  return items.filter((item) => {
    const category = getRedundantConcreteToolCategory(item);
    if (!category) {
      return true;
    }

    return !(
      (category === 'terminal_command' && hasConcreteEvidence.terminalCommand) ||
      (category === 'inspection' && hasConcreteEvidence.inspection) ||
      (category === 'file_change' && hasConcreteEvidence.fileChange) ||
      (category === 'research' && hasConcreteEvidence.research)
    );
  });
}

type DetailGroupCategory = 'research' | 'inspection' | 'file_change' | 'tool';

const researchToolNames = new Set([
  'web_search',
  'extract_web_page',
  'research_topic',
  'crawl_site',
  'map_site'
]);

function getDetailGroupCategory(item: ActivityLineItem): DetailGroupCategory | null {
  if (item.activityKind === 'web_search' || researchToolNames.has(item.toolName ?? '')) {
    return 'research';
  }

  if (
    item.activityKind === 'inspection_group' ||
    item.activityKind === 'file_open' ||
    item.activityKind === 'file_read' ||
    item.activityKind === 'file_search'
  ) {
    return 'inspection';
  }

  if (
    item.activityKind === 'write_group' ||
    item.activityKind === 'file_write' ||
    item.activityKind === 'mkdir'
  ) {
    return 'file_change';
  }

  if (
    item.activityKind === 'tool_call' ||
    item.activityKind === 'tool_result' ||
    item.activityKind === 'delegation'
  ) {
    return 'tool';
  }

  return null;
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function formatDetailGroupLabel(category: DetailGroupCategory, count: number) {
  switch (category) {
    case 'research':
      return `${count} research ${pluralize(count, 'step')}`;
    case 'inspection':
      return `${count} inspection ${pluralize(count, 'step')}`;
    case 'file_change':
      return `${count} file ${pluralize(count, 'change')}`;
    case 'tool':
      return `${count} tool ${pluralize(count, 'detail')}`;
    default:
      return `${count} ${pluralize(count, 'detail')}`;
  }
}

function shouldRenderSingleActivityDirectly(item: ActivityLineItem) {
  return (
    item.activityKind === 'terminal_command' ||
    item.activityKind === 'thinking' ||
    item.activityKind === 'guidance' ||
    item.activityKind === 'skill' ||
    item.activityKind === 'memory_checkpoint' ||
    item.activityKind === 'context_compaction' ||
    item.activityKind === 'file_edit'
  );
}

function getVisibleAssistantNoteText(item: AssistantTextItem) {
  return sanitizeAssistantContent(item.text || '', Boolean(item.sources?.length)).trim();
}

function countWorkSummarySteps(items: RunTranscriptItem[]) {
  return hideRedundantConcreteToolActivity(items).filter((item) => {
    if (isActivityLineItem(item)) {
      return true;
    }

    return isAssistantTextItem(item) && getVisibleAssistantNoteText(item).length > 0;
  }).length;
}

function formatPreviousStepCount(count: number) {
  return `${count} previous ${count === 1 ? 'step' : 'steps'}`;
}

function summarizeActivityGroup(items: Extract<RunTranscriptItem, { kind: 'activity_line' }>[]) {
  const visibleItems = hideRedundantConcreteToolActivity(items);
  const terminalCount = visibleItems.filter((item) => item.activityKind === 'terminal_command').length;
  const inspectionCount = visibleItems.filter((item) =>
    item.activityKind === 'inspection_group'
      || item.activityKind === 'file_open'
      || item.activityKind === 'file_read'
      || item.activityKind === 'file_search'
      || item.activityKind === 'web_search'
  ).length;
  const fileChangeCount = visibleItems.filter((item) =>
    item.activityKind === 'write_group'
      || item.activityKind === 'file_edit'
      || item.activityKind === 'file_write'
      || item.activityKind === 'mkdir'
  ).length;
  const toolStepCount = visibleItems.filter((item) =>
    item.activityKind === 'tool_call'
      || item.activityKind === 'tool_result'
      || item.activityKind === 'delegation'
  ).length;

  if (visibleItems.length === 0) {
    return '0 previous steps';
  }

  if (visibleItems.length === 1) {
    const [item] = visibleItems;
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

  if (terminalCount === visibleItems.length) {
    return `${terminalCount} commands`;
  }

  if (inspectionCount === visibleItems.length) {
    return `${inspectionCount} inspection steps`;
  }

  if (fileChangeCount === visibleItems.length) {
    return `${fileChangeCount} file changes`;
  }

  if (toolStepCount === visibleItems.length) {
    return `${toolStepCount} tool steps`;
  }

  return `${visibleItems.length} previous steps`;
}

export function summarizeActivityGroupKinds(items: Extract<RunTranscriptItem, { kind: 'activity_line' }>[]) {
  const visibleItems = hideRedundantConcreteToolActivity(items);
  const inspectionCount = visibleItems.filter((item) =>
    item.activityKind === 'inspection_group'
      || item.activityKind === 'file_open'
      || item.activityKind === 'file_read'
      || item.activityKind === 'file_search'
      || item.activityKind === 'web_search'
  ).length;
  const fileChangeCount = visibleItems.filter((item) =>
    item.activityKind === 'write_group'
      || item.activityKind === 'file_edit'
      || item.activityKind === 'file_write'
      || item.activityKind === 'mkdir'
  ).length;
  const terminalCount = visibleItems.filter((item) => item.activityKind === 'terminal_command').length;
  const toolStepCount = visibleItems.filter((item) =>
    item.activityKind === 'tool_call'
      || item.activityKind === 'tool_result'
      || item.activityKind === 'delegation'
  ).length;
  const otherCount = visibleItems.length - inspectionCount - fileChangeCount - terminalCount - toolStepCount;
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

  return parts.slice(0, 3).join(' - ');
}

function formatCommandGroupLabel(commands: TerminalActivityLineItem[]) {
  const commandCount = commands.length;
  const noun = commandCount === 1 ? 'command' : 'commands';
  if (commands.every((command) => command.status === 'running')) {
    return `Running ${commandCount} ${noun}`;
  }
  if (commands.every((command) => command.status === 'stopped')) {
    return `Stopped ${commandCount} ${noun}`;
  }
  return `Ran ${commandCount} ${noun}`;
}

export function compactActivityGroupDetailItems(items: ActivityLineItem[]): ActivityGroupDetailItem[] {
  const details: ActivityGroupDetailItem[] = [];
  let pendingCommands: TerminalActivityLineItem[] = [];
  let pendingDetails: ActivityLineItem[] = [];
  let pendingDetailCategory: DetailGroupCategory | null = null;
  const visibleItems = hideRedundantConcreteToolActivity(items);

  const flushDetails = () => {
    if (pendingDetails.length === 0 || !pendingDetailCategory) {
      return;
    }

    details.push({
      id: `detail-group:${pendingDetails[0].id}`,
      kind: 'detail_group',
      label: formatDetailGroupLabel(pendingDetailCategory, pendingDetails.length),
      items: pendingDetails
    });
    pendingDetails = [];
    pendingDetailCategory = null;
  };

  const flushCommands = () => {
    if (pendingCommands.length === 0) {
      return;
    }

    details.push({
      id: `command-group:${pendingCommands[0].id}`,
      kind: 'command_group',
      label: formatCommandGroupLabel(pendingCommands),
      items: pendingCommands
    });
    pendingCommands = [];
  };

  for (const item of visibleItems) {
    if (isTerminalActivityLineItem(item)) {
      flushDetails();
      pendingCommands.push(item);
      continue;
    }

    const detailCategory = getDetailGroupCategory(item);
    if (detailCategory) {
      flushCommands();
      if (pendingDetailCategory && pendingDetailCategory !== detailCategory) {
        flushDetails();
      }
      pendingDetailCategory = detailCategory;
      pendingDetails.push(item);
      continue;
    }

    flushCommands();
    flushDetails();
    details.push({
      id: `activity:${item.id}`,
      kind: 'activity_item',
      item
    });
  }

  flushCommands();
  flushDetails();
  return details;
}

export function compactWorkSummaryDetailItems(items: RunTranscriptItem[]): WorkSummaryDetailItem[] {
  const details: WorkSummaryDetailItem[] = [];
  let pendingCommands: TerminalActivityLineItem[] = [];
  let pendingDetails: ActivityLineItem[] = [];
  let pendingDetailCategory: DetailGroupCategory | null = null;
  const visibleItems = hideRedundantConcreteToolActivity(items);

  const flushDetails = () => {
    if (pendingDetails.length === 0 || !pendingDetailCategory) {
      return;
    }

    details.push({
      id: `detail-group:${pendingDetails[0].id}`,
      kind: 'detail_group',
      label: formatDetailGroupLabel(pendingDetailCategory, pendingDetails.length),
      items: pendingDetails
    });
    pendingDetails = [];
    pendingDetailCategory = null;
  };

  const flushCommands = () => {
    if (pendingCommands.length === 0) {
      return;
    }

    details.push({
      id: `command-group:${pendingCommands[0].id}`,
      kind: 'command_group',
      label: formatCommandGroupLabel(pendingCommands),
      items: pendingCommands
    });
    pendingCommands = [];
  };

  for (const item of visibleItems) {
    if (isTerminalActivityLineItem(item)) {
      flushDetails();
      pendingCommands.push(item);
      continue;
    }

    flushCommands();

    if (isActivityLineItem(item)) {
      const detailCategory = getDetailGroupCategory(item);
      if (detailCategory) {
        if (pendingDetailCategory && pendingDetailCategory !== detailCategory) {
          flushDetails();
        }
        pendingDetailCategory = detailCategory;
        pendingDetails.push(item);
        continue;
      }

      flushDetails();
      details.push({
        id: `activity:${item.id}`,
        kind: 'activity_item',
        item
      });
      continue;
    }

    flushDetails();

    if (isAssistantTextItem(item)) {
      const text = getVisibleAssistantNoteText(item);
      if (text) {
        details.push({
          id: `assistant-note:${item.id}`,
          kind: 'assistant_note',
          item,
          text
        });
      }
    }
  }

  flushCommands();
  flushDetails();
  return details;
}

function compactWorkedForSummary(
  items: RunTranscriptItem[]
): TranscriptRenderableItem[] | null {
  const workedForIndex = items.findIndex((item) => item.kind === 'worked_for');
  if (workedForIndex < 0) {
    return null;
  }

  const workedForItem = items[workedForIndex];
  if (workedForItem?.kind !== 'worked_for') {
    return null;
  }

  const beforeWorkedFor = items.slice(0, workedForIndex);
  const afterWorkedFor = items.slice(workedForIndex + 1);
  const hasTrailingAnswer = afterWorkedFor.some((item) =>
    item.kind === 'assistant_text' || item.kind === 'resolution_summary'
  );
  const summaryItems: RunTranscriptItem[] = [];
  const visibleItems: RunTranscriptItem[] = [];

  for (const item of beforeWorkedFor) {
    if (isActivityLineItem(item)) {
      summaryItems.push(item);
      continue;
    }

    if (hasTrailingAnswer && isAssistantTextItem(item) && getVisibleAssistantNoteText(item)) {
      summaryItems.push(item);
      continue;
    }

    visibleItems.push(item);
  }

  if (summaryItems.length === 0) {
    return null;
  }

  return [
    {
      id: `work-summary:${workedForItem.id}`,
      kind: 'work_summary_group',
      workedForLabel: workedForItem.label,
      stepLabel: formatPreviousStepCount(countWorkSummarySteps(summaryItems)),
      items: summaryItems
    },
    ...compactCompletedActivityRows([...visibleItems, ...afterWorkedFor])
  ];
}

function compactCompletedActivityRows(
  items: RunTranscriptItem[],
): TranscriptRenderableItem[] {
  const grouped: TranscriptRenderableItem[] = [];
  let pendingActivityItems: Extract<RunTranscriptItem, { kind: 'activity_line' }>[] = [];

  const flushPending = (workedForLabel: string | null = null) => {
    if (pendingActivityItems.length === 0) {
      return;
    }

    const visibleActivityItems = hideRedundantConcreteToolActivity(pendingActivityItems);
    if (visibleActivityItems.length === 0) {
      pendingActivityItems = [];
      return;
    }

    if (visibleActivityItems.length === 1 && !workedForLabel && shouldRenderSingleActivityDirectly(visibleActivityItems[0])) {
      grouped.push(visibleActivityItems[0]);
      pendingActivityItems = [];
      return;
    }

    grouped.push({
      id: `activity-group:${visibleActivityItems[0].id}`,
      kind: 'activity_group',
      label: summarizeActivityGroup(visibleActivityItems),
      workedForLabel,
      items: visibleActivityItems
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

function normalizeReasoningText(item: ActivityLineItem) {
  const text = item.text.trim();
  if (text) {
    return text;
  }

  return item.label.trim();
}

function compactRunningActivityRows(items: RunTranscriptItem[]): TranscriptRenderableItem[] {
  const reasoningKeys = new Set<string>();
  const groupedItems: TranscriptRenderableItem[] = [];
  let pendingActivityItems: ActivityLineItem[] = [];
  let hasRenderedReasoning = false;

  const flushPendingActivity = () => {
    if (pendingActivityItems.length === 0) {
      return;
    }

    groupedItems.push(...compactCompletedActivityRows(pendingActivityItems));
    pendingActivityItems = [];
  };

  for (const item of items) {
    if (isThinkingActivityLineItem(item)) {
      const reasoningText = normalizeReasoningText(item);
      if (!reasoningText) {
        continue;
      }

      const key = `${item.label.trim()}\n${reasoningText}`;
      if (!reasoningKeys.has(key)) {
        reasoningKeys.add(key);
        if (hasRenderedReasoning) {
          flushPendingActivity();
        }

        groupedItems.push({
          id: `running-reasoning:${item.id}`,
          kind: 'running_reasoning_group',
          label: 'Reasoning',
          latestText: reasoningText,
          items: [item]
        });
        hasRenderedReasoning = true;

        flushPendingActivity();
      }
      continue;
    }

    if (isActivityLineItem(item)) {
      pendingActivityItems.push(item);
      continue;
    }

    flushPendingActivity();
    groupedItems.push(item);
  }

  flushPendingActivity();
  return groupedItems;
}

export function compactCompletedTranscriptActivityGroups(
  items: RunTranscriptItem[],
  runState: 'running' | 'completed' | 'failed' | 'aborted' | null,
  _runningWorkedForLabel: string | null = null
): TranscriptRenderableItem[] {
  const visibleItems = hideRedundantConcreteToolActivity(items);

  if (runState === 'running') {
    return compactRunningActivityRows(visibleItems);
  }

  return compactWorkedForSummary(visibleItems) ?? compactCompletedActivityRows(visibleItems);
}
