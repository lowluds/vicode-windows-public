import type {
  CustomProviderSettings,
  CustomProviderSettingsSaveInput,
  OllamaPullProgress,
  ProviderAuthMode,
  ProviderDescriptor,
  ProviderId
} from '../../shared/domain';
import type {
  OllamaModelMutationResult,
  OllamaRuntimeSnapshot
} from '../../shared/ipc';
import {
  createProviderRecord,
  isRetiredProviderId,
  providerDisplayName
} from '../../shared/providers';
import { formatUserErrorMessage } from './error-format';
import { resolveProviderModelId } from './provider-defaults';
import { surfaceProviders } from './thread-presentation';

type ToastLevel = 'info' | 'warning' | 'error';
type StateSetter<T> = (value: T | ((current: T) => T)) => void;

export interface AppShellProviderActionsHost {
  providers: {
    startAuth(providerId: ProviderId, mode?: ProviderAuthMode, options?: { force?: boolean }): Promise<ProviderDescriptor>;
    adoptAuth(providerId: ProviderId): Promise<ProviderDescriptor>;
    clearAuth(providerId: ProviderId): Promise<ProviderDescriptor>;
    refresh(providerId: ProviderId): Promise<ProviderDescriptor>;
    list(): Promise<ProviderDescriptor[]>;
    listCustom(): Promise<CustomProviderSettings[]>;
    saveCustom(input: CustomProviderSettingsSaveInput): Promise<CustomProviderSettings>;
    removeCustom(providerId: string): Promise<void>;
    saveApiKey(providerId: ProviderId, apiKey: string): Promise<ProviderDescriptor>;
  };
  ollamaRuntime: {
    getStatus(): Promise<OllamaRuntimeSnapshot>;
    start(): Promise<OllamaRuntimeSnapshot>;
    stop(): Promise<OllamaRuntimeSnapshot>;
    pullModel(model: string): Promise<OllamaModelMutationResult>;
    deleteModel(model: string): Promise<OllamaModelMutationResult>;
  };
  installPollingTimers: Partial<Record<ProviderId, number>>;
  getVisibleProviders(): ProviderDescriptor[];
  getComposerProviderState(): {
    providerId: ProviderId;
    modelId: string;
  };
  getApiKey(providerId: ProviderId): string;
  now(): number;
  openInstallUrl(url: string): void;
  setInstallPollingInterval(callback: () => void, delayMs: number): number;
  clearInstallPollingInterval(timerId: number): void;
  setProviders: StateSetter<ProviderDescriptor[]>;
  setCustomProviders(value: CustomProviderSettings[]): void;
  setApiKeys: StateSetter<Record<ProviderId, string>>;
  setComposerModelId(providerId: ProviderId, modelId: string): void;
  setOllamaPullProgress(value: OllamaPullProgress | null): void;
  setOllamaRuntimeStatus(value: OllamaRuntimeSnapshot | null): void;
  showToast(level: ToastLevel, message: string): void;
}

function updateProvider(
  host: AppShellProviderActionsHost,
  provider: ProviderDescriptor
) {
  host.setProviders((current) => current.map((item) => (item.id === provider.id ? provider : item)));
}

export async function connectProviderInShell(
  host: AppShellProviderActionsHost,
  providerId: ProviderId,
  mode?: ProviderAuthMode,
  options?: { force?: boolean }
) {
  if (providerId === 'ollama') {
    const snapshot = await host.ollamaRuntime.start();
    host.setOllamaRuntimeStatus(snapshot);
    const provider = await host.providers.refresh(providerId);
    updateProvider(host, provider);
    host.showToast(
      'info',
      snapshot.managedByApp
        ? 'Local Ollama is starting in Vicode.'
        : provider.message ?? 'Local Ollama start requested.'
    );
    return;
  }

  const provider = await host.providers.startAuth(providerId, mode, options);
  updateProvider(host, provider);
  host.showToast(
    provider.authState === 'missing_cli' ? 'warning' : 'info',
    provider.message ?? `${provider.label} auth flow started.`
  );
}

export async function adoptProviderAuthInShell(
  host: AppShellProviderActionsHost,
  providerId: ProviderId
) {
  const provider = await host.providers.adoptAuth(providerId);
  updateProvider(host, provider);
  host.showToast(
    provider.authState === 'connected' ? 'info' : 'warning',
    provider.message ?? `${provider.label} setup updated.`
  );
}

export function providerInstallUrl(providerId: ProviderId) {
  return providerId === 'ollama' ? 'https://docs.ollama.com/windows' : null;
}

export function beginProviderInstallInShell(
  host: AppShellProviderActionsHost,
  providerId: ProviderId
) {
  if (isRetiredProviderId(providerId) || providerId !== 'ollama') {
    host.showToast('warning', `${providerDisplayName(providerId)} setup is retired for this beta.`);
    return;
  }

  const installUrl = providerInstallUrl(providerId);
  if (!installUrl) {
    host.showToast('warning', `${providerDisplayName(providerId)} does not have an install flow in this beta.`);
    return;
  }

  host.openInstallUrl(installUrl);
  const providerName = providerDisplayName(providerId);
  host.showToast(
    'info',
    providerId === 'ollama'
      ? 'Install Ollama, then return to Vicode.'
      : `Install ${providerName}, then return to Vicode.`
  );

  const existingTimer = host.installPollingTimers[providerId];
  if (existingTimer) {
    host.clearInstallPollingInterval(existingTimer);
  }

  const startedAt = host.now();
  const timer = host.setInstallPollingInterval(() => {
    void host.providers
      .refresh(providerId)
      .then((provider) => {
        updateProvider(host, provider);

        if (!provider.installed && host.now() - startedAt < 60_000) {
          return;
        }

        host.clearInstallPollingInterval(timer);
        delete host.installPollingTimers[providerId];

        if (provider.installed) {
          host.showToast(
            'info',
            providerId === 'ollama'
              ? provider.authState === 'connected'
                ? 'Ollama is installed and ready.'
                : 'Ollama was found. Start it or refresh to load models.'
              : provider.authState === 'connected'
                ? `${providerName} was found and is ready.`
                : `${providerName} was found. You can sign in now.`
          );
        }
      })
      .catch(() => {
        if (host.now() - startedAt >= 60_000) {
          host.clearInstallPollingInterval(timer);
          delete host.installPollingTimers[providerId];
        }
      });
  }, 2500);

  host.installPollingTimers[providerId] = timer;
}

export async function clearProviderAuthInShell(
  host: AppShellProviderActionsHost,
  providerId: ProviderId
) {
  const provider = await host.providers.clearAuth(providerId);
  updateProvider(host, provider);
  host.setApiKeys((current) => ({ ...current, [providerId]: '' }));
  host.showToast('info', `${provider.label} disconnected.`);
}

export async function refreshProviderInShell(
  host: AppShellProviderActionsHost,
  providerId: ProviderId
) {
  const provider = await host.providers.refresh(providerId);
  updateProvider(host, provider);
  if (providerId === 'ollama') {
    await refreshOllamaRuntimeStatusInShell(host);
  }
  const composer = host.getComposerProviderState();
  const previousModelId = composer.providerId === provider.id ? composer.modelId : null;
  const nextModelId = previousModelId
    ? resolveProviderModelId([provider], provider.id, previousModelId, { promoteStaleDefault: true })
    : null;
  if (nextModelId) {
    host.setComposerModelId(provider.id, nextModelId);
  }
  if (previousModelId && nextModelId && previousModelId !== nextModelId) {
    host.showToast(
      'info',
      `${provider.label} switched to ${provider.models.find((model) => model.id === nextModelId)?.label ?? nextModelId}.`
    );
    return;
  }
  host.showToast('info', `${provider.label} refreshed.`);
}

export async function refreshOllamaRuntimeStatusInShell(host: AppShellProviderActionsHost) {
  try {
    host.setOllamaRuntimeStatus(await host.ollamaRuntime.getStatus());
  } catch {
    host.setOllamaRuntimeStatus(null);
  }
}

export async function pullOllamaModelInShell(
  host: AppShellProviderActionsHost,
  model: string
) {
  const trimmedModel = model.trim();
  if (!trimmedModel) {
    host.showToast('warning', 'Model name is required.');
    return;
  }

  try {
    host.setOllamaPullProgress(null);
    const result = await host.ollamaRuntime.pullModel(trimmedModel);
    const provider = await host.providers.refresh('ollama');
    updateProvider(host, provider);
    host.showToast(
      'info',
      `Pulled ${result.model}. ${result.models.length} local model${result.models.length === 1 ? '' : 's'} available.`
    );
  } catch (error) {
    host.showToast('error', formatUserErrorMessage(error, `Unable to pull ${trimmedModel}.`));
  } finally {
    host.setOllamaPullProgress(null);
  }
}

export async function deleteOllamaModelInShell(
  host: AppShellProviderActionsHost,
  model: string
) {
  const trimmedModel = model.trim();
  if (!trimmedModel) {
    host.showToast('warning', 'Model name is required.');
    return;
  }

  try {
    const result = await host.ollamaRuntime.deleteModel(trimmedModel);
    const provider = await host.providers.refresh('ollama');
    updateProvider(host, provider);
    host.showToast(
      'info',
      `Deleted ${result.model}. ${result.models.length} local model${result.models.length === 1 ? '' : 's'} remain.`
    );
  } catch (error) {
    host.showToast('error', formatUserErrorMessage(error, `Unable to delete ${trimmedModel}.`));
  }
}

export async function stopOllamaRuntimeInShell(host: AppShellProviderActionsHost) {
  try {
    const snapshot = await host.ollamaRuntime.stop();
    host.setOllamaRuntimeStatus(snapshot);
    const provider = await host.providers.refresh('ollama');
    updateProvider(host, provider);
    host.showToast(
      'info',
      snapshot.reachable
        ? 'Ollama is still reachable outside Vicode control.'
        : 'Stopped the Vicode-managed Ollama runtime.'
    );
  } catch (error) {
    host.showToast('error', formatUserErrorMessage(error, 'Unable to stop the Ollama local runtime.'));
  }
}

export async function clearAllProviderAuthInShell(host: AppShellProviderActionsHost) {
  const clearedProviders = await Promise.all(
    host.getVisibleProviders().map((provider) => host.providers.clearAuth(provider.id))
  );
  host.setProviders((current) =>
    current.map((item) => clearedProviders.find((provider) => provider.id === item.id) ?? item)
  );
  host.setApiKeys(createProviderRecord(() => ''));
  host.showToast('info', 'Providers disconnected.');
}

export async function refreshProvidersInShell(host: AppShellProviderActionsHost) {
  host.setProviders(surfaceProviders(await host.providers.list()));
}

export async function refreshCustomProvidersInShell(host: AppShellProviderActionsHost) {
  host.setCustomProviders(await host.providers.listCustom());
}

export async function saveCustomProviderInShell(
  host: AppShellProviderActionsHost,
  input: CustomProviderSettingsSaveInput
) {
  const saved = await host.providers.saveCustom(input);
  host.setCustomProviders(await host.providers.listCustom());
  await refreshProvidersInShell(host);
  host.showToast('info', `${saved.name} saved.`);
  return saved;
}

export async function deleteCustomProviderInShell(
  host: AppShellProviderActionsHost,
  providerId: string
) {
  await host.providers.removeCustom(providerId);
  host.setCustomProviders(await host.providers.listCustom());
  await refreshProvidersInShell(host);
  host.showToast('info', 'Custom provider removed.');
}

export async function saveProviderApiKeyInShell(
  host: AppShellProviderActionsHost,
  providerId: ProviderId
) {
  const trimmedApiKey = host.getApiKey(providerId).trim();
  if (!trimmedApiKey) {
    host.showToast('warning', 'API key is required.');
    return;
  }
  const provider = await host.providers.saveApiKey(providerId, trimmedApiKey);
  updateProvider(host, provider);
  host.setApiKeys((current) => ({ ...current, [providerId]: trimmedApiKey }));
  host.showToast(
    'info',
    providerId === 'ollama'
      ? 'Ollama API keys are retired in this beta. Use local Ollama or Custom API.'
      : `${provider.label} API key stored as a local fallback.`
  );
}
