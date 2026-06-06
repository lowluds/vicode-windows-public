import type { ProviderContextWindowUsage } from '../shared/domain';

const TOTAL_TOKEN_KEYS = [
  'total_tokens',
  'totalTokens',
  'totalTokenCount',
  'tokenCount',
  'tokensUsed'
];

const INPUT_TOKEN_KEYS = [
  'prompt_tokens',
  'promptTokens',
  'promptTokenCount',
  'input_tokens',
  'inputTokens',
  'inputTokenCount',
  'prompt_eval_count',
  'promptEvalCount'
];

const OUTPUT_TOKEN_KEYS = [
  'completion_tokens',
  'completionTokens',
  'completionTokenCount',
  'output_tokens',
  'outputTokens',
  'outputTokenCount',
  'candidatesTokenCount',
  'eval_count',
  'evalCount'
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function readFirstNumber(records: Record<string, unknown>[], keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const value = readNumber(record[key]);
      if (value !== null) {
        return value;
      }
    }
  }
  return null;
}

function collectUsageRecords(payload: unknown) {
  if (!isRecord(payload)) {
    return [];
  }

  return [
    isRecord(payload.usage) ? payload.usage : null,
    isRecord(payload.usageMetadata) ? payload.usageMetadata : null,
    isRecord(payload.stats) ? payload.stats : null,
    payload
  ].filter((record): record is Record<string, unknown> => Boolean(record));
}

export function normalizeProviderContextWindowUsage(
  payload: unknown,
  providerEventType: string | null = null
): ProviderContextWindowUsage | null {
  const records = collectUsageRecords(payload);
  if (records.length === 0) {
    return null;
  }

  const inputTokens = readFirstNumber(records, INPUT_TOKEN_KEYS);
  const outputTokens = readFirstNumber(records, OUTPUT_TOKEN_KEYS);
  const totalTokens = readFirstNumber(records, TOTAL_TOKEN_KEYS);
  const usedTokens =
    totalTokens ??
    (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null) ??
    inputTokens ??
    outputTokens;

  if (!usedTokens || usedTokens <= 0) {
    return null;
  }

  return {
    usedTokens,
    inputTokens,
    outputTokens,
    providerEventType
  };
}
