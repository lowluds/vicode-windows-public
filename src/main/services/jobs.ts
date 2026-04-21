import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import type { AutonomyInboxItem, JobDefinition, ReviewItem, RunEvent } from '../../shared/domain';
import {
  deriveContextWindowCompactionLikely,
  deriveContextWindowUsagePercent
} from '../../shared/context-window';
import { normalizeDisplayText } from '../../shared/display-text';
import type { AppEvent } from '../../shared/events';
import { DatabaseService } from '../../storage/database';
import { GeneratedMemoryService } from './generated-memory';
import { MemoryWritesService, type AutoAppliedMemoryWrite } from './memory-writes';
import { ProviderManager } from './provider-manager';

type QueueTrigger = 'manual' | 'schedule';

const AUTO_NOTE_MIN_TURNS = 4;
const AUTO_NOTE_MIN_USER_TURNS = 2;
const AUTO_NOTE_MIN_ASSISTANT_CHARS = 160;
const AUTO_NOTE_CONTEXT_WARNING_PERCENT = 75;

function isSilentMemoryActionType(value: unknown): value is 'daily_note_capture' | 'memory_promotion' | 'user_preference' {
  return value === 'daily_note_capture' || value === 'memory_promotion' || value === 'user_preference';
}

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

  const shouldQueueDailyNote =
    longThread ||
    params.latestAssistantUpdate.length >= AUTO_NOTE_MIN_ASSISTANT_CHARS ||
    highContextPressure;

  return {
    shouldQueueDailyNote
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

export class JobsService {
  private readonly emitter = new EventEmitter();
  private readonly unsubscribeProviderEvents: () => void;

  constructor(
    private readonly db: DatabaseService,
    private readonly providers: ProviderManager,
    private readonly memoryWrites?: MemoryWritesService,
    private readonly generatedMemory?: GeneratedMemoryService
  ) {
    this.unsubscribeProviderEvents = this.providers.onEvent((event) => {
      if (event.type === 'run.status') {
        void this.handleRunStatus(event.threadId, event.runId, event.status, event.message ?? null);
      } else if (event.type === 'raw.event') {
        this.handleRawRunEvent(event.event);
      }
    });
    this.reconcilePendingSilentMemoryReviews();
  }

  dispose() {
    this.unsubscribeProviderEvents();
    this.emitter.removeAllListeners('event');
  }

  onEvent(listener: (event: AppEvent) => void) {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  listJobs() {
    return this.db.listJobs();
  }

  listPendingReviews() {
    return this.db.listPendingReviewItems();
  }

  private reconcilePendingSilentMemoryReviews() {
    if (!this.memoryWrites) {
      return;
    }

    for (const reviewItem of this.db.listPendingReviewItems()) {
      if (!isSilentMemoryActionType(reviewItem.details.actionType)) {
        continue;
      }

      let job: JobDefinition;
      try {
        job = this.db.getJob(reviewItem.jobId);
      } catch {
        continue;
      }

      if (job.sourceType !== 'manual') {
        continue;
      }

      try {
        const writtenPath = this.memoryWrites.applyReview(reviewItem);
        this.db.saveJob({
          id: job.id,
          projectId: job.projectId,
          sourceType: job.sourceType,
          sourceId: job.sourceId,
          title: job.title,
          status: 'completed',
          threadId: job.threadId
        });
        this.db.updateReviewItem(reviewItem.id, {
          status: 'approved',
          decision: {
            action: 'approved',
            approvedAt: new Date().toISOString(),
            writtenPath,
            autoApplied: true,
            reconciledFromPending: true
          }
        });
      } catch {
        // Keep reconciliation best-effort so one bad legacy review does not block startup.
      }
    }
  }

  createDailyNoteReview(threadId: string): { job: JobDefinition; reviewItem: ReviewItem; alreadyPending: boolean } {
    if (!this.memoryWrites) {
      throw new Error('Memory write reviews are not available.');
    }

    return this.autoApplyMemoryWrite(threadId, 'daily_note_capture');
  }

  createMemoryPromotionReview(threadId: string): { job: JobDefinition; reviewItem: ReviewItem; alreadyPending: boolean } {
    if (!this.memoryWrites) {
      throw new Error('Memory write reviews are not available.');
    }

    return this.autoApplyMemoryWrite(threadId, 'memory_promotion');
  }

  createUserPreferenceReview(threadId: string): { job: JobDefinition; reviewItem: ReviewItem; alreadyPending: boolean } {
    if (!this.memoryWrites) {
      throw new Error('Memory write reviews are not available.');
    }

    return this.autoApplyMemoryWrite(threadId, 'user_preference');
  }

  async startAutonomyTask(
    task: AutonomyInboxItem,
    trigger: 'heartbeat'
  ): Promise<{ job: JobDefinition; runId: string; threadId: string } | null> {
    const existing = this.db.findActiveJobForSource('future_system', task.key);
    if (existing) {
      return null;
    }

    const project = this.db.getProject(task.projectId);
    const providerId = project.defaultProviderId;
    const modelId = project.defaultModelByProvider[providerId];
    const queuedJob = this.db.saveJob({
      projectId: project.id,
      sourceType: 'future_system',
      sourceId: task.key,
      title: task.title,
      status: 'queued',
      threadId: task.threadId
    });

    try {
      const result = await this.providers.startDelegatedBackgroundRun({
        projectId: project.id,
        threadId: task.threadId,
        title: `Autonomy: ${task.title}`,
        prompt: task.prompt,
        providerId,
        modelId,
        executionPermission: 'default',
        delegationProfile: task.delegationProfile
      });
      const runningJob = this.db.saveJob({
        id: queuedJob.id,
        projectId: project.id,
        sourceType: queuedJob.sourceType,
        sourceId: queuedJob.sourceId,
        title: queuedJob.title,
        status: 'running',
        threadId: result.thread.id
      });
      this.db.addJobRun({
        jobId: runningJob.id,
        providerId,
        modelId,
        status: 'running',
        runId: result.runId,
        checkpoint: {
          trigger,
          source: task.source,
          sourcePath: task.sourcePath,
          delegationProfile: task.delegationProfile,
          threadId: result.thread.id
        },
        startedAt: new Date().toISOString()
      });
      this.emit({ type: 'job.updated', job: runningJob });
      return {
        job: runningJob,
        runId: result.runId,
        threadId: result.thread.id
      };
    } catch (error) {
      const failedJob = this.db.saveJob({
        id: queuedJob.id,
        projectId: project.id,
        sourceType: queuedJob.sourceType,
        sourceId: queuedJob.sourceId,
        title: queuedJob.title,
        status: 'failed',
        threadId: queuedJob.threadId
      });
      this.emit({ type: 'job.updated', job: failedJob });
      throw error;
    }
  }

  updateManualReviewDraft(reviewItemId: string, content: string): ReviewItem {
    const reviewItem = this.db.getReviewItem(reviewItemId);
    if (reviewItem.status !== 'pending') {
      throw new Error('Review item is no longer pending.');
    }

    const actionType = reviewItem.details.actionType;
    if (
      actionType !== 'daily_note_capture' &&
      actionType !== 'memory_promotion' &&
      actionType !== 'user_preference'
    ) {
      throw new Error('Only manual file-write reviews can be edited.');
    }

    const nextContent = content.replace(/\r\n/gu, '\n').trim();
    if (!nextContent) {
      throw new Error('Review content cannot be empty.');
    }

    const updatedReview = this.db.updateReviewItem(reviewItem.id, {
      details: {
        ...reviewItem.details,
        content: nextContent
      }
    });
    this.emit({ type: 'review.updated', reviewItem: updatedReview });
    return updatedReview;
  }

  async enqueueAutomationJob(automationId: string, trigger: QueueTrigger): Promise<{ job: JobDefinition; reviewItem: ReviewItem; alreadyPending: boolean }> {
    const automation = this.db.getAutomation(automationId);
    const existing = this.db.findActiveJobForSource('automation', automation.id);
    if (existing) {
      const review = this.db.listPendingReviewItems().find((item) => item.jobId === existing.id);
      if (review) {
        return { job: existing, reviewItem: review, alreadyPending: true };
      }
      throw new Error(`Automation "${automation.name}" already has an active job.`);
    }

    const job = this.db.saveJob({
      projectId: automation.projectId,
      sourceType: 'automation',
      sourceId: automation.id,
      title: automation.name,
      status: 'waiting_for_review',
      threadId: null
    });
    const reviewItem = this.db.addReviewItem({
      jobId: job.id,
      kind: 'manual_review',
      summary: trigger === 'manual' ? `Run automation "${automation.name}"` : `Approve scheduled automation "${automation.name}"`,
      details: {
        automationId: automation.id,
        trigger,
        providerId: automation.providerId,
        modelId: automation.modelId,
        promptTemplate: automation.promptTemplate,
        skillId: automation.skillId
      }
    });
    this.db.addAutomationRun(automation.id, null, 'waiting_for_review', 'Automation queued for review.');
    this.emit({ type: 'job.updated', job });
    this.emit({ type: 'review.updated', reviewItem });
    this.emit({ type: 'automation.updated', automation: this.db.getAutomation(automation.id) });
    return { job, reviewItem, alreadyPending: false };
  }

  async approveReview(reviewItemId: string): Promise<{ job: JobDefinition; reviewItem: ReviewItem; runId: string | null; threadId: string | null }> {
    const reviewItem = this.db.getReviewItem(reviewItemId);
    if (reviewItem.status !== 'pending') {
      throw new Error('Review item is no longer pending.');
    }

    const job = this.db.getJob(reviewItem.jobId);
    if (
      job.sourceType === 'manual' &&
      (
        reviewItem.details.actionType === 'daily_note_capture' ||
        reviewItem.details.actionType === 'memory_promotion' ||
        reviewItem.details.actionType === 'user_preference'
      )
    ) {
      if (!this.memoryWrites) {
        throw new Error('Memory write reviews are not available.');
      }
      const writtenPath = this.memoryWrites.applyReview(reviewItem);
      const completedJob = this.db.saveJob({
        id: job.id,
        projectId: job.projectId,
        sourceType: job.sourceType,
        sourceId: job.sourceId,
        title: job.title,
        status: 'completed',
        threadId: job.threadId
      });
      const approvedReview = this.db.updateReviewItem(reviewItem.id, {
        status: 'approved',
        decision: {
          action: 'approved',
          approvedAt: new Date().toISOString(),
          writtenPath
        }
      });
      this.emit({ type: 'job.updated', job: completedJob });
      this.emit({ type: 'review.updated', reviewItem: approvedReview });
      return {
        job: completedJob,
        reviewItem: approvedReview,
        runId: null,
        threadId: job.threadId
      };
    }
    if (job.sourceType !== 'automation' || !job.sourceId) {
      throw new Error('Unsupported job source for approval.');
    }

    const automation = this.db.getAutomation(job.sourceId);
    try {
      const result = await this.providers.submitComposer({
        projectId: automation.projectId,
        prompt: automation.promptTemplate,
        providerId: automation.providerId,
        modelId: automation.modelId,
        executionPermission: this.db.getPreferences().defaultExecutionPermission,
        skillIds: automation.skillId ? [automation.skillId] : []
      });
      if (result.disposition !== 'started') {
        throw new Error('Automation approval unexpectedly queued instead of starting.');
      }
      const now = new Date().toISOString();
      const runningJob = this.db.saveJob({
        id: job.id,
        projectId: job.projectId,
        sourceType: job.sourceType,
        sourceId: job.sourceId,
        title: job.title,
        status: 'running',
        threadId: result.thread.id
      });
      const jobRun = this.db.addJobRun({
        jobId: runningJob.id,
        providerId: automation.providerId,
        modelId: automation.modelId,
        status: 'running',
        runId: result.runId,
        checkpoint: {
          threadId: result.thread.id,
          reviewItemId: reviewItem.id
        },
        startedAt: now
      });
      const approvedReview = this.db.updateReviewItem(reviewItem.id, {
        status: 'approved',
        jobRunId: jobRun.id,
        decision: {
          action: 'approved',
          approvedAt: now
        }
      });
      this.db.addAutomationRun(automation.id, result.thread.id, 'running', 'Automation approved and started.');
      this.emit({ type: 'job.updated', job: this.db.getJob(runningJob.id) });
      this.emit({ type: 'review.updated', reviewItem: approvedReview });
      this.emit({ type: 'automation.updated', automation: this.db.getAutomation(automation.id) });
      return {
        job: this.db.getJob(runningJob.id),
        reviewItem: approvedReview,
        runId: result.runId,
        threadId: result.thread.id
      };
    } catch (error) {
      const waitingJob = this.db.saveJob({
        id: job.id,
        projectId: job.projectId,
        sourceType: job.sourceType,
        sourceId: job.sourceId,
        title: job.title,
        status: 'waiting_for_review',
        threadId: null
      });
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.db.addAutomationRun(automation.id, null, 'failed', `Automation failed to start: ${message}`);
      this.emit({ type: 'job.updated', job: waitingJob });
      this.emit({ type: 'automation.updated', automation: this.db.getAutomation(automation.id) });
      throw error;
    }
  }

  rejectReview(reviewItemId: string): { job: JobDefinition; reviewItem: ReviewItem } {
    const reviewItem = this.db.getReviewItem(reviewItemId);
    if (reviewItem.status !== 'pending') {
      throw new Error('Review item is no longer pending.');
    }
    const job = this.db.getJob(reviewItem.jobId);
    const cancelledJob = this.db.saveJob({
      id: job.id,
      projectId: job.projectId,
      sourceType: job.sourceType,
      sourceId: job.sourceId,
      title: job.title,
      status: 'cancelled',
      threadId: job.threadId
    });
    const rejectedReview = this.db.updateReviewItem(reviewItem.id, {
      status: 'rejected',
      decision: {
        action: 'rejected',
        rejectedAt: new Date().toISOString()
      }
    });
    if (job.sourceType === 'automation' && job.sourceId) {
      this.db.addAutomationRun(job.sourceId, job.threadId, 'cancelled', 'Automation review rejected.');
      this.emit({ type: 'automation.updated', automation: this.db.getAutomation(job.sourceId) });
    }
    this.emit({ type: 'job.updated', job: cancelledJob });
    this.emit({ type: 'review.updated', reviewItem: rejectedReview });
    return { job: cancelledJob, reviewItem: rejectedReview };
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
    this.emit({ type: 'thread.detail', thread: this.db.getThread(threadId) });
    this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(threadId) });
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

  private handleRawRunEvent(event: RunEvent) {
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

  private async handleRunStatus(threadId: string, providerRunId: string, status: string, message: string | null) {
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

  private emit(event: AppEvent) {
    this.emitter.emit('event', event);
  }

  private autoApplyMemoryWrite(
    threadId: string,
    actionType: 'daily_note_capture' | 'memory_promotion' | 'user_preference'
  ): { job: JobDefinition; reviewItem: ReviewItem; alreadyPending: boolean } {
    if (!this.memoryWrites) {
      throw new Error('Memory write reviews are not available.');
    }

    const thread = this.db.getThread(threadId);
    const project = this.db.getProject(thread.projectId);
    const sourceId =
      actionType === 'daily_note_capture'
        ? `daily-note:${thread.id}`
        : actionType === 'memory_promotion'
          ? `memory-promotion:${thread.id}`
          : `user-preference:${thread.id}`;

    const result =
      actionType === 'daily_note_capture'
        ? this.memoryWrites.autoApplyDailyNote(threadId)
        : actionType === 'memory_promotion'
          ? this.memoryWrites.autoApplyMemoryPromotion(threadId)
          : this.memoryWrites.autoApplyUserPreference(threadId);

    const job =
      result?.job
      ?? this.db.listJobs().find((item) => item.sourceType === 'manual' && item.sourceId === sourceId && item.status === 'completed')
      ?? (() => {
        throw new Error('Memory write completed without a persisted job.');
      })();

    const relativePath =
      result?.relativePath
      ?? (actionType === 'daily_note_capture'
        ? `memory/${new Date().toISOString().slice(0, 10)}.md`
        : actionType === 'memory_promotion'
          ? 'MEMORY.md'
          : 'USER.md');
    const targetPath = result?.targetPath ?? (project.folderPath ? join(project.folderPath, relativePath) : relativePath);
    const summary =
      result?.summary
      ?? (actionType === 'daily_note_capture'
        ? `Review daily note update for "${normalizeDisplayText(thread.title)}"`
        : actionType === 'memory_promotion'
          ? `Review durable memory promotion for "${normalizeDisplayText(thread.title)}"`
          : `Review USER.md update for "${normalizeDisplayText(thread.title)}"`);

    const reviewItem = this.db.addReviewItem({
      jobId: job.id,
      kind: 'manual_review',
      status: 'approved',
      summary,
      details: {
        actionType,
        projectId: project.id,
        threadId: thread.id,
        threadTitle: normalizeDisplayText(thread.title),
        relativePath,
        targetPath
      }
    });
    const approvedReview = this.db.updateReviewItem(reviewItem.id, {
      decision: {
        action: 'approved',
        approvedAt: new Date().toISOString(),
        writtenPath: targetPath,
        autoApplied: true,
        alreadyApplied: result == null
      }
    });
    this.emit({ type: 'job.updated', job });
    return { job, reviewItem: approvedReview, alreadyPending: false };
  }
}
