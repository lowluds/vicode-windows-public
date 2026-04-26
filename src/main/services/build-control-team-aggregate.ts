import type {
  VicodeBuildControllerEvent,
  VicodeBuildLaneSnapshot,
  VicodeBuildTeamSnapshot,
  VicodeBuildTicketSnapshot
} from '../../shared/domain';

function unresolvedDependenciesForTicket(
  ticket: VicodeBuildTicketSnapshot,
  tickets: VicodeBuildTicketSnapshot[]
) {
  return ticket.dependencies.filter((dependencyId) => {
    const dependency = tickets.find((candidate) => candidate.id === dependencyId);
    return !dependency || dependency.status !== 'done';
  });
}

function hasDependencyBlockedOpenTickets(tickets: VicodeBuildTicketSnapshot[]) {
  return tickets.some(
    (ticket) =>
      ticket.status === 'todo' &&
      ticket.dependencies.length > 0 &&
      unresolvedDependenciesForTicket(ticket, tickets).length > 0
  );
}

function isHeartbeatTerminalStatus(status: string | null) {
  return status === 'blocked' || status === 'done';
}

export function projectSnapshotTickets(
  tickets: VicodeBuildTicketSnapshot[],
  lanes: VicodeBuildLaneSnapshot[]
): VicodeBuildTicketSnapshot[] {
  return tickets.map((ticket) => {
    const blockedByTicketIds = unresolvedDependenciesForTicket(ticket, tickets);
    return {
      ...ticket,
      blockedByTicketIds,
      readyToClaim: ticket.status === 'todo' && blockedByTicketIds.length === 0,
      active: ticket.status === 'in_progress',
      ownerThreadId: lanes.find((lane) => lane.laneId === ticket.ownerLane)?.threadId ?? null
    };
  });
}

export function deriveTeamLastActivity(
  lanes: VicodeBuildLaneSnapshot[],
  heartbeatUpdatedAt: string | null,
  ticketQueueUpdatedAt: string | null
) {
  const latestLaneActivity =
    lanes
      .flatMap((lane) =>
        [lane.lastRunAt, lane.lastWakeAt, lane.lastHandoffAt].filter(
          (value): value is string => Boolean(value)
        )
      )
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ??
    null;

  return [latestLaneActivity, heartbeatUpdatedAt, ticketQueueUpdatedAt]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ??
    null;
}

export function deriveTeamStatus(input: {
  lanes: VicodeBuildLaneSnapshot[];
  heartbeatStatus: string | null;
  openTicketCount: number;
  blockedTicketCount: number;
  recentEvents: VicodeBuildControllerEvent[];
  teamId: string;
  snapshotTickets: VicodeBuildTicketSnapshot[];
}) {
  const statuses = input.lanes.map((lane) => lane.status);
  const activeTicket = input.snapshotTickets.find((ticket) => ticket.active) ?? null;
  const dependencyHeldQueue =
    !activeTicket && hasDependencyBlockedOpenTickets(input.snapshotTickets);
  const hasLaneAttention = input.lanes.some(
    (lane) =>
      Boolean(lane.blockedReason) &&
      (lane.status === 'running' ||
        lane.status === 'failed' ||
        lane.status === 'cancelled')
  );
  const hasLoopHold = input.lanes.some((lane) =>
    lane.recentEvents.some(
      (event) =>
        event.kind === 'auto_handoff_skipped' &&
        /repeated .* handoff|queue still has not advanced/iu.test(
          `${event.summary} ${event.detail ?? ''}`
        )
    )
  );
  const overlapHoldEvent = input.recentEvents.find(
    (event) =>
      event.teamId === input.teamId &&
      event.kind === 'auto_handoff_skipped' &&
      /overlap|already-active|avoid duplicate|coordination hold/iu.test(
        `${event.summary ?? ''} ${event.detail ?? ''}`
      )
  );
  const isWaitingOnExistingSlice =
    input.heartbeatStatus === 'paused' &&
    input.openTicketCount > 0 &&
    Boolean(overlapHoldEvent);
  const hasTerminalBlockedQueue =
    input.openTicketCount === 0 && input.blockedTicketCount > 0;

  return statuses.every((status) => status === 'paused')
    ? 'paused'
    : isWaitingOnExistingSlice
      ? 'waiting'
      : dependencyHeldQueue
        ? 'waiting'
        : hasLoopHold
          ? 'attention'
          : hasTerminalBlockedQueue
            ? 'attention'
            : statuses.some(
                  (status) =>
                    status === 'running' || status === 'waiting_for_review'
                )
              ? hasLaneAttention
                ? 'attention'
                : 'active'
              : statuses.some(
                    (status) =>
                      status === 'failed' ||
                      status === 'skipped' ||
                      status === 'cancelled'
                  )
                ? 'attention'
                : isHeartbeatTerminalStatus(input.heartbeatStatus)
                  ? 'idle'
                  : 'idle';
}
