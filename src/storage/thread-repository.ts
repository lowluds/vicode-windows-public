import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { normalizeThreadSources } from '../shared/thread-sources';
import type {
  ExecutionPermission,
  ProviderId,
  ThreadDetail,
  ThreadSummary,
  ThreadTurn
} from '../shared/domain';

type Row = Record<string, unknown>;

function now() {
  return new Date().toISOString();
}

export class ThreadRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly getPreferences: () => { defaultExecutionPermission: ExecutionPermission },
    private readonly ensureThreadPlannerState: (threadId: string) => void,
    private readonly savePreferences: (input: { selectedProjectId?: string | null; lastOpenedThreadId?: string | null }) => void,
    private readonly mapThreadSummary: (row: Row) => ThreadSummary,
    private readonly mapTurn: (row: Row) => ThreadTurn,
    private readonly mapRunEvent: (row: Row) => ThreadDetail['rawOutput'][number],
    private readonly getThreadPlannerState: (threadId: string) => ThreadDetail['planner'],
    private readonly listThreadFollowUps: (threadId: string) => ThreadDetail['followUps']
  ) {}

  createThread(input: {
    projectId: string;
    title?: string;
    providerId: ProviderId;
    modelId: string;
    executionPermission?: ExecutionPermission | null;
  }): ThreadDetail {
    const nowIso = now();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO threads (
          id, project_id, title, provider_id, model_id, execution_permission, status, archived, created_at, updated_at, last_message_at, last_preview
        ) VALUES (@id, @projectId, @title, @providerId, @modelId, @executionPermission, 'draft', 0, @createdAt, @updatedAt, @lastMessageAt, '')`
      )
      .run({
        id,
        projectId: input.projectId,
        title: input.title?.trim() || 'New thread',
        providerId: input.providerId,
        modelId: input.modelId,
        executionPermission: input.executionPermission ?? this.getPreferences().defaultExecutionPermission,
        createdAt: nowIso,
        updatedAt: nowIso,
        lastMessageAt: nowIso
      });
    this.ensureThreadPlannerState(id);
    this.savePreferences({ selectedProjectId: input.projectId, lastOpenedThreadId: id });
    return this.getThread(id);
  }

  listThreads(projectId: string): ThreadSummary[] {
    return this.db
      .prepare(
        `SELECT * FROM threads
         WHERE project_id = ? AND archived = 0
         ORDER BY updated_at DESC`
      )
      .all(projectId)
      .map((row) => this.mapThreadSummary(row as Row));
  }

  getThread(threadId: string): ThreadDetail {
    const row = this.db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId) as Row | undefined;
    if (!row) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    return {
      ...this.mapThreadSummary(row),
      turns: this.db
        .prepare('SELECT * FROM thread_turns WHERE thread_id = ? ORDER BY created_at ASC')
        .all(threadId)
        .map((turn) => this.mapTurn(turn as Row)),
      rawOutput: this.db
        .prepare('SELECT * FROM run_events WHERE thread_id = ? ORDER BY created_at ASC')
        .all(threadId)
        .map((event) => this.mapRunEvent(event as Row)),
      planner: this.getThreadPlannerState(threadId),
      followUps: this.listThreadFollowUps(threadId)
    };
  }

  getThreadSummary(threadId: string): ThreadSummary {
    const row = this.db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId) as Row | undefined;
    if (!row) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    return this.mapThreadSummary(row);
  }

  getThreadDraft(threadId: string): string {
    const row = this.db.prepare('SELECT prompt FROM thread_drafts WHERE thread_id = ?').get(threadId) as
      | { prompt: string }
      | undefined;
    return row?.prompt ?? '';
  }

  saveThreadDraft(threadId: string, prompt: string): string {
    const nowIso = now();
    if (!prompt.trim()) {
      this.clearThreadDraft(threadId);
      return '';
    }

    this.db
      .prepare(
        `INSERT INTO thread_drafts (thread_id, prompt, updated_at)
         VALUES (@threadId, @prompt, @updatedAt)
         ON CONFLICT(thread_id) DO UPDATE
         SET prompt = excluded.prompt,
             updated_at = excluded.updated_at`
      )
      .run({
        threadId,
        prompt,
        updatedAt: nowIso
      });

    return prompt;
  }

  clearThreadDraft(threadId: string) {
    this.db.prepare('DELETE FROM thread_drafts WHERE thread_id = ?').run(threadId);
  }

  appendTurn(
    threadId: string,
    role: ThreadTurn['role'],
    content: string,
    metadata: Record<string, unknown> | null = null,
    runId: string | null = null
  ): ThreadTurn {
    const nowIso = now();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at)
         VALUES (@id, @threadId, @runId, @role, @content, @metadataJson, @createdAt)`
      )
      .run({
        id,
        threadId,
        runId,
        role,
        content,
        metadataJson: metadata ? JSON.stringify(metadata) : null,
        createdAt: nowIso
      });
    this.db
      .prepare('UPDATE threads SET updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?')
      .run(nowIso, nowIso, content.slice(0, 160), threadId);
    return {
      id,
      threadId,
      runId,
      role,
      content,
      sources: metadata ? normalizeThreadSources(metadata.sources) : [],
      metadata,
      createdAt: nowIso
    } satisfies ThreadTurn;
  }

  updateAssistantTurn(runId: string, threadId: string, content: string, metadata?: Record<string, unknown> | null) {
    const existing = this.db
      .prepare('SELECT id FROM thread_turns WHERE run_id = ? AND role = ? ORDER BY created_at DESC LIMIT 1')
      .get(runId, 'assistant') as { id: string } | undefined;
    if (!existing) {
      this.appendTurn(threadId, 'assistant', content, metadata ?? null, runId);
      return;
    }
    const nowIso = now();
    if (metadata === undefined) {
      this.db.prepare('UPDATE thread_turns SET content = ?, created_at = ? WHERE id = ?').run(content, nowIso, existing.id);
    } else {
      this.db
        .prepare('UPDATE thread_turns SET content = ?, metadata_json = ?, created_at = ? WHERE id = ?')
        .run(content, metadata ? JSON.stringify(metadata) : null, nowIso, existing.id);
    }
    this.db.prepare('UPDATE threads SET updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?').run(nowIso, nowIso, content.slice(0, 160), threadId);
  }

  updateThreadStatus(threadId: string, status: ThreadSummary['status']) {
    this.db.prepare('UPDATE threads SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), threadId);
  }

  setThreadExecutionPermission(threadId: string, executionPermission: ExecutionPermission): ThreadDetail {
    this.getThreadSummary(threadId);
    this.db.prepare('UPDATE threads SET execution_permission = ? WHERE id = ?').run(executionPermission, threadId);
    return this.getThread(threadId);
  }

  syncThreadRunConfiguration(threadId: string, input: {
    providerId: ProviderId;
    modelId: string;
    executionPermission: ExecutionPermission;
  }): ThreadDetail {
    this.getThreadSummary(threadId);
    this.db
      .prepare(
        `UPDATE threads
         SET provider_id = @providerId,
             model_id = @modelId,
             execution_permission = @executionPermission,
             updated_at = @updatedAt
         WHERE id = @threadId`
      )
      .run({
        threadId,
        providerId: input.providerId,
        modelId: input.modelId,
        executionPermission: input.executionPermission,
        updatedAt: now()
      });
    return this.getThread(threadId);
  }
}
