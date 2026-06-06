import { describe, expect, it } from 'vitest';
import type { RunEvent, SubagentSummary, ThreadFollowUp, ThreadTurn } from './domain';
import { deriveHarnessHandoffState } from './harness-handoff-state';

function createUserTurn(metadata: Record<string, unknown>): ThreadTurn {
  return {
    id: 'turn-1',
    threadId: 'thread-1',
    runId: 'run-1',
    role: 'user',
    content: 'Implement the harness evidence slice.',
    metadata,
    createdAt: '2026-03-17T00:00:00.000Z'
  };
}

function createSubagent(overrides: Partial<SubagentSummary> = {}): SubagentSummary {
  return {
    id: 'subagent-1',
    parentThreadId: 'thread-1',
    parentRunId: 'run-1',
    childThreadId: 'thread-child',
    childRunId: 'run-child',
    name: 'researcher',
    title: 'Inspect current harness state',
    prompt: 'Read the repo and summarize harness state.',
    providerId: 'openai',
    modelId: 'gpt-5',
    executionPermission: 'default',
    delegationProfile: 'research',
    status: 'completed',
    outputSummary: 'Found existing hook evidence and verification artifacts.',
    lastError: null,
    createdAt: '2026-03-17T00:00:01.000Z',
    updatedAt: '2026-03-17T00:00:02.000Z',
    startedAt: '2026-03-17T00:00:01.100Z',
    completedAt: '2026-03-17T00:00:02.000Z',
    ...overrides
  };
}

describe('deriveHarnessHandoffState', () => {
  it('derives read-only handoff state from contract, verification, final evidence, and changes', () => {
    const state = deriveHarnessHandoffState({
      threadId: 'thread-1',
      runId: 'run-1',
      turns: [
        createUserTurn({
          harnessTaskContract: {
            taskKind: 'edit',
            objective: 'Implement Slice 7D handoff state.',
            workspaceRoot: 'C:/Users/test-user/Desktop/vicode-project',
            allowedPaths: ['src/shared'],
            deniedPaths: ['release'],
            expectedMutations: 'workspace_write',
            verificationPolicy: 'required',
            isolationMode: 'direct_workspace',
            riskLevel: 'medium',
            executionPermission: 'default',
            trustedWorkspace: true,
            runtimeCommandPolicy: 'approval_required',
            runtimeNetworkPolicy: 'disabled',
            commandAccess: 'approval_required',
            networkAccess: 'disabled'
          }
        })
      ],
      followUps: [],
      rawOutput: [
        {
          id: 'event-progress',
          threadId: 'thread-1',
          runId: 'run-1',
          eventType: 'info',
          payload: {
            progressSnapshot: {
              diffStats: {
                filesChanged: 1,
                insertions: 42,
                deletions: 3
              },
              changeArtifact: {
                source: 'workspace_diff',
                summary: {
                  filesChanged: 1,
                  insertions: 42,
                  deletions: 3
                },
                files: [
                  {
                    path: 'src/shared/harness-handoff-state.ts',
                    status: 'added',
                    insertions: 42,
                    deletions: 0,
                    beforeContent: null,
                    afterContent: 'export {}',
                    previewLines: [],
                    previewTruncated: false
                  }
                ]
              }
            }
          },
          createdAt: '2026-03-17T00:00:03.000Z'
        },
        {
          id: 'event-verification',
          threadId: 'thread-1',
          runId: 'run-1',
          eventType: 'info',
          payload: {
            verificationArtifact: {
              command: 'npm test -- src/shared/harness-handoff-state.test.ts',
              cwd: 'C:/Users/test-user/Desktop/vicode-project',
              permissionProfile: 'default',
              networkPolicy: 'disabled',
              status: 'passed',
              exitCode: 0,
              stdout: '1 passed',
              stderr: '',
              startedAt: '2026-03-17T00:00:04.000Z',
              finishedAt: '2026-03-17T00:00:05.000Z',
              durationMs: 1000,
              reason: 'Focused unit test covers handoff derivation.',
              skippedReason: null
            }
          },
          createdAt: '2026-03-17T00:00:05.000Z'
        },
        {
          id: 'event-final',
          threadId: 'thread-1',
          runId: 'run-1',
          eventType: 'info',
          payload: {
            finalEvidenceSummary: {
              runId: 'run-1',
              usedMutatingTool: true,
              usedFileContentMutationTool: true,
              usedNativeWebResearchTool: false,
              postMutationVerificationRequired: true,
              postMutationVerificationPassed: true,
              verificationCommand: 'npm test -- src/shared/harness-handoff-state.test.ts',
              verificationStatus: 'passed',
              createdDirectoriesCount: 0,
              writtenFilesCount: 1,
              toolCallCount: 3,
              reminderCount: 0
            }
          },
          createdAt: '2026-03-17T00:00:06.000Z'
        }
      ]
    });

    expect(state).toMatchObject({
      threadId: 'thread-1',
      runId: 'run-1',
      taskContract: {
        objective: 'Implement Slice 7D handoff state.',
        taskKind: 'edit',
        expectedMutations: 'workspace_write',
        verificationPolicy: 'required',
        isolationMode: 'direct_workspace',
        riskLevel: 'medium'
      },
      workspace: {
        trustedWorkspace: true,
        workspaceRoot: 'C:/Users/test-user/Desktop/vicode-project',
        allowedPaths: ['src/shared'],
        deniedPaths: ['release']
      },
      change: {
        changedFiles: ['src/shared/harness-handoff-state.ts'],
        changedFileCount: 1,
        diffStats: {
          filesChanged: 1,
          insertions: 42,
          deletions: 3
        }
      },
      verification: {
        command: 'npm test -- src/shared/harness-handoff-state.test.ts',
        status: 'passed',
        skippedReason: null,
        reason: 'Focused unit test covers handoff derivation.'
      },
      finalEvidenceSummary: {
        postMutationVerificationPassed: true,
        writtenFilesCount: 1
      },
      recommendedNextAction: 'review_verified_changes',
      recommendedNextPrompt: 'Review the verified changes from run run-1 and decide whether to accept, revert, or continue.'
    });
  });

  it('includes context pressure, continuation, subagent summaries, and outstanding tasks without merging child state', () => {
    const followUps: ThreadFollowUp[] = [
      {
        id: 'follow-up-1',
        threadId: 'thread-1',
        content: 'Check the exported support report next.',
        metadata: null,
        kind: 'follow_up',
        status: 'queued',
        priority: 0,
        targetRunId: 'run-1',
        createdAt: '2026-03-17T00:00:07.000Z',
        updatedAt: '2026-03-17T00:00:07.000Z',
        dispatchedAt: null,
        cancelledAt: null
      }
    ];
    const state = deriveHarnessHandoffState({
      threadId: 'thread-1',
      runId: 'run-1',
      turns: [],
      followUps,
      subagents: [createSubagent()],
      rawOutput: [
        {
          id: 'event-progress',
          threadId: 'thread-1',
          runId: 'run-1',
          eventType: 'info',
          payload: {
            progressSnapshot: {
              items: [
                { id: '1', label: 'Inspect current events', order: 0, status: 'completed' },
                { id: '2', label: 'Write handoff export test', order: 1, status: 'in_progress' }
              ],
              diffStats: null,
              changeArtifact: null
            }
          },
          createdAt: '2026-03-17T00:00:03.000Z'
        },
        {
          id: 'event-context',
          threadId: 'thread-1',
          runId: 'run-1',
          eventType: 'info',
          payload: {
            harnessHookEvidence: {
              runId: 'run-1',
              stage: 'context_pressure',
              sequence: 1,
              at: '2026-03-17T00:00:04.000Z',
              contextPressureSeverity: 'warning',
              contextPressureCheckpointRecommended: true,
              contextPressureCompactionLikely: false,
              checkpointReminderTitle: 'Checkpoint recommended'
            }
          },
          createdAt: '2026-03-17T00:00:04.000Z'
        },
        {
          id: 'event-continuation',
          threadId: 'thread-1',
          runId: 'run-1',
          eventType: 'info',
          payload: {
            harnessHookEvidence: {
              runId: 'run-1',
              stage: 'continuation',
              sequence: 2,
              at: '2026-03-17T00:00:05.000Z',
              continuationReason: 'required_mutation',
              continuationReminderCount: 1,
              continuationMaxReminderCount: 2
            }
          },
          createdAt: '2026-03-17T00:00:05.000Z'
        }
      ]
    });

    expect(state.hooks).toEqual({
      stagesSeen: ['context_pressure', 'continuation'],
      continuationReasons: ['required_mutation'],
      contextPressureSeverity: 'warning',
      contextPressureCheckpointRecommended: true,
      contextPressureCompactionLikely: false
    });
    expect(state.subagents).toEqual([
      {
        id: 'subagent-1',
        parentRunId: 'run-1',
        childThreadId: 'thread-child',
        childRunId: 'run-child',
        status: 'completed',
        outputSummary: 'Found existing hook evidence and verification artifacts.',
        lastError: null
      }
    ]);
    expect(state.subagents[0]).not.toHaveProperty('prompt');
    expect(state.outstandingTasks).toEqual([
      'Write handoff export test',
      'Check the exported support report next.'
    ]);
    expect(state.recommendedNextAction).toBe('continue_required_work');
    expect(state.recommendedNextPrompt).toBe('Continue run run-1 from handoff evidence and address: required_mutation.');
  });
});
