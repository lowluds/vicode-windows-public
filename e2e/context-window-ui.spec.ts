import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { closeApp, launchApp as launchElectronApp, waitForBridge } from './helpers/electron';

async function seedContextFixture(window: Page, workspaceDir: string) {
  return await window.evaluate(async ({ workspaceDir }) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    const provider =
      bootstrap.providers.find((entry) => entry.id === 'ollama') ??
      bootstrap.providers.find((entry) => entry.id === 'openai_compatible') ??
      null;

    if (!provider) {
      throw new Error('Expected a release-facing provider for the context window fixture.');
    }

    const project = await window.vicode.projects.create({
      name: `Context window fixture ${Date.now()}`,
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
      executionPermission: 'full_access'
    });

    await window.vicode.settings.save({
      selectedProjectId: project.id,
      lastOpenedThreadId: thread.id
    });

    return {
      projectId: project.id,
      threadId: thread.id
    };
  }, { workspaceDir });
}

async function cleanupFixture(window: Page | null, fixture: { projectId: string | null; threadId: string | null }) {
  if (!window) {
    return;
  }

  await window.evaluate(async ({ projectId, threadId }) => {
    if (threadId) {
      await window.vicode.threads.remove(threadId).catch(() => {});
    }
    if (projectId) {
      await window.vicode.projects.remove(projectId).catch(() => {});
    }
  }, fixture).catch(() => {});
}

test.describe.serial('context window ui', () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-context-window-ui-'));
  let app: ElectronApplication | null = null;
  let window: Page | null = null;
  let fixture: { projectId: string | null; threadId: string | null } = {
    projectId: null,
    threadId: null
  };

  test.afterAll(async () => {
    await cleanupFixture(window, fixture);
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  test('keeps context usage in the sidebar instead of the composer', async () => {
    const launched = await launchElectronApp({
      bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads']
    });
    app = launched.app;
    window = launched.window;

    await window.setViewportSize({ width: 1280, height: 900 });
    fixture = await seedContextFixture(window, workspaceDir);
    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads']);

    const composer = window.getByTestId('composer-input');
    await expect(composer).toBeVisible();

    await expect(window.getByTestId('composer-context-window-trigger')).toHaveCount(0);
    const status = window.getByTestId('sidebar-context-window-status');
    await expect(status).toBeVisible();
    await expect(status).toContainText('Ctx');
    await expect(status).toContainText(/%/);

    const desktopBox = await status.boundingBox();
    expect(desktopBox).not.toBeNull();
    expect(desktopBox!.width).toBeGreaterThan(0);
    expect(desktopBox!.x).toBeGreaterThanOrEqual(0);
    expect(desktopBox!.x + desktopBox!.width).toBeLessThanOrEqual(1280);

    await status.click();
    await expect(status).toHaveAttribute('aria-expanded', 'false');
    await expect(status.locator('em')).toHaveCount(0);
    await status.click();
    await expect(status).toHaveAttribute('aria-expanded', 'true');
    await expect(status.locator('em')).toBeVisible();

    await window.setViewportSize({ width: 820, height: 760 });
    await expect(window.getByTestId('composer-context-window-trigger')).toHaveCount(0);
    await expect(status).toBeVisible();

    const compactBox = await status.boundingBox();
    expect(compactBox).not.toBeNull();
    expect(compactBox!.x).toBeGreaterThanOrEqual(0);
    expect(compactBox!.x + compactBox!.width).toBeLessThanOrEqual(820);
  });
});
