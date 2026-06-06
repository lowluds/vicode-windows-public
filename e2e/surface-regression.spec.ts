import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { closeApp, launchApp, openTitlebarSurface, waitForBridge } from './helpers/electron';

test('release-facing settings and plugin surfaces match the current beta posture', async () => {
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
      const releaseProvider =
        bootstrap.providers.find((provider) => provider.id === 'ollama') ??
        bootstrap.providers.find((provider) => provider.id === 'openai_compatible') ??
        null;
      if (!releaseProvider) {
        throw new Error('Expected at least one release-facing provider in bootstrap.');
      }

      const project = await window.vicode.projects.create({
        name: `Surface regression ${Date.now()}`,
        folderPath: targetWorkspaceDir,
        trusted: true
      });

      const providerId = releaseProvider.id;
      const modelId =
        project.defaultModelByProvider[providerId] ??
        bootstrap.preferences.defaultModelByProvider[providerId] ??
        releaseProvider.models[0]?.id ??
        'qwen3-coder';

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
        threadTitle: thread.title,
        providerId,
        bootstrapProviderIds: bootstrap.providers.map((provider) => provider.id)
      };
    }, workspaceDir);

    projectId = seeded.projectId;
    threadId = seeded.threadId;

    await test.step('bootstrap and renderer surface the current beta provider set', async () => {
      expect(seeded.bootstrapProviderIds).toEqual(['ollama']);

      await window.reload();
      await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.skills']);
      await openTitlebarSurface(window, 'nav-settings', window.locator('.settings-root'));
      await expect(window.locator('.settings-root')).toBeVisible();
      await expect(window.getByRole('heading', { name: 'Updates' })).toBeVisible();
      await window.locator('.settings-nav-item').filter({ hasText: 'Providers' }).click();
      await expect(window.getByRole('heading', { name: 'Providers' })).toBeVisible();

      const providerCards = window.locator('.settings-provider-card');
      await expect(providerCards).toHaveCount(2);
      await expect(window.getByText(/^Ollama$/)).toBeVisible();
      await expect(window.getByText(/^Custom API$/)).toBeVisible();
      await expect(window.getByText(/^OpenAI$/)).toHaveCount(0);
      await expect(window.getByText(/^Codex$/)).toHaveCount(0);
      await expect(window.getByText(/^Gemini$/)).toHaveCount(0);
      await expect(window.getByText(/^Qwen$/)).toHaveCount(0);
      await expect(window.getByText(/^Kimi$/)).toHaveCount(0);
      await expect(window.getByText('Codex CLI')).toHaveCount(0);
      await expect(window.getByText('OpenAI Codex Login')).toHaveCount(0);
      await expect(window.getByText('Gemini CLI')).toHaveCount(0);
      await expect(window.getByText('Qwen CLI')).toHaveCount(0);
    });

    await test.step('provider cards explain the current release routes instead of generic setup state', async () => {
      const customApiCard = window.locator('article').filter({ hasText: 'Custom API' }).first();
      await expect(customApiCard.locator('strong').filter({ hasText: 'Add custom provider' })).toBeVisible();
      await expect(customApiCard.getByText('API keys stay on this device after you save.')).toBeVisible();

      const ollamaCard = window.locator('article').filter({ hasText: 'Ollama' }).first();
      await ollamaCard.scrollIntoViewIfNeeded();
      await expect(ollamaCard.getByText('Default model', { exact: true })).toBeVisible();
      await expect(ollamaCard.getByText('Used for new threads unless you choose another model in the composer.', { exact: true })).toBeVisible();
      await expect(ollamaCard.getByLabel('Ollama default model', { exact: true })).toBeVisible();
      await expect(ollamaCard.getByText('Quick', { exact: true })).toHaveCount(0);
      await expect(ollamaCard.getByText('Ollama mode', { exact: true })).toBeVisible();
      await expect(ollamaCard.getByText('Cloud API key', { exact: true })).toHaveCount(0);
      await expect(ollamaCard.getByText('Use local models from this PC through the local Ollama API.')).toBeVisible();
      await expect(ollamaCard.getByText('Transport', { exact: true })).toHaveCount(0);
      await expect(ollamaCard.getByText('/v1/responses', { exact: true })).toHaveCount(0);
      await expect(window.getByText('Use an API key instead')).toHaveCount(0);
      await expect(window.getByText('API key fallback')).toHaveCount(0);
    });

    await test.step('advanced diagnostics and archived-thread restore stay reachable from Settings', async () => {
      await window.locator('.settings-nav-item').filter({ hasText: 'Advanced' }).click();
      await expect(window.getByRole('heading', { name: 'Advanced' })).toBeVisible();
      await expect(window.getByText('App data')).toBeVisible();

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
    });

    await test.step('legacy extension surfaces stay parked from primary chrome', async () => {
      await expect(window.getByTestId('nav-plugins')).toHaveCount(0);
      await expect(window.getByTestId('nav-automations')).toHaveCount(0);
      await expect(window.getByText('Autonomous Builds')).toHaveCount(0);
      await expect(window.getByText('Build Control')).toHaveCount(0);
      await expect
        .poll(async () => window.evaluate(() => 'vicodeBuild' in window.vicode))
        .toBe(false);
      await openTitlebarSurface(window, 'nav-settings', window.locator('.settings-root'));
      await expect(window.locator('.settings-nav-item').filter({ hasText: 'Instructions' })).toHaveCount(0);
      await expect(window.locator('.settings-nav-item').filter({ hasText: 'Personalization' })).toHaveCount(0);
      await expect(window.getByText('Global instructions')).toHaveCount(0);
      await expect(window.getByText('Experimental memory')).toHaveCount(0);
    });
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
