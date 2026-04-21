import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mirrorDir = path.join(root, '.tmp', 'public-source-mirror');
const forbiddenPaths = [
  '.vicode',
  'AGENTS.md',
  'HEARTBEAT.md',
  'docs/agent-system',
  'docs/collaboration',
  'docs/engineering'
];
const requiredPaths = [
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'docs/releases/0.2.1.md',
  'docs/releases/0.2.1-reviewer-guide.md',
  'docs/releases/beta-tester-quick-start.md',
  'docs/setup/windows-provider-setup.md',
  'package.json'
];
const textExtensions = new Set([
  '',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.yml',
  '.yaml'
]);

function normalizePath(value) {
  return value.replace(/\\/gu, '/');
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

function collectSensitiveTokens() {
  const tokens = new Set();
  const candidates = [
    process.env.USERPROFILE,
    process.env.HOME,
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
    root
  ];
  for (const candidate of candidates) {
    if (!candidate || candidate.trim().length < 4) {
      continue;
    }
    const normalized = normalizePath(candidate).toLowerCase();
    tokens.add(normalized);
    if (!normalized.endsWith('/')) {
      tokens.add(`${normalized}/`);
    }
  }
  return [...tokens];
}

function main() {
  try {
    execFileSync(process.execPath, ['scripts/build-public-source-mirror.mjs'], {
      cwd: root,
      stdio: 'pipe',
      encoding: 'utf8'
    });
  } catch (error) {
    if (typeof error.stdout === 'string' && error.stdout.trim()) {
      console.error(error.stdout.trimEnd());
    }
    if (typeof error.stderr === 'string' && error.stderr.trim()) {
      console.error(error.stderr.trimEnd());
    }
    throw error;
  }

  const findings = [];

  for (const requiredPath of requiredPaths) {
    if (!existsSync(path.join(mirrorDir, requiredPath))) {
      findings.push(`Missing required public mirror path: ${requiredPath}`);
    }
  }

  for (const forbiddenPath of forbiddenPaths) {
    if (existsSync(path.join(mirrorDir, forbiddenPath))) {
      findings.push(`Forbidden internal path present in public mirror: ${forbiddenPath}`);
    }
  }

  const sensitiveTokens = collectSensitiveTokens();
  const secretPatterns = [
    /sk-[A-Za-z0-9]{10,}/gu,
    /ghp_[A-Za-z0-9]{10,}/gu,
    /AKIA[0-9A-Z]{16}/gu,
    /AIza[0-9A-Za-z_-]{10,}/gu
  ];

  const files = walkFiles(mirrorDir);
  for (const filePath of files) {
    const extension = path.extname(filePath).toLowerCase();
    if (!textExtensions.has(extension)) {
      continue;
    }

    let content = '';
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const relativePath = normalizePath(path.relative(mirrorDir, filePath));
    const lines = content.split(/\r?\n/gu);
    for (let index = 0; index < lines.length; index += 1) {
      const normalizedLine = normalizePath(lines[index]).toLowerCase();
      const matchedSensitiveToken = sensitiveTokens.find((token) => normalizedLine.includes(token));
      if (matchedSensitiveToken) {
        findings.push(`${relativePath}:${index + 1}: contains local path token "${matchedSensitiveToken}"`);
      }
      for (const pattern of secretPatterns) {
        const matches = lines[index].match(pattern);
        if (!matches) {
          continue;
        }
        for (const match of matches) {
          findings.push(`${relativePath}:${index + 1}: contains secret-like token "${match}"`);
        }
      }
    }
  }

  const packageJsonPath = path.join(mirrorDir, 'package.json');
  if (existsSync(packageJsonPath)) {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    if (typeof parsed.repository?.url !== 'string' || !parsed.repository.url.includes('vicode-windows-public')) {
      findings.push('Mirrored package.json repository.url was not rewritten to the public mirror repo');
    }
  }

  if (findings.length > 0) {
    console.error('Public source mirror audit failed:');
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        mirrorDir: normalizePath(path.relative(root, mirrorDir)),
        scannedFiles: files.length,
        status: 'ok'
      },
      null,
      2
    )
  );
}

main();
