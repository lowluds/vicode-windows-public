import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '../../storage/settings-repository';
import type { Preferences } from '../../shared/domain';
import {
  applyOllamaLaunchProfile,
  readOllamaLaunchDiagnostics,
  validateOllamaLaunchProfile
} from '../ollama-launch-profile';
import { DiagnosticsService } from './diagnostics';
import { cleanupDiagnosticsTestDirs, createExportsDir, createSubagentSummary, createThreadDetail } from './diagnostics-test-fixtures';

describe('DiagnosticsService export behavior', () => {
  afterEach(async () => {
    await cleanupDiagnosticsTestDirs();
  });
  it('exports a single thread bundle when requested', async () => {
    const exportsDir = await createExportsDir();
    const thread = createThreadDetail();
    const project = {
      id: 'project-1',
      name: 'Vitest project',
      folderPath: 'C:/Users/test-user/Desktop/vicode-project/vitest1',
      trusted: true,
      defaultProviderId: 'ollama',
      defaultModelByProvider: {
        openai: 'gpt-5',
        gemini: 'gemini-2.5-pro',
        qwen: 'qwen3.5-plus',
        ollama: 'kimi-k2:latest',
        kimi: 'kimi-k2-thinking'
      },
      createdAt: '2026-03-17T00:00:00.000Z',
      updatedAt: '2026-03-17T00:00:00.000Z'
    };
    const db = {
      getProject: () => project,
      getThread: () => thread,
      listSubagentsByParentThread: () => [createSubagentSummary()]
    } as unknown as Parameters<typeof DiagnosticsService>[0];

    const service = new DiagnosticsService(db, exportsDir);
    const filePath = await service.exportThread('thread-1', []);
    const exportedText = await readFile(filePath, 'utf8');
    const exported = JSON.parse(exportedText) as {
      project: typeof project;
      thread: ThreadDetail;
      runProgressDiagnostics: {
        providerEventDiagnostics: Array<Record<string, unknown>>;
        verificationArtifactDiagnostics: Array<Record<string, unknown>>;
        promptSectionEvidenceDiagnostics: Array<Record<string, unknown>>;
        modelRoutingEvidenceDiagnostics: Array<Record<string, unknown>>;
        toolRoutingEvidenceDiagnostics: Array<Record<string, unknown>>;
        infrastructureEvidenceDiagnostics: Array<Record<string, unknown>>;
        stagedWorkspaceChangeDiagnostics: Array<Record<string, unknown>>;
        stagedWorkspaceHunkReviewDecisionDiagnostics: Array<Record<string, unknown>>;
        worktreeChangeDiagnostics: Array<Record<string, unknown>>;
        worktreeReviewDecisionDiagnostics: Array<Record<string, unknown>>;
        worktreeHunkReviewDecisionDiagnostics: Array<Record<string, unknown>>;
        worktreeCleanupDecisionDiagnostics: Array<Record<string, unknown>>;
        harnessHookEvidenceDiagnostics: Array<Record<string, unknown>>;
        finalEvidenceSummaryDiagnostics: Array<Record<string, unknown>>;
        harnessHandoffStateDiagnostics: Array<Record<string, unknown>>;
        runtimeTraceDiagnostics: Array<Record<string, unknown>>;
        failedRunDiagnostics: Array<Record<string, unknown>>;
        runEvidenceBundles: Array<Record<string, unknown>>;
      };
    };

    expect(exported.project.folderPath).toBe('C:/Users/test-user/Desktop/vicode-project/vitest1');
    expect(exported.thread.id).toBe('thread-1');
    expect(exported.runProgressDiagnostics.providerEventDiagnostics).toHaveLength(3);
    expect(exported.runProgressDiagnostics.verificationArtifactDiagnostics).toEqual([
      expect.objectContaining({
        threadId: 'thread-1',
        threadTitle: 'Codex planning thread',
        runId: 'run-1',
        command: 'npm test -- C:/Users/test-user/Desktop/vicode-project/src/app.test.ts',
        status: 'passed'
      })
    ]);
    expect(exported.runProgressDiagnostics.promptSectionEvidenceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        sectionId: 'system-prompt',
        title: 'System prompt',
        placement: 'system',
        characterCount: 240
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        sectionId: 'workspace-context',
        title: 'Workspace context',
        placement: 'user',
        characterCount: 120
      })
    ]));
    expect(exported.runProgressDiagnostics.modelRoutingEvidenceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        modelId: 'gpt-5',
        runMode: 'default',
        reason: 'model id carried from the provider run context before transport dispatch'
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        modelId: 'gpt-5',
        providerLabel: 'OpenAI',
        transportKind: 'responses',
        runtimeAuthority: 'app_harness'
      })
    ]));
    expect(exported.runProgressDiagnostics.toolRoutingEvidenceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        toolId: 'native:read_file',
        callName: 'read_file',
        included: true,
        readsWorkspace: true
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        toolId: 'native:run_command',
        callName: 'run_command',
        included: false,
        requiresApproval: true
      })
    ]));
    expect(exported.runProgressDiagnostics.infrastructureEvidenceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        infrastructureId: 'workspace_read',
        available: true,
        toolCallNames: ['read_file']
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        infrastructureId: 'shell_command',
        available: false,
        toolCallNames: []
      })
    ]));
    expect(exported.runProgressDiagnostics.stagedWorkspaceChangeDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        sourceToolName: 'write_file',
        changedPaths: ['src/new-widget.ts'],
        operationKinds: ['write_file'],
        filesChanged: 1,
        insertions: 4,
        deletions: 0
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        sourceToolName: 'apply_patch',
        changedPaths: ['src/existing.ts', 'src/remove-me.ts'],
        operationKinds: ['apply_patch', 'delete'],
        filesChanged: 2,
        insertions: 5,
        deletions: 3
      })
    ]));
    expect(exported.runProgressDiagnostics.stagedWorkspaceHunkReviewDecisionDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        action: 'applied',
        status: 'applied',
        source: 'staged_workspace_preview',
        isolationMode: 'patch_buffer',
        stagedEventId: 'event-5b-staged-patch',
        hunkIds: ['hunk-1', 'hunk-2'],
        acceptedHunkIds: ['hunk-1'],
        rejectedHunkIds: ['hunk-2'],
        changedPaths: ['src/existing.ts'],
        hunkCount: 2,
        acceptedHunkCount: 1,
        rejectedHunkCount: 1
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-5',
        action: 'applied',
        status: 'failed',
        hunkIds: ['[redacted-path]', 'hunk-failed'],
        changedPaths: ['[redacted-path]', 'src/hunk-failed.ts'],
        errorReason: 'Workspace drift in [redacted-path]'
      })
    ]));
    expect(exported.runProgressDiagnostics.worktreeChangeDiagnostics).toEqual([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        changedPaths: ['src/worktree.ts', 'src/remove-me.ts'],
        filesChanged: 2,
        insertions: 9,
        deletions: 3
      })
    ]);
    expect(exported.runProgressDiagnostics.worktreeReviewDecisionDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        action: 'applied',
        status: 'applied',
        changedPaths: ['src/worktree.ts', 'src/remove-me.ts'],
        filesChanged: 2,
        insertions: 9,
        deletions: 3
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-4',
        action: 'rejected',
        status: 'rejected',
        changedPaths: ['src/rejected.ts']
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        action: 'reverted',
        status: 'reverted',
        changedPaths: ['src/worktree.ts', 'src/remove-me.ts']
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-5',
        action: 'applied',
        status: 'failed',
        changedPaths: ['[redacted-path]', 'src/failed.ts'],
        errorReason: 'Workspace drift in [redacted-path]'
      })
    ]));
    expect(exported.runProgressDiagnostics.worktreeHunkReviewDecisionDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        action: 'applied',
        status: 'applied',
        hunkIds: ['worktree-hunk-1', 'worktree-hunk-2'],
        acceptedHunkIds: ['worktree-hunk-1'],
        rejectedHunkIds: ['worktree-hunk-2'],
        changedPaths: ['src/worktree.ts'],
        errorReason: null
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-5',
        action: 'applied',
        status: 'failed',
        hunkIds: ['[redacted-path]', 'worktree-hunk-failed'],
        acceptedHunkIds: ['[redacted-path]'],
        rejectedHunkIds: ['worktree-hunk-failed'],
        changedPaths: ['[redacted-path]', 'src/worktree-hunk-failed.ts'],
        errorReason: 'Workspace drift in [redacted-path]'
      })
    ]));
    expect(exported.runProgressDiagnostics.worktreeCleanupDecisionDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        action: 'cleaned',
        status: 'cleaned',
        cleanupPolicy: 'preserve_until_review',
        reviewStatus: 'reverted'
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-5',
        action: 'failed',
        status: 'failed',
        errorReason: 'Cleanup failed in [redacted-path]'
      })
    ]));
    expect(exportedText).not.toContain('PRIVATE_STAGED_WRITE_AFTER_CONTENT');
    expect(exportedText).not.toContain('PRIVATE_STAGED_PATCH_BEFORE_CONTENT');
    expect(exportedText).not.toContain('PRIVATE_STAGED_PATCH_AFTER_CONTENT');
    expect(exportedText).not.toContain('PRIVATE_STAGED_PATCH_TEXT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_SOURCE_ROOT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_RUNTIME_ROOT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_SOURCE_REPO_ROOT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_REPO_ROOT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_REVIEW_SOURCE_REPO_ROOT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_REVIEW_SOURCE_ROOT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_REVIEW_REPO_ROOT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_REVIEW_RUNTIME_ROOT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_REVIEW_BEFORE_CONTENT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_REVIEW_AFTER_CONTENT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_REVIEW_PATCH_TEXT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_REVIEW_PREVIEW_LINE');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_REVIEW_FAILED_BEFORE_CONTENT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_REVIEW_FAILED_AFTER_CONTENT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_REVIEW_FAILED_PATCH_TEXT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_REVIEW_FAILED_PREVIEW_LINE');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_HUNK_SOURCE_REPO_ROOT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_HUNK_SOURCE_ROOT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_HUNK_REPO_ROOT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_HUNK_RUNTIME_ROOT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_HUNK_BEFORE_CONTENT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_HUNK_AFTER_CONTENT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_HUNK_PATCH_TEXT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_HUNK_PREVIEW_LINE');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_HUNK_FAILED_BEFORE_CONTENT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_HUNK_FAILED_AFTER_CONTENT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_HUNK_FAILED_PATCH_TEXT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_HUNK_FAILED_PREVIEW_LINE');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_CLEANUP_SOURCE_REPO_ROOT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_CLEANUP_SOURCE_ROOT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_CLEANUP_REPO_ROOT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_CLEANUP_RUNTIME_ROOT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_CLEANUP_BEFORE_CONTENT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_CLEANUP_AFTER_CONTENT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_CLEANUP_PATCH_TEXT');
    expect(exportedText).not.toContain('PRIVATE_WORKTREE_CLEANUP_PREVIEW_LINE');
    expect(exportedText).not.toContain('PRIVATE_DISPATCH_PROMPT_TEXT');
    expect(exportedText).not.toContain('PRIVATE_DISPATCH_SYSTEM_PROMPT');
    expect(exportedText).not.toContain('PRIVATE_MODEL_ROUTING_PROMPT_TEXT');
    expect(exportedText).not.toContain('PRIVATE_HARNESS_PROMPT_TEXT');
    expect(exportedText).not.toContain('PRIVATE_HARNESS_USER_PROMPT');
    expect(exportedText).not.toContain('PRIVATE_HARNESS_SYSTEM_PROMPT');
    expect(exportedText).not.toContain('PRIVATE_SYSTEM_PROMPT_TEXT');
    expect(exportedText).not.toContain('PRIVATE_CONTEXT_SECTION_CONTENT');
    expect(exportedText).not.toContain('PRIVATE_MODEL_SELECTION_PROMPT_TEXT');
    expect(exportedText).not.toContain('PRIVATE_TOOL_ROUTING_PROMPT_TEXT');
    expect(exportedText).not.toContain('PRIVATE_INFRA_CONTEXT_CONTENT');
    expect(exportedText).not.toContain('C:/Users/test-user/Desktop/vicode-project/src/private.ts');
    expect(exported.runProgressDiagnostics.harnessHookEvidenceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        stage: 'before_verification'
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        stage: 'context_pressure',
        contextPressureSeverity: 'warning',
        checkpointReminderTitle: 'Checkpoint recommended'
      })
    ]));
    expect(exported.runProgressDiagnostics.finalEvidenceSummaryDiagnostics).toEqual([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        postMutationVerificationPassed: true
      })
    ]);
    expect(exported.runProgressDiagnostics.harnessHandoffStateDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        change: expect.objectContaining({
          changedFiles: ['src/shared/harness-handoff-state.ts']
        }),
        subagents: [
          expect.objectContaining({
            childThreadId: 'thread-child',
            childRunId: 'run-child',
            status: 'completed'
          })
        ]
      })
    ]));
    expect(exported.runProgressDiagnostics.runtimeTraceDiagnostics).toHaveLength(2);
    expect(exported.runProgressDiagnostics.failedRunDiagnostics).toHaveLength(1);
    expect(exported.runProgressDiagnostics.runEvidenceBundles.map((bundle) => (bundle.identity as { threadId: string }).threadId)).toEqual([
      'thread-1',
      'thread-1',
      'thread-1',
      'thread-1',
      'thread-1'
    ]);
    expect(exported.runProgressDiagnostics.runEvidenceBundles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        identity: expect.objectContaining({
          threadId: 'thread-1',
          runId: 'run-1'
        }),
        promptEvidence: expect.objectContaining({ sectionCount: 2 }),
        changeReviewEvidence: expect.objectContaining({
          stagedReviewDecisions: expect.arrayContaining([
            expect.objectContaining({ action: 'applied', status: 'applied' })
          ]),
          stagedHunkReviewDecisions: expect.arrayContaining([
            expect.objectContaining({ action: 'applied', status: 'applied' })
          ]),
          worktreeReviewDecisions: expect.arrayContaining([
            expect.objectContaining({ action: 'applied', status: 'applied' })
          ]),
          worktreeHunkReviewDecisions: expect.arrayContaining([
            expect.objectContaining({ action: 'applied', status: 'applied' })
          ])
        })
      })
    ]));
  });

  it('includes sanitized Ollama launch profile diagnostics in thread exports', async () => {
    const stateDir = await createExportsDir();
    const exportsDir = join(stateDir, 'exports');
    const thread = createThreadDetail();
    const project = {
      id: 'project-1',
      name: 'Vitest project',
      folderPath: 'C:/Users/test-user/Desktop/vicode-project/vitest1',
      trusted: true,
      defaultProviderId: 'ollama',
      defaultModelByProvider: {
        openai: 'gpt-5',
        gemini: 'gemini-2.5-pro',
        qwen: 'qwen3.5-plus',
        ollama: 'kimi-k2:latest',
        kimi: 'kimi-k2-thinking'
      },
      createdAt: '2026-03-17T00:00:00.000Z',
      updatedAt: '2026-03-17T00:00:00.000Z'
    };
    let preferences: Preferences = {
      ...DEFAULT_PREFERENCES,
      defaultProviderId: 'openai',
      defaultModelByProvider: {
        ...DEFAULT_PREFERENCES.defaultModelByProvider,
        ollama: 'previous-ollama-model'
      },
      ollamaTransportMode: 'chat'
    };
    const db = {
      getProject: () => project,
      getThread: () => thread,
      listSubagentsByParentThread: () => [createSubagentSummary()],
      getPreferences: () => preferences,
      savePreferences: (next: Partial<Preferences>) => {
        preferences = {
          ...preferences,
          ...next,
          defaultModelByProvider: {
            ...preferences.defaultModelByProvider,
            ...next.defaultModelByProvider
          },
          defaultReasoningEffortByProvider: {
            ...preferences.defaultReasoningEffortByProvider,
            ...next.defaultReasoningEffortByProvider
          },
          defaultThinkingByProvider: {
            ...preferences.defaultThinkingByProvider,
            ...next.defaultThinkingByProvider
          }
        };
        return preferences;
      },
      getProviderAccount: () => null
    } as unknown as Parameters<typeof DiagnosticsService>[0];

    applyOllamaLaunchProfile({
      db,
      stateDir,
      profile: validateOllamaLaunchProfile({
        version: 1,
        source: 'ollama-launch',
        providerId: 'ollama',
        profileId: 'launch-qwen-local',
        modelId: 'qwen2.5-coder:7b',
        modelSource: 'local',
        baseUrl: 'http://127.0.0.1:11434',
        transportMode: 'responses',
        configureOnly: true,
        createdAt: '2026-06-03T00:00:00.000Z'
      }),
      now: () => '2026-06-03T00:00:01.000Z'
    });

    const service = new DiagnosticsService(
      db,
      exportsDir,
      null,
      null,
      () => readOllamaLaunchDiagnostics(stateDir)
    );
    const filePath = await service.exportThread('thread-1', []);
    const exportedText = await readFile(filePath, 'utf8');
    const exported = JSON.parse(exportedText) as {
      ollamaLaunchDiagnostics: ReturnType<typeof readOllamaLaunchDiagnostics>;
    };

    expect(exported.ollamaLaunchDiagnostics).toEqual({
      active: true,
      markerStatus: 'active',
      appliedAt: '2026-06-03T00:00:01.000Z',
      profile: {
        profileId: 'launch-qwen-local',
        providerId: 'ollama',
        modelId: 'qwen2.5-coder:7b',
        modelSource: 'local',
        baseUrlConfigured: true,
        transportMode: 'responses',
        configureOnly: true,
        restore: false,
        createdAt: '2026-06-03T00:00:00.000Z'
      },
      pending: {
        status: 'missing',
        reason: null,
        deferredAt: null,
        profile: null
      }
    });
    expect(exportedText).not.toContain('previous-ollama-model');
    expect(exportedText).not.toContain('http://127.0.0.1:11434');
  });
});
