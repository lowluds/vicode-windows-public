import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { closeApp, launchApp, openTitlebarSurface, waitForBridge } from './helpers/electron';

test('trusted projects expose app-managed project context without the legacy setup form', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-project-context-e2e-'));
  writeFileSync(
    join(workspaceDir, 'package.json'),
    JSON.stringify(
      {
        name: 'minimal-context-project',
        private: true,
        scripts: {
          build: 'vite build',
          test: 'vitest run'
        },
        dependencies: {
          react: '^19.0.0'
        },
        devDependencies: {
          vite: '^7.0.0',
          typescript: '^5.0.0'
        }
      },
      null,
      2
    ),
    'utf8'
  );

  const { app, window: launchedWindow } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.settings']
  });

  let window: Page | null = launchedWindow;
  let projectId: string | null = null;
  let threadId: string | null = null;

  try {
    const seeded = await window.evaluate(async (targetWorkspaceDir) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const provider =
        bootstrap.providers.find((entry) => entry.id === 'ollama') ??
        bootstrap.providers.find((entry) => entry.id === 'openai_compatible') ??
        null;
      if (!provider) {
        throw new Error('Expected a release-facing provider for the workspace context E2E.');
      }

      const project = await window.vicode.projects.create({
        name: `Minimal context ${Date.now()}`,
        folderPath: targetWorkspaceDir,
        trusted: true
      });
      const providerId = provider.id;
      const modelId =
        project.defaultModelByProvider[providerId] ??
        bootstrap.preferences.defaultModelByProvider[providerId] ??
        provider.models[0]?.id ??
        'qwen2.5-coder:14b-instruct-q6_K';
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
      return {
        projectId: project.id,
        threadId: thread.id
      };
    }, workspaceDir);

    projectId = seeded.projectId;
    threadId = seeded.threadId;

    await window.reload();
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.settings']);

    await expect.poll(() => window!.evaluate(() => 'workspaceBootstrap' in window.vicode)).toBe(false);
    await expect(window.getByTestId('workspace-bootstrap-open')).toHaveCount(0);
    await expect(window.getByText('Set up project')).toHaveCount(0);

    const projectContextHeading = window.getByRole('heading', { name: 'Project context' });
    await openTitlebarSurface(window, 'nav-settings', projectContextHeading);
    await projectContextHeading.scrollIntoViewIfNeeded();
    await expect(projectContextHeading).toBeVisible();
    await expect(window.getByText('Vicode handles workspace instructions and memory behind the scenes.')).toBeVisible();
    await expect(window.getByText('Project files: detected automatically')).toBeVisible();
    await expect(window.getByText('Memory: handled by Vicode')).toBeVisible();
    await expect(window.getByText('Instructions: AGENTS.md when present')).toHaveCount(0);
    await expect(window.getByRole('button', { name: 'Set up' })).toHaveCount(0);
    await expect(window.getByLabel('Workspace files')).toHaveCount(0);
  } finally {
    if (window && projectId) {
      await window.evaluate(
        async ({ targetProjectId, targetThreadId }) => {
          if (targetThreadId) {
            await window.vicode.threads.remove(targetThreadId).catch(() => {});
          }
          await window.vicode.projects.remove(targetProjectId).catch(() => {});
          await window.vicode.settings.save({
            selectedProjectId: null,
            lastOpenedThreadId: null
          });
        },
        { targetProjectId: projectId, targetThreadId: threadId }
      ).catch(() => {});
    }

    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
