import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
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
  ProviderModelToolDefinition,
  ProviderModelTransport,
  ProviderModelTurnRequest,
  ProviderModelTurnResult,
  ProviderRunCallbacks,
  ProviderRunContext
} from '../types';
import { APP_RUNTIME_MODEL_AUTHORITY } from '../../main/services/provider-model-runtime-authority';
import { OLLAMA_CHAT_CAPABILITY_PROFILE } from '../../main/services/provider-model-capability-profile';
import { ProviderModelExecutionService } from '../../main/services/provider-model-execution-service';
import { OllamaChatTransport, type OllamaChatFetchWithRetry } from './chat-transport';
import {
  buildOllamaProviderDiagnostics,
  classifyOllamaToolCallContent,
  isRecord
} from './tool-loop-model';
import {
  OLLAMA_TOOL_INTENT_ADAPTER_SOURCE,
  classifyOllamaToolIntentAdapterResponse,
  createOllamaToolIntentAdapterFormat
} from './tool-intent-adapter';
import { createOllamaResponsesHarnessPolicy } from './tool-loop-responses-runner';

type StreamMode = 'stream_true' | 'stream_false';
type ToolIntentStrategy =
  | 'baseline'
  | 'baseline_adapter_fallback'
  | 'adapter_first'
  | 'alias_normalizer'
  | 'structured_schema'
  | 'native_only';

type RawContentDecision =
  | {
      status: 'empty';
      source: null;
      reason: null;
      candidateToolName: null;
    }
  | {
      status: 'accepted';
      source:
        | 'structured'
        | 'xml'
        | 'exact_json'
        | 'schema_json'
        | 'alias_normalized_json'
        | 'strict_fenced_json'
        | 'strict_unlabeled_fence'
        | typeof OLLAMA_TOOL_INTENT_ADAPTER_SOURCE;
      reason: null;
      candidateToolName: null;
    }
  | {
      status: 'recoverable_contract_violation';
      source: null;
      reason: string;
      candidateToolName: string | null;
    }
  | {
      status: 'rejected';
      source: null;
      reason: string;
      candidateToolName: string | null;
    };

interface RawOllamaToolModeTurnEvidence {
  streamRequested: boolean;
  httpStatus: number;
  ok: boolean;
  latencyMs: number;
  responseBytes: number;
  doneReason: string | null;
  eventCount: number;
  promptEvalCount: number | null;
  evalCount: number | null;
  content: string;
  thinking: string;
  structuredToolCalls: unknown[];
  emptyResponse: boolean;
}

interface ToolModeRequestSummary {
  stream: boolean | null;
  format: unknown;
  inputCount: number;
  options: unknown;
  systemLength: number;
  toolNames: string[];
  userContentLengths: number[];
}

interface ToolModeTurnEvidence {
  turnIndex: number;
  latencyMs: number;
  acceptedToolCallCount: number;
  acceptedToolCallNames: string[];
  acceptedToolCallSource: AcceptedToolCallSource | null;
  recoverableContractViolationReason: string | null;
  recoverableContractViolationCandidateToolName: string | null;
  rawStructuredToolCallCount: number;
  rawContentLength: number;
  rawContentDecision: RawContentDecision;
  adapterAttempted: boolean;
  adapterAcceptedToolCallCount: number;
  adapterAcceptedToolCallNames: string[];
  adapterDecision: RawContentDecision | null;
  emptyResponse: boolean;
  terminalState: ProviderModelTurnResult['terminalState'] | null;
}

type AcceptedToolCallSource =
  | RawContentDecision['source']
  | 'native_tool_calls'
  | typeof OLLAMA_TOOL_INTENT_ADAPTER_SOURCE;

interface ToolModeRunSummary {
  completed: boolean;
  error: string | null;
  totalLatencyMs: number;
  acceptedToolCallCount: number;
  acceptedToolCallNames: string[];
  structuredToolCallTurnCount: number;
  acceptedFallbackEnvelopeTurnCount: number;
  recoverableContractViolationTurnCount: number;
  emptyResponseTurnCount: number;
  adapterAttemptCount: number;
  adapterAcceptedToolCallCount: number;
  contractReminderSent: boolean;
  recoveredAfterContractReminder: boolean;
  firstAcceptedSource: AcceptedToolCallSource | null;
}

interface ToolIntentAdapterAttemptEvidence {
  turnIndex: number;
  strategy: ToolIntentStrategy;
  requestSummary: ToolModeRequestSummary;
  httpStatus: number;
  ok: boolean;
  latencyMs: number;
  responseBytes: number;
  rawContent: string;
  rawContentLength: number;
  decision: RawContentDecision;
  acceptedToolCallCount: number;
  acceptedToolCallNames: string[];
  error: string | null;
}

interface ToolModeRunEvidence {
  modelId: string;
  strategy: ToolIntentStrategy;
  streamMode: StreamMode;
  streamRequested: boolean;
  baseUrl: string;
  prompt: string;
  requestSummaries: ToolModeRequestSummary[];
  rawTurns: RawOllamaToolModeTurnEvidence[];
  adapterAttempts: ToolIntentAdapterAttemptEvidence[];
  turns: ToolModeTurnEvidence[];
  callbacks: {
    completed: string[];
    deltas: string[];
    errors: string[];
    infoMessages: string[];
  };
  executedToolCalls: AgentToolCall[];
  harnessHooks: HarnessHookEvidence[];
  summary: ToolModeRunSummary;
}

const runDiagnostic = process.env.VICODE_RUN_OLLAMA_TOOL_MODE_DIAGNOSTIC === '1'
  ? describe
  : describe.skip;

const STREAM_MODES: StreamMode[] = ['stream_true', 'stream_false'];
const DEFAULT_TOOL_INTENT_STRATEGIES: ToolIntentStrategy[] = [
  'baseline',
  'baseline_adapter_fallback',
  'adapter_first'
];
const TOOL_INTENT_STRATEGIES: ToolIntentStrategy[] = [
  'baseline',
  'baseline_adapter_fallback',
  'adapter_first',
  'alias_normalizer',
  'structured_schema',
  'native_only'
];
const TOOL_CALL_CONTRACT_REMINDER_SUMMARY = 're-emit a valid tool-call envelope';

function streamRequestedForMode(strategy: ToolIntentStrategy, mode: StreamMode) {
  if (strategy === 'structured_schema') {
    return false;
  }
  return mode === 'stream_true';
}

function emptySummary(): ToolModeRunSummary {
  return {
    completed: false,
    error: null,
    totalLatencyMs: 0,
    acceptedToolCallCount: 0,
    acceptedToolCallNames: [],
    structuredToolCallTurnCount: 0,
    acceptedFallbackEnvelopeTurnCount: 0,
    recoverableContractViolationTurnCount: 0,
    emptyResponseTurnCount: 0,
    adapterAttemptCount: 0,
    adapterAcceptedToolCallCount: 0,
    contractReminderSent: false,
    recoveredAfterContractReminder: false,
    firstAcceptedSource: null
  };
}

function parseRawTurn(
  raw: string,
  input: {
    streamRequested: boolean;
    httpStatus: number;
    ok: boolean;
    latencyMs: number;
  }
): RawOllamaToolModeTurnEvidence {
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
    const message = event.message && typeof event.message === 'object'
      ? event.message as Record<string, unknown>
      : null;
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

  const joinedContent = content.join('');
  const joinedThinking = thinking.join('');

  return {
    streamRequested: input.streamRequested,
    httpStatus: input.httpStatus,
    ok: input.ok,
    latencyMs: input.latencyMs,
    responseBytes: Buffer.byteLength(raw, 'utf8'),
    doneReason,
    eventCount: events.length,
    promptEvalCount,
    evalCount,
    content: joinedContent,
    thinking: joinedThinking,
    structuredToolCalls,
    emptyResponse:
      input.ok
      && events.length > 0
      && !joinedContent.trim()
      && !joinedThinking.trim()
      && structuredToolCalls.length === 0
  };
}

function summarizeRequest(body: Record<string, unknown>): ToolModeRequestSummary {
  const messages = Array.isArray(body.messages)
    ? body.messages as Array<Record<string, unknown>>
    : [];
  const tools = Array.isArray(body.tools)
    ? body.tools as Array<{ function?: { name?: unknown } }>
    : [];

  return {
    stream: typeof body.stream === 'boolean' ? body.stream : null,
    format: body.format ?? null,
    inputCount: messages.length,
    options: body.options ?? null,
    systemLength: typeof messages[0]?.content === 'string' ? messages[0].content.length : 0,
    toolNames: tools
      .map((tool) => typeof tool.function?.name === 'string' ? tool.function.name : null)
      .filter((name): name is string => Boolean(name)),
    userContentLengths: messages
      .filter((message) => message.role === 'user' && typeof message.content === 'string')
      .map((message) => (message.content as string).length)
  };
}

function isToolDefinition(value: unknown): value is ProviderModelToolDefinition {
  return isRecord(value)
    && value.type === 'function'
    && isRecord(value.function)
    && typeof value.function.name === 'string'
    && value.function.name.trim().length > 0;
}

function readRequestToolDefinitions(body: Record<string, unknown>) {
  return Array.isArray(body.tools)
    ? body.tools.filter(isToolDefinition)
    : [];
}

function describeToolDefinition(definition: ProviderModelToolDefinition) {
  const parameters = isRecord(definition.function.parameters)
    ? definition.function.parameters
    : {};
  const required = Array.isArray(parameters.required)
    ? parameters.required.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  return required.length > 0
    ? `- ${definition.function.name}: required arguments ${required.join(', ')}`
    : `- ${definition.function.name}: no required arguments`;
}

function createToolIntentSchema(toolDefinitions: ProviderModelToolDefinition[]) {
  const toolNames = toolDefinitions.map((definition) => definition.function.name);
  return {
    type: 'object',
    properties: {
      name: toolNames.length > 0
        ? {
            type: 'string',
            enum: toolNames
          }
        : {
            type: 'string'
          },
      arguments: {
        type: 'object'
      }
    },
    required: ['name', 'arguments'],
    additionalProperties: false
  };
}

function createStructuredSchemaInstruction(toolDefinitions: ProviderModelToolDefinition[]) {
  return [
    'Local Ollama tool-intent schema diagnostic:',
    'Return exactly one JSON object matching {"name":"tool_name","arguments":{...}}.',
    'Do not include prose, markdown, code fences, or final answer text.',
    'Vicode will validate the object against the active tool schema before execution.',
    'Active tools:',
    ...toolDefinitions.map(describeToolDefinition),
    'When the task requires creating or editing a file, use write_file with path and content.'
  ].join('\n');
}

function createAdapterInstruction(toolDefinitions: ProviderModelToolDefinition[]) {
  return [
    'Local Ollama tool-intent adapter diagnostic:',
    'Return exactly one JSON object matching {"name":"tool_name","arguments":{...}}.',
    'Do not include prose, markdown, code fences, or final answer text.',
    'Do not invent paths, content, commands, or tools that are not present in the user task.',
    'Vicode will validate the object against the active tool schema before execution.',
    'Active tools:',
    ...toolDefinitions.map(describeToolDefinition),
    'When the task requires creating or editing a file, use write_file with path and content.'
  ].join('\n');
}

function configureStructuredSchemaRequestBody(body: Record<string, unknown>) {
  const toolDefinitions = readRequestToolDefinitions(body);
  const messages = Array.isArray(body.messages)
    ? body.messages as Array<Record<string, unknown>>
    : [];
  const firstMessage = messages[0];
  const instruction = createStructuredSchemaInstruction(toolDefinitions);

  if (firstMessage && typeof firstMessage.content === 'string') {
    firstMessage.content = `${firstMessage.content}\n\n${instruction}`;
  } else {
    messages.unshift({
      role: 'system',
      content: instruction
    });
    body.messages = messages;
  }

  body.stream = false;
  body.format = createToolIntentSchema(toolDefinitions);
  body.options = {
    ...(isRecord(body.options) ? body.options : {}),
    temperature: 0
  };
  delete body.tools;
}

function requestContainsToolResult(request: ProviderModelTurnRequest) {
  return request.input.some((message) =>
    message.role === 'tool'
    || /^Tool result for [^:\n]+:\n/iu.test(message.content)
  );
}

function extractAdapterUserTask(request: ProviderModelTurnRequest) {
  const latestUserMessage = [...request.input]
    .reverse()
    .find((message) => message.role === 'user' && !/^Tool result for [^:\n]+:\n/iu.test(message.content));

  return latestUserMessage?.content.trim() || request.input
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');
}

function createAdapterRequestBody(request: ProviderModelTurnRequest) {
  const toolDefinitions = request.tools;
  return {
    model: request.modelId,
    stream: false,
    messages: [
      {
        role: 'system',
        content: createAdapterInstruction(toolDefinitions)
      },
      {
        role: 'user',
        content: [
          'Original Vicode task:',
          extractAdapterUserTask(request),
          '',
          'Return exactly one tool intent JSON object for this task.'
        ].join('\n')
      }
    ],
    format: createOllamaToolIntentAdapterFormat(toolDefinitions),
    options: {
      temperature: 0
    }
  };
}

function adapterDecisionFromResponse(
  content: string,
  toolDefinitions: ProviderModelToolDefinition[]
): {
  decision: RawContentDecision;
  toolCalls: AgentToolCall[];
} {
  const decision = classifyOllamaToolIntentAdapterResponse(content, toolDefinitions);
  if (decision.status === 'accepted') {
    return {
      decision: {
        status: 'accepted',
        source: decision.source,
        reason: null,
        candidateToolName: null
      },
      toolCalls: decision.toolCalls
    };
  }

  return {
    decision: {
      status: 'rejected',
      source: null,
      reason: decision.reason,
      candidateToolName: decision.candidateToolName
    },
    toolCalls: []
  };
}

function classifyRawContent(
  content: string,
  toolDefinitions: ProviderModelToolDefinition[],
  strategy: ToolIntentStrategy
): RawContentDecision {
  if (!content.trim()) {
    return {
      status: 'empty',
      source: null,
      reason: null,
      candidateToolName: null
    };
  }

  const decision = classifyOllamaToolCallContent(
    { content },
    {
      toolDefinitions,
      jsonAliasNormalization: strategy === 'alias_normalizer'
    }
  );
  if (decision.status === 'accepted') {
    return {
      status: 'accepted',
      source: strategy === 'structured_schema' && decision.source === 'exact_json'
        ? 'schema_json'
        : decision.source,
      reason: null,
      candidateToolName: null
    };
  }
  if (decision.status === 'recoverable_contract_violation') {
    return {
      status: decision.status,
      source: null,
      reason: decision.reason,
      candidateToolName: decision.candidateToolName
    };
  }

  return {
    status: 'rejected',
    source: null,
    reason: decision.reason,
    candidateToolName: null
  };
}

function createToolModeFetch(evidence: ToolModeRunEvidence): OllamaChatFetchWithRetry {
  return async (baseUrl, requestPath, options, apiKey) => {
    const requestBody = typeof options.body === 'string'
      ? JSON.parse(options.body) as Record<string, unknown>
      : {};
    requestBody.stream = evidence.streamRequested;
    if (evidence.strategy === 'structured_schema') {
      configureStructuredSchemaRequestBody(requestBody);
    }
    evidence.requestSummaries.push(summarizeRequest(requestBody));

    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');
    if (apiKey) {
      headers.set('Authorization', `Bearer ${apiKey}`);
    }

    const startedAt = performance.now();
    const response = await fetch(`${baseUrl}${requestPath}`, {
      ...options,
      headers,
      body: JSON.stringify(requestBody)
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    const rawText = await response.clone().text();
    evidence.rawTurns.push(parseRawTurn(rawText, {
      streamRequested: evidence.streamRequested,
      httpStatus: response.status,
      ok: response.ok,
      latencyMs
    }));

    return response;
  };
}

function resultWithToolCalls(
  result: ProviderModelTurnResult,
  toolCalls: AgentToolCall[],
  toolCallContractViolation: ProviderModelTurnResult['toolCallContractViolation'] = null
): ProviderModelTurnResult {
  return {
    ...result,
    toolCalls: toolCalls.map((call) => ({
      name: call.name,
      arguments: call.arguments
    })),
    toolCallContractViolation,
    providerDiagnostics: buildOllamaProviderDiagnostics(toolCalls)
  };
}

function emptyCompletedTurnResult(): ProviderModelTurnResult {
  return {
    text: '',
    toolCalls: [],
    toolCallContractViolation: null,
    providerDiagnostics: null,
    terminalState: 'completed'
  };
}

function applyDiagnosticStrategy(input: {
  strategy: ToolIntentStrategy;
  result: ProviderModelTurnResult;
  request: ProviderModelTurnRequest;
  rawContent: string;
  rawStructuredToolCalls: unknown[];
}): ProviderModelTurnResult {
  if (input.result.terminalState === 'error') {
    return input.result;
  }

  if (input.strategy === 'native_only') {
    const decision = classifyOllamaToolCallContent(
      {
        content: '',
        tool_calls: input.rawStructuredToolCalls
      },
      {
        toolDefinitions: input.request.tools
      }
    );
    return resultWithToolCalls(
      input.result,
      decision.status === 'accepted' ? decision.toolCalls : []
    );
  }

  if (input.strategy === 'alias_normalizer' && input.result.toolCalls.length === 0 && input.rawContent.trim()) {
    const decision = classifyOllamaToolCallContent(
      {
        content: input.rawContent
      },
      {
        toolDefinitions: input.request.tools,
        jsonAliasNormalization: true
      }
    );
    if (decision.status === 'accepted') {
      return resultWithToolCalls(input.result, decision.toolCalls);
    }
    if (decision.status === 'recoverable_contract_violation') {
      return {
        ...input.result,
        toolCallContractViolation: {
          providerId: 'ollama',
          reason: decision.reason,
          candidateToolName: decision.candidateToolName,
          recoverable: true
        }
      };
    }
  }

  return input.result;
}

function canAttemptAdapter(request: ProviderModelTurnRequest) {
  return request.tools.length > 0 && !requestContainsToolResult(request);
}

async function requestAdapterToolIntent(input: {
  evidence: ToolModeRunEvidence;
  request: ProviderModelTurnRequest;
  turnIndex: number;
}): Promise<{
  decision: RawContentDecision;
  toolCalls: AgentToolCall[];
}> {
  const requestBody = createAdapterRequestBody(input.request);
  const requestSummary = summarizeRequest(requestBody);
  const startedAt = performance.now();

  try {
    const response = await fetch(`${input.evidence.baseUrl}/api/chat`, {
      method: 'POST',
      signal: input.request.signal,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    const rawText = await response.text();
    const rawTurn = parseRawTurn(rawText, {
      streamRequested: false,
      httpStatus: response.status,
      ok: response.ok,
      latencyMs
    });
    const parsedDecision = response.ok
      ? adapterDecisionFromResponse(rawTurn.content, input.request.tools)
      : {
          decision: {
            status: 'rejected',
            source: null,
            reason: rawText.trim() || `Ollama returned HTTP ${response.status}.`,
            candidateToolName: null
          } satisfies RawContentDecision,
          toolCalls: []
        };

    input.evidence.adapterAttempts.push({
      turnIndex: input.turnIndex,
      strategy: input.evidence.strategy,
      requestSummary,
      httpStatus: response.status,
      ok: response.ok,
      latencyMs,
      responseBytes: Buffer.byteLength(rawText, 'utf8'),
      rawContent: rawTurn.content,
      rawContentLength: rawTurn.content.trim().length,
      decision: parsedDecision.decision,
      acceptedToolCallCount: parsedDecision.toolCalls.length,
      acceptedToolCallNames: parsedDecision.toolCalls.map((call) => call.name),
      error: response.ok ? null : rawText.trim() || `Ollama returned HTTP ${response.status}.`
    });

    return parsedDecision;
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const message = error instanceof Error ? error.message : String(error);
    const decision: RawContentDecision = {
      status: 'rejected',
      source: null,
      reason: message,
      candidateToolName: null
    };
    input.evidence.adapterAttempts.push({
      turnIndex: input.turnIndex,
      strategy: input.evidence.strategy,
      requestSummary,
      httpStatus: 0,
      ok: false,
      latencyMs,
      responseBytes: 0,
      rawContent: '',
      rawContentLength: 0,
      decision,
      acceptedToolCallCount: 0,
      acceptedToolCallNames: [],
      error: message
    });
    return {
      decision,
      toolCalls: []
    };
  }
}

class ToolModeDiagnosticTransport implements ProviderModelTransport {
  private turnIndex = 0;

  constructor(
    private readonly transport: ProviderModelTransport,
    private readonly evidence: ToolModeRunEvidence
  ) {}

  async sendTurn(request: ProviderModelTurnRequest): Promise<ProviderModelTurnResult> {
    const startedAt = performance.now();
    let adapterAttempt: Awaited<ReturnType<typeof requestAdapterToolIntent>> | null = null;
    const adapterAllowed = canAttemptAdapter(request);
    const rawTurnStart = this.evidence.rawTurns.length;

    if (this.evidence.strategy === 'adapter_first' && adapterAllowed) {
      adapterAttempt = await requestAdapterToolIntent({
        evidence: this.evidence,
        request,
        turnIndex: this.turnIndex
      });
      if (adapterAttempt.toolCalls.length > 0) {
        const latencyMs = Math.round(performance.now() - startedAt);
        const strategyResult = resultWithToolCalls(emptyCompletedTurnResult(), adapterAttempt.toolCalls);

        this.evidence.turns.push({
          turnIndex: this.turnIndex,
          latencyMs,
          acceptedToolCallCount: strategyResult.toolCalls.length,
          acceptedToolCallNames: strategyResult.toolCalls.map((call) => call.name),
          acceptedToolCallSource: OLLAMA_TOOL_INTENT_ADAPTER_SOURCE,
          recoverableContractViolationReason: null,
          recoverableContractViolationCandidateToolName: null,
          rawStructuredToolCallCount: 0,
          rawContentLength: 0,
          rawContentDecision: {
            status: 'empty',
            source: null,
            reason: null,
            candidateToolName: null
          },
          adapterAttempted: true,
          adapterAcceptedToolCallCount: adapterAttempt.toolCalls.length,
          adapterAcceptedToolCallNames: adapterAttempt.toolCalls.map((call) => call.name),
          adapterDecision: adapterAttempt.decision,
          emptyResponse: false,
          terminalState: strategyResult.terminalState ?? null
        });
        this.turnIndex += 1;

        return strategyResult;
      }
    }

    const result = await this.transport.sendTurn(request);
    const rawTurns = this.evidence.rawTurns.slice(rawTurnStart);
    const rawStructuredToolCallCount = rawTurns.reduce(
      (count, turn) => count + turn.structuredToolCalls.length,
      0
    );
    const rawStructuredToolCalls = rawTurns.flatMap((turn) => turn.structuredToolCalls);
    const rawContent = rawTurns.map((turn) => turn.content).join('');
    let strategyResult = applyDiagnosticStrategy({
      strategy: this.evidence.strategy,
      result,
      request,
      rawContent,
      rawStructuredToolCalls
    });
    if (
      this.evidence.strategy === 'baseline_adapter_fallback'
      && strategyResult.toolCalls.length === 0
      && adapterAllowed
    ) {
      adapterAttempt = await requestAdapterToolIntent({
        evidence: this.evidence,
        request,
        turnIndex: this.turnIndex
      });
      if (adapterAttempt.toolCalls.length > 0) {
        strategyResult = resultWithToolCalls(strategyResult, adapterAttempt.toolCalls);
      }
    }
    const latencyMs = Math.round(performance.now() - startedAt);
    const violation = strategyResult.toolCallContractViolation ?? null;
    const rawContentDecision = rawStructuredToolCallCount > 0
      ? {
          status: 'accepted',
          source: 'structured',
          reason: null,
          candidateToolName: null
        } satisfies RawContentDecision
      : classifyRawContent(rawContent, request.tools, this.evidence.strategy);
    const acceptedToolCallSource = strategyResult.toolCalls.length === 0
      ? null
      : adapterAttempt?.toolCalls.length
        ? OLLAMA_TOOL_INTENT_ADAPTER_SOURCE
        : rawStructuredToolCallCount > 0
          ? 'native_tool_calls'
          : rawContentDecision.source;

    this.evidence.turns.push({
      turnIndex: this.turnIndex,
      latencyMs,
      acceptedToolCallCount: strategyResult.toolCalls.length,
      acceptedToolCallNames: strategyResult.toolCalls.map((call) => call.name),
      acceptedToolCallSource,
      recoverableContractViolationReason: violation?.recoverable ? violation.reason : null,
      recoverableContractViolationCandidateToolName: violation?.recoverable
        ? violation.candidateToolName
        : null,
      rawStructuredToolCallCount,
      rawContentLength: rawContent.trim().length,
      rawContentDecision,
      adapterAttempted: Boolean(adapterAttempt),
      adapterAcceptedToolCallCount: adapterAttempt?.toolCalls.length ?? 0,
      adapterAcceptedToolCallNames: adapterAttempt?.toolCalls.map((call) => call.name) ?? [],
      adapterDecision: adapterAttempt?.decision ?? null,
      emptyResponse: rawTurns.some((turn) => turn.emptyResponse),
      terminalState: strategyResult.terminalState ?? null
    });
    this.turnIndex += 1;

    return strategyResult;
  }
}

function createDiagnosticRuntime(evidence: ToolModeRunEvidence): AgentRuntime {
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

function createCallbacks(evidence: ToolModeRunEvidence): ProviderRunCallbacks {
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

function summarizeRun(evidence: ToolModeRunEvidence) {
  const reminderTurns = evidence.harnessHooks.filter((hook) =>
    hook.stage === 'continuation'
    && hook.continuationReason === 'required_mutation'
    && hook.summary?.includes(TOOL_CALL_CONTRACT_REMINDER_SUMMARY)
  );
  const firstReminderTurn = reminderTurns
    .map((hook) => hook.turnIndex)
    .filter((turnIndex): turnIndex is number => typeof turnIndex === 'number')
    .sort((a, b) => a - b)[0] ?? null;
  const firstAcceptedAfterReminder = firstReminderTurn === null
    ? null
    : evidence.turns.find((turn) =>
      turn.turnIndex > firstReminderTurn && turn.acceptedToolCallCount > 0
    ) ?? null;
  const acceptedTurns = evidence.turns.filter((turn) => turn.acceptedToolCallCount > 0);
  const firstAcceptedTurn = acceptedTurns[0] ?? null;

  evidence.summary = {
    completed: evidence.callbacks.completed.length > 0,
    error: evidence.callbacks.errors[0] ?? null,
    totalLatencyMs: evidence.turns.reduce((sum, turn) => sum + turn.latencyMs, 0),
    acceptedToolCallCount: evidence.turns.reduce((sum, turn) => sum + turn.acceptedToolCallCount, 0),
    acceptedToolCallNames: [...new Set(evidence.turns.flatMap((turn) => turn.acceptedToolCallNames))],
    structuredToolCallTurnCount: evidence.turns.filter((turn) => turn.rawStructuredToolCallCount > 0).length,
    acceptedFallbackEnvelopeTurnCount: evidence.turns.filter((turn) =>
      turn.acceptedToolCallCount > 0
      && turn.rawStructuredToolCallCount === 0
      && turn.acceptedToolCallSource !== OLLAMA_TOOL_INTENT_ADAPTER_SOURCE
    ).length,
    recoverableContractViolationTurnCount: evidence.turns.filter((turn) =>
      Boolean(turn.recoverableContractViolationReason)
    ).length,
    emptyResponseTurnCount: evidence.turns.filter((turn) => turn.emptyResponse).length,
    adapterAttemptCount: evidence.adapterAttempts.length,
    adapterAcceptedToolCallCount: evidence.adapterAttempts.reduce((sum, attempt) =>
      sum + attempt.acceptedToolCallCount, 0),
    contractReminderSent: reminderTurns.length > 0,
    recoveredAfterContractReminder: Boolean(firstAcceptedAfterReminder),
    firstAcceptedSource: firstAcceptedTurn?.acceptedToolCallSource ?? null
  };
}

function safeArtifactName(value: string) {
  return value.replace(/[^a-z0-9._-]+/giu, '_').replace(/^_+|_+$/gu, '') || 'model';
}

function resolveModelIds() {
  const rawValue =
    process.env.VICODE_OLLAMA_TOOL_MODE_MODELS
    ?? process.env.VICODE_G5_OLLAMA_MODEL
    ?? 'qwen3:4b,qwen2.5-coder:14b-instruct-q6_K,mistral:7b';

  return rawValue
    .split(/[,\n;]/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveToolIntentStrategies() {
  const requested = process.env.VICODE_OLLAMA_TOOL_MODE_STRATEGIES
    ?.split(/[,\n;]/u)
    .map((value) => value.trim())
    .filter(Boolean);
  const selected = requested?.length ? requested : DEFAULT_TOOL_INTENT_STRATEGIES;
  return selected.filter((value): value is ToolIntentStrategy =>
    TOOL_INTENT_STRATEGIES.includes(value as ToolIntentStrategy)
  );
}

function streamModesForStrategy(strategy: ToolIntentStrategy) {
  return strategy === 'structured_schema' || strategy === 'adapter_first'
    ? ['stream_false'] as StreamMode[]
    : STREAM_MODES;
}

async function runModeDiagnostic(input: {
  modelId: string;
  strategy: ToolIntentStrategy;
  streamMode: StreamMode;
  baseUrl: string;
  prompt: string;
  workspaceRoot: string;
}): Promise<ToolModeRunEvidence> {
  const evidence: ToolModeRunEvidence = {
    modelId: input.modelId,
    strategy: input.strategy,
    streamMode: input.streamMode,
    streamRequested: streamRequestedForMode(input.strategy, input.streamMode),
    baseUrl: input.baseUrl,
    prompt: input.prompt,
    requestSummaries: [],
    rawTurns: [],
    adapterAttempts: [],
    turns: [],
    callbacks: {
      completed: [],
      deltas: [],
      errors: [],
      infoMessages: []
    },
    executedToolCalls: [],
    harnessHooks: [],
    summary: emptySummary()
  };
  const transport = new ToolModeDiagnosticTransport(new OllamaChatTransport({
    apiKey: null,
    baseUrl: input.baseUrl,
    fetchWithRetry: createToolModeFetch(evidence),
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
    threadId: `tool-mode-diagnostic-${input.strategy}-${input.streamMode}`,
    runId: `tool-mode-diagnostic-${input.strategy}-${input.streamMode}`,
    prompt: input.prompt,
    sourcePrompt: input.prompt,
    modelId: input.modelId,
    reasoningEffort: null,
    thinkingEnabled: false,
    folderPath: input.workspaceRoot,
    runtimeWorkspaceRoot: input.workspaceRoot,
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
  summarizeRun(evidence);

  return evidence;
}

runDiagnostic('local Ollama tool-intent strategy diagnostic', () => {
  it('compares app-shaped tool-intent strategies through the same harness path', async () => {
    const modelIds = resolveModelIds();
    const strategies = resolveToolIntentStrategies();
    const baseUrl = process.env.VICODE_OLLAMA_BASE_URL?.trim() || 'http://127.0.0.1:11434';
    const prompt = [
      'Create a file named g5-stream-mode-local.txt in this project.',
      'The entire file contents must be exactly: G5_STREAM_MODE_DIAGNOSTIC_OK',
      'Use write_file for the file change. Do not create any other files.',
      'After writing the file, reply exactly: G5_STREAM_MODE_DIAGNOSTIC_OK'
    ].join('\n');
    const workspaceRoot = process.cwd();

    for (const modelId of modelIds) {
      const runs: ToolModeRunEvidence[] = [];
      for (const strategy of strategies) {
        for (const streamMode of streamModesForStrategy(strategy)) {
          runs.push(await runModeDiagnostic({
            modelId,
            strategy,
            streamMode,
            baseUrl,
            prompt,
            workspaceRoot
          }));
        }
      }

      const outputPath = path.join(
        process.cwd(),
        'test-results',
        `ollama-tool-intent-adapter-comparison-${safeArtifactName(modelId)}.json`
      );
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify({
        modelId,
        baseUrl,
        prompt,
        runs
      }, null, 2)}\n`, 'utf8');

      expect(runs).toHaveLength(strategies.reduce(
        (count, strategy) => count + streamModesForStrategy(strategy).length,
        0
      ));
      expect(runs.every((run) => run.rawTurns.length + run.adapterAttempts.length > 0)).toBe(true);
      expect(runs.every((run) =>
        run.requestSummaries.every((summary) => summary.stream === run.streamRequested)
      )).toBe(true);
      expect(runs
        .filter((run) => run.strategy === 'structured_schema')
        .every((run) =>
          run.requestSummaries.every((summary) => summary.format !== null && summary.toolNames.length === 0)
        )
      ).toBe(true);
      expect(runs
        .flatMap((run) => run.adapterAttempts)
        .every((attempt) =>
          attempt.requestSummary.stream === false
          && attempt.requestSummary.format !== null
          && attempt.requestSummary.toolNames.length === 0
        )
      ).toBe(true);
    }
  }, 900_000);
});
