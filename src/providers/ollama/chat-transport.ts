import type {
  NormalizedModelToolCall,
  ProviderModelTransport,
  ProviderModelTurnMessage,
  ProviderModelTurnRequest,
  ProviderModelTurnResult,
  ProviderInfoPayload
} from '../types';
import { resolveOllamaSamplingOptions } from '../model-sampling-profile';
import {
  buildOllamaChatImages,
  type OllamaChatMessagePayload,
  type OllamaToolCallPayload
} from './transport-payloads';
import {
  appendOllamaVisibleText,
  buildOllamaProviderDiagnostics,
  classifyOllamaToolCallContent,
  extractToolCalls,
  isRecord
} from './tool-loop-model';
import { TOOL_LOOP_RESPONSE_TIMEOUT_MS } from './tool-loop-guardrails';
import { normalizeProviderContextWindowUsage } from '../context-window-usage';

export type OllamaChatFetchWithRetry = (
  baseUrl: string,
  path: string,
  options: RequestInit,
  apiKey: string | null,
  timeoutMs: number
) => Promise<Response>;

export interface OllamaChatTransportOptions {
  apiKey: string | null;
  baseUrl: string;
  fetchWithRetry: OllamaChatFetchWithRetry;
  timeoutMs?: number;
}

interface PendingOllamaChatToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

const TOOL_RESULT_PREFIX_PATTERN = /^Tool result for ([^:\n]+):\n([\s\S]*)$/u;
const OLLAMA_THINKING_ACTIVITY_TYPE = 'ollama_chat_message_thinking';
const MAX_THINKING_SUMMARY_CHARS = 900;

function compactOllamaThinkingSummary(value: string) {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= MAX_THINKING_SUMMARY_CHARS) {
    return normalized;
  }

  const clipped = normalized.slice(0, MAX_THINKING_SUMMARY_CHARS).trimEnd();
  const sentenceMatch = clipped.match(/^([\s\S]{160,}[.!?])(?:\s|$)/u);
  return `${sentenceMatch?.[1] ?? clipped}...`;
}

function cloneOllamaToolCall(toolCall: PendingOllamaChatToolCall): OllamaToolCallPayload {
  return {
    ...(toolCall.id
      ? {
          id: toolCall.id
        }
      : {}),
    function: {
      name: toolCall.name,
      arguments: {
        ...toolCall.arguments
      }
    }
  };
}

function toOllamaChatMessage(
  message: ProviderModelTurnMessage,
  request: ProviderModelTurnRequest,
  includeImages: boolean
): OllamaChatMessagePayload {
  const role = message.role === 'system'
    ? 'system'
    : message.role === 'assistant'
      ? 'assistant'
      : message.role === 'tool'
        ? 'tool'
        : 'user';

  return {
    role,
    content: message.content,
    ...(role === 'tool' && message.toolName
      ? {
          tool_name: message.toolName
        }
      : {}),
    ...(includeImages && role === 'user' && request.attachments?.imageAttachments?.length
      ? {
          images: buildOllamaChatImages(request.attachments.imageAttachments)
        }
      : {})
  };
}

function normalizeToolCalls(toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>): NormalizedModelToolCall[] {
  return toolCalls.map((toolCall) => ({
    name: toolCall.name,
    arguments: toolCall.arguments
  }));
}

export class OllamaChatTransport implements ProviderModelTransport {
  private readonly timeoutMs: number;
  private readonly pendingToolCalls: PendingOllamaChatToolCall[] = [];

  constructor(private readonly options: OllamaChatTransportOptions) {
    this.timeoutMs = options.timeoutMs ?? TOOL_LOOP_RESPONSE_TIMEOUT_MS;
  }

  async sendTurn(request: ProviderModelTurnRequest): Promise<ProviderModelTurnResult> {
    const messages: OllamaChatMessagePayload[] = [
      {
        role: 'system',
        content: request.systemInstructions
      },
      ...this.buildMessages(request)
    ];

    const samplingOptions = resolveOllamaSamplingOptions(request.samplingProfile);
    const response = await this.options.fetchWithRetry(
      this.options.baseUrl,
      '/api/chat',
      {
        method: 'POST',
        signal: request.signal,
        body: JSON.stringify({
          model: request.modelId,
          stream: true,
          messages,
          tools: request.tools,
          ...(typeof request.thinkingEnabled === 'boolean'
            ? { think: request.thinkingEnabled }
            : {}),
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

    if (!response.body) {
      return {
        text: '',
        toolCalls: [],
        terminalState: 'error',
        errorMessage: 'Ollama returned an empty chat response.'
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let rawText = '';
    let thinkingText = '';
    let contextWindowUsage: ProviderModelTurnResult['contextWindowUsage'] = null;
    let toolCallContractViolation: ProviderModelTurnResult['toolCallContractViolation'] = null;
    const toolCalls: NormalizedModelToolCall[] = [];
    const toolCallExtractionOptions = {
      toolDefinitions: request.tools
    };

    const processEvent = (raw: string) => {
      if (!raw.trim()) {
        return null;
      }

      try {
        const event = JSON.parse(raw.trim()) as Record<string, unknown>;
        if (typeof event.error === 'string' && event.error.trim()) {
          return event.error.trim();
        }

        const usage = normalizeProviderContextWindowUsage(event, 'ollama_chat_context_window_usage');
        if (usage) {
          contextWindowUsage = usage;
        }

        if (isRecord(event.message)) {
          if (typeof event.message.thinking === 'string') {
            thinkingText = appendOllamaVisibleText(thinkingText, event.message.thinking).text;
          }
          if (typeof event.message.content === 'string') {
            rawText += event.message.content;
            text = appendOllamaVisibleText(text, event.message.content).text;
          }
          toolCalls.push(...normalizeToolCalls(extractToolCalls(event.message, toolCallExtractionOptions)));
        }
      } catch {
        // Ignore provider diagnostics that are not valid chat JSON. The legacy
        // runner surfaced these as info; thin transports only return turn data.
      }

      return null;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const errorMessage = processEvent(line);
        if (errorMessage) {
          return {
            text: '',
            toolCalls: [],
            terminalState: 'error',
            errorMessage
          };
        }
      }
    }

    if (buffer.trim()) {
      const errorMessage = processEvent(buffer);
      if (errorMessage) {
        return {
          text: '',
          toolCalls: [],
          terminalState: 'error',
          errorMessage
        };
      }
    }

    if (toolCalls.length === 0 && rawText.trim()) {
      const contentDecision = classifyOllamaToolCallContent({ content: rawText }, toolCallExtractionOptions);
      if (contentDecision.status === 'accepted') {
        toolCalls.push(...normalizeToolCalls(contentDecision.toolCalls));
      } else if (contentDecision.status === 'recoverable_contract_violation') {
        toolCallContractViolation = {
          providerId: 'ollama',
          reason: contentDecision.reason,
          candidateToolName: contentDecision.candidateToolName,
          recoverable: true
        };
      }
    }

    const thinkingSummary = compactOllamaThinkingSummary(thinkingText);
    const infoMessages: ProviderInfoPayload[] = thinkingSummary
      ? [
          {
            message: thinkingSummary,
            activity: {
              kind: 'thinking',
              summary: thinkingSummary,
              text: thinkingSummary,
              providerEventType: OLLAMA_THINKING_ACTIVITY_TYPE
            }
          }
        ]
      : [];

    const result = {
      text,
      toolCalls,
      toolCallContractViolation,
      contextWindowUsage,
      providerDiagnostics: buildOllamaProviderDiagnostics(toolCalls),
      ...(infoMessages.length > 0 ? { infoMessages } : {}),
      terminalState: 'completed'
    } satisfies ProviderModelTurnResult;
    this.pendingToolCalls.push(
      ...toolCalls.map((toolCall, index) => ({
        id: `call-${this.pendingToolCalls.length + index + 1}`,
        name: toolCall.name,
        arguments: {
          ...toolCall.arguments
        }
      }))
    );
    return result;
  }

  private buildMessages(request: ProviderModelTurnRequest) {
    const messages: OllamaChatMessagePayload[] = [];
    let includedImages = false;
    let insertedPendingToolCalls = false;

    const insertPendingToolCalls = () => {
      if (insertedPendingToolCalls || this.pendingToolCalls.length === 0) {
        return;
      }
      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: this.pendingToolCalls.map((toolCall) => cloneOllamaToolCall(toolCall))
      });
      insertedPendingToolCalls = true;
    };

    for (const message of request.input) {
      const toolResult = this.normalizeToolResultMessage(message);
      if (toolResult) {
        insertPendingToolCalls();
        const pending = this.consumePendingToolCall(toolResult.toolName);
        if (pending) {
          messages.push({
            role: 'tool',
            tool_name: pending.name,
            content: toolResult.content
          });
          continue;
        }
      }

      const includeImages =
        !includedImages
        && message.role === 'user'
        && Boolean(request.attachments?.imageAttachments?.length);
      if (includeImages) {
        includedImages = true;
      }
      messages.push(toOllamaChatMessage(message, request, includeImages));
    }

    return messages;
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

  private consumePendingToolCall(toolName: string | null) {
    const pendingIndex = toolName
      ? this.pendingToolCalls.findIndex((call) => call.name === toolName)
      : 0;
    const index = pendingIndex >= 0 ? pendingIndex : 0;
    const [pending] = this.pendingToolCalls.splice(index, 1);
    return pending ?? null;
  }
}
