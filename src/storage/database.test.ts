import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseService } from './database';

const cleanupPaths: string[] = [];
const cleanupDatabases: DatabaseService[] = [];

afterEach(async () => {
  while (cleanupDatabases.length > 0) {
    const db = cleanupDatabases.pop();
    db?.close();
  }

  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

function rawDatabase(db: DatabaseService) {
  return (db as unknown as {
    db: {
      prepare(sql: string): {
        run(...params: unknown[]): unknown;
      };
    };
  }).db;
}

function createTestDatabase(dir: string) {
  const db = new DatabaseService(join(dir, 'vicode.sqlite'));
  db.migrate();
  cleanupDatabases.push(db);
  return db;
}

function setRunEventsCreatedAt(db: DatabaseService, threadId: string, runId: string, createdAt: string) {
  rawDatabase(db).prepare('UPDATE run_events SET created_at = ? WHERE thread_id = ? AND run_id = ?').run(createdAt, threadId, runId);
}

describe('DatabaseService storage diagnostics', () => {
  it('persists MCP server scope, project ownership, and lifecycle state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-storage-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);
    const project = db.createProject({
      name: 'Scoped MCP Project',
      folderPath: join(dir, 'workspace'),
      trusted: true
    });

    const server = db.saveMcpServer({
      name: 'Scoped MCP',
      scope: 'project',
      projectId: project.id,
      transportType: 'stdio',
      command: 'npx',
      args: ['@example/mcp'],
      cwd: join(dir, 'workspace'),
      env: { FOO: 'bar' },
      enabled: true,
      toolInvocationMode: 'ask',
      launchApproved: false
    });

    db.saveMcpServerState({
      serverId: server.definition.id,
      status: 'approval_required',
      capabilities: null,
      lastSeenAt: null,
      lastError: 'Launch approval required before starting this MCP server.',
      toolCount: 0,
      resourceCount: 0,
      promptCount: 0,
      updatedAt: '2026-04-01T00:00:00.000Z'
    });

    const stored = db.getMcpServer(server.definition.id);
    const listed = db.listMcpServers().find((entry) => entry.definition.id === server.definition.id);

    expect(stored.definition).toMatchObject({
      name: 'Scoped MCP',
      scope: 'project',
      projectId: project.id,
      transportType: 'stdio',
      command: 'npx',
      args: ['@example/mcp'],
      cwd: join(dir, 'workspace'),
      enabled: true,
      toolInvocationMode: 'ask',
      launchApproved: false
    });
    expect(stored.state).toEqual({
      serverId: server.definition.id,
      status: 'approval_required',
      capabilities: null,
      lastSeenAt: null,
      lastError: 'Launch approval required before starting this MCP server.',
      toolCount: 0,
      resourceCount: 0,
      promptCount: 0,
      updatedAt: '2026-04-01T00:00:00.000Z'
    });
    expect(listed?.definition.scope).toBe('project');
    expect(listed?.definition.projectId).toBe(project.id);
  });

  it('persists the workspace runtime command and network policies on projects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-storage-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);

    const created = db.createProject({
      name: 'Policy Test',
      folderPath: join(dir, 'workspace'),
      trusted: true
    });

    expect(created.runtimeCommandPolicy).toBe('approval_required');
    expect(created.runtimeNetworkPolicy).toBe('disabled');

    const updated = db.updateProject({
      id: created.id,
      runtimeCommandPolicy: 'auto_approve',
      runtimeNetworkPolicy: 'enabled'
    });

    expect(updated.runtimeCommandPolicy).toBe('auto_approve');
    expect(updated.runtimeNetworkPolicy).toBe('enabled');
    expect(db.getProject(created.id).runtimeCommandPolicy).toBe('auto_approve');
    expect(db.getProject(created.id).runtimeNetworkPolicy).toBe('enabled');
  });

  it('persists appearance mode in preferences', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-storage-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);

    expect(db.getPreferences().appearanceMode).toBe('system');
    expect(db.getPreferences().accentMode).toBe('system');
    expect(db.getPreferences().accentColor).toBeNull();
    expect(db.getPreferences().generatedMemoryUseEnabled).toBe(false);
    expect(db.getPreferences().generatedMemoryGenerationEnabled).toBe(true);

    db.savePreferences({ appearanceMode: 'light' });
    expect(db.getPreferences().appearanceMode).toBe('light');

    db.savePreferences({ appearanceMode: 'dark' });
    expect(db.getPreferences().appearanceMode).toBe('dark');

    db.savePreferences({ accentMode: 'custom', accentColor: '#2257aa' });
    expect(db.getPreferences().accentMode).toBe('custom');
    expect(db.getPreferences().accentColor).toBe('#2257aa');

    db.savePreferences({
      generatedMemoryUseEnabled: true,
      generatedMemoryGenerationEnabled: false
    });
    expect(db.getPreferences().generatedMemoryUseEnabled).toBe(true);
    expect(db.getPreferences().generatedMemoryGenerationEnabled).toBe(false);
  });

  it('clears stale selected project and last opened thread references from preferences', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-storage-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);
    const project = db.createProject({
      name: 'Preference Cleanup',
      folderPath: join(dir, 'workspace'),
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Cleanup target',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default'
    });

    db.savePreferences({
      selectedProjectId: project.id,
      lastOpenedThreadId: thread.id
    });

    db.deleteThread(thread.id);
    db.deleteProject(project.id);

    const preferences = db.getPreferences();
    expect(preferences.selectedProjectId).toBeNull();
    expect(preferences.lastOpenedThreadId).toBeNull();
  });

  it('reports thread, archive, turn, and run-event counts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-storage-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);

    const project = db.createProject({
      name: 'Storage Test',
      folderPath: join(dir, 'workspace'),
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Thread one',
      providerId: 'gemini',
      modelId: 'gemini-2.5-pro',
      executionPermission: 'default'
    });

    db.appendTurn(thread.id, 'user', 'hello');
    db.appendTurn(thread.id, 'assistant', 'world', null, 'run-1');
    db.addRunEvent(thread.id, 'run-1', 'started', { providerId: 'gemini' });
    db.addRunEvent(thread.id, 'run-1', 'delta', { delta: 'world' });
    db.archiveThread(thread.id);

    const diagnostics = db.getStorageDiagnostics();

    expect(diagnostics.projectCount).toBe(2);
    expect(diagnostics.threadCount).toBe(1);
    expect(diagnostics.archivedThreadCount).toBe(1);
    expect(diagnostics.activeThreadCount).toBe(0);
    expect(diagnostics.turnCount).toBe(2);
    expect(diagnostics.runEventCount).toBe(2);
    expect(diagnostics.compactableRunCount).toBe(0);
    expect(diagnostics.compactableDeltaEventCount).toBe(0);
    expect(diagnostics.databaseSizeBytes).toBeGreaterThan(0);
    expect(diagnostics.totalStorageBytes).toBeGreaterThan(0);
    expect(diagnostics.databasePath.endsWith('vicode.sqlite')).toBe(true);
  });

  it('compacts delta events only for old archived terminal runs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-storage-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);

    const project = db.createProject({
      name: 'Compaction Test',
      folderPath: join(dir, 'workspace'),
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Archived thread',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default'
    });

    db.appendTurn(thread.id, 'user', 'hello');
    db.appendTurn(thread.id, 'assistant', 'done', null, 'run-compact');
    db.addRunEvent(thread.id, 'run-compact', 'started', { providerId: 'openai' });
    db.addRunEvent(thread.id, 'run-compact', 'delta', { delta: 'd' });
    db.addRunEvent(thread.id, 'run-compact', 'delta', { delta: 'o' });
    db.addRunEvent(thread.id, 'run-compact', 'completed', { message: 'done' });
    db.archiveThread(thread.id);

    const oldIso = '2026-01-01T00:00:00.000Z';
    setRunEventsCreatedAt(db, thread.id, 'run-compact', oldIso);

    const before = db.getStorageDiagnostics();
    expect(before.compactableRunCount).toBe(1);
    expect(before.compactableDeltaEventCount).toBe(2);

    const result = db.compactOldTerminalRunEvents();

    expect(result.runsCompacted).toBe(1);
    expect(result.deltaEventsDeleted).toBe(2);

    const events = db.getThread(thread.id).rawOutput;
    expect(events.map((event) => event.eventType)).toEqual(['started', 'completed']);

    const after = db.getStorageDiagnostics();
    expect(after.runEventCount).toBe(2);
    expect(after.compactableRunCount).toBe(0);
    expect(after.compactableDeltaEventCount).toBe(0);
  });

  it('does not compact recent runs, planner-active runs, or runs with pending review work', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-storage-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);

    const project = db.createProject({
      name: 'Compaction Exclusions',
      folderPath: join(dir, 'workspace'),
      trusted: true
    });

    const recentThread = db.createThread({
      projectId: project.id,
      title: 'Recent archived thread',
      providerId: 'gemini',
      modelId: 'gemini-2.5-pro',
      executionPermission: 'default'
    });
    db.addRunEvent(recentThread.id, 'run-recent', 'started', {});
    db.addRunEvent(recentThread.id, 'run-recent', 'delta', { delta: 'a' });
    db.addRunEvent(recentThread.id, 'run-recent', 'completed', { output: 'done' });
    db.archiveThread(recentThread.id);

    const plannerThread = db.createThread({
      projectId: project.id,
      title: 'Planner active thread',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default'
    });
    db.addRunEvent(plannerThread.id, 'run-planner', 'started', {});
    db.addRunEvent(plannerThread.id, 'run-planner', 'delta', { delta: 'b' });
    db.addRunEvent(plannerThread.id, 'run-planner', 'completed', { output: 'done' });
    db.archiveThread(plannerThread.id);
    db.setThreadPlannerTurnState(plannerThread.id, 'waiting_for_answers');
    setRunEventsCreatedAt(db, plannerThread.id, 'run-planner', '2026-01-01T00:00:00.000Z');

    const pendingReviewThread = db.createThread({
      projectId: project.id,
      title: 'Pending review thread',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default'
    });
    db.addRunEvent(pendingReviewThread.id, 'run-review', 'started', {});
    db.addRunEvent(pendingReviewThread.id, 'run-review', 'delta', { delta: 'c' });
    db.addRunEvent(pendingReviewThread.id, 'run-review', 'completed', { output: 'done' });
    db.archiveThread(pendingReviewThread.id);
    setRunEventsCreatedAt(db, pendingReviewThread.id, 'run-review', '2026-01-01T00:00:00.000Z');
    const job = db.saveJob({
      projectId: project.id,
      sourceType: 'manual',
      title: 'Pending review',
      status: 'waiting_for_review',
      threadId: pendingReviewThread.id
    });
    db.addReviewItem({
      jobId: job.id,
      kind: 'manual_review',
      summary: 'Review required',
      details: { path: 'note.md' }
    });

    const before = db.getStorageDiagnostics();
    expect(before.compactableRunCount).toBe(0);
    expect(before.compactableDeltaEventCount).toBe(0);

    const result = db.compactOldTerminalRunEvents();
    expect(result.runsCompacted).toBe(0);
    expect(result.deltaEventsDeleted).toBe(0);

    expect(db.getThread(recentThread.id).rawOutput.map((event) => event.eventType)).toEqual(['started', 'delta', 'completed']);
    expect(db.getThread(plannerThread.id).rawOutput.map((event) => event.eventType)).toEqual(['started', 'delta', 'completed']);
    expect(db.getThread(pendingReviewThread.id).rawOutput.map((event) => event.eventType)).toEqual(['started', 'delta', 'completed']);
  });

  it('runs SQLite maintenance with WAL checkpointing after archived-run compaction', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-storage-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);

    const project = db.createProject({
      name: 'Maintenance Test',
      folderPath: join(dir, 'workspace'),
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Archived thread',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default'
    });

    db.addRunEvent(thread.id, 'run-maintain', 'started', {});
    db.addRunEvent(thread.id, 'run-maintain', 'delta', { delta: 'a' });
    db.addRunEvent(thread.id, 'run-maintain', 'delta', { delta: 'b' });
    db.addRunEvent(thread.id, 'run-maintain', 'completed', { output: 'done' });
    db.archiveThread(thread.id);
    setRunEventsCreatedAt(db, thread.id, 'run-maintain', '2026-01-01T00:00:00.000Z');

    const result = db.maintainStorage();

    expect(result.runsCompacted).toBe(1);
    expect(result.deltaEventsDeleted).toBe(2);
    expect(result.vacuumApplied).toBe(false);
    expect(result.sizeBeforeBytes).toBeGreaterThan(0);
    expect(result.sizeAfterBytes).toBeGreaterThan(0);
    expect(result.reclaimedBytes).toBeGreaterThanOrEqual(0);
    expect(db.getStorageDiagnostics().compactableRunCount).toBe(0);
  });

  it('supports optional VACUUM during deep maintenance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-storage-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);

    const result = db.maintainStorage({ vacuum: true });

    expect(result.vacuumApplied).toBe(true);
    expect(result.sizeBeforeBytes).toBeGreaterThan(0);
    expect(result.sizeAfterBytes).toBeGreaterThan(0);
    expect(result.reclaimedBytes).toBeGreaterThanOrEqual(0);
  });

  it('preserves info and terminal events when compacting an old archived failed run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-storage-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);

    const project = db.createProject({
      name: 'Compaction Preservation',
      folderPath: join(dir, 'workspace'),
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Archived failed thread',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default'
    });

    db.appendTurn(thread.id, 'user', 'hello');
    db.appendTurn(thread.id, 'assistant', 'partial output', null, 'run-failed');
    db.addRunEvent(thread.id, 'run-failed', 'started', { providerId: 'openai' });
    db.addRunEvent(thread.id, 'run-failed', 'info', {
      message: 'Delegated planner failed.',
      activity: { kind: 'delegation', summary: 'Delegated planner failed.' }
    });
    db.addRunEvent(thread.id, 'run-failed', 'delta', { delta: 'partial ' });
    db.addRunEvent(thread.id, 'run-failed', 'delta', { delta: 'output' });
    db.addRunEvent(thread.id, 'run-failed', 'failed', { message: 'planner disconnected' });
    db.archiveThread(thread.id);

    const oldIso = '2026-01-01T00:00:00.000Z';
    setRunEventsCreatedAt(db, thread.id, 'run-failed', oldIso);

    const result = db.compactOldTerminalRunEvents();

    expect(result.runsCompacted).toBe(1);
    expect(result.deltaEventsDeleted).toBe(2);

    const detail = db.getThread(thread.id);
    expect(detail.rawOutput.map((event) => event.eventType)).toEqual(['started', 'info', 'failed']);
    expect(detail.turns.at(-1)?.content).toBe('partial output');
  });

  it('recovers interrupted active threads on startup by marking them aborted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-storage-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);

    const project = db.createProject({
      name: 'Recovery Test',
      folderPath: join(dir, 'workspace'),
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Interrupted thread',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default'
    });

    db.updateThreadStatus(thread.id, 'running');
    db.addRunEvent(thread.id, 'run-recover', 'started', {});
    db.addRunEvent(thread.id, 'run-recover', 'delta', { delta: 'partial output' });

    const recovered = db.recoverInterruptedThreads();
    const updated = db.getThread(thread.id);

    expect(recovered.map((item) => item.id)).toEqual([thread.id]);
    expect(updated.status).toBe('aborted');
    expect(updated.rawOutput.map((event) => event.eventType)).toEqual(['started', 'delta', 'aborted']);
    expect(updated.rawOutput.at(-1)?.payload).toEqual({
      message: 'Run interrupted when the app closed.'
    });
  });

  it('persists queued follow-ups separately from transcript turns', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-storage-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);

    const project = db.createProject({
      name: 'Follow-up queue test',
      folderPath: join(dir, 'workspace'),
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Queued follow-up thread',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default'
    });

    const followUp = db.createThreadFollowUp({
      threadId: thread.id,
      content: 'Queue this for the next turn.',
      kind: 'follow_up',
      targetRunId: 'run-1'
    });

    const detail = db.getThread(thread.id);

    expect(detail.turns).toHaveLength(0);
    expect(detail.followUps).toHaveLength(1);
    expect(detail.followUps[0]).toMatchObject({
      id: followUp.id,
      threadId: thread.id,
      content: 'Queue this for the next turn.',
      kind: 'follow_up',
      status: 'queued',
      targetRunId: 'run-1'
    });
  });

  it('round-trips persisted progress snapshots through thread raw output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-storage-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);
    const project = db.createProject({
      name: 'Progress snapshot test',
      folderPath: join(dir, 'workspace'),
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Progress thread',
      providerId: 'ollama',
      modelId: 'qwen2.5-coder',
      executionPermission: 'default'
    });

    db.addRunEvent(thread.id, 'run-1', 'info', {
      progressSnapshot: {
        runId: 'run-1',
        threadId: thread.id,
        title: 'Current tasks',
        items: [{ id: 'run-1:0', label: 'Restore progress', order: 0, status: 'in_progress' }],
        updatedAt: '2026-03-23T12:00:00.000Z',
        diffStats: null,
        reviewAvailable: false,
        changeArtifact: null,
        delegation: null,
        contextPressure: null,
        checkpointReminder: null,
        queueSummary: null
      }
    });

    const detail = db.getThread(thread.id);

    expect(detail.rawOutput).toHaveLength(1);
    expect(detail.rawOutput[0]?.payload).toEqual({
      progressSnapshot: {
        runId: 'run-1',
        threadId: thread.id,
        title: 'Current tasks',
        items: [{ id: 'run-1:0', label: 'Restore progress', order: 0, status: 'in_progress' }],
        updatedAt: '2026-03-23T12:00:00.000Z',
        diffStats: null,
        reviewAvailable: false,
        changeArtifact: null,
        delegation: null,
        contextPressure: null,
        checkpointReminder: null,
        queueSummary: null
      }
    });
  });

  it('claims queued follow-ups by priority and creation order, then hides dispatched and cancelled items', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-storage-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);

    const project = db.createProject({
      name: 'Follow-up ordering test',
      folderPath: join(dir, 'workspace'),
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Ordering thread',
      providerId: 'gemini',
      modelId: 'gemini-2.5-pro',
      executionPermission: 'default'
    });

    const first = db.createThreadFollowUp({
      threadId: thread.id,
      content: 'First queued follow-up.',
      kind: 'follow_up'
    });
    const steer = db.createThreadFollowUp({
      threadId: thread.id,
      content: 'Higher-priority steer.',
      kind: 'steer',
      priority: 1
    });
    const third = db.createThreadFollowUp({
      threadId: thread.id,
      content: 'Third queued follow-up.',
      kind: 'follow_up'
    });

    const claimedSteer = db.claimNextThreadFollowUp(thread.id);
    expect(claimedSteer?.id).toBe(steer.id);
    expect(claimedSteer?.status).toBe('dispatching');

    db.markThreadFollowUpDispatched(steer.id);
    db.cancelThreadFollowUp(third.id);

    const remaining = db.listThreadFollowUps(thread.id);
    expect(remaining.map((item) => item.id)).toEqual([first.id]);

    const claimedFirst = db.claimNextThreadFollowUp(thread.id);
    expect(claimedFirst?.id).toBe(first.id);
    expect(claimedFirst?.status).toBe('dispatching');
    expect(db.claimNextThreadFollowUp(thread.id)).toBeNull();
  });

  it('supersedes older queued steer items for the same target run and lists remaining queued threads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-storage-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);

    const project = db.createProject({
      name: 'Steer replacement test',
      folderPath: join(dir, 'workspace'),
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Steer thread',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default'
    });

    const older = db.createThreadFollowUp({
      threadId: thread.id,
      content: 'Older steer.',
      kind: 'steer',
      priority: 1,
      targetRunId: 'run-1'
    });
    const newer = db.createThreadFollowUp({
      threadId: thread.id,
      content: 'Newer steer.',
      kind: 'steer',
      priority: 1,
      targetRunId: 'run-1'
    });

    expect(
      db.supersedeQueuedFollowUps({
        threadId: thread.id,
        kind: 'steer',
        targetRunId: 'run-1',
        excludeId: newer.id
      })
    ).toBe(1);

    expect(db.getThreadFollowUp(older.id).status).toBe('superseded');
    expect(db.listThreadFollowUps(thread.id).map((item) => item.id)).toEqual([newer.id]);
    expect(db.listThreadIdsWithQueuedFollowUps()).toContain(thread.id);
  });

  it('restores terminal status for stale active threads that already have a terminal event', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-storage-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);

    const project = db.createProject({
      name: 'Recovery Terminal Test',
      folderPath: join(dir, 'workspace'),
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Completed thread',
      providerId: 'gemini',
      modelId: 'gemini-2.5-pro',
      executionPermission: 'default'
    });

    db.updateThreadStatus(thread.id, 'running');
    db.addRunEvent(thread.id, 'run-finished', 'started', {});
    db.addRunEvent(thread.id, 'run-finished', 'completed', { output: 'done' });

    const recovered = db.recoverInterruptedThreads();
    const updated = db.getThread(thread.id);

    expect(recovered.map((item) => item.id)).toEqual([thread.id]);
    expect(updated.status).toBe('completed');
    expect(updated.rawOutput.map((event) => event.eventType)).toEqual(['started', 'completed']);
  });
});

describe('DatabaseService generated memory storage', () => {
  it('dedupes generated-memory candidates by workspace scope and dedupe key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-generated-memory-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);
    const project = db.createProject({
      name: 'Generated Memory',
      folderPath: join(dir, 'workspace-a'),
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Memory source',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    const turn = db.appendTurn(thread.id, 'user', 'Use npm run smoke when runtime orchestration changes.');

    const first = db.upsertGeneratedMemoryCandidate({
      workspaceScopeKey: project.folderPath!,
      projectId: project.id,
      sourceThreadId: thread.id,
      sourceRunId: null,
      sourceTurnIds: [turn.id],
      kind: 'workflow_preference',
      summary: 'Use npm run smoke for runtime work',
      detail: 'Prefer npm run smoke when main-process runtime orchestration changes.',
      evidenceExcerpt: 'Use npm run smoke when runtime orchestration changes.',
      dedupeKey: `${project.folderPath}|workflow_preference|npm-run-smoke`,
      status: 'proposed',
      createdAt: '2026-04-20T10:00:00.000Z',
      updatedAt: '2026-04-20T10:00:00.000Z'
    });

    const second = db.upsertGeneratedMemoryCandidate({
      workspaceScopeKey: project.folderPath!,
      projectId: project.id,
      sourceThreadId: thread.id,
      sourceRunId: 'run-1',
      sourceTurnIds: [turn.id],
      kind: 'workflow_preference',
      summary: 'Use npm run smoke for runtime changes',
      detail: 'Prefer npm run smoke before trusting runtime orchestration changes.',
      evidenceExcerpt: 'Use npm run smoke when runtime orchestration changes.',
      dedupeKey: `${project.folderPath}|workflow_preference|npm-run-smoke`,
      status: 'consolidated',
      createdAt: '2026-04-20T10:00:00.000Z',
      updatedAt: '2026-04-20T10:05:00.000Z'
    });

    db.replaceGeneratedMemoryEvidenceForCandidate(second.id, [
      {
        workspaceScopeKey: project.folderPath!,
        projectId: project.id,
        sourceThreadId: thread.id,
        sourceTurnIds: [turn.id],
        role: 'user',
        excerpt: 'Use npm run smoke when runtime orchestration changes.',
        capturedAt: '2026-04-20T10:05:00.000Z'
      }
    ]);

    const listed = db.listGeneratedMemoryCandidates(project.folderPath!);
    const evidence = db.listGeneratedMemoryEvidenceForCandidate(second.id);

    expect(second.id).toBe(first.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      workspaceScopeKey: project.folderPath!,
      projectId: project.id,
      sourceThreadId: thread.id,
      sourceRunId: 'run-1',
      kind: 'workflow_preference',
      status: 'consolidated',
      summary: 'Use npm run smoke for runtime changes'
    });
    expect(listed[0].sourceTurnIds).toEqual([turn.id]);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      candidateId: second.id,
      itemId: null,
      workspaceScopeKey: project.folderPath!,
      sourceThreadId: thread.id,
      role: 'user'
    });
    expect(evidence[0].sourceTurnIds).toEqual([turn.id]);
  });

  it('stores generated-memory items with evidence and supports disabling recall', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-generated-memory-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);
    const project = db.createProject({
      name: 'Generated Memory',
      folderPath: join(dir, 'workspace-b'),
      trusted: true
    });
    const thread = db.createThread({
      projectId: project.id,
      title: 'Pitfall source',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    const turn = db.appendTurn(thread.id, 'assistant', 'Avoid the legacy path; use the workspace root script.');
    const candidate = db.upsertGeneratedMemoryCandidate({
      workspaceScopeKey: project.folderPath!,
      projectId: project.id,
      sourceThreadId: thread.id,
      sourceRunId: 'run-2',
      sourceTurnIds: [turn.id],
      kind: 'known_pitfall',
      summary: 'Avoid the legacy path',
      detail: 'Use the workspace root script instead of the legacy nested path.',
      evidenceExcerpt: 'Avoid the legacy path; use the workspace root script.',
      dedupeKey: `${project.folderPath}|known_pitfall|legacy-path`,
      status: 'consolidated',
      createdAt: '2026-04-20T11:00:00.000Z',
      updatedAt: '2026-04-20T11:00:00.000Z'
    });

    const item = db.upsertGeneratedMemoryItem({
      workspaceScopeKey: project.folderPath!,
      projectId: project.id,
      kind: 'known_pitfall',
      summary: 'Avoid the legacy path',
      detail: 'Use the workspace root script instead of the legacy nested path.',
      authority: 'derived_noncanonical',
      evidenceCount: 1,
      sourceCandidateIds: [candidate.id],
      sourceThreadIds: [thread.id],
      createdAt: '2026-04-20T11:05:00.000Z',
      updatedAt: '2026-04-20T11:05:00.000Z',
      lastUsedAt: null,
      useCount: 0,
      disabledAt: null
    });

    db.replaceGeneratedMemoryEvidenceForItem(item.id, [
      {
        workspaceScopeKey: project.folderPath!,
        projectId: project.id,
        sourceThreadId: thread.id,
        sourceTurnIds: [turn.id],
        role: 'assistant',
        excerpt: 'Avoid the legacy path; use the workspace root script.',
        capturedAt: '2026-04-20T11:05:00.000Z'
      }
    ]);

    const stored = db.listGeneratedMemoryItems(project.folderPath!);
    const evidence = db.listGeneratedMemoryEvidenceForItem(item.id);
    const disabled = db.disableGeneratedMemoryItem(item.id, '2026-04-20T11:10:00.000Z');

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: item.id,
      workspaceScopeKey: project.folderPath!,
      authority: 'derived_noncanonical',
      evidenceCount: 1,
      useCount: 0,
      disabledAt: null
    });
    expect(stored[0].sourceCandidateIds).toEqual([candidate.id]);
    expect(stored[0].sourceThreadIds).toEqual([thread.id]);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      candidateId: null,
      itemId: item.id,
      role: 'assistant'
    });
    expect(disabled?.disabledAt).toBe('2026-04-20T11:10:00.000Z');
  });

  it('clears generated-memory state per workspace scope without touching another workspace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-generated-memory-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);
    const projectA = db.createProject({
      name: 'Workspace A',
      folderPath: join(dir, 'workspace-a'),
      trusted: true
    });
    const projectB = db.createProject({
      name: 'Workspace B',
      folderPath: join(dir, 'workspace-b'),
      trusted: true
    });
    const threadA = db.createThread({
      projectId: projectA.id,
      title: 'A thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    const threadB = db.createThread({
      projectId: projectB.id,
      title: 'B thread',
      providerId: 'openai',
      modelId: 'gpt-5'
    });
    const turnA = db.appendTurn(threadA.id, 'user', 'Workspace A prefers pnpm.');
    const turnB = db.appendTurn(threadB.id, 'user', 'Workspace B prefers npm.');

    const candidateA = db.upsertGeneratedMemoryCandidate({
      workspaceScopeKey: projectA.folderPath!,
      projectId: projectA.id,
      sourceThreadId: threadA.id,
      sourceRunId: null,
      sourceTurnIds: [turnA.id],
      kind: 'workflow_preference',
      summary: 'Workspace A prefers pnpm',
      detail: 'Use pnpm in workspace A.',
      evidenceExcerpt: 'Workspace A prefers pnpm.',
      dedupeKey: `${projectA.folderPath}|workflow_preference|package-manager`,
      status: 'proposed',
      createdAt: '2026-04-20T12:00:00.000Z',
      updatedAt: '2026-04-20T12:00:00.000Z'
    });
    const candidateB = db.upsertGeneratedMemoryCandidate({
      workspaceScopeKey: projectB.folderPath!,
      projectId: projectB.id,
      sourceThreadId: threadB.id,
      sourceRunId: null,
      sourceTurnIds: [turnB.id],
      kind: 'workflow_preference',
      summary: 'Workspace B prefers npm',
      detail: 'Use npm in workspace B.',
      evidenceExcerpt: 'Workspace B prefers npm.',
      dedupeKey: `${projectB.folderPath}|workflow_preference|package-manager`,
      status: 'proposed',
      createdAt: '2026-04-20T12:00:00.000Z',
      updatedAt: '2026-04-20T12:00:00.000Z'
    });

    db.upsertGeneratedMemoryItem({
      workspaceScopeKey: projectA.folderPath!,
      projectId: projectA.id,
      kind: 'workflow_preference',
      summary: 'Workspace A prefers pnpm',
      detail: 'Use pnpm in workspace A.',
      authority: 'derived_noncanonical',
      evidenceCount: 1,
      sourceCandidateIds: [candidateA.id],
      sourceThreadIds: [threadA.id],
      createdAt: '2026-04-20T12:01:00.000Z',
      updatedAt: '2026-04-20T12:01:00.000Z',
      lastUsedAt: null,
      useCount: 0,
      disabledAt: null
    });
    db.upsertGeneratedMemoryItem({
      workspaceScopeKey: projectB.folderPath!,
      projectId: projectB.id,
      kind: 'workflow_preference',
      summary: 'Workspace B prefers npm',
      detail: 'Use npm in workspace B.',
      authority: 'derived_noncanonical',
      evidenceCount: 1,
      sourceCandidateIds: [candidateB.id],
      sourceThreadIds: [threadB.id],
      createdAt: '2026-04-20T12:01:00.000Z',
      updatedAt: '2026-04-20T12:01:00.000Z',
      lastUsedAt: null,
      useCount: 0,
      disabledAt: null
    });

    db.clearGeneratedMemoryWorkspaceScope(projectA.folderPath!);

    expect(db.listGeneratedMemoryCandidates(projectA.folderPath!)).toHaveLength(0);
    expect(db.listGeneratedMemoryItems(projectA.folderPath!)).toHaveLength(0);
    expect(db.listGeneratedMemoryCandidates(projectB.folderPath!)).toHaveLength(1);
    expect(db.listGeneratedMemoryItems(projectB.folderPath!)).toHaveLength(1);
  });
});

describe('DatabaseService collaboration cache', () => {
  it('hydrates collaboration bootstrap from local cache tables', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-collab-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);
    const now = '2026-03-20T12:00:00.000Z';

    db.saveCollabConfig({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key'
    });
    db.setCollabIdentity({
      userId: 'user-1',
      connectionState: 'connected'
    });

    db.upsertCollabProfile({
      id: 'user-1',
      email: null,
      displayName: 'Owner',
      handle: '@owner',
      avatarUrl: null,
      status: 'online',
      bio: 'Workspace owner',
      timezone: 'America/Toronto',
      createdAt: now,
      updatedAt: now
    });
    db.upsertCollabProfile({
      id: 'user-2',
      email: null,
      displayName: 'Friend',
      handle: '@friend',
      avatarUrl: null,
      status: 'away',
      bio: null,
      timezone: 'America/New_York',
      createdAt: now,
      updatedAt: now
    });

    db.upsertCollabRoom({
      id: 'room-1',
      type: 'project',
      name: '#core-app',
      joinCode: 'COREAPP42',
      slug: 'core-app',
      topic: 'Shared implementation',
      projectLabel: 'vicode-windows',
      directUserId: null,
      unreadCount: 1,
      memberCount: 2,
      lastActivityAt: now,
      lastMessagePreview: 'Run summary posted',
      createdBy: 'user-1',
      createdAt: now,
      updatedAt: now
    });
    db.upsertCollabRoomSession({
      roomId: 'room-1',
      userId: 'user-1',
      sessionToken: 'session-token-1',
      updatedAt: now,
      expiresAt: null
    });
    db.replaceCollabRoomMembers('room-1', [
      {
        roomId: 'room-1',
        userId: 'user-1',
        role: 'owner',
        membershipState: 'active',
        joinedAt: now,
        displayName: 'Owner',
        handle: '@owner',
        avatarUrl: null,
        status: 'online'
      },
      {
        roomId: 'room-1',
        userId: 'user-2',
        role: 'member',
        membershipState: 'active',
        joinedAt: now,
        displayName: 'Friend',
        handle: '@friend',
        avatarUrl: null,
        status: 'away'
      }
    ]);
    db.upsertCollabMessage({
      id: 'message-1',
      roomId: 'room-1',
      authorId: 'user-1',
      authorDisplayName: 'Owner',
      authorHandle: '@owner',
      body: 'Shared run is live.',
      createdAt: now
    });
    db.upsertCollabPresence({
      roomId: 'room-1',
      userId: 'user-2',
      status: 'away',
      currentThreadId: 'thread-1',
      currentThreadTitle: 'Collab bootstrap',
      branchName: 'codex/collab',
      worktreeName: null,
      activeRunId: 'run-1',
      activeRunTitle: 'Wire backend',
      dirtyFileCount: 3,
      stagedFileCount: 1,
      updatedAt: now
    });
    db.upsertCollabSharedThread({
      id: 'room-1:thread-1',
      roomId: 'room-1',
      threadId: 'thread-1',
      projectId: 'project-1',
      projectLabel: 'vicode-windows',
      title: 'Collaboration bootstrap',
      status: 'active',
      driverUserId: 'user-1',
      driverDisplayName: 'Owner',
      providerId: 'openai',
      modelId: 'gpt-5',
      lastPromptSummary: 'Build the collaboration cache.',
      latestAssistantSummary: 'Storage layer landed.',
      runId: 'run-1',
      createdAt: now,
      updatedAt: now
    });
    db.upsertCollabSharedRun({
      id: 'room-1:run-1',
      roomId: 'room-1',
      threadId: 'thread-1',
      threadTitle: 'Collaboration bootstrap',
      runId: 'run-1',
      driverUserId: 'user-1',
      driverDisplayName: 'Owner',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      status: 'running',
      taskTitle: 'Wire backend',
      summary: 'Shared run is live.',
      changedFiles: ['src/storage/database.ts'],
      diffStats: {
        filesChanged: 1,
        insertions: 120,
        deletions: 4
      },
      testsSummary: null,
      resultLabel: null,
      startedAt: now,
      updatedAt: now,
      completedAt: null
    });
    db.upsertCollabHandoff({
      id: 'handoff-1',
      roomId: 'room-1',
      threadId: 'thread-1',
      runId: 'run-1',
      authorUserId: 'user-1',
      authorDisplayName: 'Owner',
      title: 'Continue backend wiring',
      summary: 'Finish IPC and renderer hookup.',
      branchName: 'codex/collab',
      dirtyFileCount: 3,
      stagedFileCount: 1,
      changedFiles: ['src/storage/database.ts'],
      outstandingTasks: ['Wire IPC', 'Replace mock UI'],
      recommendedNextPrompt: 'Finish the collaboration bridge.',
      createdAt: now
    });

    const bootstrap = db.getCollabBootstrap();

    expect(bootstrap.config.supabaseUrl).toBe('https://example.supabase.co');
    expect(bootstrap.account.userId).toBe('user-1');
    expect(bootstrap.account.email).toBeNull();
    expect(bootstrap.profile?.displayName).toBe('Owner');
    expect(bootstrap.rooms).toHaveLength(1);
    expect(bootstrap.roomMembersByRoom['room-1']).toHaveLength(2);
    expect(bootstrap.messagesByRoom['room-1'][0]?.body).toBe('Shared run is live.');
    expect(bootstrap.presenceByRoom['room-1'][0]?.activeRunId).toBe('run-1');
    expect(bootstrap.sharedThreadsByRoom['room-1'][0]?.title).toBe('Collaboration bootstrap');
    expect(bootstrap.sharedRunsByRoom['room-1'][0]?.status).toBe('running');
    expect(bootstrap.handoffsByRoom['room-1'][0]?.title).toBe('Continue backend wiring');
    expect(bootstrap.contacts.map((contact) => contact.userId)).toEqual(['user-2']);
  });

  it('includes direct-message rooms in chats while preserving contact discovery', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-collab-dm-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);
    const now = '2026-03-20T12:30:00.000Z';

    db.saveCollabConfig({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key'
    });
    db.setCollabIdentity({
      userId: 'user-1',
      connectionState: 'connected'
    });

    db.upsertCollabProfile({
      id: 'user-1',
      email: null,
      displayName: 'Owner',
      handle: '@owner',
      avatarUrl: null,
      status: 'online',
      bio: null,
      timezone: 'America/Toronto',
      createdAt: now,
      updatedAt: now
    });
    db.upsertCollabProfile({
      id: 'user-2',
      email: null,
      displayName: 'Doris Brown',
      handle: '@doris',
      avatarUrl: null,
      status: 'away',
      bio: null,
      timezone: 'America/New_York',
      createdAt: now,
      updatedAt: now
    });

    db.upsertCollabRoom({
      id: 'dm-1',
      type: 'dm',
      name: 'Doris Brown',
      joinCode: 'DMCODE42',
      slug: null,
      topic: null,
      projectLabel: null,
      directUserId: 'user-2',
      unreadCount: 0,
      memberCount: 2,
      lastActivityAt: now,
      lastMessagePreview: 'Ping from the peer',
      createdBy: 'user-1',
      createdAt: now,
      updatedAt: now
    });
    db.upsertCollabRoomSession({
      roomId: 'dm-1',
      userId: 'user-1',
      sessionToken: 'session-token-dm',
      updatedAt: now,
      expiresAt: null
    });
    db.replaceCollabRoomMembers('dm-1', [
      {
        roomId: 'dm-1',
        userId: 'user-1',
        role: 'owner',
        membershipState: 'active',
        joinedAt: now,
        displayName: 'Owner',
        handle: '@owner',
        avatarUrl: null,
        status: 'online'
      },
      {
        roomId: 'dm-1',
        userId: 'user-2',
        role: 'member',
        membershipState: 'active',
        joinedAt: now,
        displayName: 'Doris Brown',
        handle: '@doris',
        avatarUrl: null,
        status: 'away'
      }
    ]);
    db.upsertCollabMessage({
      id: 'message-dm-1',
      roomId: 'dm-1',
      authorId: 'user-2',
      authorDisplayName: 'Doris Brown',
      authorHandle: '@doris',
      body: 'Ping from the peer',
      createdAt: now
    });

    const bootstrap = db.getCollabBootstrap();

    expect(db.listCollabChats()).toEqual([
      expect.objectContaining({
        id: 'dm-1',
        type: 'dm',
        directUserId: 'user-2',
        name: 'Doris Brown'
      })
    ]);
    expect(bootstrap.rooms).toEqual([
      expect.objectContaining({
        id: 'dm-1',
        type: 'dm'
      })
    ]);
    expect(bootstrap.messagesByRoom['dm-1'][0]?.body).toBe('Ping from the peer');
    expect(bootstrap.contacts.map((contact) => contact.userId)).toContain('user-2');
  });
});

describe('DatabaseService built-in skills', () => {
  it('seeds the current Vicode-tailored built-in skill contracts during migration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-skills-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);
    const skills = db.listSkills();

    const concise = skills.find((skill) => skill.id === 'built-in-concise');
    const planner = skills.find((skill) => skill.id === 'built-in-planner');
    const pdfToolkit = skills.find((skill) => skill.id === 'built-in-pdf-toolkit');

    expect(concise?.description).toContain('when the user wants');
    expect(planner?.instructions).toContain('do not replace or fake the provider-native planner state machine');
    expect(pdfToolkit?.instructions).toContain('Do not imply that a file was inspected when it was not provided.');
  });
});
