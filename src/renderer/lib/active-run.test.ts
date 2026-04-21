import { describe, expect, it } from 'vitest';
import type { ThreadDetail } from '../../shared/domain';
import { deriveCurrentRunId, isActiveThreadStatus } from './active-run';

function createThread(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Planner thread',
    providerId: 'ollama',
    modelId: 'qwen3-coder',
    executionPermission: 'default',
    status: 'completed',
    archived: false,
    lastMessageAt: '2026-04-20T00:00:00.000Z',
    createdAt: '2026-04-20T00:00:00.000Z',
    updatedAt: '2026-04-20T00:00:00.000Z',
    lastPreview: 'Existing preview',
    turns: [],
    rawOutput: [],
    planner: {
      threadId: 'thread-1',
      composerMode: 'default',
      turnState: 'idle',
      activePlanId: null,
      pendingQuestionCallId: null,
      updatedAt: '2026-04-20T00:00:00.000Z',
      activePlan: null,
      pendingQuestionSet: null
    },
    followUps: [],
    ...overrides
  };
}

describe('active-run', () => {
  it('recognizes active thread statuses', () => {
    expect(isActiveThreadStatus('queued')).toBe(true);
    expect(isActiveThreadStatus('running')).toBe(true);
    expect(isActiveThreadStatus('stopping')).toBe(true);
    expect(isActiveThreadStatus('completed')).toBe(false);
  });

  it('hides stale closeout info for a terminal run', () => {
    const thread = createThread({
      status: 'queued',
      rawOutput: [
        { id: 'event-1', threadId: 'thread-1', runId: 'run-1', eventType: 'started', payload: {}, createdAt: '2026-04-20T00:00:00.000Z' },
        { id: 'event-2', threadId: 'thread-1', runId: 'run-1', eventType: 'completed', payload: {}, createdAt: '2026-04-20T00:00:01.000Z' },
        { id: 'event-3', threadId: 'thread-1', runId: 'run-1', eventType: 'info', payload: { message: 'Planner proposed a plan.' }, createdAt: '2026-04-20T00:00:02.000Z' }
      ]
    });

    expect(deriveCurrentRunId(thread, null)).toBeNull();
  });

  it('keeps a non-terminal run active while the thread is active', () => {
    const thread = createThread({
      status: 'running',
      rawOutput: [
        { id: 'event-1', threadId: 'thread-1', runId: 'run-1', eventType: 'started', payload: {}, createdAt: '2026-04-20T00:00:00.000Z' },
        { id: 'event-2', threadId: 'thread-1', runId: 'run-1', eventType: 'info', payload: { message: 'Still running.' }, createdAt: '2026-04-20T00:00:01.000Z' }
      ]
    });

    expect(deriveCurrentRunId(thread, null)).toBe('run-1');
  });

  it('prefers an explicit active run id', () => {
    expect(deriveCurrentRunId(createThread(), 'run-explicit')).toBe('run-explicit');
  });
});
