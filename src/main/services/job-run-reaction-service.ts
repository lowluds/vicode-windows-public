import type { JobDefinition, RunEvent } from '../../shared/domain';
import {
  deriveContextWindowCompactionLikely,
  deriveContextWindowUsagePercent
} from '../../shared/context-window';
import type { AppEvent } from '../../shared/events';
import { DatabaseService } from '../../storage/database';
import { GeneratedMemoryService } from './generated-memory';
import { MemoryWritesService, type AutoAppliedMemoryWrite } from './memory-writes';
import { ThreadProjectionService } from './thread-projection-service';

const AUTO_NOTE_MIN_TURNS = 4;
const AUTO_NOTE_MIN_USER_TURNS = 2;
const AUTO_NOTE_MIN_ASSISTANT_CHARS = 160;
const AUTO_NOTE_CONTEXT_WARNING_PERCENT = 75;

function latestTurnContent(
  turns: Array<{ role: 'user' | 'assistant'; content: string }>,
  role: 'user' | 'assistant'
) {
  return [...turns].reverse().find((turn) => turn.role === role && turn.content.trim().length > 0)?.content.trim() ?? '';
}

function evaluateSilentMemoryWrites(params: {
  populatedTurns: Array<{ role: 'user' | 'assistant'; content: string }>;
  latestAssistantUpdate: string;
  latestContextUsagePercent: number | null;
}) {
  const longThread =
    params.populatedTurns.length >= AUTO_NOTE_MIN_TURNS
    || params.populatedTurns.filter((turn) => turn.role === 'user').length >= AUTO_NOTE_MIN_USER_TURNS;
  const highContextPressure =
    params.latestContextUsagePercent != null && params.latestContextUsagePercent >= AUTO_NOTE_CONTEXT_WARNING_PERCENT;

  return {
    shouldQueueDailyNote:
      longThread ||
      params.latestAssistantUpdate.length >= AUTO_NOTE_MIN_ASSISTANT_CHARS ||
      highContextPressure
  };
}

function readContextWindowUsedTokens(payload: Record<string, unknown> | null | undefined) {
  const value = payload?.contextWindow;
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as { usedTokens?: unknown };
  return typeof candidate.usedTokens === 'number' && Number.isFinite(candidate.usedTokens) ? candidate.usedTokens : null;
}

export class JobRunReactionService {
  private readonly threadProjection: ThreadProjectionService;

  constructor(
    private readonly db: DatabaseService,
    private readonly emit: (event: AppEvent) => void,
    private readonly memoryWrites?: MemoryWritesService,
    private readonly generatedMemory?: GeneratedMemoryService
  ) {
    this.threadProjection = new ThreadProjectionService(db, emit);
  }

  handleRawRunEvent(event: RunEvent) {
    if (event.eventType !== 'info') {
      return;
    }

    const usedTokens = readContextWindowUsedTokens(event.payload);
    if (usedTokens == null || !this.memoryWrites) {
      return;
    }

    let thread;
    try {
      thread = this.db.getThread(event.threadId);
    } catch {
      return;
    }

    const shouldFlush = deriveContextWindowCompactionLikely(thread.providerId, thread.modelId, usedTokens);

    if (!shouldFlush) {
      return;
    }

    try {
      const result = this.memoryWrites.autoApplyDailyNote(thread.id, event.runId);
      this.emitAutoAppliedMemoryWrite(thread.id, event.runId, 'daily_note_capture', result, 'context_pressure');
    } catch {
      // Keep pressure-triggered memory flush best-effort and non-blocking.
    }
  }

  async handleRunStatus(threadId: string, providerRunId: string, status: string, message: string | null) {
    if (status !== 'completed' && status !== 'failed' && status !== 'aborted') {
      return;
    }

    const jobRun = this.db.findJobRunByProviderRunId(providerRunId);
    if (!jobRun) {
      if (status === 'completed') {
        this.maybeAutoQueueMemoryReviews(threadId, providerRunId);
        this.maybeGenerateWorkspaceMemory(threadId, providerRunId);
      }
      return;
    }

    const finishedAt = new Date().toISOString();
    const nextJobStatus: JobDefinition['status'] =
      status === 'completed' ? 'completed' : status === 'aborted' ? 'cancelled' : 'failed';
    this.db.updateJobRun(jobRun.id, {
      status: nextJobStatus,
      finishedAt
    });
    const job = this.db.getJob(jobRun.jobId);
    const nextJob = this.db.saveJob({
      id: job.id,
      projectId: job.projectId,
      sourceType: job.sourceType,
      sourceId: job.sourceId,
      title: job.title,
      status: nextJobStatus,
      threadId: job.threadId
    });
    if (job.sourceType === 'automation' && job.sourceId) {
      const automationStatus = status === 'completed' ? 'completed' : status === 'aborted' ? 'cancelled' : 'failed';
      this.db.addAutomationRun(job.sourceId, nextJob.threadId, automationStatus, message ?? `Automation ${automationStatus}.`);
      this.emit({ type: 'automation.updated', automation: this.db.getAutomation(job.sourceId) });
    }
    this.emit({ type: 'job.updated', job: nextJob });

    if (status === 'completed') {
      this.maybeAutoQueueMemoryReviews(threadId, providerRunId);
      this.maybeGenerateWorkspaceMemory(threadId, providerRunId);
    }
  }

  private emitAutoAppliedMemoryWrite(
    threadId: string,
    runId: string | null,
    actionType: 'daily_note_capture' | 'memory_promotion' | 'user_preference',
    result: AutoAppliedMemoryWrite | null,
    reason: 'completion' | 'context_pressure' = 'completion'
  ) {
    if (!result) {
      return;
    }

    this.emit({ type: 'job.updated', job: result.job });
    if (!runId) {
      return;
    }

    const fileName = result.relativePath.split(/[\\/]/u).pop() ?? result.relativePath;
    const isDailyCheckpoint = actionType === 'daily_note_capture';
    const summary =
      isDailyCheckpoint
        ? 'Checkpoint saved'
        : actionType === 'memory_promotion'
          ? 'Auto-updated MEMORY.md'
          : 'Auto-updated USER.md';
    const text =
      isDailyCheckpoint
        ? reason === 'context_pressure'
          ? `Saved a durable note to ${fileName} before compaction risk increased.`
          : `Captured this thread in ${fileName}.`
        : actionType === 'memory_promotion'
          ? 'Promoted durable thread guidance into MEMORY.md.'
          : 'Persisted stable user preferences into USER.md.';

    const event = this.db.addRunEvent(threadId, runId, 'info', {
      activity: {
        kind: isDailyCheckpoint ? 'memory_checkpoint' : 'file_write',
        summary,
        path: result.targetPath,
        text
      }
    });
    this.emit({ type: 'raw.event', event });
    this.threadProjection.emitThread(threadId);
  }

  private maybeAutoQueueMemoryReviews(threadId: string, runId: string | null) {
    if (!this.memoryWrites) {
      return;
    }

    let thread;
    try {
      thread = this.db.getThread(threadId);
    } catch {
      return;
    }

    const populatedTurns = thread.turns.filter((turn) => turn.content.trim().length > 0);
    const latestAssistantUpdate = latestTurnContent(populatedTurns, 'assistant');
    const latestContextUsedTokens =
      [...thread.rawOutput]
        .reverse()
        .filter((event) => !runId || event.runId === runId)
        .map((event) => readContextWindowUsedTokens(event.payload))
        .find((usedTokens) => usedTokens != null) ?? null;
    const latestContextUsagePercent =
      latestContextUsedTokens == null
        ? null
        : deriveContextWindowUsagePercent(thread.providerId, thread.modelId, latestContextUsedTokens);

    const { shouldQueueDailyNote } = evaluateSilentMemoryWrites({
      populatedTurns,
      latestAssistantUpdate,
      latestContextUsagePercent
    });

    if (shouldQueueDailyNote) {
      try {
        const result = this.memoryWrites.autoApplyDailyNote(threadId, runId ?? undefined);
        this.emitAutoAppliedMemoryWrite(threadId, runId, 'daily_note_capture', result, 'completion');
      } catch {
        // Keep long-thread note collection best-effort and non-blocking.
      }
    }
  }

  private maybeGenerateWorkspaceMemory(threadId: string, runId: string | null) {
    if (!this.generatedMemory) {
      return;
    }
    if (!this.db.getPreferences().generatedMemoryGenerationEnabled) {
      return;
    }

    try {
      this.generatedMemory.captureThreadCandidates(threadId, runId);
    } catch {
      // Keep generated-memory shadow capture best-effort and non-blocking.
    }
  }
}
