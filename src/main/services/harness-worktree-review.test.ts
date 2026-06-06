import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunChangeArtifact, RunEvent, ThreadDetail } from '../../shared/domain';
import { parseRunChangeHunks } from '../../shared/hunk-review';
import type { HarnessWorktreeSession } from './harness-worktree-session';
import { HarnessWorktreeReviewService } from './harness-worktree-review';

const createdDirs: string[] = [];

async function createWorkspace(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'vicode-worktree-review-'));
  createdDirs.push(dir);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(dir, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
  }

  return dir;
}

async function readTextOrNull(path: string) {
  return readFile(path, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  });
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
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
    errorReason: null,
    ...overrides
  };
}

function createArtifact(files: RunChangeArtifact['files']): RunChangeArtifact {
  return {
    source: 'worktree_diff',
    summary: {
      filesChanged: files.length,
      insertions: files.reduce((total, file) => total + file.insertions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0)
    },
    files
  };
}

function createTwoHunkModifiedArtifact(path = 'src/mixed.txt') {
  const beforeContent = [
    'line 1',
    'line 2 before-secret-token',
    'line 3',
    'line 4',
    'line 5',
    'line 6',
    'line 7',
    'line 8',
    'line 9',
    'line 10 before-secret-token',
    'line 11'
  ].join('\n') + '\n';
  const afterContent = beforeContent
    .replace('line 2 before-secret-token', 'line 2 after-secret-token')
    .replace('line 10 before-secret-token', 'line 10 after-secret-token');
  const firstHunkOnlyContent = beforeContent.replace(
    'line 2 before-secret-token',
    'line 2 after-secret-token'
  );
  const artifact = createArtifact([
    {
      path,
      status: 'modified',
      insertions: 2,
      deletions: 2,
      beforeContent,
      afterContent,
      previewLines: [
        { type: 'context', oldLineNumber: 1, newLineNumber: 1, text: 'line 1' },
        { type: 'removed', oldLineNumber: 2, newLineNumber: null, text: 'line 2 before-secret-token' },
        { type: 'added', oldLineNumber: null, newLineNumber: 2, text: 'line 2 after-secret-token' },
        { type: 'context', oldLineNumber: 3, newLineNumber: 3, text: 'line 3' },
        { type: 'context', oldLineNumber: 4, newLineNumber: 4, text: 'line 4' },
        { type: 'context', oldLineNumber: 5, newLineNumber: 5, text: 'line 5' },
        { type: 'context', oldLineNumber: 6, newLineNumber: 6, text: 'line 6' },
        { type: 'context', oldLineNumber: 7, newLineNumber: 7, text: 'line 7' },
        { type: 'context', oldLineNumber: 8, newLineNumber: 8, text: 'line 8' },
        { type: 'context', oldLineNumber: 9, newLineNumber: 9, text: 'line 9' },
        { type: 'removed', oldLineNumber: 10, newLineNumber: null, text: 'line 10 before-secret-token' },
        { type: 'added', oldLineNumber: null, newLineNumber: 10, text: 'line 10 after-secret-token' },
        { type: 'context', oldLineNumber: 11, newLineNumber: 11, text: 'line 11' }
      ],
      previewTruncated: false
    }
  ]);
  const [firstHunk, secondHunk] = parseRunChangeHunks(artifact).hunks;
  if (!firstHunk || !secondHunk) {
    throw new Error('Expected two hunks for worktree review test fixture.');
  }
  return {
    artifact,
    beforeContent,
    afterContent,
    firstHunkOnlyContent,
    firstHunkId: firstHunk.id,
    secondHunkId: secondHunk.id
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

function createWorktreeArtifactEvent(artifact: RunChangeArtifact): RunEvent {
  return {
    id: 'event-worktree-artifact',
    threadId: 'thread-1',
    runId: 'run-1',
    eventType: 'info',
    payload: {
      activity: {
        kind: 'change_summary',
        summary: `${artifact.summary.filesChanged} files changed`,
        changeArtifact: artifact
      }
    },
    createdAt: '2026-05-29T00:00:01.000Z'
  };
}

function createDecisionEvent(
  action: 'applied' | 'rejected' | 'reverted',
  status: 'applied' | 'rejected' | 'reverted' | 'failed'
): RunEvent {
  return {
    id: `event-worktree-decision-${action}-${status}`,
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
        errorReason: status === 'failed' ? 'Prior apply failed.' : null,
        createdAt: '2026-05-29T00:00:02.000Z'
      }
    },
    createdAt: '2026-05-29T00:00:02.000Z'
  };
}

function createThread(rawOutput: RunEvent[]): ThreadDetail {
  return {
    id: 'thread-1',
    rawOutput
  } as ThreadDetail;
}

function createReviewDb(thread: ThreadDetail) {
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
        id: `decision-${recordedEvents.length + 1}`,
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

describe('HarnessWorktreeReviewService', () => {
  afterEach(async () => {
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('applies worktree added, modified, and deleted files back to the persisted source workspace and records sanitized evidence', async () => {
    const sourceWorkspaceRoot = await createWorkspace({
      'src/existing.txt': 'before-secret-token\n',
      'src/remove.txt': 'remove-secret-token\n'
    });
    const session = createHarnessWorktreeSession({ sourceWorkspaceRoot });
    const artifact = createArtifact([
      {
        path: 'src/new.txt',
        status: 'added',
        insertions: 1,
        deletions: 0,
        beforeContent: null,
        afterContent: 'new-secret-token\n',
        previewLines: [],
        previewTruncated: false
      },
      {
        path: 'src/existing.txt',
        status: 'modified',
        insertions: 1,
        deletions: 1,
        beforeContent: 'before-secret-token\n',
        afterContent: 'after-secret-token\n',
        previewLines: [],
        previewTruncated: false
      },
      {
        path: 'src/remove.txt',
        status: 'deleted',
        insertions: 0,
        deletions: 1,
        beforeContent: 'remove-secret-token\n',
        afterContent: null,
        previewLines: [],
        previewTruncated: false
      }
    ]);
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createWorktreeArtifactEvent({ ...artifact, source: 'workspace_diff' }),
      createWorktreeArtifactEvent(artifact)
    ]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new HarnessWorktreeReviewService(db);

    const decision = await service.apply({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(await readTextOrNull(join(sourceWorkspaceRoot, 'src/new.txt'))).toBe('new-secret-token\n');
    expect(await readTextOrNull(join(sourceWorkspaceRoot, 'src/existing.txt'))).toBe('after-secret-token\n');
    expect(await readTextOrNull(join(sourceWorkspaceRoot, 'src/remove.txt'))).toBeNull();
    expect(decision).toMatchObject({
      action: 'applied',
      status: 'applied',
      threadId: 'thread-1',
      runId: 'run-1',
      isolationMode: 'git_worktree',
      branchName: 'vicode/worktree/project-1/run-1',
      baseSha: 'abc123',
      sourceWorkspaceRelativePath: 'packages/app',
      changedPaths: ['src/new.txt', 'src/existing.txt', 'src/remove.txt'],
      filesChanged: 3,
      insertions: 2,
      deletions: 2,
      errorReason: null
    });

    const payload = recordedEvents.at(-1)?.payload;
    expect(payload).toMatchObject({
      eventKind: 'debug_detail',
      transcriptVisible: false,
      worktreeReviewDecision: expect.objectContaining({
        action: 'applied',
        status: 'applied',
        changedPaths: ['src/new.txt', 'src/existing.txt', 'src/remove.txt']
      })
    });
    const payloadJson = JSON.stringify(payload);
    expect(payloadJson).not.toContain(sourceWorkspaceRoot);
    expect(payloadJson).not.toContain(session.sourceRepoRoot);
    expect(payloadJson).not.toContain(session.worktreeRepoRoot);
    expect(payloadJson).not.toContain(session.worktreeWorkspaceRoot);
    expect(payloadJson).not.toContain('before-secret-token');
    expect(payloadJson).not.toContain('after-secret-token');
    expect(payloadJson).not.toContain('new-secret-token');
  });

  it('fails apply with a drift decision when the source workspace no longer matches beforeContent', async () => {
    const sourceWorkspaceRoot = await createWorkspace({
      'src/existing.txt': 'changed outside worktree\n',
      'src/untouched.txt': 'keep\n'
    });
    const session = createHarnessWorktreeSession({ sourceWorkspaceRoot });
    const artifact = createArtifact([
      {
        path: 'src/existing.txt',
        status: 'modified',
        insertions: 1,
        deletions: 1,
        beforeContent: 'expected before\n',
        afterContent: 'after\n',
        previewLines: [],
        previewTruncated: false
      },
      {
        path: 'src/new.txt',
        status: 'added',
        insertions: 1,
        deletions: 0,
        beforeContent: null,
        afterContent: 'should not be written\n',
        previewLines: [],
        previewTruncated: false
      }
    ]);
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createWorktreeArtifactEvent(artifact)
    ]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new HarnessWorktreeReviewService(db);

    await expect(service.apply({
      threadId: 'thread-1',
      runId: 'run-1'
    })).rejects.toThrow(/Workspace drift/u);

    expect(await readTextOrNull(join(sourceWorkspaceRoot, 'src/existing.txt'))).toBe('changed outside worktree\n');
    expect(await readTextOrNull(join(sourceWorkspaceRoot, 'src/new.txt'))).toBeNull();
    expect(recordedEvents.at(-1)?.payload).toMatchObject({
      worktreeReviewDecision: expect.objectContaining({
        action: 'applied',
        status: 'failed',
        errorReason: expect.stringMatching(/Workspace drift/u)
      })
    });
  });

  it('rejects a worktree run without mutating source files', async () => {
    const sourceWorkspaceRoot = await createWorkspace({
      'src/example.txt': 'before\n'
    });
    const session = createHarnessWorktreeSession({ sourceWorkspaceRoot });
    const artifact = createArtifact([
      {
        path: 'src/example.txt',
        status: 'modified',
        insertions: 1,
        deletions: 1,
        beforeContent: 'before\n',
        afterContent: 'after\n',
        previewLines: [],
        previewTruncated: false
      }
    ]);
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createWorktreeArtifactEvent(artifact)
    ]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new HarnessWorktreeReviewService(db);

    const decision = await service.reject({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(await readTextOrNull(join(sourceWorkspaceRoot, 'src/example.txt'))).toBe('before\n');
    expect(decision).toMatchObject({
      action: 'rejected',
      status: 'rejected',
      changedPaths: ['src/example.txt'],
      filesChanged: 1,
      insertions: 1,
      deletions: 1,
      errorReason: null
    });
    expect(recordedEvents.at(-1)?.payload).toMatchObject({
      worktreeReviewDecision: expect.objectContaining({
        action: 'rejected',
        status: 'rejected'
      })
    });
  });

  it('reverts an applied added worktree file by deleting it and records sanitized evidence', async () => {
    const sourceWorkspaceRoot = await createWorkspace({
      'src/new.txt': 'new-secret-token\n'
    });
    const session = createHarnessWorktreeSession({ sourceWorkspaceRoot });
    const artifact = createArtifact([
      {
        path: 'src/new.txt',
        status: 'added',
        insertions: 1,
        deletions: 0,
        beforeContent: null,
        afterContent: 'new-secret-token\n',
        previewLines: [],
        previewTruncated: false
      }
    ]);
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createWorktreeArtifactEvent(artifact),
      createDecisionEvent('applied', 'applied')
    ]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new HarnessWorktreeReviewService(db);

    const decision = await service.revert({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(await readTextOrNull(join(sourceWorkspaceRoot, 'src/new.txt'))).toBeNull();
    expect(decision).toMatchObject({
      action: 'reverted',
      status: 'reverted',
      changedPaths: ['src/new.txt'],
      filesChanged: 1,
      insertions: 1,
      deletions: 0,
      errorReason: null
    });

    const payload = recordedEvents.at(-1)?.payload;
    expect(payload).toMatchObject({
      eventKind: 'debug_detail',
      transcriptVisible: false,
      worktreeReviewDecision: expect.objectContaining({
        action: 'reverted',
        status: 'reverted',
        changedPaths: ['src/new.txt']
      })
    });
    const payloadJson = JSON.stringify(payload);
    expect(payloadJson).not.toContain(sourceWorkspaceRoot);
    expect(payloadJson).not.toContain(session.sourceRepoRoot);
    expect(payloadJson).not.toContain(session.worktreeRepoRoot);
    expect(payloadJson).not.toContain(session.worktreeWorkspaceRoot);
    expect(payloadJson).not.toContain('new-secret-token');
  });

  it('reverts an applied modified worktree file by restoring beforeContent', async () => {
    const sourceWorkspaceRoot = await createWorkspace({
      'src/example.txt': 'after-secret-token\n'
    });
    const session = createHarnessWorktreeSession({ sourceWorkspaceRoot });
    const artifact = createArtifact([
      {
        path: 'src/example.txt',
        status: 'modified',
        insertions: 1,
        deletions: 1,
        beforeContent: 'before-secret-token\n',
        afterContent: 'after-secret-token\n',
        previewLines: [],
        previewTruncated: false
      }
    ]);
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createWorktreeArtifactEvent(artifact),
      createDecisionEvent('applied', 'applied')
    ]);
    const { db } = createReviewDb(thread);
    const service = new HarnessWorktreeReviewService(db);

    const decision = await service.revert({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(await readTextOrNull(join(sourceWorkspaceRoot, 'src/example.txt'))).toBe('before-secret-token\n');
    expect(decision).toMatchObject({
      action: 'reverted',
      status: 'reverted',
      changedPaths: ['src/example.txt']
    });
  });

  it('reverts an applied deleted worktree file by recreating beforeContent', async () => {
    const sourceWorkspaceRoot = await createWorkspace({});
    const session = createHarnessWorktreeSession({ sourceWorkspaceRoot });
    const artifact = createArtifact([
      {
        path: 'src/remove.txt',
        status: 'deleted',
        insertions: 0,
        deletions: 1,
        beforeContent: 'remove-secret-token\n',
        afterContent: null,
        previewLines: [],
        previewTruncated: false
      }
    ]);
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createWorktreeArtifactEvent(artifact),
      createDecisionEvent('applied', 'applied')
    ]);
    const { db } = createReviewDb(thread);
    const service = new HarnessWorktreeReviewService(db);

    const decision = await service.revert({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(await readTextOrNull(join(sourceWorkspaceRoot, 'src/remove.txt'))).toBe('remove-secret-token\n');
    expect(decision).toMatchObject({
      action: 'reverted',
      status: 'reverted',
      changedPaths: ['src/remove.txt']
    });
  });

  it('fails revert with a drift decision when source content changed after apply', async () => {
    const sourceWorkspaceRoot = await createWorkspace({
      'src/example.txt': 'changed after apply\n'
    });
    const session = createHarnessWorktreeSession({ sourceWorkspaceRoot });
    const artifact = createArtifact([
      {
        path: 'src/example.txt',
        status: 'modified',
        insertions: 1,
        deletions: 1,
        beforeContent: 'before\n',
        afterContent: 'after\n',
        previewLines: [],
        previewTruncated: false
      }
    ]);
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createWorktreeArtifactEvent(artifact),
      createDecisionEvent('applied', 'applied')
    ]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new HarnessWorktreeReviewService(db);

    await expect(service.revert({
      threadId: 'thread-1',
      runId: 'run-1'
    })).rejects.toThrow(/Workspace drift/u);

    expect(await readTextOrNull(join(sourceWorkspaceRoot, 'src/example.txt'))).toBe('changed after apply\n');
    expect(recordedEvents.at(-1)?.payload).toMatchObject({
      worktreeReviewDecision: expect.objectContaining({
        action: 'reverted',
        status: 'failed',
        errorReason: expect.stringMatching(/Workspace drift/u)
      })
    });
  });

  it('allows revert only when the latest successful worktree review decision is applied', async () => {
    const sourceWorkspaceRoot = await createWorkspace({
      'src/example.txt': 'after\n'
    });
    const session = createHarnessWorktreeSession({ sourceWorkspaceRoot });
    const artifact = createArtifact([
      {
        path: 'src/example.txt',
        status: 'modified',
        insertions: 1,
        deletions: 1,
        beforeContent: 'before\n',
        afterContent: 'after\n',
        previewLines: [],
        previewTruncated: false
      }
    ]);

    for (const decisions of [
      [],
      [createDecisionEvent('applied', 'failed')],
      [createDecisionEvent('rejected', 'rejected')],
      [createDecisionEvent('applied', 'applied'), createDecisionEvent('reverted', 'reverted')]
    ]) {
      const thread = createThread([
        createWorktreeSessionEvent(session),
        createWorktreeArtifactEvent(artifact),
        ...decisions
      ]);
      const { db, recordedEvents } = createReviewDb(thread);
      const service = new HarnessWorktreeReviewService(db);

      await expect(service.revert({
        threadId: 'thread-1',
        runId: 'run-1'
      })).rejects.toThrow(/Only applied worktree changes can be reverted/u);
      expect(recordedEvents).toHaveLength(1);
      expect(recordedEvents.at(-1)?.payload).toMatchObject({
        worktreeReviewDecision: expect.objectContaining({
          action: 'reverted',
          status: 'failed',
          errorReason: 'Only applied worktree changes can be reverted.'
        })
      });
    }
  });

  it('applies one selected worktree hunk while leaving rejected hunks unchanged and records sanitized evidence', async () => {
    const fixture = createTwoHunkModifiedArtifact();
    const sourceWorkspaceRoot = await createWorkspace({
      'src/mixed.txt': fixture.beforeContent
    });
    const session = createHarnessWorktreeSession({ sourceWorkspaceRoot });
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createWorktreeArtifactEvent(fixture.artifact)
    ]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new HarnessWorktreeReviewService(db);

    const decision = await service.applyHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      acceptedHunkIds: [fixture.firstHunkId],
      rejectedHunkIds: [fixture.secondHunkId]
    });

    expect(await readTextOrNull(join(sourceWorkspaceRoot, 'src/mixed.txt'))).toBe(fixture.firstHunkOnlyContent);
    expect(decision).toMatchObject({
      action: 'applied',
      status: 'applied',
      source: 'worktree_diff',
      isolationMode: 'git_worktree',
      branchName: 'vicode/worktree/project-1/run-1',
      baseSha: 'abc123',
      sourceWorkspaceRelativePath: 'packages/app',
      changedPaths: ['src/mixed.txt'],
      hunkIds: [fixture.firstHunkId, fixture.secondHunkId],
      acceptedHunkIds: [fixture.firstHunkId],
      rejectedHunkIds: [fixture.secondHunkId],
      filesChanged: 1,
      insertions: 2,
      deletions: 2,
      errorReason: null
    });

    const payload = recordedEvents.at(-1)?.payload;
    expect(payload).toMatchObject({
      eventKind: 'debug_detail',
      transcriptVisible: false,
      worktreeHunkReviewDecision: expect.objectContaining({
        action: 'applied',
        status: 'applied',
        acceptedHunkIds: [fixture.firstHunkId],
        rejectedHunkIds: [fixture.secondHunkId]
      })
    });
    const payloadJson = JSON.stringify(payload);
    expect(payloadJson).not.toContain(sourceWorkspaceRoot);
    expect(payloadJson).not.toContain(session.sourceRepoRoot);
    expect(payloadJson).not.toContain(session.worktreeRepoRoot);
    expect(payloadJson).not.toContain(session.worktreeWorkspaceRoot);
    expect(payloadJson).not.toContain('before-secret-token');
    expect(payloadJson).not.toContain('after-secret-token');
  });

  it('rejects selected worktree hunks without mutating source files', async () => {
    const fixture = createTwoHunkModifiedArtifact('src/reject-hunks.txt');
    const sourceWorkspaceRoot = await createWorkspace({
      'src/reject-hunks.txt': fixture.beforeContent
    });
    const session = createHarnessWorktreeSession({ sourceWorkspaceRoot });
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createWorktreeArtifactEvent(fixture.artifact)
    ]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new HarnessWorktreeReviewService(db);

    const decision = await service.rejectHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      hunkIds: [fixture.firstHunkId, fixture.secondHunkId]
    });

    expect(await readTextOrNull(join(sourceWorkspaceRoot, 'src/reject-hunks.txt'))).toBe(fixture.beforeContent);
    expect(decision).toMatchObject({
      action: 'rejected',
      status: 'rejected',
      acceptedHunkIds: [],
      rejectedHunkIds: [fixture.firstHunkId, fixture.secondHunkId],
      changedPaths: ['src/reject-hunks.txt']
    });
    expect(recordedEvents.at(-1)?.payload).toMatchObject({
      worktreeHunkReviewDecision: expect.objectContaining({
        action: 'rejected',
        status: 'rejected'
      })
    });
  });

  it('fails worktree hunk apply with no mutation when source content drifted', async () => {
    const fixture = createTwoHunkModifiedArtifact('src/drift-hunks.txt');
    const sourceWorkspaceRoot = await createWorkspace({
      'src/drift-hunks.txt': 'changed outside review\n'
    });
    const session = createHarnessWorktreeSession({ sourceWorkspaceRoot });
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createWorktreeArtifactEvent(fixture.artifact)
    ]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new HarnessWorktreeReviewService(db);

    await expect(service.applyHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      acceptedHunkIds: [fixture.firstHunkId],
      rejectedHunkIds: [fixture.secondHunkId]
    })).rejects.toThrow(/Workspace drift/u);

    expect(await readTextOrNull(join(sourceWorkspaceRoot, 'src/drift-hunks.txt'))).toBe('changed outside review\n');
    expect(recordedEvents.at(-1)?.payload).toMatchObject({
      worktreeHunkReviewDecision: expect.objectContaining({
        action: 'applied',
        status: 'failed',
        errorReason: expect.stringMatching(/Workspace drift/u)
      })
    });
  });

  it('reverts a partial worktree hunk apply only when source matches synthesized output', async () => {
    const fixture = createTwoHunkModifiedArtifact('src/revert-hunks.txt');
    const sourceWorkspaceRoot = await createWorkspace({
      'src/revert-hunks.txt': fixture.beforeContent
    });
    const session = createHarnessWorktreeSession({ sourceWorkspaceRoot });
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createWorktreeArtifactEvent(fixture.artifact)
    ]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new HarnessWorktreeReviewService(db);

    await service.applyHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      acceptedHunkIds: [fixture.firstHunkId],
      rejectedHunkIds: [fixture.secondHunkId]
    });
    const decision = await service.revertHunks({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(await readTextOrNull(join(sourceWorkspaceRoot, 'src/revert-hunks.txt'))).toBe(fixture.beforeContent);
    expect(decision).toMatchObject({
      action: 'reverted',
      status: 'reverted',
      acceptedHunkIds: [fixture.firstHunkId],
      rejectedHunkIds: [fixture.secondHunkId],
      changedPaths: ['src/revert-hunks.txt']
    });

    thread.rawOutput = thread.rawOutput.filter((event) => !event.payload.worktreeHunkReviewDecision);
    await writeFile(join(sourceWorkspaceRoot, 'src/revert-hunks.txt'), fixture.beforeContent, 'utf8');
    await service.applyHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      acceptedHunkIds: [fixture.firstHunkId],
      rejectedHunkIds: [fixture.secondHunkId]
    });
    await writeFile(join(sourceWorkspaceRoot, 'src/revert-hunks.txt'), 'changed after partial apply\n', 'utf8');

    await expect(service.revertHunks({
      threadId: 'thread-1',
      runId: 'run-1'
    })).rejects.toThrow(/Workspace drift/u);
    expect(recordedEvents.at(-1)?.payload).toMatchObject({
      worktreeHunkReviewDecision: expect.objectContaining({
        action: 'reverted',
        status: 'failed',
        errorReason: expect.stringMatching(/Workspace drift/u)
      })
    });
  });

  it('prevents file-level decisions after a successful worktree hunk decision', async () => {
    const fixture = createTwoHunkModifiedArtifact('src/no-duplicate.txt');
    const sourceWorkspaceRoot = await createWorkspace({
      'src/no-duplicate.txt': fixture.beforeContent
    });
    const session = createHarnessWorktreeSession({ sourceWorkspaceRoot });
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createWorktreeArtifactEvent(fixture.artifact)
    ]);
    const { db } = createReviewDb(thread);
    const service = new HarnessWorktreeReviewService(db);

    await service.rejectHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      hunkIds: [fixture.firstHunkId]
    });

    await expect(service.apply({
      threadId: 'thread-1',
      runId: 'run-1'
    })).rejects.toThrow(/already has a successful worktree hunk review decision/u);
    expect(await readTextOrNull(join(sourceWorkspaceRoot, 'src/no-duplicate.txt'))).toBe(fixture.beforeContent);
  });

  it('prevents duplicate successful decisions for the same worktree run', async () => {
    const sourceWorkspaceRoot = await createWorkspace({
      'src/example.txt': 'before\n'
    });
    const session = createHarnessWorktreeSession({ sourceWorkspaceRoot });
    const artifact = createArtifact([
      {
        path: 'src/example.txt',
        status: 'modified',
        insertions: 1,
        deletions: 1,
        beforeContent: 'before\n',
        afterContent: 'after\n',
        previewLines: [],
        previewTruncated: false
      }
    ]);
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createWorktreeArtifactEvent(artifact),
      createDecisionEvent('applied', 'applied')
    ]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new HarnessWorktreeReviewService(db);

    await expect(service.reject({
      threadId: 'thread-1',
      runId: 'run-1'
    })).rejects.toThrow(/already has a successful worktree review decision/u);

    expect(await readTextOrNull(join(sourceWorkspaceRoot, 'src/example.txt'))).toBe('before\n');
    expect(recordedEvents).toHaveLength(0);
  });

  it('fails clearly when the worktree session event is missing', async () => {
    const thread = createThread([createWorktreeArtifactEvent(createArtifact([]))]);
    const { db } = createReviewDb(thread);
    const service = new HarnessWorktreeReviewService(db);

    await expect(service.apply({
      threadId: 'thread-1',
      runId: 'run-1'
    })).rejects.toThrow(/No git_worktree session found/u);
  });

  it('fails clearly when the worktree diff artifact is missing', async () => {
    const session = createHarnessWorktreeSession();
    const thread = createThread([createWorktreeSessionEvent(session)]);
    const { db } = createReviewDb(thread);
    const service = new HarnessWorktreeReviewService(db);

    await expect(service.apply({
      threadId: 'thread-1',
      runId: 'run-1'
    })).rejects.toThrow(/No worktree_diff artifact found/u);
  });

  it('records a failed apply decision for unsupported artifacts missing required content', async () => {
    const sourceWorkspaceRoot = await createWorkspace({});
    const session = createHarnessWorktreeSession({ sourceWorkspaceRoot });
    const artifact = createArtifact([
      {
        path: 'src/new.txt',
        status: 'added',
        insertions: 1,
        deletions: 0,
        beforeContent: null,
        afterContent: null,
        previewLines: [],
        previewTruncated: false
      }
    ]);
    const thread = createThread([
      createWorktreeSessionEvent(session),
      createWorktreeArtifactEvent(artifact)
    ]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new HarnessWorktreeReviewService(db);

    await expect(service.apply({
      threadId: 'thread-1',
      runId: 'run-1'
    })).rejects.toThrow(/missing afterContent/u);

    expect(await readTextOrNull(join(sourceWorkspaceRoot, 'src/new.txt'))).toBeNull();
    expect(recordedEvents.at(-1)?.payload).toMatchObject({
      worktreeReviewDecision: expect.objectContaining({
        action: 'applied',
        status: 'failed',
        errorReason: expect.stringMatching(/missing afterContent/u)
      })
    });
  });
});
