import type { ImageAttachment, ProviderContextWindowUsage, ProviderId, ProviderModel, RunEvent, SkillDefinition, TextAttachment, ThreadTurn } from '../../shared/domain';
import {
  deriveContextWindowNote,
  deriveContextWindowPressureLabel,
  deriveContextWindowSeverity,
  deriveProviderContextSourceLabel,
  resolveContextWindowPolicy
} from '../../shared/context-window';
export { resolveContextWindowLimit } from '../../shared/context-window';

export interface ContextWindowEstimate {
  maxTokens: number;
  autoCompactTokenLimit: number | null;
  usedTokens: number;
  usagePercent: number;
  title: string;
  pressureLabel: string;
  note: string;
  sourceLabel: string;
  source: 'estimate' | 'provider';
  severity: 'normal' | 'warning' | 'danger';
}

interface EstimateContextWindowInput {
  providerId: ProviderId;
  modelId: string;
  model?: ProviderModel | null;
  turns: ThreadTurn[];
  prompt: string;
  attachedSkills: SkillDefinition[];
  imageAttachments: ImageAttachment[];
  textAttachments?: TextAttachment[];
  baselineUsedTokens?: number | null;
}

const IMAGE_ATTACHMENT_TOKEN_ESTIMATE = 850;
export function formatContextTokenCount(value: number) {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(1)}M`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 1_000)}k`;
  }

  return value.toLocaleString();
}

export function formatContextUsagePercent(value: number) {
  if (value <= 0) {
    return '0%';
  }
  if (value < 0.1) {
    return '<0.1%';
  }
  if (value < 10) {
    return `${value.toFixed(1)}%`;
  }
  return `${Math.round(value)}%`;
}

export function deriveContextWindowMeterPercent(value: number) {
  const boundedValue = Math.min(100, Math.max(0, value));
  if (boundedValue <= 0) {
    return 0;
  }

  // Keep low-usage movement visible on very large context windows without
  // changing the exact numeric percentage shown in the tooltip.
  if (boundedValue < 10) {
    return Math.max(3.5, Math.sqrt(boundedValue / 10) * 10);
  }

  return boundedValue;
}

export function estimateContextWindow(input: EstimateContextWindowInput): ContextWindowEstimate {
  const policy = resolveContextWindowPolicy(input.providerId, input.modelId, input.model);
  const maxTokens = policy.maxTokens;
  const autoCompactTokenLimit = policy.autoCompactTokenLimit;
  const baseUsedTokens = Math.max(0, input.baselineUsedTokens ?? 0);
  const imageAttachments = input.imageAttachments ?? [];
  const textAttachments = input.textAttachments ?? [];
  const estimatedTextTokens =
    input.baselineUsedTokens == null
      ? estimateTokenCount(
          `${input.turns.map((turn) => turn.content).join('\n')}\n${input.prompt}\n${input.attachedSkills
            .map((skill) => `${skill.name}\n${skill.description}\n${skill.instructions}`)
            .join('\n')}`
        )
      : estimateTokenCount(
          `${input.prompt}\n${input.attachedSkills
            .map((skill) => `${skill.name}\n${skill.description}\n${skill.instructions}`)
            .join('\n')}`
        );
  const estimatedImageTokens = imageAttachments.length * IMAGE_ATTACHMENT_TOKEN_ESTIMATE;
  const estimatedAttachmentTextTokens = textAttachments.reduce(
    (total, attachment) => total + estimateTokenCount(`${attachment.relativePath}\n${attachment.charCount}`),
    0
  );
  const usedTokens = Math.max(0, baseUsedTokens + estimatedTextTokens + estimatedImageTokens + estimatedAttachmentTextTokens);
  const usagePercent = Math.min(999, Math.max(0, (usedTokens / maxTokens) * 100));
  const hasProviderBaseline = input.baselineUsedTokens != null;
  const severity = deriveContextWindowSeverity(usagePercent);
  const pressureLabel = deriveContextWindowPressureLabel(severity);

  return {
    maxTokens,
    autoCompactTokenLimit,
    usedTokens,
    usagePercent,
    title: 'Context window',
    pressureLabel,
    note: buildContextWindowNote(input.providerId, severity, hasProviderBaseline, policy.source),
    sourceLabel: hasProviderBaseline
      ? `Latest provider report + ${describeContextWindowLimitSource(policy.source)}`
      : `Estimated from thread and draft text + ${describeContextWindowLimitSource(policy.source)}`,
    source: hasProviderBaseline ? 'provider' : 'estimate',
    severity
  };
}

function estimateTokenCount(value: string) {
  if (!value.trim()) {
    return 0;
  }

  return Math.ceil(value.length / 4);
}

export function buildProviderContextWindow(
  providerId: ProviderId,
  modelId: string,
  usage: ProviderContextWindowUsage,
  model?: ProviderModel | null
): ContextWindowEstimate {
  const policy = resolveContextWindowPolicy(providerId, modelId, model);
  const maxTokens = policy.maxTokens;
  const autoCompactTokenLimit = policy.autoCompactTokenLimit;
  const usedTokens = Math.max(0, usage.usedTokens);
  const usagePercent = maxTokens > 0 ? Math.min(999, Math.max(0, (usedTokens / maxTokens) * 100)) : 0;
  const severity = deriveContextWindowSeverity(usagePercent);

  return {
    maxTokens,
    autoCompactTokenLimit,
    usedTokens,
    usagePercent,
    title: 'Context window',
    pressureLabel: deriveContextWindowPressureLabel(severity),
    note: buildContextWindowNote(providerId, severity, true, policy.source),
    sourceLabel: `${deriveProviderContextSourceLabel(providerId)} + ${describeContextWindowLimitSource(policy.source)}`,
    source: 'provider',
    severity
  };
}

export function deriveLatestProviderContextWindowUsage(events: RunEvent[], runId: string | null) {
  for (const event of [...events].reverse()) {
    if (runId && event.runId !== runId) {
      continue;
    }

    const usage = readContextWindowUsage(event.payload.contextWindow);
    if (usage) {
      return usage;
    }
  }

  return null;
}

function readContextWindowUsage(value: unknown): ProviderContextWindowUsage | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ProviderContextWindowUsage>;
  return typeof candidate.usedTokens === 'number' && Number.isFinite(candidate.usedTokens)
    ? {
        usedTokens: candidate.usedTokens,
        inputTokens: typeof candidate.inputTokens === 'number' ? candidate.inputTokens : null,
        outputTokens: typeof candidate.outputTokens === 'number' ? candidate.outputTokens : null,
        providerEventType: typeof candidate.providerEventType === 'string' ? candidate.providerEventType : null
      }
    : null;
}

export function deriveProviderContextWindow(
  events: RunEvent[],
  runId: string | null,
  providerId: ProviderId,
  modelId: string,
  model?: ProviderModel | null
): ContextWindowEstimate | null {
  const usage = deriveLatestProviderContextWindowUsage(events, runId);
  return usage ? buildProviderContextWindow(providerId, modelId, usage, model) : null;
}

function describeContextWindowLimitSource(source: ReturnType<typeof resolveContextWindowPolicy>['source']) {
  if (source === 'runtime') {
    return 'runtime model limit';
  }
  if (source === 'configured') {
    return 'configured model limit';
  }
  if (source === 'heuristic') {
    return 'heuristic model limit';
  }
  return 'selected model limit';
}

function buildContextWindowNote(
  providerId: ProviderId,
  severity: 'normal' | 'warning' | 'danger',
  hasProviderBaseline: boolean,
  policySource: ReturnType<typeof resolveContextWindowPolicy>['source']
) {
  const baseNote = deriveContextWindowNote(providerId, severity, hasProviderBaseline);
  if (policySource !== 'heuristic') {
    return baseNote;
  }

  return `${baseNote} The selected model did not expose a runtime context size, so the window limit is using Vicode's fallback policy.`;
}
