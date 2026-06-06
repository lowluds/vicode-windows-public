import { useState } from 'react';
import { ActionButton, DisclosureButton } from './ui';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, NoteIcon, TaskIcon } from './icons';
import type { RunProgressState } from '../../shared/domain';
import { countCompletedRunProgressItems } from '../../shared/run-progress';
import { formatContextTokenCount, formatContextUsagePercent } from '../lib/context-window';
import { Task, TaskContent, TaskItem, TaskTrigger } from './ai-elements/task';
import { cx } from './ui/utils';

function progressItemStatusLabel(status: RunProgressState['items'][number]['status']) {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'in_progress':
      return 'In progress';
    case 'blocked':
      return 'Blocked';
    case 'failed':
      return 'Failed';
    default:
      return 'Pending';
  }
}

export function RunProgressPanel({
  progress,
  onShareRun,
  onCreateHandoff
}: {
  progress: RunProgressState;
  onShareRun?: () => void;
  onCreateHandoff?: () => void;
}) {
  const completedCount = countCompletedRunProgressItems(progress);
  const [showDelegationDetails, setShowDelegationDetails] = useState(false);

  const delegationTitle =
    progress.delegation?.mode === 'background'
      ? 'Background task active'
      : progress.delegation?.phase === 'waiting_for_answers'
      ? 'Background planner waiting'
      : progress.delegation?.phase === 'resuming'
        ? 'Background planner resuming'
        : 'Background planner active';
  const delegationDetail =
    progress.delegation == null
      ? null
      : `Includes ${progress.delegation.includedContext.join(', ')} · Excludes ${progress.delegation.excludedContext.join(', ')}`;

  return (
    <section className="run-progress-panel" data-testid="run-progress-panel">
      <div className="run-progress-header">
        <div className="run-progress-heading">
          <TaskIcon />
          <span>Progress</span>
        </div>
        {onShareRun || onCreateHandoff ? (
          <div className="collab-view-actions">
            {onShareRun ? (
              <ActionButton size="compact" tone="quiet" onClick={onShareRun}>
                Share run
              </ActionButton>
            ) : null}
            {onCreateHandoff ? (
              <ActionButton size="compact" tone="quiet" onClick={onCreateHandoff}>
                Handoff
              </ActionButton>
            ) : null}
          </div>
        ) : null}
      </div>
      {progress.contextPressure ? (
        <div className={`run-progress-insight is-${progress.contextPressure.severity}`}>
          <div className="run-progress-insight-header">
            <span className="run-progress-insight-label">{progress.contextPressure.pressureLabel}</span>
            <span className="run-progress-insight-metric">
              {formatContextUsagePercent(progress.contextPressure.usagePercent)} of{' '}
              {formatContextTokenCount(progress.contextPressure.maxTokens)}
            </span>
          </div>
          <p>{progress.contextPressure.note}</p>
        </div>
      ) : null}
      {progress.contextPressure?.compactionLikely ? (
        <div className="run-progress-queue-summary">
          <strong>Context almost full</strong>
          <span>Save anything durable before the next long turn.</span>
        </div>
      ) : null}
      {progress.delegation ? (
        <div className="run-progress-reminder" role="note" aria-label="Delegated run context">
          <div className="run-progress-reminder-header">
            <NoteIcon size={14} />
            <strong>{delegationTitle}</strong>
          </div>
          <p>{progress.delegation.note}</p>
          <DisclosureButton
            className="run-progress-context-toggle mt-2 self-start px-2.5 py-1.5"
            align="start"
            leadingIcon={showDelegationDetails ? <ChevronDownIcon /> : <ChevronRightIcon />}
            onClick={() => setShowDelegationDetails((current) => !current)}
          >
            Delegated context
          </DisclosureButton>
          {showDelegationDetails && delegationDetail ? (
            <div className="run-progress-queue-summary">
              <strong>{progress.delegation.title}</strong>
              <span>{delegationDetail}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {progress.checkpointReminder ? (
        <div className="run-progress-reminder" role="note" aria-label="Checkpoint reminder">
          <div className="run-progress-reminder-header">
            <NoteIcon size={14} />
            <strong>{progress.checkpointReminder.title}</strong>
          </div>
          <p>{progress.checkpointReminder.message}</p>
        </div>
      ) : null}
      {progress.queueSummary ? (
        <div className="run-progress-queue-summary">
          <strong>
            {progress.queueSummary.queuedCount} queued {progress.queueSummary.queuedCount === 1 ? 'message' : 'messages'}
          </strong>
          <span>
            {progress.queueSummary.steerCount} steer{progress.queueSummary.steerCount === 1 ? '' : 's'}
            {' · '}
            {progress.queueSummary.followUpCount} follow-up{progress.queueSummary.followUpCount === 1 ? '' : 's'}
            {progress.queueSummary.condensedQueuedCount > 0
              ? ` · ${progress.queueSummary.condensedQueuedCount} earlier steer ${
                  progress.queueSummary.condensedQueuedCount === 1 ? 'message' : 'messages'
                } condensed`
              : ''}
          </span>
        </div>
      ) : null}
      <Task className="run-progress-task" defaultOpen>
        <TaskTrigger title={`${completedCount} of ${progress.items.length} tasks completed`}>
          <div className="run-progress-task-trigger flex w-full items-center gap-3 border border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-03)] px-3 py-2.5 text-left transition-colors hover:bg-[color:var(--ui-alpha-05)]">
            <TaskIcon size={15} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-[color:var(--ui-text-title)]">
                {completedCount} of {progress.items.length} tasks completed
              </div>
              <div className="text-[11px] text-[color:var(--ui-text-subtle)]">{progress.title}</div>
            </div>
            <ChevronDownIcon className="transition-transform group-data-[state=open]:rotate-180" />
          </div>
        </TaskTrigger>
        <TaskContent className="run-progress-list" role="list" aria-label="Run task progress">
          {progress.items.map((item, index) => (
            <TaskItem key={item.id} className="run-progress-item flex items-center gap-3" role="listitem">
              <span
                className={cx(`run-progress-item-dot is-${item.status}`, 'inline-flex size-5 items-center justify-center rounded-full')}
                aria-hidden="true"
              >
                {item.status === 'completed' ? <CheckIcon size={11} /> : null}
              </span>
              <span className="run-progress-item-index">{index + 1}.</span>
              <span className={cx(`run-progress-item-label is-${item.status}`, 'flex-1')}>
                {item.label}
              </span>
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--ui-text-subtle)]">
                {progressItemStatusLabel(item.status)}
              </span>
            </TaskItem>
          ))}
        </TaskContent>
      </Task>
      <div className="run-progress-footnote">{progress.title}</div>
    </section>
  );
}
