import type { ProviderId, ProviderModel, ProviderModelRecommendation } from './domain-provider';

export const OLLAMA_DEFAULT_LOCAL_MODEL_ID = 'qwen2.5-coder:14b-instruct-q6_K';

export const OLLAMA_LIGHTWEIGHT_SMOKE_MODEL_ID = 'qwen2.5-coder:7b';

export const OLLAMA_LOCAL_MODEL_ID_PREFIX = 'local:';

export function encodeOllamaLocalModelId(modelId: string) {
  const trimmed = modelId.trim();
  return trimmed.startsWith(OLLAMA_LOCAL_MODEL_ID_PREFIX)
    ? trimmed
    : `${OLLAMA_LOCAL_MODEL_ID_PREFIX}${trimmed}`;
}

export function isOllamaLocalModelId(modelId: string) {
  return modelId.trim().startsWith(OLLAMA_LOCAL_MODEL_ID_PREFIX);
}

export function decodeOllamaModelId(modelId: string) {
  const trimmed = modelId.trim();
  return isOllamaLocalModelId(trimmed)
    ? trimmed.slice(OLLAMA_LOCAL_MODEL_ID_PREFIX.length)
    : trimmed;
}

export function resolveOllamaApiKeyForModel(modelId: string, apiKey: string | null) {
  return null;
}

export function selectPreferredOllamaModel<T extends { id: string }>(models: readonly T[]) {
  const exactDefault = models.find((entry) => entry.id === OLLAMA_DEFAULT_LOCAL_MODEL_ID);
  if (exactDefault) {
    return exactDefault;
  }

  const qwen25Coder14b = models.find((entry) => /^qwen2\.5-coder:14b(?:$|[-_:])/i.test(entry.id));
  if (qwen25Coder14b) {
    return qwen25Coder14b;
  }

  const qwen25Coder7b = models.find((entry) => entry.id === OLLAMA_LIGHTWEIGHT_SMOKE_MODEL_ID);
  if (qwen25Coder7b) {
    return qwen25Coder7b;
  }

  return (
    models.find((entry) => /coder/i.test(entry.id)) ??
    models.find((entry) => /deepseek/i.test(entry.id)) ??
    models.find((entry) => /qwen/i.test(entry.id)) ??
    models.find((entry) => /llama/i.test(entry.id)) ??
    models[0]
  );
}

const OLLAMA_PRACTICAL_VISION_MODEL_MAX_BILLIONS = 32;

function getOllamaVisionModelFamilyRank(modelId: string) {
  if (/qwen.*(?:vl|vision)|qwen2\.5vl|qwen2-vl/i.test(modelId)) {
    return 0;
  }
  if (/gemma3/i.test(modelId)) {
    return 1;
  }
  if (/llava|bakllava/i.test(modelId)) {
    return 2;
  }
  if (/minicpm-v|moondream|mllama/i.test(modelId)) {
    return 3;
  }
  return 4;
}

function isPracticalOllamaVisionModel(modelId: string) {
  const size = parseModelSizeBillions(modelId);
  return !Number.isFinite(size) || size <= OLLAMA_PRACTICAL_VISION_MODEL_MAX_BILLIONS;
}

function compareOllamaVisionModels<T extends { id: string }>(left: T, right: T) {
  const leftFamilyRank = getOllamaVisionModelFamilyRank(left.id);
  const rightFamilyRank = getOllamaVisionModelFamilyRank(right.id);
  if (leftFamilyRank !== rightFamilyRank) {
    return leftFamilyRank - rightFamilyRank;
  }

  const leftSize = parseModelSizeBillions(left.id);
  const rightSize = parseModelSizeBillions(right.id);
  if (leftSize !== rightSize) {
    return leftSize - rightSize;
  }

  return left.id.localeCompare(right.id, undefined, { sensitivity: 'base' });
}

export function selectPreferredOllamaVisionModel<T extends { id: string; supportsVision?: boolean }>(
  models: readonly T[]
) {
  const visionModels = models.filter((model) => model.supportsVision);
  if (visionModels.length === 0) {
    return null;
  }

  const practicalVisionModels = visionModels.filter((model) => isPracticalOllamaVisionModel(model.id));
  const rankedModels = (practicalVisionModels.length > 0 ? practicalVisionModels : visionModels)
    .slice()
    .sort(compareOllamaVisionModels);

  return rankedModels[0] ?? null;
}

export function selectPreferredOllamaValidationModels<T extends { id: string }>(models: readonly T[]) {
  const primary = selectPreferredOllamaModel(models);
  if (!primary) {
    return [];
  }

  const alternate =
    models.find((entry) => entry.id !== primary.id && entry.id === OLLAMA_LIGHTWEIGHT_SMOKE_MODEL_ID) ??
    models.find((entry) => entry.id !== primary.id && /qwen|llama/i.test(entry.id)) ??
    models.find((entry) => entry.id !== primary.id && /deepseek|coder/i.test(entry.id)) ??
    models.find((entry) => entry.id !== primary.id) ??
    null;

  return alternate ? [primary, alternate] : [primary];
}

function parseModelSizeBillions(modelId: string) {
  const match = modelId.match(/(?:^|[:\-])(\d+(?:\.\d+)?)b(?:$|[^a-z])/i) ?? modelId.match(/\b(\d+(?:\.\d+)?)b\b/i);
  return match ? Number.parseFloat(match[1]) : Number.POSITIVE_INFINITY;
}

function selectByIdPattern<T extends { id: string }>(models: readonly T[], pattern: RegExp) {
  return models.find((model) => pattern.test(model.id)) ?? null;
}

function selectByRecommendation<T extends { recommendation?: ProviderModelRecommendation }>(
  models: readonly T[],
  recommendation: ProviderModelRecommendation
) {
  return models.find((model) => model.recommendation === recommendation) ?? null;
}

export function selectPreferredSubagentModel<T extends Pick<ProviderModel, 'id' | 'recommendation'>>(
  providerId: ProviderId,
  models: readonly T[]
) {
  if (models.length === 0) {
    return null;
  }

  if (providerId === 'openai') {
    return (
      selectByIdPattern(models, /^gpt-5(?:\.\d+)?-mini$/i) ??
      selectByRecommendation(models, 'fast') ??
      selectByIdPattern(models, /\bmini\b/i) ??
      selectByRecommendation(models, 'recommended') ??
      models[0]
    );
  }

  if (providerId === 'gemini') {
    return (
      selectByRecommendation(models, 'fast') ??
      selectByIdPattern(models, /flash-lite/i) ??
      selectByIdPattern(models, /\bflash\b/i) ??
      selectByRecommendation(models, 'recommended') ??
      models[0]
    );
  }

  if (providerId === 'ollama') {
    const preferredPool = models.filter((model) => /coder|qwen|deepseek|llama/i.test(model.id));
    const ranked = (preferredPool.length > 0 ? preferredPool : models).slice().sort((left, right) => {
      const leftCategory = /coder|qwen/i.test(left.id) ? 0 : /deepseek/i.test(left.id) ? 1 : /llama/i.test(left.id) ? 2 : 3;
      const rightCategory = /coder|qwen/i.test(right.id) ? 0 : /deepseek/i.test(right.id) ? 1 : /llama/i.test(right.id) ? 2 : 3;
      if (leftCategory !== rightCategory) {
        return leftCategory - rightCategory;
      }

      const leftSize = parseModelSizeBillions(left.id);
      const rightSize = parseModelSizeBillions(right.id);
      if (leftSize !== rightSize) {
        return leftSize - rightSize;
      }

      return left.id.localeCompare(right.id, undefined, { sensitivity: 'base' });
    });

    return selectByRecommendation(models, 'fast') ?? ranked[0] ?? selectPreferredOllamaModel(models) ?? models[0];
  }

  if (providerId === 'qwen') {
    return (
      selectByRecommendation(models, 'fast') ??
      selectByIdPattern(models, /turbo|lite|mini/i) ??
      selectByRecommendation(models, 'recommended') ??
      models[0]
    );
  }

  return (
    selectByRecommendation(models, 'fast') ??
    selectByIdPattern(models, /lite|mini|fast/i) ??
    selectByRecommendation(models, 'recommended') ??
    models[0]
  );
}
