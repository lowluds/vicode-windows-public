import { EventEmitter } from 'node:events';
import type {
  AutonomousTaskRecord,
  AutonomousTaskStatus,
  AutonomousTaskSummary,
  JobDefinition,
  SubagentSummary,
  VicodeBuildTicketSnapshot,
  VicodeBuildLaneSnapshot
} from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import { deriveRelevantBuildTeam, sortAutonomousTasks } from '../../shared/autonomous-tasks';
import { DatabaseService } from '../../storage/database';
import { JobsService } from './jobs';
import { SubagentOrchestratorService } from './subagents';
import { VicodeBuildControlService } from './vicode-build-control';

function deriveBuildLaneTaskStatus(lane: VicodeBuildLaneSnapshot): AutonomousTaskStatus {
  if (lane.paused) {
    return 'waiting';
  }
  switch (lane.status) {
    case 'running':
      return 'running';
    case 'waiting_for_review':
      return 'waiting';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'skipped':
      return 'blocked';
    case 'idle':
      return 'idle';
    default:
      return 'queued';
  }
}

function deriveBuildLaneTaskSummary(
  lane: VicodeBuildLaneSnapshot,
  teamLabel: string
): AutonomousTaskSummary {
  const status = deriveBuildLaneTaskStatus(lane);
  const summary =
    lane.recommendedAction
    ?? lane.blockedReason
    ?? lane.lastPreview
    ?? `Lane status: ${lane.status.replace(/_/gu, ' ')}.`;
  return {
    id: `build-lane:${teamLabel}:${lane.laneId}`,
    kind: 'build_lane',
    title: lane.label,
    summary,
    ownerLabel: teamLabel,
    provenanceLabel: 'build control',
    trustLabel: 'trusted worktree',
    approvalLabel: lane.paused ? 'manual wake required' : null,
    status,
    statusLabel: lane.paused ? 'paused' : lane.status.replace(/_/gu, ' '),
    threadId: lane.threadId,
    updatedAt: lane.lastRunAt ?? lane.lastWakeAt ?? lane.nextRunAt,
    attention: status === 'failed' || status === 'blocked'
  };
}

function buildLaneTaskSourceId(projectId: string, teamId: string, laneId: VicodeBuildLaneSnapshot['laneId']) {
  return `build-lane:${projectId}:${teamId}:${laneId}`;
}

function buildTicketTaskSourceId(projectId: string, teamId: string, ticketId: string) {
  return `build-ticket:${projectId}:${teamId}:${ticketId}`;
}

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

function unresolvedTicketDependencies(
  ticket: VicodeBuildTicketSnapshot,
  tickets: VicodeBuildTicketSnapshot[]
) {
  if ((ticket.blockedByTicketIds?.length ?? 0) > 0) {
    return ticket.blockedByTicketIds;
  }
  return ticket.dependencies.filter((dependencyId) => {
    const dependency = tickets.find((candidate) => candidate.id === dependencyId);
    return !dependency || dependency.status !== 'done';
  });
}

function unresolvedDependencyTitles(
  ticket: VicodeBuildTicketSnapshot,
  tickets: VicodeBuildTicketSnapshot[]
) {
  return unresolvedTicketDependencies(ticket, tickets).map(
    (dependencyId) => tickets.find((candidate) => candidate.id === dependencyId)?.title ?? dependencyId
  );
}

function dependentTicketIds(
  ticket: VicodeBuildTicketSnapshot,
  tickets: VicodeBuildTicketSnapshot[]
) {
  return tickets
    .filter(
      (candidate) =>
        candidate.id !== ticket.id
        && candidate.status !== 'done'
        && unresolvedTicketDependencies(candidate, tickets).includes(ticket.id)
    )
    .map((candidate) => candidate.id);
}

function dependentTicketTitles(
  ticket: VicodeBuildTicketSnapshot,
  tickets: VicodeBuildTicketSnapshot[]
) {
  return dependentTicketIds(ticket, tickets).map(
    (ticketId) => tickets.find((candidate) => candidate.id === ticketId)?.title ?? ticketId
  );
}

function deriveBuildTicketTaskStatus(
  ticket: VicodeBuildTicketSnapshot,
  tickets: VicodeBuildTicketSnapshot[]
): AutonomousTaskStatus {
  switch (ticket.status) {
    case 'in_progress':
      return 'running';
    case 'done':
      return 'completed';
    case 'blocked':
      return 'blocked';
    case 'todo':
      return (ticket.readyToClaim ?? false) || unresolvedTicketDependencies(ticket, tickets).length === 0 ? 'queued' : 'waiting';
  }
}

function summarizeBuildTicketChecklist(
  ticket: VicodeBuildTicketSnapshot,
  tickets: VicodeBuildTicketSnapshot[]
) {
  const dependencyCount = unresolvedTicketDependencies(ticket, tickets).length;
  const checklistBits = [
    ticket.summary?.trim() ?? null,
    ticket.targetPaths.length > 0 ? `Targets ${ticket.targetPaths.slice(0, 2).join(', ')}.` : null,
    ticket.acceptanceCriteria.length > 0 ? `${ticket.acceptanceCriteria.length} acceptance checks.` : null,
    ticket.verificationSteps.length > 0 ? `${ticket.verificationSteps.length} verification steps.` : null,
    dependencyCount > 0 ? `Waiting on ${dependencyCount} dependency${dependencyCount === 1 ? '' : 'ies'}.` : null,
    ticket.stopWhen?.trim() ? `Stop when ${ticket.stopWhen.trim()}.` : null
  ];
  return checklistBits.find((entry) => Boolean(entry)) ?? 'Bounded build-control ticket.';
}

function deriveBuildTicketTaskSummary(
  ticket: VicodeBuildTicketSnapshot,
  teamLabel: string,
  tickets: VicodeBuildTicketSnapshot[]
): AutonomousTaskSummary {
  const status = deriveBuildTicketTaskStatus(ticket, tickets);
  return {
    id: `build-ticket:${teamLabel}:${ticket.id}`,
    kind: 'build_ticket',
    title: ticket.title,
    summary: summarizeBuildTicketChecklist(ticket, tickets),
    ownerLabel: ticket.ownerLane,
    provenanceLabel: 'build control ticket',
    trustLabel: 'trusted worktree',
    approvalLabel: ticket.stopWhen?.trim() ? 'bounded stop condition' : null,
    status,
    statusLabel:
      ticket.status === 'todo' && unresolvedTicketDependencies(ticket, tickets).length > 0
        ? 'waiting on dependency'
        : ticket.status.replace(/_/gu, ' '),
    threadId: ticket.ownerThreadId ?? null,
    updatedAt: ticket.updatedAt,
    attention: status === 'blocked'
  };
}

function deriveBuildLaneTaskRecord(
  projectId: string,
  teamId: string,
  teamLabel: string,
  lane: VicodeBuildLaneSnapshot,
  current: AutonomousTaskRecord | null
): AutonomousTaskRecord {
  const status = deriveBuildLaneTaskStatus(lane);
  const summary =
    lane.recommendedAction
    ?? lane.blockedReason
    ?? lane.lastPreview
    ?? `Lane status: ${lane.status.replace(/_/gu, ' ')}.`;
  const terminal = status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'blocked';
  return {
    id: current?.id ?? buildLaneTaskSourceId(projectId, teamId, lane.laneId),
    kind: 'build_lane',
    projectId,
    threadId: lane.threadId,
    runId: null,
    sourceId: buildLaneTaskSourceId(projectId, teamId, lane.laneId),
    title: lane.label,
    summary,
    ownerLabel: teamLabel,
    provenanceLabel: 'build control',
    trustLabel: 'trusted worktree',
    approvalLabel: lane.paused ? 'manual wake required' : null,
    status,
    statusLabel: lane.paused ? 'paused' : lane.status.replace(/_/gu, ' '),
    blockedBy: lane.blockedReason,
    blocking: null,
    lastError: status === 'failed' ? lane.blockedReason ?? lane.lastPreview : null,
    metadata: {
      teamId,
      laneId: lane.laneId,
      threadStatus: lane.threadStatus,
      threadTitle: lane.threadTitle
    },
    createdAt: current?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt:
      status === 'running'
        ? (current?.startedAt ?? lane.lastWakeAt ?? lane.lastRunAt ?? null)
        : current?.startedAt ?? null,
    completedAt:
      terminal
        ? (lane.lastRunAt ?? current?.completedAt ?? new Date().toISOString())
        : null
  };
}

function deriveBuildTicketTaskRecord(
  projectId: string,
  teamId: string,
  laneThreadId: string | null,
  ticket: VicodeBuildTicketSnapshot,
  tickets: VicodeBuildTicketSnapshot[],
  current: AutonomousTaskRecord | null
): AutonomousTaskRecord {
  const status = deriveBuildTicketTaskStatus(ticket, tickets);
  const unresolvedDependencies = unresolvedTicketDependencies(ticket, tickets);
  const unresolvedDependencyTitlesValue = unresolvedDependencyTitles(ticket, tickets);
  const downstreamDependentIds = dependentTicketIds(ticket, tickets);
  const downstreamDependentTitles = dependentTicketTitles(ticket, tickets);
  return {
    id: current?.id ?? buildTicketTaskSourceId(projectId, teamId, ticket.id),
    kind: 'build_ticket',
    projectId,
    threadId: laneThreadId,
    runId: null,
    sourceId: buildTicketTaskSourceId(projectId, teamId, ticket.id),
    title: ticket.title,
    summary: summarizeBuildTicketChecklist(ticket, tickets),
    ownerLabel: ticket.ownerLane,
    provenanceLabel: 'build control ticket',
    trustLabel: 'trusted worktree',
    approvalLabel: ticket.stopWhen?.trim() ? 'bounded stop condition' : null,
    status,
    statusLabel:
      ticket.status === 'todo' && unresolvedDependencies.length > 0
        ? 'waiting on dependency'
        : ticket.status.replace(/_/gu, ' '),
    blockedBy:
      ticket.status === 'blocked'
        ? ticket.summary ?? 'ticket blocked'
        : unresolvedDependencyTitlesValue.length > 0
          ? unresolvedDependencyTitlesValue.join(', ')
          : null,
    blocking: downstreamDependentTitles.length > 0 ? downstreamDependentTitles.join(', ') : null,
    lastError: ticket.status === 'blocked' ? ticket.summary ?? null : null,
    metadata: {
      teamId,
      ticketId: ticket.id,
      ownerLane: ticket.ownerLane,
      ownerThreadId: ticket.ownerThreadId ?? null,
      blockedByTicketIds: unresolvedDependencies,
      blockedByTicketTitles: unresolvedDependencyTitlesValue,
      blockingTicketIds: downstreamDependentIds,
      blockingTicketTitles: downstreamDependentTitles,
      dependencies: ticket.dependencies,
      targetPaths: ticket.targetPaths,
      acceptanceCriteria: ticket.acceptanceCriteria,
      verificationSteps: ticket.verificationSteps,
      refs: ticket.refs,
      stopWhen: ticket.stopWhen
    },
    createdAt: current?.createdAt ?? ticket.updatedAt ?? new Date().toISOString(),
    updatedAt: ticket.updatedAt ?? new Date().toISOString(),
    startedAt:
      status === 'running'
        ? (current?.startedAt ?? ticket.updatedAt ?? new Date().toISOString())
        : current?.startedAt ?? null,
    completedAt:
      status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'blocked'
        ? (ticket.updatedAt ?? current?.completedAt ?? new Date().toISOString())
        : null
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
  private readonly unsubscribeBuildControl: () => void;

  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobsService,
    private readonly vicodeBuild: VicodeBuildControlService,
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
    this.unsubscribeBuildControl =
      typeof this.vicodeBuild.onControllerUpdate === 'function'
        ? this.vicodeBuild.onControllerUpdate((event) => {
            this.syncBuildTeamTasks(event.projectId, event.teamId);
            this.emitBuildTeamUpdates(event.projectId, event.teamId, event.threadId);
          })
        : () => undefined;
  }

  dispose() {
    this.unsubscribeJobs();
    this.unsubscribeSubagents();
    this.unsubscribeBuildControl();
    this.emitter.removeAllListeners();
  }

  onEvent(listener: (event: AppEvent) => void) {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  listForThread(threadId: string) {
    const thread = this.db.getThread(threadId);
    const buildSnapshot = this.vicodeBuild.getSnapshot(thread.projectId);
    const relevantTeam = deriveRelevantBuildTeam(buildSnapshot, thread);
    const tasks: AutonomousTaskSummary[] = [];
    const persistedTasks = new Map(
      this.db
        .listAutonomousTasksForProject(thread.projectId)
        .map((task) => [task.sourceId, task] as const)
    );

    if (relevantTeam) {
      for (const lane of relevantTeam.lanes) {
        const persisted = persistedTasks.get(buildLaneTaskSourceId(thread.projectId, relevantTeam.teamId, lane.laneId));
        tasks.push(persisted ? toAutonomousTaskSummary(persisted) : deriveBuildLaneTaskSummary(lane, relevantTeam.label));
      }
      for (const ticket of relevantTeam.tickets) {
        const persisted = persistedTasks.get(buildTicketTaskSourceId(thread.projectId, relevantTeam.teamId, ticket.id));
        tasks.push(
          persisted
            ? toAutonomousTaskSummary(persisted)
            : deriveBuildTicketTaskSummary(ticket, relevantTeam.label, relevantTeam.tickets)
        );
      }
    }

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

  private syncBuildTeamTasks(projectId: string, teamId: string) {
    const snapshot = this.vicodeBuild.getSnapshot(projectId);
    if (!snapshot.available) {
      return;
    }

    const team = snapshot.teams.find((entry) => entry.teamId === teamId);
    if (!team) {
      return;
    }

    const existingLaneBySource = new Map(
      this.db
        .listAutonomousTasksForProject(projectId, 'build_lane')
        .map((task) => [task.sourceId, task] as const)
    );
    const existingTicketBySource = new Map(
      this.db
        .listAutonomousTasksForProject(projectId, 'build_ticket')
        .map((task) => [task.sourceId, task] as const)
    );
    const nextLaneSources = new Set<string>();
    const nextTicketSources = new Set<string>();

    for (const lane of team.lanes) {
      const sourceId = buildLaneTaskSourceId(projectId, team.teamId, lane.laneId);
      nextLaneSources.add(sourceId);
      this.db.upsertAutonomousTask(
        deriveBuildLaneTaskRecord(projectId, team.teamId, team.label, lane, existingLaneBySource.get(sourceId) ?? null)
      );
    }

    const laneThreadIds = new Map(team.lanes.map((lane) => [lane.laneId, lane.threadId] as const));
    for (const ticket of team.tickets) {
      const sourceId = buildTicketTaskSourceId(projectId, team.teamId, ticket.id);
      nextTicketSources.add(sourceId);
      this.db.upsertAutonomousTask(
        deriveBuildTicketTaskRecord(
          projectId,
          team.teamId,
          laneThreadIds.get(ticket.ownerLane) ?? null,
          ticket,
          team.tickets,
          existingTicketBySource.get(sourceId) ?? null
        )
      );
    }

    for (const sourceId of existingLaneBySource.keys()) {
      if (sourceId.startsWith(`build-lane:${projectId}:${team.teamId}:`) && !nextLaneSources.has(sourceId)) {
        this.db.deleteAutonomousTaskByKindAndSource('build_lane', sourceId);
      }
    }

    for (const sourceId of existingTicketBySource.keys()) {
      if (sourceId.startsWith(`build-ticket:${projectId}:${team.teamId}:`) && !nextTicketSources.has(sourceId)) {
        this.db.deleteAutonomousTaskByKindAndSource('build_ticket', sourceId);
      }
    }
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

  private emitBuildTeamUpdates(projectId: string, teamId: string, fallbackThreadId: string | null) {
    const snapshot = this.vicodeBuild.getSnapshot(projectId);
    if (!snapshot.available) {
      if (fallbackThreadId) {
        this.emitThreadUpdate(fallbackThreadId);
      }
      return;
    }

    const team = snapshot.teams.find((entry) => entry.teamId === teamId);
    if (!team) {
      if (fallbackThreadId) {
        this.emitThreadUpdate(fallbackThreadId);
      }
      return;
    }

    const threadIds = new Set<string>();
    if (fallbackThreadId) {
      threadIds.add(fallbackThreadId);
    }
    for (const lane of team.lanes) {
      if (lane.threadId) {
        threadIds.add(lane.threadId);
      }
    }

    for (const threadId of threadIds) {
      this.emitThreadUpdate(threadId);
    }
  }
}
