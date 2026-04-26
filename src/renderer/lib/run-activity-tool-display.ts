import type { RunActivityInfo } from '../../shared/domain';
import type { RunTranscriptActivityItem, RunTranscriptItem } from './run-activity';

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
        .replace(
          /^same origin only:\s*(true|false)$/iu,
          (_match, value: string) =>
            `Stay on one site: ${formatYesNo(value.toLowerCase() === 'true')}`
        );
    case 'mkdir':
    case 'create_directory':
      return trimmed.replace(/^path:\s*/iu, 'Folder: ');
    default:
      return trimmed;
  }
}

function normalizeFriendlyToolDetailText(
  toolName: string | null,
  text: string | null | undefined
) {
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

function formatFriendlyToolResultLabel(
  toolName: string | null,
  status: string | null,
  fallback: string
) {
  const isError =
    status?.toLowerCase() === 'error' ||
    status?.toLowerCase() === 'failed' ||
    status?.toLowerCase() === 'stopped';

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

export function deriveFriendlyToolCallDisplay(
  activity: Extract<RunActivityInfo, { kind: 'tool_call' }>
) {
  return {
    label: formatFriendlyToolCallLabel(activity.toolName ?? null, activity.summary),
    text:
      normalizeFriendlyToolDetailText(
        activity.toolName ?? null,
        activity.text ?? activity.summary
      ) ?? activity.summary
  };
}

export function deriveToolResultDisplay(activity: RunActivityInfo) {
  if (activity.kind === 'tool_result' && activity.toolName !== 'run_command') {
    return {
      label: formatFriendlyToolResultLabel(
        activity.toolName ?? null,
        activity.status ?? null,
        activity.summary
      ),
      text:
        normalizeFriendlyToolDetailText(
          activity.toolName ?? null,
          activity.text ?? activity.summary
        ) ?? activity.summary
    };
  }

  if (
    activity.kind !== 'tool_result' ||
    activity.toolName !== 'run_command' ||
    activity.status !== 'error'
  ) {
    return {
      label: activity.summary,
      text: activity.text ?? activity.summary
    };
  }

  const detail = activity.text ?? activity.summary;
  const command = clean(activity.command ?? '');
  const isVerificationCommand =
    /^(?:npm|pnpm|yarn|bun|npx|vite|vitest|playwright|pytest|cargo|go|dotnet|python\b.*-m\s+pytest\b)/iu.test(
      command
    ) &&
    /\b(?:build|test|check|verify|preview|lint|typecheck|pytest|vitest|playwright)\b/iu.test(
      command
    );
  const blockedPrefix = isVerificationCommand
    ? 'Blocked verification command'
    : 'Blocked command';
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
  if (
    detail.startsWith(
      'run_command is blocked by this workspace network policy.'
    )
  ) {
    return {
      label: `${blockedPrefix}: workspace network blocked`,
      text: detail
    };
  }
  if (
    detail.startsWith(
      'run_command is blocked by runtime launcher policy. Nested shell launchers'
    )
  ) {
    return {
      label: `${blockedPrefix}: nested shell launcher`,
      text: detail
    };
  }
  if (
    detail.startsWith(
      'run_command is blocked by runtime launcher policy. Inline interpreter commands'
    )
  ) {
    return {
      label: `${blockedPrefix}: inline interpreter`,
      text: detail
    };
  }
  if (
    detail.startsWith(
      'run_command is blocked by runtime launcher policy. Remote shell commands'
    )
  ) {
    return {
      label: `${blockedPrefix}: remote shell launcher`,
      text: detail
    };
  }
  if (
    detail.startsWith(
      'run_command is blocked by runtime path policy. The command references an absolute path outside the workspace'
    )
  ) {
    return {
      label: `${blockedPrefix}: outside workspace path`,
      text: detail
    };
  }
  if (
    detail.startsWith(
      'run_command is blocked by runtime path policy. The command references a relative path that resolves outside the workspace'
    )
  ) {
    return {
      label: `${blockedPrefix}: path escape`,
      text: detail
    };
  }
  if (detail.startsWith('run_command was not approved by the user.')) {
    return {
      label: isVerificationCommand
        ? 'Verification command denied'
        : 'Command denied',
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

function shouldSuppressToolCallBeforeConcreteAction(
  toolCallItem: RunTranscriptActivityItem,
  nextItem: RunTranscriptItem | undefined
) {
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
      return (
        nextItem.activityKind === 'file_open' ||
        nextItem.activityKind === 'file_read' ||
        nextItem.activityKind === 'file_search' ||
        nextItem.activityKind === 'inspection_group'
      );
    case 'write_file':
    case 'mkdir':
    case 'create_directory':
      return (
        nextItem.activityKind === 'file_write' ||
        nextItem.activityKind === 'mkdir' ||
        nextItem.activityKind === 'write_group'
      );
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

export function compactRedundantToolCalls(items: RunTranscriptItem[]) {
  const results: RunTranscriptItem[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (
      item?.kind === 'activity_line' &&
      item.activityKind === 'tool_call' &&
      shouldSuppressToolCallBeforeConcreteAction(item, items[index + 1])
    ) {
      continue;
    }

    if (item) {
      results.push(item);
    }
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
    /^Failed (?:run_command|exec_command)\b/i.test(item.label) ||
    /^Blocked command\b/i.test(item.label) ||
    /^Blocked verification command\b/i.test(item.label)
  ) {
    return previousItem.activityKind === 'terminal_command';
  }

  if (
    /^Opened /i.test(item.label) ||
    /^Read /i.test(item.label) ||
    /^Searched /i.test(item.label)
  ) {
    return (
      previousItem.activityKind === 'inspection_group' ||
      previousItem.activityKind === 'file_open' ||
      previousItem.activityKind === 'file_read' ||
      previousItem.activityKind === 'file_search'
    );
  }

  if (/^(?:Created|Updated|Wrote) /i.test(item.label)) {
    return (
      previousItem.activityKind === 'write_group' ||
      previousItem.activityKind === 'file_write' ||
      previousItem.activityKind === 'mkdir'
    );
  }

  return false;
}

export function compactConcreteFollowupToolResults(items: RunTranscriptItem[]) {
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
