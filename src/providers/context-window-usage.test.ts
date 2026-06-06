import { describe, expect, it } from 'vitest';
import { normalizeProviderContextWindowUsage } from './context-window-usage';

describe('normalizeProviderContextWindowUsage', () => {
  it('normalizes OpenAI-compatible token usage fields', () => {
    expect(
      normalizeProviderContextWindowUsage({
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 300,
          total_tokens: 1500
        }
      })
    ).toEqual({
      usedTokens: 1500,
      inputTokens: 1200,
      outputTokens: 300,
      providerEventType: null
    });
  });

  it('normalizes Ollama prompt and output usage fields', () => {
    expect(
      normalizeProviderContextWindowUsage({
        prompt_eval_count: 4096,
        eval_count: 512
      }, 'ollama_chat_context_window_usage')
    ).toEqual({
      usedTokens: 4608,
      inputTokens: 4096,
      outputTokens: 512,
      providerEventType: 'ollama_chat_context_window_usage'
    });
  });

  it('ignores payloads without positive finite token usage', () => {
    expect(
      normalizeProviderContextWindowUsage({
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      })
    ).toBeNull();
  });
});
