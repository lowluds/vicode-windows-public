import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { closeApp, launchApp as launchElectronApp, waitForBridge } from './helpers/electron';

async function createComposerFixture(window: Page, workspaceDir: string) {
  return await window.evaluate(async ({ workspaceDir }) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    const provider =
      bootstrap.providers.find((candidate) => candidate.id === 'ollama' && candidate.authState === 'connected' && candidate.models.length > 0) ??
      bootstrap.providers.find((candidate) => candidate.authState === 'connected' && candidate.models.length > 0) ??
      null;

    if (!provider) {
      throw new Error('Expected a connected provider with at least one model for composer submit regression coverage.');
    }

    const modelId = provider.models[0]?.id ?? null;
    if (!modelId) {
      throw new Error(`Expected a model id for provider ${provider.id}.`);
    }

    const project = await window.vicode.projects.create({
      name: `Composer submit regression ${Date.now()}`,
      folderPath: workspaceDir,
      trusted: true,
      defaultProviderId: provider.id,
      defaultModelByProvider: {
        ...bootstrap.preferences.defaultModelByProvider,
        [provider.id]: modelId
      }
    });

    const thread = await window.vicode.threads.create({
      projectId: project.id,
      providerId: provider.id,
      modelId,
      executionPermission: 'full_access'
    });

    await window.vicode.settings.save({
      selectedProjectId: project.id,
      lastOpenedThreadId: thread.id,
      defaultProviderId: provider.id,
      defaultModelByProvider: {
        ...bootstrap.preferences.defaultModelByProvider,
        [provider.id]: modelId
      }
    });

    return {
      projectId: project.id,
      threadId: thread.id,
      providerId: provider.id,
      modelId
    };
  }, { workspaceDir });
}

async function restoreFixture(window: Page, projectId: string, threadId: string) {
  await window.evaluate(async ({ projectId, threadId }) => {
    await window.vicode.settings.save({
      selectedProjectId: projectId,
      lastOpenedThreadId: threadId
    });
  }, { projectId, threadId });
  await window.reload({ waitUntil: 'domcontentloaded' });
  await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']);
}

test.describe.serial('composer submit regression', () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-composer-submit-regression-'));
  let app: ElectronApplication | null = null;
  let window: Page | null = null;
  let fixture: { projectId: string; threadId: string } | null = null;

  test.beforeAll(async () => {
    ({ app, window } = await launchElectronApp({
      bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.composer']
    }));
    fixture = await createComposerFixture(window, workspaceDir);
    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.composer']);
  });

  test.afterAll(async () => {
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  test('send button clears the composer and shows the optimistic user turn', async () => {
    test.skip(!window || !fixture);

    const prompt = 'Button submit regression prompt.';
    const composer = window!.getByTestId('composer-input');
    await composer.fill(prompt);
    await window!.getByTestId('composer-submit-button').click();

    await expect(composer).toHaveValue('');
    await expect(window!.getByText(prompt, { exact: true })).toBeVisible();
  });

  test('enter key clears the composer and shows the optimistic user turn', async () => {
    test.skip(!window || !fixture);

    await restoreFixture(window!, fixture!.projectId, fixture!.threadId);

    const prompt = 'Enter submit regression prompt.';
    const composer = window!.getByTestId('composer-input');
    await composer.fill(prompt);
    await composer.press('Enter');

    await expect(composer).toHaveValue('');
    await expect(window!.getByText(prompt, { exact: true })).toBeVisible();
  });
});
