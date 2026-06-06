import { EventEmitter } from 'node:events';
import type {
  AutonomousTaskRecord,
  AutonomousTaskStatus,
  AutonomousTaskSummary,
  JobDefinition,
  SubagentSummary
} from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import { sortAutonomousTasks } from '../../shared/autonomous-tasks';
import { DatabaseService } from '../../storage/database';
import { JobsService } from './jobs';
import { SubagentOrchestratorService } from './subagents';

function subagentTaskSourceId(subagentId: string) {
  return `subagent:${subagentId}`;
}

function jobTaskSourceId(jobId: string) {
  return `job:${jobId}`;
}

function toAutonomousTaskSummary(task: AutonomousTaskRecord): AutonomousTaskSummary {
  return {
    id: task.id,
    kind: task.kind,
    title: task.title,
    summary: task.summary,
    ownerLabel: task.ownerLabel,
    provenanceLabel: task.provenanceLabel,
    trustLabel: task.trustLabel,
    approvalLabel: task.approvalLabel,
    status: task.status,
    statusLabel: task.statusLabel,
    threadId: task.threadId,
    updatedAt: task.updatedAt,
    attention: task.status === 'failed' || task.status === 'blocked' || task.status === 'cancelled'
  };
}

function describeSubagent(subagent: SubagentSummary): string {
  if (subagent.outputSummary?.trim()) {
    return subagent.outputSummary.trim();
  }
  switch (subagent.status) {
    case 'queued':
      return 'Waiting to start in a delegated thread.';
    case 'running':
      return subagent.childThreadId ? 'Running in a delegated thread.' : 'Launching delegated thread.';
    case 'completed':
      return 'Finished the last task and is waiting for follow-up work.';
    case 'failed':
      return subagent.lastError ?? 'Run failed before it could finish.';
    case 'cancelled':
      return 'Run cancelled.';
  }
}

function deriveSubagentTaskStatus(subagent: SubagentSummary): AutonomousTaskStatus {
  switch (subagent.status) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'completed':
      return 'waiting';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

function deriveSubagentTaskSummary(subagent: SubagentSummary): AutonomousTaskSummary {
  const status = deriveSubagentTaskStatus(subagent);
  return {
    id: `subagent:${subagent.id}`,
    kind: 'subagent',
    title: subagent.name,
    summary: describeSubagent(subagent),
    ownerLabel: subagent.delegationProfile,
    provenanceLabel: 'delegated thread',
    trustLabel: subagent.executionPermission === 'full_access' ? 'full access' : 'trusted workspace',
    approvalLabel: subagent.executionPermission === 'full_access' ? 'full access delegated' : null,
    status,
    statusLabel: status === 'waiting' ? 'waiting' : subagent.status,
    threadId: subagent.childThreadId,
    updatedAt: subagent.updatedAt,
    attention: status === 'failed' || status === 'cancelled'
  };
}

function deriveSubagentTaskRecord(subagent: SubagentSummary, current: AutonomousTaskRecord | null): AutonomousTaskRecord {
  const status = deriveSubagentTaskStatus(subagent);
  return {
    id: current?.id ?? subagentTaskSourceId(subagent.id),
    kind: 'subagent',
    projectId: current?.projectId ?? '',
    threadId: subagent.childThreadId,
    runId: subagent.childRunId,
    sourceId: subagentTaskSourceId(subagent.id),
    title: subagent.name,
    summary: describeSubagent(subagent),
    ownerLabel: subagent.delegationProfile,
    provenanceLabel: 'delegated thread',
    trustLabel: subagent.executionPermission === 'full_access' ? 'full access' : 'trusted workspace',
    approvalLabel: subagent.executionPermission === 'full_access' ? 'full access delegated' : null,
    status,
    statusLabel: status === 'waiting' ? 'waiting' : subagent.status,
    blockedBy: status === 'failed' ? subagent.lastError : null,
    blocking: null,
    lastError: subagent.lastError,
    metadata: {
      parentThreadId: subagent.parentThreadId,
      parentRunId: subagent.parentRunId,
      providerId: subagent.providerId,
      modelId: subagent.modelId
    },
    createdAt: current?.createdAt ?? subagent.createdAt,
    updatedAt: subagent.updatedAt,
    startedAt: subagent.startedAt,
    completedAt: subagent.completedAt
  };
}

function deriveJobTaskStatus(job: JobDefinition): AutonomousTaskStatus {
  switch (job.status) {
    case 'queued':
    case 'resumed':
      return 'queued';
    case 'running':
      return 'running';
    case 'waiting_for_review':
    case 'paused':
      return 'waiting';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

function describeJob(job: JobDefinition): string {
  switch (job.status) {
    case 'queued':
    case 'resumed':
      return 'Queued and waiting for execution.';
    case 'running':
      return 'Running in the background.';
    case 'waiting_for_review':
      return 'Waiting for review or approval before continuing.';
    case 'paused':
      return 'Paused until the next manual resume.';
    case 'completed':
      return 'Completed the last background task.';
    case 'failed':
      return 'Background task failed.';
    case 'cancelled':
      return 'Background task was cancelled.';
  }
}

function formatJobOwnerLabel(job: JobDefinition) {
  switch (job.sourceType) {
    case 'future_system':
      return 'autonomy';
    case 'automation':
      return 'automation';
    case 'review_retry':
      return 'review retry';
    case 'manual':
      return 'manual review';
  }
}

function formatJobProvenanceLabel(job: JobDefinition) {
  switch (job.sourceType) {
    case 'future_system':
      return 'future system';
    case 'automation':
      return 'scheduled automation';
    case 'review_retry':
      return 'review retry';
    case 'manual':
      return 'manual review';
  }
}

function formatJobApprovalLabel(job: JobDefinition) {
  switch (job.status) {
    case 'waiting_for_review':
      return 'review required';
    case 'paused':
      return 'manual resume required';
    default:
      return null;
  }
}

function deriveJobTaskSummary(job: JobDefinition): AutonomousTaskSummary {
  const status = deriveJobTaskStatus(job);
  return {
    id: `job:${job.id}`,
    kind: 'job',
    title: job.title,
    summary: describeJob(job),
    ownerLabel: formatJobOwnerLabel(job),
    provenanceLabel: formatJobProvenanceLabel(job),
    trustLabel: job.sourceType === 'future_system' ? 'trusted workspace' : null,
    approvalLabel: formatJobApprovalLabel(job),
    status,
    statusLabel: job.status.replace(/_/gu, ' '),
    threadId: job.threadId,
    updatedAt: job.updatedAt,
    attention: status === 'failed'
  };
}

function deriveJobTaskRecord(job: JobDefinition, current: AutonomousTaskRecord | null): AutonomousTaskRecord {
  const status = deriveJobTaskStatus(job);
  return {
    id: current?.id ?? jobTaskSourceId(job.id),
    kind: 'job',
    projectId: job.projectId,
    threadId: job.threadId,
    runId: current?.runId ?? null,
    sourceId: jobTaskSourceId(job.id),
    title: job.title,
    summary: describeJob(job),
    ownerLabel: formatJobOwnerLabel(job),
    provenanceLabel: formatJobProvenanceLabel(job),
    trustLabel: job.sourceType === 'future_system' ? 'trusted workspace' : null,
    approvalLabel: formatJobApprovalLabel(job),
    status,
    statusLabel: job.status.replace(/_/gu, ' '),
    blockedBy: status === 'failed' ? 'job_failed' : null,
    blocking: null,
    lastError: status === 'failed' ? current?.lastError ?? 'Background task failed.' : null,
    metadata: {
      sourceType: job.sourceType,
      sourceId: job.sourceId
    },
    createdAt: current?.createdAt ?? job.createdAt,
    updatedAt: job.updatedAt,
    startedAt:
      status === 'running'
        ? (current?.startedAt ?? job.updatedAt)
        : current?.startedAt ?? null,
    completedAt:
      status === 'completed' || status === 'failed' || status === 'cancelled'
        ? (current?.completedAt ?? job.updatedAt)
        : null
  };
}

export class AutonomousTaskService {
  private readonly emitter = new EventEmitter();
  private readonly unsubscribeJobs: () => void;
  private readonly unsubscribeSubagents: () => void;

  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobsService,
    private readonly subagents: SubagentOrchestratorService
  ) {
    this.unsubscribeJobs =
      typeof this.jobs.onEvent === 'function'
        ? this.jobs.onEvent((event) => {
            if (event.type === 'job.updated' && event.job.threadId) {
              this.syncJobTask(event.job);
              this.emitThreadUpdate(event.job.threadId);
            }
          })
        : () => undefined;
    this.unsubscribeSubagents =
      typeof this.subagents.onEvent === 'function'
        ? this.subagents.onEvent((event) => {
            if (
              event.type === 'subagent.created'
              || event.type === 'subagent.updated'
              || event.type === 'subagent.completed'
              || event.type === 'subagent.failed'
              || event.type === 'subagent.cancelled'
            ) {
              this.syncSubagentTask(event.subagent);
              this.emitThreadUpdate(event.subagent.parentThreadId);
            }
          })
        : () => undefined;
  }

  dispose() {
    this.unsubscribeJobs();
    this.unsubscribeSubagents();
    this.emitter.removeAllListeners();
  }

  onEvent(listener: (event: AppEvent) => void) {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  listForThread(threadId: string) {
    const thread = this.db.getThread(threadId);
    const tasks: AutonomousTaskSummary[] = [];
    const persistedTasks = new Map(
      this.db
        .listAutonomousTasksForProject(thread.projectId)
        .map((task) => [task.sourceId, task] as const)
    );

    for (const subagent of this.subagents.listForThread(threadId)) {
      const persisted = persistedTasks.get(subagentTaskSourceId(subagent.id));
      tasks.push(persisted ? toAutonomousTaskSummary(persisted) : deriveSubagentTaskSummary(subagent));
    }

    for (const job of this.db.listJobsForThread(threadId)) {
      const persisted = persistedTasks.get(jobTaskSourceId(job.id));
      tasks.push(persisted ? toAutonomousTaskSummary(persisted) : deriveJobTaskSummary(job));
    }

    return sortAutonomousTasks(tasks);
  }

  private syncJobTask(job: JobDefinition) {
    const current = this.db.getAutonomousTaskByKindAndSource('job', jobTaskSourceId(job.id));
    this.db.upsertAutonomousTask(deriveJobTaskRecord(job, current));
  }

  private syncSubagentTask(subagent: SubagentSummary) {
    let projectId = '';
    try {
      projectId = this.db.getThread(subagent.parentThreadId).projectId;
    } catch {
      projectId = '';
    }
    const current = this.db.getAutonomousTaskByKindAndSource('subagent', subagentTaskSourceId(subagent.id));
    if (!projectId && !current?.projectId) {
      return;
    }
    this.db.upsertAutonomousTask({
      ...deriveSubagentTaskRecord(subagent, current),
      projectId: projectId || current?.projectId || ''
    });
  }

  private emitThreadUpdate(threadId: string) {
    this.emitter.emit('event', {
      type: 'autonomousTasks.updated',
      threadId,
      tasks: this.listForThread(threadId)
    } satisfies AppEvent);
  }
}
