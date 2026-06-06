import { join } from 'node:path';
import type { JobDefinition, ReviewItem } from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import { normalizeDisplayText } from '../../shared/display-text';
import { DatabaseService } from '../../storage/database';
import { MemoryWritesService } from './memory-writes';
import { ProviderManager } from './provider-manager';

type QueueTrigger = 'manual' | 'schedule';

export class ReviewOrchestrationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly providers: ProviderManager,
    private readonly emit: (event: AppEvent) => void,
    private readonly memoryWrites?: MemoryWritesService
  ) {}

  listPendingReviews() {
    return this.db.listPendingReviewItems();
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
        ? `Review project checkpoint for "${normalizeDisplayText(thread.title)}"`
        : actionType === 'memory_promotion'
          ? `Review project memory for "${normalizeDisplayText(thread.title)}"`
          : `Review project preference for "${normalizeDisplayText(thread.title)}"`);

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
