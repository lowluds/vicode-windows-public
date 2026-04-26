import { randomUUID } from 'node:crypto';
import type { ProviderAdapter } from '../../providers/types';
import type {
  OllamaTransportMode,
  ProviderAccount,
  ProviderAuthMode,
  ProviderAuthState,
  ProviderDescriptor,
  ProviderId
} from '../../shared/domain';
import { providerCapabilities, selectPreferredSubagentModel } from '../../shared/providers';

export interface UtilityTextGenerationInput {
  providerId: ProviderId;
  modelId: string;
  prompt: string;
  fallback: string | null;
  timeoutMs: number;
}

export interface UtilityTextGenerationDependencies {
  adapters: Record<ProviderId, ProviderAdapter>;
  getProviderAccount: (providerId: ProviderId) => ProviderAccount | null;
  getProviderDescriptor: (providerId: ProviderId) => Promise<Pick<ProviderDescriptor, 'models'>>;
  resolveUsableModelId: (providerId: ProviderId, modelId: string) => Promise<string>;
  decryptApiKey: (encryptedApiKey: string) => string;
  resolveOllamaTransportMode: (providerId: ProviderId) => OllamaTransportMode | undefined;
}

interface UtilityAuthState {
  authState: ProviderAuthState;
  authMode: ProviderAuthMode | null;
}

function resolveApiKey(
  account: ProviderAccount | null,
  auth: UtilityAuthState,
  decryptApiKey: (encryptedApiKey: string) => string
) {
  return auth.authMode === 'api_key' && account?.encryptedApiKey
    ? decryptApiKey(account.encryptedApiKey)
    : null;
}

export async function resolveUtilityModelId(
  providerId: ProviderId,
  modelId: string,
  dependencies: Pick<UtilityTextGenerationDependencies, 'getProviderDescriptor' | 'resolveUsableModelId'>
) {
  let candidate = modelId;

  try {
    const provider = await dependencies.getProviderDescriptor(providerId);
    candidate = selectPreferredSubagentModel(providerId, provider.models)?.id ?? candidate;
  } catch {
    // Fall back to the caller-supplied model when provider metadata is unavailable.
  }

  try {
    return await dependencies.resolveUsableModelId(providerId, candidate);
  } catch {
    return candidate;
  }
}

export async function runUtilityTextGeneration(
  input: UtilityTextGenerationInput,
  dependencies: UtilityTextGenerationDependencies
) {
  if (providerCapabilities(input.providerId).requiresFullAccessForAppRuns) {
    return input.fallback;
  }

  const adapter = dependencies.adapters[input.providerId];
  const account = dependencies.getProviderAccount(input.providerId);
  const auth = await adapter.getAuthState(account);
  const apiKey = resolveApiKey(account, auth, dependencies.decryptApiKey);
  const modelId = await resolveUtilityModelId(input.providerId, input.modelId, dependencies);
  const runId = randomUUID();

  return new Promise<string | null>((resolve) => {
    let output = '';
    let settled = false;
    const timeout = setTimeout(() => {
      finish(input.fallback);
    }, input.timeoutMs);

    const finish = (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(value?.trim() ? value.trim() : input.fallback);
    };

    void adapter
      .startRun(
        {
          threadId: `utility-summary-${runId}`,
          runId,
          prompt: input.prompt,
          modelId,
          reasoningEffort: null,
          thinkingEnabled: providerCapabilities(input.providerId).supportsThinkingToggle ? false : undefined,
          folderPath: null,
          trusted: false,
          apiKey,
          runMode: 'plan',
          executionPermission: 'default',
          ollamaTransportMode: dependencies.resolveOllamaTransportMode(input.providerId)
        },
        {
          onStart: () => {},
          onDelta: (delta) => {
            output += delta;
          },
          onInfo: () => {},
          onComplete: (value) => finish(value || output),
          onError: () => finish(input.fallback),
          onAbort: () => finish(input.fallback)
        }
      )
      .catch(() => finish(input.fallback));
  });
}
