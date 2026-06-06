import { describe, expect, it, vi } from 'vitest';
import type {
  ComposerSubmitInput,
  Project
} from '../../shared/domain';
import type { HarnessWorktreeSession } from './harness-worktree-session';
import {
  resolveProviderExecutionWorkspace,
  type ProviderExecutionWorkspaceHost
} from './provider-execution-workspace';

function createComposerInput(overrides: Partial<ComposerSubmitInput> = {}): ComposerSubmitInput {
  return {
    projectId: 'project-1',
    prompt: 'Update the helper.',
    providerId: 'openai',
    modelId: 'gpt-5',
    executionPermission: 'default',
    skillIds: [],
    ...overrides
  };
}

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Project',
    folderPath: 'C:/workspace',
    trusted: true,
    defaultProviderId: 'openai',
    defaultModelId: 'gpt-5',
    runtimeCommandPolicy: 'ask',
    runtimeNetworkPolicy: 'enabled',
    createdAt: '2026-03-14T00:00:00.000Z',
    updatedAt: '2026-03-14T00:00:00.000Z',
    ...overrides
  };
}

function createHarnessWorktreeSession(overrides: Partial<HarnessWorktreeSession> = {}): HarnessWorktreeSession {
  const sourceWorkspaceRoot = overrides.sourceWorkspaceRoot ?? 'C:/workspace';
  const worktreeWorkspaceRoot = overrides.worktreeWorkspaceRoot ?? 'C:/vicode-worktrees/project-1/run-1';

  return {
    threadId: 'thread-1',
    runId: 'run-1',
    projectId: 'project-1',
    sourceRepoRoot: sourceWorkspaceRoot,
    sourceWorkspaceRoot,
    sourceWorkspaceRelativePath: '.',
    worktreeRepoRoot: worktreeWorkspaceRoot,
    worktreeWorkspaceRoot,
    branchName: 'vicode/worktree/project-1/run-1',
    baseRef: 'HEAD',
    baseSha: 'abc123',
    status: 'ready',
    cleanupPolicy: 'preserve_until_review',
    reviewStatus: 'pending',
    createdAt: '2026-03-14T00:00:00.000Z',
    updatedAt: '2026-03-14T00:00:00.000Z',
    errorReason: null,
    ...overrides
  };
}

function createHost(overrides: Partial<ProviderExecutionWorkspaceHost> = {}): ProviderExecutionWorkspaceHost {
  return {
    recordRuntimeTraceMark: vi.fn(),
    ...overrides
  };
}

describe('resolveProviderExecutionWorkspace', () => {
  it('uses the source workspace directly by default', async () => {
    const host = createHost();

    await expect(
      resolveProviderExecutionWorkspace({
        composerInput: createComposerInput(),
        project: createProject(),
        runId: 'run-1',
        threadId: 'thread-1',
        host
      })
    ).resolves.toEqual({
      sourceWorkspaceRoot: 'C:/workspace',
      runtimeWorkspaceRoot: 'C:/workspace',
      harnessWorktreeSession: null
    });

    expect(host.recordRuntimeTraceMark).not.toHaveBeenCalled();
  });

  it('creates and traces a git worktree runtime workspace', async () => {
    const session = createHarnessWorktreeSession();
    const createWorktreeSession = vi.fn(async () => ({
      ok: true as const,
      session
    }));
    const host = createHost({ createHarnessWorktreeSession: createWorktreeSession });

    const result = await resolveProviderExecutionWorkspace({
      composerInput: createComposerInput({ isolationMode: 'git_worktree' }),
      project: createProject(),
      runId: 'run-1',
      threadId: 'thread-1',
      host
    });

    expect(createWorktreeSession).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1',
      projectId: 'project-1',
      sourceWorkspaceRoot: 'C:/workspace'
    });
    expect(host.recordRuntimeTraceMark).toHaveBeenCalledWith(
      'thread-1',
      'run-1',
      'worktree_session_created',
      {
        sourceWorkspaceRoot: 'C:/workspace',
        runtimeWorkspaceRoot: 'C:/vicode-worktrees/project-1/run-1',
        harnessWorktreeSession: session
      }
    );
    expect(result).toEqual({
      sourceWorkspaceRoot: 'C:/workspace',
      runtimeWorkspaceRoot: 'C:/vicode-worktrees/project-1/run-1',
      harnessWorktreeSession: session
    });
  });

  it('fails git worktree isolation when no source workspace is attached', async () => {
    const host = createHost();

    await expect(
      resolveProviderExecutionWorkspace({
        composerInput: createComposerInput({ isolationMode: 'git_worktree' }),
        project: createProject({ folderPath: null }),
        runId: 'run-1',
        threadId: 'thread-1',
        host
      })
    ).rejects.toThrow('git_worktree isolation requires an attached project workspace folder.');

    expect(host.recordRuntimeTraceMark).toHaveBeenCalledWith(
      'thread-1',
      'run-1',
      'worktree_session_failed',
      {
        reason: 'missing_workspace',
        message: 'git_worktree isolation requires an attached project workspace folder.'
      }
    );
  });

  it('fails git worktree isolation when worktree sessions are unavailable', async () => {
    const host = createHost();

    await expect(
      resolveProviderExecutionWorkspace({
        composerInput: createComposerInput({ isolationMode: 'git_worktree' }),
        project: createProject(),
        runId: 'run-1',
        threadId: 'thread-1',
        host
      })
    ).rejects.toThrow('git_worktree isolation is not configured for this app runtime.');

    expect(host.recordRuntimeTraceMark).toHaveBeenCalledWith(
      'thread-1',
      'run-1',
      'worktree_session_failed',
      {
        reason: 'unavailable',
        message: 'git_worktree isolation is not configured for this app runtime.'
      }
    );
  });

  it('traces preflight failures before rejecting git worktree isolation', async () => {
    const host = createHost({
      createHarnessWorktreeSession: vi.fn(async () => ({
        ok: false as const,
        reason: 'dirty_workspace',
        message: 'git_worktree isolation requires a clean source workspace.',
        paths: ['src/dirty.ts']
      }))
    });

    await expect(
      resolveProviderExecutionWorkspace({
        composerInput: createComposerInput({ isolationMode: 'git_worktree' }),
        project: createProject(),
        runId: 'run-1',
        threadId: 'thread-1',
        host
      })
    ).rejects.toThrow('git_worktree setup failed: git_worktree isolation requires a clean source workspace.');

    expect(host.recordRuntimeTraceMark).toHaveBeenCalledWith(
      'thread-1',
      'run-1',
      'worktree_session_failed',
      {
        reason: 'dirty_workspace',
        message: 'git_worktree isolation requires a clean source workspace.',
        paths: ['src/dirty.ts']
      }
    );
  });

  it('converts thrown worktree creation errors into traced preflight failures', async () => {
    const host = createHost({
      createHarnessWorktreeSession: vi.fn(async () => {
        throw new Error('git worktree add failed.');
      })
    });

    await expect(
      resolveProviderExecutionWorkspace({
        composerInput: createComposerInput({ isolationMode: 'git_worktree' }),
        project: createProject(),
        runId: 'run-1',
        threadId: 'thread-1',
        host
      })
    ).rejects.toThrow('git_worktree setup failed: git worktree add failed.');

    expect(host.recordRuntimeTraceMark).toHaveBeenCalledWith(
      'thread-1',
      'run-1',
      'worktree_session_failed',
      {
        reason: 'worktree_create_failed',
        message: 'git worktree add failed.',
        paths: []
      }
    );
  });
});
