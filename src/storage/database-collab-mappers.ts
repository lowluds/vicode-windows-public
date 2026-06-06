import type {
  CollabHandoff,
  CollabMessage,
  CollabPresence,
  CollabProfile,
  CollabRoleRequest,
  CollabRoom,
  CollabRoomFollower,
  CollabRoomMember,
  CollabRoomTerminalState,
  CollabSharedRun,
  CollabSharedThread,
  ExecutionPermission,
  ProviderId
} from '../shared/domain';

type Row = Record<string, unknown>;

export function mapCollabProfile(row: Row): CollabProfile {
  return {
    id: String(row.id),
    email: (row.email as string | null) ?? null,
    displayName: String(row.display_name),
    handle: (row.handle as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    status: row.status as CollabProfile["status"],
    bio: (row.bio as string | null) ?? null,
    timezone: (row.timezone as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapCollabRoom(row: Row): CollabRoom {
  return {
    id: String(row.id),
    type: row.type as CollabRoom["type"],
    name: String(row.name),
    joinCode: (row.join_code as string | null) ?? null,
    slug: (row.slug as string | null) ?? null,
    topic: (row.topic as string | null) ?? null,
    projectLabel: (row.project_label as string | null) ?? null,
    directUserId: (row.direct_user_id as string | null) ?? null,
    unreadCount: Number(row.unread_count ?? 0),
    memberCount: Number(row.member_count ?? 0),
    lastActivityAt: String(row.last_activity_at),
    lastMessagePreview: (row.last_message_preview as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapCollabRoomMember(row: Row): CollabRoomMember {
  return {
    roomId: String(row.room_id),
    userId: String(row.user_id),
    role: row.role as CollabRoomMember["role"],
    membershipState:
      row.membership_state as CollabRoomMember["membershipState"],
    joinedAt: (row.joined_at as string | null) ?? null,
    displayName: String(row.display_name),
    handle: (row.handle as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    status: row.status as CollabRoomMember["status"],
  };
}

export function mapCollabInvite(row: Row) {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    code: String(row.code),
    status: row.status as "active" | "redeemed" | "expired" | "revoked",
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    expiresAt: (row.expires_at as string | null) ?? null,
  };
}

export function mapCollabMessage(row: Row): CollabMessage {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    authorId: String(row.author_id),
    authorDisplayName: String(row.display_name),
    authorHandle: (row.handle as string | null) ?? null,
    body: String(row.body),
    createdAt: String(row.created_at),
  };
}

export function mapCollabPresence(row: Row): CollabPresence {
  return {
    roomId: String(row.room_id),
    userId: String(row.user_id),
    status: row.status as CollabPresence["status"],
    currentThreadId: (row.current_thread_id as string | null) ?? null,
    currentThreadTitle: (row.current_thread_title as string | null) ?? null,
    branchName: (row.branch_name as string | null) ?? null,
    worktreeName: (row.worktree_name as string | null) ?? null,
    activeRunId: (row.active_run_id as string | null) ?? null,
    activeRunTitle: (row.active_run_title as string | null) ?? null,
    dirtyFileCount: Number(row.dirty_file_count ?? 0),
    stagedFileCount: Number(row.staged_file_count ?? 0),
    updatedAt: String(row.updated_at),
  };
}

export function mapCollabSharedThread(row: Row): CollabSharedThread {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    threadId: String(row.thread_id),
    projectId: (row.project_id as string | null) ?? null,
    projectLabel: (row.project_label as string | null) ?? null,
    title: String(row.title),
    status: row.status as CollabSharedThread["status"],
    driverUserId: String(row.driver_user_id),
    driverDisplayName: String(row.display_name),
    providerId: row.provider_id as ProviderId,
    modelId: String(row.model_id),
    lastPromptSummary: (row.last_prompt_summary as string | null) ?? null,
    latestAssistantSummary:
      (row.latest_assistant_summary as string | null) ?? null,
    runId: (row.run_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapCollabSharedRun(row: Row): CollabSharedRun {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    threadId: String(row.thread_id),
    threadTitle: String(row.thread_title),
    runId: String(row.run_id),
    driverUserId: String(row.driver_user_id),
    driverDisplayName: String(row.display_name),
    providerId: row.provider_id as ProviderId,
    modelId: String(row.model_id),
    executionPermission: row.execution_permission as ExecutionPermission,
    status: row.status as CollabSharedRun["status"],
    taskTitle: (row.task_title as string | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    changedFiles: JSON.parse(String(row.changed_files_json)) as string[],
    diffStats: row.diff_stats_json
      ? (JSON.parse(
          String(row.diff_stats_json),
        ) as CollabSharedRun["diffStats"])
      : null,
    testsSummary: (row.tests_summary as string | null) ?? null,
    resultLabel: (row.result_label as string | null) ?? null,
    startedAt: String(row.started_at),
    updatedAt: String(row.updated_at),
    completedAt: (row.completed_at as string | null) ?? null,
  };
}

export function mapCollabHandoff(row: Row): CollabHandoff {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    threadId: String(row.thread_id),
    runId: (row.run_id as string | null) ?? null,
    authorUserId: String(row.author_user_id),
    authorDisplayName: String(row.display_name),
    title: String(row.title),
    summary: String(row.summary),
    branchName: (row.branch_name as string | null) ?? null,
    dirtyFileCount: Number(row.dirty_file_count ?? 0),
    stagedFileCount: Number(row.staged_file_count ?? 0),
    changedFiles: JSON.parse(String(row.changed_files_json)) as string[],
    outstandingTasks: JSON.parse(
      String(row.outstanding_tasks_json),
    ) as string[],
    recommendedNextPrompt:
      (row.recommended_next_prompt as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export function mapCollabRoomFollower(row: Row): CollabRoomFollower {
  return {
    roomId: String(row.room_id),
    userId: String(row.user_id),
    displayName: String(row.display_name),
    handle: (row.handle as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    status: row.status as CollabRoomFollower["status"],
    createdAt: String(row.created_at),
  };
}

export function mapCollabRoleRequest(row: Row): CollabRoleRequest {
  return {
    id: String(row.id),
    roomId: String(row.room_id),
    requesterUserId: String(row.requester_user_id),
    requesterDisplayName: String(row.display_name),
    requesterHandle: (row.handle as string | null) ?? null,
    requestedRole: row.requested_role as CollabRoleRequest["requestedRole"],
    status: row.status as CollabRoleRequest["status"],
    resolvedByUserId: (row.resolved_by_user_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function mapCollabRoomTerminalState(row: Row): CollabRoomTerminalState {
  return {
    roomId: String(row.room_id),
    mode: row.mode as CollabRoomTerminalState["mode"],
    enabledByUserId: (row.enabled_by_user_id as string | null) ?? null,
    enabledByDisplayName: (row.display_name as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    updatedAt: String(row.updated_at),
  };
}
