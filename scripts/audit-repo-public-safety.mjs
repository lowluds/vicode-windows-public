import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function normalizeTarget(target) {
  return target.replace(/\\/gu, '/');
}

function listMarkdownFiles(relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  try {
    return readdirSync(absoluteDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => normalizeTarget(path.join(relativeDir, entry.name)))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

const canonicalTargets = [
  'AGENTS.md',
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'HEARTBEAT.md',
  'docs/engineering/README.md',
  'docs/engineering/public-beta-verification-goal-0.2.8.md',
  'docs/engineering/public-launch-checklist.md',
  'docs/engineering/release-gates.md',
  'docs/engineering/release-program.md',
  'docs/engineering/windows-release-runbook.md',
  ...listMarkdownFiles('docs/releases'),
  'docs/setup/windows-provider-setup.md',
  'src/main/AGENTS.md',
  'src/renderer/AGENTS.md',
  'src/storage/AGENTS.md'
];
const requiredExportIgnoreEntries = [
  '.vicode/control/ export-ignore',
  'docs/engineering/agent-evaluation-execution-board.md export-ignore',
  'docs/engineering/agent-team-roster.md export-ignore',
  'docs/engineering/autonomous-launcher-prompt.md export-ignore',
  'docs/engineering/autonomous-release-operator.md export-ignore',
  'docs/engineering/autonomous-team-brief.md export-ignore',
  'docs/engineering/codex-reference-execution-board.md export-ignore',
  'docs/engineering/memory-validation-runs/ export-ignore',
  'docs/engineering/reference-captures/ export-ignore',
  'docs/engineering/runtime-autonomy-execution-board.md export-ignore',
  'docs/engineering/validation-runs/ export-ignore',
  'docs/engineering/WORKLOG.md export-ignore'
];
const forbiddenPublicPaths = [
  '.vicode/control/evidence',
  '.vicode/control/runs'
];

const localPathPatterns = [
  /[A-Za-z]:\\Users\\[^\\\r\n]+/gu,
  /[A-Za-z]:\/Users\/[^/\r\n]+/gu,
  /\/Users\/[^/\r\n]+/gu,
  /\/home\/[^/\r\n]+/gu,
  /[A-Za-z]:\\DEV\\[^\r\n]*/gu,
  /[A-Za-z]:\/DEV\/[^\r\n]*/gu,
  /AppData\\Roaming\\npm\\[^\s`)<>\]]+/gu,
  /AppData\/Roaming\/npm\/[^\s`)<>\]]+/gu
];

function scanFile(relativePath, findings) {
  const absolutePath = path.join(root, relativePath);
  let stats;
  try {
    stats = statSync(absolutePath);
  } catch {
    return;
  }
  if (!stats.isFile()) {
    return;
  }

  const content = readFileSync(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/gu);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const pattern of localPathPatterns) {
      const matches = line.match(pattern);
      if (!matches) {
        continue;
      }
      for (const match of matches) {
        findings.push(`${normalizeTarget(relativePath)}:${index + 1}: ${match}`);
      }
    }
  }
}

function scanForbiddenArtifactDirs(findings, exportIgnoreLines) {
  for (const relativePath of forbiddenPublicPaths) {
    const absolutePath = path.join(root, relativePath);
    try {
      if (statSync(absolutePath).isDirectory()) {
        findings.push(`${normalizeTarget(relativePath)} should not be present in a public repo snapshot`);
      }
    } catch {
      // missing is fine
    }
  }

  for (const parent of ['docs/engineering/memory-validation-runs', 'docs/engineering/validation-runs', 'docs/engineering/reference-captures']) {
    const normalizedParent = normalizeTarget(parent);
    if (exportIgnoreLines.has(`${normalizedParent}/ export-ignore`)) {
      continue;
    }

    const absoluteParent = path.join(root, parent);
    try {
      if (!statSync(absoluteParent).isDirectory()) {
        continue;
      }
      for (const entry of readdirSync(absoluteParent, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        if (/^\d{4}-\d{2}-\d{2}$/u.test(entry.name)) {
          findings.push(`${normalizeTarget(path.join(parent, entry.name))} should not be present in a public repo snapshot`);
        }
      }
    } catch {
      continue;
    }
  }
}

function getExportIgnoreLines(findings) {
  const gitattributesPath = path.join(root, '.gitattributes');
  let content = '';
  try {
    content = readFileSync(gitattributesPath, 'utf8');
  } catch {
    findings.push('.gitattributes is required for public-source snapshot exclusions');
    return new Set();
  }

  const lines = new Set(
    content
      .split(/\r?\n/gu)
      .map((line) => line.trim())
      .filter(Boolean)
  );

  for (const entry of requiredExportIgnoreEntries) {
    if (!lines.has(entry)) {
      findings.push(`.gitattributes is missing required export-ignore entry: ${entry}`);
    }
  }

  return lines;
}

function main() {
  const findings = [];
  const exportIgnoreLines = getExportIgnoreLines(findings);
  scanForbiddenArtifactDirs(findings, exportIgnoreLines);
  for (const target of canonicalTargets) {
    scanFile(target, findings);
  }

  if (findings.length > 0) {
    console.error('Public repo safety audit failed:');
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        auditedTargets: canonicalTargets.map(normalizeTarget),
        checkedFileCount: canonicalTargets.length,
        requiredExportIgnoreEntries: requiredExportIgnoreEntries.length,
        status: 'ok'
      },
      null,
      2
    )
  );
}

main();
