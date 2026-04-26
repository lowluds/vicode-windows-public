import type { ProviderAdapter } from '../../providers/types';
import type {
  ProviderAccount,
  ProviderAuthMode,
  ProviderDescriptor,
  ProviderId
} from '../../shared/domain';
import {
  providerCapabilities,
  providerCliLabel,
  providerDisplayName
} from '../../shared/providers';
import { DatabaseService } from '../../storage/database';
import type { ProviderAuthService } from './provider-auth-service';
import type { ProviderModelService } from './provider-model-service';

export interface ProviderDescriptorServiceHost {
  db: DatabaseService;
  adapters: Record<ProviderId, ProviderAdapter>;
  authService: Pick<ProviderAuthService, 'getPendingSince' | 'clearPendingAuth'>;
  modelService: Pick<
    ProviderModelService,
    'getResolvedModels' | 'getResolvedQuota' | 'resolveQuotaProbeModelId' | 'mergeQuotaModels'
  >;
}

export class ProviderDescriptorService {
  constructor(private readonly host: ProviderDescriptorServiceHost) {}

  async listProviders() {
    return Promise.all(
      (Object.keys(this.host.adapters) as ProviderId[]).map((providerId) => this.getProvider(providerId))
    );
  }

  async getProvider(providerId: ProviderId, options: { forceRefresh?: boolean } = {}): Promise<ProviderDescriptor> {
    const adapter = this.host.adapters[providerId];
    const install = await adapter.detectInstall();
    const storedAccount = this.host.db.getProviderAccount(providerId);
    const machineAuth = await adapter.getAuthState(storedAccount);
    const availableAuthMode = this.resolveAvailableAuthMode(machineAuth, storedAccount);
    const ollamaCloudConfigured = providerId === 'ollama' && availableAuthMode === 'api_key';

    if (!install.installed && !ollamaCloudConfigured) {
      this.host.authService.clearPendingAuth(providerId);
      return {
        id: providerId,
        label: adapter.label,
        installed: false,
        cliPath: install.cliPath,
        authState: providerId === 'ollama' ? 'disconnected' : 'missing_cli',
        authMode: availableAuthMode,
        models: adapter.listStaticModels(),
        modelSource: 'fallback',
        modelsUpdatedAt: null,
        canLiveDiscoverModels: false,
        capabilities: providerCapabilities(providerId),
        plannerPolicy: adapter.getPlannerCapability(),
        quota: null,
        message: this.getMissingCliMessage(providerId, availableAuthMode)
      };
    }

    const localDisconnect = this.isLocallyDisconnected(storedAccount);
    const preserveLocalDisconnect = localDisconnect && availableAuthMode !== null;
    const auth = preserveLocalDisconnect
      ? {
          authState: 'disconnected' as const,
          authMode: availableAuthMode,
          message: this.getLocalDisconnectMessage(providerId, availableAuthMode)
        }
      : this.resolveVisibleProviderAuth(providerId, storedAccount, machineAuth);
    const account = this.syncProviderAccount(providerId, storedAccount, auth);
    const pendingSince = this.host.authService.getPendingSince(providerId);
    const pendingFresh = pendingSince !== undefined && Date.now() - pendingSince < 90_000;

    if (machineAuth.authState === 'connected' && auth.authState === 'connected') {
      this.host.authService.clearPendingAuth(providerId);
    } else if (pendingSince !== undefined && !pendingFresh) {
      this.host.authService.clearPendingAuth(providerId);
    }

    const isChecking = pendingFresh && auth.authState !== 'connected';
    const resolvedModels = await this.host.modelService.getResolvedModels(providerId, adapter, {
      account,
      authMode: preserveLocalDisconnect ? null : auth.authMode,
      cliPath: install.cliPath,
      forceRefresh: options.forceRefresh ?? false
    });
    const resolvedQuota = await this.host.modelService.getResolvedQuota(providerId, adapter, {
      account,
      authMode: preserveLocalDisconnect ? null : auth.authMode,
      cliPath: install.cliPath,
      modelId: this.host.modelService.resolveQuotaProbeModelId(providerId, resolvedModels.models)
    });
    const visibleModels = this.host.modelService.mergeQuotaModels(
      providerId,
      resolvedModels.models,
      resolvedQuota.quota
    );

    return {
      id: providerId,
      label: adapter.label,
      installed: install.installed || ollamaCloudConfigured,
      cliPath: install.cliPath,
      authState: preserveLocalDisconnect ? 'disconnected' : isChecking ? 'checking' : auth.authState,
      authMode: preserveLocalDisconnect ? availableAuthMode : auth.authMode,
      models: visibleModels,
      modelSource: resolvedModels.source,
      modelsUpdatedAt: resolvedModels.updatedAt,
      canLiveDiscoverModels: resolvedModels.canLiveDiscoverModels,
      capabilities: providerCapabilities(providerId),
      plannerPolicy: adapter.getPlannerCapability(),
      quota: resolvedQuota.quota,
      message: isChecking
        ? providerId === 'ollama'
          ? 'Waiting for the Ollama local runtime to start...'
          : providerId === 'gemini'
            ? 'Waiting for Gemini browser sign-in to complete...'
            : `Waiting for ${adapter.label} sign-in to complete...`
        : auth.message
    };
  }

  resolveAvailableAuthMode(
    auth: { authState: ProviderAccount['authState']; authMode: ProviderAuthMode | null },
    account: ProviderAccount | null
  ) {
    if (auth.authMode) {
      return auth.authMode;
    }
    if (account?.encryptedApiKey) {
      return 'api_key' as const;
    }
    return null;
  }

  syncProviderAccount(
    providerId: ProviderId,
    account: ProviderAccount | null,
    auth: { authState: ProviderAccount['authState']; authMode: ProviderAuthMode | null }
  ) {
    const nextEncryptedApiKey = account?.encryptedApiKey ?? null;
    const nextAuthMode = auth.authMode;
    const nextAuthState = auth.authState;

    if (!account && nextAuthMode === null && !nextEncryptedApiKey) {
      return null;
    }

    if (!account && nextAuthMode === 'cli' && nextAuthState === 'detected' && !nextEncryptedApiKey) {
      return null;
    }

    const next: ProviderAccount = {
      providerId,
      authState: nextAuthState,
      authMode: nextAuthMode,
      encryptedApiKey: nextEncryptedApiKey,
      updatedAt: new Date().toISOString()
    };

    if (account?.authMode !== next.authMode) {
      this.host.db.clearProviderModelCache(providerId);
    }

    if (
      !account ||
      account.authState !== next.authState ||
      account.authMode !== next.authMode ||
      account.encryptedApiKey !== next.encryptedApiKey
    ) {
      this.host.db.saveProviderAccount(next);
    }

    return next;
  }

  private isLocallyDisconnected(account: ProviderAccount | null) {
    return Boolean(account && account.authState === 'disconnected' && (account.authMode !== null || account.encryptedApiKey));
  }

  private resolveVisibleProviderAuth(
    providerId: ProviderId,
    account: ProviderAccount | null,
    machineAuth: { authState: ProviderAccount['authState']; authMode: ProviderAuthMode | null; message?: string }
  ) {
    if (machineAuth.authMode === 'api_key') {
      return machineAuth;
    }

    if (machineAuth.authMode !== 'cli') {
      return {
        authState: machineAuth.authState,
        authMode: account?.encryptedApiKey ? 'api_key' : null,
        message: machineAuth.message
      };
    }

    const explicitlyConnected = account?.authMode === 'cli' && account.authState === 'connected';

    if (machineAuth.authState === 'connected') {
      if (explicitlyConnected) {
        return machineAuth;
      }

      return {
        authState: 'detected' as const,
        authMode: 'cli' as const,
        message: this.getDetectedCliMessage(providerId)
      };
    }

    if (machineAuth.authState === 'detected') {
      return {
        authState: 'detected' as const,
        authMode: 'cli' as const,
        message: machineAuth.message ?? this.getDetectedCliMessage(providerId)
      };
    }

    return {
      authState: 'disconnected' as const,
      authMode: null,
      message: machineAuth.message
    };
  }

  private getLocalDisconnectMessage(providerId: ProviderId, authMode: ProviderAuthMode | null) {
    if (authMode === 'cli') {
      return `${providerDisplayName(providerId)} sign-in is still available on this machine, but disconnected in Vicode. Reconnect it here or open the official CLI sign-in flow again.`;
    }

    if (authMode === 'api_key') {
      return `A local ${providerDisplayName(providerId)} API key is still stored for this app, but ${providerDisplayName(providerId)} is disconnected in Vicode. Reconnect in Vicode to use it here.`;
    }

    return `${providerDisplayName(providerId)} is disconnected in Vicode.`;
  }

  private getDetectedCliMessage(providerId: ProviderId) {
    return `Found an existing ${providerCliLabel(providerId)} sign-in on this PC. Choose Connect to use it in Vicode, or open the official sign-in flow again.`;
  }

  private getMissingCliMessage(providerId: ProviderId, authMode: ProviderAuthMode | null) {
    if (providerId === 'ollama') {
      if (authMode === 'api_key') {
        return 'An Ollama cloud API key is stored locally. You can use hosted Ollama models without installing the local runtime.';
      }

      if (authMode === 'cli') {
        return 'Ollama state was detected on this machine, but the local runtime is not runnable from Vicode. Install or repair the Ollama runtime and refresh.';
      }

      return 'Ollama local runtime is not installed. Install it for local models, or save an Ollama API key in Vicode to use hosted models.';
    }

    if (authMode === 'cli') {
      return `${providerDisplayName(providerId)} sign-in was detected on this machine, but the ${providerCliLabel(providerId)} is not runnable from Vicode. Install or repair the CLI and refresh.`;
    }

    if (authMode === 'api_key') {
      return `A ${providerDisplayName(providerId)} API key is stored locally, but ${providerCliLabel(providerId)} is still required to run ${providerDisplayName(providerId)} in Vicode.`;
    }

    return `${providerCliLabel(providerId)} is not installed. Install it before signing in.`;
  }
}
