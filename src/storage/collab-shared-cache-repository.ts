import Database from 'better-sqlite3';
import type {
  CollabContact,
  CollabHandoff,
  CollabProfile,
  CollabRoleRequest,
  CollabRoomFollower,
  CollabRoomTerminalState,
  CollabSharedRun,
  CollabSharedThread
} from '../shared/domain';

type Row = Record<string, unknown>;

export class CollabSharedCacheRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly mapSharedThread: (row: Row) => CollabSharedThread,
    private readonly mapSharedRun: (row: Row) => CollabSharedRun,
    private readonly mapHandoff: (row: Row) => CollabHandoff,
    private readonly mapFollower: (row: Row) => CollabRoomFollower,
    private readonly mapRoleRequest: (row: Row) => CollabRoleRequest,
    private readonly mapTerminalState: (row: Row) => CollabRoomTerminalState,
    private readonly upsertProfile: (profile: CollabProfile) => CollabProfile,
    private readonly getCurrentUserId: () => string | null
  ) {}

  listCollabSharedThreads(roomId: string): CollabSharedThread[] {
    return this.db
      .prepare(
        `SELECT
          shared.*,
          profiles.display_name
         FROM collab_shared_threads shared
         INNER JOIN collab_profiles profiles ON profiles.id = shared.driver_user_id
         WHERE shared.room_id = ?
         ORDER BY shared.updated_at DESC`
      )
      .all(roomId)
      .map((row) => this.mapSharedThread(row as Row));
  }

  upsertCollabSharedThread(sharedThread: CollabSharedThread): CollabSharedThread {
    this.db
      .prepare(
        `INSERT INTO collab_shared_threads (
          id, room_id, thread_id, project_id, project_label, title, status, driver_user_id, provider_id, model_id, last_prompt_summary, latest_assistant_summary, run_id, created_at, updated_at
        ) VALUES (
          @id, @roomId, @threadId, @projectId, @projectLabel, @title, @status, @driverUserId, @providerId, @modelId, @lastPromptSummary, @latestAssistantSummary, @runId, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          room_id = excluded.room_id,
          thread_id = excluded.thread_id,
          project_id = excluded.project_id,
          project_label = excluded.project_label,
          title = excluded.title,
          status = excluded.status,
          driver_user_id = excluded.driver_user_id,
          provider_id = excluded.provider_id,
          model_id = excluded.model_id,
          last_prompt_summary = excluded.last_prompt_summary,
          latest_assistant_summary = excluded.latest_assistant_summary,
          run_id = excluded.run_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`
      )
      .run({
        id: sharedThread.id,
        roomId: sharedThread.roomId,
        threadId: sharedThread.threadId,
        projectId: sharedThread.projectId,
        projectLabel: sharedThread.projectLabel,
        title: sharedThread.title,
        status: sharedThread.status,
        driverUserId: sharedThread.driverUserId,
        providerId: sharedThread.providerId,
        modelId: sharedThread.modelId,
        lastPromptSummary: sharedThread.lastPromptSummary,
        latestAssistantSummary: sharedThread.latestAssistantSummary,
        runId: sharedThread.runId,
        createdAt: sharedThread.createdAt,
        updatedAt: sharedThread.updatedAt
      });
    return this.listCollabSharedThreads(sharedThread.roomId).find((candidate) => candidate.id === sharedThread.id) ?? sharedThread;
  }

  listCollabSharedRuns(roomId: string): CollabSharedRun[] {
    return this.db
      .prepare(
        `SELECT
          runs.*,
          profiles.display_name
         FROM collab_shared_runs runs
         INNER JOIN collab_profiles profiles ON profiles.id = runs.driver_user_id
         WHERE runs.room_id = ?
         ORDER BY runs.updated_at DESC`
      )
      .all(roomId)
      .map((row) => this.mapSharedRun(row as Row));
  }

  getCollabSharedRunByRunId(runId: string): CollabSharedRun | null {
    const row = this.db
      .prepare(
        `SELECT
          runs.*,
          profiles.display_name
         FROM collab_shared_runs runs
         INNER JOIN collab_profiles profiles ON profiles.id = runs.driver_user_id
         WHERE runs.run_id = ?
         ORDER BY runs.updated_at DESC
         LIMIT 1`
      )
      .get(runId) as Row | undefined;
    return row ? this.mapSharedRun(row) : null;
  }

  upsertCollabSharedRun(sharedRun: CollabSharedRun): CollabSharedRun {
    this.db
      .prepare(
        `INSERT INTO collab_shared_runs (
          id, room_id, thread_id, thread_title, run_id, driver_user_id, provider_id, model_id, execution_permission, status, task_title, summary, changed_files_json, diff_stats_json, tests_summary, result_label, started_at, updated_at, completed_at
        ) VALUES (
          @id, @roomId, @threadId, @threadTitle, @runId, @driverUserId, @providerId, @modelId, @executionPermission, @status, @taskTitle, @summary, @changedFilesJson, @diffStatsJson, @testsSummary, @resultLabel, @startedAt, @updatedAt, @completedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          room_id = excluded.room_id,
          thread_id = excluded.thread_id,
          thread_title = excluded.thread_title,
          run_id = excluded.run_id,
          driver_user_id = excluded.driver_user_id,
          provider_id = excluded.provider_id,
          model_id = excluded.model_id,
          execution_permission = excluded.execution_permission,
          status = excluded.status,
          task_title = excluded.task_title,
          summary = excluded.summary,
          changed_files_json = excluded.changed_files_json,
          diff_stats_json = excluded.diff_stats_json,
          tests_summary = excluded.tests_summary,
          result_label = excluded.result_label,
          started_at = excluded.started_at,
          updated_at = excluded.updated_at,
          completed_at = excluded.completed_at`
      )
      .run({
        id: sharedRun.id,
        roomId: sharedRun.roomId,
        threadId: sharedRun.threadId,
        threadTitle: sharedRun.threadTitle,
        runId: sharedRun.runId,
        driverUserId: sharedRun.driverUserId,
        providerId: sharedRun.providerId,
        modelId: sharedRun.modelId,
        executionPermission: sharedRun.executionPermission,
        status: sharedRun.status,
        taskTitle: sharedRun.taskTitle,
        summary: sharedRun.summary,
        changedFilesJson: JSON.stringify(sharedRun.changedFiles),
        diffStatsJson: sharedRun.diffStats ? JSON.stringify(sharedRun.diffStats) : null,
        testsSummary: sharedRun.testsSummary,
        resultLabel: sharedRun.resultLabel,
        startedAt: sharedRun.startedAt,
        updatedAt: sharedRun.updatedAt,
        completedAt: sharedRun.completedAt
      });
    return this.getCollabSharedRunByRunId(sharedRun.runId) ?? sharedRun;
  }

  listCollabHandoffs(roomId: string): CollabHandoff[] {
    return this.db
      .prepare(
        `SELECT
          handoffs.*,
          profiles.display_name
         FROM collab_handoffs handoffs
         INNER JOIN collab_profiles profiles ON profiles.id = handoffs.author_user_id
         WHERE handoffs.room_id = ?
         ORDER BY handoffs.created_at DESC`
      )
      .all(roomId)
      .map((row) => this.mapHandoff(row as Row));
  }

  upsertCollabHandoff(handoff: CollabHandoff): CollabHandoff {
    this.db
      .prepare(
        `INSERT INTO collab_handoffs (
          id, room_id, thread_id, run_id, author_user_id, title, summary, branch_name, dirty_file_count, staged_file_count, changed_files_json, outstanding_tasks_json, recommended_next_prompt, created_at
        ) VALUES (
          @id, @roomId, @threadId, @runId, @authorUserId, @title, @summary, @branchName, @dirtyFileCount, @stagedFileCount, @changedFilesJson, @outstandingTasksJson, @recommendedNextPrompt, @createdAt
        )
        ON CONFLICT(id) DO UPDATE SET
          room_id = excluded.room_id,
          thread_id = excluded.thread_id,
          run_id = excluded.run_id,
          author_user_id = excluded.author_user_id,
          title = excluded.title,
          summary = excluded.summary,
          branch_name = excluded.branch_name,
          dirty_file_count = excluded.dirty_file_count,
          staged_file_count = excluded.staged_file_count,
          changed_files_json = excluded.changed_files_json,
          outstanding_tasks_json = excluded.outstanding_tasks_json,
          recommended_next_prompt = excluded.recommended_next_prompt,
          created_at = excluded.created_at`
      )
      .run({
        id: handoff.id,
        roomId: handoff.roomId,
        threadId: handoff.threadId,
        runId: handoff.runId,
        authorUserId: handoff.authorUserId,
        title: handoff.title,
        summary: handoff.summary,
        branchName: handoff.branchName,
        dirtyFileCount: handoff.dirtyFileCount,
        stagedFileCount: handoff.stagedFileCount,
        changedFilesJson: JSON.stringify(handoff.changedFiles),
        outstandingTasksJson: JSON.stringify(handoff.outstandingTasks),
        recommendedNextPrompt: handoff.recommendedNextPrompt,
        createdAt: handoff.createdAt
      });
    return this.listCollabHandoffs(handoff.roomId).find((candidate) => candidate.id === handoff.id) ?? handoff;
  }

  listCollabRoomFollowers(roomId: string): CollabRoomFollower[] {
    return this.db
      .prepare(
        `SELECT
          followers.*,
          profiles.display_name,
          profiles.handle,
          profiles.avatar_url,
          profiles.status
         FROM collab_room_followers followers
         INNER JOIN collab_profiles profiles ON profiles.id = followers.user_id
         WHERE followers.room_id = ?
         ORDER BY followers.created_at DESC, profiles.display_name COLLATE NOCASE ASC`
      )
      .all(roomId)
      .map((row) => this.mapFollower(row as Row));
  }

  replaceCollabRoomFollowers(roomId: string, followers: CollabRoomFollower[]) {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM collab_room_followers WHERE room_id = ?').run(roomId);
      const insert = this.db.prepare(
        `INSERT INTO collab_room_followers (room_id, user_id, created_at)
         VALUES (@roomId, @userId, @createdAt)`
      );
      for (const follower of followers) {
        const now = new Date().toISOString();
        this.upsertProfile({
          id: follower.userId,
          email: null,
          displayName: follower.displayName,
          handle: follower.handle,
          avatarUrl: follower.avatarUrl,
          status: follower.status,
          bio: null,
          timezone: null,
          createdAt: now,
          updatedAt: now
        });
        insert.run({
          roomId: follower.roomId,
          userId: follower.userId,
          createdAt: follower.createdAt
        });
      }
    });
    transaction();
  }

  listCollabRoleRequests(roomId: string): CollabRoleRequest[] {
    return this.db
      .prepare(
        `SELECT
          requests.*,
          profiles.display_name,
          profiles.handle
         FROM collab_role_requests requests
         INNER JOIN collab_profiles profiles ON profiles.id = requests.requester_user_id
         WHERE requests.room_id = ?
         ORDER BY requests.updated_at DESC, requests.created_at DESC`
      )
      .all(roomId)
      .map((row) => this.mapRoleRequest(row as Row));
  }

  upsertCollabRoleRequest(request: CollabRoleRequest): CollabRoleRequest {
    this.db
      .prepare(
        `INSERT INTO collab_role_requests (
          id, room_id, requester_user_id, requested_role, status, resolved_by_user_id, created_at, updated_at
        ) VALUES (
          @id, @roomId, @requesterUserId, @requestedRole, @status, @resolvedByUserId, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          room_id = excluded.room_id,
          requester_user_id = excluded.requester_user_id,
          requested_role = excluded.requested_role,
          status = excluded.status,
          resolved_by_user_id = excluded.resolved_by_user_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`
      )
      .run({
        id: request.id,
        roomId: request.roomId,
        requesterUserId: request.requesterUserId,
        requestedRole: request.requestedRole,
        status: request.status,
        resolvedByUserId: request.resolvedByUserId,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt
      });
    return this.listCollabRoleRequests(request.roomId).find((candidate) => candidate.id === request.id) ?? request;
  }

  replaceCollabRoleRequests(roomId: string, requests: CollabRoleRequest[]) {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM collab_role_requests WHERE room_id = ?').run(roomId);
      for (const request of requests) {
        this.upsertCollabRoleRequest(request);
      }
    });
    transaction();
  }

  getCollabRoomTerminalState(roomId: string): CollabRoomTerminalState | null {
    const row = this.db
      .prepare(
        `SELECT
          terminal.*,
          profiles.display_name
         FROM collab_room_terminal_states terminal
         LEFT JOIN collab_profiles profiles ON profiles.id = terminal.enabled_by_user_id
         WHERE terminal.room_id = ?`
      )
      .get(roomId) as Row | undefined;
    return row ? this.mapTerminalState(row) : null;
  }

  upsertCollabRoomTerminalState(state: CollabRoomTerminalState): CollabRoomTerminalState {
    this.db
      .prepare(
        `INSERT INTO collab_room_terminal_states (
          room_id, mode, enabled_by_user_id, note, updated_at
        ) VALUES (
          @roomId, @mode, @enabledByUserId, @note, @updatedAt
        )
        ON CONFLICT(room_id) DO UPDATE SET
          mode = excluded.mode,
          enabled_by_user_id = excluded.enabled_by_user_id,
          note = excluded.note,
          updated_at = excluded.updated_at`
      )
      .run({
        roomId: state.roomId,
        mode: state.mode,
        enabledByUserId: state.enabledByUserId,
        note: state.note,
        updatedAt: state.updatedAt
      });
    return this.getCollabRoomTerminalState(state.roomId) ?? state;
  }

  clearCollabRoomTerminalState(roomId: string) {
    this.db.prepare('DELETE FROM collab_room_terminal_states WHERE room_id = ?').run(roomId);
  }

  listCollabContacts(): CollabContact[] {
    const currentUserId = this.getCurrentUserId();
    const rows = this.db
      .prepare(
        `SELECT
          profiles.id,
          profiles.display_name,
          profiles.handle,
          profiles.avatar_url,
          profiles.status,
          (
            SELECT members.room_id
            FROM collab_room_members members
            WHERE members.user_id = profiles.id
            ORDER BY members.updated_at DESC
            LIMIT 1
          ) AS last_room_id,
          (
            SELECT rooms.name
            FROM collab_room_members members
            INNER JOIN collab_rooms rooms ON rooms.id = members.room_id
            WHERE members.user_id = profiles.id
            ORDER BY members.updated_at DESC
            LIMIT 1
          ) AS last_room_name
         FROM collab_profiles profiles
         ORDER BY profiles.display_name COLLATE NOCASE ASC`
      )
      .all() as Row[];

    return rows
      .filter((row) => !currentUserId || String(row.id) !== currentUserId)
      .map((row) => ({
        userId: String(row.id),
        displayName: String(row.display_name),
        handle: (row.handle as string | null) ?? null,
        avatarUrl: (row.avatar_url as string | null) ?? null,
        status: row.status as CollabContact['status'],
        lastRoomId: (row.last_room_id as string | null) ?? null,
        lastRoomName: (row.last_room_name as string | null) ?? null
      }));
  }
}
