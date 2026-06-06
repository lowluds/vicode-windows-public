import { describe, expect, it, vi } from 'vitest';
import type { OllamaRuntime } from './runtime';
import { fetchOllama, fetchOllamaTags, fetchOllamaWithRetry } from './transport';

function createRuntime(overrides: Partial<OllamaRuntime> = {}): OllamaRuntime {
  return {
    baseUrl: 'http://127.0.0.1:11434',
    fetch: vi.fn(),
    listTags: vi.fn(async () => null),
    showModel: vi.fn(async () => null),
    detectInstall: vi.fn(async () => ({
      installed: false,
      cliPath: null
    })),
    getStatus: vi.fn(async () => ({
      installed: false,
      cliPath: null,
      reachable: false,
      baseUrl: 'http://127.0.0.1:11434',
      tags: null
    })),
    start: vi.fn(async () => {}),
    ...overrides
  };
}

describe('Ollama transport helpers', () => {
  it('delegates unauthenticated local requests to the local runtime', async () => {
    const runtime = createRuntime({
      fetch: vi.fn(async () => new Response('{}', { status: 200 }))
    });
    const fetchImpl = vi.fn();

    const response = await fetchOllama({
      runtime,
      fetchImpl,
      baseUrl: runtime.baseUrl,
      path: '/api/chat',
      options: { method: 'POST' },
      apiKey: null,
      timeoutMs: 1000
    });

    expect(response.status).toBe(200);
    expect(runtime.fetch).toHaveBeenCalledWith('/api/chat', { method: 'POST' }, 1000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends bearer auth to an explicit remote base URL without using the local runtime', async () => {
    const runtime = createRuntime();
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));

    await fetchOllama({
      runtime,
      fetchImpl: fetchImpl as typeof globalThis.fetch,
      baseUrl: 'https://remote.example',
      path: '/api/tags',
      options: { method: 'GET' },
      apiKey: 'cloud-key',
      timeoutMs: 1000
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://remote.example/api/tags',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer cloud-key'
        })
      })
    );
    expect(runtime.fetch).not.toHaveBeenCalled();
  });

  it('loads remote tags through the shared transport path', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ models: [{ name: 'qwen3-coder:480b-cloud' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(
      fetchOllamaTags({
        runtime: createRuntime(),
        fetchImpl: fetchImpl as typeof globalThis.fetch,
        baseUrl: 'https://remote.example',
        apiKey: 'cloud-key'
      })
    ).resolves.toEqual({
      models: [{ name: 'qwen3-coder:480b-cloud' }]
    });
  });

  it('retries transient server errors but preserves responses-transport fallback errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('server unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await expect(
      fetchOllamaWithRetry({
        runtime: createRuntime(),
        fetchImpl: fetchImpl as typeof globalThis.fetch,
        baseUrl: 'https://remote.example',
        path: '/api/chat',
        options: { method: 'POST' },
        apiKey: 'cloud-key',
        timeoutMs: 1000
      })
    ).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const fallbackFetch = vi.fn(async () => new Response('history is not defined', { status: 500 }));
    await expect(
      fetchOllamaWithRetry({
        runtime: createRuntime(),
        fetchImpl: fallbackFetch as typeof globalThis.fetch,
        baseUrl: 'https://remote.example',
        path: '/v1/responses',
        options: { method: 'POST' },
        apiKey: 'cloud-key',
        timeoutMs: 1000
      })
    ).resolves.toMatchObject({ status: 500 });
    expect(fallbackFetch).toHaveBeenCalledTimes(1);
  });
});
