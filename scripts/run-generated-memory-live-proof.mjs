import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

function parseArg(name) {
  const prefix = `--${name}=`;
  const entry = process.argv.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

function getDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

async function spawnCommand(command, args, cwd, extraEnv = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...extraEnv
      },
      stdio: 'inherit',
      shell: false
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function ensureRunnerLog(filePath) {
  try {
    await access(filePath);
  } catch {
    await writeFile(
      filePath,
      [
        '# Generated-Memory Live Proof Runner Log',
        '',
        'This file is for automated live-proof execution notes only.'
      ].join('\n'),
      'utf8'
    );
  }
}

async function appendRunnerLog(filePath, line) {
  await appendFile(filePath, `${line}\n`, 'utf8');
}

function renderComparisonMemo(results) {
  const scenarioLines = results.scenarios.flatMap((scenario) => [
    `### ${scenario.id}`,
    `- Verdict: ${scenario.verdict}`,
    `- Baseline first substantive action: ${scenario.baseline.firstSubstantiveAction ?? 'none recorded'}`,
    `- Experimental first substantive action: ${scenario.experimental.firstSubstantiveAction ?? 'none recorded'}`,
    `- Baseline answer: ${scenario.baseline.answer || '<empty>'}`,
    `- Experimental answer: ${scenario.experimental.answer || '<empty>'}`,
    `- Experimental generated-memory items: ${scenario.experimental.generatedMemoryItems.length}`,
    `- Diagnostics:`,
    `  - baseline: ${scenario.baseline.diagnosticsCopyPath}`,
    `  - experimental: ${scenario.experimental.diagnosticsCopyPath}`,
    ''
  ]);

  return [
    '## Automated live proof summary',
    '',
    `- Executed at: ${results.executedAt}`,
    `- Provider: ${results.providerId}`,
    `- Model: ${results.modelId}`,
    `- Workspace: ${results.workspacePath}`,
    `- Improved scenarios: ${results.scenarios.filter((scenario) => scenario.verdict === 'improved').length}`,
    `- Flat scenarios: ${results.scenarios.filter((scenario) => scenario.verdict === 'flat').length}`,
    `- Regressed scenarios: ${results.scenarios.filter((scenario) => scenario.verdict === 'regressed').length}`,
    '',
    ...scenarioLines
  ].join('\n');
}

async function main() {
  const root = process.cwd();
  const dateStamp = parseArg('date') ?? getDateStamp();
  const workspace = parseArg('workspace') ?? root;
  const modelId = parseArg('model');
  const force = process.argv.includes('--force');

  const batchDir = path.join(root, 'docs', 'engineering', 'memory-validation-runs', dateStamp);
  const runnerLogPath = path.join(batchDir, 'runner-log.md');
  const comparisonMemoPath = path.join(batchDir, 'comparison-memo.md');

  const initArgs = ['scripts/init-generated-memory-eval-packet.mjs', '--date', dateStamp, '--workspace', workspace];
  if (force) {
    initArgs.push('--force');
  }
  const initExitCode = await spawnCommand(process.execPath, initArgs, root);
  if (initExitCode !== 0) {
    throw new Error(`Generated-memory packet initialization failed with exit code ${initExitCode}.`);
  }

  await mkdir(batchDir, { recursive: true });
  await ensureRunnerLog(runnerLogPath);

  const commandArgs = [
    'vitest',
    'run',
    'src/main/services/generated-memory-live-proof.test.ts',
    '--reporter=verbose'
  ];

  await appendRunnerLog(
    runnerLogPath,
    `- ${new Date().toISOString()}: scheduled live proof run \`npx ${commandArgs.join(' ')}\``
  );

  const exitCode = await spawnCommand(
    process.platform === 'win32' ? 'cmd.exe' : 'npx',
    process.platform === 'win32' ? ['/d', '/s', '/c', 'npx', ...commandArgs] : commandArgs,
    root,
    {
      VICODE_RUN_GENERATED_MEMORY_LIVE_PROOF: '1',
      VICODE_GENERATED_MEMORY_BATCH_DIR: batchDir,
      ...(modelId ? { VICODE_GENERATED_MEMORY_LIVE_MODEL: modelId } : {})
    }
  );

  const skipReasonPath = path.join(batchDir, 'skip-reason.txt');
  const resultsPath = path.join(batchDir, 'live-proof-results.json');

  let skipReason = null;
  try {
    skipReason = (await readFile(skipReasonPath, 'utf8')).trim() || null;
  } catch {}

  if (skipReason) {
    await appendRunnerLog(
      runnerLogPath,
      `- ${new Date().toISOString()}: live proof skipped: ${skipReason}`
    );
    return;
  }

  if (exitCode !== 0) {
    await appendRunnerLog(
      runnerLogPath,
      `- ${new Date().toISOString()}: live proof command exited with code ${exitCode}.`
    );
    throw new Error(`Generated-memory live proof failed with exit code ${exitCode}.`);
  }

  const results = JSON.parse(await readFile(resultsPath, 'utf8'));
  await appendFile(
    comparisonMemoPath,
    `\n\n${renderComparisonMemo(results)}\n`,
    'utf8'
  );
  await appendRunnerLog(
    runnerLogPath,
    `- ${new Date().toISOString()}: live proof completed successfully and wrote ${resultsPath}.`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
