import type { RunActivityInfo } from '../../../shared/domain';
import type { TerminalCommandViewModel } from './types';

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export const nodeInternalStackLinePattern = /^\s*at .*(?:\((?:node:)?internal[/:].+\)|\((?:node:)?diagnostics_channel:.+\)|(?:node:)?internal[/:].+|(?:node:)?diagnostics_channel:.+)$/u;
export const terminalControlSequencePattern =
  /(?:\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b\[[0-?]*[ -/]*[@-~]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F])/gu;
export const terminalTimestampPattern =
  /(?:\[[0-9]{4}-[0-9]{2}-[0-9]{2}T[^\]]+\]|(?:^|\s)[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-]+Z(?=\s|$))/gu;

export function sanitizeTerminalOutputLine(value: string) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.replace(terminalControlSequencePattern, '').trimEnd())
    .filter((line) => line.trim().length > 0 && !nodeInternalStackLinePattern.test(line.trim()))
    .join('\n')
    .trimEnd();
}

export function sanitizeTerminalOutputLines(values: string[] | null) {
  if (!values) {
    return null;
  }

  return values.map(sanitizeTerminalOutputLine).filter(Boolean);
}

export function appendIfMissing(target: string[], value: string | null) {
  if (!value) {
    return;
  }
  if (!target.includes(value)) {
    target.push(value);
  }
}

export function appendLines(target: string[], values: string[] | null | undefined) {
  if (!values || values.length === 0) {
    return;
  }
  for (const value of values) {
    if (target[target.length - 1] !== value) {
      target.push(value);
    }
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

export function compactTerminalOutput(command: string | null, values: string[]) {
  return stripLeadingTerminalCommandEcho(command, values);
}

export function deriveTerminalCommandStatus(activity: RunActivityInfo) {
  return activity.phase === 'completed' ? 'completed' : activity.phase === 'stopped' ? 'stopped' : 'running';
}

export function normalizeTerminalCommandLabel(
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

export function canMergeTerminalCommand(
  currentCommand: Pick<TerminalCommandViewModel, 'status' | 'command'> | null,
  activity: RunActivityInfo
) {
  return currentCommand
    && currentCommand.status === 'running'
    && (activity.command === null || currentCommand.command === null || currentCommand.command === activity.command);
}
