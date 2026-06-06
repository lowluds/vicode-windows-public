import { describe, expect, it } from 'vitest';
import type { ResolvedConversationTaskPacket } from './conversation-task-resolver';
import type { PlannerPlan, RunEvent } from './domain';
import {
  advanceRunProgress,
  applyRunProgressSnapshotEvent,
  completeRunProgress,
  countCompletedRunProgressItems,
  deriveRunProgressFromProviderTodos,
  deriveRunProgressFromPlanner,
  deriveRunProgressFromResolvedTaskPacket,
  deriveRunProgressSnapshots,
  failRunProgress,
  shouldAdvanceRunProgressFromActivity
} from './run-progress';

function createPlan(overrides: Partial<PlannerPlan> = {}): PlannerPlan {
  return {
    id: 'plan-1',
    threadId: 'thread-1',
    createdTurnId: 'turn-1',
    proposedPlanMarkdown: `1. Inspect the provider abstraction\n2. Add model discovery support\n3. Update tests`,
    structuredPlan: {
      title: 'Qwen support',
      summary: ['Inspect the provider abstraction'],
      keyChanges: ['Add model discovery support', 'Update tests'],
      testPlan: ['Run build and tests'],
      assumptions: []
    },
    status: 'approved',
    createdAt: '2026-03-17T00:00:00.000Z',
    ...overrides
  };
}

function createResolvedTaskPacket(
  overrides: Partial<ResolvedConversationTaskPacket> = {}
): ResolvedConversationTaskPacket {
  return {
    trigger: 'inferred_proceed',
    phase: 'ready_to_task',
    executionPolicy: 'auto_execute',
    confidence: 'high',
    objective: 'Implement a small calculator app.',
    sourceTurnIds: ['turn-1'],
    decisionsUsed: [],
    decisions: [],
    rejectedOptions: [],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: ['Keyboard input works.'],
    expectedToolGroups: ['workspace_read', 'workspace_write', 'verification'],
    slices: [
      {
        id: 'inspect-context',
        title: 'Inspect resolved conversation context',
        status: 'pending',
        detail: null,
        rationale: 'Use prior thread context.',
        expectedOutcome: 'Context is ready for implementation.',
        sourceTurnIds: ['turn-1']
      },
      {
        id: 'implement-core',
        title: 'Implement core workspace changes',
        status: 'pending',
        detail: null,
        rationale: 'Apply the resolved task.',
        expectedOutcome: 'The calculator behavior exists.',
        sourceTurnIds: ['turn-1']
      },
      {
        id: 'verify-result',
        title: 'Run focused verification',
        status: 'pending',
        detail: null,
        rationale: 'Prove the changed behavior.',
        expectedOutcome: 'Focused checks pass.',
        sourceTurnIds: ['turn-1']
      }
    ],
    verification: ['Run npm test.'],
    ...overrides
  };
}

describe('run progress derivation', () => {
  it('returns null when the approved plan is not actively executing', () => {
    expect(deriveRunProgressFromPlanner(createPlan(), 'idle', 'run-1', 'thread-1')).toBeNull();
  });

  it('derives progress rows from the structured planner plan', () => {
    const progress = deriveRunProgressFromPlanner(createPlan(), 'executing_from_plan', 'run-1', 'thread-1');
    expect(progress?.title).toBe('Qwen support');
    expect(countCompletedRunProgressItems(progress!)).toBe(0);
    expect(progress?.items[0]?.status).toBe('in_progress');
    expect(progress?.items.map((item) => item.label)).toEqual(['Add model discovery support', 'Update tests', 'Run build and tests', 'Inspect the provider abstraction']);
  });

  it('falls back to markdown tasks when no structured plan exists', () => {
    const progress = deriveRunProgressFromPlanner(
      createPlan({
        structuredPlan: null,
        proposedPlanMarkdown: '- First task\n- Second task'
      }),
      'executing_from_plan',
      'run-1',
      'thread-1'
    );

    expect(progress?.items.map((item) => item.label)).toEqual(['First task', 'Second task']);
  });

  it('keeps every approved planner task instead of truncating the execution contract', () => {
    const progress = deriveRunProgressFromPlanner(
      createPlan({
        structuredPlan: {
          title: 'Long plan',
          summary: ['Summarize results'],
          keyChanges: [
            'Inspect workspace',
            'Search the web',
            'Read notes',
            'Create index.html',
            'Create styles.css',
            'Create main.js',
            'Run unit tests',
            'Run visual check',
            'Report outcome'
          ],
          testPlan: ['Run npm test'],
          assumptions: []
        }
      }),
      'executing_from_plan',
      'run-1',
      'thread-1'
    );

    expect(progress?.items.map((item) => item.label)).toEqual([
      'Inspect workspace',
      'Search the web',
      'Read notes',
      'Create index.html',
      'Create styles.css',
      'Create main.js',
      'Run unit tests',
      'Run visual check',
      'Report outcome',
      'Run npm test',
      'Summarize results'
    ]);
  });

  it('advances task state sequentially', () => {
    const progress = deriveRunProgressFromPlanner(createPlan(), 'executing_from_plan', 'run-1', 'thread-1');
    const next = advanceRunProgress(progress!);

    expect(next.items[0]?.status).toBe('completed');
    expect(next.items[1]?.status).toBe('in_progress');
    expect(countCompletedRunProgressItems(next)).toBe(1);
  });

  it('marks all tasks completed at the end of a run', () => {
    const progress = deriveRunProgressFromPlanner(createPlan(), 'executing_from_plan', 'run-1', 'thread-1');
    const done = completeRunProgress(progress!);

    expect(done.items.every((item) => item.status === 'completed')).toBe(true);
    expect(countCompletedRunProgressItems(done)).toBe(done.items.length);
  });

  it('marks the active task as failed when a run errors', () => {
    const progress = deriveRunProgressFromPlanner(createPlan(), 'executing_from_plan', 'run-1', 'thread-1');
    const failed = failRunProgress(progress!, 'failed');

    expect(failed.items[0]?.status).toBe('failed');
    expect(failed.items[1]?.status).toBe('pending');
  });

  it('derives provider-native progress from todo tool output', () => {
    const progress = deriveRunProgressFromProviderTodos(
      [
        { description: 'Inspect auth flow', status: 'completed' },
        { description: 'Wire quota panel', status: 'in_progress' },
        { description: 'Run smoke checks', status: 'pending' },
        { description: 'Handle flaky step', status: 'cancelled' }
      ],
      'run-1',
      'thread-1',
      'Gemini todo list'
    );

    expect(progress).toMatchObject({
      runId: 'run-1',
      threadId: 'thread-1',
      title: 'Gemini todo list'
    });
    expect(
      progress?.items.map((item) => ({
        label: item.label,
        status: item.status
      }))
    ).toEqual([
      { label: 'Inspect auth flow', status: 'completed' },
      { label: 'Wire quota panel', status: 'in_progress' },
      { label: 'Run smoke checks', status: 'pending' },
      { label: 'Handle flaky step', status: 'blocked' }
    ]);
  });

  it('derives progress rows from a resolved conversation task packet', () => {
    const packet = createResolvedTaskPacket();

    const progress = deriveRunProgressFromResolvedTaskPacket(packet, 'run-1', 'thread-1');

    expect(progress).toMatchObject({
      runId: 'run-1',
      threadId: 'thread-1',
      title: 'Resolved task'
    });
    expect(
      progress?.items.map((item) => ({
        label: item.label,
        status: item.status
      }))
    ).toEqual([
      { label: 'Inspect resolved conversation context', status: 'in_progress' },
      { label: 'Implement core workspace changes', status: 'pending' },
      { label: 'Run focused verification', status: 'pending' }
    ]);
  });

  it('does not derive fake execution progress for non-auto task packets', () => {
    expect(
      deriveRunProgressFromResolvedTaskPacket(
        createResolvedTaskPacket({
          executionPolicy: 'ask_clarifying_question',
          confidence: 'low',
          expectedToolGroups: ['workspace_read'],
          clarificationQuestion: 'What should I implement?'
        }),
        'run-1',
        'thread-1'
      )
    ).toBeNull();
    expect(
      deriveRunProgressFromResolvedTaskPacket(
        createResolvedTaskPacket({
          executionPolicy: 'approval_required',
          riskReason: 'This task needs approval before execution.'
        }),
        'run-1',
        'thread-1'
      )
    ).toBeNull();
    expect(
      deriveRunProgressFromResolvedTaskPacket(
        createResolvedTaskPacket({
          phase: 'task_plan',
          executionPolicy: 'plan_mode_wait'
        }),
        'run-1',
        'thread-1'
      )
    ).toBeNull();
  });

  it('replays persisted progress snapshots from raw run events', () => {
    const events: RunEvent[] = [
      {
        id: 'event-1',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          progressSnapshot: {
            runId: 'run-1',
            threadId: 'thread-1',
            title: 'Current tasks',
            items: [
              { id: 'run-1:0', label: 'Inspect provider flow', order: 0, status: 'completed' },
              { id: 'run-1:1', label: 'Wire renderer restore', order: 1, status: 'in_progress' }
            ],
            updatedAt: '2026-03-23T12:00:00.000Z',
            diffStats: null,
            reviewAvailable: false,
            changeArtifact: null,
            delegation: {
              mode: 'planner',
              profile: 'delegated',
              phase: 'waiting_for_answers',
              title: 'Delegated planner context',
              note: 'The delegated planner needs a clarifying answer before it should continue drafting the plan.',
              includedContext: ['Project instructions', 'Provider compatibility notes'],
              excludedContext: ['Full project memory', 'Main-thread history']
            },
            contextPressure: {
              severity: 'warning',
              pressureLabel: 'Context pressure building',
              note: 'Long follow-ups may start to lose continuity.',
              source: 'provider',
              sourceLabel: 'Provider-reported usage from Codex',
              usagePercent: 82,
              usedTokens: 82_000,
              maxTokens: 100_000,
              checkpointRecommended: true,
              compactionLikely: false
            },
            checkpointReminder: {
              kind: 'context_pressure',
              title: 'Checkpoint recommended',
              message: 'Capture the operating contract before another heavy turn.'
            },
            queueSummary: {
              queuedCount: 2,
              steerCount: 1,
              followUpCount: 1,
              condensedQueuedCount: 1
            }
          }
        },
        createdAt: '2026-03-23T12:00:00.000Z'
      }
    ];

    expect(deriveRunProgressSnapshots(events)).toEqual({
      'run-1': expect.objectContaining({
        runId: 'run-1',
        threadId: 'thread-1',
        title: 'Current tasks',
        delegation: expect.objectContaining({
          mode: 'planner',
          phase: 'waiting_for_answers'
        }),
        contextPressure: expect.objectContaining({
          severity: 'warning',
          usagePercent: 82
        }),
        checkpointReminder: expect.objectContaining({
          kind: 'context_pressure'
        }),
        queueSummary: expect.objectContaining({
          condensedQueuedCount: 1
        }),
        items: [
          expect.objectContaining({ label: 'Inspect provider flow', status: 'completed' }),
          expect.objectContaining({ label: 'Wire renderer restore', status: 'in_progress' })
        ]
      })
    });
  });

  it('supports legacy progress payloads and clears snapshots on terminal events', () => {
    const infoEvent: RunEvent = {
      id: 'event-1',
      threadId: 'thread-1',
      runId: 'run-1',
      eventType: 'info',
      payload: {
        progress: {
          runId: 'run-1',
          threadId: 'thread-1',
          title: 'Legacy tasks',
          items: [{ id: 'run-1:0', label: 'Inspect diagnostics', order: 0, status: 'in_progress' }],
          updatedAt: '2026-03-23T12:00:00.000Z',
          diffStats: null,
          reviewAvailable: false,
          changeArtifact: null,
          delegation: null,
          contextPressure: null,
          checkpointReminder: null,
          queueSummary: null
        }
      },
      createdAt: '2026-03-23T12:00:00.000Z'
    };
    const completedEvent: RunEvent = {
      id: 'event-2',
      threadId: 'thread-1',
      runId: 'run-1',
      eventType: 'completed',
      payload: {},
      createdAt: '2026-03-23T12:01:00.000Z'
    };

    const restored = applyRunProgressSnapshotEvent({}, infoEvent);
    expect(restored['run-1']?.title).toBe('Legacy tasks');
    expect(applyRunProgressSnapshotEvent(restored, completedEvent)).toEqual({});
  });
});

describe('run progress activity advancement', () => {
  it('ignores thinking updates', () => {
    expect(
      shouldAdvanceRunProgressFromActivity({
        kind: 'thinking',
        summary: 'Thinking'
      })
    ).toBe(false);
  });

  it('ignores additive tool telemetry updates', () => {
    expect(
      shouldAdvanceRunProgressFromActivity({
        kind: 'tool_call',
        summary: 'Calling read_file'
      })
    ).toBe(false);
    expect(
      shouldAdvanceRunProgressFromActivity({
        kind: 'tool_result',
        summary: 'Completed read_file'
      })
    ).toBe(false);
  });

  it('advances on meaningful runtime activity', () => {
    expect(
      shouldAdvanceRunProgressFromActivity({
        kind: 'terminal_command',
        phase: 'completed',
        summary: 'Ran npm test'
      })
    ).toBe(true);
  });
});
