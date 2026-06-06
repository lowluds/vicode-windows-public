import type {
  NormalizedModelToolCall,
  ProviderModelToolDefinition,
  ProviderModelTransport,
  ProviderModelTurnMessage,
  ProviderModelTurnRequest,
  ProviderModelTurnResult
} from '../types';
import { resolveOllamaSamplingOptions } from '../model-sampling-profile';
import {
  buildOllamaResponsesInput,
  type OllamaResponsesInputMessage
} from './transport-payloads';
import {
  buildOllamaProviderDiagnostics,
  extractResponsesText,
  extractResponsesToolCalls
} from './tool-loop-model';
import { TOOL_LOOP_RESPONSE_TIMEOUT_MS } from './tool-loop-guardrails';
import { normalizeProviderContextWindowUsage } from '../context-window-usage';

export type OllamaResponsesFetchWithRetry = (
  baseUrl: string,
  path: string,
  options: RequestInit,
  apiKey: string | null,
  timeoutMs: number
) => Promise<Response>;

export interface OllamaResponsesTransportOptions {
  apiKey: string | null;
  baseUrl: string;
  fetchWithRetry: OllamaResponsesFetchWithRetry;
  timeoutMs?: number;
}

interface OllamaResponseFunctionCallItem {
  id?: string;
  type: 'function_call';
  name: string;
  arguments: string;
  call_id: string;
  status?: string;
}

type OllamaResponsesInputItem =
  | OllamaResponsesInputMessage
  | OllamaResponseFunctionCallItem
  | {
      type: 'function_call_output';
      call_id: string;
      output: string;
    }
  | Record<string, unknown>;

const TOOL_RESULT_PREFIX_PATTERN = /^Tool result for ([^:\n]+):\n([\s\S]*)$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFunctionCallArguments(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  if (isRecord(value)) {
    return JSON.stringify(value);
  }
  return '{}';
}

function normalizeToolDefinitions(tools: ProviderModelToolDefinition[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    name: tool.function.name,
    ...(tool.function.description
      ? {
          description: tool.function.description
        }
      : {}),
    parameters: tool.function.parameters ?? {
      type: 'object',
      properties: {}
    },
    strict: false
  }));
}

function parseFunctionCallArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function collectFunctionCallItems(payload: unknown): OllamaResponseFunctionCallItem[] {
  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    return [];
  }

  return payload.output
    .map((item) => {
      if (
        !isRecord(item)
        || item.type !== 'function_call'
        || typeof item.name !== 'string'
        || !item.name.trim()
        || typeof item.call_id !== 'string'
        || !item.call_id.trim()
      ) {
        return null;
      }

      return {
        ...item,
        type: 'function_call' as const,
        name: item.name.trim(),
        arguments: normalizeFunctionCallArguments(item.arguments),
        call_id: item.call_id.trim()
      } satisfies OllamaResponseFunctionCallItem;
    })
    .filter((item): item is OllamaResponseFunctionCallItem => Boolean(item));
}

function collectPreservableOutputItems(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    return [];
  }

  return payload.output
    .filter((item): item is Record<string, unknown> =>
      isRecord(item)
      && item.type !== 'message'
      && typeof item.type === 'string'
    )
    .map((item) => ({
      ...item,
      ...(item.type === 'function_call'
        ? {
            arguments: normalizeFunctionCallArguments(item.arguments)
          }
        : {})
    }));
}

function toOllamaResponsesInputMessage(
  message: ProviderModelTurnMessage,
  request: ProviderModelTurnRequest,
  index: number
): OllamaResponsesInputMessage {
  const role = message.role === 'assistant' ? 'assistant' : 'user';
  return {
    role,
    content: index === 0 && role === 'user'
      ? buildOllamaResponsesInput(message.content, request.attachments?.imageAttachments)
      : message.content
  };
}

function normalizeToolCalls(toolCalls: Array<{ name: string; arguments: unknown }>): NormalizedModelToolCall[] {
  return toolCalls.map((toolCall) => ({
    name: toolCall.name,
    arguments: parseFunctionCallArguments(toolCall.arguments)
  }));
}

export class OllamaResponsesTransport implements ProviderModelTransport {
  private readonly timeoutMs: number;
  private readonly preservedOutputItems: Record<string, unknown>[] = [];
  private readonly pendingFunctionCalls: Array<{ callId: string; name: string }> = [];
  private readonly toolResultCallIds: string[] = [];

  constructor(private readonly options: OllamaResponsesTransportOptions) {
    this.timeoutMs = options.timeoutMs ?? TOOL_LOOP_RESPONSE_TIMEOUT_MS;
  }

  async sendTurn(request: ProviderModelTurnRequest): Promise<ProviderModelTurnResult> {
    const samplingOptions = resolveOllamaSamplingOptions(request.samplingProfile);
    const response = await this.options.fetchWithRetry(
      this.options.baseUrl,
      '/v1/responses',
      {
        method: 'POST',
        signal: request.signal,
        body: JSON.stringify({
          model: request.modelId,
          instructions: request.systemInstructions,
          input: this.buildInputItems(request),
          tools: normalizeToolDefinitions(request.tools),
          stream: false,
          ...(samplingOptions ? { options: samplingOptions } : {})
        })
      },
      this.options.apiKey,
      this.timeoutMs
    );

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      return {
        text: '',
        toolCalls: [],
        terminalState: 'error',
        errorMessage: message.trim() || `Ollama returned HTTP ${response.status}.`
      };
    }

    const rawPayload = await response.json().catch(() => null);
    const functionCalls = collectFunctionCallItems(rawPayload);
    const toolCalls = normalizeToolCalls(functionCalls.length > 0
      ? functionCalls
      : extractResponsesToolCalls(rawPayload));
    this.preserveOutputItems(rawPayload, functionCalls);

    return {
      text: extractResponsesText(rawPayload),
      toolCalls,
      contextWindowUsage: normalizeProviderContextWindowUsage(rawPayload, 'ollama_responses_context_window_usage'),
      providerDiagnostics: buildOllamaProviderDiagnostics(toolCalls),
      terminalState: 'completed',
      rawPayload
    };
  }

  private buildInputItems(request: ProviderModelTurnRequest) {
    const inputItems: OllamaResponsesInputItem[] = [];
    let insertedPreservedOutputItems = false;
    let toolResultIndex = 0;

    request.input.forEach((message, index) => {
      const toolResult = this.normalizeToolResultMessage(message);
      if (!toolResult) {
        inputItems.push(toOllamaResponsesInputMessage(message, request, index));
        return;
      }

      if (!insertedPreservedOutputItems) {
        inputItems.push(...this.preservedOutputItems);
        insertedPreservedOutputItems = true;
      }

      const callId = this.resolveToolResultCallId(toolResultIndex, toolResult.toolName);
      toolResultIndex += 1;

      if (!callId) {
        inputItems.push({
          role: 'user',
          content: `Tool result from ${toolResult.toolName ?? 'unknown_tool'}:\n${toolResult.content}`
        });
        return;
      }

      inputItems.push({
        type: 'function_call_output',
        call_id: callId,
        output: toolResult.content
      });
    });

    return inputItems;
  }

  private normalizeToolResultMessage(message: ProviderModelTurnMessage) {
    if (message.role === 'tool') {
      return {
        toolName: message.toolName ?? null,
        content: message.content
      };
    }

    if (message.role !== 'user') {
      return null;
    }

    const match = TOOL_RESULT_PREFIX_PATTERN.exec(message.content);
    if (!match) {
      return null;
    }

    return {
      toolName: match[1]?.trim() || null,
      content: match[2] ?? ''
    };
  }

  private resolveToolResultCallId(toolResultIndex: number, toolName: string | null) {
    const existing = this.toolResultCallIds[toolResultIndex];
    if (existing) {
      return existing;
    }

    const pendingIndex = toolName
      ? this.pendingFunctionCalls.findIndex((call) => call.name === toolName)
      : 0;
    const index = pendingIndex >= 0 ? pendingIndex : 0;
    const [pending] = this.pendingFunctionCalls.splice(index, 1);
    if (!pending) {
      return null;
    }

    this.toolResultCallIds[toolResultIndex] = pending.callId;
    return pending.callId;
  }

  private preserveOutputItems(rawPayload: unknown, functionCalls: OllamaResponseFunctionCallItem[]) {
    this.preservedOutputItems.push(...collectPreservableOutputItems(rawPayload));
    this.pendingFunctionCalls.push(
      ...functionCalls.map((call) => ({
        callId: call.call_id,
        name: call.name
      }))
    );
  }
}
