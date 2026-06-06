import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMock, resetIpcTestMocks } from './ipc-test-harness';

describe('registerIpc run review handlers', () => {
  beforeEach(resetIpcTestMocks);

  it('hydrates pending run approvals in bootstrap and wires approval IPC handlers', async () => {
    const { registerIpc } = await import('./ipc');

    const pendingApproval = {
      id: 'approval-1',
      threadId: 'thread-1',
      runId: 'run-1',
      providerId: 'ollama',
      toolName: 'run_command',
      command: 'npm test',
      cwd: 'src',
      workspaceRoot: 'C:/workspace',
      requestedAt: '2026-03-23T10:00:00.000Z'
    };

    const services = {
      db: {
        getBootstrapData: vi.fn(async () => ({
          projects: [],
          threadsByProject: {},
          preferences: {}
        }))
      },
      providers: {
        onEvent: vi.fn(() => vi.fn()),
        listProviders: vi.fn(async () => []),
        listPendingToolApprovals: vi.fn(() => [pendingApproval]),
        approveToolApproval: vi.fn(async () => {}),
        rejectToolApproval: vi.fn(async () => {})
      },
      ollamaRuntime: {
        onEvent: vi.fn(() => vi.fn())
      },
      skills: {},
      automations: {
        onEvent: vi.fn(() => vi.fn())
      },
      diagnostics: {},
      mcp: {
        onEvent: vi.fn(() => vi.fn())
      },
      jobs: {
        onEvent: vi.fn(() => vi.fn())
      },
      voice: {}
    };

    const mainWindow = {
      webContents: {
        send: vi.fn()
      },
      on: vi.fn()
    };

    registerIpc(mainWindow as never, services as never);

    const bootstrapEntry = handleMock.mock.calls.find(([channel]) => channel === 'app:getBootstrap');
    expect(bootstrapEntry).toBeTruthy();
    const approveEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:approveToolApproval');
    const rejectEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:rejectToolApproval');
    expect(approveEntry).toBeTruthy();
    expect(rejectEntry).toBeTruthy();

    const [, bootstrapHandler] = bootstrapEntry!;
    const [, approveHandler] = approveEntry!;
    const [, rejectHandler] = rejectEntry!;

    const bootstrap = await bootstrapHandler({});
    expect(bootstrap.pendingRunToolApprovals).toEqual([pendingApproval]);

    await approveHandler({}, { approvalId: pendingApproval.id });
    expect(services.providers.approveToolApproval).toHaveBeenCalledWith('approval-1');

    await rejectHandler({}, { approvalId: pendingApproval.id });
    expect(services.providers.rejectToolApproval).toHaveBeenCalledWith('approval-1');
  });

  it('wires staged workspace review apply, reject, and revert IPC handlers with input validation', async () => {
    const { registerIpc } = await import('./ipc');

    const applyResult = {
      thread: { id: 'thread-1' },
      decision: {
        action: 'applied',
        status: 'applied',
        threadId: 'thread-1',
        runId: 'run-1',
        stagedEventId: 'event-staged',
        stagedEventIndex: 0,
        sourceToolName: 'write_file',
        isolationMode: 'patch_buffer',
        changedPaths: ['src/example.txt'],
        operationKinds: ['write_file'],
        errorReason: null,
        createdAt: '2026-03-14T00:00:00.000Z'
      }
    };
    const rejectResult = {
      thread: { id: 'thread-1' },
      decision: {
        ...applyResult.decision,
        action: 'rejected',
        status: 'rejected'
      }
    };
    const revertResult = {
      thread: { id: 'thread-1' },
      decision: {
        ...applyResult.decision,
        action: 'reverted',
        status: 'reverted'
      }
    };
    const previewArtifact = {
      source: 'staged_workspace_preview',
      summary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 0
      },
      files: []
    };
    const hunkApplyResult = {
      thread: { id: 'thread-1' },
      decision: {
        action: 'applied',
        status: 'applied',
        threadId: 'thread-1',
        runId: 'run-1',
        source: 'staged_workspace_preview',
        isolationMode: 'patch_buffer',
        stagedEventId: 'event-staged',
        stagedEventIndex: 0,
        changedPaths: ['src/example.txt'],
        hunkIds: ['hunk-1', 'hunk-2'],
        acceptedHunkIds: ['hunk-1'],
        rejectedHunkIds: ['hunk-2'],
        filesChanged: 1,
        insertions: 1,
        deletions: 1,
        errorReason: null,
        createdAt: '2026-05-29T00:00:00.000Z'
      }
    };
    const hunkRejectResult = {
      thread: { id: 'thread-1' },
      decision: {
        ...hunkApplyResult.decision,
        action: 'rejected',
        status: 'rejected',
        acceptedHunkIds: [],
        rejectedHunkIds: ['hunk-1']
      }
    };
    const hunkRevertResult = {
      thread: { id: 'thread-1' },
      decision: {
        ...hunkApplyResult.decision,
        action: 'reverted',
        status: 'reverted'
      }
    };
    const worktreeApplyResult = {
      thread: { id: 'thread-1' },
      decision: {
        action: 'applied',
        status: 'applied',
        threadId: 'thread-1',
        runId: 'run-1',
        isolationMode: 'git_worktree',
        branchName: 'vicode/worktree/project-1/run-1',
        baseSha: 'abc123',
        sourceWorkspaceRelativePath: '.',
        changedPaths: ['src/example.txt'],
        filesChanged: 1,
        insertions: 1,
        deletions: 1,
        errorReason: null,
        createdAt: '2026-05-29T00:00:00.000Z'
      }
    };
    const worktreeRejectResult = {
      thread: { id: 'thread-1' },
      decision: {
        ...worktreeApplyResult.decision,
        action: 'rejected',
        status: 'rejected'
      }
    };
    const worktreeRevertResult = {
      thread: { id: 'thread-1' },
      decision: {
        ...worktreeApplyResult.decision,
        action: 'reverted',
        status: 'reverted'
      }
    };
    const worktreeHunkApplyResult = {
      thread: { id: 'thread-1' },
      decision: {
        action: 'applied',
        status: 'applied',
        threadId: 'thread-1',
        runId: 'run-1',
        source: 'worktree_diff',
        isolationMode: 'git_worktree',
        branchName: 'vicode/worktree/project-1/run-1',
        baseSha: 'abc123',
        sourceWorkspaceRelativePath: '.',
        changedPaths: ['src/example.txt'],
        hunkIds: ['hunk-1', 'hunk-2'],
        acceptedHunkIds: ['hunk-1'],
        rejectedHunkIds: ['hunk-2'],
        filesChanged: 1,
        insertions: 1,
        deletions: 1,
        errorReason: null,
        createdAt: '2026-05-29T00:00:00.000Z'
      }
    };
    const worktreeHunkRejectResult = {
      thread: { id: 'thread-1' },
      decision: {
        ...worktreeHunkApplyResult.decision,
        action: 'rejected',
        status: 'rejected',
        acceptedHunkIds: [],
        rejectedHunkIds: ['hunk-1']
      }
    };
    const worktreeHunkRevertResult = {
      thread: { id: 'thread-1' },
      decision: {
        ...worktreeHunkApplyResult.decision,
        action: 'reverted',
        status: 'reverted'
      }
    };
    const worktreeCleanupResult = {
      thread: { id: 'thread-1' },
      decision: {
        action: 'cleaned',
        status: 'cleaned',
        threadId: 'thread-1',
        runId: 'run-1',
        isolationMode: 'git_worktree',
        branchName: 'vicode/worktree/project-1/run-1',
        baseSha: 'abc123',
        cleanupPolicy: 'preserve_until_review',
        reviewStatus: 'reverted',
        errorReason: null,
        createdAt: '2026-05-29T00:00:00.000Z'
      }
    };
    const services = {
      db: {},
      providers: {
        onEvent: vi.fn(() => vi.fn()),
        previewStagedWorkspaceChange: vi.fn(async () => previewArtifact),
        applyStagedWorkspaceChange: vi.fn(async () => applyResult),
        rejectStagedWorkspaceChange: vi.fn(async () => rejectResult),
        revertStagedWorkspaceChange: vi.fn(async () => revertResult),
        applyStagedWorkspaceHunks: vi.fn(async () => hunkApplyResult),
        rejectStagedWorkspaceHunks: vi.fn(async () => hunkRejectResult),
        revertStagedWorkspaceHunks: vi.fn(async () => hunkRevertResult),
        applyWorktreeReview: vi.fn(async () => worktreeApplyResult),
        rejectWorktreeReview: vi.fn(async () => worktreeRejectResult),
        revertWorktreeReview: vi.fn(async () => worktreeRevertResult),
        applyWorktreeHunks: vi.fn(async () => worktreeHunkApplyResult),
        rejectWorktreeHunks: vi.fn(async () => worktreeHunkRejectResult),
        revertWorktreeHunks: vi.fn(async () => worktreeHunkRevertResult),
        cleanupWorktreeReview: vi.fn(async () => worktreeCleanupResult)
      },
      ollamaRuntime: {
        onEvent: vi.fn(() => vi.fn())
      },
      skills: {},
      automations: {
        onEvent: vi.fn(() => vi.fn())
      },
      diagnostics: {},
      mcp: {
        onEvent: vi.fn(() => vi.fn())
      },
      jobs: {
        onEvent: vi.fn(() => vi.fn())
      },
      voice: {}
    };
    const mainWindow = {
      webContents: {
        send: vi.fn()
      },
      on: vi.fn()
    };

    registerIpc(mainWindow as never, services as never);

    const applyEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:applyStagedWorkspaceChange');
    const rejectEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:rejectStagedWorkspaceChange');
    const revertEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:revertStagedWorkspaceChange');
    const previewEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:previewStagedWorkspaceChange');
    const hunkApplyEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:applyStagedWorkspaceHunks');
    const hunkRejectEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:rejectStagedWorkspaceHunks');
    const hunkRevertEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:revertStagedWorkspaceHunks');
    const worktreeApplyEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:applyWorktreeReview');
    const worktreeRejectEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:rejectWorktreeReview');
    const worktreeRevertEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:revertWorktreeReview');
    const worktreeHunkApplyEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:applyWorktreeHunks');
    const worktreeHunkRejectEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:rejectWorktreeHunks');
    const worktreeHunkRevertEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:revertWorktreeHunks');
    const worktreeCleanupEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:cleanupWorktreeReview');
    expect(applyEntry).toBeTruthy();
    expect(rejectEntry).toBeTruthy();
    expect(revertEntry).toBeTruthy();
    expect(previewEntry).toBeTruthy();
    expect(hunkApplyEntry).toBeTruthy();
    expect(hunkRejectEntry).toBeTruthy();
    expect(hunkRevertEntry).toBeTruthy();
    expect(worktreeApplyEntry).toBeTruthy();
    expect(worktreeRejectEntry).toBeTruthy();
    expect(worktreeRevertEntry).toBeTruthy();
    expect(worktreeHunkApplyEntry).toBeTruthy();
    expect(worktreeHunkRejectEntry).toBeTruthy();
    expect(worktreeHunkRevertEntry).toBeTruthy();
    expect(worktreeCleanupEntry).toBeTruthy();

    const [, applyHandler] = applyEntry!;
    const [, rejectHandler] = rejectEntry!;
    const [, revertHandler] = revertEntry!;
    const [, previewHandler] = previewEntry!;
    const [, hunkApplyHandler] = hunkApplyEntry!;
    const [, hunkRejectHandler] = hunkRejectEntry!;
    const [, hunkRevertHandler] = hunkRevertEntry!;
    const [, worktreeApplyHandler] = worktreeApplyEntry!;
    const [, worktreeRejectHandler] = worktreeRejectEntry!;
    const [, worktreeRevertHandler] = worktreeRevertEntry!;
    const [, worktreeHunkApplyHandler] = worktreeHunkApplyEntry!;
    const [, worktreeHunkRejectHandler] = worktreeHunkRejectEntry!;
    const [, worktreeHunkRevertHandler] = worktreeHunkRevertEntry!;
    const [, worktreeCleanupHandler] = worktreeCleanupEntry!;
    await expect(applyHandler({}, { threadId: 'thread-1', runId: 'run-1' })).rejects.toThrow();
    expect(services.providers.applyStagedWorkspaceChange).not.toHaveBeenCalled();
    await expect(revertHandler({}, { threadId: 'thread-1', runId: 'run-1' })).rejects.toThrow();
    expect(services.providers.revertStagedWorkspaceChange).not.toHaveBeenCalled();
    await expect(previewHandler({}, { threadId: 'thread-1', runId: 'run-1' })).rejects.toThrow();
    expect(services.providers.previewStagedWorkspaceChange).not.toHaveBeenCalled();
    await expect(hunkApplyHandler({}, {
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      acceptedHunkIds: []
    })).rejects.toThrow();
    expect(services.providers.applyStagedWorkspaceHunks).not.toHaveBeenCalled();
    await expect(hunkRejectHandler({}, {
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      hunkIds: []
    })).rejects.toThrow();
    expect(services.providers.rejectStagedWorkspaceHunks).not.toHaveBeenCalled();
    await expect(hunkRevertHandler({}, { threadId: 'thread-1', runId: 'run-1' })).rejects.toThrow();
    expect(services.providers.revertStagedWorkspaceHunks).not.toHaveBeenCalled();

    await expect(previewHandler({}, { threadId: 'thread-1', runId: 'run-1', stagedEventId: 'event-staged' })).resolves.toBe(previewArtifact);
    expect(services.providers.previewStagedWorkspaceChange).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });

    await expect(applyHandler({}, { threadId: 'thread-1', runId: 'run-1', stagedEventId: 'event-staged' })).resolves.toBe(applyResult);
    expect(services.providers.applyStagedWorkspaceChange).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });

    await expect(rejectHandler({}, { threadId: 'thread-1', runId: 'run-1', stagedEventIndex: 0 })).resolves.toBe(rejectResult);
    expect(services.providers.rejectStagedWorkspaceChange).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventIndex: 0
    });

    await expect(revertHandler({}, { threadId: 'thread-1', runId: 'run-1', stagedEventId: 'event-staged' })).resolves.toBe(revertResult);
    expect(services.providers.revertStagedWorkspaceChange).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });

    await expect(hunkApplyHandler({}, {
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      acceptedHunkIds: ['hunk-1'],
      rejectedHunkIds: ['hunk-2'],
      beforeContent: 'must-not-cross-ipc'
    })).resolves.toBe(hunkApplyResult);
    expect(services.providers.applyStagedWorkspaceHunks).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      acceptedHunkIds: ['hunk-1'],
      rejectedHunkIds: ['hunk-2']
    });

    await expect(hunkRejectHandler({}, {
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventIndex: 0,
      hunkIds: ['hunk-1'],
      patchText: 'must-not-cross-ipc'
    })).resolves.toBe(hunkRejectResult);
    expect(services.providers.rejectStagedWorkspaceHunks).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventIndex: 0,
      hunkIds: ['hunk-1']
    });

    await expect(hunkRevertHandler({}, {
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      proposedAfterContent: 'must-not-cross-ipc'
    })).resolves.toBe(hunkRevertResult);
    expect(services.providers.revertStagedWorkspaceHunks).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });

    await expect(worktreeApplyHandler({}, { threadId: 'thread-1' })).rejects.toThrow();
    expect(services.providers.applyWorktreeReview).not.toHaveBeenCalled();
    await expect(worktreeRejectHandler({}, { runId: 'run-1' })).rejects.toThrow();
    expect(services.providers.rejectWorktreeReview).not.toHaveBeenCalled();
    await expect(worktreeRevertHandler({}, { threadId: 'thread-1' })).rejects.toThrow();
    expect(services.providers.revertWorktreeReview).not.toHaveBeenCalled();
    await expect(worktreeHunkApplyHandler({}, {
      threadId: 'thread-1',
      runId: 'run-1',
      acceptedHunkIds: []
    })).rejects.toThrow();
    expect(services.providers.applyWorktreeHunks).not.toHaveBeenCalled();
    await expect(worktreeHunkRejectHandler({}, {
      threadId: 'thread-1',
      runId: 'run-1',
      hunkIds: []
    })).rejects.toThrow();
    expect(services.providers.rejectWorktreeHunks).not.toHaveBeenCalled();
    await expect(worktreeHunkRevertHandler({}, { threadId: 'thread-1' })).rejects.toThrow();
    expect(services.providers.revertWorktreeHunks).not.toHaveBeenCalled();
    await expect(worktreeCleanupHandler({}, { runId: 'run-1' })).rejects.toThrow();
    expect(services.providers.cleanupWorktreeReview).not.toHaveBeenCalled();

    await expect(worktreeApplyHandler({}, {
      threadId: 'thread-1',
      runId: 'run-1',
      sourceWorkspaceRoot: 'C:/must-not-cross-ipc'
    })).resolves.toBe(worktreeApplyResult);
    expect(services.providers.applyWorktreeReview).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    await expect(worktreeRejectHandler({}, { threadId: 'thread-1', runId: 'run-1' })).resolves.toBe(worktreeRejectResult);
    expect(services.providers.rejectWorktreeReview).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    await expect(worktreeRevertHandler({}, {
      threadId: 'thread-1',
      runId: 'run-1',
      worktreeWorkspaceRoot: 'C:/must-not-cross-ipc'
    })).resolves.toBe(worktreeRevertResult);
    expect(services.providers.revertWorktreeReview).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    await expect(worktreeHunkApplyHandler({}, {
      threadId: 'thread-1',
      runId: 'run-1',
      acceptedHunkIds: ['hunk-1'],
      rejectedHunkIds: ['hunk-2'],
      sourceWorkspaceRoot: 'C:/must-not-cross-ipc'
    })).resolves.toBe(worktreeHunkApplyResult);
    expect(services.providers.applyWorktreeHunks).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1',
      acceptedHunkIds: ['hunk-1'],
      rejectedHunkIds: ['hunk-2']
    });

    await expect(worktreeHunkRejectHandler({}, {
      threadId: 'thread-1',
      runId: 'run-1',
      hunkIds: ['hunk-1'],
      afterContent: 'must-not-cross-ipc'
    })).resolves.toBe(worktreeHunkRejectResult);
    expect(services.providers.rejectWorktreeHunks).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1',
      hunkIds: ['hunk-1']
    });

    await expect(worktreeHunkRevertHandler({}, {
      threadId: 'thread-1',
      runId: 'run-1',
      worktreeWorkspaceRoot: 'C:/must-not-cross-ipc'
    })).resolves.toBe(worktreeHunkRevertResult);
    expect(services.providers.revertWorktreeHunks).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    await expect(worktreeCleanupHandler({}, {
      threadId: 'thread-1',
      runId: 'run-1',
      worktreeRepoRoot: 'C:/must-not-cross-ipc'
    })).resolves.toBe(worktreeCleanupResult);
    expect(services.providers.cleanupWorktreeReview).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1'
    });
  });
});
