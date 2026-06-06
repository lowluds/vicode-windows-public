import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseService } from './database';

const cleanupPaths: string[] = [];
const cleanupDatabases: DatabaseService[] = [];

afterEach(async () => {
  while (cleanupDatabases.length > 0) {
    cleanupDatabases.pop()?.close();
  }

  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

async function createTestDatabase() {
  const dir = await mkdtemp(join(tmpdir(), 'vicode-thread-compactions-'));
  cleanupPaths.push(dir);
  const db = new DatabaseService(join(dir, 'vicode.sqlite'));
  db.migrate();
  cleanupDatabases.push(db);
  return db;
}

describe('thread compaction storage', () => {
  it('stores derived compaction overlays per thread and returns the latest first', async () => {
    const db = await createTestDatabase();
    const project = db.createProject({
      name: 'Project',
      folderPath: 'C:\\workspace',
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      providerId: 'ollama',
      modelId: 'qwen3-coder'
    });
    const otherThread = db.createThread({
      projectId: project.id,
      providerId: 'ollama',
      modelId: 'qwen3-coder'
    });

    const older = db.createThreadCompaction({
      threadId: thread.id,
      sourceStartEventId: 'event-1',
      sourceEndEventId: 'event-4',
      summary: 'Earlier thread state.',
      inputTokenEstimate: 10_000,
      outputTokenEstimate: 800,
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      createdAt: '2026-06-01T10:00:00.000Z'
    });
    const newer = db.createThreadCompaction({
      threadId: thread.id,
      sourceStartEventId: 'event-5',
      sourceEndEventId: 'event-9',
      summary: 'Newer thread state.',
      inputTokenEstimate: null,
      outputTokenEstimate: null,
      providerId: null,
      modelId: null,
      createdAt: '2026-06-01T11:00:00.000Z'
    });
    db.createThreadCompaction({
      threadId: otherThread.id,
      sourceStartEventId: 'other-event-1',
      sourceEndEventId: 'other-event-2',
      summary: 'Other thread state.',
      inputTokenEstimate: 500,
      outputTokenEstimate: 25,
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      createdAt: '2026-06-01T12:00:00.000Z'
    });

    expect(db.listThreadCompactions(thread.id)).toEqual([newer, older]);
    expect(db.getLatestThreadCompaction(thread.id)).toEqual(newer);
  });

  it('removes derived compaction overlays when the owning thread is deleted', async () => {
    const db = await createTestDatabase();
    const project = db.createProject({
      name: 'Project',
      folderPath: 'C:\\workspace',
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      providerId: 'ollama',
      modelId: 'qwen3-coder'
    });
    db.createThreadCompaction({
      threadId: thread.id,
      sourceStartEventId: 'event-1',
      sourceEndEventId: 'event-4',
      summary: 'Thread state.',
      inputTokenEstimate: 10_000,
      outputTokenEstimate: 800,
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      createdAt: '2026-06-01T10:00:00.000Z'
    });

    db.deleteThread(thread.id);

    expect(db.listThreadCompactions(thread.id)).toEqual([]);
    expect(db.getLatestThreadCompaction(thread.id)).toBeNull();
  });
});
