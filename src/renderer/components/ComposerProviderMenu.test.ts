import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProviderDescriptor, ProviderId } from '../../shared/domain';
import {
  ComposerProviderMenu,
  getProviderModelGroups,
  visibleComposerModelRecommendationLabel
} from './ComposerProviderMenu';
import { TooltipProvider } from './ui';

function createProvider(input: Partial<ProviderDescriptor> & { id: ProviderId }): ProviderDescriptor {
  return {
    id: input.id,
    label: input.label ?? input.id,
    authState: input.authState ?? 'authenticated',
    authMode: input.authMode ?? 'oauth',
    installed: input.installed ?? true,
    models: input.models ?? [],
    modelSource: input.modelSource ?? 'static',
    modelsUpdatedAt: input.modelsUpdatedAt ?? null,
    canLiveDiscoverModels: input.canLiveDiscoverModels ?? true,
    cliPath: input.cliPath ?? null,
    capabilities: input.capabilities ?? {
      supportsImages: false,
      supportsPromptCache: false,
      supportsReasoningEffort: input.id === 'openai',
      supportsThinkingToggle: input.id === 'gemini',
      supportsPlanMode: false,
      supportsNativeTools: true,
      supportsStructuredJson: false
    },
    plannerPolicy: input.plannerPolicy ?? {
      defaultPlannerMode: 'disabled',
      supportsPlanMode: false,
      requiresPlanMode: false
    },
    message: input.message
  };
}

describe('ComposerProviderMenu', () => {
  it('renders the selected provider/model trigger', () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(ComposerProviderMenu, {
          providers: [
            createProvider({
              id: 'openai',
              models: [
                {
                  id: 'gpt-5',
                  label: 'GPT-5',
                  description: 'Default model.',
                  recommendation: 'default'
                }
              ]
            }),
            createProvider({
              id: 'gemini',
              installed: false,
              authState: 'missing_cli',
              authMode: null
            })
          ],
          providerId: 'openai',
          modelId: 'gpt-5',
          effort: 'Medium',
          selectComposerModel: () => undefined,
          selectComposerEffort: () => undefined,
          refreshProvider: async () => undefined,
          openProviderSettings: () => undefined,
          dismissComposerTriggerOverlays: () => undefined,
          handleComposerMenuCloseAutoFocus: () => undefined
        })
      )
    );

    expect(html).toContain('composer-model-select');
    expect(html).toContain('OpenAI / GPT-5');
    expect(html).toContain('GPT-5');
    expect(html).not.toContain('Thinking');
  });

  it('does not expose Ollama thinking as a composer menu toggle', () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(ComposerProviderMenu, {
          providers: [
            createProvider({
              id: 'ollama',
              models: [
                {
                  id: 'qwen3-coder',
                  label: 'Qwen 3 Coder',
                  description: 'Default model.'
                }
              ]
            })
          ],
          providerId: 'ollama',
          modelId: 'qwen3-coder',
          effort: 'Medium',
          selectComposerModel: () => undefined,
          selectComposerEffort: () => undefined,
          refreshProvider: async () => undefined,
          openProviderSettings: () => undefined,
          dismissComposerTriggerOverlays: () => undefined,
          handleComposerMenuCloseAutoFocus: () => undefined
        })
      )
    );

    expect(html).toContain('Ollama / Qwen 3 Coder');
    expect(html).not.toContain('Thinking');
  });

  it('hides default and quick model recommendation badges', () => {
    expect(visibleComposerModelRecommendationLabel('Default')).toBeNull();
    expect(visibleComposerModelRecommendationLabel('Quick')).toBeNull();
    expect(visibleComposerModelRecommendationLabel('Preview')).toBe('Preview');
  });

  it('groups local Ollama models at the bottom of the submenu', () => {
    const groups = getProviderModelGroups(
      createProvider({
        id: 'ollama',
        authMode: 'api_key',
        models: [
          {
            id: 'qwen3-cloud',
            label: 'Qwen3 Cloud',
            description: 'Cloud model.'
          },
          {
            id: 'local:qwen3-local:14b',
            label: 'Qwen3 Local 14b',
            description: 'Local model.'
          }
        ]
      })
    );

    expect(groups.map((group) => ({
      label: group.label,
      models: group.models.map((model) => model.label)
    }))).toEqual([
      { label: 'Cloud', models: ['Qwen3 Cloud'] },
      { label: 'Local', models: ['Qwen3 Local 14b'] }
    ]);
  });
});
