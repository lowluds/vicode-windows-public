import type {
  NormalizedModelToolCall,
  ProviderModelToolDefinition,
  ProviderModelTransport,
  ProviderModelTurnMessage,
  ProviderModelTurnRequest,
  ProviderModelTurnResult
} from '../types';
import { normalizeProviderContextWindowUsage } from '../context-window-usage';

export interface OpenAICompatibleChatTransportOptions {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface CompatibleChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

type CompatibleChatMessage = Record<string, unknown>;
type CompatibleChatMessageContent =
  | string
  | Array<
    | {
        type: 'text';
        text: string;
      }
    | {
        type: 'image_url';
        image_url: {
          url: string;
        };
      }
  >;

const TOOL_RESULT_PREFIX_PATTERN = /^Tool result for ([^:\n]+):\n([\s\S]*)$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseToolArguments(value: unknown): Record<string, unknown> {
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

function normalizeFunctionArguments(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  if (isRecord(value)) {
    return JSON.stringify(value);
  }
  return '{}';
}

function normalizeEndpoint(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/u, '');
  return normalized.endsWith('/v1')
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`;
}

function normalizeToolDefinitions(tools: ProviderModelToolDefinition[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.function.name,
      ...(tool.function.description
        ? {
            description: tool.function.description
          }
        : {}),
      parameters: tool.function.parameters ?? {
        type: 'object',
        properties: {}
      }
    }
  }));
}

function redactSecret(value: string, secret: string) {
  const trimmedSecret = secret.trim();
  if (!trimmedSecret) {
    return value;
  }

  return value.split(trimmedSecret).join('[REDACTED]');
}

function extractProviderErrorMessage(rawText: string, apiKey: string) {
  if (!rawText.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawText);
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === 'string') {
      const message = parsed.error.message.trim();
      return message ? redactSecret(message, apiKey) : null;
    }
  } catch {
    return redactSecret(rawText.trim(), apiKey);
  }

  return redactSecret(rawText.trim(), apiKey);
}

function collectMessageContent(message: Record<string, unknown>) {
  const content = message.content;
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .flatMap((item) =>
      isRecord(item) && typeof item.text === 'string' && item.text.trim()
        ? [item.text]
        : []
    )
    .join('\n')
    .trim();
}

function collectChoiceMessage(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return null;
  }

  const [choice] = payload.choices;
  return isRecord(choice) && isRecord(choice.message) ? choice.message : null;
}

function collectCompatibleToolCalls(message: Record<string, unknown>): CompatibleChatToolCall[] {
  if (!Array.isArray(message.tool_calls)) {
    return [];
  }

  return message.tool_calls
    .map((item) => {
      if (
        !isRecord(item)
        || typeof item.id !== 'string'
        || !item.id.trim()
        || item.type !== 'function'
        || !isRecord(item.function)
        || typeof item.function.name !== 'string'
        || !item.function.name.trim()
      ) {
        return null;
      }

      return {
        id: item.id.trim(),
        type: 'function' as const,
        function: {
          name: item.function.name.trim(),
          arguments: normalizeFunctionArguments(item.function.arguments)
        }
      } satisfies CompatibleChatToolCall;
    })
    .filter((item): item is CompatibleChatToolCall => Boolean(item));
}

function normalizeToolCalls(toolCalls: CompatibleChatToolCall[]): NormalizedModelToolCall[] {
  return toolCalls.map((toolCall) => ({
    name: toolCall.function.name,
    arguments: parseToolArguments(toolCall.function.arguments)
  }));
}

export class OpenAICompatibleChatTransport implements ProviderModelTransport {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pendingToolCalls: CompatibleChatToolCall[] = [];

  constructor(private readonly options: OpenAICompatibleChatTransportOptions) {
    this.endpoint = normalizeEndpoint(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async sendTurn(request: ProviderModelTurnRequest): Promise<ProviderModelTurnResult> {
    const body: Record<string, unknown> = {
      model: request.modelId,
      messages: this.buildMessages(request),
      stream: false
    };
    if (request.tools.length > 0) {
      body.tools = normalizeToolDefinitions(request.tools);
      body.tool_choice = 'auto';
    }

    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: request.signal,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const rawText = await response.text().catch(() => '');
      return {
        text: '',
        toolCalls: [],
        terminalState: 'error',
        errorMessage: extractProviderErrorMessage(rawText, this.options.apiKey) ?? `OpenAI-compatible chat endpoint returned HTTP ${response.status}.`
      };
    }

    const rawText = await response.text().catch(() => '');
    if (!rawText.trim()) {
      return {
        text: '',
        toolCalls: [],
        terminalState: 'error',
        errorMessage: 'OpenAI-compatible chat endpoint returned an empty payload.'
      };
    }

    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(rawText) as unknown;
    } catch {
      return {
        text: '',
        toolCalls: [],
        terminalState: 'error',
        errorMessage: 'OpenAI-compatible chat endpoint returned malformed JSON.'
      };
    }

    const message = collectChoiceMessage(rawPayload);
    if (!message) {
      return {
        text: '',
        toolCalls: [],
        terminalState: 'error',
        errorMessage: 'OpenAI-compatible chat endpoint returned a payload without a message choice.',
        rawPayload
      };
    }

    const compatibleToolCalls = collectCompatibleToolCalls(message);
    this.pendingToolCalls.push(...compatibleToolCalls);

    return {
      text: collectMessageContent(message),
      toolCalls: normalizeToolCalls(compatibleToolCalls),
      contextWindowUsage: normalizeProviderContextWindowUsage(rawPayload, 'openai_compatible_chat_context_window_usage'),
      terminalState: 'completed',
      rawPayload
    };
  }

  private buildMessages(request: ProviderModelTurnRequest) {
    const messages: CompatibleChatMessage[] = [
      {
        role: 'system',
        content: request.systemInstructions
      }
    ];
    const pendingToolCallsForTurn = this.pendingToolCalls.map((toolCall) => ({
      ...toolCall,
      function: {
        ...toolCall.function
      }
    }));
    let insertedPendingToolCalls = false;
    let insertedImageAttachments = false;

    const insertPendingToolCalls = () => {
      if (insertedPendingToolCalls || pendingToolCallsForTurn.length === 0) {
        return;
      }
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: pendingToolCallsForTurn
      });
      insertedPendingToolCalls = true;
    };

    for (const message of request.input) {
      const toolResult = this.normalizeToolResultMessage(message);
      if (toolResult) {
        const pending = this.consumePendingToolCall(toolResult.toolName);
        if (pending) {
          insertPendingToolCalls();
          messages.push({
            role: 'tool',
            tool_call_id: pending.id,
            content: toolResult.content
          });
          continue;
        }
      }

      const imageAttachments = !insertedImageAttachments && message.role === 'user'
        ? request.attachments?.imageAttachments ?? []
        : [];
      messages.push(this.toCompatibleMessage(message, imageAttachments));
      if (imageAttachments.length > 0) {
        insertedImageAttachments = true;
      }
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
      ? this.pendingToolCalls.findIndex((call) => call.function.name === toolName)
      : 0;
    const index = pendingIndex >= 0 ? pendingIndex : 0;
    const [pending] = this.pendingToolCalls.splice(index, 1);
    return pending ?? null;
  }

  private toCompatibleMessage(
    message: ProviderModelTurnMessage,
    imageAttachments: NonNullable<ProviderModelTurnRequest['attachments']>['imageAttachments'] = []
  ): CompatibleChatMessage {
    const role = message.role === 'system'
      ? 'system'
      : message.role === 'assistant'
        ? 'assistant'
        : 'user';
    return {
      role,
      content: this.toCompatibleMessageContent(message.content, role, imageAttachments ?? [])
    };
  }

  private toCompatibleMessageContent(
    content: string,
    role: 'system' | 'assistant' | 'user',
    imageAttachments: NonNullable<ProviderModelTurnRequest['attachments']>['imageAttachments']
  ): CompatibleChatMessageContent {
    if (role !== 'user' || !imageAttachments || imageAttachments.length === 0) {
      return content;
    }

    return [
      {
        type: 'text',
        text: content
      },
      ...imageAttachments.map((attachment) => ({
        type: 'image_url' as const,
        image_url: {
          url: attachment.dataUrl
        }
      }))
    ];
  }
}
