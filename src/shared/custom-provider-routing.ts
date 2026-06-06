const CUSTOM_PROVIDER_MODEL_PREFIX = 'openai-compatible';

export interface CustomProviderModelRoute {
  customProviderId: string;
  modelId: string;
}

export function encodeCustomProviderModelId(route: CustomProviderModelRoute) {
  return [
    CUSTOM_PROVIDER_MODEL_PREFIX,
    encodeURIComponent(route.customProviderId),
    encodeURIComponent(route.modelId)
  ].join(':');
}

export function decodeCustomProviderModelId(modelId: string): CustomProviderModelRoute | null {
  const [prefix, encodedProviderId, encodedModelId, ...extra] = modelId.split(':');
  if (prefix !== CUSTOM_PROVIDER_MODEL_PREFIX || !encodedProviderId || !encodedModelId || extra.length > 0) {
    return null;
  }

  try {
    const customProviderId = decodeURIComponent(encodedProviderId);
    const resolvedModelId = decodeURIComponent(encodedModelId);
    if (!customProviderId.trim() || !resolvedModelId.trim()) {
      return null;
    }

    return {
      customProviderId,
      modelId: resolvedModelId
    };
  } catch {
    return null;
  }
}
