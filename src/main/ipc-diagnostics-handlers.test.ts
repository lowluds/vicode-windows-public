import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMock, resetIpcTestMocks } from './ipc-test-harness';

describe('registerIpc diagnostics handlers', () => {
  beforeEach(resetIpcTestMocks);

  it('exports a user-facing thread support report over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const providers = [{ id: 'openai' }];
    const services = {
      db: {},
      providers: {
        onEvent: vi.fn(() => vi.fn()),
        listProviders: vi.fn().mockResolvedValue(providers)
      },
      ollamaRuntime: {
        onEvent: vi.fn(() => vi.fn())
      },
      skills: {},
      automations: {
        onEvent: vi.fn(() => vi.fn())
      },
      diagnostics: {
        exportThreadReport: vi.fn().mockResolvedValue('C:/tmp/thread-report-thread-1')
      },
      mcp: {
        onEvent: vi.fn(() => vi.fn())
      },
      jobs: {
        onEvent: vi.fn(() => vi.fn())
      },
      voice: {}
    };
    const mainWindow = {
      webContents: {
        send: vi.fn()
      },
      on: vi.fn()
    };

    registerIpc(mainWindow as never, services as never);

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'diagnostics:exportThreadReport');
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    const result = await handler({}, { threadId: 'thread-1' });

    expect(services.providers.listProviders).toHaveBeenCalledOnce();
    expect(services.diagnostics.exportThreadReport).toHaveBeenCalledWith('thread-1', providers);
    expect(result).toBe('C:/tmp/thread-report-thread-1');
  });
});
