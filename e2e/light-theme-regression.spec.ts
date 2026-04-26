import { expect, test } from '@playwright/test';
import { closeApp, launchApp } from './helpers/electron';

test('light mode uses readable Windows-style shell colors', async () => {
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.settings']
  });

  try {
    await window.evaluate(async () => {
      await window.vicode.settings.save({ appearanceMode: 'light' });
    });

    await expect
      .poll(async () => {
        return await window.evaluate(() => ({
          theme: document.documentElement.dataset.theme,
          background: getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
          sidebarGradient: getComputedStyle(document.documentElement).getPropertyValue('--ui-window-sidebar-gradient').trim(),
          panelGradient: getComputedStyle(document.documentElement).getPropertyValue('--ui-panel-gradient').trim()
        }));
      })
      .toMatchObject({
        theme: 'light',
        background: '#fcfcfc',
        sidebarGradient: 'linear-gradient(180deg, #f3f3f3, #ebebeb)'
      });

    const panelGradient = await window.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ui-panel-gradient').trim()
    );
    expect(panelGradient).toContain('#ffffff');
    expect(panelGradient).toContain('#fcfcfc');

    await window.getByTestId('nav-settings').click();
    await expect(window.getByRole('heading', { name: 'App' })).toBeVisible();
    const settingsRail = window.locator('.settings-shell-rail');
    const tabs = window.locator('.settings-inline-shell-tabs');
    const card = window.locator('.ui-surface-card').first();
    const heading = window.locator('.settings-detail-header h2');
    const copy = window.locator('.settings-detail-header p');
    await expect(settingsRail).toBeVisible();
    await expect(tabs).toBeVisible();
    await expect(card).toBeVisible();
    await expect(copy).toBeVisible();

    const appearance = {
      rootTheme: await window.evaluate(() => document.documentElement.dataset.theme),
      rootText: await window.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-text-title').trim()),
      sidebarBackground: await settingsRail.evaluate((element) => getComputedStyle(element).backgroundColor),
      tabsBackdrop: await tabs.evaluate((element) => getComputedStyle(element).backdropFilter),
      cardBackground: await card.evaluate((element) => getComputedStyle(element).backgroundImage),
      headingColor: await heading.evaluate((element) => getComputedStyle(element).color),
      copyColor: await copy.evaluate((element) => getComputedStyle(element).color)
    };

    expect(appearance.rootTheme).toBe('light');
    expect(appearance.rootText).toBe('#151515');
    expect(appearance.sidebarBackground).not.toBe('rgb(24, 24, 24)');
    expect(appearance.tabsBackdrop).toBe('none');
    expect(appearance.cardBackground).not.toContain('30, 33, 39');
    expect(appearance.headingColor).toBe('rgb(21, 21, 21)');
    expect(appearance.copyColor).not.toBe('rgb(255, 255, 255)');
  } finally {
    await closeApp(app);
  }
});
