import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type {
  CollabAccount,
  CollabConfig,
  CollabHandoff,
  CollabMessage,
  CollabPresence,
  CollabPresenceStatus,
  CollabProfile,
  CollabRoleRequest,
  CollabRoom,
  CollabRoomFollower,
  CollabRoomMember,
  CollabRoomSession,
  CollabRoomTerminalState,
  CollabSharedRun,
  CollabSharedThread,
  ExecutionPermission,
  ProviderId,
  RunDiffStats
} from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import { DatabaseService } from '../../storage/database';

type RoomRow = {
  id: string;
  type: CollabRoom['type'];
  name: string;
  join_code: string | null;
  slug: string | null;
  topic: string | null;
  project_label: string | null;
  direct_user_id: string | null;
  unread_count?: number | null;
  member_count?: number | null;
  last_activity_at: string;
  last_message_preview: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  status: CollabPresenceStatus;
  bio: string | null;
  timezone: string | null;
  created_at: string;
  updated_at: string;
};

type MemberRow = {
  room_id: string;
  user_id: string;
  role: CollabRoomMember['role'];
  membership_state: CollabRoomMember['membershipState'];
  joined_at: string | null;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  status: CollabPresenceStatus;
};

type MessageRow = {
  id: string;
  room_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

type SharedThreadRow = {
  id: string;
  room_id: string;
  thread_id: string;
  project_id: string | null;
  project_label: string | null;
  title: string;
  status: CollabSharedThread['status'];
  driver_user_id: string;
  provider_id: ProviderId;
  model_id: string;
  last_prompt_summary: string | null;
  latest_assistant_summary: string | null;
  run_id: string | null;
  created_at: string;
  updated_at: string;
};

type SharedRunRow = {
  id: string;
  room_id: string;
  thread_id: string;
  thread_title: string;
  run_id: string;
  driver_user_id: string;
  provider_id: ProviderId;
  model_id: string;
  execution_permission: ExecutionPermission;
  status: CollabSharedRun['status'];
  task_title: string | null;
  summary: string | null;
  changed_files_json: string[];
  diff_stats_json: RunDiffStats | null;
  tests_summary: string | null;
  result_label: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

type HandoffRow = {
  id: string;
  room_id: string;
  thread_id: string;
  run_id: string | null;
  author_user_id: string;
  title: string;
  summary: string;
  branch_name: string | null;
  dirty_file_count: number;
  staged_file_count: number;
  changed_files_json: string[];
  outstanding_tasks_json: string[];
  recommended_next_prompt: string | null;
  created_at: string;
};

type FollowerRow = {
  room_id: string;
  user_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  status: CollabPresenceStatus;
  created_at: string;
};

type RoleRequestRow = {
  id: string;
  room_id: string;
  requester_user_id: string;
  display_name: string;
  handle: string | null;
  requested_role: CollabRoleRequest['requestedRole'];
  status: CollabRoleRequest['status'];
  resolved_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type TerminalStateRow = {
  room_id: string;
  mode: CollabRoomTerminalState['mode'];
  enabled_by_user_id: string | null;
  enabled_by_display_name: string | null;
  note: string | null;
  updated_at: string;
};

type RoomSnapshot = {
  room: RoomRow;
  members: MemberRow[];
  messages: MessageRow[];
  shared_threads: SharedThreadRow[];
  shared_runs: SharedRunRow[];
  handoffs: HandoffRow[];
  followers: FollowerRow[];
  role_requests: RoleRequestRow[];
  terminal_state: TerminalStateRow | null;
};

type RoomAccessResult = {
  room_id: string;
  room_name: string;
  room_type?: CollabRoom['type'];
  join_code: string | null;
  user_id: string;
  session_token: string;
};

type DirectRoomPeer = {
  userId: string;
  displayName: string;
  handle: string | null;
} | null;

type PresencePayload = Omit<CollabPresence, 'roomId' | 'userId'> & {
  roomId: string;
  userId: string;
};

type CollaborationLifecycleEntry = {
  recordedAt: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  connectionState: CollabConfig['connectionState'];
  userId: string | null;
  channelCount: number;
  activeRoomIds: string[];
  [key: string]: unknown;
};

const COLLAB_LIFECYCLE_LIMIT = 200;

function summarizeProgress(event: Extract<AppEvent, { type: 'run.progress' }>) {
  const activeItem = event.progress.items.find((item) => item.status === 'in_progress') ?? event.progress.items.at(-1) ?? null;
  return activeItem?.label ?? event.progress.title ?? null;
}

export class CollaborationService {
  private readonly emitter = new EventEmitter();
  private client: SupabaseClient | null = null;
  private readonly channels = new Map<string, RealtimeChannel>();
  private readonly pendingPresence = new Map<string, CollabPresence>();
  private readonly lifecycleEvents: CollaborationLifecycleEntry[] = [];
  private disposed = false;
  private syncing = false;
  private readonly lastRunPublishAt = new Map<string, number>();

  constructor(private readonly db: DatabaseService) {}

  onEvent(listener: (event: AppEvent) => void) {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  private describeError(error: unknown) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack ?? null
      };
    }

    return {
      message: String(error)
    };
  }

  private logLifecycle(event: string, details: Record<string, unknown> = {}, level: 'info' | 'warn' | 'error' = 'info') {
    this.lifecycleEvents.push({
      recordedAt: new Date().toISOString(),
      event,
      level,
      connectionState: this.db.getCollabConfig().connectionState,
      userId: this.db.getCollabAccount().userId,
      channelCount: this.channels.size,
      activeRoomIds: [...this.channels.keys()],
      ...details
    });
    if (this.lifecycleEvents.length > COLLAB_LIFECYCLE_LIMIT) {
      this.lifecycleEvents.splice(0, this.lifecycleEvents.length - COLLAB_LIFECYCLE_LIMIT);
    }
  }

  async initialize() {
    this.logLifecycle('initialize.start');
    const config = this.db.getCollabServiceConfig();
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      this.logLifecycle('initialize.unconfigured');
      this.emit({ type: 'collab.connectionChanged', config: this.db.getCollabConfig() });
      return;
    }

    this.createClient(config.supabaseUrl, config.supabaseAnonKey);
    if (!this.db.getCollabAccount().userId) {
      this.db.setCollabConnectionState('identity_required');
      this.logLifecycle('initialize.identity_required');
      this.emit({ type: 'collab.connectionChanged', config: this.db.getCollabConfig() });
      return;
    }

    await this.syncFromRemote();
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const channel of this.channels.values()) {
      void channel.unsubscribe();
    }
    this.channels.clear();
    this.pendingPresence.clear();
    this.lastRunPublishAt.clear();
    this.client = null;
    this.emitter.removeAllListeners('event');
    this.logLifecycle('dispose');
  }

  getBootstrap() {
    return this.db.getCollabBootstrap();
  }

  async configure(input: { supabaseUrl: string; supabaseAnonKey: string }) {
    this.logLifecycle('configure.start');
    this.db.saveCollabConfig(input);
    await this.recreateClient();
    if (this.db.getCollabAccount().userId) {
      await this.syncFromRemote();
    } else {
      this.db.setCollabConnectionState('identity_required');
      this.logLifecycle('configure.identity_required');
      this.emit({ type: 'collab.connectionChanged', config: this.db.getCollabConfig() });
    }
    this.logLifecycle('configure.complete');
    return this.db.getCollabConfig();
  }

  async clearConfig() {
    this.logLifecycle('config.clear.start');
    for (const channel of this.channels.values()) {
      await channel.unsubscribe();
    }
    this.channels.clear();
    this.pendingPresence.clear();
    this.client = null;
    const config = this.db.clearCollabConfig();
    this.emit({ type: 'collab.connectionChanged', config });
    this.emit({ type: 'collab.profileUpdated', profile: null });
    this.emit({ type: 'collab.roomsUpdated', rooms: [] });
    this.logLifecycle('config.clear.complete');
    return config;
  }

  async clearIdentity() {
    this.logLifecycle('identity.clear.start');
    for (const channel of this.channels.values()) {
      await channel.unsubscribe();
    }
    this.channels.clear();
    this.pendingPresence.clear();
    this.db.setCollabIdentity({
      userId: null,
      connectionState: this.db.getCollabConfig().hasAnonKey ? 'identity_required' : 'unconfigured'
    });
    this.db.clearCollabCache();
    this.emit({ type: 'collab.connectionChanged', config: this.db.getCollabConfig() });
    this.emit({ type: 'collab.profileUpdated', profile: null });
    this.emit({ type: 'collab.roomsUpdated', rooms: [] });
    this.logLifecycle('identity.clear.complete');
    return this.db.getCollabAccount();
  }

  async createGuestProfile(input: { displayName: string; handle?: string | null; avatarUrl?: string | null }) {
    const row = await this.callRpc<ProfileRow>('create_guest_profile', {
      input_display_name: input.displayName,
      input_handle: input.handle ?? null,
      input_avatar_url: input.avatarUrl ?? null
    });
    const profile = this.mapRemoteProfile(row);
    this.db.upsertCollabProfile(profile);
    this.db.setCollabIdentity({ userId: profile.id, connectionState: 'connected' });
    this.emit({ type: 'collab.profileUpdated', profile });
    this.emit({ type: 'collab.connectionChanged', config: this.db.getCollabConfig() });
    this.logLifecycle('profile.created', { profileId: profile.id });
    return profile;
  }

  async updateProfile(input: {
    displayName?: string;
    handle?: string | null;
    avatarUrl?: string | null;
    bio?: string | null;
    timezone?: string | null;
    status?: CollabPresenceStatus;
  }) {
    const profile = this.requireProfile();
    const row = await this.callRpc<ProfileRow>('update_guest_profile', {
      target_profile_id: profile.id,
      input_display_name: input.displayName ?? profile.displayName,
      input_handle: input.handle === undefined ? profile.handle : input.handle,
      input_avatar_url: input.avatarUrl === undefined ? profile.avatarUrl : input.avatarUrl,
      input_bio: input.bio === undefined ? profile.bio : input.bio,
      input_timezone: input.timezone === undefined ? profile.timezone : input.timezone,
      input_status: input.status ?? profile.status
    });
    const next = this.mapRemoteProfile(row);
    this.db.upsertCollabProfile(next);
    this.emit({ type: 'collab.profileUpdated', profile: next });
    return next;
  }

  async createRoom(input: { name: string; password?: string | null; topic?: string | null; projectLabel?: string | null }) {
    const profile = this.requireProfile();
    const password = input.password?.trim() || null;
    const result = await this.callRpc<RoomAccessResult>('create_room_with_password', {
      creator_profile_id: profile.id,
      room_name: input.name,
      room_password: password,
      room_topic: input.topic ?? null,
      room_project_label: input.projectLabel ?? null
    });
    this.persistRoomAccess({
      roomId: result.room_id,
      userId: result.user_id,
      sessionToken: result.session_token,
      type: 'project',
      name: result.room_name,
      joinCode: result.join_code,
      topic: input.topic ?? null,
      projectLabel: input.projectLabel ?? null,
      createdBy: profile.id
    });
    await this.refreshRoom(result.room_id);
    this.emit({ type: 'collab.roomsUpdated', rooms: this.db.listCollabRooms() });
    this.logLifecycle('room.created', { roomId: result.room_id, roomName: result.room_name, hasPassword: Boolean(password) });
    return this.db.getCollabRoom(result.room_id);
  }

  async joinRoom(input: { joinCode: string; password?: string | null }) {
    const profile = this.requireProfile();
    const password = input.password?.trim() || null;
    const result = await this.callRpc<RoomAccessResult>('join_room_with_password', {
      target_join_code: input.joinCode,
      room_password: password,
      joining_profile_id: profile.id
    });
    this.persistRoomAccess({
      roomId: result.room_id,
      userId: result.user_id,
      sessionToken: result.session_token,
      type: 'project',
      name: result.room_name,
      joinCode: result.join_code,
      topic: null,
      projectLabel: null,
      createdBy: null
    });
    await this.refreshRoom(result.room_id);
    this.emit({ type: 'collab.roomsUpdated', rooms: this.db.listCollabRooms() });
    this.logLifecycle('room.joined', { roomId: result.room_id, joinCode: result.join_code, hasPassword: Boolean(password) });
    return this.db.getCollabRoom(result.room_id);
  }

  async createDirectChat(input: { peerUserId: string }) {
    const profile = this.requireProfile();
    const result = await this.callRpc<RoomAccessResult>('create_direct_chat', {
      creator_profile_id: profile.id,
      peer_profile_id: input.peerUserId
    });
    this.persistRoomAccess({
      roomId: result.room_id,
      userId: result.user_id,
      sessionToken: result.session_token,
      type: result.room_type ?? 'dm',
      name: result.room_name,
      joinCode: result.join_code,
      topic: null,
      projectLabel: null,
      createdBy: null
    });
    await this.refreshRoom(result.room_id);
    this.emit({ type: 'collab.roomsUpdated', rooms: this.db.listCollabRooms() });
    this.logLifecycle('chat.direct.created', { roomId: result.room_id, peerUserId: input.peerUserId });
    return this.db.getCollabRoom(result.room_id);
  }

  async setFollowing(input: { roomId: string; following: boolean }) {
    const session = this.requireRoomSession(input.roomId);
    await this.callRpc<null>('set_room_following', {
      target_room_id: input.roomId,
      target_user_id: session.userId,
      target_session_token: session.sessionToken,
      should_follow: input.following
    });
    await this.refreshRoom(input.roomId);
    await this.broadcastRoomRefresh(input.roomId, input.following ? 'follower.added' : 'follower.removed');
    return this.db.listCollabRoomFollowers(input.roomId);
  }

  async requestRole(input: { roomId: string; requestedRole: 'contributor' | 'driver' }) {
    const session = this.requireRoomSession(input.roomId);
    const row = await this.callRpc<{ id: string }>('request_room_role', {
      target_room_id: input.roomId,
      target_user_id: session.userId,
      target_session_token: session.sessionToken,
      requested_role: input.requestedRole
    });
    await this.refreshRoom(input.roomId);
    await this.broadcastRoomRefresh(input.roomId, 'role.requested');
    const request = this.db.listCollabRoleRequests(input.roomId).find((candidate) => candidate.id === row.id);
    if (!request) {
      throw new Error('Role request was not available after synchronization.');
    }
    return request;
  }

  async resolveRoleRequest(input: { roomId: string; requestId: string; status: 'approved' | 'declined' }) {
    const session = this.requireRoomSession(input.roomId);
    const row = await this.callRpc<{ id: string }>('respond_room_role_request', {
      target_room_id: input.roomId,
      target_user_id: session.userId,
      target_session_token: session.sessionToken,
      target_request_id: input.requestId,
      next_status: input.status
    });
    await this.refreshRoom(input.roomId);
    await this.broadcastRoomRefresh(input.roomId, `role.${input.status}`);
    const request = this.db.listCollabRoleRequests(input.roomId).find((candidate) => candidate.id === row.id);
    if (!request) {
      throw new Error('Role request was not available after synchronization.');
    }
    return request;
  }

  async setTerminalMode(input: { roomId: string; mode: 'off' | 'announce_only'; note?: string | null }) {
    const session = this.requireRoomSession(input.roomId);
    await this.callRpc<null>('set_room_terminal_mode', {
      target_room_id: input.roomId,
      target_user_id: session.userId,
      target_session_token: session.sessionToken,
      next_mode: input.mode,
      terminal_note: input.note ?? null
    });
    await this.refreshRoom(input.roomId);
    await this.broadcastRoomRefresh(input.roomId, input.mode === 'off' ? 'terminal.off' : 'terminal.on');
    return this.db.getCollabRoomTerminalState(input.roomId);
  }

  async listRooms() {
    if (this.db.getCollabConfig().connectionState === 'connected') {
      await this.syncFromRemote();
    }
    return this.db.listCollabRooms().filter((room) => room.type !== 'dm');
  }

  async openRoom(roomId: string) {
    await this.refreshRoom(roomId);
    return this.db.getCollabRoomDetail(roomId);
  }

  async listChats() {
    return this.db.listCollabChats();
  }

  async openChat(chatId: string) {
    await this.refreshRoom(chatId);
    return this.db.getCollabRoomDetail(chatId);
  }

  async listContacts() {
    return this.db.listCollabContacts();
  }

  async sendMessage(input: { roomId: string; body: string }) {
    const session = this.requireRoomSession(input.roomId);
    const row = await this.callRpc<MessageRow>('post_room_message', {
      target_room_id: input.roomId,
      target_user_id: session.userId,
      target_session_token: session.sessionToken,
      message_body: input.body
    });
    const profile = this.requireProfile();
    const message = this.mapRemoteMessage(row, new Map([[profile.id, profile]]));
    this.db.upsertCollabMessage(message);
    await this.refreshRoom(input.roomId);
    await this.broadcastRoomRefresh(input.roomId, 'message.created');
    this.emit({ type: 'collab.messageCreated', roomId: input.roomId, message });
    return message;
  }

  async setPresence(input: {
    roomId: string;
    status: CollabPresenceStatus;
    currentThreadId?: string | null;
    currentThreadTitle?: string | null;
    branchName?: string | null;
    worktreeName?: string | null;
    activeRunId?: string | null;
    activeRunTitle?: string | null;
    dirtyFileCount?: number;
    stagedFileCount?: number;
  }) {
    const profile = this.requireProfile();
    const presence: CollabPresence = {
      roomId: input.roomId,
      userId: profile.id,
      status: input.status,
      currentThreadId: input.currentThreadId ?? null,
      currentThreadTitle: input.currentThreadTitle ?? null,
      branchName: input.branchName ?? null,
      worktreeName: input.worktreeName ?? null,
      activeRunId: input.activeRunId ?? null,
      activeRunTitle: input.activeRunTitle ?? null,
      dirtyFileCount: input.dirtyFileCount ?? 0,
      stagedFileCount: input.stagedFileCount ?? 0,
      updatedAt: new Date().toISOString()
    };

    this.pendingPresence.set(input.roomId, presence);
    this.db.upsertCollabPresence(presence);
    this.logLifecycle('presence.track.requested', {
      roomId: input.roomId,
      status: input.status,
      currentThreadId: presence.currentThreadId,
      activeRunId: presence.activeRunId
    });
    const channel = await this.ensureRoomChannel(input.roomId);
    await channel.track(this.mapPresencePayload(presence));
    this.logLifecycle('presence.track.applied', { roomId: input.roomId, status: input.status });
    this.emit({ type: 'collab.presenceUpdated', roomId: input.roomId, presence: this.db.listCollabPresence(input.roomId) });
  }

  async shareThread(input: {
    roomId: string;
    threadId: string;
    title: string;
    projectId?: string | null;
    projectLabel?: string | null;
    status?: 'idle' | 'active' | 'completed' | 'failed';
    providerId: ProviderId;
    modelId: string;
    lastPromptSummary?: string | null;
    latestAssistantSummary?: string | null;
    runId?: string | null;
  }) {
    const session = this.requireRoomSession(input.roomId);
    await this.callRpc<SharedThreadRow>('upsert_shared_thread', {
      target_room_id: input.roomId,
      target_user_id: session.userId,
      target_session_token: session.sessionToken,
      input_thread_id: input.threadId,
      input_project_id: input.projectId ?? null,
      input_project_label: input.projectLabel ?? null,
      input_title: input.title,
      input_status: input.status ?? 'active',
      input_provider_id: input.providerId,
      input_model_id: input.modelId,
      input_last_prompt_summary: input.lastPromptSummary ?? null,
      input_latest_assistant_summary: input.latestAssistantSummary ?? null,
      input_run_id: input.runId ?? null
    });

    await this.refreshRoom(input.roomId);
    await this.broadcastRoomRefresh(input.roomId, 'thread.shared');
    const sharedThread = this.db.listCollabSharedThreads(input.roomId).find((entry) => entry.threadId === input.threadId);
    if (!sharedThread) {
      throw new Error('Shared thread was not available after synchronization.');
    }
    this.emit({ type: 'collab.threadShared', roomId: input.roomId, sharedThread });
    return sharedThread;
  }

  async shareRun(input: {
    roomId: string;
    threadId: string;
    threadTitle: string;
    runId: string;
    providerId: ProviderId;
    modelId: string;
    executionPermission: ExecutionPermission;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    taskTitle?: string | null;
    summary?: string | null;
    changedFiles?: string[];
    diffStats?: RunDiffStats | null;
    testsSummary?: string | null;
    resultLabel?: string | null;
    completedAt?: string | null;
  }) {
    const session = this.requireRoomSession(input.roomId);
    await this.callRpc<SharedRunRow>('upsert_shared_run', {
      target_room_id: input.roomId,
      target_user_id: session.userId,
      target_session_token: session.sessionToken,
      input_thread_id: input.threadId,
      input_thread_title: input.threadTitle,
      input_run_id: input.runId,
      input_provider_id: input.providerId,
      input_model_id: input.modelId,
      input_execution_permission: input.executionPermission,
      input_status: input.status,
      input_task_title: input.taskTitle ?? null,
      input_summary: input.summary ?? null,
      input_changed_files_json: input.changedFiles ?? [],
      input_diff_stats_json: input.diffStats ?? null,
      input_tests_summary: input.testsSummary ?? null,
      input_result_label: input.resultLabel ?? null,
      input_completed_at: input.completedAt ?? null
    });

    await this.refreshRoom(input.roomId);
    await this.broadcastRoomRefresh(input.roomId, 'run.shared');
    const sharedRun = this.db.getCollabSharedRunByRunId(input.runId);
    if (!sharedRun) {
      throw new Error('Shared run was not available after synchronization.');
    }
    this.emit({ type: sharedRun.status === 'running' ? 'collab.runUpdated' : 'collab.runShared', roomId: input.roomId, sharedRun });
    return sharedRun;
  }

  async createHandoff(input: {
    roomId: string;
    threadId: string;
    runId?: string | null;
    title: string;
    summary: string;
    branchName?: string | null;
    dirtyFileCount?: number;
    stagedFileCount?: number;
    changedFiles?: string[];
    outstandingTasks?: string[];
    recommendedNextPrompt?: string | null;
  }) {
    const session = this.requireRoomSession(input.roomId);
    await this.callRpc<HandoffRow>('create_room_handoff', {
      target_room_id: input.roomId,
      target_user_id: session.userId,
      target_session_token: session.sessionToken,
      input_thread_id: input.threadId,
      input_run_id: input.runId ?? null,
      input_title: input.title,
      input_summary: input.summary,
      input_branch_name: input.branchName ?? null,
      input_dirty_file_count: input.dirtyFileCount ?? 0,
      input_staged_file_count: input.stagedFileCount ?? 0,
      input_changed_files_json: input.changedFiles ?? [],
      input_outstanding_tasks_json: input.outstandingTasks ?? [],
      input_recommended_next_prompt: input.recommendedNextPrompt ?? null
    });

    await this.refreshRoom(input.roomId);
    await this.broadcastRoomRefresh(input.roomId, 'handoff.created');
    const handoff = this.db.listCollabHandoffs(input.roomId)[0] ?? null;
    if (!handoff) {
      throw new Error('Handoff was not available after synchronization.');
    }
    this.emit({ type: 'collab.handoffCreated', roomId: input.roomId, handoff });
    return handoff;
  }

  async handleAppEvent(event: AppEvent) {
    if (event.type !== 'run.progress' && event.type !== 'run.status') {
      return;
    }

    const sharedRun = this.db.getCollabSharedRunByRunId(event.runId);
    if (!sharedRun) {
      return;
    }

    const now = Date.now();
    const lastPublishAt = this.lastRunPublishAt.get(event.runId) ?? 0;
    const shouldThrottle = event.type === 'run.progress' && now - lastPublishAt < 1500;
    if (shouldThrottle) {
      return;
    }

    this.lastRunPublishAt.set(event.runId, now);
    const next: CollabSharedRun = {
      ...sharedRun,
      status:
        event.type === 'run.progress'
          ? 'running'
          : event.status === 'completed'
            ? 'completed'
            : event.status === 'failed' || event.status === 'aborted'
              ? 'failed'
              : event.status === 'stopping'
                ? 'running'
                : sharedRun.status,
      taskTitle: event.type === 'run.progress' ? event.progress.title ?? summarizeProgress(event) : sharedRun.taskTitle,
      summary: event.type === 'run.progress' ? summarizeProgress(event) ?? sharedRun.summary : event.message ?? sharedRun.summary,
      diffStats: event.type === 'run.progress' ? event.progress.diffStats ?? sharedRun.diffStats : sharedRun.diffStats,
      resultLabel: event.type === 'run.status' ? event.message ?? sharedRun.resultLabel : sharedRun.resultLabel,
      updatedAt: new Date().toISOString(),
      completedAt:
        event.type === 'run.status' && (event.status === 'completed' || event.status === 'failed' || event.status === 'aborted')
          ? new Date().toISOString()
          : sharedRun.completedAt
    };

    try {
      await this.shareRun({
        roomId: next.roomId,
        threadId: next.threadId,
        threadTitle: next.threadTitle,
        runId: next.runId,
        providerId: next.providerId,
        modelId: next.modelId,
        executionPermission: next.executionPermission,
        status: next.status,
        taskTitle: next.taskTitle,
        summary: next.summary,
        changedFiles: next.changedFiles,
        diffStats: next.diffStats,
        testsSummary: next.testsSummary,
        resultLabel: next.resultLabel,
        completedAt: next.completedAt
      });
    } catch (error) {
      console.error('[collab] Failed to publish shared run update', error);
    }
  }

  private async recreateClient() {
    this.logLifecycle('client.recreate.start');
    for (const channel of this.channels.values()) {
      await channel.unsubscribe();
    }
    this.channels.clear();
    this.pendingPresence.clear();
    this.client = null;

    const config = this.db.getCollabServiceConfig();
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      this.logLifecycle('client.recreate.skipped_unconfigured');
      return;
    }

    this.createClient(config.supabaseUrl, config.supabaseAnonKey);
    this.logLifecycle('client.recreate.complete');
  }

  private createClient(supabaseUrl: string, supabaseAnonKey: string) {
    this.client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
    this.logLifecycle('client.created', {
      supabaseHost: (() => {
        try {
          return new URL(supabaseUrl).host;
        } catch {
          return supabaseUrl;
        }
      })()
    });
  }

  private requireClient() {
    if (!this.client) {
      throw new Error('Collaboration is not available on this device yet.');
    }
    return this.client;
  }

  private requireProfile() {
    const profile = this.db.getActiveCollabProfile();
    if (!profile) {
      throw new Error('Create a collaboration identity first.');
    }
    return profile;
  }

  private requireRoomSession(roomId: string): CollabRoomSession {
    const session = this.db.getCollabRoomSession(roomId);
    if (!session) {
      throw new Error('Room session not available locally. Join the room again.');
    }
    return session;
  }

  private async syncFromRemote() {
    if (this.syncing) {
      this.logLifecycle('sync.skipped_already_running');
      return;
    }

    this.requireClient();
    const profile = this.requireProfile();
    const sessions = this.db.listCollabRoomSessions(profile.id);

    this.syncing = true;
    this.db.setCollabConnectionState('connecting');
    this.logLifecycle('sync.start', { sessionCount: sessions.length });
    this.emit({ type: 'collab.connectionChanged', config: this.db.getCollabConfig() });

    try {
      this.db.clearCollabRoomCache();
      this.db.upsertCollabProfile(profile);
      const syncedRoomIds: string[] = [];

      for (const session of sessions) {
        try {
          await this.fetchRoomSnapshotFromRemote(session.roomId, session);
          syncedRoomIds.push(session.roomId);
          this.logLifecycle('sync.room.complete', { roomId: session.roomId });
        } catch (error) {
          console.error(`[collab] Failed to sync room ${session.roomId}`, error);
          this.logLifecycle('sync.room.failed', {
            roomId: session.roomId,
            error: this.describeError(error)
          }, 'error');
          this.db.removeCollabRoomSession(session.roomId, session.userId);
        }
      }

      this.db.setCollabConnectionState('connected');
      this.db.touchCollabSync();
      await this.subscribeToRooms(syncedRoomIds);
      this.logLifecycle('sync.complete', { syncedRoomIds });
      this.emit({ type: 'collab.profileUpdated', profile });
      this.emit({ type: 'collab.roomsUpdated', rooms: this.db.listCollabRooms() });
      this.emit({ type: 'collab.connectionChanged', config: this.db.getCollabConfig() });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to synchronize collaboration.';
      console.error('[collab] Sync failed', error);
      this.logLifecycle('sync.failed', {
        error: this.describeError(error),
        message
      }, 'error');
      this.db.setCollabConnectionState('error', message);
      this.emit({ type: 'collab.connectionChanged', config: this.db.getCollabConfig() });
      throw error;
    } finally {
      this.syncing = false;
    }
  }

  private async refreshRoom(roomId: string) {
    if (this.db.getCollabConfig().connectionState !== 'connected') {
      this.logLifecycle('refresh.skipped_not_connected', { roomId }, 'warn');
      return;
    }

    this.logLifecycle('refresh.start', { roomId });
    await this.fetchRoomSnapshotFromRemote(roomId);
    await this.subscribeToRooms([roomId]);
    const detail = this.db.getCollabRoomDetail(roomId);
    this.logLifecycle('refresh.complete', {
      roomId,
      memberCount: detail.members.length,
      messageCount: detail.messages.length
    });
    this.emit({ type: 'collab.roomUpdated', room: detail.room, members: detail.members });
    this.emit({ type: 'collab.roomsUpdated', rooms: this.db.listCollabRooms() });
  }

  private async fetchRoomSnapshotFromRemote(roomId: string, roomSession?: CollabRoomSession | null) {
    const session = roomSession ?? this.requireRoomSession(roomId);
    this.logLifecycle('snapshot.fetch.start', { roomId });
    const snapshot = await this.callRpc<RoomSnapshot>('get_room_snapshot', {
      target_room_id: roomId,
      target_user_id: session.userId,
      target_session_token: session.sessionToken
    });

    await this.callRpc<null>('collab_touch_room_session', {
      target_room_id: roomId,
      target_user_id: session.userId,
      target_session_token: session.sessionToken
    });

    const profileById = new Map<string, CollabProfile>();
    for (const member of snapshot.members) {
      const profile = this.mapRemoteProfile({
        id: member.user_id,
        display_name: member.display_name,
        handle: member.handle,
        avatar_url: member.avatar_url,
        status: member.status,
        bio: null,
        timezone: null,
        created_at: snapshot.room.created_at,
        updated_at: snapshot.room.updated_at
      });
      this.db.upsertCollabProfile(profile);
      profileById.set(profile.id, profile);
    }

    const directPeer = this.resolveDirectRoomPeer(snapshot.room, snapshot.members, session.userId);
    const room = this.mapRemoteRoom(snapshot.room, snapshot.members.length, snapshot.messages.at(-1)?.body ?? null, directPeer);
    this.db.upsertCollabRoom(room);
    this.db.replaceCollabRoomMembers(roomId, snapshot.members.map((row) => this.mapRemoteMember(row, profileById)));
    this.db.replaceCollabMessages(roomId, snapshot.messages.map((row) => this.mapRemoteMessage(row, profileById)));

    for (const sharedThread of snapshot.shared_threads) {
      this.db.upsertCollabSharedThread(this.mapRemoteSharedThread(sharedThread, profileById));
    }
    for (const sharedRun of snapshot.shared_runs) {
      this.db.upsertCollabSharedRun(this.mapRemoteSharedRun(sharedRun, profileById));
    }
    for (const handoff of snapshot.handoffs) {
      this.db.upsertCollabHandoff(this.mapRemoteHandoff(handoff, profileById));
    }
    this.db.replaceCollabRoomFollowers(roomId, (snapshot.followers ?? []).map((row) => this.mapRemoteFollower(row)));
    this.db.replaceCollabRoleRequests(roomId, (snapshot.role_requests ?? []).map((row) => this.mapRemoteRoleRequest(row)));
    if (snapshot.terminal_state) {
      this.db.upsertCollabRoomTerminalState(this.mapRemoteTerminalState(snapshot.terminal_state));
    } else {
      this.db.clearCollabRoomTerminalState(roomId);
    }

    this.db.upsertCollabRoomSession({
      ...session,
      updatedAt: new Date().toISOString()
    });
    this.logLifecycle('snapshot.fetch.complete', {
      roomId,
      memberCount: snapshot.members.length,
      messageCount: snapshot.messages.length,
      sharedThreadCount: snapshot.shared_threads.length,
      sharedRunCount: snapshot.shared_runs.length,
      handoffCount: snapshot.handoffs.length
    });
  }

  private persistRoomAccess(input: {
    roomId: string;
    userId: string;
    sessionToken: string;
    type: CollabRoom['type'];
    name: string;
    joinCode: string | null;
    topic: string | null;
    projectLabel: string | null;
    createdBy: string | null;
  }) {
    const now = new Date().toISOString();
    this.db.upsertCollabRoom({
      id: input.roomId,
      type: input.type,
      name: input.name,
      joinCode: input.joinCode,
      slug: null,
      topic: input.topic,
      projectLabel: input.projectLabel,
      directUserId: null,
      unreadCount: 0,
      memberCount: input.type === 'dm' ? 2 : 1,
      lastActivityAt: now,
      lastMessagePreview: null,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now
    });
    this.db.upsertCollabRoomSession({
      roomId: input.roomId,
      userId: input.userId,
      sessionToken: input.sessionToken,
      updatedAt: now,
      expiresAt: null
    });
  }

  private async subscribeToRooms(roomIds: string[]) {
    this.logLifecycle('channel.sync.start', { roomIds });
    const keepIds = new Set(roomIds);
    for (const [roomId, channel] of this.channels.entries()) {
      if (keepIds.has(roomId)) {
        continue;
      }
      await channel.unsubscribe();
      this.channels.delete(roomId);
      this.logLifecycle('channel.removed', { roomId });
    }

    for (const roomId of keepIds) {
      await this.ensureRoomChannel(roomId);
    }
    this.logLifecycle('channel.sync.complete', { roomIds: [...keepIds] });
  }

  private async ensureRoomChannel(roomId: string) {
    const existing = this.channels.get(roomId);
    if (existing) {
      this.logLifecycle('channel.reused', { roomId });
      return existing;
    }

    const client = this.requireClient();
    const profile = this.requireProfile();
    const channel = client.channel(`collab:room:${roomId}`, {
      config: {
        broadcast: { self: true },
        presence: { key: profile.id }
      }
    });

    channel.on('broadcast', { event: 'room.refresh' }, () => {
      this.logLifecycle('broadcast.room_refresh.received', { roomId });
      void this.refreshRoom(roomId).catch((error) => {
        console.error('[collab] Failed to refresh room after broadcast', error);
        this.logLifecycle('broadcast.room_refresh.failed', {
          roomId,
          error: this.describeError(error)
        }, 'error');
      });
    });
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<PresencePayload>();
      const presence: CollabPresence[] = [];
      for (const [userId, entries] of Object.entries(state)) {
        for (const entry of entries ?? []) {
          presence.push({
            roomId,
            userId,
            status: entry.status,
            currentThreadId: entry.currentThreadId,
            currentThreadTitle: entry.currentThreadTitle,
            branchName: entry.branchName,
            worktreeName: entry.worktreeName,
            activeRunId: entry.activeRunId,
            activeRunTitle: entry.activeRunTitle,
            dirtyFileCount: entry.dirtyFileCount,
            stagedFileCount: entry.stagedFileCount,
            updatedAt: entry.updatedAt
          });
        }
      }
      this.db.replaceCollabPresence(roomId, presence);
      this.logLifecycle('presence.sync', {
        roomId,
        presenceCount: presence.length,
        presentUserIds: [...new Set(presence.map((entry) => entry.userId))]
      });
      this.emit({ type: 'collab.presenceUpdated', roomId, presence });
    });

    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status) => {
        this.logLifecycle('channel.status', { roomId, status });
        if (status === 'SUBSCRIBED') {
          resolve();
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          reject(new Error(`Failed to subscribe to collaboration room ${roomId}: ${status}`));
        }
      });
    });

    const pending = this.pendingPresence.get(roomId);
    if (pending) {
      await channel.track(this.mapPresencePayload(pending));
      this.logLifecycle('channel.pending_presence_applied', { roomId, status: pending.status });
    }

    this.channels.set(roomId, channel);
    this.logLifecycle('channel.subscribed', { roomId });
    return channel;
  }

  private async broadcastRoomRefresh(roomId: string, reason: string) {
    const channel = await this.ensureRoomChannel(roomId);
    this.logLifecycle('broadcast.room_refresh.send', { roomId, reason });
    await channel.send({
      type: 'broadcast',
      event: 'room.refresh',
      payload: {
        roomId,
        reason,
        updatedAt: new Date().toISOString()
      }
    });
    this.logLifecycle('broadcast.room_refresh.sent', { roomId, reason });
  }

  private mapPresencePayload(presence: CollabPresence): PresencePayload {
    return {
      roomId: presence.roomId,
      userId: presence.userId,
      status: presence.status,
      currentThreadId: presence.currentThreadId,
      currentThreadTitle: presence.currentThreadTitle,
      branchName: presence.branchName,
      worktreeName: presence.worktreeName,
      activeRunId: presence.activeRunId,
      activeRunTitle: presence.activeRunTitle,
      dirtyFileCount: presence.dirtyFileCount,
      stagedFileCount: presence.stagedFileCount,
      updatedAt: presence.updatedAt
    };
  }

  private async callRpc<T>(name: string, args: Record<string, unknown>) {
    const client = this.requireClient();
    const { data, error } = await client.rpc(name, args);
    if (error) {
      const normalized = this.normalizeRpcError(name, error);
      await this.recoverFromRpcError(normalized);
      throw normalized;
    }
    return data as T;
  }

  private async recoverFromRpcError(error: Error) {
    const message = error.message.toLowerCase();
    const missingGuestProfile = message.includes('guest profile not found');
    if (!missingGuestProfile) {
      return;
    }
    await this.clearIdentity();
    error.message = 'Your collaboration identity is no longer valid on the backend. Create a new guest identity and try again.';
  }

  private normalizeRpcError(name: string, error: unknown) {
    if (error instanceof Error && error.message.trim()) {
      return error;
    }

    const payload = error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
    const message = typeof payload?.message === 'string' && payload.message.trim() ? payload.message.trim() : `Collaboration RPC ${name} failed.`;
    const hint = typeof payload?.hint === 'string' && payload.hint.trim() ? payload.hint.trim() : null;
    const details = typeof payload?.details === 'string' && payload.details.trim() ? payload.details.trim() : null;
    const code = typeof payload?.code === 'string' && payload.code.trim() ? payload.code.trim() : null;

    const suffixParts = [hint, details, code ? `code ${code}` : null].filter(Boolean);
    return new Error(suffixParts.length > 0 ? `${message} (${suffixParts.join('; ')})` : message);
  }

  private mapRemoteProfile(row: ProfileRow): CollabProfile {
    return {
      id: row.id,
      email: null,
      displayName: row.display_name,
      handle: row.handle,
      avatarUrl: row.avatar_url,
      status: row.status,
      bio: row.bio,
      timezone: row.timezone,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private resolveDirectRoomPeer(row: RoomRow, members: MemberRow[], currentUserId: string): DirectRoomPeer {
    if (row.type !== 'dm') {
      return null;
    }

    const peer =
      members.find((member) => member.user_id !== currentUserId && member.membership_state === 'active') ??
      members.find((member) => member.user_id !== currentUserId) ??
      null;
    if (!peer) {
      return null;
    }

    return {
      userId: peer.user_id,
      displayName: peer.display_name,
      handle: peer.handle
    };
  }

  private mapRemoteRoom(row: RoomRow, memberCount: number, lastPreview: string | null, directPeer: DirectRoomPeer = null): CollabRoom {
    return {
      id: row.id,
      type: row.type,
      name: row.type === 'dm' ? directPeer?.displayName ?? row.name : row.name,
      joinCode: row.join_code,
      slug: row.slug,
      topic: row.topic,
      projectLabel: row.project_label,
      directUserId: row.type === 'dm' ? directPeer?.userId ?? null : row.direct_user_id,
      unreadCount: row.unread_count ?? 0,
      memberCount: row.member_count ?? memberCount,
      lastActivityAt: row.last_activity_at,
      lastMessagePreview: lastPreview ?? row.last_message_preview,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapRemoteMember(row: MemberRow, profileById: Map<string, CollabProfile>): CollabRoomMember {
    const profile = profileById.get(row.user_id);
    return {
      roomId: row.room_id,
      userId: row.user_id,
      role: row.role,
      membershipState: row.membership_state,
      joinedAt: row.joined_at,
      displayName: profile?.displayName ?? row.display_name ?? `User ${row.user_id.slice(0, 8)}`,
      handle: profile?.handle ?? row.handle ?? null,
      avatarUrl: profile?.avatarUrl ?? row.avatar_url ?? null,
      status: profile?.status ?? row.status ?? 'offline'
    };
  }

  private mapRemoteMessage(row: MessageRow, profileById: Map<string, CollabProfile>): CollabMessage {
    const profile = profileById.get(row.author_id);
    return {
      id: row.id,
      roomId: row.room_id,
      authorId: row.author_id,
      authorDisplayName: profile?.displayName ?? `User ${row.author_id.slice(0, 8)}`,
      authorHandle: profile?.handle ?? null,
      body: row.body,
      createdAt: row.created_at
    };
  }

  private mapRemoteSharedThread(row: SharedThreadRow, profileById: Map<string, CollabProfile>): CollabSharedThread {
    const profile = profileById.get(row.driver_user_id);
    return {
      id: row.id,
      roomId: row.room_id,
      threadId: row.thread_id,
      projectId: row.project_id,
      projectLabel: row.project_label,
      title: row.title,
      status: row.status,
      driverUserId: row.driver_user_id,
      driverDisplayName: profile?.displayName ?? `User ${row.driver_user_id.slice(0, 8)}`,
      providerId: row.provider_id,
      modelId: row.model_id,
      lastPromptSummary: row.last_prompt_summary,
      latestAssistantSummary: row.latest_assistant_summary,
      runId: row.run_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapRemoteSharedRun(row: SharedRunRow, profileById: Map<string, CollabProfile>): CollabSharedRun {
    const profile = profileById.get(row.driver_user_id);
    return {
      id: row.id,
      roomId: row.room_id,
      threadId: row.thread_id,
      threadTitle: row.thread_title,
      runId: row.run_id,
      driverUserId: row.driver_user_id,
      driverDisplayName: profile?.displayName ?? `User ${row.driver_user_id.slice(0, 8)}`,
      providerId: row.provider_id,
      modelId: row.model_id,
      executionPermission: row.execution_permission,
      status: row.status,
      taskTitle: row.task_title,
      summary: row.summary,
      changedFiles: row.changed_files_json ?? [],
      diffStats: row.diff_stats_json,
      testsSummary: row.tests_summary,
      resultLabel: row.result_label,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at
    };
  }

  private mapRemoteHandoff(row: HandoffRow, profileById: Map<string, CollabProfile>): CollabHandoff {
    const profile = profileById.get(row.author_user_id);
    return {
      id: row.id,
      roomId: row.room_id,
      threadId: row.thread_id,
      runId: row.run_id,
      authorUserId: row.author_user_id,
      authorDisplayName: profile?.displayName ?? `User ${row.author_user_id.slice(0, 8)}`,
      title: row.title,
      summary: row.summary,
      branchName: row.branch_name,
      dirtyFileCount: row.dirty_file_count,
      stagedFileCount: row.staged_file_count,
      changedFiles: row.changed_files_json ?? [],
      outstandingTasks: row.outstanding_tasks_json ?? [],
      recommendedNextPrompt: row.recommended_next_prompt,
      createdAt: row.created_at
    };
  }

  private mapRemoteFollower(row: FollowerRow): CollabRoomFollower {
    return {
      roomId: row.room_id,
      userId: row.user_id,
      displayName: row.display_name,
      handle: row.handle,
      avatarUrl: row.avatar_url,
      status: row.status,
      createdAt: row.created_at
    };
  }

  private mapRemoteRoleRequest(row: RoleRequestRow): CollabRoleRequest {
    return {
      id: row.id,
      roomId: row.room_id,
      requesterUserId: row.requester_user_id,
      requesterDisplayName: row.display_name,
      requesterHandle: row.handle,
      requestedRole: row.requested_role,
      status: row.status,
      resolvedByUserId: row.resolved_by_user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapRemoteTerminalState(row: TerminalStateRow): CollabRoomTerminalState {
    return {
      roomId: row.room_id,
      mode: row.mode,
      enabledByUserId: row.enabled_by_user_id,
      enabledByDisplayName: row.enabled_by_display_name,
      note: row.note,
      updatedAt: row.updated_at
    };
  }

  getDiagnosticsSnapshot() {
    return {
      recentLifecycleEvents: [...this.lifecycleEvents]
    };
  }

  private emit(event: AppEvent) {
    this.emitter.emit('event', event);
  }
}
