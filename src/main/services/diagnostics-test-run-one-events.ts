import type { RunEvent } from '../../shared/domain';

export function createDiagnosticsRunOneEvents(): RunEvent[] {
  return [
      {
        id: 'event-0',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'submit_received',
            at: '2026-03-17T00:00:00.000Z',
            detail: {
              providerId: 'openai'
            }
          }
        },
        createdAt: '2026-03-17T00:00:00.000Z'
      },
      {
        id: 'event-0b',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'workspace_context_started',
            at: '2026-03-17T00:00:00.050Z'
          }
        },
        createdAt: '2026-03-17T00:00:00.050Z'
      },
      {
        id: 'event-0c',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'workspace_context_completed',
            at: '2026-03-17T00:00:00.150Z',
            detail: {
              durationMs: 100,
              blockCount: 2
            }
          }
        },
        createdAt: '2026-03-17T00:00:00.150Z'
      },
      {
        id: 'event-0d',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'prompt_assembled',
            at: '2026-03-17T00:00:00.180Z',
            detail: {
              promptLength: 512
            }
          }
        },
        createdAt: '2026-03-17T00:00:00.180Z'
      },
      {
        id: 'event-0d-worktree-trace',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'worktree_session_created',
            at: '2026-03-17T00:00:00.190Z',
            detail: {
              sourceWorkspaceRoot: 'PRIVATE_WORKTREE_SOURCE_ROOT',
              runtimeWorkspaceRoot: 'PRIVATE_WORKTREE_RUNTIME_ROOT',
              harnessWorktreeSession: {
                sourceRepoRoot: 'PRIVATE_WORKTREE_SOURCE_REPO_ROOT',
                sourceWorkspaceRoot: 'PRIVATE_WORKTREE_SOURCE_ROOT',
                worktreeRepoRoot: 'PRIVATE_WORKTREE_REPO_ROOT',
                worktreeWorkspaceRoot: 'PRIVATE_WORKTREE_RUNTIME_ROOT',
                branchName: 'vicode/worktree/project-1/run-1',
                sourceWorkspaceRelativePath: 'packages/app'
              }
            }
          }
        },
        createdAt: '2026-03-17T00:00:00.190Z'
      },
      {
        id: 'event-0e',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'provider_dispatch_started',
            at: '2026-03-17T00:00:00.200Z'
          }
        },
        createdAt: '2026-03-17T00:00:00.200Z'
      },
      {
        id: 'event-0e-model-routing',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'provider_model_normalized_dispatch_started',
            at: '2026-03-17T00:00:00.210Z',
            detail: {
              providerId: 'openai',
              transportKind: 'responses',
              promptText: 'PRIVATE_DISPATCH_PROMPT_TEXT',
              systemPrompt: 'PRIVATE_DISPATCH_SYSTEM_PROMPT',
              modelRouting: {
                providerId: 'openai',
                modelId: 'gpt-5',
                customProviderId: null,
                ollamaTransportMode: null,
                providerLabel: 'OpenAI',
                transportKind: 'responses',
                runtimeAuthority: 'app_harness',
                reason: 'normalized provider model transport selected for this trusted workspace run',
                promptText: 'PRIVATE_MODEL_ROUTING_PROMPT_TEXT'
              }
            }
          }
        },
        createdAt: '2026-03-17T00:00:00.210Z'
      },
      {
        id: 'event-0e-harness-evidence',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'provider_model_harness_evidence_captured',
            at: '2026-03-17T00:00:00.220Z',
            detail: {
              promptText: 'PRIVATE_HARNESS_PROMPT_TEXT',
              userPrompt: 'PRIVATE_HARNESS_USER_PROMPT',
              systemPrompt: 'PRIVATE_HARNESS_SYSTEM_PROMPT',
              promptSections: [
                {
                  id: 'system-prompt',
                  title: 'System prompt',
                  placement: 'system',
                  characterCount: 240,
                  reason: 'provider model system instructions assembled for this run',
                  content: 'PRIVATE_SYSTEM_PROMPT_TEXT'
                },
                {
                  id: 'workspace-context',
                  title: 'Workspace context',
                  placement: 'user',
                  characterCount: 120,
                  reason: 'context section included in the provider model prompt payload',
                  content: 'PRIVATE_CONTEXT_SECTION_CONTENT'
                }
              ],
              modelSelection: {
                modelId: 'gpt-5',
                customProviderId: null,
                ollamaTransportMode: null,
                runMode: 'default',
                reason: 'model id carried from the provider run context before transport dispatch',
                promptText: 'PRIVATE_MODEL_SELECTION_PROMPT_TEXT'
              },
              toolRouting: [
                {
                  id: 'native:read_file',
                  callName: 'read_file',
                  name: 'Read file',
                  origin: 'native',
                  visibilityGroup: 'workspace_read',
                  included: true,
                  reason: 'included in active provider model tool catalog',
                  requiresApproval: false,
                  mutatesWorkspace: false,
                  readsWorkspace: true,
                  usesNetwork: false,
                  promptText: 'PRIVATE_TOOL_ROUTING_PROMPT_TEXT'
                },
                {
                  id: 'native:run_command',
                  callName: 'run_command',
                  name: 'Run command',
                  origin: 'native',
                  visibilityGroup: 'host_command',
                  included: false,
                  reason: 'excluded before active provider model tool catalog assembly',
                  requiresApproval: true,
                  mutatesWorkspace: false,
                  readsWorkspace: false,
                  usesNetwork: true
                }
              ],
              infrastructure: [
                {
                  id: 'workspace_read',
                  label: 'Workspace read tools',
                  available: true,
                  reason: 'available through read_file',
                  toolCallNames: ['read_file'],
                  contextSectionContents: 'PRIVATE_INFRA_CONTEXT_CONTENT'
                },
                {
                  id: 'shell_command',
                  label: 'Host shell command',
                  available: false,
                  reason: 'run_command is not in the active provider model tool catalog',
                  toolCallNames: []
                }
              ]
            }
          }
        },
        createdAt: '2026-03-17T00:00:00.220Z'
      },
      {
        id: 'event-0f',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'run_started',
            at: '2026-03-17T00:00:00.250Z'
          }
        },
        createdAt: '2026-03-17T00:00:00.250Z'
      },
      {
        id: 'event-0g',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'first_delta',
            at: '2026-03-17T00:00:00.350Z'
          }
        },
        createdAt: '2026-03-17T00:00:00.350Z'
      },
      {
        id: 'event-0h',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'first_tool_call',
            at: '2026-03-17T00:00:00.450Z'
          }
        },
        createdAt: '2026-03-17T00:00:00.450Z'
      },
      {
        id: 'event-0i',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'first_tool_result',
            at: '2026-03-17T00:00:00.650Z'
          }
        },
        createdAt: '2026-03-17T00:00:00.650Z'
      },
      {
        id: 'event-0j',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'completed',
            at: '2026-03-17T00:00:01.000Z',
            detail: {
              outputLength: 128
            }
          }
        },
        createdAt: '2026-03-17T00:00:01.000Z'
      },
      {
        id: 'event-1',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          providerDiagnostics: {
            kind: 'provider_event_classification',
            source: 'codex_app_server',
            providerEventType: 'item/completed',
            itemType: 'task_group',
            itemKeys: ['milestones', 'type'],
            paths: [],
            decision: null,
            status: null,
            taskLike: true,
            classification: 'task_candidate_unparsed'
          }
        },
        createdAt: '2026-03-17T00:00:01.000Z'
      },
      {
        id: 'event-1b',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          providerDiagnostics: {
            kind: 'provider_event_classification',
            source: 'codex_cli_json',
            providerEventType: 'read_file_begin',
            itemType: null,
            itemKeys: ['path', 'type'],
            paths: ['src/renderer/app.tsx'],
            decision: null,
            status: 'started',
            taskLike: false,
            classification: 'evidence_candidate_unparsed'
          }
        },
        createdAt: '2026-03-17T00:00:01.500Z'
      },
      {
        id: 'event-2',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          message: 'Codex updated its task list.',
          progressSnapshot: {
            runId: 'run-1',
            threadId: 'thread-1',
            title: 'Codex tasks',
            items: [
              { id: '1', label: 'Inspect', order: 0, status: 'completed' },
              { id: '2', label: 'Wire', order: 1, status: 'in_progress' }
            ],
            updatedAt: '2026-03-17T00:00:02.000Z',
            diffStats: {
              filesChanged: 1,
              insertions: 42,
              deletions: 3
            },
            reviewAvailable: false,
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
        createdAt: '2026-03-17T00:00:02.000Z'
      },
      {
        id: 'event-3',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_call',
            toolName: 'read_file',
            phase: 'started',
            summary: 'Calling read_file'
          }
        },
        createdAt: '2026-03-17T00:00:03.000Z'
      },
      {
        id: 'event-4',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            toolName: 'read_file',
            phase: 'completed',
            status: 'completed',
            summary: 'Completed read_file'
          }
        },
        createdAt: '2026-03-17T00:00:04.000Z'
      },
      {
        id: 'event-5',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'completed',
            summary: 'Ran npm test',
            command: 'npm test',
            cwd: 'C:/repo',
            isolationMode: 'host_job_object_temp_profile',
            outputLines: ['1 passed']
          }
        },
        createdAt: '2026-03-17T00:00:05.000Z'
      },
      {
        id: 'event-5b',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          verificationArtifact: {
            command: 'npm test -- C:/Users/test-user/Desktop/vicode-project/src/app.test.ts',
            cwd: 'C:/Users/test-user/Desktop/vicode-project',
            permissionProfile: 'default',
            networkPolicy: 'disabled',
            status: 'passed',
            exitCode: 0,
            stdout: 'PASS C:/Users/test-user/Desktop/vicode-project/src/app.test.ts',
            stderr: '',
            startedAt: '2026-03-17T00:00:05.000Z',
            finishedAt: '2026-03-17T00:00:06.250Z',
            durationMs: 1250,
            reason: 'package.json defines a test script.',
            skippedReason: null
          }
        },
        createdAt: '2026-03-17T00:00:06.250Z'
      },
      {
        id: 'event-5b-staged-write',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          stagedWorkspaceChangeSet: {
            threadId: 'thread-1',
            runId: 'run-1',
            sourceToolName: 'write_file',
            isolationMode: 'patch_buffer',
            status: 'proposed',
            requestedPath: 'src/new-widget.ts',
            changedPaths: ['src/new-widget.ts'],
            operations: [
              {
                operation: 'write_file',
                path: 'src/new-widget.ts',
                beforeContent: null,
                proposedAfterContent: 'PRIVATE_STAGED_WRITE_AFTER_CONTENT',
                patchText: null
              }
            ],
            summary: {
              filesChanged: 1,
              insertions: 4,
              deletions: 0
            }
          }
        },
        createdAt: '2026-03-17T00:00:06.260Z'
      },
      {
        id: 'event-5b-staged-patch',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          stagedWorkspaceChangeSet: {
            threadId: 'thread-1',
            runId: 'run-1',
            sourceToolName: 'apply_patch',
            isolationMode: 'patch_buffer',
            status: 'proposed',
            requestedPath: null,
            changedPaths: ['src/existing.ts', 'src/remove-me.ts'],
            operations: [
              {
                operation: 'apply_patch',
                path: 'src/existing.ts',
                beforeContent: 'PRIVATE_STAGED_PATCH_BEFORE_CONTENT',
                proposedAfterContent: 'PRIVATE_STAGED_PATCH_AFTER_CONTENT',
                patchText: 'PRIVATE_STAGED_PATCH_TEXT'
              },
              {
                operation: 'delete',
                path: 'src/remove-me.ts',
                beforeContent: 'PRIVATE_STAGED_DELETE_BEFORE_CONTENT',
                proposedAfterContent: null,
                patchText: 'PRIVATE_STAGED_PATCH_TEXT'
              }
            ],
            summary: {
              filesChanged: 2,
              insertions: 5,
              deletions: 3
            }
          }
        },
        createdAt: '2026-03-17T00:00:06.270Z'
      },
      {
        id: 'event-5b-staged-review',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          stagedWorkspaceReviewDecision: {
            action: 'applied',
            status: 'applied',
            threadId: 'thread-1',
            runId: 'run-1',
            stagedEventId: 'event-5b-staged-patch',
            stagedEventIndex: 1,
            sourceToolName: 'apply_patch',
            isolationMode: 'patch_buffer',
            changedPaths: ['src/existing.ts', 'src/remove-me.ts'],
            operationKinds: ['apply_patch', 'delete'],
            errorReason: null,
            createdAt: '2026-03-17T00:00:06.275Z'
          }
        },
        createdAt: '2026-03-17T00:00:06.275Z'
      },
      {
        id: 'event-5b-staged-hunk-review-applied',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          stagedWorkspaceHunkReviewDecision: {
            action: 'applied',
            status: 'applied',
            threadId: 'thread-1',
            runId: 'run-1',
            source: 'staged_workspace_preview',
            isolationMode: 'patch_buffer',
            stagedEventId: 'event-5b-staged-patch',
            stagedEventIndex: 1,
            changedPaths: ['src/existing.ts'],
            hunkIds: ['hunk-1', 'hunk-2'],
            acceptedHunkIds: ['hunk-1'],
            rejectedHunkIds: ['hunk-2'],
            filesChanged: 1,
            insertions: 3,
            deletions: 1,
            errorReason: null,
            createdAt: '2026-03-17T00:00:06.276Z',
            beforeContent: 'PRIVATE_STAGED_HUNK_BEFORE_CONTENT',
            afterContent: 'PRIVATE_STAGED_HUNK_AFTER_CONTENT',
            proposedAfterContent: 'PRIVATE_STAGED_HUNK_PROPOSED_AFTER_CONTENT',
            patchText: 'PRIVATE_STAGED_HUNK_PATCH_TEXT',
            previewLines: [{ text: 'PRIVATE_STAGED_HUNK_PREVIEW_LINE' }]
          }
        },
        createdAt: '2026-03-17T00:00:06.276Z'
      },
      {
        id: 'event-5b-staged-hunk-review-failed',
        threadId: 'thread-1',
        runId: 'run-5',
        eventType: 'info',
        payload: {
          stagedWorkspaceHunkReviewDecision: {
            action: 'applied',
            status: 'failed',
            threadId: 'thread-1',
            runId: 'run-5',
            source: 'staged_workspace_preview',
            isolationMode: 'patch_buffer',
            stagedEventId: 'event-5b-staged-patch',
            stagedEventIndex: 1,
            changedPaths: [
              'C:/Users/test-user/Desktop/vicode-project/src/private-hunk.ts',
              'src/hunk-failed.ts'
            ],
            hunkIds: [
              'C:/Users/test-user/Desktop/vicode-project/src/private-hunk.ts:hunk-1',
              'hunk-failed'
            ],
            acceptedHunkIds: ['C:/Users/test-user/Desktop/vicode-project/src/private-hunk.ts:hunk-1'],
            rejectedHunkIds: ['hunk-failed'],
            filesChanged: 2,
            insertions: 2,
            deletions: 2,
            errorReason: 'Workspace drift in C:/Users/test-user/Desktop/vicode-project/src/private-hunk.ts',
            createdAt: '2026-03-17T00:00:06.277Z',
            beforeContent: 'PRIVATE_STAGED_HUNK_FAILED_BEFORE_CONTENT',
            afterContent: 'PRIVATE_STAGED_HUNK_FAILED_AFTER_CONTENT',
            proposedAfterContent: 'PRIVATE_STAGED_HUNK_FAILED_PROPOSED_AFTER_CONTENT',
            patchText: 'PRIVATE_STAGED_HUNK_FAILED_PATCH_TEXT',
            previewLines: [{ text: 'PRIVATE_STAGED_HUNK_FAILED_PREVIEW_LINE' }]
          }
        },
        createdAt: '2026-03-17T00:00:06.277Z'
      },
  ];
}
