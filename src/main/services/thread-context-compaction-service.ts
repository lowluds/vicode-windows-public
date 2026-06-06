import type { RunEvent, ThreadDetail } from '../../shared/domain';
import type {
  ThreadCompactionCreateInput,
  ThreadCompactionRecord
} from '../../storage/thread-compaction-repository';

export interface ThreadContextCompactionSummaryInput {
  thread: ThreadDetail;
  sourceEvents: RunEvent[];
  prompt: string;
}

export interface ThreadContextCompactionServiceOptions {
  db: {
    getThread(threadId: string): ThreadDetail;
    createThreadCompaction(input: ThreadCompactionCreateInput): ThreadCompactionRecord;
    getLatestThreadCompaction?(threadId: string): ThreadCompactionRecord | null;
  };
  summarize(input: ThreadContextCompactionSummaryInput): Promise<string | null>;
}

export interface ThreadContextCompactionCreateInput {
  threadId: string;
  protectedRecentEventCount?: number;
  minimumCompactableEventCount?: number;
  inputTokenEstimate?: number | null;
  outputTokenEstimate?: number | null;
  providerId?: ThreadCompactionCreateInput['providerId'];
  modelId?: string | null;
}

export type ThreadContextCompactionResult =
  | {
      status: 'compacted';
      compaction: ThreadCompactionRecord;
      sourceEventCount: number;
      protectedEventCount: number;
    }
  | {
      status: 'skipped';
      reason: 'not_enough_events' | 'no_safe_boundary' | 'duplicate_source_range' | 'empty_summary';
    };

const DEFAULT_PROTECTED_RECENT_EVENT_COUNT = 8;
const DEFAULT_MINIMUM_COMPACTABLE_EVENT_COUNT = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readActivityKind(event: RunEvent) {
  const activity = isRecord(event.payload.activity) ? event.payload.activity : null;
  return typeof activity?.kind === 'string' ? activity.kind : null;
}

function boundarySplitsToolPair(events: RunEvent[], boundaryEndIndex: number) {
  const boundaryEvent = events[boundaryEndIndex];
  const nextEvent = events[boundaryEndIndex + 1];
  return readActivityKind(boundaryEvent) === 'tool_call' || readActivityKind(nextEvent) === 'tool_result';
}

function findSafeBoundaryEndIndex(events: RunEvent[], protectedRecentEventCount: number) {
  let boundaryEndIndex = events.length - protectedRecentEventCount - 1;
  while (boundaryEndIndex >= 0 && boundarySplitsToolPair(events, boundaryEndIndex)) {
    boundaryEndIndex -= 1;
  }
  return boundaryEndIndex;
}

function redactSensitiveText(value: string) {
  return value
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9_]{8,})\b/gu, '[redacted-secret]')
    .replace(/\b(?:api[_-]?key|token|secret|password|credential|session)\b\s*[:=]\s*[^\s,;)]+/giu, '[redacted-secret]');
}

function eventText(event: RunEvent) {
  const activity = isRecord(event.payload.activity) ? event.payload.activity : null;
  const activityText =
    typeof activity?.text === 'string' && activity.text.trim()
      ? activity.text
      : typeof activity?.summary === 'string' && activity.summary.trim()
        ? activity.summary
        : null;
  const text =
    activityText ??
    (typeof event.payload.delta === 'string' ? event.payload.delta : null) ??
    (typeof event.payload.message === 'string' ? event.payload.message : null) ??
    JSON.stringify(event.payload);

  return redactSensitiveText(text.trim());
}

export function buildThreadContextCompactionPrompt(thread: ThreadDetail, sourceEvents: RunEvent[]) {
  const sourceText = sourceEvents
    .map((event) => `[${event.id}] ${event.eventType}: ${eventText(event)}`)
    .join('\n');

  return [
    'Summarize the selected older thread events into compact working state.',
    '',
    'Keep this as short structured text. Preserve only facts needed to continue the current thread.',
    '',
    'Required sections:',
    '- Current objective and acceptance criteria',
    '- Decisions made and why',
    '- Files, commands, and tool results that still matter',
    '- Open blockers and next steps',
    '- User preferences that affect this thread',
    '',
    'Do not include secrets, credentials, bulky logs, or stale brainstorming.',
    '',
    `Thread: ${thread.title}`,
    `Provider: ${thread.providerId}`,
    `Model: ${thread.modelId}`,
    '',
    'Selected older events:',
    sourceText
  ].join('\n');
}

export class ThreadContextCompactionService {
  constructor(private readonly options: ThreadContextCompactionServiceOptions) {}

  async createThreadCompaction(input: ThreadContextCompactionCreateInput): Promise<ThreadContextCompactionResult> {
    const thread = this.options.db.getThread(input.threadId);
    const protectedEventCount = Math.max(
      0,
      input.protectedRecentEventCount ?? DEFAULT_PROTECTED_RECENT_EVENT_COUNT
    );
    const minimumEventCount = Math.max(
      1,
      input.minimumCompactableEventCount ?? DEFAULT_MINIMUM_COMPACTABLE_EVENT_COUNT
    );
    if (thread.rawOutput.length <= protectedEventCount) {
      return {
        status: 'skipped',
        reason: 'not_enough_events'
      };
    }

    const boundaryEndIndex = findSafeBoundaryEndIndex(thread.rawOutput, protectedEventCount);

    if (boundaryEndIndex < 0) {
      return {
        status: 'skipped',
        reason: 'no_safe_boundary'
      };
    }

    const sourceEvents = thread.rawOutput.slice(0, boundaryEndIndex + 1);
    if (sourceEvents.length < minimumEventCount) {
      return {
        status: 'skipped',
        reason: 'not_enough_events'
      };
    }

    const latestCompaction = this.options.db.getLatestThreadCompaction?.(thread.id) ?? null;
    const sourceEndEventId = sourceEvents[sourceEvents.length - 1].id;
    if (latestCompaction?.sourceEndEventId === sourceEndEventId) {
      return {
        status: 'skipped',
        reason: 'duplicate_source_range'
      };
    }

    const prompt = buildThreadContextCompactionPrompt(thread, sourceEvents);
    const summary = await this.options.summarize({
      thread,
      sourceEvents,
      prompt
    });
    if (!summary?.trim()) {
      return {
        status: 'skipped',
        reason: 'empty_summary'
      };
    }

    const compaction = this.options.db.createThreadCompaction({
      threadId: thread.id,
      sourceStartEventId: sourceEvents[0].id,
      sourceEndEventId,
      summary: summary.trim(),
      inputTokenEstimate: input.inputTokenEstimate ?? null,
      outputTokenEstimate: input.outputTokenEstimate ?? null,
      providerId: input.providerId === undefined ? thread.providerId : input.providerId,
      modelId: input.modelId === undefined ? thread.modelId : input.modelId
    });

    return {
      status: 'compacted',
      compaction,
      sourceEventCount: sourceEvents.length,
      protectedEventCount
    };
  }
}
