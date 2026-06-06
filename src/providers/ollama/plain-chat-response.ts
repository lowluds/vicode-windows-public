import {
  appendOllamaVisibleText,
  containsXmlFunctionCallMarkup,
  extractToolCalls,
  isRecord
} from './tool-loop-model';

const EMPTY_ASSISTANT_OUTPUT_ERROR = 'Ollama completed without producing assistant output.';
const PLAIN_CHAT_TOOL_CALL_LEAK_ERROR =
  'Ollama emitted workspace tool-call markup instead of a final assistant reply. Retry the run after restarting Vicode.';

export type OllamaPlainChatResponseResult =
  | {
      status: 'complete';
      content: string;
    }
  | {
      status: 'error';
      message: string;
    };

interface OllamaPlainChatResponseHandlers {
  onDelta(delta: string): void;
  onInfo(message: string): void;
}

function readEvent(event: Record<string, unknown>, assistantText: string) {
  if (typeof event.error === 'string' && event.error.trim()) {
    return {
      result: {
        status: 'error' as const,
        message: event.error.trim()
      },
      assistantText
    };
  }

  const messageRecord = isRecord(event.message) ? event.message : null;
  const rawMessage = messageRecord && typeof messageRecord.content === 'string' ? messageRecord.content : '';
  if (
    messageRecord
    && (
      extractToolCalls(messageRecord).length > 0
      || containsXmlFunctionCallMarkup(rawMessage)
    )
  ) {
    return {
      result: {
        status: 'error' as const,
        message: PLAIN_CHAT_TOOL_CALL_LEAK_ERROR
      },
      assistantText
    };
  }

  if (!rawMessage) {
    return {
      result: null,
      assistantText,
      delta: ''
    };
  }

  const next = appendOllamaVisibleText(assistantText, rawMessage);
  return {
    result: null,
    assistantText: next.text,
    delta: next.delta
  };
}

function readJsonLine(line: string, assistantText: string, handlers: OllamaPlainChatResponseHandlers) {
  try {
    return readEvent(JSON.parse(line) as Record<string, unknown>, assistantText);
  } catch {
    handlers.onInfo(line);
    return {
      result: null,
      assistantText,
      delta: ''
    };
  }
}

export async function readOllamaPlainChatResponse(
  response: Response,
  handlers: OllamaPlainChatResponseHandlers
): Promise<OllamaPlainChatResponseResult> {
  let assistantText = '';

  if (!response.body) {
    const payload = await response.json().catch(() => null);
    const parsed = isRecord(payload) ? readEvent(payload, assistantText) : null;
    if (parsed?.result) {
      return parsed.result;
    }
    assistantText = parsed?.assistantText ?? '';
    if (parsed?.delta) {
      handlers.onDelta(parsed.delta);
    }
    const finalContent = assistantText.trim();
    return finalContent
      ? {
          status: 'complete',
          content: finalContent
        }
      : {
          status: 'error',
          message: EMPTY_ASSISTANT_OUTPUT_ERROR
        };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const parsed = readJsonLine(trimmed, assistantText, handlers);
      if (parsed.result) {
        return parsed.result;
      }
      assistantText = parsed.assistantText;
      if (parsed.delta) {
        handlers.onDelta(parsed.delta);
      }
    }
  }

  if (buffer.trim()) {
    const parsed = readJsonLine(buffer.trim(), assistantText, handlers);
    if (parsed.result) {
      return parsed.result;
    }
    assistantText = parsed.assistantText;
    if (parsed.delta) {
      handlers.onDelta(parsed.delta);
    }
  }

  const finalAssistantText = assistantText.trim();
  return finalAssistantText
    ? {
        status: 'complete',
        content: finalAssistantText
      }
    : {
        status: 'error',
        message: EMPTY_ASSISTANT_OUTPUT_ERROR
      };
}
