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

describe('collectRunProgressDiagnostics payload extraction', () => {
  it('collects provider, progress, runtime, terminal, and verification payloads', () => {
    const diagnostics = collectFixtureDiagnostics();

    expect(diagnostics.providerEventDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        source: 'codex_app_server',
        providerEventType: 'item/completed',
        itemType: 'task_group',
        paths: [],
        decision: null,
        status: null,
        classification: 'task_candidate_unparsed'
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        source: 'codex_cli_json',
        providerEventType: 'read_file_begin',
        itemType: null,
        paths: ['src/renderer/app.tsx'],
        decision: null,
        status: 'started',
        classification: 'evidence_candidate_unparsed'
      })
    ]));
    expect(diagnostics.nativeProgressSnapshots).toEqual([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        title: 'Codex tasks',
        itemCount: 2,
        statuses: ['completed', 'in_progress']
      })
    ]);
    expect(diagnostics.toolRuntimeDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        kind: 'tool_call',
        toolName: 'read_file',
        phase: 'started',
        status: null,
        summary: 'Calling read_file'
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        kind: 'tool_result',
        toolName: 'read_file',
        phase: 'completed',
        status: 'completed',
        summary: 'Completed read_file'
      })
    ]));
    expect(diagnostics.terminalCommandDiagnostics).toEqual([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        phase: 'completed',
        summary: 'Ran npm test',
        command: 'npm test',
        cwd: 'C:/repo',
        isolationMode: 'host_job_object_temp_profile'
      })
    ]);
    expect(diagnostics.verificationArtifactDiagnostics).toEqual([
      expect.objectContaining({
        threadId: 'thread-1',
        threadTitle: 'Codex planning thread',
        providerId: 'openai',
        runId: 'run-1',
        createdAt: '2026-03-17T00:00:06.250Z',
        command: 'npm test -- C:/Users/test-user/Desktop/vicode-project/src/app.test.ts',
        cwd: 'C:/Users/test-user/Desktop/vicode-project',
        status: 'passed',
        exitCode: 0,
        durationMs: 1250,
        reason: 'package.json defines a test script.',
        skippedReason: null,
        permissionProfile: 'default',
        networkPolicy: 'disabled'
      })
    ]);
  });

  it('collects prompt, model, tool routing, and infrastructure evidence payloads', () => {
    const diagnostics = collectFixtureDiagnostics();

    expect(diagnostics.promptSectionEvidenceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        threadTitle: 'Codex planning thread',
        providerId: 'openai',
        runId: 'run-1',
        createdAt: '2026-03-17T00:00:00.220Z',
        sectionId: 'system-prompt',
        title: 'System prompt',
        placement: 'system',
        characterCount: 240,
        reason: 'provider model system instructions assembled for this run'
      }),
      expect.objectContaining({
        sectionId: 'workspace-context',
        title: 'Workspace context',
        placement: 'user',
        characterCount: 120,
        reason: 'context section included in the provider model prompt payload'
      })
    ]));
    expect(diagnostics.modelRoutingEvidenceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        createdAt: '2026-03-17T00:00:00.220Z',
        modelId: 'gpt-5',
        customProviderId: null,
        ollamaTransportMode: null,
        runMode: 'default',
        providerLabel: null,
        transportKind: null,
        runtimeAuthority: null,
        reason: 'model id carried from the provider run context before transport dispatch'
      }),
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        createdAt: '2026-03-17T00:00:00.210Z',
        modelId: 'gpt-5',
        providerLabel: 'OpenAI',
        transportKind: 'responses',
        runtimeAuthority: 'app_harness',
        reason: 'normalized provider model transport selected for this trusted workspace run'
      })
    ]));
    expect(diagnostics.toolRoutingEvidenceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        createdAt: '2026-03-17T00:00:00.220Z',
        toolId: 'native:read_file',
        callName: 'read_file',
        name: 'Read file',
        origin: 'native',
        visibilityGroup: 'workspace_read',
        included: true,
        reason: 'included in active provider model tool catalog',
        mutatesWorkspace: false,
        requiresApproval: false,
        readsWorkspace: true,
        usesNetwork: false
      }),
      expect.objectContaining({
        toolId: 'native:run_command',
        callName: 'run_command',
        included: false,
        reason: 'excluded before active provider model tool catalog assembly',
        requiresApproval: true,
        usesNetwork: true
      })
    ]));
    expect(diagnostics.infrastructureEvidenceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        createdAt: '2026-03-17T00:00:00.220Z',
        infrastructureId: 'workspace_read',
        label: 'Workspace read tools',
        available: true,
        reason: 'available through read_file',
        toolCallNames: ['read_file']
      }),
      expect.objectContaining({
        infrastructureId: 'shell_command',
        label: 'Host shell command',
        available: false,
        reason: 'run_command is not in the active provider model tool catalog',
        toolCallNames: []
      })
    ]));
  });
});
