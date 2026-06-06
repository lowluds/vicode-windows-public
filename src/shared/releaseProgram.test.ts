import { describe, expect, it } from 'vitest';
import { PROVIDER_IDS } from './domain';
import {
  APP_BUILDER_BENCHMARKS,
  getProviderBenchmarkRequirements,
  getProviderGraduationTarget,
  PROVIDER_BENCHMARK_REQUIREMENTS,
  PROVIDER_GRADUATION_TARGETS,
  RELEASE_WORKFLOW_LADDER
} from './releaseProgram';

describe('release program contract', () => {
  it('defines a five-tier workflow ladder in ascending order', () => {
    expect(RELEASE_WORKFLOW_LADDER.map((entry) => entry.tier)).toEqual([1, 2, 3, 4, 5]);
  });

  it('covers every provider with an explicit graduation target', () => {
    expect(Object.keys(PROVIDER_GRADUATION_TARGETS).sort()).toEqual([...PROVIDER_IDS].sort());
    expect(getProviderGraduationTarget('openai').targetTier).toBe(1);
    expect(getProviderGraduationTarget('gemini').targetTier).toBe(1);
    expect(getProviderGraduationTarget('ollama').targetTier).toBe(4);
    expect(getProviderGraduationTarget('qwen').targetTier).toBe(1);
    expect(getProviderGraduationTarget('kimi').targetTier).toBe(1);
  });

  it('keeps the current beta release blocker limited to Ollama', () => {
    const releaseBlockingProviders = PROVIDER_IDS.filter((providerId) => getProviderGraduationTarget(providerId).releaseBlocking);
    expect(releaseBlockingProviders).toEqual(['ollama']);
  });

  it('defines unique app-builder benchmarks', () => {
    const ids = APP_BUILDER_BENCHMARKS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('marketing-site');
    expect(ids).toContain('bugfix-slice');
    expect(ids).toContain('same-thread-complex-project');
  });

  it('requires every provider to have benchmark coverage mapped to defined scenarios', () => {
    const validIds = new Set(APP_BUILDER_BENCHMARKS.map((entry) => entry.id));
    for (const providerId of PROVIDER_IDS) {
      const requirements = getProviderBenchmarkRequirements(providerId);
      if (providerId === 'openai' || providerId === 'gemini' || providerId === 'qwen' || providerId === 'kimi') {
        expect(requirements).toEqual([]);
        continue;
      }
      expect(requirements.length).toBeGreaterThan(0);
      expect(requirements.every((id) => validIds.has(id))).toBe(true);
    }

    expect(PROVIDER_BENCHMARK_REQUIREMENTS.openai).toEqual([]);
    expect(PROVIDER_BENCHMARK_REQUIREMENTS.openai_compatible).toContain('marketing-site');
    expect(PROVIDER_BENCHMARK_REQUIREMENTS.openai_compatible).toContain('docs-site');
    expect(PROVIDER_BENCHMARK_REQUIREMENTS.ollama).not.toContain('same-thread-complex-project');
    expect(PROVIDER_BENCHMARK_REQUIREMENTS.ollama).not.toContain('auth-app');
    expect(PROVIDER_BENCHMARK_REQUIREMENTS.gemini).toEqual([]);
    expect(PROVIDER_BENCHMARK_REQUIREMENTS.qwen).toEqual([]);
    expect(PROVIDER_BENCHMARK_REQUIREMENTS.kimi).toEqual([]);
  });
});
