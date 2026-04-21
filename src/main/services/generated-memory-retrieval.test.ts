import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../storage/database';
import { GeneratedMemoryRetrievalService } from './generated-memory-retrieval';
import { normalizeGeneratedMemoryWorkspaceScopeKey } from './generated-memory';

describe('GeneratedMemoryRetrievalService', () => {
  const tempDirs: string[] = [];
  const dbs: DatabaseService[] = [];

  afterEach(() => {
    while (dbs.length > 0) {
      dbs.pop()?.close();
    }
    while (tempDirs.length > 0) {
      const current = tempDirs.pop();
      if (current) {
        rmSync(current, { recursive: true, force: true });
      }
    }
  });

  function createDb() {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-generated-memory-retrieval-'));
    tempDirs.push(dir);
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    dbs.push(db);
    return { db, dir };
  }

  function seedItem(
    db: DatabaseService,
    input: {
      workspaceScopeKey: string;
      projectId: string | null;
      kind:
        | 'known_pitfall'
        | 'architecture_fact'
        | 'workflow_preference'
        | 'user_preference_workspace_scoped'
        | 'workspace_convention';
      summary: string;
      detail: string;
      updatedAt: string;
      disabledAt?: string | null;
    }
  ) {
    return db.upsertGeneratedMemoryItem({
      workspaceScopeKey: input.workspaceScopeKey,
      projectId: input.projectId,
      kind: input.kind,
      summary: input.summary,
      detail: input.detail,
      authority: 'derived_noncanonical',
      evidenceCount: 1,
      sourceCandidateIds: [`candidate-${input.kind}-${input.updatedAt}`],
      sourceThreadIds: [`thread-${input.kind}-${input.updatedAt}`],
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt,
      lastUsedAt: null,
      useCount: 0,
      disabledAt: input.disabledAt ?? null
    });
  }

  it('returns only known pitfall items for the exact trusted workspace scope in live recall', () => {
    const { db, dir } = createDb();
    const workspaceA = join(dir, 'workspace-a');
    const workspaceB = join(dir, 'workspace-b');
    const project = db.createProject({
      name: 'Workspace A',
      folderPath: workspaceA,
      trusted: true
    });
    const scopeA = normalizeGeneratedMemoryWorkspaceScopeKey(workspaceA);
    const scopeB = normalizeGeneratedMemoryWorkspaceScopeKey(workspaceB);
    seedItem(db, {
      workspaceScopeKey: scopeA,
      projectId: project.id,
      kind: 'known_pitfall',
      summary: 'Nested smoke path pitfall.',
      detail: 'Avoid the nested smoke path during validation because it checks the wrong surface.',
      updatedAt: '2026-04-20T10:00:00.000Z'
    });
    seedItem(db, {
      workspaceScopeKey: scopeA,
      projectId: project.id,
      kind: 'workflow_preference',
      summary: 'Keep docs source-backed with code pointers.',
      detail: 'Repo docs should stay grounded in live source files and direct code paths.',
      updatedAt: '2026-04-20T11:00:00.000Z'
    });
    seedItem(db, {
      workspaceScopeKey: scopeA,
      projectId: project.id,
      kind: 'architecture_fact',
      summary: 'Vicode uses Electron with SQLite.',
      detail: 'Persistence and privileged logic remain in the main process.',
      updatedAt: '2026-04-20T12:00:00.000Z'
    });
    seedItem(db, {
      workspaceScopeKey: scopeB,
      projectId: null,
      kind: 'known_pitfall',
      summary: 'Foreign workspace memory.',
      detail: 'This should never bleed across scopes.',
      updatedAt: '2026-04-20T13:00:00.000Z'
    });

    const service = new GeneratedMemoryRetrievalService(db);
    const result = service.retrieveRelevantMemory({
      projectId: project.id,
      folderPath: workspaceA,
      trusted: true,
      query: 'What trap should I avoid during smoke validation in this workspace?',
      maxResults: 2
    });

    expect(result).toHaveLength(1);
    expect(result.every((entry) => entry.label === 'Generated Workspace Recall (Derived, Non-Canonical)')).toBe(true);
    expect(result.every((entry) => entry.authority === 'derived_noncanonical')).toBe(true);
    expect(result[0]?.retrievalReason.rank).toBe(1);
    expect(result[0]?.retrievalReason.kindGate.length).toBeGreaterThan(0);
    expect(result.map((entry) => entry.summary)).toEqual(['Nested smoke path pitfall.']);
  });

  it('keeps workflow preferences out of live recall until that class proves value', () => {
    const { db, dir } = createDb();
    const workspace = join(dir, 'workspace');
    const project = db.createProject({
      name: 'Workspace',
      folderPath: workspace,
      trusted: true
    });
    const scope = normalizeGeneratedMemoryWorkspaceScopeKey(workspace);
    seedItem(db, {
      workspaceScopeKey: scope,
      projectId: project.id,
      kind: 'workflow_preference',
      summary: 'Workspace validation command',
      detail: 'Use `npm run smoke` from the workspace root as the default verification command for this workspace.',
      updatedAt: '2026-04-20T10:00:00.000Z'
    });
    seedItem(db, {
      workspaceScopeKey: scope,
      projectId: project.id,
      kind: 'known_pitfall',
      summary: 'Nested smoke path drift',
      detail: 'Avoid the legacy nested smoke path in this workspace because it causes drift.',
      updatedAt: '2026-04-20T11:00:00.000Z'
    });
    seedItem(db, {
      workspaceScopeKey: scope,
      projectId: project.id,
      kind: 'user_preference_workspace_scoped',
      summary: 'Workspace user preference',
      detail: 'Keep celebratory status blurbs upbeat when summarizing progress.',
      updatedAt: '2026-04-20T12:00:00.000Z'
    });
    seedItem(db, {
      workspaceScopeKey: scope,
      projectId: project.id,
      kind: 'workspace_convention',
      summary: 'Workspace docs convention',
      detail: 'Keep docs source-backed with code pointers placed in repo docs.',
      updatedAt: '2026-04-20T13:00:00.000Z'
    });

    const service = new GeneratedMemoryRetrievalService(db);
    const result = service.retrieveRelevantMemory({
      projectId: project.id,
      folderPath: workspace,
      trusted: true,
      query: 'Validate this workspace after the change and choose the first command.'
    });

    expect(result).toEqual([]);
  });

  it('keeps workspace-scoped answer-shape preferences generated-only in the live lane', () => {
    const { db, dir } = createDb();
    const workspace = join(dir, 'workspace');
    const project = db.createProject({
      name: 'Workspace',
      folderPath: workspace,
      trusted: true
    });
    const scope = normalizeGeneratedMemoryWorkspaceScopeKey(workspace);
    seedItem(db, {
      workspaceScopeKey: scope,
      projectId: project.id,
      kind: 'user_preference_workspace_scoped',
      summary: 'Workspace note style preference',
      detail: 'User in this workspace prefers source-backed docs with code pointers placed in repo docs.',
      updatedAt: '2026-04-20T10:00:00.000Z'
    });
    seedItem(db, {
      workspaceScopeKey: scope,
      projectId: project.id,
      kind: 'known_pitfall',
      summary: 'Nested smoke path drift',
      detail: 'Avoid the legacy nested smoke path in this workspace because it causes drift.',
      updatedAt: '2026-04-20T11:00:00.000Z'
    });

    const service = new GeneratedMemoryRetrievalService(db);
    const result = service.retrieveRelevantMemory({
      projectId: project.id,
      folderPath: workspace,
      trusted: true,
      query: 'Write the integration note for this memory slice with direct code pointers in repo docs.'
    });

    expect(result).toEqual([]);
  });

  it('keeps architecture facts generated-only in the live recall lane', () => {
    const { db, dir } = createDb();
    const workspace = join(dir, 'workspace');
    const project = db.createProject({
      name: 'Workspace',
      folderPath: workspace,
      trusted: true
    });
    const scope = normalizeGeneratedMemoryWorkspaceScopeKey(workspace);
    seedItem(db, {
      workspaceScopeKey: scope,
      projectId: project.id,
      kind: 'architecture_fact',
      summary: 'Prompt formatting ownership',
      detail: 'Prompt formatting changes belong in `src/main/services/provider-manager-prompt-builder.ts`, not the provider-manager orchestrator.',
      updatedAt: '2026-04-20T10:00:00.000Z'
    });
    seedItem(db, {
      workspaceScopeKey: scope,
      projectId: project.id,
      kind: 'user_preference_workspace_scoped',
      summary: 'Marketing tone preference',
      detail: 'Keep celebratory progress notes upbeat in this workspace.',
      updatedAt: '2026-04-20T11:00:00.000Z'
    });

    const service = new GeneratedMemoryRetrievalService(db);
    const result = service.retrieveRelevantMemory({
      projectId: project.id,
      folderPath: workspace,
      trusted: true,
      query: 'Which file owns prompt assembly for the provider run?'
    });

    expect(result).toEqual([]);
  });

  it('excludes disabled items', () => {
    const { db, dir } = createDb();
    const workspace = join(dir, 'workspace');
    const project = db.createProject({
      name: 'Workspace',
      folderPath: workspace,
      trusted: true
    });
    const scope = normalizeGeneratedMemoryWorkspaceScopeKey(workspace);
    const disabled = seedItem(db, {
      workspaceScopeKey: scope,
      projectId: project.id,
      kind: 'known_pitfall',
      summary: 'Old smoke path.',
      detail: 'This recall item was disabled.',
      updatedAt: '2026-04-20T10:00:00.000Z'
    });
    db.disableGeneratedMemoryItem(disabled.id, '2026-04-20T11:00:00.000Z');
    seedItem(db, {
      workspaceScopeKey: scope,
      projectId: project.id,
      kind: 'known_pitfall',
      summary: 'Active smoke pitfall.',
      detail: 'Avoid running smoke from nested folders in this workspace.',
      updatedAt: '2026-04-20T12:00:00.000Z'
    });

    const service = new GeneratedMemoryRetrievalService(db);
    const result = service.retrieveRelevantMemory({
      projectId: project.id,
      folderPath: workspace,
      trusted: true,
      query: 'Which smoke pitfall is still active in this workspace?'
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.summary).toBe('Active smoke pitfall.');
  });

  it('returns nothing for untrusted workspaces or empty queries', () => {
    const { db, dir } = createDb();
    const workspace = join(dir, 'workspace');
    const project = db.createProject({
      name: 'Workspace',
      folderPath: workspace,
      trusted: true
    });
    const scope = normalizeGeneratedMemoryWorkspaceScopeKey(workspace);
    seedItem(db, {
      workspaceScopeKey: scope,
      projectId: project.id,
      kind: 'architecture_fact',
      summary: 'Vicode uses Electron with SQLite.',
      detail: 'Main-process persistence stays local-first.',
      updatedAt: '2026-04-20T10:00:00.000Z'
    });

    const service = new GeneratedMemoryRetrievalService(db);

    expect(
      service.retrieveRelevantMemory({
        projectId: project.id,
        folderPath: workspace,
        trusted: false,
        query: 'Electron'
      })
    ).toEqual([]);
    expect(
      service.retrieveRelevantMemory({
        projectId: project.id,
        folderPath: workspace,
        trusted: true,
        query: '  '
      })
    ).toEqual([]);
  });
});
