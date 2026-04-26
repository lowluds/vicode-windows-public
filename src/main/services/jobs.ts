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
import { MemoryWritesService } from './memory-writes';
import { ProviderManager } from './provider-manager';
import { JobRunReactionService } from './job-run-reaction-service';
import { ReviewOrchestrationService } from './review-orchestration-service';

type QueueTrigger = 'manual' | 'schedule';

function isSilentMemoryActionType(value: unknown): value is 'daily_note_capture' | 'memory_promotion' | 'user_preference' {
  return value === 'daily_note_capture' || value === 'memory_promotion' || value === 'user_preference';
}

export class JobsService {
  private readonly emitter = new EventEmitter();
  private readonly unsubscribeProviderEvents: () => void;
  private readonly reviews: ReviewOrchestrationService;
  private readonly reactions: JobRunReactionService;

  constructor(
    private readonly db: DatabaseService,
    private readonly providers: ProviderManager,
    private readonly memoryWrites?: MemoryWritesService,
    private readonly generatedMemory?: GeneratedMemoryService
  ) {
    this.reviews = new ReviewOrchestrationService(
      db,
      providers,
      (event) => this.emit(event),
      memoryWrites
    );
    this.reactions = new JobRunReactionService(
      db,
      (event) => this.emit(event),
      memoryWrites,
      generatedMemory
    );
    this.unsubscribeProviderEvents = this.providers.onEvent((event) => {
      if (event.type === 'run.status') {
        void this.reactions.handleRunStatus(event.threadId, event.runId, event.status, event.message ?? null);
      } else if (event.type === 'raw.event') {
        this.reactions.handleRawRunEvent(event.event);
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
    return this.reviews.listPendingReviews();
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
    return this.reviews.createDailyNoteReview(threadId);
  }

  createMemoryPromotionReview(threadId: string): { job: JobDefinition; reviewItem: ReviewItem; alreadyPending: boolean } {
    return this.reviews.createMemoryPromotionReview(threadId);
  }

  createUserPreferenceReview(threadId: string): { job: JobDefinition; reviewItem: ReviewItem; alreadyPending: boolean } {
    return this.reviews.createUserPreferenceReview(threadId);
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
    return this.reviews.updateManualReviewDraft(reviewItemId, content);
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
    return this.reviews.approveReview(reviewItemId);
  }

  rejectReview(reviewItemId: string): { job: JobDefinition; reviewItem: ReviewItem } {
    return this.reviews.rejectReview(reviewItemId);
  }
  private emit(event: AppEvent) {
    this.emitter.emit('event', event);
  }

}
