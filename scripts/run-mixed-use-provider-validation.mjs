import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const providerOrder = ['openai', 'gemini', 'ollama'];

const providerConfig = {
  openai: {
    label: 'OpenAI',
    model: 'gpt-5.4',
    packetId: 'openai-mixed-use-gpt-5.4',
    testLabel: 'OpenAI completes the same-thread complex-project benchmark'
  },
  gemini: {
    label: 'Gemini',
    model: 'gemini-3.1-pro-preview',
    packetId: 'gemini-mixed-use-gemini-3.1-pro-preview',
    testLabel: 'Gemini completes the same-thread complex-project benchmark'
  },
  ollama: {
    label: 'Hosted Ollama',
    model: 'qwen3-coder-next',
    packetId: 'ollama-mixed-use-qwen3-coder-next',
    testLabel: 'Hosted Ollama completes the same-thread complex-project benchmark'
  }
};

function parseArg(name) {
  const prefix = `--${name}=`;
  const entry = process.argv.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

function parseCsvArg(name) {
  const value = parseArg(name);
  if (!value) {
    return null;
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

function getPacketPaths(root, dateStamp, providerId) {
  const config = providerConfig[providerId];
  const runDir = path.join(root, 'docs', 'engineering', 'validation-runs', dateStamp, config.packetId);
  const timelinePath = path.join(runDir, 'timeline.md');
  const observationsPath = path.join(runDir, 'observations.md');
  const scorecardPath = path.join(runDir, 'scorecard.md');
  const skipReasonPath = path.join(runDir, 'skip-reason.txt');
  const runnerLogPath = path.join(root, 'docs', 'engineering', 'validation-runs', dateStamp, 'runner-log.md');

  return { runDir, timelinePath, observationsPath, scorecardPath, skipReasonPath, runnerLogPath };
}

async function packetBatchExists(root, dateStamp, providers) {
  const checks = providers.flatMap((providerId) => {
    const config = providerConfig[providerId];
    return [
      path.join(root, 'docs', 'engineering', 'validation-runs', dateStamp, config.packetId, 'brief.md'),
      path.join(root, 'docs', 'engineering', 'validation-runs', dateStamp, config.packetId, 'timeline.md')
    ];
  });
  checks.push(path.join(root, 'docs', 'engineering', 'validation-runs', dateStamp, 'comparison-memo.md'));

  try {
    await Promise.all(checks.map((filePath) => access(filePath)));
    return true;
  } catch {
    return false;
  }
}

async function appendTimelineLine(filePath, line) {
  await appendFile(filePath, `${line}\n`, 'utf8');
}

async function ensureObservationPlaceholder(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    if (content.includes('## Runner Notes')) {
      return;
    }
    await appendFile(
      filePath,
      ['',
       '## Runner Notes',
       '- Automated benchmark execution completed.',
       '- Capture thread diagnostics export manually after the run and record the export path here.'
      ].join('\n'),
      'utf8'
    );
  } catch {
    await writeFile(
      filePath,
      [
        '# Observations',
        '',
        '## Runner Notes',
        '- Automated benchmark execution completed.',
        '- Capture thread diagnostics export manually after the run and record the export path here.'
      ].join('\n'),
      'utf8'
    );
  }
}

async function ensureScorecardPlaceholder(filePath, providerId) {
  try {
    await readFile(filePath, 'utf8');
  } catch {
    await writeFile(
      filePath,
      [
        `# ${providerConfig[providerId].label} Scorecard`,
        '',
        '- Status: pending human scoring',
        '- Benchmark run: automated',
        '- Diagnostics export: pending manual capture'
      ].join('\n'),
      'utf8'
    );
  }
}

async function appendRunnerNote(filePath, providerId, exitCode, noteSuffix = '') {
  const line = `- ${formatTimestamp()}: ${providerConfig[providerId].label} benchmark command exited with code ${exitCode}.${noteSuffix}`;
  await appendFile(filePath, `${line}\n`, 'utf8');
}

async function ensureRunnerLog(filePath) {
  try {
    await access(filePath);
  } catch {
    await writeFile(
      filePath,
      [
        '# Mixed-Use Runner Log',
        '',
        'This file is for automated runner execution notes only.',
        'Keep the provider comparison narrative in `comparison-memo.md`.'
      ].join('\n'),
      'utf8'
    );
  }
}

async function spawnCommand(command, args, cwd, dryRun, extraEnv = {}) {
  if (dryRun) {
    console.log(JSON.stringify({ command, args, cwd, env: extraEnv }, null, 2));
    return 0;
  }

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

async function main() {
  const root = process.cwd();
  const dateStamp = parseArg('date') ?? getDateStamp();
  const workspace = parseArg('workspace') ?? root;
  const providers = parseCsvArg('providers') ?? providerOrder;
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');

  for (const providerId of providers) {
    if (!providerConfig[providerId]) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
  }

  const batchReady = force ? false : await packetBatchExists(root, dateStamp, providers);
  if (!batchReady) {
    const initArgs = ['scripts/init-mixed-use-validation-batch.mjs', '--date', dateStamp, '--workspace', workspace];
    if (force) {
      initArgs.push('--force');
    }
    const initExitCode = await spawnCommand(process.execPath, initArgs, root, dryRun);
    if (initExitCode !== 0) {
      throw new Error(`Mixed-use validation packet initialization failed with exit code ${initExitCode}.`);
    }
  }

  for (const providerId of providers) {
    const { runDir, timelinePath, observationsPath, scorecardPath, skipReasonPath, runnerLogPath } = getPacketPaths(root, dateStamp, providerId);
    if (!dryRun) {
      await mkdir(runDir, { recursive: true });
      await ensureObservationPlaceholder(observationsPath);
      await ensureScorecardPlaceholder(scorecardPath, providerId);
      await ensureRunnerLog(runnerLogPath);
    }

    const testLabel = providerConfig[providerId].testLabel;
    const commandArgs = ['playwright', 'test', 'e2e/live-provider.spec.ts', '--grep', testLabel];
    const displayCommand = `npx ${commandArgs.join(' ')}`;
    const diagnosticsPath = path.join(path.dirname(timelinePath), 'thread-diagnostics.json');
    const extraEnv = {
      VICODE_MIXED_USE_PACKET_DIR: path.dirname(timelinePath),
      VICODE_MIXED_USE_PROVIDER: providerId,
      ...(providerId === 'ollama' &&
      !process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE &&
      !process.env.VICODE_OLLAMA_API_KEY &&
      !process.env.OLLAMA_API_KEY
        ? { VICODE_LIVE_OLLAMA_USE_DURABLE_STATE: '1' }
        : {})
    };

    if (!dryRun) {
      await appendTimelineLine(timelinePath, `- ${formatTimestamp()}: scheduled benchmark run \`${displayCommand}\``);
    }
    const exitCode = await spawnCommand(
      process.platform === 'win32' ? 'cmd.exe' : 'npx',
      process.platform === 'win32' ? ['/d', '/s', '/c', 'npx', ...commandArgs] : commandArgs,
      root,
      dryRun,
      extraEnv
    );

    let skipReason = null;
    if (!dryRun) {
      try {
        skipReason = (await readFile(skipReasonPath, 'utf8')).trim() || null;
      } catch {
        skipReason = null;
      }
    }

    if (!dryRun && exitCode === 0 && !skipReason) {
      try {
        await access(diagnosticsPath);
      } catch {
        throw new Error(
          `${providerConfig[providerId].label} mixed-use benchmark did not produce ${diagnosticsPath}. The run may have been skipped or the diagnostics export failed.`
        );
      }
    }

    if (!dryRun) {
      await appendTimelineLine(
        timelinePath,
        `- ${formatTimestamp()}: benchmark run finished with exit code ${exitCode}. Expected diagnostics artifact: ${diagnosticsPath}`
      );
      if (skipReason) {
        await appendTimelineLine(timelinePath, `- ${formatTimestamp()}: skip reason recorded: ${skipReason}`);
        await appendRunnerNote(
          runnerLogPath,
          providerId,
          exitCode,
          ` Skip recorded in packet: ${skipReason}`
        );
      } else {
        await appendRunnerNote(
          runnerLogPath,
          providerId,
          exitCode,
          ' Thread diagnostics should now exist in the provider packet when the run reached thread export.'
        );
      }
    }

    if (exitCode !== 0) {
      throw new Error(`${providerConfig[providerId].label} mixed-use benchmark failed with exit code ${exitCode}.`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
