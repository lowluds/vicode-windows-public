import { describe, expect, it } from 'vitest';
import {
  deriveContextWindowCompactionLikely,
  deriveContextWindowUsagePercent,
  resolveContextWindowAutoCompactTokenLimit,
  resolveContextWindowLimit
} from './context-window';

describe('shared context window helpers', () => {
  it('resolves model-specific limits for the active providers', () => {
    expect(resolveContextWindowLimit('openai', 'gpt-5.4')).toBe(1_000_000);
    expect(resolveContextWindowLimit('openai', 'gpt-5.4-mini')).toBe(400_000);
    expect(resolveContextWindowLimit('openai', 'gpt-5')).toBe(400_000);
    expect(resolveContextWindowLimit('gemini', 'gemini-3.1-pro-preview')).toBe(1_048_576);
    expect(resolveContextWindowLimit('qwen', 'qwen3.5-plus')).toBe(1_000_000);
    expect(resolveContextWindowLimit('qwen', 'qwen3-coder-next')).toBe(262_144);
    expect(resolveContextWindowLimit('kimi', 'kimi-k2-thinking')).toBe(262_144);
    expect(resolveContextWindowLimit('ollama', 'qwen3-coder')).toBe(32_768);
  });

  it('exposes explicit auto-compaction thresholds only for the long-context Codex lane', () => {
    expect(resolveContextWindowAutoCompactTokenLimit('openai', 'gpt-5.4')).toBe(750_000);
    expect(resolveContextWindowAutoCompactTokenLimit('openai', 'gpt-5.4-mini')).toBeNull();
    expect(resolveContextWindowAutoCompactTokenLimit('openai', 'gpt-5')).toBeNull();
    expect(resolveContextWindowAutoCompactTokenLimit('gemini', 'gemini-3.1-pro-preview')).toBeNull();
  });

  it('derives usage percent from used tokens and provider limits', () => {
    expect(deriveContextWindowUsagePercent('openai', 'gpt-5.4', 750_000)).toBeCloseTo(75, 3);
    expect(deriveContextWindowUsagePercent('gemini', 'gemini-3-flash-preview', 524_288)).toBeCloseTo(50, 3);
  });

  it('treats only the configured auto-compaction threshold as the likely-compact boundary', () => {
    expect(deriveContextWindowCompactionLikely('openai', 'gpt-5.4', 749_999)).toBe(false);
    expect(deriveContextWindowCompactionLikely('openai', 'gpt-5.4', 750_000)).toBe(true);
    expect(deriveContextWindowCompactionLikely('openai', 'gpt-5.4-mini', 310_000)).toBe(false);
    expect(deriveContextWindowCompactionLikely('openai', 'gpt-5', 310_000)).toBe(false);
  });
});
