import { useEffect, useMemo, useState } from 'react';
import type {
  VicodeBuildControllerEvent,
  VicodeBuildLaneId,
  VicodeBuildSnapshot,
  VicodeBuildVerificationResult
} from '../../shared/domain';
import { BUILD_CONTROL_ORCHESTRATION_ENABLED } from '../../shared/product-flags';
import { ActionButton, PrimaryButton, StatusPill, SurfaceCard } from './ui';
import { CheckIcon, CloseIcon, LoadingIcon, PlayIcon, RefreshIcon, TaskIcon } from './icons';

const laneOrder: VicodeBuildLaneId[] = ['planner', 'builder', 'finisher'];

function formatTime(value: string | null) {
  if (!value) {
    return 'never';
  }
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function compactPath(value: string | null) {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\\/gu, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= 2) {
    return normalized;
  }
  return `${segments.at(-2)}/${segments.at(-1)}`;
}

function summarizeChecklist(items: string[]) {
  if (items.length === 0) {
    return null;
  }
  return items.slice(0, 2).join(' | ');
}

function toneForStatus(status: string) {
  switch (status) {
    case 'running':
      return 'connected';
    case 'attention':
    case 'waiting':
    case 'waiting_for_review':
      return 'warning';
    case 'failed':
    case 'cancelled':
      return 'danger';
    case 'completed':
      return 'success';
    default:
      return 'default';
  }
}

function laneActionLabel(laneId: VicodeBuildLaneId) {
  switch (laneId) {
    case 'planner':
      return 'Wake planner';
    case 'builder':
      return 'Wake builder';
    case 'finisher':
      return 'Wake finisher';
  }
}

function eventTone(event: VicodeBuildControllerEvent) {
  switch (event.kind) {
    case 'run_failed':
    case 'auto_handoff_skipped':
    case 'config_mismatch':
    case 'queue_stalled':
    case 'run_stalled':
      return 'warning';
    case 'manual_wake':
    case 'auto_handoff':
      return 'connected';
    case 'run_completed':
    case 'team_resumed':
      return 'success';
    default:
      return 'default';
  }
}

function eventKindLabel(event: VicodeBuildControllerEvent) {
  switch (event.kind) {
    case 'manual_wake':
      return 'wake';
    case 'auto_handoff':
      return 'handoff';
    case 'auto_handoff_skipped':
      return 'skip';
    case 'config_mismatch':
      return 'config';
    case 'queue_stalled':
      return 'queue';
    case 'run_stalled':
      return 'stalled';
    case 'run_completed':
      return 'completed';
    case 'run_failed':
      return 'failed';
    case 'team_paused':
      return 'paused';
    case 'team_resumed':
      return 'resumed';
  }
}

function laneStepState(status: string, paused: boolean) {
  if (paused) {
    return 'paused';
  }
  if (status === 'completed') {
    return 'complete';
  }
  if (status === 'running' || status === 'waiting_for_review') {
    return 'active';
  }
  if (status === 'failed' || status === 'cancelled' || status === 'skipped') {
    return 'blocked';
  }
  return 'idle';
}

function laneStepLabel(status: string, paused: boolean) {
  const state = laneStepState(status, paused);
  switch (state) {
    case 'complete':
      return 'done';
    case 'active':
      return 'working';
    case 'blocked':
      return 'blocked';
    case 'paused':
      return 'paused';
    default:
      return 'idle';
  }
}

function laneDisplayName(laneId: VicodeBuildLaneId) {
  switch (laneId) {
    case 'planner':
      return 'Planner';
    case 'builder':
      return 'Builder';
    case 'finisher':
      return 'Finisher';
  }
}

function deriveTeamActivity(team: VicodeBuildSnapshot['teams'][number]) {
  const orderedLanes = laneOrder
    .map((laneId) => team.lanes.find((lane) => lane.laneId === laneId))
    .filter((lane): lane is NonNullable<typeof lane> => Boolean(lane));
  const activeLane = orderedLanes.find((lane) => lane.status === 'running' || lane.status === 'waiting_for_review') ?? null;
  const blockedLane = orderedLanes.find((lane) => laneStepState(lane.status, lane.paused) === 'blocked') ?? null;
  const latestEvent = orderedLanes
    .flatMap((lane) => lane.recentEvents.map((event) => ({ lane, event })))
    .sort((left, right) => new Date(right.event.createdAt).getTime() - new Date(left.event.createdAt).getTime())[0] ?? null;

  const completedSteps = orderedLanes.filter((lane) => lane.status === 'completed').length;
  const activeProgress = activeLane ? 0.5 : 0;
  const progressPercent = Math.max(0, Math.min(100, ((completedSteps + activeProgress) / laneOrder.length) * 100));

  return {
    orderedLanes,
    activeLane,
    blockedLane,
    latestEvent,
    progressPercent
  };
}

function deriveTerminalBlockedSummary(team: VicodeBuildSnapshot['teams'][number]) {
  if (team.status !== 'attention' || team.openTicketCount > 0 || team.blockedTicketCount === 0) {
    return null;
  }
  const blockedTicket = team.tickets.find((ticket) => ticket.status === 'blocked') ?? null;
  if (!blockedTicket) {
    return null;
  }
  return blockedTicket.summary ?? blockedTicket.title;
}

interface VicodeBuildControlViewProps {
  snapshot: VicodeBuildSnapshot | null;
  verification: VicodeBuildVerificationResult | null;
  busyAction: string | null;
  onRefresh: () => void;
  onCreatePlan: () => void;
  onClearInactivePlans: () => Promise<void>;
  onSetTeamPaused: (teamId: string, paused: boolean) => Promise<void>;
  onWakeLane: (teamId: string, laneId: VicodeBuildLaneId) => Promise<void>;
  onRetryLane: (teamId: string, laneId: VicodeBuildLaneId) => Promise<void>;
  onOpenThread: (threadId: string) => Promise<void>;
  onRunVerification: () => Promise<void>;
}

export function VicodeBuildControlView(props: VicodeBuildControlViewProps) {
  const teamIds = useMemo(() => props.snapshot?.teams.map((team) => team.teamId) ?? [], [props.snapshot]);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(teamIds[0] ?? null);

  useEffect(() => {
    if (!teamIds.length) {
      setExpandedTeamId(null);
      return;
    }
    setExpandedTeamId((current) => (current && teamIds.includes(current) ? current : teamIds[0] ?? null));
  }, [teamIds]);

  if (!props.snapshot?.available) {
    const note = props.snapshot?.note?.includes('config')
      ? 'No build plans exist in this workspace yet. Start a new build plan and Vicode will scaffold the controller files automatically.'
      : props.snapshot?.note ?? 'Select a workspace to start a build plan.';
    return (
      <SurfaceCard className="vicode-build-panel">
        <div className="vicode-build-header">
          <div>
            <h3>Vicode Autonomous Builds</h3>
            <p>{note}</p>
          </div>
          <div className="vicode-build-toolbar">
            <ActionButton size="compact" tone="quiet" leadingIcon={<RefreshIcon />} onClick={props.onRefresh}>
              Refresh
            </ActionButton>
          </div>
        </div>
      </SurfaceCard>
    );
  }

  const clearableCount = props.snapshot.teams.filter((team) => team.status !== 'active' && team.status !== 'waiting').length;

  return (
    <section className="vicode-build-shell">
      <SurfaceCard className="vicode-build-panel">
        <div className="vicode-build-header">
            <div className="vicode-build-copy">
              <div className="vicode-build-eyebrow">Vicode Builds Vicode</div>
            <h3>Plans</h3>
            <p>
              Visible planner, builder, and finisher threads live here.
              {BUILD_CONTROL_ORCHESTRATION_ENABLED
                ? ' Runs execute in native Vicode threads so you can inspect the work directly here.'
                : ' Automatic handoffs and queue-driven orchestration are currently parked.'}
            </p>
          </div>
          <div className="vicode-build-toolbar">
            <ActionButton size="compact" tone="quiet" leadingIcon={<RefreshIcon />} onClick={props.onRefresh}>
              Refresh
            </ActionButton>
            <ActionButton
              size="compact"
              tone="quiet"
              leadingIcon={<CloseIcon />}
              onClick={() => void props.onClearInactivePlans()}
              disabled={props.busyAction === 'clear-inactive' || clearableCount === 0}
            >
              Clear old plans
            </ActionButton>
            <ActionButton
              size="compact"
              tone="quiet"
              leadingIcon={<TaskIcon />}
              onClick={() => void props.onRunVerification()}
              disabled={props.busyAction === 'verify'}
            >
              {props.busyAction === 'verify' ? 'Verifying...' : 'Run verification'}
            </ActionButton>
          </div>
        </div>
        <div className="vicode-build-team-grid">
          {props.snapshot.teams.map((team) => (
            <article key={team.teamId} className="vicode-build-team-card">
              {(() => {
                const activity = deriveTeamActivity(team);
                const terminalBlockedSummary = BUILD_CONTROL_ORCHESTRATION_ENABLED ? deriveTerminalBlockedSummary(team) : null;
                const expanded = expandedTeamId === team.teamId;
                return (
                  <>
              <div className="vicode-build-plan-summary">
                <div className="vicode-build-team-top">
                  <div className="vicode-build-team-copy">
                    <h4>{team.label}</h4>
                    <p>{team.goal}</p>
                    <p className="vicode-build-lane-summary">
                      <strong>Activity:</strong>{' '}
                      {team.status === 'waiting'
                        ? 'Waiting on an existing overlapping slice'
                        : terminalBlockedSummary
                          ? 'Blocked on verification or environment'
                        : activity.activeLane
                        ? `${activity.activeLane.label} is working`
                        : activity.blockedLane
                          ? `${activity.blockedLane.label} needs attention`
                          : 'Waiting for the next bounded slice'}
                      {team.lastActivityAt ? ` • ${formatTime(team.lastActivityAt)}` : ''}
                    </p>
                    {terminalBlockedSummary ? (
                      <p className="vicode-build-lane-summary vicode-build-lane-warning">
                        <strong>Blocked:</strong> {terminalBlockedSummary}
                      </p>
                    ) : null}
                    {BUILD_CONTROL_ORCHESTRATION_ENABLED && team.activeTicketTitle ? (
                      <p className="vicode-build-lane-summary">
                        <strong>Current ticket:</strong> {team.activeTicketTitle}
                      </p>
                    ) : BUILD_CONTROL_ORCHESTRATION_ENABLED && team.ownedSliceSummary ? (
                      <p className="vicode-build-lane-summary">
                        <strong>Owned slice:</strong> {team.ownedSliceSummary}
                      </p>
                    ) : BUILD_CONTROL_ORCHESTRATION_ENABLED && team.ticketSummary ? (
                      <p className="vicode-build-lane-summary">
                        <strong>Open tickets:</strong> {team.ticketSummary}
                      </p>
                    ) : null}
                    {compactPath(team.worktreeRoot) ? <p className="vicode-build-path">{compactPath(team.worktreeRoot)}</p> : null}
                  </div>
                  <div className="vicode-build-summary-actions">
                    <StatusPill tone={toneForStatus(team.status)}>{team.status}</StatusPill>
                    <ActionButton
                      size="compact"
                      tone="quiet"
                      onClick={() => setExpandedTeamId(expanded ? null : team.teamId)}
                    >
                      {expanded ? 'Collapse' : 'Expand'}
                    </ActionButton>
                  </div>
                </div>
                <div className="vicode-build-progress-bar" aria-hidden="true">
                  <div className="vicode-build-progress-fill" style={{ width: `${activity.progressPercent}%` }} />
                </div>
              </div>
              <div className="vicode-build-lane-timeline" aria-label={`${team.label} plan progress`}>
                {activity.orderedLanes.map((lane, index) => {
                  const state = laneStepState(lane.status, lane.paused);
                  return (
                    <div key={lane.laneId} className={`vicode-build-timeline-step is-${state}`}>
                      <div className="vicode-build-timeline-node" aria-hidden="true" />
                      {index < activity.orderedLanes.length - 1 ? <div className="vicode-build-timeline-rail" aria-hidden="true" /> : null}
                      <div className="vicode-build-timeline-copy">
                        <strong>{laneDisplayName(lane.laneId)}</strong>
                        <span>{laneStepLabel(lane.status, lane.paused)}</span>
                        {lane.lastPreview ? <p>{lane.lastPreview}</p> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              {expanded ? (
                <>
              <div className="vicode-build-team-actions">
                <ActionButton
                  size="compact"
                  tone="quiet"
                  leadingIcon={<CloseIcon />}
                  onClick={() => void props.onSetTeamPaused(team.teamId, true)}
                  disabled={props.busyAction === `pause:${team.teamId}`}
                >
                  Pause plan
                </ActionButton>
                <PrimaryButton
                  size="compact"
                  leadingIcon={<CheckIcon />}
                  onClick={() => void props.onSetTeamPaused(team.teamId, false)}
                  disabled={props.busyAction === `resume:${team.teamId}`}
                >
                  Resume plan
                </PrimaryButton>
              </div>
              {team.heartbeatSummary ? (
                <p className="vicode-build-lane-summary">
                  <strong>Heartbeat:</strong> {team.heartbeatSummary}
                  {team.heartbeatStatus ? ` (${team.heartbeatStatus})` : ''}
                  {team.heartbeatUpdatedAt ? ` • ${formatTime(team.heartbeatUpdatedAt)}` : ''}
                </p>
              ) : team.heartbeatPath ? (
                <p className="vicode-build-lane-summary">
                  <strong>Heartbeat:</strong> {team.heartbeatPath}
                </p>
              ) : null}
              {summarizeChecklist(team.heartbeatOpenItems) ? (
                <p className="vicode-build-lane-summary">
                  <strong>Checklist:</strong> {summarizeChecklist(team.heartbeatOpenItems)}
                </p>
              ) : null}
              {BUILD_CONTROL_ORCHESTRATION_ENABLED && team.ticketQueuePath ? (
                <p className="vicode-build-lane-summary">
                  <strong>Tickets:</strong> {team.openTicketCount} open
                  {team.blockedTicketCount ? ` • ${team.blockedTicketCount} blocked` : ''}
                  {` • ${compactPath(team.ticketQueuePath) ?? team.ticketQueuePath}`}
                </p>
              ) : null}
              {BUILD_CONTROL_ORCHESTRATION_ENABLED && team.ownedSliceSummary ? (
                <p className="vicode-build-lane-summary">
                  <strong>Owned slice:</strong> {team.ownedSliceSummary}
                </p>
              ) : null}
              {BUILD_CONTROL_ORCHESTRATION_ENABLED && team.tickets.length ? (
                <div className="vicode-build-event-list">
                  {team.tickets.map((ticket) => (
                    <div key={ticket.id} className="vicode-build-event-row">
                      <div className="vicode-build-event-copy">
                        <div className="vicode-build-event-meta">
                          <StatusPill tone={ticket.status === 'blocked' ? 'warning' : ticket.status === 'done' ? 'success' : ticket.status === 'in_progress' ? 'connected' : 'default'}>
                            {ticket.status.replace('_', ' ')}
                          </StatusPill>
                          <span>{laneDisplayName(ticket.ownerLane)}</span>
                          {ticket.updatedAt ? <span>{formatTime(ticket.updatedAt)}</span> : null}
                        </div>
                        <p>{ticket.title}</p>
                        {ticket.summary ? <span>{ticket.summary}</span> : null}
                        {ticket.dependencies.length ? (
                          <span>{`Depends on: ${ticket.dependencies.join(', ')}`}</span>
                        ) : null}
                        {summarizeChecklist(ticket.acceptanceCriteria) ? (
                          <span>{`Accept: ${summarizeChecklist(ticket.acceptanceCriteria)}`}</span>
                        ) : null}
                        {summarizeChecklist(ticket.verificationSteps) ? (
                          <span>{`Verify: ${summarizeChecklist(ticket.verificationSteps)}`}</span>
                        ) : null}
                        {ticket.stopWhen ? <span>{`Stop when: ${ticket.stopWhen}`}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="vicode-build-lane-list">
                {team.lanes.map((lane) => (
                  <div key={lane.automationId} className="vicode-build-lane-row">
                    <div className="vicode-build-lane-main">
                      <div className="vicode-build-lane-heading">
                        <strong>{lane.label}</strong>
                        <StatusPill tone={toneForStatus(lane.status)}>{lane.status}</StatusPill>
                      </div>
                      <div className="vicode-build-lane-meta">
                        <span>{BUILD_CONTROL_ORCHESTRATION_ENABLED ? (lane.paused ? 'Paused for orchestration' : 'Ready for orchestration') : (lane.paused ? 'Paused' : 'Available')}</span>
                        <span>{`Last ${formatTime(lane.lastRunAt)}`}</span>
                        {lane.skillNames.length ? <span>{`Skills: ${lane.skillNames.join(', ')}`}</span> : null}
                        {lane.threadTitle ? <span>{lane.threadTitle}</span> : null}
                        {lane.threadStatus ? <span>{`Thread ${lane.threadStatus}`}</span> : null}
                      </div>
                      {lane.lastPreview ? <p className="vicode-build-lane-summary">{lane.lastPreview}</p> : null}
                      {lane.blockedReason ? (
                        <p className="vicode-build-lane-summary vicode-build-lane-warning">
                          <strong>Blocked:</strong> {lane.blockedReason}
                        </p>
                      ) : null}
                      {lane.recommendedAction ? (
                        <p className="vicode-build-lane-summary">
                          <strong>Next:</strong> {lane.recommendedAction}
                        </p>
                      ) : null}
                      {lane.lastWakeReason ? (
                        <p className="vicode-build-lane-summary">
                          <strong>Wake:</strong> {lane.lastWakeReason}
                          {lane.lastWakeAt ? ` (${formatTime(lane.lastWakeAt)})` : ''}
                        </p>
                      ) : null}
                      {lane.lastHandoffSummary ? (
                        <p className="vicode-build-lane-summary">
                          <strong>Handoff:</strong> {lane.lastHandoffSummary}
                          {lane.lastHandoffAt ? ` (${formatTime(lane.lastHandoffAt)})` : ''}
                        </p>
                      ) : null}
                      {lane.recentEvents.length ? (
                        <div className="vicode-build-event-list">
                          {lane.recentEvents.map((event) => (
                            <div key={event.id} className="vicode-build-event-row">
                              <div className="vicode-build-event-copy">
                                <div className="vicode-build-event-meta">
                                  <StatusPill tone={eventTone(event)}>{eventKindLabel(event)}</StatusPill>
                                  <span>{formatTime(event.createdAt)}</span>
                                </div>
                                <p>{event.summary}</p>
                                {event.detail ? <span>{event.detail}</span> : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="vicode-build-lane-actions">
                      {lane.threadId ? (
                        <ActionButton size="compact" tone="quiet" onClick={() => void props.onOpenThread(lane.threadId!)}>
                          Open thread
                        </ActionButton>
                      ) : null}
                      {lane.recentEvents.some((event) => event.kind === 'run_stalled') ? (
                        <ActionButton
                          size="compact"
                          tone="quiet"
                          onClick={() => void props.onRetryLane(team.teamId, lane.laneId)}
                          disabled={props.busyAction === `retry:${team.teamId}:${lane.laneId}`}
                        >
                          Retry stalled lane
                        </ActionButton>
                      ) : null}
                      <PrimaryButton
                        size="compact"
                        leadingIcon={<PlayIcon />}
                        onClick={() => void props.onWakeLane(team.teamId, lane.laneId)}
                        disabled={props.busyAction === `wake:${team.teamId}:${lane.laneId}`}
                      >
                        {laneActionLabel(lane.laneId)}
                      </PrimaryButton>
                    </div>
                  </div>
                ))}
              </div>
                </>
              ) : null}
                  </>
                );
              })()}
            </article>
          ))}
        </div>
      </SurfaceCard>

      {props.verification ? (
        <SurfaceCard className="vicode-build-panel">
          <div className="vicode-build-header">
            <div>
              <h3>Verification</h3>
              <p>{props.verification.ok ? 'All verification checks passed.' : 'One or more verification checks need attention.'}</p>
            </div>
            <StatusPill tone={props.verification.ok ? 'success' : 'warning'}>
              {props.verification.ok ? 'passing' : 'attention'}
            </StatusPill>
          </div>
          <div className="vicode-build-verification-list">
            {props.verification.steps.map((step) => (
              <div key={step.id} className="vicode-build-verification-row">
                <div className="vicode-build-verification-copy">
                  <strong>{step.teamLabel}</strong>
                  <span>{step.label}</span>
                  {step.detail ? <p>{step.detail}</p> : null}
                </div>
                <StatusPill tone={step.ok ? 'success' : 'warning'}>{step.summary}</StatusPill>
              </div>
            ))}
          </div>
        </SurfaceCard>
      ) : null}

      {props.snapshot.recentEvents.length ? (
        <SurfaceCard className="vicode-build-panel">
          <div className="vicode-build-header">
            <div>
              <h3>Diagnostics</h3>
              <p>Recent controller decisions, wake attempts, and handoff outcomes. Use this when a lane feels stuck or unexpected.</p>
            </div>
            <StatusPill tone="default">{props.snapshot.recentEvents.length} events</StatusPill>
          </div>
          <div className="vicode-build-diagnostics-list">
            {props.snapshot.recentEvents.map((event) => (
              <div key={event.id} className="vicode-build-diagnostics-row">
                <div className="vicode-build-diagnostics-copy">
                  <div className="vicode-build-event-meta">
                    <StatusPill tone={eventTone(event)}>{eventKindLabel(event)}</StatusPill>
                    <span>{event.teamId}</span>
                    <span>{event.laneId}</span>
                    <span>{formatTime(event.createdAt)}</span>
                  </div>
                  <p>{event.summary}</p>
                  {event.detail ? <span>{event.detail}</span> : null}
                </div>
                {event.threadId ? (
                  <ActionButton size="compact" tone="quiet" onClick={() => void props.onOpenThread(event.threadId!)}>
                    Open thread
                  </ActionButton>
                ) : null}
              </div>
            ))}
          </div>
        </SurfaceCard>
      ) : null}

      {props.busyAction ? (
        <div className="vicode-build-busy-indicator">
          <LoadingIcon size={16} />
          <span>Updating controller state...</span>
        </div>
      ) : null}
    </section>
  );
}
