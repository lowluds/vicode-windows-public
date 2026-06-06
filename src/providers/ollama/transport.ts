import type { OllamaRuntime, OllamaTagResponse } from './runtime';

export const CHAT_REQUEST_TIMEOUT_MS = 1000 * 60 * 30;

const OLLAMA_SERVER_ERROR_RETRY_LIMIT = 2;
const OLLAMA_SERVER_ERROR_RETRY_DELAY_MS = 350;

export function shouldFallbackFromResponsesTransport(message: string) {
  const normalized = message.trim().toLowerCase();
  return normalized === 'history is not defined'
    || normalized.includes('history is not defined');
}

export async function fetchOllama(input: {
  runtime: OllamaRuntime;
  fetchImpl: typeof globalThis.fetch;
  baseUrl: string;
  path: string;
  options: RequestInit;
  apiKey: string | null;
  timeoutMs: number;
}) {
  const {
    runtime,
    fetchImpl,
    baseUrl,
    path,
    options,
    apiKey,
    timeoutMs
  } = input;

  if (!apiKey && baseUrl === runtime.baseUrl) {
    return runtime.fetch(path, options, timeoutMs);
  }

  const controller = new AbortController();
  const abortFromInput = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const inputSignal = options.signal;

  if (inputSignal) {
    if (inputSignal.aborted) {
      controller.abort();
    } else {
      inputSignal.addEventListener('abort', abortFromInput, { once: true });
    }
  }

  try {
    return await fetchImpl(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(options.headers ?? {})
      }
    });
  } finally {
    clearTimeout(timer);
    if (inputSignal) {
      inputSignal.removeEventListener('abort', abortFromInput);
    }
  }
}

export async function fetchOllamaWithRetry(input: {
  runtime: OllamaRuntime;
  fetchImpl: typeof globalThis.fetch;
  baseUrl: string;
  path: string;
  options: RequestInit;
  apiKey: string | null;
  timeoutMs: number;
}) {
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= OLLAMA_SERVER_ERROR_RETRY_LIMIT; attempt += 1) {
    const response = await fetchOllama(input);
    if (response.status >= 500 && input.path === '/v1/responses') {
      const compatibilityMessage = await response.clone().text().catch(() => '');
      if (shouldFallbackFromResponsesTransport(compatibilityMessage)) {
        return response;
      }
    }
    if (
      response.status < 500
      || attempt === OLLAMA_SERVER_ERROR_RETRY_LIMIT
      || input.options.signal?.aborted
    ) {
      return response;
    }

    lastResponse = response;
    await new Promise((resolve) => setTimeout(resolve, OLLAMA_SERVER_ERROR_RETRY_DELAY_MS));
  }

  return lastResponse as Response;
}

export async function fetchOllamaTags(input: {
  runtime: OllamaRuntime;
  fetchImpl: typeof globalThis.fetch;
  baseUrl: string;
  apiKey: string | null;
  timeoutMs?: number;
}) {
  const response = await fetchOllama({
    runtime: input.runtime,
    fetchImpl: input.fetchImpl,
    baseUrl: input.baseUrl,
    path: '/api/tags',
    options: {
      method: 'GET'
    },
    apiKey: input.apiKey,
    timeoutMs: input.timeoutMs ?? CHAT_REQUEST_TIMEOUT_MS
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as OllamaTagResponse;
}
