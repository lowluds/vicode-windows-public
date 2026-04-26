import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { closeApp, launchApp, openTitlebarSurface, waitForBridge, waitForThreadSurfaceReady } from './helpers/electron';

async function openCatalogTab(window: Page, tab: 'plugins' | 'skills') {
  const tabButton = window.getByTestId(`skills-tab-${tab}`);
  if (!(await tabButton.isVisible().catch(() => false))) {
    await openTitlebarSurface(window, 'nav-plugins', tabButton);
  }
  await expect(tabButton).toBeVisible();
  if ((await tabButton.getAttribute('aria-selected')) !== 'true') {
    await tabButton.click();
  }
}

async function seedProject(window: Page, workspaceDir: string) {
  return await window.evaluate(async ({ workspaceDir }) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    const provider =
      bootstrap.providers.find((entry) => entry.id === 'openai') ??
      bootstrap.providers.find((entry) => entry.id === 'gemini') ??
      bootstrap.providers.find((entry) => entry.id === 'ollama') ??
      null;
    if (!provider) {
      throw new Error('Expected a release-facing provider for visual coverage.');
    }
    const project = await window.vicode.projects.create({
      name: `Visual surface ${Date.now()}`,
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
      executionPermission: 'default'
    });
    await window.vicode.settings.save({
      selectedProjectId: project.id,
      lastOpenedThreadId: thread.id
    });
    return project.id;
  }, { workspaceDir });
}

async function removeProject(window: Page, projectId: string | null) {
  if (!projectId) {
    return;
  }
  await window.evaluate(async (targetProjectId) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    if (bootstrap.projects.some((project) => project.id === targetProjectId)) {
      await window.vicode.projects.remove(targetProjectId);
    }
  }, projectId).catch(() => {});
}

async function openPlugins(window: Page) {
  await openCatalogTab(window, 'plugins');
}

async function openSkills(window: Page) {
  await openCatalogTab(window, 'skills');
}

async function setAppearance(window: Page, mode: 'dark' | 'light') {
  await window.evaluate(async (appearanceMode) => {
    await window.vicode.settings.save({ appearanceMode });
    document.documentElement.classList.toggle('dark', appearanceMode === 'dark');
    document.documentElement.classList.toggle('light', appearanceMode === 'light');
    document.documentElement.dataset.theme = appearanceMode;
    document.documentElement.style.colorScheme = appearanceMode;
  }, mode);

  await expect
    .poll(async () => window.evaluate(() => document.documentElement.dataset.theme))
    .toBe(mode);
}

function widestChannelSpread(styleValue: string) {
  if (styleValue === 'none') {
    return 0;
  }
  const triplets: number[][] = [];

  for (const match of styleValue.matchAll(/rgba?\(([^)]+)\)/g)) {
    triplets.push(
      match[1]
        .split(',')
        .slice(0, 3)
        .map((channel) => Number.parseFloat(channel.trim()))
    );
  }

  for (const match of styleValue.matchAll(/color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*[0-9.]+)?\)/g)) {
    triplets.push(
      match
        .slice(1, 4)
        .map((channel) => Number.parseFloat(channel))
        .map((channel) => (channel <= 1 ? channel * 255 : channel))
    );
  }

  if (!triplets.length) {
    throw new Error(`Expected RGB colors in "${styleValue}".`);
  }

  return Math.max(
    ...triplets.map((channels) => Math.max(...channels) - Math.min(...channels))
  );
}

function maxPixelValue(styleValue: string) {
  if (styleValue === 'none') {
    return 0;
  }
  const matches = [...styleValue.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((match) => Math.abs(Number.parseFloat(match[1])));
  if (!matches.length) {
    throw new Error(`Expected pixel values in "${styleValue}".`);
  }
  return Math.max(...matches);
}

test('titlebar surface buttons toggle closed when already open', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-titlebar-visual-'));
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']
  });
  let projectId: string | null = null;

  try {
    projectId = await seedProject(window, workspaceDir);
    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']);
    await waitForThreadSurfaceReady(window);
    await openTitlebarSurface(window, 'nav-plugins', window.getByTestId('skills-tab-plugins'));
    await expect(window.getByTestId('skills-tab-plugins')).toBeVisible();
    await window.getByTestId('nav-plugins').click();
    await expect(window.getByTestId('skills-tab-plugins')).toHaveCount(0);

    await window.getByTestId('nav-automations').click();
    await expect(window.getByRole('heading', { name: 'Automations', exact: true })).toBeVisible();
    await window.getByTestId('nav-automations').click();
    await expect(window.getByRole('heading', { name: 'Automations', exact: true })).toHaveCount(0);
  } finally {
    await removeProject(window, projectId);
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('plugins surface keeps neutral controls and restrained shadows', async () => {
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.mcp', 'vicode.settings']
  });

  try {
    for (const mode of ['dark', 'light'] as const) {
      await setAppearance(window, mode);
      await openPlugins(window);
      const pageShell = window.locator('.skills-page-shell');
      const createButton = window.getByRole('button', { name: 'Create', exact: true });
      const refreshButton = window.getByRole('button', { name: 'Manage' }).first();
      const addButton = window.getByTestId('mcp-official-add-shadcn');
      const firstRow = window.locator('.skills-list-item').first();

      await expect(pageShell).toBeVisible();
      await expect(createButton).toBeVisible();
      await expect(refreshButton).toBeVisible();
      await expect(addButton).toBeVisible();
      await firstRow.hover();
      await createButton.hover();
      await addButton.hover();
      await createButton.click();
      await expect(window.getByRole('menuitem', { name: 'Create plugin' })).toBeVisible();
      await expect(window.getByRole('menuitem', { name: 'Create skill' })).toBeVisible();
      await window.keyboard.press('Escape');

      const pageShadow = await pageShell.evaluate((element) => getComputedStyle(element).boxShadow);
      const createButtonStyles = await createButton.evaluate((element) => ({
        backgroundImage: getComputedStyle(element).backgroundImage,
        boxShadow: getComputedStyle(element).boxShadow
      }));
      const addButtonStyles = await addButton.evaluate((element) => ({
        backgroundColor: getComputedStyle(element).backgroundColor,
        borderColor: getComputedStyle(element).borderColor
      }));
      const rowHeight = await firstRow.evaluate((element) => element.getBoundingClientRect().height);

      expect(rowHeight).toBeLessThanOrEqual(70);
      expect(maxPixelValue(pageShadow)).toBeLessThanOrEqual(16);
      expect(pageShadow).not.toContain('64px');
      expect(maxPixelValue(createButtonStyles.boxShadow)).toBeLessThanOrEqual(16);
      expect(widestChannelSpread(createButtonStyles.backgroundImage)).toBeLessThanOrEqual(18);
      expect(widestChannelSpread(addButtonStyles.backgroundColor)).toBeLessThanOrEqual(12);
      expect(widestChannelSpread(addButtonStyles.borderColor)).toBeLessThanOrEqual(12);
    }
  } finally {
    await closeApp(app);
  }
});

test('skills catalog and create action stay neutral without brand-purple accents', async () => {
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.skills', 'vicode.settings']
  });

  try {
    for (const mode of ['dark', 'light'] as const) {
      await setAppearance(window, mode);
      await openSkills(window);

      const avatar = window.locator('.skills-avatar.is-openai').first();
      await expect(avatar).toBeVisible();

      const avatarBackground = await avatar.evaluate((element) => getComputedStyle(element).backgroundImage);
      expect(widestChannelSpread(avatarBackground)).toBeLessThanOrEqual(18);

      const pageShell = window.locator('.skills-page-shell');
      const createButton = window.getByRole('button', { name: 'Create', exact: true });
      const firstRow = window.locator('.skills-list-item').first();
      await expect(pageShell).toBeVisible();
      await expect(createButton).toBeVisible();
      await firstRow.hover();
      await createButton.hover();

      const pageShadow = await pageShell.evaluate((element) => getComputedStyle(element).boxShadow);
      const createButtonStyles = await createButton.evaluate((element) => ({
        backgroundImage: getComputedStyle(element).backgroundImage,
        boxShadow: getComputedStyle(element).boxShadow
      }));
      const rowHeight = await firstRow.evaluate((element) => element.getBoundingClientRect().height);

      expect(rowHeight).toBeLessThanOrEqual(70);
      expect(maxPixelValue(pageShadow)).toBeLessThanOrEqual(16);
      expect(pageShadow).not.toContain('64px');
      expect(maxPixelValue(createButtonStyles.boxShadow)).toBeLessThanOrEqual(16);
      expect(widestChannelSpread(createButtonStyles.backgroundImage)).toBeLessThanOrEqual(18);
    }
  } finally {
    await closeApp(app);
  }
});
