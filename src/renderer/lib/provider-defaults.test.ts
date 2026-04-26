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
    authState: 'disconnected',
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
      supportsQuotaStatus: false,
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
    quota: null,
    plannerPolicy: {
      supported: true,
      executionMode: 'workspace-write',
      enforcement: 'hard-enforced'
    }
  };
}

describe('resolveDefaultProviderId', () => {
  it('keeps OpenAI as the default when both providers are installed', () => {
    const providerId = resolveDefaultProviderId(
      [createProvider('openai', true), createProvider('gemini', true)],
      'openai'
    );

    expect(providerId).toBe('openai');
  });

  it('switches to Gemini when Gemini is the only installed provider', () => {
    const providerId = resolveDefaultProviderId(
      [createProvider('openai', false), createProvider('gemini', true)],
      'openai'
    );

    expect(providerId).toBe('gemini');
  });

  it('keeps Gemini when it is the preferred installed provider', () => {
    const providerId = resolveDefaultProviderId(
      [createProvider('openai', true), createProvider('gemini', true)],
      'gemini'
    );

    expect(providerId).toBe('gemini');
  });

  it('keeps hosted Ollama as the default when it is the preferred available provider', () => {
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
            description: 'Hosted coder model discovered from Ollama.',
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
          description: 'Latest Codex model.',
          supportsVision: true
        },
        {
          id: 'gpt-5.4',
          label: 'GPT-5.4',
          description: 'Previous Codex default.',
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
              description: 'Future Codex model.',
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
