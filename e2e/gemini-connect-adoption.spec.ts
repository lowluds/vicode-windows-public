import { expect, test } from '@playwright/test';
import { closeApp, launchApp } from './helpers/electron';

test('Gemini Connect adopts a detected local CLI sign-in into Vicode', async () => {
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.providers']
  });

  try {
    const bootstrap = await window.evaluate(() => window.vicode.app.getBootstrap());
    const gemini = bootstrap.providers.find((provider) => provider.id === 'gemini');
    test.skip(!gemini?.installed, 'Gemini CLI must be installed for the connect-adoption check.');
    test.skip(
      !(
        gemini.authState === 'detected' ||
        (gemini.authState === 'disconnected' && gemini.authMode === 'cli')
      ),
      'Gemini must have a detected machine-local CLI sign-in for the adoption check.'
    );

    await window.getByTestId('nav-settings').click();
    await window.locator('.settings-nav-item').filter({ hasText: 'Providers' }).click();

    const geminiCard = window.locator('article').filter({ hasText: 'Gemini' }).first();
    await expect(geminiCard).toBeVisible();
    await geminiCard.getByRole('button', { name: 'Connect' }).click();

    await expect
      .poll(async () => {
        const nextBootstrap = await window.evaluate(() => window.vicode.app.getBootstrap());
        return nextBootstrap.providers.find((provider) => provider.id === 'gemini')?.authState ?? null;
      })
      .toBe('connected');

    await expect(geminiCard.getByText('Gemini is ready in Vicode.', { exact: true })).toBeVisible();
    await expect(geminiCard.getByText('Ready', { exact: true })).toBeVisible();
  } finally {
    await closeApp(app);
  }
});
