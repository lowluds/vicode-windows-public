import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { closeApp, launchApp, waitForBridge, waitForThreadSurfaceReady } from './helpers/electron';

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
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-gemini-signin-e2e-'));
  const baselinePids = listGeminiSigninProcessPids();
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.providers', 'vicode.projects', 'vicode.threads', 'vicode.settings']
  });
  let launchedPids: number[] = [];
  let projectId: string | null = null;

  try {
    const bootstrap = await window.evaluate(() => window.vicode.app.getBootstrap());
    const gemini = bootstrap.providers.find((provider) => provider.id === 'gemini');
    test.skip(!gemini?.installed, 'Gemini CLI must be installed for the CLI sign-in regression check.');
    test.skip(gemini.authState === 'connected', 'Gemini is already connected, so the sign-in launch action is not shown.');
    projectId = await window.evaluate(async ({ workspaceDir }) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const provider = bootstrap.providers.find((entry) => entry.id === 'gemini') ?? bootstrap.providers[0];
      const project = await window.vicode.projects.create({
        name: `Gemini sign-in ${Date.now()}`,
        folderPath: workspaceDir,
        trusted: true
      });
      const modelId =
        project.defaultModelByProvider[provider.id] ??
        bootstrap.preferences.defaultModelByProvider[provider.id] ??
        provider.models[0]?.id ??
        'gemini-2.5-pro';
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
    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.providers', 'vicode.projects', 'vicode.threads', 'vicode.settings']);
    await waitForThreadSurfaceReady(window);

    await window.getByTestId('nav-sidebar-settings').click();
    await window.locator('.settings-nav-item').filter({ hasText: 'Providers' }).click();

    const geminiCard = window.locator('article').filter({ hasText: 'Gemini' }).first();
    await expect(geminiCard).toBeVisible();

    const actionsButton = geminiCard.getByRole('button', { name: 'Gemini actions' });
    await expect(actionsButton).toBeVisible();
    if (gemini.authMode === 'cli') {
      await actionsButton.click();
      await window.getByRole('menuitem', { name: 'Retry Gemini sign-in' }).click();
    } else {
      await geminiCard.getByRole('button', { name: 'Connect' }).click();
    }
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
    if (projectId) {
      await window.evaluate(async (targetProjectId) => {
        const bootstrap = await window.vicode.app.getBootstrap();
        if (bootstrap.projects.some((project) => project.id === targetProjectId)) {
          await window.vicode.projects.remove(targetProjectId);
        }
      }, projectId).catch(() => {});
    }
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
