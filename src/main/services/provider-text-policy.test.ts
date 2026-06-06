import { describe, expect, it } from 'vitest';
import { PROVIDER_IDS } from '../../shared/domain';
import { getProviderTextNormalizationOptions, getProviderTextPolicy } from './provider-text-policy';

describe('provider-text-policy', () => {
  it('keeps ollama-specific visible-text cleanup flags in one shared policy lookup', () => {
    expect(getProviderTextNormalizationOptions('ollama')).toEqual({
      stripXmlFunctionCallMarkup: true,
      stripReasoningLabels: true
    });
  });

  it('applies provider-neutral final cleanup without provider-specific visible-text flags', () => {
    for (const providerId of PROVIDER_IDS.filter((candidate) => candidate !== 'ollama')) {
      expect(getProviderTextNormalizationOptions(providerId)).toEqual({});
      expect(getProviderTextPolicy(providerId).formatCompletionOutput?.('hello , world !')).toBe('hello, world!');
    }
  });

  it('declares ollama completion cleanup through the shared policy registry', () => {
    expect(
      getProviderTextPolicy('ollama').formatCompletionOutput?.(
        'Thinking: inspect first.\n<function_calls><invoke name="read_file"></invoke></function_calls>\nhello , world !'
      )
    ).toBe('hello, world!');
  });
});
