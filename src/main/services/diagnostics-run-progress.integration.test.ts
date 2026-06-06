import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderDescriptor } from '../../shared/domain';
import { DiagnosticsService } from './diagnostics';
import { cleanupDiagnosticsTestDirs, createExportsDir, createSubagentSummary, createThreadDetail } from './diagnostics-test-fixtures';

type ExportedRunProgressDiagnostics = Record<string, Array<Record<string, unknown>>>;

describe('DiagnosticsService run progress diagnostics', () => {
  afterEach(async () => {
    await cleanupDiagnosticsTestDirs();
  });

  it('exports the collected run progress diagnostics with instrumentation and collaboration diagnostics', async () => {
    const exportsDir = await createExportsDir();
    const thread = createThreadDetail();
    const db = {
      listProjects: () => [{ id: 'project-1', name: 'Project', folderPath: null, trusted: true, defaultProviderId: 'openai', defaultModelByProvider: { openai: 'gpt-5', gemini: 'gemini-2.5-pro', qwen: 'qwen3.5-plus', kimi: 'kimi-k2-thinking' }, createdAt: '2026-03-17T00:00:00.000Z', updatedAt: '2026-03-17T00:00:00.000Z' }],
      getPreferences: () => ({ selectedProjectId: 'project-1', defaultProviderId: 'openai', defaultModelByProvider: { openai: 'gpt-5', gemini: 'gemini-2.5-pro', qwen: 'qwen3.5-plus', kimi: 'kimi-k2-thinking' }, defaultReasoningEffortByProvider: { openai: 'high', gemini: null, qwen: null, kimi: null }, defaultThinkingByProvider: { openai: false, gemini: false, qwen: true, kimi: false }, defaultExecutionPermission: 'default', followUpBehavior: 'queue', generatedMemoryUseEnabled: false, generatedMemoryGenerationEnabled: true, appearanceMode: 'system', onboardingComplete: true, lastOpenedThreadId: 'thread-1', microphoneAllowed: false }),
      listSkills: () => [],
      listAutomations: () => [],
      listThreads: () => [{ ...thread, turns: undefined, rawOutput: undefined, planner: undefined, followUps: undefined }],
      listArchivedThreads: () => [],
      getThread: () => thread,
      listSubagentsByParentThread: () => [createSubagentSummary()]
    } as unknown as Parameters<typeof DiagnosticsService>[0];
    const providers: ProviderDescriptor[] = [];

    const service = new DiagnosticsService(
      db,
      exportsDir,
      () => ({
        bootstrap: {
          config: { connectionState: 'connected' },
          account: { userId: 'user-1' }
        },
        roomSessions: [{ roomId: 'room-1', userId: 'user-1', sessionToken: 'token-1', updatedAt: '2026-03-20T15:00:00.000Z', expiresAt: null }],
        recentLifecycleEvents: [
          {
            recordedAt: '2026-03-20T15:00:01.000Z',
            level: 'info',
            event: 'channel.subscribed',
            roomId: 'room-1'
          }
        ]
      }),
      () => ({
        bootstrapDiagnostics: {
          capturedAt: '2026-03-20T15:05:00.000Z',
          durationMs: 14,
          projectCount: 1
        },
        skillCatalogDiagnostics: {
          capturedAt: '2026-03-20T15:05:01.000Z',
          durationMs: 9,
          skillCount: 0
        }
      })
    );

    const filePath = await service.export(providers);
    const exportedText = await readFile(filePath, 'utf8');
    const exported = JSON.parse(exportedText) as {
      instrumentationDiagnostics: {
        bootstrapDiagnostics: { durationMs: number; projectCount: number } | null;
        skillCatalogDiagnostics: { durationMs: number; skillCount: number } | null;
      };
      runProgressDiagnostics: ExportedRunProgressDiagnostics;
      collaborationDiagnostics: {
        bootstrap: { config: { connectionState: string } };
        roomSessions: Array<Record<string, unknown>>;
        recentLifecycleEvents: Array<Record<string, unknown>>;
      };
    };

    expect(Object.fromEntries(
      Object.entries(exported.runProgressDiagnostics).map(([key, value]) => [key, value.length])
    )).toEqual({
      providerEventDiagnostics: 3,
      nativeProgressSnapshots: 1,
      toolRuntimeDiagnostics: 4,
      terminalCommandDiagnostics: 1,
      verificationArtifactDiagnostics: 1,
      promptSectionEvidenceDiagnostics: 2,
      modelRoutingEvidenceDiagnostics: 2,
      toolRoutingEvidenceDiagnostics: 2,
      infrastructureEvidenceDiagnostics: 2,
      stagedWorkspaceChangeDiagnostics: 2,
      stagedWorkspaceHunkReviewDecisionDiagnostics: 2,
      worktreeChangeDiagnostics: 1,
      worktreeReviewDecisionDiagnostics: 4,
      worktreeHunkReviewDecisionDiagnostics: 2,
      worktreeCleanupDecisionDiagnostics: 2,
      harnessHookEvidenceDiagnostics: 2,
      finalEvidenceSummaryDiagnostics: 1,
      harnessHandoffStateDiagnostics: 5,
      runtimeTraceDiagnostics: 2,
      failedRunDiagnostics: 1,
      runEvidenceBundles: 5
    });
    expect(exported.runProgressDiagnostics.providerEventDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        source: 'codex_app_server'
      })
    ]));
    expect(exported.runProgressDiagnostics.runEvidenceBundles.map((bundle) => (bundle.identity as { runId: string }).runId).sort()).toEqual([
      'run-1',
      'run-2',
      'run-3',
      'run-4',
      'run-5'
    ]);
    expect(exportedText).not.toMatch(/PRIVATE_[A-Z0-9_]+/u);
    expect(exported.instrumentationDiagnostics.bootstrapDiagnostics).toEqual(
      expect.objectContaining({
        durationMs: 14,
        projectCount: 1
      })
    );
    expect(exported.instrumentationDiagnostics.skillCatalogDiagnostics).toEqual(
      expect.objectContaining({
        durationMs: 9,
        skillCount: 0
      })
    );
    expect(exported.collaborationDiagnostics.bootstrap.config.connectionState).toBe('connected');
    expect(exported.collaborationDiagnostics.roomSessions).toHaveLength(1);
    expect(exported.collaborationDiagnostics.recentLifecycleEvents).toEqual([
      expect.objectContaining({
        event: 'channel.subscribed',
        roomId: 'room-1'
      })
    ]);
  });
});
