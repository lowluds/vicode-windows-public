import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type {
  GeneratedMemoryCandidate,
  GeneratedMemoryCandidateKind,
  GeneratedMemoryCandidateStatus,
  GeneratedMemoryEvidence,
  GeneratedMemoryItem,
  GeneratedMemoryItemAuthority
} from '../shared/domain';

type Row = Record<string, unknown>;

export class GeneratedMemoryRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly mapCandidate: (row: Row) => GeneratedMemoryCandidate,
    private readonly mapItem: (row: Row) => GeneratedMemoryItem,
    private readonly mapEvidence: (row: Row) => GeneratedMemoryEvidence
  ) {}

  upsertGeneratedMemoryCandidate(input: {
    workspaceScopeKey: string;
    projectId: string | null;
    sourceThreadId: string;
    sourceRunId: string | null;
    sourceTurnIds: string[];
    kind: GeneratedMemoryCandidateKind;
    summary: string;
    detail: string;
    evidenceExcerpt: string;
    dedupeKey: string;
    status: GeneratedMemoryCandidateStatus;
    createdAt: string;
    updatedAt: string;
  }): GeneratedMemoryCandidate {
    const existing = this.db
      .prepare('SELECT id FROM generated_memory_candidates WHERE workspace_scope_key = ? AND dedupe_key = ?')
      .get(input.workspaceScopeKey, input.dedupeKey) as { id?: string } | undefined;
    const id = existing?.id ?? randomUUID();

    this.db
      .prepare(
        `INSERT INTO generated_memory_candidates (
          id, workspace_scope_key, project_id, source_thread_id, source_run_id, source_turn_ids_json, kind,
          summary, detail, evidence_excerpt, dedupe_key, status, created_at, updated_at
        ) VALUES (
          @id, @workspaceScopeKey, @projectId, @sourceThreadId, @sourceRunId, @sourceTurnIdsJson, @kind,
          @summary, @detail, @evidenceExcerpt, @dedupeKey, @status, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          workspace_scope_key = excluded.workspace_scope_key,
          project_id = excluded.project_id,
          source_thread_id = excluded.source_thread_id,
          source_run_id = excluded.source_run_id,
          source_turn_ids_json = excluded.source_turn_ids_json,
          kind = excluded.kind,
          summary = excluded.summary,
          detail = excluded.detail,
          evidence_excerpt = excluded.evidence_excerpt,
          dedupe_key = excluded.dedupe_key,
          status = excluded.status,
          updated_at = excluded.updated_at`
      )
      .run({
        id,
        workspaceScopeKey: input.workspaceScopeKey,
        projectId: input.projectId,
        sourceThreadId: input.sourceThreadId,
        sourceRunId: input.sourceRunId,
        sourceTurnIdsJson: JSON.stringify(input.sourceTurnIds),
        kind: input.kind,
        summary: input.summary,
        detail: input.detail,
        evidenceExcerpt: input.evidenceExcerpt,
        dedupeKey: input.dedupeKey,
        status: input.status,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt
      });

    return this.getGeneratedMemoryCandidate(id)!;
  }

  getGeneratedMemoryCandidate(candidateId: string): GeneratedMemoryCandidate | null {
    const row = this.db
      .prepare('SELECT * FROM generated_memory_candidates WHERE id = ?')
      .get(candidateId) as Row | undefined;
    return row ? this.mapCandidate(row) : null;
  }

  listGeneratedMemoryCandidates(workspaceScopeKey: string): GeneratedMemoryCandidate[] {
    return this.db
      .prepare('SELECT * FROM generated_memory_candidates WHERE workspace_scope_key = ? ORDER BY updated_at DESC, created_at DESC')
      .all(workspaceScopeKey)
      .map((row) => this.mapCandidate(row as Row));
  }

  upsertGeneratedMemoryItem(input: {
    id?: string;
    workspaceScopeKey: string;
    projectId: string | null;
    kind: GeneratedMemoryCandidateKind;
    summary: string;
    detail: string;
    authority: GeneratedMemoryItemAuthority;
    evidenceCount: number;
    sourceCandidateIds: string[];
    sourceThreadIds: string[];
    createdAt: string;
    updatedAt: string;
    lastUsedAt: string | null;
    useCount: number;
    disabledAt: string | null;
  }): GeneratedMemoryItem {
    const id = input.id ?? randomUUID();

    this.db
      .prepare(
        `INSERT INTO generated_memory_items (
          id, workspace_scope_key, project_id, kind, summary, detail, authority, evidence_count,
          source_candidate_ids_json, source_thread_ids_json, created_at, updated_at, last_used_at, use_count, disabled_at
        ) VALUES (
          @id, @workspaceScopeKey, @projectId, @kind, @summary, @detail, @authority, @evidenceCount,
          @sourceCandidateIdsJson, @sourceThreadIdsJson, @createdAt, @updatedAt, @lastUsedAt, @useCount, @disabledAt
        )
        ON CONFLICT(id) DO UPDATE SET
          workspace_scope_key = excluded.workspace_scope_key,
          project_id = excluded.project_id,
          kind = excluded.kind,
          summary = excluded.summary,
          detail = excluded.detail,
          authority = excluded.authority,
          evidence_count = excluded.evidence_count,
          source_candidate_ids_json = excluded.source_candidate_ids_json,
          source_thread_ids_json = excluded.source_thread_ids_json,
          updated_at = excluded.updated_at,
          last_used_at = excluded.last_used_at,
          use_count = excluded.use_count,
          disabled_at = excluded.disabled_at`
      )
      .run({
        id,
        workspaceScopeKey: input.workspaceScopeKey,
        projectId: input.projectId,
        kind: input.kind,
        summary: input.summary,
        detail: input.detail,
        authority: input.authority,
        evidenceCount: input.evidenceCount,
        sourceCandidateIdsJson: JSON.stringify(input.sourceCandidateIds),
        sourceThreadIdsJson: JSON.stringify(input.sourceThreadIds),
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        lastUsedAt: input.lastUsedAt,
        useCount: input.useCount,
        disabledAt: input.disabledAt
      });

    return this.getGeneratedMemoryItem(id)!;
  }

  getGeneratedMemoryItem(itemId: string): GeneratedMemoryItem | null {
    const row = this.db.prepare('SELECT * FROM generated_memory_items WHERE id = ?').get(itemId) as Row | undefined;
    return row ? this.mapItem(row) : null;
  }

  listGeneratedMemoryItems(workspaceScopeKey: string): GeneratedMemoryItem[] {
    return this.db
      .prepare('SELECT * FROM generated_memory_items WHERE workspace_scope_key = ? ORDER BY updated_at DESC, created_at DESC')
      .all(workspaceScopeKey)
      .map((row) => this.mapItem(row as Row));
  }

  disableGeneratedMemoryItem(itemId: string, disabledAt: string) {
    this.db
      .prepare('UPDATE generated_memory_items SET disabled_at = ?, updated_at = ? WHERE id = ?')
      .run(disabledAt, disabledAt, itemId);
    return this.getGeneratedMemoryItem(itemId);
  }

  replaceGeneratedMemoryEvidenceForCandidate(
    candidateId: string,
    evidence: Array<{
      workspaceScopeKey: string;
      projectId: string | null;
      sourceThreadId: string;
      sourceTurnIds: string[];
      role: GeneratedMemoryEvidence['role'];
      excerpt: string;
      capturedAt: string;
    }>
  ) {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM generated_memory_evidence WHERE candidate_id = ?').run(candidateId);
      const insert = this.db.prepare(
        `INSERT INTO generated_memory_evidence (
          id, workspace_scope_key, project_id, candidate_id, item_id, source_thread_id, source_turn_ids_json, role, excerpt, captured_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`
      );
      for (const entry of evidence) {
        insert.run(
          randomUUID(),
          entry.workspaceScopeKey,
          entry.projectId,
          candidateId,
          entry.sourceThreadId,
          JSON.stringify(entry.sourceTurnIds),
          entry.role,
          entry.excerpt,
          entry.capturedAt
        );
      }
    });

    transaction();
  }

  replaceGeneratedMemoryEvidenceForItem(
    itemId: string,
    evidence: Array<{
      workspaceScopeKey: string;
      projectId: string | null;
      sourceThreadId: string;
      sourceTurnIds: string[];
      role: GeneratedMemoryEvidence['role'];
      excerpt: string;
      capturedAt: string;
    }>
  ) {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM generated_memory_evidence WHERE item_id = ?').run(itemId);
      const insert = this.db.prepare(
        `INSERT INTO generated_memory_evidence (
          id, workspace_scope_key, project_id, candidate_id, item_id, source_thread_id, source_turn_ids_json, role, excerpt, captured_at
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
      );
      for (const entry of evidence) {
        insert.run(
          randomUUID(),
          entry.workspaceScopeKey,
          entry.projectId,
          itemId,
          entry.sourceThreadId,
          JSON.stringify(entry.sourceTurnIds),
          entry.role,
          entry.excerpt,
          entry.capturedAt
        );
      }
    });

    transaction();
  }

  listGeneratedMemoryEvidenceForCandidate(candidateId: string): GeneratedMemoryEvidence[] {
    return this.db
      .prepare('SELECT * FROM generated_memory_evidence WHERE candidate_id = ? ORDER BY captured_at ASC')
      .all(candidateId)
      .map((row) => this.mapEvidence(row as Row));
  }

  listGeneratedMemoryEvidenceForItem(itemId: string): GeneratedMemoryEvidence[] {
    return this.db
      .prepare('SELECT * FROM generated_memory_evidence WHERE item_id = ? ORDER BY captured_at ASC')
      .all(itemId)
      .map((row) => this.mapEvidence(row as Row));
  }

  clearGeneratedMemoryWorkspaceScope(workspaceScopeKey: string) {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM generated_memory_evidence WHERE workspace_scope_key = ?').run(workspaceScopeKey);
      this.db.prepare('DELETE FROM generated_memory_candidates WHERE workspace_scope_key = ?').run(workspaceScopeKey);
      this.db.prepare('DELETE FROM generated_memory_items WHERE workspace_scope_key = ?').run(workspaceScopeKey);
    });

    transaction();
  }
}
