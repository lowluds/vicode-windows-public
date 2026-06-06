import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ProviderId } from '../shared/domain';

type Row = Record<string, unknown>;

export interface ThreadCompactionRecord {
  id: string;
  threadId: string;
  sourceStartEventId: string;
  sourceEndEventId: string;
  summary: string;
  inputTokenEstimate: number | null;
  outputTokenEstimate: number | null;
  providerId: ProviderId | null;
  modelId: string | null;
  createdAt: string;
}

export interface ThreadCompactionCreateInput {
  threadId: string;
  sourceStartEventId: string;
  sourceEndEventId: string;
  summary: string;
  inputTokenEstimate?: number | null;
  outputTokenEstimate?: number | null;
  providerId?: ProviderId | null;
  modelId?: string | null;
  createdAt?: string | null;
}

function numberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

export class ThreadCompactionRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: ThreadCompactionCreateInput): ThreadCompactionRecord {
    const record: ThreadCompactionRecord = {
      id: randomUUID(),
      threadId: input.threadId,
      sourceStartEventId: input.sourceStartEventId,
      sourceEndEventId: input.sourceEndEventId,
      summary: input.summary,
      inputTokenEstimate: input.inputTokenEstimate ?? null,
      outputTokenEstimate: input.outputTokenEstimate ?? null,
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      createdAt: input.createdAt ?? new Date().toISOString()
    };

    this.db
      .prepare(
        `INSERT INTO thread_compactions (
          id,
          thread_id,
          source_start_event_id,
          source_end_event_id,
          summary,
          input_token_estimate,
          output_token_estimate,
          provider_id,
          model_id,
          created_at
        ) VALUES (
          @id,
          @threadId,
          @sourceStartEventId,
          @sourceEndEventId,
          @summary,
          @inputTokenEstimate,
          @outputTokenEstimate,
          @providerId,
          @modelId,
          @createdAt
        )`
      )
      .run(record);

    return record;
  }

  listForThread(threadId: string): ThreadCompactionRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM thread_compactions
         WHERE thread_id = ?
         ORDER BY created_at DESC, id DESC`
      )
      .all(threadId)
      .map((row) => this.mapThreadCompaction(row as Row));
  }

  getLatestForThread(threadId: string): ThreadCompactionRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM thread_compactions
         WHERE thread_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`
      )
      .get(threadId) as Row | undefined;

    return row ? this.mapThreadCompaction(row) : null;
  }

  deleteForThread(threadId: string) {
    this.db.prepare('DELETE FROM thread_compactions WHERE thread_id = ?').run(threadId);
  }

  private mapThreadCompaction(row: Row): ThreadCompactionRecord {
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      sourceStartEventId: String(row.source_start_event_id),
      sourceEndEventId: String(row.source_end_event_id),
      summary: String(row.summary),
      inputTokenEstimate: numberOrNull(row.input_token_estimate),
      outputTokenEstimate: numberOrNull(row.output_token_estimate),
      providerId: stringOrNull(row.provider_id) as ProviderId | null,
      modelId: stringOrNull(row.model_id),
      createdAt: String(row.created_at)
    };
  }
}
