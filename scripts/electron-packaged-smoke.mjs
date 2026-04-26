import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { _electron as electron } from 'playwright';

const root = process.cwd();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPackagedExecutablePath() {
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const productName = packageJson.build?.productName ?? 'Vicode';
  return path.join(root, 'release', 'win-unpacked', `${productName}.exe`);
}

async function getAppWindow(app, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const currentWindow of app.windows()) {
      if (currentWindow.isClosed()) {
        continue;
      }
      try {
        await currentWindow.waitForSelector('body', {
          timeout: 1_000
        });
        return currentWindow;
      } catch {
        continue;
      }
    }
    await sleep(500);
  }
  throw new Error('Timed out waiting for the packaged Vicode application window.');
}

async function waitForAppReady(window, timeoutMs = 45_000) {
  await window.waitForLoadState('domcontentloaded');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hasBridge = await window.evaluate(() => Boolean(window.vicode?.app && window.vicode?.composer));
    if (hasBridge) {
      return;
    }
    await sleep(250);
  }

  throw new Error('Packaged Vicode preload bridge did not become ready.');
}

async function waitForStartupSurface(window, timeoutMs = 45_000) {
  const startupSurfaces = [
    {
      label: 'welcome-screen',
      isVisible: () => window.getByRole('button', { name: 'Get Started' }).isVisible()
    },
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
      try {
        if (await surface.isVisible()) {
          return surface.label;
        }
      } catch {
        continue;
      }
    }
    await sleep(250);
  }

  throw new Error(`Timed out waiting for a packaged startup surface (${startupSurfaces.map((surface) => surface.label).join(', ')}).`);
}

async function waitForThreadTitle(window, expectedTitle) {
  await window.locator('.windows-titlebar-context-thread').waitFor({ state: 'visible', timeout: 30_000 });
  const actualTitle = (await window.locator('.windows-titlebar-context-thread').textContent())?.trim() ?? '';
  if (actualTitle !== expectedTitle) {
    throw new Error(`Expected restored thread title "${expectedTitle}" but found "${actualTitle}".`);
  }
}

async function dismissWelcomeIfVisible(window) {
  const getStarted = window.getByRole('button', { name: 'Get Started' });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await getStarted.isVisible().catch(() => false)) {
      await getStarted.click();
      await getStarted.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
      return true;
    }
    const shellReady = (
      await Promise.all([
        window.getByTestId('nav-settings').isVisible().catch(() => false),
        window.getByTestId('composer-input').isVisible().catch(() => false),
        window.getByRole('button', { name: 'Open project' }).isVisible().catch(() => false)
      ])
    ).some(Boolean);
    if (shellReady) {
      return false;
    }
    await sleep(250);
  }
  return false;
}

async function waitForSettingsSurface(window, timeoutMs = 30_000) {
  await window
    .getByRole('heading', { name: 'App' })
    .waitFor({ state: 'visible', timeout: timeoutMs });
  await window.getByRole('heading', { name: 'Updates' }).waitFor({ state: 'visible', timeout: timeoutMs });
  await window
    .getByRole('button', { name: /Check now|Checking\.\.\.|Downloading\.\.\.|Restart to update/ })
    .waitFor({ state: 'visible', timeout: timeoutMs });
}

async function waitForPluginsSurface(window, timeoutMs = 30_000) {
  await window
    .getByRole('heading', { name: /^Providers$/ })
    .waitFor({ state: 'visible', timeout: timeoutMs });
  await window
    .getByText('Connect the CLIs and keys Vicode can run.')
    .waitFor({ state: 'visible', timeout: timeoutMs });
  await window
    .getByText('Default model')
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs });
}

async function main() {
  const executablePath = getPackagedExecutablePath();
  if (!existsSync(executablePath)) {
    throw new Error(`Packaged executable not found at ${executablePath}. Run "npm run dist:win" first.`);
  }

  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-packaged-smoke-'));
  const isolatedStateRoot = mkdtempSync(path.join(tmpdir(), 'vicode-packaged-state-'));
  const isolatedUserDataPath = path.join(isolatedStateRoot, 'user-data');
  const isolatedSessionDataPath = path.join(isolatedStateRoot, 'session-data');
  mkdirSync(isolatedUserDataPath, { recursive: true });
  mkdirSync(isolatedSessionDataPath, { recursive: true });
  writeFileSync(
    path.join(workspaceDir, 'package.json'),
    JSON.stringify(
      {
        name: 'vicode-packaged-smoke-project',
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

  const app = await electron.launch({
    executablePath,
    cwd: path.dirname(executablePath),
    env: {
      ...process.env,
      VICODE_USER_DATA_PATH: isolatedUserDataPath,
      VICODE_SESSION_DATA_PATH: isolatedSessionDataPath
    }
  });

  let projectId = null;
  let threadId = null;

  try {
    console.log('[packaged-smoke] Packaged Vicode launched');
    const window = await getAppWindow(app);
    console.log('[packaged-smoke] Packaged Vicode window ready');
    await waitForAppReady(window);
    let startupSurface = await waitForStartupSurface(window);
    if (startupSurface === 'welcome-screen') {
      await dismissWelcomeIfVisible(window);
      startupSurface = await waitForStartupSurface(window);
    }

    const bootstrap = await window.evaluate(() => window.vicode.app.getBootstrap());
    if (!bootstrap.providers.some((provider) => provider.id === 'openai')) {
      throw new Error('Packaged bootstrap did not include the OpenAI provider.');
    }
    if (!bootstrap.providers.some((provider) => provider.id === 'gemini')) {
      throw new Error('Packaged bootstrap did not include the Gemini provider.');
    }

    const seeded = await window.evaluate(async (targetWorkspaceDir) => {
      const appBootstrap = await window.vicode.app.getBootstrap();
      const project = await window.vicode.projects.create({
        name: `Packaged smoke ${Date.now()}`,
        folderPath: targetWorkspaceDir,
        trusted: true
      });

      const providerId = project.defaultProviderId;
      const modelId =
        project.defaultModelByProvider[providerId] ??
        appBootstrap.preferences.defaultModelByProvider[providerId] ??
        appBootstrap.providers.find((provider) => provider.id === providerId)?.models[0]?.id ??
        'gpt-5';

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

    projectId = seeded.projectId;
    threadId = seeded.threadId;

    await window.reload();
    await waitForAppReady(window);
    if ((await waitForStartupSurface(window)) === 'welcome-screen') {
      await dismissWelcomeIfVisible(window);
    }
    await waitForThreadTitle(window, seeded.threadTitle);

    const archivedRoundTrip = await window.evaluate(async (targetThreadId) => {
      await window.vicode.threads.archive(targetThreadId);
      const archived = await window.vicode.threads.listArchived(null);
      await window.vicode.threads.restore(targetThreadId);
      return archived.some((thread) => thread.id === targetThreadId);
    }, seeded.threadId);

    await window.getByTestId('nav-settings').click();
    await waitForSettingsSurface(window);
    await window.getByRole('button', { name: 'Providers' }).click();
    await waitForPluginsSurface(window);

    console.log(
      JSON.stringify(
        {
          packagedAppStarted: true,
          startupThreadRestore: true,
          archivedThreadRoundTrip: archivedRoundTrip,
          providerStates: bootstrap.providers.map((provider) => ({
            id: provider.id,
            installed: provider.installed,
            authState: provider.authState,
            modelCount: provider.models.length
          }))
        },
        null,
        2
      )
    );
  } finally {
    try {
      const window = app.windows().find((currentWindow) => !currentWindow.isClosed());
      if (window && projectId) {
        await window
          .evaluate(
            async ({ targetProjectId, targetThreadId }) => {
              if (targetThreadId) {
                await window.vicode.threads.remove(targetThreadId).catch(() => {});
              }
              await window.vicode.projects.remove(targetProjectId).catch(() => {});
            },
            { targetProjectId: projectId, targetThreadId: threadId }
          )
          .catch(() => {});
      }
    } finally {
      await app.close().catch(() => {});
      rmSync(workspaceDir, { recursive: true, force: true });
      rmSync(isolatedStateRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
