import type { RunChangeArtifact } from '../../../shared/domain';
import type {
  RunTranscriptActivityItem,
  RunTranscriptItem,
  TerminalCommandViewModel,
  ThinkingLineViewModel
} from './types';

const WORKED_FOR_ACTIVITY_KINDS = new Set<RunTranscriptActivityItem['activityKind']>([
  'tool_call',
  'tool_result',
  'file_edit',
  'file_write',
  'mkdir',
  'terminal_command',
  'write_group'
]);

export function formatElapsed(startedAt: string | null, finishedAt: string | null) {
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

export function hasWorkedForEvidence(params: {
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
