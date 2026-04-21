import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

import { closeApp, launchApp, waitForBridge } from './helpers/electron';

const tightViewport = { width: 980, height: 760 };
const sidebarWidthStorageKey = 'vicode.sidebar.width';
const sidebarCollapsedStorageKey = 'vicode.sidebar.collapsed';
const maxSidebarWidth = '420';

function seedScrollableThreadState(databasePath: string, threadId: string) {
  const seedScript = `
    import Database from 'better-sqlite3';

    const databasePath = process.argv[1];
    const threadId = process.argv[2];
    const db = new Database(databasePath);

    const insertTurn = db.prepare(
      'INSERT INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );

    db.prepare('DELETE FROM thread_turns WHERE thread_id = ?').run(threadId);

    const totalPairs = 26;
    let lastPreview = '';
    let lastMessageAt = '2026-04-19T15:00:00.000Z';

    for (let index = 0; index < totalPairs; index += 1) {
      const minute = String(index).padStart(2, '0');
      const userAt = '2026-04-19T15:' + minute + ':00.000Z';
      const assistantAt = '2026-04-19T15:' + minute + ':30.000Z';
      const userId = 'turn-user-' + index;
      const assistantId = 'turn-assistant-' + index;
      const userContent =
        'Scrollable transcript user prompt ' +
        (index + 1) +
        ' keeps the transcript overflowing while the sidebar is pinned at maximum width.';
      const assistantContent =
        'Scrollable transcript assistant response ' +
        (index + 1) +
        ' keeps the transcript overflowing during hover verification and should stay horizontally stable.';

      insertTurn.run(userId, threadId, null, 'user', userContent, null, userAt);
      insertTurn.run(assistantId, threadId, null, 'assistant', assistantContent, null, assistantAt);
      lastPreview = assistantContent;
      lastMessageAt = assistantAt;
    }

    db.prepare('UPDATE threads SET status = ?, updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?').run(
      'completed',
      lastMessageAt,
      lastMessageAt,
      lastPreview,
      threadId
    );

    db.close();
  `;

  execFileSync(process.execPath, ['--input-type=module', '-e', seedScript, databasePath, threadId], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
}

async function expectStableX(locatorBeforeAfter: {
  before: () => Promise<number>;
  hover: () => Promise<void>;
  after: () => Promise<number>;
}) {
  const before = await locatorBeforeAfter.before();
  await locatorBeforeAfter.hover();
  const after = await locatorBeforeAfter.after();
  expect(Math.abs(after - before)).toBeLessThan(0.5);
}

test('thread transcript scrollbar does not nudge transcript content at minimum shell width', async () => {
  let launched = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']
  });
  const preservedStatePaths = launched.statePaths;
  const cleanupState = launched.cleanupState;

  try {
    await launched.window.setViewportSize(tightViewport);

    const seeded = await launched.window.evaluate(async () => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const provider = bootstrap.providers.find((entry) => entry.installed) ?? bootstrap.providers[0] ?? null;

      if (!provider) {
        throw new Error('Expected at least one provider for transcript scrollbar coverage.');
      }

      const project = await window.vicode.projects.create({
        name: 'Transcript scrollbar stability',
        folderPath: 'C:/Users/test-user/Desktop/vicode-transcript-scrollbar',
        trusted: true
      });

      const modelId =
        project.defaultModelByProvider[provider.id] ??
        bootstrap.preferences.defaultModelByProvider[provider.id] ??
        provider.models[0]?.id ??
        'gpt-5';

      const thread = await window.vicode.threads.create({
        projectId: project.id,
        title: 'Transcript scrollbar stability thread',
        providerId: provider.id,
        modelId,
        executionPermission: 'default'
      });

      await window.vicode.settings.save({
        selectedProjectId: project.id,
        lastOpenedThreadId: thread.id
      });

      return { threadId: thread.id };
    });

    const meta = await launched.window.evaluate(async () => await window.vicode.app.getMeta());
    const databasePath = join(meta.statePath, 'vicode.sqlite');

    await closeApp(launched.app, { cleanupState: false });
    launched = { app: null as never, window: null as never, statePaths: preservedStatePaths, cleanupState };

    seedScrollableThreadState(databasePath, seeded.threadId);

    launched = await launchApp({
      bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings'],
      statePaths: preservedStatePaths
    });

    await launched.window.setViewportSize(tightViewport);
    await launched.window.evaluate(
      ({ sidebarWidthStorageKey, sidebarCollapsedStorageKey, maxSidebarWidth }) => {
        window.localStorage.setItem(sidebarWidthStorageKey, maxSidebarWidth);
        window.localStorage.setItem(sidebarCollapsedStorageKey, 'false');
      },
      { sidebarWidthStorageKey, sidebarCollapsedStorageKey, maxSidebarWidth }
    );
    await launched.window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(launched.window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']);
    await launched.window.setViewportSize(tightViewport);

    const transcriptScroll = launched.window.locator('.transcript');
    await expect(transcriptScroll).toBeVisible();

    const transcriptMarker = launched.window.getByText(
      'Scrollable transcript assistant response 26 keeps the transcript overflowing during hover verification and should stay horizontally stable.'
    );
    await expect(transcriptMarker).toBeVisible();

    await expectStableX({
      before: async () => (await transcriptMarker.boundingBox())!.x,
      hover: async () => {
        await transcriptScroll.hover();
        await launched.window.waitForTimeout(150);
      },
      after: async () => (await transcriptMarker.boundingBox())!.x
    });
  } finally {
    await closeApp(launched.app, { cleanupState: false }).catch(() => {});
    cleanupState();
  }
});
