import type { RunEvent, RunProgressState, ThreadDetail, ThreadSummary } from '../../shared/domain';
import { appendRunEvent } from './thread-presentation';
import { applyLiveRunDelta, replaceLiveRunText } from './live-run-thread-state';

export interface PendingLiveRunDelta {
  threadId: string;
  runId: string;
  delta: string;
}

export function queuePendingLiveRunDelta(
  pending: Map<string, PendingLiveRunDelta>,
  threadId: string,
  runId: string,
  delta: string
) {
  const key = `${threadId}:${runId}`;
  const current = pending.get(key);
  pending.set(key, {
    threadId,
    runId,
    delta: `${current?.delta ?? ''}${delta}`
  });
}

export function applyPendingLiveRunDeltas(
  thread: ThreadDetail | null,
  pending: PendingLiveRunDelta[],
  createdAt: string
) {
  if (!thread) {
    return thread;
  }

  let next = thread;
  for (const entry of pending) {
    if (entry.threadId !== next.id) {
      continue;
    }

    next = applyLiveRunDelta(next, {
      threadId: entry.threadId,
      runId: entry.runId,
      delta: entry.delta,
      createdAt
    });
  }

  return next;
}

export function applyThreadSummaryToActiveThread(
  thread: ThreadDetail | null,
  summary: ThreadSummary
) {
  if (!thread) {
    return thread;
  }

  return {
    ...thread,
    ...summary,
    turns: thread.turns,
    rawOutput: thread.rawOutput,
    planner: thread.planner
  };
}

export function applyRunStartedToThread(
  thread: ThreadDetail | null,
  input: { threadId: string; runId: string },
  createdAt: string
) {
  if (!thread) {
    return thread;
  }

  return {
    ...thread,
    status: 'running',
    rawOutput: appendRunEvent(thread.rawOutput, {
      id: `${input.runId}:started:${thread.rawOutput.length}`,
      threadId: input.threadId,
      runId: input.runId,
      eventType: 'started',
      payload: {},
      createdAt
    })
  };
}

export function applyRunReplaceToThread(
  thread: ThreadDetail | null,
  input: { threadId: string; runId: string; text: string },
  createdAt: string
) {
  if (!thread) {
    return thread;
  }

  return replaceLiveRunText(thread, {
    threadId: input.threadId,
    runId: input.runId,
    text: input.text,
    createdAt
  });
}

export function applyRawRunEventToThread(
  thread: ThreadDetail | null,
  event: RunEvent
) {
  if (!thread) {
    return thread;
  }

  return {
    ...thread,
    rawOutput: appendRunEvent(thread.rawOutput, event)
  };
}

export function clearRunProgressEntry(
  runProgressByRunId: Record<string, RunProgressState>,
  runId: string
) {
  if (!(runId in runProgressByRunId)) {
    return runProgressByRunId;
  }

  const next = { ...runProgressByRunId };
  delete next[runId];
  return next;
}
