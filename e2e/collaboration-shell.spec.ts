import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { closeApp, launchApp, waitForBridge } from './helpers/electron';

test('collaboration shell stays parked out of the current app chrome', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-collab-parked-'));
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']
  });

  let projectId: string | null = null;
  let threadId: string | null = null;

  try {
    const seeded = await window.evaluate(async (targetWorkspaceDir) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const provider = bootstrap.providers.find((entry) => entry.id === 'openai') ?? bootstrap.providers[0];
      if (!provider) {
        throw new Error('Expected at least one provider for the parked collaboration shell test.');
      }

      const modelId =
        bootstrap.preferences.defaultModelByProvider[provider.id] ??
        provider.models[0]?.id ??
        'gpt-5';

      const project = await window.vicode.projects.create({
        name: `Collab parked ${Date.now()}`,
        folderPath: targetWorkspaceDir,
        trusted: true
      });

      const thread = await window.vicode.threads.create({
        projectId: project.id,
        providerId: provider.id,
        modelId,
        executionPermission: 'default'
      });

      await window.vicode.settings.save({
        selectedProjectId: project.id,
        lastOpenedThreadId: thread.id
      });

      return {
        projectId: project.id,
        threadId: thread.id
      };
    }, workspaceDir);

    projectId = seeded.projectId;
    threadId = seeded.threadId;

    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']);

    await expect(window.getByTestId('composer-input')).toBeVisible();
    await expect(window.getByLabel('Rooms')).toHaveCount(0);

    const threadActions = window.getByRole('button', { name: 'Thread actions' });
    await expect(threadActions).toBeVisible();
    await threadActions.focus();
    await window.keyboard.press('5');

    await expect(window.getByTestId('composer-input')).toBeVisible();
    await expect(window.getByTestId('chat-utility-pane-layout')).toHaveCount(0);

    await threadActions.click();
    await expect(window.getByRole('menuitem', { name: 'Open folder location' })).toBeVisible();
    await expect(window.getByRole('menuitem', { name: 'Rename thread' })).toBeVisible();
    await expect(window.getByRole('menuitem', { name: 'Duplicate thread' })).toBeVisible();
    await expect(window.getByRole('menuitem', { name: 'Retry last prompt' })).toBeVisible();
    await expect(window.getByRole('menuitem', { name: 'Archive thread' })).toBeVisible();
    await expect(window.getByRole('menuitem', { name: 'Delete permanently' })).toBeVisible();
    await expect(window.getByRole('menuitem', { name: 'Capture daily note' })).toHaveCount(0);
    await expect(window.getByRole('menuitem', { name: 'Promote to memory' })).toHaveCount(0);
    await expect(window.getByRole('menuitem', { name: 'Suggest USER.md update' })).toHaveCount(0);
    await expect(window.getByRole('menuitem', { name: 'Export thread diagnostics' })).toHaveCount(0);
    await expect(window.getByRole('menuitem', { name: 'Share thread' })).toHaveCount(0);
    await expect(window.getByRole('menuitem', { name: 'Open collaboration rooms' })).toHaveCount(0);
  } finally {
    if (projectId) {
      await window.evaluate(
        async ({ targetProjectId, targetThreadId }) => {
          if (targetThreadId) {
            await window.vicode.threads.remove(targetThreadId).catch(() => {});
          }
          await window.vicode.projects.remove(targetProjectId).catch(() => {});
        },
        { targetProjectId: projectId, targetThreadId: threadId }
      ).catch(() => {});
    }

    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
