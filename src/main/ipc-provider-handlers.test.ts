import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMock, resetIpcTestMocks } from './ipc-test-harness';

describe('registerIpc provider handlers', () => {
  beforeEach(resetIpcTestMocks);

  it('wires the Ollama runtime stop handler over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const stopAndGetSnapshot = vi.fn(async () => ({
      installed: true,
      reachable: false,
      cliPath: 'C:/Program Files/Ollama/ollama.exe',
      baseUrl: 'http://127.0.0.1:11434',
      models: [],
      managedByApp: false,
      canManageProcess: true,
      canStop: false,
      starting: false
    }));

    const services = {
      db: {},
      providers: {
        onEvent: vi.fn(() => vi.fn())
      },
      ollamaRuntime: {
        onEvent: vi.fn(() => vi.fn()),
        stopAndGetSnapshot
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

    const mainWindow = {
      webContents: {
        send: vi.fn()
      },
      on: vi.fn()
    };

    registerIpc(mainWindow as never, services as never);

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'ollamaRuntime:stop');
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    await expect(handler({})).resolves.toEqual({
      installed: true,
      reachable: false,
      cliPath: 'C:/Program Files/Ollama/ollama.exe',
      baseUrl: 'http://127.0.0.1:11434',
      models: [],
      managedByApp: false,
      canManageProcess: true,
      canStop: false,
      starting: false
    });
    expect(stopAndGetSnapshot).toHaveBeenCalledOnce();
  });

  it('wires custom provider settings over IPC through the provider manager', async () => {
    const { registerIpc } = await import('./ipc');

    const customProvider = {
      id: 'custom-provider-1',
      name: 'Gateway',
      transportKind: 'openai_compatible_chat' as const,
      baseUrl: 'https://gateway.example/v1',
      defaultModelId: 'gateway-coder',
      enabled: true,
      hasApiKey: true,
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:00:00.000Z'
    };
    const services = {
      db: {},
      providers: {
        onEvent: vi.fn(() => vi.fn()),
        listCustomProviderSettings: vi.fn(() => [customProvider]),
        saveCustomProviderSettings: vi.fn(() => customProvider),
        deleteCustomProviderSettings: vi.fn()
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

    const listEntry = handleMock.mock.calls.find(([channel]) => channel === 'providers:listCustom');
    const saveEntry = handleMock.mock.calls.find(([channel]) => channel === 'providers:saveCustom');
    const removeEntry = handleMock.mock.calls.find(([channel]) => channel === 'providers:removeCustom');

    expect(listEntry).toBeTruthy();
    expect(saveEntry).toBeTruthy();
    expect(removeEntry).toBeTruthy();

    const [, listHandler] = listEntry!;
    const [, saveHandler] = saveEntry!;
    const [, removeHandler] = removeEntry!;

    expect(await listHandler({})).toEqual([customProvider]);
    expect(
      await saveHandler({}, {
        name: ' Gateway ',
        transportKind: 'openai_compatible_chat',
        baseUrl: ' https://gateway.example/v1 ',
        apiKey: ' gateway-secret ',
        defaultModelId: ' gateway-coder ',
        enabled: true
      })
    ).toEqual(customProvider);
    await removeHandler({}, { providerId: 'custom-provider-1' });

    expect(services.providers.saveCustomProviderSettings).toHaveBeenCalledWith({
      name: 'Gateway',
      transportKind: 'openai_compatible_chat',
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'gateway-secret',
      defaultModelId: 'gateway-coder',
      enabled: true
    });
    expect(services.providers.deleteCustomProviderSettings).toHaveBeenCalledWith('custom-provider-1');
  });
});
