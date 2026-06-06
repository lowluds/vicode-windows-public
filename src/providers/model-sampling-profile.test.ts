import { describe, expect, it } from 'vitest';
import { resolveModelSamplingProfile, resolveOllamaSamplingOptions } from './model-sampling-profile';

describe('model sampling profile', () => {
  it('resolves lane-specific sampling controls without model-specific rules', () => {
    expect(resolveModelSamplingProfile({ lane: 'tool_loop' })).toMatchObject({
      temperature: 0.2,
      top_p: 0.8,
      top_k: 20,
      repeat_penalty: 1.05
    });
    expect(resolveModelSamplingProfile({ lane: 'plain_chat' })).toEqual(null);
    expect(resolveModelSamplingProfile({ lane: 'final_summary' })).toMatchObject({
      temperature: 0.1
    });
  });

  it('passes provider-neutral profile values through as Ollama options', () => {
    expect(resolveOllamaSamplingOptions(resolveModelSamplingProfile({ lane: 'tool_loop' }))).toEqual({
      temperature: 0.2,
      top_p: 0.8,
      top_k: 20,
      repeat_penalty: 1.05
    });
    expect(resolveOllamaSamplingOptions(null)).toBeNull();
  });
});
