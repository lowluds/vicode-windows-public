import { sanitizeDiscoveredModels } from '../catalog';
import type { ProviderModel } from '../../shared/domain';
import type { OllamaShowResponse, OllamaTagResponse } from './runtime';

function extractModelName(entry: OllamaTagResponse['models'][number]) {
  const value = typeof entry.name === 'string' && entry.name.trim()
    ? entry.name.trim()
    : typeof entry.model === 'string' && entry.model.trim()
      ? entry.model.trim()
      : null;
  return value;
}

function inferOllamaVisionSupport(modelId: string, families: string[]) {
  const haystack = [modelId, ...families].join(' ').toLowerCase();
  return /(?:^|[\s:-])(vision|vl|llava|bakllava|moondream|minicpm-v|mllama|clip|gemma3)(?:$|[\s:-])/.test(haystack)
    || haystack.includes('qwen2.5vl')
    || haystack.includes('qwen2-vl');
}

function readPositiveNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return null;
}

function readOllamaConfiguredContextLength(parameters: string | null | undefined) {
  if (!parameters) {
    return null;
  }

  const match = parameters.match(/(?:^|\r?\n)\s*num_ctx\s+(\d+)/iu);
  return match ? readPositiveNumber(match[1]) : null;
}

function readOllamaModelContextLength(modelInfo: Record<string, unknown> | null | undefined) {
  if (!modelInfo) {
    return null;
  }

  for (const [key, value] of Object.entries(modelInfo)) {
    if (key === 'general.context_length' || key.endsWith('.context_length')) {
      const numeric = readPositiveNumber(value);
      if (numeric) {
        return numeric;
      }
    }
  }

  return null;
}

export function deriveOllamaContextWindowTokens(details: OllamaShowResponse | null) {
  if (!details) {
    return null;
  }

  const configuredContextLength = readOllamaConfiguredContextLength(details.parameters);
  if (configuredContextLength) {
    return configuredContextLength;
  }

  return readOllamaModelContextLength(details.model_info ?? null);
}

export async function mapOllamaDiscoveredModels(
  payload: OllamaTagResponse | null,
  loadModelDetails: ((modelId: string) => Promise<OllamaShowResponse | null>) | null
) {
  if (!payload) {
    return null;
  }

  const discovered = (await Promise.all(
    (payload.models ?? []).map(async (entry) => {
      const id = extractModelName(entry);
      if (!id) {
        return null;
      }
      const families = Array.isArray(entry.details?.families) ? entry.details.families.filter((value): value is string => typeof value === 'string') : [];
      const details = loadModelDetails ? await loadModelDetails(id) : null;
      const contextWindowTokens = deriveOllamaContextWindowTokens(details);
      return {
        id,
        label: id,
        description:
          families.length > 0
            ? `Local Ollama model from families: ${families.join(', ')}.`
            : 'Local model discovered from Ollama.',
        supportsVision: inferOllamaVisionSupport(id, families),
        contextWindowTokens,
        contextWindowSource: contextWindowTokens ? 'runtime' : undefined
      } satisfies ProviderModel;
    })
  ))
    .filter((value): value is ProviderModel => Boolean(value));

  return discovered.length > 0 ? sanitizeDiscoveredModels('ollama', discovered, { preserveInputOrder: true }) : [];
}
