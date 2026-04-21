import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { closeApp, launchApp } from './helpers/electron';

test('current shipped surfaces remain wired together in the built app', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-surface-regression-'));
  writeFileSync(
    join(workspaceDir, 'package.json'),
    JSON.stringify(
      {
        name: 'surface-regression-project',
        private: true,
        scripts: {
          build: 'vite build'
        }
      },
      null,
      2
    ),
    'utf8'
  );

  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.skills']
  });

  let projectId: string | null = null;
  let threadId: string | null = null;

  try {
    const seeded = await window.evaluate(async (targetWorkspaceDir) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const project = await window.vicode.projects.create({
        name: `Surface regression ${Date.now()}`,
        folderPath: targetWorkspaceDir,
        trusted: true
      });

      const providerId = project.defaultProviderId;
      const modelId =
        project.defaultModelByProvider[providerId] ??
        bootstrap.preferences.defaultModelByProvider[providerId] ??
        bootstrap.providers.find((provider) => provider.id === providerId)?.models[0]?.id ??
        'gpt-5';

      const thread = await window.vicode.threads.create({
        projectId: project.id,
        providerId,
        modelId,
        executionPermission: 'default'
      });

      await window.vicode.settings.save({
        selectedProjectId: project.id,
        lastOpenedThreadId: thread.id
      });

      await window.vicode.threads.archive(thread.id);

      return {
        projectId: project.id,
        threadId: thread.id,
        threadTitle: thread.title
      };
    }, workspaceDir);

    projectId = seeded.projectId;
    threadId = seeded.threadId;

    await window.reload();
    await window.getByTestId('nav-settings').click();
    await expect(window.getByText('Trust: trusted workspace')).toBeVisible();
    await window.locator('.settings-nav-item').filter({ hasText: 'Providers' }).click();
    await expect(window.getByRole('heading', { name: 'Providers' })).toBeVisible();
    const ollamaCard = window.locator('article').filter({ hasText: 'Ollama' }).first();
    await ollamaCard.scrollIntoViewIfNeeded();
    await expect(ollamaCard.getByText('How Ollama works in Vicode')).toBeVisible();
    await expect(ollamaCard.getByText('Cloud models key')).toBeVisible();
    await expect(window.getByText('API key instead of CLI sign-in (optional)').first()).toBeVisible();
    await expect(window.getByText('API key fallback')).toHaveCount(0);

    await window.locator('.settings-nav-item').filter({ hasText: 'Local storage' }).click();
    await expect(window.getByRole('heading', { name: 'Local storage' })).toBeVisible();
    await expect(window.getByText('App data path')).toBeVisible();

    await window.locator('.settings-nav-item').filter({ hasText: 'Archived threads' }).click();
    await expect(window.getByRole('heading', { name: 'Archived threads' })).toBeVisible();
    const archivedCard = window.locator('.settings-archived-card').filter({ hasText: seeded.threadTitle }).first();
    await expect(archivedCard).toBeVisible();
    await archivedCard.getByRole('button', { name: 'Restore thread' }).click();
    await expect
      .poll(async () => {
        return await window.evaluate(async (targetThreadId) => {
          const archived = await window.vicode.threads.listArchived(null);
          return archived.some((thread) => thread.id === targetThreadId);
        }, seeded.threadId);
      })
      .toBe(false);

  await window.getByTestId('nav-plugins').click();
  await window.getByTestId('skills-tab-plugins').click();
  await expect(window.getByText('Recommended plugins')).toBeVisible();
  await expect(window.getByText('Connect app-managed MCP plugins')).toBeVisible();
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
