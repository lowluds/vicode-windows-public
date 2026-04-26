import { describe, expect, it } from 'vitest';
import { createProviderModelFromId, sanitizeDiscoveredModels } from './catalog';

describe('provider catalog recommendations', () => {
  it('marks quick OpenAI models without guessing the live Codex default', () => {
    expect(createProviderModelFromId('openai', 'gpt-5.5')?.recommendation).toBeUndefined();
    expect(createProviderModelFromId('openai', 'gpt-5.4')?.recommendation).toBeUndefined();
    expect(createProviderModelFromId('openai', 'gpt-5-mini')?.recommendation).toBe('fast');
  });

  it('marks Gemini preview models explicitly as preview', () => {
    expect(createProviderModelFromId('gemini', 'gemini-3-pro-preview')?.recommendation).toBe('preview');
    expect(createProviderModelFromId('gemini', 'gemini-3.1-flash-preview')).toMatchObject({
      id: 'gemini-3-flash-preview',
      recommendation: 'preview'
    });
    expect(createProviderModelFromId('gemini', 'auto-gemini-3')?.recommendation).toBe('preview');
    expect(createProviderModelFromId('gemini', 'auto-gemini-2.5')?.recommendation).toBe('recommended');
  });

  it('sorts coder-first Ollama models ahead of general local models', () => {
    const models = sanitizeDiscoveredModels('ollama', [
      {
        id: 'qwen3',
        label: 'Qwen 3',
        description: 'General Ollama model.',
        supportsVision: false
      },
      {
        id: 'qwen3-coder',
        label: 'Qwen 3 Coder',
        description: 'Coding Ollama model.',
        supportsVision: false
      },
      {
        id: 'deepseek-coder',
        label: 'DeepSeek Coder',
        description: 'Alternate coding Ollama model.',
        supportsVision: false
      },
      {
        id: 'llama3.1',
        label: 'Llama 3.1',
        description: 'General Ollama model.',
        supportsVision: false
      }
    ]);

    expect(models.map((model) => model.id)).toEqual(['qwen3-coder', 'deepseek-coder', 'qwen3', 'llama3.1']);
    expect(models[0].recommendation).toBe('recommended');
    expect(models[1].recommendation).toBeUndefined();
  });

  it('can preserve provider runtime order for Ollama discovery', () => {
    const models = sanitizeDiscoveredModels(
      'ollama',
      [
        {
          id: 'llama3.1',
          label: 'Llama 3.1',
          description: 'General local model.',
          supportsVision: false
        },
        {
          id: 'qwen3-coder',
          label: 'Qwen 3 Coder',
          description: 'Coding local model.',
          supportsVision: false
        }
      ],
      { preserveInputOrder: true }
    );

    expect(models.map((model) => model.id)).toEqual(['llama3.1', 'qwen3-coder']);
  });

  it('keeps non-certified Ollama coding families unlabeled until benchmark evidence exists', () => {
    expect(createProviderModelFromId('ollama', 'deepseek-coder:33b')).toMatchObject({
      id: 'deepseek-coder:33b',
      recommendation: undefined,
      supportsVision: false
    });
  });

  it('marks quick OpenAI variants explicitly', () => {
    expect(createProviderModelFromId('openai', 'gpt-5.4-mini')?.recommendation).toBe('fast');
  });

  it('keeps newly discovered OpenAI versioned models ahead of older hard-coded routes', () => {
    const models = sanitizeDiscoveredModels('openai', [
      {
        id: 'gpt-5.4',
        label: 'GPT-5.4',
        description: 'Known route.',
        supportsVision: true
      },
      {
        id: 'gpt-5.6',
        label: 'GPT-5.6',
        description: 'Future discovered route.',
        supportsVision: true
      },
      {
        id: 'gpt-5.5',
        label: 'GPT-5.5',
        description: 'Current discovered route.',
        supportsVision: true
      },
      {
        id: 'gpt-5.6-mini',
        label: 'GPT-5.6 Mini',
        description: 'Future quick route.',
        supportsVision: true
      }
    ]);

    expect(models.map((model) => model.id)).toEqual(['gpt-5.6', 'gpt-5.6-mini', 'gpt-5.5', 'gpt-5.4']);
  });

  it('attaches model-specific context metadata for known provider routes', () => {
    expect(createProviderModelFromId('openai', 'gpt-5.5')).toMatchObject({
      contextWindowTokens: 400_000,
      autoCompactTokenLimit: null,
      contextWindowSource: 'official'
    });
    expect(createProviderModelFromId('openai', 'gpt-5.4')).toMatchObject({
      contextWindowTokens: 1_000_000,
      autoCompactTokenLimit: 750_000,
      contextWindowSource: 'configured'
    });
    expect(createProviderModelFromId('qwen', 'qwen3.5-plus')).toMatchObject({
      contextWindowTokens: 1_000_000,
      contextWindowSource: 'official'
    });
    expect(createProviderModelFromId('kimi', 'kimi-k2-thinking')).toMatchObject({
      contextWindowTokens: 262_144,
      contextWindowSource: 'official'
    });
  });

  it('preserves an explicit provider-supplied recommendation', () => {
    const models = sanitizeDiscoveredModels('ollama', [
      {
        id: 'deepseek-coder',
        label: 'DeepSeek Coder',
        description: 'Provider supplied recommendation.',
        supportsVision: false,
        recommendation: 'fast'
      }
    ]);

    expect(models).toMatchObject([
      {
        id: 'deepseek-coder',
        recommendation: 'fast'
      }
    ]);
  });

  it('keeps the stable auto Gemini 2.5 route ahead of pinned and preview routes', () => {
    const models = sanitizeDiscoveredModels('gemini', [
      {
        id: 'auto-gemini-3',
        label: 'Auto Gemini 3',
        description: 'Preview auto route.',
        supportsVision: true
      },
      {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        description: 'Stable route.',
        supportsVision: true
      },
      {
        id: 'auto-gemini-2.5',
        label: 'Auto Gemini 2.5',
        description: 'Stable auto route.',
        supportsVision: true
      }
    ]);

    expect(models.map((model) => model.id)).toEqual(['auto-gemini-2.5', 'gemini-2.5-pro', 'auto-gemini-3']);
  });
});
