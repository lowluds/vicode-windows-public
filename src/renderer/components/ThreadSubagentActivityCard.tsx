import { useMemo, useState } from 'react';
import type { AutonomyDelegationProfile, SubagentSummary } from '../../shared/domain';
import { Shimmer } from './ai-elements/shimmer';
import { ChevronDownIcon, ChevronRightIcon } from './icons';
import { DisclosureButton } from './ui';
import { cx } from './ui/utils';

function isLiveSubagent(status: SubagentSummary['status']) {
  return status === 'queued' || status === 'running';
}

function sortSubagents(subagents: SubagentSummary[]) {
  return [...subagents].sort((left, right) => {
    const liveRank = Number(isLiveSubagent(left.status)) - Number(isLiveSubagent(right.status));
    if (liveRank !== 0) {
      return liveRank > 0 ? -1 : 1;
    }
    return left.createdAt.localeCompare(right.createdAt);
  });
}

export function describeDelegationRole(profile: AutonomyDelegationProfile) {
  switch (profile) {
    case 'research':
      return 'explorer';
    case 'implement':
      return 'worker';
    case 'verify':
      return 'verifier';
    case 'heartbeat':
      return 'heartbeat';
    default:
      return 'agent';
  }
}

export function summarizeSubagentActivityHeader(subagents: SubagentSummary[]) {
  const liveCount = subagents.filter((subagent) => isLiveSubagent(subagent.status)).length;
  if (liveCount > 0) {
    return `Spawning ${liveCount} agent${liveCount === 1 ? '' : 's'}`;
  }

  return `${subagents.length} delegated agent${subagents.length === 1 ? '' : 's'}`;
}

export function summarizeSubagentActivityDetail(subagents: SubagentSummary[]) {
  const counts = {
    running: 0,
    queued: 0,
    completed: 0,
    failed: 0,
    cancelled: 0
  };

  for (const subagent of subagents) {
    counts[subagent.status] += 1;
  }

  const parts: string[] = [];
  if (counts.running > 0) {
    parts.push(`${counts.running} running`);
  }
  if (counts.queued > 0) {
    parts.push(`${counts.queued} waiting`);
  }
  if (counts.completed > 0) {
    parts.push(`${counts.completed} ready`);
  }
  if (counts.failed > 0) {
    parts.push(`${counts.failed} blocked`);
  }
  if (counts.cancelled > 0) {
    parts.push(`${counts.cancelled} cancelled`);
  }

  return parts.join(' · ');
}

export function describeSubagentActivityStatus(
  subagent: SubagentSummary,
  _childThreadTitle: string | null
) {
  if (subagent.status === 'queued') {
    return 'Waiting to start on the delegated task.';
  }

  if (subagent.status === 'running') {
    return 'Working on the delegated task.';
  }

  if (subagent.status === 'completed') {
    return subagent.outputSummary?.trim() || 'Completed and waiting for follow-up work.';
  }

  if (subagent.status === 'failed') {
    return subagent.lastError?.trim() || 'Stopped on a blocker before it could finish.';
  }

  return 'Cancelled before it could finish.';
}

export function ThreadSubagentActivityCard({
  subagents,
  resolveThreadTitle
}: {
  subagents: SubagentSummary[];
  resolveThreadTitle: (threadId: string | null) => string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const orderedSubagents = useMemo(() => sortSubagents(subagents), [subagents]);
  const headerLabel = summarizeSubagentActivityHeader(orderedSubagents);
  const detailLabel = summarizeSubagentActivityDetail(orderedSubagents);

  if (orderedSubagents.length === 0) {
    return null;
  }

  return (
    <section className="thread-subagent-activity-card">
      <DisclosureButton
        className="thread-subagent-activity-trigger"
        align="between"
        trailingIcon={expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="thread-subagent-activity-heading">
          <span className="thread-subagent-activity-title">{headerLabel}</span>
          {detailLabel ? <span className="thread-subagent-activity-detail">{detailLabel}</span> : null}
        </span>
      </DisclosureButton>
      {expanded ? (
        <div className="thread-subagent-activity-body">
          {orderedSubagents.map((subagent) => {
            const childThreadTitle = resolveThreadTitle(subagent.childThreadId);
            return (
              <article key={subagent.id} className="thread-subagent-activity-entry">
                <div className="thread-subagent-activity-copy">
                  <div className="thread-subagent-activity-line">
                    <span className="thread-subagent-activity-created">Created</span>
                    <span className="thread-subagent-activity-name">{subagent.name}</span>
                    <span className="thread-subagent-activity-role">({describeDelegationRole(subagent.delegationProfile)})</span>
                    <span className="thread-subagent-activity-created">with the instructions:</span>
                  </div>
                  <div className="thread-subagent-activity-prompt">{subagent.prompt}</div>
                  <div className="thread-subagent-activity-status-row">
                    {subagent.status === 'running' ? (
                      <Shimmer as="span" className="thread-subagent-activity-status thread-subagent-activity-status-live" duration={1}>
                        Thinking
                      </Shimmer>
                    ) : null}
                    <span
                      className={cx(
                        'thread-subagent-activity-status-copy',
                        subagent.status === 'failed' && 'is-blocked',
                        subagent.status === 'completed' && 'is-complete'
                      )}
                    >
                      {describeSubagentActivityStatus(subagent, childThreadTitle)}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
