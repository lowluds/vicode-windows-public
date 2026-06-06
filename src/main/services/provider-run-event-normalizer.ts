import type {
  ProviderContextWindowUsage,
  ProviderId,
  RunEventPayloadKind,
  RunActivityInfo,
  RunProgressState
} from '../../shared/domain';
import type { StagedWorkspaceChangeSet } from '../../providers/agent-runtime';
import type { VerificationArtifact } from '../../shared/harness-verification';
import type {
  ProviderDiagnosticsPayload,
  ProviderExecutionSessionSignal,
  HarnessFinalEvidenceSummary,
  HarnessHookEvidence,
  ProviderInfoPayload,
  ProviderPlannerSignal
} from '../../providers/types';
import {
  preferNormalizedAssistantText,
  reconcileAssistantTextSnapshot,
  normalizeAssistantVisibleTextChunk,
} from '../../shared/assistant-text-normalization';
import { appendAssistantStreamChunk } from '../../shared/assistant-text/stream-assembler';
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
  stagedWorkspaceChangeSet: StagedWorkspaceChangeSet | null;
  verificationArtifact: VerificationArtifact | null;
  harnessHookEvidence: HarnessHookEvidence | null;
  finalEvidenceSummary: HarnessFinalEvidenceSummary | null;
  planner: ProviderPlannerSignal | null;
  session: ProviderExecutionSessionSignal | null;
  contextWindow: ProviderContextWindowUsage | null;
  providerDiagnostics: ProviderDiagnosticsPayload | null;
  eventPayload: Record<string, unknown>;
  shouldPersist: boolean;
  dedupeKey: string | null;
  eventKind: RunEventPayloadKind;
  transcriptVisible: boolean;
}

function isInternalRuntimeReminderText(value: string | null | undefined) {
  return typeof value === 'string' && /^Internal runtime reminder:/iu.test(value.trim());
}

function classifyProviderInfoEvent(input: {
  requestedKind: RunEventPayloadKind | null;
  requestedTranscriptVisible: boolean | null;
  message: string;
  activity: RunActivityInfo | null;
  providerDiagnostics: ProviderDiagnosticsPayload | null;
  stagedWorkspaceChangeSet: StagedWorkspaceChangeSet | null;
  verificationArtifact: VerificationArtifact | null;
  harnessHookEvidence: HarnessHookEvidence | null;
  finalEvidenceSummary: HarnessFinalEvidenceSummary | null;
}): { eventKind: RunEventPayloadKind; transcriptVisible: boolean } {
  if (input.requestedKind) {
    return {
      eventKind: input.requestedKind,
      transcriptVisible: input.requestedTranscriptVisible ?? input.requestedKind !== 'internal_runtime_reminder'
    };
  }

  if (
    isInternalRuntimeReminderText(input.message)
    || isInternalRuntimeReminderText(input.activity?.summary)
    || isInternalRuntimeReminderText(input.activity?.text)
  ) {
    return {
      eventKind: 'internal_runtime_reminder',
      transcriptVisible: false
    };
  }

  if (input.providerDiagnostics && !input.message && !input.activity) {
    return {
      eventKind: 'provider_diagnostic',
      transcriptVisible: false
    };
  }

  if ((input.stagedWorkspaceChangeSet || input.verificationArtifact) && !input.message && !input.activity) {
    return {
      eventKind: 'debug_detail',
      transcriptVisible: input.requestedTranscriptVisible ?? false
    };
  }

  if ((input.harnessHookEvidence || input.finalEvidenceSummary) && !input.message && !input.activity) {
    return {
      eventKind: 'debug_detail',
      transcriptVisible: input.requestedTranscriptVisible ?? false
    };
  }

  if (input.activity?.kind === 'guidance' && input.activity.status === 'failed') {
    return {
      eventKind: 'failure_summary',
      transcriptVisible: input.requestedTranscriptVisible ?? true
    };
  }

  if (input.activity) {
    return {
      eventKind: 'tool_activity',
      transcriptVisible: input.requestedTranscriptVisible ?? true
    };
  }

  return {
    eventKind: 'debug_detail',
    transcriptVisible: input.requestedTranscriptVisible ?? true
  };
}

export function normalizeProviderVisibleText(providerId: ProviderId, value: string) {
  return normalizeAssistantVisibleTextChunk(value, getProviderTextNormalizationOptions(providerId));
}

export function normalizeProviderAssistantDelta(
  providerId: ProviderId,
  current: string,
  delta: string
): NormalizedProviderAssistantDelta {
  return appendAssistantStreamChunk(current, delta, getProviderTextNormalizationOptions(providerId));
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
  const stagedWorkspaceChangeSet = typeof normalizedPayload === 'string' ? null : normalizedPayload.stagedWorkspaceChangeSet ?? null;
  const verificationArtifact = typeof normalizedPayload === 'string' ? null : normalizedPayload.verificationArtifact ?? null;
  const harnessHookEvidence = typeof normalizedPayload === 'string' ? null : normalizedPayload.harnessHookEvidence ?? null;
  const finalEvidenceSummary = typeof normalizedPayload === 'string' ? null : normalizedPayload.finalEvidenceSummary ?? null;
  const requestedKind = typeof normalizedPayload === 'string' ? null : normalizedPayload.eventKind ?? null;
  const requestedTranscriptVisible =
    typeof normalizedPayload === 'string' ? null : normalizedPayload.transcriptVisible ?? null;
  const { eventKind, transcriptVisible } = classifyProviderInfoEvent({
    requestedKind,
    requestedTranscriptVisible,
    message: trimmedMessage,
    activity,
    providerDiagnostics,
    stagedWorkspaceChangeSet,
    verificationArtifact,
    harnessHookEvidence,
    finalEvidenceSummary
  });
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
  if (stagedWorkspaceChangeSet) {
    eventPayload.stagedWorkspaceChangeSet = stagedWorkspaceChangeSet;
  }
  if (verificationArtifact) {
    eventPayload.verificationArtifact = verificationArtifact;
  }
  if (harnessHookEvidence) {
    eventPayload.harnessHookEvidence = harnessHookEvidence;
  }
  if (finalEvidenceSummary) {
    eventPayload.finalEvidenceSummary = finalEvidenceSummary;
  }
  const shouldPersist = Boolean(
    trimmedMessage
    || activity
    || planner
    || session
    || contextWindow
    || providerDiagnostics
    || stagedWorkspaceChangeSet
    || verificationArtifact
    || harnessHookEvidence
    || finalEvidenceSummary
  );
  if (shouldPersist) {
    eventPayload.eventKind = eventKind;
    eventPayload.transcriptVisible = transcriptVisible;
  }

  return {
    normalizedPayload,
    message: trimmedMessage,
    activity,
    providerProgress,
    stagedWorkspaceChangeSet,
    verificationArtifact,
    harnessHookEvidence,
    finalEvidenceSummary,
    planner,
    session,
    contextWindow,
    providerDiagnostics,
    eventPayload,
    shouldPersist,
    dedupeKey: trimmedMessage || null,
    eventKind,
    transcriptVisible
  };
}
