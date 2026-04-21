import type { ThreadDetail, ThreadStatus } from '../../shared/domain';

const TERMINAL_RUN_EVENT_TYPES = new Set(['completed', 'failed', 'aborted']);

export function isActiveThreadStatus(status: ThreadStatus) {
  return status === 'queued' || status === 'running' || status === 'stopping';
}

export function deriveCurrentRunId(thread: ThreadDetail | null, activeRunId: string | null) {
  if (activeRunId) {
    return activeRunId;
  }

  if (!thread || !isActiveThreadStatus(thread.status)) {
    return null;
  }

  const latestRunId = [...thread.rawOutput].reverse().find((event) => event.runId)?.runId ?? null;
  if (!latestRunId) {
    return null;
  }

  const hasTerminalEvent = thread.rawOutput.some(
    (event) => event.runId === latestRunId && TERMINAL_RUN_EVENT_TYPES.has(event.eventType)
  );
  if (hasTerminalEvent) {
    return null;
  }

  return latestRunId;
}
