import { resolveProviderModelAlias } from '../../providers/catalog';
import type { ProviderDescriptor, ProviderId } from '../../shared/domain';
import {
  getProviderMetadata,
  isSurfacedProviderId,
  providerCanRunInComposer,
  selectPreferredOllamaModel
} from '../../shared/providers';

interface ResolveProviderModelOptions {
  promoteStaleDefault?: boolean;
}

function shouldPromoteManagedDefault(provider: ProviderDescriptor, modelId: string) {
  if (provider.id === 'ollama') {
    return false;
  }

  if (provider.id === 'openai') {
    return /^gpt-\d+(?:\.\d+)?$/iu.test(modelId);
  }

  return modelId === getProviderMetadata(provider.id).defaultModelId;
}

export function resolveDefaultProviderId(
  providers: ProviderDescriptor[],
  preferredProviderId: ProviderId
): ProviderId {
  const availableProviders = providers.filter(
    (provider) => isSurfacedProviderId(provider.id) && providerCanRunInComposer(provider)
  );

  if (availableProviders.some((provider) => provider.id === preferredProviderId)) {
    return preferredProviderId;
  }

  if (availableProviders.some((provider) => provider.id === 'ollama')) {
    return 'ollama';
  }

  if (availableProviders.some((provider) => provider.id === 'openai_compatible')) {
    return 'openai_compatible';
  }

  const surfacedProviders = providers.filter((provider) => isSurfacedProviderId(provider.id));
  if (surfacedProviders.some((provider) => provider.id === preferredProviderId)) {
    return preferredProviderId;
  }

  return surfacedProviders.find((provider) => provider.id === 'ollama')?.id
    ?? surfacedProviders.find((provider) => provider.id === 'openai_compatible')?.id
    ?? preferredProviderId;
}

export function resolveProviderModelId(
  providers: ProviderDescriptor[],
  providerId: ProviderId,
  preferredModelId: string,
  options: ResolveProviderModelOptions = {}
) {
  const provider = providers.find((entry) => entry.id === providerId);
  if (!provider || provider.models.length === 0) {
    return resolveProviderModelAlias(providerId, preferredModelId);
  }

  const normalizedModelId = resolveProviderModelAlias(providerId, preferredModelId);
  if (provider.models.some((model) => model.id === normalizedModelId)) {
    const topModelId = provider.models[0]?.id;
    const providerDefaultId = getProviderMetadata(provider.id).defaultModelId;
    if (
      options.promoteStaleDefault
      && topModelId
      && topModelId !== normalizedModelId
      && (normalizedModelId === providerDefaultId || shouldPromoteManagedDefault(provider, normalizedModelId))
    ) {
      return topModelId;
    }
    return normalizedModelId;
  }

  if (provider.id === 'ollama') {
    return selectPreferredOllamaModel(provider.models).id;
  }

  return provider.models[0].id;
}

export function resolvePreferredProviderModel(
  providers: ProviderDescriptor[],
  providerId: ProviderId,
  preferredModelId?: string | null
) {
  const provider = providers.find((entry) => entry.id === providerId);
  if (!provider || provider.models.length === 0) {
    return null;
  }

  const resolvedId = preferredModelId
    ? resolveProviderModelId(providers, providerId, preferredModelId)
    : provider.id === 'ollama'
      ? selectPreferredOllamaModel(provider.models).id
      : provider.models[0].id;

  return provider.models.find((model) => model.id === resolvedId) ?? provider.models[0] ?? null;
}
