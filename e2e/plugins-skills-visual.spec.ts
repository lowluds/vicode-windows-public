import { expect, test, type Page } from '@playwright/test';
import { closeApp, launchApp } from './helpers/electron';

async function openPlugins(window: Page) {
  await window.getByTestId('nav-plugins').click();
  await window.getByTestId('skills-tab-plugins').click();
}

async function openSkills(window: Page) {
  await window.getByTestId('nav-plugins').click();
  await window.getByTestId('skills-tab-skills').click();
}

function widestChannelSpread(styleValue: string) {
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
  const matches = [...styleValue.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((match) => Math.abs(Number.parseFloat(match[1])));
  if (!matches.length) {
    throw new Error(`Expected pixel values in "${styleValue}".`);
  }
  return Math.max(...matches);
}

test('plugins dialog keeps neutral controls and restrained shadows', async () => {
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.mcp']
  });

  try {
    await openPlugins(window);
    await window.getByRole('button', { name: 'New plugin' }).click();

    const dialog = window.locator('.skills-plugin-dialog');
    const nameInput = window.getByTestId('plugin-dialog-name');
    const saveButton = window.getByRole('button', { name: 'Save plugin' });
    const activeToggle = window.getByRole('button', { name: 'Approval required' });
    const scopeRow = window.getByTestId('plugin-dialog-scope-row');
    const modeRow = window.getByTestId('plugin-dialog-mode-row');

    await expect(dialog).toBeVisible();
    await expect(nameInput).toBeVisible();
    await expect(scopeRow).toBeVisible();
    await expect(modeRow).toBeVisible();
    await nameInput.focus();

    const dialogShadow = await dialog.evaluate((element) => getComputedStyle(element).boxShadow);
    const saveButtonStyles = await saveButton.evaluate((element) => ({
      backgroundImage: getComputedStyle(element).backgroundImage,
      boxShadow: getComputedStyle(element).boxShadow
    }));
    const activeToggleStyles = await activeToggle.evaluate((element) => ({
      backgroundColor: getComputedStyle(element).backgroundColor,
      borderColor: getComputedStyle(element).borderColor
    }));
    const focusedInputShadow = await nameInput.evaluate((element) => getComputedStyle(element).boxShadow);
    const scopeRowHeight = await scopeRow.evaluate((element) => element.getBoundingClientRect().height);
    const modeRowHeight = await modeRow.evaluate((element) => element.getBoundingClientRect().height);

    expect(maxPixelValue(dialogShadow)).toBeLessThanOrEqual(16);
    expect(dialogShadow).not.toContain('64px');
    expect(maxPixelValue(saveButtonStyles.boxShadow)).toBeLessThanOrEqual(16);
    expect(widestChannelSpread(saveButtonStyles.backgroundImage)).toBeLessThanOrEqual(18);
    expect(widestChannelSpread(activeToggleStyles.backgroundColor)).toBeLessThanOrEqual(12);
    expect(widestChannelSpread(activeToggleStyles.borderColor)).toBeLessThanOrEqual(12);
    expect(widestChannelSpread(focusedInputShadow)).toBeLessThanOrEqual(12);
    expect(scopeRowHeight).toBeLessThan(96);
    expect(modeRowHeight).toBeLessThan(96);
  } finally {
    await closeApp(app);
  }
});

test('skills catalog and dialog stay neutral without brand-purple accents', async () => {
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.skills']
  });

  try {
    await openSkills(window);

    const avatar = window.locator('.skills-avatar.is-openai').first();
    await expect(avatar).toBeVisible();

    const avatarBackground = await avatar.evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(widestChannelSpread(avatarBackground)).toBeLessThanOrEqual(18);

    await window.getByRole('button', { name: 'New skill' }).click();

    const dialog = window.locator('.skills-editor-dialog');
    const saveButton = window.getByRole('button', { name: 'Save skill' });
    const providerToggle = dialog.locator('.skills-toggle-button.is-active').first();

    await expect(dialog).toBeVisible();
    await expect(providerToggle).toBeVisible();

    const dialogShadow = await dialog.evaluate((element) => getComputedStyle(element).boxShadow);
    const saveButtonStyles = await saveButton.evaluate((element) => ({
      backgroundImage: getComputedStyle(element).backgroundImage,
      boxShadow: getComputedStyle(element).boxShadow
    }));
    const providerToggleStyles = await providerToggle.evaluate((element) => ({
      backgroundColor: getComputedStyle(element).backgroundColor,
      borderColor: getComputedStyle(element).borderColor
    }));

    expect(maxPixelValue(dialogShadow)).toBeLessThanOrEqual(16);
    expect(dialogShadow).not.toContain('64px');
    expect(maxPixelValue(saveButtonStyles.boxShadow)).toBeLessThanOrEqual(16);
    expect(widestChannelSpread(saveButtonStyles.backgroundImage)).toBeLessThanOrEqual(18);
    expect(widestChannelSpread(providerToggleStyles.backgroundColor)).toBeLessThanOrEqual(12);
    expect(widestChannelSpread(providerToggleStyles.borderColor)).toBeLessThanOrEqual(12);
  } finally {
    await closeApp(app);
  }
});
