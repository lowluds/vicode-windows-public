import type { RunActivityInfo } from '../shared/domain';
import type { ProviderId, ProviderInfoPayload } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeMultilineText(value: string) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function formatWorkspacePathLabel(value: string | null) {
  if (!value) {
    return null;
  }

  if (value === '.' || value === './' || value === '.\\') {
    return 'Workspace root';
  }

  return value;
}

function collectRecords(value: unknown, depth = 0, maxDepth = 4, results: Record<string, unknown>[] = []) {
  if (depth > maxDepth || !value) {
    return results;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectRecords(entry, depth + 1, maxDepth, results);
    }
    return results;
  }

  if (!isRecord(value)) {
    return results;
  }

  results.push(value);
  for (const entry of Object.values(value)) {
    if (Array.isArray(entry) || isRecord(entry)) {
      collectRecords(entry, depth + 1, maxDepth, results);
    }
  }
  return results;
}

function collectStringsByKeys(
  value: unknown,
  keys: string[],
  depth = 0,
  maxDepth = 4,
  results: string[] = []
): string[] {
  if (depth > maxDepth) {
    return results;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStringsByKeys(entry, keys, depth + 1, maxDepth, results);
    }
    return results;
  }

  if (!isRecord(value)) {
    return results;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && keys.includes(key)) {
      results.push(entry);
      continue;
    }

    if (Array.isArray(entry) || isRecord(entry)) {
      collectStringsByKeys(entry, keys, depth + 1, maxDepth, results);
    }
  }

  return results;
}

function findFirstString(value: unknown, keys: string[]) {
  return (
    collectStringsByKeys(value, keys)
      .map((entry) => normalizeWhitespace(entry))
      .find(Boolean) ?? null
  );
}

function findFirstJoinedStringArrayByKeys(value: unknown, keys: string[], depth = 0, maxDepth = 4): string | null {
  if (depth > maxDepth) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findFirstJoinedStringArrayByKeys(entry, keys, depth + 1, maxDepth);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (keys.includes(key) && Array.isArray(entry) && entry.every((item) => typeof item === 'string')) {
      const normalized = normalizeWhitespace(entry.join(' '));
      if (normalized) {
        return normalized;
      }
    }

    if (Array.isArray(entry) || isRecord(entry)) {
      const nested = findFirstJoinedStringArrayByKeys(entry, keys, depth + 1, maxDepth);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function splitLines(value: string | null, limit = 8) {
  if (!value) {
    return [];
  }

  return value
    .split(/\r?\n/u)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .slice(0, limit);
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function dedupePayloads(items: ProviderInfoPayload[]) {
  const seen = new Set<string>();
  const results: ProviderInfoPayload[] = [];
  for (const item of items) {
    const key =
      typeof item === 'string'
        ? `string:${item}`
        : JSON.stringify({
            message: item.message ?? null,
            activity: item.activity ?? null
          });
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(item);
  }
  return results;
}

function extractContextWindowUsage(
  record: Record<string, unknown>,
  providerEventType: string
): ProviderInfoPayload | null {
  const records = collectRecords(record, 0, 5);

  for (const candidate of records) {
    const usageMetadata = isRecord(candidate.usageMetadata) ? candidate.usageMetadata : null;
    const stats = isRecord(candidate.stats) ? candidate.stats : null;

    const usedTokens =
      readNumber(usageMetadata?.totalTokenCount) ??
      readNumber(stats?.totalTokens) ??
      readNumber(stats?.tokenCount) ??
      readNumber(stats?.tokensUsed) ??
      readNumber(candidate.totalTokens) ??
      readNumber(candidate.tokenCount) ??
      readNumber(candidate.tokensUsed);

    if (!usedTokens || usedTokens <= 0) {
      continue;
    }

    const inputTokens =
      readNumber(usageMetadata?.promptTokenCount) ??
      readNumber(stats?.inputTokens) ??
      readNumber(stats?.inputTokenCount) ??
      readNumber(candidate.inputTokens) ??
      readNumber(candidate.inputTokenCount);

    const outputTokens =
      readNumber(usageMetadata?.candidatesTokenCount) ??
      readNumber(stats?.outputTokens) ??
      readNumber(stats?.outputTokenCount) ??
      readNumber(candidate.outputTokens) ??
      readNumber(candidate.outputTokenCount);

    return {
      contextWindow: {
        usedTokens,
        inputTokens,
        outputTokens,
        providerEventType
      }
    };
  }

  return null;
}

function activity(activity: RunActivityInfo, message?: string | null): ProviderInfoPayload {
  return {
    message: message ?? activity.summary,
    activity
  };
}

function formatToolTitle(toolName: string | null) {
  if (!toolName) {
    return 'tool';
  }

  return toolName.replace(/[_-]+/g, ' ').trim() || toolName;
}

function summarizeToolCall(toolName: string | null, status: string | null) {
  const title = formatToolTitle(toolName);
  if (status === 'completed' || status === 'success') {
    return `Completed ${title}`;
  }
  if (status === 'failed' || status === 'error' || status === 'stopped' || status === 'declined' || status === 'cancelled' || status === 'canceled') {
    return `Failed ${title}`;
  }
  return `Calling ${title}`;
}

function buildToolDetail(values: Array<[string, string | null]>) {
  const lines = values
    .map(([label, value]) => {
      const normalized = value ? normalizeMultilineText(value) : '';
      return normalized ? `${label}: ${normalized}` : null;
    })
    .filter((value): value is string => Boolean(value));

  return lines.length > 0 ? lines.join('\n') : null;
}

type CodexFileChangeKind = 'add' | 'delete' | 'update';

interface CodexFileChangeInfo {
  path: string;
  kind: CodexFileChangeKind;
  movePath: string | null;
}

function extractCodexFileChanges(record: Record<string, unknown>): CodexFileChangeInfo[] {
  const changes = isRecord(record.changes) ? record.changes : null;
  if (!changes) {
    return [];
  }

  return Object.entries(changes)
    .map(([path, rawChange]) => {
      if (!isRecord(rawChange)) {
        return null;
      }

      const explicitType = findFirstString(rawChange, ['type'])?.toLowerCase() ?? null;
      const kind: CodexFileChangeKind | null =
        explicitType === 'add' || explicitType === 'delete' || explicitType === 'update'
          ? explicitType
          : typeof rawChange.unified_diff === 'string'
            ? 'update'
            : typeof rawChange.content === 'string'
              ? 'add'
              : null;

      if (!kind) {
        return null;
      }

      return {
        path: normalizeWhitespace(path),
        kind,
        movePath: findFirstString(rawChange, ['move_path', 'movePath'])
      } satisfies CodexFileChangeInfo;
    })
    .filter((change): change is CodexFileChangeInfo => Boolean(change?.path));
}

function summarizeCodexFileChange(change: CodexFileChangeInfo, succeeded: boolean) {
  if (change.movePath) {
    return succeeded ? `Moved ${change.path} to ${change.movePath}` : `Failed to move ${change.path}`;
  }

  if (change.kind === 'delete') {
    return succeeded ? `Deleted ${change.path}` : `Failed to delete ${change.path}`;
  }

  return succeeded ? `Wrote ${change.path}` : `Failed to write ${change.path}`;
}

function toolActivity(
  kind: 'tool_call' | 'tool_result',
  toolName: string | null,
  status: string | null,
  providerEventType: string,
  text: string | null = null,
  extra: Partial<Pick<RunActivityInfo, 'command' | 'cwd' | 'path' | 'query' | 'url'>> = {}
) {
  return activity({
    kind,
    summary: summarizeToolCall(toolName, kind === 'tool_call' ? null : status),
    toolName,
    status,
    text,
    providerEventType,
    ...extra
  });
}

function describeCommand(command: string | null, cwd: string | null, fallback: string) {
  const normalizedCwd = formatWorkspacePathLabel(cwd);
  if (command && normalizedCwd) {
    return `${command} · ${normalizedCwd}`;
  }
  return command ?? normalizedCwd ?? fallback;
}

function describeSearch(query: string | null, url: string | null, started: boolean) {
  if (query) {
    return `${started ? 'Searching web for' : 'Searched web for'} ${query}`;
  }
  if (url) {
    return `${started ? 'Searching web' : 'Searched web'} ${url}`;
  }
  return started ? 'Searching web' : 'Searched web';
}

function deriveCodexEventPhase(providerEventType: string, status: string) {
  if (
    /(finish|end|complete|completed|success|succeeded)/u.test(providerEventType) ||
    status === 'completed' ||
    status === 'success' ||
    status === 'succeeded'
  ) {
    return 'completed' as const;
  }

  if (
    /(stop|stopped|abort|aborted|fail|failed|error)/u.test(providerEventType) ||
    ['failed', 'error', 'stopped', 'declined', 'cancelled', 'canceled'].includes(status)
  ) {
    return 'stopped' as const;
  }

  return 'started' as const;
}

function reasoningPayload(record: Record<string, unknown>, providerEventType: string): ProviderInfoPayload {
  const reasoningText = findFirstString(record, ['summary', 'reasoning', 'text', 'content', 'message', 'delta']);
  const fullText = reasoningText ? normalizeMultilineText(reasoningText) : '';
  if (!fullText) {
    return activity({
      kind: 'thinking',
      summary: 'Thinking',
      providerEventType
    });
  }

  const lines = fullText.split('\n').filter(Boolean);

  return activity(
    {
      kind: 'thinking',
      summary: lines[0],
      text: fullText,
      providerEventType
    },
    lines[0]
  );
}

function terminalOutputActivity(record: Record<string, unknown>, providerEventType: string) {
  const outputLines = splitLines(findFirstString(record, ['output', 'stdout', 'stderr', 'result', 'response']), 24);
  if (outputLines.length === 0) {
    return null;
  }

  return activity({
    kind: 'terminal_output',
    summary: outputLines[0],
    text: outputLines.join('\n'),
    outputLines,
    providerEventType
  });
}

function summarizeFileWrite(path: string | null, phase: 'started' | 'completed' | 'stopped') {
  const displayPath = formatWorkspacePathLabel(path);
  if (!displayPath) {
    return null;
  }

  return {
    path: displayPath,
    summary:
      phase === 'completed'
        ? `Wrote ${displayPath}`
        : phase === 'stopped'
          ? `Failed to write ${displayPath}`
          : `Writing ${displayPath}`
  };
}

function summarizeDirectoryCreate(path: string | null, phase: 'started' | 'completed' | 'stopped') {
  const displayPath = formatWorkspacePathLabel(path);
  if (!displayPath) {
    return null;
  }

  return {
    path: displayPath,
    summary:
      phase === 'completed'
        ? 'Created folder'
        : phase === 'stopped'
          ? 'Failed to create folder'
          : 'Creating folder'
  };
}

function textPayloads(text: string | null, providerEventType: string) {
  return splitLines(text, 16).map((line) =>
    activity({
      kind: 'thinking',
      summary: line,
      text: line,
      providerEventType
    })
  );
}

function extractSkillLoadName(text: string | null) {
  if (!text) {
    return null;
  }

  const match = normalizeWhitespace(text).match(/^(?:loading|loaded)\s+(?:extension|skill)\s*:\s*(.+)$/iu);
  if (!match) {
    return null;
  }

  return normalizeWhitespace(match[1] ?? '') || null;
}

export function extractCodexCliInfoMessages(payload: unknown): ProviderInfoPayload[] {
  const items: ProviderInfoPayload[] = [];
  const records = collectRecords(payload);

  for (const record of records) {
    const providerEventType = (findFirstString(record, ['type', 'event', 'kind']) ?? '').toLowerCase();
    if (!providerEventType) {
      continue;
    }

    const contextWindow = extractContextWindowUsage(record, providerEventType);
    if (contextWindow) {
      items.push(contextWindow);
    }

    const query = findFirstString(record, ['query', 'searchQuery', 'search_term']);
    const url = findFirstString(record, ['url', 'uri', 'link']);
    const command =
      findFirstString(record, ['command', 'cmd', 'input']) ??
      findFirstJoinedStringArrayByKeys(record, ['command', 'cmd', 'input']);
    const cwd = findFirstString(record, ['cwd', 'directory', 'workingDirectory', 'workdir']);
    const path = findFirstString(record, ['path', 'filePath', 'filepath', 'file_path', 'file', 'dir_path']);
    const toolName = (findFirstString(record, ['toolName', 'tool_name', 'tool', 'name', 'action']) ?? '').toLowerCase();
    const pattern = findFirstString(record, ['pattern', 'glob', 'regex']);
    const status = (findFirstString(record, ['status', 'state', 'phase']) ?? '').toLowerCase();
    const resultText = findFirstString(record, ['aggregated_output', 'formatted_output', 'output', 'stdout', 'stderr', 'result', 'response']);
    const fileChanges = extractCodexFileChanges(record);

    if (providerEventType.includes('web_search_begin')) {
      items.push(
        toolActivity(
          'tool_call',
          'web_search',
          status || 'started',
          providerEventType,
          buildToolDetail([
            ['query', query],
            ['url', url]
          ])
        )
      );
      items.push(
        activity({
          kind: 'web_search',
          phase: 'started',
          summary: describeSearch(query, url, true),
          query,
          url,
          status: status || 'started',
          providerEventType
        })
      );
      continue;
    }

    if (providerEventType.includes('web_search_end')) {
      items.push(
        toolActivity(
          'tool_result',
          'web_search',
          status || 'completed',
          providerEventType,
          buildToolDetail([
            ['query', query],
            ['url', url]
          ])
        )
      );
      items.push(
        activity({
          kind: 'web_search',
          phase: 'completed',
          summary: describeSearch(query, url, false),
          query,
          url,
          status: status || 'completed',
          providerEventType
        })
      );
      if (url) {
        items.push(
          activity({
            kind: 'web_search',
            phase: 'completed',
            summary: url,
            url,
            providerEventType
          })
        );
      }
      continue;
    }

    if (providerEventType.includes('agent_reasoning_raw_content')) {
      items.push(reasoningPayload(record, providerEventType));
      continue;
    }

    if (providerEventType.includes('tool_use') && toolName) {
      items.push(
        toolActivity(
          'tool_call',
          toolName,
          status || 'started',
          providerEventType,
          buildToolDetail([
            ['path', path],
            ['query', query ?? pattern],
            ['command', command],
            ['cwd', cwd],
            ['url', url]
          ])
        )
      );

      if (toolName.includes('write_file')) {
        const fileWrite = summarizeFileWrite(path, 'started');
        if (fileWrite) {
          items.push(
            activity({
              kind: 'file_write',
              summary: fileWrite.summary,
              path: fileWrite.path,
              status: status || 'started',
              providerEventType
            })
          );
        }
      }

      if (toolName.includes('mkdir') || toolName.includes('create_directory')) {
        const directoryCreate = summarizeDirectoryCreate(path, 'started');
        if (directoryCreate) {
          items.push(
            activity({
              kind: 'mkdir',
              summary: directoryCreate.summary,
              path: directoryCreate.path,
              status: status || 'started',
              providerEventType
            })
          );
        }
      }
      continue;
    }

    if (providerEventType.includes('tool_result') && toolName) {
      const phase = deriveCodexEventPhase(providerEventType, status);
      items.push(
        toolActivity(
          'tool_result',
          toolName,
          status || phase,
          providerEventType,
          buildToolDetail([
            ['path', path],
            ['query', query ?? pattern],
            ['command', command],
            ['cwd', cwd],
            ['url', url],
            ['result', resultText]
          ])
        )
      );

      if (toolName.includes('write_file')) {
        const fileWrite = summarizeFileWrite(path, phase);
        if (fileWrite) {
          items.push(
            activity({
              kind: 'file_write',
              summary: fileWrite.summary,
              path: fileWrite.path,
              status: status || phase,
              providerEventType
            })
          );
        }
      }

      if (toolName.includes('mkdir') || toolName.includes('create_directory')) {
        const directoryCreate = summarizeDirectoryCreate(path, phase);
        if (directoryCreate) {
          items.push(
            activity({
              kind: 'mkdir',
              summary: directoryCreate.summary,
              path: directoryCreate.path,
              status: status || phase,
              providerEventType
            })
          );
        }
      }
      continue;
    }

    if (providerEventType.includes('patch_apply_begin')) {
      items.push(
        toolActivity(
          'tool_call',
          'apply_patch',
          status || 'started',
          providerEventType,
          buildToolDetail([
            ['files', fileChanges.map((change) => change.path).join(', ') || null]
          ])
        )
      );
      continue;
    }

    if (providerEventType.includes('patch_apply_end')) {
      const succeeded =
        status === 'completed' ||
        status === 'success' ||
        status === 'succeeded' ||
        record.success === true;
      const normalizedStatus = succeeded ? 'completed' : status || 'failed';
      items.push(
        toolActivity(
          'tool_result',
          'apply_patch',
          normalizedStatus,
          providerEventType,
          buildToolDetail([
            ['files', fileChanges.map((change) => change.path).join(', ') || null],
            ['result', resultText]
          ])
        )
      );
      for (const change of fileChanges) {
        items.push(
          activity({
            kind: 'file_write',
            summary: summarizeCodexFileChange(change, succeeded),
            path: change.path,
            status: normalizedStatus,
            providerEventType
          })
        );
      }
      continue;
    }

    if (providerEventType.includes('read_file')) {
      const phase = deriveCodexEventPhase(providerEventType, status);
      const displayPath = formatWorkspacePathLabel(path);
      items.push(
        toolActivity(
          phase === 'started' ? 'tool_call' : 'tool_result',
          'read_file',
          status || phase,
          providerEventType,
          buildToolDetail([
            ['path', path],
            ['result', resultText]
          ])
        )
      );
      if (displayPath) {
        items.push(
          activity({
            kind: 'file_read',
            summary: `${phase === 'completed' ? 'Read' : phase === 'stopped' ? 'Failed to read' : 'Reading'} ${displayPath}`,
            path: displayPath,
            status: status || phase,
            providerEventType
          })
        );
      }
      continue;
    }

    if (providerEventType.includes('list_directory')) {
      const phase = deriveCodexEventPhase(providerEventType, status);
      const displayPath = formatWorkspacePathLabel(path);
      items.push(
        toolActivity(
          phase === 'started' ? 'tool_call' : 'tool_result',
          'list_directory',
          status || phase,
          providerEventType,
          buildToolDetail([
            ['path', path],
            ['result', resultText]
          ])
        )
      );
      if (displayPath) {
        items.push(
          activity({
            kind: 'file_open',
            summary: `${phase === 'completed' ? 'Opened' : phase === 'stopped' ? 'Failed to open' : 'Opening'} ${displayPath}`,
            path: displayPath,
            status: status || phase,
            providerEventType
          })
        );
      }
      continue;
    }

    if (
      providerEventType.includes('grep')
      || providerEventType.includes('glob')
      || providerEventType.includes('search_file_content')
    ) {
      const phase = deriveCodexEventPhase(providerEventType, status);
      const detail = pattern ?? query ?? path;
      items.push(
        toolActivity(
          phase === 'started' ? 'tool_call' : 'tool_result',
          providerEventType.includes('glob')
            ? 'glob'
            : providerEventType.includes('grep')
              ? 'grep'
              : 'search_file_content',
          status || phase,
          providerEventType,
          buildToolDetail([
            ['query', detail],
            ['path', path],
            ['result', resultText]
          ])
        )
      );
      if (detail) {
        items.push(
          activity({
            kind: 'file_search',
            summary:
              phase === 'completed'
                ? `Searched files for ${detail}`
                : phase === 'stopped'
                  ? `Failed to search files for ${detail}`
                  : `Searching files for ${detail}`,
            query: detail,
            path,
            status: status || phase,
            providerEventType
          })
        );
      }
      continue;
    }

    if (/(terminal_interaction|exec_command|background_terminal|terminal|command|exec)/u.test(providerEventType)) {
      const summaryLabel = describeCommand(command, cwd, 'command');
      const phase =
        /(finish|end|complete|completed|success)/u.test(providerEventType) || status === 'completed' || status === 'success'
          ? 'completed'
          : /(stop|stopped|abort|aborted|fail|failed|error)/u.test(providerEventType) || ['failed', 'error', 'stopped'].includes(status)
            ? 'stopped'
            : 'started';
      items.push(
        toolActivity(
          phase === 'started' ? 'tool_call' : 'tool_result',
          'exec_command',
          status || phase,
          providerEventType,
          buildToolDetail([
            ['command', command],
            ['cwd', cwd]
          ]),
          {
            command,
            cwd
          }
        )
      );
      items.push(
        activity({
          kind: 'terminal_command',
          phase,
          summary:
            phase === 'completed'
              ? `Ran ${summaryLabel}`
              : phase === 'stopped'
                ? `Stopped ${summaryLabel}`
                : `Running ${summaryLabel}`,
          command,
          cwd,
          status: status || phase,
          providerEventType,
          background: providerEventType.includes('background')
        })
      );

      const outputItem = terminalOutputActivity(record, providerEventType);
      if (outputItem) {
        items.push(outputItem);
      }
      continue;
    }
  }

  return dedupePayloads(items);
}

export function extractGeminiCliInfoMessages(payload: unknown): ProviderInfoPayload[] {
  const items: ProviderInfoPayload[] = [];
  const records = collectRecords(payload);

  for (const record of records) {
    const providerEventType = (findFirstString(record, ['type', 'event', 'kind']) ?? '').toLowerCase();
    const role = (findFirstString(record, ['role']) ?? '').toLowerCase();
    const toolName = (findFirstString(record, ['toolName', 'tool_name', 'tool', 'name', 'action']) ?? '').toLowerCase();
    const status = (findFirstString(record, ['status', 'state']) ?? '').toLowerCase();
    const query = findFirstString(record, ['query', 'prompt', 'search_query', 'searchQuery', 'search_term']);
    const url = findFirstString(record, ['url', 'uri', 'link']);
    const command = findFirstString(record, ['command', 'cmd', 'shell_command']);
    const cwd = findFirstString(record, ['cwd', 'directory', 'workingDirectory', 'working_directory', 'workdir']);
    const path = findFirstString(record, ['path', 'filePath', 'filepath', 'file_path', 'file', 'dir_path']);
    const pattern = findFirstString(record, ['pattern', 'glob', 'regex']);
    const backgroundPids = Array.isArray(record.backgroundPids) ? record.backgroundPids : [];
    const resultText = findFirstString(record, ['output', 'result', 'response', 'stdout', 'stderr', 'message', 'text', 'content']);
    const isToolResultLike =
      providerEventType === 'tool_result' ||
      status.includes('success') ||
      status.includes('completed') ||
      status.includes('error') ||
      status.includes('failed');

    const contextWindow = providerEventType ? extractContextWindowUsage(record, providerEventType) : null;
    if (contextWindow) {
      items.push(contextWindow);
    }

    if (providerEventType.includes('reasoning') || providerEventType.includes('thought')) {
      items.push(reasoningPayload(record, providerEventType));
      continue;
    }

    if (providerEventType === 'message' && (role === 'user' || role === 'assistant')) {
      continue;
    }

    if (providerEventType === 'result' || providerEventType === 'init') {
      continue;
    }

    if (toolName.includes('google_web_search') || toolName.includes('web_search') || providerEventType.includes('websearch')) {
      const started = !(status.includes('success') || status.includes('completed'));
      items.push(
        toolActivity(
          started ? 'tool_call' : 'tool_result',
          toolName || 'web_search',
          status || (started ? 'started' : 'completed'),
          providerEventType,
          buildToolDetail([
            ['query', query],
            ['url', url]
          ])
        )
      );
      items.push(
        activity({
          kind: 'web_search',
          phase: started ? 'started' : 'completed',
          summary: describeSearch(query, url, started),
          query,
          url,
          toolName,
          status: status || (started ? 'started' : 'completed'),
          providerEventType
        })
      );
      if (!started && url) {
        items.push(
          activity({
            kind: 'web_search',
            phase: 'completed',
            summary: url,
            url,
            toolName,
            providerEventType
          })
        );
      }
      continue;
    }

    if (toolName.includes('web_fetch')) {
      items.push(
        toolActivity(
          isToolResultLike ? 'tool_result' : 'tool_call',
          toolName,
          status || (isToolResultLike ? 'completed' : 'started'),
          providerEventType,
          buildToolDetail([
            ['url', url],
            ['path', path],
            ['result', resultText]
          ])
        )
      );
      if (url) {
        items.push(
          activity({
            kind: 'file_open',
            summary: `Opened ${url}`,
            url,
            toolName,
            status,
            providerEventType
          })
        );
      }
      continue;
    }

    if (toolName.includes('read_file')) {
      const displayPath = formatWorkspacePathLabel(path);
      items.push(
        toolActivity(
          isToolResultLike ? 'tool_result' : 'tool_call',
          toolName,
          status || (isToolResultLike ? 'completed' : 'started'),
          providerEventType,
          buildToolDetail([
            ['path', path],
            ['result', resultText]
          ])
        )
      );
      if (displayPath) {
        items.push(
          activity({
            kind: 'file_read',
            summary: `Read ${displayPath}`,
            path: displayPath,
            toolName,
            status,
            providerEventType
          })
        );
      }
      continue;
    }

    if (toolName.includes('list_directory')) {
      const displayPath = formatWorkspacePathLabel(path);
      items.push(
        toolActivity(
          isToolResultLike ? 'tool_result' : 'tool_call',
          toolName,
          status || (isToolResultLike ? 'completed' : 'started'),
          providerEventType,
          buildToolDetail([
            ['path', path],
            ['result', resultText]
          ])
        )
      );
      if (displayPath) {
        items.push(
          activity({
            kind: 'file_open',
            summary: `Opened ${displayPath}`,
            path: displayPath,
            toolName,
            status,
            providerEventType
          })
        );
      }
      continue;
    }

    if (toolName.includes('glob') || toolName.includes('grep') || toolName.includes('search_file_content')) {
      const detail = pattern ?? query ?? path;
      items.push(
        toolActivity(
          isToolResultLike ? 'tool_result' : 'tool_call',
          toolName,
          status || (isToolResultLike ? 'completed' : 'started'),
          providerEventType,
          buildToolDetail([
            ['query', detail],
            ['path', path],
            ['result', resultText]
          ])
        )
      );
      if (detail) {
        items.push(
          activity({
            kind: 'file_search',
            summary: `Searched files for ${detail}`,
            query: detail,
            path,
            toolName,
            status,
            providerEventType
          })
        );
      }
      continue;
    }

    if (toolName.includes('write_file')) {
      const phase =
        status.includes('success') || status.includes('completed')
          ? 'completed'
          : status.includes('fail') || status.includes('error')
            ? 'stopped'
            : 'started';
      items.push(
        toolActivity(
          phase === 'started' ? 'tool_call' : 'tool_result',
          toolName,
          status || phase,
          providerEventType,
          buildToolDetail([
            ['path', path],
            ['result', resultText]
          ])
        )
      );
      const fileWrite = summarizeFileWrite(path, phase);
      if (fileWrite) {
        items.push(
          activity({
            kind: 'file_write',
            summary: fileWrite.summary,
            path: fileWrite.path,
            toolName,
            status: status || phase,
            providerEventType
          })
        );
      }
      continue;
    }

    if (toolName.includes('mkdir') || toolName.includes('create_directory')) {
      const phase =
        status.includes('success') || status.includes('completed')
          ? 'completed'
          : status.includes('fail') || status.includes('error')
            ? 'stopped'
            : 'started';
      items.push(
        toolActivity(
          phase === 'started' ? 'tool_call' : 'tool_result',
          toolName,
          status || phase,
          providerEventType,
          buildToolDetail([
            ['path', path],
            ['result', resultText]
          ])
        )
      );
      const directoryCreate = summarizeDirectoryCreate(path, phase);
      if (directoryCreate) {
        items.push(
          activity({
            kind: 'mkdir',
            summary: directoryCreate.summary,
            path: directoryCreate.path,
            toolName,
            status: status || phase,
            providerEventType
          })
        );
      }
      continue;
    }

    if (toolName.includes('run_shell_command') || providerEventType.includes('shell') || providerEventType.includes('command')) {
      const label = describeCommand(command, cwd, 'command');
      const phase =
        backgroundPids.length > 0
          ? 'started'
          : status.includes('success') || status.includes('completed')
            ? 'completed'
            : status.includes('fail') || status.includes('error')
              ? 'stopped'
              : 'started';
      items.push(
        toolActivity(
          phase === 'started' ? 'tool_call' : 'tool_result',
          toolName || 'run_shell_command',
          status || phase,
          providerEventType,
          buildToolDetail([
            ['command', command],
            ['cwd', cwd],
            ['result', resultText]
          ]),
          {
            command,
            cwd
          }
        )
      );

      items.push(
        activity({
          kind: 'terminal_command',
          phase,
          summary:
            backgroundPids.length > 0
              ? `Started background terminal with ${label}`
              : phase === 'completed'
                ? `Ran ${label}`
                : phase === 'stopped'
                  ? `Stopped ${label}`
                  : `Running ${label}`,
          command,
          cwd,
          toolName,
          status: status || phase,
          providerEventType,
          background: backgroundPids.length > 0
        })
      );

      const outputItem = terminalOutputActivity(record, providerEventType);
      if (outputItem) {
        items.push(outputItem);
      }
      continue;
    }

    if (providerEventType === 'tool_use' && toolName) {
      items.push(
        toolActivity(
          'tool_call',
          toolName,
          status || 'started',
          providerEventType,
          buildToolDetail([
            ['query', query],
            ['path', path],
            ['url', url]
          ])
        )
      );
      continue;
    }

    if (toolName.includes('write_file')) {
      const phase = isToolResultLike ? 'completed' : 'started';
      items.push(
        toolActivity(
          isToolResultLike ? 'tool_result' : 'tool_call',
          toolName,
          status || phase,
          providerEventType,
          buildToolDetail([
            ['path', path],
            ['result', resultText]
          ])
        )
      );
      const fileWrite = summarizeFileWrite(path, phase);
      if (fileWrite) {
        items.push(
          activity({
            kind: 'file_write',
            summary: fileWrite.summary,
            path: fileWrite.path,
            toolName,
            status: status || phase,
            providerEventType
          })
        );
      }
      continue;
    }

    if (toolName.includes('mkdir') || toolName.includes('create_directory')) {
      const phase = isToolResultLike ? 'completed' : 'started';
      items.push(
        toolActivity(
          isToolResultLike ? 'tool_result' : 'tool_call',
          toolName,
          status || phase,
          providerEventType,
          buildToolDetail([
            ['path', path],
            ['result', resultText]
          ])
        )
      );
      const directoryCreate = summarizeDirectoryCreate(path, phase);
      if (directoryCreate) {
        items.push(
          activity({
            kind: 'mkdir',
            summary: directoryCreate.summary,
            path: directoryCreate.path,
            toolName,
            status: status || phase,
            providerEventType
          })
        );
      }
      continue;
    }

    if (providerEventType === 'tool_result' && toolName) {
      items.push(
        toolActivity(
          'tool_result',
          toolName,
          status || 'completed',
          providerEventType,
          buildToolDetail([
            ['result', resultText],
            ['path', path],
            ['url', url]
          ])
        )
      );
      continue;
    }

    const skillName = extractSkillLoadName(findFirstString(record, ['message', 'text', 'content', 'delta', 'summary']));
    if (skillName) {
      items.push(
        activity(
          {
            kind: 'skill',
            summary: skillName,
            text: skillName,
            toolName: toolName || null,
            status: status || null,
            providerEventType
          },
          skillName
        )
      );
      continue;
    }

    const extraThinking =
      /(agent_message|output_text|assistant|final_answer|message|result|init|tool_use|tool_result)/u.test(providerEventType)
        ? []
        : textPayloads(findFirstString(record, ['message', 'text', 'content', 'delta', 'summary']), providerEventType);
    if (extraThinking.length > 0) {
      items.push(...extraThinking);
    }
  }

  return dedupePayloads(items);
}

export function extractProviderInfoMessages(providerId: ProviderId, payload: unknown) {
  return providerId === 'openai' ? extractCodexCliInfoMessages(payload) : extractGeminiCliInfoMessages(payload);
}
