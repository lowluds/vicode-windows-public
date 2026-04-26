import type { ProviderDescriptor } from '../../shared/domain';

export const SAVED_PROVIDER_API_KEY_MASK = '••••••••••••••••';

export function providerHasStoredApiKey(provider: Pick<ProviderDescriptor, 'authMode'>) {
  return provider.authMode === 'api_key';
}

export function resolveProviderApiKeyFieldValue(
  provider: Pick<ProviderDescriptor, 'authMode'>,
  draftValue: string
) {
  return draftValue.length > 0
    ? draftValue
    : providerHasStoredApiKey(provider)
      ? SAVED_PROVIDER_API_KEY_MASK
      : '';
}

export function normalizeProviderApiKeyDraft(
  provider: Pick<ProviderDescriptor, 'authMode'>,
  previousDraftValue: string,
  nextValue: string
) {
  if (
    previousDraftValue.length === 0 &&
    providerHasStoredApiKey(provider) &&
    nextValue.startsWith(SAVED_PROVIDER_API_KEY_MASK)
  ) {
    return nextValue.slice(SAVED_PROVIDER_API_KEY_MASK.length);
  }

  return nextValue;
}
