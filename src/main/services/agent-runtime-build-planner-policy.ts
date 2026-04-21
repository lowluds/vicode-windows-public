import { resolve } from 'node:path';
import type { AgentToolExecutionContext } from '../../providers/agent-runtime';

function isBuildControllerQueuePath(relativePath: string) {
  return (
    relativePath.startsWith('.vicode/control/build-tickets/')
    && relativePath.toLowerCase().endsWith('.json')
  );
}

function getExecutionToolPreset(context: AgentToolExecutionContext) {
  return context.executionConstraints?.toolPolicy.preset ?? null;
}

function isBuildPlannerWritablePath(relativePath: string) {
  const normalized = relativePath.replace(/\\/gu, '/');
  return (
    normalized === 'HEARTBEAT.md'
    || normalized === '.vicode'
    || normalized === '.vicode/control'
    || normalized === '.vicode/control/build-heartbeats'
    || normalized === '.vicode/control/build-prompts'
    || normalized === '.vicode/control/vicode-build-teams.json'
    || normalized.startsWith('.vicode/control/build-heartbeats/')
    || normalized.startsWith('.vicode/control/build-prompts/')
  );
}

function isAllowedBuildPlannerCommand(command: string) {
  const normalized = command.trim().toLowerCase().replace(/\\/gu, '/');
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('.vicode/control/update_build_ticket_queue.py')
    || normalized.includes(' update_build_ticket_queue.py')
    || normalized.startsWith('update_build_ticket_queue.py')
    || normalized.includes('.vicode/control/check_queue_health.py')
    || normalized.includes(' check_queue_health.py')
    || normalized.startsWith('check_queue_health.py')
    || normalized.includes('.vicode/control/select_claimable_ticket.py')
    || normalized.includes(' select_claimable_ticket.py')
    || normalized.startsWith('select_claimable_ticket.py')
  );
}

export function assertBuildPlannerWorkspaceMutationAllowed(
  relativePath: string,
  context: AgentToolExecutionContext
) {
  if (getExecutionToolPreset(context) !== 'build_planner') {
    return;
  }

  if (!isBuildPlannerWritablePath(relativePath)) {
    throw new Error(
      `Build planner lanes may only write planning artifacts such as build heartbeats and build prompts. ${relativePath} must be updated by Builder or Finisher instead.`
    );
  }
}

export function rewriteBuildPlannerHelperCommand(
  command: string,
  workspaceRoot: string
) {
  const controlRoot = resolve(workspaceRoot, '.vicode', 'control').replace(/\\/gu, '/');
  const helperRewrites: Array<[RegExp, string]> = [
    [
      /(^|\s)(python(?:\.exe)?\s+)(update_build_ticket_queue\.py)(?=\s|$)/iu,
      `$1$2"${controlRoot}/update_build_ticket_queue.py"`
    ],
    [
      /(^|\s)(python(?:\.exe)?\s+)(check_queue_health\.py)(?=\s|$)/iu,
      `$1$2"${controlRoot}/check_queue_health.py"`
    ],
    [
      /(^|\s)(python(?:\.exe)?\s+)(select_claimable_ticket\.py)(?=\s|$)/iu,
      `$1$2"${controlRoot}/select_claimable_ticket.py"`
    ]
  ];

  let rewritten = command;
  for (const [pattern, replacement] of helperRewrites) {
    rewritten = rewritten.replace(pattern, replacement);
  }
  return rewritten;
}

export function assertBuildPlannerCommandAllowed(
  command: string,
  context: AgentToolExecutionContext
) {
  if (getExecutionToolPreset(context) !== 'build_planner') {
    return;
  }

  if (!isAllowedBuildPlannerCommand(command)) {
    throw new Error(
      'Build planner lanes may only use run_command for bounded control-plane helpers such as update_build_ticket_queue.py.'
    );
  }
}

export function requiresBuildControllerQueueHelper(
  relativePath: string,
  context: AgentToolExecutionContext
) {
  const preset = getExecutionToolPreset(context);
  return (
    isBuildControllerQueuePath(relativePath)
    && (preset === 'build_planner' || preset === 'builder' || preset === 'finisher')
  );
}
