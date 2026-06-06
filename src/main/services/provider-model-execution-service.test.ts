import { describe, expect, it, vi } from 'vitest';
import type {
  AgentRuntime,
  AgentRuntimeToolCatalog,
  AgentRuntimeToolDescriptor
} from '../../providers/agent-runtime';
import type {
  AgentToolCall,
  ProviderModelTransport,
  ProviderModelTurnRequest,
  ProviderModelTurnResult,
  ProviderRunCallbacks,
  ProviderRunContext
} from '../../providers/types';
import { ProviderModelExecutionService } from './provider-model-execution-service';
import { createOllamaResponsesHarnessPolicy } from '../../providers/ollama/tool-loop-responses-runner';
import type { ProviderModelHarnessPolicy } from './provider-model-harness-runner';
import { APP_RUNTIME_MODEL_AUTHORITY } from './provider-model-runtime-authority';
import {
  OLLAMA_CHAT_CAPABILITY_PROFILE,
  OLLAMA_RESPONSES_CAPABILITY_PROFILE,
  OPENAI_COMPATIBLE_CHAT_CAPABILITY_PROFILE
} from './provider-model-capability-profile';

function createContext(overrides: Partial<ProviderRunContext> = {}): ProviderRunContext {
  return {
    threadId: 'thread-1',
    runId: 'run-1',
    prompt: 'Inspect the workspace.',
    sourcePrompt: 'Inspect the workspace.',
    modelId: 'qwen3-coder',
    reasoningEffort: null,
    thinkingEnabled: false,
    folderPath: 'C:\\workspace',
    trusted: true,
    apiKey: null,
    runMode: 'default',
    executionPermission: 'default',
    runtimeCommandPolicy: 'approval_required',
    runtimeNetworkPolicy: 'enabled',
    ollamaTransportMode: 'responses',
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

function createCatalog(tools: AgentRuntimeToolDescriptor[]): AgentRuntimeToolCatalog {
  return {
    nativeWebResearchEnabled: tools.some((tool) => tool.visibilityGroup === 'web_research'),
    nativeTools: tools.filter((tool) => tool.origin === 'native'),
    mcpTools: tools.filter((tool) => tool.origin === 'mcp'),
    tools
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
      text: 'Done.',
      toolCalls: [],
      terminalState: 'completed'
    };
  }
}

function createRuntime(): AgentRuntime {
  return {
    executeToolCall: vi.fn(async () => ({
      toolName: 'read_file',
      content: 'file contents'
    })),
    hasNativeWebResearch: vi.fn(() => false)
  };
}

function createRuntimeWithCatalog(catalog: AgentRuntimeToolCatalog): AgentRuntime {
  return {
    executeToolCall: vi.fn(async (call: AgentToolCall) => ({
      toolName: call.name,
      content: call.name === 'extract_web_page'
        ? 'Web fetch failed for https://unsplash.com/s/photos/roofing: HTTP 401.'
        : call.name === 'mkdir'
          ? 'Created roofing-landing'
          : 'Search results: https://unsplash.com/photos/roofing-hero',
      isError: call.name === 'extract_web_page'
    })),
    async listToolCatalog() {
      return catalog;
    }
  };
}

function createPolicy(providerLabel: string): ProviderModelHarnessPolicy {
  return {
    providerLabel,
    providerEventTypePrefix: `${providerLabel.toLowerCase()}_test`,
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
    isMutatingToolCall: () => false,
    isUntrustedToolResult: () => false,
    isVerificationCommandToolCall: (toolCall: AgentToolCall) => toolCall.name === 'run_command',
    buildToolCallSignature: (toolCalls) => JSON.stringify(toolCalls),
    buildToolResultSignature: (toolResults) => JSON.stringify(toolResults),
    formatLimitError: (maxTurns) => `limit:${maxTurns}`,
    formatRuntimeError: () => 'runtime limit',
    formatStallError: () => 'stalled',
    formatMissingRequiredWebResearchError: () => 'missing web research',
    formatMissingRequiredMutationError: () => 'missing mutation',
    formatTransportError: (error) => `transport:${error instanceof Error ? error.message : String(error)}`
  };
}

describe('ProviderModelExecutionService', () => {
  it('returns null for non-Ollama providers without starting callbacks', async () => {
    const callbacks = createCallbacks();
    const service = new ProviderModelExecutionService({
      agentRuntime: createRuntime(),
      resolveTransport: vi.fn(() => null)
    });

    await expect(
      service.tryStartNormalizedRun({
        providerId: 'openai',
        context: createContext(),
        callbacks,
        finalizeAssistantOutput: async (_context, output) => output
      })
    ).resolves.toBeNull();

    expect(callbacks.onStart).not.toHaveBeenCalled();
  });

  it('returns null normalized resolution for retired native OpenAI', () => {
    const service = new ProviderModelExecutionService({
      agentRuntime: createRuntime(),
      resolveTransport: vi.fn(() => null)
    });

    expect(
      service.resolveNormalizedRun({
        providerId: 'openai',
        context: createContext({
          modelId: 'gpt-5.4-nano',
          apiKey: 'ignored-openai-key',
          ollamaTransportMode: undefined
        })
      })
    ).toBeNull();
  });

  it('keeps no-project casual Ollama chats on the compatibility path', () => {
    const service = new ProviderModelExecutionService({
      agentRuntime: createRuntime(),
      resolveTransport: vi.fn(() => ({
        transportKind: 'ollama_chat',
        providerLabel: 'Ollama',
        runtimeAuthority: APP_RUNTIME_MODEL_AUTHORITY,
        capabilityProfile: OLLAMA_CHAT_CAPABILITY_PROFILE,
        transport: new FakeTransport([]),
        policy: createPolicy('Ollama')
      }))
    });

    expect(
      service.resolveNormalizedRun({
        providerId: 'ollama',
        context: createContext({
          prompt: 'yo',
          sourcePrompt: 'yo',
          folderPath: null,
          runtimeWorkspaceRoot: null,
          apiKey: null,
          ollamaTransportMode: 'chat'
        })
      })
    ).toBeNull();
  });

  it('uses normalized web tools for no-project Ollama web research chats', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [
          {
            name: 'web_search',
            arguments: {
              query: 'ca2 framework c++ git repository',
              max_results: 5
            }
          }
        ],
        terminalState: 'completed'
      },
      {
        text: 'Found the CA2 repository.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();
    const webCatalog = createCatalog([
      createTool('web_search', {
        visibilityGroup: 'web_research',
        renderHint: 'web',
        usesNetwork: true,
        readsWorkspace: false,
        contentTrust: 'untrusted_content'
      })
    ]);
    const agentRuntime = createRuntimeWithCatalog(webCatalog);
    const service = new ProviderModelExecutionService({
      agentRuntime,
      resolveTransport: vi.fn(() => ({
        transportKind: 'ollama_chat',
        providerLabel: 'Ollama',
        runtimeAuthority: APP_RUNTIME_MODEL_AUTHORITY,
        capabilityProfile: OLLAMA_CHAT_CAPABILITY_PROFILE,
        transport,
        policy: {
          ...createPolicy('Ollama'),
          isUntrustedToolResult: (_toolCatalog, toolName) => toolName === 'web_search'
        }
      }))
    });

    const handle = await service.tryStartNormalizedRun({
      providerId: 'ollama',
      context: createContext({
        prompt: 'can you look up ca2 framework online and provide me the git repo link',
        sourcePrompt: 'can you look up ca2 framework online and provide me the git repo link',
        folderPath: null,
        runtimeWorkspaceRoot: null,
        apiKey: null,
        ollamaTransportMode: 'chat',
        runtimeNetworkPolicy: 'disabled'
      }),
      callbacks,
      finalizeAssistantOutput: async (_context, output) => output
    });

    expect(handle).not.toBeNull();
    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Found the CA2 repository.');
    });
    expect(agentRuntime.executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'web_search' }),
      expect.objectContaining({ workspaceRoot: null })
    );
    expect(transport.requests[0]?.tools.map((tool) => tool.function.name)).toEqual(['web_search']);
    expect(transport.requests[0]?.input[0]?.content).toContain('No project workspace attached');
  });

  it('starts local Ollama responses through the shared harness', async () => {
    const transport = new FakeTransport([
      {
        text: 'Normalized complete.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();
    const recordTrace = vi.fn();
    const service = new ProviderModelExecutionService({
      agentRuntime: createRuntime(),
      resolveTransport: vi.fn(() => ({
        transportKind: 'ollama_responses',
        providerLabel: 'Ollama',
        runtimeAuthority: APP_RUNTIME_MODEL_AUTHORITY,
        capabilityProfile: OLLAMA_RESPONSES_CAPABILITY_PROFILE,
        transport,
        policy: {
          ...createPolicy('Ollama'),
          shouldFallbackFromTransportError: () => true,
          fallbackInfoMessage: 'Ollama /v1/responses was unavailable for this tool run. Falling back to the normalized local chat transport.'
        },
        buildFallbackRunContext: (context: ProviderRunContext) => ({
          ...context,
          ollamaTransportMode: 'chat'
        })
      }))
    });

    const handle = await service.tryStartNormalizedRun({
      providerId: 'ollama',
      context: createContext(),
      callbacks,
      finalizeAssistantOutput: async (_context, output) => output,
      recordTrace
    });

    expect(handle?.runId).toBe('run-1');
    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Normalized complete.');
    });
    expect(callbacks.onDelta).toHaveBeenCalledWith('Normalized complete.');
    expect(transport.requests[0]?.modelId).toBe('qwen3-coder');
    expect(recordTrace).toHaveBeenCalledWith(
      'provider_model_normalized_dispatch_started',
      expect.objectContaining({
        providerId: 'ollama',
        transportKind: 'ollama_responses',
        modelRouting: expect.objectContaining({
          modelId: 'qwen3-coder',
          providerLabel: 'Ollama',
          transportKind: 'ollama_responses'
        })
      })
    );
    expect(recordTrace).toHaveBeenCalledWith(
      'provider_model_harness_evidence_captured',
      expect.objectContaining({
        modelSelection: expect.objectContaining({
          modelId: 'qwen3-coder'
        }),
        promptSections: expect.any(Array),
        infrastructure: expect.any(Array),
        toolRouting: expect.any(Array)
      })
    );
  });

  it('adds the universal local Ollama tool-call contract to local chat runs', async () => {
    const transport = new FakeTransport([
      {
        text: 'Local chat complete.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const service = new ProviderModelExecutionService({
      agentRuntime: createRuntime(),
      resolveTransport: vi.fn(() => ({
        transportKind: 'ollama_chat',
        providerLabel: 'Ollama',
        runtimeAuthority: APP_RUNTIME_MODEL_AUTHORITY,
        capabilityProfile: OLLAMA_CHAT_CAPABILITY_PROFILE,
        transport,
        policy: createPolicy('Ollama')
      }))
    });
    const callbacks = createCallbacks();

    const handle = await service.tryStartNormalizedRun({
      providerId: 'ollama',
      context: createContext({
        apiKey: null,
        ollamaTransportMode: 'chat'
      }),
      callbacks,
      finalizeAssistantOutput: async (_context, output) => output
    });

    expect(handle).not.toBeNull();
    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Local chat complete.');
    });
    const initialPrompt = transport.requests[0]?.input[0]?.content ?? '';
    expect(initialPrompt).toContain('Local Ollama tool-call contract:');
    expect(initialPrompt).toContain('When this task requires a Vicode tool, use native structured tool_calls when available.');
    expect(initialPrompt).toContain('If native tool_calls are not emitted, return exactly one tool-call envelope and no prose.');
    expect(initialPrompt).toContain('Allowed fallback envelope:');
    expect(initialPrompt).toContain('{"name":"tool_name","arguments":{"arg":"value"}}');
    expect(initialPrompt).toContain('or one ```json fenced block containing that same JSON object.');
    expect(initialPrompt).toContain('Do not include final-answer text until after Vicode returns the tool result.');
    expect(initialPrompt).not.toContain('Local Ollama tool-call fallback:');
    expect(initialPrompt).not.toMatch(/\b(qwen|mistral|granite)\b/i);
  });

  it('does not add the universal local contract to plan-mode Ollama chat runs', async () => {
    const transport = new FakeTransport([
      {
        text: 'Plan complete.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const service = new ProviderModelExecutionService({
      agentRuntime: createRuntime(),
      resolveTransport: vi.fn(() => ({
        transportKind: 'ollama_chat',
        providerLabel: 'Ollama',
        runtimeAuthority: APP_RUNTIME_MODEL_AUTHORITY,
        capabilityProfile: OLLAMA_CHAT_CAPABILITY_PROFILE,
        transport,
        policy: createPolicy('Ollama')
      }))
    });
    const callbacks = createCallbacks();

    const handle = await service.tryStartNormalizedRun({
      providerId: 'ollama',
      context: createContext({
        apiKey: null,
        ollamaTransportMode: 'chat',
        runMode: 'plan'
      }),
      callbacks,
      finalizeAssistantOutput: async (_context, output) => output
    });

    expect(handle).not.toBeNull();
    await vi.waitFor(() => {
      expect(transport.requests.length).toBeGreaterThan(0);
    });
    expect(transport.requests[0]?.input[0]?.content).not.toContain('Local Ollama tool-call contract:');
    expect(transport.requests[0]?.input[0]?.content).not.toContain('Local Ollama tool-call fallback:');
    await handle?.cancel('test complete');
  });

  it('starts custom OpenAI-compatible transports through the shared harness with the selected custom provider id', async () => {
    const transport = new FakeTransport([
      {
        text: 'Custom provider complete.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const resolveTransport = vi.fn(() => ({
      transportKind: 'openai_compatible_chat' as const,
      providerLabel: 'Gateway',
      runtimeAuthority: APP_RUNTIME_MODEL_AUTHORITY,
      capabilityProfile: OPENAI_COMPATIBLE_CHAT_CAPABILITY_PROFILE,
      transport,
      policy: createPolicy('Gateway')
    }));
    const service = new ProviderModelExecutionService({
      agentRuntime: createRuntime(),
      resolveTransport
    });
    const callbacks = createCallbacks();

    const handle = await service.tryStartNormalizedRun({
      providerId: 'openai_compatible',
      context: createContext({
        modelId: 'gateway-coder',
        customProviderId: 'custom-provider-1',
        apiKey: null,
        ollamaTransportMode: undefined
      }),
      callbacks,
      finalizeAssistantOutput: async (_context, output) => output
    });

    expect(handle?.runId).toBe('run-1');
    expect(resolveTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai_compatible',
        modelId: 'gateway-coder',
        customProviderId: 'custom-provider-1',
        apiKey: null
      })
    );
    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Custom provider complete.');
    });
    expect(transport.requests[0]?.modelId).toBe('gateway-coder');
  });

  it('falls back from responses to normalized chat without invoking the legacy provider run', async () => {
    const responsesTransport = new FakeTransport([
      {
        text: '',
        toolCalls: [],
        terminalState: 'error',
        errorMessage: 'history is not defined'
      }
    ]);
    const chatTransport = new FakeTransport([
      {
        text: 'Normalized chat fallback complete.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const callbacks = createCallbacks();
    const resolveTransport = vi.fn((input: { ollamaTransportMode?: string | null }) => {
      if (input.ollamaTransportMode === 'chat') {
        return {
          transportKind: 'ollama_chat' as const,
          providerLabel: 'Ollama',
          runtimeAuthority: APP_RUNTIME_MODEL_AUTHORITY,
          capabilityProfile: OLLAMA_CHAT_CAPABILITY_PROFILE,
          transport: chatTransport,
          policy: createPolicy('Ollama')
        };
      }

      return {
        transportKind: 'ollama_responses' as const,
        providerLabel: 'Ollama',
        runtimeAuthority: APP_RUNTIME_MODEL_AUTHORITY,
        capabilityProfile: OLLAMA_RESPONSES_CAPABILITY_PROFILE,
        transport: responsesTransport,
        policy: {
          ...createPolicy('Ollama'),
          shouldFallbackFromTransportError: () => true,
          fallbackInfoMessage: 'Ollama /v1/responses was unavailable for this tool run. Falling back to the normalized local chat transport.'
        },
        buildFallbackRunContext: (context: ProviderRunContext) => ({
          ...context,
          ollamaTransportMode: 'chat'
        })
      };
    });
    const service = new ProviderModelExecutionService({
      agentRuntime: createRuntime(),
      resolveTransport
    });

    const handle = await service.tryStartNormalizedRun({
      providerId: 'ollama',
      context: createContext(),
      callbacks,
      finalizeAssistantOutput: async (_context, output) => output
    });

    expect(handle?.runId).toBe('run-1');
    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Normalized chat fallback complete.');
    });
    expect(chatTransport.requests[0]?.modelId).toBe('qwen3-coder');
    expect(resolveTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        ollamaTransportMode: 'chat'
      })
    );
    expect(callbacks.onInfo).toHaveBeenCalledWith(
      'Ollama /v1/responses was unavailable for this tool run. Falling back to the normalized local chat transport.'
    );
  });

  it('surfaces Ollama missing-write diagnostics when a web-backed page run only creates a folder', async () => {
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
    const catalog = createCatalog([
      createTool('web_search', {
        visibilityGroup: 'web_research',
        renderHint: 'web',
        reviewHint: 'external_research',
        orchestrationHint: 'research',
        readsWorkspace: false,
        usesNetwork: true,
        contentTrust: 'untrusted_content'
      }),
      createTool('extract_web_page', {
        visibilityGroup: 'web_research',
        renderHint: 'web',
        reviewHint: 'external_research',
        orchestrationHint: 'research',
        readsWorkspace: false,
        usesNetwork: true,
        contentTrust: 'untrusted_content'
      }),
      createTool('mkdir', {
        visibilityGroup: 'workspace_write',
        mutatesWorkspace: true,
        readsWorkspace: false
      }),
      createTool('write_file', {
        visibilityGroup: 'workspace_write',
        mutatesWorkspace: true,
        readsWorkspace: false
      })
    ]);
    const runtime = createRuntimeWithCatalog(catalog);
    const service = new ProviderModelExecutionService({
      agentRuntime: runtime,
      resolveTransport: vi.fn(() => ({
        transportKind: 'ollama_chat',
        providerLabel: 'Ollama',
        runtimeAuthority: APP_RUNTIME_MODEL_AUTHORITY,
        capabilityProfile: OLLAMA_CHAT_CAPABILITY_PROFILE,
        transport,
        policy: createOllamaResponsesHarnessPolicy(),
        limits: {
          maxRequiredMutationReminders: 1
        }
      }))
    });
    const callbacks = createCallbacks();
    const prompt = [
      'I want to build a html / css / js landing page hero section just like this.',
      'I want you to get an image from unsplash for a roofing business that will go as the hero image.'
    ].join('\n\n');

    const handle = await service.tryStartNormalizedRun({
      providerId: 'ollama',
      context: createContext({
        apiKey: null,
        ollamaTransportMode: 'chat',
        prompt,
        sourcePrompt: prompt
      }),
      callbacks,
      finalizeAssistantOutput: async (_context, output) => output
    });

    expect(handle?.runId).toBe('run-1');
    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalledWith(
        'No page files were written. Created only roofing-landing before the provider stopped. No write_file or apply_patch tool calls were recorded after 1 runtime reminder. Ollama stopped before writing the required file contents. Continue the thread and ask it to write the missing files, or try a different provider if this repeats.'
      );
    });
    expect(callbacks.onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'guidance',
          providerEventType: 'ollama_tool_loop_missing_file_write_diagnostic',
          summary: 'No file writes recorded before stopping',
          text: expect.stringContaining('parsed tool calls: web_search, extract_web_page, mkdir')
        })
      })
    );
    expect(callbacks.onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          text: expect.stringContaining('created directories: roofing-landing')
        })
      })
    );
    expect(callbacks.onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'thinking',
          text: expect.stringContaining('Local Ollama tool-call contract:')
        })
      })
    );
    const reminderText = callbacks.onInfo.mock.calls
      .map(([event]) => event.activity?.text)
      .find((text): text is string => typeof text === 'string' && text.includes('Local Ollama tool-call contract:')) ?? '';
    expect(reminderText).toContain('If native tool_calls are not emitted, return exactly one tool-call envelope and no prose.');
    expect(reminderText).not.toContain('Local Ollama JSON tool-call fallback for this turn:');
    expect(reminderText).not.toMatch(/\b(qwen|mistral|granite)\b/i);
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    expect(runtime.executeToolCall).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'write_file' }),
      expect.any(Object)
    );
  });
});
