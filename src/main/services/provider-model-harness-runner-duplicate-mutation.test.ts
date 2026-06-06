import { describe, expect, it, vi } from 'vitest';
import type {
  AgentRuntime,
  AgentRuntimeToolCatalog,
  AgentRuntimeToolDescriptor,
  AgentToolCall,
  AgentToolExecutionResult
} from '../../providers/agent-runtime';
import type {
  ProviderModelTransport,
  ProviderModelTurnRequest,
  ProviderModelTurnResult,
  ProviderRunCallbacks,
  ProviderRunContext
} from '../../providers/types';
import {
  startProviderModelHarnessRun,
  type ProviderModelHarnessPolicy,
  type ProviderModelHarnessPreparedRun
} from './provider-model-harness-runner';

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
    nativeWebResearchEnabled: false,
    nativeTools: tools.filter((tool) => tool.origin === 'native'),
    mcpTools: tools.filter((tool) => tool.origin === 'mcp'),
    tools
  };
}

function createWriteCatalog() {
  return createCatalog([
    createTool('write_file', {
      mutatesWorkspace: true,
      readsWorkspace: false,
      visibilityGroup: 'workspace_write',
      reviewHint: 'workspace_mutation',
      orchestrationHint: 'modify'
    })
  ]);
}

function createCallbacks(): ProviderRunCallbacks {
  return {
    onStart: vi.fn(),
    onDelta: vi.fn(),
    onInfo: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onAbort: vi.fn()
  };
}

function createContext(): ProviderRunContext {
  return {
    threadId: 'thread-1',
    runId: 'run-1',
    prompt: 'Write the file.',
    sourcePrompt: 'Write the file.',
    modelId: 'test-model',
    reasoningEffort: null,
    thinkingEnabled: false,
    folderPath: 'C:\\workspace',
    trusted: true,
    apiKey: 'test-key',
    runMode: 'default',
    executionPermission: 'default',
    runtimeSkillResources: []
  };
}

function createPreparedRun(): ProviderModelHarnessPreparedRun {
  const activeToolCatalog = createWriteCatalog();
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
    requiresFileContentMutation: true,
    requiresPostMutationVerification: false,
    requiredStaticWebPageFileExtensions: [],
    requiresWebImageArtifactReference: false,
    requiresWorkspaceMutation: true,
    systemPrompt: 'Harness system instructions.',
    tools: []
  };
}

function createPolicy(): ProviderModelHarnessPolicy {
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
    isUntrustedToolResult: () => false,
    isVerificationCommandToolCall: () => false,
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

async function runHarness(input: {
  agentRuntime: AgentRuntime;
  callbacks?: ProviderRunCallbacks;
  transport: ProviderModelTransport;
}) {
  const callbacks = input.callbacks ?? createCallbacks();
  await startProviderModelHarnessRun({
    agentRuntime: input.agentRuntime,
    callbacks,
    context: createContext(),
    transport: input.transport,
    prepareRun: vi.fn(async () => createPreparedRun()),
    policy: createPolicy(),
    finalizeAssistantOutput: async (_context, output) => output
  });
  return callbacks;
}

function toolResultActivities(callbacks: ProviderRunCallbacks) {
  const onInfo = callbacks.onInfo as unknown as { mock: { calls: Array<[unknown]> } };
  return onInfo.mock.calls
    .map(([payload]) => payload)
    .filter((payload): payload is { activity: { kind: string; status?: string | null; summary?: string } } =>
      Boolean(payload)
      && typeof payload === 'object'
      && 'activity' in payload
      && Boolean((payload as { activity?: unknown }).activity)
      && typeof (payload as { activity?: unknown }).activity === 'object'
    )
    .map((payload) => payload.activity)
    .filter((activity) => activity.kind === 'tool_result');
}

const firstWriteCall: AgentToolCall = {
  name: 'write_file',
  arguments: {
    path: 'src/example.ts',
    content: 'export const value = 1;'
  }
};

describe('Provider model harness duplicate mutation guardrail', () => {
  it('suppresses an exact duplicate mutating tool call after the same call already succeeded', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [firstWriteCall],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [firstWriteCall],
        terminalState: 'completed'
      },
      {
        text: 'Done.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const executeToolCall = vi.fn(async (call: AgentToolCall): Promise<AgentToolExecutionResult> => ({
      toolName: call.name,
      content: `Wrote ${call.arguments.path}`
    }));
    const callbacks = await runHarness({
      transport,
      agentRuntime: {
        executeToolCall
      }
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Done.');
    });

    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(transport.requests[2]?.input.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining('Duplicate mutating tool call suppressed')
    });
    expect(toolResultActivities(callbacks)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'skipped',
        summary: expect.stringContaining('Skipped duplicate write_file')
      })
    ]));
  });

  it('does not suppress a later mutating tool call when its arguments change', async () => {
    const secondWriteCall: AgentToolCall = {
      name: 'write_file',
      arguments: {
        path: 'src/example.ts',
        content: 'export const value = 2;'
      }
    };
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [firstWriteCall],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [secondWriteCall],
        terminalState: 'completed'
      },
      {
        text: 'Done.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const executeToolCall = vi.fn(async (call: AgentToolCall): Promise<AgentToolExecutionResult> => ({
      toolName: call.name,
      content: `Wrote ${call.arguments.path}`
    }));
    const callbacks = await runHarness({
      transport,
      agentRuntime: {
        executeToolCall
      }
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Done.');
    });

    expect(executeToolCall).toHaveBeenCalledTimes(2);
    expect(executeToolCall).toHaveBeenNthCalledWith(2, secondWriteCall, expect.any(Object));
    expect(toolResultActivities(callbacks)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'skipped'
      })
    ]));
  });

  it('does not suppress a retry when the earlier mutating tool call failed', async () => {
    const transport = new FakeTransport([
      {
        text: '',
        toolCalls: [firstWriteCall],
        terminalState: 'completed'
      },
      {
        text: '',
        toolCalls: [firstWriteCall],
        terminalState: 'completed'
      },
      {
        text: 'Done.',
        toolCalls: [],
        terminalState: 'completed'
      }
    ]);
    const executeToolCall = vi.fn(async (call: AgentToolCall): Promise<AgentToolExecutionResult> => {
      if (executeToolCall.mock.calls.length === 1) {
        return {
          toolName: call.name,
          content: 'disk error',
          isError: true
        };
      }

      return {
        toolName: call.name,
        content: `Wrote ${call.arguments.path}`
      };
    });
    const callbacks = await runHarness({
      transport,
      agentRuntime: {
        executeToolCall
      }
    });

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Done.');
    });

    expect(executeToolCall).toHaveBeenCalledTimes(2);
    expect(toolResultActivities(callbacks)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'skipped'
      })
    ]));
  });
});
