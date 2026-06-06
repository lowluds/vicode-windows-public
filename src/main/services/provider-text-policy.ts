import type { AssistantTextNormalizationOptions } from '../../shared/assistant-text-normalization';
import { cleanFinalAssistantDisplayText } from '../../shared/assistant-text/final-display-cleanup';
import type { ProviderId } from '../../shared/domain';
import { createProviderRecord } from '../../shared/providers';

export interface ProviderTextPolicy {
  visibleTextNormalizationOptions: AssistantTextNormalizationOptions;
  formatCompletionOutput?: ((value: string) => string) | null;
}

const DEFAULT_VISIBLE_TEXT_NORMALIZATION_OPTIONS: AssistantTextNormalizationOptions = {};

const PROVIDER_TEXT_POLICIES: Record<ProviderId, ProviderTextPolicy> = createProviderRecord((providerId) => {
  if (providerId === 'ollama') {
    return {
      visibleTextNormalizationOptions: {
        stripXmlFunctionCallMarkup: true,
        stripReasoningLabels: true
      },
      formatCompletionOutput: (value) =>
        cleanFinalAssistantDisplayText(value, {
          stripXmlFunctionCallMarkup: true,
          stripReasoningLabels: true
        })
    };
  }

  return {
    visibleTextNormalizationOptions: DEFAULT_VISIBLE_TEXT_NORMALIZATION_OPTIONS,
    formatCompletionOutput: cleanFinalAssistantDisplayText
  };
});

export function getProviderTextPolicy(providerId: ProviderId) {
  return PROVIDER_TEXT_POLICIES[providerId];
}

export function getProviderTextNormalizationOptions(providerId: ProviderId) {
  return getProviderTextPolicy(providerId).visibleTextNormalizationOptions;
}
