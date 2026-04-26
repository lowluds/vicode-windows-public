import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeApp, launchApp, waitForBridge, waitForThreadSurfaceReady } from './helpers/electron';

test('Gemini Connect adopts a detected local CLI sign-in into Vicode', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-gemini-connect-e2e-'));
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.providers', 'vicode.projects', 'vicode.threads', 'vicode.settings']
  });
  let projectId: string | null = null;

  try {
    const bootstrap = await window.evaluate(() => window.vicode.app.getBootstrap());
    const gemini = bootstrap.providers.find((provider) => provider.id === 'gemini');
    test.skip(!gemini?.installed, 'Gemini CLI must be installed for the connect-adoption check.');
    test.skip(
      !(
        gemini.authState === 'detected' ||
        (gemini.authState === 'disconnected' && gemini.authMode === 'cli')
      ),
      'Gemini must have a detected machine-local CLI sign-in for the adoption check.'
    );
    projectId = await window.evaluate(async ({ workspaceDir }) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const provider = bootstrap.providers.find((entry) => entry.id === 'gemini') ?? bootstrap.providers[0];
      const project = await window.vicode.projects.create({
        name: `Gemini connect ${Date.now()}`,
        folderPath: workspaceDir,
        trusted: true
      });
      const modelId =
        project.defaultModelByProvider[provider.id] ??
        bootstrap.preferences.defaultModelByProvider[provider.id] ??
        provider.models[0]?.id ??
        'gemini-2.5-pro';
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
      return project.id;
    }, { workspaceDir });
    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.providers', 'vicode.projects', 'vicode.threads', 'vicode.settings']);
    await waitForThreadSurfaceReady(window);

    await window.getByTestId('nav-sidebar-settings').click();
    await window.locator('.settings-nav-item').filter({ hasText: 'Providers' }).click();

    const geminiCard = window.locator('article').filter({ hasText: 'Gemini' }).first();
    await expect(geminiCard).toBeVisible();
    await geminiCard.getByRole('button', { name: 'Connect' }).click();

    await expect
      .poll(async () => {
        const nextBootstrap = await window.evaluate(() => window.vicode.app.getBootstrap());
        return nextBootstrap.providers.find((provider) => provider.id === 'gemini')?.authState ?? null;
      })
      .toBe('connected');

    await expect(geminiCard.getByText('Ready to use.', { exact: true }).first()).toBeVisible();
    await expect(geminiCard.getByText('Ready', { exact: true })).toBeVisible();
  } finally {
    if (projectId) {
      await window.evaluate(async (targetProjectId) => {
        const bootstrap = await window.vicode.app.getBootstrap();
        if (bootstrap.projects.some((project) => project.id === targetProjectId)) {
          await window.vicode.projects.remove(targetProjectId);
        }
      }, projectId).catch(() => {});
    }
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
