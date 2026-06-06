import { describe, expect, it } from 'vitest';
import type { ProviderDescriptor, ProviderId } from '../../shared/domain';
import { resolveDefaultProviderId, resolvePreferredProviderModel, resolveProviderModelId } from './provider-defaults';

function createProvider(
  id: ProviderId,
  installed: boolean,
  models: ProviderDescriptor['models'] = [],
  authMode: ProviderDescriptor['authMode'] = null
): ProviderDescriptor {
  return {
    id,
    label: id,
    authState: authMode === 'api_key' ? 'connected' : 'disconnected',
    authMode,
    installed,
    models,
    modelSource: 'fallback',
    modelsUpdatedAt: null,
    canLiveDiscoverModels: false,
    cliPath: null,
    capabilities: {
      requiresAuth: false,
      supportsVisionInput: false,
      supportsReasoningEffort: false,
      supportsRuntimeSkillResources: false,
      supportsNativeSkills: false,
      supportsSessionResume: false,
      requiresProjectTrust: true,
      supportsThinkingToggle: false,
      supportsNativeRunProgress: false,
      executionAuthority: 'provider_cli',
      approvalAuthority: 'provider_cli',
      sandboxAuthority: 'provider_cli',
      requiresTrustedWorkspace: true,
      workspaceInstructionFileName: 'AGENTS.md',
      requiresFullAccessForAppRuns: false
    },
    plannerPolicy: {
      supported: true,
      executionMode: 'workspace-write',
      enforcement: 'hard-enforced'
    }
  };
}

describe('resolveDefaultProviderId', () => {
  it('keeps a configured OpenAI-compatible API as the default when preferred', () => {
    const providerId = resolveDefaultProviderId(
      [
        createProvider('openai_compatible', true, [{ id: 'custom:openai:gpt-5.4-nano', label: 'OpenAI · GPT-5.4 Nano', description: 'Custom OpenAI-compatible model.' }], 'api_key'),
        createProvider('ollama', true)
      ],
      'openai_compatible'
    );

    expect(providerId).toBe('openai_compatible');
  });

  it('switches to Ollama when Ollama is the only available surfaced provider', () => {
    const providerId = resolveDefaultProviderId(
      [createProvider('openai', false), createProvider('ollama', true)],
      'openai'
    );

    expect(providerId).toBe('ollama');
  });

  it('does not keep Gemini as the default even when stale preferences still point at it', () => {
    const providerId = resolveDefaultProviderId(
      [
        createProvider('openai_compatible', true, [{ id: 'custom:openai:gpt-5.4-nano', label: 'OpenAI · GPT-5.4 Nano', description: 'Custom OpenAI-compatible model.' }], 'api_key'),
        createProvider('gemini', true),
        createProvider('ollama', true)
      ],
      'gemini'
    );

    expect(providerId).toBe('ollama');
  });

  it('falls back to the preferred provider when no surfaced provider is present', () => {
    const providerId = resolveDefaultProviderId(
      [createProvider('gemini', true), createProvider('qwen', true)],
      'openai'
    );

    expect(providerId).toBe('openai');
  });

  it('keeps Ollama as the preferred surfaced provider even before local setup is complete', () => {
    const providerId = resolveDefaultProviderId(
      [createProvider('openai', false), createProvider('ollama', false, [], 'api_key')],
      'ollama'
    );

    expect(providerId).toBe('ollama');
  });

  it('prefers a coder-style Ollama model when the preferred model is not installed', () => {
    const modelId = resolveProviderModelId(
      [
        createProvider('ollama', true, [
          {
            id: 'deepseek-r1:8b',
            label: 'Deepseek R1 8b',
            description: 'Local model discovered from Ollama.',
            supportsVision: false
          },
          {
            id: 'qwen3-coder-next',
            label: 'Qwen 3 Coder Next',
            description: 'Local coder model discovered from Ollama.',
            supportsVision: false
          }
        ])
      ],
      'ollama',
      'deepseek-coder'
    );

    expect(modelId).toBe('qwen3-coder-next');
  });

  it('keeps an installed Ollama model when it is present in the discovered list', () => {
    const modelId = resolveProviderModelId(
      [
        createProvider('ollama', true, [
          {
            id: 'deepseek-r1:8b',
            label: 'Deepseek R1 8b',
            description: 'Local model discovered from Ollama.',
            supportsVision: false
          }
        ])
      ],
      'ollama',
      'deepseek-r1:8b'
    );

    expect(modelId).toBe('deepseek-r1:8b');
  });

  it('promotes a stale metadata default to the provider runtime order when requested', () => {
    const providers = [
      createProvider('openai', true, [
        {
          id: 'gpt-5.5',
          label: 'GPT-5.5',
          description: 'Latest OpenAI model.',
          supportsVision: true
        },
        {
          id: 'gpt-5.4',
          label: 'GPT-5.4',
          description: 'Previous OpenAI default.',
          supportsVision: true
        }
      ])
    ];

    expect(resolveProviderModelId(providers, 'openai', 'gpt-5.4')).toBe('gpt-5.4');
    expect(
      resolveProviderModelId(providers, 'openai', 'gpt-5.4', {
        promoteStaleDefault: true
      })
    ).toBe('gpt-5.5');

    expect(
      resolveProviderModelId(
        [
          createProvider('openai', true, [
            {
              id: 'gpt-5.6',
              label: 'GPT-5.6',
              description: 'Future OpenAI model.',
              supportsVision: true
            },
            {
              id: 'gpt-5.5',
              label: 'GPT-5.5',
              description: 'Previous managed default.',
              supportsVision: true
            }
          ])
        ],
        'openai',
        'gpt-5.5',
        { promoteStaleDefault: true }
      )
    ).toBe('gpt-5.6');
  });

  it('returns the preferred visible Ollama model for UI previews', () => {
    const model = resolvePreferredProviderModel(
      [
        createProvider('ollama', true, [
          {
            id: 'llama3.1',
            label: 'Llama 3.1',
            description: 'General model discovered from Ollama.',
            supportsVision: false
          },
          {
            id: 'qwen3-coder-next',
            label: 'Qwen 3 Coder Next',
            description: 'Preferred coder model discovered from Ollama.',
            supportsVision: false
          }
        ])
      ],
      'ollama'
    );

    expect(model?.id).toBe('qwen3-coder-next');
  });

  it('maps stale Gemini preview ids to the current visible preview model', () => {
    const modelId = resolveProviderModelId(
      [
        createProvider('gemini', true, [
          {
            id: 'gemini-3-flash-preview',
            label: 'Gemini 3 Flash Preview',
            description: 'Preview Gemini Flash model.',
            supportsVision: true
          },
          {
            id: 'gemini-3.1-pro-preview',
            label: 'Gemini 3.1 Pro Preview',
            description: 'Preview Gemini Pro model.',
            supportsVision: true
          }
        ])
      ],
      'gemini',
      'gemini-3.1-flash-preview'
    );

    expect(modelId).toBe('gemini-3-flash-preview');
  });
});
