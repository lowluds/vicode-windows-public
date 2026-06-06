import { describe, expect, it } from 'vitest';
import type { WorkspaceSnapshot } from './workspace-changes';
import type { HarnessWorktreeSession } from './harness-worktree-session';
import {
  buildProviderExecutionAbortedFinalization,
  buildProviderExecutionCleanupSuccessFinalization,
  buildProviderExecutionEmptyOutputFailure,
  buildProviderExecutionFailedFinalization,
  buildProviderExecutionSuccessFinalization,
  resolveProviderExecutionApprovedPlan,
  resolveProviderExecutionTitlePrompt
} from './provider-execution-finalization';

function createWorkspaceSnapshot(): WorkspaceSnapshot {
  return {
    rootPath: 'C:/workspace',
    files: {}
  };
}

function createHarnessWorktreeSession(overrides: Partial<HarnessWorktreeSession> = {}): HarnessWorktreeSession {
  return {
    threadId: 'thread-1',
    runId: 'run-1',
    projectId: 'project-1',
    sourceRepoRoot: 'C:/workspace',
    sourceWorkspaceRoot: 'C:/workspace',
    sourceWorkspaceRelativePath: '.',
    worktreeRepoRoot: 'C:/worktree',
    worktreeWorkspaceRoot: 'C:/worktree',
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

describe('provider execution finalization helpers', () => {
  it('builds direct workspace success finalization input without forcing a change artifact source', () => {
    const workspaceSnapshot = createWorkspaceSnapshot();

    expect(
      buildProviderExecutionSuccessFinalization({
        threadId: 'thread-1',
        runId: 'run-1',
        output: 'Done',
        workspaceSnapshot,
        projectFolderPath: 'C:/workspace',
        approvedPlan: false,
        titlePrompt: 'Build the app.',
        harnessWorktreeSession: null
      })
    ).toEqual({
      threadId: 'thread-1',
      runId: 'run-1',
      output: 'Done',
      workspaceSnapshot,
      projectFolderPath: 'C:/workspace',
      approvedPlan: false,
      titlePrompt: 'Build the app.',
      changeArtifactSource: undefined,
      harnessWorktreeSession: null
    });
  });

  it('marks worktree success finalization as worktree diff evidence', () => {
    const session = createHarnessWorktreeSession();

    expect(
      buildProviderExecutionSuccessFinalization({
        threadId: 'thread-1',
        runId: 'run-1',
        output: 'Done',
        workspaceSnapshot: createWorkspaceSnapshot(),
        projectFolderPath: 'C:/worktree',
        approvedPlan: true,
        titlePrompt: null,
        harnessWorktreeSession: session
      })
    ).toMatchObject({
      changeArtifactSource: 'worktree_diff',
      harnessWorktreeSession: session,
      approvedPlan: true
    });
  });

  it('adds provider identity to cleanup success finalization input', () => {
    expect(
      buildProviderExecutionCleanupSuccessFinalization({
        providerId: 'ollama',
        modelId: 'qwen3',
        threadId: 'thread-1',
        runId: 'run-1',
        output: 'Done',
        workspaceSnapshot: null,
        projectFolderPath: 'C:/workspace',
        approvedPlan: false,
        titlePrompt: null
      })
    ).toMatchObject({
      providerId: 'ollama',
      modelId: 'qwen3',
      output: 'Done',
      projectFolderPath: 'C:/workspace'
    });
  });

  it('builds failed finalization input with stable failed statuses', () => {
    expect(
      buildProviderExecutionFailedFinalization({
        threadId: 'thread-1',
        runId: 'run-1',
        message: 'Provider disconnected.',
        tracePayload: { message: 'Provider disconnected.' },
        approvedPlan: true,
        titlePrompt: 'Fix tests.'
      })
    ).toEqual({
      threadId: 'thread-1',
      runId: 'run-1',
      message: 'Provider disconnected.',
      traceStage: 'failed',
      tracePayload: { message: 'Provider disconnected.' },
      eventType: 'failed',
      threadStatus: 'failed',
      runStatus: 'failed',
      progressStatus: 'failed',
      approvedPlan: true,
      titlePrompt: 'Fix tests.'
    });
  });

  it('builds aborted finalization input with blocked progress and no title prompt', () => {
    expect(
      buildProviderExecutionAbortedFinalization({
        threadId: 'thread-1',
        runId: 'run-1',
        message: 'Run stopped by user.',
        approvedPlan: false
      })
    ).toEqual({
      threadId: 'thread-1',
      runId: 'run-1',
      message: 'Run stopped by user.',
      traceStage: 'aborted',
      tracePayload: { message: 'Run stopped by user.' },
      eventType: 'aborted',
      threadStatus: 'aborted',
      runStatus: 'aborted',
      progressStatus: 'blocked',
      approvedPlan: false,
      titlePrompt: null
    });
  });

  it('builds empty-output failure input with provider display name and reason trace', () => {
    expect(
      buildProviderExecutionEmptyOutputFailure({
        providerId: 'openai',
        threadId: 'thread-1',
        runId: 'run-1',
        approvedPlan: false,
        titlePrompt: null
      })
    ).toMatchObject({
      message: 'OpenAI completed without producing assistant output.',
      tracePayload: { reason: 'empty_output' },
      eventType: 'failed',
      progressStatus: 'failed'
    });
  });

  it('keeps title generation and approved-plan decisions explicit at the call site', () => {
    expect(resolveProviderExecutionTitlePrompt({
      shouldGenerateTitle: true,
      prompt: 'Create a landing page.'
    })).toBe('Create a landing page.');
    expect(resolveProviderExecutionTitlePrompt({
      shouldGenerateTitle: false,
      prompt: 'Create a landing page.'
    })).toBeNull();
    expect(resolveProviderExecutionApprovedPlan({ approvedPlan: { id: 'plan-1' } })).toBe(true);
    expect(resolveProviderExecutionApprovedPlan({ approvedPlan: null })).toBe(false);
  });
});
