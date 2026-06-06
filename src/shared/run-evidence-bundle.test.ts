import { describe, expect, it } from 'vitest';
import type {
  RunChangeArtifact,
  WorktreeCleanupDecision,
  WorktreeHunkReviewDecision,
  WorktreeReviewDecision
} from './domain';
import type { StagedWorkspaceHunkReviewDecision } from './hunk-review';
import { buildRunEvidenceBundleV1 } from './run-evidence-bundle';
import type { HarnessTaskContract } from './harness-task-contract';
import type { VerificationArtifact } from './harness-verification';

const taskContract: HarnessTaskContract = {
  taskKind: 'edit',
  objective: 'Implement EvidenceBundle-1 for C:\\Users\\fixture-user\\secret-repo with token-secret-123.',
  workspaceRoot: 'C:\\Users\\fixture-user\\secret-repo',
  allowedPaths: ['src/shared'],
  deniedPaths: ['C:\\Users\\fixture-user\\secret-repo\\.env'],
  expectedMutations: 'workspace_write',
  verificationPolicy: 'required',
  isolationMode: 'git_worktree',
  riskLevel: 'medium',
  executionPermission: 'full_access',
  trustedWorkspace: true,
  runtimeCommandPolicy: 'approval_required',
  runtimeNetworkPolicy: 'disabled',
  commandAccess: 'approval_required',
  networkAccess: 'disabled'
};

const verificationArtifact: VerificationArtifact = {
  command: 'npm test -- src/shared/run-evidence-bundle.test.ts',
  cwd: 'C:\\Users\\fixture-user\\secret-repo',
  permissionProfile: 'full_access',
  networkPolicy: 'disabled',
  status: 'passed',
  exitCode: 0,
  stdout: 'full terminal output with token-secret-123',
  stderr: 'stderr should stay out',
  startedAt: '2026-05-30T12:00:00.000Z',
  finishedAt: '2026-05-30T12:00:01.000Z',
  durationMs: 1000,
  reason: 'Focused unit coverage.',
  skippedReason: null
};

function createChangeArtifact(source: RunChangeArtifact['source']): RunChangeArtifact {
  return {
    source,
    summary: {
      filesChanged: 1,
      insertions: 12,
      deletions: 3
    },
    files: [
      {
        path: 'src/shared/run-evidence-bundle.ts',
        status: 'modified',
        insertions: 12,
        deletions: 3,
        beforeContent: 'old file content with token-secret-123',
        afterContent: 'new file content with token-secret-123',
        previewLines: [
          {
            type: 'added',
            oldLineNumber: null,
            newLineNumber: 1,
            text: 'preview text with token-secret-123'
          }
        ],
        previewTruncated: false
      }
    ]
  };
}

describe('buildRunEvidenceBundleV1', () => {
  it('builds a complete support-safe bundle from existing harness evidence', () => {
    const worktreeReviewDecision: WorktreeReviewDecision = {
      action: 'applied',
      status: 'applied',
      threadId: 'thread-1',
      runId: 'run-1',
      isolationMode: 'git_worktree',
      branchName: 'vicode/run-1',
      baseSha: 'abc123',
      sourceWorkspaceRelativePath: '.',
      changedPaths: ['src/shared/run-evidence-bundle.ts'],
      filesChanged: 1,
      insertions: 12,
      deletions: 3,
      errorReason: null,
      createdAt: '2026-05-30T12:00:02.000Z'
    };
    const worktreeCleanupDecision: WorktreeCleanupDecision = {
      action: 'cleaned',
      status: 'cleaned',
      threadId: 'thread-1',
      runId: 'run-1',
      isolationMode: 'git_worktree',
      branchName: 'vicode/run-1',
      baseSha: 'abc123',
      cleanupPolicy: 'delete_after_reject',
      reviewStatus: 'rejected',
      errorReason: null,
      createdAt: '2026-05-30T12:00:03.000Z'
    };
    const stagedHunkReviewDecision: StagedWorkspaceHunkReviewDecision = {
      action: 'applied',
      status: 'applied',
      threadId: 'thread-1',
      runId: 'run-1',
      source: 'staged_workspace_preview',
      isolationMode: 'patch_buffer',
      stagedEventId: 'event-1',
      stagedEventIndex: 0,
      changedPaths: ['src/shared/run-evidence-bundle.ts'],
      hunkIds: ['hunk-token-secret-123', 'hunk-2'],
      acceptedHunkIds: ['hunk-token-secret-123'],
      rejectedHunkIds: ['hunk-2'],
      filesChanged: 1,
      insertions: 5,
      deletions: 2,
      errorReason: 'Applied hunks from C:\\Users\\fixture-user\\secret-repo with token-secret-123.',
      createdAt: '2026-05-30T12:00:01.500Z'
    };
    const worktreeHunkReviewDecision: WorktreeHunkReviewDecision = {
      action: 'applied',
      status: 'applied',
      threadId: 'thread-1',
      runId: 'run-1',
      source: 'worktree_diff',
      isolationMode: 'git_worktree',
      branchName: 'vicode/run-1',
      baseSha: 'abc123',
      sourceWorkspaceRelativePath: '.',
      changedPaths: ['src/shared/run-evidence-bundle.ts'],
      hunkIds: ['worktree-hunk-token-secret-123', 'worktree-hunk-2'],
      acceptedHunkIds: ['worktree-hunk-token-secret-123'],
      rejectedHunkIds: ['worktree-hunk-2'],
      filesChanged: 1,
      insertions: 6,
      deletions: 2,
      errorReason: 'Applied worktree hunks from C:\\Users\\fixture-user\\secret-repo with token-secret-123.',
      createdAt: '2026-05-30T12:00:01.750Z'
    };

    const bundle = buildRunEvidenceBundleV1({
      identity: {
        threadId: 'thread-1',
        threadTitle: 'Harness evidence',
        projectId: 'project-1',
        providerId: 'openai',
        modelId: 'gpt-5',
        runId: 'run-1',
        status: 'completed',
        startedAt: '2026-05-30T12:00:00.000Z',
        completedAt: '2026-05-30T12:00:04.000Z',
        terminalStage: 'completed'
      },
      taskContract,
      promptEvidence: [
        {
          sectionId: 'system',
          title: 'System Prompt',
          placement: 'system',
          characterCount: 1200,
          reason: 'Static system prompt section from C:\\Users\\fixture-user\\secret-repo.'
        }
      ],
      modelRoutingEvidence: [
        {
          modelId: 'gpt-5',
          customProviderId: null,
          ollamaTransportMode: null,
          runMode: 'default',
          providerLabel: 'OpenAI',
          transportKind: 'responses_api',
          runtimeAuthority: 'provider_model_harness',
          reason: 'Selected by configured provider.'
        }
      ],
      toolRoutingEvidence: [
        {
          toolId: 'write_file',
          callName: 'write_file',
          name: 'Write file',
          origin: 'native',
          visibilityGroup: 'workspace',
          included: true,
          reason: 'Edit task allowed workspace writes.',
          mutatesWorkspace: true,
          requiresApproval: false,
          readsWorkspace: false,
          usesNetwork: false
        }
      ],
      infrastructureEvidence: [
        {
          infrastructureId: 'git_worktree',
          label: 'Git worktree',
          available: true,
          reason: 'Created app-owned worktree.',
          toolCallNames: ['write_file', 'run_command']
        }
      ],
      runtimeTrace: {
        marks: [
          { stage: 'submit_received', at: '2026-05-30T12:00:00.000Z' },
          { stage: 'worktree_session_created', at: '2026-05-30T12:00:00.100Z' },
          { stage: 'completed', at: '2026-05-30T12:00:04.000Z' }
        ]
      },
      toolExecution: {
        toolCallCount: 2,
        toolResultCount: 2,
        terminalCommandCount: 1,
        mutatingToolCallCount: 1,
        tools: [
          {
            toolName: 'write_file',
            callCount: 1,
            resultCount: 1,
            mutatesWorkspace: true,
            errorCount: 0
          }
        ],
        terminalCommands: [
          {
            command: 'npm test -- src/shared/run-evidence-bundle.test.ts',
            cwd: 'C:\\Users\\fixture-user\\secret-repo',
            status: 'passed',
            exitCode: 0,
            durationMs: 1000
          }
        ]
      },
      verificationArtifacts: [verificationArtifact],
      changeArtifacts: [
        createChangeArtifact('workspace_diff'),
        createChangeArtifact('staged_workspace_preview'),
        createChangeArtifact('worktree_diff')
      ],
      stagedReviewDecisions: [
        {
          action: 'reverted',
          status: 'reverted',
          threadId: 'thread-1',
          runId: 'run-1',
          stagedEventId: 'event-1',
          stagedEventIndex: 0,
          sourceToolName: 'write_file',
          isolationMode: 'patch_buffer',
          changedPaths: ['src/shared/run-evidence-bundle.ts'],
          operationKinds: ['write_file'],
          errorReason: null,
          createdAt: '2026-05-30T12:00:01.000Z'
        }
      ],
      stagedHunkReviewDecisions: [stagedHunkReviewDecision],
      worktreeReviewDecisions: [worktreeReviewDecision],
      worktreeHunkReviewDecisions: [worktreeHunkReviewDecision],
      worktreeCleanupDecisions: [worktreeCleanupDecision],
      hookEvidence: [
        {
          stage: 'after_verification',
          sequence: 3,
          at: '2026-05-30T12:00:02.000Z',
          summary: 'Verification passed.',
          verificationStatus: 'passed'
        }
      ],
      finalEvidenceSummary: {
        runId: 'run-1',
        usedMutatingTool: true,
        usedFileContentMutationTool: true,
        usedNativeWebResearchTool: false,
        postMutationVerificationRequired: true,
        postMutationVerificationPassed: true,
        verificationCommand: 'npm test -- src/shared/run-evidence-bundle.test.ts',
        verificationStatus: 'passed',
        createdDirectoriesCount: 0,
        writtenFilesCount: 1,
        toolCallCount: 2,
        reminderCount: 0
      },
      handoffState: {
        threadId: 'thread-1',
        runId: 'run-1',
        createdAt: '2026-05-30T12:00:04.000Z',
        taskContract: {
          objective: 'Implement EvidenceBundle-1.',
          taskKind: 'edit',
          expectedMutations: 'workspace_write',
          verificationPolicy: 'required',
          isolationMode: 'git_worktree',
          riskLevel: 'medium'
        },
        workspace: {
          trustedWorkspace: true,
          workspaceRoot: 'C:\\Users\\fixture-user\\secret-repo',
          allowedPaths: ['src/shared'],
          deniedPaths: []
        },
        change: {
          changedFiles: ['src/shared/run-evidence-bundle.ts'],
          diffStats: { filesChanged: 1, insertions: 12, deletions: 3 },
          changedFileCount: 1
        },
        verification: {
          command: 'npm test -- src/shared/run-evidence-bundle.test.ts',
          status: 'passed',
          skippedReason: null,
          reason: 'Focused unit coverage.'
        },
        finalEvidenceSummary: null,
        hooks: {
          stagesSeen: ['after_verification'],
          continuationReasons: [],
          contextPressureSeverity: null,
          contextPressureCheckpointRecommended: null,
          contextPressureCompactionLikely: null
        },
        subagents: [],
        outstandingTasks: [],
        recommendedNextAction: 'review_verified_changes',
        recommendedNextPrompt: 'Review verified changes.'
      }
    });

    expect(bundle).toMatchObject({
      schemaVersion: 1,
      identity: {
        runId: 'run-1',
        terminalStage: 'completed'
      },
      taskContractSummary: {
        taskKind: 'edit',
        isolationMode: 'git_worktree',
        workspaceRoot: '[local-path]',
        deniedPaths: ['[local-path]']
      },
      promptEvidence: {
        sections: [
          {
            sectionId: 'system',
            characterCount: 1200
          }
        ]
      },
      verificationEvidence: {
        artifacts: [
          {
            status: 'passed',
            exitCode: 0
          }
        ]
      },
      changeReviewEvidence: {
        changeArtifacts: [
          { source: 'workspace_diff' },
          { source: 'staged_workspace_preview' },
          { source: 'worktree_diff' }
        ],
        stagedReviewDecisions: [
          {
            action: 'reverted',
            status: 'reverted'
          }
        ],
        stagedHunkReviewDecisions: [
          {
            action: 'applied',
            status: 'applied',
            hunkIds: ['hunk-[redacted-secret]', 'hunk-2'],
            acceptedHunkIds: ['hunk-[redacted-secret]'],
            rejectedHunkIds: ['hunk-2']
          }
        ],
        worktreeReviewDecisions: [
          {
            action: 'applied',
            status: 'applied'
          }
        ],
        worktreeHunkReviewDecisions: [
          {
            action: 'applied',
            status: 'applied',
            hunkIds: ['worktree-hunk-[redacted-secret]', 'worktree-hunk-2'],
            acceptedHunkIds: ['worktree-hunk-[redacted-secret]'],
            rejectedHunkIds: ['worktree-hunk-2']
          }
        ]
      },
      worktreeCleanupEvidence: {
        latestDecision: {
          action: 'cleaned',
          status: 'cleaned'
        }
      },
      finalEvidenceSummary: {
        postMutationVerificationPassed: true
      },
      handoffState: {
        recommendedNextAction: 'review_verified_changes'
      }
    });

    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('C:\\Users\\fixture-user');
    expect(serialized).not.toContain('token-secret-123');
    expect(serialized).not.toContain('full terminal output');
    expect(serialized).not.toContain('stderr should stay out');
    expect(serialized).not.toContain('old file content');
    expect(serialized).not.toContain('new file content');
    expect(serialized).not.toContain('preview text');
    expect(serialized).not.toContain('token-secret-123');
    expect(serialized).not.toContain('beforeContent');
    expect(serialized).not.toContain('afterContent');
    expect(serialized).not.toContain('patchText');
    expect(serialized).not.toContain('previewLines');
  });

  it('builds a partial bundle for historical runs with explicit limitations', () => {
    const bundle = buildRunEvidenceBundleV1({
      identity: {
        threadId: 'thread-old',
        runId: 'run-old'
      }
    });

    expect(bundle.taskContractSummary).toBeNull();
    expect(bundle.promptEvidence.sections).toEqual([]);
    expect(bundle.modelRoutingEvidence).toEqual([]);
    expect(bundle.toolRoutingEvidence).toEqual([]);
    expect(bundle.infrastructureEvidence).toEqual([]);
    expect(bundle.verificationEvidence.artifacts).toEqual([]);
    expect(bundle.finalEvidenceSummary).toBeNull();
    expect(bundle.handoffState).toBeNull();
    expect(bundle.limitations).toContain('Some historical runs may not have all evidence sections.');
    expect(bundle.limitations).toContain('Task contract evidence is missing for this run.');
  });

  it('summarizes failed-run runtime evidence without leaking unsafe detail', () => {
    const bundle = buildRunEvidenceBundleV1({
      identity: {
        threadId: 'thread-1',
        providerId: 'openai',
        runId: 'run-failed',
        status: 'failed',
        failedAt: '2026-05-30T12:00:02.000Z'
      },
      runtimeTrace: {
        marks: [
          { stage: 'submit_received', at: '2026-05-30T12:00:00.000Z' },
          {
            stage: 'failed',
            at: '2026-05-30T12:00:02.000Z',
            detail: {
              message: 'Failed in C:\\Users\\fixture-user\\secret-repo with token-secret-123.',
              reason: 'provider_error'
            }
          }
        ]
      },
      failedRun: {
        failureStage: 'failed',
        failureMessage: 'Provider payload included token-secret-123.',
        failureReason: 'provider_error'
      }
    });

    expect(bundle.runtimeTraceSummary).toMatchObject({
      stageCount: 2,
      terminalStage: 'failed',
      failureStage: 'failed',
      failureMessage: 'Provider payload included [redacted-secret].',
      failureReason: 'provider_error'
    });
    expect(JSON.stringify(bundle)).not.toContain('C:\\Users\\fixture-user');
    expect(JSON.stringify(bundle)).not.toContain('token-secret-123');
  });
});
