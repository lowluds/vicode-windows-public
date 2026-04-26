import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AutonomousTaskRecord } from '../shared/domain';

type Row = Record<string, unknown>;

export class AutonomousTaskRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly mapAutonomousTask: (row: Row) => AutonomousTaskRecord
  ) {}

  listAutonomousTasksForProject(
    projectId: string,
    kind?: AutonomousTaskRecord['kind']
  ): AutonomousTaskRecord[] {
    const rows = (
      kind
        ? this.db
            .prepare(
              `SELECT * FROM autonomous_tasks
               WHERE project_id = ? AND kind = ?
               ORDER BY updated_at DESC`
            )
            .all(projectId, kind)
        : this.db
            .prepare(
              `SELECT * FROM autonomous_tasks
               WHERE project_id = ?
               ORDER BY updated_at DESC`
            )
            .all(projectId)
    ) as Row[];
    return rows.map((row) => this.mapAutonomousTask(row));
  }

  getAutonomousTaskByKindAndSource(
    kind: AutonomousTaskRecord['kind'],
    sourceId: string
  ): AutonomousTaskRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM autonomous_tasks
         WHERE kind = ? AND source_id = ?`
      )
      .get(kind, sourceId) as Row | undefined;
    return row ? this.mapAutonomousTask(row) : null;
  }

  deleteAutonomousTaskByKindAndSource(
    kind: AutonomousTaskRecord['kind'],
    sourceId: string
  ) {
    this.db
      .prepare(
        `DELETE FROM autonomous_tasks
         WHERE kind = ? AND source_id = ?`
      )
      .run(kind, sourceId);
  }

  upsertAutonomousTask(
    input: Omit<AutonomousTaskRecord, 'createdAt' | 'updatedAt'> & {
      createdAt?: string;
      updatedAt?: string;
    }
  ): AutonomousTaskRecord {
    const existing = this.getAutonomousTaskByKindAndSource(input.kind, input.sourceId);
    const now = new Date().toISOString();
    const next: AutonomousTaskRecord = {
      ...existing,
      ...input,
      id: existing?.id ?? input.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now
    };

    this.db
      .prepare(
        `INSERT INTO autonomous_tasks (
          id, kind, project_id, thread_id, run_id, source_id, title, summary,
          owner_label, provenance_label, trust_label, approval_label, status,
          status_label, blocked_by, blocking, last_error, metadata_json,
          created_at, updated_at, started_at, completed_at
        ) VALUES (
          @id, @kind, @projectId, @threadId, @runId, @sourceId, @title, @summary,
          @ownerLabel, @provenanceLabel, @trustLabel, @approvalLabel, @status,
          @statusLabel, @blockedBy, @blocking, @lastError, @metadataJson,
          @createdAt, @updatedAt, @startedAt, @completedAt
        )
        ON CONFLICT(kind, source_id) DO UPDATE SET
          project_id = excluded.project_id,
          thread_id = excluded.thread_id,
          run_id = excluded.run_id,
          title = excluded.title,
          summary = excluded.summary,
          owner_label = excluded.owner_label,
          provenance_label = excluded.provenance_label,
          trust_label = excluded.trust_label,
          approval_label = excluded.approval_label,
          status = excluded.status,
          status_label = excluded.status_label,
          blocked_by = excluded.blocked_by,
          blocking = excluded.blocking,
          last_error = excluded.last_error,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at`
      )
      .run({
        id: next.id,
        kind: next.kind,
        projectId: next.projectId,
        threadId: next.threadId,
        runId: next.runId,
        sourceId: next.sourceId,
        title: next.title,
        summary: next.summary,
        ownerLabel: next.ownerLabel,
        provenanceLabel: next.provenanceLabel,
        trustLabel: next.trustLabel,
        approvalLabel: next.approvalLabel,
        status: next.status,
        statusLabel: next.statusLabel,
        blockedBy: next.blockedBy,
        blocking: next.blocking,
        lastError: next.lastError,
        metadataJson: JSON.stringify(next.metadata ?? {}),
        createdAt: next.createdAt,
        updatedAt: next.updatedAt,
        startedAt: next.startedAt,
        completedAt: next.completedAt
      });

    return this.getAutonomousTaskByKindAndSource(next.kind, next.sourceId)!;
  }
}
