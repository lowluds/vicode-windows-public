import type { ProviderAdapter } from '../../providers/types';
import type {
  ImageAttachment,
  ProviderAccount,
  ProviderDescriptor,
  ProviderId,
  ProviderModel,
  ProviderModelSource,
  ProviderQuotaStatus
} from '../../shared/domain';
import {
  createProviderModelFromId,
  filterUnsupportedProviderModels,
  resolveProviderModelAlias,
  sanitizeDiscoveredModels
} from '../../providers/catalog';
import {
  selectPreferredOllamaModel,
  selectPreferredOllamaVisionModel
} from '../../shared/providers';
import { DatabaseService } from '../../storage/database';

const MODEL_CACHE_TTL_MS = 1000 * 60 * 60 * 12;

const GEMINI_QUOTA_PROBE_ORDER = [
  'gemini-3.1-pro-preview',
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
] as const;

export interface ResolvedProviderModels {
  models: ProviderModel[];
  source: ProviderModelSource;
  updatedAt: string | null;
  canLiveDiscoverModels: boolean;
}

export interface ResolvedProviderQuota {
  quota: ProviderQuotaStatus | null;
}

export interface ProviderImageAttachmentRouting {
  needsInternalReview: boolean;
  reviewModelId: string | null;
  passImagesToExecution: boolean;
}

export interface ProviderModelServiceHost {
  db: DatabaseService;
  decryptApiKey(encrypted: string): string;
  getProvider(providerId: ProviderId, options?: { forceRefresh?: boolean }): Promise<ProviderDescriptor>;
}

export class ProviderModelService {
  constructor(private readonly host: ProviderModelServiceHost) {}

  async getResolvedModels(
    providerId: ProviderId,
    adapter: ProviderAdapter,
    input: {
      account: ProviderAccount | null;
      authMode: ProviderDescriptor['authMode'];
      cliPath: string | null;
      forceRefresh: boolean;
    }
  ): Promise<ResolvedProviderModels> {
    const fallbackModels = adapter.listStaticModels();
    const cached = this.host.db.getProviderModelCache(providerId);
    const apiKey = input.account?.encryptedApiKey ? this.host.decryptApiKey(input.account.encryptedApiKey) : null;
    const runtimeDiscoveryAllowed = input.authMode === 'cli' || (providerId === 'ollama' && input.authMode !== 'api_key');

    if (runtimeDiscoveryAllowed) {
      const discovered = await adapter.discoverRuntimeModels({
        account: input.account,
        authMode: input.authMode,
        apiKey,
        cliPath: input.cliPath
      });

      if (discovered !== null) {
        if (discovered.length > 0) {
          this.host.db.replaceProviderModels(providerId, discovered, 'runtime');
        } else {
          this.host.db.clearProviderModelCache(providerId);
        }

        return {
          models: this.resolveProviderModels(providerId, fallbackModels, discovered),
          source: 'runtime',
          updatedAt: new Date().toISOString(),
          canLiveDiscoverModels: true
        };
      }

      if (cached.models.length > 0) {
        return {
          models: this.resolveProviderModels(providerId, fallbackModels, cached.models),
          source: 'cache',
          updatedAt: cached.updatedAt,
          canLiveDiscoverModels: false
        };
      }

      return {
        models: fallbackModels,
        source: 'fallback',
        updatedAt: null,
        canLiveDiscoverModels: false
      };
    }

    if (input.authMode === 'api_key') {
      const shouldRefresh = input.forceRefresh || cached.models.length === 0 || this.isModelCacheStale(cached.updatedAt);

      if (shouldRefresh) {
        const discovered = await adapter.discoverApiModels({
          account: input.account,
          authMode: input.authMode,
          apiKey,
          cliPath: input.cliPath
        });

        if (discovered && discovered.length > 0) {
          this.host.db.replaceProviderModels(providerId, discovered, 'api');
          return {
            models: this.resolveProviderModels(providerId, fallbackModels, discovered),
            source: 'api',
            updatedAt: new Date().toISOString(),
            canLiveDiscoverModels: true
          };
        }
      }

      if (cached.models.length > 0) {
        return {
          models: this.resolveProviderModels(providerId, fallbackModels, cached.models),
          source: 'cache',
          updatedAt: cached.updatedAt,
          canLiveDiscoverModels: true
        };
      }
    } else if (cached.models.length > 0) {
      return {
        models: this.resolveProviderModels(providerId, fallbackModels, cached.models),
        source: 'cache',
        updatedAt: cached.updatedAt,
        canLiveDiscoverModels: false
      };
    }

    return {
      models: fallbackModels,
      source: 'fallback',
      updatedAt: null,
      canLiveDiscoverModels: input.authMode === 'api_key'
    };
  }

  async getResolvedQuota(
    providerId: ProviderId,
    adapter: ProviderAdapter,
    input: {
      account: ProviderAccount | null;
      authMode: ProviderDescriptor['authMode'];
      cliPath: string | null;
      modelId: string | null;
    }
  ): Promise<ResolvedProviderQuota> {
    if (!adapter.getQuotaStatus || !input.authMode) {
      return { quota: null };
    }

    const apiKey = input.account?.encryptedApiKey ? this.host.decryptApiKey(input.account.encryptedApiKey) : null;

    try {
      const quota = await adapter.getQuotaStatus({
        account: input.account,
        authMode: input.authMode,
        apiKey,
        cliPath: input.cliPath,
        modelId: input.modelId
      });
      return { quota };
    } catch {
      return { quota: null };
    }
  }

  resolveQuotaProbeModelId(providerId: ProviderId, models: ProviderModel[]) {
    if (models.length === 0) {
      return null;
    }

    if (providerId === 'gemini') {
      for (const modelId of GEMINI_QUOTA_PROBE_ORDER) {
        if (models.some((model) => model.id === modelId)) {
          return modelId;
        }
      }
    }

    return providerId === 'ollama' ? selectPreferredOllamaModel(models)?.id ?? null : models[0]?.id ?? null;
  }

  mergeQuotaModels(providerId: ProviderId, models: ProviderModel[], quota: ProviderQuotaStatus | null) {
    if (!quota?.buckets.length) {
      return models;
    }

    const extras = quota.buckets
      .map((bucket) => createProviderModelFromId(providerId, bucket.modelId))
      .filter((value): value is ProviderModel => Boolean(value));

    if (extras.length === 0) {
      return models;
    }

    return filterUnsupportedProviderModels(
      providerId,
      sanitizeDiscoveredModels(providerId, [...models, ...extras], {
        preserveInputOrder: providerId === 'gemini' || providerId === 'ollama'
      })
    );
  }

  resolveProviderModels(providerId: ProviderId, fallbackModels: ProviderModel[], cachedModels: ProviderModel[]) {
    if (providerId === 'ollama' && cachedModels.length === 0) {
      return [];
    }

    if (cachedModels.length > 0) {
      const modelPool = providerId === 'openai' ? [...fallbackModels, ...cachedModels] : cachedModels;
      return filterUnsupportedProviderModels(
        providerId,
        sanitizeDiscoveredModels(providerId, modelPool, {
          preserveInputOrder: providerId === 'gemini' || providerId === 'ollama'
        })
      );
    }

    return filterUnsupportedProviderModels(providerId, fallbackModels);
  }

  async resolveUsableModelId(providerId: ProviderId, requestedModelId: string) {
    const normalizedModelId = resolveProviderModelAlias(providerId, requestedModelId);
    const provider = await this.host.getProvider(providerId);
    if (provider.models.some((model) => model.id === normalizedModelId)) {
      return normalizedModelId;
    }

    if (providerId === 'ollama') {
      return selectPreferredOllamaModel(provider.models)?.id ?? normalizedModelId;
    }

    return provider.models[0]?.id ?? normalizedModelId;
  }

  async resolveExecutionModelId(
    providerId: ProviderId,
    requestedModelId: string,
    _imageAttachments: readonly ImageAttachment[]
  ) {
    const normalizedModelId = resolveProviderModelAlias(providerId, requestedModelId);
    const provider = await this.host.getProvider(providerId);

    if (provider.models.some((model) => model.id === normalizedModelId)) {
      return normalizedModelId;
    }

    if (providerId === 'ollama') {
      return selectPreferredOllamaModel(provider.models)?.id ?? normalizedModelId;
    }

    return provider.models[0]?.id ?? normalizedModelId;
  }

  async resolveImageAttachmentRouting(
    providerId: ProviderId,
    executionModelId: string,
    imageAttachments: readonly ImageAttachment[]
  ): Promise<ProviderImageAttachmentRouting> {
    if (providerId !== 'ollama' || imageAttachments.length === 0) {
      return {
        needsInternalReview: false,
        reviewModelId: null,
        passImagesToExecution: true
      };
    }

    const normalizedModelId = resolveProviderModelAlias(providerId, executionModelId);
    const provider = await this.host.getProvider(providerId);
    const executionModel = provider.models.find((model) => model.id === normalizedModelId) ?? null;
    if (executionModel?.supportsVision) {
      return {
        needsInternalReview: false,
        reviewModelId: null,
        passImagesToExecution: true
      };
    }

    const reviewModel = selectPreferredOllamaVisionModel(provider.models);
    return {
      needsInternalReview: true,
      reviewModelId: reviewModel?.id ?? null,
      passImagesToExecution: false
    };
  }

  private isModelCacheStale(updatedAt: string | null) {
    if (!updatedAt) {
      return true;
    }

    return Date.now() - new Date(updatedAt).getTime() > MODEL_CACHE_TTL_MS;
  }
}
