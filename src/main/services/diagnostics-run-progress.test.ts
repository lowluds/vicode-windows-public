import { describe, expect, it } from 'vitest';
import type { Project, SubagentSummary, ThreadDetail } from '../../shared/domain';
import { collectRunProgressDiagnostics } from './diagnostics-run-progress';

const PROJECT: Project = {
  id: 'project-1',
  name: 'Project',
  folderPath: null,
  trusted: true,
  runtimeCommandPolicy: 'approval_required',
  runtimeNetworkPolicy: 'disabled',
  defaultProviderId: 'openai',
  defaultModelByProvider: { openai: 'gpt-5', gemini: 'gemini-2.5-pro', qwen: 'qwen3.5-plus', kimi: 'kimi-k2-thinking' },
  createdAt: '2026-03-17T00:00:00.000Z',
  updatedAt: '2026-03-17T00:00:00.000Z'
};

function createSubagentSummary(): SubagentSummary {
  return {
    id: 'subagent-1',
    parentThreadId: 'thread-1',
    parentRunId: 'run-1',
    childThreadId: 'thread-child',
    childRunId: 'run-child',
    name: 'reviewer',
    title: 'Review run evidence',
    prompt: 'Review run evidence.',
    providerId: 'openai',
    modelId: 'gpt-5',
    executionPermission: 'default',
    delegationProfile: 'verify',
    status: 'completed',
    outputSummary: 'Evidence looks complete.',
    lastError: null,
    createdAt: '2026-03-17T00:00:00.010Z',
    updatedAt: '2026-03-17T00:00:00.090Z',
    startedAt: '2026-03-17T00:00:00.020Z',
    completedAt: '2026-03-17T00:00:00.090Z'
  };
}

function createThread(): ThreadDetail {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Diagnostics run thread',
    providerId: 'openai',
    modelId: 'gpt-5',
    executionPermission: 'default',
    status: 'completed',
    archived: false,
    lastMessageAt: '2026-03-17T00:00:00.100Z',
    createdAt: '2026-03-17T00:00:00.000Z',
    updatedAt: '2026-03-17T00:00:00.100Z',
    lastPreview: '',
    planner: null as unknown as ThreadDetail['planner'],
    followUps: [],
    turns: [
      {
        id: 'turn-1',
        threadId: 'thread-1',
        runId: 'run-1',
        role: 'user',
        content: 'Collect diagnostics.',
        metadata: {
          harnessTaskContract: {
            taskKind: 'edit',
            objective: 'Collect diagnostics.',
            workspaceRoot: 'C:/Users/test-user/project',
            allowedPaths: ['src/main/services'],
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
        },
        createdAt: '2026-03-17T00:00:00.000Z'
      }
    ],
    rawOutput: [
      {
        id: 'event-submit',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'submit_received',
            at: '2026-03-17T00:00:00.000Z',
            detail: { providerId: 'openai' }
          }
        },
        createdAt: '2026-03-17T00:00:00.000Z'
      },
      {
        id: 'event-started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'run_started',
            at: '2026-03-17T00:00:00.010Z'
          }
        },
        createdAt: '2026-03-17T00:00:00.010Z'
      },
      {
        id: 'event-provider',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          providerDiagnostics: {
            source: 'codex_app_server',
            providerEventType: 'item/completed',
            itemType: 'task_group',
            itemKeys: ['id', 'status'],
            paths: ['output.0'],
            classification: 'task_candidate'
          }
        },
        createdAt: '2026-03-17T00:00:00.015Z'
      },
      {
        id: 'event-tool-call-mark',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'first_tool_call',
            at: '2026-03-17T00:00:00.020Z'
          }
        },
        createdAt: '2026-03-17T00:00:00.020Z'
      },
      {
        id: 'event-tool-call',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_call',
            toolName: 'apply_patch',
            phase: 'started',
            status: 'running',
            summary: 'Editing diagnostics module'
          }
        },
        createdAt: '2026-03-17T00:00:00.021Z'
      },
      {
        id: 'event-tool-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            toolName: 'apply_patch',
            phase: 'completed',
            status: 'completed',
            summary: 'Edited diagnostics module'
          }
        },
        createdAt: '2026-03-17T00:00:00.030Z'
      },
      {
        id: 'event-terminal',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'completed',
            summary: 'Ran diagnostics tests',
            command: 'npm test -- src/main/services/diagnostics.test.ts',
            cwd: 'C:/Users/test-user/project',
            isolationMode: 'direct_workspace'
          }
        },
        createdAt: '2026-03-17T00:00:00.040Z'
      },
      {
        id: 'event-progress',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          progressSnapshot: {
            title: 'Strengthening diagnostics',
            items: [
              { id: 'inspect', label: 'Inspect', status: 'completed', order: 0 },
              { id: 'test', label: 'Test', status: 'running', order: 1 }
            ]
          }
        },
        createdAt: '2026-03-17T00:00:00.050Z'
      },
      {
        id: 'event-completed-mark',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'completed',
            at: '2026-03-17T00:00:00.100Z'
          }
        },
        createdAt: '2026-03-17T00:00:00.100Z'
      }
    ]
  };
}

describe('collectRunProgressDiagnostics', () => {
  it('collects scoped run progress diagnostics and assembles the run evidence bundle', () => {
    const thread = createThread();
    const diagnostics = collectRunProgressDiagnostics({
      db: {
        listProjects: () => [PROJECT],
        listThreads: () => [{ ...thread, turns: undefined, rawOutput: undefined, planner: undefined, followUps: undefined }],
        listArchivedThreads: () => [],
        getThread: () => thread,
        listSubagentsByParentThread: () => [createSubagentSummary()]
      },
      threadIds: ['thread-1']
    });

    expect(diagnostics.providerEventDiagnostics).toEqual([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        source: 'codex_app_server',
        providerEventType: 'item/completed',
        itemType: 'task_group',
        itemKeys: ['id', 'status'],
        paths: ['output.0'],
        classification: 'task_candidate'
      })
    ]);
    expect(diagnostics.nativeProgressSnapshots).toEqual([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        title: 'Strengthening diagnostics',
        itemCount: 2,
        statuses: ['completed', 'running']
      })
    ]);
    expect(diagnostics.runtimeTraceDiagnostics).toEqual([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        stageCount: 4,
        terminalStage: 'completed',
        submitToRunStartedMs: 10,
        submitToFirstToolCallMs: 20,
        submitToTerminalMs: 100
      })
    ]);

    expect(diagnostics.runEvidenceBundles).toEqual([
      expect.objectContaining({
        identity: expect.objectContaining({
          threadId: 'thread-1',
          projectId: 'project-1',
          runId: 'run-1',
          status: 'completed',
          completedAt: '2026-03-17T00:00:00.100Z',
          terminalStage: 'completed'
        }),
        taskContractSummary: expect.objectContaining({
          objective: 'Collect diagnostics.',
          isolationMode: 'direct_workspace'
        }),
        runtimeTraceSummary: expect.objectContaining({
          stageCount: 4,
          terminalStage: 'completed'
        }),
        toolExecutionSummary: expect.objectContaining({
          toolCallCount: 1,
          toolResultCount: 1,
          terminalCommandCount: 1,
          tools: [
            {
              toolName: 'apply_patch',
              callCount: 1,
              resultCount: 1,
              mutatesWorkspace: null,
              errorCount: 0
            }
          ]
        })
      })
    ]);
  });
});
