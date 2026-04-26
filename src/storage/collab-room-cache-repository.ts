import Database from 'better-sqlite3';
import type {
  CollabMessage,
  CollabPresence,
  CollabProfile,
  CollabRoom,
  CollabRoomMember
} from '../shared/domain';

type Row = Record<string, unknown>;

export class CollabRoomCacheRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly mapRoom: (row: Row) => CollabRoom,
    private readonly mapMember: (row: Row) => CollabRoomMember,
    private readonly mapInvite: (row: Row) => {
      id: string;
      roomId: string;
      code: string;
      status: 'active' | 'redeemed' | 'expired' | 'revoked';
      createdBy: string;
      createdAt: string;
      expiresAt: string | null;
    },
    private readonly mapMessage: (row: Row) => CollabMessage,
    private readonly mapPresence: (row: Row) => CollabPresence,
    private readonly upsertProfile: (profile: CollabProfile) => CollabProfile
  ) {}

  listCollabRooms(type?: CollabRoom['type']): CollabRoom[] {
    const sql = type
      ? 'SELECT * FROM collab_rooms WHERE type = ? ORDER BY last_activity_at DESC, updated_at DESC'
      : 'SELECT * FROM collab_rooms ORDER BY last_activity_at DESC, updated_at DESC';
    const rows = type ? this.db.prepare(sql).all(type) : this.db.prepare(sql).all();
    return rows.map((row) => this.mapRoom(row as Row));
  }

  getCollabRoom(roomId: string): CollabRoom {
    const row = this.db.prepare('SELECT * FROM collab_rooms WHERE id = ?').get(roomId) as Row | undefined;
    if (!row) {
      throw new Error(`Collaboration room not found: ${roomId}`);
    }
    return this.mapRoom(row);
  }

  upsertCollabRoom(room: CollabRoom): CollabRoom {
    this.db
      .prepare(
        `INSERT INTO collab_rooms (
          id, type, name, join_code, slug, topic, project_label, direct_user_id, unread_count, member_count, last_activity_at, last_message_preview, created_by, created_at, updated_at
        ) VALUES (
          @id, @type, @name, @joinCode, @slug, @topic, @projectLabel, @directUserId, @unreadCount, @memberCount, @lastActivityAt, @lastMessagePreview, @createdBy, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          name = excluded.name,
          join_code = excluded.join_code,
          slug = excluded.slug,
          topic = excluded.topic,
          project_label = excluded.project_label,
          direct_user_id = excluded.direct_user_id,
          unread_count = excluded.unread_count,
          member_count = excluded.member_count,
          last_activity_at = excluded.last_activity_at,
          last_message_preview = excluded.last_message_preview,
          created_by = excluded.created_by,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`
      )
      .run({
        id: room.id,
        type: room.type,
        name: room.name,
        joinCode: room.joinCode,
        slug: room.slug,
        topic: room.topic,
        projectLabel: room.projectLabel,
        directUserId: room.directUserId,
        unreadCount: room.unreadCount,
        memberCount: room.memberCount,
        lastActivityAt: room.lastActivityAt,
        lastMessagePreview: room.lastMessagePreview,
        createdBy: room.createdBy,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt
      });
    return this.getCollabRoom(room.id);
  }

  listCollabRoomMembers(roomId: string): CollabRoomMember[] {
    const rows = this.db
      .prepare(
        `SELECT
          members.*,
          profiles.display_name,
          profiles.handle,
          profiles.avatar_url,
          profiles.status
         FROM collab_room_members members
         INNER JOIN collab_profiles profiles ON profiles.id = members.user_id
         WHERE members.room_id = ?
         ORDER BY profiles.display_name COLLATE NOCASE ASC`
      )
      .all(roomId);
    return rows.map((row) => this.mapMember(row as Row));
  }

  replaceCollabRoomMembers(roomId: string, members: CollabRoomMember[]) {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM collab_room_members WHERE room_id = ?').run(roomId);
      const insert = this.db.prepare(
        `INSERT INTO collab_room_members (
          room_id, user_id, role, membership_state, joined_at, created_at, updated_at
        ) VALUES (
          @roomId, @userId, @role, @membershipState, @joinedAt, @createdAt, @updatedAt
        )`
      );
      for (const member of members) {
        const now = new Date().toISOString();
        this.upsertProfile({
          id: member.userId,
          email: null,
          displayName: member.displayName,
          handle: member.handle,
          avatarUrl: member.avatarUrl,
          status: member.status,
          bio: null,
          timezone: null,
          createdAt: now,
          updatedAt: now
        });
        insert.run({
          roomId: member.roomId,
          userId: member.userId,
          role: member.role,
          membershipState: member.membershipState,
          joinedAt: member.joinedAt,
          createdAt: member.joinedAt ?? now,
          updatedAt: now
        });
      }
    });
    transaction();
  }

  listCollabInvites(roomId: string) {
    return this.db
      .prepare('SELECT * FROM collab_invites WHERE room_id = ? ORDER BY created_at DESC')
      .all(roomId)
      .map((row) => this.mapInvite(row as Row));
  }

  upsertCollabInvite(invite: {
    id: string;
    roomId: string;
    code: string;
    status: 'active' | 'redeemed' | 'expired' | 'revoked';
    createdBy: string;
    createdAt: string;
    expiresAt: string | null;
  }) {
    this.db
      .prepare(
        `INSERT INTO collab_invites (id, room_id, code, status, created_by, created_at, expires_at)
         VALUES (@id, @roomId, @code, @status, @createdBy, @createdAt, @expiresAt)
         ON CONFLICT(id) DO UPDATE SET
           room_id = excluded.room_id,
           code = excluded.code,
           status = excluded.status,
           created_by = excluded.created_by,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`
      )
      .run({
        id: invite.id,
        roomId: invite.roomId,
        code: invite.code,
        status: invite.status,
        createdBy: invite.createdBy,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt
      });
    return this.listCollabInvites(invite.roomId).find((candidate) => candidate.id === invite.id) ?? invite;
  }

  listCollabMessages(roomId: string): CollabMessage[] {
    return this.db
      .prepare(
        `SELECT
          messages.*,
          profiles.display_name,
          profiles.handle
         FROM collab_messages messages
         INNER JOIN collab_profiles profiles ON profiles.id = messages.author_id
         WHERE room_id = ?
         ORDER BY created_at ASC`
      )
      .all(roomId)
      .map((row) => this.mapMessage(row as Row));
  }

  upsertCollabMessage(message: CollabMessage): CollabMessage {
    this.db
      .prepare(
        `INSERT INTO collab_messages (id, room_id, author_id, body, created_at)
         VALUES (@id, @roomId, @authorId, @body, @createdAt)
         ON CONFLICT(id) DO UPDATE SET
           room_id = excluded.room_id,
           author_id = excluded.author_id,
           body = excluded.body,
           created_at = excluded.created_at`
      )
      .run({
        id: message.id,
        roomId: message.roomId,
        authorId: message.authorId,
        body: message.body,
        createdAt: message.createdAt
      });
    return this.listCollabMessages(message.roomId).find((candidate) => candidate.id === message.id) ?? message;
  }

  replaceCollabMessages(roomId: string, messages: CollabMessage[]) {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM collab_messages WHERE room_id = ?').run(roomId);
      for (const message of messages) {
        this.upsertCollabMessage(message);
      }
    });
    transaction();
  }

  listCollabPresence(roomId: string): CollabPresence[] {
    return this.db
      .prepare('SELECT * FROM collab_presences WHERE room_id = ? ORDER BY updated_at DESC')
      .all(roomId)
      .map((row) => this.mapPresence(row as Row));
  }

  upsertCollabPresence(presence: CollabPresence): CollabPresence {
    this.db
      .prepare(
        `INSERT INTO collab_presences (
          room_id, user_id, status, current_thread_id, current_thread_title, branch_name, worktree_name, active_run_id, active_run_title, dirty_file_count, staged_file_count, updated_at
        ) VALUES (
          @roomId, @userId, @status, @currentThreadId, @currentThreadTitle, @branchName, @worktreeName, @activeRunId, @activeRunTitle, @dirtyFileCount, @stagedFileCount, @updatedAt
        )
        ON CONFLICT(room_id, user_id) DO UPDATE SET
          status = excluded.status,
          current_thread_id = excluded.current_thread_id,
          current_thread_title = excluded.current_thread_title,
          branch_name = excluded.branch_name,
          worktree_name = excluded.worktree_name,
          active_run_id = excluded.active_run_id,
          active_run_title = excluded.active_run_title,
          dirty_file_count = excluded.dirty_file_count,
          staged_file_count = excluded.staged_file_count,
          updated_at = excluded.updated_at`
      )
      .run({
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
      });
    return this.listCollabPresence(presence.roomId).find((candidate) => candidate.userId === presence.userId) ?? presence;
  }

  replaceCollabPresence(roomId: string, presence: CollabPresence[]) {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM collab_presences WHERE room_id = ?').run(roomId);
      for (const entry of presence) {
        this.upsertCollabPresence(entry);
      }
    });
    transaction();
  }
}
