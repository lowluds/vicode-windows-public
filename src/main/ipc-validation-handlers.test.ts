import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMock, resetIpcTestMocks } from './ipc-test-harness';

describe('registerIpc validation handlers', () => {
  beforeEach(resetIpcTestMocks);

  it('rejects malformed project and provider IDs before calling IPC services', async () => {
    const { registerIpc } = await import('./ipc');

    const services = {
      db: {
        listThreads: vi.fn(() => [])
      },
      providers: {
        onEvent: vi.fn(() => vi.fn()),
        clearAuth: vi.fn(async () => ({ id: 'openai' })),
        getProvider: vi.fn(async () => ({ id: 'openai' }))
      },
      ollamaRuntime: {
        onEvent: vi.fn(() => vi.fn())
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

    registerIpc({ webContents: { send: vi.fn() } } as never, services as never);

    const listThreadsEntry = handleMock.mock.calls.find(([channel]) => channel === 'threads:list');
    const clearAuthEntry = handleMock.mock.calls.find(([channel]) => channel === 'providers:clearAuth');
    const refreshProviderEntry = handleMock.mock.calls.find(([channel]) => channel === 'providers:refresh');
    expect(listThreadsEntry).toBeTruthy();
    expect(clearAuthEntry).toBeTruthy();
    expect(refreshProviderEntry).toBeTruthy();

    const [, listThreadsHandler] = listThreadsEntry!;
    const [, clearAuthHandler] = clearAuthEntry!;
    const [, refreshProviderHandler] = refreshProviderEntry!;

    expect(() => listThreadsHandler({}, '')).toThrow();
    expect(services.db.listThreads).not.toHaveBeenCalled();

    await expect(clearAuthHandler({}, 'anthropic')).rejects.toThrow();
    expect(services.providers.clearAuth).not.toHaveBeenCalled();

    await expect(refreshProviderHandler({}, 'anthropic')).rejects.toThrow();
    expect(services.providers.getProvider).not.toHaveBeenCalled();
  });
});
