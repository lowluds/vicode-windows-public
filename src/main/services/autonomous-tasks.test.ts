import { describe, expect, it, vi } from 'vitest';
import type { AppEvent } from '../../shared/events';
import type {
  JobDefinition,
  SubagentSummary,
  ThreadDetail
} from '../../shared/domain';
import { AutonomousTaskService } from './autonomous-tasks';

function createThread(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    id: 'thread-main',
    projectId: 'project-1',
    title: 'Main thread',
    providerId: 'openai',
    modelId: 'gpt-5.4',
    executionPermission: 'default',
    status: 'running',
    archived: false,
    lastMessageAt: '2026-04-01T10:06:00.000Z',
    createdAt: '2026-04-01T09:55:00.000Z',
    updatedAt: '2026-04-01T10:06:00.000Z',
    lastPreview: 'Applying updates.',
    turns: [],
    followUps: [],
    pendingRunToolApprovals: [],
    planner: null,
    ...overrides
  };
}

function createSubagent(overrides: Partial<SubagentSummary> = {}): SubagentSummary {
  return {
    id: 'subagent-1',
    parentThreadId: 'thread-main',
    parentRunId: null,
    childThreadId: 'thread-child',
    childRunId: 'run-child',
    name: 'Scout',
    title: 'Inspect auth settings',
    prompt: 'Inspect auth settings and report back.',
    providerId: 'openai',
    modelId: 'gpt-5.4',
    executionPermission: 'default',
    delegationProfile: 'research',
    status: 'running',
    outputSummary: null,
    lastError: null,
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:05:00.000Z',
    startedAt: '2026-04-01T10:01:00.000Z',
    completedAt: null,
    ...overrides
  };
}

function createJob(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return {
    id: 'job-1',
    projectId: 'project-1',
    sourceType: 'future_system',
    sourceId: 'heartbeat:1',
    title: 'Heartbeat docs check',
    status: 'running',
    threadId: 'thread-main',
    createdAt: '2026-04-01T10:02:00.000Z',
    updatedAt: '2026-04-01T10:07:00.000Z',
    ...overrides
  };
}

describe('AutonomousTaskService', () => {
  it('combines subagents and jobs for a thread', () => {
    const service = new AutonomousTaskService(
      {
        getThread: () => createThread(),
        listJobsForThread: () => [createJob()],
        listAutonomousTasksForProject: () => []
      } as never,
      {
        onEvent: () => () => undefined
      } as never,
      {
        listForThread: () => [createSubagent()]
      } as never
    );

    const tasks = service.listForThread('thread-main');

    expect(tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'job',
          title: 'Heartbeat docs check',
          ownerLabel: 'autonomy',
          provenanceLabel: 'future system',
          trustLabel: 'trusted workspace',
          status: 'running'
        }),
        expect.objectContaining({
          kind: 'subagent',
          title: 'Scout',
          ownerLabel: 'research',
          provenanceLabel: 'delegated thread',
          status: 'running'
        })
      ])
    );
  });

  it('emits canonical task updates when job and subagent state changes', () => {
    const jobListeners: Array<(event: AppEvent) => void> = [];
    const subagentListeners: Array<(event: AppEvent) => void> = [];
    const job = createJob({ status: 'waiting_for_review' });
    const service = new AutonomousTaskService(
      {
        getThread: () => createThread(),
        listJobsForThread: () => [job],
        listAutonomousTasksForProject: () => [],
        upsertAutonomousTask: vi.fn(),
        getAutonomousTaskByKindAndSource: vi.fn(() => null)
      } as never,
      {
        onEvent: (listener: (event: AppEvent) => void) => {
          jobListeners.push(listener);
          return () => undefined;
        }
      } as never,
      {
        listForThread: () => [createSubagent({ status: 'completed', outputSummary: 'Research finished.' })],
        onEvent: (listener: (event: AppEvent) => void) => {
          subagentListeners.push(listener);
          return () => undefined;
        }
      } as never
    );
    const received = vi.fn();

    service.onEvent(received);

    jobListeners[0]?.({ type: 'job.updated', job });
    subagentListeners[0]?.({ type: 'subagent.completed', subagent: createSubagent({ status: 'completed', outputSummary: 'Research finished.' }) });

    expect(received).toHaveBeenCalledTimes(2);
    expect(received).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'autonomousTasks.updated',
        threadId: 'thread-main',
        tasks: expect.arrayContaining([
          expect.objectContaining({
            kind: 'job',
            status: 'waiting'
          })
        ])
      })
    );
    expect(received).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'autonomousTasks.updated',
        threadId: 'thread-main',
        tasks: expect.arrayContaining([
          expect.objectContaining({
            kind: 'subagent',
            status: 'waiting'
          })
        ])
      })
    );
  });

  it('persists subagent task records with the parent project id', () => {
    const upsertAutonomousTask = vi.fn();
    const subagentListeners: Array<(event: AppEvent) => void> = [];
    const service = new AutonomousTaskService(
      {
        getThread: () => createThread(),
        listJobsForThread: () => [],
        listAutonomousTasksForProject: () => [],
        upsertAutonomousTask,
        getAutonomousTaskByKindAndSource: vi.fn(() => null)
      } as never,
      {
        onEvent: () => () => undefined
      } as never,
      {
        listForThread: () => [createSubagent()],
        onEvent: (listener: (event: AppEvent) => void) => {
          subagentListeners.push(listener);
          return () => undefined;
        }
      } as never
    );

    subagentListeners[0]?.({ type: 'subagent.updated', subagent: createSubagent() });

    expect(upsertAutonomousTask).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'subagent',
        projectId: 'project-1',
        sourceId: 'subagent:subagent-1',
        title: 'Scout',
        status: 'running'
      })
    );
    service.dispose();
  });
});
