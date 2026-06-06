import type { ProviderAdapter } from '../../providers/types';
import type {
  ImageAttachment,
  ProviderAccount,
  ProviderDescriptor,
  ProviderId,
  ProviderModel,
  ProviderModelSource
} from '../../shared/domain';
import { decodeCustomProviderModelId } from '../../shared/custom-provider-routing';
import {
  filterUnsupportedProviderModels,
  resolveProviderModelAlias,
  sanitizeDiscoveredModels
} from '../../providers/catalog';
import {
  decodeOllamaModelId,
  encodeOllamaLocalModelId,
  isOllamaLocalModelId,
  selectPreferredOllamaModel,
  selectPreferredOllamaVisionModel
} from '../../shared/providers';
import { DatabaseService } from '../../storage/database';

const MODEL_CACHE_TTL_MS = 1000 * 60 * 60 * 12;

export interface ResolvedProviderModels {
  models: ProviderModel[];
  source: ProviderModelSource;
  updatedAt: string | null;
  canLiveDiscoverModels: boolean;
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
    const runtimeDiscoveryAllowed = input.authMode === 'cli' || providerId === 'ollama';

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
    if (providerId === 'openai_compatible') {
      return this.resolveOpenAICompatibleExecutionModelId(requestedModelId);
    }

    const normalizedModelId =
      providerId === 'ollama' && isOllamaLocalModelId(requestedModelId)
        ? requestedModelId.trim()
        : resolveProviderModelAlias(providerId, requestedModelId);
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
    if (providerId === 'openai_compatible') {
      return this.resolveOpenAICompatibleExecutionModelId(requestedModelId);
    }

    const normalizedModelId =
      providerId === 'ollama' && isOllamaLocalModelId(requestedModelId)
        ? requestedModelId.trim()
        : resolveProviderModelAlias(providerId, requestedModelId);
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

    const normalizedModelId =
      providerId === 'ollama'
        ? decodeOllamaModelId(executionModelId)
        : resolveProviderModelAlias(providerId, executionModelId);
    const provider = await this.host.getProvider(providerId);
    const executionModel =
      provider.models.find((model) => model.id === executionModelId) ??
      provider.models.find((model) => model.id === normalizedModelId) ??
      null;
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
      reviewModelId: reviewModel ? decodeOllamaModelId(reviewModel.id) : null,
      passImagesToExecution: false
    };
  }

  private isModelCacheStale(updatedAt: string | null) {
    if (!updatedAt) {
      return true;
    }

    return Date.now() - new Date(updatedAt).getTime() > MODEL_CACHE_TTL_MS;
  }

  private resolveOpenAICompatibleExecutionModelId(requestedModelId: string) {
    const route = decodeCustomProviderModelId(requestedModelId);
    if (route) {
      return route.modelId;
    }

    return requestedModelId.trim();
  }
}
