import type { ProviderId, ProviderModel, ProviderModelRecommendation } from '../shared/domain';
import { resolveContextWindowAutoCompactTokenLimit, resolveContextWindowLimit, resolveContextWindowPolicy } from '../shared/context-window';
import { OLLAMA_DEFAULT_LOCAL_MODEL_ID, OLLAMA_LIGHTWEIGHT_SMOKE_MODEL_ID } from '../shared/providers';

function withKnownContextWindow(providerId: ProviderId, model: ProviderModel): ProviderModel {
  if (typeof model.contextWindowTokens === 'number' && model.contextWindowTokens > 0) {
    return {
      ...model,
      autoCompactTokenLimit:
        typeof model.autoCompactTokenLimit === 'number' && Number.isFinite(model.autoCompactTokenLimit)
          ? model.autoCompactTokenLimit
          : null,
      contextWindowSource: model.contextWindowSource ?? 'runtime'
    };
  }

  const policy = resolveContextWindowPolicy(providerId, model.id);
  return {
    ...model,
    contextWindowTokens: resolveContextWindowLimit(providerId, model.id),
    autoCompactTokenLimit: resolveContextWindowAutoCompactTokenLimit(providerId, model.id),
    contextWindowSource: policy.source
  };
}

const FALLBACK_MODELS: Record<ProviderId, ProviderModel[]> = {
  openai: [
    { id: 'gpt-5.5', label: 'GPT-5.5', description: 'Latest frontier coding and reasoning model available through an OpenAI API key.', supportsVision: true },
    { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Frontier coding and reasoning model available through an OpenAI API key.', supportsVision: true },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3', description: 'OpenAI coding model available through an OpenAI API key.', supportsVision: true },
    { id: 'gpt-5', label: 'GPT-5', description: 'Balanced coding model for day-to-day work.', supportsVision: true },
    { id: 'gpt-5-mini', label: 'GPT-5 Mini', description: 'Faster, cheaper model for lightweight tasks.', supportsVision: true, recommendation: 'fast' }
  ],
  gemini: [
    { id: 'auto-gemini-2.5', label: 'Auto Gemini 2.5', description: 'Recommended Gemini 2.5 route that can shift between stable 2.5 lanes when capacity changes.', supportsVision: true, recommendation: 'recommended' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Best quality for large-context reasoning.', supportsVision: true, recommendation: 'recommended' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast model for iterative chat and automations.', supportsVision: true, recommendation: 'fast' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', description: 'Lightweight Gemini Flash variant for cheaper, faster tasks.', supportsVision: true },
    { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview', description: 'Historical Gemini preview metadata retained for legacy thread records.', supportsVision: true, recommendation: 'preview' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', description: 'Historical Gemini preview metadata retained for legacy thread records.', supportsVision: true, recommendation: 'preview' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', description: 'Historical Gemini preview metadata retained for legacy thread records.', supportsVision: true, recommendation: 'preview' }
  ],
  qwen: [
    {
      id: 'qwen3.5-plus',
      label: 'Qwen 3.5 Plus',
      description: 'Free Qwen OAuth model recommended for first-run Vicode support.',
      supportsVision: true
    }
  ],
  ollama: [
    {
      id: OLLAMA_DEFAULT_LOCAL_MODEL_ID,
      label: 'Qwen 2.5 Coder 14B Q6',
      description: 'GPU-safe local coding default served through Ollama.',
      supportsVision: false,
      recommendation: 'recommended'
    },
    {
      id: OLLAMA_LIGHTWEIGHT_SMOKE_MODEL_ID,
      label: 'Qwen 2.5 Coder 7B',
      description: 'Lightweight local coding model for fast smoke tests.',
      supportsVision: false,
      recommendation: 'fast'
    },
    {
      id: 'qwen3',
      label: 'Qwen 3',
      description: 'Local Qwen model served through Ollama.',
      supportsVision: false
    },
    {
      id: 'qwen3-coder',
      label: 'Qwen 3 Coder',
      description: 'Local coding-oriented Qwen model served through Ollama.',
      supportsVision: false,
      recommendation: 'recommended'
    },
    {
      id: 'qwen2.5vl',
      label: 'Qwen 2.5 VL',
      description: 'Vision-capable Qwen model served through Ollama.',
      supportsVision: true
    },
    {
      id: 'gemma3',
      label: 'Gemma 3',
      description: 'Multimodal Gemma model served through Ollama.',
      supportsVision: true
    },
    {
      id: 'llava',
      label: 'LLaVA',
      description: 'Vision model served through Ollama.',
      supportsVision: true
    },
    {
      id: 'llama3.1',
      label: 'Llama 3.1',
      description: 'Local Llama model served through Ollama.',
      supportsVision: false
    },
    {
      id: 'deepseek-coder',
      label: 'DeepSeek Coder',
      description: 'Local coding model served through Ollama.',
      supportsVision: false
    }
  ],
  kimi: [
    {
      id: 'kimi-k2-thinking',
      label: 'Kimi K2 Thinking',
      description: 'Reasoning-first Kimi coding model exposed by Kimi Code CLI.',
      supportsVision: false
    },
    {
      id: 'kimi-k2-thinking-turbo',
      label: 'Kimi K2 Thinking Turbo',
      description: 'Faster Kimi reasoning model exposed by Kimi Code CLI.',
      supportsVision: false
    }
  ],
  openai_compatible: []
};

const ALLOWLIST_PATTERNS: Record<ProviderId, RegExp[]> = {
  openai: [/^gpt-5([.-].+)?$/i],
  gemini: [/^gemini-(?:2\.5|3(?:\.1)?)-[a-z0-9.-]+$/i, /^auto-gemini-(?:2\.5|3)$/i],
  qwen: [/^qwen(?:[\d.]+)?-(?:plus|max|turbo|coder(?:-[a-z0-9.-]+)?)$/i],
  ollama: [/^[a-z0-9][a-z0-9._-]*(?::[a-z0-9._-]+)?$/i],
  kimi: [/^kimi-[a-z0-9.-]+$/i],
  openai_compatible: [/^openai-compatible:[^:]+:[^:]+$/i]
};

const PREFERRED_OPENAI_ORDER = [
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2-codex',
  'gpt-5.2',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5',
  'gpt-5-mini'
];

const PREFERRED_GEMINI_ORDER = [
  'auto-gemini-2.5',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'auto-gemini-3',
  'gemini-3-pro-preview',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview'
];

const MODEL_ALIASES: Partial<Record<ProviderId, Record<string, string>>> = {
  gemini: {
    'gemini-3.1-flash-preview': 'gemini-3-flash-preview'
  }
};

const PREFERRED_QWEN_ORDER = ['qwen3.5-plus', 'qwen3-coder-plus', 'qwen3-coder-next'];
const PREFERRED_OLLAMA_ORDER = [
  OLLAMA_DEFAULT_LOCAL_MODEL_ID,
  OLLAMA_LIGHTWEIGHT_SMOKE_MODEL_ID,
  'qwen3-coder',
  'qwen2.5vl',
  'gemma3',
  'llava',
  'deepseek-coder',
  'qwen3',
  'llama3.1'
];
const PREFERRED_KIMI_ORDER = ['kimi-k2-thinking', 'kimi-k2-thinking-turbo'];
const PREFERRED_OPENAI_COMPATIBLE_ORDER: string[] = [];
const UNSUPPORTED_MODEL_IDS: Partial<Record<ProviderId, Set<string>>> = {
  gemini: new Set(['gemini-3.1-flash-lite-preview'])
};

export function getProviderFallbackModels(providerId: ProviderId): ProviderModel[] {
  return FALLBACK_MODELS[providerId].map((model) => withKnownContextWindow(providerId, model));
}

export function filterUnsupportedProviderModels(providerId: ProviderId, models: ProviderModel[]) {
  const unsupported = UNSUPPORTED_MODEL_IDS[providerId];
  if (!unsupported?.size) {
    return models;
  }

  return models.filter((model) => !unsupported.has(model.id));
}

interface SanitizeDiscoveredModelsOptions {
  preserveInputOrder?: boolean;
}

export function sanitizeDiscoveredModels(
  providerId: ProviderId,
  models: ProviderModel[],
  options: SanitizeDiscoveredModelsOptions = {}
): ProviderModel[] {
  const allowlist = ALLOWLIST_PATTERNS[providerId];
  const deduped = new Map<string, ProviderModel>();

  for (const model of models) {
    const normalizedId = model.id.trim();
    if (!normalizedId || !allowlist.some((pattern) => pattern.test(normalizedId))) {
      continue;
    }

    const recommendation =
      providerId === 'openai' && model.recommendation === 'recommended'
        ? defaultModelRecommendation(providerId, normalizedId)
        : model.recommendation ?? defaultModelRecommendation(providerId, normalizedId);
    const trimmedLabel = model.label.trim();
    const label =
      trimmedLabel && trimmedLabel !== normalizedId && !(providerId === 'openai' && /codex/iu.test(trimmedLabel))
        ? trimmedLabel
        : formatProviderModelLabel(providerId, normalizedId);
    const trimmedDescription = model.description.trim();
    const description =
      trimmedDescription && !(providerId === 'openai' && /codex/iu.test(trimmedDescription))
        ? trimmedDescription
        : defaultModelDescription(providerId, normalizedId);

    deduped.set(normalizedId, {
      id: normalizedId,
      label,
      description,
      supportsVision: model.supportsVision ?? false,
      recommendation,
      contextWindowTokens: model.contextWindowTokens ?? null,
      autoCompactTokenLimit: model.autoCompactTokenLimit ?? null,
      contextWindowSource: model.contextWindowSource
    });
  }

  const visibleModels = [...deduped.values()].map((model) => withKnownContextWindow(providerId, model));
  return filterUnsupportedProviderModels(
    providerId,
    options.preserveInputOrder ? visibleModels : sortModels(providerId, visibleModels)
  );
}

export function humanizeModelId(modelId: string) {
  return modelId
    .split(/[-.]/u)
    .filter(Boolean)
    .map((part) => {
      if (/^\d+$/u.test(part)) {
        return part;
      }
      if (part.length <= 3) {
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

export function createProviderModelFromId(providerId: ProviderId, modelId: string): ProviderModel | null {
  const normalizedId = resolveProviderModelAlias(providerId, modelId);
  if (!normalizedId || !ALLOWLIST_PATTERNS[providerId].some((pattern) => pattern.test(normalizedId))) {
    return null;
  }

  return withKnownContextWindow(providerId, {
    id: normalizedId,
    label: formatProviderModelLabel(providerId, normalizedId),
    description: defaultModelDescription(providerId, normalizedId),
    supportsVision: providerId === 'openai' || providerId === 'gemini' || providerId === 'qwen',
    recommendation: defaultModelRecommendation(providerId, normalizedId)
  });
}

export function resolveProviderModelAlias(providerId: ProviderId, modelId: string) {
  const normalizedId = modelId.trim();
  if (!normalizedId) {
    return normalizedId;
  }

  return MODEL_ALIASES[providerId]?.[normalizedId] ?? normalizedId;
}

function formatProviderModelLabel(providerId: ProviderId, modelId: string) {
  if (providerId === 'openai') {
    return modelId
      .split('-')
      .flatMap((part) => {
        if (part === 'gpt') {
          return ['GPT'];
        }
        if (part === 'codex') {
          return [];
        }
        if (part === 'mini') {
          return ['Mini'];
        }
        if (part === 'max') {
          return ['Max'];
        }
        if (part === 'spark') {
          return ['Spark'];
        }
        return [part];
      })
      .join('-');
  }

  if (providerId === 'qwen') {
    return modelId
      .replace(/^qwen/iu, 'Qwen ')
      .replace(/-/gu, ' ')
      .replace(/\b([a-z])/gu, (match) => match.toUpperCase())
      .replace(/\s+/gu, ' ')
      .trim();
  }

  if (providerId === 'ollama') {
    return humanizeModelId(modelId.replace(/:/gu, ' '));
  }

  if (providerId === 'kimi') {
    return modelId
      .replace(/^kimi/iu, 'Kimi ')
      .replace(/-/gu, ' ')
      .replace(/\b([a-z])/gu, (match) => match.toUpperCase())
      .replace(/\s+/gu, ' ')
      .trim();
  }

  if (modelId.startsWith('auto-gemini-')) {
    return modelId
      .replace(/^auto-gemini-/u, 'Auto Gemini ')
      .replace(/-/gu, ' ')
      .replace(/\b([a-z])/gu, (match) => match.toUpperCase());
  }

  return modelId
    .replace(/^gemini-/u, 'Gemini ')
    .replace(/-/gu, ' ')
    .replace(/\b([a-z])/gu, (match) => match.toUpperCase());
}

function defaultModelDescription(providerId: ProviderId, modelId: string) {
  if (providerId === 'openai') {
    return modelId.includes('mini')
      ? 'Fast coding model available through an OpenAI API key.'
      : 'Coding-capable model available through an OpenAI API key.';
  }

  if (providerId === 'qwen') {
    return modelId.includes('coder')
      ? 'Coding-capable Qwen model discovered from the local Qwen runtime.'
      : 'Qwen model discovered from the local Qwen runtime.';
  }

  if (providerId === 'ollama') {
    return modelId.includes('coder')
      ? 'Coding-capable local model discovered from Ollama.'
      : 'Local model discovered from Ollama.';
  }

  if (providerId === 'kimi') {
    return modelId.includes('thinking')
      ? 'Reasoning-first Kimi model discovered from the local Kimi runtime.'
      : 'Kimi model discovered from the local Kimi runtime.';
  }

  if (modelId.startsWith('auto-gemini-')) {
    return 'Historical Gemini router model retained for legacy thread records.';
  }

  return modelId.includes('flash')
    ? 'Fast Gemini model discovered from Google.'
    : 'Coding-capable Gemini model discovered from Google.';
}

function defaultModelRecommendation(
  providerId: ProviderId,
  modelId: string
): ProviderModelRecommendation | undefined {
  if (providerId === 'openai') {
    if (modelId === 'gpt-5-mini' || modelId === 'gpt-5.4-mini') {
      return 'fast';
    }
    return undefined;
  }

  if (providerId === 'gemini') {
    if (modelId === 'gemini-2.5-pro' || modelId === 'auto-gemini-2.5') {
      return 'recommended';
    }
    if (modelId === 'gemini-2.5-flash') {
      return 'fast';
    }
    if (/preview/i.test(modelId) || modelId === 'auto-gemini-3') {
      return 'preview';
    }
    return undefined;
  }

  if (providerId === 'ollama') {
    if (modelId === OLLAMA_DEFAULT_LOCAL_MODEL_ID) {
      return 'recommended';
    }
    if (modelId === OLLAMA_LIGHTWEIGHT_SMOKE_MODEL_ID) {
      return 'fast';
    }
    return undefined;
  }

  return undefined;
}

function getOpenAIModelSortKey(modelId: string) {
  const match = modelId.match(/^gpt-(\d+)(?:\.(\d+))?(?:-|$)/iu);
  if (!match) {
    return null;
  }

  const major = Number(match[1]);
  const minor = Number(match[2] ?? '0');
  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return null;
  }

  const variantRank =
    /^gpt-\d+(?:\.\d+)?$/iu.test(modelId)
      ? 0
      : /codex/iu.test(modelId)
        ? 1
        : /mini/iu.test(modelId)
          ? 2
          : /spark/iu.test(modelId)
            ? 3
            : 4;

  return {
    version: major * 100 + minor,
    variantRank
  };
}

function sortModels(providerId: ProviderId, models: ProviderModel[]) {
  const preferredOrder =
    providerId === 'openai'
      ? PREFERRED_OPENAI_ORDER
      : providerId === 'gemini'
        ? PREFERRED_GEMINI_ORDER
      : providerId === 'qwen'
          ? PREFERRED_QWEN_ORDER
          : providerId === 'ollama'
            ? PREFERRED_OLLAMA_ORDER
            : providerId === 'kimi'
              ? PREFERRED_KIMI_ORDER
              : PREFERRED_OPENAI_COMPATIBLE_ORDER;

  return [...models].sort((left, right) => {
    if (providerId === 'openai') {
      const leftOpenAI = getOpenAIModelSortKey(left.id);
      const rightOpenAI = getOpenAIModelSortKey(right.id);
      if (leftOpenAI || rightOpenAI) {
        if (!leftOpenAI) {
          return 1;
        }
        if (!rightOpenAI) {
          return -1;
        }
        if (leftOpenAI.version !== rightOpenAI.version) {
          return rightOpenAI.version - leftOpenAI.version;
        }
        if (leftOpenAI.variantRank !== rightOpenAI.variantRank) {
          return leftOpenAI.variantRank - rightOpenAI.variantRank;
        }
      }
    }

    const leftRank = preferredOrder.indexOf(left.id);
    const rightRank = preferredOrder.indexOf(right.id);

    if (leftRank >= 0 || rightRank >= 0) {
      return (leftRank >= 0 ? leftRank : Number.MAX_SAFE_INTEGER) - (rightRank >= 0 ? rightRank : Number.MAX_SAFE_INTEGER);
    }

    return right.label.localeCompare(left.label, undefined, { numeric: true, sensitivity: 'base' });
  });
}
