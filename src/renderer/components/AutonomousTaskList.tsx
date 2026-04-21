import type { AutonomousTaskSummary } from '../../shared/domain';
import { ActionButton, StatusPill } from './ui';

function toneForStatus(status: AutonomousTaskSummary['status']) {
  switch (status) {
    case 'running':
      return 'connected';
    case 'waiting':
    case 'queued':
      return 'warning';
    case 'completed':
      return 'success';
    case 'failed':
    case 'blocked':
    case 'cancelled':
      return 'danger';
    default:
      return 'muted';
  }
}

export function AutonomousTaskList({
  tasks,
  onOpenThread
}: {
  tasks: AutonomousTaskSummary[];
  onOpenThread: (threadId: string) => void;
}) {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className="autonomous-task-list">
      {tasks.map((task) => (
        <div key={task.id} className="autonomous-task-row">
          <div className="autonomous-task-copy">
            <div className="autonomous-task-heading">
              <span className="autonomous-task-title">{task.title}</span>
              <span className="autonomous-task-owner">{task.ownerLabel}</span>
            </div>
            <div className="autonomous-task-meta">
              {[task.provenanceLabel, task.trustLabel, task.approvalLabel].filter(Boolean).join(' · ')}
            </div>
            <div className="autonomous-task-summary">{task.summary}</div>
          </div>
          <div className="autonomous-task-actions">
            <StatusPill tone={toneForStatus(task.status)}>{task.statusLabel}</StatusPill>
            {task.threadId ? (
              <ActionButton tone="quiet" size="compact" onClick={() => onOpenThread(task.threadId!)}>
                Open thread
              </ActionButton>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
