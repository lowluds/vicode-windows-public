import { describe, expect, it, vi } from 'vitest';
import type {
  CustomProviderSettings,
  CustomProviderSettingsSaveInput,
  ProviderDescriptor,
  ProviderId
} from '../../shared/domain';
import type { OllamaRuntimeSnapshot } from '../../shared/ipc';
import {
  beginProviderInstallInShell,
  clearAllProviderAuthInShell,
  connectProviderInShell,
  pullOllamaModelInShell,
  refreshProviderInShell,
  saveCustomProviderInShell,
  saveProviderApiKeyInShell,
  type AppShellProviderActionsHost
} from './app-shell-provider-actions';

type Toast = {
  level: 'info' | 'warning' | 'error';
  message: string;
};

function createProvider(
  id: ProviderId,
  overrides: Partial<ProviderDescriptor> = {}
) {
  return {
    id,
    label: id === 'ollama' ? 'Ollama' : 'OpenAI',
    authState: 'connected',
    authMode: 'cli',
    installed: true,
    models: [{ id: `${id}-model`, label: `${id} model`, description: '' }],
    modelSource: 'runtime',
    modelsUpdatedAt: null,
    canLiveDiscoverModels: true,
    cliPath: null,
    capabilities: {} as ProviderDescriptor['capabilities'],
    plannerPolicy: {} as ProviderDescriptor['plannerPolicy'],
    ...overrides
  } as ProviderDescriptor;
}

function createRuntime(overrides: Partial<OllamaRuntimeSnapshot> = {}) {
  return {
    installed: true,
    reachable: true,
    cliPath: null,
    baseUrl: 'http://127.0.0.1:11434',
    models: [],
    managedByApp: true,
    canManageProcess: true,
    canStop: true,
    starting: true,
    ...overrides
  } as OllamaRuntimeSnapshot;
}

function createCustomProvider(overrides: Partial<CustomProviderSettings> = {}) {
  return {
    id: 'custom-1',
    name: 'Custom API',
    transportKind: 'openai_compatible_chat',
    baseUrl: 'https://api.example.test',
    defaultModelId: 'model',
    enabled: true,
    hasApiKey: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  } as CustomProviderSettings;
}

function applyStateSetter<T>(current: T, value: T | ((current: T) => T)) {
  return typeof value === 'function' ? (value as (current: T) => T)(current) : value;
}

function createHost(overrides?: Partial<AppShellProviderActionsHost>) {
  let providers = [
    createProvider('openai', { models: [{ id: 'gpt-old', label: 'Old model', description: '' }] }),
    createProvider('ollama')
  ];
  let customProviders: CustomProviderSettings[] = [];
  let apiKeys = {
    openai: '  sk-test  ',
    gemini: '',
    qwen: '',
    ollama: '',
    kimi: '',
    openai_compatible: ''
  } as Record<ProviderId, string>;
  let composer = {
    providerId: 'openai' as ProviderId,
    modelId: 'gpt-old'
  };
  const toasts: Toast[] = [];
  const openedUrls: string[] = [];
  const clearedTimers: number[] = [];
  let nextTimerId = 40;
  let now = 0;
  const intervalCallbacks: Record<number, () => void> = {};
  const ollamaSnapshot = createRuntime();
  const refreshedProvider = createProvider('openai', {
    models: [{ id: 'gpt-new', label: 'New model', description: '' }]
  });

  const host: AppShellProviderActionsHost = {
    providers: {
      startAuth: vi.fn(async (providerId: ProviderId) => createProvider(providerId, { authState: 'connected' })),
      adoptAuth: vi.fn(async (providerId: ProviderId) => createProvider(providerId)),
      clearAuth: vi.fn(async (providerId: ProviderId) => createProvider(providerId, { authState: 'disconnected' })),
      refresh: vi.fn(async (providerId: ProviderId) =>
        providerId === 'openai'
          ? refreshedProvider
          : createProvider(providerId, { label: 'Ollama', models: [{ id: 'llama3', label: 'llama3', description: '' }] })
      ),
      list: vi.fn(async () => providers),
      listCustom: vi.fn(async () => customProviders),
      saveCustom: vi.fn(async (input: CustomProviderSettingsSaveInput) =>
        createCustomProvider({ id: input.id ?? 'custom-1', name: input.name })
      ),
      removeCustom: vi.fn(async () => undefined),
      saveApiKey: vi.fn(async (providerId: ProviderId) => createProvider(providerId))
    },
    ollamaRuntime: {
      getStatus: vi.fn(async () => ollamaSnapshot),
      start: vi.fn(async () => ollamaSnapshot),
      stop: vi.fn(async () => createRuntime({ reachable: false, starting: false })),
      pullModel: vi.fn(async (model: string) => ({ model, models: [model] })),
      deleteModel: vi.fn(async (model: string) => ({ model, models: [] }))
    },
    installPollingTimers: {},
    getVisibleProviders: () => providers,
    getComposerProviderState: () => composer,
    getApiKey: (providerId: ProviderId) => apiKeys[providerId],
    now: () => now,
    openInstallUrl: (url) => {
      openedUrls.push(url);
    },
    setInstallPollingInterval: (callback) => {
      nextTimerId += 1;
      intervalCallbacks[nextTimerId] = callback;
      return nextTimerId;
    },
    clearInstallPollingInterval: (timerId) => {
      clearedTimers.push(timerId);
      delete intervalCallbacks[timerId];
    },
    setProviders: (value) => {
      providers = applyStateSetter(providers, value);
    },
    setCustomProviders: (value) => {
      customProviders = value;
    },
    setApiKeys: (value) => {
      apiKeys = applyStateSetter(apiKeys, value);
    },
    setComposerModelId: (providerId, modelId) => {
      if (composer.providerId === providerId) {
        composer = { ...composer, modelId };
      }
    },
    setOllamaPullProgress: vi.fn(),
    setOllamaRuntimeStatus: vi.fn(),
    showToast: (level, message) => {
      toasts.push({ level, message });
    },
    ...overrides
  };

  return {
    host,
    toasts,
    openedUrls,
    clearedTimers,
    intervalCallbacks,
    setNow: (value: number) => {
      now = value;
    },
    getProviders: () => providers,
    getCustomProviders: () => customProviders,
    getApiKeys: () => apiKeys,
    getComposer: () => composer
  };
}

describe('app shell provider actions', () => {
  it('starts Ollama through the runtime and refreshes the provider state', async () => {
    const state = createHost();

    await connectProviderInShell(state.host, 'ollama');

    expect(state.host.ollamaRuntime.start).toHaveBeenCalled();
    expect(state.host.providers.refresh).toHaveBeenCalledWith('ollama');
    expect(state.host.setOllamaRuntimeStatus).toHaveBeenCalledWith(expect.objectContaining({ managedByApp: true }));
    expect(state.toasts).toEqual([
      { level: 'info', message: 'Local Ollama is starting in Vicode.' }
    ]);
  });

  it('refreshes a provider and promotes stale composer model ids', async () => {
    const state = createHost();

    await refreshProviderInShell(state.host, 'openai');

    expect(state.getComposer().modelId).toBe('gpt-new');
    expect(state.toasts).toEqual([
      { level: 'info', message: 'OpenAI switched to New model.' }
    ]);
  });

  it('opens Ollama install docs and polls until the provider is found', async () => {
    const state = createHost({
      providers: {
        ...createHost().host.providers,
        refresh: vi
          .fn()
          .mockResolvedValueOnce(createProvider('ollama', { installed: false, authState: 'missing_cli', label: 'Ollama' }))
          .mockResolvedValueOnce(createProvider('ollama', { installed: true, authState: 'connected', label: 'Ollama' }))
      }
    });

    beginProviderInstallInShell(state.host, 'ollama');
    expect(state.openedUrls).toEqual(['https://docs.ollama.com/windows']);
    expect(state.toasts[0]).toEqual({
      level: 'info',
      message: 'Install Ollama, then return to Vicode.'
    });

    const timerId = state.host.installPollingTimers.ollama!;
    state.intervalCallbacks[timerId]();
    await Promise.resolve();
    state.setNow(61_000);
    state.intervalCallbacks[timerId]();
    await Promise.resolve();

    expect(state.clearedTimers).toEqual([timerId]);
    expect(state.toasts.at(-1)).toEqual({
      level: 'info',
      message: 'Ollama is installed and ready.'
    });
  });

  it('does not open install flows for retired provider CLIs', () => {
    const state = createHost();

    beginProviderInstallInShell(state.host, 'qwen');

    expect(state.openedUrls).toEqual([]);
    expect(state.host.installPollingTimers.qwen).toBeUndefined();
    expect(state.toasts).toEqual([
      { level: 'warning', message: 'Qwen setup is retired for this beta.' }
    ]);
  });

  it('pulls Ollama models and refreshes provider models', async () => {
    const state = createHost();

    await pullOllamaModelInShell(state.host, ' llama3 ');

    expect(state.host.ollamaRuntime.pullModel).toHaveBeenCalledWith('llama3');
    expect(state.host.providers.refresh).toHaveBeenCalledWith('ollama');
    expect(state.toasts).toEqual([
      { level: 'info', message: 'Pulled llama3. 1 local model available.' }
    ]);
  });

  it('saves custom providers and refreshes the surfaced provider list', async () => {
    const state = createHost();
    const input: CustomProviderSettingsSaveInput = {
      name: 'Custom API',
      transportKind: 'openai_compatible_chat',
      baseUrl: 'https://api.example.test',
      apiKey: 'sk-custom',
      defaultModelId: 'model',
      enabled: true
    };

    const saved = await saveCustomProviderInShell(state.host, input);

    expect(saved.name).toBe('Custom API');
    expect(state.host.providers.saveCustom).toHaveBeenCalledWith(input);
    expect(state.host.providers.list).toHaveBeenCalled();
    expect(state.toasts).toEqual([
      { level: 'info', message: 'Custom API saved.' }
    ]);
  });

  it('saves API keys without including the secret in toast copy', async () => {
    const state = createHost();

    await saveProviderApiKeyInShell(state.host, 'openai');

    expect(state.host.providers.saveApiKey).toHaveBeenCalledWith('openai', 'sk-test');
    expect(state.getApiKeys().openai).toBe('sk-test');
    expect(state.toasts).toEqual([
      { level: 'info', message: 'OpenAI API key stored as a local fallback.' }
    ]);
  });

  it('clears all visible provider auth and resets local API key drafts', async () => {
    const state = createHost();

    await clearAllProviderAuthInShell(state.host);

    expect(state.host.providers.clearAuth).toHaveBeenCalledWith('openai');
    expect(state.host.providers.clearAuth).toHaveBeenCalledWith('ollama');
    expect(state.getApiKeys().openai).toBe('');
    expect(state.toasts).toEqual([
      { level: 'info', message: 'Providers disconnected.' }
    ]);
  });
});
