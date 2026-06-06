import type { RunTranscriptItem } from '../lib/run-activity';
import type { ToolState } from './ai-elements/tool';

function stripTrailingSourcesFooter(source: string) {
  return source.replace(/\n{2,}Sources:\s*\n(?:\s*-\s*https?:\/\/\S+\s*\n?)+$/iu, '').trim();
}

export function sanitizeAssistantContent(source: string, hasStructuredSources = false) {
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
export function formatIsolationMode(value: string | null) {
  if (value === 'host_job_object_temp_profile') {
    return 'Host Job Object temp profile';
  }

  if (value === 'host_isolated_temp_profile') {
    return 'Host isolated temp profile';
  }

  return value;
}

export function getTerminalPreviewLines(lines: string[], count = 2) {
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

export function formatTerminalSummaryLabel(item: {
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

export function terminalToolState(status: Extract<RunTranscriptItem, { kind: 'activity_line'; activityKind: 'terminal_command' }>['status']): ToolState {
  if (status === 'running') {
    return 'input-available';
  }

  if (status === 'stopped') {
    return 'output-error';
  }

  return 'output-available';
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

export function formatWorkingForLabel(startedAt: string | null | undefined, elapsedSeconds: number) {
  if (!startedAt) {
    return 'Working';
  }

  return `Working for ${formatElapsedSeconds(elapsedSeconds)}`;
}
