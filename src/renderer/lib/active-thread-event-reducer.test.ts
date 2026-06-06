import { describe, expect, it } from 'vitest';
import type { ThreadDetail } from '../../shared/domain';
import {
  clearActiveThreadEventBuffer,
  createActiveThreadEventBuffer,
  drainActiveThreadDeltas,
  flushActiveThreadDeltas,
  queueActiveThreadDelta,
  setActiveThreadEventBufferThread
} from './active-thread-event-reducer';

function createThread(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Streaming thread',
    providerId: 'openai',
    modelId: 'gpt-5.4',
    executionPermission: 'default',
    status: 'running',
    archived: false,
    lastMessageAt: '2026-04-21T12:00:00.000Z',
    createdAt: '2026-04-21T12:00:00.000Z',
    updatedAt: '2026-04-21T12:00:00.000Z',
    lastPreview: 'Working...',
    turns: [],
    rawOutput: [],
    planner: {
      threadId: 'thread-1',
      composerMode: 'default',
      turnState: 'idle',
      activePlanId: null,
      pendingQuestionCallId: null,
      updatedAt: '2026-04-21T12:00:00.000Z',
      activePlan: null,
      pendingQuestionSet: null
    },
    followUps: [],
    ...overrides
  };
}

describe('active thread event buffer', () => {
  it('merges duplicate live deltas for the same run before flushing', () => {
    const buffer = createActiveThreadEventBuffer('thread-1');

    expect(queueActiveThreadDelta(buffer, { threadId: 'thread-1', runId: 'run-1', delta: 'Hel' })).toBe(true);
    expect(queueActiveThreadDelta(buffer, { threadId: 'thread-1', runId: 'run-1', delta: 'lo' })).toBe(true);

    const pending = drainActiveThreadDeltas(buffer);
    expect(pending).toEqual([
      {
        threadId: 'thread-1',
        runId: 'run-1',
        delta: 'Hello'
      }
    ]);
    expect(drainActiveThreadDeltas(buffer)).toEqual([]);
  });

  it('ignores out-of-order deltas for inactive threads', () => {
    const buffer = createActiveThreadEventBuffer('thread-1');

    expect(queueActiveThreadDelta(buffer, { threadId: 'thread-2', runId: 'run-2', delta: 'stale' })).toBe(false);
    expect(queueActiveThreadDelta(buffer, { threadId: 'thread-1', runId: 'run-1', delta: 'live' })).toBe(true);

    expect(drainActiveThreadDeltas(buffer)).toEqual([
      {
        threadId: 'thread-1',
        runId: 'run-1',
        delta: 'live'
      }
    ]);
  });

  it('clears pending deltas on thread switches', () => {
    const buffer = createActiveThreadEventBuffer('thread-1');
    queueActiveThreadDelta(buffer, { threadId: 'thread-1', runId: 'run-1', delta: 'pending' });

    expect(setActiveThreadEventBufferThread(buffer, 'thread-2')).toBe(true);

    expect(buffer.activeThreadId).toBe('thread-2');
    expect(drainActiveThreadDeltas(buffer)).toEqual([]);
  });

  it('flushes run completion deltas once into the active thread state', () => {
    const buffer = createActiveThreadEventBuffer('thread-1');
    queueActiveThreadDelta(buffer, { threadId: 'thread-1', runId: 'run-1', delta: 'Done' });

    const firstFlush = flushActiveThreadDeltas(
      createThread(),
      buffer,
      '2026-04-21T12:00:01.000Z'
    );
    const secondFlush = flushActiveThreadDeltas(
      firstFlush,
      buffer,
      '2026-04-21T12:00:02.000Z'
    );

    expect(firstFlush?.turns.at(-1)?.content).toBe('Done');
    expect(firstFlush?.rawOutput).toHaveLength(1);
    expect(secondFlush).toBe(firstFlush);
  });

  it('allows explicit cleanup without changing the active thread id', () => {
    const buffer = createActiveThreadEventBuffer('thread-1');
    queueActiveThreadDelta(buffer, { threadId: 'thread-1', runId: 'run-1', delta: 'pending' });

    clearActiveThreadEventBuffer(buffer);

    expect(buffer.activeThreadId).toBe('thread-1');
    expect(drainActiveThreadDeltas(buffer)).toEqual([]);
  });
});

