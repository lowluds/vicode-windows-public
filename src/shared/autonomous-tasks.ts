import type {
  AutonomousTaskStatus,
  AutonomousTaskSummary
} from './domain';

function taskStatusRank(status: AutonomousTaskStatus) {
  switch (status) {
    case 'failed':
    case 'blocked':
      return 0;
    case 'running':
      return 1;
    case 'waiting':
      return 2;
    case 'queued':
      return 3;
    case 'completed':
      return 4;
    case 'idle':
      return 5;
    case 'cancelled':
      return 6;
  }
}

export function sortAutonomousTasks(tasks: AutonomousTaskSummary[]) {
  return [...tasks].sort((left, right) => {
    const statusDelta = taskStatusRank(left.status) - taskStatusRank(right.status);
    if (statusDelta !== 0) {
      return statusDelta;
    }
    return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '');
  });
}

export function summarizeAutonomousTasks(tasks: AutonomousTaskSummary[]) {
  if (tasks.length === 0) {
    return null;
  }

  const counts = new Map<AutonomousTaskStatus, number>();
  for (const task of tasks) {
    counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
  }

  const order: AutonomousTaskStatus[] = ['failed', 'blocked', 'running', 'waiting', 'queued', 'completed', 'idle', 'cancelled'];
  return order
    .filter((status) => (counts.get(status) ?? 0) > 0)
    .map((status) => `${counts.get(status)} ${status}`)
    .join(' · ');
}
