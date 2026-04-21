import type { RunActivityInfo, RunChangeArtifact, RunEvent, RunProgressState, ThreadDetail, ThreadSource, ThreadTurn } from '../../shared/domain';

export interface TerminalCommandViewModel {
  id: string;
  label: string;
  command: string | null;
  cwd: string | null;
  isolationMode: string | null;
  status: 'running' | 'completed' | 'stopped';
  startedAt: string | null;
  finishedAt: string | null;
  durationLabel: string | null;
  outputLines: string[];
}

export interface ThinkingLineViewModel {
  id: string;
  label: string;
  text: string;
  url: string | null;
  path: string | null;
  kind: 'thinking' | 'skill' | 'memory_recall' | 'memory_checkpoint' | 'web_search' | 'delegation' | 'tool_call' | 'tool_result' | 'file_edit' | 'file_write' | 'mkdir' | 'file_open' | 'file_read' | 'file_search';
}

export interface RunActivityTimelineThinkingItem {
  id: string;
  kind: 'thinking';
  line: ThinkingLineViewModel;
}

export interface RunActivityTimelineTerminalItem {
  id: string;
  kind: 'terminal_command';
  command: TerminalCommandViewModel;
}

export type RunActivityTimelineItem = RunActivityTimelineThinkingItem | RunActivityTimelineTerminalItem;

export interface RunTranscriptAssistantItem {
  id: string;
  kind: 'assistant_text';
  text: string;
  sources?: ThreadSource[];
}

export interface RunTranscriptActivityItem {
  id: string;
  kind: 'activity_line';
  activityKind: 'thinking' | 'skill' | 'memory_recall' | 'memory_checkpoint' | 'web_search' | 'delegation' | 'tool_call' | 'tool_result' | 'file_edit' | 'file_write' | 'mkdir' | 'terminal_command' | 'file_open' | 'file_read' | 'file_search' | 'inspection_group' | 'write_group';
  toolName: string | null;
  label: string;
  text: string;
  url: string | null;
  path: string | null;
  command: string | null;
  cwd: string | null;
  isolationMode: string | null;
  status: 'running' | 'completed' | 'stopped' | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationLabel: string | null;
  outputLines: string[];
}

export interface RunTranscriptChangeArtifactItem {
  id: string;
  kind: 'change_artifact';
  label: string;
  artifact: RunChangeArtifact;
}

export interface RunTranscriptWorkedForItem {
  id: string;
  kind: 'worked_for';
  label: string;
}

export interface RunTranscriptResolutionSummaryItem {
  id: string;
  kind: 'resolution_summary';
  outcome: string;
  filesChanged: string[];
  toolsUsed: string[];
  verificationCommands: string[];
  remainingRisk: string | null;
}

export type RunTranscriptItem =
  | RunTranscriptAssistantItem
  | RunTranscriptActivityItem
  | RunTranscriptChangeArtifactItem
  | RunTranscriptWorkedForItem
  | RunTranscriptResolutionSummaryItem;

export interface RunActivityViewModel {
  runId: string;
  state: 'running' | 'completed' | 'failed' | 'aborted';
  startedAt: string | null;
  finishedAt: string | null;
  outcomeMessage: string | null;
  thinkingLines: ThinkingLineViewModel[];
  terminalCommands: TerminalCommandViewModel[];
  timelineItems: RunActivityTimelineItem[];
  activeHeading: 'Thinking' | 'Working' | null;
  workedForLabel: string | null;
  changeArtifact: RunChangeArtifact | null;
}

export interface RunReviewEvidenceViewModel {
  runId: string;
  state: RunActivityViewModel['state'];
  reviewAvailable: boolean;
  changeArtifact: RunChangeArtifact | null;
  thoughtEvidence: ThinkingLineViewModel[];
  fileEvidence: ThinkingLineViewModel[];
  terminalCommands: TerminalCommandViewModel[];
  workedForLabel: string | null;
  activity: RunActivityViewModel;
}

const WORKED_FOR_ACTIVITY_KINDS = new Set<RunTranscriptActivityItem['activityKind']>([
  'tool_call',
  'tool_result',
  'file_edit',
  'file_write',
  'mkdir',
  'terminal_command',
  'write_group'
]);

function readDelta(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanMultiline(value: string) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

const nodeInternalStackLinePattern = /^\s*at .*(?:\((?:node:)?internal[/:].+\)|\((?:node:)?diagnostics_channel:.+\)|(?:node:)?internal[/:].+|(?:node:)?diagnostics_channel:.+)$/u;

function sanitizeTerminalOutputLine(value: string) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.replace(/\u001b\[[0-9;]*m/gu, '').trimEnd())
    .filter((line) => line.trim().length > 0 && !nodeInternalStackLinePattern.test(line.trim()))
    .join('\n')
    .trimEnd();
}

function sanitizeTerminalOutputLines(values: string[] | null) {
  if (!values) {
    return null;
  }

  return values.map(sanitizeTerminalOutputLine).filter(Boolean);
}

function readString(value: unknown) {
  return typeof value === 'string' ? clean(value) : null;
}

const noisyOperationalMessagePatterns = [
  /^<meta\b/iu,
  /^<\/?(?:html|body|main|div|noscript|script|style|svg|path)\b/iu,
  /^<[^>]+>$/u,
  /^[A-Za-z][A-Za-z0-9:_-]*="[^"]*"$/u,
  /^(?:d|fill|stroke|strokeWidth|viewBox|xmlns|class|role|width|height)=/u,
  /^>$/u,
  /^\/>$/u,
  /\bcodex_core::/u,
  /\bmcp::service::client\b/u,
  /\bcodex_features\b/u,
  /\bReceived unknown status update\b/u,
  /\bstartup remote plugin sync failed\b/u,
  /\bWARN\b.*\b(?:codex_|mcp::)\b/u
];

function shouldSuppressOperationalMessage(value: string | null) {
  if (!value) {
    return false;
  }

  const normalized = value
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .replace(/\[[0-9]{4}-[0-9]{2}-[0-9]{2}T[^\]]+\]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

  if (!normalized) {
    return true;
  }

  return noisyOperationalMessagePatterns.some((pattern) => pattern.test(normalized));
}

function sanitizeOperationalMessage(value: string | null) {
  return shouldSuppressOperationalMessage(value) ? null : value;
}

function normalizeWorkspaceCwd(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = clean(value);
  if (!normalized) {
    return null;
  }

  if (normalized === '.' || normalized === './' || normalized === '.\\') {
    return 'Workspace root';
  }

  return normalized;
}

function readCwd(value: unknown) {
  return typeof value === 'string' ? normalizeWorkspaceCwd(value) : null;
}

function readMultilineString(value: unknown) {
  return typeof value === 'string' ? cleanMultiline(value) : null;
}

function readActivityInfo(value: unknown): RunActivityInfo | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<RunActivityInfo>;
  if ((candidate.kind === 'thinking' || candidate.kind === 'skill' || candidate.kind === 'memory_recall' || candidate.kind === 'memory_checkpoint' || candidate.kind === 'web_search' || candidate.kind === 'delegation' || candidate.kind === 'tool_call' || candidate.kind === 'tool_result' || candidate.kind === 'file_edit' || candidate.kind === 'file_write' || candidate.kind === 'mkdir' || candidate.kind === 'terminal_command' || candidate.kind === 'terminal_output' || candidate.kind === 'file_open' || candidate.kind === 'file_read' || candidate.kind === 'file_search' || candidate.kind === 'change_summary') && typeof candidate.summary === 'string') {
    return {
      kind: candidate.kind,
      summary: clean(candidate.summary),
      phase: candidate.phase,
      providerEventType: readString(candidate.providerEventType),
      toolName: readString(candidate.toolName),
      status: readString(candidate.status),
      query: readString(candidate.query),
      command: readString(candidate.command),
      cwd: readCwd(candidate.cwd),
      isolationMode: readString(candidate.isolationMode),
      url: readString(candidate.url),
      path: readString(candidate.path),
      text: candidate.kind === 'terminal_command' || candidate.kind === 'terminal_output' ? (typeof candidate.text === 'string' ? sanitizeTerminalOutputLine(candidate.text) || null : null) : readMultilineString(candidate.text),
      outputLines:
        candidate.kind === 'terminal_command' || candidate.kind === 'terminal_output'
          ? sanitizeTerminalOutputLines(Array.isArray(candidate.outputLines) ? candidate.outputLines.filter((value): value is string => typeof value === 'string') : null)
          : Array.isArray(candidate.outputLines)
            ? candidate.outputLines
                .filter((value): value is string => typeof value === 'string')
                .map(clean)
                .filter(Boolean)
            : null,
      background: candidate.background === true,
      changeArtifact: candidate.changeArtifact ?? null
    };
  }

  return null;
}

function appendUnique(target: string[], value: string | null) {
  if (!value) {
    return;
  }
  if (target[target.length - 1] !== value) {
    target.push(value);
  }
}

function appendIfMissing(target: string[], value: string | null) {
  if (!value) {
    return;
  }
  if (!target.includes(value)) {
    target.push(value);
  }
}

function appendLines(target: string[], values: string[] | null | undefined) {
  if (!values || values.length === 0) {
    return;
  }
  for (const value of values) {
    appendUnique(target, value);
  }
}

function stripLeadingTerminalCommandEcho(command: string | null, values: string[]) {
  if (!command || values.length === 0) {
    return values;
  }

  const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const commandEchoPattern = new RegExp(`^(?:PS\\s+[^>]+>\\s*|\\$\\s*)?${escapedCommand}$`, 'u');
  const nextValues = [...values];

  while (nextValues.length > 0 && commandEchoPattern.test(nextValues[0]?.trim() ?? '')) {
    nextValues.shift();
  }

  return nextValues;
}

function compactTerminalOutput(command: string | null, values: string[]) {
  return stripLeadingTerminalCommandEcho(command, values);
}

function formatYesNo(value: boolean) {
  return value ? 'Yes' : 'No';
}

function normalizeFriendlyToolDetailLine(toolName: string | null, line: string) {
  const trimmed = line.trim();
  if (!trimmed || !toolName) {
    return trimmed;
  }

  switch (toolName) {
    case 'web_search':
      return trimmed
        .replace(/^query:\s*/iu, 'Search query: ')
        .replace(/^max results:\s*/iu, 'Results limit: ');
    case 'extract_web_page':
      return trimmed
        .replace(/^url:\s*/iu, 'Page URL: ')
        .replace(/^query:\s*/iu, 'Focus: ');
    case 'research_topic':
      return trimmed
        .replace(/^query:\s*/iu, 'Research topic: ')
        .replace(/^max results:\s*/iu, 'Results limit: ')
        .replace(/^max pages:\s*/iu, 'Page limit: ');
    case 'crawl_site':
    case 'map_site':
      return trimmed
        .replace(/^url:\s*/iu, 'Start URL: ')
        .replace(/^max pages:\s*/iu, 'Page limit: ')
        .replace(/^same origin only:\s*(true|false)$/iu, (_, value: string) => `Stay on one site: ${formatYesNo(value.toLowerCase() === 'true')}`);
    case 'mkdir':
    case 'create_directory':
      return trimmed.replace(/^path:\s*/iu, 'Folder: ');
    default:
      return trimmed;
  }
}

function normalizeFriendlyToolDetailText(toolName: string | null, text: string | null | undefined) {
  if (!text) {
    return text ?? null;
  }

  const normalized = text
    .split(/\r?\n/u)
    .map((line) => normalizeFriendlyToolDetailLine(toolName, line))
    .join('\n')
    .trim();

  return normalized || null;
}

function formatFriendlyToolCallLabel(toolName: string | null, fallback: string) {
  switch (toolName) {
    case 'mkdir':
    case 'create_directory':
      return 'Creating folder';
    case 'web_search':
      return 'Searching the web';
    case 'extract_web_page':
      return 'Reading a web page';
    case 'research_topic':
      return 'Researching a topic';
    case 'crawl_site':
      return 'Crawling a site';
    case 'map_site':
      return 'Mapping a site';
    default:
      return fallback;
  }
}

function formatFriendlyToolResultLabel(toolName: string | null, status: string | null, fallback: string) {
  const isError = status?.toLowerCase() === 'error' || status?.toLowerCase() === 'failed' || status?.toLowerCase() === 'stopped';

  switch (toolName) {
    case 'mkdir':
    case 'create_directory':
      return isError ? 'Could not create folder' : 'Created folder';
    case 'web_search':
      return isError ? 'Web search failed' : 'Searched the web';
    case 'extract_web_page':
      return isError ? 'Could not read the web page' : 'Read the web page';
    case 'research_topic':
      return isError ? 'Research failed' : 'Finished research';
    case 'crawl_site':
      return isError ? 'Site crawl failed' : 'Crawled the site';
    case 'map_site':
      return isError ? 'Site map failed' : 'Mapped the site';
    default:
      return fallback;
  }
}

function deriveFriendlyToolCallDisplay(activity: Extract<RunActivityInfo, { kind: 'tool_call' }>) {
  return {
    label: formatFriendlyToolCallLabel(activity.toolName ?? null, activity.summary),
    text: normalizeFriendlyToolDetailText(activity.toolName ?? null, activity.text ?? activity.summary) ?? activity.summary
  };
}

function appendThinkingLine(target: ThinkingLineViewModel[], entry: Omit<ThinkingLineViewModel, 'id'>, seed: string) {
  const label = clean(entry.label);
  const text = cleanMultiline(entry.text);
  if (!label) {
    return;
  }

  const previous = target[target.length - 1];
  if (previous && previous.label === label && previous.text === text && previous.url === (entry.url ?? null) && previous.path === (entry.path ?? null) && previous.kind === entry.kind) {
    return;
  }

  target.push({
    id: `${seed}:${target.length}`,
    label,
    text,
    url: entry.url ?? null,
    path: entry.path ?? null,
    kind: entry.kind
  });
}

function deriveToolResultDisplay(activity: RunActivityInfo) {
  if (activity.kind === 'tool_result' && activity.toolName !== 'run_command') {
    return {
      label: formatFriendlyToolResultLabel(activity.toolName ?? null, activity.status ?? null, activity.summary),
      text: normalizeFriendlyToolDetailText(activity.toolName ?? null, activity.text ?? activity.summary) ?? activity.summary
    };
  }

  if (
    activity.kind !== 'tool_result'
    || activity.toolName !== 'run_command'
    || activity.status !== 'error'
  ) {
    return {
      label: activity.summary,
      text: activity.text ?? activity.summary
    };
  }

  const detail = activity.text ?? activity.summary;
  const command = clean(activity.command ?? '');
  const isVerificationCommand = /^(?:npm|pnpm|yarn|bun|npx|vite|vitest|playwright|pytest|cargo|go|dotnet|python\b.*-m\s+pytest\b)/iu.test(command)
    && /\b(?:build|test|check|verify|preview|lint|typecheck|pytest|vitest|playwright)\b/iu.test(command);
  const blockedPrefix = isVerificationCommand ? 'Blocked verification command' : 'Blocked command';
  if (detail.startsWith('run_command requires Full access.')) {
    return {
      label: `${blockedPrefix}: Full access required`,
      text: detail
    };
  }
  if (detail.startsWith('run_command is disabled for this workspace.')) {
    return {
      label: `${blockedPrefix}: workspace commands disabled`,
      text: detail
    };
  }
  if (detail.startsWith('run_command is blocked by this workspace network policy.')) {
    return {
      label: `${blockedPrefix}: workspace network blocked`,
      text: detail
    };
  }
  if (detail.startsWith('run_command is blocked by runtime launcher policy. Nested shell launchers')) {
    return {
      label: `${blockedPrefix}: nested shell launcher`,
      text: detail
    };
  }
  if (detail.startsWith('run_command is blocked by runtime launcher policy. Inline interpreter commands')) {
    return {
      label: `${blockedPrefix}: inline interpreter`,
      text: detail
    };
  }
  if (detail.startsWith('run_command is blocked by runtime launcher policy. Remote shell commands')) {
    return {
      label: `${blockedPrefix}: remote shell launcher`,
      text: detail
    };
  }
  if (detail.startsWith('run_command is blocked by runtime path policy. The command references an absolute path outside the trusted workspace')) {
    return {
      label: `${blockedPrefix}: outside workspace path`,
      text: detail
    };
  }
  if (detail.startsWith('run_command is blocked by runtime path policy. The command references a relative path that resolves outside the trusted workspace')) {
    return {
      label: `${blockedPrefix}: path escape`,
      text: detail
    };
  }
  if (detail.startsWith('run_command was not approved by the user.')) {
    return {
      label: isVerificationCommand ? 'Verification command denied' : 'Command denied',
      text: detail
    };
  }
  if (detail.startsWith('run_command requires a runtime approval handler')) {
    return {
      label: `${blockedPrefix}: approval unavailable`,
      text: detail
    };
  }

  return {
    label: activity.summary,
    text: detail
  };
}

function shouldSuppressTranscriptToolResult(activity: RunActivityInfo) {
  if (activity.kind !== 'tool_result') {
    return false;
  }

  const normalizedStatus = activity.status?.toLowerCase() ?? null;
  if (normalizedStatus === 'error' || normalizedStatus === 'failed' || normalizedStatus === 'stopped') {
    return false;
  }

  switch (activity.toolName) {
    case 'list_directory':
    case 'read_file':
    case 'write_file':
    case 'mkdir':
    case 'create_directory':
    case 'open_file':
    case 'search_files':
    case 'grep_search':
    case 'glob_search':
    case 'run_command':
    case 'exec_command':
      return true;
    default:
      break;
  }

  const normalizedSummary = clean(activity.summary);
  const normalizedText = activity.text ? cleanMultiline(activity.text) : null;
  const hasMeaningfulDetail = Boolean(normalizedText && normalizedText !== normalizedSummary);

  return !activity.url
    && !activity.path
    && !hasMeaningfulDetail
    && /^(Completed|Finished|Applied|Created|Opened|Read|Searched|Listed|Ran)\b/i.test(normalizedSummary);
}

function hasVisibleTranscriptText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isInternalRuntimeReminderText(value: string | null | undefined) {
  return typeof value === 'string' && /^Internal runtime reminder:/iu.test(value.trim());
}

function shouldSuppressTranscriptThinkingActivity(activity: Extract<RunActivityInfo, { kind: 'thinking' }>) {
  return activity.providerEventType === 'ollama_tool_loop_thinking'
    && isInternalRuntimeReminderText(activity.text ?? activity.summary);
}

function isInspectionActivityItem(item: RunTranscriptItem): item is RunTranscriptActivityItem {
  return item.kind === 'activity_line' && (item.activityKind === 'file_open' || item.activityKind === 'file_read' || item.activityKind === 'file_search');
}

function isWriteActivityItem(item: RunTranscriptItem): item is RunTranscriptActivityItem {
  return item.kind === 'activity_line' && (item.activityKind === 'file_write' || item.activityKind === 'mkdir');
}

function isToolCallActivityItem(item: RunTranscriptItem): item is RunTranscriptActivityItem {
  return item.kind === 'activity_line' && item.activityKind === 'tool_call';
}

function shouldSuppressToolCallBeforeConcreteAction(toolCallItem: RunTranscriptActivityItem, nextItem: RunTranscriptItem | undefined) {
  if (!nextItem || nextItem.kind !== 'activity_line') {
    return false;
  }

  switch (toolCallItem.toolName) {
    case 'list_directory':
    case 'read_file':
    case 'open_file':
    case 'search_files':
    case 'grep_search':
    case 'glob_search':
      return nextItem.activityKind === 'file_open'
        || nextItem.activityKind === 'file_read'
        || nextItem.activityKind === 'file_search'
        || nextItem.activityKind === 'inspection_group';
    case 'write_file':
    case 'mkdir':
    case 'create_directory':
      return nextItem.activityKind === 'file_write'
        || nextItem.activityKind === 'mkdir'
        || nextItem.activityKind === 'write_group';
    case 'run_command':
    case 'exec_command':
      return nextItem.activityKind === 'terminal_command';
    case 'web_search':
    case 'research_topic':
    case 'extract_web_page':
    case 'crawl_site':
    case 'map_site':
      return nextItem.activityKind === 'web_search';
    default:
      break;
  }

  return false;
}

function compactRedundantToolCalls(items: RunTranscriptItem[]) {
  const results: RunTranscriptItem[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (isToolCallActivityItem(item) && shouldSuppressToolCallBeforeConcreteAction(item, items[index + 1])) {
      continue;
    }

    results.push(item);
  }

  return results;
}

function shouldSuppressToolResultAfterConcreteAction(
  previousItem: RunTranscriptItem | undefined,
  item: RunTranscriptItem
) {
  if (item.kind !== 'activity_line' || item.activityKind !== 'tool_result') {
    return false;
  }

  if (!previousItem || previousItem.kind !== 'activity_line') {
    return false;
  }

  if (
    /^Failed (?:run_command|exec_command)\b/i.test(item.label)
    || /^Blocked command\b/i.test(item.label)
    || /^Blocked verification command\b/i.test(item.label)
  ) {
    return previousItem.activityKind === 'terminal_command';
  }

  if (/^Opened /i.test(item.label) || /^Read /i.test(item.label) || /^Searched /i.test(item.label)) {
    return previousItem.activityKind === 'inspection_group'
      || previousItem.activityKind === 'file_open'
      || previousItem.activityKind === 'file_read'
      || previousItem.activityKind === 'file_search';
  }

  if (/^(?:Created|Updated|Wrote) /i.test(item.label)) {
    return previousItem.activityKind === 'write_group'
      || previousItem.activityKind === 'file_write'
      || previousItem.activityKind === 'mkdir';
  }

  return false;
}

function compactConcreteFollowupToolResults(items: RunTranscriptItem[]) {
  const results: RunTranscriptItem[] = [];

  for (const item of items) {
    const previousItem = results[results.length - 1];
    if (shouldSuppressToolResultAfterConcreteAction(previousItem, item)) {
      continue;
    }
    results.push(item);
  }

  return results;
}

function formatInspectionGroupLabel(items: RunTranscriptActivityItem[]) {
  const uniquePaths = Array.from(
    new Set(
      items
        .map((item) => item.path?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );

  if (uniquePaths.length > 0) {
    return `Inspected ${uniquePaths.length} ${uniquePaths.length === 1 ? 'file' : 'files'}`;
  }

  return `Inspected ${items.length} locations`;
}

function formatInspectionGroupText(items: RunTranscriptActivityItem[]) {
  return items
    .map((item) => item.path ?? item.label ?? item.text)
    .filter((value, index, values): value is string => Boolean(value?.trim()) && values.indexOf(value) === index)
    .join('\n');
}

function formatWriteGroupLabel(items: RunTranscriptActivityItem[]) {
  const fileWrites = items.filter((item) => item.activityKind === 'file_write').length;
  const directories = items.filter((item) => item.activityKind === 'mkdir').length;

  if (fileWrites > 0 && directories > 0) {
    return `Applied ${items.length} filesystem changes`;
  }

  if (fileWrites > 0) {
    return `Updated ${fileWrites} ${fileWrites === 1 ? 'file' : 'files'}`;
  }

  return `Created ${directories} ${directories === 1 ? 'folder' : 'folders'}`;
}

function formatWriteGroupText(items: RunTranscriptActivityItem[]) {
  return items
    .map((item) => item.path ?? item.label ?? item.text)
    .filter((value, index, values): value is string => Boolean(value?.trim()) && values.indexOf(value) === index)
    .join('\n');
}

function compactTranscriptActivityItems(items: RunTranscriptItem[]) {
  const results: RunTranscriptItem[] = [];
  let pendingInspectionItems: RunTranscriptActivityItem[] = [];
  let pendingWriteItems: RunTranscriptActivityItem[] = [];

  const flushInspectionItems = () => {
    if (pendingInspectionItems.length === 0) {
      return;
    }

    if (pendingInspectionItems.length === 1) {
      results.push(pendingInspectionItems[0]);
      pendingInspectionItems = [];
      return;
    }

    const text = formatInspectionGroupText(pendingInspectionItems);
    results.push({
      id: `${pendingInspectionItems[0].id}:inspection-group`,
      kind: 'activity_line',
      activityKind: 'inspection_group',
      toolName: null,
      label: formatInspectionGroupLabel(pendingInspectionItems),
      text,
      url: null,
      path: null,
      command: null,
      cwd: null,
      isolationMode: null,
      status: null,
      outputLines: []
    });
    pendingInspectionItems = [];
  };

  const flushWriteItems = () => {
    if (pendingWriteItems.length === 0) {
      return;
    }

    if (pendingWriteItems.length === 1) {
      results.push(pendingWriteItems[0]);
      pendingWriteItems = [];
      return;
    }

    results.push({
      id: `${pendingWriteItems[0].id}:write-group`,
      kind: 'activity_line',
      activityKind: 'write_group',
      toolName: null,
      label: formatWriteGroupLabel(pendingWriteItems),
      text: formatWriteGroupText(pendingWriteItems),
      url: null,
      path: null,
      command: null,
      cwd: null,
      isolationMode: null,
      status: null,
      outputLines: []
    });
    pendingWriteItems = [];
  };

  for (const item of items) {
    if (isInspectionActivityItem(item)) {
      flushWriteItems();
      pendingInspectionItems.push(item);
      continue;
    }

    if (isWriteActivityItem(item)) {
      flushInspectionItems();
      pendingWriteItems.push(item);
      continue;
    }

    flushInspectionItems();
    flushWriteItems();
    results.push(item);
  }

  flushInspectionItems();
  flushWriteItems();
  return results;
}

function shouldCompactAssistantPreamble(item: RunTranscriptAssistantItem) {
  const text = item.text.trim();
  if (!text || text.length > 180) {
    return false;
  }

  if (!/[.!?…]\s*$/u.test(text)) {
    return false;
  }

  return /^(?:I(?:'|’)?m going to|I will|I(?:'|’)?ll|Let me|Next, I will|Next, I(?:'|’)?ll|First, I will|First, I(?:'|’)?ll)\b/u.test(text);
}

function isOperationalAssistantParagraph(text: string) {
  return /^(?:I(?:'|’)?m going to|I am going to|I will|I(?:'|’)?ll|I will now|I will start by|I(?:'|’)?ll start by|Let me|Next, I will|Next, I(?:'|’)?ll|First, I will|First, I(?:'|’)?ll)\b/u.test(text.trim());
}

function isCompletionStyleAssistantParagraph(text: string) {
  const normalized = text.trim();
  if (!normalized || isOperationalAssistantParagraph(normalized)) {
    return false;
  }

  return /\b(?:complete|completed|done|repaired|updated|added|implemented|fixed|built|ready)\b/i.test(normalized);
}

function isGenericResolutionOutcome(text: string) {
  const normalized = text.trim();
  if (!normalized || normalized.length > 120 || normalized.includes('\n')) {
    return false;
  }

  const wordCount = normalized
    .replace(/[.?!]+$/u, '')
    .split(/\s+/u)
    .filter(Boolean).length;

  if (wordCount > 5) {
    return false;
  }

  return /^(?:Feature slice complete\.|Feature slice implemented\.|Refinement complete\.|Repair complete\.|Build complete\.|Implementation complete\.|Update complete\.|Completed\.)$/iu.test(normalized)
    || /^(?:Built|Implemented|Updated|Fixed|Repaired|Completed) [^.?!]{0,36}[.?!]$/iu.test(normalized);
}

function isConciseResolutionOutcome(text: string) {
  const normalized = text.trim();
  if (!normalized || normalized.length > 140 || normalized.includes('\n')) {
    return false;
  }

  if (isOperationalAssistantParagraph(normalized)) {
    return false;
  }

  if (/^[#*-]\s/u.test(normalized)) {
    return false;
  }

  return /\b(?:complete|completed|done|repaired|updated|added|implemented|fixed|built|created|wired|verified|scaffolded|shipped|resolved|finished)\b/i.test(normalized);
}

function shouldPromoteResolutionOutcome(text: string) {
  return isGenericResolutionOutcome(text) || isConciseResolutionOutcome(text);
}

function collectResolutionFiles(
  items: RunTranscriptItem[],
  changeArtifacts: RunTranscriptChangeArtifactItem[]
) {
  const files: string[] = [];

  for (const artifact of changeArtifacts) {
    for (const file of artifact.artifact.files) {
      appendIfMissing(files, clean(file.path));
    }
  }

  for (const item of items) {
    if (item.kind !== 'activity_line') {
      continue;
    }

    if (item.activityKind === 'file_write' || item.activityKind === 'mkdir' || item.activityKind === 'file_edit') {
      appendIfMissing(files, item.path ?? item.text);
      continue;
    }

    if (item.activityKind === 'write_group') {
      for (const value of item.text.split('\n')) {
        appendIfMissing(files, clean(value));
      }
    }
  }

  return files.filter(Boolean);
}

function collectResolutionVerificationCommands(items: RunTranscriptItem[]) {
  const commands: string[] = [];

  for (const item of items) {
    if (item.kind !== 'activity_line' || item.activityKind !== 'terminal_command' || item.status !== 'completed') {
      continue;
    }

    appendIfMissing(commands, item.command ? clean(item.command) : null);
  }

  return commands.filter(Boolean);
}

function collectResolutionToolsUsed(items: RunTranscriptItem[]) {
  const tools: string[] = [];

  for (const item of items) {
    if (item.kind !== 'activity_line' || (item.activityKind !== 'tool_call' && item.activityKind !== 'tool_result')) {
      continue;
    }

    const mcpToolMatch = /^(?:Calling|Completed)\s+MCP tool\s+(.+)$/iu.exec(item.label.trim());
    if (!mcpToolMatch) {
      continue;
    }

    appendIfMissing(tools, clean(mcpToolMatch[1] ?? ''));
  }

  return tools.filter(Boolean);
}

function matchesRemainingRiskPattern(text: string) {
  const riskPatterns = [
    /^Remaining risk:[\s\S]*$/iu,
    /^No verification commands were run[\s\S]*$/iu,
    /^I did not run[\s\S]*$/iu,
    /^I didn't run[\s\S]*$/iu,
    /^I have not run[\s\S]*$/iu,
    /^I have not verified[\s\S]*$/iu,
    /^I haven't verified[\s\S]*$/iu,
    /^I was not able to run[\s\S]*$/iu,
    /^I wasn't able to run[\s\S]*$/iu,
    /^Verification was not run[\s\S]*$/iu,
    /^(?:Tests|Checks|Verification|Build) (?:were|was) not run[\s\S]*$/iu,
    /^Not (?:yet )?verified[\s\S]*$/iu,
    /^Manual verification[\s\S]*$/iu,
    /^Needs manual verification[\s\S]*$/iu,
    /^This still needs[\s\S]*$/iu,
    /^Still needs[\s\S]*$/iu,
    /^I wasn't able to verify[\s\S]*$/iu,
    /^You(?:'ll| will) (?:still )?(?:want|need) to[\s\S]*$/iu,
    /^You may still want to[\s\S]*$/iu,
    /^Next step:[\s\S]*$/iu,
    /^The only thing left[\s\S]*$/iu,
    /^Pending verification[\s\S]*$/iu
  ];

  return riskPatterns.some((pattern) => pattern.test(text.trim()));
}

function deriveRemainingRisk(outcome: string) {
  const normalized = outcome.trim();
  if (!normalized) {
    return null;
  }

  const paragraphs = splitAssistantParagraphs(normalized);
  const riskParagraph = paragraphs.find((paragraph) => matchesRemainingRiskPattern(paragraph));
  if (riskParagraph) {
    return riskParagraph.trim();
  }

  const candidateSentences = paragraphs.flatMap((paragraph) =>
    paragraph
      .split(/(?<=[.?!])\s+/u)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
  );

  for (const candidate of candidateSentences) {
    if (matchesRemainingRiskPattern(candidate)) {
      return candidate.trim();
    }
  }

  return null;
}

function splitAssistantParagraphs(text: string) {
  return text
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function isSubstantiveResolutionDetailParagraph(text: string) {
  const normalized = text.trim();
  if (!normalized || normalized.length < 24) {
    return false;
  }

  return !isGenericResolutionOutcome(normalized) && !isOperationalAssistantParagraph(normalized);
}

function shouldKeepResolutionDetailParagraph(
  text: string,
  resolutionSummary: RunTranscriptResolutionSummaryItem
) {
  const normalized = text.trim();
  if (!isSubstantiveResolutionDetailParagraph(normalized)) {
    return false;
  }

  const normalizedOutcome = resolutionSummary.outcome.trim();
  if (normalized === normalizedOutcome) {
    return false;
  }

  const normalizedRisk = resolutionSummary.remainingRisk?.trim() ?? null;
  if (!normalizedRisk) {
    return true;
  }

  const trimmedWithoutRisk = normalized.replace(normalizedRisk, '').replace(/\s{2,}/gu, ' ').trim();
  return Boolean(trimmedWithoutRisk) && isSubstantiveResolutionDetailParagraph(trimmedWithoutRisk);
}

function deriveResolutionSummaryItem(
  items: RunTranscriptItem[],
  changeArtifacts: RunTranscriptChangeArtifactItem[],
  runState: 'completed' | 'failed' | 'aborted' | null
) {
  if (runState !== 'completed') {
    return null;
  }

  const assistantItems = items.filter((item): item is RunTranscriptAssistantItem => item.kind === 'assistant_text');
  const finalAssistant = assistantItems.at(-1)?.text.trim() ?? '';
  const assistantParagraphs = splitAssistantParagraphs(finalAssistant);
  const outcome = assistantParagraphs[0] ?? finalAssistant;
  if (!shouldPromoteResolutionOutcome(outcome)) {
    return null;
  }

  const filesChanged = collectResolutionFiles(items, changeArtifacts);
  const toolsUsed = collectResolutionToolsUsed(items);
  const verificationCommands = collectResolutionVerificationCommands(items);
  const remainingRisk = deriveRemainingRisk(finalAssistant);

  if (filesChanged.length === 0 && toolsUsed.length === 0 && verificationCommands.length === 0 && !remainingRisk) {
    return null;
  }

  return {
    id: `resolution-summary:${items.length}`,
    kind: 'resolution_summary' as const,
    outcome,
    filesChanged,
    toolsUsed,
    verificationCommands,
    remainingRisk
  };
}

function compactAssistantDetailAfterResolutionSummary(items: RunTranscriptItem[]) {
  const resolutionSummary = items.find((item): item is RunTranscriptResolutionSummaryItem => item.kind === 'resolution_summary');
  if (!resolutionSummary) {
    return items;
  }

  const results = [...items];
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const item = results[index];
    if (!item || item.kind !== 'assistant_text') {
      continue;
    }

    const paragraphs = splitAssistantParagraphs(item.text);
    if (paragraphs.length === 0 || !shouldPromoteResolutionOutcome(paragraphs[0] ?? '')) {
      break;
    }

    const detailParagraphs = paragraphs
      .slice(1)
      .map((paragraph) => {
        const normalizedRisk = resolutionSummary.remainingRisk?.trim() ?? null;
        if (!normalizedRisk) {
          return paragraph.trim();
        }
        return paragraph.replace(normalizedRisk, '').replace(/\s{2,}/gu, ' ').trim();
      })
      .filter((paragraph) => shouldKeepResolutionDetailParagraph(paragraph, resolutionSummary));
    if (detailParagraphs.length === 0) {
      results.splice(index, 1);
      break;
    }

    results[index] = {
      ...item,
      text: detailParagraphs.join('\n\n')
    };
    break;
  }

  return results;
}

function compactOperationalAssistantNarration(items: RunTranscriptItem[]) {
  return items.map((item, index) => {
    if (item.kind !== 'assistant_text') {
      return item;
    }

    const paragraphs = item.text
      .split(/\n\s*\n/u)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    if (paragraphs.length < 2) {
      return item;
    }

    const completionParagraph = paragraphs.at(-1) ?? '';
    const operationalParagraphs = paragraphs.slice(0, -1);
    if (
      operationalParagraphs.length === 0
      || !isCompletionStyleAssistantParagraph(completionParagraph)
      || !operationalParagraphs.every(isOperationalAssistantParagraph)
    ) {
      return item;
    }

    const hasConcreteWorkBefore = items
      .slice(0, index)
      .some(
        (candidate) =>
          candidate.kind === 'activity_line'
          && candidate.activityKind !== 'thinking'
          && candidate.activityKind !== 'skill'
      );

    if (!hasConcreteWorkBefore) {
      return item;
    }

    return {
      ...item,
      text: completionParagraph
    };
  });
}

function compactAssistantFollowUps(items: RunTranscriptItem[]) {
  const results = [...items];

  for (let index = 0; index < results.length; index += 1) {
    const item = results[index];
    if (!item || item.kind !== 'assistant_text' || !shouldCompactAssistantPreamble(item)) {
      continue;
    }

    let sawWork = false;
    let foundLaterAssistant = false;

    for (let nextIndex = index + 1; nextIndex < results.length; nextIndex += 1) {
      const nextItem = results[nextIndex];
      if (!nextItem) {
        continue;
      }

      if (nextItem.kind === 'assistant_text') {
        foundLaterAssistant = true;
        break;
      }

      if (nextItem.kind === 'change_artifact') {
        continue;
      }

      if (nextItem.kind === 'worked_for' || nextItem.kind === 'activity_line') {
        sawWork = true;
        continue;
      }

      break;
    }

    if (sawWork && foundLaterAssistant) {
      results.splice(index, 1);
      index -= 1;
    }
  }

  return results;
}

function compactGenericThinkingRows(items: RunTranscriptItem[]) {
  return items;
}

function compactOperationalMetaRows(items: RunTranscriptItem[]) {
  const hasResolvedAssistantContent = items.some((item) => item.kind === 'assistant_text' || item.kind === 'resolution_summary');
  if (!hasResolvedAssistantContent) {
    return items;
  }

  return items.filter((item) => {
    if (item.kind !== 'activity_line') {
      return true;
    }

    return item.activityKind !== 'memory_checkpoint' && item.activityKind !== 'delegation';
  });
}

function deriveTerminalCommandStatus(activity: RunActivityInfo) {
  return activity.phase === 'completed' ? 'completed' : activity.phase === 'stopped' ? 'stopped' : 'running';
}

function normalizeTerminalCommandLabel(
  summary: string,
  command: string | null,
  status: TerminalCommandViewModel['status']
) {
  const cleanedSummary = clean(summary)
    .replace(/\s+[·-]\s+Workspace root$/u, '')
    .trim();

  if (
    cleanedSummary.startsWith('Started background terminal with ')
    || cleanedSummary.startsWith('Background terminal running')
    || cleanedSummary.startsWith('Background terminal finished')
    || cleanedSummary.startsWith('Background terminal stopped')
  ) {
    return cleanedSummary.replace(/^Started background terminal with /u, 'Background terminal running with ');
  }

  if (command) {
    return status === 'completed'
      ? `Ran ${command}`
      : status === 'stopped'
        ? `Stopped ${command}`
        : `Running ${command}`;
  }

  return cleanedSummary;
}

function canMergeTerminalCommand(currentCommand: Pick<TerminalCommandViewModel, 'status' | 'command'> | null, activity: RunActivityInfo) {
  return currentCommand && currentCommand.status === 'running' && (activity.command === null || currentCommand.command === null || currentCommand.command === activity.command);
}

function formatElapsed(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt || !finishedAt) {
    return null;
  }

  const durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }

  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${totalSeconds}s`;
  }
  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

const transcriptWordCharClass = `\\p{L}\\p{N}\\p{M}`;
const transcriptContinuationStartPattern = new RegExp(`^[\\p{Ll}\\p{Lm}\\p{Lo}\\p{Nd}\\p{Nl}\\p{Mn}\\p{Mc}]`, 'u');
const transcriptTrailingFragmentPattern = new RegExp(`(^|[^${transcriptWordCharClass}])([${transcriptWordCharClass}][${transcriptWordCharClass}'’_-]{0,23})$`, 'u');

function takeTrailingAssistantFragment(items: RunTranscriptItem[], incomingDelta: string) {
  if (!transcriptContinuationStartPattern.test(incomingDelta)) {
    return '';
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind !== 'assistant_text') {
      continue;
    }

    const match = item.text.match(transcriptTrailingFragmentPattern);
    if (!match) {
      return '';
    }

    const prefix = match[1] ?? '';
    const fragment = match[2] ?? '';
    if (!fragment) {
      return '';
    }

    item.text = item.text.slice(0, item.text.length - fragment.length);
    if (item.text.endsWith(' ') && prefix) {
      item.text = item.text.slice(0, -1);
    }
    if (!item.text.trim()) {
      items.splice(index, 1);
    }
    return fragment;
  }

  return '';
}

function deriveActiveHeading(thinkingLines: ThinkingLineViewModel[], terminalCommands: TerminalCommandViewModel[], state: RunActivityViewModel['state']) {
  if (state !== 'running') {
    return null;
  }

  if (terminalCommands.length > 0) {
    return 'Working' as const;
  }

  if (thinkingLines.some((line) => line.kind === 'file_edit' || line.kind === 'file_write' || line.kind === 'mkdir' || line.kind === 'tool_call' || line.kind === 'tool_result' || line.kind === 'web_search' || line.kind === 'file_open' || line.kind === 'file_read' || line.kind === 'file_search')) {
    return 'Working' as const;
  }

  return 'Thinking' as const;
}

function hasWorkedForEvidence(params: {
  thinkingLines?: ThinkingLineViewModel[];
  terminalCommands?: TerminalCommandViewModel[];
  timelineItems?: RunTranscriptItem[];
  changeArtifact?: RunChangeArtifact | null;
}) {
  if (params.changeArtifact) {
    return true;
  }

  if ((params.terminalCommands?.length ?? 0) > 0) {
    return true;
  }

  if (params.thinkingLines?.some((line) =>
    line.kind === 'tool_call' ||
    line.kind === 'tool_result' ||
    line.kind === 'file_edit' ||
    line.kind === 'file_write' ||
    line.kind === 'mkdir'
  )) {
    return true;
  }

  if (params.timelineItems?.some((item) => item.kind === 'change_artifact' || (item.kind === 'activity_line' && WORKED_FOR_ACTIVITY_KINDS.has(item.activityKind)))) {
    return true;
  }

  return false;
}

function deriveRunActivity(runId: string, events: RunEvent[]): RunActivityViewModel {
  let startedAt: string | null = null;
  let finishedAt: string | null = null;
  let state: RunActivityViewModel['state'] = 'completed';
  const thinkingLines: ThinkingLineViewModel[] = [];
  const terminalCommands: TerminalCommandViewModel[] = [];
  const timelineItems: RunActivityTimelineItem[] = [];
  let currentTerminalCommand: TerminalCommandViewModel | null = null;
  let changeArtifact: RunChangeArtifact | null = null;
  let outcomeMessage: string | null = null;

  for (const event of events) {
    if (event.eventType === 'started') {
      startedAt ??= event.createdAt;
      state = 'running';
      continue;
    }

    if (event.eventType === 'completed') {
      finishedAt = event.createdAt;
      state = 'completed';
      continue;
    }

    if (event.eventType === 'failed') {
      finishedAt = event.createdAt;
      state = 'failed';
      outcomeMessage = readString(event.payload.message);
      continue;
    }

    if (event.eventType === 'aborted') {
      finishedAt = event.createdAt;
      state = 'aborted';
      outcomeMessage = readString(event.payload.message);
      continue;
    }

    if (event.eventType !== 'info') {
      continue;
    }

    const message = sanitizeOperationalMessage(readString(event.payload.message));
    const activity = readActivityInfo(event.payload.activity);
    if (activity?.kind === 'change_summary' && activity.changeArtifact) {
      changeArtifact = activity.changeArtifact;
    }
    if (activity?.kind === 'memory_recall') {
      continue;
    }

    if (activity?.kind === 'thinking' || activity?.kind === 'skill' || activity?.kind === 'memory_checkpoint' || activity?.kind === 'web_search' || activity?.kind === 'delegation' || activity?.kind === 'tool_call' || activity?.kind === 'tool_result' || activity?.kind === 'file_edit' || activity?.kind === 'file_write' || activity?.kind === 'mkdir' || activity?.kind === 'file_open' || activity?.kind === 'file_read' || activity?.kind === 'file_search') {
      const toolCallDisplay = activity.kind === 'tool_call'
        ? deriveFriendlyToolCallDisplay(activity)
        : null;
      const toolResultDisplay = activity.kind === 'tool_result'
        ? deriveToolResultDisplay(activity)
        : null;
      const summary = activity.kind === 'thinking' ? sanitizeOperationalMessage(activity.summary) ?? '' : activity.summary;
      const text = activity.kind === 'thinking'
        ? sanitizeOperationalMessage(activity.text ?? activity.summary) ?? ''
        : (toolCallDisplay?.text ?? toolResultDisplay?.text ?? activity.text ?? activity.summary);
      const line: Omit<ThinkingLineViewModel, 'id'> = {
        kind: activity.kind,
        label: activity.kind === 'thinking' ? summary : (toolCallDisplay?.label ?? toolResultDisplay?.label ?? activity.summary),
        text,
        url: activity.url ?? null,
        path: activity.path ?? null
      };
      appendThinkingLine(thinkingLines, line, event.id);
      const appendedLine = thinkingLines[thinkingLines.length - 1];
      if (appendedLine && appendedLine.id === `${event.id}:${thinkingLines.length - 1}`) {
        timelineItems.push({
          id: `thinking:${appendedLine.id}`,
          kind: 'thinking',
          line: appendedLine
        });
      }
      continue;
    }

    if (activity?.kind === 'terminal_command') {
      const nextStatus = deriveTerminalCommandStatus(activity);

      if (canMergeTerminalCommand(currentTerminalCommand, activity)) {
        currentTerminalCommand.status = nextStatus;
        currentTerminalCommand.label = normalizeTerminalCommandLabel(activity.summary, activity.command ?? currentTerminalCommand.command, nextStatus);
        currentTerminalCommand.command = activity.command ?? currentTerminalCommand.command;
        currentTerminalCommand.cwd = activity.cwd ?? currentTerminalCommand.cwd;
        currentTerminalCommand.isolationMode = activity.isolationMode ?? currentTerminalCommand.isolationMode;
        currentTerminalCommand.finishedAt = nextStatus === 'running' ? null : event.createdAt;
        currentTerminalCommand.durationLabel = nextStatus === 'running'
          ? null
          : formatElapsed(currentTerminalCommand.startedAt, currentTerminalCommand.finishedAt);
        appendLines(currentTerminalCommand.outputLines, activity.outputLines);
        currentTerminalCommand.outputLines = compactTerminalOutput(currentTerminalCommand.command, currentTerminalCommand.outputLines);
        continue;
      }

      currentTerminalCommand = {
        id: event.id,
        label: normalizeTerminalCommandLabel(activity.summary, activity.command ?? null, nextStatus),
        command: activity.command ?? null,
        cwd: activity.cwd ?? null,
        isolationMode: activity.isolationMode ?? null,
        status: nextStatus,
        startedAt: event.createdAt,
        finishedAt: nextStatus === 'running' ? null : event.createdAt,
        durationLabel: null,
        outputLines: compactTerminalOutput(activity.command ?? null, activity.outputLines ? [...activity.outputLines] : [])
      };
      terminalCommands.push(currentTerminalCommand);
      timelineItems.push({
        id: `terminal:${currentTerminalCommand.id}`,
        kind: 'terminal_command',
        command: currentTerminalCommand
      });
      continue;
    }

      if (activity?.kind === 'terminal_output') {
      if (currentTerminalCommand) {
        appendLines(currentTerminalCommand.outputLines, activity.outputLines);
        if (!activity.outputLines?.length) {
          appendIfMissing(currentTerminalCommand.outputLines, activity.text ?? activity.summary);
        }
        currentTerminalCommand.outputLines = compactTerminalOutput(currentTerminalCommand.command, currentTerminalCommand.outputLines);
      }
      continue;
    }

    if (message) {
      const line: Omit<ThinkingLineViewModel, 'id'> = {
        kind: 'thinking',
        label: message,
        text: activity?.text ?? message,
        url: null,
        path: null
      };
      appendThinkingLine(thinkingLines, line, event.id);
      const appendedLine = thinkingLines[thinkingLines.length - 1];
      if (appendedLine && appendedLine.id === `${event.id}:${thinkingLines.length - 1}`) {
        timelineItems.push({
          id: `thinking:${appendedLine.id}`,
          kind: 'thinking',
          line: appendedLine
        });
      }
    }
  }

  return {
    runId,
    state,
    startedAt,
    finishedAt,
    outcomeMessage,
    thinkingLines,
    terminalCommands,
    timelineItems,
    activeHeading: deriveActiveHeading(thinkingLines, terminalCommands, state),
    workedForLabel: hasWorkedForEvidence({ thinkingLines, terminalCommands, changeArtifact })
      ? formatElapsed(startedAt, finishedAt)
      : null,
    changeArtifact
  };
}

export function deriveRunActivityMap(thread: ThreadDetail | null) {
  if (!thread) {
    return {} as Record<string, RunActivityViewModel>;
  }

  const grouped = new Map<string, RunEvent[]>();
  for (const event of thread.rawOutput) {
    const bucket = grouped.get(event.runId) ?? [];
    bucket.push(event);
    grouped.set(event.runId, bucket);
  }

  return Object.fromEntries(Array.from(grouped.entries()).map(([runId, events]) => [runId, deriveRunActivity(runId, events)])) as Record<string, RunActivityViewModel>;
}

function deriveRunTranscriptItems(events: RunEvent[], assistantTurn: ThreadTurn | null = null): RunTranscriptItem[] {
  let items: RunTranscriptItem[] = [];
  const changeArtifacts: RunTranscriptChangeArtifactItem[] = [];
  let assistantBuffer = '';
  let assistantSeed = '';
  let currentTerminalItem: RunTranscriptActivityItem | null = null;
  let startedAt: string | null = null;
  let finishedAt: string | null = null;
  let runState: 'completed' | 'failed' | 'aborted' | null = null;

  const flushAssistant = () => {
    const text = assistantBuffer;
    if (!text) {
      return;
    }

    items.push({
      id: assistantSeed || `assistant:${items.length}`,
      kind: 'assistant_text',
      text,
      sources: assistantTurn?.sources ?? []
    });
    assistantBuffer = '';
    assistantSeed = '';
  };

  for (const event of events) {
    if (event.eventType === 'started') {
      startedAt ??= event.createdAt;
    } else if (event.eventType === 'completed' || event.eventType === 'failed' || event.eventType === 'aborted') {
      finishedAt = event.createdAt;
      runState = event.eventType;
    }

    if (event.eventType === 'delta') {
      const delta = readDelta(event.payload.delta);
      if (delta) {
        if (!assistantBuffer) {
          assistantBuffer = takeTrailingAssistantFragment(items, delta);
        }
        if (!assistantSeed) {
          assistantSeed = event.id;
        }
        assistantBuffer += delta;
      }
      continue;
    }

    if (event.eventType !== 'info') {
      if (event.eventType === 'completed' || event.eventType === 'failed' || event.eventType === 'aborted') {
        continue;
      }

      flushAssistant();
      continue;
    }

    flushAssistant();

    const message = sanitizeOperationalMessage(readString(event.payload.message));
    const activity = readActivityInfo(event.payload.activity);
    if (activity?.kind === 'change_summary' && activity.changeArtifact) {
      changeArtifacts.push({
        id: `changes:${event.id}`,
        kind: 'change_artifact',
        label: activity.summary,
        artifact: activity.changeArtifact
      });
      continue;
    }
    if (activity?.kind === 'memory_recall') {
      continue;
    }
    const activityKind = activity?.kind === 'thinking' || activity?.kind === 'skill' || activity?.kind === 'memory_checkpoint' || activity?.kind === 'web_search' || activity?.kind === 'delegation' || activity?.kind === 'tool_call' || activity?.kind === 'file_edit' || activity?.kind === 'file_write' || activity?.kind === 'mkdir' || activity?.kind === 'file_open' || activity?.kind === 'file_read' || activity?.kind === 'file_search' ? activity.kind : null;
    const toolResultDisplay = activity?.kind === 'tool_result'
      ? deriveToolResultDisplay(activity)
      : null;

    if (activity?.kind === 'terminal_command') {
      const nextStatus = deriveTerminalCommandStatus(activity);

      if (canMergeTerminalCommand(currentTerminalItem, activity)) {
        currentTerminalItem.status = nextStatus;
        currentTerminalItem.label = normalizeTerminalCommandLabel(activity.summary, activity.command ?? currentTerminalItem.command, nextStatus);
        currentTerminalItem.text = normalizeTerminalCommandLabel(activity.summary, activity.command ?? currentTerminalItem.command, nextStatus);
        currentTerminalItem.command = activity.command ?? currentTerminalItem.command;
        currentTerminalItem.cwd = activity.cwd ?? currentTerminalItem.cwd;
        currentTerminalItem.isolationMode = activity.isolationMode ?? currentTerminalItem.isolationMode;
        currentTerminalItem.finishedAt = nextStatus === 'running' ? null : event.createdAt;
        currentTerminalItem.durationLabel = nextStatus === 'running'
          ? null
          : formatElapsed(currentTerminalItem.startedAt, currentTerminalItem.finishedAt);
        appendLines(currentTerminalItem.outputLines, activity.outputLines);
        currentTerminalItem.outputLines = compactTerminalOutput(currentTerminalItem.command, currentTerminalItem.outputLines);
        continue;
      }

      currentTerminalItem = {
        id: event.id,
        kind: 'activity_line',
        activityKind: 'terminal_command',
        toolName: null,
        label: normalizeTerminalCommandLabel(activity.summary, activity.command ?? null, nextStatus),
        text: normalizeTerminalCommandLabel(activity.summary, activity.command ?? null, nextStatus),
        url: null,
        path: null,
        command: activity.command ?? null,
        cwd: activity.cwd ?? null,
        isolationMode: activity.isolationMode ?? null,
        status: nextStatus,
        startedAt: event.createdAt,
        finishedAt: nextStatus === 'running' ? null : event.createdAt,
        durationLabel: null,
        outputLines: compactTerminalOutput(activity.command ?? null, activity.outputLines ? [...activity.outputLines] : [])
      };
      if (
        !hasVisibleTranscriptText(currentTerminalItem.label)
        && !hasVisibleTranscriptText(currentTerminalItem.text)
        && !hasVisibleTranscriptText(currentTerminalItem.command)
        && !hasVisibleTranscriptText(currentTerminalItem.cwd)
        && currentTerminalItem.outputLines.length === 0
      ) {
        currentTerminalItem = null;
        continue;
      }
      items.push(currentTerminalItem);
      continue;
    }

    if (activity?.kind === 'terminal_output') {
      if (currentTerminalItem) {
        appendLines(currentTerminalItem.outputLines, activity.outputLines);
        if (!activity.outputLines?.length) {
          appendIfMissing(currentTerminalItem.outputLines, activity.text ?? activity.summary);
        }
        currentTerminalItem.outputLines = compactTerminalOutput(currentTerminalItem.command, currentTerminalItem.outputLines);
      }
      continue;
    }

    if (activityKind) {
      if (activity?.kind === 'thinking' && shouldSuppressTranscriptThinkingActivity(activity)) {
        continue;
      }

      const toolCallDisplay = activity?.kind === 'tool_call'
        ? deriveFriendlyToolCallDisplay(activity)
        : null;
      const label = activityKind === 'thinking'
        ? sanitizeOperationalMessage(activity?.summary ?? message ?? '') ?? ''
        : (toolCallDisplay?.label ?? activity?.summary ?? message ?? '');
      const text = activityKind === 'thinking'
        ? sanitizeOperationalMessage(activity?.text ?? activity?.summary ?? message ?? '') ?? ''
        : (toolCallDisplay?.text ?? activity?.text ?? activity?.summary ?? message ?? '');
      if (!hasVisibleTranscriptText(label) && !hasVisibleTranscriptText(text) && !activity?.url && !activity?.path) {
        continue;
      }

      items.push({
        id: event.id,
        kind: 'activity_line',
        activityKind,
        toolName: activity?.toolName ?? null,
        label,
        text,
        url: activity?.url ?? null,
        path: activity?.path ?? null,
        command: activity?.command ?? null,
        cwd: activity?.cwd ?? null,
        isolationMode: activity?.isolationMode ?? null,
        status: activityKind === 'terminal_command' ? (activity?.phase === 'completed' ? 'completed' : activity?.phase === 'stopped' ? 'stopped' : 'running') : null,
        startedAt: null,
        finishedAt: null,
        durationLabel: null,
        outputLines: activity?.outputLines ? [...activity.outputLines] : []
      });
      continue;
    }

    if (activity?.kind === 'tool_result') {
      if (shouldSuppressTranscriptToolResult(activity)) {
        continue;
      }

      const label = toolResultDisplay?.label ?? activity.summary;
      const text = toolResultDisplay?.text ?? activity.text ?? activity.summary;
      if (!hasVisibleTranscriptText(label) && !hasVisibleTranscriptText(text) && !activity.url && !activity.path) {
        continue;
      }

      items.push({
        id: event.id,
        kind: 'activity_line',
        activityKind: 'tool_result',
        toolName: activity.toolName ?? null,
        label,
        text,
        url: activity.url ?? null,
        path: activity.path ?? null,
        command: null,
        cwd: null,
        isolationMode: null,
        status: null,
        outputLines: []
      });
      continue;
    }

    if (message) {
      items.push({
        id: event.id,
        kind: 'activity_line',
        activityKind: 'thinking',
        toolName: null,
        label: message,
        text: message,
        url: null,
        path: null,
        command: null,
        cwd: null,
        isolationMode: null,
        status: null,
        outputLines: []
      });
    }
  }

  items = compactRedundantToolCalls(items);
  items = compactTranscriptActivityItems(items);
  items = compactConcreteFollowupToolResults(items);

  const workedForLabel = hasWorkedForEvidence({ timelineItems: items, changeArtifact: changeArtifacts[0]?.artifact ?? null })
    ? formatElapsed(startedAt, finishedAt)
    : null;
  if (workedForLabel) {
    items.push({
      id: `worked-for:${items.length}`,
      kind: 'worked_for',
      label: `Worked for ${workedForLabel}`
    });
  }
  flushAssistant();
  const canonicalAssistantText = assistantTurn?.content.trim() ?? '';
  if (canonicalAssistantText) {
    const lastAssistantIndex = [...items].reverse().findIndex((item) => item.kind === 'assistant_text');
    if (lastAssistantIndex >= 0) {
      const normalizedIndex = items.length - 1 - lastAssistantIndex;
      const currentItem = items[normalizedIndex];
      if (currentItem?.kind === 'assistant_text') {
        items[normalizedIndex] = {
          ...currentItem,
          id: assistantTurn?.id ?? currentItem.id,
          text: canonicalAssistantText,
          sources: assistantTurn?.sources ?? currentItem.sources
        };
      }
    } else {
      items.push({
        id: assistantTurn?.id ?? `assistant:${items.length}`,
        kind: 'assistant_text',
        text: canonicalAssistantText,
        sources: assistantTurn?.sources ?? []
      });
    }
  }
  items = compactOperationalAssistantNarration(items);
  items = compactAssistantFollowUps(items);
  items = compactGenericThinkingRows(items);
  items = compactOperationalMetaRows(items);
  const resolutionSummary = deriveResolutionSummaryItem(items, changeArtifacts, runState);
  if (resolutionSummary) {
    items.push(resolutionSummary);
    items = compactAssistantDetailAfterResolutionSummary(items);
  }
  items.push(...changeArtifacts);
  return items;
}

export function deriveRunTranscriptItemsMap(thread: ThreadDetail | null) {
  if (!thread) {
    return {} as Record<string, RunTranscriptItem[]>;
  }

  const assistantTurnsByRunId = new Map<string, ThreadTurn>();
  for (const turn of thread.turns) {
    if (turn.role !== 'assistant' || typeof turn.runId !== 'string' || !turn.runId.trim()) {
      continue;
    }
    assistantTurnsByRunId.set(turn.runId, turn);
  }

  const grouped = new Map<string, RunEvent[]>();
  for (const event of thread.rawOutput) {
    const bucket = grouped.get(event.runId) ?? [];
    bucket.push(event);
    grouped.set(event.runId, bucket);
  }

  return Object.fromEntries(
    Array.from(grouped.entries()).map(([runId, events]) => [
      runId,
      deriveRunTranscriptItems(events, assistantTurnsByRunId.get(runId) ?? null)
    ])
  ) as Record<string, RunTranscriptItem[]>;
}

export function deriveRunReviewEvidence(
  activity: RunActivityViewModel | null,
  progress: RunProgressState | null
): RunReviewEvidenceViewModel | null {
  if (!activity) {
    return null;
  }

  const thoughtEvidence = activity.state === 'running'
    ? []
    : activity.thinkingLines.filter((line) =>
        line.kind === 'thinking' ||
        line.kind === 'skill' ||
        line.kind === 'memory_recall' ||
        line.kind === 'memory_checkpoint' ||
        line.kind === 'web_search' ||
        line.kind === 'delegation' ||
        line.kind === 'tool_call' ||
        line.kind === 'tool_result'
      );
  const fileEvidence = activity.thinkingLines.filter((line) =>
    line.kind === 'file_edit' ||
    line.kind === 'file_write' ||
    line.kind === 'mkdir' ||
    line.kind === 'file_open' ||
    line.kind === 'file_read' ||
    line.kind === 'file_search'
  );
  const terminalCommands = activity.terminalCommands.filter((command) => command.label.trim().length > 0);
  const changeArtifact = progress?.changeArtifact ?? activity.changeArtifact ?? null;
  const reviewAvailable = progress?.reviewAvailable ?? Boolean(changeArtifact);

  if (
    !reviewAvailable &&
    !changeArtifact &&
    terminalCommands.length === 0 &&
    fileEvidence.length === 0 &&
    thoughtEvidence.length === 0
  ) {
    return null;
  }

  return {
    runId: activity.runId,
    state: activity.state,
    reviewAvailable,
    changeArtifact,
    thoughtEvidence,
    fileEvidence,
    terminalCommands,
    workedForLabel: activity.workedForLabel,
    activity: {
      ...activity,
      terminalCommands
    }
  };
}
