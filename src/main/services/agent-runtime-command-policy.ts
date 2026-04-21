import {
  evaluateRuntimeCommandAccess,
  evaluateRuntimeCommandExecution
} from '../../shared/runtime-policy';
import type {
  AgentToolExecutionContext,
  AgentToolExecutionResult
} from '../../providers/agent-runtime';
import type { WorkspacePathResolution } from './agent-runtime-workspace-paths';
import { normalizeWorkspacePath } from './agent-runtime-workspace-paths';

export function assertRunCommandToolPolicy(
  context: AgentToolExecutionContext
) {
  const runtimePolicy = evaluateRuntimeCommandAccess(
    context.executionPermission,
    context.runtimeCommandPolicy,
    context.runtimeNetworkPolicy
  );
  if (runtimePolicy.deniedReason) {
    throw new Error(runtimePolicy.deniedReason);
  }
  if (runtimePolicy.requiresApproval && !context.requestApproval) {
    throw new Error(
      'run_command requires a runtime approval handler, but none is available for this run.'
    );
  }
}

export function resolveRunCommandExecution(
  command: string,
  requestedCwd: string,
  context: AgentToolExecutionContext
):
  | {
    resolvedCwd: WorkspacePathResolution;
  }
  | {
    errorResult: AgentToolExecutionResult;
  } {
  const resolvedCwd = normalizeWorkspacePath(
    context.workspaceRoot,
    requestedCwd
  );
  const executionPolicy = evaluateRuntimeCommandExecution(
    context.executionPermission,
    command,
    context.runtimeCommandPolicy,
    context.runtimeNetworkPolicy,
    {
      workspaceRoot: context.workspaceRoot,
      cwdPath: resolvedCwd.absolutePath
    }
  );
  if (executionPolicy.deniedReason) {
    return {
      errorResult: {
        toolName: 'run_command',
        content: executionPolicy.deniedReason,
        isError: true
      }
    };
  }

  return { resolvedCwd };
}

export async function requestRunCommandApprovalIfNeeded(
  command: string,
  resolvedCwd: WorkspacePathResolution,
  context: AgentToolExecutionContext
): Promise<AgentToolExecutionResult | null> {
  const approvalDecision = await context.requestApproval?.({
    toolName: 'run_command',
    command,
    cwd: resolvedCwd.relativePath === '.' ? null : resolvedCwd.relativePath,
    workspaceRoot: context.workspaceRoot
  });

  if (approvalDecision === 'rejected') {
    return {
      toolName: 'run_command',
      content: 'run_command was not approved by the user.',
      isError: true
    };
  }

  if (approvalDecision === 'cancelled') {
    const error = new Error('Agent runtime was aborted.');
    error.name = 'AbortError';
    throw error;
  }

  return null;
}
