import { expect, test } from '@playwright/test';
import { closeApp, launchApp } from './helpers/electron';

async function readRenderedLogoSources(window: Awaited<ReturnType<typeof launchApp>>['window']) {
  return await window.locator('.themed-wolf-logo').evaluateAll((logos) =>
    logos.map((logo) => {
      const darkLogo = logo.querySelector<HTMLImageElement>('.themed-wolf-logo-dark');
      const lightLogo = logo.querySelector<HTMLImageElement>('.themed-wolf-logo-light');
      const readStats = (image: HTMLImageElement | null) => {
        if (!image || !image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) {
          return null;
        }

        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) {
          return null;
        }

        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let visible = 0;
        let sum = 0;
        let maxChannel = 0;

        for (let index = 0; index < pixels.length; index += 4) {
          const alpha = pixels[index + 3] ?? 0;
          if (alpha === 0) {
            continue;
          }

          const red = pixels[index] ?? 0;
          const green = pixels[index + 1] ?? 0;
          const blue = pixels[index + 2] ?? 0;
          visible += 1;
          sum += (red + green + blue) / 3;
          maxChannel = Math.max(maxChannel, red, green, blue);
        }

        return {
          visible,
          averageChannel: visible > 0 ? sum / visible : 0,
          maxChannel
        };
      };

      return {
        darkDisplay: darkLogo ? getComputedStyle(darkLogo).display : null,
        lightDisplay: lightLogo ? getComputedStyle(lightLogo).display : null,
        darkSrc: darkLogo?.currentSrc ?? darkLogo?.src ?? '',
        lightSrc: lightLogo?.currentSrc ?? lightLogo?.src ?? '',
        darkStats: readStats(darkLogo),
        lightStats: readStats(lightLogo)
      };
    })
  );
}

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

    const lightLogos = await readRenderedLogoSources(window);
    expect(lightLogos.length).toBeGreaterThanOrEqual(2);
    for (const logo of lightLogos) {
      expect(logo.darkDisplay).toBe('none');
      expect(logo.lightDisplay).toBe('block');
      expect(logo.darkSrc).toContain('wolf-logo');
      expect(logo.lightStats?.visible).toBeGreaterThan(0);
      expect(logo.lightStats?.maxChannel).toBe(0);
    }

    await window.evaluate(async () => {
      await window.vicode.settings.save({ appearanceMode: 'dark' });
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
      document.documentElement.dataset.theme = 'dark';
      document.documentElement.style.colorScheme = 'dark';
    });

    await expect.poll(async () => await window.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');

    const darkLogos = await readRenderedLogoSources(window);
    expect(darkLogos.length).toBeGreaterThanOrEqual(2);
    for (const logo of darkLogos) {
      expect(logo.darkDisplay).toBe('block');
      expect(logo.lightDisplay).toBe('none');
      expect(logo.darkSrc).toContain('wolf-logo');
      expect(logo.darkSrc).not.toContain('wolf-logo-light');
      expect(logo.darkStats?.visible).toBeGreaterThan(0);
      expect(logo.darkStats?.averageChannel).toBeGreaterThan(220);
      expect(logo.lightStats?.maxChannel).toBe(0);
    }
  } finally {
    await closeApp(app);
  }
});
