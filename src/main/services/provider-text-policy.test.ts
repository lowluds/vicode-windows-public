import { describe, expect, it } from 'vitest';
import { getProviderTextNormalizationOptions, getProviderTextPolicy } from './provider-text-policy';

describe('provider-text-policy', () => {
  it('keeps ollama-specific visible-text cleanup flags in one shared policy lookup', () => {
    expect(getProviderTextNormalizationOptions('ollama')).toEqual({
      stripXmlFunctionCallMarkup: true,
      stripReasoningLabels: true
    });
  });

  it('keeps default provider text policies narrow when no special cleanup is needed', () => {
    expect(getProviderTextNormalizationOptions('openai')).toEqual({});
    expect(getProviderTextPolicy('openai').formatCompletionOutput).toBeNull();
  });

  it('declares ollama completion formatting through the shared policy registry', () => {
    expect(
      getProviderTextPolicy('ollama').formatCompletionOutput?.(
        'Sure! Here are some fun facts about Mars:- 🌍 **The Red Planet:** Mars looks red due to iron oxide.'
      )
    ).toBe(
      'Sure! Here are some fun facts about Mars:\n\n- 🌍 **The Red Planet:** Mars looks red due to iron oxide.'
    );
  });
});
