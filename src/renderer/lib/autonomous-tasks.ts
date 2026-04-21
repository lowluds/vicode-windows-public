import type { AutonomousTaskSummary } from '../../shared/domain';
export { summarizeAutonomousTasks } from '../../shared/autonomous-tasks';

const COMPOSER_VISIBLE_AUTONOMOUS_STATUSES = new Set<AutonomousTaskSummary['status']>([
  'running',
  'waiting',
  'queued',
  'blocked',
  'failed'
]);

export function filterComposerAutonomousTasks(tasks: AutonomousTaskSummary[]) {
  return tasks.filter((task) => COMPOSER_VISIBLE_AUTONOMOUS_STATUSES.has(task.status));
}
