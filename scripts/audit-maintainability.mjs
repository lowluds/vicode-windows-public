import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = process.cwd();
const strict = process.argv.includes('--strict');
const sourceRoot = resolve(root, 'src');
const supportedExtensions = new Set(['.ts', '.tsx']);

const thresholds = {
  renderer: { target: 300, review: 450, split: 600 },
  process: { target: 450, review: 650, split: 800 },
  test: { target: 450, review: 650, split: 1200 }
};

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'out' || entry.name === 'dist' || entry.name === 'release' || entry.name === 'node_modules') {
      continue;
    }

    const nextPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(nextPath, files);
      continue;
    }

    if ([...supportedExtensions].some((extension) => entry.name.endsWith(extension))) {
      files.push(nextPath);
    }
  }

  return files;
}

function classifyFile(absolutePath) {
  const normalized = absolutePath.replace(/\\/gu, '/');
  const rel = relative(root, absolutePath).replace(/\\/gu, '/');
  const isTest = /\.test\.tsx?$/u.test(normalized);

  if (isTest) {
    return { category: 'test', threshold: thresholds.test, rel };
  }

  if (normalized.includes('/src/renderer/')) {
    return { category: 'renderer', threshold: thresholds.renderer, rel };
  }

  return { category: 'process', threshold: thresholds.process, rel };
}

function countLines(absolutePath) {
  const content = readFileSync(absolutePath, 'utf8');
  return content.split(/\r?\n/u).length;
}

function deriveStatus(lines, threshold) {
  if (lines > 1000) {
    return 'exception';
  }
  if (lines > threshold.split) {
    return 'split';
  }
  if (lines > threshold.review) {
    return 'review';
  }
  return 'ok';
}

const files = walk(sourceRoot).map((absolutePath) => {
  const classification = classifyFile(absolutePath);
  const lines = countLines(absolutePath);
  return {
    ...classification,
    absolutePath,
    lines,
    sizeKb: Math.round((statSync(absolutePath).size / 1024) * 10) / 10,
    status: deriveStatus(lines, classification.threshold)
  };
});

const flagged = files
  .filter((entry) => entry.status !== 'ok')
  .sort((left, right) => right.lines - left.lines);

const summary = {
  exception: flagged.filter((entry) => entry.status === 'exception').length,
  split: flagged.filter((entry) => entry.status === 'split').length,
  review: flagged.filter((entry) => entry.status === 'review').length
};

console.log('Maintainability audit');
console.log(`Workspace: ${root}`);
console.log(`Flagged files: ${flagged.length} (exception: ${summary.exception}, split: ${summary.split}, review: ${summary.review})`);
console.log('');

if (flagged.length === 0) {
  console.log('No files exceed the review thresholds.');
  process.exit(0);
}

for (const entry of flagged.slice(0, 25)) {
  const threshold = entry.threshold;
  const guidance =
    entry.status === 'exception'
      ? `over 1000 lines; requires a WORKLOG exception record plus an extraction plan`
      : entry.status === 'split'
        ? `over split threshold (${threshold.split} lines)`
        : `over review threshold (${threshold.review} lines)`;
  console.log(
    `- [${entry.status.toUpperCase()}] ${entry.rel} :: ${entry.lines} lines, ${entry.sizeKb.toFixed(1)} KB, ${entry.category} category, ${guidance}`
  );
}

if (flagged.length > 25) {
  console.log(`- ... ${flagged.length - 25} additional flagged files omitted`);
}

if (strict && flagged.some((entry) => entry.status === 'exception' || entry.status === 'split')) {
  process.exit(1);
}
