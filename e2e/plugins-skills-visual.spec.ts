import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { closeApp, launchApp, waitForBridge, waitForThreadSurfaceReady } from './helpers/electron';

test('titlebar keeps legacy plugins, automations, and build control parked from primary chrome', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-titlebar-minimal-'));
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']
  });
  let projectId: string | null = null;
  let threadId: string | null = null;

  try {
    const seeded = await window.evaluate(async ({ workspaceDir }) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const provider =
        bootstrap.providers.find((entry) => entry.id === 'ollama') ??
        bootstrap.providers.find((entry) => entry.id === 'openai_compatible') ??
        null;
      if (!provider) {
        throw new Error('Expected a release-facing provider for titlebar coverage.');
      }
      const project = await window.vicode.projects.create({
        name: `Minimal chrome ${Date.now()}`,
        folderPath: workspaceDir,
        trusted: true
      });
      const modelId =
        project.defaultModelByProvider[provider.id] ??
        bootstrap.preferences.defaultModelByProvider[provider.id] ??
        provider.models[0]?.id ??
        'qwen2.5-coder:14b-instruct-q6_K';
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
      return { projectId: project.id, threadId: thread.id };
    }, { workspaceDir });

    projectId = seeded.projectId;
    threadId = seeded.threadId;
    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']);
    await waitForThreadSurfaceReady(window);

    await expect(window.getByTestId('nav-settings')).toBeVisible();
    await expect(window.getByTestId('nav-skills')).toBeVisible();
    await expect(window.getByTestId('nav-plugins')).toHaveCount(0);
    await expect(window.getByTestId('nav-automations')).toHaveCount(0);
    await expect(window.getByText('Autonomous Builds')).toHaveCount(0);
    await expect(window.getByText('Build Control')).toHaveCount(0);
    await window.getByTestId('nav-skills').click();
    await expect(window.locator('.skills-page-shell')).toBeVisible();
    await expect(window.getByTestId('skills-tab-plugins')).toBeVisible();
    await expect(window.getByTestId('skills-tab-skills')).toBeVisible();
    await expect(window.getByRole('button', { name: 'Close catalog' })).toBeVisible();
    await expect(window.getByTestId('nav-plugins')).toHaveCount(0);
    await expect(window.getByTestId('nav-automations')).toHaveCount(0);
    await window.getByRole('button', { name: 'Close catalog' }).click();
    await expect(window.getByTestId('composer-input')).toBeVisible();
    await window.getByTestId('nav-settings').click();
    await expect(window.getByRole('heading', { name: 'App' })).toBeVisible();
    await expect(window.locator('.settings-nav-item').filter({ hasText: 'Providers' })).toBeVisible();
    await expect(window.locator('.settings-nav-item').filter({ hasText: 'Instructions' })).toHaveCount(0);
    await expect(window.locator('.settings-nav-item').filter({ hasText: 'Personalization' })).toHaveCount(0);
    await expect(window.getByText('Global instructions')).toHaveCount(0);
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
