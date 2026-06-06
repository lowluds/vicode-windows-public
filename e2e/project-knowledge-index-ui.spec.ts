import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { closeApp, launchApp, openTitlebarSurface, waitForBridge } from './helpers/electron';

const fixtureRoot = path.join(process.cwd(), 'test', 'fixtures', 'project-knowledge-sample');

async function openLibrarySettings(window: Page) {
  const settingsDialog = window.getByRole('dialog', { name: 'Settings' });
  await openTitlebarSurface(window, 'nav-settings', settingsDialog);
  await settingsDialog.getByRole('button', { name: 'Library' }).click();
  await expect(settingsDialog.getByRole('heading', { name: 'Library' })).toBeVisible();
  return settingsDialog;
}

test('refreshes Project Knowledge index and keeps draft review outside Settings', async ({}, testInfo) => {
  const knowledgeRoot = mkdtempSync(path.join(tmpdir(), 'vicode-project-knowledge-ui-'));
  cpSync(fixtureRoot, knowledgeRoot, { recursive: true });
  const indexPath = path.join(knowledgeRoot, 'INDEX.md');
  const beforeIndex = readFileSync(indexPath, 'utf8');

  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.settings', 'vicode.projectKnowledge', 'vicode.library']
  });

  try {
    await window.evaluate(async (rootPath) => {
      await window.vicode.settings.save({
        onboardingComplete: true,
        llmWikiLibraryPath: rootPath
      });
    }, knowledgeRoot);
    await window.reload();
    await waitForBridge(window, ['vicode.app', 'vicode.settings', 'vicode.projectKnowledge', 'vicode.library']);

    const settingsDialog = await openLibrarySettings(window);
    await expect(settingsDialog.getByText('Project Knowledge index has not been refreshed yet.')).toBeVisible();

    await settingsDialog.getByRole('button', { name: 'Refresh Index' }).click();
    await expect(settingsDialog.getByText(/3 indexed files, \d+ sections\./u)).toBeVisible();
    await expect(settingsDialog.getByText(/notes\.txt: Only markdown files are indexed for Project Knowledge/u)).toBeVisible();
    await expect(settingsDialog.getByRole('button', { name: 'Open Draft' })).toBeVisible();
    await expect(settingsDialog.getByRole('button', { name: 'Suggest Index' })).toHaveCount(0);
    await expect(window.getByRole('dialog', { name: 'Suggested INDEX.md' })).toHaveCount(0);

    await window.screenshot({
      path: testInfo.outputPath('project-knowledge-library-refresh.png'),
      fullPage: false
    });

    const overlap = await settingsDialog.evaluate(() => {
      const main = document.querySelector('.settings-shell-main')?.getBoundingClientRect();
      const handle = document.querySelector('.settings-floating-resize-handle')?.getBoundingClientRect();
      if (!main || !handle) {
        return null;
      }
      return Math.max(0, main.bottom - handle.top);
    });
    expect(overlap).toBe(0);
    expect(readFileSync(indexPath, 'utf8')).toBe(beforeIndex);
  } finally {
    await closeApp(app);
    rmSync(knowledgeRoot, { recursive: true, force: true });
  }
});
