import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { closeApp, launchApp } from './helpers/electron';

const now = '2026-03-20T15:00:00.000Z';

function seedCollaborationState(databasePath: string, options: { includeDirectChat: boolean }) {
  const seedScript = `
    import Database from 'better-sqlite3';

    const databasePath = process.argv[1];
    const includeDirectChat = process.argv[2] === 'true';
    const now = ${JSON.stringify(now)};
    const db = new Database(databasePath);

    db.exec(\`
      DELETE FROM collab_handoffs;
      DELETE FROM collab_shared_runs;
      DELETE FROM collab_shared_threads;
      DELETE FROM collab_presences;
      DELETE FROM collab_messages;
      DELETE FROM collab_invites;
      DELETE FROM collab_room_members;
      DELETE FROM collab_room_sessions;
      DELETE FROM collab_rooms;
      DELETE FROM collab_profiles;
    \`);

    db.prepare(\`
      UPDATE collab_settings
      SET supabase_url = ?,
          supabase_anon_key = ?,
          encrypted_session_json = NULL,
          current_user_id = ?,
          current_email = NULL,
          session_expires_at = NULL,
          connection_state = ?,
          last_error = NULL,
          updated_at = ?,
          last_synced_at = NULL
      WHERE id = 1
    \`).run('', 'seeded-anon-key', 'user-1', 'connected', now);

    const insertProfile = db.prepare(\`
      INSERT INTO collab_profiles (
        id, email, display_name, handle, avatar_url, status, bio, timezone, created_at, updated_at
      ) VALUES (?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?)
    \`);
    insertProfile.run('user-1', 'Kyle', '@kyle', 'online', 'Owner profile', 'America/Toronto', now, now);
    insertProfile.run('user-2', 'Doris Brown', '@doris', 'away', null, 'America/New_York', now, now);

    const insertRoom = db.prepare(\`
      INSERT INTO collab_rooms (
        id, type, name, join_code, slug, topic, project_label, direct_user_id, unread_count, member_count, last_activity_at, last_message_preview, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`);
    insertRoom.run('room-1', 'project', '#General', 'ROOMCODE1', 'Shared implementation', 'vicode-windows', null, 0, 2, now, 'Room bootstrap message', 'user-1', now, now);

    const insertSession = db.prepare(\`
      INSERT INTO collab_room_sessions (room_id, user_id, session_token, updated_at, expires_at)
      VALUES (?, ?, ?, ?, NULL)
    \`);
    insertSession.run('room-1', 'user-1', 'session-token-room-1', now);

    const insertMember = db.prepare(\`
      INSERT INTO collab_room_members (
        room_id, user_id, role, membership_state, joined_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    \`);
    insertMember.run('room-1', 'user-1', 'owner', 'active', now, now, now);
    insertMember.run('room-1', 'user-2', 'member', 'active', now, now, now);

    if (includeDirectChat) {
      insertRoom.run('dm-1', 'dm', 'Doris Brown', 'DMCODE42', null, null, 'user-2', 0, 2, now, 'Ping from the peer', 'user-1', now, now);
      insertSession.run('dm-1', 'user-1', 'session-token-dm-1', now);
      insertMember.run('dm-1', 'user-1', 'owner', 'active', now, now, now);
      insertMember.run('dm-1', 'user-2', 'member', 'active', now, now, now);
      db.prepare(\`
        INSERT INTO collab_messages (id, room_id, author_id, body, created_at)
        VALUES (?, ?, ?, ?, ?)
      \`).run('message-dm-1', 'dm-1', 'user-2', 'Ping from the peer', now);
    }

    db.close();
  `;

  execFileSync(process.execPath, ['--input-type=module', '-e', seedScript, databasePath, String(options.includeDirectChat)], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
}

test.skip('contacts surface exposes the DM CTA and existing DMs open in chats', async () => {
  let launched = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.collab']
  });
  const preservedStatePaths = launched.statePaths;
  const cleanupState = launched.cleanupState;

  try {
    const meta = await launched.window.evaluate(async () => await window.vicode.app.getMeta());
    const databasePath = join(meta.statePath, 'vicode.sqlite');

    await closeApp(launched.app, { cleanupState: false });
    launched = { app: null as never, window: null as never, statePaths: preservedStatePaths, cleanupState };

    seedCollaborationState(databasePath, { includeDirectChat: false });

    launched = await launchApp({
      bridgePaths: ['vicode.app', 'vicode.collab'],
      statePaths: preservedStatePaths
    });

    await launched.window.getByLabel('Rooms').click();
    await launched.window.getByTestId('collab-section-contacts').click();
    await expect(launched.window.getByRole('heading', { name: 'Contacts', level: 2 })).toBeVisible();
    await expect(launched.window.getByRole('button', { name: 'Start direct chat' })).toBeVisible();

    await closeApp(launched.app, { cleanupState: false });
    launched = { app: null as never, window: null as never, statePaths: preservedStatePaths, cleanupState };

    seedCollaborationState(databasePath, { includeDirectChat: true });

    launched = await launchApp({
      bridgePaths: ['vicode.app', 'vicode.collab'],
      statePaths: preservedStatePaths
    });

    await launched.window.getByLabel('Rooms').click();
    await launched.window.getByTestId('collab-section-contacts').click();
    await launched.window.getByRole('button', { name: 'Open direct' }).click();

    await expect(launched.window.getByRole('heading', { name: 'Chat', level: 2 })).toBeVisible();
    await expect(launched.window.locator('main').getByText('Ping from the peer').last()).toBeVisible();
    await expect(launched.window.getByRole('button', { name: 'Send message' })).toBeVisible();
  } finally {
    await closeApp(launched.app ?? null, { cleanupState: false });
    cleanupState();
  }
});
