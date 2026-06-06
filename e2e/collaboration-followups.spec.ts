import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { closeApp, launchApp, waitForBridge } from './helpers/electron';

const now = '2026-03-20T15:00:00.000Z';
const recommendedPrompt = 'Continue the collaboration hardening pass and verify every endpoint.';
const launchEnv = {
  VICODE_DISABLE_DEFERRED_COLLAB: '1'
};

function seedConnectedRoom(databasePath: string) {
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
    \`).run('https://example.supabase.co', 'seeded-anon-key', 'user-1', 'connected', now);

    const insertProfile = db.prepare(\`
      INSERT INTO collab_profiles (
        id, email, display_name, handle, avatar_url, status, bio, timezone, created_at, updated_at
      ) VALUES (?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?)
    \`);
    insertProfile.run('user-1', 'Kyle', '@kyle', 'online', 'Owner profile', 'America/Toronto', now, now);
    insertProfile.run('user-2', 'Doris Brown', '@doris', 'away', null, 'America/New_York', now, now);

    db.prepare(\`
      INSERT INTO collab_rooms (
        id, type, name, join_code, slug, topic, project_label, direct_user_id, unread_count, member_count, last_activity_at, last_message_preview, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`).run('room-1', 'project', '#General', 'ROOMCODE1', 'Shared implementation', 'vicode-windows', null, 0, 2, now, 'Room bootstrap message', 'user-1', now, now);

    db.prepare(\`
      INSERT INTO collab_room_sessions (room_id, user_id, session_token, updated_at, expires_at)
      VALUES (?, ?, ?, ?, NULL)
    \`).run('room-1', 'user-1', 'session-token-room-1', now);

    const insertMember = db.prepare(\`
      INSERT INTO collab_room_members (
        room_id, user_id, role, membership_state, joined_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    \`);
    insertMember.run('room-1', 'user-1', 'owner', 'active', now, now, now);
    insertMember.run('room-1', 'user-2', 'member', 'active', now, now, now);

    db.prepare(\`
      INSERT INTO collab_shared_threads (
        id, room_id, thread_id, project_id, project_label, title, status, driver_user_id, provider_id, model_id, last_prompt_summary, latest_assistant_summary, run_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`).run(
      'shared-thread-1',
      'room-1',
      'thread-1',
      'project-1',
      'vicode-windows',
      'Investigate collaboration issue',
      'active',
      'user-1',
      'ollama',
      'qwen2.5-coder:14b-instruct-q6_K',
      'Resolve stale identity handling.',
      'Confirmed the room state and summarized the next step.',
      'run-1',
      now,
      now
    );

    db.prepare(\`
      INSERT INTO collab_handoffs (
        id, room_id, thread_id, run_id, author_user_id, title, summary, branch_name, dirty_file_count, staged_file_count, changed_files_json, outstanding_tasks_json, recommended_next_prompt, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    \`).run(
      'handoff-1',
      'room-1',
      'thread-1',
      'run-1',
      'user-1',
      'Handoff: collaboration hardening',
      'Continue verification against the shared room.',
      null,
      0,
      0,
      JSON.stringify(['src/main/services/collab.ts']),
      JSON.stringify(['Run build and smoke coverage']),
      ${JSON.stringify(recommendedPrompt)},
      now
    );

    db.close();
  `;

  execFileSync(process.execPath, ['--input-type=module', '-e', seedScript, databasePath], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
}

test.skip('collaboration follow-up suggestions render as suggestion chips and copy the recommended prompt', async () => {
  let launched = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.collab'],
    env: launchEnv
  });
  const preservedStatePaths = launched.statePaths;
  const cleanupState = launched.cleanupState;

  try {
    const meta = await launched.window.evaluate(async () => await window.vicode.app.getMeta());
    const databasePath = join(meta.statePath, 'vicode.sqlite');

    await closeApp(launched.app, { cleanupState: false });
    launched = { app: null as never, window: null as never, statePaths: preservedStatePaths, cleanupState };

    seedConnectedRoom(databasePath);

    launched = await launchApp({
      bridgePaths: ['vicode.app', 'vicode.collab'],
      statePaths: preservedStatePaths,
      env: launchEnv
    });

    await waitForBridge(launched.window, ['vicode.app', 'vicode.collab']);

    await launched.window.getByLabel('Rooms').click();
    await expect(launched.window.getByRole('heading', { name: 'Chat', level: 2 })).toBeVisible();
    await launched.window.evaluate(() => {
      const clipboard = navigator.clipboard;
      const originalWriteText = clipboard.writeText.bind(clipboard);
      Object.defineProperty(window, '__vicodeCopiedText', {
        value: null,
        writable: true,
        configurable: true
      });
      Object.defineProperty(clipboard, 'writeText', {
        configurable: true,
        value: async (value: string) => {
          (window as typeof window & { __vicodeCopiedText: string | null }).__vicodeCopiedText = value;
          return originalWriteText(value);
        }
      });
    });
    const recommendedPromptChip = launched.window.getByTestId('collab-followup-suggestion-recommended-prompt');
    await expect(recommendedPromptChip).toBeVisible();
    await recommendedPromptChip.scrollIntoViewIfNeeded();
    await recommendedPromptChip.click();
    await expect
      .poll(async () =>
        launched.window.evaluate(
          () => (window as typeof window & { __vicodeCopiedText: string | null }).__vicodeCopiedText
        )
      )
      .toBe(recommendedPrompt);
  } finally {
    await closeApp(launched.app ?? null, { cleanupState: false });
    cleanupState();
  }
});
