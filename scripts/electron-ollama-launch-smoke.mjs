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

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out waiting for Electron configure-only launch after ${timeoutMs}ms.`));
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

async function main() {
  ensureBuilt('Ollama launch smoke');
  await prepareBetterSqlite3WithRetry('electron');

  const isolatedStateRoot = mkdtempSync(path.join(tmpdir(), 'vicode-ollama-launch-smoke-'));
  const isolatedUserDataPath = path.join(isolatedStateRoot, 'user-data');
  const isolatedSessionDataPath = path.join(isolatedStateRoot, 'session-data');
  const profilePath = path.join(isolatedStateRoot, 'ollama-launch-profile.json');
  mkdirSync(isolatedUserDataPath, { recursive: true });
  mkdirSync(isolatedSessionDataPath, { recursive: true });
  writeFileSync(
    profilePath,
    `${JSON.stringify({
      version: 1,
      source: 'ollama-launch',
      providerId: 'ollama',
      modelId: 'qwen2.5-coder:7b',
      modelSource: 'local',
      transportMode: 'responses',
      configureOnly: true
    }, null, 2)}\n`,
    'utf8'
  );

  try {
    const child = spawn(electronBinary, ['.', '--ollama-launch-profile', profilePath], {
      cwd: root,
      env: {
        ...process.env,
        VICODE_USER_DATA_PATH: isolatedUserDataPath,
        VICODE_SESSION_DATA_PATH: isolatedSessionDataPath
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    const exit = await waitForExit(child, 30_000);
    if (exit.code !== 0) {
      throw new Error(`Electron configure-only launch exited with code ${exit.code ?? 'null'} signal ${exit.signal ?? 'null'}.\n${stderr}`);
    }

    const stateDir = path.join(isolatedUserDataPath, 'state');
    const databasePath = path.join(stateDir, 'vicode.sqlite');
    const markerPath = path.join(stateDir, 'ollama-launch', 'active-profile.json');
    if (!existsSync(databasePath)) {
      throw new Error('Configure-only launch did not create the Vicode database.');
    }
    if (!existsSync(markerPath)) {
      throw new Error('Configure-only launch did not write the Ollama launch marker.');
    }

    await prepareBetterSqlite3WithRetry('node');
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(databasePath, { readonly: true });
    const preferences = db
      .prepare('SELECT default_provider_id, default_model_ollama, ollama_transport_mode FROM preferences WHERE id = 1')
      .get();
    db.close();

    if (preferences.default_provider_id !== 'ollama') {
      throw new Error(`Expected default_provider_id=ollama, found ${preferences.default_provider_id}`);
    }
    if (preferences.default_model_ollama !== 'qwen2.5-coder:7b') {
      throw new Error(`Expected default_model_ollama=qwen2.5-coder:7b, found ${preferences.default_model_ollama}`);
    }
    if (preferences.ollama_transport_mode !== 'responses') {
      throw new Error(`Expected ollama_transport_mode=responses, found ${preferences.ollama_transport_mode}`);
    }

    const markerText = readFileSync(markerPath, 'utf8');
    if (/(api[_-]?key|authorization|bearer|token)/iu.test(markerText)) {
      throw new Error('Ollama launch marker contains credential-shaped text.');
    }

    console.log(JSON.stringify({
      status: 'ok',
      defaultProviderId: preferences.default_provider_id,
      defaultOllamaModel: preferences.default_model_ollama,
      ollamaTransportMode: preferences.ollama_transport_mode
    }, null, 2));
  } finally {
    rmSync(isolatedStateRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
