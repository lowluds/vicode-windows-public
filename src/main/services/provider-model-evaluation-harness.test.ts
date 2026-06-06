import { describe, expect, it, vi } from 'vitest';
import type {
  AgentRuntime,
  AgentRuntimeToolCatalog,
  AgentRuntimeToolDescriptor,
  AgentToolExecutionResult
} from '../../providers/agent-runtime';
import type {
  ProviderModelTransport,
  ProviderModelTurnRequest,
  ProviderModelTurnResult,
  ProviderRunCallbacks,
  ProviderRunContext,
  ProviderRunHandle
} from '../../providers/types';
import type {
  ProviderModelHarnessPolicy,
  ProviderModelHarnessPreparedRun
} from './provider-model-harness-runner';
import { createDefaultProviderModelHarnessPolicy } from './provider-model-harness-policy';
import { startProviderModelHarnessRun } from './provider-model-harness-runner';
import { resolveCustomProviderModelTransport } from './provider-model-transport-registry';

type EvaluationTransportKind = 'ollama_responses' | 'ollama_chat' | 'openai_compatible_chat';

const NORMALIZED_EVALUATION_LANES: Array<{
  providerLabel: string;
  transportKind: EvaluationTransportKind;
}> = [
  { transportKind: 'ollama_responses', providerLabel: 'Ollama' },
  { transportKind: 'ollama_chat', providerLabel: 'Ollama' },
  { transportKind: 'openai_compatible_chat', providerLabel: 'OpenAI-compatible' }
];

const openAICompatibleLiveEnv = {
  apiKey: process.env.VICODE_OPENAI_COMPATIBLE_API_KEY?.trim() ?? '',
  baseUrl: process.env.VICODE_OPENAI_COMPATIBLE_BASE_URL?.trim() ?? '',
  modelId: process.env.VICODE_OPENAI_COMPATIBLE_MODEL?.trim() ?? ''
};

const maybeLiveOpenAICompatibleIt = openAICompatibleLiveEnv.apiKey
  && openAICompatibleLiveEnv.baseUrl
  && openAICompatibleLiveEnv.modelId
  ? it
  : it.skip;

class ScriptedTransport implements ProviderModelTransport {
  readonly requests: ProviderModelTurnRequest[] = [];

  constructor(private readonly results: ProviderModelTurnResult[]) {}

  async sendTurn(request: ProviderModelTurnRequest) {
    this.requests.push(request);
    const result = this.results.shift();
    if (!result) {
      return {
        text: 'Done.',
        toolCalls: [],
        terminalState: 'completed' as const
      };
    }
    return result;
  }
}

function createContext(overrides: Partial<ProviderRunContext> = {}): ProviderRunContext {
  return {
    threadId: 'thread-1',
    runId: 'run-1',
    prompt: 'Evaluate the normalized provider lane.',
    sourcePrompt: 'Evaluate the normalized provider lane.',
    modelId: 'model-under-test',
    reasoningEffort: null,
    thinkingEnabled: false,
    folderPath: 'C:\\workspace',
    trusted: true,
    apiKey: 'test-key',
    runMode: 'default',
    executionPermission: 'full_access',
    runtimeCommandPolicy: 'approval_required',
    runtimeNetworkPolicy: 'enabled',
    ollamaTransportMode: undefined,
    runtimeSkillResources: [],
    ...overrides
  };
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

function createPolicy(providerLabel: string): ProviderModelHarnessPolicy {
  return createDefaultProviderModelHarnessPolicy({
    providerLabel,
    providerEventTypePrefix: `${providerLabel.toLowerCase()}_evaluation`
  });
}

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

function createPreparedToolCatalog(
  tools: AgentRuntimeToolDescriptor[] = [createTool('read_file')]
): AgentRuntimeToolCatalog {
  return {
    nativeWebResearchEnabled: tools.some((tool) => tool.visibilityGroup === 'web_research'),
    nativeTools: tools.filter((tool) => tool.origin === 'native'),
    mcpTools: tools.filter((tool) => tool.origin === 'mcp'),
    tools
  };
}

function createPreparedRun(
  context: ProviderRunContext,
  overrides: Partial<ProviderModelHarnessPreparedRun> = {}
): ProviderModelHarnessPreparedRun {
  const activeToolCatalog = overrides.activeToolCatalog ?? createPreparedToolCatalog();
  return {
    activeToolCatalog,
    initialAgentPrompt: context.prompt,
    initialWebResearchDirective: null,
    promptPayload: {
      systemInstructions: 'System',
      input: [{ role: 'user' as const, content: context.prompt }],
      tools: { definitions: [] },
      attachments: {}
    },
    requiresNativeWebResearch: false,
    requiresFileContentMutation: false,
    requiresPostMutationVerification: false,
    requiredStaticWebPageFileExtensions: [],
    requiresWebImageArtifactReference: false,
    requiresWorkspaceMutation: false,
    systemPrompt: 'System',
    tools: [],
    ...overrides
  };
}

function createPrepareRun(overrides: Partial<ProviderModelHarnessPreparedRun> = {}) {
  return async (_agentRuntime: AgentRuntime, context: ProviderRunContext) => ({
    ...createPreparedRun(context, overrides)
  });
}

async function startEvaluationHarness(input: {
  transport: ProviderModelTransport;
  callbacks: ProviderRunCallbacks;
  agentRuntime?: AgentRuntime;
  buildFallbackRunContext?: (context: ProviderRunContext) => ProviderRunContext;
  fallbackToRun?: (
    context: ProviderRunContext,
    callbacks: ProviderRunCallbacks
  ) => Promise<ProviderRunHandle>;
  providerLabel?: string;
  context?: Partial<ProviderRunContext>;
  limits?: Parameters<typeof startProviderModelHarnessRun>[0]['limits'];
  policy?: ProviderModelHarnessPolicy;
  preparedRun?: Partial<ProviderModelHarnessPreparedRun>;
}) {
  return startProviderModelHarnessRun({
    agentRuntime: input.agentRuntime ?? {
      executeToolCall: vi.fn(async () => ({
        toolName: 'read_file',
        content: 'file contents'
      }))
    },
    buildFallbackRunContext: input.buildFallbackRunContext,
    callbacks: input.callbacks,
    context: createContext(input.context),
    fallbackToRun: input.fallbackToRun,
    finalizeAssistantOutput: async (_context, output) => output,
    limits: {
      maxTurns: 4,
      maxRuntimeMs: 1000 * 10,
      ...input.limits
    },
    policy: input.policy ?? createPolicy(input.providerLabel ?? 'Provider'),
    prepareRun: createPrepareRun(input.preparedRun),
    transport: input.transport
  });
}

describe('normalized provider evaluation harness', () => {
  it.each(NORMALIZED_EVALUATION_LANES)('completes text-only normalized run for $transportKind', async ({ providerLabel }) => {
    const transport = new ScriptedTransport([
      {
        text: 'Evaluation complete.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();

    await startEvaluationHarness({
      transport,
      callbacks,
      providerLabel
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Evaluation complete.');
    });
    expect(callbacks.onDelta).toHaveBeenCalledWith('Evaluation complete.');
  });

  it.each(NORMALIZED_EVALUATION_LANES)('returns tool results to the model for $transportKind', async ({ providerLabel }) => {
    const transport = new ScriptedTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'read_file',
            arguments: {
              path: 'README.md'
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
    const executeToolCall = vi.fn(async () => ({
      toolName: 'read_file',
      content: 'README contents'
    }));

    await startEvaluationHarness({
      transport,
      callbacks,
      providerLabel,
      agentRuntime: {
        executeToolCall
      }
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Read complete.');
    });
    expect(executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'read_file'
      }),
      expect.any(Object)
    );
    expect(transport.requests[1]?.input.at(-1)?.content).toContain('README contents');
  });

  it('certifies a saved OpenAI-compatible custom provider through the fake tool-call loop', async () => {
    const responses = [
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'read_file',
                      arguments: JSON.stringify({
                        path: 'README.md'
                      })
                    }
                  }
                ]
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      ),
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Read complete.'
              }
            }
          ]
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const resolution = resolveCustomProviderModelTransport({
      provider: {
        id: 'custom-provider-1',
        name: 'Example Gateway',
        transportKind: 'openai_compatible_chat',
        baseUrl: 'https://gateway.example/v1',
        encryptedApiKey: Buffer.from('compatible-key', 'utf8').toString('base64'),
        defaultModelId: 'compatible-coder',
        enabled: true,
        createdAt: '2026-05-25T00:00:00.000Z',
        updatedAt: '2026-05-25T00:00:00.000Z'
      },
      decryptApiKey: (encrypted) => Buffer.from(encrypted, 'base64').toString('utf8'),
      fetchImpl
    });
    const callbacks = createCallbacks();
    const executeToolCall = vi.fn(async () => ({
      toolName: 'read_file',
      content: 'README contents'
    }));

    expect(resolution?.transportKind).toBe('openai_compatible_chat');
    await startEvaluationHarness({
      transport: resolution!.transport,
      callbacks,
      providerLabel: resolution!.providerLabel,
      policy: resolution!.policy,
      limits: resolution!.limits,
      agentRuntime: {
        executeToolCall
      },
      context: {
        modelId: 'compatible-coder'
      },
      preparedRun: {
        tools: [
          {
            type: 'function',
            function: {
              name: 'read_file',
              description: 'Read a workspace file.',
              parameters: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string'
                  }
                }
              }
            }
          }
        ]
      }
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Read complete.');
    });
    expect(executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'read_file',
        arguments: {
          path: 'README.md'
        }
      }),
      expect.any(Object)
    );
    const followUpBody = JSON.parse(fetchImpl.mock.calls[1]?.[1].body as string);
    expect(followUpBody.messages).toEqual(
      expect.arrayContaining([
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: 'README contents'
        }
      ])
    );
  });

  maybeLiveOpenAICompatibleIt('certifies an OpenAI-compatible custom provider through a live tool-call loop', async () => {
    const resolution = resolveCustomProviderModelTransport({
      provider: {
        id: 'custom-provider-live',
        name: 'OpenAI-compatible live',
        transportKind: 'openai_compatible_chat',
        baseUrl: openAICompatibleLiveEnv.baseUrl,
        encryptedApiKey: Buffer.from(openAICompatibleLiveEnv.apiKey, 'utf8').toString('base64'),
        defaultModelId: openAICompatibleLiveEnv.modelId,
        enabled: true,
        createdAt: '2026-05-25T00:00:00.000Z',
        updatedAt: '2026-05-25T00:00:00.000Z'
      },
      decryptApiKey: (encrypted) => Buffer.from(encrypted, 'base64').toString('utf8'),
      timeoutMs: 45_000
    });
    const callbacks = createCallbacks();
    const executeToolCall = vi.fn(async () => ({
      toolName: 'read_file',
      content: 'VicodeCompatibleLiveSeed'
    }));

    expect(resolution?.transportKind).toBe('openai_compatible_chat');
    await startEvaluationHarness({
      transport: resolution!.transport,
      callbacks,
      providerLabel: resolution!.providerLabel,
      policy: resolution!.policy,
      limits: {
        ...resolution!.limits,
        maxRuntimeMs: 60_000,
        maxTurns: 4
      },
      agentRuntime: {
        executeToolCall
      },
      context: {
        modelId: openAICompatibleLiveEnv.modelId,
        prompt: [
          'Use the available read_file tool exactly once before answering.',
          'Read README.md.',
          'After the tool result returns, reply with exactly: VICODE_OPENAI_COMPATIBLE_LIVE_TOOL_OK'
        ].join('\n')
      },
      preparedRun: {
        tools: [
          {
            type: 'function',
            function: {
              name: 'read_file',
              description: 'Read a workspace file.',
              parameters: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string'
                  }
                },
                required: ['path'],
                additionalProperties: false
              }
            }
          }
        ]
      }
    });

    await vi.waitFor(
      () => {
        expect(callbacks.onComplete).toHaveBeenCalledWith(expect.stringMatching(/VICODE_OPENAI_COMPATIBLE_LIVE_TOOL_OK/iu));
      },
      {
        timeout: 65_000
      }
    );
    expect(executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'read_file'
      }),
      expect.any(Object)
    );
  }, 70_000);

  it.each(NORMALIZED_EVALUATION_LANES)('runs multi-turn tool-result loops for $transportKind', async ({ providerLabel }) => {
    const transport = new ScriptedTransport([
      {
        text: '',
        toolCalls: [{ name: 'read_file', arguments: { path: 'seed.txt' } }],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [{ name: 'write_file', arguments: { path: 'out.txt', content: 'seed:ok' } }],
        terminalState: 'completed'
      },
      {
        text: 'Multi-turn complete.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();
    const executeToolCall = vi.fn(async (call) => ({
      toolName: call.name,
      content: call.name === 'read_file' ? 'seed' : 'wrote out.txt'
    }));

    await startEvaluationHarness({
      transport,
      callbacks,
      providerLabel,
      agentRuntime: {
        executeToolCall
      },
      preparedRun: {
        activeToolCatalog: createPreparedToolCatalog([
          createTool('read_file'),
          createTool('write_file', {
            visibilityGroup: 'workspace_write',
            orchestrationHint: 'modify',
            mutatesWorkspace: true,
            readsWorkspace: false
          })
        ])
      }
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Multi-turn complete.');
    });
    expect(executeToolCall).toHaveBeenCalledTimes(2);
    expect(transport.requests[1]?.input.at(-1)?.content).toContain('seed');
    expect(transport.requests[2]?.input.at(-1)?.content).toContain('wrote out.txt');
  });

  it.each(NORMALIZED_EVALUATION_LANES)('returns tool errors to the model for $transportKind', async ({ providerLabel }) => {
    const transport = new ScriptedTransport([
      {
        text: '',
        toolCalls: [{ name: 'read_file', arguments: { path: 'missing.txt' } }],
        terminalState: 'completed'
      },
      {
        text: 'Handled missing file.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();

    await startEvaluationHarness({
      transport,
      callbacks,
      providerLabel,
      agentRuntime: {
        executeToolCall: vi.fn(async () => ({
          toolName: 'read_file',
          content: 'ENOENT missing.txt',
          isError: true
        }))
      }
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Handled missing file.');
    });
    expect(transport.requests[1]?.input.at(-1)?.content).toContain('Tool error: ENOENT missing.txt');
  });

  it.each(
    NORMALIZED_EVALUATION_LANES.flatMap((lane) =>
      (['approved', 'rejected', 'cancelled'] as const).map((decision) => ({
        ...lane,
        decision
      }))
    )
  )(
    'passes $decision command approval through the app runtime for $transportKind',
    async ({ providerLabel, decision }) => {
      const transport = new ScriptedTransport([
        {
          text: '',
          toolCalls: [{ name: 'run_command', arguments: { command: 'npm test' } }],
          terminalState: 'completed'
        },
        {
          text: 'Approval handled.',
          toolCalls: [],
          terminalState: 'completed'
        }
      ]);
      const callbacks = createCallbacks({
        requestToolApproval: vi.fn(async () => decision)
      });

      await startEvaluationHarness({
        transport,
        callbacks,
        providerLabel,
        agentRuntime: {
          executeToolCall: vi.fn(async (_call, runtimeContext) => {
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
          })
        }
      });

      await vi.waitFor(() => {
        expect(callbacks.onComplete).toHaveBeenCalledWith('Approval handled.');
      });
      expect(callbacks.requestToolApproval).toHaveBeenCalled();
      expect(transport.requests[1]?.input.at(-1)?.content).toContain(`approval:${decision}`);
    }
  );

  it('passes command approval through the app runtime in normalized runs', async () => {
    const transport = new ScriptedTransport([
      {
        text: '',
        toolCalls: [{ name: 'run_command', arguments: { command: 'npm test' } }],
        terminalState: 'completed'
      },
      {
        text: 'Approved command handled.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks({
      requestToolApproval: vi.fn(async () => 'approved')
    });

    await startEvaluationHarness({
      transport,
      callbacks,
      providerLabel: 'OpenAI',
      agentRuntime: {
        executeToolCall: vi.fn(async (_call, runtimeContext) => {
          const decision = await runtimeContext.requestApproval?.({
            toolName: 'run_command',
            command: 'npm test',
            cwd: null,
            workspaceRoot: 'C:\\workspace'
          });
          return {
            toolName: 'run_command',
            content: `approval:${decision}`
          };
        })
      }
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Approved command handled.');
    });
    expect(callbacks.requestToolApproval).toHaveBeenCalled();
  });

  it.each(NORMALIZED_EVALUATION_LANES)('requires workspace mutation before completing $transportKind', async ({ providerLabel }) => {
    const transport = new ScriptedTransport([
      {
        text: 'I can do that without changing files.',
        toolCalls: [],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [{ name: 'write_file', arguments: { path: 'out.txt', content: 'ok' } }],
        terminalState: 'completed'
      },
      {
        text: 'Workspace mutation complete.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();

    await startEvaluationHarness({
      transport,
      callbacks,
      providerLabel,
      agentRuntime: {
        executeToolCall: vi.fn(async () => ({
          toolName: 'write_file',
          content: 'wrote out.txt'
        }))
      },
      preparedRun: {
        activeToolCatalog: createPreparedToolCatalog([
          createTool('write_file', {
            visibilityGroup: 'workspace_write',
            orchestrationHint: 'modify',
            mutatesWorkspace: true,
            readsWorkspace: false
          })
        ]),
        requiresWorkspaceMutation: true
      }
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Workspace mutation complete.');
    });
    expect(transport.requests[1]?.input.at(-1)?.content).toContain('write-capable tool');
    expect(callbacks.onDelta).not.toHaveBeenCalledWith('I can do that without changing files.');
  });

  it.each(NORMALIZED_EVALUATION_LANES)('requires verification after workspace mutation for $transportKind', async ({ providerLabel }) => {
    const transport = new ScriptedTransport([
      {
        text: '',
        toolCalls: [{ name: 'write_file', arguments: { path: 'out.txt', content: 'ok' } }],
        terminalState: 'completed'
      },
      {
        text: 'Done without tests.',
        toolCalls: [],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [{ name: 'run_command', arguments: { command: 'npm test' } }],
        terminalState: 'completed'
      },
      {
        text: 'Verified complete.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();
    const executeToolCall = vi.fn(async (call) => ({
      toolName: call.name,
      content: call.name === 'run_command' ? 'tests passed' : 'wrote out.txt'
    }));

    await startEvaluationHarness({
      transport,
      callbacks,
      providerLabel,
      agentRuntime: {
        executeToolCall
      },
      preparedRun: {
        activeToolCatalog: createPreparedToolCatalog([
          createTool('write_file', {
            visibilityGroup: 'workspace_write',
            orchestrationHint: 'modify',
            mutatesWorkspace: true,
            readsWorkspace: false
          }),
          createTool('run_command', {
            visibilityGroup: 'terminal',
            orchestrationHint: 'verify',
            mutatesWorkspace: false,
            readsWorkspace: true
          })
        ]),
        requiresPostMutationVerification: true
      }
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Verified complete.');
    });
    expect(transport.requests[2]?.input.at(-1)?.content).toContain('post-edit verification command');
    expect(executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'run_command' }),
      expect.any(Object)
    );
  });

  it('reports provider transport errors through normalized callbacks', async () => {
    const transport = new ScriptedTransport([
      {
        text: '',
        toolCalls: [],
        terminalState: 'error',
        errorMessage: 'provider failed'
      }
    ]);
    const callbacks = createCallbacks();

    await startEvaluationHarness({
      transport,
      callbacks,
      providerLabel: 'OpenAI'
    });

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalledWith('provider failed');
    });
  });

  it('cancels normalized transport work without completing the run', async () => {
    let signal: AbortSignal | null = null;
    let resolveTurn: ((result: ProviderModelTurnResult) => void) | null = null;
    const transport: ProviderModelTransport = {
      async sendTurn(request) {
        signal = request.signal;
        return new Promise<ProviderModelTurnResult>((resolve) => {
          resolveTurn = resolve;
        });
      }
    };
    const callbacks = createCallbacks();

    const handle = await startEvaluationHarness({
      transport,
      callbacks,
      providerLabel: 'OpenAI'
    });

    await vi.waitFor(() => {
      expect(signal).not.toBeNull();
    });
    await handle.cancel('test cancellation');
    resolveTurn?.({
      text: 'late',
      toolCalls: [],
      terminalState: 'completed'
    });

    expect(signal?.aborted).toBe(true);
    expect(callbacks.onAbort).toHaveBeenCalledWith('test cancellation');
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it('falls back from Ollama responses before app work starts when the transport rejects the request', async () => {
    const transport = new ScriptedTransport([
      {
        text: '',
        toolCalls: [],
        terminalState: 'error',
        errorMessage: 'responses transport rejected the request'
      }
    ]);
    const callbacks = createCallbacks();
    const fallbackHandle: ProviderRunHandle = {
      runId: 'run-1',
      cancel: vi.fn(async () => undefined)
    };
    const fallbackToRun = vi.fn(async (_context: ProviderRunContext, fallbackCallbacks: ProviderRunCallbacks) => {
      fallbackCallbacks.onComplete('Fallback complete.');
      return fallbackHandle;
    });
    const policy = {
      ...createPolicy('Ollama'),
      shouldFallbackFromTransportError: (message: string) => message.includes('rejected'),
      fallbackInfoMessage: 'Falling back to chat transport.'
    };

    const handle = await startEvaluationHarness({
      transport,
      callbacks,
      providerLabel: 'Ollama',
      policy,
      buildFallbackRunContext: (context) => ({
        ...context,
        ollamaTransportMode: 'chat'
      }),
      fallbackToRun
    });

    expect(handle.runId).toBe('run-1');
    await vi.waitFor(() => {
      expect(fallbackToRun).toHaveBeenCalledWith(
        expect.objectContaining({ ollamaTransportMode: 'chat' }),
        callbacks
      );
    });
    expect(callbacks.onInfo).toHaveBeenCalledWith('Falling back to chat transport.');
    expect(callbacks.onComplete).toHaveBeenCalledWith('Fallback complete.');
  });
});
