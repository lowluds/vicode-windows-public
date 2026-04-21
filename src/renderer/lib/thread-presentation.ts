import type {
  AutomationDefinition,
  ImageAttachment,
  TextAttachment,
  PlannerPlan,
  ProviderDescriptor,
  RunEvent,
  ThreadDetail,
  ThreadSummary
} from '../../shared/domain';

export function formatTime(value: string | null) {
  if (!value) {
    return 'Never';
  }

  return new Date(value).toLocaleString();
}

export function formatAutomationSchedule(automation: AutomationDefinition) {
  if (automation.scheduleType === 'interval_while_app_open' && automation.intervalMinutes) {
    return `Every ${automation.intervalMinutes}m`;
  }

  return 'Manual';
}

export function mergeBootstrapRecords<T extends { id: string }>(current: T[], incoming: T[]) {
  return [...incoming, ...current.filter((item) => !incoming.some((candidate) => candidate.id === item.id))];
}

export function surfaceProviders(providers: ProviderDescriptor[]) {
  return providers.filter((provider) => provider.id !== 'kimi');
}

function threadSortValue(thread: ThreadSummary) {
  const lastMessageAt = new Date(thread.lastMessageAt || '').getTime();
  const updatedAt = new Date(thread.updatedAt || '').getTime();
  return Math.max(Number.isFinite(lastMessageAt) ? lastMessageAt : 0, Number.isFinite(updatedAt) ? updatedAt : 0);
}

export function deriveRecentThreads(threadsByProject: Record<string, ThreadSummary[]>) {
  return Object.values(threadsByProject)
    .flat()
    .filter((thread) => !thread.archived && thread.status !== 'archived')
    .sort((left, right) => threadSortValue(right) - threadSortValue(left))
    .slice(0, 5);
}

export function upsertRecentThread(current: ThreadSummary[], thread: ThreadSummary) {
  if (thread.archived || thread.status === 'archived') {
    return current.filter((item) => item.id !== thread.id);
  }

  return [thread, ...current.filter((item) => item.id !== thread.id)]
    .sort((left, right) => threadSortValue(right) - threadSortValue(left))
    .slice(0, 5);
}

export function extractThreadSkillIds(thread: ThreadDetail | null) {
  if (!thread) {
    return [];
  }

  const lastUserTurn = [...thread.turns].reverse().find((turn) => turn.role === 'user');
  const skillIds = lastUserTurn?.metadata?.skillIds;
  return Array.isArray(skillIds) ? skillIds.filter((value): value is string => typeof value === 'string') : [];
}

export function extractTurnImageAttachments(metadata: Record<string, unknown> | null) {
  const imageAttachments = metadata?.imageAttachments;
  if (!Array.isArray(imageAttachments)) {
    return [];
  }

  return imageAttachments.filter((value): value is ImageAttachment => {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Partial<ImageAttachment>;
    return (
      typeof candidate.id === 'string' &&
      typeof candidate.name === 'string' &&
      typeof candidate.mimeType === 'string' &&
      typeof candidate.dataUrl === 'string'
    );
  });
}

export function extractTurnTextAttachments(metadata: Record<string, unknown> | null) {
  const textAttachments = metadata?.textAttachments;
  if (!Array.isArray(textAttachments)) {
    return [];
  }

  return textAttachments.filter((value): value is TextAttachment => {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Partial<TextAttachment>;
    return (
      typeof candidate.id === 'string' &&
      typeof candidate.name === 'string' &&
      candidate.mimeType === 'text/plain' &&
      typeof candidate.relativePath === 'string' &&
      typeof candidate.absolutePath === 'string' &&
      typeof candidate.charCount === 'number'
    );
  });
}

export function appendRunEvent(events: RunEvent[], event: RunEvent) {
  if (events.some((entry) => entry.id === event.id)) {
    return events;
  }

  return [...events, event];
}

export function isVisibleTranscriptTurn(turn: ThreadDetail['turns'][number]) {
  if (turn.role !== 'user' && turn.role !== 'assistant') {
    return false;
  }

  if (turn.role === 'assistant' && typeof turn.metadata?.plannerArtifactType === 'string') {
    return false;
  }

  if (turn.role === 'user' && (turn.metadata?.plannerPhase === 'answer' || turn.metadata?.plannerHandoff === true)) {
    return false;
  }

  return true;
}

export function isVisiblePlannerPlanTurn(turn: ThreadDetail['turns'][number], activePlan: PlannerPlan | null) {
  return (
    turn.role === 'assistant' &&
    turn.metadata?.plannerArtifactType === 'plan' &&
    activePlan?.createdTurnId === turn.id
  );
}

export function hasAssistantTurnForRun(thread: ThreadDetail | null, runId: string | null) {
  if (!thread || !runId) {
    return false;
  }

  return thread.turns.some((turn) => turn.role === 'assistant' && turn.runId === runId);
}
