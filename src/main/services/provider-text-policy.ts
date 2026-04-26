import type { AssistantTextNormalizationOptions } from '../../providers/text-normalization';
import type { ProviderId } from '../../shared/domain';
import { createProviderRecord } from '../../shared/providers';
import { formatOllamaFinalAnswerFallback } from './ollama-final-answer-formatter';

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
      formatCompletionOutput: formatOllamaFinalAnswerFallback
    };
  }

  return {
    visibleTextNormalizationOptions: DEFAULT_VISIBLE_TEXT_NORMALIZATION_OPTIONS,
    formatCompletionOutput: null
  };
});

export function getProviderTextPolicy(providerId: ProviderId) {
  return PROVIDER_TEXT_POLICIES[providerId];
}

export function getProviderTextNormalizationOptions(providerId: ProviderId) {
  return getProviderTextPolicy(providerId).visibleTextNormalizationOptions;
}
