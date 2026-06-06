import { describe, expect, it, vi } from 'vitest';
import { deriveOllamaContextWindowTokens, mapOllamaDiscoveredModels } from './model-metadata';
import type { OllamaShowResponse, OllamaTagResponse } from './runtime';

describe('Ollama model metadata helpers', () => {
  it('maps discovered tag entries into Vicode model metadata with runtime context and vision hints', async () => {
    const tags: OllamaTagResponse = {
      models: [
        { name: 'qwen3' },
        { model: 'qwen3-coder:30b' },
        { name: 'qwen2.5vl:7b', details: { families: ['clip'] } },
        { name: '   ' }
      ]
    };
    const loadModelDetails = vi.fn(async (modelId: string): Promise<OllamaShowResponse | null> => {
      if (modelId === 'qwen3-coder:30b') {
        return {
          parameters: 'temperature 0.7\n num_ctx 65536',
          model_info: {
            'qwen3.context_length': 262144
          }
        };
      }

      return null;
    });

    await expect(mapOllamaDiscoveredModels(tags, loadModelDetails)).resolves.toEqual([
      expect.objectContaining({
        id: 'qwen3',
        label: 'Qwen3',
        supportsVision: false,
        contextWindowTokens: 32_768,
        contextWindowSource: 'heuristic'
      }),
      expect.objectContaining({
        id: 'qwen3-coder:30b',
        label: 'Qwen3 Coder 30b',
        supportsVision: false,
        contextWindowTokens: 65_536,
        contextWindowSource: 'runtime'
      }),
      expect.objectContaining({
        id: 'qwen2.5vl:7b',
        label: 'Qwen2 5vl 7b',
        description: 'Local Ollama model from families: clip.',
        supportsVision: true,
        contextWindowTokens: 32_768,
        contextWindowSource: 'heuristic'
      })
    ]);
    expect(loadModelDetails).toHaveBeenCalledTimes(3);
  });

  it('prefers configured num_ctx over model-info context lengths', () => {
    expect(
      deriveOllamaContextWindowTokens({
        parameters: 'num_ctx 8192',
        model_info: {
          'general.context_length': 32768
        }
      })
    ).toBe(8192);
  });
});
