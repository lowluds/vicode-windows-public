import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { prepareBetterSqlite3 } from '../../scripts/prepare-better-sqlite3.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const isolatedStateCleanupByApp = new WeakMap<ElectronApplication, () => void>();

export interface LaunchStatePaths {
  userDataPath: string;
  sessionDataPath: string;
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function rmSyncWithRetry(targetPath: string, attempts = 120, delayMs = 500) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      const code = typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(code) || attempt === attempts - 1) {
        throw error;
      }
      sleepSync(delayMs);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
}

function getFsErrorCode(error: unknown) {
  return typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
}

function cleanupIsolatedStateRoot(isolatedStateRoot: string) {
  try {
    rmSyncWithRetry(isolatedStateRoot);
    return;
  } catch (error) {
    const code = getFsErrorCode(error);
    if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(code)) {
      throw error;
    }
  }

  const deferredPath = `${isolatedStateRoot}-pending-delete-${Date.now()}`;
  try {
    renameSync(isolatedStateRoot, deferredPath);
    rmSyncWithRetry(deferredPath, 24, 1_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Deferred cleanup for ${isolatedStateRoot}: ${message}`);
  }
}

function createIsolatedState() {
  const isolatedStateRoot = mkdtempSync(path.join(tmpdir(), 'vicode-playwright-'));
  const isolatedUserDataPath = path.join(isolatedStateRoot, 'user-data');
  const isolatedSessionDataPath = path.join(isolatedStateRoot, 'session-data');

  mkdirSync(isolatedUserDataPath, { recursive: true });
  mkdirSync(isolatedSessionDataPath, { recursive: true });

  return {
    isolatedUserDataPath,
    isolatedSessionDataPath,
    cleanup() {
      cleanupIsolatedStateRoot(isolatedStateRoot);
    }
  };
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForElectronProcessExit(child: ChildProcess | null | undefined, timeoutMs = 15_000) {
  if (!child || child.exitCode !== null || child.killed) {
    return true;
  }

  await Promise.race([
    once(child, 'exit').catch(() => {}),
    sleep(timeoutMs)
  ]);

  return child.exitCode !== null || child.killed;
}

async function closeElectronApp(app: ElectronApplication | null, timeoutMs = 15_000) {
  if (!app) {
    return;
  }

  let child: ChildProcess | null = null;
  try {
    child = app.process();
  } catch {
    child = null;
  }
  await Promise.race([
    app.close().catch(() => {}),
    sleep(timeoutMs)
  ]);
  const exited = await waitForElectronProcessExit(child, timeoutMs);
  if (!exited && child && child.exitCode === null && !child.killed) {
    child.kill('SIGKILL');
    await waitForElectronProcessExit(child, 5_000);
  }
}

async function prepareBetterSqlite3WithRetry(target: 'electron' | 'node', attempts = 40, delayMs = 500) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      prepareBetterSqlite3(target);
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('better_sqlite3.node is locked') || attempt === attempts - 1) {
        throw error;
      }
      await sleep(delayMs);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(`Failed to prepare better-sqlite3 for ${target}.`);
}

export async function getAppWindow(app: ElectronApplication, timeoutMs = 45_000) {
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
    await sleep(250);
  }

  throw new Error('Timed out waiting for the Vicode application window.');
}

export async function waitForBridge(window: Page, requiredPaths: string[] = ['vicode.app'], timeoutMs = 30_000) {
  await window.waitForLoadState('domcontentloaded');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await window.evaluate((paths) => {
      function readPath(target: Record<string, unknown>, path: string) {
        return path.split('.').reduce<unknown>((current, segment) => {
          if (!current || typeof current !== 'object') {
            return undefined;
          }
          return (current as Record<string, unknown>)[segment];
        }, target);
      }

      return paths.every((path) => Boolean(readPath(window as unknown as Record<string, unknown>, path)));
    }, requiredPaths);
    if (ready) {
      return;
    }
    await sleep(250);
  }

  throw new Error('Vicode preload bridge did not become ready.');
}

export async function waitForStartupSurface(window: Page, timeoutMs = 30_000) {
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
    `Timed out waiting for a startup surface (${startupSurfaces.map((surface) => surface.label).join(', ')}).`
  );
}

export async function waitForThreadSurfaceReady(window: Page, timeoutMs = 30_000) {
  await expect(window.getByTestId('composer-input')).toBeVisible({ timeout: timeoutMs });
  await sleep(250);
}

export async function openTitlebarSurface(
  window: Page,
  navTestId: string,
  readyLocator: Locator,
  timeoutMs = 30_000
) {
  const navButton = window.getByTestId(navTestId);
  await expect(navButton).toBeVisible({ timeout: timeoutMs });

  if (await readyLocator.isVisible().catch(() => false)) {
    return;
  }

  await navButton.click();
  try {
    await readyLocator.waitFor({ state: 'visible', timeout: 5_000 });
    return;
  } catch {
    const active = await navButton.evaluate((element) => element.classList.contains('is-active')).catch(() => false);
    if (active) {
      await expect(readyLocator).toBeVisible({ timeout: timeoutMs });
      return;
    }
  }

  await navButton.click({ force: true });
  await expect(readyLocator).toBeVisible({ timeout: timeoutMs });
}

export async function dismissWelcomeIfVisible(_window: Page) {
  // Retained as a no-op for older E2E call sites; startup now enters the app shell directly.
}

export async function launchApp(options?: {
  bridgePaths?: string[];
  timeoutMs?: number;
  statePaths?: LaunchStatePaths;
  env?: Record<string, string | undefined>;
}) {
  await prepareBetterSqlite3WithRetry('electron');
  const isolatedState = options?.statePaths ? null : createIsolatedState();
  const statePaths = options?.statePaths ?? {
    userDataPath: isolatedState!.isolatedUserDataPath,
    sessionDataPath: isolatedState!.isolatedSessionDataPath
  };
  const app = await electron.launch({
    args: ['.'],
    cwd: root,
    env: {
      ...process.env,
      ...options?.env,
      VICODE_USER_DATA_PATH: statePaths.userDataPath,
      VICODE_SESSION_DATA_PATH: statePaths.sessionDataPath
    }
  });

  try {
    const window = await getAppWindow(app, options?.timeoutMs);
    await waitForBridge(window, options?.bridgePaths ?? ['vicode.app'], options?.timeoutMs);
    await waitForStartupSurface(window, options?.timeoutMs);
    await dismissWelcomeIfVisible(window);
    await waitForStartupSurface(window, options?.timeoutMs);
    if (isolatedState) {
      isolatedStateCleanupByApp.set(app, isolatedState.cleanup);
    }
    return {
      app,
      window,
      statePaths,
      cleanupState: isolatedState?.cleanup ?? (() => {})
    };
  } catch (error) {
    await closeElectronApp(app);
    isolatedState?.cleanup();
    await prepareBetterSqlite3WithRetry('node');
    throw error;
  }
}

export async function closeApp(app: ElectronApplication | null, options?: { cleanupState?: boolean }) {
  if (app) {
    const cleanup = isolatedStateCleanupByApp.get(app);
    await closeElectronApp(app);
    if (options?.cleanupState !== false) {
      cleanup?.();
    }
    isolatedStateCleanupByApp.delete(app);
  }
  await prepareBetterSqlite3WithRetry('node');
}
