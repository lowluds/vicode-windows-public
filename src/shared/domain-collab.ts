import type { ProviderId } from './domain-provider';
import type { ExecutionPermission } from './domain-thread';
import type { RunDiffStats } from './domain-run-review';

export type CollabConnectionState = 'unconfigured' | 'identity_required' | 'connecting' | 'connected' | 'error';

export type CollabRoomType = 'project' | 'dm';

export type CollabRoomMemberRole = 'owner' | 'admin' | 'member';

export type CollabPresenceStatus = 'online' | 'away' | 'busy' | 'offline';

export type CollabThreadStatus = 'idle' | 'active' | 'completed' | 'failed';

export type CollabRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type CollabRequestedRole = 'contributor' | 'driver';

export type CollabRoleRequestStatus = 'pending' | 'approved' | 'declined';

export type CollabTerminalMode = 'off' | 'announce_only';

export interface CollabAccount {
  email: string | null;
  userId: string | null;
  expiresAt: string | null;
}

export interface CollabRoomSession {
  roomId: string;
  userId: string;
  sessionToken: string;
  updatedAt: string;
  expiresAt: string | null;
}

export interface CollabConfig {
  supabaseUrl: string | null;
  hasAnonKey: boolean;
  connectionState: CollabConnectionState;
  lastError: string | null;
}

export interface CollabProfile {
  id: string;
  email: string | null;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  status: CollabPresenceStatus;
  bio: string | null;
  timezone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollabRoom {
  id: string;
  type: CollabRoomType;
  name: string;
  joinCode: string | null;
  slug: string | null;
  topic: string | null;
  projectLabel: string | null;
  directUserId: string | null;
  unreadCount: number;
  memberCount: number;
  lastActivityAt: string;
  lastMessagePreview: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollabRoomMember {
  roomId: string;
  userId: string;
  role: CollabRoomMemberRole;
  membershipState: 'active' | 'invited' | 'left';
  joinedAt: string | null;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  status: CollabPresenceStatus;
}

export interface CollabMessage {
  id: string;
  roomId: string;
  authorId: string;
  authorDisplayName: string;
  authorHandle: string | null;
  body: string;
  createdAt: string;
}

export interface CollabPresence {
  roomId: string;
  userId: string;
  status: CollabPresenceStatus;
  currentThreadId: string | null;
  currentThreadTitle: string | null;
  branchName: string | null;
  worktreeName: string | null;
  activeRunId: string | null;
  activeRunTitle: string | null;
  dirtyFileCount: number;
  stagedFileCount: number;
  updatedAt: string;
}

export interface CollabSharedThread {
  id: string;
  roomId: string;
  threadId: string;
  projectId: string | null;
  projectLabel: string | null;
  title: string;
  status: CollabThreadStatus;
  driverUserId: string;
  driverDisplayName: string;
  providerId: ProviderId;
  modelId: string;
  lastPromptSummary: string | null;
  latestAssistantSummary: string | null;
  runId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollabSharedRun {
  id: string;
  roomId: string;
  threadId: string;
  threadTitle: string;
  runId: string;
  driverUserId: string;
  driverDisplayName: string;
  providerId: ProviderId;
  modelId: string;
  executionPermission: ExecutionPermission;
  status: CollabRunStatus;
  taskTitle: string | null;
  summary: string | null;
  changedFiles: string[];
  diffStats: RunDiffStats | null;
  testsSummary: string | null;
  resultLabel: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CollabHandoff {
  id: string;
  roomId: string;
  threadId: string;
  runId: string | null;
  authorUserId: string;
  authorDisplayName: string;
  title: string;
  summary: string;
  branchName: string | null;
  dirtyFileCount: number;
  stagedFileCount: number;
  changedFiles: string[];
  outstandingTasks: string[];
  recommendedNextPrompt: string | null;
  createdAt: string;
}

export interface CollabRoomFollower {
  roomId: string;
  userId: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  status: CollabPresenceStatus;
  createdAt: string;
}

export interface CollabRoleRequest {
  id: string;
  roomId: string;
  requesterUserId: string;
  requesterDisplayName: string;
  requesterHandle: string | null;
  requestedRole: CollabRequestedRole;
  status: CollabRoleRequestStatus;
  resolvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollabRoomTerminalState {
  roomId: string;
  mode: CollabTerminalMode;
  enabledByUserId: string | null;
  enabledByDisplayName: string | null;
  note: string | null;
  updatedAt: string;
}

export interface CollabContact {
  userId: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  status: CollabPresenceStatus;
  lastRoomId: string | null;
  lastRoomName: string | null;
}

export interface CollabRoomDetail {
  room: CollabRoom;
  members: CollabRoomMember[];
  messages: CollabMessage[];
  presence: CollabPresence[];
  sharedThreads: CollabSharedThread[];
  sharedRuns: CollabSharedRun[];
  handoffs: CollabHandoff[];
  followers: CollabRoomFollower[];
  roleRequests: CollabRoleRequest[];
  terminalState: CollabRoomTerminalState | null;
}

export interface CollabBootstrap {
  config: CollabConfig;
  account: CollabAccount;
  profile: CollabProfile | null;
  rooms: CollabRoom[];
  roomMembersByRoom: Record<string, CollabRoomMember[]>;
  messagesByRoom: Record<string, CollabMessage[]>;
  presenceByRoom: Record<string, CollabPresence[]>;
  sharedThreadsByRoom: Record<string, CollabSharedThread[]>;
  sharedRunsByRoom: Record<string, CollabSharedRun[]>;
  handoffsByRoom: Record<string, CollabHandoff[]>;
  followersByRoom: Record<string, CollabRoomFollower[]>;
  roleRequestsByRoom: Record<string, CollabRoleRequest[]>;
  terminalStateByRoom: Record<string, CollabRoomTerminalState | null>;
  contacts: CollabContact[];
}
