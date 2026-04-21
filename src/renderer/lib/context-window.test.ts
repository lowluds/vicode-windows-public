import { describe, expect, it } from 'vitest';
import type { ProviderModel, RunEvent } from '../../shared/domain';
import {
  deriveContextWindowMeterPercent,
  deriveLatestProviderContextWindowUsage,
  deriveProviderContextWindow,
  estimateContextWindow,
  formatContextUsagePercent,
  resolveContextWindowLimit
} from './context-window';

function createInfoEvent(id: string, runId: string, usedTokens: number): RunEvent {
  return {
    id,
    threadId: 'thread-1',
    runId,
    eventType: 'info',
    payload: {
      contextWindow: {
        usedTokens,
        providerEventType: 'result'
      }
    },
    createdAt: '2026-03-16T00:00:00.000Z'
  };
}

describe('context window helpers', () => {
  it('formats low percentages without fake rounded 0% values', () => {
    expect(formatContextUsagePercent(0)).toBe('0%');
    expect(formatContextUsagePercent(0.04)).toBe('<0.1%');
    expect(formatContextUsagePercent(0.4)).toBe('0.4%');
    expect(formatContextUsagePercent(4.25)).toBe('4.3%');
  });

  it('keeps the visual meter moving for very low large-window usage', () => {
    expect(deriveContextWindowMeterPercent(0)).toBe(0);
    expect(deriveContextWindowMeterPercent(0.4)).toBeGreaterThan(3);
    expect(deriveContextWindowMeterPercent(0.4)).toBeLessThan(10);
    expect(deriveContextWindowMeterPercent(10)).toBe(10);
    expect(deriveContextWindowMeterPercent(62)).toBe(62);
  });

  it('shows moving low-percent labels for large Gemini context windows', () => {
    const estimate = estimateContextWindow({
      providerId: 'gemini',
      modelId: 'gemini-2.5-pro',
      turns: [],
      prompt: 'x'.repeat(6_568),
      attachedSkills: [],
      imageAttachments: []
    });

    expect(estimate.usedTokens).toBeGreaterThan(1_000);
    expect(estimate.usagePercent).toBeGreaterThan(0);
    expect(formatContextUsagePercent(estimate.usagePercent)).toBe('0.2%');
  });

  it('uses provider-reported usage as the base and only estimates the current draft delta', () => {
    const estimate = estimateContextWindow({
      providerId: 'openai',
      modelId: 'gpt-5.4',
      turns: [{ id: 'turn-1', threadId: 'thread-1', runId: null, role: 'user', content: 'prior transcript should not be recounted', metadata: null, createdAt: '2026-03-16T00:00:00.000Z' }],
      prompt: 'draft delta',
      attachedSkills: [],
      imageAttachments: [],
      baselineUsedTokens: 200_000
    });

    expect(estimate.usedTokens).toBeGreaterThan(200_000);
    expect(estimate.usedTokens).toBeLessThan(200_100);
    expect(estimate.maxTokens).toBe(1_000_000);
    expect(estimate.autoCompactTokenLimit).toBe(750_000);
    expect(estimate.source).toBe('provider');
    expect(estimate.pressureLabel).toBe('Healthy headroom');
    expect(estimate.sourceLabel).toBe('Latest provider report + configured model limit');
  });

  it('prefers the latest matching provider-reported usage for the active run', () => {
    const events: RunEvent[] = [
      createInfoEvent('event-1', 'run-1', 1200),
      createInfoEvent('event-2', 'run-2', 2400),
      createInfoEvent('event-3', 'run-1', 3600)
    ];

    const contextWindow = deriveProviderContextWindow(events, 'run-1', 'gemini', 'gemini-2.5-pro');

    expect(contextWindow).toMatchObject({
      source: 'provider',
      usedTokens: 3600,
      maxTokens: 1_048_576,
      pressureLabel: 'Healthy headroom',
      sourceLabel: 'Provider-reported usage from the selected model + selected model limit'
    });
  });

  it('surfaces explicit compaction-risk language for high openai usage', () => {
    const contextWindow = deriveProviderContextWindow(
      [createInfoEvent('event-1', 'run-1', 980_000)],
      'run-1',
      'openai',
      'gpt-5.4'
    );

    expect(contextWindow).toMatchObject({
      severity: 'danger',
      pressureLabel: 'High context pressure',
      sourceLabel: 'Provider-reported usage from Codex + configured model limit'
    });
    expect(contextWindow?.note).toContain('compact soon');
  });

  it('uses discovered runtime model metadata when a provider exposes the real window size', () => {
    const model = {
      id: 'gemma3',
      label: 'Gemma 3',
      description: 'Local model discovered from Ollama.',
      supportsVision: true,
      contextWindowTokens: 65_536,
      contextWindowSource: 'runtime'
    } satisfies ProviderModel;

    const estimate = estimateContextWindow({
      providerId: 'ollama',
      modelId: 'gemma3',
      model,
      turns: [],
      prompt: 'x'.repeat(8_000),
      attachedSkills: [],
      imageAttachments: []
    });

    expect(estimate.maxTokens).toBe(65_536);
    expect(estimate.sourceLabel).toContain('runtime model limit');
  });

  it('extracts the latest provider usage record for reuse in draft estimation', () => {
    const events: RunEvent[] = [
      createInfoEvent('event-1', 'run-1', 1200),
      createInfoEvent('event-2', 'run-2', 2400),
      createInfoEvent('event-3', 'run-1', 3600)
    ];

    expect(deriveLatestProviderContextWindowUsage(events, 'run-1')).toMatchObject({
      usedTokens: 3600
    });
  });

  it('uses model-specific context window limits instead of one provider-wide default', () => {
    expect(resolveContextWindowLimit('openai', 'gpt-5.4')).toBe(1_000_000);
    expect(resolveContextWindowLimit('openai', 'gpt-5')).toBe(400_000);
    expect(resolveContextWindowLimit('gemini', 'gemini-2.5-pro')).toBe(1_048_576);
    expect(resolveContextWindowLimit('kimi', 'kimi-k2-thinking')).toBe(262_144);
  });
});
