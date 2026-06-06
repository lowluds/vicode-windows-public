import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureDatabaseSchema } from './database-schema';
import {
  runDatabaseMigrations,
  runPostSeedDatabaseBackfills,
  type DatabaseMigrationDefaults
} from './database-migrations';
import { DEFAULT_PREFERENCES } from './settings-repository';

const cleanupDatabases: Database.Database[] = [];
const NOW_ISO = '2026-06-02T12:00:00.000Z';

afterEach(() => {
  while (cleanupDatabases.length > 0) {
    cleanupDatabases.pop()?.close();
  }
});

function createMemoryDatabase() {
  const db = new Database(':memory:');
  cleanupDatabases.push(db);
  db.pragma('foreign_keys = ON');
  ensureDatabaseSchema(db);
  return db;
}

function migrationDefaults(): DatabaseMigrationDefaults {
  return {
    preferences: DEFAULT_PREFERENCES,
    projectRuntimeCommandPolicy: 'approval_required',
    projectRuntimeNetworkPolicy: 'disabled',
    collabConnectionState: 'unconfigured',
    nowIso: () => NOW_ISO
  };
}

function insertProject(
  db: Database.Database,
  input: {
    id: string;
    name: string;
    folderPath: string | null;
    trusted?: boolean;
  }
) {
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
        @name,
        @folderPath,
        @trusted,
        @defaultProviderId,
        @openaiModel,
        @geminiModel,
        @qwenModel,
        @ollamaModel,
        @kimiModel,
        @runtimeCommandPolicy,
        @runtimeNetworkPolicy,
        @createdAt,
        @updatedAt
      )`
    )
    .run({
      id: input.id,
      name: input.name,
      folderPath: input.folderPath,
      trusted: input.trusted === false ? 0 : 1,
      defaultProviderId: DEFAULT_PREFERENCES.defaultProviderId,
      openaiModel: DEFAULT_PREFERENCES.defaultModelByProvider.openai,
      geminiModel: DEFAULT_PREFERENCES.defaultModelByProvider.gemini,
      qwenModel: DEFAULT_PREFERENCES.defaultModelByProvider.qwen,
      ollamaModel: DEFAULT_PREFERENCES.defaultModelByProvider.ollama,
      kimiModel: DEFAULT_PREFERENCES.defaultModelByProvider.kimi,
      runtimeCommandPolicy: 'approval_required',
      runtimeNetworkPolicy: 'disabled',
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO
    });
}

function insertThread(db: Database.Database, id: string, projectId: string) {
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
        0,
        @createdAt,
        @updatedAt,
        @lastMessageAt,
        ''
      )`
    )
    .run({
      id,
      projectId,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
      lastMessageAt: NOW_ISO
    });
}

function insertSubagent(
  db: Database.Database,
  input: {
    id: string;
    parentThreadId: string;
    name: string;
    createdAt: string;
  }
) {
  db
    .prepare(
      `INSERT INTO subagents (
        id,
        parent_thread_id,
        parent_run_id,
        child_thread_id,
        child_run_id,
        name,
        title,
        prompt,
        provider_id,
        model_id,
        execution_permission,
        delegation_profile,
        status,
        output_summary,
        last_error,
        created_at,
        updated_at,
        started_at,
        completed_at
      ) VALUES (
        @id,
        @parentThreadId,
        NULL,
        NULL,
        NULL,
        @name,
        'Task',
        'Prompt',
        'openai',
        'gpt-4.1',
        'default',
        'implement',
        'running',
        NULL,
        NULL,
        @createdAt,
        @createdAt,
        NULL,
        NULL
      )`
    )
    .run(input);
}

describe('database migrations', () => {
  it('creates default singleton rows and is idempotent', () => {
    const db = createMemoryDatabase();

    runDatabaseMigrations(db, migrationDefaults());
    runDatabaseMigrations(db, migrationDefaults());

    const preferences = db
      .prepare(
        `SELECT
          default_provider_id,
          default_model_openai,
          default_execution_permission,
          follow_up_behavior,
          generated_memory_generation_enabled
         FROM preferences
         WHERE id = 1`
      )
      .get() as Record<string, unknown>;
    const collabSettings = db
      .prepare(
        `SELECT connection_state, updated_at
         FROM collab_settings
         WHERE id = 1`
      )
      .get() as Record<string, unknown>;

    expect(preferences).toMatchObject({
      default_provider_id: DEFAULT_PREFERENCES.defaultProviderId,
      default_model_openai: DEFAULT_PREFERENCES.defaultModelByProvider.openai,
      default_execution_permission:
        DEFAULT_PREFERENCES.defaultExecutionPermission,
      follow_up_behavior: DEFAULT_PREFERENCES.followUpBehavior,
      generated_memory_generation_enabled: 1
    });
    expect(collabSettings).toEqual({
      connection_state: 'unconfigured',
      updated_at: NOW_ISO
    });
    expect(
      (
        db
          .prepare('SELECT COUNT(*) as total FROM preferences')
          .get() as { total: number }
      ).total
    ).toBe(1);
    expect(
      (
        db
          .prepare('SELECT COUNT(*) as total FROM collab_settings')
          .get() as { total: number }
      ).total
    ).toBe(1);
  });

  it('adds Project Knowledge index tables to legacy databases', () => {
    const db = createMemoryDatabase();
    db.exec(`
      DROP TABLE project_knowledge_diagnostics;
      DROP TABLE project_knowledge_sections;
      DROP TABLE project_knowledge_sources;
      DROP TABLE project_knowledge_refreshes;
      DROP TABLE project_knowledge_roots;
    `);

    runDatabaseMigrations(db, migrationDefaults());

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'project_knowledge_%' ORDER BY name"
      )
      .all()
      .map((row) => (row as { name: string }).name);
    const indexRow = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_project_knowledge_sources_root_path'"
      )
      .get();

    expect(tables).toEqual([
      'project_knowledge_diagnostics',
      'project_knowledge_refreshes',
      'project_knowledge_roots',
      'project_knowledge_sections',
      'project_knowledge_sources'
    ]);
    expect(indexRow).toEqual({ name: 'idx_project_knowledge_sources_root_path' });
  });

  it('migrates legacy planner question set call ids to a thread-scoped index', () => {
    const db = createMemoryDatabase();
    db.exec(`
      DROP TABLE planner_question_sets;
      CREATE TABLE planner_question_sets (
        question_set_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        prompt_turn_id TEXT NOT NULL REFERENCES thread_turns(id) ON DELETE CASCADE,
        call_id TEXT NOT NULL UNIQUE,
        questions_json TEXT NOT NULL,
        answers_json TEXT,
        created_at TEXT NOT NULL
      );
    `);

    runDatabaseMigrations(db, migrationDefaults());

    const tableSql = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'planner_question_sets'"
      )
      .get() as { sql: string };
    const indexRow = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_planner_question_sets_thread_call'"
      )
      .get();

    expect(tableSql.sql).not.toMatch(/call_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i);
    expect(indexRow).toEqual({ name: 'idx_planner_question_sets_thread_call' });
  });

  it('backfills placeholder subagent names without overwriting explicit names', () => {
    const db = createMemoryDatabase();
    insertProject(db, {
      id: 'project-1',
      name: 'Project',
      folderPath: 'C:\\workspace'
    });
    insertThread(db, 'thread-1', 'project-1');
    insertSubagent(db, {
      id: 'subagent-1',
      parentThreadId: 'thread-1',
      name: 'Agent',
      createdAt: '2026-06-02T12:00:01.000Z'
    });
    insertSubagent(db, {
      id: 'subagent-2',
      parentThreadId: 'thread-1',
      name: 'Agent',
      createdAt: '2026-06-02T12:00:02.000Z'
    });
    insertSubagent(db, {
      id: 'subagent-3',
      parentThreadId: 'thread-1',
      name: 'Research',
      createdAt: '2026-06-02T12:00:03.000Z'
    });

    runDatabaseMigrations(db, migrationDefaults());

    const names = db
      .prepare('SELECT name FROM subagents ORDER BY created_at ASC')
      .all()
      .map((row) => (row as { name: string }).name);
    expect(names).toHaveLength(3);
    expect(names[0]).not.toBe('Agent');
    expect(names[1]).not.toBe('Agent');
    expect(names[2]).toBe('Research');
    expect(new Set(names).size).toBe(3);
  });

  it('runs post-seed backfills while preserving non-empty placeholder projects', () => {
    const db = createMemoryDatabase();
    insertProject(db, {
      id: 'empty-placeholder',
      name: 'My Project',
      folderPath: null,
      trusted: false
    });
    insertProject(db, {
      id: 'active-placeholder',
      name: 'My Project',
      folderPath: null,
      trusted: false
    });
    insertThread(db, 'thread-1', 'active-placeholder');
    let legacyRemovalCallbacks = 0;

    runPostSeedDatabaseBackfills(db, {
      onLegacyWelcomeProjectsRemoved: () => {
        legacyRemovalCallbacks += 1;
      }
    });
    runPostSeedDatabaseBackfills(db, {
      onLegacyWelcomeProjectsRemoved: () => {
        legacyRemovalCallbacks += 1;
      }
    });

    expect(
      db.prepare("SELECT id FROM projects WHERE id = 'empty-placeholder'").get()
    ).toBeUndefined();
    expect(
      db
        .prepare(
          "SELECT id, trusted FROM projects WHERE id = 'active-placeholder'"
        )
        .get()
    ).toEqual({ id: 'active-placeholder', trusted: 1 });
    expect(legacyRemovalCallbacks).toBe(1);
  });
});
