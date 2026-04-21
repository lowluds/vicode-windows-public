import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { prepareBetterSqlite3 } from '../../scripts/prepare-better-sqlite3.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const isolatedStateCleanupByApp = new WeakMap<ElectronApplication, () => void>();

export interface LaunchStatePaths {
  userDataPath: string;
  sessionDataPath: string;
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
      rmSync(isolatedStateRoot, { recursive: true, force: true });
    }
  };
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForElectronProcessExit(child: ChildProcess | null | undefined, timeoutMs = 15_000) {
  if (!child || child.exitCode !== null || child.killed) {
    return;
  }

  await Promise.race([
    once(child, 'exit').catch(() => {}),
    sleep(timeoutMs)
  ]);
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

export async function dismissWelcomeIfVisible(window: Page) {
  const getStarted = window.getByRole('button', { name: 'Get Started' });
  if (await getStarted.isVisible().catch(() => false)) {
    await getStarted.click();
    await expect(getStarted).toHaveCount(0);
  }
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
    await dismissWelcomeIfVisible(window);
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
    const child = app.process();
    await app.close().catch(() => {});
    await waitForElectronProcessExit(child);
    isolatedState?.cleanup();
    await prepareBetterSqlite3WithRetry('node');
    throw error;
  }
}

export async function closeApp(app: ElectronApplication | null, options?: { cleanupState?: boolean }) {
  if (app) {
    const cleanup = isolatedStateCleanupByApp.get(app);
    const child = app.process();
    await app.close();
    await waitForElectronProcessExit(child);
    if (options?.cleanupState !== false) {
      cleanup?.();
    }
    isolatedStateCleanupByApp.delete(app);
  }
  await prepareBetterSqlite3WithRetry('node');
}
