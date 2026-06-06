import type {
  RunActivityViewModel,
  TerminalCommandViewModel,
  ThinkingLineViewModel
} from './types';

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

export function appendThinkingLine(
  target: ThinkingLineViewModel[],
  entry: Omit<ThinkingLineViewModel, 'id'>,
  seed: string
) {
  const label = clean(entry.label);
  const text = cleanMultiline(entry.text);
  if (!label) {
    return;
  }

  const previous = target[target.length - 1];
  if (
    previous
    && previous.label === label
    && previous.text === text
    && previous.url === (entry.url ?? null)
    && previous.path === (entry.path ?? null)
    && previous.kind === entry.kind
  ) {
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

export function deriveActiveHeading(
  thinkingLines: ThinkingLineViewModel[],
  terminalCommands: TerminalCommandViewModel[],
  state: RunActivityViewModel['state']
) {
  if (state !== 'running') {
    return null;
  }

  if (terminalCommands.length > 0) {
    return 'Working' as const;
  }

  if (thinkingLines.some((line) => line.kind === 'guidance' || line.kind === 'file_edit' || line.kind === 'file_write' || line.kind === 'mkdir' || line.kind === 'tool_call' || line.kind === 'tool_result' || line.kind === 'web_search' || line.kind === 'file_open' || line.kind === 'file_read' || line.kind === 'file_search')) {
    return 'Working' as const;
  }

  return 'Thinking' as const;
}
