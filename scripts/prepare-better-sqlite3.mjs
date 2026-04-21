import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const cacheRoot = path.join(repoRoot, '.cache', 'native-modules', 'better-sqlite3');
const statePath = path.join(cacheRoot, 'active-target.json');
const binaryFileName = 'better_sqlite3.node';
const defaultRetryAttempts = 40;
const defaultRetryDelayMs = 500;

function getBetterSqliteDir() {
  const packageJsonPath = require.resolve('better-sqlite3/package.json');
  return path.dirname(packageJsonPath);
}

function getPrebuildInstallCli() {
  return require.resolve('prebuild-install/bin.js');
}

function getElectronVersion() {
  return require('electron/package.json').version;
}

function getNodeVersion() {
  return process.versions.node;
}

function getTargetVersion(target) {
  return target === 'electron' ? getElectronVersion() : getNodeVersion();
}

function getTargetAbi(target) {
  return target === 'node' ? process.versions.modules : null;
}

function getBinaryPath() {
  return path.join(getBetterSqliteDir(), 'build', 'Release', binaryFileName);
}

function getCachePath(target) {
  const abiSuffix = getTargetAbi(target);
  const abiSegment = abiSuffix ? `-abi${abiSuffix}` : '';
  return path.join(cacheRoot, `${target}-${getTargetVersion(target)}${abiSegment}-${process.platform}-${process.arch}.node`);
}

function getFileSha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function binaryMatchesTargetCache(target) {
  const cachePath = getCachePath(target);
  const binaryPath = getBinaryPath();
  if (!existsSync(cachePath) || !existsSync(binaryPath)) {
    return true;
  }

  return getFileSha256(cachePath) === getFileSha256(binaryPath);
}

function readActiveTarget() {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeActiveTarget(target) {
  mkdirSync(cacheRoot, { recursive: true });
  writeFileSync(
    statePath,
    JSON.stringify(
      {
        target,
        version: getTargetVersion(target),
        abi: getTargetAbi(target),
        platform: process.platform,
        arch: process.arch,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    )
  );
}

function isTargetAlreadyActive(target) {
  const active = readActiveTarget();
  if (!active) {
    return false;
  }

  return (
    active.target === target &&
    active.version === getTargetVersion(target) &&
    active.abi === getTargetAbi(target) &&
    active.platform === process.platform &&
    active.arch === process.arch &&
    existsSync(getBinaryPath()) &&
    binaryMatchesTargetCache(target)
  );
}

function copyCachedBinaryIntoPlace(target) {
  const cachePath = getCachePath(target);
  if (!existsSync(cachePath)) {
    return false;
  }

  mkdirSync(path.dirname(getBinaryPath()), { recursive: true });

  try {
    copyFileSync(cachePath, getBinaryPath());
  } catch (error) {
    throw wrapLockedBinaryError(target, error);
  }

  writeActiveTarget(target);
  return true;
}

function cachePreparedBinary(target) {
  mkdirSync(cacheRoot, { recursive: true });
  copyFileSync(getBinaryPath(), getCachePath(target));
  writeActiveTarget(target);
}

function wrapLockedBinaryError(target, error) {
  if (!error || typeof error !== 'object') {
    return error;
  }

  const code = 'code' in error ? String(error.code) : null;
  if (code !== 'EBUSY' && code !== 'EPERM') {
    return error;
  }

  return new Error(
    [
      `Failed to prepare better-sqlite3 for ${target} because ${binaryFileName} is locked.`,
      'Close running Vicode/Electron instances and any Node processes currently using the workspace, then retry.'
    ].join(' ')
  );
}

function isLockedBinaryError(error) {
  if (!error) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  return message.includes(`${binaryFileName} is locked`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRetryNumber(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function prepareBetterSqlite3(target) {
  if (target !== 'node' && target !== 'electron') {
    throw new Error(`Unsupported target "${target}". Expected "node" or "electron".`);
  }

  if (isTargetAlreadyActive(target)) {
    return;
  }

  if (copyCachedBinaryIntoPlace(target)) {
    return;
  }

  const cliPath = getPrebuildInstallCli();
  const args =
    target === 'electron'
      ? ['-r', 'electron', '-t', getElectronVersion(), '--verbose']
      : ['-r', 'node', '-t', getNodeVersion(), '--verbose'];
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: getBetterSqliteDir(),
    stdio: 'inherit',
    env: process.env
  });

  if (result.status !== 0) {
    throw new Error(`Failed to prepare better-sqlite3 for ${target}.`);
  }

  if (!existsSync(getBinaryPath())) {
    throw new Error(`Prepared better-sqlite3 for ${target}, but ${binaryFileName} was not found afterward.`);
  }

  try {
    cachePreparedBinary(target);
  } catch (error) {
    throw wrapLockedBinaryError(target, error);
  }
}

export async function prepareBetterSqlite3WithRetry(
  target,
  {
    attempts = defaultRetryAttempts,
    delayMs = defaultRetryDelayMs
  } = {}
) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      prepareBetterSqlite3(target);
      return;
    } catch (error) {
      lastError = error;
      if (!isLockedBinaryError(error) || attempt === attempts - 1) {
        throw error;
      }
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Failed to prepare better-sqlite3 for ${target}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await prepareBetterSqlite3WithRetry(process.argv[2] ?? 'node', {
      attempts: readRetryNumber(process.env.BETTER_SQLITE3_PREPARE_RETRY_ATTEMPTS, defaultRetryAttempts),
      delayMs: readRetryNumber(process.env.BETTER_SQLITE3_PREPARE_RETRY_DELAY_MS, defaultRetryDelayMs)
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
