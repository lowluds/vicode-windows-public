import { describe, expect, it, vi } from 'vitest';
import type { ProviderAdapter, ProviderRunCallbacks, ProviderRunHandle } from '../../providers/types';
import type {
  ProviderAccount,
  ProviderDescriptor,
  ProviderId,
  ProviderModel
} from '../../shared/domain';
import {
  resolveUtilityModelId,
  runUtilityTextGeneration,
  type UtilityTextGenerationDependencies
} from './utility-text-generation';

function createProviderModel(id: string, label = id): ProviderModel {
  return { id, label, description: '' };
}

function createAdapter(providerId: ProviderId, startRun?: ProviderAdapter['startRun']): ProviderAdapter {
  return {
    id: providerId,
    label: providerId,
    listStaticModels: () => [],
    getPlannerCapability: () => ({
      supported: true,
      executionMode: 'read-only',
      enforcement: 'hard-enforced'
    }),
    discoverApiModels: async () => null,
    discoverRuntimeModels: async () => null,
    detectInstall: async () => ({ installed: true, cliPath: `${providerId}.cmd` }),
    getAuthState: async () => ({ authState: 'disconnected', authMode: null }),
    startAuth: async () => {},
    clearAuth: async () => {},
    validateProjectContext: () => ({ valid: true }),
    startRun:
      startRun ??
      (async () =>
        ({
          runId: 'run-1',
          cancel: async () => {}
        }) satisfies ProviderRunHandle)
  };
}

function createDependencies(overrides?: Partial<UtilityTextGenerationDependencies>): UtilityTextGenerationDependencies {
  const adapters: Record<ProviderId, ProviderAdapter> = {
    openai: createAdapter('openai'),
    gemini: createAdapter('gemini'),
    qwen: createAdapter('qwen'),
    ollama: createAdapter('ollama'),
    kimi: createAdapter('kimi')
  };

  return {
    adapters,
    getProviderAccount: () => null,
    getProviderDescriptor: async () =>
      ({
        models: []
      }) satisfies Pick<ProviderDescriptor, 'models'>,
    resolveUsableModelId: async (_providerId, modelId) => modelId,
    decryptApiKey: (encryptedApiKey) => encryptedApiKey,
    resolveOllamaTransportMode: () => undefined,
    ...overrides
  };
}

describe('utility-text-generation', () => {
  it('prefers the provider-specific subagent model before resolving the usable utility model id', async () => {
    const resolveUsableModelId = vi.fn(async (_providerId: ProviderId, modelId: string) => modelId);

    await expect(
      resolveUtilityModelId(
        'openai',
        'gpt-5.4',
        createDependencies({
          getProviderDescriptor: async () =>
            ({
              models: [
                createProviderModel('gpt-5.4'),
                createProviderModel('gpt-5.4-mini')
              ]
            }) satisfies Pick<ProviderDescriptor, 'models'>,
          resolveUsableModelId
        })
      )
    ).resolves.toBe('gpt-5.4-mini');

    expect(resolveUsableModelId).toHaveBeenCalledWith('openai', 'gpt-5.4-mini');
  });

  it('runs utility generation through the provider adapter and returns the completed text', async () => {
    const startRun = vi.fn(async (_context, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      callbacks.onDelta('Partial');
      callbacks.onComplete('Finished utility summary');
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });

    const dependencies = createDependencies({
      adapters: {
        openai: createAdapter('openai', startRun),
        gemini: createAdapter('gemini'),
        qwen: createAdapter('qwen'),
        ollama: createAdapter('ollama'),
        kimi: createAdapter('kimi')
      }
    });

    await expect(
      runUtilityTextGeneration(
        {
          providerId: 'openai',
          modelId: 'gpt-5.4',
          prompt: 'Summarize this thread.',
          fallback: 'fallback',
          timeoutMs: 5_000
        },
        dependencies
      )
    ).resolves.toBe('Finished utility summary');
  });

  it('falls back immediately for providers that require full access for app-driven runs', async () => {
    const startRun = vi.fn();
    const dependencies = createDependencies({
      adapters: {
        openai: createAdapter('openai'),
        gemini: createAdapter('gemini'),
        qwen: createAdapter('qwen'),
        ollama: createAdapter('ollama'),
        kimi: createAdapter('kimi', startRun as never)
      }
    });

    await expect(
      runUtilityTextGeneration(
        {
          providerId: 'kimi',
          modelId: 'kimi-k2-thinking',
          prompt: 'Summarize this thread.',
          fallback: 'fallback',
          timeoutMs: 5_000
        },
        dependencies
      )
    ).resolves.toBe('fallback');

    expect(startRun).not.toHaveBeenCalled();
  });

  it('decrypts API keys before passing utility runs to the provider', async () => {
    const getAuthState = vi.fn(async (_account: ProviderAccount | null) => ({
      authState: 'connected' as const,
      authMode: 'api_key' as const
    }));
    const startRun = vi.fn(async (context, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      callbacks.onComplete('Finished utility summary');
      expect(context.apiKey).toBe('decrypted-secret');
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });

    const account = {
      providerId: 'openai',
      authState: 'connected',
      authMode: 'api_key',
      encryptedApiKey: 'encrypted-secret',
      updatedAt: '2026-04-21T00:00:00.000Z'
    } satisfies ProviderAccount;

    const adapter = createAdapter('openai', startRun);
    adapter.getAuthState = getAuthState;

    const dependencies = createDependencies({
      adapters: {
        openai: adapter,
        gemini: createAdapter('gemini'),
        qwen: createAdapter('qwen'),
        ollama: createAdapter('ollama'),
        kimi: createAdapter('kimi')
      },
      getProviderAccount: () => account,
      decryptApiKey: vi.fn(() => 'decrypted-secret')
    });

    await runUtilityTextGeneration(
      {
        providerId: 'openai',
        modelId: 'gpt-5.4',
        prompt: 'Summarize this thread.',
        fallback: 'fallback',
        timeoutMs: 5_000
      },
      dependencies
    );

    expect(getAuthState).toHaveBeenCalledWith(account);
  });
});
