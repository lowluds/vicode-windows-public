import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runDatabaseMigrations } from './database-migrations';
import { ensureDatabaseSchema } from './database-schema';
import {
  compactOldTerminalRunEvents,
  getStorageDiagnostics,
  maintainStorage
} from './storage-maintenance';
import { DEFAULT_PREFERENCES } from './settings-repository';

const cleanupPaths: string[] = [];
const cleanupDatabases: Database.Database[] = [];
const NOW_ISO = '2026-06-02T12:00:00.000Z';
const OLD_ISO = '2026-01-01T00:00:00.000Z';

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

async function createFileDatabase() {
  const dir = await mkdtemp(join(tmpdir(), 'vicode-storage-maintenance-'));
  cleanupPaths.push(dir);
  const databasePath = join(dir, 'vicode.sqlite');
  const db = new Database(databasePath);
  cleanupDatabases.push(db);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureDatabaseSchema(db);
  runDatabaseMigrations(db, {
    preferences: DEFAULT_PREFERENCES,
    projectRuntimeCommandPolicy: 'approval_required',
    projectRuntimeNetworkPolicy: 'disabled',
    collabConnectionState: 'unconfigured',
    nowIso: () => NOW_ISO
  });
  return { db, databasePath };
}

function insertProject(db: Database.Database, id = 'project-1') {
  db
    .prepare(
      `INSERT INTO projects (
        id,
        name,
        folder_path,
        trusted,
        default_provider_id,
        default_model_openai,
        default_model_gemini,
        default_model_qwen,
        default_model_ollama,
        default_model_kimi,
        runtime_command_policy,
        runtime_network_policy,
        created_at,
        updated_at
      ) VALUES (
        @id,
        'Project',
        'C:\\workspace',
        1,
        @defaultProviderId,
        @openaiModel,
        @geminiModel,
        @qwenModel,
        @ollamaModel,
        @kimiModel,
        'approval_required',
        'disabled',
        @createdAt,
        @updatedAt
      )`
    )
    .run({
      id,
      defaultProviderId: DEFAULT_PREFERENCES.defaultProviderId,
      openaiModel: DEFAULT_PREFERENCES.defaultModelByProvider.openai,
      geminiModel: DEFAULT_PREFERENCES.defaultModelByProvider.gemini,
      qwenModel: DEFAULT_PREFERENCES.defaultModelByProvider.qwen,
      ollamaModel: DEFAULT_PREFERENCES.defaultModelByProvider.ollama,
      kimiModel: DEFAULT_PREFERENCES.defaultModelByProvider.kimi,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO
    });
}

function insertThread(
  db: Database.Database,
  input: { id: string; projectId?: string; archived?: boolean }
) {
  db
    .prepare(
      `INSERT INTO threads (
        id,
        project_id,
        title,
        provider_id,
        model_id,
        status,
        archived,
        created_at,
        updated_at,
        last_message_at,
        last_preview
      ) VALUES (
        @id,
        @projectId,
        'Thread',
        'openai',
        'gpt-4.1',
        'idle',
        @archived,
        @createdAt,
        @updatedAt,
        @lastMessageAt,
        ''
      )`
    )
    .run({
      id: input.id,
      projectId: input.projectId ?? 'project-1',
      archived: input.archived ? 1 : 0,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
      lastMessageAt: NOW_ISO
    });
}

function insertTurn(db: Database.Database, id: string, threadId: string) {
  db
    .prepare(
      `INSERT INTO thread_turns (
        id,
        thread_id,
        run_id,
        role,
        content,
        metadata_json,
        created_at
      ) VALUES (
        @id,
        @threadId,
        NULL,
        'user',
        'hello',
        NULL,
        @createdAt
      )`
    )
    .run({ id, threadId, createdAt: NOW_ISO });
}

function insertRunEvent(
  db: Database.Database,
  input: {
    id: string;
    threadId: string;
    runId: string;
    eventType: string;
    createdAt: string;
  }
) {
  db
    .prepare(
      `INSERT INTO run_events (
        id,
        thread_id,
        run_id,
        event_type,
        payload_json,
        created_at
      ) VALUES (
        @id,
        @threadId,
        @runId,
        @eventType,
        '{}',
        @createdAt
      )`
    )
    .run(input);
}

function insertOldArchivedTerminalRun(db: Database.Database) {
  insertProject(db);
  insertThread(db, { id: 'thread-1', archived: true });
  insertTurn(db, 'turn-1', 'thread-1');
  insertRunEvent(db, {
    id: 'event-started',
    threadId: 'thread-1',
    runId: 'run-1',
    eventType: 'started',
    createdAt: OLD_ISO
  });
  insertRunEvent(db, {
    id: 'event-delta-1',
    threadId: 'thread-1',
    runId: 'run-1',
    eventType: 'delta',
    createdAt: OLD_ISO
  });
  insertRunEvent(db, {
    id: 'event-delta-2',
    threadId: 'thread-1',
    runId: 'run-1',
    eventType: 'delta',
    createdAt: OLD_ISO
  });
  insertRunEvent(db, {
    id: 'event-completed',
    threadId: 'thread-1',
    runId: 'run-1',
    eventType: 'completed',
    createdAt: OLD_ISO
  });
}

describe('storage maintenance', () => {
  it('reports storage counts, file sizes, and compactable run totals', async () => {
    const { db, databasePath } = await createFileDatabase();
    insertOldArchivedTerminalRun(db);
    insertThread(db, { id: 'thread-2', archived: false });

    const diagnostics = getStorageDiagnostics(db, databasePath);

    expect(diagnostics.databasePath).toBe(databasePath);
    expect(diagnostics.projectCount).toBe(1);
    expect(diagnostics.threadCount).toBe(2);
    expect(diagnostics.archivedThreadCount).toBe(1);
    expect(diagnostics.activeThreadCount).toBe(1);
    expect(diagnostics.turnCount).toBe(1);
    expect(diagnostics.runEventCount).toBe(4);
    expect(diagnostics.compactableRunCount).toBe(1);
    expect(diagnostics.compactableDeltaEventCount).toBe(2);
    expect(diagnostics.databaseSizeBytes).toBeGreaterThan(0);
    expect(diagnostics.totalStorageBytes).toBeGreaterThan(0);
    expect(diagnostics.compactionCutoffDays).toBe(30);
  });

  it('compacts only delta events for old archived terminal runs', async () => {
    const { db } = await createFileDatabase();
    insertOldArchivedTerminalRun(db);

    const result = compactOldTerminalRunEvents(db);

    expect(result.runsCompacted).toBe(1);
    expect(result.deltaEventsDeleted).toBe(2);
    expect(
      db
        .prepare('SELECT event_type FROM run_events ORDER BY created_at, id')
        .all()
        .map((row) => (row as { event_type: string }).event_type)
    ).toEqual(['completed', 'started']);
  });

  it('runs checkpoint and optional vacuum after compaction', async () => {
    const { db, databasePath } = await createFileDatabase();
    insertOldArchivedTerminalRun(db);

    const result = maintainStorage(db, databasePath, { vacuum: true });

    expect(result.runsCompacted).toBe(1);
    expect(result.deltaEventsDeleted).toBe(2);
    expect(result.vacuumApplied).toBe(true);
    expect(result.sizeBeforeBytes).toBeGreaterThan(0);
    expect(result.sizeAfterBytes).toBeGreaterThan(0);
    expect(result.reclaimedBytes).toBeGreaterThanOrEqual(0);
    expect(getStorageDiagnostics(db, databasePath).compactableRunCount).toBe(0);
  });
});
