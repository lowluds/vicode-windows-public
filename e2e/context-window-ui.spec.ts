import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { closeApp, launchApp as launchElectronApp, waitForBridge } from './helpers/electron';

async function seedContextFixture(window: Page, workspaceDir: string) {
  return await window.evaluate(async ({ workspaceDir }) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    const provider =
      bootstrap.providers.find((entry) => entry.id === 'openai') ??
      bootstrap.providers.find((entry) => entry.id === 'gemini') ??
      bootstrap.providers.find((entry) => entry.id === 'ollama') ??
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
      'gpt-5';

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

  test('keeps the context hover surface readable across viewport sizes', async () => {
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

    const trigger = window.getByTestId('composer-context-window-trigger');
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-label', /Context window/);

    await trigger.hover();

    const tooltip = window.getByTestId('composer-context-window-tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('full');
    await expect(tooltip).toContainText('tokens used');

    const desktopBox = await tooltip.boundingBox();
    expect(desktopBox).not.toBeNull();
    expect(desktopBox!.width).toBeGreaterThanOrEqual(260);

    await window.setViewportSize({ width: 820, height: 760 });
    await expect(trigger).toBeVisible();
    await trigger.hover();
    await expect(tooltip).toBeVisible();

    const compactBox = await tooltip.boundingBox();
    expect(compactBox).not.toBeNull();
    expect(compactBox!.width).toBeLessThanOrEqual(788);
    expect(compactBox!.x).toBeGreaterThanOrEqual(0);
    expect(compactBox!.x + compactBox!.width).toBeLessThanOrEqual(820);
  });
});
