#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const binDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(binDir, '..');
const mainEntry = resolve(appRoot, 'out', 'main', 'index.js');

if (!existsSync(mainEntry)) {
  console.error('Vicode is not built yet. Reinstall the package or run `npm run build` in the app package first.');
  process.exit(1);
}

const child = spawn(electronBinary, [appRoot, ...process.argv.slice(2)], {
  cwd: appRoot,
  stdio: 'inherit',
  windowsHide: false
});

child.on('error', (error) => {
  console.error(`Failed to launch Vicode: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
