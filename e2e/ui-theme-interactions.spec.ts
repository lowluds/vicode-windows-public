import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeApp, launchApp, openTitlebarSurface, waitForBridge } from './helpers/electron';

type ThemeName = 'dark' | 'light';

function widestChannelSpread(styleValue: string) {
  if (!styleValue || styleValue === 'none' || styleValue === 'transparent') {
    return 0;
  }

  const triplets: number[][] = [];

  for (const match of styleValue.matchAll(/rgba?\(([^)]+)\)/g)) {
    const channels = match[1].split(',').slice(0, 3).map((channel) => Number.parseFloat(channel.trim()));
    if (channels.every(Number.isFinite)) {
      triplets.push(channels);
    }
  }

  for (const match of styleValue.matchAll(/color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*[0-9.]+)?\)/g)) {
    triplets.push(
      match
        .slice(1, 4)
        .map((channel) => Number.parseFloat(channel))
        .map((channel) => (channel <= 1.01 ? channel * 255 : channel))
    );
  }

  for (const match of styleValue.matchAll(/oklch\([-+0-9.e]+\s+([-+0-9.e]+)\s+[-+0-9.e]+(?:\s*\/\s*[-+0-9.e]+)?\)/g)) {
    const chroma = Number.parseFloat(match[1]);
    triplets.push(chroma <= 0.01 ? [0, 0, 0] : [0, 255, 0]);
  }

  for (const match of styleValue.matchAll(/oklab\([-+0-9.e]+\s+([-+0-9.e]+)\s+([-+0-9.e]+)(?:\s*\/\s*[-+0-9.e]+)?\)/g)) {
    const a = Math.abs(Number.parseFloat(match[1]));
    const b = Math.abs(Number.parseFloat(match[2]));
    triplets.push(a <= 0.01 && b <= 0.01 ? [0, 0, 0] : [0, 255, 0]);
  }

  if (!triplets.length) {
    throw new Error(`Expected RGB colors in "${styleValue}".`);
  }

  return Math.max(
    ...triplets.map((channels) => Math.max(...channels) - Math.min(...channels))
  );
}

function maxPixelValue(styleValue: string) {
  if (!styleValue || styleValue === 'none') {
    return 0;
  }

  const matches = [...styleValue.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((match) => Math.abs(Number.parseFloat(match[1])));
  if (!matches.length) {
    throw new Error(`Expected pixel values in "${styleValue}".`);
  }
  return Math.max(...matches);
}

async function seedUiFixture(window: Page, workspaceDir: string) {
  return await window.evaluate(async ({ workspaceDir }) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    const provider = bootstrap.providers.find((entry) => entry.id === 'openai') ?? bootstrap.providers[0];
    if (!provider) {
      throw new Error('Expected at least one provider for UI theme audit.');
    }

    const modelId =
      bootstrap.preferences.defaultModelByProvider[provider.id] ??
      provider.models[0]?.id ??
      'gpt-5';
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

    const project = await window.vicode.projects.create({
      name: `UI theme ${suffix}`,
      folderPath: workspaceDir,
      trusted: true
    });
    const thread = await window.vicode.threads.create({
      projectId: project.id,
      providerId: provider.id,
      modelId,
      executionPermission: 'default'
    });
    const automation = await window.vicode.automations.save({
      name: `Neutral audit ${suffix}`,
      projectId: project.id,
      providerId: provider.id,
      modelId,
      promptTemplate: 'Check the workspace and summarize any UI polish issues.',
      skillId: null,
      enabled: true,
      scheduleType: 'manual',
      intervalMinutes: null
    });

    await window.vicode.settings.save({
      selectedProjectId: project.id,
      lastOpenedThreadId: thread.id,
      accentMode: 'custom',
      accentColor: '#3f3f3f'
    });

    return {
      projectId: project.id,
      threadId: thread.id,
      automationId: automation.id
    };
  }, { workspaceDir });
}

async function setTheme(window: Page, theme: ThemeName) {
  await window.evaluate(async ({ theme }) => {
    await window.vicode.settings.save({
      appearanceMode: theme,
      accentMode: 'custom',
      accentColor: '#3f3f3f'
    });
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, { theme });

  await expect.poll(async () => await window.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
}

async function expectNeutralPaint(locator: Locator, label: string) {
  const paint = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow
    };
  });

  expect(widestChannelSpread(paint.backgroundColor), `${label} background (${paint.backgroundColor}) should stay neutral`).toBeLessThanOrEqual(28);
  expect(widestChannelSpread(paint.borderColor), `${label} border (${paint.borderColor}) should stay neutral`).toBeLessThanOrEqual(28);
  expect(maxPixelValue(paint.boxShadow), `${label} shadow (${paint.boxShadow}) should stay Apple-restrained`).toBeLessThanOrEqual(24);
  if (paint.backgroundImage !== 'none') {
    expect(widestChannelSpread(paint.backgroundImage), `${label} gradient (${paint.backgroundImage}) should stay neutral`).toBeLessThanOrEqual(28);
  }
}

async function expectFlatNeutralSurface(locator: Locator, label: string) {
  await expect(locator).toBeVisible();
  const paint = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow
    };
  });

  expect(paint.backgroundImage, `${label} should not use gradients`).toBe('none');
  expect(maxPixelValue(paint.boxShadow), `${label} should not use drop shadows`).toBe(0);
  expect(widestChannelSpread(paint.backgroundColor), `${label} background (${paint.backgroundColor}) should stay neutral`).toBeLessThanOrEqual(28);
  expect(widestChannelSpread(paint.borderColor), `${label} border (${paint.borderColor}) should stay neutral`).toBeLessThanOrEqual(28);
}

async function expectStableHover(locator: Locator, label: string) {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const before = await locator.boundingBox();
  expect(before, `${label} should have a bounding box before hover`).not.toBeNull();

  await locator.hover();

  const after = await locator.boundingBox();
  expect(after, `${label} should have a bounding box after hover`).not.toBeNull();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0)), `${label} x should not shift on hover`).toBeLessThanOrEqual(1);
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0)), `${label} y should not shift on hover`).toBeLessThanOrEqual(1);
  expect(Math.abs((after?.width ?? 0) - (before?.width ?? 0)), `${label} width should not shift on hover`).toBeLessThanOrEqual(1);
  expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0)), `${label} height should not shift on hover`).toBeLessThanOrEqual(1);
}

async function expectOpenMenuNeutral(window: Page, trigger: Locator, label: string) {
  await expectStableHover(trigger, `${label} trigger`);
  await trigger.click();

  const menu = window.locator('.ui-menu-content').last();
  await expect(menu).toBeVisible();
  await expectNeutralPaint(menu, `${label} menu`);

  const item = menu.locator('.ui-menu-item').filter({ hasText: /\S/u }).first();
  if (await item.isVisible().catch(() => false)) {
    await expectStableHover(item, `${label} menu item`);
  }

  await window.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
}

async function expectNoHorizontalOverflow(window: Page, selectors: string[]) {
  const issues = await window.evaluate((selectors) => {
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Number(style.opacity || '1') > 0.01;
    };

    return selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector)).flatMap((root) => {
        if (!visible(root)) {
          return [];
        }
        const rect = root.getBoundingClientRect();
        const html = root as HTMLElement;
        const outOfBounds = rect.left < -2 || rect.right > window.innerWidth + 2;
        const overflow = html.scrollWidth > html.clientWidth + 4;
        return outOfBounds || overflow
          ? [{ selector, left: rect.left, right: rect.right, clientWidth: html.clientWidth, scrollWidth: html.scrollWidth }]
          : [];
      })
    );
  }, selectors);

  expect(issues).toEqual([]);
}

test.describe.serial('theme interaction visual audit', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`${theme} theme keeps opened controls neutral, aligned, and restrained`, async () => {
      const workspaceDir = mkdtempSync(join(tmpdir(), `vicode-ui-theme-${theme}-`));
      const { app, window } = await launchApp({
        bridgePaths: [
          'vicode.app',
          'vicode.projects',
          'vicode.threads',
          'vicode.settings',
          'vicode.skills',
          'vicode.mcp',
          'vicode.providers',
          'vicode.automations'
        ]
      });

      try {
        const fixture = await seedUiFixture(window, workspaceDir);
        await setTheme(window, theme);
        await window.reload({ waitUntil: 'domcontentloaded' });
        await waitForBridge(window, [
          'vicode.app',
          'vicode.projects',
          'vicode.threads',
          'vicode.settings',
          'vicode.skills',
          'vicode.mcp',
          'vicode.providers',
          'vicode.automations'
        ]);
        await expect(window.getByTestId('composer-input')).toBeVisible();
        await setTheme(window, theme);

        const composerStack = window.locator('.thread-composer-stack');
        const submitButton = window.getByTestId('composer-submit-button');
        const modelSelect = window.getByTestId('composer-model-select');
        const composerActions = window.getByLabel('Composer actions');
        await expectNeutralPaint(composerStack, `${theme} composer stack`);
        await expectStableHover(submitButton, `${theme} composer submit`);
        await expectOpenMenuNeutral(window, composerActions, `${theme} composer actions`);
        await expectOpenMenuNeutral(window, modelSelect, `${theme} model select`);

        await window.getByTestId(`project-row-${fixture.projectId}`).hover();
        await expectOpenMenuNeutral(window, window.getByLabel('Project and thread actions'), `${theme} project actions`);

        await window.getByTestId('nav-automations').click();
        await expect(window.getByRole('heading', { name: 'Automations', exact: true })).toBeVisible();
        const automationTemplate = window.locator('.automation-template-card').first();
        const automationCard = window.locator('.automation-card').filter({ hasText: `Neutral audit` }).first();
        await expectStableHover(automationTemplate, `${theme} automation template`);
        await expectFlatNeutralSurface(automationTemplate, `${theme} automation template`);
        await expectStableHover(automationCard, `${theme} automation card`);
        await expectFlatNeutralSurface(automationCard, `${theme} automation card`);
        await expectStableHover(window.getByRole('button', { name: 'Create automation' }), `${theme} create automation`);
        await expectFlatNeutralSurface(window.getByRole('button', { name: 'Create automation' }), `${theme} create automation`);

        await window.getByTestId('nav-settings').click();
        await expect(window.getByRole('heading', { name: 'App' })).toBeVisible();
        await expectNeutralPaint(window.locator('.settings-root'), `${theme} settings root`);
        await expectOpenMenuNeutral(
          window,
          window.locator('.settings-row').filter({ hasText: 'Theme mode' }).locator('.ui-select-trigger'),
          `${theme} theme mode select`
        );

        await openTitlebarSurface(window, 'nav-plugins', window.getByTestId('skills-tab-plugins'));
        await window.getByTestId('skills-tab-plugins').click();
        await expect(window.getByRole('heading', { name: 'Make Vicode work your way' })).toBeVisible();
        await expectNeutralPaint(window.locator('.skills-page-shell'), `${theme} plugins shell`);
        const pluginSearch = window.locator('.skills-search');
        await expectFlatNeutralSurface(pluginSearch, `${theme} plugin search`);
        await pluginSearch.fill('play');
        await expect(pluginSearch).toHaveValue('play');
        await pluginSearch.fill('');
        const pluginCreateButton = window.getByRole('button', { name: 'Create', exact: true });
        await expectStableHover(pluginCreateButton, `${theme} plugin create menu`);
        await expectFlatNeutralSurface(pluginCreateButton, `${theme} plugin create menu`);
        await expectStableHover(window.getByTestId('mcp-official-add-shadcn'), `${theme} plugin add`);
        await expectFlatNeutralSurface(window.getByTestId('mcp-official-add-shadcn'), `${theme} plugin add`);

        await window.getByTestId('skills-tab-skills').click();
        await expect(window.getByRole('heading', { name: 'Recommended' })).toBeVisible();
        const skillCreateButton = window.getByRole('button', { name: 'Create', exact: true });
        await expectStableHover(skillCreateButton, `${theme} skill create menu`);
        await expectFlatNeutralSurface(skillCreateButton, `${theme} skill create menu`);
        await window.locator('.skills-list-item').first().click({ position: { x: 24, y: 24 } });
        const dialog = window.locator('.ui-dialog-content').last();
        await expect(dialog).toBeVisible();
        await expectNeutralPaint(dialog, `${theme} skill detail dialog`);
        await window.keyboard.press('Escape');

        await expectNoHorizontalOverflow(window, [
          '.sidebar',
          '.main-surface',
          '.thread-composer-stack',
          '.settings-root',
          '.skills-page-shell'
        ]);
      } finally {
        await closeApp(app);
        rmSync(workspaceDir, { recursive: true, force: true });
      }
    });
  }
});
