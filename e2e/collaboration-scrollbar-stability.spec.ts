import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './helpers/electron';
import { prepareBetterSqlite3 } from '../scripts/prepare-better-sqlite3.mjs';

const now = '2026-03-21T15:00:00.000Z';

function seedScrollableCollaborationState(databasePath: string) {
  const seedScript = `
    import Database from 'better-sqlite3';

    const databasePath = process.argv[1];
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
    for (let index = 0; index < 24; index += 1) {
      const peerId = 'user-' + (index + 2);
      insertProfile.run(peerId, 'Guest ' + (index + 1), '@guest' + (index + 1), index % 3 === 0 ? 'online' : 'away', null, 'America/Toronto', now, now);
    }

    const insertRoom = db.prepare(\`
      INSERT INTO collab_rooms (
        id, type, name, join_code, slug, topic, project_label, direct_user_id, unread_count, member_count, last_activity_at, last_message_preview, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`);
    const insertSession = db.prepare(\`
      INSERT INTO collab_room_sessions (room_id, user_id, session_token, updated_at, expires_at)
      VALUES (?, ?, ?, ?, NULL)
    \`);
    const insertMember = db.prepare(\`
      INSERT INTO collab_room_members (
        room_id, user_id, role, membership_state, joined_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    \`);
    const insertMessage = db.prepare(\`
      INSERT INTO collab_messages (id, room_id, author_id, body, created_at)
      VALUES (?, ?, ?, ?, ?)
    \`);

    for (let index = 0; index < 20; index += 1) {
      const roomId = 'room-' + (index + 1);
      const peerId = 'user-' + ((index % 12) + 2);
      insertRoom.run(
        roomId,
        'project',
        '#Room ' + (index + 1),
        'ROOM' + String(index + 1).padStart(4, '0'),
        'Shared topic ' + (index + 1),
        'vicode-windows',
        null,
        index % 4,
        2,
        now,
        'Room update ' + (index + 1),
        'user-1',
        now,
        now
      );
      insertSession.run(roomId, 'user-1', 'session-token-' + roomId, now);
      insertMember.run(roomId, 'user-1', 'owner', 'active', now, now, now);
      insertMember.run(roomId, peerId, 'member', 'active', now, now, now);
    }

    for (let index = 0; index < 18; index += 1) {
      const roomId = 'dm-' + (index + 1);
      const peerId = 'user-' + (index + 2);
      insertRoom.run(
        roomId,
        'dm',
        'Guest ' + (index + 1),
        'DM' + String(index + 1).padStart(4, '0'),
        null,
        null,
        peerId,
        index % 3,
        2,
        now,
        'Direct ping ' + (index + 1),
        'user-1',
        now,
        now
      );
      insertSession.run(roomId, 'user-1', 'session-token-' + roomId, now);
      insertMember.run(roomId, 'user-1', 'owner', 'active', now, now, now);
      insertMember.run(roomId, peerId, 'member', 'active', now, now, now);
      insertMessage.run('message-' + roomId, roomId, peerId, 'Direct ping ' + (index + 1), now);
    }

    for (let index = 0; index < 36; index += 1) {
      const authorId = index % 2 === 0 ? 'user-1' : 'user-2';
      insertMessage.run(
        'message-room-1-' + index,
        'room-1',
        authorId,
        'Scrollable room message ' + (index + 1) + ' with enough text to keep the conversation pane overflowing during hover verification.',
        now
      );
    }

    db.close();
  `;

  execFileSync(process.execPath, ['--input-type=module', '-e', seedScript, databasePath], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
}

async function prepareBetterSqlite3WithRetry(target: 'node' | 'electron', attempts = 40, delayMs = 500) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      prepareBetterSqlite3(target);
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('better_sqlite3.node is locked') || attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to prepare better-sqlite3 for ${target}.`);
}

async function expectStableX(locatorBeforeAfter: { before: () => Promise<number>; hover: () => Promise<void>; after: () => Promise<number> }) {
  const before = await locatorBeforeAfter.before();
  await locatorBeforeAfter.hover();
  const after = await locatorBeforeAfter.after();
  expect(Math.abs(after - before)).toBeLessThan(0.5);
}

test.skip('collaboration scrollbars do not nudge sidebar or conversation content on hover', async () => {
  let launched = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.collab']
  });
  const preservedStatePaths = launched.statePaths;
  const cleanupState = launched.cleanupState;

  try {
    const meta = await launched.window.evaluate(async () => await window.vicode.app.getMeta());
    const databasePath = join(meta.statePath, 'vicode.sqlite');

    await launched.app.close();
    await prepareBetterSqlite3WithRetry('node');
    launched = { app: null as never, window: null as never, statePaths: preservedStatePaths, cleanupState };

    seedScrollableCollaborationState(databasePath);

    launched = await launchApp({
      bridgePaths: ['vicode.app', 'vicode.collab'],
      statePaths: preservedStatePaths
    });

    const sidebarScroll = launched.window.getByTestId('collab-sidebar-scroll');
    await launched.window.getByLabel('Rooms').click();
    const primaryRoomEntry = sidebarScroll.locator('button').first();
    await primaryRoomEntry.click();

    const roomEntry = primaryRoomEntry.locator('span').first();
    await expectStableX({
      before: async () => (await roomEntry.boundingBox())!.x,
      hover: async () => {
        await sidebarScroll.hover();
        await launched.window.waitForTimeout(150);
      },
      after: async () => (await roomEntry.boundingBox())!.x
    });

    const conversationScroll = launched.window.getByTestId('collab-conversation-scroll');
    const roomMessage = conversationScroll
      .getByText(/Scrollable room message \d+ with enough text to keep the conversation pane overflowing during hover verification\./i)
      .first();
    await expectStableX({
      before: async () => (await roomMessage.boundingBox())!.x,
      hover: async () => {
        await conversationScroll.hover();
        await launched.window.waitForTimeout(150);
      },
      after: async () => (await roomMessage.boundingBox())!.x
    });

    const chatEntry = launched.window.getByRole('button', { name: /Guest 1/i }).first();
    await expectStableX({
      before: async () => (await chatEntry.boundingBox())!.x,
      hover: async () => {
        await sidebarScroll.hover();
        await launched.window.waitForTimeout(150);
      },
      after: async () => (await chatEntry.boundingBox())!.x
    });

    await launched.window.getByTestId('collab-section-contacts').click();
    const contactEntry = launched.window.getByRole('button', { name: /Guest 1/i }).first();
    await expectStableX({
      before: async () => (await contactEntry.boundingBox())!.x,
      hover: async () => {
        await sidebarScroll.hover();
        await launched.window.waitForTimeout(150);
      },
      after: async () => (await contactEntry.boundingBox())!.x
    });
  } finally {
    await launched.app?.close();
    cleanupState();
  }
});
