import type { CustomProviderDefinition, ProviderId, OllamaTransportMode } from '../../shared/domain';
import type { ProviderModelTransport, ProviderRunContext } from '../../providers/types';
import {
  OllamaResponsesTransport,
  type OllamaResponsesFetchWithRetry
} from '../../providers/ollama/responses-transport';
import { OllamaChatTransport } from '../../providers/ollama/chat-transport';
import { OpenAICompatibleChatTransport } from '../../providers/openai-compatible/chat-transport';
import { createOllamaResponsesHarnessPolicy } from '../../providers/ollama/tool-loop-responses-runner';
import {
  createDefaultProviderModelHarnessPolicy,
  DEFAULT_PROVIDER_MODEL_HARNESS_LIMITS
} from './provider-model-harness-policy';
import type {
  ProviderModelHarnessLimits,
  ProviderModelHarnessPolicy
} from './provider-model-harness-runner';
import {
  APP_RUNTIME_MODEL_AUTHORITY,
  type ProviderModelRuntimeAuthority
} from './provider-model-runtime-authority';
import {
  OLLAMA_CHAT_CAPABILITY_PROFILE,
  OLLAMA_RESPONSES_CAPABILITY_PROFILE,
  OPENAI_COMPATIBLE_CHAT_CAPABILITY_PROFILE,
  type ProviderModelCapabilityProfile
} from './provider-model-capability-profile';

export type ProviderModelTransportKind = 'ollama_responses' | 'ollama_chat' | 'openai_compatible_chat';

export interface ProviderModelTransportResolution {
  buildFallbackRunContext?: (context: ProviderRunContext) => ProviderRunContext;
  capabilityProfile: ProviderModelCapabilityProfile;
  limits?: Partial<ProviderModelHarnessLimits>;
  policy: ProviderModelHarnessPolicy;
  providerLabel: string;
  runtimeAuthority: ProviderModelRuntimeAuthority;
  transport: ProviderModelTransport;
  transportKind: ProviderModelTransportKind;
}

export interface ResolveProviderModelTransportInput {
  providerId: ProviderId;
  modelId: string;
  apiKey: string | null;
  ollamaRuntimeBaseUrl: string;
  ollamaTransportMode?: OllamaTransportMode | string | null;
  fetchOllamaWithRetry: OllamaResponsesFetchWithRetry;
}

export interface ResolveOpenAICompatibleChatTransportInput {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  providerLabel: string;
  timeoutMs?: number;
}

export interface ResolveCustomProviderModelTransportInput {
  decryptApiKey: (encryptedApiKey: string) => string;
  fetchImpl?: typeof fetch;
  provider: CustomProviderDefinition;
  timeoutMs?: number;
}

export function resolveOpenAICompatibleChatTransport(
  input: ResolveOpenAICompatibleChatTransportInput
): ProviderModelTransportResolution | null {
  const apiKey = input.apiKey.trim();
  const baseUrl = input.baseUrl.trim();
  const providerLabel = input.providerLabel.trim() || 'OpenAI-compatible';
  if (!apiKey || !baseUrl) {
    return null;
  }

  return {
    providerLabel,
    transportKind: 'openai_compatible_chat',
    runtimeAuthority: APP_RUNTIME_MODEL_AUTHORITY,
    capabilityProfile: OPENAI_COMPATIBLE_CHAT_CAPABILITY_PROFILE,
    transport: new OpenAICompatibleChatTransport({
      apiKey,
      baseUrl,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs
    }),
    policy: createDefaultProviderModelHarnessPolicy({
      providerLabel,
      providerEventTypePrefix: 'openai_compatible_tool_loop'
    }),
    limits: DEFAULT_PROVIDER_MODEL_HARNESS_LIMITS
  };
}

export function resolveCustomProviderModelTransport(
  input: ResolveCustomProviderModelTransportInput
): ProviderModelTransportResolution | null {
  if (!input.provider.enabled) {
    return null;
  }

  if (input.provider.transportKind !== 'openai_compatible_chat') {
    return null;
  }

  const apiKey = input.decryptApiKey(input.provider.encryptedApiKey);
  return resolveOpenAICompatibleChatTransport({
    apiKey,
    baseUrl: input.provider.baseUrl,
    fetchImpl: input.fetchImpl,
    providerLabel: input.provider.name,
    timeoutMs: input.timeoutMs
  });
}

export function resolveProviderModelTransport(
  input: ResolveProviderModelTransportInput
): ProviderModelTransportResolution | null {
  if (input.providerId === 'openai') {
    return null;
  }

  if (input.providerId !== 'ollama') {
    return null;
  }

  const baseUrl = input.ollamaRuntimeBaseUrl;
  if (input.ollamaTransportMode === 'responses') {
    return {
      providerLabel: 'Ollama',
      transportKind: 'ollama_responses',
      runtimeAuthority: APP_RUNTIME_MODEL_AUTHORITY,
      capabilityProfile: OLLAMA_RESPONSES_CAPABILITY_PROFILE,
      transport: new OllamaResponsesTransport({
        apiKey: null,
        baseUrl,
        fetchWithRetry: input.fetchOllamaWithRetry
      }),
      policy: createOllamaResponsesHarnessPolicy(),
      limits: DEFAULT_PROVIDER_MODEL_HARNESS_LIMITS,
      buildFallbackRunContext: (context) => ({
        ...context,
        ollamaTransportMode: 'chat'
      })
    };
  }

  if (input.ollamaTransportMode === 'chat' || input.ollamaTransportMode == null) {
    return {
      providerLabel: 'Ollama',
      transportKind: 'ollama_chat',
      runtimeAuthority: APP_RUNTIME_MODEL_AUTHORITY,
      capabilityProfile: OLLAMA_CHAT_CAPABILITY_PROFILE,
      transport: new OllamaChatTransport({
        apiKey: null,
        baseUrl,
        fetchWithRetry: input.fetchOllamaWithRetry
      }),
      policy: createOllamaResponsesHarnessPolicy(),
      limits: DEFAULT_PROVIDER_MODEL_HARNESS_LIMITS
    };
  }

  return null;
}
