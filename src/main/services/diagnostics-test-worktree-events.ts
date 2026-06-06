import type { RunEvent } from '../../shared/domain';

export function createDiagnosticsWorktreeEvents(): RunEvent[] {
  return [
      {
        id: 'event-5b-worktree-change',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          worktreeChangeEvidence: {
            threadId: 'thread-1',
            runId: 'run-1',
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
          }
        },
        createdAt: '2026-03-17T00:00:06.280Z'
      },
      {
        id: 'event-5b-worktree-review-applied',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          worktreeReviewDecision: {
            action: 'applied',
            status: 'applied',
            threadId: 'thread-1',
            runId: 'run-1',
            isolationMode: 'git_worktree',
            branchName: 'vicode/worktree/project-1/run-1',
            baseSha: 'abc123',
            sourceWorkspaceRelativePath: 'packages/app',
            changedPaths: ['src/worktree.ts', 'src/remove-me.ts'],
            filesChanged: 2,
            insertions: 9,
            deletions: 3,
            errorReason: null,
            createdAt: '2026-03-17T00:00:06.281Z',
            sourceRepoRoot: 'PRIVATE_WORKTREE_REVIEW_SOURCE_REPO_ROOT',
            sourceWorkspaceRoot: 'PRIVATE_WORKTREE_REVIEW_SOURCE_ROOT',
            worktreeRepoRoot: 'PRIVATE_WORKTREE_REVIEW_REPO_ROOT',
            worktreeWorkspaceRoot: 'PRIVATE_WORKTREE_REVIEW_RUNTIME_ROOT',
            beforeContent: 'PRIVATE_WORKTREE_REVIEW_BEFORE_CONTENT',
            afterContent: 'PRIVATE_WORKTREE_REVIEW_AFTER_CONTENT',
            patchText: 'PRIVATE_WORKTREE_REVIEW_PATCH_TEXT',
            previewLines: [{ text: 'PRIVATE_WORKTREE_REVIEW_PREVIEW_LINE' }]
          }
        },
        createdAt: '2026-03-17T00:00:06.281Z'
      },
      {
        id: 'event-5b-worktree-review-rejected',
        threadId: 'thread-1',
        runId: 'run-4',
        eventType: 'info',
        payload: {
          worktreeReviewDecision: {
            action: 'rejected',
            status: 'rejected',
            threadId: 'thread-1',
            runId: 'run-4',
            isolationMode: 'git_worktree',
            branchName: 'vicode/worktree/project-1/run-4',
            baseSha: 'def456',
            sourceWorkspaceRelativePath: 'packages/app',
            changedPaths: ['src/rejected.ts'],
            filesChanged: 1,
            insertions: 2,
            deletions: 0,
            errorReason: null,
            createdAt: '2026-03-17T00:00:06.282Z'
          }
        },
        createdAt: '2026-03-17T00:00:06.282Z'
      },
      {
        id: 'event-5b-worktree-review-reverted',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          worktreeReviewDecision: {
            action: 'reverted',
            status: 'reverted',
            threadId: 'thread-1',
            runId: 'run-1',
            isolationMode: 'git_worktree',
            branchName: 'vicode/worktree/project-1/run-1',
            baseSha: 'abc123',
            sourceWorkspaceRelativePath: 'packages/app',
            changedPaths: ['src/worktree.ts', 'src/remove-me.ts'],
            filesChanged: 2,
            insertions: 9,
            deletions: 3,
            errorReason: null,
            createdAt: '2026-03-17T00:00:06.283Z'
          }
        },
        createdAt: '2026-03-17T00:00:06.283Z'
      },
      {
        id: 'event-5b-worktree-review-failed',
        threadId: 'thread-1',
        runId: 'run-5',
        eventType: 'info',
        payload: {
          worktreeReviewDecision: {
            action: 'applied',
            status: 'failed',
            threadId: 'thread-1',
            runId: 'run-5',
            isolationMode: 'git_worktree',
            branchName: 'vicode/worktree/project-1/run-5',
            baseSha: 'fed789',
            sourceWorkspaceRelativePath: 'packages/app',
            changedPaths: [
              'C:/Users/test-user/Desktop/vicode-project/src/private.ts',
              'src/failed.ts'
            ],
            filesChanged: 1,
            insertions: 1,
            deletions: 1,
            errorReason: 'Workspace drift in C:/Users/test-user/Desktop/vicode-project/src/private.ts',
            createdAt: '2026-03-17T00:00:06.284Z',
            sourceRepoRoot: 'C:/Users/test-user/Desktop/vicode-project',
            sourceWorkspaceRoot: 'C:/Users/test-user/Desktop/vicode-project/packages/app',
            worktreeRepoRoot: 'C:/Users/test-user/AppData/Roaming/Vicode/worktrees/run-5',
            worktreeWorkspaceRoot: 'C:/Users/test-user/AppData/Roaming/Vicode/worktrees/run-5/packages/app',
            beforeContent: 'PRIVATE_WORKTREE_REVIEW_FAILED_BEFORE_CONTENT',
            afterContent: 'PRIVATE_WORKTREE_REVIEW_FAILED_AFTER_CONTENT',
            patchText: 'PRIVATE_WORKTREE_REVIEW_FAILED_PATCH_TEXT',
            previewLines: [{ text: 'PRIVATE_WORKTREE_REVIEW_FAILED_PREVIEW_LINE' }]
          }
        },
        createdAt: '2026-03-17T00:00:06.284Z'
      },
      {
        id: 'event-5b-worktree-hunk-review-applied',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          worktreeHunkReviewDecision: {
            action: 'applied',
            status: 'applied',
            threadId: 'thread-1',
            runId: 'run-1',
            source: 'worktree_diff',
            isolationMode: 'git_worktree',
            branchName: 'vicode/worktree/project-1/run-1',
            baseSha: 'abc123',
            sourceWorkspaceRelativePath: 'packages/app',
            changedPaths: ['src/worktree.ts'],
            hunkIds: ['worktree-hunk-1', 'worktree-hunk-2'],
            acceptedHunkIds: ['worktree-hunk-1'],
            rejectedHunkIds: ['worktree-hunk-2'],
            filesChanged: 1,
            insertions: 4,
            deletions: 1,
            errorReason: null,
            createdAt: '2026-03-17T00:00:06.284Z',
            sourceRepoRoot: 'PRIVATE_WORKTREE_HUNK_SOURCE_REPO_ROOT',
            sourceWorkspaceRoot: 'PRIVATE_WORKTREE_HUNK_SOURCE_ROOT',
            worktreeRepoRoot: 'PRIVATE_WORKTREE_HUNK_REPO_ROOT',
            worktreeWorkspaceRoot: 'PRIVATE_WORKTREE_HUNK_RUNTIME_ROOT',
            beforeContent: 'PRIVATE_WORKTREE_HUNK_BEFORE_CONTENT',
            afterContent: 'PRIVATE_WORKTREE_HUNK_AFTER_CONTENT',
            patchText: 'PRIVATE_WORKTREE_HUNK_PATCH_TEXT',
            previewLines: [{ text: 'PRIVATE_WORKTREE_HUNK_PREVIEW_LINE' }]
          }
        },
        createdAt: '2026-03-17T00:00:06.284Z'
      },
      {
        id: 'event-5b-worktree-hunk-review-failed',
        threadId: 'thread-1',
        runId: 'run-5',
        eventType: 'info',
        payload: {
          worktreeHunkReviewDecision: {
            action: 'applied',
            status: 'failed',
            threadId: 'thread-1',
            runId: 'run-5',
            source: 'worktree_diff',
            isolationMode: 'git_worktree',
            branchName: 'vicode/worktree/project-1/run-5',
            baseSha: 'fed789',
            sourceWorkspaceRelativePath: 'packages/app',
            changedPaths: [
              'C:/Users/test-user/Desktop/vicode-project/src/private-hunk.ts',
              'src/worktree-hunk-failed.ts'
            ],
            hunkIds: [
              'C:/Users/test-user/Desktop/vicode-project/src/private-hunk.ts:hunk-1',
              'worktree-hunk-failed'
            ],
            acceptedHunkIds: ['C:/Users/test-user/Desktop/vicode-project/src/private-hunk.ts:hunk-1'],
            rejectedHunkIds: ['worktree-hunk-failed'],
            filesChanged: 2,
            insertions: 2,
            deletions: 2,
            errorReason: 'Workspace drift in C:/Users/test-user/Desktop/vicode-project/src/private-hunk.ts',
            createdAt: '2026-03-17T00:00:06.284Z',
            sourceRepoRoot: 'C:/Users/test-user/Desktop/vicode-project',
            sourceWorkspaceRoot: 'C:/Users/test-user/Desktop/vicode-project/packages/app',
            worktreeRepoRoot: 'C:/Users/test-user/AppData/Roaming/Vicode/worktrees/run-5',
            worktreeWorkspaceRoot: 'C:/Users/test-user/AppData/Roaming/Vicode/worktrees/run-5/packages/app',
            beforeContent: 'PRIVATE_WORKTREE_HUNK_FAILED_BEFORE_CONTENT',
            afterContent: 'PRIVATE_WORKTREE_HUNK_FAILED_AFTER_CONTENT',
            patchText: 'PRIVATE_WORKTREE_HUNK_FAILED_PATCH_TEXT',
            previewLines: [{ text: 'PRIVATE_WORKTREE_HUNK_FAILED_PREVIEW_LINE' }]
          }
        },
        createdAt: '2026-03-17T00:00:06.284Z'
      },
      {
        id: 'event-5b-worktree-cleanup-cleaned',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          worktreeCleanupDecision: {
            action: 'cleaned',
            status: 'cleaned',
            threadId: 'thread-1',
            runId: 'run-1',
            isolationMode: 'git_worktree',
            branchName: 'vicode/worktree/project-1/run-1',
            baseSha: 'abc123',
            cleanupPolicy: 'preserve_until_review',
            reviewStatus: 'reverted',
            errorReason: null,
            createdAt: '2026-03-17T00:00:06.285Z',
            sourceRepoRoot: 'PRIVATE_WORKTREE_CLEANUP_SOURCE_REPO_ROOT',
            sourceWorkspaceRoot: 'PRIVATE_WORKTREE_CLEANUP_SOURCE_ROOT',
            worktreeRepoRoot: 'PRIVATE_WORKTREE_CLEANUP_REPO_ROOT',
            worktreeWorkspaceRoot: 'PRIVATE_WORKTREE_CLEANUP_RUNTIME_ROOT',
            beforeContent: 'PRIVATE_WORKTREE_CLEANUP_BEFORE_CONTENT',
            afterContent: 'PRIVATE_WORKTREE_CLEANUP_AFTER_CONTENT',
            patchText: 'PRIVATE_WORKTREE_CLEANUP_PATCH_TEXT',
            previewLines: [{ text: 'PRIVATE_WORKTREE_CLEANUP_PREVIEW_LINE' }]
          }
        },
        createdAt: '2026-03-17T00:00:06.285Z'
      },
      {
        id: 'event-5b-worktree-cleanup-failed',
        threadId: 'thread-1',
        runId: 'run-5',
        eventType: 'info',
        payload: {
          worktreeCleanupDecision: {
            action: 'failed',
            status: 'failed',
            threadId: 'thread-1',
            runId: 'run-5',
            isolationMode: 'git_worktree',
            branchName: 'vicode/worktree/project-1/run-5',
            baseSha: 'fed789',
            cleanupPolicy: 'preserve_until_review',
            reviewStatus: 'failed',
            errorReason: 'Cleanup failed in C:/Users/test-user/AppData/Roaming/Vicode/worktrees/run-5',
            createdAt: '2026-03-17T00:00:06.286Z',
            sourceRepoRoot: 'C:/Users/test-user/Desktop/vicode-project',
            worktreeRepoRoot: 'C:/Users/test-user/AppData/Roaming/Vicode/worktrees/run-5'
          }
        },
        createdAt: '2026-03-17T00:00:06.286Z'
      },
      {
        id: 'event-5b-worktree-artifact',
        threadId: 'thread-1',
        runId: 'run-3',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'change_summary',
            summary: '1 file changed in worktree',
            changeArtifact: {
              source: 'worktree_diff',
              summary: {
                filesChanged: 1,
                insertions: 1,
                deletions: 1
              },
              files: [
                {
                  path: 'src/worktree.ts',
                  status: 'modified',
                  insertions: 1,
                  deletions: 1,
                  beforeContent: 'PRIVATE_WORKTREE_BEFORE_CONTENT',
                  afterContent: 'PRIVATE_WORKTREE_AFTER_CONTENT',
                  previewLines: [],
                  previewTruncated: false
                }
              ]
            }
          }
        },
        createdAt: '2026-03-17T00:00:06.290Z'
      },
      {
        id: 'event-5c',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          harnessHookEvidence: {
            runId: 'run-1',
            stage: 'before_verification',
            sequence: 7,
            at: '2026-03-17T00:00:06.300Z',
            turnIndex: 1,
            toolName: 'run_command',
            summary: 'Calling planned post-mutation verification command',
            isError: false,
            mutatesWorkspace: false,
            verificationCommand: 'npm test -- C:/Users/test-user/Desktop/vicode-project/src/app.test.ts',
            verificationStatus: null
          }
        },
        createdAt: '2026-03-17T00:00:06.300Z'
      },
      {
        id: 'event-5d',
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
            verificationCommand: 'npm test -- C:/Users/test-user/Desktop/vicode-project/src/app.test.ts',
            verificationStatus: 'passed',
            createdDirectoriesCount: 0,
            writtenFilesCount: 1,
            toolCallCount: 2,
            reminderCount: 1
          }
        },
        createdAt: '2026-03-17T00:00:06.500Z'
      },
      {
        id: 'event-5e',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          harnessHookEvidence: {
            runId: 'run-1',
            stage: 'context_pressure',
            sequence: 8,
            at: '2026-03-17T00:00:06.600Z',
            turnIndex: null,
            toolName: null,
            summary: 'Context pressure checkpoint recommended',
            isError: false,
            mutatesWorkspace: false,
            verificationCommand: null,
            verificationStatus: null,
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
          }
        },
        createdAt: '2026-03-17T00:00:06.600Z'
      },
  ];
}
