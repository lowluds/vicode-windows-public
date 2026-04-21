import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { closeApp, launchApp } from './helpers/electron';

function listGeminiSigninProcessPids() {
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NonInteractive',
      '-Command',
      [
        "$processes = Get-CimInstance Win32_Process | Where-Object {",
        "  $_.Name -match '^cmd\\.exe$' -and",
        "  $_.CommandLine -like '*gemini.cmd*'",
        '};',
        '$processes | Select-Object -ExpandProperty ProcessId'
      ].join(' ')
    ],
    { encoding: 'utf8' }
  );

  return output
    .split(/\r?\n/)
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value));
}

function killProcesses(processIds: number[]) {
  for (const processId of processIds) {
    try {
      execFileSync('taskkill.exe', ['/PID', String(processId), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // The auth shell can exit on its own before cleanup runs.
    }
  }
}

test('Gemini retry sign-in launches the managed browser-auth CLI process', async () => {
  const baselinePids = listGeminiSigninProcessPids();
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.providers']
  });
  let launchedPids: number[] = [];

  try {
    const bootstrap = await window.evaluate(() => window.vicode.app.getBootstrap());
    const gemini = bootstrap.providers.find((provider) => provider.id === 'gemini');
    test.skip(!gemini?.installed, 'Gemini CLI must be installed for the CLI sign-in regression check.');

    await window.getByTestId('nav-settings').click();
    await window.locator('.settings-nav-item').filter({ hasText: 'Providers' }).click();

    const geminiCard = window.locator('article').filter({ hasText: 'Gemini' }).first();
    await expect(geminiCard).toBeVisible();

    const actionsButton = geminiCard.getByRole('button', { name: 'Gemini actions' });
    await expect(actionsButton).toBeVisible();
    await actionsButton.click();
    await window.getByRole('menuitem', { name: 'Retry Gemini sign-in' }).click();
    await expect(geminiCard.getByText('Checking sign-in')).toBeVisible();

    await expect
      .poll(() => {
        const current = listGeminiSigninProcessPids();
        launchedPids = current.filter((pid) => !baselinePids.includes(pid));
        return launchedPids.length;
      })
      .toBeGreaterThan(0);
  } finally {
    if (launchedPids.length > 0) {
      killProcesses(launchedPids);
    }
    await closeApp(app);
  }
});
