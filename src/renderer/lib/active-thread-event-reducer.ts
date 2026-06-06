import type { ThreadDetail } from '../../shared/domain';
import {
  applyPendingLiveRunDeltas,
  queuePendingLiveRunDelta,
  type PendingLiveRunDelta
} from './thread-live-event-reducer';

export interface ActiveThreadEventBuffer {
  activeThreadId: string | null;
  pendingDeltas: Map<string, PendingLiveRunDelta>;
}

export function createActiveThreadEventBuffer(activeThreadId: string | null = null): ActiveThreadEventBuffer {
  return {
    activeThreadId,
    pendingDeltas: new Map()
  };
}

export function setActiveThreadEventBufferThread(
  buffer: ActiveThreadEventBuffer,
  activeThreadId: string | null
) {
  if (buffer.activeThreadId === activeThreadId) {
    return false;
  }

  buffer.activeThreadId = activeThreadId;
  buffer.pendingDeltas.clear();
  return true;
}

export function clearActiveThreadEventBuffer(buffer: ActiveThreadEventBuffer) {
  buffer.pendingDeltas.clear();
}

export function hasActiveThreadDeltas(buffer: ActiveThreadEventBuffer) {
  return buffer.pendingDeltas.size > 0;
}

export function queueActiveThreadDelta(
  buffer: ActiveThreadEventBuffer,
  input: PendingLiveRunDelta
) {
  if (!buffer.activeThreadId || input.threadId !== buffer.activeThreadId) {
    return false;
  }

  queuePendingLiveRunDelta(buffer.pendingDeltas, input.threadId, input.runId, input.delta);
  return true;
}

export function drainActiveThreadDeltas(buffer: ActiveThreadEventBuffer) {
  if (buffer.pendingDeltas.size === 0) {
    return [];
  }

  const activeThreadId = buffer.activeThreadId;
  const pending = Array.from(buffer.pendingDeltas.values())
    .filter((entry) => entry.threadId === activeThreadId);
  buffer.pendingDeltas.clear();
  return pending;
}

export function applyActiveThreadDeltas(
  thread: ThreadDetail | null,
  pending: PendingLiveRunDelta[],
  createdAt: string
) {
  return applyPendingLiveRunDeltas(thread, pending, createdAt);
}

export function flushActiveThreadDeltas(
  thread: ThreadDetail | null,
  buffer: ActiveThreadEventBuffer,
  createdAt: string
) {
  return applyActiveThreadDeltas(thread, drainActiveThreadDeltas(buffer), createdAt);
}
