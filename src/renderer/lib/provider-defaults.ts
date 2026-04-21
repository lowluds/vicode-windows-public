import { resolveProviderModelAlias } from '../../providers/catalog';
import type { ProviderDescriptor, ProviderId } from '../../shared/domain';
import { providerCanRunInComposer, selectPreferredOllamaModel } from '../../shared/providers';

export function resolveDefaultProviderId(
  providers: ProviderDescriptor[],
  preferredProviderId: ProviderId
): ProviderId {
  const availableProviders = providers.filter((provider) => providerCanRunInComposer(provider));

  if (availableProviders.some((provider) => provider.id === preferredProviderId)) {
    return preferredProviderId;
  }

  if (availableProviders.some((provider) => provider.id === 'openai')) {
    return 'openai';
  }

  if (availableProviders.some((provider) => provider.id === 'gemini')) {
    return 'gemini';
  }

  if (availableProviders.some((provider) => provider.id === 'qwen')) {
    return 'qwen';
  }

  if (availableProviders.some((provider) => provider.id === 'ollama')) {
    return 'ollama';
  }

  if (providers.some((provider) => provider.id === preferredProviderId)) {
    return preferredProviderId;
  }

  return providers.find((provider) => provider.id === 'openai')?.id ?? providers[0]?.id ?? preferredProviderId;
}

export function resolveProviderModelId(
  providers: ProviderDescriptor[],
  providerId: ProviderId,
  preferredModelId: string
) {
  const provider = providers.find((entry) => entry.id === providerId);
  if (!provider || provider.models.length === 0) {
    return resolveProviderModelAlias(providerId, preferredModelId);
  }

  const normalizedModelId = resolveProviderModelAlias(providerId, preferredModelId);
  if (provider.models.some((model) => model.id === normalizedModelId)) {
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
