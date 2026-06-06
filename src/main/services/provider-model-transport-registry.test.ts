import { describe, expect, it, vi } from 'vitest';
import {
  resolveOpenAICompatibleChatTransport,
  resolveProviderModelTransport
} from './provider-model-transport-registry';

describe('provider model transport registry', () => {
  it('returns null without side effects for unsupported and retired native providers', () => {
    const fetchWithRetry = vi.fn();

    const result = resolveProviderModelTransport({
      providerId: 'openai',
      modelId: 'gpt-5',
      apiKey: null,
      ollamaRuntimeBaseUrl: 'http://127.0.0.1:11434',
      ollamaTransportMode: 'responses',
      fetchOllamaWithRetry: fetchWithRetry
    });

    expect(result).toBeNull();
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it('keeps native OpenAI retired even when an API key is present', () => {
    const result = resolveProviderModelTransport({
      providerId: 'openai',
      modelId: 'gpt-5.4-nano',
      apiKey: 'openai-key',
      ollamaRuntimeBaseUrl: 'http://127.0.0.1:11434',
      ollamaTransportMode: null,
      fetchOllamaWithRetry: vi.fn()
    });

    expect(result).toBeNull();
  });

  it('creates a local Ollama responses transport for responses mode', async () => {
    const fetchWithRetry = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output_text: 'Responses ready.'
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );

    const result = resolveProviderModelTransport({
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      apiKey: 'ignored-legacy-ollama-key',
      ollamaRuntimeBaseUrl: 'http://127.0.0.1:11434',
      ollamaTransportMode: 'responses',
      fetchOllamaWithRetry: fetchWithRetry
    });

    expect(result?.transportKind).toBe('ollama_responses');
    expect(result?.capabilityProfile.toolCallFormat).toBe('responses_function_call');
    expect(result?.capabilityProfile.needsTransportFallback).toBe(true);
    expect(result?.runtimeAuthority.approvalAuthority).toBe('app');
    expect(result?.runtimeAuthority.executionAuthority).toBe('app_runtime');
    expect(result?.runtimeAuthority.sandboxAuthority).toBe('app_runtime');
    const turn = await result!.transport.sendTurn({
      modelId: 'qwen3-coder',
      systemInstructions: 'System',
      input: [
        {
          role: 'user',
          content: 'Hello'
        }
      ],
      tools: [],
      attachments: {},
      signal: new AbortController().signal
    });

    expect(turn.text).toBe('Responses ready.');
    expect(fetchWithRetry.mock.calls[0]?.[0]).toBe('http://127.0.0.1:11434');
    expect(fetchWithRetry.mock.calls[0]?.[1]).toBe('/v1/responses');
    expect(fetchWithRetry.mock.calls[0]?.[3]).toBeNull();
  });

  it('creates an Ollama chat transport for classic chat mode', () => {
    const result = resolveProviderModelTransport({
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      apiKey: null,
      ollamaRuntimeBaseUrl: 'http://127.0.0.1:11434',
      ollamaTransportMode: 'chat',
      fetchOllamaWithRetry: vi.fn()
    });

    expect(result?.transportKind).toBe('ollama_chat');
    expect(result?.capabilityProfile.toolCallFormat).toBe('ollama_chat_tool_call');
    expect(result?.capabilityProfile.needsTransportFallback).toBe(false);
    expect(result?.runtimeAuthority.approvalAuthority).toBe('app');
    expect(result?.runtimeAuthority.executionAuthority).toBe('app_runtime');
    expect(result?.runtimeAuthority.sandboxAuthority).toBe('app_runtime');
  });

  it('treats missing Ollama transport mode as normalized chat mode', () => {
    const result = resolveProviderModelTransport({
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      apiKey: null,
      ollamaRuntimeBaseUrl: 'http://127.0.0.1:11434',
      ollamaTransportMode: undefined,
      fetchOllamaWithRetry: vi.fn()
    });

    expect(result?.transportKind).toBe('ollama_chat');
    expect(result?.capabilityProfile.toolCallFormat).toBe('ollama_chat_tool_call');
    expect(result?.capabilityProfile.needsTransportFallback).toBe(false);
    expect(result?.runtimeAuthority).toEqual({
      executionAuthority: 'app_runtime',
      approvalAuthority: 'app',
      sandboxAuthority: 'app_runtime'
    });
  });

  it('creates an OpenAI-compatible chat transport resolution for saved custom provider picker entries', () => {
    const result = resolveOpenAICompatibleChatTransport({
      apiKey: 'compatible-key',
      baseUrl: 'https://gateway.example/v1',
      providerLabel: 'Example Gateway'
    });

    expect(result?.transportKind).toBe('openai_compatible_chat');
    expect(result?.providerLabel).toBe('Example Gateway');
    expect(result?.capabilityProfile).toEqual({
      supportsTools: true,
      supportsStreaming: false,
      toolCallFormat: 'openai_compatible_chat_tool_call',
      preferredSmokeModel: null,
      needsTransportFallback: false
    });
    expect(result?.runtimeAuthority).toEqual({
      executionAuthority: 'app_runtime',
      approvalAuthority: 'app',
      sandboxAuthority: 'app_runtime'
    });
  });
});
