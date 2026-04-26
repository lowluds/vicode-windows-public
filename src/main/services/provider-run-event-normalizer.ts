import type {
  ProviderContextWindowUsage,
  ProviderId,
  RunActivityInfo,
  RunProgressState
} from '../../shared/domain';
import type {
  ProviderDiagnosticsPayload,
  ProviderExecutionSessionSignal,
  ProviderInfoPayload,
  ProviderPlannerSignal
} from '../../providers/types';
import {
  appendAssistantTextDelta,
  preferNormalizedAssistantText,
  reconcileAssistantTextSnapshot,
  normalizeAssistantVisibleTextChunk,
} from '../../providers/text-normalization';
import { deriveRunActivityInfo } from './run-activity';
import { getProviderTextNormalizationOptions } from './provider-text-policy';

export interface NormalizedProviderAssistantDelta {
  delta: string;
  text: string;
  replace: boolean;
}

export interface NormalizedProviderAssistantSnapshot {
  delta: string;
  text: string;
  snapshotText: string;
  replace: boolean;
}

export interface NormalizedProviderInfoEvent {
  normalizedPayload: ProviderInfoPayload;
  message: string;
  activity: RunActivityInfo | null;
  providerProgress: RunProgressState | null;
  planner: ProviderPlannerSignal | null;
  session: ProviderExecutionSessionSignal | null;
  contextWindow: ProviderContextWindowUsage | null;
  providerDiagnostics: ProviderDiagnosticsPayload | null;
  eventPayload: Record<string, unknown>;
  shouldPersist: boolean;
  dedupeKey: string | null;
}

export function normalizeProviderVisibleText(providerId: ProviderId, value: string) {
  return normalizeAssistantVisibleTextChunk(value, getProviderTextNormalizationOptions(providerId));
}

export function normalizeProviderAssistantDelta(
  providerId: ProviderId,
  current: string,
  delta: string
): NormalizedProviderAssistantDelta {
  return appendAssistantTextDelta(current, delta, getProviderTextNormalizationOptions(providerId));
}

export function reconcileProviderAssistantSnapshot(
  providerId: ProviderId,
  current: string,
  currentSnapshot: string,
  rawSnapshot: string
): NormalizedProviderAssistantSnapshot {
  return reconcileAssistantTextSnapshot(
    current,
    currentSnapshot,
    rawSnapshot,
    getProviderTextNormalizationOptions(providerId)
  );
}

export function preferProviderVisibleText(providerId: ProviderId, current: string, rawCandidate: string) {
  return preferNormalizedAssistantText(current, rawCandidate, getProviderTextNormalizationOptions(providerId));
}

export function normalizeProviderActivity(providerId: ProviderId, activity: RunActivityInfo): RunActivityInfo | null {
  const summary = normalizeProviderVisibleText(providerId, activity.summary).trim();
  const text = typeof activity.text === 'string' ? normalizeProviderVisibleText(providerId, activity.text).trim() : activity.text;
  if (!summary && (!text || !text.trim())) {
    return null;
  }

  const nextSummary =
    summary
    || (typeof text === 'string' && text ? text.split(/\r?\n/u)[0]?.trim() || activity.summary.trim() : activity.summary.trim());
  return {
    ...activity,
    summary: nextSummary,
    text: typeof text === 'string' ? (text || null) : text
  };
}

export function normalizeProviderInfoPayload(providerId: ProviderId, payload: ProviderInfoPayload): ProviderInfoPayload {
  if (typeof payload === 'string') {
    return normalizeProviderVisibleText(providerId, payload).trim();
  }

  const message =
    typeof payload.message === 'string' ? normalizeProviderVisibleText(providerId, payload.message).trim() : payload.message ?? null;
  const activity = payload.activity ? normalizeProviderActivity(providerId, payload.activity) : payload.activity ?? null;
  return {
    ...payload,
    message,
    activity
  };
}

export function normalizeProviderInfoEvent(providerId: ProviderId, payload: ProviderInfoPayload): NormalizedProviderInfoEvent {
  const normalizedPayload = normalizeProviderInfoPayload(providerId, payload);
  const message =
    typeof normalizedPayload === 'string'
      ? normalizedPayload
      : typeof normalizedPayload.message === 'string'
        ? normalizedPayload.message
        : normalizedPayload.activity?.summary ?? '';
  const trimmedMessage = message.trim();
  const activity =
    typeof normalizedPayload === 'string'
      ? deriveRunActivityInfo(providerId, trimmedMessage)
      : normalizedPayload.activity ?? deriveRunActivityInfo(providerId, trimmedMessage);
  const planner = typeof normalizedPayload === 'string' ? null : normalizedPayload.planner ?? null;
  const session = typeof normalizedPayload === 'string' ? null : normalizedPayload.session ?? null;
  const contextWindow = typeof normalizedPayload === 'string' ? null : normalizedPayload.contextWindow ?? null;
  const providerDiagnostics = typeof normalizedPayload === 'string' ? null : normalizedPayload.providerDiagnostics ?? null;
  const providerProgress = typeof normalizedPayload === 'string' ? null : normalizedPayload.progress ?? null;
  const eventPayload: Record<string, unknown> = {};
  if (trimmedMessage) {
    eventPayload.message = trimmedMessage;
  }
  if (activity) {
    eventPayload.activity = activity;
  }
  if (planner) {
    eventPayload.planner = planner;
  }
  if (session) {
    eventPayload.session = session;
  }
  if (contextWindow) {
    eventPayload.contextWindow = contextWindow;
  }
  if (providerDiagnostics) {
    eventPayload.providerDiagnostics = providerDiagnostics;
  }
  const shouldPersist = Boolean(trimmedMessage || activity || planner || session || contextWindow || providerDiagnostics);

  return {
    normalizedPayload,
    message: trimmedMessage,
    activity,
    providerProgress,
    planner,
    session,
    contextWindow,
    providerDiagnostics,
    eventPayload,
    shouldPersist,
    dedupeKey: trimmedMessage || null
  };
}
