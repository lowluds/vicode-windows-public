import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceEntries = ['package.json', 'electron.vite.config.ts', 'src', 'e2e'];
const outputEntries = ['out'];

function getBuildCommand() {
  if (process.platform === 'win32') {
    return {
      file: process.env.ComSpec || process.env.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm run build']
    };
  }

  return { file: 'npm', args: ['run', 'build'] };
}

function newestMtime(targetPath) {
  if (!existsSync(targetPath)) {
    return 0;
  }

  const stats = statSync(targetPath);
  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }

  let latest = stats.mtimeMs;
  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.tmp' || entry.name === 'out') {
      continue;
    }

    latest = Math.max(latest, newestMtime(path.join(targetPath, entry.name)));
  }

  return latest;
}

function resolveNewest(entries) {
  return entries.reduce((latest, entry) => Math.max(latest, newestMtime(path.join(root, entry))), 0);
}

export function needsBuild() {
  const newestSourceMtime = resolveNewest(sourceEntries);
  const newestOutputMtime = resolveNewest(outputEntries);
  return newestOutputMtime === 0 || newestSourceMtime > newestOutputMtime;
}

export function ensureBuilt(reason = 'test run') {
  if (!needsBuild()) {
    return;
  }

  console.log(`[ensure-built] Rebuilding app before ${reason}`);
  const command = getBuildCommand();
  execFileSync(command.file, command.args, {
    cwd: root,
    stdio: 'inherit'
  });
}
