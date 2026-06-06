import { safeStorage } from 'electron';
import type { ProviderAdapter } from '../../providers/types';
import { RetiredProviderAdapter } from '../../providers/retired-adapter';
import type {
  ProviderAccount,
  ProviderAuthMode,
  ProviderDescriptor,
  ProviderId
} from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import { isRetiredProviderId, providerAuthBrand, providerCliLabel, providerDisplayName } from '../../shared/providers';
import { DatabaseService } from '../../storage/database';

const AUTH_POLLING_WINDOW_MS = 90_000;

export interface ProviderAuthServiceHost {
  db: DatabaseService;
  adapters: Record<ProviderId, ProviderAdapter>;
  emit(event: AppEvent): void;
  getProvider(providerId: ProviderId, options?: { forceRefresh?: boolean }): Promise<ProviderDescriptor>;
  resolveAvailableAuthMode(
    providerId: ProviderId,
    auth: { authState: ProviderAccount['authState']; authMode: ProviderAuthMode | null },
    account: ProviderAccount | null
  ): ProviderAuthMode | null;
  syncProviderAccount(
    providerId: ProviderId,
    account: ProviderAccount | null,
    auth: { authState: ProviderAccount['authState']; authMode: ProviderAuthMode | null }
  ): Promise<ProviderAccount | null>;
}

export class ProviderAuthService {
  private readonly pendingAuth = new Map<ProviderId, number>();
  private readonly authPolling = new Map<ProviderId, NodeJS.Timeout>();

  constructor(private readonly host: ProviderAuthServiceHost) {}

  dispose() {
    for (const timer of this.authPolling.values()) {
      clearInterval(timer);
    }
    this.authPolling.clear();
    this.pendingAuth.clear();
  }

  getPendingSince(providerId: ProviderId) {
    return this.pendingAuth.get(providerId);
  }

  clearPendingAuth(providerId: ProviderId) {
    this.pendingAuth.delete(providerId);
    const timer = this.authPolling.get(providerId);
    if (!timer) {
      return;
    }
    clearInterval(timer);
    this.authPolling.delete(providerId);
  }

  async startAuth(providerId: ProviderId, mode: 'cli' | 'api_key' | undefined, options: { force?: boolean } = {}) {
    const current = await this.host.getProvider(providerId);

    if (this.isRetiredProviderUnavailable(providerId)) {
      this.host.emit({ type: 'provider.updated', provider: current });
      return current;
    }

    if (!current.installed) {
      this.host.emit({ type: 'provider.updated', provider: current });
      return current;
    }

    if (mode === 'api_key') {
      this.host.emit({ type: 'provider.updated', provider: current });
      return current;
    }

    if (mode === 'cli' && current.authMode === 'cli' && current.authState === 'connected') {
      const provider = {
        ...current,
        message: `${providerCliLabel(providerId)} is already connected to ${providerAuthBrand(providerId)}.`
      };
      this.host.emit({ type: 'provider.updated', provider });
      return provider;
    }

    if (current.authState === 'checking' && !options.force) {
      this.host.emit({ type: 'provider.updated', provider: current });
      return current;
    }

    await this.host.adapters[providerId].startAuth(mode, current.cliPath);
    this.pendingAuth.set(providerId, Date.now());
    this.scheduleAuthPolling(providerId);

    const provider = await this.host.getProvider(providerId);
    this.host.emit({ type: 'provider.updated', provider });
    return provider;
  }

  async adoptAuth(providerId: ProviderId) {
    const current = await this.host.getProvider(providerId);
    if (this.isRetiredProviderUnavailable(providerId)) {
      this.host.emit({ type: 'provider.updated', provider: current });
      return current;
    }

    if (!current.installed) {
      this.host.emit({ type: 'provider.updated', provider: current });
      return current;
    }

    if (current.id === 'ollama') {
      this.host.emit({ type: 'provider.updated', provider: current });
      return current;
    }

    const storedAccount = this.host.db.getProviderAccount(providerId);
    const machineAuth = await this.host.adapters[providerId].getAuthState(storedAccount);

    if (machineAuth.authMode !== 'cli' || machineAuth.authState !== 'connected') {
      const provider = await this.host.getProvider(providerId, {
        forceRefresh: storedAccount?.authMode === 'api_key'
      });
      this.host.emit({ type: 'provider.updated', provider });
      return provider;
    }

    await this.host.syncProviderAccount(providerId, storedAccount, {
      authState: 'connected',
      authMode: 'cli',
      message: `${providerDisplayName(providerId)} is ready in Vicode.`
    });
    const provider = await this.host.getProvider(providerId);
    this.host.emit({ type: 'provider.updated', provider });
    return provider;
  }

  async clearAuth(providerId: ProviderId) {
    this.clearPendingAuth(providerId);
    if (this.isRetiredProviderUnavailable(providerId)) {
      const provider = await this.host.getProvider(providerId);
      this.host.emit({ type: 'provider.updated', provider });
      return provider;
    }

    const account = this.host.db.getProviderAccount(providerId);
    const auth = await this.host.adapters[providerId].getAuthState(account);
    const nextAuthMode = this.host.resolveAvailableAuthMode(providerId, auth, account);
    const encryptedApiKey = account?.encryptedApiKey ?? null;

    if (nextAuthMode !== null || encryptedApiKey) {
      this.host.db.clearProviderModelCache(providerId);
    }

    const next: ProviderAccount = {
      providerId,
      authState: 'disconnected',
      authMode: nextAuthMode,
      encryptedApiKey,
      updatedAt: new Date().toISOString()
    };

    if (next.authMode !== null || next.encryptedApiKey) {
      this.host.db.saveProviderAccount(account ? { ...account, ...next } : next);
    }

    const provider = await this.host.getProvider(providerId);
    this.host.emit({ type: 'provider.updated', provider });
    return provider;
  }

  async saveApiKey(providerId: ProviderId, apiKey: string) {
    this.clearPendingAuth(providerId);
    if (this.isRetiredProviderUnavailable(providerId)) {
      const provider = await this.host.getProvider(providerId);
      this.host.emit({ type: 'provider.updated', provider });
      return provider;
    }
    if (providerId === 'ollama') {
      const provider = await this.host.getProvider(providerId);
      this.host.emit({
        type: 'provider.updated',
        provider: {
          ...provider,
          message: 'Ollama API keys are retired in this Vicode beta. Use the local Ollama runtime, or add API keys through Custom API.'
        }
      });
      return provider;
    }

    const adapter = this.host.adapters[providerId];
    const previous = this.host.db.getProviderAccount(providerId);
    const encrypted = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(apiKey).toString('base64')
      : Buffer.from(apiKey, 'utf8').toString('base64');
    const updatedAt = new Date().toISOString();
    const provisionalAccount: ProviderAccount = {
      providerId,
      authState: previous?.authState ?? 'disconnected',
      authMode: 'api_key',
      encryptedApiKey: encrypted,
      updatedAt
    };
    const resolvedAuth = await adapter.getAuthState(provisionalAccount);
    const nextAccount: ProviderAccount = {
      providerId,
      authState: resolvedAuth.authState,
      authMode: resolvedAuth.authMode,
      encryptedApiKey: encrypted,
      updatedAt: provisionalAccount.updatedAt
    };
    if (previous?.authMode !== nextAccount.authMode) {
      this.host.db.clearProviderModelCache(providerId);
    }
    this.host.db.saveProviderAccount(nextAccount);
    const provider = await this.host.getProvider(providerId, { forceRefresh: nextAccount.authMode === 'api_key' });
    this.host.emit({ type: 'provider.updated', provider });
    return provider;
  }

  private scheduleAuthPolling(providerId: ProviderId) {
    this.clearPendingAuth(providerId);
    this.pendingAuth.set(providerId, Date.now());
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      void this.host.getProvider(providerId)
        .then((provider) => {
          this.host.emit({ type: 'provider.updated', provider });
          if (provider.authState !== 'checking' || attempts >= 30) {
            this.clearPendingAuth(providerId);
          }
        })
        .catch(() => {
          if (attempts >= 30) {
            this.clearPendingAuth(providerId);
          }
        });
    }, 2_500);
    this.authPolling.set(providerId, timer);
  }

  private isRetiredProviderUnavailable(providerId: ProviderId) {
    return providerId === 'qwen'
      || providerId === 'kimi'
      || (isRetiredProviderId(providerId) && this.host.adapters[providerId] instanceof RetiredProviderAdapter);
  }
}
