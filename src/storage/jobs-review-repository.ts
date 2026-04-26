import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type {
  JobDefinition,
  JobRun,
  ProviderId,
  ReviewItem
} from '../shared/domain';

type Row = Record<string, unknown>;

export class JobsReviewRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly mapJob: (row: Row) => JobDefinition,
    private readonly mapJobRun: (row: Row) => JobRun,
    private readonly mapReviewItem: (row: Row) => ReviewItem
  ) {}

  listJobs(): JobDefinition[] {
    return this.db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC').all().map((row) => this.mapJob(row as Row));
  }

  listJobsForThread(threadId: string): JobDefinition[] {
    return this.db
      .prepare(
        `SELECT * FROM jobs
         WHERE thread_id = ?
         ORDER BY updated_at DESC`
      )
      .all(threadId)
      .map((row) => this.mapJob(row as Row));
  }

  getJob(jobId: string): JobDefinition {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Row | undefined;
    if (!row) {
      throw new Error(`Job not found: ${jobId}`);
    }
    return this.mapJob(row);
  }

  saveJob(input: {
    id?: string;
    projectId: string;
    sourceType: JobDefinition['sourceType'];
    sourceId?: string | null;
    title: string;
    status: JobDefinition['status'];
    threadId?: string | null;
  }): JobDefinition {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const exists = input.id ? this.db.prepare('SELECT id FROM jobs WHERE id = ?').get(input.id) : undefined;
    if (exists) {
      this.db
        .prepare(
          `UPDATE jobs
           SET project_id = @projectId,
               source_type = @sourceType,
               source_id = @sourceId,
               title = @title,
               status = @status,
               thread_id = @threadId,
               updated_at = @updatedAt
           WHERE id = @id`
        )
        .run({
          id,
          projectId: input.projectId,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          title: input.title,
          status: input.status,
          threadId: input.threadId ?? null,
          updatedAt: now
        });
    } else {
      this.db
        .prepare(
          `INSERT INTO jobs (
            id, project_id, source_type, source_id, title, status, thread_id, created_at, updated_at
          ) VALUES (
            @id, @projectId, @sourceType, @sourceId, @title, @status, @threadId, @createdAt, @updatedAt
          )`
        )
        .run({
          id,
          projectId: input.projectId,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          title: input.title,
          status: input.status,
          threadId: input.threadId ?? null,
          createdAt: now,
          updatedAt: now
        });
    }
    return this.getJob(id);
  }

  findActiveJobForSource(sourceType: JobDefinition['sourceType'], sourceId: string): JobDefinition | null {
    const row = this.db
      .prepare(
        `SELECT * FROM jobs
         WHERE source_type = ?
           AND source_id = ?
           AND status IN ('queued', 'running', 'waiting_for_review', 'paused', 'resumed')
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(sourceType, sourceId) as Row | undefined;
    return row ? this.mapJob(row) : null;
  }

  addJobRun(input: {
    jobId: string;
    providerId?: ProviderId | null;
    modelId?: string | null;
    status: JobRun['status'];
    runId?: string | null;
    checkpoint?: Record<string, unknown> | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  }): JobRun {
    const run: JobRun = {
      id: randomUUID(),
      jobId: input.jobId,
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
      status: input.status,
      runId: input.runId ?? null,
      checkpoint: input.checkpoint ?? null,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null,
      createdAt: new Date().toISOString()
    };
    this.db
      .prepare(
        `INSERT INTO job_runs (
          id, job_id, provider_id, model_id, status, run_id, checkpoint_json, started_at, finished_at, created_at
        ) VALUES (
          @id, @jobId, @providerId, @modelId, @status, @runId, @checkpointJson, @startedAt, @finishedAt, @createdAt
        )`
      )
      .run({
        ...run,
        checkpointJson: run.checkpoint ? JSON.stringify(run.checkpoint) : null
      });
    return run;
  }

  getJobRun(jobRunId: string): JobRun {
    const row = this.db.prepare('SELECT * FROM job_runs WHERE id = ?').get(jobRunId) as Row | undefined;
    if (!row) {
      throw new Error(`Job run not found: ${jobRunId}`);
    }
    return this.mapJobRun(row);
  }

  updateJobRun(jobRunId: string, input: {
    status?: JobRun['status'];
    runId?: string | null;
    checkpoint?: Record<string, unknown> | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  }): JobRun {
    const current = this.getJobRun(jobRunId);
    const next: JobRun = {
      ...current,
      ...input
    };
    this.db
      .prepare(
        `UPDATE job_runs
         SET status = @status,
             run_id = @linkedRunId,
             checkpoint_json = @checkpointJson,
             started_at = @startedAt,
             finished_at = @finishedAt
         WHERE id = @id`
      )
      .run({
        id: next.id,
        status: next.status,
        linkedRunId: next.runId,
        checkpointJson: next.checkpoint ? JSON.stringify(next.checkpoint) : null,
        startedAt: next.startedAt,
        finishedAt: next.finishedAt
      });
    return this.getJobRun(next.id);
  }

  findJobRunByProviderRunId(providerRunId: string): JobRun | null {
    const row = this.db.prepare('SELECT * FROM job_runs WHERE run_id = ? ORDER BY created_at DESC LIMIT 1').get(providerRunId) as Row | undefined;
    return row ? this.mapJobRun(row) : null;
  }

  listPendingReviewItems(): ReviewItem[] {
    return this.db.prepare("SELECT * FROM review_items WHERE status = 'pending' ORDER BY updated_at DESC").all().map((row) => this.mapReviewItem(row as Row));
  }

  getReviewItem(reviewItemId: string): ReviewItem {
    const row = this.db.prepare('SELECT * FROM review_items WHERE id = ?').get(reviewItemId) as Row | undefined;
    if (!row) {
      throw new Error(`Review item not found: ${reviewItemId}`);
    }
    return this.mapReviewItem(row);
  }

  addReviewItem(input: {
    jobId: string;
    jobRunId?: string | null;
    kind: ReviewItem['kind'];
    status?: ReviewItem['status'];
    summary: string;
    details: Record<string, unknown>;
  }): ReviewItem {
    const now = new Date().toISOString();
    const review: ReviewItem = {
      id: randomUUID(),
      jobId: input.jobId,
      jobRunId: input.jobRunId ?? null,
      kind: input.kind,
      status: input.status ?? 'pending',
      summary: input.summary,
      details: input.details,
      decision: null,
      createdAt: now,
      updatedAt: now
    };
    this.db
      .prepare(
        `INSERT INTO review_items (
          id, job_id, job_run_id, kind, status, summary, details_json, decision_json, created_at, updated_at
        ) VALUES (
          @id, @jobId, @jobRunId, @kind, @status, @summary, @detailsJson, @decisionJson, @createdAt, @updatedAt
        )`
      )
      .run({
        ...review,
        detailsJson: JSON.stringify(review.details),
        decisionJson: null
      });
    return review;
  }

  updateReviewItem(reviewItemId: string, input: {
    status?: ReviewItem['status'];
    decision?: Record<string, unknown> | null;
    jobRunId?: string | null;
    details?: Record<string, unknown>;
  }): ReviewItem {
    const current = this.getReviewItem(reviewItemId);
    const next: ReviewItem = {
      ...current,
      details: input.details ?? current.details,
      ...input,
      updatedAt: new Date().toISOString()
    };
    this.db
      .prepare(
        `UPDATE review_items
         SET job_run_id = @jobRunId,
             status = @status,
             details_json = @detailsJson,
             decision_json = @decisionJson,
             updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({
        id: next.id,
        jobRunId: next.jobRunId,
        status: next.status,
        detailsJson: JSON.stringify(next.details),
        decisionJson: next.decision ? JSON.stringify(next.decision) : null,
        updatedAt: next.updatedAt
      });
    return this.getReviewItem(reviewItemId);
  }
}
