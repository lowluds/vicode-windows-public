import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../storage/database';
import { CollaborationService } from './collab';

const cleanupPaths: string[] = [];
const cleanupDatabases: DatabaseService[] = [];
const now = '2026-03-20T15:00:00.000Z';

afterEach(async () => {
  vi.restoreAllMocks();

  while (cleanupDatabases.length > 0) {
    cleanupDatabases.pop()?.close();
  }

  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

function createTestDatabase(dir: string) {
  const db = new DatabaseService(join(dir, 'vicode.sqlite'));
  db.migrate();
  cleanupDatabases.push(db);
  return db;
}

function seedConnectedIdentity(db: DatabaseService) {
  db.saveCollabConfig({
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'anon-key'
  });
  db.setCollabIdentity({
    userId: 'user-1',
    connectionState: 'connected'
  });
  db.upsertCollabProfile({
    id: 'user-1',
    email: null,
    displayName: 'Owner',
    handle: '@owner',
    avatarUrl: null,
    status: 'online',
    bio: null,
    timezone: 'America/Toronto',
    createdAt: now,
    updatedAt: now
  });
}

function buildRoomState(options?: {
  roomId?: string;
  roomName?: string;
  roomType?: 'project' | 'dm';
  joinCode?: string | null;
  createdBy?: string | null;
  directUserId?: string | null;
  peerUserId?: string;
  peerDisplayName?: string;
  peerHandle?: string | null;
}) {
  const roomId = options?.roomId ?? 'room-1';
  const roomType = options?.roomType ?? 'project';
  const peerUserId = options?.peerUserId ?? 'user-2';
  const peerDisplayName = options?.peerDisplayName ?? 'Doris Brown';
  const peerHandle = options?.peerHandle ?? '@doris';
  return {
    room: {
      id: roomId,
      type: roomType,
      name: options?.roomName ?? (roomType === 'dm' ? 'Direct chat' : '#General'),
      join_code: options?.joinCode ?? 'ROOMCODE1',
      slug: null,
      topic: roomType === 'project' ? 'Shared implementation' : null,
      project_label: roomType === 'project' ? 'vicode-windows' : null,
      direct_user_id: options?.directUserId ?? (roomType === 'dm' ? peerUserId : null),
      unread_count: 0,
      member_count: 2,
      last_activity_at: now,
      last_message_preview: null,
      created_by: options?.createdBy ?? 'user-1',
      created_at: now,
      updated_at: now
    },
    members: [
      {
        room_id: roomId,
        user_id: 'user-1',
        role: 'owner',
        membership_state: 'active',
        joined_at: now,
        display_name: 'Owner',
        handle: '@owner',
        avatar_url: null,
        status: 'online'
      },
      {
        room_id: roomId,
        user_id: peerUserId,
        role: 'member',
        membership_state: 'active',
        joined_at: now,
        display_name: peerDisplayName,
        handle: peerHandle,
        avatar_url: null,
        status: 'away'
      }
    ],
    messages: [] as Array<{
      id: string;
      room_id: string;
      author_id: string;
      body: string;
      created_at: string;
    }>,
    shared_threads: [] as Array<{
      id: string;
      room_id: string;
      thread_id: string;
      project_id: string | null;
      project_label: string | null;
      title: string;
      status: 'idle' | 'active' | 'completed' | 'failed';
      driver_user_id: string;
      provider_id: 'openai' | 'gemini';
      model_id: string;
      last_prompt_summary: string | null;
      latest_assistant_summary: string | null;
      run_id: string | null;
      created_at: string;
      updated_at: string;
    }>,
    shared_runs: [] as Array<{
      id: string;
      room_id: string;
      thread_id: string;
      thread_title: string;
      run_id: string;
      driver_user_id: string;
      provider_id: 'openai' | 'gemini';
      model_id: string;
      execution_permission: 'readonly' | 'workspace-write' | 'danger-full-access';
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
      task_title: string | null;
      summary: string | null;
      changed_files_json: string[];
      diff_stats_json: { filesChanged: number; insertions: number; deletions: number } | null;
      tests_summary: string | null;
      result_label: string | null;
      started_at: string;
      updated_at: string;
      completed_at: string | null;
    }>,
    handoffs: [] as Array<{
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
    }>,
    followers: [] as Array<{
      room_id: string;
      user_id: string;
      display_name: string;
      handle: string | null;
      avatar_url: string | null;
      status: 'online' | 'away' | 'busy' | 'offline';
      created_at: string;
    }>,
    role_requests: [] as Array<{
      id: string;
      room_id: string;
      requester_user_id: string;
      display_name: string;
      handle: string | null;
      requested_role: 'contributor' | 'driver';
      status: 'pending' | 'approved' | 'declined';
      resolved_by_user_id: string | null;
      created_at: string;
      updated_at: string;
    }>,
    terminal_state: null as null | {
      room_id: string;
      mode: 'off' | 'announce_only';
      enabled_by_user_id: string | null;
      enabled_by_display_name: string | null;
      note: string | null;
      updated_at: string;
    }
  };
}

function snapshotFromState(state: ReturnType<typeof buildRoomState>) {
  return {
    ...state,
    room: {
      ...state.room,
      member_count: state.members.length,
      last_message_preview: state.messages.at(-1)?.body ?? null,
      last_activity_at: state.messages.at(-1)?.created_at ?? state.room.last_activity_at,
      updated_at: state.messages.at(-1)?.created_at ?? state.room.updated_at
    }
  };
}

function attachRpc(
  service: CollaborationService,
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
) {
  vi.spyOn(service as never, 'subscribeToRooms').mockResolvedValue(undefined);
  vi.spyOn(service as never, 'broadcastRoomRefresh').mockResolvedValue(undefined);
  (service as unknown as { client: { rpc: typeof rpc } }).client = { rpc };
}

describe('CollaborationService diagnostics snapshot', () => {
  it('records channel subscribe and presence sync lifecycle events', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-collab-diagnostics-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);
    seedConnectedIdentity(db);
    db.upsertCollabRoom({
      id: 'room-1',
      type: 'project',
      name: '#General',
      joinCode: 'ROOMCODE1',
      slug: null,
      topic: 'Shared implementation',
      projectLabel: 'vicode-windows',
      directUserId: null,
      unreadCount: 0,
      memberCount: 1,
      lastActivityAt: now,
      lastMessagePreview: null,
      createdBy: 'user-1',
      createdAt: now,
      updatedAt: now
    });
    const service = new CollaborationService(db);

    let presenceSyncHandler: (() => void) | null = null;
    const channel = {
      on: vi.fn((_type: string, filter: { event?: string }, callback: () => void) => {
        if (filter.event === 'sync') {
          presenceSyncHandler = callback;
        }
        return channel;
      }),
      subscribe: vi.fn((callback: (status: string) => void) => {
        callback('SUBSCRIBED');
        return channel;
      }),
      presenceState: vi.fn(() => ({
        'user-1': [
          {
            status: 'online',
            currentThreadId: 'thread-1',
            currentThreadTitle: 'Investigate room drop',
            branchName: 'codex/claude-code-adoption',
            worktreeName: 'main',
            activeRunId: 'run-1',
            activeRunTitle: 'Investigate collaboration issue',
            dirtyFileCount: 2,
            stagedFileCount: 1,
            updatedAt: now
          }
        ]
      })),
      track: vi.fn(async () => undefined),
      unsubscribe: vi.fn(async () => undefined),
      send: vi.fn(async () => 'ok')
    };

    (service as unknown as { client: { channel: (name: string, options: unknown) => typeof channel } }).client = {
      channel: vi.fn(() => channel)
    };

    await (service as unknown as { ensureRoomChannel: (roomId: string) => Promise<unknown> }).ensureRoomChannel('room-1');
    presenceSyncHandler?.();

    const snapshot = service.getDiagnosticsSnapshot();
    expect(snapshot.recentLifecycleEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'channel.status',
          roomId: 'room-1',
          status: 'SUBSCRIBED'
        }),
        expect.objectContaining({
          event: 'channel.subscribed',
          roomId: 'room-1'
        }),
        expect.objectContaining({
          event: 'presence.sync',
          roomId: 'room-1',
          presenceCount: 1
        })
      ])
    );
  });
});

describe('CollaborationService identity and room access', () => {
  it('creates a guest profile and stores the active identity', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-collab-service-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);
    db.saveCollabConfig({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'anon-key'
    });

    const service = new CollaborationService(db);
    attachRpc(service, vi.fn(async (name) => {
      if (name !== 'create_guest_profile') {
        throw new Error(`Unexpected RPC call in test: ${name}`);
      }
      return {
        data: {
          id: 'user-1',
          display_name: 'Kyle',
          handle: '@kyle',
          avatar_url: null,
          status: 'online',
          bio: null,
          timezone: null,
          created_at: now,
          updated_at: now
        },
        error: null
      };
    }));

    const profile = await service.createGuestProfile({
      displayName: 'Kyle',
      handle: '@kyle'
    });

    expect(profile.displayName).toBe('Kyle');
    expect(db.getCollabAccount().userId).toBe('user-1');
    expect(db.getCollabConfig().connectionState).toBe('connected');
    expect(db.getActiveCollabProfile()?.handle).toBe('@kyle');
  });

  it('creates and joins open rooms while persisting room sessions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-collab-service-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);
    seedConnectedIdentity(db);

    const createdRoom = buildRoomState({
      roomId: 'room-created',
      roomName: 'Open room',
      joinCode: 'OPEN123'
    });
    const joinedRoom = buildRoomState({
      roomId: 'room-joined',
      roomName: 'Joined room',
      joinCode: 'JOIN456',
      createdBy: 'user-2'
    });

    const states = new Map<string, ReturnType<typeof buildRoomState>>([
      ['room-created', createdRoom],
      ['room-joined', joinedRoom]
    ]);

    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      switch (name) {
        case 'create_room_with_password':
          expect(args).toMatchObject({
            creator_profile_id: 'user-1',
            room_name: 'Open room',
            room_password: null
          });
          return {
            data: {
              room_id: 'room-created',
              room_name: 'Open room',
              join_code: 'OPEN123',
              user_id: 'user-1',
              session_token: 'session-created'
            },
            error: null
          };
        case 'join_room_with_password':
          expect(args).toMatchObject({
            joining_profile_id: 'user-1',
            target_join_code: 'JOIN456',
            room_password: null
          });
          return {
            data: {
              room_id: 'room-joined',
              room_name: 'Joined room',
              join_code: 'JOIN456',
              user_id: 'user-1',
              session_token: 'session-joined'
            },
            error: null
          };
        case 'get_room_snapshot':
          return {
            data: snapshotFromState(states.get(String(args.target_room_id))!),
            error: null
          };
        case 'collab_touch_room_session':
          return { data: null, error: null };
        default:
          throw new Error(`Unexpected RPC call in test: ${name}`);
      }
    });

    const service = new CollaborationService(db);
    attachRpc(service, rpc);

    const room = await service.createRoom({
      name: 'Open room',
      password: '   '
    });
    const joined = await service.joinRoom({
      joinCode: 'JOIN456',
      password: ''
    });

    expect(room.joinCode).toBe('OPEN123');
    expect(joined.joinCode).toBe('JOIN456');
    expect(db.listCollabRoomSessions('user-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roomId: 'room-created', sessionToken: 'session-created' }),
        expect.objectContaining({ roomId: 'room-joined', sessionToken: 'session-joined' })
      ])
    );
  });

  it('clears a stale identity when the backend guest profile is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-collab-service-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);
    seedConnectedIdentity(db);

    const service = new CollaborationService(db);
    attachRpc(service, vi.fn(async (name) => {
      if (name !== 'create_room_with_password') {
        throw new Error(`Unexpected RPC call in test: ${name}`);
      }
      return {
        data: null,
        error: {
          code: 'P0001',
          details: null,
          hint: null,
          message: 'Guest profile not found.'
        }
      };
    }));

    await expect(
      service.createRoom({
        name: 'Debug room'
      })
    ).rejects.toThrow('Your collaboration identity is no longer valid on the backend. Create a new guest identity and try again.');

    expect(db.getCollabAccount().userId).toBeNull();
    expect(db.getCollabConfig().connectionState).toBe('identity_required');
    expect(db.getCollabBootstrap().profile).toBeNull();
    expect(db.getCollabBootstrap().rooms).toEqual([]);
  });
});

describe('CollaborationService direct chats and synced room actions', () => {
  it('creates a DM room, resolves the peer from room membership, and persists the local session cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-collab-service-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);
    seedConnectedIdentity(db);

    const state = buildRoomState({
      roomId: 'dm-1',
      roomType: 'dm',
      roomName: 'Direct chat',
      joinCode: 'DMCODE42',
      directUserId: 'user-2'
    });
    state.messages.push({
      id: 'message-1',
      room_id: 'dm-1',
      author_id: 'user-2',
      body: 'Ping from the peer',
      created_at: now
    });

    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      switch (name) {
        case 'create_direct_chat':
          expect(args).toMatchObject({
            creator_profile_id: 'user-1',
            peer_profile_id: 'user-2'
          });
          return {
            data: {
              room_id: 'dm-1',
              room_name: 'Direct chat',
              room_type: 'dm',
              join_code: 'DMCODE42',
              user_id: 'user-1',
              session_token: 'session-token-1'
            },
            error: null
          };
        case 'get_room_snapshot':
          expect(args).toMatchObject({
            target_room_id: 'dm-1',
            target_user_id: 'user-1',
            target_session_token: 'session-token-1'
          });
          return {
            data: snapshotFromState(state),
            error: null
          };
        case 'collab_touch_room_session':
          return { data: null, error: null };
        default:
          throw new Error(`Unexpected RPC call in test: ${name}`);
      }
    });

    const service = new CollaborationService(db);
    attachRpc(service, rpc);

    const room = await service.createDirectChat({ peerUserId: 'user-2' });

    expect(room.type).toBe('dm');
    expect(room.name).toBe('Doris Brown');
    expect(room.directUserId).toBe('user-2');
    expect(await service.listChats()).toEqual([
      expect.objectContaining({
        id: 'dm-1',
        type: 'dm',
        name: 'Doris Brown',
        directUserId: 'user-2'
      })
    ]);
    expect(await service.openChat('dm-1')).toMatchObject({
      room: expect.objectContaining({ id: 'dm-1', name: 'Doris Brown' }),
      members: expect.arrayContaining([expect.objectContaining({ userId: 'user-2' })])
    });
  });

  it('covers synced follower, role request, terminal, messaging, thread, run, handoff, and presence flows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-collab-service-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);
    seedConnectedIdentity(db);
    db.upsertCollabRoom({
      id: 'room-1',
      type: 'project',
      name: '#General',
      joinCode: 'ROOMCODE1',
      slug: null,
      topic: 'Shared implementation',
      projectLabel: 'vicode-windows',
      directUserId: null,
      unreadCount: 0,
      memberCount: 2,
      lastActivityAt: now,
      lastMessagePreview: null,
      createdBy: 'user-1',
      createdAt: now,
      updatedAt: now
    });
    db.upsertCollabRoomSession({
      roomId: 'room-1',
      userId: 'user-1',
      sessionToken: 'session-room-1',
      updatedAt: now,
      expiresAt: null
    });

    const state = buildRoomState({
      roomId: 'room-1',
      roomName: '#General',
      joinCode: 'ROOMCODE1'
    });

    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      switch (name) {
        case 'get_room_snapshot':
          expect(args.target_room_id).toBe('room-1');
          return { data: snapshotFromState(state), error: null };
        case 'collab_touch_room_session':
          return { data: null, error: null };
        case 'set_room_following':
          state.followers = args.should_follow
            ? [
                {
                  room_id: 'room-1',
                  user_id: 'user-1',
                  display_name: 'Owner',
                  handle: '@owner',
                  avatar_url: null,
                  status: 'online',
                  created_at: now
                }
              ]
            : [];
          return { data: null, error: null };
        case 'request_room_role':
          state.role_requests = [
            {
              id: 'request-1',
              room_id: 'room-1',
              requester_user_id: 'user-1',
              display_name: 'Owner',
              handle: '@owner',
              requested_role: String(args.requested_role) as 'contributor' | 'driver',
              status: 'pending',
              resolved_by_user_id: null,
              created_at: now,
              updated_at: now
            }
          ];
          return { data: { id: 'request-1' }, error: null };
        case 'respond_room_role_request':
          state.role_requests = state.role_requests.map((request) =>
            request.id === args.target_request_id
              ? {
                  ...request,
                  status: String(args.next_status) as 'approved' | 'declined',
                  resolved_by_user_id: 'user-1',
                  updated_at: now
                }
              : request
          );
          return { data: { id: 'request-1' }, error: null };
        case 'set_room_terminal_mode':
          state.terminal_state =
            args.next_mode === 'off'
              ? null
              : {
                  room_id: 'room-1',
                  mode: 'announce_only',
                  enabled_by_user_id: 'user-1',
                  enabled_by_display_name: 'Owner',
                  note: (args.terminal_note as string | null) ?? null,
                  updated_at: now
                };
          return { data: null, error: null };
        case 'post_room_message': {
          const message = {
            id: 'message-1',
            room_id: 'room-1',
            author_id: 'user-1',
            body: String(args.message_body),
            created_at: now
          };
          state.messages.push(message);
          return { data: message, error: null };
        }
        case 'upsert_shared_thread': {
          const thread = {
            id: 'shared-thread-1',
            room_id: 'room-1',
            thread_id: String(args.input_thread_id),
            project_id: (args.input_project_id as string | null) ?? null,
            project_label: (args.input_project_label as string | null) ?? null,
            title: String(args.input_title),
            status: String(args.input_status) as 'idle' | 'active' | 'completed' | 'failed',
            driver_user_id: 'user-1',
            provider_id: String(args.input_provider_id) as 'openai' | 'gemini',
            model_id: String(args.input_model_id),
            last_prompt_summary: (args.input_last_prompt_summary as string | null) ?? null,
            latest_assistant_summary: (args.input_latest_assistant_summary as string | null) ?? null,
            run_id: (args.input_run_id as string | null) ?? null,
            created_at: now,
            updated_at: now
          };
          state.shared_threads = [thread];
          return { data: thread, error: null };
        }
        case 'upsert_shared_run': {
          const run = {
            id: 'shared-run-1',
            room_id: 'room-1',
            thread_id: String(args.input_thread_id),
            thread_title: String(args.input_thread_title),
            run_id: String(args.input_run_id),
            driver_user_id: 'user-1',
            provider_id: String(args.input_provider_id) as 'openai' | 'gemini',
            model_id: String(args.input_model_id),
            execution_permission: String(args.input_execution_permission) as 'readonly' | 'workspace-write' | 'danger-full-access',
            status: String(args.input_status) as 'queued' | 'running' | 'completed' | 'failed' | 'cancelled',
            task_title: (args.input_task_title as string | null) ?? null,
            summary: (args.input_summary as string | null) ?? null,
            changed_files_json: (args.input_changed_files_json as string[]) ?? [],
            diff_stats_json:
              (args.input_diff_stats_json as { filesChanged: number; insertions: number; deletions: number } | null) ?? null,
            tests_summary: (args.input_tests_summary as string | null) ?? null,
            result_label: (args.input_result_label as string | null) ?? null,
            started_at: now,
            updated_at: now,
            completed_at: (args.input_completed_at as string | null) ?? null
          };
          state.shared_runs = [run];
          return { data: run, error: null };
        }
        case 'create_room_handoff': {
          const handoff = {
            id: 'handoff-1',
            room_id: 'room-1',
            thread_id: String(args.input_thread_id),
            run_id: (args.input_run_id as string | null) ?? null,
            author_user_id: 'user-1',
            title: String(args.input_title),
            summary: String(args.input_summary),
            branch_name: (args.input_branch_name as string | null) ?? null,
            dirty_file_count: Number(args.input_dirty_file_count),
            staged_file_count: Number(args.input_staged_file_count),
            changed_files_json: (args.input_changed_files_json as string[]) ?? [],
            outstanding_tasks_json: (args.input_outstanding_tasks_json as string[]) ?? [],
            recommended_next_prompt: (args.input_recommended_next_prompt as string | null) ?? null,
            created_at: now
          };
          state.handoffs = [handoff];
          return { data: handoff, error: null };
        }
        default:
          throw new Error(`Unexpected RPC call in test: ${name}`);
      }
    });

    const service = new CollaborationService(db);
    attachRpc(service, rpc);

    const track = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(service as never, 'ensureRoomChannel').mockResolvedValue({ track } as never);
    vi.spyOn(service as never, 'syncFromRemote').mockResolvedValue(undefined);

    expect(await service.listRooms()).toEqual([expect.objectContaining({ id: 'room-1' })]);

    const roomDetail = await service.openRoom('room-1');
    expect(roomDetail.room.name).toBe('#General');
    expect((await service.listContacts()).map((contact) => contact.userId)).toContain('user-2');

    const followers = await service.setFollowing({ roomId: 'room-1', following: true });
    expect(followers).toEqual([expect.objectContaining({ userId: 'user-1' })]);

    const request = await service.requestRole({ roomId: 'room-1', requestedRole: 'contributor' });
    expect(request).toMatchObject({ id: 'request-1', status: 'pending', requestedRole: 'contributor' });

    const resolvedRequest = await service.resolveRoleRequest({
      roomId: 'room-1',
      requestId: 'request-1',
      status: 'approved'
    });
    expect(resolvedRequest).toMatchObject({ id: 'request-1', status: 'approved' });

    const terminalState = await service.setTerminalMode({
      roomId: 'room-1',
      mode: 'announce_only',
      note: 'Host is narrating the current terminal flow.'
    });
    expect(terminalState).toMatchObject({ mode: 'announce_only', enabledByUserId: 'user-1' });

    const message = await service.sendMessage({
      roomId: 'room-1',
      body: 'Room update'
    });
    expect(message.body).toBe('Room update');

    const presenceEvent = await service.setPresence({
      roomId: 'room-1',
      status: 'busy',
      currentThreadId: 'thread-1',
      currentThreadTitle: 'Investigate collaboration issue'
    });
    expect(presenceEvent).toBeUndefined();
    expect(track).toHaveBeenCalledTimes(1);
    expect(db.listCollabPresence('room-1')).toEqual([expect.objectContaining({ userId: 'user-1', status: 'busy' })]);

    const sharedThread = await service.shareThread({
      roomId: 'room-1',
      threadId: 'thread-1',
      title: 'Investigate collaboration issue',
      projectId: 'project-1',
      projectLabel: 'vicode-windows',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      lastPromptSummary: 'Resolve stale identity handling.'
    });
    expect(sharedThread.threadId).toBe('thread-1');

    const sharedRun = await service.shareRun({
      roomId: 'room-1',
      threadId: 'thread-1',
      threadTitle: 'Investigate collaboration issue',
      runId: 'run-1',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'workspace-write',
      status: 'running',
      taskTitle: 'Patch collaboration integration',
      summary: 'Applying the stale-identity fix.',
      changedFiles: ['src/main/services/collab.ts'],
      diffStats: { filesChanged: 1, insertions: 12, deletions: 0 }
    });
    expect(sharedRun.runId).toBe('run-1');
    expect(sharedRun.status).toBe('running');

    const handoff = await service.createHandoff({
      roomId: 'room-1',
      threadId: 'thread-1',
      runId: 'run-1',
      title: 'Handoff: collaboration hardening',
      summary: 'Continue verification against the shared room.',
      changedFiles: ['src/main/services/collab.ts'],
      outstandingTasks: ['Run build and smoke coverage'],
      recommendedNextPrompt: 'Continue the collaboration hardening pass and verify every endpoint.'
    });
    expect(handoff.title).toBe('Handoff: collaboration hardening');

    const bootstrap = db.getCollabBootstrap();
    expect(bootstrap.followersByRoom['room-1']).toEqual([expect.objectContaining({ userId: 'user-1' })]);
    expect(bootstrap.roleRequestsByRoom['room-1']).toEqual([expect.objectContaining({ id: 'request-1', status: 'approved' })]);
    expect(bootstrap.terminalStateByRoom['room-1']).toEqual(expect.objectContaining({ mode: 'announce_only' }));
    expect(bootstrap.sharedThreadsByRoom['room-1']).toEqual([expect.objectContaining({ threadId: 'thread-1' })]);
    expect(bootstrap.sharedRunsByRoom['room-1']).toEqual([expect.objectContaining({ runId: 'run-1' })]);
    expect(bootstrap.handoffsByRoom['room-1']).toEqual([expect.objectContaining({ id: 'handoff-1' })]);
    expect(bootstrap.messagesByRoom['room-1']).toEqual([expect.objectContaining({ id: 'message-1', body: 'Room update' })]);
  });
});

describe('CollaborationService room errors', () => {
  it('normalizes RPC error objects into readable Error messages', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vicode-collab-service-'));
    cleanupPaths.push(dir);

    const db = createTestDatabase(dir);
    seedConnectedIdentity(db);

    const service = new CollaborationService(db);
    attachRpc(service, vi.fn(async () => ({
      data: null,
      error: {
        code: '42883',
        details: null,
        hint: 'No function matches the given name and argument types.',
        message: 'function gen_random_bytes(integer) does not exist'
      }
    })));

    await expect(
      service.createRoom({
        name: 'Debug room',
        topic: 'debugging'
      })
    ).rejects.toThrow(
      'function gen_random_bytes(integer) does not exist (No function matches the given name and argument types.; code 42883)'
    );
  });
});
