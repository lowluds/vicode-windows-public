import type { ProviderId, ThreadDetail } from '../../shared/domain';

export interface ExecutionContinuityPlan {
  strategy: 'native_resume' | 'inline_recent_history' | 'none';
  resumeSessionId: string | null;
  includeInlineThreadHistory: boolean;
}

export function isBuildControllerLaneThread(thread: ThreadDetail) {
  const latestMarkedTurn = [...thread.turns].reverse().find((turn) => {
    if (!turn.metadata || typeof turn.metadata !== 'object') {
      return false;
    }
    const marker = (turn.metadata as { laneControlMarker?: unknown }).laneControlMarker;
    return typeof marker === 'string' && marker.startsWith('build-controller:');
  });
  const marker = latestMarkedTurn?.metadata && typeof latestMarkedTurn.metadata === 'object'
    ? (latestMarkedTurn.metadata as { laneControlMarker?: unknown }).laneControlMarker
    : null;
  return typeof marker === 'string' && marker.startsWith('build-controller:');
}

export function providerSupportsNativeExecutionResume(providerId: ProviderId) {
  return providerId === 'gemini';
}

export function providerSupportsNativePlannerResume(providerId: ProviderId) {
  return providerId === 'gemini';
}

export function providerNeedsInlineThreadHistoryFallback(providerId: ProviderId) {
  return providerId === 'openai'
    || providerId === 'gemini'
    || providerId === 'ollama'
    || providerId === 'kimi'
    || providerId === 'qwen';
}

export function findLatestPlannerSessionId(thread: ThreadDetail) {
  for (const event of [...thread.rawOutput].reverse()) {
    const planner = event.payload?.planner;
    if (
      planner &&
      typeof planner === 'object' &&
      (planner as { kind?: string }).kind === 'session' &&
      typeof (planner as { sessionId?: unknown }).sessionId === 'string'
    ) {
      return (planner as { sessionId: string }).sessionId;
    }
  }

  return null;
}

export function resolvePlannerResumeSessionId(
  providerId: ProviderId,
  thread: ThreadDetail
) {
  if (!providerSupportsNativePlannerResume(providerId)) {
    return null;
  }

  return findLatestPlannerSessionId(thread);
}

export function findLatestExecutionSessionId(
  thread: ThreadDetail,
  providerId: ProviderId
) {
  for (const event of [...thread.rawOutput].reverse()) {
    const payload = event.payload;
    const session = payload?.session;
    if (
      session &&
      typeof session === 'object' &&
      (session as { kind?: string }).kind === 'execution' &&
      (session as { providerId?: unknown }).providerId === providerId &&
      typeof (session as { sessionId?: unknown }).sessionId === 'string'
    ) {
      return (session as { sessionId: string }).sessionId;
    }

    if (
      event.eventType === 'started' &&
      payload?.providerId === providerId &&
      typeof payload.resumeSessionId === 'string' &&
      payload.resumeSessionId.trim()
    ) {
      return payload.resumeSessionId;
    }
  }

  return null;
}

export function resolveExecutionContinuity(
  providerId: ProviderId,
  thread: ThreadDetail | null
): ExecutionContinuityPlan {
  if (!thread) {
    return {
      strategy: 'none',
      resumeSessionId: null,
      includeInlineThreadHistory: false
    };
  }

  if (isBuildControllerLaneThread(thread)) {
    return {
      strategy: 'none',
      resumeSessionId: null,
      includeInlineThreadHistory: false
    };
  }

  const resumeSessionId = findLatestExecutionSessionId(thread, providerId);
  if (resumeSessionId && providerSupportsNativeExecutionResume(providerId)) {
    return {
      strategy: 'native_resume',
      resumeSessionId,
      includeInlineThreadHistory: false
    };
  }

  if (providerNeedsInlineThreadHistoryFallback(providerId)) {
    return {
      strategy: 'inline_recent_history',
      resumeSessionId: null,
      includeInlineThreadHistory: true
    };
  }

  return {
    strategy: 'none',
    resumeSessionId: null,
    includeInlineThreadHistory: false
  };
}
