import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { OllamaRuntimeService } from './ollama-runtime';
import type { AppEvent } from '../../shared/events';
import type { OllamaRuntime } from '../../providers/ollama/runtime';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

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

function createManagedChild() {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  child.pid = 4242;
  child.exitCode = null;
  child.killed = false;
  child.stdout = {
    resume: vi.fn(),
    on: vi.fn()
  } as never;
  child.stderr = {
    resume: vi.fn(),
    on: vi.fn()
  } as never;
  child.kill = vi.fn(() => true);
  return child;
}

describe('OllamaRuntimeService', () => {
  it('forwards runtime model metadata lookups', async () => {
    const showModel = vi.fn(async () => ({
      parameters: 'num_ctx 65536',
      model_info: {
        'qwen3.context_length': 262144
      }
    }));
    const runtime = createRuntime({ showModel });
    const service = new OllamaRuntimeService(runtime);

    await expect(service.showModel('qwen3-coder:30b')).resolves.toEqual({
      parameters: 'num_ctx 65536',
      model_info: {
        'qwen3.context_length': 262144
      }
    });
    expect(showModel).toHaveBeenCalledWith('qwen3-coder:30b');
  });

  it('returns a main-process snapshot with discovered model ids', async () => {
    const runtime = createRuntime({
      getStatus: vi.fn(async () => ({
        installed: true,
        cliPath: 'C:\\Program Files\\Ollama\\ollama.exe',
        reachable: true,
        baseUrl: 'http://127.0.0.1:11434',
        tags: {
          models: [{ name: 'qwen3-coder:30b' }, { model: 'deepseek-r1:8b' }]
        }
      }))
    });

    const service = new OllamaRuntimeService(runtime);

    await expect(service.getSnapshot()).resolves.toEqual({
      installed: true,
      reachable: true,
      cliPath: 'C:\\Program Files\\Ollama\\ollama.exe',
      baseUrl: 'http://127.0.0.1:11434',
      models: ['qwen3-coder:30b', 'deepseek-r1:8b'],
      managedByApp: false,
      canManageProcess: true,
      canStop: false,
      starting: false
    });
  });

  it('starts the runtime under Vicode control when a local executable path is available', async () => {
    let reachable = false;
    const child = createManagedChild();
    const spawnProcess = vi.fn(() => {
      reachable = true;
      return child;
    });
    const runtime = createRuntime({
      getStatus: vi.fn(async () => ({
        installed: true,
        cliPath: 'C:\\Program Files\\Ollama\\ollama.exe',
        reachable,
        baseUrl: 'http://127.0.0.1:11434',
        tags: reachable
          ? {
              models: [{ name: 'qwen3' }]
            }
          : null
      }))
    });

    const service = new OllamaRuntimeService(runtime, spawnProcess);
    const snapshot = await service.startAndGetSnapshot();

    expect(spawnProcess).toHaveBeenCalledWith('C:\\Program Files\\Ollama\\ollama.exe', ['serve']);
    expect(snapshot).toEqual({
      installed: true,
      reachable: true,
      cliPath: 'C:\\Program Files\\Ollama\\ollama.exe',
      baseUrl: 'http://127.0.0.1:11434',
      models: ['qwen3'],
      managedByApp: true,
      canManageProcess: true,
      canStop: true,
      starting: false
    });
  });

  it('falls back to delegated runtime start when Vicode cannot own a process handle', async () => {
    const start = vi.fn(async () => {});
    let reachable = false;
    const runtime = createRuntime({
      start,
      getStatus: vi.fn(async () => ({
        installed: true,
        cliPath: null,
        reachable,
        baseUrl: 'http://127.0.0.1:11434',
        tags: reachable
          ? {
              models: [{ name: 'qwen3' }]
            }
          : null
      }))
    });
    start.mockImplementation(async () => {
      reachable = true;
    });

    const service = new OllamaRuntimeService(runtime);
    const snapshot = await service.startAndGetSnapshot();

    expect(start).toHaveBeenCalledWith(undefined);
    expect(snapshot.models).toEqual(['qwen3']);
    expect(snapshot.reachable).toBe(true);
    expect(snapshot.managedByApp).toBe(false);
    expect(snapshot.canManageProcess).toBe(false);
  });

  it('stops a Vicode-managed runtime and clears stop capability', async () => {
    let reachable = false;
    const child = createManagedChild();
    const spawnProcess = vi.fn(() => {
      reachable = true;
      return child;
    });
    const killProcess = vi.fn(async () => {
      reachable = false;
      child.exitCode = 0;
      child.emit('exit', 0);
    });
    const runtime = createRuntime({
      getStatus: vi.fn(async () => ({
        installed: true,
        cliPath: 'C:\\Program Files\\Ollama\\ollama.exe',
        reachable,
        baseUrl: 'http://127.0.0.1:11434',
        tags: reachable ? { models: [{ name: 'qwen3' }] } : null
      }))
    });

    const service = new OllamaRuntimeService(runtime, spawnProcess, killProcess);
    await service.startAndGetSnapshot();

    await expect(service.stopAndGetSnapshot()).resolves.toEqual({
      installed: true,
      reachable: false,
      cliPath: 'C:\\Program Files\\Ollama\\ollama.exe',
      baseUrl: 'http://127.0.0.1:11434',
      models: [],
      managedByApp: false,
      canManageProcess: true,
      canStop: false,
      starting: false
    });
    expect(killProcess).toHaveBeenCalledWith(child);
  });

  it('pulls a model through the runtime, streams progress, and returns the refreshed inventory', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('{"status":"pulling manifest"}\n'));
        controller.enqueue(encoder.encode('{"status":"downloading","completed":5,"total":10,"digest":"sha256:test"}\n'));
        controller.enqueue(encoder.encode('{"status":"success"}\n'));
        controller.close();
      }
    });

    const fetch = vi.fn(async (path: string) => {
      if (path === '/api/pull') {
        return new Response(stream, {
          status: 200,
          headers: {
            'content-type': 'application/x-ndjson'
          }
        });
      }

      return new Response('', { status: 404 });
    });
    const runtime = createRuntime({
      fetch,
      listTags: vi.fn(async () => ({
        models: [{ name: 'qwen3-coder:30b' }]
      }))
    });
    const service = new OllamaRuntimeService(runtime);
    const events: AppEvent[] = [];

    service.onEvent((event) => {
      events.push(event);
    });

    await expect(service.pullModel('qwen3-coder:30b')).resolves.toEqual({
      model: 'qwen3-coder:30b',
      models: ['qwen3-coder:30b']
    });

    expect(events).toEqual([
      {
        type: 'ollama.pullProgress',
        progress: {
          model: 'qwen3-coder:30b',
          status: 'Starting pull for qwen3-coder:30b',
          completed: null,
          total: null,
          digest: null,
          state: 'running'
        }
      },
      {
        type: 'ollama.pullProgress',
        progress: {
          model: 'qwen3-coder:30b',
          status: 'pulling manifest',
          completed: null,
          total: null,
          digest: null,
          state: 'running'
        }
      },
      {
        type: 'ollama.pullProgress',
        progress: {
          model: 'qwen3-coder:30b',
          status: 'downloading',
          completed: 5,
          total: 10,
          digest: 'sha256:test',
          state: 'running'
        }
      },
      {
        type: 'ollama.pullProgress',
        progress: {
          model: 'qwen3-coder:30b',
          status: 'success',
          completed: null,
          total: null,
          digest: null,
          state: 'completed'
        }
      }
    ]);
  });

  it('fails model pulls when the streamed runtime reports an error', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('{"status":"pulling manifest"}\n'));
        controller.enqueue(encoder.encode('{"error":"model not found"}\n'));
        controller.close();
      }
    });

    const fetch = vi.fn(async (path: string) => {
      if (path === '/api/pull') {
        return new Response(stream, {
          status: 200,
          headers: {
            'content-type': 'application/x-ndjson'
          }
        });
      }

      return new Response('', { status: 404 });
    });
    const runtime = createRuntime({ fetch });
    const service = new OllamaRuntimeService(runtime);
    const events: AppEvent[] = [];

    service.onEvent((event) => {
      events.push(event);
    });

    await expect(service.pullModel('missing-model')).rejects.toThrow('model not found');
    expect(events).toEqual([
      {
        type: 'ollama.pullProgress',
        progress: {
          model: 'missing-model',
          status: 'Starting pull for missing-model',
          completed: null,
          total: null,
          digest: null,
          state: 'running'
        }
      },
      {
        type: 'ollama.pullProgress',
        progress: {
          model: 'missing-model',
          status: 'pulling manifest',
          completed: null,
          total: null,
          digest: null,
          state: 'running'
        }
      },
      {
        type: 'ollama.pullProgress',
        progress: {
          model: 'missing-model',
          status: 'model not found',
          completed: null,
          total: null,
          digest: null,
          state: 'failed'
        }
      }
    ]);
  });

  it('deletes a model through the runtime and returns the refreshed inventory', async () => {
    const fetch = vi.fn(async (path: string) => {
      if (path === '/api/delete') {
        return new Response('{}', { status: 200 });
      }

      return new Response('', { status: 404 });
    });
    const runtime = createRuntime({
      fetch,
      listTags: vi.fn(async () => ({
        models: [{ name: 'deepseek-r1:8b' }]
      }))
    });
    const service = new OllamaRuntimeService(runtime);

    await expect(service.deleteModel('qwen3')).resolves.toEqual({
      model: 'qwen3',
      models: ['deepseek-r1:8b']
    });
  });
});
