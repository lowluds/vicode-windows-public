import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { closeApp, launchApp, waitForBridge } from './helpers/electron';

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
        bootstrap.providers.find((provider) => provider.id === 'openai') ??
        bootstrap.providers.find((provider) => provider.id === 'gemini') ??
        bootstrap.providers.find((provider) => provider.id === 'ollama') ??
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
        threadTitle: thread.title,
        providerId,
        bootstrapProviderIds: bootstrap.providers.map((provider) => provider.id)
      };
    }, workspaceDir);

    projectId = seeded.projectId;
    threadId = seeded.threadId;

    await test.step('bootstrap can still know every provider while the renderer surfaces only the beta set', async () => {
      expect(seeded.bootstrapProviderIds).toEqual(expect.arrayContaining(['openai', 'gemini', 'qwen', 'ollama', 'kimi']));

      await window.reload();
      await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.skills']);
      await window.getByTestId('nav-sidebar-settings').click({ force: true });
      await expect(window.locator('.settings-root')).toBeVisible();
      await expect(window.getByRole('heading', { name: 'Updates' })).toBeVisible();
      await window.locator('.settings-nav-item').filter({ hasText: 'Providers' }).click();
      await expect(window.getByRole('heading', { name: 'Providers' })).toBeVisible();

      const providerCards = window.locator('.settings-provider-card');
      await expect(providerCards).toHaveCount(3);
      await expect(window.getByText(/^Codex$/)).toBeVisible();
      await expect(window.getByText(/^Gemini$/)).toBeVisible();
      await expect(window.getByText(/^Ollama$/)).toBeVisible();
      await expect(window.getByText(/^Qwen$/)).toHaveCount(0);
      await expect(window.getByText(/^Kimi$/)).toHaveCount(0);
    });

    await test.step('provider cards explain the current release routes instead of generic setup state', async () => {
      await expect(window.getByText('Newest available Codex model first.')).toBeVisible();
      await expect(window.getByText('Auto Gemini 2.5 by default.')).toBeVisible();

      const ollamaCard = window.locator('article').filter({ hasText: 'Ollama' }).first();
      await ollamaCard.scrollIntoViewIfNeeded();
      await expect(ollamaCard.getByText(/Qwen 3 Coder for (?:cloud|local) models\./).first()).toBeVisible();
      await expect(ollamaCard.getByText('Ollama mode', { exact: true })).toBeVisible();
      await expect(ollamaCard.getByText('Cloud API key', { exact: true })).toBeVisible();
      await expect(window.getByText('Use an API key instead').first()).toBeVisible();
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

    await test.step('Plugins remains a separate MCP surface, not another provider settings list', async () => {
      await window.getByTestId('nav-plugins').click();
      await window.getByTestId('skills-tab-plugins').click();
      await expect(window.getByRole('heading', { name: 'Make Vicode work your way' })).toBeVisible();
      await expect(window.getByText('Featured')).toBeVisible();
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
