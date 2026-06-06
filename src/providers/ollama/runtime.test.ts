import { describe, expect, it, vi } from 'vitest';
import { LocalOllamaRuntime } from './runtime';

describe('LocalOllamaRuntime', () => {
  it('treats a reachable runtime as installed even when the CLI shim is missing', async () => {
    const runtime = new LocalOllamaRuntime(
      'http://127.0.0.1:11434',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            models: [{ name: 'qwen3-coder:30b' }]
          }),
          { status: 200 }
        )
      ),
      vi.fn(async () => ({
        installed: false,
        cliPath: null
      })),
      vi.fn(async () => {})
    );

    await expect(runtime.detectInstall()).resolves.toEqual({
      installed: true,
      cliPath: null
    });
  });

  it('reports runtime reachability and discovered tags in status checks', async () => {
    const tags = {
      models: [{ name: 'deepseek-r1:8b' }]
    };
    const runtime = new LocalOllamaRuntime(
      'http://127.0.0.1:11434',
      vi.fn(async () => new Response(JSON.stringify(tags), { status: 200 })),
      vi.fn(async () => ({
        installed: true,
        cliPath: 'C:\\Program Files\\Ollama\\ollama.exe'
      })),
      vi.fn(async () => {})
    );

    await expect(runtime.getStatus()).resolves.toEqual({
      installed: true,
      cliPath: 'C:\\Program Files\\Ollama\\ollama.exe',
      reachable: true,
      baseUrl: 'http://127.0.0.1:11434',
      tags
    });
  });

  it('uses the configured base URL for local runtime requests', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200 }));
    const runtime = new LocalOllamaRuntime('http://127.0.0.1:15432', fetchImpl, vi.fn(), vi.fn());

    await runtime.listTags();

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:15432/api/tags',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json'
        }),
        signal: expect.any(AbortSignal)
      })
    );
  });

  it('forwards caller abort signals through runtime fetch', async () => {
    const fetchImpl = vi.fn(async (_url: string, options?: RequestInit) => {
      expect(options?.signal?.aborted).toBe(true);
      return new Response('{}', { status: 200 });
    });
    const runtime = new LocalOllamaRuntime('http://127.0.0.1:11434', fetchImpl, vi.fn(), vi.fn());
    const controller = new AbortController();
    controller.abort();

    await runtime.fetch('/api/tags', { signal: controller.signal });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
