import { describe, expect, it, vi } from 'vitest';
import type { AppEvent } from '../../shared/events';
import type {
  JobDefinition,
  SubagentSummary,
  ThreadDetail,
  VicodeBuildSnapshot,
  VicodeBuildTeamSnapshot
} from '../../shared/domain';
import { AutonomousTaskService } from './autonomous-tasks';

function createThread(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    id: 'thread-builder',
    projectId: 'project-1',
    title: 'Builder thread',
    providerId: 'openai',
    modelId: 'gpt-5.4',
    executionPermission: 'default',
    status: 'running',
    archived: false,
    lastMessageAt: '2026-04-01T10:06:00.000Z',
    createdAt: '2026-04-01T09:55:00.000Z',
    updatedAt: '2026-04-01T10:06:00.000Z',
    lastPreview: 'Applying docs updates.',
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
    parentThreadId: 'thread-builder',
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
    threadId: 'thread-builder',
    createdAt: '2026-04-01T10:02:00.000Z',
    updatedAt: '2026-04-01T10:07:00.000Z',
    ...overrides
  };
}

function createBuildTeam(overrides: Partial<VicodeBuildTeamSnapshot> = {}): VicodeBuildTeamSnapshot {
  return {
    teamId: 'team-1',
    label: 'Docs maintenance',
    goal: 'Fix stale docs',
    worktreeRoot: 'C:/worktree',
    lastActivityAt: '2026-04-01T10:06:00.000Z',
    ticketQueuePath: '.vicode/control/queue.json',
    activeTicketTitle: 'Refresh docs',
    activeTicketOwnerLane: 'builder',
    ownedSliceSummary: 'Update README and engineering docs.',
    openTicketCount: 1,
    blockedTicketCount: 0,
    ticketSummary: '1 active ticket',
    tickets: [
      {
        id: 'ticket-1',
        title: 'Refresh docs',
        status: 'in_progress',
        ownerLane: 'builder',
        summary: 'Update README and engineering docs.',
        dependencies: [],
        targetPaths: ['README.md', 'docs/engineering/README.md'],
        acceptanceCriteria: ['Docs match current branch behavior.'],
        verificationSteps: ['Run the docs maintenance checks.'],
        refs: ['docs/engineering/README.md'],
        stopWhen: 'the docs are current with the repository state',
        updatedAt: '2026-04-01T10:06:00.000Z'
      }
    ],
    heartbeatPath: '.vicode/control/heartbeat.md',
    heartbeatStatus: 'running',
    heartbeatSummary: 'Docs maintenance active.',
    heartbeatUpdatedAt: '2026-04-01T10:06:00.000Z',
    heartbeatOpenItems: [],
    status: 'active',
    statusSummary: 'Builder running.',
    recommendedAction: null,
    lanes: [
      {
        laneId: 'planner',
        label: 'Planner',
        automationId: 'planner-auto',
        status: 'completed',
        paused: false,
        worktreeRoot: 'C:/worktree',
        skillIds: [],
        skillNames: [],
        lastRunAt: '2026-04-01T10:00:00.000Z',
        nextRunAt: null,
        threadId: 'thread-planner',
        threadTitle: 'Planner thread',
        threadStatus: 'completed',
        lastPreview: 'Planner finished the first pass.',
        blockedReason: null,
        recommendedAction: null,
        lastWakeAt: '2026-04-01T10:00:00.000Z',
        lastWakeReason: 'initial',
        recentEvents: []
      },
      {
        laneId: 'builder',
        label: 'Builder',
        automationId: 'builder-auto',
        status: 'running',
        paused: false,
        worktreeRoot: 'C:/worktree',
        skillIds: [],
        skillNames: [],
        lastRunAt: '2026-04-01T10:06:00.000Z',
        nextRunAt: null,
        threadId: 'thread-builder',
        threadTitle: 'Builder thread',
        threadStatus: 'running',
        lastPreview: 'Applying docs updates.',
        blockedReason: null,
        recommendedAction: null,
        lastWakeAt: '2026-04-01T10:05:00.000Z',
        lastWakeReason: 'handoff',
        recentEvents: []
      },
      {
        laneId: 'finisher',
        label: 'Finisher',
        automationId: 'finisher-auto',
        status: 'idle',
        paused: false,
        worktreeRoot: 'C:/worktree',
        skillIds: [],
        skillNames: [],
        lastRunAt: null,
        nextRunAt: null,
        threadId: 'thread-finisher',
        threadTitle: 'Finisher thread',
        threadStatus: 'queued',
        lastPreview: null,
        blockedReason: null,
        recommendedAction: null,
        lastWakeAt: null,
        lastWakeReason: null,
        recentEvents: []
      }
    ],
    ...overrides
  };
}

function createSnapshot(team: VicodeBuildTeamSnapshot): VicodeBuildSnapshot {
  return {
    available: true,
    checkedAt: '2026-04-01T10:06:00.000Z',
    projectId: 'project-1',
    projectRoot: 'C:/project',
    configPath: '.vicode/control/vicode-build-teams.json',
    teams: [team],
    recentEvents: [],
    note: null
  };
}

describe('AutonomousTaskService', () => {
  it('combines build lanes, subagents, and jobs for a thread', () => {
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
        getSnapshot: () => createSnapshot(createBuildTeam())
      } as never,
      {
        listForThread: () => [createSubagent()]
      } as never
    );

    const tasks = service.listForThread('thread-builder');

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
          kind: 'build_lane',
          title: 'Builder',
          provenanceLabel: 'build control',
          trustLabel: 'trusted worktree'
        }),
        expect.objectContaining({
          kind: 'build_ticket',
          title: 'Refresh docs',
          provenanceLabel: 'build control ticket',
          ownerLabel: 'builder',
          status: 'running'
        })
      ])
    );
    expect(tasks.find((task) => task.kind === 'job')).toMatchObject({
      kind: 'job',
      title: 'Heartbeat docs check',
      ownerLabel: 'autonomy',
      provenanceLabel: 'future system',
      trustLabel: 'trusted workspace',
      status: 'running'
    });
    expect(tasks.find((task) => task.kind === 'build_lane' && task.title === 'Builder')).toMatchObject({
      kind: 'build_lane',
      title: 'Builder',
      provenanceLabel: 'build control',
      trustLabel: 'trusted worktree'
    });
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
        getSnapshot: () => createSnapshot(createBuildTeam()),
        onControllerUpdate: () => () => undefined
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
        threadId: 'thread-builder',
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
        threadId: 'thread-builder',
        tasks: expect.arrayContaining([
          expect.objectContaining({
            kind: 'subagent',
            status: 'waiting'
          })
        ])
      })
    );
  });

  it('syncs persisted build-lane tasks when build control records controller activity', () => {
    const buildListeners: Array<(event: { projectId: string; teamId: string; laneId: string; threadId: string | null }) => void> = [];
    const upsertAutonomousTask = vi.fn();
    const service = new AutonomousTaskService(
      {
        getThread: () => createThread(),
        listJobsForThread: () => [],
        listAutonomousTasksForProject: () => [],
        upsertAutonomousTask
      } as never,
      {
        onEvent: () => () => undefined
      } as never,
      {
        getSnapshot: () => createSnapshot(createBuildTeam()),
        onControllerUpdate: (listener: (event: { projectId: string; teamId: string; laneId: string; threadId: string | null }) => void) => {
          buildListeners.push(listener);
          return () => undefined;
        }
      } as never,
      {
        listForThread: () => [],
        onEvent: () => () => undefined
      } as never
    );

    buildListeners[0]?.({
      projectId: 'project-1',
      teamId: 'team-1',
      laneId: 'builder',
      threadId: 'thread-builder'
    } as never);

    expect(upsertAutonomousTask).toHaveBeenCalledTimes(4);
    expect(upsertAutonomousTask).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'build_lane',
        projectId: 'project-1',
        sourceId: 'build-lane:project-1:team-1:builder',
        title: 'Builder',
        status: 'running',
        threadId: 'thread-builder',
        provenanceLabel: 'build control'
      })
    );
    expect(upsertAutonomousTask).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'build_ticket',
        projectId: 'project-1',
        sourceId: 'build-ticket:project-1:team-1:ticket-1',
        title: 'Refresh docs',
        status: 'running',
        threadId: 'thread-builder',
        provenanceLabel: 'build control ticket',
        blocking: null,
        metadata: expect.objectContaining({
          blockedByTicketIds: [],
          blockingTicketIds: []
        })
      })
    );
    service.dispose();
  });

  it('surfaces dependency-held build tickets as waiting autonomous tasks', () => {
    const service = new AutonomousTaskService(
      {
        getThread: () => createThread(),
        listJobsForThread: () => [],
        listAutonomousTasksForProject: () => [],
        upsertAutonomousTask: vi.fn(),
        getAutonomousTaskByKindAndSource: vi.fn(() => null)
      } as never,
      {
        onEvent: () => () => undefined
      } as never,
      {
        getSnapshot: () =>
          createSnapshot(
            createBuildTeam({
              tickets: [
                {
                  id: 'ticket-1',
                  title: 'Research docs drift',
                  status: 'done',
                  ownerLane: 'planner',
                  summary: 'Research complete.',
                  dependencies: [],
                  targetPaths: ['docs/engineering/README.md'],
                  acceptanceCriteria: [],
                  verificationSteps: [],
                  refs: [],
                  stopWhen: null,
                  updatedAt: '2026-04-01T10:00:00.000Z'
                },
                {
                  id: 'ticket-2',
                  title: 'Update docs copy',
                  status: 'todo',
                  ownerLane: 'builder',
                  summary: 'Write the bounded docs update.',
                  dependencies: ['ticket-3'],
                  targetPaths: ['README.md'],
                  acceptanceCriteria: ['README reflects current behavior.'],
                  verificationSteps: ['Inspect README.'],
                  refs: ['README.md'],
                  stopWhen: 'README is current',
                  updatedAt: '2026-04-01T10:06:00.000Z'
                },
                {
                  id: 'ticket-3',
                  title: 'Validate current behavior',
                  status: 'todo',
                  ownerLane: 'planner',
                  summary: 'Confirm the current product behavior first.',
                  dependencies: [],
                  targetPaths: ['src/shared/domain.ts'],
                  acceptanceCriteria: [],
                  verificationSteps: [],
                  refs: [],
                  stopWhen: null,
                  updatedAt: '2026-04-01T10:05:00.000Z'
                }
              ]
            })
          ),
        onControllerUpdate: () => () => undefined
      } as never,
      {
        listForThread: () => [],
        onEvent: () => () => undefined
      } as never
    );

    const waitingTicket = service.listForThread('thread-builder').find((task) => task.kind === 'build_ticket' && task.title === 'Update docs copy');

    expect(waitingTicket).toMatchObject({
      kind: 'build_ticket',
      status: 'waiting',
      statusLabel: 'waiting on dependency',
      approvalLabel: 'bounded stop condition'
    });
  });

  it('prunes stale build-ticket task records when the queue no longer contains them', () => {
    const buildListeners: Array<(event: { projectId: string; teamId: string; laneId: string; threadId: string | null }) => void> = [];
    const deleteAutonomousTaskByKindAndSource = vi.fn();
    const service = new AutonomousTaskService(
      {
        getThread: (threadId: string) => createThread({ id: threadId }),
        listJobsForThread: () => [],
        listAutonomousTasksForProject: (projectId: string, kind?: 'build_lane' | 'build_ticket' | 'subagent' | 'job') => {
          if (kind === 'build_lane') {
            return [];
          }
          if (kind === 'build_ticket') {
            return [
              {
                id: 'task-ticket-1',
                kind: 'build_ticket',
                projectId,
                threadId: 'thread-builder',
                runId: null,
                sourceId: 'build-ticket:project-1:team-1:ticket-stale',
                title: 'Stale ticket',
                summary: 'Old ticket',
                ownerLabel: 'builder',
                provenanceLabel: 'build control ticket',
                trustLabel: 'trusted worktree',
                approvalLabel: null,
                status: 'queued',
                statusLabel: 'todo',
                blockedBy: null,
                blocking: null,
                lastError: null,
                metadata: {},
                createdAt: '2026-04-01T09:00:00.000Z',
                updatedAt: '2026-04-01T09:05:00.000Z',
                startedAt: null,
                completedAt: null
              }
            ];
          }
          return [];
        },
        upsertAutonomousTask: vi.fn(),
        getAutonomousTaskByKindAndSource: vi.fn(() => null),
        deleteAutonomousTaskByKindAndSource
      } as never,
      {
        onEvent: () => () => undefined
      } as never,
      {
        getSnapshot: () => createSnapshot(createBuildTeam()),
        onControllerUpdate: (listener: (event: { projectId: string; teamId: string; laneId: string; threadId: string | null }) => void) => {
          buildListeners.push(listener);
          return () => undefined;
        }
      } as never,
      {
        listForThread: () => [],
        onEvent: () => () => undefined
      } as never
    );

    buildListeners[0]?.({
      projectId: 'project-1',
      teamId: 'team-1',
      laneId: 'builder',
      threadId: 'thread-builder'
    });

    expect(deleteAutonomousTaskByKindAndSource).toHaveBeenCalledWith(
      'build_ticket',
      'build-ticket:project-1:team-1:ticket-stale'
    );
    service.dispose();
  });

  it('emits task updates when build control records lane activity', () => {
    const buildListeners: Array<(event: { projectId: string; teamId: string; laneId: string; threadId: string | null }) => void> = [];
    const service = new AutonomousTaskService(
      {
        getThread: (threadId: string) => createThread({ id: threadId }),
        listJobsForThread: () => [],
        listAutonomousTasksForProject: () => [],
        upsertAutonomousTask: vi.fn(),
        getAutonomousTaskByKindAndSource: vi.fn(() => null)
      } as never,
      {
        onEvent: () => () => undefined
      } as never,
      {
        getSnapshot: () => createSnapshot(createBuildTeam()),
        onControllerUpdate: (listener: (event: { projectId: string; teamId: string; laneId: string; threadId: string | null }) => void) => {
          buildListeners.push(listener);
          return () => undefined;
        }
      } as never,
      {
        listForThread: () => [],
        onEvent: () => () => undefined
      } as never
    );
    const received = vi.fn();

    service.onEvent(received);

    buildListeners[0]?.({
      projectId: 'project-1',
      teamId: 'team-1',
      laneId: 'builder',
      threadId: 'thread-builder'
    });

    expect(received).toHaveBeenCalledTimes(3);
    expect(received).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'autonomousTasks.updated',
        threadId: 'thread-builder'
      })
    );
    expect(received).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'autonomousTasks.updated',
        threadId: 'thread-planner'
      })
    );
    expect(received).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        type: 'autonomousTasks.updated',
        threadId: 'thread-finisher'
      })
    );
  });

  it('records explicit blocked-by and blocking ticket edges for persisted build tickets', () => {
    const buildListeners: Array<(event: { projectId: string; teamId: string; laneId: string; threadId: string | null }) => void> = [];
    const upsertAutonomousTask = vi.fn();
    const service = new AutonomousTaskService(
      {
        getThread: () => createThread(),
        listJobsForThread: () => [],
        listAutonomousTasksForProject: () => [],
        upsertAutonomousTask
      } as never,
      {
        onEvent: () => () => undefined
      } as never,
      {
        getSnapshot: () =>
          createSnapshot(
            createBuildTeam({
              activeTicketTitle: 'Research docs drift',
              tickets: [
                {
                  id: 'ticket-1',
                  title: 'Research docs drift',
                  status: 'in_progress',
                  ownerLane: 'planner',
                  summary: 'Research the current state before implementation.',
                  dependencies: [],
                  targetPaths: ['docs/engineering/README.md'],
                  acceptanceCriteria: [],
                  verificationSteps: [],
                  refs: [],
                  stopWhen: null,
                  updatedAt: '2026-04-01T10:00:00.000Z'
                },
                {
                  id: 'ticket-2',
                  title: 'Implement the bounded docs slice',
                  status: 'todo',
                  ownerLane: 'builder',
                  summary: 'Update the docs after research is complete.',
                  dependencies: ['ticket-1'],
                  targetPaths: ['README.md'],
                  acceptanceCriteria: ['README reflects current behavior.'],
                  verificationSteps: ['Run docs checks.'],
                  refs: [],
                  stopWhen: 'the docs are current',
                  updatedAt: '2026-04-01T10:05:00.000Z'
                }
              ]
            })
          ),
        onControllerUpdate: (listener: (event: { projectId: string; teamId: string; laneId: string; threadId: string | null }) => void) => {
          buildListeners.push(listener);
          return () => undefined;
        }
      } as never,
      {
        listForThread: () => [],
        onEvent: () => () => undefined
      } as never
    );

    buildListeners[0]?.({
      projectId: 'project-1',
      teamId: 'team-1',
      laneId: 'planner',
      threadId: 'thread-planner'
    } as never);

    expect(upsertAutonomousTask).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'build_ticket',
        sourceId: 'build-ticket:project-1:team-1:ticket-1',
        blocking: 'Implement the bounded docs slice',
        metadata: expect.objectContaining({
          blockedByTicketIds: [],
          blockingTicketIds: ['ticket-2'],
          blockingTicketTitles: ['Implement the bounded docs slice']
        })
      })
    );
    expect(upsertAutonomousTask).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'build_ticket',
        sourceId: 'build-ticket:project-1:team-1:ticket-2',
        blockedBy: 'Research docs drift',
        metadata: expect.objectContaining({
          blockedByTicketIds: ['ticket-1'],
          blockedByTicketTitles: ['Research docs drift'],
          blockingTicketIds: []
        })
      })
    );
    service.dispose();
  });
});
