import { describe, expect, it } from 'vitest';
import type { ThreadDetail } from '../../shared/domain';
import { applyLiveRunDelta, replaceLiveRunText } from './live-run-thread-state';

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

describe('applyLiveRunDelta', () => {
  it('creates an assistant turn and a synthetic delta event for the first live chunk', () => {
    const result = applyLiveRunDelta(createThread(), {
      threadId: 'thread-1',
      runId: 'run-1',
      delta: 'Hello',
      createdAt: '2026-04-21T12:00:01.000Z'
    });

    expect(result.turns.at(-1)).toEqual(
      expect.objectContaining({
        id: 'run-1-assistant',
        role: 'assistant',
        runId: 'run-1',
        content: 'Hello'
      })
    );
    expect(result.rawOutput).toEqual([
      expect.objectContaining({
        id: 'run-1:delta:0',
        runId: 'run-1',
        eventType: 'delta',
        payload: { delta: 'Hello' }
      })
    ]);
  });

  it('merges adjacent live deltas into the trailing synthetic event for the same run', () => {
    const first = applyLiveRunDelta(createThread(), {
      threadId: 'thread-1',
      runId: 'run-1',
      delta: 'Hello',
      createdAt: '2026-04-21T12:00:01.000Z'
    });
    const second = applyLiveRunDelta(first, {
      threadId: 'thread-1',
      runId: 'run-1',
      delta: ' world',
      createdAt: '2026-04-21T12:00:02.000Z'
    });

    expect(second.turns.at(-1)?.content).toBe('Hello world');
    expect(second.rawOutput).toHaveLength(1);
    expect(second.rawOutput[0]).toEqual(
      expect.objectContaining({
        id: 'run-1:delta:0',
        payload: { delta: 'Hello world' },
        createdAt: '2026-04-21T12:00:02.000Z'
      })
    );
  });

  it('keeps delta boundaries when a non-delta activity lands between chunks', () => {
    const withInfo = createThread({
      turns: [
        {
          id: 'run-1-assistant',
          threadId: 'thread-1',
          runId: 'run-1',
          role: 'assistant',
          content: 'Hello',
          metadata: null,
          createdAt: '2026-04-21T12:00:01.000Z'
        }
      ],
      rawOutput: [
        {
          id: 'run-1:delta:0',
          threadId: 'thread-1',
          runId: 'run-1',
          eventType: 'delta',
          payload: { delta: 'Hello' },
          createdAt: '2026-04-21T12:00:01.000Z'
        },
        {
          id: 'run-1:info:1',
          threadId: 'thread-1',
          runId: 'run-1',
          eventType: 'info',
          payload: { message: 'Reading files' },
          createdAt: '2026-04-21T12:00:02.000Z'
        }
      ]
    });

    const next = applyLiveRunDelta(withInfo, {
      threadId: 'thread-1',
      runId: 'run-1',
      delta: ' world',
      createdAt: '2026-04-21T12:00:03.000Z'
    });

    expect(next.turns.at(-1)?.content).toBe('Hello world');
    expect(next.rawOutput).toHaveLength(3);
    expect(next.rawOutput[2]).toEqual(
      expect.objectContaining({
        id: 'run-1:delta:2',
        payload: { delta: ' world' }
      })
    );
  });
});

describe('replaceLiveRunText', () => {
  it('rewrites the latest assistant turn for the run without disturbing raw events', () => {
    const thread = createThread({
      turns: [
        {
          id: 'run-1-assistant',
          threadId: 'thread-1',
          runId: 'run-1',
          role: 'assistant',
          content: 'Hel lo',
          metadata: null,
          createdAt: '2026-04-21T12:00:01.000Z'
        }
      ],
      rawOutput: [
        {
          id: 'run-1:delta:0',
          threadId: 'thread-1',
          runId: 'run-1',
          eventType: 'delta',
          payload: { delta: 'Hel lo' },
          createdAt: '2026-04-21T12:00:01.000Z'
        }
      ]
    });

    const next = replaceLiveRunText(thread, {
      threadId: 'thread-1',
      runId: 'run-1',
      text: 'Hello',
      createdAt: '2026-04-21T12:00:02.000Z'
    });

    expect(next.turns.at(-1)?.content).toBe('Hello');
    expect(next.rawOutput).toEqual(thread.rawOutput);
  });
});
