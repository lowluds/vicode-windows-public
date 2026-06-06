import { describe, expect, it, vi } from 'vitest';
import type {
  AgentRuntime,
  AgentRuntimeToolCatalog,
  AgentRuntimeToolDescriptor,
  AgentToolExecutionResult,
  AgentToolCall
} from '../../providers/agent-runtime';
import type {
  ProviderModelTransport,
  ProviderModelTurnRequest,
  ProviderModelTurnResult,
  ProviderRunCallbacks,
  ProviderRunContext,
  ProviderRunHandle
} from '../../providers/types';
import type { VerificationPlan } from '../../shared/harness-verification';
import {
  startProviderModelHarnessRun,
  type ProviderModelHarnessPolicy,
  type ProviderModelHarnessPreparedRun
} from './provider-model-harness-runner';
import { createOllamaResponsesHarnessPolicy } from '../../providers/ollama/tool-loop-responses-runner';

function createTool(
  callName: string,
  overrides: Partial<AgentRuntimeToolDescriptor> = {}
): AgentRuntimeToolDescriptor {
  return {
    id: `native:${callName}`,
    name: callName,
    callName,
    description: null,
    inputJsonSchema: null,
    origin: 'native',
    executionAuthority: 'app_runtime',
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'workspace_read',
    renderHint: 'workspace',
    reviewHint: 'none',
    orchestrationHint: 'inspect',
    mutatesWorkspace: false,
    readsWorkspace: true,
    usesNetwork: false,
    contentTrust: 'trusted',
    serverId: null,
    serverName: null,
    mcpToolName: null,
    ...overrides
  };
}

function createCatalog(tools: AgentRuntimeToolDescriptor[] = [createTool('read_file')]): AgentRuntimeToolCatalog {
  return {
    nativeWebResearchEnabled: tools.some((tool) => tool.visibilityGroup === 'web_research'),
    nativeTools: tools.filter((tool) => tool.origin === 'native'),
    mcpTools: tools.filter((tool) => tool.origin === 'mcp'),
    tools
  };
}

function createContext(overrides: Partial<ProviderRunContext> = {}): ProviderRunContext {
  return {
    threadId: 'thread-1',
    runId: 'run-1',
    prompt: 'Inspect the workspace.',
    sourcePrompt: 'Inspect the workspace.',
    modelId: 'test-model',
    reasoningEffort: null,
    thinkingEnabled: false,
    folderPath: 'C:\\workspace',
    trusted: true,
    apiKey: 'test-key',
    runMode: 'default',
    executionPermission: 'default',
    runtimeSkillResources: [],
    ...overrides
  };
}

function createVerificationPlan(overrides: Partial<VerificationPlan> = {}): VerificationPlan {
  return {
    command: 'npm test',
    commandSource: 'package_json_test_script',
    cwd: 'C:\\workspace',
    permissionProfile: 'default',
    networkPolicy: 'disabled',
    status: 'planned',
    reason: 'package.json defines a test script.',
    skippedReason: null,
    resultShape: {
      status: 'not_run',
      exitCode: null
    },
    ...overrides
  };
}

function runCommandContent(input: {
  exitCode: number;
  cwd?: string;
  stdout?: string;
  stderr?: string;
}) {
  return [
    `exit_code: ${input.exitCode}`,
    `cwd: ${input.cwd ?? 'C:\\workspace'}`,
    `stdout:\n${input.stdout ?? '[empty]'}`,
    `stderr:\n${input.stderr ?? '[empty]'}`
  ].join('\n\n');
}

function createCallbacks(overrides: Partial<ProviderRunCallbacks> = {}): ProviderRunCallbacks {
  return {
    onStart: vi.fn(),
    onDelta: vi.fn(),
    onInfo: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onAbort: vi.fn(),
    ...overrides
  };
}

function createPreparedRun(overrides: Partial<ProviderModelHarnessPreparedRun> = {}): ProviderModelHarnessPreparedRun {
  const activeToolCatalog = overrides.activeToolCatalog ?? createCatalog();
  return {
    activeToolCatalog,
    initialAgentPrompt: 'Assembled Vicode context prompt.',
    initialWebResearchDirective: null,
    promptPayload: {
      systemInstructions: 'Harness system instructions.',
      input: [
        {
          role: 'user',
          content: 'Assembled Vicode context prompt.'
        }
      ],
      tools: {
        definitions: []
      },
      attachments: {}
    },
    requiresNativeWebResearch: false,
    requiresFileContentMutation: false,
    requiresPostMutationVerification: false,
    requiredStaticWebPageFileExtensions: [],
    requiresWebImageArtifactReference: false,
    requiresWorkspaceMutation: false,
    systemPrompt: 'Harness system instructions.',
    tools: [],
    ...overrides
  };
}

function createPolicy(overrides: Partial<ProviderModelHarnessPolicy> = {}): ProviderModelHarnessPolicy {
  return {
    providerLabel: 'Test model',
    providerEventTypePrefix: 'test_harness',
    appendVisibleText: (current, rawChunk) => ({
      text: `${current}${rawChunk}`,
      delta: rawChunk
    }),
    stripToolCallMarkup: (content) => content,
    assistantSignalsPendingWorkspaceMutation: () => false,
    buildRequiredWebResearchReminder: () => 'REQUIRE_WEB_RESEARCH',
    buildRequiredMutationReminder: () => 'REQUIRE_MUTATION',
    buildRequiredPostMutationVerificationReminder: () => 'REQUIRE_VERIFICATION',
    formatToolLabel: (toolName) => toolName,
    formatToolResultForModel: (_toolCatalog, _toolName, content) => content,
    isMutatingToolCall: (toolCatalog, toolName) =>
      toolCatalog.tools.some((tool) => tool.callName === toolName && tool.mutatesWorkspace === true),
    isUntrustedToolResult: (toolCatalog, toolName) =>
      toolCatalog.tools.some((tool) => tool.callName === toolName && tool.contentTrust === 'untrusted_content'),
    isVerificationCommandToolCall: (toolCall: AgentToolCall) => toolCall.name === 'run_command',
    buildToolCallSignature: (toolCalls) => JSON.stringify(toolCalls),
    buildToolResultSignature: (toolResults) => JSON.stringify(toolResults),
    formatLimitError: (maxTurns) => `limit:${maxTurns}`,
    formatRuntimeError: () => 'runtime limit',
    formatStallError: () => 'stalled',
    formatMissingRequiredWebResearchError: () => 'missing web research',
    formatMissingRequiredMutationError: () => 'missing mutation',
    formatTransportError: (error) => `transport:${error instanceof Error ? error.message : String(error)}`,
    ...overrides
  };
}

class FakeTransport implements ProviderModelTransport {
  readonly requests: ProviderModelTurnRequest[] = [];
  private readonly results: ProviderModelTurnResult[];

  constructor(results: ProviderModelTurnResult[]) {
    this.results = [...results];
  }

  async sendTurn(request: ProviderModelTurnRequest) {
    this.requests.push(request);
    return this.results.shift() ?? {
      text: '',
      toolCalls: [],
      terminalState: 'completed'
    };
  }
}

async function startHarness(input: {
  agentRuntime?: AgentRuntime;
  callbacks?: ProviderRunCallbacks;
  context?: ProviderRunContext;
  policy?: ProviderModelHarnessPolicy;
  preparedRun?: ProviderModelHarnessPreparedRun;
  transport: ProviderModelTransport;
  limits?: {
    maxTurns?: number;
    maxRuntimeMs?: number;
    maxStalledToolTurns?: number;
    maxRequiredWebResearchReminders?: number;
    maxRequiredMutationReminders?: number;
  };
  buildFallbackRunContext?: (context: ProviderRunContext) => ProviderRunContext;
  fallbackToRun?: (context: ProviderRunContext, callbacks: ProviderRunCallbacks) => Promise<ProviderRunHandle>;
}) {
  const preparedRun = input.preparedRun ?? createPreparedRun();
  const agentRuntime = input.agentRuntime ?? {
    executeToolCall: vi.fn(async () => ({
      toolName: 'read_file',
      content: 'file contents'
    }))
  };
  const callbacks = input.callbacks ?? createCallbacks();
  const handle = await startProviderModelHarnessRun({
    agentRuntime,
    callbacks,
    context: input.context ?? createContext(),
    transport: input.transport,
    prepareRun: vi.fn(async () => preparedRun),
    policy: input.policy ?? createPolicy(),
    finalizeAssistantOutput: async (_context, output) => output,
    limits: input.limits,
    buildFallbackRunContext: input.buildFallbackRunContext,
    fallbackToRun: input.fallbackToRun
  });

  return {
    agentRuntime,
    callbacks,
    handle
  };
}

function objectInfoPayloads(callbacks: ProviderRunCallbacks) {
  const onInfo = callbacks.onInfo as unknown as { mock: { calls: Array<[unknown]> } };
  return onInfo.mock.calls
    .map(([payload]) => payload)
    .filter((payload): payload is Record<string, unknown> =>
      Boolean(payload) && typeof payload === 'object' && !Array.isArray(payload)
    );
}

function hookStages(callbacks: ProviderRunCallbacks) {
  return objectInfoPayloads(callbacks)
    .map((payload) => payload.harnessHookEvidence)
    .filter((value): value is { stage: string } =>
      Boolean(value) && typeof value === 'object' && 'stage' in value
    )
    .map((evidence) => evidence.stage);
}

function harnessHookEvidences(callbacks: ProviderRunCallbacks) {
  return objectInfoPayloads(callbacks)
    .map((payload) => payload.harnessHookEvidence)
    .filter((value): value is Record<string, unknown> =>
      Boolean(value) && typeof value === 'object'
    );
}

function finalEvidenceSummaries(callbacks: ProviderRunCallbacks) {
  return objectInfoPayloads(callbacks)
    .map((payload) => payload.finalEvidenceSummary)
    .filter((value): value is Record<string, unknown> =>
      Boolean(value) && typeof value === 'object'
    );
}

function verificationArtifacts(callbacks: ProviderRunCallbacks) {
  return objectInfoPayloads(callbacks)
    .map((payload) => payload.verificationArtifact)
    .filter((value): value is Record<string, unknown> =>
      Boolean(value) && typeof value === 'object'
    );
}

function stagedWorkspaceChangeSets(callbacks: ProviderRunCallbacks) {
  return objectInfoPayloads(callbacks)
    .map((payload) => payload.stagedWorkspaceChangeSet)
    .filter((value): value is Record<string, unknown> =>
      Boolean(value) && typeof value === 'object'
    );
}

describe('Provider model harness runner', () => {
  it('completes final assistant text without executing tools', async () => {
    const transport = new FakeTransport([
      {
        text: 'Done.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const { callbacks } = await startHarness({ transport });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Done.');
    });

    expect(callbacks.onDelta).toHaveBeenCalledWith('Done.');
    expect(transport.requests[0]).toMatchObject({
      modelId: 'test-model',
      systemInstructions: 'Harness system instructions.',
      input: [
        {
          role: 'user',
          content: 'Assembled Vicode context prompt.'
        }
      ]
    });
  });

  it('emits provider-reported context-window usage from normalized model turns', async () => {
    const transport = new FakeTransport([
      {
        text: 'Done.',
        toolCalls: [],
        terminalState: 'completed',
        contextWindowUsage: {
          usedTokens: 12_000,
          inputTokens: 10_000,
          outputTokens: 2_000,
          providerEventType: null
        }
      }
    ]);
    const { callbacks } = await startHarness({ transport });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Done.');
    });

    expect(callbacks.onInfo).toHaveBeenCalledWith({
      contextWindow: {
        usedTokens: 12_000,
        inputTokens: 10_000,
        outputTokens: 2_000,
        providerEventType: 'test_harness_context_window_usage'
      }
    });
  });

  it('emits provider-reported thinking activity from normalized model turns', async () => {
    const transport = new FakeTransport([
      {
        text: 'Done.',
        toolCalls: [],
        terminalState: 'completed',
        infoMessages: [
          {
            message: 'Inspecting the relevant files before editing.',
            activity: {
              kind: 'thinking',
              summary: 'Inspecting the relevant files before editing.',
              text: 'Inspecting the relevant files before editing.',
              providerEventType: 'ollama_chat_message_thinking'
            }
          }
        ]
      }
    ]);
    const { callbacks } = await startHarness({ transport });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Done.');
    });

    expect(callbacks.onInfo).toHaveBeenCalledWith({
      message: 'Inspecting the relevant files before editing.',
      activity: {
        kind: 'thinking',
        summary: 'Inspecting the relevant files before editing.',
        text: 'Inspecting the relevant files before editing.',
        providerEventType: 'ollama_chat_message_thinking'
      }
    });
  });

  it('passes the run thinking preference to normalized model turns', async () => {
    const transport = new FakeTransport([
      {
        text: 'Done.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);

    await startHarness({
      transport,
      context: createContext({
        thinkingEnabled: true
      })
    });

    expect(transport.requests[0]?.thinkingEnabled).toBe(true);
  });

  it('executes normalized tool calls and returns tool results to the model', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'read_file',
            arguments: {
              path: 'src/example.ts'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Read complete.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const executeToolCall = vi.fn(async () => ({
      toolName: 'read_file',
      content: 'export const value = 1;'
    }));
    const { callbacks } = await startHarness({
      transport,
      agentRuntime: {
        executeToolCall
      }
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Read complete.');
    });

    expect(executeToolCall).toHaveBeenCalledWith(
      {
        name: 'read_file',
        arguments: {
          path: 'src/example.ts'
        }
      },
      expect.objectContaining({
        workspaceRoot: 'C:\\workspace',
        executionPermission: 'default'
      })
    );
    expect(transport.requests[1]?.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('Tool result for read_file')
        })
      ])
    );
  });

  it('uses the runtime workspace root when executing app-owned tools', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'read_file',
            arguments: {
              path: 'src/example.ts'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Read complete.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const executeToolCall = vi.fn(async () => ({
      toolName: 'read_file',
      content: 'export const value = 1;'
    }));

    await startHarness({
      transport,
      context: createContext({
        folderPath: 'C:\\source-workspace',
        sourceWorkspaceRoot: 'C:\\source-workspace',
        runtimeWorkspaceRoot: 'C:\\vicode-worktrees\\project-1\\run-1'
      }),
      agentRuntime: {
        executeToolCall
      }
    });

    expect(executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'read_file'
      }),
      expect.objectContaining({
        workspaceRoot: 'C:\\vicode-worktrees\\project-1\\run-1'
      })
    );
  });

  it.each(['approved', 'rejected', 'cancelled'] as const)(
    'passes command approval decisions through the app runtime when %s',
    async (decision) => {
      const transport = new FakeTransport([
        {
          text: '',
          toolCalls: [
            {
              name: 'run_command',
              arguments: {
                command: 'npm test'
              }
            }
          ],
          terminalState: 'completed'
        },
        {
          text: 'Command handled.',
          toolCalls: [],
          terminalState: 'completed'
        }
      ]);
      const requestToolApproval = vi.fn(async () => decision);
      const executeToolCall = vi.fn(async (_call, runtimeContext) => {
        const approval = await runtimeContext.requestApproval?.({
          toolName: 'run_command',
          command: 'npm test',
          cwd: null,
          workspaceRoot: 'C:\\workspace'
        });
        return {
          toolName: 'run_command',
          content: `approval:${approval}`
        };
      });
      const callbacks = createCallbacks({
        requestToolApproval
      });

      await startHarness({
        transport,
        callbacks,
        agentRuntime: {
          executeToolCall
        }
      });

      await vi.waitFor(() => {
        expect(callbacks.onComplete).toHaveBeenCalledWith('Command handled.');
      });
      expect(requestToolApproval).toHaveBeenCalledWith({
        toolName: 'run_command',
        command: 'npm test',
        cwd: null,
        workspaceRoot: 'C:\\workspace'
      });
      expect(transport.requests[1]?.input.at(-1)?.content).toContain(`approval:${decision}`);
    }
  );

  it('returns tool errors to the model as tool-error content', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'read_file',
            arguments: {
              path: 'missing.ts'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'I saw the error.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    await startHarness({
      transport,
      agentRuntime: {
        executeToolCall: vi.fn(async () => ({
          toolName: 'read_file',
          content: 'ENOENT',
          isError: true
        }))
      }
    });

    await vi.waitFor(() => {
      expect(transport.requests[1]?.input.at(-1)?.content).toContain('Tool error: ENOENT');
    });
  });

  it('emits hook stages in order for a model turn with a tool call', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'read_file',
            arguments: {
              path: 'src/example.ts'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Read complete.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();
    await startHarness({
      callbacks,
      transport,
      agentRuntime: {
        executeToolCall: vi.fn(async () => ({
          toolName: 'read_file',
          content: 'export const value = 1;'
        }))
      }
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Read complete.');
    });

    expect(hookStages(callbacks)).toEqual([
      'before_model',
      'after_model',
      'before_tool',
      'after_tool',
      'before_model',
      'after_model',
      'before_finalize'
    ]);
  });

  it('emits on_tool_error before the model receives tool-error content', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'read_file',
            arguments: {
              path: 'missing.ts'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'I saw the error.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();
    await startHarness({
      callbacks,
      transport,
      agentRuntime: {
        executeToolCall: vi.fn(async () => ({
          toolName: 'read_file',
          content: 'ENOENT',
          isError: true
        }))
      }
    });

    await vi.waitFor(() => {
      expect(transport.requests[1]?.input.at(-1)?.content).toContain('Tool error: ENOENT');
    });

    const stages = hookStages(callbacks);
    expect(stages).toEqual([
      'before_model',
      'after_model',
      'before_tool',
      'after_tool',
      'on_tool_error',
      'before_model',
      'after_model',
      'before_finalize'
    ]);
    expect(stages.indexOf('on_tool_error')).toBeLessThan(stages.indexOf('before_model', 1));
  });

  it('emits context pressure evidence without automatic compaction or continuation', async () => {
    const transport = new FakeTransport([
      {
        text: 'Done.',
        toolCalls: [],
        terminalState: 'completed'
      },
      {
        text: 'Unexpected continuation.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();
    await startHarness({
      callbacks,
      transport,
      context: createContext({
        contextPressure: {
          severity: 'warning',
          pressureLabel: 'High context pressure',
          note: 'Context pressure is building.',
          source: 'provider',
          sourceLabel: 'OpenAI reported usage',
          usagePercent: 78,
          usedTokens: 780_000,
          maxTokens: 1_000_000,
          checkpointRecommended: true,
          compactionLikely: false
        },
        checkpointReminder: {
          kind: 'context_pressure',
          title: 'Checkpoint recommended',
          message: 'Context pressure is building. Preserve the durable memory before another long follow-up.'
        }
      })
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Done.');
    });

    expect(harnessHookEvidences(callbacks)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: 'context_pressure',
        contextPressureSeverity: 'warning',
        contextPressureUsagePercent: 78,
        contextPressureUsedTokens: 780_000,
        contextPressureMaxTokens: 1_000_000,
        contextPressureSource: 'provider',
        contextPressureSourceLabel: 'OpenAI reported usage',
        contextPressureCheckpointRecommended: true,
        contextPressureCompactionLikely: false,
        checkpointReminderKind: 'context_pressure',
        checkpointReminderTitle: 'Checkpoint recommended',
        checkpointReminderSummary: 'Context pressure is building. Preserve the durable memory before another long follow-up.'
      })
    ]));
    expect(hookStages(callbacks)).not.toContain('continuation');
    expect(transport.requests).toHaveLength(1);
  });

  it('stops when the max-turn guardrail is reached', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'read_file',
            arguments: {
              path: 'a.ts'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'read_file',
            arguments: {
              path: 'b.ts'
            }
          }
        ],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();

    await startHarness({
      callbacks,
      transport,
      limits: {
        maxTurns: 2
      }
    });

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalledWith('limit:2');
    });
  });

  it('prompts the model to use required web research before final text', async () => {
    const transport = new FakeTransport([
      {
        text: 'Answering from memory.',
        toolCalls: [],
        terminalState: 'completed'
      },
      {
        text: 'Researched answer.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    await startHarness({
      transport,
      preparedRun: createPreparedRun({
        requiresNativeWebResearch: true
      })
    });

    await vi.waitFor(() => {
      expect(transport.requests[1]?.input.at(-1)?.content).toBe('REQUIRE_WEB_RESEARCH');
    });
  });

  it('prompts the model to mutate the workspace before final text', async () => {
    const transport = new FakeTransport([
      {
        text: 'I would change the file.',
        toolCalls: [],
        terminalState: 'completed'
      },
      {
        text: 'Mutation handled.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    await startHarness({
      transport,
      preparedRun: createPreparedRun({
        requiresWorkspaceMutation: true
      })
    });

    await vi.waitFor(() => {
      expect(transport.requests[1]?.input.at(-1)?.content).toBe('REQUIRE_MUTATION');
    });
  });

  it('emits continuation evidence when reminding after a premature mutation answer', async () => {
    const transport = new FakeTransport([
      {
        text: 'I would change the file.',
        toolCalls: [],
        terminalState: 'completed'
      },
      {
        text: 'Mutation handled.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();
    await startHarness({
      callbacks,
      transport,
      preparedRun: createPreparedRun({
        requiresWorkspaceMutation: true
      })
    });

    await vi.waitFor(() => {
      expect(transport.requests[1]?.input.at(-1)?.content).toBe('REQUIRE_MUTATION');
    });

    expect(harnessHookEvidences(callbacks)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: 'continuation',
        turnIndex: 0,
        summary: 'Prompting Test model to continue until the requested workspace changes are complete.',
        continuationReason: 'required_mutation',
        continuationReminderCount: 1,
        continuationMaxReminderCount: 2
      })
    ]));
  });

  it('uses a tool-call contract reminder before generic mutation reminders for recoverable violations', async () => {
    const transport = new FakeTransport([
      {
        text: 'I will call the tool now:\n```json\n{"name":"write_file","arguments":{"path":"src/example.ts","content":"ok"}}\n```',
        toolCalls: [],
        terminalState: 'completed',
        toolCallContractViolation: {
          providerId: 'ollama',
          reason: 'surrounding_prose',
          candidateToolName: 'write_file',
          recoverable: true
        }
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'src/example.ts',
              content: 'ok'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Mutation handled.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const executeToolCall = vi.fn(async (call) => ({
      toolName: call.name,
      content: `Wrote ${call.arguments.path}`
    }));
    const callbacks = createCallbacks();
    await startHarness({
      callbacks,
      transport,
      agentRuntime: {
        executeToolCall
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          })
        ]),
        requiresWorkspaceMutation: true
      }),
      policy: createPolicy({
        buildToolCallContractReminder: ({ reason, candidateToolName, runMode }) =>
          `CONTRACT:${runMode}:${reason}:${candidateToolName ?? 'none'}`
      })
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Mutation handled.');
    });
    expect(transport.requests[1]?.input.at(-1)?.content).toBe('CONTRACT:default:surrounding_prose:write_file');
    expect(transport.requests[1]?.input).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: expect.stringContaining('I will call the tool now')
        })
      ])
    );
    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'write_file',
        arguments: {
          path: 'src/example.ts',
          content: 'ok'
        }
      }),
      expect.any(Object)
    );
    expect(harnessHookEvidences(callbacks)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: 'continuation',
        turnIndex: 0,
        summary: 'Prompting Test model to re-emit a valid tool-call envelope.',
        continuationReason: 'required_mutation',
        continuationReminderCount: 1,
        continuationMaxReminderCount: 2
      })
    ]));
  });

  it('limits repeated tool-call contract reminders with the mutation reminder budget', async () => {
    const transport = new FakeTransport([
      {
        text: 'I will call the tool now:\n```json\n{"name":"write_file","arguments":{"path":"src/example.ts","content":"ok"}}\n```',
        toolCalls: [],
        terminalState: 'completed',
        toolCallContractViolation: {
          providerId: 'ollama',
          reason: 'surrounding_prose',
          candidateToolName: 'write_file',
          recoverable: true
        }
      },
      {
        text: 'Still trying:\n```json\n{"name":"write_file","arguments":{"path":"src/example.ts","content":"ok"}}\n```',
        toolCalls: [],
        terminalState: 'completed',
        toolCallContractViolation: {
          providerId: 'ollama',
          reason: 'surrounding_prose',
          candidateToolName: 'write_file',
          recoverable: true
        }
      }
    ]);
    const executeToolCall = vi.fn(async (call) => ({
      toolName: call.name,
      content: `Wrote ${call.arguments.path}`
    }));
    const callbacks = createCallbacks();
    await startHarness({
      callbacks,
      transport,
      agentRuntime: {
        executeToolCall
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          })
        ]),
        requiresWorkspaceMutation: true
      }),
      policy: createPolicy({
        buildToolCallContractReminder: ({ reason }) => `CONTRACT:${reason}`
      }),
      limits: {
        maxRequiredMutationReminders: 1
      }
    });

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalledWith('missing mutation');
    });
    expect(transport.requests[1]?.input.at(-1)?.content).toBe('CONTRACT:surrounding_prose');
    expect(transport.requests).toHaveLength(2);
    expect(executeToolCall).not.toHaveBeenCalled();
  });

  it('uses the Ollama contract reminder text for recoverable tool-call violations', async () => {
    const transport = new FakeTransport([
      {
        text: 'I will call the tool now:\n```json\n{"name":"write_file","arguments":{"path":"src/example.ts","content":"ok"}}\n```',
        toolCalls: [],
        terminalState: 'completed',
        toolCallContractViolation: {
          providerId: 'ollama',
          reason: 'surrounding_prose',
          candidateToolName: 'write_file',
          recoverable: true
        }
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'src/example.ts',
              content: 'ok'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Mutation handled.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();
    await startHarness({
      callbacks,
      transport,
      agentRuntime: {
        executeToolCall: vi.fn(async (call) => ({
          toolName: call.name,
          content: `Wrote ${call.arguments.path}`
        }))
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          })
        ]),
        requiresWorkspaceMutation: true,
        requiresFileContentMutation: true
      }),
      policy: createOllamaResponsesHarnessPolicy()
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Mutation handled.');
    });
    expect(transport.requests[1]?.input.at(-1)?.content).toContain('Vicode did not execute');
    expect(transport.requests[1]?.input.at(-1)?.content).toContain('exactly one executable tool call and no prose');
    expect(transport.requests[1]?.input.at(-1)?.content).toContain('Do not include the final answer until after Vicode returns the tool result.');
    expect(transport.requests[1]?.input.at(-1)?.content).toContain('Use only active tool names and include all required arguments.');
  });

  it('prompts the model to run the planned verification command after mutation before final text', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'src/example.ts',
              content: 'export const value = 1;'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Done without verification.',
        toolCalls: [],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'run_command',
            arguments: {
              command: 'npm test'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Verified changes.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const { callbacks } = await startHarness({
      transport,
      context: createContext({
        verificationPlan: createVerificationPlan()
      } as Partial<ProviderRunContext>),
      agentRuntime: {
        executeToolCall: vi.fn(async (call) => ({
          toolName: call.name,
          content: call.name === 'run_command' ? 'Tests passed.' : 'Wrote file.'
        }))
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          }),
          createTool('run_command', {
            visibilityGroup: 'host_command'
          })
        ]),
        requiresPostMutationVerification: true
      }),
      policy: createPolicy({
        buildRequiredPostMutationVerificationReminder: (_lastVerificationFailed, plannedCommand?: string | null) =>
          `REQUIRE_VERIFICATION:${plannedCommand ?? 'none'}`
      })
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Verified changes.');
    });
    expect(callbacks.onComplete).not.toHaveBeenCalledWith('Done without verification.');
    expect(transport.requests[2]?.input.at(-1)?.content).toBe('REQUIRE_VERIFICATION:npm test');
  });

  it('keeps executing all planned static page files before post-mutation verification', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'web_search',
            arguments: {
              query: 'Unsplash landing page hero image'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'read_file',
            arguments: {
              path: 'index.html'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'index.html',
              content: '<!doctype html><title>Landing</title>'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Index file is ready.',
        toolCalls: [],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'styles.css',
              content: 'body { background: #111; }'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Styles are ready.',
        toolCalls: [],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'main.js',
              content: "document.body.dataset.ready = 'true';"
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'run_command',
            arguments: {
              command: 'npm test'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Landing page built and verified.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const writtenFiles = new Set<string>();
    const executeToolCall = vi.fn(async (call: AgentToolCall): Promise<AgentToolExecutionResult> => {
      if (call.name === 'list_directory') {
        const listing = [...writtenFiles]
          .sort((a, b) => a.localeCompare(b))
          .map((fileName) => `file ${fileName}`)
          .join('\n');
        return {
          toolName: call.name,
          content: listing || '[empty]'
        };
      }

      if (call.name === 'write_file') {
        const path = typeof call.arguments.path === 'string' ? call.arguments.path : '';
        if (path) {
          writtenFiles.add(path);
        }
        return {
          toolName: call.name,
          content: `Wrote ${path}`
        };
      }

      if (call.name === 'run_command') {
        return {
          toolName: call.name,
          content: runCommandContent({
            exitCode: 0,
            stdout: 'Tests passed'
          })
        };
      }

      return {
        toolName: call.name,
        content: `${call.name} complete`
      };
    });
    const callbacks = createCallbacks();

    await startHarness({
      callbacks,
      transport,
      context: createContext({
        verificationPlan: createVerificationPlan()
      }),
      agentRuntime: {
        executeToolCall
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('web_search', {
            visibilityGroup: 'web_research',
            readsWorkspace: false,
            usesNetwork: true,
            contentTrust: 'untrusted_content'
          }),
          createTool('read_file'),
          createTool('list_directory'),
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          }),
          createTool('run_command', {
            visibilityGroup: 'host_command'
          })
        ]),
        requiresNativeWebResearch: true,
        requiresWorkspaceMutation: true,
        requiresFileContentMutation: true,
        requiresPostMutationVerification: true,
        requiredStaticWebPageFileExtensions: ['.html', '.css', '.js']
      }),
      policy: createPolicy({
        buildRequiredPostMutationVerificationReminder: (_lastVerificationFailed, plannedCommand?: string | null) =>
          `REQUIRE_VERIFICATION:${plannedCommand ?? 'none'}`
      })
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Landing page built and verified.');
    });
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'web_search' }),
      expect.any(Object)
    );
    expect(executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'read_file' }),
      expect.any(Object)
    );
    expect(executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'run_command' }),
      expect.any(Object)
    );
    expect([...writtenFiles].sort((a, b) => a.localeCompare(b))).toEqual([
      'index.html',
      'main.js',
      'styles.css'
    ]);
    expect(executeToolCall.mock.calls.map(([call]) => call.name)).toEqual([
      'web_search',
      'read_file',
      'write_file',
      'list_directory',
      'write_file',
      'list_directory',
      'write_file',
      'run_command',
      'list_directory'
    ]);
    const reminderPrompts = transport.requests
      .map((request) => request.input.at(-1)?.content ?? '')
      .filter((content) => /Internal runtime reminder|REQUIRE_VERIFICATION/u.test(content));
    expect(reminderPrompts[0]).toContain('The user asked for a static web page that requires index.html, styles.css, main.js.');
    expect(reminderPrompts[1]).toContain('The user asked for a static web page that requires index.html, styles.css, main.js.');
    expect(reminderPrompts).toHaveLength(2);
  });

  it('passes patch-buffer isolation to runtime and emits staged workspace evidence', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'src/example.ts',
              content: 'export const value = 1;\n'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Staged proposal ready.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const stagedWorkspaceChangeSet = {
      threadId: 'thread-1',
      runId: 'run-1',
      sourceToolName: 'write_file',
      isolationMode: 'patch_buffer',
      status: 'proposed',
      requestedPath: 'src/example.ts',
      changedPaths: ['src/example.ts'],
      operations: [
        {
          operation: 'write_file',
          path: 'src/example.ts',
          beforeContent: null,
          proposedAfterContent: 'export const value = 1;\n',
          patchText: null
        }
      ],
      summary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 0
      }
    } as const;
    const executeToolCall = vi.fn(async (call: AgentToolCall): Promise<AgentToolExecutionResult> => ({
      toolName: call.name,
      content: 'Staged write_file src/example.ts',
      stagedWorkspaceChangeSet
    }));
    const { callbacks } = await startHarness({
      transport,
      context: createContext({
        harnessTaskContract: {
          taskKind: 'edit',
          objective: 'Stage a file edit.',
          workspaceRoot: 'C:\\workspace',
          allowedPaths: [],
          deniedPaths: [],
          expectedMutations: 'workspace_write',
          verificationPolicy: 'required',
          isolationMode: 'patch_buffer',
          riskLevel: 'medium',
          executionPermission: 'default',
          trustedWorkspace: true,
          runtimeCommandPolicy: 'approval_required',
          runtimeNetworkPolicy: 'disabled',
          commandAccess: 'approval_required',
          networkAccess: 'disabled'
        }
      }),
      agentRuntime: {
        executeToolCall
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          })
        ]),
        requiresWorkspaceMutation: true
      })
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Staged proposal ready.');
    });
    expect(executeToolCall.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        isolationMode: 'patch_buffer'
      })
    );
    expect(stagedWorkspaceChangeSets(callbacks)).toEqual([stagedWorkspaceChangeSet]);
  });

  it('does not require post-mutation verification for staged-only patch-buffer changes', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'src/example.ts',
              content: 'export const value = 1;\n'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Staged proposal ready.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const { callbacks } = await startHarness({
      transport,
      context: createContext({
        harnessTaskContract: {
          taskKind: 'edit',
          objective: 'Stage a file edit.',
          workspaceRoot: 'C:\\workspace',
          allowedPaths: [],
          deniedPaths: [],
          expectedMutations: 'workspace_write',
          verificationPolicy: 'required',
          isolationMode: 'patch_buffer',
          riskLevel: 'medium',
          executionPermission: 'default',
          trustedWorkspace: true,
          runtimeCommandPolicy: 'approval_required',
          runtimeNetworkPolicy: 'disabled',
          commandAccess: 'approval_required',
          networkAccess: 'disabled'
        },
        verificationPlan: createVerificationPlan()
      }),
      agentRuntime: {
        executeToolCall: vi.fn(async (call: AgentToolCall): Promise<AgentToolExecutionResult> => ({
          toolName: call.name,
          content: 'Staged write_file src/example.ts',
          stagedWorkspaceChangeSet: {
            threadId: 'thread-1',
            runId: 'run-1',
            sourceToolName: 'write_file',
            isolationMode: 'patch_buffer',
            status: 'proposed',
            requestedPath: 'src/example.ts',
            changedPaths: ['src/example.ts'],
            operations: [],
            summary: {
              filesChanged: 1,
              insertions: 1,
              deletions: 0
            }
          }
        }))
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          }),
          createTool('run_command', {
            visibilityGroup: 'host_command'
          })
        ]),
        requiresPostMutationVerification: true,
        requiresWorkspaceMutation: true
      })
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Staged proposal ready.');
    });
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests.map((request) => request.input.at(-1)?.content)).not.toContain('REQUIRE_VERIFICATION');
    expect(finalEvidenceSummaries(callbacks).at(-1)).toEqual(
      expect.objectContaining({
        usedMutatingTool: true,
        usedFileContentMutationTool: true,
        postMutationVerificationRequired: false,
        postMutationVerificationPassed: false,
        verificationStatus: null
      })
    );
  });

  it('prompts for remediation when post-mutation verification fails', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'src/example.ts',
              content: 'export const value = 1;'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'run_command',
            arguments: {
              command: 'npm test'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Verification failed but done.',
        toolCalls: [],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'run_command',
            arguments: {
              command: 'npm test'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Fixed and verified.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    let commandCount = 0;
    await startHarness({
      transport,
      context: createContext({
        verificationPlan: createVerificationPlan()
      } as Partial<ProviderRunContext>),
      agentRuntime: {
        executeToolCall: vi.fn(async (call) => {
          if (call.name === 'run_command') {
            commandCount += 1;
            return {
              toolName: call.name,
              content: commandCount === 1 ? 'Tests failed.' : 'Tests passed.',
              isError: commandCount === 1
            };
          }

          return {
            toolName: call.name,
            content: 'Wrote file.'
          };
        })
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          }),
          createTool('run_command', {
            visibilityGroup: 'host_command'
          })
        ]),
        requiresPostMutationVerification: true
      }),
      policy: createPolicy({
        buildRequiredPostMutationVerificationReminder: (lastVerificationFailed, plannedCommand?: string | null) =>
          `REQUIRE_VERIFICATION:${lastVerificationFailed ? 'failed' : 'missing'}:${plannedCommand ?? 'none'}`
      })
    });

    await vi.waitFor(() => {
      expect(transport.requests[3]?.input.at(-1)?.content).toBe('REQUIRE_VERIFICATION:failed:npm test');
    });
  });

  it('allows final completion after post-mutation verification passes', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'src/example.ts',
              content: 'export const value = 1;'
            }
          },
          {
            name: 'run_command',
            arguments: {
              command: 'npm test'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Done and verified.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const { callbacks } = await startHarness({
      transport,
      context: createContext({
        verificationPlan: createVerificationPlan()
      } as Partial<ProviderRunContext>),
      agentRuntime: {
        executeToolCall: vi.fn(async (call) => ({
          toolName: call.name,
          content: call.name === 'run_command' ? 'Tests passed.' : 'Wrote file.'
        }))
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          }),
          createTool('run_command', {
            visibilityGroup: 'host_command'
          })
        ]),
        requiresPostMutationVerification: true
      })
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Done and verified.');
    });
    expect(transport.requests).toHaveLength(2);
  });

  it('emits a verification artifact when the planned post-mutation command passes', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'src/example.ts',
              content: 'export const value = 1;'
            }
          },
          {
            name: 'run_command',
            arguments: {
              command: 'npm test'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Done and verified.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();
    await startHarness({
      callbacks,
      transport,
      context: createContext({
        verificationPlan: createVerificationPlan()
      }),
      agentRuntime: {
        executeToolCall: vi.fn(async (call) => ({
          toolName: call.name,
          content: call.name === 'run_command'
            ? runCommandContent({
                exitCode: 0,
                stdout: 'Test Files  1 passed\nTests  2 passed'
              })
            : 'Wrote file.',
          isError: false
        }))
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          }),
          createTool('run_command', {
            visibilityGroup: 'host_command'
          })
        ]),
        requiresPostMutationVerification: true
      })
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Done and verified.');
    });
    expect(callbacks.onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: 'debug_detail',
        transcriptVisible: false,
        verificationArtifact: expect.objectContaining({
          command: 'npm test',
          cwd: 'C:\\workspace',
          permissionProfile: 'default',
          networkPolicy: 'disabled',
          status: 'passed',
          exitCode: 0,
          stdout: 'Test Files  1 passed\nTests  2 passed',
          stderr: '',
          reason: 'package.json defines a test script.',
          skippedReason: null,
          startedAt: expect.any(String),
          finishedAt: expect.any(String),
          durationMs: expect.any(Number)
        })
      })
    );
    expect(hookStages(callbacks)).toEqual(expect.arrayContaining([
      'after_mutation',
      'before_verification',
      'after_verification'
    ]));
  });

  it('emits a final evidence summary before successful completion', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'src/example.ts',
              content: 'export const value = 1;'
            }
          },
          {
            name: 'run_command',
            arguments: {
              command: 'npm test'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Done and verified.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const eventOrder: string[] = [];
    const callbacks = createCallbacks({
      onInfo: vi.fn((payload) => {
        if (payload && typeof payload === 'object' && 'finalEvidenceSummary' in payload) {
          eventOrder.push('summary');
        }
      }),
      onComplete: vi.fn(() => {
        eventOrder.push('complete');
      })
    });
    await startHarness({
      callbacks,
      transport,
      context: createContext({
        verificationPlan: createVerificationPlan()
      }),
      agentRuntime: {
        executeToolCall: vi.fn(async (call) => ({
          toolName: call.name,
          content: call.name === 'run_command'
            ? runCommandContent({
                exitCode: 0,
                stdout: 'Tests passed'
              })
            : 'Wrote file.',
          isError: false
        }))
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          }),
          createTool('run_command', {
            visibilityGroup: 'host_command'
          })
        ]),
        requiresPostMutationVerification: true
      })
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Done and verified.');
    });

    expect(eventOrder).toEqual(['summary', 'complete']);
    expect(finalEvidenceSummaries(callbacks)).toEqual([
      expect.objectContaining({
        runId: 'run-1',
        usedMutatingTool: true,
        usedFileContentMutationTool: true,
        usedNativeWebResearchTool: false,
        postMutationVerificationRequired: true,
        postMutationVerificationPassed: true,
        verificationCommand: 'npm test',
        verificationStatus: 'passed',
        createdDirectoriesCount: 0,
        writtenFilesCount: 1,
        toolCallCount: 2,
        reminderCount: 0
      })
    ]);
  });

  it('does not emit continuation hook evidence or continue automatically after final completion', async () => {
    const transport = new FakeTransport([
      {
        text: 'Done.',
        toolCalls: [],
        terminalState: 'completed'
      },
      {
        text: 'Unexpected continuation.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();
    await startHarness({
      callbacks,
      transport
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Done.');
    });

    expect(hookStages(callbacks)).not.toContain('continuation');
    expect(transport.requests).toHaveLength(1);
  });

  it('emits a verification artifact when the planned post-mutation command fails', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'src/example.ts',
              content: 'export const value = 1;'
            }
          },
          {
            name: 'run_command',
            arguments: {
              command: 'npm test'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Fixing verification.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();
    await startHarness({
      callbacks,
      transport,
      context: createContext({
        verificationPlan: createVerificationPlan()
      }),
      agentRuntime: {
        executeToolCall: vi.fn(async (call) => ({
          toolName: call.name,
          content: call.name === 'run_command'
            ? runCommandContent({
                exitCode: 1,
                stdout: '1 failed',
                stderr: 'AssertionError'
              })
            : 'Wrote file.',
          isError: call.name === 'run_command'
        }))
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          }),
          createTool('run_command', {
            visibilityGroup: 'host_command'
          })
        ]),
        requiresPostMutationVerification: true
      }),
      limits: {
        maxRequiredMutationReminders: 1
      }
    });

    await vi.waitFor(() => {
      expect(callbacks.onInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          verificationArtifact: expect.objectContaining({
            command: 'npm test',
            status: 'failed',
            exitCode: 1,
            stdout: '1 failed',
            stderr: 'AssertionError'
          })
        })
      );
    });
  });

  it('does not emit a verification artifact for non-verification run_command calls', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'run_command',
            arguments: {
              command: 'npm test'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Command handled.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();
    await startHarness({
      callbacks,
      transport,
      context: createContext({
        verificationPlan: createVerificationPlan()
      }),
      agentRuntime: {
        executeToolCall: vi.fn(async (call) => ({
          toolName: call.name,
          content: runCommandContent({
            exitCode: 0,
            stdout: 'Tests passed'
          })
        }))
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('run_command', {
            visibilityGroup: 'host_command'
          })
        ])
      })
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Command handled.');
    });
    expect(callbacks.onInfo).not.toHaveBeenCalledWith(
      expect.objectContaining({
        verificationArtifact: expect.any(Object)
      })
    );
  });

  it('emits skipped final verification evidence for skipped verification plans after applied mutation', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'src/example.ts',
              content: 'export const value = 1;'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Done without command verification.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();
    await startHarness({
      callbacks,
      transport,
      context: createContext({
        verificationPlan: createVerificationPlan({
          command: null,
          commandSource: 'unavailable',
          status: 'skipped',
          reason: 'No automatic verification command could be selected.',
          skippedReason: 'No package.json test/build script or TypeScript config was detected.',
          resultShape: {
            status: 'skipped',
            exitCode: null
          }
        })
      }),
      agentRuntime: {
        executeToolCall: vi.fn(async (call) => ({
          toolName: call.name,
          content: 'Wrote file.'
        }))
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          })
        ])
      })
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Done without command verification.');
    });
    expect(verificationArtifacts(callbacks)).toEqual([
      expect.objectContaining({
        command: null,
        cwd: 'C:\\workspace',
        status: 'skipped',
        exitCode: null,
        reason: 'No automatic verification command could be selected.',
        skippedReason: 'No package.json test/build script or TypeScript config was detected.'
      })
    ]);
    expect(finalEvidenceSummaries(callbacks).at(-1)).toEqual(
      expect.objectContaining({
        usedMutatingTool: true,
        postMutationVerificationRequired: false,
        postMutationVerificationPassed: false,
        verificationCommand: null,
        verificationStatus: 'skipped'
      })
    );
  });

  it('emits skipped final verification evidence when run_command is unavailable after applied mutation', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'src/example.ts',
              content: 'export const value = 1;'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Done without command access.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();
    await startHarness({
      callbacks,
      transport,
      context: createContext({
        verificationPlan: createVerificationPlan()
      }),
      agentRuntime: {
        executeToolCall: vi.fn(async (call) => ({
          toolName: call.name,
          content: 'Wrote file.'
        }))
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          })
        ])
      })
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Done without command access.');
    });
    expect(verificationArtifacts(callbacks)).toEqual([
      expect.objectContaining({
        command: 'npm test',
        cwd: 'C:\\workspace',
        status: 'skipped',
        exitCode: null,
        reason: 'package.json defines a test script.',
        skippedReason: 'Planned verification command was not executed because run_command was not available.'
      })
    ]);
    expect(finalEvidenceSummaries(callbacks).at(-1)).toEqual(
      expect.objectContaining({
        usedMutatingTool: true,
        postMutationVerificationRequired: false,
        postMutationVerificationPassed: false,
        verificationCommand: 'npm test',
        verificationStatus: 'skipped'
      })
    );
  });

  it('does not complete file-content work after only mkdir and pending-work text', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'mkdir',
            arguments: {
              path: 'roofing-landing-page'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: "Now I'll create the basic HTML structure for the roofing business landing page.",
        toolCalls: [],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'roofing-landing-page/index.html',
              content: '<h1>Swift Roofer</h1>'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Roofing landing page built.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const executeToolCall = vi.fn(async (call) => ({
      toolName: call.name,
      content: call.name === 'mkdir' ? 'Created roofing-landing-page' : 'Wrote roofing-landing-page/index.html'
    }));
    const { callbacks } = await startHarness({
      transport,
      agentRuntime: {
        executeToolCall
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('mkdir', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          }),
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          })
        ]),
        requiresWorkspaceMutation: true,
        requiresFileContentMutation: true
      }),
      policy: createPolicy({
        assistantSignalsPendingWorkspaceMutation: (text) => /\bi(?:'ll| will)\b.{0,80}\b(?:create|build|write)\b/iu.test(text)
      })
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Roofing landing page built.');
    });
    expect(callbacks.onComplete).not.toHaveBeenCalledWith(
      "Now I'll create the basic HTML structure for the roofing business landing page."
    );
    expect(transport.requests[2]?.input.at(-1)?.content).toBe('REQUIRE_MUTATION');
    expect(executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'write_file' }),
      expect.any(Object)
    );
  });

  it('fails loudly when a file-building run only creates a folder after web lookup failure', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'web_search',
            arguments: {
              query: 'roofing business hero image unsplash'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'extract_web_page',
            arguments: {
              url: 'https://unsplash.com/s/photos/roofing'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'mkdir',
            arguments: {
              path: 'roofing-landing'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const executeToolCall = vi.fn(async (call: AgentToolCall) => ({
      toolName: call.name,
      content: call.name === 'extract_web_page'
        ? 'Web fetch failed for https://unsplash.com/s/photos/roofing: HTTP 401.'
        : call.name === 'mkdir'
          ? 'Created roofing-landing'
          : 'Search results: https://unsplash.com/photos/roofing-hero',
      isError: call.name === 'extract_web_page'
    }));
    const { callbacks } = await startHarness({
      transport,
      agentRuntime: {
        executeToolCall
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('web_search', {
            visibilityGroup: 'web_research',
            contentTrust: 'untrusted_content',
            readsWorkspace: false,
            usesNetwork: true
          }),
          createTool('extract_web_page', {
            visibilityGroup: 'web_research',
            contentTrust: 'untrusted_content',
            readsWorkspace: false,
            usesNetwork: true
          }),
          createTool('mkdir', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          }),
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          })
        ]),
        requiresNativeWebResearch: true,
        requiresWorkspaceMutation: true,
        requiresFileContentMutation: true
      }),
      limits: {
        maxRequiredMutationReminders: 1
      }
    });

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalledWith(
        'No page files were written. Created only roofing-landing before the provider stopped. No write_file or apply_patch tool calls were recorded after 1 runtime reminder. missing mutation'
      );
    });
    expect(callbacks.onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'guidance',
          providerEventType: 'test_harness_missing_file_write_diagnostic',
          summary: 'No file writes recorded before stopping',
          text: expect.stringContaining('parsed write-capable tool calls: 0')
        })
      })
    );
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    expect(executeToolCall).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'write_file' }),
      expect.any(Object)
    );
  });

  it('runs app-owned preview validation before accepting final text', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'index.html',
              content: '<h1>Preview Beacon</h1>'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Preview still needs validation.',
        toolCalls: [],
        terminalState: 'completed'
      },
      {
        text: 'Preview validation complete.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const previewResult: AgentToolExecutionResult = {
      toolName: 'browser_preview_check',
      content: 'Preview Beacon found.'
    };
    const runAppPreviewValidation = vi.fn(async (input: { usedBrowserPreviewTool: boolean }) =>
      input.usedBrowserPreviewTool ? null : previewResult
    );
    const { callbacks } = await startHarness({
      transport,
      agentRuntime: {
        executeToolCall: vi.fn(async (call) => ({
          toolName: call.name,
          content: 'wrote file'
        }))
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            visibilityGroup: 'workspace_write'
          }),
          createTool('browser_preview_check', {
            visibilityGroup: 'browser_preview'
          })
        ])
      }),
      policy: createPolicy({
        runAppPreviewValidation,
        buildPreviewValidationSummaryPrompt: (result) => `Summarize preview result:\n${result.content}`
      })
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Preview validation complete.');
    });
    expect(runAppPreviewValidation).toHaveBeenCalledWith(
      expect.objectContaining({
        usedMutatingTool: true,
        usedBrowserPreviewTool: false
      })
    );
    expect(transport.requests[2]?.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('Tool result for browser_preview_check')
        }),
        expect.objectContaining({
          role: 'user',
          content: 'Summarize preview result:\nPreview Beacon found.'
        })
      ])
    );
  });

  it('requires an Unsplash URL in written page files before accepting final text for web-image builds', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'index.html',
              content: '<h1>Roofing</h1>'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Roofing landing page built.',
        toolCalls: [],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'index.html',
              content: '<img src="https://images.unsplash.com/photo-roofing" alt="Roofing" />'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Roofing landing page built.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    let searchCount = 0;
    const executeToolCall = vi.fn(async (call: AgentToolCall) => {
      if (call.name === 'search_text') {
        searchCount += 1;
        return {
          toolName: 'search_text',
          content: searchCount === 1
            ? '[no matches for "unsplash.com"]'
            : 'index.html:1:https://images.unsplash.com/photo-roofing'
        };
      }

      return {
        toolName: call.name,
        content: `Wrote ${call.arguments.path}`
      };
    });
    const { callbacks } = await startHarness({
      transport,
      agentRuntime: {
        executeToolCall
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          }),
          createTool('search_text', {
            readsWorkspace: true,
            visibilityGroup: 'workspace_read'
          })
        ]),
        requiresWorkspaceMutation: true,
        requiresFileContentMutation: true,
        requiresWebImageArtifactReference: true
      })
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Roofing landing page built.');
    });
    expect(transport.requests[2]?.input.at(-1)?.content).toContain('The written files do not include an Unsplash URL yet.');
    expect(executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'search_text',
        arguments: expect.objectContaining({
          query: 'unsplash.com'
        })
      }),
      expect.any(Object)
    );
  });

  it('requires all requested static web page files before accepting final text', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'index.html',
              content: '<h1>Roofing</h1>'
            }
          },
          {
            name: 'write_file',
            arguments: {
              path: 'styles.css',
              content: 'body { margin: 0; }'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Roofing landing page built.',
        toolCalls: [],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'main.js',
              content: 'console.log("roofing landing ready");'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Roofing landing page built.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    let listCount = 0;
    const executeToolCall = vi.fn(async (call: AgentToolCall) => {
      if (call.name === 'list_directory') {
        listCount += 1;
        return {
          toolName: 'list_directory',
          content: listCount === 1
            ? 'file index.html\nfile styles.css'
            : 'file index.html\nfile main.js\nfile styles.css'
        };
      }

      return {
        toolName: call.name,
        content: `Wrote ${call.arguments.path}`
      };
    });
    const { callbacks } = await startHarness({
      transport,
      agentRuntime: {
        executeToolCall
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          }),
          createTool('list_directory', {
            readsWorkspace: true,
            visibilityGroup: 'workspace_read'
          })
        ]),
        requiresWorkspaceMutation: true,
        requiresFileContentMutation: true,
        requiredStaticWebPageFileExtensions: ['.html', '.css', '.js']
      })
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Roofing landing page built.');
    });
    expect(transport.requests[2]?.input.at(-1)?.content).toContain('does not show all required page files yet');
    expect(executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'list_directory',
        arguments: expect.objectContaining({
          path: '.'
        })
      }),
      expect.any(Object)
    );
  });

  it('accepts requested static web page files written inside a nested folder', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'roofing-landing-page/index.html',
              content: '<h1>Swift Roofer</h1>'
            }
          },
          {
            name: 'write_file',
            arguments: {
              path: 'roofing-landing-page/styles.css',
              content: 'body { background: #101418; }'
            }
          },
          {
            name: 'write_file',
            arguments: {
              path: 'roofing-landing-page/main.js',
              content: 'console.log("roofing landing ready");'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Roofing landing page built.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const executeToolCall = vi.fn(async (call: AgentToolCall) => {
      if (call.name === 'list_directory') {
        return {
          toolName: 'list_directory',
          content: 'directory roofing-landing-page'
        };
      }

      return {
        toolName: call.name,
        content: `Wrote ${call.arguments.path}`
      };
    });

    const { callbacks } = await startHarness({
      transport,
      agentRuntime: {
        executeToolCall
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            readsWorkspace: false,
            visibilityGroup: 'workspace_write'
          }),
          createTool('list_directory', {
            readsWorkspace: true,
            visibilityGroup: 'workspace_read'
          })
        ]),
        requiresWorkspaceMutation: true,
        requiresFileContentMutation: true,
        requiredStaticWebPageFileExtensions: ['.html', '.css', '.js']
      })
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Roofing landing page built.');
    });
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(transport.requests).toHaveLength(2);
  });

  it('does not fall back after a mutating tool has changed the workspace', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'write_file',
            arguments: {
              path: 'index.html',
              content: '<h1>Changed</h1>'
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [],
        terminalState: 'error',
        errorMessage: 'transport rejected after mutation'
      }
    ]);
    const fallbackToRun = vi.fn(async () => ({
      runId: 'fallback',
      cancel: vi.fn(async () => undefined)
    }));
    const { callbacks } = await startHarness({
      transport,
      agentRuntime: {
        executeToolCall: vi.fn(async (call) => ({
          toolName: call.name,
          content: 'wrote file'
        }))
      },
      preparedRun: createPreparedRun({
        activeToolCatalog: createCatalog([
          createTool('write_file', {
            mutatesWorkspace: true,
            visibilityGroup: 'workspace_write'
          })
        ])
      }),
      policy: createPolicy({
        shouldFallbackFromTransportError: () => true,
        fallbackInfoMessage: 'Falling back.'
      }),
      buildFallbackRunContext: (context) => ({
        ...context,
        ollamaTransportMode: 'chat'
      }),
      fallbackToRun
    });

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalledWith('transport rejected after mutation');
    });
    expect(fallbackToRun).not.toHaveBeenCalled();
    expect(callbacks.onInfo).not.toHaveBeenCalledWith('Falling back.');
  });
});
