import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureBuilt } from './ensure-built.mjs';
import { prepareBetterSqlite3WithRetry } from './prepare-better-sqlite3.mjs';

const root = process.cwd();
const require = createRequire(import.meta.url);
const electronBinary = require('electron');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(child, timeoutMs, label) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out waiting for ${label} after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });

    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function waitForCondition(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (predicate()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}.${lastError ? ` Last error: ${lastError.message}` : ''}`);
}

function writeProfile(profilePath, profile) {
  writeFileSync(profilePath, `${JSON.stringify({
    version: 1,
    source: 'ollama-launch',
    providerId: 'ollama',
    modelSource: 'local',
    ...profile
  }, null, 2)}\n`, 'utf8');
}

function readActiveProfile(markerPath) {
  return JSON.parse(readFileSync(markerPath, 'utf8'));
}

function spawnElectron(profilePath, env, label) {
  const child = spawn(electronBinary, ['.', `--ollama-launch-profile=${profilePath}`], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[${label}:stderr] ${chunk}`);
  });
  return child;
}

async function terminate(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill();
  try {
    await waitForExit(child, 10_000, 'first Electron launch shutdown');
  } catch {
    child.kill('SIGKILL');
  }
}

async function main() {
  ensureBuilt('Ollama running launch smoke');
  await prepareBetterSqlite3WithRetry('electron');

  const isolatedStateRoot = mkdtempSync(path.join(tmpdir(), 'vicode-ollama-running-smoke-'));
  const isolatedUserDataPath = path.join(isolatedStateRoot, 'user-data');
  const isolatedSessionDataPath = path.join(isolatedStateRoot, 'session-data');
  const firstProfilePath = path.join(isolatedStateRoot, 'first-profile.json');
  const secondProfilePath = path.join(isolatedStateRoot, 'second-profile.json');
  const restoreProfilePath = path.join(isolatedStateRoot, 'restore-profile.json');
  const startupLogPath = path.join(isolatedStateRoot, 'startup.log');
  mkdirSync(isolatedUserDataPath, { recursive: true });
  mkdirSync(isolatedSessionDataPath, { recursive: true });

  writeProfile(firstProfilePath, {
    profileId: 'running-smoke-first',
    modelId: 'qwen2.5-coder:7b',
    transportMode: 'chat'
  });
  writeProfile(secondProfilePath, {
    profileId: 'running-smoke-second',
    modelId: 'qwen3:4b',
    transportMode: 'responses'
  });
  writeProfile(restoreProfilePath, {
    profileId: 'running-smoke-restore',
    modelId: 'qwen3:4b',
    restore: true
  });

  const env = {
    ...process.env,
    VICODE_USER_DATA_PATH: isolatedUserDataPath,
    VICODE_SESSION_DATA_PATH: isolatedSessionDataPath,
    VICODE_STARTUP_DEBUG: '1',
    VICODE_STARTUP_DEBUG_LOG_PATH: startupLogPath
  };

  const markerPath = path.join(isolatedUserDataPath, 'state', 'ollama-launch', 'active-profile.json');
  let firstChild = null;
  try {
    firstChild = spawnElectron(firstProfilePath, env, 'first');
    await waitForCondition(() => existsSync(markerPath), 30_000, 'first launch active marker');
    await waitForCondition(() => readActiveProfile(markerPath).profile?.profileId === 'running-smoke-first', 10_000, 'first launch profile marker');

    const secondChild = spawnElectron(secondProfilePath, env, 'second');
    const secondExit = await waitForExit(secondChild, 30_000, 'second Electron launch handoff');
    if (secondExit.code !== 0) {
      throw new Error(`Second launch exited with code ${secondExit.code ?? 'null'} signal ${secondExit.signal ?? 'null'}.`);
    }
    await waitForCondition(() => readActiveProfile(markerPath).profile?.profileId === 'running-smoke-second', 10_000, 'second launch profile handoff marker');

    const restoreChild = spawnElectron(restoreProfilePath, env, 'restore');
    const restoreExit = await waitForExit(restoreChild, 30_000, 'restore launch handoff');
    if (restoreExit.code !== 0) {
      throw new Error(`Restore launch exited with code ${restoreExit.code ?? 'null'} signal ${restoreExit.signal ?? 'null'}.`);
    }
    await waitForCondition(() => !existsSync(markerPath), 10_000, 'restore launch marker cleanup');

    console.log(JSON.stringify({
      status: 'ok',
      firstProfile: 'running-smoke-first',
      secondProfile: 'running-smoke-second',
      restoreMarkerRemoved: true
    }, null, 2));
  } finally {
    await terminate(firstChild);
    rmSync(isolatedStateRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
