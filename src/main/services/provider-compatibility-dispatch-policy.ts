import type { ProviderId } from '../../shared/domain';
import type { ProviderRunContext, ProviderRunMode } from '../../providers/types';
import { legacyProviderRuntimeAuthority } from './provider-model-runtime-authority';
import { promptIsCasualConversation } from './provider-model-prompt-routing';
import { isRetiredProviderId } from '../../shared/providers';

export type ProviderCompatibilityDispatchReason =
  | 'normalized_required'
  | 'openai_codex_compatibility'
  | 'ollama_plain_compatibility'
  | 'legacy_provider_compatibility'
  | 'retired_provider';

export interface ProviderCompatibilityDispatchPolicy {
  allowCompatibilityDispatch: boolean;
  requireNormalizedTransport: boolean;
  reason: ProviderCompatibilityDispatchReason;
}

export interface ProviderCompatibilityTraceDetail {
  providerId: ProviderId;
  runMode: ProviderRunMode;
  compatibilityAuthority: 'provider_adapter';
  normalizedTransport: null;
  executionAuthority: ReturnType<typeof legacyProviderRuntimeAuthority>['executionAuthority'];
  approvalAuthority: ReturnType<typeof legacyProviderRuntimeAuthority>['approvalAuthority'];
  sandboxAuthority: ReturnType<typeof legacyProviderRuntimeAuthority>['sandboxAuthority'];
}

function hasTrustedWorkspace(context: ProviderRunContext) {
  return Boolean(context.folderPath?.trim()) && context.trusted;
}

function isTrustedOllamaCodingRun(context: ProviderRunContext) {
  if (context.ollamaTransportMode === 'legacy') {
    return false;
  }

  if (!hasTrustedWorkspace(context)) {
    return false;
  }

  if (context.runMode === 'plan') {
    return true;
  }

  return !promptIsCasualConversation(context.sourcePrompt || context.prompt);
}

function isTrustedOpenAiApiRun(context: ProviderRunContext) {
  return hasTrustedWorkspace(context)
    && context.runMode === 'default'
    && Boolean(context.apiKey?.trim());
}

export function resolveProviderCompatibilityDispatchPolicy(input: {
  providerId: ProviderId;
  context: ProviderRunContext;
  retiredProvider?: boolean;
}): ProviderCompatibilityDispatchPolicy {
  if (
    (input.retiredProvider === true && isRetiredProviderId(input.providerId)) ||
    input.providerId === 'qwen' ||
    input.providerId === 'kimi'
  ) {
    return {
      allowCompatibilityDispatch: false,
      requireNormalizedTransport: false,
      reason: 'retired_provider'
    };
  }

  if (input.providerId === 'ollama' && isTrustedOllamaCodingRun(input.context)) {
    return {
      allowCompatibilityDispatch: false,
      requireNormalizedTransport: true,
      reason: 'normalized_required'
    };
  }

  if (input.providerId === 'openai' && isTrustedOpenAiApiRun(input.context)) {
    return {
      allowCompatibilityDispatch: false,
      requireNormalizedTransport: true,
      reason: 'normalized_required'
    };
  }

  if (input.providerId === 'openai_compatible') {
    return {
      allowCompatibilityDispatch: false,
      requireNormalizedTransport: true,
      reason: 'normalized_required'
    };
  }

  if (input.providerId === 'ollama') {
    return {
      allowCompatibilityDispatch: true,
      requireNormalizedTransport: false,
      reason: 'ollama_plain_compatibility'
    };
  }

  if (input.providerId === 'openai') {
    return {
      allowCompatibilityDispatch: true,
      requireNormalizedTransport: false,
      reason: 'openai_codex_compatibility'
    };
  }

  return {
    allowCompatibilityDispatch: true,
    requireNormalizedTransport: false,
    reason: 'legacy_provider_compatibility'
  };
}

export function buildProviderCompatibilityDispatchTraceDetail(input: {
  providerId: ProviderId;
  runMode: ProviderRunMode;
}): ProviderCompatibilityTraceDetail {
  const runtimeAuthority = legacyProviderRuntimeAuthority(input.providerId);

  return {
    providerId: input.providerId,
    runMode: input.runMode,
    compatibilityAuthority: 'provider_adapter',
    normalizedTransport: null,
    executionAuthority: runtimeAuthority.executionAuthority,
    approvalAuthority: runtimeAuthority.approvalAuthority,
    sandboxAuthority: runtimeAuthority.sandboxAuthority
  };
}
