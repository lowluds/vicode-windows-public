import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outputDir = path.join(root, '.tmp', 'public-source-mirror');
const publicRepoName = process.env.VICODE_PUBLIC_SOURCE_REPO ?? 'lowluds/vicode-windows-public';
const publicRepoUrl = `https://github.com/${publicRepoName}`;
const publicRepoGitUrl = `${publicRepoUrl}.git`;
const publicDocs = new Set([
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'docs/releases/0.2.6.md',
  'docs/releases/0.2.6-reviewer-guide.md',
  'docs/releases/beta-tester-quick-start.md',
  'docs/setup/windows-provider-setup.md'
]);
const excludedPrefixes = [
  '.vicode/',
  'docs/agent-system/',
  'docs/collaboration/',
  'docs/engineering/',
  'out/',
  'playwright-report/',
  'release/',
  'test-results/',
  'tools/upstream/'
];
const excludedExactPaths = new Set([
  '.gitattributes',
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'HEARTBEAT.md',
  'vicode-windows-0.2.1.tgz'
]);

function normalizePath(value) {
  return value.replace(/\\/gu, '/');
}

function ensureParentDir(targetPath) {
  mkdirSync(path.dirname(targetPath), { recursive: true });
}

function shouldInclude(relativePath) {
  const normalized = normalizePath(relativePath);
  if (excludedExactPaths.has(normalized)) {
    return false;
  }
  if (excludedPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }
  if (normalized === 'docs' || normalized.startsWith('docs/')) {
    return publicDocs.has(normalized);
  }
  return true;
}

function patchPackageJson(targetPath) {
  if (!existsSync(targetPath)) {
    return;
  }

  const parsed = JSON.parse(readFileSync(targetPath, 'utf8'));
  parsed.repository = {
    type: 'git',
    url: publicRepoGitUrl
  };
  parsed.homepage = publicRepoUrl;
  parsed.bugs = {
    url: `${publicRepoUrl}/issues`
  };
  writeFileSync(targetPath, `${JSON.stringify(parsed, null, 2)}\n`);
}

function writeMirrorManifest(targetPath, fileCount) {
  writeFileSync(
    targetPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceRoot: root,
        publicRepo: publicRepoUrl,
        fileCount
      },
      null,
      2
    )}\n`
  );
}

function main() {
  const sourceFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
    .split('\0')
    .filter(Boolean)
    .map(normalizePath)
    .filter(shouldInclude);

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  for (const relativePath of sourceFiles) {
    const sourcePath = path.join(root, relativePath);
    if (!existsSync(sourcePath)) {
      continue;
    }
    const targetPath = path.join(outputDir, relativePath);
    ensureParentDir(targetPath);
    copyFileSync(sourcePath, targetPath);
  }

  patchPackageJson(path.join(outputDir, 'package.json'));
  writeMirrorManifest(path.join(outputDir, 'PUBLIC_SOURCE_MIRROR.json'), sourceFiles.length);

  console.log(
    JSON.stringify(
      {
        outputDir: normalizePath(path.relative(root, outputDir)),
        publicRepo: publicRepoUrl,
        copiedFiles: sourceFiles.length,
        publicDocs: [...publicDocs]
      },
      null,
      2
    )
  );
}

main();
