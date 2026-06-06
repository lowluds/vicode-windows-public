import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { _electron as electron } from 'playwright';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getInstalledExecutablePath() {
  if (process.env.VICODE_INSTALLED_EXE) {
    return process.env.VICODE_INSTALLED_EXE;
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    throw new Error('LOCALAPPDATA is not set. Set VICODE_INSTALLED_EXE to the installed Vicode.exe path.');
  }

  return path.join(localAppData, 'Programs', 'vicode-windows', 'Vicode.exe');
}

async function getAppWindow(app, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const currentWindow of app.windows()) {
      if (currentWindow.isClosed()) {
        continue;
      }
      try {
        await currentWindow.waitForSelector('body', { timeout: 1_000 });
        return currentWindow;
      } catch {
        continue;
      }
    }
    await sleep(500);
  }
  throw new Error('Timed out waiting for the installed Vicode application window.');
}

async function waitForAppReady(window, timeoutMs = 45_000) {
  await window.waitForLoadState('domcontentloaded');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await window.evaluate(() => Boolean(window.vicode?.app && window.vicode?.settings))) {
      return;
    }
    await sleep(250);
  }

  throw new Error('Installed Vicode preload bridge did not become ready.');
}

async function waitForStartupSurface(window, timeoutMs = 45_000) {
  const startupSurfaces = [
    {
      label: 'composer',
      isVisible: () => window.getByTestId('composer-input').isVisible()
    },
    {
      label: 'settings-nav',
      isVisible: () => window.getByTestId('nav-settings').isVisible()
    },
    {
      label: 'empty-thread-open-project',
      isVisible: () => window.getByRole('button', { name: 'Open project' }).isVisible()
    }
  ];
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const surface of startupSurfaces) {
      if (await surface.isVisible().catch(() => false)) {
        return surface.label;
      }
    }
    await sleep(250);
  }

  throw new Error(`Timed out waiting for installed startup surface (${startupSurfaces.map((surface) => surface.label).join(', ')}).`);
}

async function waitForThreadTitle(window, expectedTitle) {
  await window.locator('.windows-titlebar-context-thread').waitFor({ state: 'visible', timeout: 30_000 });
  const actualTitle = (await window.locator('.windows-titlebar-context-thread').textContent())?.trim() ?? '';
  if (actualTitle !== expectedTitle) {
    throw new Error(`Expected installed restored thread title "${expectedTitle}" but found "${actualTitle}".`);
  }
}

async function verifyNarrowChrome(window, expectedThreadTitle) {
  if ((await window.getByTestId('nav-plugins').count()) !== 0) {
    throw new Error('Installed app exposed legacy Plugins primary chrome during the narrow beta.');
  }
  if ((await window.getByTestId('nav-automations').count()) !== 0) {
    throw new Error('Installed app exposed legacy Automations primary chrome during the narrow beta.');
  }
  if (!(await window.getByTestId('nav-skills').isVisible().catch(() => false))) {
    throw new Error('Installed app did not expose the narrow titlebar Skills entrypoint.');
  }

  await window.getByTestId('nav-skills').click();
  await window.locator('.skills-page-shell').waitFor({
    state: 'visible',
    timeout: 30_000
  });
  await window.getByTestId('skills-tab-plugins').waitFor({
    state: 'visible',
    timeout: 30_000
  });
  await window.getByTestId('skills-tab-skills').waitFor({
    state: 'visible',
    timeout: 30_000
  });
  await window.getByRole('button', { name: /^(Close plugins and skills|Close catalog)$/u }).click();
  await waitForThreadTitle(window, expectedThreadTitle);
}

function assertNarrowProviderSurface(providerStates) {
  if (!providerStates.some((provider) => provider.id === 'ollama')) {
    throw new Error('Installed bootstrap did not include the Ollama provider.');
  }

  const discontinuedProviderIds = new Set(['openai', 'gemini', 'qwen', 'kimi']);
  const discontinuedProvider = providerStates.find((provider) => discontinuedProviderIds.has(provider.id));
  if (discontinuedProvider) {
    throw new Error(`Installed bootstrap surfaced discontinued provider ${discontinuedProvider.id}.`);
  }
}

async function seedInstalledThread(window, workspaceDir) {
  return window.evaluate(async (targetWorkspaceDir) => {
    const appBootstrap = await window.vicode.app.getBootstrap();
    const project = await window.vicode.projects.create({
      name: `Installed smoke ${Date.now()}`,
      folderPath: targetWorkspaceDir,
      trusted: true
    });

    const providerId = project.defaultProviderId;
    const modelId =
      project.defaultModelByProvider[providerId] ??
      appBootstrap.preferences.defaultModelByProvider[providerId] ??
      appBootstrap.providers.find((provider) => provider.id === providerId)?.models[0]?.id ??
      'qwen3-coder';

    const thread = await window.vicode.threads.create({
      projectId: project.id,
      providerId,
      modelId,
      executionPermission: 'default'
    });

    await window.vicode.settings.save({
      selectedProjectId: project.id,
      lastOpenedThreadId: thread.id
    });

    return {
      projectId: project.id,
      threadId: thread.id,
      threadTitle: thread.title
    };
  }, workspaceDir);
}

async function launchInstalled(executablePath, statePaths, options) {
  const app = await electron.launch({
    executablePath,
    cwd: path.dirname(executablePath),
    env: {
      ...process.env,
      VICODE_USER_DATA_PATH: statePaths.userDataPath,
      VICODE_SESSION_DATA_PATH: statePaths.sessionDataPath
    }
  });

  try {
    const window = await getAppWindow(app);
    await waitForAppReady(window);
    const firstSurface = await waitForStartupSurface(window);
    const finalSurface = await waitForStartupSurface(window);
    const bootstrap = await window.evaluate(() => window.vicode.app.getBootstrap());
    const providerStates = bootstrap.providers.map((provider) => ({
      id: provider.id,
      installed: provider.installed,
      authState: provider.authState,
      modelCount: provider.models.length
    }));

    assertNarrowProviderSurface(providerStates);
    const seeded =
      options.seedThread
        ? await seedInstalledThread(window, options.workspaceDir)
        : {
            threadTitle: options.expectedThreadTitle
          };

    await window.reload();
    await waitForAppReady(window);
    await waitForStartupSurface(window);
    await waitForThreadTitle(window, seeded.threadTitle);
    await verifyNarrowChrome(window, seeded.threadTitle);

    return {
      app,
      result: {
        firstSurface,
        finalSurface,
        providerStates,
        threadTitle: seeded.threadTitle
      }
    };
  } catch (error) {
    await app.close().catch(() => {});
    throw error;
  }
}

async function main() {
  const executablePath = getInstalledExecutablePath();
  if (!existsSync(executablePath)) {
    throw new Error(`Installed executable not found at ${executablePath}. Run the installer first.`);
  }

  const isolatedStateRoot = mkdtempSync(path.join(tmpdir(), 'vicode-installed-state-'));
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-installed-smoke-'));
  writeFileSync(
    path.join(workspaceDir, 'package.json'),
    JSON.stringify(
      {
        name: 'vicode-installed-smoke-project',
        private: true,
        scripts: {
          build: 'vite build'
        }
      },
      null,
      2
    ),
    'utf8'
  );
  const statePaths = {
    userDataPath: path.join(isolatedStateRoot, 'user-data'),
    sessionDataPath: path.join(isolatedStateRoot, 'session-data')
  };
  mkdirSync(statePaths.userDataPath, { recursive: true });
  mkdirSync(statePaths.sessionDataPath, { recursive: true });

  try {
    const firstLaunch = await launchInstalled(executablePath, statePaths, {
      seedThread: true,
      workspaceDir
    });
    await firstLaunch.app.close();
    const relaunch = await launchInstalled(executablePath, statePaths, {
      seedThread: false,
      workspaceDir,
      expectedThreadTitle: firstLaunch.result.threadTitle
    });
    await relaunch.app.close();

    console.log(
      JSON.stringify(
        {
          installedAppStarted: true,
          firstLaunch: firstLaunch.result,
          relaunch: relaunch.result
        },
        null,
        2
      )
    );
  } finally {
    rmSync(isolatedStateRoot, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
