import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  AgentRuntime,
  AgentToolCall,
  AgentToolExecutionContext,
  AgentToolExecutionResult
} from '../agent-runtime';
import { buildAgentRuntimeToolCatalog } from '../agent-tool-catalog';
import type {
  HarnessHookEvidence,
  ProviderModelTransport,
  ProviderModelTurnRequest,
  ProviderModelTurnResult,
  ProviderRunCallbacks,
  ProviderRunContext
} from '../types';
import { createOllamaResponsesHarnessPolicy } from './tool-loop-responses-runner';
import { OllamaChatTransport, type OllamaChatFetchWithRetry } from './chat-transport';
import { ProviderModelExecutionService } from '../../main/services/provider-model-execution-service';
import { APP_RUNTIME_MODEL_AUTHORITY } from '../../main/services/provider-model-runtime-authority';
import { OLLAMA_CHAT_CAPABILITY_PROFILE } from '../../main/services/provider-model-capability-profile';

interface RawOllamaTurnEvidence {
  doneReason: string | null;
  eventCount: number;
  promptEvalCount: number | null;
  evalCount: number | null;
  content: string;
  thinking: string;
  structuredToolCalls: unknown[];
}

type DiagnosticTurnOutcome =
  | 'native_tool_calls'
  | 'accepted_fallback_envelope'
  | 'recoverable_contract_violation'
  | 'rejected_unsafe_or_incomplete'
  | 'no_tool_call_output';

interface DiagnosticTurnEvidence {
  turnIndex: number;
  acceptedToolCallCount: number;
  acceptedToolCallNames: string[];
  recoverableContractViolationReason: string | null;
  recoverableContractViolationCandidateToolName: string | null;
  rejectedContractViolationReason: string | null;
  rawStructuredToolCallCount: number;
  rawContentLength: number;
  contractReminderSent: boolean;
  reemittedAcceptedEnvelopeAfterReminder: boolean;
  outcome: DiagnosticTurnOutcome;
  terminalState: ProviderModelTurnResult['terminalState'] | null;
}

interface DiagnosticContractRecoveryEvidence {
  contractReminderSent: boolean;
  recoveredAfterContractReminder: boolean;
  firstContractReminderTurnIndex: number | null;
  firstAcceptedAfterContractReminderTurnIndex: number | null;
}

interface DiagnosticEvidence {
  modelId: string;
  baseUrl: string;
  prompt: string;
  requestSummaries: Array<{
    inputCount: number;
    options: unknown;
    systemLength: number;
    toolNames: string[];
    userContentLengths: number[];
  }>;
  rawTurns: RawOllamaTurnEvidence[];
  callbacks: {
    completed: string[];
    deltas: string[];
    errors: string[];
    infoMessages: string[];
  };
  executedToolCalls: AgentToolCall[];
  harnessHooks: HarnessHookEvidence[];
  turns: DiagnosticTurnEvidence[];
  contractRecovery: DiagnosticContractRecoveryEvidence;
}

const runDiagnostic = process.env.VICODE_RUN_OLLAMA_G5_DIAGNOSTIC === '1' ? describe : describe.skip;
const TOOL_CALL_CONTRACT_REMINDER_SUMMARY = 're-emit a valid tool-call envelope';

function parseRawTurn(raw: string): RawOllamaTurnEvidence {
  const events = raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((event): event is Record<string, unknown> => Boolean(event));

  const content: string[] = [];
  const thinking: string[] = [];
  const structuredToolCalls: unknown[] = [];
  let doneReason: string | null = null;
  let promptEvalCount: number | null = null;
  let evalCount: number | null = null;

  for (const event of events) {
    const message = event.message && typeof event.message === 'object' ? event.message as Record<string, unknown> : null;
    if (message && typeof message.content === 'string') {
      content.push(message.content);
    }
    if (message && typeof message.thinking === 'string') {
      thinking.push(message.thinking);
    }
    if (message && Array.isArray(message.tool_calls)) {
      structuredToolCalls.push(...message.tool_calls);
    }
    if (typeof event.done_reason === 'string') {
      doneReason = event.done_reason;
    }
    if (typeof event.prompt_eval_count === 'number') {
      promptEvalCount = event.prompt_eval_count;
    }
    if (typeof event.eval_count === 'number') {
      evalCount = event.eval_count;
    }
  }

  return {
    doneReason,
    eventCount: events.length,
    promptEvalCount,
    evalCount,
    content: content.join(''),
    thinking: thinking.join(''),
    structuredToolCalls
  };
}

function createDiagnosticFetch(evidence: DiagnosticEvidence): OllamaChatFetchWithRetry {
  return async (baseUrl, requestPath, options, apiKey) => {
    const requestBody = typeof options.body === 'string'
      ? JSON.parse(options.body) as Record<string, unknown>
      : {};
    const messages = Array.isArray(requestBody.messages)
      ? requestBody.messages as Array<Record<string, unknown>>
      : [];
    const tools = Array.isArray(requestBody.tools)
      ? requestBody.tools as Array<{ function?: { name?: unknown } }>
      : [];

    evidence.requestSummaries.push({
      inputCount: messages.length,
      options: requestBody.options ?? null,
      systemLength: typeof messages[0]?.content === 'string' ? messages[0].content.length : 0,
      toolNames: tools
        .map((tool) => typeof tool.function?.name === 'string' ? tool.function.name : null)
        .filter((name): name is string => Boolean(name)),
      userContentLengths: messages
        .filter((message) => message.role === 'user' && typeof message.content === 'string')
        .map((message) => (message.content as string).length)
    });

    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');
    if (apiKey) {
      headers.set('Authorization', `Bearer ${apiKey}`);
    }

    const response = await fetch(`${baseUrl}${requestPath}`, {
      ...options,
      headers
    });
    const rawText = await response.clone().text();
    evidence.rawTurns.push(parseRawTurn(rawText));
    return response;
  };
}

function classifyDiagnosticTurn(input: {
  acceptedToolCallCount: number;
  rawStructuredToolCallCount: number;
  rawContentLength: number;
  violation: ProviderModelTurnResult['toolCallContractViolation'] | null;
  hadAcceptedToolCallBeforeTurn: boolean;
  terminalState: ProviderModelTurnResult['terminalState'] | null;
}): DiagnosticTurnOutcome {
  if (input.acceptedToolCallCount > 0 && input.rawStructuredToolCallCount > 0) {
    return 'native_tool_calls';
  }
  if (input.acceptedToolCallCount > 0) {
    return 'accepted_fallback_envelope';
  }
  if (input.violation?.recoverable) {
    return 'recoverable_contract_violation';
  }
  if (
    input.terminalState === 'error'
    || input.rawStructuredToolCallCount > 0
    || (input.rawContentLength > 0 && !input.hadAcceptedToolCallBeforeTurn)
  ) {
    return 'rejected_unsafe_or_incomplete';
  }

  return 'no_tool_call_output';
}

class DiagnosticTransport implements ProviderModelTransport {
  private turnIndex = 0;
  private acceptedToolCallSeen = false;

  constructor(
    private readonly transport: ProviderModelTransport,
    private readonly evidence: DiagnosticEvidence
  ) {}

  async sendTurn(request: ProviderModelTurnRequest): Promise<ProviderModelTurnResult> {
    const rawTurnStart = this.evidence.rawTurns.length;
    const hadAcceptedToolCallBeforeTurn = this.acceptedToolCallSeen;
    const result = await this.transport.sendTurn(request);
    const rawTurns = this.evidence.rawTurns.slice(rawTurnStart);
    const rawStructuredToolCallCount = rawTurns.reduce(
      (count, turn) => count + turn.structuredToolCalls.length,
      0
    );
    const rawContentLength = rawTurns.reduce(
      (count, turn) => count + turn.content.trim().length,
      0
    );
    const violation = result.toolCallContractViolation ?? null;

    this.evidence.turns.push({
      turnIndex: this.turnIndex,
      acceptedToolCallCount: result.toolCalls.length,
      acceptedToolCallNames: result.toolCalls.map((call) => call.name),
      recoverableContractViolationReason: violation?.recoverable ? violation.reason : null,
      recoverableContractViolationCandidateToolName: violation?.recoverable
        ? violation.candidateToolName
        : null,
      rejectedContractViolationReason: violation && !violation.recoverable ? violation.reason : null,
      rawStructuredToolCallCount,
      rawContentLength,
      contractReminderSent: false,
      reemittedAcceptedEnvelopeAfterReminder: false,
      outcome: classifyDiagnosticTurn({
        acceptedToolCallCount: result.toolCalls.length,
        rawStructuredToolCallCount,
        rawContentLength,
        violation,
        hadAcceptedToolCallBeforeTurn,
        terminalState: result.terminalState ?? null
      }),
      terminalState: result.terminalState ?? null
    });

    if (result.toolCalls.length > 0) {
      this.acceptedToolCallSeen = true;
    }
    this.turnIndex += 1;

    return result;
  }
}

function summarizeContractRecovery(evidence: DiagnosticEvidence) {
  const reminderTurnIndexes = evidence.harnessHooks
    .filter((hook) =>
      hook.stage === 'continuation'
      && hook.continuationReason === 'required_mutation'
      && hook.summary?.includes(TOOL_CALL_CONTRACT_REMINDER_SUMMARY)
    )
    .map((hook) => hook.turnIndex)
    .filter((turnIndex): turnIndex is number => typeof turnIndex === 'number')
    .sort((a, b) => a - b);
  const reminderTurnIndexSet = new Set(reminderTurnIndexes);
  let firstAcceptedAfterContractReminderTurnIndex: number | null = null;

  for (const turn of evidence.turns) {
    turn.contractReminderSent = reminderTurnIndexSet.has(turn.turnIndex);
    const hasPriorContractReminder = reminderTurnIndexes.some(
      (reminderTurnIndex) => reminderTurnIndex < turn.turnIndex
    );
    turn.reemittedAcceptedEnvelopeAfterReminder =
      hasPriorContractReminder && turn.acceptedToolCallCount > 0;
    if (
      firstAcceptedAfterContractReminderTurnIndex === null
      && turn.reemittedAcceptedEnvelopeAfterReminder
    ) {
      firstAcceptedAfterContractReminderTurnIndex = turn.turnIndex;
    }
  }

  evidence.contractRecovery = {
    contractReminderSent: reminderTurnIndexes.length > 0,
    recoveredAfterContractReminder: firstAcceptedAfterContractReminderTurnIndex !== null,
    firstContractReminderTurnIndex: reminderTurnIndexes[0] ?? null,
    firstAcceptedAfterContractReminderTurnIndex
  };
}

function createDiagnosticRuntime(evidence: DiagnosticEvidence): AgentRuntime {
  const catalog = buildAgentRuntimeToolCatalog({
    executionPermission: 'full_access',
    trustedWorkspace: true,
    nativeWebResearchEnabled: false,
    mcpTools: [],
    runtimeCommandPolicy: 'approval_required',
    runtimeNetworkPolicy: 'disabled'
  });

  return {
    async executeToolCall(call: AgentToolCall, _context: AgentToolExecutionContext): Promise<AgentToolExecutionResult> {
      evidence.executedToolCalls.push(call);

      if (call.name === 'write_file') {
        return {
          toolName: call.name,
          content: `Diagnostic simulated write_file for ${String(call.arguments.path ?? '')}.`
        };
      }
      if (call.name === 'mkdir') {
        return {
          toolName: call.name,
          content: `Diagnostic simulated mkdir for ${String(call.arguments.path ?? '')}.`
        };
      }
      if (call.name === 'read_file') {
        return {
          toolName: call.name,
          content: '[diagnostic] file not read from disk'
        };
      }
      if (call.name === 'list_directory') {
        return {
          toolName: call.name,
          content: 'g5-diagnostic-workspace.txt'
        };
      }

      return {
        toolName: call.name,
        content: `Diagnostic simulated ${call.name}.`
      };
    },
    async listToolCatalog() {
      return catalog;
    },
    hasNativeWebResearch() {
      return false;
    }
  };
}

function createCallbacks(evidence: DiagnosticEvidence): ProviderRunCallbacks {
  return {
    onStart: () => undefined,
    onDelta: (delta) => {
      evidence.callbacks.deltas.push(delta);
    },
    onInfo: (payload) => {
      if (typeof payload === 'string') {
        evidence.callbacks.infoMessages.push(payload);
        return;
      }
      if (payload.harnessHookEvidence) {
        evidence.harnessHooks.push(payload.harnessHookEvidence);
      }
      if (payload.message) {
        evidence.callbacks.infoMessages.push(payload.message);
      }
      if (payload.activity?.summary) {
        evidence.callbacks.infoMessages.push(payload.activity.summary);
      }
    },
    onComplete: (output) => {
      evidence.callbacks.completed.push(output);
    },
    onError: (message) => {
      evidence.callbacks.errors.push(message);
    },
    onAbort: (message) => {
      evidence.callbacks.errors.push(message ?? 'aborted');
    }
  };
}

function safeArtifactName(value: string) {
  return value.replace(/[^a-z0-9._-]+/giu, '_').replace(/^_+|_+$/gu, '') || 'model';
}

runDiagnostic('G5 local Ollama tool-call diagnostic', () => {
  it('captures raw local Ollama output through the app-shaped normalized harness path', async () => {
    const modelId = process.env.VICODE_G5_OLLAMA_MODEL?.trim() || 'qwen2.5-coder:14b-instruct-q6_K';
    const baseUrl = process.env.VICODE_OLLAMA_BASE_URL?.trim() || 'http://127.0.0.1:11434';
    const prompt = [
      'Create a file named g5-root-cause-local.txt in this project.',
      'The entire file contents must be exactly: G5_LOCAL_TOOL_DIAGNOSTIC_OK',
      'Use write_file for the file change. Do not create any other files.',
      'After writing the file, reply exactly: G5_LOCAL_TOOL_DIAGNOSTIC_OK'
    ].join('\n');
    const workspaceRoot = process.cwd();
    const evidence: DiagnosticEvidence = {
      modelId,
      baseUrl,
      prompt,
      requestSummaries: [],
      rawTurns: [],
      callbacks: {
        completed: [],
        deltas: [],
        errors: [],
        infoMessages: []
      },
      executedToolCalls: [],
      harnessHooks: [],
      turns: [],
      contractRecovery: {
        contractReminderSent: false,
        recoveredAfterContractReminder: false,
        firstContractReminderTurnIndex: null,
        firstAcceptedAfterContractReminderTurnIndex: null
      }
    };
    const transport = new DiagnosticTransport(new OllamaChatTransport({
      apiKey: null,
      baseUrl,
      fetchWithRetry: createDiagnosticFetch(evidence),
      timeoutMs: 300_000
    }), evidence);
    const service = new ProviderModelExecutionService({
      agentRuntime: createDiagnosticRuntime(evidence),
      resolveTransport: () => ({
        transportKind: 'ollama_chat',
        providerLabel: 'Ollama',
        runtimeAuthority: APP_RUNTIME_MODEL_AUTHORITY,
        capabilityProfile: OLLAMA_CHAT_CAPABILITY_PROFILE,
        transport,
        policy: createOllamaResponsesHarnessPolicy(),
        limits: {
          maxRequiredMutationReminders: 2,
          maxRuntimeMs: 300_000
        }
      })
    });
    const context: ProviderRunContext = {
      threadId: 'g5-diagnostic-thread',
      runId: 'g5-diagnostic-run',
      prompt,
      sourcePrompt: prompt,
      modelId,
      reasoningEffort: null,
      thinkingEnabled: false,
      folderPath: workspaceRoot,
      runtimeWorkspaceRoot: workspaceRoot,
      trusted: true,
      apiKey: null,
      runMode: 'default',
      executionPermission: 'full_access',
      runtimeCommandPolicy: 'approval_required',
      runtimeNetworkPolicy: 'disabled',
      ollamaTransportMode: 'chat',
      runtimeSkillResources: []
    };
    const handle = await service.tryStartNormalizedRun({
      providerId: 'ollama',
      context,
      callbacks: createCallbacks(evidence),
      finalizeAssistantOutput: async (_context, output) => output
    });
    expect(handle).not.toBeNull();

    await expect.poll(
      () => evidence.callbacks.completed.length + evidence.callbacks.errors.length,
      { timeout: 310_000 }
    ).toBeGreaterThan(0);
    summarizeContractRecovery(evidence);

    const outputPath = path.join(
      process.cwd(),
      'test-results',
      `ollama-g5-local-tool-diagnostic-${safeArtifactName(modelId)}.json`
    );
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

    expect(evidence.rawTurns.length).toBeGreaterThan(0);
    expect(evidence.turns.length).toBeGreaterThan(0);
    expect(evidence.turns.every((turn) => Number.isInteger(turn.acceptedToolCallCount))).toBe(true);
    expect(typeof evidence.contractRecovery.contractReminderSent).toBe('boolean');
  }, 320_000);
});
