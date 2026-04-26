import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderDescriptor, ThreadDetail } from '../../shared/domain';
import { DiagnosticsService } from './diagnostics';

const createdDirs: string[] = [];

async function createExportsDir() {
  const dir = await mkdtemp(join(tmpdir(), 'vicode-diagnostics-test-'));
  createdDirs.push(dir);
  return dir;
}

function createThreadDetail(): ThreadDetail {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Codex planning thread',
    providerId: 'openai',
    modelId: 'gpt-5',
    executionPermission: 'default',
    status: 'completed',
    archived: false,
    lastMessageAt: '2026-03-17T00:00:00.000Z',
    createdAt: '2026-03-17T00:00:00.000Z',
    updatedAt: '2026-03-17T00:00:00.000Z',
    lastPreview: '',
    turns: [],
    rawOutput: [
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
            diffStats: null,
            reviewAvailable: false,
            changeArtifact: null
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
        id: 'event-6a',
        threadId: 'thread-1',
        runId: 'run-2',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'submit_received',
            at: '2026-03-17T00:01:00.000Z'
          }
        },
        createdAt: '2026-03-17T00:01:00.000Z'
      },
      {
        id: 'event-6b',
        threadId: 'thread-1',
        runId: 'run-2',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'run_started',
            at: '2026-03-17T00:01:00.100Z'
          }
        },
        createdAt: '2026-03-17T00:01:00.100Z'
      },
      {
        id: 'event-6c',
        threadId: 'thread-1',
        runId: 'run-2',
        eventType: 'info',
        payload: {
          providerDiagnostics: {
            kind: 'provider_event_classification',
            source: 'ollama_chat_json',
            providerEventType: 'message/tool_calls',
            itemType: 'read_file',
            itemKeys: ['path'],
            paths: ['index.html'],
            decision: null,
            status: 'started',
            taskLike: false,
            classification: 'evidence_candidate_unparsed'
          },
          message: 'Thinking about the next step',
          activity: {
            kind: 'thinking',
            summary: 'Thinking about the next step'
          }
        },
        createdAt: '2026-03-17T00:01:00.200Z'
      },
      {
        id: 'event-6d',
        threadId: 'thread-1',
        runId: 'run-2',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_call',
            toolName: 'read_file',
            phase: 'started',
            summary: 'Calling read_file'
          }
        },
        createdAt: '2026-03-17T00:01:00.250Z'
      },
      {
        id: 'event-6e',
        threadId: 'thread-1',
        runId: 'run-2',
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
        createdAt: '2026-03-17T00:01:00.300Z'
      },
      {
        id: 'event-6f',
        threadId: 'thread-1',
        runId: 'run-2',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'failed',
            at: '2026-03-17T00:01:01.000Z',
            detail: {
              message: 'Ollama completed without producing assistant output.',
              reason: 'empty_output'
            }
          }
        },
        createdAt: '2026-03-17T00:01:01.000Z'
      },
      {
        id: 'event-6g',
        threadId: 'thread-1',
        runId: 'run-2',
        eventType: 'failed',
        payload: {
          message: 'Ollama completed without producing assistant output.'
        },
        createdAt: '2026-03-17T00:01:01.001Z'
      }
    ],
    planner: {
      threadId: 'thread-1',
      composerMode: 'default',
      turnState: 'idle',
      activePlanId: null,
      pendingQuestionCallId: null,
      updatedAt: '2026-03-17T00:00:00.000Z',
      activePlan: null,
      pendingQuestionSet: null
    },
    followUps: []
  };
}

describe('DiagnosticsService', () => {
  afterEach(async () => {
    await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('exports run progress diagnostics from raw run events', async () => {
    const exportsDir = await createExportsDir();
    const thread = createThreadDetail();
    const db = {
      listProjects: () => [{ id: 'project-1', name: 'Project', folderPath: null, trusted: true, defaultProviderId: 'openai', defaultModelByProvider: { openai: 'gpt-5', gemini: 'gemini-2.5-pro', qwen: 'qwen3.5-plus', kimi: 'kimi-k2-thinking' }, createdAt: '2026-03-17T00:00:00.000Z', updatedAt: '2026-03-17T00:00:00.000Z' }],
      getPreferences: () => ({ selectedProjectId: 'project-1', defaultProviderId: 'openai', defaultModelByProvider: { openai: 'gpt-5', gemini: 'gemini-2.5-pro', qwen: 'qwen3.5-plus', kimi: 'kimi-k2-thinking' }, defaultReasoningEffortByProvider: { openai: 'high', gemini: null, qwen: null, kimi: null }, defaultThinkingByProvider: { openai: false, gemini: false, qwen: true, kimi: false }, defaultExecutionPermission: 'default', followUpBehavior: 'queue', generatedMemoryUseEnabled: false, generatedMemoryGenerationEnabled: true, appearanceMode: 'system', onboardingComplete: true, lastOpenedThreadId: 'thread-1', microphoneAllowed: false }),
      listSkills: () => [],
      listAutomations: () => [],
      listThreads: () => [{ ...thread, turns: undefined, rawOutput: undefined, planner: undefined, followUps: undefined }],
      listArchivedThreads: () => [],
      getThread: () => thread
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
    const exported = JSON.parse(await readFile(filePath, 'utf8')) as {
      instrumentationDiagnostics: {
        bootstrapDiagnostics: {
          capturedAt: string;
          durationMs: number;
          projectCount: number;
        } | null;
        skillCatalogDiagnostics: {
          capturedAt: string;
          durationMs: number;
          skillCount: number;
        } | null;
      };
      runProgressDiagnostics: {
        providerEventDiagnostics: Array<Record<string, unknown>>;
        nativeProgressSnapshots: Array<Record<string, unknown>>;
        toolRuntimeDiagnostics: Array<Record<string, unknown>>;
        terminalCommandDiagnostics: Array<Record<string, unknown>>;
        runtimeTraceDiagnostics: Array<Record<string, unknown>>;
        failedRunDiagnostics: Array<Record<string, unknown>>;
      };
      collaborationDiagnostics: {
        bootstrap: {
          config: { connectionState: string };
          account: { userId: string };
        };
        roomSessions: Array<Record<string, unknown>>;
        recentLifecycleEvents: Array<Record<string, unknown>>;
      };
    };

    expect(exported.runProgressDiagnostics.providerEventDiagnostics).toEqual(expect.arrayContaining([
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
    expect(exported.runProgressDiagnostics.nativeProgressSnapshots).toEqual([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        title: 'Codex tasks',
        itemCount: 2,
        statuses: ['completed', 'in_progress']
      })
    ]);
    expect(exported.runProgressDiagnostics.toolRuntimeDiagnostics).toEqual(expect.arrayContaining([
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
    expect(exported.runProgressDiagnostics.terminalCommandDiagnostics).toEqual([
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
    expect(exported.runProgressDiagnostics.runtimeTraceDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        threadId: 'thread-1',
        runId: 'run-1',
        stageCount: 10,
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
          expect.objectContaining({ stage: 'completed' })
        ])
      })
    ]));
    expect(exported.runProgressDiagnostics.failedRunDiagnostics).toEqual([
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
      getThread: () => thread
    } as unknown as Parameters<typeof DiagnosticsService>[0];

    const service = new DiagnosticsService(db, exportsDir);
    const filePath = await service.exportThread('thread-1', []);
    const exported = JSON.parse(await readFile(filePath, 'utf8')) as {
      project: typeof project;
      thread: ThreadDetail;
      runProgressDiagnostics: {
        providerEventDiagnostics: Array<Record<string, unknown>>;
        runtimeTraceDiagnostics: Array<Record<string, unknown>>;
        failedRunDiagnostics: Array<Record<string, unknown>>;
      };
    };

    expect(exported.project.folderPath).toBe('C:/Users/test-user/Desktop/vicode-project/vitest1');
    expect(exported.thread.id).toBe('thread-1');
    expect(exported.runProgressDiagnostics.providerEventDiagnostics).toHaveLength(3);
    expect(exported.runProgressDiagnostics.runtimeTraceDiagnostics).toHaveLength(2);
    expect(exported.runProgressDiagnostics.failedRunDiagnostics).toHaveLength(1);
  });
});
