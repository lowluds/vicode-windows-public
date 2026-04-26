import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

type Row = Record<string, unknown>;

export type VicodeBuildLaneState = {
  projectId: string;
  teamId: string;
  laneId: string;
  threadId: string | null;
  paused: boolean;
  updatedAt: string;
};

export type VicodeBuildEvent = {
  id: string;
  projectId: string;
  teamId: string;
  laneId: string;
  kind: string;
  trigger: string;
  summary: string;
  detail: string | null;
  sourceLaneId: string | null;
  targetLaneId: string | null;
  threadId: string | null;
  runId: string | null;
  createdAt: string;
};

export type VicodeBuildLaneStateInput = {
  projectId: string;
  teamId: string;
  laneId: string;
  threadId?: string | null;
  paused?: boolean;
};

export type VicodeBuildEventInput = {
  projectId: string;
  teamId: string;
  laneId: string;
  kind: string;
  trigger: string;
  summary: string;
  detail?: string | null;
  sourceLaneId?: string | null;
  targetLaneId?: string | null;
  threadId?: string | null;
  runId?: string | null;
};

export class BuildControlRepository {
  constructor(private readonly db: Database.Database) {}

  listVicodeBuildLaneStates(projectId: string): VicodeBuildLaneState[] {
    return this.db
      .prepare(
        `SELECT project_id, team_id, lane_id, thread_id, paused, updated_at
         FROM vicode_build_lanes
         WHERE project_id = ?
         ORDER BY team_id ASC, lane_id ASC`
      )
      .all(projectId)
      .map((row) => this.mapVicodeBuildLaneState(row as Row));
  }

  getVicodeBuildLaneState(
    projectId: string,
    teamId: string,
    laneId: string
  ): VicodeBuildLaneState {
    const row = this.db
      .prepare(
        `SELECT project_id, team_id, lane_id, thread_id, paused, updated_at
         FROM vicode_build_lanes
         WHERE project_id = ? AND team_id = ? AND lane_id = ?`
      )
      .get(projectId, teamId, laneId) as Row | undefined;
    if (!row) {
      return {
        projectId,
        teamId,
        laneId,
        threadId: null,
        paused: false,
        updatedAt: new Date(0).toISOString()
      };
    }
    return this.mapVicodeBuildLaneState(row);
  }

  findVicodeBuildLaneByThread(threadId: string): VicodeBuildLaneState | null {
    const row = this.db
      .prepare(
        `SELECT project_id, team_id, lane_id, thread_id, paused, updated_at
         FROM vicode_build_lanes
         WHERE thread_id = ?`
      )
      .get(threadId) as Row | undefined;
    return row ? this.mapVicodeBuildLaneState(row) : null;
  }

  saveVicodeBuildLaneState(input: VicodeBuildLaneStateInput): VicodeBuildLaneState {
    const current = this.getVicodeBuildLaneState(input.projectId, input.teamId, input.laneId);
    const next: VicodeBuildLaneState = {
      ...current,
      threadId: input.threadId === undefined ? current.threadId : input.threadId,
      paused: input.paused ?? current.paused,
      updatedAt: new Date().toISOString()
    };
    this.db
      .prepare(
        `INSERT INTO vicode_build_lanes (project_id, team_id, lane_id, thread_id, paused, updated_at)
         VALUES (@projectId, @teamId, @laneId, @threadId, @paused, @updatedAt)
         ON CONFLICT(project_id, team_id, lane_id) DO UPDATE SET
           thread_id = excluded.thread_id,
           paused = excluded.paused,
           updated_at = excluded.updated_at`
      )
      .run({
        ...next,
        paused: next.paused ? 1 : 0
      });
    return next;
  }

  listVicodeBuildEvents(input: {
    projectId: string;
    teamId?: string;
    laneId?: string;
    limit?: number;
  }): VicodeBuildEvent[] {
    const clauses = ['project_id = @projectId'];
    if (input.teamId) {
      clauses.push('team_id = @teamId');
    }
    if (input.laneId) {
      clauses.push('lane_id = @laneId');
    }
    const limit = Math.max(1, Math.min(200, input.limit ?? 20));
    const rows = this.db
      .prepare(
        `SELECT id, project_id, team_id, lane_id, kind, trigger_kind, summary, detail, source_lane_id, target_lane_id, thread_id, run_id, created_at
         FROM vicode_build_events
         WHERE ${clauses.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT @limit`
      )
      .all({
        projectId: input.projectId,
        teamId: input.teamId ?? null,
        laneId: input.laneId ?? null,
        limit
      });

    return rows.map((row) => this.mapVicodeBuildEvent(row as Row));
  }

  addVicodeBuildEvent(input: VicodeBuildEventInput): VicodeBuildEvent {
    const event: VicodeBuildEvent = {
      id: randomUUID(),
      projectId: input.projectId,
      teamId: input.teamId,
      laneId: input.laneId,
      kind: input.kind,
      trigger: input.trigger,
      summary: input.summary,
      detail: input.detail ?? null,
      sourceLaneId: input.sourceLaneId ?? null,
      targetLaneId: input.targetLaneId ?? null,
      threadId: input.threadId ?? null,
      runId: input.runId ?? null,
      createdAt: new Date().toISOString()
    };

    this.db
      .prepare(
        `INSERT INTO vicode_build_events (
          id, project_id, team_id, lane_id, kind, trigger_kind, summary, detail, source_lane_id, target_lane_id, thread_id, run_id, created_at
        ) VALUES (
          @id, @projectId, @teamId, @laneId, @kind, @trigger, @summary, @detail, @sourceLaneId, @targetLaneId, @threadId, @runId, @createdAt
        )`
      )
      .run(event);

    return event;
  }

  private mapVicodeBuildLaneState(row: Row): VicodeBuildLaneState {
    return {
      projectId: String(row.project_id),
      teamId: String(row.team_id),
      laneId: String(row.lane_id),
      threadId: (row.thread_id as string | null) ?? null,
      paused: Boolean(row.paused),
      updatedAt: String(row.updated_at)
    };
  }

  private mapVicodeBuildEvent(row: Row): VicodeBuildEvent {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      teamId: String(row.team_id),
      laneId: String(row.lane_id),
      kind: String(row.kind),
      trigger: String(row.trigger_kind),
      summary: String(row.summary),
      detail: (row.detail as string | null) ?? null,
      sourceLaneId: (row.source_lane_id as string | null) ?? null,
      targetLaneId: (row.target_lane_id as string | null) ?? null,
      threadId: (row.thread_id as string | null) ?? null,
      runId: (row.run_id as string | null) ?? null,
      createdAt: String(row.created_at)
    };
  }
}
