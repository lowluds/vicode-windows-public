import type {
  ComposerSubmitInput,
  ThreadDetail,
  ThreadFollowUp,
  RunProgressState
} from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import type { ThreadProjectionService } from './thread-projection-service';

type ExecutionStartResult = { thread: ThreadDetail; runId: string };

export interface ProviderFollowUpServiceHost {
  isDisposed(): boolean;
  getRunningRunId(threadId: string): string | null;
  db: {
    getPreferences(): { followUpBehavior: 'queue' | 'steer' };
    getThread(threadId: string): ThreadDetail;
    getProject(projectId: string): ReturnType<import('../../storage/database').DatabaseService['getProject']>;
    listThreadFollowUps(threadId: string): ThreadFollowUp[];
    createThreadFollowUp(input: {
      threadId: string;
      content: string;
      metadata?: Record<string, unknown> | null;
      kind: ThreadFollowUp['kind'];
      priority?: number;
      targetRunId?: string | null;
    }): ThreadFollowUp;
    getThreadFollowUp(followUpId: string): ThreadFollowUp;
    supersedeQueuedFollowUps(input: {
      threadId: string;
      kind?: ThreadFollowUp['kind'];
      targetRunId?: string | null;
      excludeId?: string | null;
    }): number;
    claimNextThreadFollowUp(threadId: string): ThreadFollowUp | null;
    markThreadFollowUpDispatched(followUpId: string): ThreadFollowUp;
    markThreadFollowUpQueued(followUpId: string): ThreadFollowUp;
  };
  threadProjection: ThreadProjectionService;
  emit(event: AppEvent): void;
  startExecutionRun(
    input: ComposerSubmitInput,
    thread: ThreadDetail,
    project: ReturnType<import('../../storage/database').DatabaseService['getProject']>,
    executionContext: {
      approvedPlan: null;
      plannerAnswers: null;
    }
  ): Promise<ExecutionStartResult>;
  stopRun(runId: string): Promise<void>;
  refreshDerivedRunProgress(threadId: string, runId: string, providerId: ThreadDetail['providerId'], modelId: string): void;
  readTurnSkillIds(metadata: Record<string, unknown> | null): string[];
  readTurnImageAttachments(metadata: Record<string, unknown> | null): ComposerSubmitInput['imageAttachments'];
  readTurnTextAttachments(metadata: Record<string, unknown> | null): ComposerSubmitInput['textAttachments'];
}

export class ProviderFollowUpService {
  private readonly followUpDispatching = new Set<string>();

  constructor(private readonly host: ProviderFollowUpServiceHost) {}

  dispose() {
    this.followUpDispatching.clear();
  }

  isThreadActive(thread: ThreadDetail) {
    return thread.status === 'queued' || thread.status === 'running' || thread.status === 'stopping';
  }

  findLatestRunId(thread: ThreadDetail) {
    return [...thread.rawOutput].reverse().find((event) => event.runId)?.runId ?? null;
  }

  async queueForActiveThread(input: {
    thread: ThreadDetail;
    prompt: string;
    skillIds?: string[];
    imageAttachments?: ComposerSubmitInput['imageAttachments'];
    textAttachments?: ComposerSubmitInput['textAttachments'];
  }): Promise<{ thread: ThreadDetail; queuedFollowUp: ThreadFollowUp }> {
    const followUpBehavior = this.host.db.getPreferences().followUpBehavior;
    const kind = followUpBehavior === 'steer' ? 'steer' : 'follow_up';
    const targetRunId = this.host.getRunningRunId(input.thread.id) ?? this.findLatestRunId(input.thread);
    const queuedFollowUps = this.host.db.listThreadFollowUps(input.thread.id);
    const condensedQueuedCount =
      kind === 'steer'
        ? queuedFollowUps.filter(
            (followUp) => followUp.kind === 'steer' && followUp.targetRunId === targetRunId
          ).length
        : 0;

    const queuedFollowUp = this.host.db.createThreadFollowUp({
      threadId: input.thread.id,
      content: input.prompt,
      metadata: {
        skillIds: input.skillIds ?? [],
        imageAttachments: input.imageAttachments ?? [],
        textAttachments: input.textAttachments ?? [],
        condensedQueuedCount: condensedQueuedCount > 0 ? condensedQueuedCount : undefined
      },
      kind,
      priority: kind === 'steer' ? 1 : 0,
      targetRunId
    });

    if (kind === 'steer') {
      this.host.db.supersedeQueuedFollowUps({
        threadId: input.thread.id,
        kind: 'steer',
        targetRunId,
        excludeId: queuedFollowUp.id
      });
    }

    this.host.emit({ type: 'followup.queued', threadId: input.thread.id, followUp: queuedFollowUp });
    this.host.threadProjection.emitThreadDetail(input.thread.id);

    if (targetRunId) {
      this.host.refreshDerivedRunProgress(input.thread.id, targetRunId, input.thread.providerId, input.thread.modelId);
    }

    if (kind === 'steer' && targetRunId && input.thread.status !== 'stopping') {
      void this.host.stopRun(targetRunId).catch(() => {});
    }

    return {
      thread: this.host.db.getThread(input.thread.id),
      queuedFollowUp: this.host.db.getThreadFollowUp(queuedFollowUp.id)
    };
  }

  async maybeDispatchNextFollowUp(threadId: string) {
    if (
      this.host.isDisposed() ||
      this.followUpDispatching.has(threadId) ||
      this.host.getRunningRunId(threadId)
    ) {
      return;
    }

    const thread = this.host.db.getThread(threadId);
    if (this.isThreadActive(thread)) {
      return;
    }

    const followUp = this.host.db.claimNextThreadFollowUp(threadId);
    if (!followUp) {
      return;
    }

    this.followUpDispatching.add(threadId);

    try {
      const currentThread = this.host.db.getThread(threadId);
      const project = this.host.db.getProject(currentThread.projectId);
      const result = await this.host.startExecutionRun(
        {
          projectId: currentThread.projectId,
          threadId,
          prompt: followUp.content,
          providerId: currentThread.providerId,
          modelId: currentThread.modelId,
          executionPermission: currentThread.executionPermission,
          skillIds: this.host.readTurnSkillIds(followUp.metadata ?? null),
          imageAttachments: this.host.readTurnImageAttachments(followUp.metadata ?? null),
          textAttachments: this.host.readTurnTextAttachments(followUp.metadata ?? null)
        },
        currentThread,
        project,
        {
          approvedPlan: null,
          plannerAnswers: null
        }
      );
      const dispatched = this.host.db.markThreadFollowUpDispatched(followUp.id);
      this.host.emit({ type: 'followup.dispatched', threadId, followUp: dispatched, runId: result.runId });
      this.host.threadProjection.emitThreadDetail(threadId);
      this.host.refreshDerivedRunProgress(threadId, result.runId, currentThread.providerId, currentThread.modelId);
    } catch (error) {
      this.host.db.markThreadFollowUpQueued(followUp.id);
      this.host.emit({
        type: 'app.notification',
        level: 'warning',
        message: error instanceof Error ? error.message : 'Queued follow-up could not start yet.'
      });
    } finally {
      this.followUpDispatching.delete(threadId);
    }
  }
}
