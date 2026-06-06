import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureDatabaseSchema } from './database-schema';

const cleanupDatabases: Database.Database[] = [];

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

function listTables(db: Database.Database) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
}

function listIndexes(db: Database.Database) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
}

describe('ensureDatabaseSchema', () => {
  it('creates core app storage tables and indexes', () => {
    const db = createMemoryDatabase();

    expect(listTables(db)).toEqual(expect.arrayContaining([
      'projects',
      'threads',
      'thread_turns',
      'run_events',
      'thread_compactions',
      'preferences',
      'provider_accounts',
      'provider_models_cache',
      'custom_providers',
      'collab_rooms',
      'generated_memory_items',
      'mcp_servers',
      'project_knowledge_roots',
      'project_knowledge_sources',
      'project_knowledge_sections',
      'project_knowledge_diagnostics',
      'project_knowledge_refreshes'
    ]));
    expect(listIndexes(db)).toEqual(expect.arrayContaining([
      'idx_thread_compactions_thread_created',
      'idx_generated_memory_items_scope_disabled',
      'idx_mcp_servers_enabled',
      'idx_review_items_status',
      'idx_project_knowledge_sources_root_path',
      'idx_project_knowledge_sections_root_source',
      'idx_project_knowledge_diagnostics_root_severity'
    ]));
  });

  it('is idempotent for already-initialized databases', () => {
    const db = createMemoryDatabase();

    expect(() => ensureDatabaseSchema(db)).not.toThrow();
    expect(listTables(db)).toContain('preferences');
    expect(listIndexes(db)).toContain('idx_thread_compactions_thread_created');
    expect(listTables(db)).toContain('project_knowledge_sources');
  });
});
