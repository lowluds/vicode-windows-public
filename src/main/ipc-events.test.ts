import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMock, resetIpcTestMocks } from './ipc-test-harness';

describe('registerIpc event forwarding', () => {
  beforeEach(resetIpcTestMocks);

  it('forwards Ollama runtime events to the renderer event bus', async () => {
    const { registerIpc } = await import('./ipc');

    const unsubscribeOllamaRuntime = vi.fn();
    const mainWindow = {
      webContents: {
        send: vi.fn()
      },
      on: vi.fn()
    };

    const services = {
      db: {},
      providers: {
        onEvent: vi.fn(() => vi.fn())
      },
      ollamaRuntime: {
        onEvent: vi.fn((listener: (event: unknown) => void) => {
          listener({
            type: 'ollama.pullProgress',
            progress: {
              model: 'qwen3-coder:30b',
              status: 'downloading',
              completed: 5,
              total: 10,
              digest: 'sha256:test',
              state: 'running'
            }
          });
          return unsubscribeOllamaRuntime;
        })
      },
      skills: {},
      automations: {
        onEvent: vi.fn(() => vi.fn())
      },
      diagnostics: {},
      mcp: {
        onEvent: vi.fn(() => vi.fn())
      },
      jobs: {
        onEvent: vi.fn(() => vi.fn())
      },
      voice: {}
    };

    const unregister = registerIpc(mainWindow as never, services as never);

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('vicode:event', {
      type: 'ollama.pullProgress',
      progress: {
        model: 'qwen3-coder:30b',
        status: 'downloading',
        completed: 5,
        total: 10,
        digest: 'sha256:test',
        state: 'running'
      }
    });

    unregister();
    expect(unsubscribeOllamaRuntime).toHaveBeenCalledOnce();
  });

  it('forwards library watch events to the renderer event bus', async () => {
    const { registerIpc } = await import('./ipc');

    const unsubscribeLibraryWatch = vi.fn();
    const mainWindow = {
      webContents: {
        send: vi.fn()
      },
      on: vi.fn()
    };

    const services = {
      db: {},
      providers: {
        onEvent: vi.fn(() => vi.fn())
      },
      ollamaRuntime: {
        onEvent: vi.fn(() => vi.fn())
      },
      libraryWatch: {
        onEvent: vi.fn((listener: (event: unknown) => void) => {
          listener({
            type: 'library.skillsChanged',
            refreshedAt: '2026-06-05T10:00:00.000Z'
          });
          return unsubscribeLibraryWatch;
        })
      },
      skills: {},
      automations: {
        onEvent: vi.fn(() => vi.fn())
      },
      diagnostics: {},
      mcp: {
        onEvent: vi.fn(() => vi.fn())
      },
      jobs: {
        onEvent: vi.fn(() => vi.fn())
      },
      voice: {}
    };

    const unregister = registerIpc(mainWindow as never, services as never);

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('vicode:event', {
      type: 'library.skillsChanged',
      refreshedAt: '2026-06-05T10:00:00.000Z'
    });

    unregister();
    expect(unsubscribeLibraryWatch).toHaveBeenCalledOnce();
  });
});
