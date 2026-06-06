import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StagedWorkspaceChangeSet, StagedWorkspaceOperation } from '../../providers/agent-runtime';
import type { RunEvent, ThreadDetail } from '../../shared/domain';
import { parseRunChangeHunks } from '../../shared/hunk-review';
import { StagedWorkspaceReviewService } from './staged-workspace-review';

const createdDirs: string[] = [];

async function createWorkspace(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'vicode-staged-review-'));
  createdDirs.push(dir);

  for (const [fileName, content] of Object.entries(files)) {
    const filePath = join(dir, fileName);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
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

function createChangeSet(operations: StagedWorkspaceOperation[]): StagedWorkspaceChangeSet {
  return {
    threadId: 'thread-1',
    runId: 'run-1',
    sourceToolName: operations.length === 1 && operations[0]?.operation === 'write_file' ? 'write_file' : 'apply_patch',
    isolationMode: 'patch_buffer',
    status: 'proposed',
    requestedPath: null,
    changedPaths: operations.map((operation) => operation.path),
    operations,
    summary: {
      filesChanged: operations.filter((operation) => operation.operation !== 'mkdir').length,
      insertions: 0,
      deletions: 0
    }
  };
}

function createStagedEvent(id: string, changeSet: StagedWorkspaceChangeSet, runId = 'run-1'): RunEvent {
  return {
    id,
    threadId: 'thread-1',
    runId,
    eventType: 'info',
    payload: {
      eventKind: 'debug_detail',
      transcriptVisible: false,
      stagedWorkspaceChangeSet: changeSet
    },
    createdAt: '2026-05-27T00:00:00.000Z'
  };
}

function createDecisionEvent(
  stagedEventId: string,
  action: 'applied' | 'rejected',
  status: 'applied' | 'rejected' | 'failed'
): RunEvent {
  return {
    id: `decision-${action}-${status}`,
    threadId: 'thread-1',
    runId: 'run-1',
    eventType: 'info',
    payload: {
      eventKind: 'debug_detail',
      transcriptVisible: false,
      stagedWorkspaceReviewDecision: {
        action,
        status,
        threadId: 'thread-1',
        runId: 'run-1',
        stagedEventId,
        stagedEventIndex: 0,
        sourceToolName: 'write_file',
        isolationMode: 'patch_buffer',
        changedPaths: ['src/example.txt'],
        operationKinds: ['write_file'],
        errorReason: status === 'failed' ? 'Prior review action failed.' : null,
        createdAt: '2026-05-27T00:00:02.000Z'
      }
    },
    createdAt: '2026-05-27T00:00:02.000Z'
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
        createdAt: '2026-05-27T00:00:01.000Z'
      };
      recordedEvents.push(event);
      thread.rawOutput.push(event);
      return event;
    })
  };

  return { db, recordedEvents };
}

function hunkIdsForPreview(service: StagedWorkspaceReviewService, stagedEventId: string) {
  const artifact = service.preview({
    threadId: 'thread-1',
    runId: 'run-1',
    stagedEventId
  });
  const parsed = parseRunChangeHunks(artifact);
  return parsed.hunks.map((hunk) => hunk.id);
}

describe('StagedWorkspaceReviewService', () => {
  afterEach(async () => {
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('applies a persisted staged change set after validating current file content and records sanitized decision evidence', async () => {
    const workspaceRoot = await createWorkspace({
      'src/existing.txt': 'before-secret-token\n',
      'src/remove.txt': 'remove-secret-token\n'
    });
    const changeSet = createChangeSet([
      {
        operation: 'mkdir',
        path: 'src/generated',
        beforeContent: null,
        proposedAfterContent: null,
        patchText: null
      },
      {
        operation: 'write_file',
        path: 'src/new.txt',
        beforeContent: null,
        proposedAfterContent: 'new-secret-token\n',
        patchText: null
      },
      {
        operation: 'apply_patch',
        path: 'src/existing.txt',
        beforeContent: 'before-secret-token\n',
        proposedAfterContent: 'after-secret-token\n',
        patchText: 'patch-secret-token'
      },
      {
        operation: 'delete',
        path: 'src/remove.txt',
        beforeContent: 'remove-secret-token\n',
        proposedAfterContent: null,
        patchText: 'delete-patch-secret'
      }
    ]);
    const thread = createThread([createStagedEvent('event-staged', changeSet)]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new StagedWorkspaceReviewService(db);

    const decision = await service.apply({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      workspaceRoot
    });

    await expect(stat(join(workspaceRoot, 'src/generated'))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    expect(await readTextOrNull(join(workspaceRoot, 'src/new.txt'))).toBe('new-secret-token\n');
    expect(await readTextOrNull(join(workspaceRoot, 'src/existing.txt'))).toBe('after-secret-token\n');
    expect(await readTextOrNull(join(workspaceRoot, 'src/remove.txt'))).toBeNull();
    expect(decision).toMatchObject({
      action: 'applied',
      status: 'applied',
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      stagedEventIndex: 0,
      changedPaths: ['src/generated', 'src/new.txt', 'src/existing.txt', 'src/remove.txt'],
      operationKinds: ['mkdir', 'write_file', 'apply_patch', 'delete'],
      errorReason: null
    });

    const payload = recordedEvents.at(-1)?.payload;
    expect(payload).toMatchObject({
      eventKind: 'debug_detail',
      transcriptVisible: false,
      stagedWorkspaceReviewDecision: expect.objectContaining({
        action: 'applied',
        status: 'applied',
        changedPaths: ['src/generated', 'src/new.txt', 'src/existing.txt', 'src/remove.txt'],
        operationKinds: ['mkdir', 'write_file', 'apply_patch', 'delete']
      })
    });
    const decisionJson = JSON.stringify(payload);
    expect(decisionJson).not.toContain('before-secret-token');
    expect(decisionJson).not.toContain('after-secret-token');
    expect(decisionJson).not.toContain('new-secret-token');
    expect(decisionJson).not.toContain('patch-secret-token');
  });

  it('rejects a staged change set by deterministic staged event index without mutating the workspace', async () => {
    const workspaceRoot = await createWorkspace({
      'src/keep.txt': 'keep me\n'
    });
    const firstChangeSet = createChangeSet([
      {
        operation: 'write_file',
        path: 'src/other.txt',
        beforeContent: null,
        proposedAfterContent: 'other\n',
        patchText: null
      }
    ]);
    const secondChangeSet = createChangeSet([
      {
        operation: 'write_file',
        path: 'src/keep.txt',
        beforeContent: 'keep me\n',
        proposedAfterContent: 'changed\n',
        patchText: null
      }
    ]);
    const thread = createThread([
      createStagedEvent('event-first', firstChangeSet),
      createStagedEvent('event-second', secondChangeSet)
    ]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new StagedWorkspaceReviewService(db);

    const decision = await service.reject({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventIndex: 1
    });

    expect(await readTextOrNull(join(workspaceRoot, 'src/keep.txt'))).toBe('keep me\n');
    expect(await readTextOrNull(join(workspaceRoot, 'src/other.txt'))).toBeNull();
    expect(decision).toMatchObject({
      action: 'rejected',
      status: 'rejected',
      stagedEventId: 'event-second',
      stagedEventIndex: 1,
      changedPaths: ['src/keep.txt'],
      operationKinds: ['write_file']
    });
    expect(recordedEvents.at(-1)?.payload).toMatchObject({
      stagedWorkspaceReviewDecision: expect.objectContaining({
        action: 'rejected',
        status: 'rejected',
        stagedEventId: 'event-second',
        stagedEventIndex: 1
      })
    });
  });

  it('fails apply with a drift decision and no mutation when current content no longer matches beforeContent', async () => {
    const workspaceRoot = await createWorkspace({
      'src/existing.txt': 'changed outside staging\n'
    });
    const changeSet = createChangeSet([
      {
        operation: 'write_file',
        path: 'src/existing.txt',
        beforeContent: 'expected before\n',
        proposedAfterContent: 'new content\n',
        patchText: null
      },
      {
        operation: 'write_file',
        path: 'src/new.txt',
        beforeContent: null,
        proposedAfterContent: 'should not be written\n',
        patchText: null
      }
    ]);
    const thread = createThread([createStagedEvent('event-staged', changeSet)]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new StagedWorkspaceReviewService(db);

    await expect(service.apply({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      workspaceRoot
    })).rejects.toThrow(/Workspace drift/u);

    expect(await readTextOrNull(join(workspaceRoot, 'src/existing.txt'))).toBe('changed outside staging\n');
    expect(await readTextOrNull(join(workspaceRoot, 'src/new.txt'))).toBeNull();
    expect(recordedEvents.at(-1)?.payload).toMatchObject({
      stagedWorkspaceReviewDecision: expect.objectContaining({
        action: 'applied',
        status: 'failed',
        changedPaths: ['src/existing.txt', 'src/new.txt'],
        operationKinds: ['write_file'],
        errorReason: expect.stringMatching(/Workspace drift/u)
      })
    });
  });

  it('reverts an applied staged change set using beforeContent and records sanitized decision evidence', async () => {
    const workspaceRoot = await createWorkspace({
      'src/new.txt': 'new-secret-token\n',
      'src/existing.txt': 'after-secret-token\n'
    });
    const changeSet = createChangeSet([
      {
        operation: 'write_file',
        path: 'src/new.txt',
        beforeContent: null,
        proposedAfterContent: 'new-secret-token\n',
        patchText: null
      },
      {
        operation: 'apply_patch',
        path: 'src/existing.txt',
        beforeContent: 'before-secret-token\n',
        proposedAfterContent: 'after-secret-token\n',
        patchText: 'patch-secret-token'
      },
      {
        operation: 'delete',
        path: 'src/remove.txt',
        beforeContent: 'remove-secret-token\n',
        proposedAfterContent: null,
        patchText: 'delete-patch-secret'
      }
    ]);
    const thread = createThread([
      createStagedEvent('event-staged', changeSet),
      createDecisionEvent('event-staged', 'applied', 'applied')
    ]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new StagedWorkspaceReviewService(db);

    const decision = await service.revert({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      workspaceRoot
    });

    expect(await readTextOrNull(join(workspaceRoot, 'src/new.txt'))).toBeNull();
    expect(await readTextOrNull(join(workspaceRoot, 'src/existing.txt'))).toBe('before-secret-token\n');
    expect(await readTextOrNull(join(workspaceRoot, 'src/remove.txt'))).toBe('remove-secret-token\n');
    expect(decision).toMatchObject({
      action: 'reverted',
      status: 'reverted',
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      stagedEventIndex: 0,
      changedPaths: ['src/new.txt', 'src/existing.txt', 'src/remove.txt'],
      operationKinds: ['write_file', 'apply_patch', 'delete'],
      errorReason: null
    });

    const payload = recordedEvents.at(-1)?.payload;
    expect(payload).toMatchObject({
      stagedWorkspaceReviewDecision: expect.objectContaining({
        action: 'reverted',
        status: 'reverted',
        changedPaths: ['src/new.txt', 'src/existing.txt', 'src/remove.txt'],
        operationKinds: ['write_file', 'apply_patch', 'delete']
      })
    });
    const decisionJson = JSON.stringify(payload);
    expect(decisionJson).not.toContain('before-secret-token');
    expect(decisionJson).not.toContain('after-secret-token');
    expect(decisionJson).not.toContain('new-secret-token');
    expect(decisionJson).not.toContain('patch-secret-token');
  });

  it('fails revert with a drift decision when current content no longer matches proposedAfterContent', async () => {
    const workspaceRoot = await createWorkspace({
      'src/example.txt': 'changed after apply\n'
    });
    const changeSet = createChangeSet([
      {
        operation: 'write_file',
        path: 'src/example.txt',
        beforeContent: 'before\n',
        proposedAfterContent: 'applied\n',
        patchText: null
      }
    ]);
    const thread = createThread([
      createStagedEvent('event-staged', changeSet),
      createDecisionEvent('event-staged', 'applied', 'applied')
    ]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new StagedWorkspaceReviewService(db);

    await expect(service.revert({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      workspaceRoot
    })).rejects.toThrow(/Workspace drift/u);

    expect(await readTextOrNull(join(workspaceRoot, 'src/example.txt'))).toBe('changed after apply\n');
    expect(recordedEvents.at(-1)?.payload).toMatchObject({
      stagedWorkspaceReviewDecision: expect.objectContaining({
        action: 'reverted',
        status: 'failed',
        errorReason: expect.stringMatching(/Workspace drift/u)
      })
    });
  });

  it('allows revert only when the latest staged review decision is applied', async () => {
    const workspaceRoot = await createWorkspace({
      'src/example.txt': 'applied\n'
    });
    const changeSet = createChangeSet([
      {
        operation: 'write_file',
        path: 'src/example.txt',
        beforeContent: 'before\n',
        proposedAfterContent: 'applied\n',
        patchText: null
      }
    ]);

    for (const eventSet of [
      [createStagedEvent('pending-staged', changeSet)],
      [createStagedEvent('rejected-staged', changeSet), createDecisionEvent('rejected-staged', 'rejected', 'rejected')],
      [createStagedEvent('failed-staged', changeSet), createDecisionEvent('failed-staged', 'applied', 'failed')]
    ]) {
      const thread = createThread(eventSet);
      const { db, recordedEvents } = createReviewDb(thread);
      const service = new StagedWorkspaceReviewService(db);

      await expect(service.revert({
        threadId: 'thread-1',
        runId: 'run-1',
        stagedEventIndex: 0,
        workspaceRoot
      })).rejects.toThrow(/Only applied staged workspace changes can be reverted/u);
      expect(recordedEvents).toHaveLength(1);
      expect(recordedEvents.at(-1)?.payload).toMatchObject({
        stagedWorkspaceReviewDecision: expect.objectContaining({
          action: 'reverted',
          status: 'failed',
          errorReason: 'Only applied staged workspace changes can be reverted.'
        })
      });
    }
  });

  it('previews a staged write_file change as a diff artifact without exposing patch text', async () => {
    const changeSet = createChangeSet([
      {
        operation: 'write_file',
        path: 'src/new.txt',
        beforeContent: null,
        proposedAfterContent: 'new-secret-token\n',
        patchText: 'patch-secret-token'
      }
    ]);
    const thread = createThread([createStagedEvent('event-staged', changeSet)]);
    const { db } = createReviewDb(thread);
    const service = new StagedWorkspaceReviewService(db);

    const artifact = service.preview({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });

    expect(artifact).toMatchObject({
      source: 'staged_workspace_preview',
      summary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 0
      },
      files: [
        expect.objectContaining({
          path: 'src/new.txt',
          status: 'added',
          beforeContent: null,
          afterContent: 'new-secret-token\n'
        })
      ]
    });
    expect(JSON.stringify(artifact)).not.toContain('patch-secret-token');
  });

  it('previews staged apply_patch modified and deleted file operations', async () => {
    const changeSet = createChangeSet([
      {
        operation: 'apply_patch',
        path: 'src/existing.txt',
        beforeContent: 'first\nsecond\n',
        proposedAfterContent: 'first\nchanged\n',
        patchText: 'patch-secret-token'
      },
      {
        operation: 'delete',
        path: 'src/remove.txt',
        beforeContent: 'remove me\n',
        proposedAfterContent: null,
        patchText: 'delete-patch-secret'
      }
    ]);
    const thread = createThread([createStagedEvent('event-staged', changeSet)]);
    const { db } = createReviewDb(thread);
    const service = new StagedWorkspaceReviewService(db);

    const artifact = service.preview({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventIndex: 0
    });

    expect(artifact.summary).toEqual({
      filesChanged: 2,
      insertions: 1,
      deletions: 2
    });
    expect(artifact.files).toEqual([
      expect.objectContaining({
        path: 'src/existing.txt',
        status: 'modified',
        beforeContent: 'first\nsecond\n',
        afterContent: 'first\nchanged\n',
        insertions: 1,
        deletions: 1
      }),
      expect.objectContaining({
        path: 'src/remove.txt',
        status: 'deleted',
        beforeContent: 'remove me\n',
        afterContent: null,
        insertions: 0,
        deletions: 1
      })
    ]);
    expect(JSON.stringify(artifact)).not.toContain('patch-secret-token');
    expect(JSON.stringify(artifact)).not.toContain('delete-patch-secret');
  });

  it('fails preview clearly when a staged change set has no file diff artifact', () => {
    const changeSet = createChangeSet([
      {
        operation: 'mkdir',
        path: 'src/generated',
        beforeContent: null,
        proposedAfterContent: null,
        patchText: null
      }
    ]);
    const thread = createThread([createStagedEvent('event-staged', changeSet)]);
    const { db } = createReviewDb(thread);
    const service = new StagedWorkspaceReviewService(db);

    expect(() => service.preview({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    })).toThrow(/No file diff preview is available/u);
  });

  it('applies all selected hunks in a modified file and matches existing file-level output', async () => {
    const beforeContent = ['one', 'two before', 'three'].join('\n') + '\n';
    const afterContent = ['one', 'two after', 'three', 'four added'].join('\n') + '\n';
    const workspaceRoot = await createWorkspace({
      'src/example.txt': beforeContent
    });
    const changeSet = createChangeSet([
      {
        operation: 'apply_patch',
        path: 'src/example.txt',
        beforeContent,
        proposedAfterContent: afterContent,
        patchText: 'patch-secret-token'
      }
    ]);
    const thread = createThread([createStagedEvent('event-staged', changeSet)]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new StagedWorkspaceReviewService(db);
    const hunkIds = hunkIdsForPreview(service, 'event-staged');

    const decision = await service.applyHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      workspaceRoot,
      acceptedHunkIds: hunkIds,
      rejectedHunkIds: []
    });

    expect(await readTextOrNull(join(workspaceRoot, 'src/example.txt'))).toBe(afterContent);
    expect(decision).toMatchObject({
      action: 'applied',
      status: 'applied',
      source: 'staged_workspace_preview',
      isolationMode: 'patch_buffer',
      stagedEventId: 'event-staged',
      acceptedHunkIds: hunkIds,
      rejectedHunkIds: [],
      changedPaths: ['src/example.txt'],
      filesChanged: 1,
      errorReason: null
    });
    const payload = recordedEvents.at(-1)?.payload;
    expect(payload).toMatchObject({
      stagedWorkspaceHunkReviewDecision: expect.objectContaining({
        action: 'applied',
        status: 'applied',
        hunkIds,
        acceptedHunkIds: hunkIds,
        rejectedHunkIds: []
      })
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('two before');
    expect(serialized).not.toContain('two after');
    expect(serialized).not.toContain('patch-secret-token');
  });

  it('applies one selected hunk while leaving rejected hunks unchanged', async () => {
    const beforeContent = [
      'line 1',
      'line 2 before',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      'line 9',
      'line 10 before',
      'line 11'
    ].join('\n') + '\n';
    const afterContent = beforeContent
      .replace('line 2 before', 'line 2 after')
      .replace('line 10 before', 'line 10 after');
    const workspaceRoot = await createWorkspace({
      'src/mixed.txt': beforeContent
    });
    const changeSet = createChangeSet([
      {
        operation: 'apply_patch',
        path: 'src/mixed.txt',
        beforeContent,
        proposedAfterContent: afterContent,
        patchText: null
      }
    ]);
    const thread = createThread([createStagedEvent('event-staged', changeSet)]);
    const { db } = createReviewDb(thread);
    const service = new StagedWorkspaceReviewService(db);
    const [acceptedHunkId, rejectedHunkId] = hunkIdsForPreview(service, 'event-staged');

    await service.applyHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      workspaceRoot,
      acceptedHunkIds: [acceptedHunkId as string],
      rejectedHunkIds: [rejectedHunkId as string]
    });

    expect(await readTextOrNull(join(workspaceRoot, 'src/mixed.txt'))).toBe(
      beforeContent.replace('line 2 before', 'line 2 after')
    );
  });

  it('rejects selected hunks without mutating files', async () => {
    const beforeContent = 'before\n';
    const afterContent = 'after\n';
    const workspaceRoot = await createWorkspace({
      'src/reject.txt': beforeContent
    });
    const changeSet = createChangeSet([
      {
        operation: 'apply_patch',
        path: 'src/reject.txt',
        beforeContent,
        proposedAfterContent: afterContent,
        patchText: null
      }
    ]);
    const thread = createThread([createStagedEvent('event-staged', changeSet)]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new StagedWorkspaceReviewService(db);
    const hunkIds = hunkIdsForPreview(service, 'event-staged');

    const decision = await service.rejectHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      hunkIds
    });

    expect(await readTextOrNull(join(workspaceRoot, 'src/reject.txt'))).toBe(beforeContent);
    expect(decision).toMatchObject({
      action: 'rejected',
      status: 'rejected',
      acceptedHunkIds: [],
      rejectedHunkIds: hunkIds,
      changedPaths: ['src/reject.txt']
    });
    expect(recordedEvents.at(-1)?.payload).toMatchObject({
      stagedWorkspaceHunkReviewDecision: expect.objectContaining({
        action: 'rejected',
        status: 'rejected',
        hunkIds
      })
    });
  });

  it('fails hunk apply with no mutation when current content no longer matches beforeContent', async () => {
    const workspaceRoot = await createWorkspace({
      'src/drift.txt': 'changed outside review\n'
    });
    const changeSet = createChangeSet([
      {
        operation: 'apply_patch',
        path: 'src/drift.txt',
        beforeContent: 'before\n',
        proposedAfterContent: 'after\n',
        patchText: null
      }
    ]);
    const thread = createThread([createStagedEvent('event-staged', changeSet)]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new StagedWorkspaceReviewService(db);
    const hunkIds = hunkIdsForPreview(service, 'event-staged');

    await expect(service.applyHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      workspaceRoot,
      acceptedHunkIds: hunkIds
    })).rejects.toThrow(/Workspace drift/u);

    expect(await readTextOrNull(join(workspaceRoot, 'src/drift.txt'))).toBe('changed outside review\n');
    expect(recordedEvents.at(-1)?.payload).toMatchObject({
      stagedWorkspaceHunkReviewDecision: expect.objectContaining({
        action: 'applied',
        status: 'failed',
        errorReason: expect.stringMatching(/Workspace drift/u)
      })
    });
  });

  it('fails hunk apply closed for truncated previews', async () => {
    const beforeContent = Array.from({ length: 240 }, (_, index) => `before ${index}`).join('\n') + '\n';
    const afterContent = Array.from({ length: 240 }, (_, index) => `after ${index}`).join('\n') + '\n';
    const workspaceRoot = await createWorkspace({
      'src/truncated.txt': beforeContent
    });
    const changeSet = createChangeSet([
      {
        operation: 'apply_patch',
        path: 'src/truncated.txt',
        beforeContent,
        proposedAfterContent: afterContent,
        patchText: null
      }
    ]);
    const thread = createThread([createStagedEvent('event-staged', changeSet)]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new StagedWorkspaceReviewService(db);
    const hunkIds = hunkIdsForPreview(service, 'event-staged');

    await expect(service.applyHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      workspaceRoot,
      acceptedHunkIds: hunkIds
    })).rejects.toThrow(/unsupported for truncated previews/u);

    expect(await readTextOrNull(join(workspaceRoot, 'src/truncated.txt'))).toBe(beforeContent);
    expect(recordedEvents.at(-1)?.payload).toMatchObject({
      stagedWorkspaceHunkReviewDecision: expect.objectContaining({
        action: 'applied',
        status: 'failed',
        errorReason: expect.stringMatching(/truncated previews/u)
      })
    });
  });

  it('reverts a partial hunk apply only when current content matches synthesized output', async () => {
    const beforeContent = [
      'line 1',
      'line 2 before',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      'line 9',
      'line 10 before',
      'line 11'
    ].join('\n') + '\n';
    const afterContent = beforeContent
      .replace('line 2 before', 'line 2 after')
      .replace('line 10 before', 'line 10 after');
    const workspaceRoot = await createWorkspace({
      'src/revert-partial.txt': beforeContent
    });
    const changeSet = createChangeSet([
      {
        operation: 'apply_patch',
        path: 'src/revert-partial.txt',
        beforeContent,
        proposedAfterContent: afterContent,
        patchText: null
      }
    ]);
    const thread = createThread([createStagedEvent('event-staged', changeSet)]);
    const { db, recordedEvents } = createReviewDb(thread);
    const service = new StagedWorkspaceReviewService(db);
    const [acceptedHunkId, rejectedHunkId] = hunkIdsForPreview(service, 'event-staged');

    await service.applyHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      workspaceRoot,
      acceptedHunkIds: [acceptedHunkId as string],
      rejectedHunkIds: [rejectedHunkId as string]
    });
    const decision = await service.revertHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      workspaceRoot
    });

    expect(await readTextOrNull(join(workspaceRoot, 'src/revert-partial.txt'))).toBe(beforeContent);
    expect(decision).toMatchObject({
      action: 'reverted',
      status: 'reverted',
      acceptedHunkIds: [acceptedHunkId],
      rejectedHunkIds: [rejectedHunkId],
      changedPaths: ['src/revert-partial.txt']
    });

    await service.applyHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      workspaceRoot,
      acceptedHunkIds: [acceptedHunkId as string],
      rejectedHunkIds: [rejectedHunkId as string]
    });
    await writeFile(join(workspaceRoot, 'src/revert-partial.txt'), 'changed after partial apply\n', 'utf8');

    await expect(service.revertHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      workspaceRoot
    })).rejects.toThrow(/Workspace drift/u);
    expect(recordedEvents.at(-1)?.payload).toMatchObject({
      stagedWorkspaceHunkReviewDecision: expect.objectContaining({
        action: 'reverted',
        status: 'failed',
        errorReason: expect.stringMatching(/Workspace drift/u)
      })
    });
  });
});
