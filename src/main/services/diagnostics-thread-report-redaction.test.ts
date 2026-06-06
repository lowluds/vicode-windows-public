import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderDescriptor } from '../../shared/domain';
import { DiagnosticsService } from './diagnostics';
import { cleanupDiagnosticsTestDirs, createExportsDir, createSubagentSummary, createThreadDetail } from './diagnostics-test-fixtures';

describe('DiagnosticsService thread report redaction', () => {
  afterEach(async () => {
    await cleanupDiagnosticsTestDirs();
  });
  it('exports a redacted user-facing thread report packet', async () => {
    const exportsDir = await createExportsDir();
    const thread = createThreadDetail();
    const project = {
      id: 'project-1',
      name: 'Support project',
      folderPath: 'C:/Users/test-user/Desktop/vicode-project/support-repro',
      trusted: true,
      defaultProviderId: 'openai',
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
    const providers: ProviderDescriptor[] = [
      {
        id: 'openai',
        label: 'OpenAI',
        authState: 'connected',
        authMode: 'cli',
        installed: true,
        models: [],
        modelSource: 'fallback',
        modelsUpdatedAt: null,
        canLiveDiscoverModels: true,
        cliPath: 'C:/Users/test-user/AppData/Roaming/npm/codex.cmd',
        capabilities: {
          supportsCliAuth: true,
          supportsApiKeyAuth: true,
          supportsModelListing: true,
          supportsReasoningEffort: true,
          supportsThinking: false,
          supportsVision: true,
          requiresTrustedWorkspace: true,
          requiresFullAccessForAppRuns: false,
          workspaceInstructionFileName: 'AGENTS.md'
        },
        plannerPolicy: {
          supportsPlannerMode: true,
          plannerModeLabel: 'Plan',
          plannerModeDescription: 'Plan before edits.',
          plannerModeRequiresModel: false
        }
      }
    ];

    const service = new DiagnosticsService(
      db,
      exportsDir,
      () => ({
        roomSessions: [
          {
            roomId: 'room-1',
            userId: 'user-1',
            sessionToken: 'secret-session-token',
            updatedAt: '2026-03-20T15:00:00.000Z',
            expiresAt: null
          }
        ]
      })
    );

    const reportDir = await service.exportThreadReport('thread-1', providers);
    const readme = await readFile(join(reportDir, 'README.txt'), 'utf8');
    const reportText = await readFile(join(reportDir, 'report.json'), 'utf8');
    const report = JSON.parse(reportText) as {
      reportType: string;
      project: { folderPath: string | null };
      providers: Array<{ cliPath: string | null }>;
      runProgressDiagnostics: {
        providerEventDiagnostics: Array<{ paths: string[] }>;
        terminalCommandDiagnostics: Array<{ cwd: string | null }>;
        verificationArtifactDiagnostics: Array<{ command: string | null; cwd: string | null }>;
        promptSectionEvidenceDiagnostics: Array<{
          sectionId: string | null;
          title: string | null;
          placement: string | null;
          characterCount: number | null;
          reason: string | null;
        }>;
        modelRoutingEvidenceDiagnostics: Array<{
          modelId: string | null;
          providerLabel: string | null;
          transportKind: string | null;
          runtimeAuthority: string | null;
          reason: string | null;
        }>;
        toolRoutingEvidenceDiagnostics: Array<{
          toolId: string | null;
          callName: string | null;
          included: boolean | null;
          reason: string | null;
          mutatesWorkspace: boolean | null;
          requiresApproval: boolean | null;
          readsWorkspace: boolean | null;
          usesNetwork: boolean | null;
        }>;
        infrastructureEvidenceDiagnostics: Array<{
          infrastructureId: string | null;
          label: string | null;
          available: boolean | null;
          reason: string | null;
          toolCallNames: string[];
        }>;
        stagedWorkspaceChangeDiagnostics: Array<{
          sourceToolName: string | null;
          changedPaths: string[];
          operationKinds: string[];
          filesChanged: number | null;
          insertions: number | null;
          deletions: number | null;
        }>;
        stagedWorkspaceHunkReviewDecisionDiagnostics: Array<{
          action: string;
          status: string;
          hunkIds: string[];
          acceptedHunkIds: string[];
          rejectedHunkIds: string[];
          changedPaths: string[];
          errorReason: string | null;
        }>;
        worktreeChangeDiagnostics: Array<{
          changedPaths: string[];
          branchName: string | null;
          sourceWorkspaceRelativePath: string | null;
          filesChanged: number | null;
          insertions: number | null;
          deletions: number | null;
        }>;
        worktreeReviewDecisionDiagnostics: Array<{
          action: string;
          status: string;
          branchName: string | null;
          baseSha: string | null;
          sourceWorkspaceRelativePath: string | null;
          changedPaths: string[];
          filesChanged: number | null;
          insertions: number | null;
          deletions: number | null;
          errorReason: string | null;
        }>;
        worktreeHunkReviewDecisionDiagnostics: Array<{
          action: string;
          status: string;
          hunkIds: string[];
          acceptedHunkIds: string[];
          rejectedHunkIds: string[];
          changedPaths: string[];
          errorReason: string | null;
        }>;
        worktreeCleanupDecisionDiagnostics: Array<{
          errorReason: string | null;
          action: string;
          status: string;
        }>;
        harnessHookEvidenceDiagnostics: Array<{ verificationCommand: string | null; checkpointReminderSummary?: string | null }>;
        finalEvidenceSummaryDiagnostics: Array<{ verificationCommand: string | null }>;
        harnessHandoffStateDiagnostics: Array<{
          workspace: { workspaceRoot: string | null };
          verification: { command: string | null };
          recommendedNextPrompt: string;
        }>;
      };
      collaborationDiagnostics: {
        roomSessions: Array<Record<string, unknown>>;
      };
    };

    expect(readme).toContain('Attach this folder');
    expect(report.reportType).toBe('thread-support-report');
    expect(report.project.folderPath).toBe('[redacted-path]');
    expect(report.providers[0]?.cliPath).toBe('[redacted-path]');
    expect(report.runProgressDiagnostics.providerEventDiagnostics[1]?.paths).toEqual([
      'src/renderer/app.tsx'
    ]);
    expect(report.runProgressDiagnostics.terminalCommandDiagnostics[0]?.cwd).toBe('[redacted-path]');
    expect(report.runProgressDiagnostics.verificationArtifactDiagnostics[0]?.command).toBe(
      'npm test -- [redacted-path]'
    );
    expect(report.runProgressDiagnostics.verificationArtifactDiagnostics[0]?.cwd).toBe('[redacted-path]');
    expect(report.runProgressDiagnostics.promptSectionEvidenceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sectionId: 'system-prompt',
        title: 'System prompt',
        placement: 'system',
        characterCount: 240
      }),
      expect.objectContaining({
        sectionId: 'workspace-context',
        title: 'Workspace context',
        placement: 'user',
        characterCount: 120
      })
    ]));
    expect(report.runProgressDiagnostics.modelRoutingEvidenceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        modelId: 'gpt-5',
        reason: 'model id carried from the provider run context before transport dispatch'
      }),
      expect.objectContaining({
        modelId: 'gpt-5',
        providerLabel: 'OpenAI',
        transportKind: 'responses',
        runtimeAuthority: 'app_harness'
      })
    ]));
    expect(report.runProgressDiagnostics.toolRoutingEvidenceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toolId: 'native:read_file',
        callName: 'read_file',
        included: true,
        mutatesWorkspace: false,
        readsWorkspace: true
      }),
      expect.objectContaining({
        toolId: 'native:run_command',
        callName: 'run_command',
        included: false,
        requiresApproval: true,
        usesNetwork: true
      })
    ]));
    expect(report.runProgressDiagnostics.infrastructureEvidenceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        infrastructureId: 'workspace_read',
        label: 'Workspace read tools',
        available: true,
        toolCallNames: ['read_file']
      }),
      expect.objectContaining({
        infrastructureId: 'shell_command',
        label: 'Host shell command',
        available: false,
        toolCallNames: []
      })
    ]));
    expect(report.runProgressDiagnostics.stagedWorkspaceChangeDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceToolName: 'write_file',
        changedPaths: ['src/new-widget.ts'],
        operationKinds: ['write_file'],
        filesChanged: 1,
        insertions: 4,
        deletions: 0
      }),
      expect.objectContaining({
        sourceToolName: 'apply_patch',
        changedPaths: ['src/existing.ts', 'src/remove-me.ts'],
        operationKinds: ['apply_patch', 'delete'],
        filesChanged: 2,
        insertions: 5,
        deletions: 3
      })
    ]));
    expect(report.runProgressDiagnostics.stagedWorkspaceHunkReviewDecisionDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'applied',
        status: 'applied',
        hunkIds: ['hunk-1', 'hunk-2'],
        acceptedHunkIds: ['hunk-1'],
        rejectedHunkIds: ['hunk-2'],
        changedPaths: ['src/existing.ts'],
        errorReason: null
      }),
      expect.objectContaining({
        action: 'applied',
        status: 'failed',
        hunkIds: ['[redacted-path]', 'hunk-failed'],
        acceptedHunkIds: ['[redacted-path]'],
        rejectedHunkIds: ['hunk-failed'],
        changedPaths: ['[redacted-path]', 'src/hunk-failed.ts'],
        errorReason: 'Workspace drift in [redacted-path]'
      })
    ]));
    expect(report.runProgressDiagnostics.worktreeChangeDiagnostics).toEqual([
      expect.objectContaining({
        changedPaths: ['src/worktree.ts', 'src/remove-me.ts'],
        branchName: 'vicode/worktree/project-1/run-1',
        sourceWorkspaceRelativePath: 'packages/app',
        filesChanged: 2,
        insertions: 9,
        deletions: 3
      })
    ]);
    expect(report.runProgressDiagnostics.worktreeReviewDecisionDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'applied',
        status: 'applied',
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
        action: 'rejected',
        status: 'rejected',
        changedPaths: ['src/rejected.ts']
      }),
      expect.objectContaining({
        action: 'reverted',
        status: 'reverted',
        changedPaths: ['src/worktree.ts', 'src/remove-me.ts']
      }),
      expect.objectContaining({
        action: 'applied',
        status: 'failed',
        changedPaths: ['[redacted-path]', 'src/failed.ts'],
        errorReason: 'Workspace drift in [redacted-path]'
      })
    ]));
    expect(report.runProgressDiagnostics.worktreeHunkReviewDecisionDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'applied',
        status: 'applied',
        hunkIds: ['worktree-hunk-1', 'worktree-hunk-2'],
        acceptedHunkIds: ['worktree-hunk-1'],
        rejectedHunkIds: ['worktree-hunk-2'],
        changedPaths: ['src/worktree.ts'],
        errorReason: null
      }),
      expect.objectContaining({
        action: 'applied',
        status: 'failed',
        hunkIds: ['[redacted-path]', 'worktree-hunk-failed'],
        acceptedHunkIds: ['[redacted-path]'],
        rejectedHunkIds: ['worktree-hunk-failed'],
        changedPaths: ['[redacted-path]', 'src/worktree-hunk-failed.ts'],
        errorReason: 'Workspace drift in [redacted-path]'
      })
    ]));
    expect(report.runProgressDiagnostics.worktreeCleanupDecisionDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'cleaned',
        status: 'cleaned',
        errorReason: null
      }),
      expect.objectContaining({
        action: 'failed',
        status: 'failed',
        errorReason: 'Cleanup failed in [redacted-path]'
      })
    ]));
    expect(report.runProgressDiagnostics.harnessHookEvidenceDiagnostics[0]?.verificationCommand).toBe(
      'npm test -- [redacted-path]'
    );
    expect(report.runProgressDiagnostics.harnessHookEvidenceDiagnostics[1]?.checkpointReminderSummary).toBe(
      'Capture a note for [redacted-path]'
    );
    expect(report.runProgressDiagnostics.finalEvidenceSummaryDiagnostics[0]?.verificationCommand).toBe(
      'npm test -- [redacted-path]'
    );
    expect(report.runProgressDiagnostics.harnessHandoffStateDiagnostics[0]?.workspace.workspaceRoot).toBe(
      '[redacted-path]'
    );
    expect(report.runProgressDiagnostics.harnessHandoffStateDiagnostics[0]?.verification.command).toBe(
      'npm test -- [redacted-path]'
    );
    expect(report.runProgressDiagnostics.harnessHandoffStateDiagnostics[0]?.recommendedNextPrompt).toBe(
      'Continue run run-1 from handoff evidence and address: Wire.'
    );
    expect(report.collaborationDiagnostics.roomSessions[0]?.sessionToken).toBe('[redacted]');
    expect(reportText).not.toContain('C:/Users/test-user');
    expect(reportText).not.toContain('PRIVATE_STAGED_WRITE_AFTER_CONTENT');
    expect(reportText).not.toContain('PRIVATE_STAGED_PATCH_BEFORE_CONTENT');
    expect(reportText).not.toContain('PRIVATE_STAGED_PATCH_AFTER_CONTENT');
    expect(reportText).not.toContain('PRIVATE_STAGED_PATCH_TEXT');
    expect(reportText).not.toContain('PRIVATE_STAGED_HUNK_BEFORE_CONTENT');
    expect(reportText).not.toContain('PRIVATE_STAGED_HUNK_AFTER_CONTENT');
    expect(reportText).not.toContain('PRIVATE_STAGED_HUNK_PROPOSED_AFTER_CONTENT');
    expect(reportText).not.toContain('PRIVATE_STAGED_HUNK_PATCH_TEXT');
    expect(reportText).not.toContain('PRIVATE_STAGED_HUNK_PREVIEW_LINE');
    expect(reportText).not.toContain('PRIVATE_STAGED_HUNK_FAILED_BEFORE_CONTENT');
    expect(reportText).not.toContain('PRIVATE_STAGED_HUNK_FAILED_AFTER_CONTENT');
    expect(reportText).not.toContain('PRIVATE_STAGED_HUNK_FAILED_PROPOSED_AFTER_CONTENT');
    expect(reportText).not.toContain('PRIVATE_STAGED_HUNK_FAILED_PATCH_TEXT');
    expect(reportText).not.toContain('PRIVATE_STAGED_HUNK_FAILED_PREVIEW_LINE');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_SOURCE_ROOT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_RUNTIME_ROOT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_SOURCE_REPO_ROOT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_REPO_ROOT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_REVIEW_SOURCE_REPO_ROOT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_REVIEW_SOURCE_ROOT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_REVIEW_REPO_ROOT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_REVIEW_RUNTIME_ROOT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_REVIEW_BEFORE_CONTENT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_REVIEW_AFTER_CONTENT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_REVIEW_PATCH_TEXT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_REVIEW_PREVIEW_LINE');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_REVIEW_FAILED_BEFORE_CONTENT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_REVIEW_FAILED_AFTER_CONTENT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_REVIEW_FAILED_PATCH_TEXT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_REVIEW_FAILED_PREVIEW_LINE');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_HUNK_SOURCE_REPO_ROOT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_HUNK_SOURCE_ROOT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_HUNK_REPO_ROOT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_HUNK_RUNTIME_ROOT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_HUNK_BEFORE_CONTENT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_HUNK_AFTER_CONTENT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_HUNK_PATCH_TEXT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_HUNK_PREVIEW_LINE');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_HUNK_FAILED_BEFORE_CONTENT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_HUNK_FAILED_AFTER_CONTENT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_HUNK_FAILED_PATCH_TEXT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_HUNK_FAILED_PREVIEW_LINE');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_CLEANUP_SOURCE_REPO_ROOT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_CLEANUP_SOURCE_ROOT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_CLEANUP_REPO_ROOT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_CLEANUP_RUNTIME_ROOT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_CLEANUP_BEFORE_CONTENT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_CLEANUP_AFTER_CONTENT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_CLEANUP_PATCH_TEXT');
    expect(reportText).not.toContain('PRIVATE_WORKTREE_CLEANUP_PREVIEW_LINE');
    expect(reportText).not.toContain('PRIVATE_DISPATCH_PROMPT_TEXT');
    expect(reportText).not.toContain('PRIVATE_DISPATCH_SYSTEM_PROMPT');
    expect(reportText).not.toContain('PRIVATE_MODEL_ROUTING_PROMPT_TEXT');
    expect(reportText).not.toContain('PRIVATE_HARNESS_PROMPT_TEXT');
    expect(reportText).not.toContain('PRIVATE_HARNESS_USER_PROMPT');
    expect(reportText).not.toContain('PRIVATE_HARNESS_SYSTEM_PROMPT');
    expect(reportText).not.toContain('PRIVATE_SYSTEM_PROMPT_TEXT');
    expect(reportText).not.toContain('PRIVATE_CONTEXT_SECTION_CONTENT');
    expect(reportText).not.toContain('PRIVATE_MODEL_SELECTION_PROMPT_TEXT');
    expect(reportText).not.toContain('PRIVATE_TOOL_ROUTING_PROMPT_TEXT');
    expect(reportText).not.toContain('PRIVATE_INFRA_CONTEXT_CONTENT');
    expect(reportText).not.toContain('src/private.ts');
    expect(reportText).not.toContain('secret-session-token');
  });

  it('redacts absolute local paths with spaces in thread support reports', async () => {
    const exportsDir = await createExportsDir();
    const thread = createThreadDetail();
    thread.rawOutput = [
      {
        id: 'event-path-space',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'completed',
            summary: 'Ran command inside C:/Users/test-user/My Project/private-worktree',
            command: 'npm test',
            cwd: 'C:/Users/test-user/My Project/private-worktree',
            isolationMode: 'host_job_object_temp_profile'
          }
        },
        createdAt: '2026-03-17T00:00:05.000Z'
      }
    ];
    const db = {
      getProject: () => ({
        id: 'project-1',
        name: 'Support project',
        folderPath: 'C:/Users/test-user/My Project/private-worktree',
        trusted: true,
        defaultProviderId: 'openai',
        defaultModelByProvider: { openai: 'gpt-5' },
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z'
      }),
      getThread: () => thread
    } as unknown as Parameters<typeof DiagnosticsService>[0];

    const service = new DiagnosticsService(db, exportsDir);
    const reportDir = await service.exportThreadReport('thread-1', []);
    const reportText = await readFile(join(reportDir, 'report.json'), 'utf8');
    const report = JSON.parse(reportText) as {
      project: { folderPath: string | null };
      runProgressDiagnostics: {
        terminalCommandDiagnostics: Array<{ cwd: string | null; summary: string }>;
      };
    };

    expect(report.project.folderPath).toBe('[redacted-path]');
    expect(report.runProgressDiagnostics.terminalCommandDiagnostics[0]?.cwd).toBe('[redacted-path]');
    expect(report.runProgressDiagnostics.terminalCommandDiagnostics[0]?.summary).toBe('Ran command inside [redacted-path]');
    expect(reportText).not.toContain('My Project');
    expect(reportText).not.toContain('private-worktree');
  });
});
