import { describe, expect, it } from 'vitest';
import { collectRunProgressDiagnostics } from './diagnostics-run-progress';
import { createSubagentSummary, createThreadDetail } from './diagnostics-test-fixtures';

function collectFixtureDiagnostics() {
  const thread = createThreadDetail();
  return collectRunProgressDiagnostics({
    db: {
      listProjects: () => [{ id: 'project-1' }],
      listThreads: (_projectId: string) => [{ id: thread.id }],
      listArchivedThreads: (_projectId?: string | null) => [],
      getThread: () => thread,
      listSubagentsByParentThread: () => [createSubagentSummary()]
    },
    threadIds: ['thread-1']
  });
}

describe('collectRunProgressDiagnostics review payload extraction', () => {
  it('collects staged workspace and worktree review payloads', () => {
    const diagnostics = collectFixtureDiagnostics();

    expect(diagnostics.stagedWorkspaceChangeDiagnostics).toEqual([
      expect.objectContaining({
        threadId: 'thread-1',
        threadTitle: 'Codex planning thread',
        providerId: 'openai',
        runId: 'run-1',
        createdAt: '2026-03-17T00:00:06.260Z',
        sourceToolName: 'write_file',
        isolationMode: 'patch_buffer',
        status: 'proposed',
        requestedPath: 'src/new-widget.ts',
        changedPaths: ['src/new-widget.ts'],
        operationCount: 1,
        operationKinds: ['write_file'],
        filesChanged: 1,
        insertions: 4,
        deletions: 0
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        threadTitle: 'Codex planning thread',
        providerId: 'openai',
        runId: 'run-1',
        createdAt: '2026-03-17T00:00:06.270Z',
        sourceToolName: 'apply_patch',
        isolationMode: 'patch_buffer',
        status: 'proposed',
        requestedPath: null,
        changedPaths: ['src/existing.ts', 'src/remove-me.ts'],
        operationCount: 2,
        operationKinds: ['apply_patch', 'delete'],
        filesChanged: 2,
        insertions: 5,
        deletions: 3
      })
    ]);
    expect(diagnostics.stagedWorkspaceHunkReviewDecisionDiagnostics).toEqual([
      expect.objectContaining({
        threadId: 'thread-1',
        threadTitle: 'Codex planning thread',
        providerId: 'openai',
        runId: 'run-1',
        createdAt: '2026-03-17T00:00:06.276Z',
        action: 'applied',
        status: 'applied',
        source: 'staged_workspace_preview',
        isolationMode: 'patch_buffer',
        stagedEventId: 'event-5b-staged-patch',
        stagedEventIndex: 1,
        changedPaths: ['src/existing.ts'],
        hunkIds: ['hunk-1', 'hunk-2'],
        acceptedHunkIds: ['hunk-1'],
        rejectedHunkIds: ['hunk-2'],
        hunkCount: 2,
        acceptedHunkCount: 1,
        rejectedHunkCount: 1,
        filesChanged: 1,
        insertions: 3,
        deletions: 1,
        errorReason: null
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-5',
        action: 'applied',
        status: 'failed',
        source: 'staged_workspace_preview',
        isolationMode: 'patch_buffer',
        changedPaths: ['[redacted-path]', 'src/hunk-failed.ts'],
        hunkIds: ['[redacted-path]', 'hunk-failed'],
        acceptedHunkIds: ['[redacted-path]'],
        rejectedHunkIds: ['hunk-failed'],
        hunkCount: 2,
        acceptedHunkCount: 1,
        rejectedHunkCount: 1,
        filesChanged: 2,
        insertions: 2,
        deletions: 2,
        errorReason: 'Workspace drift in [redacted-path]'
      })
    ]);
    expect(diagnostics.worktreeChangeDiagnostics).toEqual([
      expect.objectContaining({
        threadId: 'thread-1',
        threadTitle: 'Codex planning thread',
        providerId: 'openai',
        runId: 'run-1',
        createdAt: '2026-03-17T00:00:06.280Z',
        isolationMode: 'git_worktree',
        status: 'ready',
        reviewStatus: 'pending',
        cleanupPolicy: 'preserve_until_review',
        sourceWorkspaceRelativePath: 'packages/app',
        branchName: 'vicode/worktree/project-1/run-1',
        baseRef: 'HEAD',
        baseSha: 'abc123',
        filesChanged: 2,
        insertions: 9,
        deletions: 3,
        changedPaths: ['src/worktree.ts', 'src/remove-me.ts']
      })
    ]);
    expect(diagnostics.worktreeReviewDecisionDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        action: 'applied',
        status: 'applied',
        isolationMode: 'git_worktree',
        branchName: 'vicode/worktree/project-1/run-1',
        baseSha: 'abc123',
        sourceWorkspaceRelativePath: 'packages/app',
        changedPaths: ['src/worktree.ts', 'src/remove-me.ts'],
        filesChanged: 2,
        insertions: 9,
        deletions: 3,
        errorReason: null
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-4',
        action: 'rejected',
        status: 'rejected',
        changedPaths: ['src/rejected.ts'],
        filesChanged: 1,
        insertions: 2,
        deletions: 0,
        errorReason: null
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        action: 'reverted',
        status: 'reverted',
        changedPaths: ['src/worktree.ts', 'src/remove-me.ts'],
        filesChanged: 2,
        insertions: 9,
        deletions: 3,
        errorReason: null
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-5',
        action: 'applied',
        status: 'failed',
        branchName: 'vicode/worktree/project-1/run-5',
        baseSha: 'fed789',
        sourceWorkspaceRelativePath: 'packages/app',
        changedPaths: ['[redacted-path]', 'src/failed.ts'],
        filesChanged: 1,
        insertions: 1,
        deletions: 1,
        errorReason: 'Workspace drift in [redacted-path]'
      })
    ]));
    expect(diagnostics.worktreeHunkReviewDecisionDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        action: 'applied',
        status: 'applied',
        source: 'worktree_diff',
        isolationMode: 'git_worktree',
        branchName: 'vicode/worktree/project-1/run-1',
        baseSha: 'abc123',
        sourceWorkspaceRelativePath: 'packages/app',
        changedPaths: ['src/worktree.ts'],
        hunkIds: ['worktree-hunk-1', 'worktree-hunk-2'],
        acceptedHunkIds: ['worktree-hunk-1'],
        rejectedHunkIds: ['worktree-hunk-2'],
        hunkCount: 2,
        acceptedHunkCount: 1,
        rejectedHunkCount: 1,
        filesChanged: 1,
        insertions: 4,
        deletions: 1,
        errorReason: null
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-5',
        action: 'applied',
        status: 'failed',
        source: 'worktree_diff',
        isolationMode: 'git_worktree',
        branchName: 'vicode/worktree/project-1/run-5',
        baseSha: 'fed789',
        sourceWorkspaceRelativePath: 'packages/app',
        changedPaths: ['[redacted-path]', 'src/worktree-hunk-failed.ts'],
        hunkIds: ['[redacted-path]', 'worktree-hunk-failed'],
        acceptedHunkIds: ['[redacted-path]'],
        rejectedHunkIds: ['worktree-hunk-failed'],
        hunkCount: 2,
        acceptedHunkCount: 1,
        rejectedHunkCount: 1,
        filesChanged: 2,
        insertions: 2,
        deletions: 2,
        errorReason: 'Workspace drift in [redacted-path]'
      })
    ]));
    expect(diagnostics.worktreeCleanupDecisionDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        action: 'cleaned',
        status: 'cleaned',
        isolationMode: 'git_worktree',
        branchName: 'vicode/worktree/project-1/run-1',
        baseSha: 'abc123',
        cleanupPolicy: 'preserve_until_review',
        reviewStatus: 'reverted',
        errorReason: null
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-5',
        action: 'failed',
        status: 'failed',
        branchName: 'vicode/worktree/project-1/run-5',
        baseSha: 'fed789',
        cleanupPolicy: 'preserve_until_review',
        reviewStatus: 'failed',
        errorReason: 'Cleanup failed in [redacted-path]'
      })
    ]));
  });

  it('collects hook, handoff, runtime trace, failure, and run evidence bundle payloads', () => {
    const diagnostics = collectFixtureDiagnostics();

    expect(diagnostics.harnessHookEvidenceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        threadTitle: 'Codex planning thread',
        providerId: 'openai',
        runId: 'run-1',
        createdAt: '2026-03-17T00:00:06.300Z',
        stage: 'before_verification',
        sequence: 7,
        turnIndex: 1,
        toolName: 'run_command',
        summary: 'Calling planned post-mutation verification command',
        isError: false,
        mutatesWorkspace: false,
        verificationCommand: 'npm test -- C:/Users/test-user/Desktop/vicode-project/src/app.test.ts',
        verificationStatus: null
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        threadTitle: 'Codex planning thread',
        providerId: 'openai',
        runId: 'run-1',
        createdAt: '2026-03-17T00:00:06.600Z',
        stage: 'context_pressure',
        sequence: 8,
        turnIndex: null,
        summary: 'Context pressure checkpoint recommended',
        contextPressureSeverity: 'warning',
        contextPressureUsagePercent: 82,
        contextPressureUsedTokens: 820000,
        contextPressureMaxTokens: 1000000,
        contextPressureSource: 'provider',
        contextPressureSourceLabel: 'OpenAI reported usage',
        contextPressureCheckpointRecommended: true,
        contextPressureCompactionLikely: false,
        checkpointReminderKind: 'context_pressure',
        checkpointReminderTitle: 'Checkpoint recommended',
        checkpointReminderSummary: 'Capture a note for C:/Users/test-user/Desktop/vicode-project before another heavy turn.'
      })
    ]));
    expect(diagnostics.finalEvidenceSummaryDiagnostics).toEqual([
      expect.objectContaining({
        threadId: 'thread-1',
        threadTitle: 'Codex planning thread',
        providerId: 'openai',
        runId: 'run-1',
        createdAt: '2026-03-17T00:00:06.500Z',
        usedMutatingTool: true,
        usedFileContentMutationTool: true,
        usedNativeWebResearchTool: false,
        postMutationVerificationRequired: true,
        postMutationVerificationPassed: true,
        verificationCommand: 'npm test -- C:/Users/test-user/Desktop/vicode-project/src/app.test.ts',
        verificationStatus: 'passed',
        createdDirectoriesCount: 0,
        writtenFilesCount: 1,
        toolCallCount: 2,
        reminderCount: 1
      })
    ]);
    expect(diagnostics.harnessHandoffStateDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        taskContract: expect.objectContaining({
          objective: 'Implement the harness handoff state.',
          taskKind: 'edit',
          expectedMutations: 'workspace_write',
          verificationPolicy: 'required',
          isolationMode: 'direct_workspace',
          riskLevel: 'medium'
        }),
        workspace: expect.objectContaining({
          trustedWorkspace: true,
          workspaceRoot: 'C:/Users/test-user/Desktop/vicode-project',
          allowedPaths: ['src/shared', 'src/main/services'],
          deniedPaths: ['release']
        }),
        change: expect.objectContaining({
          changedFiles: ['src/shared/harness-handoff-state.ts'],
          changedFileCount: 1,
          diffStats: {
            filesChanged: 1,
            insertions: 42,
            deletions: 3
          }
        }),
        verification: expect.objectContaining({
          command: 'npm test -- C:/Users/test-user/Desktop/vicode-project/src/app.test.ts',
          status: 'passed',
          skippedReason: null
        }),
        hooks: expect.objectContaining({
          stagesSeen: ['before_verification', 'context_pressure'],
          contextPressureSeverity: 'warning',
          contextPressureCheckpointRecommended: true,
          contextPressureCompactionLikely: false
        }),
        subagents: [
          {
            id: 'subagent-1',
            parentRunId: 'run-1',
            childThreadId: 'thread-child',
            childRunId: 'run-child',
            status: 'completed',
            outputSummary: 'Found existing hook evidence and verification artifacts.',
            lastError: null
          }
        ],
        outstandingTasks: ['Wire'],
        recommendedNextAction: 'continue_outstanding_tasks'
      })
    ]));
    expect(diagnostics.runtimeTraceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        stageCount: 13,
        terminalStage: 'completed',
        submitToContextCompleteMs: 150,
        contextAssemblyMs: 100,
        submitToPromptAssembledMs: 180,
        submitToRunStartedMs: 250,
        submitToFirstDeltaMs: 350,
        submitToFirstToolCallMs: 450,
        submitToFirstToolResultMs: 650,
        submitToTerminalMs: 1000,
        marks: expect.arrayContaining([
          expect.objectContaining({ stage: 'submit_received' }),
          expect.objectContaining({
            stage: 'worktree_session_created',
            detail: {
              harnessWorktreeSession: {
                branchName: 'vicode/worktree/project-1/run-1',
                sourceWorkspaceRelativePath: 'packages/app'
              }
            }
          }),
          expect.objectContaining({ stage: 'completed' })
        ])
      })
    ]));
    expect(diagnostics.failedRunDiagnostics).toEqual([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-2',
        failureStage: 'failed',
        failureMessage: 'Ollama completed without producing assistant output.',
        failureReason: 'empty_output',
        hadAssistantOutput: false,
        lastThinkingSummary: 'Thinking about the next step',
        lastProviderEventType: 'message/tool_calls',
        lastProviderPaths: ['index.html'],
        toolCallCount: 1,
        toolResultCount: 1,
        terminalCommandCount: 0,
        lastToolName: 'read_file',
        lastToolCallSummary: 'Calling read_file',
        lastToolResultSummary: 'Completed read_file',
        lastTerminalCommand: null
      })
    ]);
    expect(diagnostics.runEvidenceBundles.map((bundle) => bundle.identity.runId).sort()).toEqual([
      'run-1',
      'run-2',
      'run-3',
      'run-4',
      'run-5'
    ]);
    expect(diagnostics.runEvidenceBundles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        identity: expect.objectContaining({
          threadId: 'thread-1',
          threadTitle: 'Codex planning thread',
          providerId: 'openai',
          modelId: 'gpt-5',
          runId: 'run-1',
          terminalStage: 'completed'
        }),
        taskContractSummary: expect.objectContaining({
          taskKind: 'edit',
          isolationMode: 'direct_workspace',
          workspaceRoot: '[local-path]'
        }),
        promptEvidence: expect.objectContaining({
          sectionCount: 2
        }),
        runtimeTraceSummary: expect.objectContaining({
          stageCount: 13,
          terminalStage: 'completed'
        }),
        verificationEvidence: expect.objectContaining({
          artifactCount: 1,
          latestStatus: 'passed'
        }),
        changeReviewEvidence: expect.objectContaining({
          stagedReviewDecisions: expect.arrayContaining([
            expect.objectContaining({
              action: 'applied',
              status: 'applied',
              operationKinds: ['apply_patch', 'delete']
            })
          ]),
          worktreeReviewDecisions: expect.arrayContaining([
            expect.objectContaining({ action: 'applied', status: 'applied' }),
            expect.objectContaining({ action: 'reverted', status: 'reverted' })
          ])
        }),
        worktreeCleanupEvidence: expect.objectContaining({
          latestDecision: expect.objectContaining({
            action: 'cleaned',
            status: 'cleaned'
          })
        }),
        hookEvidence: expect.objectContaining({
          stagesSeen: ['before_verification', 'context_pressure']
        }),
        finalEvidenceSummary: expect.objectContaining({
          postMutationVerificationPassed: true
        }),
        handoffState: expect.objectContaining({
          recommendedNextAction: 'continue_outstanding_tasks'
        })
      }),
      expect.objectContaining({
        identity: expect.objectContaining({
          runId: 'run-2',
          status: 'failed',
          terminalStage: 'failed'
        }),
        taskContractSummary: null,
        limitations: expect.arrayContaining([
          'Task contract evidence is missing for this run.',
          'Some historical runs may not have all evidence sections.'
        ]),
        runtimeTraceSummary: expect.objectContaining({
          failureMessage: 'Ollama completed without producing assistant output.',
          failureReason: 'empty_output'
        })
      })
    ]));

    const serializedDiagnostics = JSON.stringify(diagnostics);
    expect(serializedDiagnostics).not.toMatch(/PRIVATE_[A-Z0-9_]+/u);
    expect(serializedDiagnostics).not.toContain('C:/Users/test-user/Desktop/vicode-project/src/private.ts');
  });
});
