import type {
  PlanTurnState,
  PlannerPlan,
  RunActivityInfo,
  RunEvent,
  RunProgressState,
  RunTaskItem,
  RunTaskStatus
} from './domain';
import type { ResolvedConversationTaskPacket } from './conversation-task-resolver';

export interface ProviderTodoItem {
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readTaskStatus(value: unknown): RunTaskStatus | null {
  return value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'blocked' || value === 'failed'
    ? value
    : null;
}

function readProgressSnapshot(snapshot: unknown, fallbackRunId: string, fallbackThreadId: string): RunProgressState | null {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.items)) {
    return null;
  }

  const runId = readString(snapshot.runId) ?? fallbackRunId;
  const threadId = readString(snapshot.threadId) ?? fallbackThreadId;
  const updatedAt = readString(snapshot.updatedAt);

  if (!runId || !threadId || !updatedAt) {
    return null;
  }

  const items = snapshot.items
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const id = readString(item.id);
      const label = readString(item.label);
      const status = readTaskStatus(item.status);
      const order = typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : null;
      if (!id || !label || !status || order === null) {
        return null;
      }
      return {
        id,
        label,
        status,
        order
      } satisfies RunTaskItem;
    })
    .filter((item): item is RunTaskItem => Boolean(item));

  if (items.length === 0) {
    return null;
  }

  return {
    runId,
    threadId,
    title: readString(snapshot.title),
    items,
    updatedAt,
    diffStats: (snapshot.diffStats as RunProgressState['diffStats'] | null | undefined) ?? null,
    reviewAvailable: snapshot.reviewAvailable === true,
    changeArtifact: (snapshot.changeArtifact as RunProgressState['changeArtifact'] | null | undefined) ?? null,
    delegation:
      isRecord(snapshot.delegation) &&
      (snapshot.delegation.mode === 'planner' || snapshot.delegation.mode === 'background') &&
      (snapshot.delegation.profile === 'delegated' ||
        snapshot.delegation.profile === 'heartbeat' ||
        snapshot.delegation.profile === 'research' ||
        snapshot.delegation.profile === 'implement' ||
        snapshot.delegation.profile === 'verify') &&
      (snapshot.delegation.phase === 'active' ||
        snapshot.delegation.phase === 'waiting_for_answers' ||
        snapshot.delegation.phase === 'resuming') &&
      readString(snapshot.delegation.title) &&
      readString(snapshot.delegation.note) &&
      Array.isArray(snapshot.delegation.includedContext) &&
      snapshot.delegation.includedContext.every((value) => typeof value === 'string') &&
      Array.isArray(snapshot.delegation.excludedContext) &&
      snapshot.delegation.excludedContext.every((value) => typeof value === 'string')
        ? {
            mode: snapshot.delegation.mode,
            profile: snapshot.delegation.profile,
            phase: snapshot.delegation.phase,
            title: readString(snapshot.delegation.title)!,
            note: readString(snapshot.delegation.note)!,
            includedContext: [...snapshot.delegation.includedContext],
            excludedContext: [...snapshot.delegation.excludedContext]
          }
        : null,
    contextPressure:
      isRecord(snapshot.contextPressure) &&
      readTaskStatus(snapshot.contextPressure.severity) === null &&
      (snapshot.contextPressure.severity === 'normal' ||
        snapshot.contextPressure.severity === 'warning' ||
        snapshot.contextPressure.severity === 'danger') &&
      readString(snapshot.contextPressure.pressureLabel) &&
      readString(snapshot.contextPressure.note) &&
      readNumber(snapshot.contextPressure.usagePercent) !== null &&
      readNumber(snapshot.contextPressure.usedTokens) !== null &&
      readNumber(snapshot.contextPressure.maxTokens) !== null &&
      (snapshot.contextPressure.source === 'provider' || snapshot.contextPressure.source === 'estimate')
        ? {
            severity: snapshot.contextPressure.severity,
            pressureLabel: readString(snapshot.contextPressure.pressureLabel)!,
            note: readString(snapshot.contextPressure.note)!,
            source: snapshot.contextPressure.source,
            sourceLabel: readString(snapshot.contextPressure.sourceLabel) ?? '',
            usagePercent: readNumber(snapshot.contextPressure.usagePercent)!,
            usedTokens: readNumber(snapshot.contextPressure.usedTokens)!,
            maxTokens: readNumber(snapshot.contextPressure.maxTokens)!,
            checkpointRecommended: snapshot.contextPressure.checkpointRecommended === true,
            compactionLikely: snapshot.contextPressure.compactionLikely === true
          }
        : null,
    checkpointReminder:
      isRecord(snapshot.checkpointReminder) &&
      snapshot.checkpointReminder.kind === 'context_pressure' &&
      readString(snapshot.checkpointReminder.title) &&
      readString(snapshot.checkpointReminder.message)
        ? {
            kind: 'context_pressure',
            title: readString(snapshot.checkpointReminder.title)!,
            message: readString(snapshot.checkpointReminder.message)!
          }
        : null,
    queueSummary:
      isRecord(snapshot.queueSummary) &&
      readNumber(snapshot.queueSummary.queuedCount) !== null &&
      readNumber(snapshot.queueSummary.steerCount) !== null &&
      readNumber(snapshot.queueSummary.followUpCount) !== null &&
      readNumber(snapshot.queueSummary.condensedQueuedCount) !== null
        ? {
            queuedCount: readNumber(snapshot.queueSummary.queuedCount)!,
            steerCount: readNumber(snapshot.queueSummary.steerCount)!,
            followUpCount: readNumber(snapshot.queueSummary.followUpCount)!,
            condensedQueuedCount: readNumber(snapshot.queueSummary.condensedQueuedCount)!
          }
        : null
  };
}

function normalizeTaskLabel(value: string) {
  return value
    .replace(/^[-*]\s+/u, '')
    .replace(/^\d+[.)]\s+/u, '')
    .trim();
}

function extractMarkdownTasks(markdown: string) {
  return markdown
    .split(/\r?\n/u)
    .map((line) => normalizeTaskLabel(line))
    .filter((line) => Boolean(line) && /^([A-Z0-9]|[a-z])/u.test(line));
}

function uniqueTaskLabels(values: string[]) {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const value of values.map((entry) => normalizeTaskLabel(entry)).filter(Boolean)) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(value);
  }

  return items;
}

export function derivePlannerTaskLabels(plan: PlannerPlan) {
  if (plan.structuredPlan) {
    const labels = uniqueTaskLabels([...plan.structuredPlan.keyChanges, ...plan.structuredPlan.testPlan, ...plan.structuredPlan.summary]);
    if (labels.length > 0) {
      return labels;
    }
  }

  const markdownTasks = uniqueTaskLabels(extractMarkdownTasks(plan.proposedPlanMarkdown));
  if (markdownTasks.length > 0) {
    return markdownTasks;
  }

  return ['Implement the approved plan'];
}

function createItems(labels: string[], runId: string): RunTaskItem[] {
  return labels.map((label, index) => ({
    id: `${runId}:${index}`,
    label,
    order: index,
    status: index === 0 ? 'in_progress' : 'pending'
  }));
}

function nextUpdatedAt() {
  return new Date().toISOString();
}

function readProgressSnapshotPayload(payload: Record<string, unknown>, runId: string, threadId: string) {
  return readProgressSnapshot(payload.progressSnapshot ?? payload.progress, runId, threadId);
}

export function applyRunProgressSnapshotEvent(
  current: Record<string, RunProgressState>,
  event: RunEvent
) {
  if (event.eventType === 'completed' || event.eventType === 'failed' || event.eventType === 'aborted') {
    if (!(event.runId in current)) {
      return current;
    }

    const next = { ...current };
    delete next[event.runId];
    return next;
  }

  if (event.eventType !== 'info' || !isRecord(event.payload)) {
    return current;
  }

  const snapshot = readProgressSnapshotPayload(event.payload, event.runId, event.threadId);
  if (!snapshot) {
    return current;
  }

  return {
    ...current,
    [snapshot.runId]: snapshot
  };
}

export function deriveRunProgressSnapshots(events: RunEvent[]) {
  return events.reduce<Record<string, RunProgressState>>(
    (current, event) => applyRunProgressSnapshotEvent(current, event),
    {}
  );
}

export function deriveRunProgressFromPlanner(plan: PlannerPlan | null, turnState: PlanTurnState | null, runId: string, threadId: string): RunProgressState | null {
  if (!plan || plan.status !== 'approved' || turnState !== 'executing_from_plan') {
    return null;
  }

  const labels = derivePlannerTaskLabels(plan);
  return {
    runId,
    threadId,
    title: plan.structuredPlan?.title ?? 'Approved plan',
    items: createItems(labels, runId),
    updatedAt: nextUpdatedAt(),
    diffStats: null,
    reviewAvailable: false,
    changeArtifact: null,
    delegation: null,
    contextPressure: null,
    checkpointReminder: null,
    queueSummary: null
  };
}

function mapResolvedTaskSliceStatus(status: ResolvedConversationTaskPacket['slices'][number]['status']): RunTaskStatus {
  if (status === 'active') {
    return 'in_progress';
  }

  return status;
}

export function deriveRunProgressFromResolvedTaskPacket(
  packet: ResolvedConversationTaskPacket | null | undefined,
  runId: string,
  threadId: string
): RunProgressState | null {
  if (!packet || packet.slices.length === 0) {
    return null;
  }
  if (packet.executionPolicy && packet.executionPolicy !== 'auto_execute') {
    return null;
  }

  const items = packet.slices.slice(0, 8).map((slice, index) => ({
    id: `${runId}:resolved:${slice.id || index}`,
    label: normalizeTaskLabel(slice.title),
    order: index,
    status: mapResolvedTaskSliceStatus(slice.status)
  })).filter((item) => item.label);

  if (items.length === 0) {
    return null;
  }

  if (!items.some((item) => item.status === 'in_progress')) {
    const firstPendingIndex = items.findIndex((item) => item.status === 'pending');
    if (firstPendingIndex >= 0) {
      items[firstPendingIndex] = {
        ...items[firstPendingIndex],
        status: 'in_progress'
      };
    }
  }

  return {
    runId,
    threadId,
    title: packet.phase === 'task_plan' ? 'Resolved task plan' : 'Resolved task',
    items,
    updatedAt: nextUpdatedAt(),
    diffStats: null,
    reviewAvailable: false,
    changeArtifact: null,
    delegation: null,
    contextPressure: null,
    checkpointReminder: null,
    queueSummary: null
  };
}

function updateItems(items: RunTaskItem[], updater: (items: RunTaskItem[]) => RunTaskItem[]) {
  return updater(items.map((item) => ({ ...item })));
}

function setItemStatus(items: RunTaskItem[], index: number, status: RunTaskStatus) {
  if (index < 0 || index >= items.length) {
    return items;
  }
  items[index] = { ...items[index], status };
  return items;
}

export function advanceRunProgress(progress: RunProgressState) {
  const currentIndex = progress.items.findIndex((item) => item.status === 'in_progress');
  if (currentIndex < 0) {
    return progress;
  }

  const nextIndex = progress.items.findIndex((item, index) => index > currentIndex && item.status === 'pending');
  const items = updateItems(progress.items, (draft) => {
    setItemStatus(draft, currentIndex, 'completed');
    if (nextIndex >= 0) {
      setItemStatus(draft, nextIndex, 'in_progress');
    }
    return draft;
  });

  return {
    ...progress,
    items,
    updatedAt: nextUpdatedAt()
  };
}

export function completeRunProgress(progress: RunProgressState) {
  return {
    ...progress,
    items: progress.items.map((item) => ({ ...item, status: 'completed' })),
    updatedAt: nextUpdatedAt()
  };
}

export function failRunProgress(progress: RunProgressState, status: Extract<RunTaskStatus, 'failed' | 'blocked'> = 'failed') {
  const currentIndex = progress.items.findIndex((item) => item.status === 'in_progress');
  if (currentIndex < 0) {
    return {
      ...progress,
      updatedAt: nextUpdatedAt()
    };
  }

  const items = updateItems(progress.items, (draft) => setItemStatus(draft, currentIndex, status));
  return {
    ...progress,
    items,
    updatedAt: nextUpdatedAt()
  };
}

export function shouldAdvanceRunProgressFromActivity(activity: RunActivityInfo | null) {
  if (!activity) {
    return false;
  }

  if (activity.kind === 'thinking' || activity.kind === 'tool_call' || activity.kind === 'tool_result') {
    return false;
  }

  if (activity.kind === 'web_search') {
    return activity.phase === 'completed';
  }

  if (activity.kind === 'terminal_command') {
    return activity.phase === 'completed' || activity.phase === 'stopped';
  }

  return activity.kind === 'skill'
    || activity.kind === 'file_open'
    || activity.kind === 'file_read'
    || activity.kind === 'file_search'
    || activity.kind === 'file_write'
    || activity.kind === 'mkdir';
}

export function countCompletedRunProgressItems(progress: RunProgressState) {
  return progress.items.filter((item) => item.status === 'completed').length;
}

function mapProviderTodoStatus(status: ProviderTodoItem['status']): RunTaskStatus {
  if (status === 'cancelled') {
    return 'blocked';
  }

  return status;
}

export function deriveRunProgressFromProviderTodos(todos: ProviderTodoItem[], runId: string, threadId: string, title: string | null = 'Current tasks'): RunProgressState | null {
  const normalizedTodos = todos
    .map((todo) => ({
      label: normalizeTaskLabel(todo.description),
      status: mapProviderTodoStatus(todo.status)
    }))
    .filter((todo) => todo.label);

  if (normalizedTodos.length === 0) {
    return null;
  }

  return {
    runId,
    threadId,
    title,
    items: normalizedTodos.map((todo, index) => ({
      id: `${runId}:provider:${index}`,
      label: todo.label,
      order: index,
      status: todo.status
    })),
    updatedAt: nextUpdatedAt(),
    diffStats: null,
    reviewAvailable: false,
    changeArtifact: null,
    delegation: null,
    contextPressure: null,
    checkpointReminder: null,
    queueSummary: null
  };
}
