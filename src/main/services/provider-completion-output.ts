import type { ProviderId } from '../../shared/domain';
import { preferProviderVisibleText, normalizeProviderVisibleText } from './provider-run-event-normalizer';
import { getProviderTextPolicy } from './provider-text-policy';

export interface ResolveProviderCompletionOutputInput {
  providerId: ProviderId;
  output: string;
  streamedDeltaOutput: string;
  assistantTurnOutput: string;
}

export function formatProviderCompletionOutput(providerId: ProviderId, value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const formatter = getProviderTextPolicy(providerId).formatCompletionOutput;
  return formatter ? formatter(trimmed) : trimmed;
}

export function resolveProviderCompletionText(input: ResolveProviderCompletionOutputInput) {
  const normalizedOutput = normalizeProviderVisibleText(input.providerId, input.output).trim();
  const streamedDeltaOutput = input.streamedDeltaOutput.trim();
  const assistantTurnOutput = input.assistantTurnOutput.trim();
  const streamedOutput = assistantTurnOutput
    ? preferProviderVisibleText(input.providerId, streamedDeltaOutput, assistantTurnOutput).trim()
    : streamedDeltaOutput;

  if (!normalizedOutput) {
    return streamedOutput;
  }

  if (!streamedOutput) {
    return normalizedOutput;
  }

  const comparableNormalized = normalizedOutput.replace(/\s+/gu, '');
  const comparableStreamed = streamedOutput.replace(/\s+/gu, '');
  if (comparableNormalized === comparableStreamed) {
    return preferProviderVisibleText(input.providerId, streamedOutput, input.output).trim();
  }

  if (normalizedOutput.startsWith(streamedOutput)) {
    return normalizedOutput;
  }

  return normalizedOutput;
}

export function resolveProviderCompletionOutput(input: ResolveProviderCompletionOutputInput) {
  return formatProviderCompletionOutput(input.providerId, resolveProviderCompletionText(input));
}
