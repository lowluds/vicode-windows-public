import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const releaseDir = path.join(root, 'release');
const winUnpackedDir = path.join(releaseDir, 'win-unpacked');
const appAsarPath = path.join(winUnpackedDir, 'resources', 'app.asar');
const packagedBetterSqlitePath = path.join(
  winUnpackedDir,
  'resources',
  'app.asar.unpacked',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
);
const textExtensions = new Set([
  '.blockmap',
  '.css',
  '.html',
  '.js',
  '.json',
  '.log',
  '.map',
  '.md',
  '.txt',
  '.yaml',
  '.yml'
]);
const forbiddenReleaseFiles = ['builder-debug.yml', 'builder-effective-config.yaml'];
const packageMainEntry = `\\${String(packageJson.main ?? 'out/main/index.js').replace(/\//gu, '\\')}`;
const requiredAsarEntries = [packageMainEntry, '\\out\\preload\\index.cjs', '\\out\\renderer\\index.html'];
const forbiddenRootAsarPrefixes = [
  '\\.vicode\\',
  '\\docs\\',
  '\\e2e\\',
  '\\playwright-report\\',
  '\\src\\',
  '\\test-results\\',
  '\\test\\'
];
const forbiddenRootAsarFiles = [
  '\\AGENTS.md',
  '\\CONTRIBUTING.md',
  '\\HEARTBEAT.md',
  '\\README.md',
  '\\WORKLOG.md'
];

function normalizeForScan(value) {
  return value.trim().replace(/\//gu, '\\').toLowerCase();
}

function collectSensitivePathTokens() {
  const candidates = new Set([
    process.env.USERPROFILE,
    process.env.HOME,
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
    process.env.HOMEDRIVE && process.env.HOMEPATH ? `${process.env.HOMEDRIVE}${process.env.HOMEPATH}` : null,
    root,
    'D:\\DEV\\',
    'D:/DEV/'
  ]);
  const tokens = new Set();
  for (const candidate of candidates) {
    if (!candidate || candidate.trim().length < 4) {
      continue;
    }
    const normalized = normalizeForScan(candidate);
    tokens.add(normalized);
    if (!normalized.endsWith('\\')) {
      tokens.add(`${normalized}\\`);
    }
  }
  return [...tokens];
}

function walkFiles(targetPath, files = []) {
  if (!existsSync(targetPath)) {
    return files;
  }
  const stats = statSync(targetPath);
  if (!stats.isDirectory()) {
    files.push(targetPath);
    return files;
  }

  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    walkFiles(path.join(targetPath, entry.name), files);
  }
  return files;
}

function shouldScanFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return textExtensions.has(extension);
}

function getAsarEntries() {
  const asarCli = require.resolve('@electron/asar/bin/asar.js');
  return execFileSync(process.execPath, [asarCli, 'list', appAsarPath], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getFileSha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function getExpectedElectronBetterSqlitePath() {
  const electronVersion = JSON.parse(readFileSync(require.resolve('electron/package.json'), 'utf8')).version;
  return path.join(
    root,
    '.cache',
    'native-modules',
    'better-sqlite3',
    `electron-${electronVersion}-${process.platform}-${process.arch}.node`
  );
}

function main() {
  if (!existsSync(releaseDir)) {
    throw new Error('release/ was not found. Run "npm run dist:win" before auditing release artifacts.');
  }
  if (!existsSync(appAsarPath)) {
    throw new Error('Packaged app.asar was not found under release/win-unpacked/resources.');
  }

  const findings = [];

  for (const fileName of forbiddenReleaseFiles) {
    if (existsSync(path.join(releaseDir, fileName))) {
      findings.push(`Unexpected transient release file present: release/${fileName}`);
    }
  }

  const asarEntries = getAsarEntries();
  const asarEntriesLower = asarEntries.map((entry) => entry.toLowerCase());

  for (const requiredEntry of requiredAsarEntries) {
    if (!asarEntriesLower.includes(requiredEntry.toLowerCase())) {
      findings.push(`Packaged app is missing expected entry: ${requiredEntry}`);
    }
  }

  if (!existsSync(packagedBetterSqlitePath)) {
    findings.push(
      'Packaged app is missing resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
    );
  } else {
    const expectedElectronBetterSqlitePath = getExpectedElectronBetterSqlitePath();
    if (!existsSync(expectedElectronBetterSqlitePath)) {
      findings.push(
        `Expected Electron better-sqlite3 cache was not found: ${path.relative(root, expectedElectronBetterSqlitePath)}`
      );
    } else if (getFileSha256(packagedBetterSqlitePath) !== getFileSha256(expectedElectronBetterSqlitePath)) {
      findings.push(
        [
          'Packaged better_sqlite3.node does not match the prepared Electron-target binary.',
          `expected cache: ${path.relative(root, expectedElectronBetterSqlitePath)}`,
          'This usually means a Node ABI build was packaged into the desktop app.'
        ].join(' ')
      );
    }
  }

  for (const entry of asarEntries) {
    const normalizedEntry = entry.toLowerCase();
    const hasForbiddenPrefix = forbiddenRootAsarPrefixes.some((prefix) =>
      normalizedEntry.startsWith(prefix.toLowerCase())
    );
    const isForbiddenRootFile = forbiddenRootAsarFiles.some(
      (fileName) => normalizedEntry === fileName.toLowerCase()
    );
    if (hasForbiddenPrefix || isForbiddenRootFile) {
      findings.push(`Forbidden repo artifact shipped in app.asar: ${entry}`);
    }
  }

  const sensitiveTokens = collectSensitivePathTokens();
  const releaseFiles = walkFiles(releaseDir);
  for (const filePath of releaseFiles) {
    if (!shouldScanFile(filePath)) {
      continue;
    }

    let content;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/gu);
    for (let index = 0; index < lines.length; index += 1) {
      const normalizedLine = lines[index].toLowerCase();
      const matchedToken = sensitiveTokens.find((token) => normalizedLine.includes(token));
      if (!matchedToken) {
        continue;
      }
      findings.push(`${path.relative(root, filePath)}:${index + 1}: contains local path token "${matchedToken}"`);
      if (findings.length >= 50) {
        break;
      }
    }
    if (findings.length >= 50) {
      break;
    }
  }

  if (findings.length > 0) {
    console.error('Release artifact audit failed:');
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        auditedRelease: path.relative(root, releaseDir),
        scannedFiles: releaseFiles.filter((filePath) => shouldScanFile(filePath)).length,
        checkedAsarEntries: asarEntries.length,
        status: 'ok'
      },
      null,
      2
    )
  );
}

main();
