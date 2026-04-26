import { describe, expect, it } from 'vitest';
import {
  SAVED_PROVIDER_API_KEY_MASK,
  normalizeProviderApiKeyDraft,
  providerHasStoredApiKey,
  resolveProviderApiKeyFieldValue
} from './provider-api-key';

describe('provider-api-key helpers', () => {
  it('recognizes stored api-key providers', () => {
    expect(providerHasStoredApiKey({ authMode: 'api_key' })).toBe(true);
    expect(providerHasStoredApiKey({ authMode: 'cli' })).toBe(false);
    expect(providerHasStoredApiKey({ authMode: null })).toBe(false);
  });

  it('shows a persisted mask when the provider has a stored key but no draft value', () => {
    expect(resolveProviderApiKeyFieldValue({ authMode: 'api_key' }, '')).toBe(SAVED_PROVIDER_API_KEY_MASK);
    expect(resolveProviderApiKeyFieldValue({ authMode: null }, '')).toBe('');
  });

  it('prefers the in-session draft value over the stored mask', () => {
    expect(resolveProviderApiKeyFieldValue({ authMode: 'api_key' }, 'ollama-key-123')).toBe('ollama-key-123');
  });

  it('strips the rendered stored mask when the user edits a saved key field', () => {
    expect(
      normalizeProviderApiKeyDraft(
        { authMode: 'api_key' },
        '',
        `${SAVED_PROVIDER_API_KEY_MASK}new-key`
      )
    ).toBe('new-key');
  });

  it('leaves ordinary draft edits untouched', () => {
    expect(normalizeProviderApiKeyDraft({ authMode: 'api_key' }, 'existing', 'existing-next')).toBe('existing-next');
    expect(normalizeProviderApiKeyDraft({ authMode: null }, '', 'fresh-key')).toBe('fresh-key');
  });
});
