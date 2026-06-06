import { describe, expect, it } from 'vitest';
import type { ProviderRunContext } from '../../providers/types';
import {
  buildProviderCompatibilityDispatchTraceDetail,
  resolveProviderCompatibilityDispatchPolicy
} from './provider-compatibility-dispatch-policy';

function createContext(overrides: Partial<ProviderRunContext> = {}): ProviderRunContext {
  return {
    threadId: 'thread-1',
    runId: 'run-1',
    prompt: 'Inspect the workspace.',
    sourcePrompt: 'Inspect the workspace.',
    modelId: 'model-1',
    reasoningEffort: null,
    thinkingEnabled: false,
    executionConstraints: null,
    resumeSessionId: null,
    folderPath: 'C:\\workspace',
    trusted: true,
    apiKey: null,
    runMode: 'default',
    executionPermission: 'default',
    runtimeCommandPolicy: 'approval_required',
    runtimeNetworkPolicy: 'enabled',
    runtimeSkillResources: [],
    ...overrides
  };
}

describe('provider compatibility dispatch policy', () => {
  it('allows OpenAI compatibility for injected adapters when no API key normalized transport is available', () => {
    const policy = resolveProviderCompatibilityDispatchPolicy({
      providerId: 'openai',
      context: createContext({
        apiKey: null
      })
    });

    expect(policy).toEqual({
      allowCompatibilityDispatch: true,
      requireNormalizedTransport: false,
      reason: 'openai_codex_compatibility'
    });
  });

  it('requires normalized transport for trusted OpenAI-compatible API-key default runs', () => {
    const policy = resolveProviderCompatibilityDispatchPolicy({
      providerId: 'openai_compatible',
      context: createContext({
        apiKey: 'openai-key'
      })
    });

    expect(policy.allowCompatibilityDispatch).toBe(false);
    expect(policy.requireNormalizedTransport).toBe(true);
    expect(policy.reason).toBe('normalized_required');
  });

  it('requires normalized transport for trusted Ollama coding and planner runs', () => {
    expect(
      resolveProviderCompatibilityDispatchPolicy({
        providerId: 'ollama',
        context: createContext({
          prompt: 'Edit the project files.'
        })
      })
    ).toMatchObject({
      allowCompatibilityDispatch: false,
      requireNormalizedTransport: true,
      reason: 'normalized_required'
    });

    expect(
      resolveProviderCompatibilityDispatchPolicy({
        providerId: 'ollama',
        context: createContext({
          prompt: 'Plan the work.',
          runMode: 'plan'
        })
      })
    ).toMatchObject({
      allowCompatibilityDispatch: false,
      requireNormalizedTransport: true,
      reason: 'normalized_required'
    });
  });

  it('allows Ollama plain compatibility for casual chat and untrusted runs', () => {
    expect(
      resolveProviderCompatibilityDispatchPolicy({
        providerId: 'ollama',
        context: createContext({
          prompt: 'hello',
          sourcePrompt: 'hello'
        })
      })
    ).toMatchObject({
      allowCompatibilityDispatch: true,
      requireNormalizedTransport: false,
      reason: 'ollama_plain_compatibility'
    });

    expect(
      resolveProviderCompatibilityDispatchPolicy({
        providerId: 'ollama',
        context: createContext({
          trusted: false
        })
      })
    ).toMatchObject({
      allowCompatibilityDispatch: true,
      requireNormalizedTransport: false,
      reason: 'ollama_plain_compatibility'
    });
  });

  it('allows explicit Ollama legacy mode as a compatibility lane', () => {
    expect(
      resolveProviderCompatibilityDispatchPolicy({
        providerId: 'ollama',
        context: createContext({
          ollamaTransportMode: 'legacy' as never,
          prompt: 'Inspect the project files.'
        })
      })
    ).toEqual({
      allowCompatibilityDispatch: true,
      requireNormalizedTransport: false,
      reason: 'ollama_plain_compatibility'
    });
  });

  it('keeps Gemini as a legacy compatibility provider for injected adapters', () => {
    expect(
      resolveProviderCompatibilityDispatchPolicy({
        providerId: 'gemini',
        context: createContext()
      })
    ).toEqual({
      allowCompatibilityDispatch: true,
      requireNormalizedTransport: false,
      reason: 'legacy_provider_compatibility'
    });
  });

  it.each(['openai', 'gemini', 'qwen', 'kimi'] as const)('blocks retired %s compatibility dispatch', (providerId) => {
    expect(
      resolveProviderCompatibilityDispatchPolicy({
        providerId,
        context: createContext(),
        retiredProvider: true
      })
    ).toEqual({
      allowCompatibilityDispatch: false,
      requireNormalizedTransport: false,
      reason: 'retired_provider'
    });
  });

  it.each(['qwen', 'kimi'] as const)('blocks hard-retired %s compatibility dispatch without an adapter flag', (providerId) => {
    expect(
      resolveProviderCompatibilityDispatchPolicy({
        providerId,
        context: createContext()
      })
    ).toEqual({
      allowCompatibilityDispatch: false,
      requireNormalizedTransport: false,
      reason: 'retired_provider'
    });
  });

  it('builds the canonical compatibility trace detail', () => {
    expect(
      buildProviderCompatibilityDispatchTraceDetail({
        providerId: 'ollama',
        runMode: 'plan'
      })
    ).toEqual({
      providerId: 'ollama',
      runMode: 'plan',
      compatibilityAuthority: 'provider_adapter',
      normalizedTransport: null,
      executionAuthority: 'app_runtime',
      approvalAuthority: 'app',
      sandboxAuthority: 'app_runtime'
    });
  });
});
