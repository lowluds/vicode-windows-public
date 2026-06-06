import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadDetail } from '../../shared/domain';
import { captureWorkspaceSnapshot } from './workspace-changes';
import { ProviderRunFinalizationService } from './provider-run-finalization-service';
import type { HarnessWorktreeSession } from './harness-worktree-session';

const tempDirs: string[] = [];

function createWorkspace(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'vicode-finalization-'));
  tempDirs.push(dir);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(dir, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, 'utf8');
  }

  return dir;
}

function createThread(): ThreadDetail {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Thread',
    providerId: 'openai',
    modelId: 'gpt-5',
    executionPermission: 'default',
    status: 'running',
    archived: false,
    lastMessageAt: '2026-03-17T00:00:00.000Z',
    createdAt: '2026-03-17T00:00:00.000Z',
    updatedAt: '2026-03-17T00:00:00.000Z',
    lastPreview: '',
    turns: [],
    rawOutput: [],
    followUps: [],
    planner: {
      threadId: 'thread-1',
      composerMode: 'default',
      turnState: 'idle',
      activePlanId: null,
      pendingQuestionCallId: null,
      updatedAt: '2026-03-17T00:00:00.000Z',
      activePlan: null,
      pendingQuestionSet: null
    }
  };
}

function createHarnessWorktreeSession(overrides: Partial<HarnessWorktreeSession> = {}): HarnessWorktreeSession {
  return {
    threadId: 'thread-1',
    runId: 'run-1',
    projectId: 'project-1',
    sourceRepoRoot: 'C:/Users/test-user/source',
    sourceWorkspaceRoot: 'C:/Users/test-user/source/packages/app',
    sourceWorkspaceRelativePath: 'packages/app',
    worktreeRepoRoot: 'C:/Users/test-user/AppData/Local/Vicode/worktrees/project-1/run-1',
    worktreeWorkspaceRoot: 'C:/Users/test-user/AppData/Local/Vicode/worktrees/project-1/run-1/packages/app',
    branchName: 'vicode/worktree/project-1/run-1',
    baseRef: 'HEAD',
    baseSha: 'abc123',
    status: 'ready',
    cleanupPolicy: 'preserve_until_review',
    reviewStatus: 'pending',
    createdAt: '2026-03-17T00:00:00.000Z',
    updatedAt: '2026-03-17T00:00:00.000Z',
    errorReason: null,
    ...overrides
  };
}

function createHost(thread = createThread()) {
  return {
    db: {
      addRunEvent: vi.fn((threadId: string, runId: string, eventType: string, payload: Record<string, unknown>) => {
        const event = {
          id: `event-${thread.rawOutput.length + 1}`,
          threadId,
          runId,
          eventType,
          payload,
          createdAt: '2026-03-17T00:00:00.000Z'
        };
        thread.rawOutput.push(event as never);
        return event;
      }),
      getThread: vi.fn(() => thread),
      removeEmptyAssistantTurn: vi.fn(),
      setThreadPlannerTurnState: vi.fn(),
      updateAssistantTurn: vi.fn(),
      updateThreadStatus: vi.fn((_threadId: string, status: ThreadDetail['status']) => {
        thread.status = status;
      })
    },
    runProgress: {
      clearPersisted: vi.fn(),
      clear: vi.fn(),
      complete: vi.fn(),
      get: vi.fn(() => ({
        runId: 'run-1',
        threadId: 'thread-1',
        title: null,
        items: [],
        updatedAt: '2026-03-17T00:00:00.000Z',
        diffStats: null,
        reviewAvailable: false,
        changeArtifact: null,
        delegation: null,
        contextPressure: null,
        checkpointReminder: null,
        queueSummary: null
      })),
      publish: vi.fn()
    },
    runEvents: {
      clearRunInfo: vi.fn(),
      recordRuntimeTraceMark: vi.fn()
    },
    threadProjection: {
      emitThread: vi.fn(),
      emitThreadSummary: vi.fn()
    },
    emit: vi.fn(),
    clearPendingToolApprovals: vi.fn(),
    maybeDispatchNextFollowUp: vi.fn(),
    generateThreadTitle: vi.fn()
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const current = tempDirs.pop();
    if (current) {
      rmSync(current, { recursive: true, force: true });
    }
  }
});

describe('ProviderRunFinalizationService', () => {
  it('keeps direct workspace finalization as generic workspace diff evidence', () => {
    const workspace = createWorkspace({
      'src/app.ts': 'export const value = "before";\n'
    });
    const snapshot = captureWorkspaceSnapshot(workspace);
    expect(snapshot).not.toBeNull();
    writeFileSync(join(workspace, 'src/app.ts'), 'export const value = "after";\n', 'utf8');
    const host = createHost();
    const service = new ProviderRunFinalizationService(host as never);

    service.finalizeSuccessfulExecutionRun({
      threadId: 'thread-1',
      runId: 'run-1',
      output: 'Done',
      workspaceSnapshot: snapshot,
      projectFolderPath: workspace,
      approvedPlan: false,
      titlePrompt: null
    });

    const changeEvent = host.db.addRunEvent.mock.calls
      .map(([, , , payload]) => payload)
      .find((payload) =>
        payload.activity
        && typeof payload.activity === 'object'
        && 'kind' in payload.activity
        && payload.activity.kind === 'change_summary'
      );
    expect(changeEvent?.activity).toMatchObject({
      kind: 'change_summary',
      changeArtifact: {
        source: 'workspace_diff'
      }
    });
  });

  it('marks git worktree finalization as worktree diff and records safe worktree evidence', () => {
    const workspace = createWorkspace({
      'src/app.ts': 'export const value = "before";\n'
    });
    const snapshot = captureWorkspaceSnapshot(workspace);
    expect(snapshot).not.toBeNull();
    writeFileSync(join(workspace, 'src/app.ts'), 'export const value = "after";\n', 'utf8');
    const host = createHost();
    const service = new ProviderRunFinalizationService(host as never);

    service.finalizeSuccessfulExecutionRun({
      threadId: 'thread-1',
      runId: 'run-1',
      output: 'Done',
      workspaceSnapshot: snapshot,
      projectFolderPath: workspace,
      approvedPlan: false,
      titlePrompt: null,
      changeArtifactSource: 'worktree_diff',
      harnessWorktreeSession: createHarnessWorktreeSession()
    });

    const eventPayloads = host.db.addRunEvent.mock.calls.map(([, , , payload]) => payload);
    expect(eventPayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'change_summary',
          changeArtifact: expect.objectContaining({
            source: 'worktree_diff',
            summary: {
              filesChanged: 1,
              insertions: 1,
              deletions: 1
            }
          })
        })
      }),
      expect.objectContaining({
        worktreeChangeEvidence: {
          threadId: 'thread-1',
          runId: 'run-1',
          isolationMode: 'git_worktree',
          status: 'ready',
          reviewStatus: 'pending',
          cleanupPolicy: 'preserve_until_review',
          sourceWorkspaceRelativePath: 'packages/app',
          branchName: 'vicode/worktree/project-1/run-1',
          baseRef: 'HEAD',
          baseSha: 'abc123',
          filesChanged: 1,
          insertions: 1,
          deletions: 1,
          changedPaths: ['src/app.ts']
        }
      })
    ]));

    const worktreeEvidence = eventPayloads.find((payload) =>
      'worktreeChangeEvidence' in payload
    );
    const serialized = JSON.stringify(worktreeEvidence);
    expect(serialized).not.toContain('sourceRepoRoot');
    expect(serialized).not.toContain('sourceWorkspaceRoot');
    expect(serialized).not.toContain('worktreeRepoRoot');
    expect(serialized).not.toContain('worktreeWorkspaceRoot');
    expect(serialized).not.toContain('beforeContent');
    expect(serialized).not.toContain('afterContent');
    expect(serialized).not.toContain('patchText');
    expect(serialized).not.toContain('C:/Users/test-user/source');
    expect(serialized).not.toContain('C:/Users/test-user/AppData/Local/Vicode/worktrees');
  });
});
