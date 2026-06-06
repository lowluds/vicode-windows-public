#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { hydrateLiveProviderEnv } from './live-provider-env.mjs';

const DEFAULT_OPENAI_TEST_MODEL = 'gpt-5.4-nano';
const reportDir = path.join(process.cwd(), 'test-results', 'normalized-provider-validation');
const reportPath = path.join(reportDir, 'last-run.json');
const playwrightCli = path.join(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js');
const vitestCli = path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');

const suites = [
  {
    id: 'openai_compatible_chat',
    lane: 'OpenAI-compatible chat',
    name: 'OpenAI-compatible normalized live tests',
    transportKind: 'openai_compatible_chat',
    requiredAnyEnv: ['VICODE_OPENAI_COMPATIBLE_API_KEY'],
    requiredAllEnv: ['VICODE_OPENAI_COMPATIBLE_BASE_URL'],
    command: process.execPath,
    args: [
      vitestCli,
      'run',
      'src/main/services/provider-model-evaluation-harness.test.ts',
      '-t',
      'certifies an OpenAI-compatible custom provider through a live tool-call loop'
    ]
  }
];

let failed = false;
const results = [];

hydrateLiveProviderEnv();

function writeReport() {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      openaiCompatibleTestModel: process.env.VICODE_OPENAI_COMPATIBLE_MODEL || DEFAULT_OPENAI_TEST_MODEL,
      suites: results
    }, null, 2)}\n`,
    'utf8'
  );
}

for (const suite of suites) {
  const startedAt = Date.now();
  const hasRequiredEnv = suite.requiredAnyEnv.some((key) => Boolean(process.env[key]));
  const missingRequiredAllEnv = (suite.requiredAllEnv ?? []).filter((key) => !process.env[key]);
  if (!hasRequiredEnv || missingRequiredAllEnv.length > 0) {
    const result = {
      id: suite.id,
      lane: suite.lane,
      transportKind: suite.transportKind,
      status: 'skipped',
      reason: [
        !hasRequiredEnv ? `missing one of ${suite.requiredAnyEnv.join(', ')}` : null,
        missingRequiredAllEnv.length > 0 ? `missing ${missingRequiredAllEnv.join(', ')}` : null
      ].filter(Boolean).join('; '),
      requiredAnyEnv: suite.requiredAnyEnv,
      requiredAllEnv: suite.requiredAllEnv ?? [],
      durationMs: 0
    };
    results.push(result);
    console.log(`[skip] ${suite.lane} (${suite.transportKind}): ${result.reason}`);
    continue;
  }

  console.log(`[run] ${suite.lane} (${suite.transportKind})`);
  const result = spawnSync(suite.command, suite.args, {
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      VICODE_OPENAI_COMPATIBLE_MODEL:
        process.env.VICODE_OPENAI_COMPATIBLE_MODEL || DEFAULT_OPENAI_TEST_MODEL
    }
  });
  const durationMs = Date.now() - startedAt;

  if (result.status !== 0) {
    failed = true;
    results.push({
      id: suite.id,
      lane: suite.lane,
      transportKind: suite.transportKind,
      status: 'failed',
      exitCode: result.status,
      signal: result.signal,
      requiredAnyEnv: suite.requiredAnyEnv,
      requiredAllEnv: suite.requiredAllEnv ?? [],
      durationMs
    });
    console.log(`[fail] ${suite.lane} (${suite.transportKind}) exited with ${result.status ?? result.signal}`);
  } else {
    results.push({
      id: suite.id,
      lane: suite.lane,
      transportKind: suite.transportKind,
      status: 'passed',
      exitCode: result.status,
      requiredAnyEnv: suite.requiredAnyEnv,
      requiredAllEnv: suite.requiredAllEnv ?? [],
      durationMs
    });
    console.log(`[pass] ${suite.lane} (${suite.transportKind})`);
  }
}

writeReport();
console.log(`[report] ${path.relative(process.cwd(), reportPath)}`);

if (failed) {
  process.exit(1);
}
