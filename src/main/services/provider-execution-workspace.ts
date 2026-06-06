import type {
  ComposerSubmitInput,
  Project
} from '../../shared/domain';
import type {
  HarnessWorktreeCreateResult,
  HarnessWorktreeSession,
  PrepareHarnessWorktreeSessionInput
} from './harness-worktree-session';

export interface ProviderExecutionWorkspaceHost {
  recordRuntimeTraceMark(threadId: string, runId: string, stage: string, payload?: Record<string, unknown> | null): void;
  createHarnessWorktreeSession?(input: PrepareHarnessWorktreeSessionInput): Promise<HarnessWorktreeCreateResult>;
}

export interface ProviderExecutionWorkspaceResolution {
  sourceWorkspaceRoot: string | null;
  runtimeWorkspaceRoot: string | null;
  harnessWorktreeSession: HarnessWorktreeSession | null;
}

export async function resolveProviderExecutionWorkspace(input: {
  composerInput: ComposerSubmitInput;
  project: Project;
  runId: string;
  threadId: string;
  host: ProviderExecutionWorkspaceHost;
}): Promise<ProviderExecutionWorkspaceResolution> {
  const sourceWorkspaceRoot = input.project.folderPath;
  if ((input.composerInput.isolationMode ?? 'direct_workspace') !== 'git_worktree') {
    return {
      sourceWorkspaceRoot,
      runtimeWorkspaceRoot: sourceWorkspaceRoot,
      harnessWorktreeSession: null
    };
  }

  if (!sourceWorkspaceRoot?.trim()) {
    const message = 'git_worktree isolation requires an attached project workspace folder.';
    input.host.recordRuntimeTraceMark(input.threadId, input.runId, 'worktree_session_failed', {
      reason: 'missing_workspace',
      message
    });
    throw new Error(message);
  }

  if (!input.host.createHarnessWorktreeSession) {
    const message = 'git_worktree isolation is not configured for this app runtime.';
    input.host.recordRuntimeTraceMark(input.threadId, input.runId, 'worktree_session_failed', {
      reason: 'unavailable',
      message
    });
    throw new Error(message);
  }

  const created = await input.host.createHarnessWorktreeSession({
    threadId: input.threadId,
    runId: input.runId,
    projectId: input.project.id,
    sourceWorkspaceRoot
  }).catch((error): HarnessWorktreeCreateResult => ({
    ok: false,
    reason: 'worktree_create_failed',
    message: error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Git failed to create the app-owned worktree.',
    paths: []
  }));

  if (!created.ok) {
    input.host.recordRuntimeTraceMark(input.threadId, input.runId, 'worktree_session_failed', {
      reason: created.reason,
      message: created.message,
      paths: created.paths
    });
    throw new Error(`git_worktree setup failed: ${created.message}`);
  }

  input.host.recordRuntimeTraceMark(input.threadId, input.runId, 'worktree_session_created', {
    sourceWorkspaceRoot,
    runtimeWorkspaceRoot: created.session.worktreeWorkspaceRoot,
    harnessWorktreeSession: created.session
  });

  return {
    sourceWorkspaceRoot,
    runtimeWorkspaceRoot: created.session.worktreeWorkspaceRoot,
    harnessWorktreeSession: created.session
  };
}
