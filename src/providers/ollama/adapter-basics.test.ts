import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaAdapter } from './adapter';
import {
  createCallbacks,
  createContext,
  createRuntime,
  createStreamResponse
} from './adapter-test-helpers';

describe('OllamaAdapter basics', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('discovers installed local models from the Ollama tags API', async () => {
    const runtime = createRuntime({
      listTags: vi.fn(async () => ({
        models: [
          { name: 'qwen3' },
          { name: 'qwen3-coder:30b' },
          { name: 'qwen2.5vl:7b', details: { families: ['clip'] } }
        ]
      })),
      showModel: vi.fn(async (modelId: string) => {
        if (modelId === 'qwen3-coder:30b') {
          return {
            parameters: 'temperature 0.7\n num_ctx 65536',
            model_info: {
              'qwen3.context_length': 262144
            }
          };
        }

        return null;
      })
    });

    const adapter = new OllamaAdapter(runtime);
    const models = await adapter.discoverRuntimeModels();

    expect(models).toEqual([
      {
        id: 'qwen3',
        label: 'Qwen3',
        description: 'Local model discovered from Ollama.',
        supportsVision: false,
        recommendation: undefined,
        contextWindowTokens: 32_768,
        autoCompactTokenLimit: null,
        contextWindowSource: 'heuristic'
      },
      {
        id: 'qwen3-coder:30b',
        label: 'Qwen3 Coder 30b',
        description: 'Local model discovered from Ollama.',
        supportsVision: false,
        recommendation: undefined,
        contextWindowTokens: 65_536,
        autoCompactTokenLimit: null,
        contextWindowSource: 'runtime'
      },
      {
        id: 'qwen2.5vl:7b',
        label: 'Qwen2 5vl 7b',
        description: 'Local Ollama model from families: clip.',
        supportsVision: true,
        recommendation: undefined,
        contextWindowTokens: 32_768,
        autoCompactTokenLimit: null,
        contextWindowSource: 'heuristic'
      }
    ]);
  });

  it('does not discover hosted Ollama models when a legacy API key is available', async () => {
    const fetchMock = vi.fn();
    const adapter = new OllamaAdapter(createRuntime({ fetch: fetchMock }));
    const models = await adapter.discoverApiModels({
      account: null,
      authMode: 'api_key',
      apiKey: 'ollama-cloud-key',
      cliPath: null
    });

    expect(models).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports planner support through the app-owned planning mode', () => {
    const adapter = new OllamaAdapter(createRuntime());

    expect(adapter.getPlannerCapability()).toEqual({
      supported: true,
      executionMode: 'workspace-write',
      enforcement: 'best-effort',
      message: 'Ollama planner runs through the app-owned planning mode.'
    });
  });

  it('does not run a second local request for completed planner markdown', async () => {
    const fetchMock = vi.fn(async () =>
      createStreamResponse([
        {
          message: {
            content: '# Example Plan\n\n## Summary\nPlan ready.\n'
          }
        }
      ])
    );
    const runtime = createRuntime({
      fetch: fetchMock
    });
    const adapter = new OllamaAdapter(runtime);
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        runMode: 'plan'
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('# Example Plan\n\n## Summary\nPlan ready.');
    });
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      messages?: Array<Record<string, unknown>>;
    };
    expect(payload.messages?.[0]?.content).toContain('Vicode planner artifact');
    expect(String(payload.messages?.[1]?.content ?? '')).toContain('Return markdown only using exactly this structure:');
    expect(String(payload.messages?.[1]?.content ?? '')).toContain('## Summary');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes image attachments through the plain chat transport', async () => {
    const runtime = createRuntime({
      fetch: vi.fn().mockResolvedValueOnce(
        createStreamResponse([
          {
            message: {
              content: 'I inspected the image and summarized it.'
            }
          }
        ])
      )
    });
    const adapter = new OllamaAdapter(runtime);
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        folderPath: null,
        trusted: false,
        imageAttachments: [
          {
            id: 'img-1',
            name: 'diagram.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,ZmFrZQ=='
          }
        ]
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('I inspected the image and summarized it.');
    });

    const fetchMock = runtime.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      messages?: Array<Record<string, unknown>>;
    };
    expect(payload.messages?.[1]).toEqual(
      expect.objectContaining({
        role: 'user',
        images: ['ZmFrZQ==']
      })
    );
    expect(callbacks.onInfo.mock.calls.flat().some((message) => String(message).includes('not wired'))).toBe(false);
  });

  it('passes image attachments through the responses transport payload', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Done.' }]
            }
          ]
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );
    const adapter = new OllamaAdapter(createRuntime({ fetch: fetchMock }));
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        folderPath: null,
        trusted: false,
        ollamaTransportMode: 'responses',
        imageAttachments: [
          {
            id: 'img-1',
            name: 'diagram.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,ZmFrZQ=='
          }
        ]
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Done.');
    });

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      input?: Array<Record<string, unknown>>;
    };
    expect(payload.input).toEqual([
      {
        type: 'input_text',
        text: 'Inspect the workspace.'
      },
      {
        type: 'input_image',
        image_url: 'data:image/png;base64,ZmFrZQ==',
        detail: 'auto'
      }
    ]);
  });

  it('reports detected when the runtime install is present but the service is unreachable', async () => {
    const runtime = createRuntime({
      getStatus: vi.fn(async () => ({
        installed: true,
        cliPath: 'C:\\Users\\test-user\\AppData\\Roaming\\npm\\ollama.cmd',
        reachable: false,
        baseUrl: 'http://127.0.0.1:11434',
        tags: null
      }))
    });

    const adapter = new OllamaAdapter(runtime);
    const authState = await adapter.getAuthState(null);

    expect(authState).toEqual({
      authState: 'detected',
      authMode: null,
      message: 'Ollama local runtime is installed, but not reachable yet. Open Ollama or start the local runtime, then refresh.'
    });
  });

  it('treats a reachable local runtime as installed even when no CLI path is available', async () => {
    const runtime = createRuntime({
      detectInstall: vi.fn(async () => ({
        installed: true,
        cliPath: null
      })),
      getStatus: vi.fn(async () => ({
        installed: true,
        cliPath: null,
        reachable: true,
        baseUrl: 'http://127.0.0.1:11434',
        tags: {
          models: [{ name: 'deepseek-r1:8b' }]
        }
      }))
    });

    const adapter = new OllamaAdapter(runtime);
    const install = await adapter.detectInstall();
    const authState = await adapter.getAuthState(null);

    expect(install).toEqual({
      installed: true,
      cliPath: null
    });
    expect(authState).toEqual({
      authState: 'connected',
      authMode: null,
      message: 'Ollama local runtime is ready with 1 local model.'
    });
  });
});
