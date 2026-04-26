import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { ensureBuilt } from "./ensure-built.mjs";
import { prepareBetterSqlite3WithRetry } from "./prepare-better-sqlite3.mjs";

const root = process.cwd();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAppWindow(app) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    for (const currentWindow of app.windows()) {
      if (currentWindow.isClosed()) {
        continue;
      }
      try {
        await currentWindow.waitForSelector("body", {
          timeout: 1000,
        });
        return currentWindow;
      } catch {
        continue;
      }
    }
    await sleep(500);
  }
  throw new Error("Timed out waiting for the Vicode application window.");
}

async function waitForAppReady(window) {
  await window.waitForLoadState("domcontentloaded");

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const hasBridge = await window.evaluate(() =>
      Boolean(
        window.vicode?.app &&
        window.vicode?.composer &&
        window.vicode?.providers &&
        window.vicode?.collab,
      ),
    );
    if (hasBridge) {
      return;
    }
    await sleep(250);
  }

  throw new Error("Vicode preload bridge did not become ready.");
}

async function waitForStartupSurface(window) {
  const startupSurfaces = [
    {
      label: "welcome-screen",
      isVisible: () =>
        window.getByRole("button", { name: "Get Started" }).isVisible(),
    },
    {
      label: "composer",
      isVisible: () => window.getByTestId("composer-input").isVisible(),
    },
    {
      label: "settings-nav",
      isVisible: () => window.getByTestId("nav-settings").isVisible(),
    },
    {
      label: "empty-thread-open-project",
      isVisible: () =>
        window.getByRole("button", { name: "Open project" }).isVisible(),
    },
  ];
  const deadline = Date.now() + 30000;

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

  throw new Error(
    `Timed out waiting for a startup surface (${startupSurfaces.map((surface) => surface.label).join(", ")}).`,
  );
}

async function waitForThreadTitle(window, expectedTitle) {
  await window.locator('.windows-titlebar-context-thread').waitFor({ state: 'visible', timeout: 30_000 });
  const actualTitle = (await window.locator('.windows-titlebar-context-thread').textContent())?.trim() ?? '';
  if (actualTitle !== expectedTitle) {
    throw new Error(
      `Expected restored thread title "${expectedTitle}" but found "${actualTitle}".`,
    );
  }
}

async function dismissWelcomeIfVisible(window) {
  const getStarted = window.getByRole("button", { name: "Get Started" });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await getStarted.isVisible().catch(() => false)) {
      await getStarted.click();
      await getStarted
        .waitFor({ state: "detached", timeout: 5_000 })
        .catch(() => {});
      return true;
    }
    const shellReady = (
      await Promise.all([
        window
          .getByTestId("nav-settings")
          .isVisible()
          .catch(() => false),
        window
          .getByTestId("composer-input")
          .isVisible()
          .catch(() => false),
        window
          .getByRole("button", { name: "Open project" })
          .isVisible()
          .catch(() => false),
      ])
    ).some(Boolean);
    if (shellReady) {
      return false;
    }
    await sleep(250);
  }
  return false;
}

async function waitForSettingsSurface(window) {
  await window
    .getByRole('heading', { name: 'App' })
    .waitFor({ state: 'visible', timeout: 30_000 });
  await window.getByRole('heading', { name: 'Updates' }).waitFor({ state: 'visible', timeout: 30_000 });
  await window
    .getByRole("button", {
      name: /Check now|Checking\.\.\.|Downloading\.\.\.|Restart to update/,
    })
    .waitFor({ state: "visible", timeout: 30_000 });
}

async function waitForPluginsSurface(window) {
  await window
    .getByRole('heading', { name: 'Make Vicode work your way' })
    .waitFor({ state: 'visible', timeout: 30_000 });
  await window
    .getByTestId('skills-tab-plugins')
    .waitFor({ state: 'visible', timeout: 30_000 });
  await window
    .getByPlaceholder('Search plugins')
    .waitFor({ state: 'visible', timeout: 30_000 });
}

async function main() {
  ensureBuilt("Electron smoke");
  await prepareBetterSqlite3WithRetry("electron");
  const isolatedStateRoot = mkdtempSync(path.join(tmpdir(), "vicode-smoke-"));
  const isolatedUserDataPath = path.join(isolatedStateRoot, "user-data");
  const isolatedSessionDataPath = path.join(isolatedStateRoot, "session-data");
  mkdirSync(isolatedUserDataPath, { recursive: true });
  mkdirSync(isolatedSessionDataPath, { recursive: true });
  const app = await electron.launch({
    args: ["."],
    cwd: root,
    env: {
      ...process.env,
      VICODE_USER_DATA_PATH: isolatedUserDataPath,
      VICODE_SESSION_DATA_PATH: isolatedSessionDataPath,
    },
  });

  try {
    console.log("[smoke] Electron launched");
    const window = await getAppWindow(app);
    console.log("[smoke] Vicode window ready");
    await waitForAppReady(window);
    let startupSurface = await waitForStartupSurface(window);
    if (startupSurface === "welcome-screen") {
      await dismissWelcomeIfVisible(window);
      startupSurface = await waitForStartupSurface(window);
    }
    const bootstrap = await window.evaluate(() =>
      window.vicode.app.getBootstrap(),
    );

    if (bootstrap.providers.length === 0) {
      throw new Error("Bootstrap returned no providers.");
    }
    if (!bootstrap.providers.some((provider) => provider.id === "openai")) {
      throw new Error("Bootstrap did not include the OpenAI provider.");
    }
    if (!bootstrap.providers.some((provider) => provider.id === "gemini")) {
      throw new Error("Bootstrap did not include the Gemini provider.");
    }

    const smokeWorkspacePath = path.join(isolatedStateRoot, "smoke-workspace");
    mkdirSync(smokeWorkspacePath, { recursive: true });

    const seeded = await window.evaluate(
      async ({ appBootstrap, smokeWorkspacePath }) => {
        let selectedProject =
          appBootstrap.projects.find(
            (project) =>
              project.id === appBootstrap.preferences.selectedProjectId,
          ) ??
          appBootstrap.projects[0] ??
          null;
        if (!selectedProject) {
          selectedProject = await window.vicode.projects.create({
            name: "Smoke Workspace",
            folderPath: smokeWorkspacePath,
            trusted: true,
          });
          await window.vicode.settings.save({
            selectedProjectId: selectedProject.id,
            lastOpenedThreadId: null,
          });
        }

        const providerId = selectedProject.defaultProviderId;
        const modelId =
          selectedProject.defaultModelByProvider[providerId] ??
          appBootstrap.preferences.defaultModelByProvider[providerId] ??
          appBootstrap.providers.find((provider) => provider.id === providerId)
            ?.models[0]?.id ??
          "gpt-5";

        const thread = await window.vicode.threads.create({
          projectId: selectedProject.id,
          providerId,
          modelId,
          executionPermission: "default",
        });

        await window.vicode.settings.save({
          selectedProjectId: selectedProject.id,
          lastOpenedThreadId: thread.id,
        });

        return {
          projectId: selectedProject.id,
          threadId: thread.id,
          threadTitle: thread.title,
        };
      },
      { appBootstrap: bootstrap, smokeWorkspacePath },
    );

    await window.reload();
    await waitForAppReady(window);
    if ((await waitForStartupSurface(window)) === "welcome-screen") {
      await dismissWelcomeIfVisible(window);
    }
    await waitForThreadTitle(window, seeded.threadTitle);

    const archivedRoundTrip = await window.evaluate(async (threadId) => {
      await window.vicode.threads.archive(threadId);
      const archived = await window.vicode.threads.listArchived(null);
      await window.vicode.threads.restore(threadId);
      return archived.length > 0;
    }, seeded.threadId);

    await window.getByTestId("nav-settings").click();
    await waitForSettingsSurface(window);
    await window.getByTestId("nav-settings").click();
    await waitForThreadTitle(window, seeded.threadTitle);

    await window.getByTestId("nav-plugins").click();
    await waitForPluginsSurface(window);
    await window.getByTestId("nav-plugins").click();
    await waitForThreadTitle(window, seeded.threadTitle);

    await window.getByTestId("nav-settings").click();
    await waitForSettingsSurface(window);
    await window.getByTestId("nav-plugins").click();
    await waitForPluginsSurface(window);
    if (
      await window
        .getByRole("heading", { name: "General" })
        .isVisible()
        .catch(() => false)
    ) {
      throw new Error("Settings remained visible after opening Plugins.");
    }
    await window.getByTestId("nav-plugins").click();
    await waitForThreadTitle(window, seeded.threadTitle);

    await window.evaluate(() => window.vicode.collab.clearConfig());
    const unconfiguredState = await window.evaluate(
      async () =>
        (await window.vicode.collab.getBootstrap()).config.connectionState,
    );
    if (unconfiguredState !== "unconfigured") {
      throw new Error(
        `Expected collaboration state "unconfigured" after clearConfig but found "${unconfiguredState}".`,
      );
    }

    await window.evaluate(() =>
      window.vicode.collab.configure({
        supabaseUrl: "https://example.supabase.co",
        supabaseAnonKey: "smoke-anon-key",
      }),
    );
    const signedOutState = await window.evaluate(async () => (await window.vicode.collab.getBootstrap()).config.connectionState);
    if (signedOutState !== 'unconfigured') {
      throw new Error(`Expected parked collaboration state "unconfigured" after configure but found "${signedOutState}".`);
    }

    await window.evaluate(() => window.vicode.collab.clearConfig());

    console.log(
      JSON.stringify(
        {
          appStarted: true,
          projectCount: bootstrap.projects.length,
          startupThreadRestore: true,
          archivedThreadRoundTrip: archivedRoundTrip,
          collaborationStates: {
            afterClearConfig: unconfiguredState,
            afterConfigure: signedOutState,
          },
          providerStates: bootstrap.providers.map((provider) => ({
            id: provider.id,
            installed: provider.installed,
            authState: provider.authState,
            modelCount: provider.models.length,
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
    await prepareBetterSqlite3WithRetry("node");
    rmSync(isolatedStateRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
