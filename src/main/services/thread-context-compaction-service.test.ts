import { describe, expect, it, vi } from 'vitest';
import type { RunEvent, ThreadDetail } from '../../shared/domain';
import {
  ThreadContextCompactionService,
  buildThreadContextCompactionPrompt
} from './thread-context-compaction-service';
import type { ThreadCompactionRecord } from '../../storage/thread-compaction-repository';

function event(
  id: string,
  payload: Record<string, unknown> = {},
  eventType: RunEvent['eventType'] = 'info'
): RunEvent {
  return {
    id,
    threadId: 'thread-1',
    runId: 'run-1',
    eventType,
    payload,
    createdAt: `2026-06-01T10:00:0${id.replace(/\D/gu, '') || '0'}.000Z`
  };
}

function activity(kind: string, summary: string) {
  return {
    activity: {
      kind,
      summary,
      text: summary
    }
  };
}

function createThread(events: RunEvent[]): ThreadDetail {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Investigate context compaction',
    providerId: 'ollama',
    modelId: 'qwen3-coder',
    executionPermission: 'default',
    status: 'completed',
    archived: false,
    createdAt: '2026-06-01T09:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    lastMessageAt: '2026-06-01T10:00:00.000Z',
    lastPreview: '',
    turns: [],
    rawOutput: events,
    planner: {
      threadId: 'thread-1',
      composerMode: 'default',
      turnState: 'idle',
      activePlan: null,
      pendingQuestionSet: null,
      updatedAt: '2026-06-01T10:00:00.000Z'
    },
    followUps: []
  };
}

function createService(thread: ThreadDetail, summarize = vi.fn(async () => 'Structured summary.')) {
  const compactions: ThreadCompactionRecord[] = [];
  const service = new ThreadContextCompactionService({
    db: {
      getThread: vi.fn(() => thread),
      getLatestThreadCompaction: vi.fn(() => compactions[compactions.length - 1] ?? null),
      createThreadCompaction: vi.fn((input) => {
        const record: ThreadCompactionRecord = {
          id: `compaction-${compactions.length + 1}`,
          threadId: input.threadId,
          sourceStartEventId: input.sourceStartEventId,
          sourceEndEventId: input.sourceEndEventId,
          summary: input.summary,
          inputTokenEstimate: input.inputTokenEstimate ?? null,
          outputTokenEstimate: input.outputTokenEstimate ?? null,
          providerId: input.providerId ?? null,
          modelId: input.modelId ?? null,
          createdAt: input.createdAt ?? '2026-06-01T10:10:00.000Z'
        };
        compactions.push(record);
        return record;
      })
    },
    summarize
  });
  return {
    compactions,
    service,
    summarize
  };
}

describe('ThreadContextCompactionService', () => {
  it('summarizes and stores a protected-prefix compaction range', async () => {
    const thread = createThread([
      event('event-1', { message: 'Started' }, 'started'),
      event('event-2', activity('thinking', 'Inspecting the project')),
      event('event-3', activity('tool_call', 'Read package.json')),
      event('event-4', activity('tool_result', 'package.json contents')),
      event('event-5', { delta: 'Working notes' }, 'delta'),
      event('event-6', activity('thinking', 'Recent plan')),
      event('event-7', { message: 'Completed' }, 'completed')
    ]);
    const { service, summarize } = createService(thread);

    const result = await service.createThreadCompaction({
      threadId: thread.id,
      protectedRecentEventCount: 2,
      inputTokenEstimate: 12_000,
      outputTokenEstimate: 700
    });

    expect(result).toMatchObject({
      status: 'compacted',
      sourceEventCount: 5,
      protectedEventCount: 2,
      compaction: {
        threadId: thread.id,
        sourceStartEventId: 'event-1',
        sourceEndEventId: 'event-5',
        summary: 'Structured summary.',
        inputTokenEstimate: 12_000,
        outputTokenEstimate: 700,
        providerId: 'ollama',
        modelId: 'qwen3-coder'
      }
    });
    expect(summarize).toHaveBeenCalledWith(
      expect.objectContaining({
        thread,
        sourceEvents: thread.rawOutput.slice(0, 5),
        prompt: expect.stringContaining('Current objective and acceptance criteria')
      })
    );
  });

  it('moves the boundary before a tool call when the protected suffix starts with its result', async () => {
    const thread = createThread([
      event('event-1', activity('thinking', 'Initial investigation')),
      event('event-2', activity('tool_call', 'Read README.md')),
      event('event-3', activity('tool_result', 'README.md contents')),
      event('event-4', activity('thinking', 'Continue from the file result'))
    ]);
    const { service, summarize } = createService(thread);

    const result = await service.createThreadCompaction({
      threadId: thread.id,
      protectedRecentEventCount: 2,
      minimumCompactableEventCount: 1
    });

    expect(result).toMatchObject({
      status: 'compacted',
      sourceEventCount: 1,
      compaction: {
        sourceStartEventId: 'event-1',
        sourceEndEventId: 'event-1'
      }
    });
    expect(summarize).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEvents: [thread.rawOutput[0]]
      })
    );
  });

  it('skips when there is not enough old history to compact', async () => {
    const thread = createThread([
      event('event-1', { message: 'Started' }, 'started'),
      event('event-2', { message: 'Completed' }, 'completed')
    ]);
    const { service, summarize } = createService(thread);

    await expect(
      service.createThreadCompaction({
        threadId: thread.id,
        protectedRecentEventCount: 2
      })
    ).resolves.toEqual({
      status: 'skipped',
      reason: 'not_enough_events'
    });
    expect(summarize).not.toHaveBeenCalled();
  });

  it('skips duplicate compaction ranges that are already represented by the latest overlay', async () => {
    const thread = createThread([
      event('event-1', { message: 'Started' }, 'started'),
      event('event-2', activity('thinking', 'Inspecting the project')),
      event('event-3', activity('thinking', 'Recent plan')),
      event('event-4', { message: 'Completed' }, 'completed')
    ]);
    const { service, summarize } = createService(thread);

    await expect(
      service.createThreadCompaction({
        threadId: thread.id,
        protectedRecentEventCount: 2,
        minimumCompactableEventCount: 1
      })
    ).resolves.toMatchObject({
      status: 'compacted',
      compaction: {
        sourceEndEventId: 'event-2'
      }
    });

    await expect(
      service.createThreadCompaction({
        threadId: thread.id,
        protectedRecentEventCount: 2,
        minimumCompactableEventCount: 1
      })
    ).resolves.toEqual({
      status: 'skipped',
      reason: 'duplicate_source_range'
    });
    expect(summarize).toHaveBeenCalledTimes(1);
  });
});

describe('buildThreadContextCompactionPrompt', () => {
  it('builds a structured prompt from source events without including the protected suffix', () => {
    const thread = createThread([
      event('event-1', activity('thinking', 'Initial investigation')),
      event('event-2', { delta: 'Assistant draft' }, 'delta')
    ]);

    expect(buildThreadContextCompactionPrompt(thread, thread.rawOutput)).toContain(
      'Summarize the selected older thread events into compact working state.'
    );
    expect(buildThreadContextCompactionPrompt(thread, thread.rawOutput)).toContain(
      '[event-2] delta: Assistant draft'
    );
  });
});
