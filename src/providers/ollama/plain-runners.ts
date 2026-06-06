import { killProcessTree } from '../util';
import type { ProviderRunCallbacks, ProviderRunContext, ProviderRunHandle } from '../types';
import { readOllamaPlainChatResponse } from './plain-chat-response';
import {
  buildOllamaPlainChatRequestBody,
  buildOllamaPlainResponsesRequestBody
} from './transport-payloads';
import {
  buildPlainChatSystemPrompt,
  buildPlannerModePrompt,
  buildPlannerSystemPrompt,
  extractResponsesText,
  extractResponsesToolCalls
} from './tool-loop-model';
import {
  CHAT_REQUEST_TIMEOUT_MS,
  shouldFallbackFromResponsesTransport
} from './transport';

export {
  CHAT_REQUEST_TIMEOUT_MS,
  shouldFallbackFromResponsesTransport
} from './transport';

export type OllamaFetchWithRetry = (
  baseUrl: string,
  path: string,
  options: RequestInit,
  apiKey: string | null,
  timeoutMs: number
) => Promise<Response>;

export type OllamaFinalizeAssistantOutput = (
  context: ProviderRunContext,
  output: string
) => Promise<string>;

function formatOllamaResponseTimeoutError(timeoutMs: number) {
  const timeoutMinutes = timeoutMs >= 60_000 ? Math.round(timeoutMs / 60_000) : null;
  const durationLabel = timeoutMinutes && timeoutMinutes > 1
    ? `${timeoutMinutes} minutes`
    : timeoutMs >= 60_000
      ? '1 minute'
      : `${Math.round(timeoutMs / 1000)} seconds`;
  return `The local Ollama runtime did not produce the next response within ${durationLabel}.`;
}

export function formatOllamaTransportError(error: unknown, isCloud: boolean, timeoutMs?: number) {
  if (error instanceof Error) {
    const normalized = error.message.trim().toLowerCase();
    if (normalized === 'fetch failed' || normalized === 'failed to fetch' || normalized.includes('fetch failed')) {
      return 'Failed to reach the local Ollama runtime. Start Ollama or check that it is reachable, then retry.';
    }

    if (normalized === 'terminated' || normalized.includes('terminated')) {
      return 'The local Ollama runtime terminated the response stream before a final answer was returned.';
    }

    if (
      normalized === 'this operation was aborted'
      || normalized === 'the operation was aborted'
      || normalized.includes('aborterror')
      || normalized.includes('aborted')
    ) {
      return formatOllamaResponseTimeoutError(timeoutMs ?? CHAT_REQUEST_TIMEOUT_MS);
    }

    if (error.message.trim()) {
      return error.message;
    }
  }

  return 'Failed to reach the local Ollama runtime.';
}

function formatPlainChatToolCallLeakError() {
  return 'Ollama emitted workspace tool-call markup instead of a final assistant reply. Retry the run after restarting Vicode.';
}

function buildPlainRunPrompts(context: ProviderRunContext) {
  return {
    systemPrompt: context.runMode === 'plan' ? buildPlannerSystemPrompt() : buildPlainChatSystemPrompt(),
    userPrompt: context.runMode === 'plan' ? buildPlannerModePrompt(context.prompt) : context.prompt
  };
}

export async function startOllamaPlainChatRun(input: {
  context: ProviderRunContext;
  callbacks: ProviderRunCallbacks;
  runtimeBaseUrl: string;
  fetchWithRetry: OllamaFetchWithRetry;
  finalizeAssistantOutput: OllamaFinalizeAssistantOutput;
}): Promise<ProviderRunHandle> {
  const { context, callbacks, fetchWithRetry, finalizeAssistantOutput } = input;
  const controller = new AbortController();
  let cancelled = false;
  let settled = false;
  const baseUrl = input.runtimeBaseUrl;
  const { systemPrompt, userPrompt } = buildPlainRunPrompts(context);

  const settleComplete = (output: string) => {
    if (settled) {
      return;
    }
    settled = true;
    callbacks.onComplete(output);
  };

  const settleError = (message: string) => {
    if (settled) {
      return;
    }
    settled = true;
    callbacks.onError(message);
  };

  const settleAbort = (message?: string) => {
    if (settled) {
      return;
    }
    settled = true;
    callbacks.onAbort(message);
  };

  void (async () => {
    try {
      const response = await fetchWithRetry(
        baseUrl,
        '/api/chat',
        {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify(buildOllamaPlainChatRequestBody({
            modelId: context.modelId,
            systemPrompt,
            userPrompt,
            imageAttachments: context.imageAttachments
          }))
        },
        null,
        CHAT_REQUEST_TIMEOUT_MS
      );

      if (!response.ok) {
        const message = await response.text().catch(() => '');
        settleError(message.trim() || `Ollama returned HTTP ${response.status}.`);
        return;
      }

      const result = await readOllamaPlainChatResponse(response, {
        onDelta: (delta) => callbacks.onDelta(delta),
        onInfo: (message) => callbacks.onInfo(message)
      });
      if (result.status === 'error') {
        settleError(result.message);
        return;
      }

      settleComplete(await finalizeAssistantOutput(context, result.content));
    } catch (error) {
      if (cancelled || controller.signal.aborted) {
        settleAbort('Ollama run was stopped.');
        return;
      }
      settleError(formatOllamaTransportError(error, false, CHAT_REQUEST_TIMEOUT_MS));
    }
  })();

  return {
    runId: context.runId,
    cancel: async (reason) => {
      cancelled = true;
      controller.abort();
      await killProcessTree(undefined);
      settleAbort(reason ?? 'Ollama run was stopped.');
    }
  };
}

export async function startOllamaPlainResponsesRun(input: {
  context: ProviderRunContext;
  callbacks: ProviderRunCallbacks;
  runtimeBaseUrl: string;
  fetchWithRetry: OllamaFetchWithRetry;
  finalizeAssistantOutput: OllamaFinalizeAssistantOutput;
  fallbackToPlainChat: (
    context: ProviderRunContext,
    callbacks: ProviderRunCallbacks
  ) => Promise<ProviderRunHandle>;
}): Promise<ProviderRunHandle> {
  const {
    context,
    callbacks,
    fetchWithRetry,
    finalizeAssistantOutput,
    fallbackToPlainChat
  } = input;
  const controller = new AbortController();
  let cancelled = false;
  let settled = false;
  let fallbackHandle: ProviderRunHandle | null = null;
  const baseUrl = input.runtimeBaseUrl;
  const { systemPrompt, userPrompt } = buildPlainRunPrompts(context);

  const settleComplete = (output: string) => {
    if (settled) {
      return;
    }
    settled = true;
    callbacks.onComplete(output);
  };

  const settleError = (message: string) => {
    if (settled) {
      return;
    }
    settled = true;
    callbacks.onError(message);
  };

  const settleAbort = (message?: string) => {
    if (settled) {
      return;
    }
    settled = true;
    callbacks.onAbort(message);
  };

  void (async () => {
    try {
      const response = await fetchWithRetry(
        baseUrl,
        '/v1/responses',
        {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify(buildOllamaPlainResponsesRequestBody({
            modelId: context.modelId,
            instructions: systemPrompt,
            userPrompt,
            imageAttachments: context.imageAttachments
          }))
        },
        null,
        CHAT_REQUEST_TIMEOUT_MS
      );

      if (!response.ok) {
        const message = await response.text().catch(() => '');
        if (!controller.signal.aborted && shouldFallbackFromResponsesTransport(message)) {
          callbacks.onInfo('Ollama /v1/responses was unavailable for this run. Falling back to the classic local chat transport.');
          fallbackHandle = await fallbackToPlainChat(
            {
              ...context,
              ollamaTransportMode: 'chat'
            },
            callbacks
          );
          return;
        }
        settleError(message.trim() || `Ollama returned HTTP ${response.status}.`);
        return;
      }

      const payload = await response.json().catch(() => null);
      if (extractResponsesToolCalls(payload).length > 0) {
        settleError(formatPlainChatToolCallLeakError());
        return;
      }

      const finalContent = extractResponsesText(payload);
      if (!finalContent) {
        settleError('Ollama completed without producing assistant output.');
        return;
      }

      const finalOutput = await finalizeAssistantOutput(context, finalContent);
      callbacks.onDelta(finalOutput);
      settleComplete(finalOutput);
    } catch (error) {
      if (cancelled || controller.signal.aborted) {
        settleAbort('Ollama run was stopped.');
        return;
      }
      settleError(formatOllamaTransportError(error, false, CHAT_REQUEST_TIMEOUT_MS));
    }
  })();

  return {
    runId: context.runId,
    cancel: async (reason) => {
      if (fallbackHandle) {
        await fallbackHandle.cancel(reason);
        return;
      }
      cancelled = true;
      controller.abort();
      await killProcessTree(undefined);
      settleAbort(reason ?? 'Ollama run was stopped.');
    }
  };
}
