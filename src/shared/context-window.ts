import type { ContextWindowSource, ProviderId, ProviderModel } from './domain';

export interface ContextWindowPolicy {
  maxTokens: number;
  autoCompactTokenLimit: number | null;
  source: ContextWindowSource;
}

const OPENAI_CONTEXT_WINDOW_DEFAULT: ContextWindowPolicy = {
  maxTokens: 400_000,
  autoCompactTokenLimit: null,
  source: 'official'
};

const GEMINI_CONTEXT_WINDOW_DEFAULT: ContextWindowPolicy = {
  maxTokens: 1_048_576,
  autoCompactTokenLimit: null,
  source: 'official'
};

const QWEN_CONTEXT_WINDOW_DEFAULT: ContextWindowPolicy = {
  maxTokens: 1_000_000,
  autoCompactTokenLimit: null,
  source: 'official'
};

const OLLAMA_CONTEXT_WINDOW_DEFAULT: ContextWindowPolicy = {
  maxTokens: 32_768,
  autoCompactTokenLimit: null,
  source: 'heuristic'
};

const KIMI_CONTEXT_WINDOW_DEFAULT: ContextWindowPolicy = {
  maxTokens: 262_144,
  autoCompactTokenLimit: null,
  source: 'official'
};

// GPT-5.4 now supports an explicit 1M Codex context window when configured.
// We keep auto-compaction at 75% so tool-heavy turns still have enough reserve.
const OPENAI_CONTEXT_WINDOW_BY_MODEL: Record<string, ContextWindowPolicy> = {
  'gpt-5.5': OPENAI_CONTEXT_WINDOW_DEFAULT,
  'gpt-5.4': {
    maxTokens: 1_000_000,
    autoCompactTokenLimit: 750_000,
    source: 'configured'
  },
  'gpt-5.4-mini': OPENAI_CONTEXT_WINDOW_DEFAULT,
  'gpt-5.3-codex': OPENAI_CONTEXT_WINDOW_DEFAULT,
  'gpt-5': OPENAI_CONTEXT_WINDOW_DEFAULT,
  'gpt-5-mini': OPENAI_CONTEXT_WINDOW_DEFAULT
};

const GEMINI_CONTEXT_WINDOW_BY_MODEL: Record<string, ContextWindowPolicy> = {
  'auto-gemini-2.5': GEMINI_CONTEXT_WINDOW_DEFAULT,
  'auto-gemini-3': GEMINI_CONTEXT_WINDOW_DEFAULT,
  'gemini-2.5-pro': GEMINI_CONTEXT_WINDOW_DEFAULT,
  'gemini-2.5-flash': GEMINI_CONTEXT_WINDOW_DEFAULT,
  'gemini-2.5-flash-lite': GEMINI_CONTEXT_WINDOW_DEFAULT,
  'gemini-3-pro-preview': GEMINI_CONTEXT_WINDOW_DEFAULT,
  'gemini-3.1-flash-lite-preview': GEMINI_CONTEXT_WINDOW_DEFAULT,
  'gemini-3.1-pro-preview': GEMINI_CONTEXT_WINDOW_DEFAULT,
  'gemini-3-flash-preview': GEMINI_CONTEXT_WINDOW_DEFAULT
};

const QWEN_CONTEXT_WINDOW_BY_MODEL: Record<string, ContextWindowPolicy> = {
  'qwen3.5-plus': QWEN_CONTEXT_WINDOW_DEFAULT,
  'qwen3-coder-plus': QWEN_CONTEXT_WINDOW_DEFAULT,
  'qwen3-coder-flash': QWEN_CONTEXT_WINDOW_DEFAULT,
  'qwen3-coder-next': {
    maxTokens: 262_144,
    autoCompactTokenLimit: null,
    source: 'official'
  }
};

const KIMI_CONTEXT_WINDOW_BY_MODEL: Record<string, ContextWindowPolicy> = {
  'kimi-k2-thinking': KIMI_CONTEXT_WINDOW_DEFAULT,
  'kimi-k2-thinking-turbo': KIMI_CONTEXT_WINDOW_DEFAULT,
  'kimi-k2.5': KIMI_CONTEXT_WINDOW_DEFAULT
};

const OLLAMA_CONTEXT_WINDOW_BY_MODEL: Record<string, ContextWindowPolicy> = {};

function toModelOverridePolicy(
  model: Pick<ProviderModel, 'contextWindowTokens' | 'autoCompactTokenLimit' | 'contextWindowSource'> | null | undefined
) {
  if (!model || typeof model.contextWindowTokens !== 'number' || !Number.isFinite(model.contextWindowTokens) || model.contextWindowTokens <= 0) {
    return null;
  }

  return {
    maxTokens: model.contextWindowTokens,
    autoCompactTokenLimit:
      typeof model.autoCompactTokenLimit === 'number' && Number.isFinite(model.autoCompactTokenLimit)
        ? model.autoCompactTokenLimit
        : null,
    source: model.contextWindowSource ?? 'runtime'
  } satisfies ContextWindowPolicy;
}

export function resolveContextWindowPolicy(
  providerId: ProviderId,
  modelId: string,
  model?: Pick<ProviderModel, 'contextWindowTokens' | 'autoCompactTokenLimit' | 'contextWindowSource'> | null
): ContextWindowPolicy {
  const override = toModelOverridePolicy(model);
  if (override) {
    return override;
  }

  if (providerId === 'openai') {
    return OPENAI_CONTEXT_WINDOW_BY_MODEL[modelId] ?? OPENAI_CONTEXT_WINDOW_DEFAULT;
  }

  if (providerId === 'qwen') {
    return QWEN_CONTEXT_WINDOW_BY_MODEL[modelId] ?? QWEN_CONTEXT_WINDOW_DEFAULT;
  }

  if (providerId === 'ollama') {
    return OLLAMA_CONTEXT_WINDOW_BY_MODEL[modelId] ?? OLLAMA_CONTEXT_WINDOW_DEFAULT;
  }

  if (providerId === 'kimi') {
    return KIMI_CONTEXT_WINDOW_BY_MODEL[modelId] ?? KIMI_CONTEXT_WINDOW_DEFAULT;
  }

  return GEMINI_CONTEXT_WINDOW_BY_MODEL[modelId] ?? GEMINI_CONTEXT_WINDOW_DEFAULT;
}

export function resolveContextWindowLimit(
  providerId: ProviderId,
  modelId: string,
  model?: Pick<ProviderModel, 'contextWindowTokens' | 'autoCompactTokenLimit' | 'contextWindowSource'> | null
) {
  return resolveContextWindowPolicy(providerId, modelId, model).maxTokens;
}

export function resolveContextWindowAutoCompactTokenLimit(
  providerId: ProviderId,
  modelId: string,
  model?: Pick<ProviderModel, 'contextWindowTokens' | 'autoCompactTokenLimit' | 'contextWindowSource'> | null
) {
  return resolveContextWindowPolicy(providerId, modelId, model).autoCompactTokenLimit;
}

export function deriveContextWindowUsagePercent(providerId: ProviderId, modelId: string, usedTokens: number) {
  const maxTokens = resolveContextWindowLimit(providerId, modelId);
  if (maxTokens <= 0) {
    return 0;
  }
  return Math.min(999, Math.max(0, (Math.max(0, usedTokens) / maxTokens) * 100));
}

export type ContextPressureSeverity = 'normal' | 'warning' | 'danger';

const CONTEXT_WINDOW_WARNING_PERCENT = 75;
const CONTEXT_WINDOW_DANGER_PERCENT = 90;

export function deriveContextWindowSeverity(usagePercent: number): ContextPressureSeverity {
  if (usagePercent >= CONTEXT_WINDOW_DANGER_PERCENT) {
    return 'danger';
  }
  if (usagePercent >= CONTEXT_WINDOW_WARNING_PERCENT) {
    return 'warning';
  }
  return 'normal';
}

export function deriveContextWindowCompactionLikely(
  providerId: ProviderId,
  modelId: string,
  usedTokens: number
) {
  const autoCompactTokenLimit = resolveContextWindowAutoCompactTokenLimit(providerId, modelId);
  return typeof autoCompactTokenLimit === 'number' && Math.max(0, usedTokens) >= autoCompactTokenLimit;
}

export function deriveContextWindowPressureLabel(severity: ContextPressureSeverity) {
  if (severity === 'danger') {
    return 'High context pressure';
  }
  if (severity === 'warning') {
    return 'Context pressure building';
  }
  return 'Healthy headroom';
}

export function deriveProviderContextSourceLabel(providerId: ProviderId) {
  if (providerId === 'openai') {
    return 'Provider-reported usage from Codex';
  }
  if (providerId === 'qwen') {
    return 'Provider-reported usage from Qwen';
  }
  return 'Provider-reported usage from the selected model';
}

export function deriveContextWindowNote(
  providerId: ProviderId,
  severity: ContextPressureSeverity,
  hasProviderBaseline: boolean
) {
  if (providerId === 'openai') {
    if (severity === 'danger') {
      return 'Codex is likely to compact soon. Preserve critical intent in durable notes before another long turn.';
    }
    if (severity === 'warning') {
      return 'Codex compacts automatically, but this thread is nearing the point where long follow-ups can lose detail.';
    }
    return hasProviderBaseline
      ? 'Codex usage is flowing back into the app, and the current thread still has comfortable room.'
      : 'Codex automatically compacts its context and the current thread still has comfortable room.';
  }

  if (severity === 'danger') {
    return 'Continuity loss or compaction is likely soon. Trim low-value detail or capture a durable note before the next long turn.';
  }
  if (severity === 'warning') {
    return 'Long follow-ups may start to lose continuity. Preserve the operating contract before another heavy prompt.';
  }

  if (providerId === 'qwen') {
    return hasProviderBaseline
      ? 'Qwen reported prior usage and the app is only estimating the current draft delta.'
      : 'Current thread and draft usage are estimated locally for Qwen.';
  }

  return hasProviderBaseline
    ? 'The provider reported prior usage and the app is estimating the current draft delta.'
    : 'Current thread and draft usage are estimated locally.';
}
