import { describe, expect, it, vi } from 'vitest';
import type {
  RunEvent,
  ThreadDetail,
  WorktreeCleanupDecision,
  WorktreeReviewDecision
} from '../../shared/domain';
import type {
  HarnessWorktreeCleanupResult,
  HarnessWorktreeSession
} from './harness-worktree-session';
import { HarnessWorktreeCleanupService } from './harness-worktree-cleanup';

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
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
    errorReason: null,
    ...overrides
  };
}

function createWorktreeSessionEvent(session: HarnessWorktreeSession): RunEvent {
  return {
    id: 'event-worktree-session',
    threadId: session.threadId,
    runId: session.runId,
    eventType: 'info',
    payload: {
      runtimeTrace: {
        stage: 'worktree_session_created',
        at: '2026-05-29T00:00:00.000Z',
        detail: {
          sourceWorkspaceRoot: session.sourceWorkspaceRoot,
          runtimeWorkspaceRoot: session.worktreeWorkspaceRoot,
          harnessWorktreeSession: session
        }
      }
    },
    createdAt: '2026-05-29T00:00:00.000Z'
  };
}

function createReviewDecisionEvent(
  action: WorktreeReviewDecision['action'],
  status: WorktreeReviewDecision['status'],
  createdAt = '2026-05-29T00:00:01.000Z'
): RunEvent {
  return {
    id: `event-worktree-review-${action}-${status}-${createdAt}`,
    threadId: 'thread-1',
    runId: 'run-1',
    eventType: 'info',
    payload: {
      worktreeReviewDecision: {
        action,
        status,
        threadId: 'thread-1',
        runId: 'run-1',
        isolationMode: 'git_worktree',
        branchName: 'vicode/worktree/project-1/run-1',
        baseSha: 'abc123',
        sourceWorkspaceRelativePath: 'packages/app',
        changedPaths: ['src/example.txt'],
        filesChanged: 1,
        insertions: 1,
        deletions: 1,
        errorReason: status === 'failed' ? 'Prior review failed.' : null,
        createdAt
      } satisfies WorktreeReviewDecision
    },
    createdAt
  };
}

function createCleanupDecisionEvent(decision: WorktreeCleanupDecision): RunEvent {
  return {
    id: `event-worktree-cleanup-${decision.status}`,
    threadId: decision.threadId,
    runId: decision.runId,
    eventType: 'info',
    payload: {
      worktreeCleanupDecision: decision
    },
    createdAt: decision.createdAt
  };
}

function createThread(rawOutput: RunEvent[]): ThreadDetail {
  return {
    id: 'thread-1',
    rawOutput
  } as ThreadDetail;
}

function createCleanupDb(thread: ThreadDetail) {
  const recordedEvents: RunEvent[] = [];
  const db = {
    getThread: vi.fn((threadId: string) => {
      if (threadId !== thread.id) {
        throw new Error(`Unexpected thread ${threadId}`);
      }
      return thread;
    }),
    addRunEvent: vi.fn((threadId: string, runId: string, eventType: RunEvent['eventType'], payload: Record<string, unknown>) => {
      const event: RunEvent = {
        id: `cleanup-decision-${recordedEvents.length + 1}`,
        threadId,
        runId,
        eventType,
        payload,
        createdAt: '2026-05-29T00:00:03.000Z'
      };
      recordedEvents.push(event);
      thread.rawOutput.push(event);
      return event;
    })
  };

  return { db, recordedEvents };
}

function createCleanupHost(result: HarnessWorktreeCleanupResult) {
  return {
    cleanup: vi.fn(async () => result)
  };
}

describe('HarnessWorktreeCleanupService', () => {
  it('cleans a preserved worktree after an applied review decision and records sanitized evidence', async () => {
    const session = createHarnessWorktreeSession();
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createReviewDecisionEvent('applied', 'applied')
    ]);
    const { db, recordedEvents } = createCleanupDb(thread);
    const cleanupHost = createCleanupHost({
      ok: true,
      status: 'cleaned',
      worktreeRepoRoot: session.worktreeRepoRoot,
      errorReason: null
    });
    const service = new HarnessWorktreeCleanupService(db, cleanupHost);

    const decision = await service.cleanup({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(cleanupHost.cleanup).toHaveBeenCalledWith({
      sourceRepoRoot: session.sourceRepoRoot,
      worktreeRepoRoot: session.worktreeRepoRoot
    });
    expect(decision).toMatchObject({
      action: 'cleaned',
      status: 'cleaned',
      threadId: 'thread-1',
      runId: 'run-1',
      isolationMode: 'git_worktree',
      branchName: session.branchName,
      baseSha: session.baseSha,
      cleanupPolicy: 'preserve_until_review',
      reviewStatus: 'applied',
      errorReason: null
    });

    const payload = recordedEvents.at(-1)?.payload;
    expect(payload).toMatchObject({
      eventKind: 'debug_detail',
      transcriptVisible: false,
      worktreeCleanupDecision: expect.objectContaining({
        action: 'cleaned',
        status: 'cleaned'
      })
    });
    const payloadJson = JSON.stringify(payload);
    expect(payloadJson).not.toContain(session.sourceRepoRoot);
    expect(payloadJson).not.toContain(session.sourceWorkspaceRoot);
    expect(payloadJson).not.toContain(session.worktreeRepoRoot);
    expect(payloadJson).not.toContain(session.worktreeWorkspaceRoot);
  });

  it('refuses cleanup while the worktree review is still pending', async () => {
    const session = createHarnessWorktreeSession();
    const thread = createThread([createWorktreeSessionEvent(session)]);
    const { db, recordedEvents } = createCleanupDb(thread);
    const cleanupHost = createCleanupHost({
      ok: true,
      status: 'cleaned',
      worktreeRepoRoot: session.worktreeRepoRoot,
      errorReason: null
    });
    const service = new HarnessWorktreeCleanupService(db, cleanupHost);

    const decision = await service.cleanup({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(cleanupHost.cleanup).not.toHaveBeenCalled();
    expect(decision).toMatchObject({
      action: 'refused',
      status: 'refused',
      reviewStatus: 'pending',
      errorReason: expect.stringMatching(/after an applied, rejected, or reverted/u)
    });
    expect(recordedEvents.at(-1)?.payload).toMatchObject({
      worktreeCleanupDecision: expect.objectContaining({
        status: 'refused'
      })
    });
  });

  it('refuses cleanup when the latest worktree review decision failed', async () => {
    const session = createHarnessWorktreeSession();
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createReviewDecisionEvent('applied', 'applied', '2026-05-29T00:00:01.000Z'),
      createReviewDecisionEvent('reverted', 'failed', '2026-05-29T00:00:02.000Z')
    ]);
    const { db } = createCleanupDb(thread);
    const cleanupHost = createCleanupHost({
      ok: true,
      status: 'cleaned',
      worktreeRepoRoot: session.worktreeRepoRoot,
      errorReason: null
    });
    const service = new HarnessWorktreeCleanupService(db, cleanupHost);

    const decision = await service.cleanup({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(cleanupHost.cleanup).not.toHaveBeenCalled();
    expect(decision).toMatchObject({
      action: 'refused',
      status: 'refused',
      reviewStatus: 'failed',
      errorReason: expect.stringMatching(/failed review decision/u)
    });
  });

  it.each(['rejected', 'reverted'] as const)('cleans a preserved worktree after a %s review decision', async (reviewStatus) => {
    const session = createHarnessWorktreeSession();
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createReviewDecisionEvent(reviewStatus, reviewStatus)
    ]);
    const { db } = createCleanupDb(thread);
    const cleanupHost = createCleanupHost({
      ok: true,
      status: 'cleaned',
      worktreeRepoRoot: session.worktreeRepoRoot,
      errorReason: null
    });
    const service = new HarnessWorktreeCleanupService(db, cleanupHost);

    const decision = await service.cleanup({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(cleanupHost.cleanup).toHaveBeenCalledWith({
      sourceRepoRoot: session.sourceRepoRoot,
      worktreeRepoRoot: session.worktreeRepoRoot
    });
    expect(decision).toMatchObject({
      action: 'cleaned',
      status: 'cleaned',
      reviewStatus
    });
  });

  it('records a refused cleanup decision when the session cleanup service refuses path ownership', async () => {
    const session = createHarnessWorktreeSession();
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createReviewDecisionEvent('applied', 'applied')
    ]);
    const { db, recordedEvents } = createCleanupDb(thread);
    const cleanupHost = createCleanupHost({
      ok: false,
      status: 'refused',
      worktreeRepoRoot: session.worktreeRepoRoot,
      errorReason: 'Refusing to remove a worktree outside the app-owned worktree root.'
    });
    const service = new HarnessWorktreeCleanupService(db, cleanupHost);

    const decision = await service.cleanup({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(decision).toMatchObject({
      action: 'refused',
      status: 'refused',
      reviewStatus: 'applied',
      errorReason: 'Refusing to remove a worktree outside the app-owned worktree root.'
    });
    expect(recordedEvents.at(-1)?.payload).toMatchObject({
      worktreeCleanupDecision: expect.objectContaining({
        action: 'refused',
        status: 'refused'
      })
    });
  });

  it('records a failed cleanup decision when Git cleanup fails', async () => {
    const session = createHarnessWorktreeSession();
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createReviewDecisionEvent('rejected', 'rejected')
    ]);
    const { db, recordedEvents } = createCleanupDb(thread);
    const cleanupHost = createCleanupHost({
      ok: false,
      status: 'failed',
      worktreeRepoRoot: session.worktreeRepoRoot,
      errorReason: 'Git failed to remove the worktree.'
    });
    const service = new HarnessWorktreeCleanupService(db, cleanupHost);

    const decision = await service.cleanup({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(decision).toMatchObject({
      action: 'failed',
      status: 'failed',
      reviewStatus: 'rejected',
      errorReason: 'Git failed to remove the worktree.'
    });
    expect(recordedEvents.at(-1)?.payload).toMatchObject({
      worktreeCleanupDecision: expect.objectContaining({
        status: 'failed',
        errorReason: 'Git failed to remove the worktree.'
      })
    });
  });

  it('returns an existing cleaned decision without calling cleanup again', async () => {
    const session = createHarnessWorktreeSession();
    const cleanedDecision: WorktreeCleanupDecision = {
      action: 'cleaned',
      status: 'cleaned',
      threadId: 'thread-1',
      runId: 'run-1',
      isolationMode: 'git_worktree',
      branchName: session.branchName,
      baseSha: session.baseSha,
      cleanupPolicy: session.cleanupPolicy,
      reviewStatus: 'applied',
      errorReason: null,
      createdAt: '2026-05-29T00:00:02.000Z'
    };
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createReviewDecisionEvent('applied', 'applied'),
      createCleanupDecisionEvent(cleanedDecision)
    ]);
    const { db, recordedEvents } = createCleanupDb(thread);
    const cleanupHost = createCleanupHost({
      ok: true,
      status: 'cleaned',
      worktreeRepoRoot: session.worktreeRepoRoot,
      errorReason: null
    });
    const service = new HarnessWorktreeCleanupService(db, cleanupHost);

    const decision = await service.cleanup({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(cleanupHost.cleanup).not.toHaveBeenCalled();
    expect(decision).toEqual(cleanedDecision);
    expect(recordedEvents).toHaveLength(0);
  });

  it('fails clearly when the worktree session event is missing', async () => {
    const thread = createThread([createReviewDecisionEvent('applied', 'applied')]);
    const { db } = createCleanupDb(thread);
    const cleanupHost = createCleanupHost({
      ok: true,
      status: 'cleaned',
      worktreeRepoRoot: 'C:/Users/test-user/AppData/Local/Vicode/worktrees/project-1/run-1',
      errorReason: null
    });
    const service = new HarnessWorktreeCleanupService(db, cleanupHost);

    await expect(service.cleanup({
      threadId: 'thread-1',
      runId: 'run-1'
    })).rejects.toThrow(/No git_worktree session found/u);
    expect(cleanupHost.cleanup).not.toHaveBeenCalled();
  });
});
