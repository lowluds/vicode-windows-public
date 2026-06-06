import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const casesPath = join(repoRoot, 'test', 'fixtures', 'project-knowledge-router', 'cases.json');
const advancedCasesPath = join(repoRoot, 'test', 'fixtures', 'project-knowledge-router', 'advanced-cases.json');
const experimentCasesPath = join(repoRoot, 'test', 'fixtures', 'project-knowledge-router', 'experiment-cases.json');
const tempDir = mkdtempSync(join(tmpdir(), 'vicode-pk-router-eval-'));

function normalizeFixtureFileContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (content && typeof content === 'object') {
    const prefix = Array.isArray(content.prefixLines) ? content.prefixLines.join('\n') : '';
    const repeated = typeof content.repeatText === 'string'
      ? content.repeatText.repeat(Number.isInteger(content.repeatCount) ? content.repeatCount : 1)
      : '';
    const suffix = Array.isArray(content.suffixLines) ? content.suffixLines.join('\n') : '';
    return [prefix, repeated, suffix].filter(Boolean).join('\n');
  }
  throw new Error('Unsupported Project Knowledge eval fixture file content.');
}

function writeKnowledgeRoot(files) {
  const rootPath = mkdtempSync(join(tempDir, 'knowledge-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(rootPath, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, normalizeFixtureFileContent(content), 'utf8');
  }
  return rootPath;
}

function sourceImportPath(relativePath) {
  return join(repoRoot, relativePath).replace(/\\/g, '/');
}

async function loadRouterModules() {
  const { build } = await import('esbuild');
  const entryPath = join(tempDir, 'project-knowledge-router-entry.ts');
  const outfile = join(tempDir, 'project-knowledge-router-bundle.mjs');
  writeFileSync(
    entryPath,
    [
      `export { ProjectKnowledgeRouter } from ${JSON.stringify(sourceImportPath('src/main/services/project-knowledge-router.ts'))};`,
      `export { ProjectKnowledgeService } from ${JSON.stringify(sourceImportPath('src/main/services/project-knowledge.ts'))};`
    ].join('\n'),
    'utf8'
  );
  await build({
    entryPoints: [entryPath],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent'
  });
  return import(pathToFileURL(outfile).href);
}

function loadEvalCases() {
  return [
    ...JSON.parse(readFileSync(casesPath, 'utf8')),
    ...JSON.parse(readFileSync(advancedCasesPath, 'utf8')),
    ...JSON.parse(readFileSync(experimentCasesPath, 'utf8'))
  ];
}

function formatBlock(block) {
  if (!block) {
    return 'none';
  }
  const heading = block.heading ? ` > ${block.heading}` : '';
  return `${block.title} (${block.relativePath}${heading})`;
}

function assertCase(testCase, result) {
  const failures = [];
  const blocks = result.blocks;
  const firstBlock = blocks[0] ?? null;
  const selectedPaths = blocks.map((block) => block.relativePath);
  const totalContentChars = blocks.reduce((total, block) => total + block.content.length, 0);

  if ('expectedFirstTitle' in testCase) {
    const actualFirstTitle = firstBlock?.title ?? null;
    const expectedFirstTitle = testCase.expectedFirstTitle ?? null;
    if (actualFirstTitle !== expectedFirstTitle) {
      failures.push(`first title ${actualFirstTitle ?? 'none'} != ${expectedFirstTitle ?? 'none'}`);
    }
  }
  if ('expectedFirstRelativePath' in testCase) {
    const actualFirstRelativePath = firstBlock?.relativePath ?? null;
    const expectedFirstRelativePath = testCase.expectedFirstRelativePath ?? null;
    if (actualFirstRelativePath !== expectedFirstRelativePath) {
      failures.push(`first relative path ${actualFirstRelativePath ?? 'none'} != ${expectedFirstRelativePath ?? 'none'}`);
    }
  }
  if ('expectedFirstHeading' in testCase) {
    const actualFirstHeading = firstBlock?.heading ?? null;
    const expectedFirstHeading = testCase.expectedFirstHeading ?? null;
    if (actualFirstHeading !== expectedFirstHeading) {
      failures.push(`first heading ${actualFirstHeading ?? 'none'} != ${expectedFirstHeading ?? 'none'}`);
    }
  }
  if (Array.isArray(testCase.expectedTitles)) {
    const actualTitles = blocks.map((block) => block.title);
    if (JSON.stringify(actualTitles) !== JSON.stringify(testCase.expectedTitles)) {
      failures.push(`titles ${JSON.stringify(actualTitles)} != ${JSON.stringify(testCase.expectedTitles)}`);
    }
  }
  for (const expectedPath of testCase.expectedRelativePaths ?? []) {
    if (!selectedPaths.includes(expectedPath)) {
      failures.push(`missing selected path ${expectedPath}`);
    }
  }
  for (const excludedPath of testCase.expectedExcludedRelativePaths ?? []) {
    if (selectedPaths.includes(excludedPath)) {
      failures.push(`unexpected selected path ${excludedPath}`);
    }
  }
  if (Number.isInteger(testCase.expectedBlockCount) && blocks.length !== testCase.expectedBlockCount) {
    failures.push(`block count ${blocks.length} != ${testCase.expectedBlockCount}`);
  }
  if (Number.isInteger(testCase.maxTotalContentChars) && totalContentChars > testCase.maxTotalContentChars) {
    failures.push(`total content chars ${totalContentChars} > ${testCase.maxTotalContentChars}`);
  }
  if (Array.isArray(testCase.relevantRelativePaths) && testCase.relevantRelativePaths.length > 0) {
    const relevant = new Set(testCase.relevantRelativePaths);
    const relevantHits = selectedPaths.filter((path) => relevant.has(path)).length;
    const precisionAtK = blocks.length === 0 ? 0 : relevantHits / blocks.length;
    const recall = relevantHits / relevant.size;
    if (typeof testCase.minPrecisionAtK === 'number' && precisionAtK < testCase.minPrecisionAtK) {
      failures.push(`precision@${blocks.length} ${precisionAtK.toFixed(2)} < ${testCase.minPrecisionAtK}`);
    }
    if (typeof testCase.minRecall === 'number' && recall < testCase.minRecall) {
      failures.push(`recall ${recall.toFixed(2)} < ${testCase.minRecall}`);
    }
  }
  for (const expectedText of testCase.expectedContentContains ?? []) {
    if (!blocks.some((block) => block.content.includes(expectedText))) {
      failures.push(`missing content ${JSON.stringify(expectedText)}`);
    }
  }
  for (const unexpectedText of testCase.expectedContentExcludes ?? []) {
    if (blocks.some((block) => block.content.includes(unexpectedText))) {
      failures.push(`unexpected content ${JSON.stringify(unexpectedText)}`);
    }
  }

  return failures;
}

function caseMetrics(testCase, result) {
  const blocks = result.blocks;
  const selectedPaths = blocks.map((block) => block.relativePath);
  const relevant = Array.isArray(testCase.relevantRelativePaths) && testCase.relevantRelativePaths.length > 0
    ? new Set(testCase.relevantRelativePaths)
    : null;
  const relevantHits = relevant ? selectedPaths.filter((path) => relevant.has(path)).length : null;
  const precisionAtK = relevant && blocks.length > 0 ? relevantHits / blocks.length : null;
  const recall = relevant ? relevantHits / relevant.size : null;
  return {
    totalContentChars: blocks.reduce((total, block) => total + block.content.length, 0),
    selectedCount: blocks.length,
    precisionAtK,
    recall
  };
}

try {
  const cases = loadEvalCases();
  const { ProjectKnowledgeRouter, ProjectKnowledgeService } = await loadRouterModules();
  let failures = 0;
  const metrics = [];

  for (const testCase of cases) {
    const rootPath = writeKnowledgeRoot(testCase.files);
    const router = new ProjectKnowledgeRouter(new ProjectKnowledgeService());
    const result = router.retrieve({
      rootPath,
      prompt: testCase.prompt,
      task: testCase.task,
      maxResults: testCase.maxResults ?? 3
    });
    const caseFailures = assertCase(testCase, result);
    const currentMetrics = caseMetrics(testCase, result);
    metrics.push(currentMetrics);
    const actualLabel = formatBlock(result.blocks[0] ?? null);

    if (caseFailures.length === 0) {
      const precision = currentMetrics.precisionAtK === null ? 'n/a' : currentMetrics.precisionAtK.toFixed(2);
      const recall = currentMetrics.recall === null ? 'n/a' : currentMetrics.recall.toFixed(2);
      console.log(`PASS ${testCase.name} -> ${actualLabel} | blocks=${currentMetrics.selectedCount} chars=${currentMetrics.totalContentChars} precision=${precision} recall=${recall}`);
    } else {
      failures += 1;
      console.error(`FAIL ${testCase.name} -> ${actualLabel} (${caseFailures.join('; ')})`);
    }
  }

  const passed = cases.length - failures;
  const measured = metrics.filter((item) => item.precisionAtK !== null && item.recall !== null);
  const averagePrecision = measured.length > 0
    ? measured.reduce((total, item) => total + item.precisionAtK, 0) / measured.length
    : null;
  const averageRecall = measured.length > 0
    ? measured.reduce((total, item) => total + item.recall, 0) / measured.length
    : null;
  const averageChars = metrics.length > 0
    ? Math.round(metrics.reduce((total, item) => total + item.totalContentChars, 0) / metrics.length)
    : 0;
  const maxChars = metrics.reduce((max, item) => Math.max(max, item.totalContentChars), 0);
  console.log(`Project Knowledge router eval: ${passed}/${cases.length} passed`);
  console.log(`Project Knowledge router metrics: measured=${measured.length}, avgPrecision=${averagePrecision === null ? 'n/a' : averagePrecision.toFixed(2)}, avgRecall=${averageRecall === null ? 'n/a' : averageRecall.toFixed(2)}, avgChars=${averageChars}, maxChars=${maxChars}`);
  if (failures > 0) {
    process.exitCode = 1;
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
