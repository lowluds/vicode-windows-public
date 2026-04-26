import Database from 'better-sqlite3';
import type {
  CollabAccount,
  CollabConfig,
  CollabProfile,
  CollabRoomSession
} from '../shared/domain';

type Row = Record<string, unknown>;

export class CollabIdentityRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly defaultConfig: CollabConfig,
    private readonly defaultAccount: CollabAccount,
    private readonly mapProfile: (row: Row) => CollabProfile
  ) {}

  getCollabConfig(): CollabConfig {
    const row = this.db.prepare('SELECT * FROM collab_settings WHERE id = 1').get() as Row | undefined;
    if (!row) {
      return this.defaultConfig;
    }

    return {
      supabaseUrl: (row.supabase_url as string | null) ?? null,
      hasAnonKey: Boolean(row.supabase_anon_key),
      connectionState: (row.connection_state as CollabConfig['connectionState']) ?? this.defaultConfig.connectionState,
      lastError: (row.last_error as string | null) ?? null
    };
  }

  getCollabServiceConfig(): { supabaseUrl: string | null; supabaseAnonKey: string | null } {
    const row = this.db.prepare('SELECT supabase_url, supabase_anon_key FROM collab_settings WHERE id = 1').get() as Row | undefined;
    return {
      supabaseUrl: (row?.supabase_url as string | null) ?? null,
      supabaseAnonKey: (row?.supabase_anon_key as string | null) ?? null
    };
  }

  saveCollabConfig(input: { supabaseUrl: string; supabaseAnonKey: string }): CollabConfig {
    const currentIdentity = this.getCollabAccount();
    this.db
      .prepare(
        `UPDATE collab_settings
         SET supabase_url = @supabaseUrl,
             supabase_anon_key = @supabaseAnonKey,
             connection_state = @connectionState,
             last_error = NULL,
             updated_at = @updatedAt
         WHERE id = 1`
      )
      .run({
        supabaseUrl: input.supabaseUrl,
        supabaseAnonKey: input.supabaseAnonKey,
        connectionState: currentIdentity.userId ? 'connecting' : 'identity_required',
        updatedAt: new Date().toISOString()
      });

    return this.getCollabConfig();
  }

  clearCollabConfig(): CollabConfig {
    this.db
      .prepare(
        `UPDATE collab_settings
         SET supabase_url = NULL,
             supabase_anon_key = NULL,
             encrypted_session_json = NULL,
             current_user_id = NULL,
             current_email = NULL,
             session_expires_at = NULL,
             connection_state = 'unconfigured',
             last_error = NULL,
             updated_at = @updatedAt,
             last_synced_at = NULL
         WHERE id = 1`
      )
      .run({
        updatedAt: new Date().toISOString()
      });
    this.clearCollabCache();
    this.db.prepare('DELETE FROM collab_room_sessions').run();
    return this.getCollabConfig();
  }

  setCollabConnectionState(connectionState: CollabConfig['connectionState'], lastError: string | null = null): CollabConfig {
    this.db
      .prepare(
        `UPDATE collab_settings
         SET connection_state = @connectionState,
             last_error = @lastError,
             updated_at = @updatedAt
         WHERE id = 1`
      )
      .run({
        connectionState,
        lastError,
        updatedAt: new Date().toISOString()
      });
    return this.getCollabConfig();
  }

  getCollabEncryptedSession(): string | null {
    const row = this.db.prepare('SELECT encrypted_session_json FROM collab_settings WHERE id = 1').get() as Row | undefined;
    return (row?.encrypted_session_json as string | null) ?? null;
  }

  getCollabAccount(): CollabAccount {
    const row = this.db.prepare('SELECT current_email, current_user_id, session_expires_at FROM collab_settings WHERE id = 1').get() as Row | undefined;
    if (!row) {
      return this.defaultAccount;
    }
    return {
      email: (row.current_email as string | null) ?? null,
      userId: (row.current_user_id as string | null) ?? null,
      expiresAt: (row.session_expires_at as string | null) ?? null
    };
  }

  setCollabIdentity(input: { userId: string | null; connectionState: CollabConfig['connectionState'] }): CollabAccount {
    this.db
      .prepare(
        `UPDATE collab_settings
         SET current_user_id = @currentUserId,
             current_email = NULL,
             session_expires_at = NULL,
             encrypted_session_json = NULL,
             connection_state = @connectionState,
             last_error = NULL,
             updated_at = @updatedAt
         WHERE id = 1`
      )
      .run({
        currentUserId: input.userId,
        connectionState: input.connectionState,
        updatedAt: new Date().toISOString()
      });
    return this.getCollabAccount();
  }

  saveCollabSession(input: {
    encryptedSessionJson: string | null;
    currentUserId: string | null;
    currentEmail: string | null;
    expiresAt: string | null;
    connectionState: CollabConfig['connectionState'];
  }): CollabAccount {
    this.db
      .prepare(
        `UPDATE collab_settings
         SET encrypted_session_json = @encryptedSessionJson,
             current_user_id = @currentUserId,
             current_email = @currentEmail,
             session_expires_at = @expiresAt,
             connection_state = @connectionState,
             last_error = NULL,
             updated_at = @updatedAt
         WHERE id = 1`
      )
      .run({
        encryptedSessionJson: input.encryptedSessionJson,
        currentUserId: input.currentUserId,
        currentEmail: input.currentEmail,
        expiresAt: input.expiresAt,
        connectionState: input.connectionState,
        updatedAt: new Date().toISOString()
      });
    return this.getCollabAccount();
  }

  clearCollabSession() {
    const config = this.getCollabConfig();
    this.db
      .prepare(
        `UPDATE collab_settings
         SET encrypted_session_json = NULL,
             current_user_id = NULL,
             current_email = NULL,
             session_expires_at = NULL,
             connection_state = @connectionState,
             last_error = NULL,
             updated_at = @updatedAt
         WHERE id = 1`
      )
      .run({
        connectionState: config.hasAnonKey && config.supabaseUrl ? 'identity_required' : 'unconfigured',
        updatedAt: new Date().toISOString()
      });
  }

  touchCollabSync(timestamp = new Date().toISOString()) {
    this.db.prepare('UPDATE collab_settings SET last_synced_at = ?, updated_at = ? WHERE id = 1').run(timestamp, timestamp);
  }

  clearCollabCache() {
    this.db.exec(`
      DELETE FROM collab_handoffs;
      DELETE FROM collab_shared_runs;
      DELETE FROM collab_shared_threads;
      DELETE FROM collab_presences;
      DELETE FROM collab_messages;
      DELETE FROM collab_role_requests;
      DELETE FROM collab_room_followers;
      DELETE FROM collab_room_terminal_states;
      DELETE FROM collab_invites;
      DELETE FROM collab_room_sessions;
      DELETE FROM collab_room_members;
      DELETE FROM collab_rooms;
      DELETE FROM collab_profiles;
    `);
  }

  clearCollabRoomCache() {
    this.db.exec(`
      DELETE FROM collab_handoffs;
      DELETE FROM collab_shared_runs;
      DELETE FROM collab_shared_threads;
      DELETE FROM collab_presences;
      DELETE FROM collab_messages;
      DELETE FROM collab_role_requests;
      DELETE FROM collab_room_followers;
      DELETE FROM collab_room_terminal_states;
      DELETE FROM collab_invites;
      DELETE FROM collab_room_members;
      DELETE FROM collab_rooms;
    `);
  }

  getActiveCollabProfile(): CollabProfile | null {
    const account = this.getCollabAccount();
    if (!account.userId) {
      return null;
    }
    return this.getCollabProfile(account.userId);
  }

  getCollabProfile(userId: string): CollabProfile | null {
    const row = this.db.prepare('SELECT * FROM collab_profiles WHERE id = ?').get(userId) as Row | undefined;
    return row ? this.mapProfile(row) : null;
  }

  upsertCollabRoomSession(session: CollabRoomSession): CollabRoomSession {
    this.db
      .prepare(
        `INSERT INTO collab_room_sessions (room_id, user_id, session_token, updated_at, expires_at)
         VALUES (@roomId, @userId, @sessionToken, @updatedAt, @expiresAt)
         ON CONFLICT(room_id, user_id) DO UPDATE SET
           session_token = excluded.session_token,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at`
      )
      .run({
        roomId: session.roomId,
        userId: session.userId,
        sessionToken: session.sessionToken,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt
      });
    return this.getCollabRoomSession(session.roomId, session.userId) ?? session;
  }

  getCollabRoomSession(roomId: string, userId?: string | null): CollabRoomSession | null {
    const resolvedUserId = userId ?? this.getCollabAccount().userId;
    if (!resolvedUserId) {
      return null;
    }
    const row = this.db
      .prepare('SELECT * FROM collab_room_sessions WHERE room_id = ? AND user_id = ?')
      .get(roomId, resolvedUserId) as Row | undefined;
    return row
      ? {
          roomId: String(row.room_id),
          userId: String(row.user_id),
          sessionToken: String(row.session_token),
          updatedAt: String(row.updated_at),
          expiresAt: (row.expires_at as string | null) ?? null
        }
      : null;
  }

  listCollabRoomSessions(userId?: string | null): CollabRoomSession[] {
    const resolvedUserId = userId ?? this.getCollabAccount().userId;
    const rows = resolvedUserId
      ? this.db.prepare('SELECT * FROM collab_room_sessions WHERE user_id = ? ORDER BY updated_at DESC').all(resolvedUserId)
      : this.db.prepare('SELECT * FROM collab_room_sessions ORDER BY updated_at DESC').all();
    return rows.map((row) => ({
      roomId: String((row as Row).room_id),
      userId: String((row as Row).user_id),
      sessionToken: String((row as Row).session_token),
      updatedAt: String((row as Row).updated_at),
      expiresAt: (((row as Row).expires_at as string | null) ?? null)
    }));
  }

  removeCollabRoomSession(roomId: string, userId?: string | null) {
    const resolvedUserId = userId ?? this.getCollabAccount().userId;
    if (resolvedUserId) {
      this.db.prepare('DELETE FROM collab_room_sessions WHERE room_id = ? AND user_id = ?').run(roomId, resolvedUserId);
      return;
    }
    this.db.prepare('DELETE FROM collab_room_sessions WHERE room_id = ?').run(roomId);
  }

  upsertCollabProfile(profile: CollabProfile): CollabProfile {
    this.db
      .prepare(
        `INSERT INTO collab_profiles (
          id, email, display_name, handle, avatar_url, status, bio, timezone, created_at, updated_at
        ) VALUES (
          @id, @email, @displayName, @handle, @avatarUrl, @status, @bio, @timezone, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          email = excluded.email,
          display_name = excluded.display_name,
          handle = excluded.handle,
          avatar_url = excluded.avatar_url,
          status = excluded.status,
          bio = excluded.bio,
          timezone = excluded.timezone,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`
      )
      .run({
        id: profile.id,
        email: profile.email,
        displayName: profile.displayName,
        handle: profile.handle,
        avatarUrl: profile.avatarUrl,
        status: profile.status,
        bio: profile.bio,
        timezone: profile.timezone,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt
      });
    return this.getCollabProfile(profile.id) ?? profile;
  }
}
