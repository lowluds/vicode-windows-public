import type { RunActivityInfo } from '../../shared/domain';
import type { RunTranscriptActivityItem, RunTranscriptItem } from './run-activity/types';
import { formatVisibleRunErrorMessage } from './error-format';

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
    case 'list_directory':
      return trimmed
        .replace(/^path:\s*/iu, 'Folder: ')
        .replace(/^max entries:\s*/iu, 'Entry limit: ')
        .replace(/^max_entries:\s*/iu, 'Entry limit: ');
    case 'read_file':
      return trimmed.replace(/^path:\s*/iu, 'File: ');
    case 'search_text':
      return trimmed
        .replace(/^query:\s*/iu, 'Search query: ')
        .replace(/^path:\s*/iu, 'Path: ')
        .replace(/^max results:\s*/iu, 'Results limit: ')
        .replace(/^max_results:\s*/iu, 'Results limit: ');
    case 'write_file':
      return trimmed
        .replace(/^path:\s*/iu, 'File: ')
        .replace(/^content:\s*.+$/iu, 'Content: provided');
    case 'apply_patch':
      return trimmed.replace(/^patch:\s*.+$/iu, 'Patch: provided');
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
    case 'browser_preview_check':
      return trimmed
        .replace(/^url:\s*/iu, 'Preview URL: ')
        .replace(/^expected text:\s*/iu, 'Expected text: ')
        .replace(/^console errors:\s*/iu, 'Console errors: ')
        .replace(/^load errors:\s*/iu, 'Load errors: ')
        .replace(/^screenshot:\s*/iu, 'Screenshot: ');
    case 'use_mcp_tool':
      return trimmed
        .replace(/^calling mcp tool\s+/iu, 'Tool: ')
        .replace(/^completed mcp tool\s+/iu, 'Tool: ')
        .replace(/^failed mcp tool\s+/iu, 'Tool: ')
        .replace(/^server:\s*/iu, 'Server: ')
        .replace(/^tool:\s*/iu, 'Tool: ');
    case 'create_skill_bundle':
      return trimmed
        .replace(/^folder_name:\s*/iu, 'Skill folder: ')
        .replace(/^scope:\s*/iu, 'Scope: ')
        .replace(/^files:\s*.+$/iu, 'Files: provided');
    case 'create_plugin_bundle':
      return trimmed
        .replace(/^folder_name:\s*/iu, 'Plugin folder: ')
        .replace(/^scope:\s*/iu, 'Scope: ')
        .replace(/^files:\s*.+$/iu, 'Files: provided');
    case 'spawn_subagents':
      return trimmed.replace(/^tasks:\s*.+$/iu, 'Helpers: provided');
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
    case 'list_directory':
      return 'Listing files';
    case 'read_file':
      return 'Reading file';
    case 'search_text':
      return 'Searching workspace';
    case 'write_file':
      return 'Writing file';
    case 'apply_patch':
      return 'Applying patch';
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
    case 'browser_preview_check':
      return 'Checking preview';
    case 'use_mcp_tool':
      return 'Using MCP tool';
    case 'create_skill_bundle':
      return 'Creating skill';
    case 'create_plugin_bundle':
      return 'Creating plugin';
    case 'spawn_subagents':
      return 'Starting helper agents';
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
    case 'list_directory':
      return isError ? 'Could not list files' : 'Listed files';
    case 'read_file':
      return isError ? 'Could not read file' : 'Read file';
    case 'search_text':
      return isError ? 'Workspace search failed' : 'Searched workspace';
    case 'write_file':
      return isError ? 'Could not write file' : 'Wrote file';
    case 'apply_patch':
      return isError ? 'Could not apply patch' : 'Applied patch';
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
    case 'browser_preview_check':
      return isError ? 'Preview needs attention' : 'Checked preview';
    case 'use_mcp_tool':
      return isError ? 'MCP tool failed' : 'Used MCP tool';
    case 'create_skill_bundle':
      return isError ? 'Could not create skill' : 'Created skill';
    case 'create_plugin_bundle':
      return isError ? 'Could not create plugin' : 'Created plugin';
    case 'spawn_subagents':
      return isError ? 'Could not start helper agents' : 'Started helper agents';
    default:
      return fallback;
  }
}

function isCommandToolName(toolName: string | null) {
  return toolName === 'run_command' || toolName === 'exec_command';
}

function normalizeCommandToolErrorDetail(detail: string) {
  return detail
    .replace(/^run_command requires Full access\./iu, 'Command requires Full access.')
    .replace(/^exec_command requires Full access\./iu, 'Command requires Full access.')
    .replace(/^run_command is disabled for this workspace\./iu, 'Commands are disabled for this workspace.')
    .replace(/^exec_command is disabled for this workspace\./iu, 'Commands are disabled for this workspace.')
    .replace(/^run_command is blocked by this workspace network policy\./iu, 'Command is blocked by this workspace network policy.')
    .replace(/^exec_command is blocked by this workspace network policy\./iu, 'Command is blocked by this workspace network policy.')
    .replace(/^run_command is blocked by runtime launcher policy\./iu, 'Command is blocked by runtime launcher policy.')
    .replace(/^exec_command is blocked by runtime launcher policy\./iu, 'Command is blocked by runtime launcher policy.')
    .replace(/^run_command is blocked by runtime path policy\./iu, 'Command is blocked by runtime path policy.')
    .replace(/^exec_command is blocked by runtime path policy\./iu, 'Command is blocked by runtime path policy.')
    .replace(/^run_command was not approved by the user\./iu, 'Command was not approved by the user.')
    .replace(/^exec_command was not approved by the user\./iu, 'Command was not approved by the user.')
    .replace(/^run_command requires a runtime approval handler/iu, 'Command requires a runtime approval handler')
    .replace(/^exec_command requires a runtime approval handler/iu, 'Command requires a runtime approval handler');
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
  if (activity.kind === 'tool_result' && !isCommandToolName(activity.toolName ?? null)) {
    const rawText = activity.text ?? activity.summary;
    const isError =
      activity.status?.toLowerCase() === 'error' || activity.status?.toLowerCase() === 'failed';
    const text =
      isError
        ? formatVisibleRunErrorMessage(rawText)
        : normalizeFriendlyToolDetailText(
          activity.toolName ?? null,
          rawText
        ) ?? activity.summary;
    const fallbackLabel = isError && text !== rawText ? text : activity.summary;
    return {
      label: formatFriendlyToolResultLabel(
        activity.toolName ?? null,
        activity.status ?? null,
        fallbackLabel
      ),
      text
    };
  }

  if (
    activity.kind !== 'tool_result' ||
    !isCommandToolName(activity.toolName ?? null) ||
    activity.status !== 'error'
  ) {
    return {
      label: activity.summary,
      text: activity.text ?? activity.summary
    };
  }

  const detail = activity.text ?? activity.summary;
  const friendlyDetail = normalizeCommandToolErrorDetail(detail);
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
  if (/^(?:run_command|exec_command) requires Full access\./iu.test(detail)) {
    return {
      label: `${blockedPrefix}: Full access required`,
      text: friendlyDetail
    };
  }
  if (/^(?:run_command|exec_command) is disabled for this workspace\./iu.test(detail)) {
    return {
      label: `${blockedPrefix}: workspace commands disabled`,
      text: friendlyDetail
    };
  }
  if (
    detail.startsWith(
      `${activity.toolName} is blocked by this workspace network policy.`
    )
  ) {
    return {
      label: `${blockedPrefix}: workspace network blocked`,
      text: friendlyDetail
    };
  }
  if (
    detail.startsWith(
      `${activity.toolName} is blocked by runtime launcher policy. Nested shell launchers`
    )
  ) {
    return {
      label: `${blockedPrefix}: nested shell launcher`,
      text: friendlyDetail
    };
  }
  if (
    detail.startsWith(
      `${activity.toolName} is blocked by runtime launcher policy. Inline interpreter commands`
    )
  ) {
    return {
      label: `${blockedPrefix}: inline interpreter`,
      text: friendlyDetail
    };
  }
  if (
    detail.startsWith(
      `${activity.toolName} is blocked by runtime launcher policy. Remote shell commands`
    )
  ) {
    return {
      label: `${blockedPrefix}: remote shell launcher`,
      text: friendlyDetail
    };
  }
  if (
    detail.startsWith(
      `${activity.toolName} is blocked by runtime path policy. The command references an absolute path outside the workspace`
    )
  ) {
    return {
      label: `${blockedPrefix}: outside workspace path`,
      text: friendlyDetail
    };
  }
  if (
    detail.startsWith(
      `${activity.toolName} is blocked by runtime path policy. The command references a relative path that resolves outside the workspace`
    )
  ) {
    return {
      label: `${blockedPrefix}: path escape`,
      text: friendlyDetail
    };
  }
  if (/^(?:run_command|exec_command) was not approved by the user\./iu.test(detail)) {
    return {
      label: isVerificationCommand
        ? 'Verification command denied'
        : 'Command denied',
      text: friendlyDetail
    };
  }
  if (/^(?:run_command|exec_command) requires a runtime approval handler/iu.test(detail)) {
    return {
      label: `${blockedPrefix}: approval unavailable`,
      text: friendlyDetail
    };
  }

  return {
    label: 'Command failed',
    text: friendlyDetail
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

function shouldSuppressToolResultBeforeConcreteAction(
  toolResultItem: RunTranscriptActivityItem,
  nextItem: RunTranscriptItem | undefined
) {
  if (!nextItem || nextItem.kind !== 'activity_line') {
    return false;
  }

  switch (toolResultItem.toolName) {
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
    if (
      item?.kind === 'activity_line' &&
      item.activityKind === 'tool_result' &&
      shouldSuppressToolResultBeforeConcreteAction(item, items[index + 1])
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
    /^Command failed\b/i.test(item.label) ||
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
