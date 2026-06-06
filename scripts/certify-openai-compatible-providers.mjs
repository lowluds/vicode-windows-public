#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_MODEL = 'gpt-5.4-nano';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const reportDir = path.join(process.cwd(), 'test-results', 'openai-compatible-provider-certification');
const reportPath = path.join(reportDir, 'last-run.json');
const vitestCli = path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');

function parseArgs(argv) {
  const parsed = {
    baseUrl: process.env.VICODE_OPENAI_COMPATIBLE_BASE_URL || DEFAULT_BASE_URL,
    keyFile: process.env.VICODE_PROVIDER_KEY_FILE || '',
    model: process.env.VICODE_OPENAI_COMPATIBLE_MODEL || DEFAULT_MODEL,
    providerName: process.env.VICODE_OPENAI_COMPATIBLE_PROVIDER_NAME || 'OpenAI-compatible testing',
    allowEnvKey: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };

    if (arg === '--base-url') {
      parsed.baseUrl = readValue();
    } else if (arg === '--key-file') {
      parsed.keyFile = readValue();
    } else if (arg === '--model') {
      parsed.model = readValue();
    } else if (arg === '--provider-name') {
      parsed.providerName = readValue();
    } else if (arg === '--allow-env-key') {
      parsed.allowEnvKey = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function usage() {
  return [
    'Usage: node scripts/certify-openai-compatible-providers.mjs [options]',
    '',
    'Options:',
    '  --key-file <path>       Explicit local operator file containing the testing API key.',
    '  --base-url <url>        OpenAI-compatible /v1 base URL. Defaults to https://api.openai.com/v1.',
    `  --model <model>         Model to certify. Defaults to ${DEFAULT_MODEL}.`,
    '  --provider-name <name>  Redacted report label for the selected provider.',
    '  --allow-env-key         Use an existing API key environment variable instead of --key-file.'
  ].join('\n');
}

function extractKeyFromText(text) {
  const envMatch = text.match(/(?:^|\n)\s*(?:VICODE_OPENAI_COMPATIBLE_API_KEY|VICODE_OPENAI_API_KEY|OPENAI_API_KEY)\s*=\s*([^\s#]+)/i);
  if (envMatch?.[1]) {
    return envMatch[1].trim();
  }

  const namedMatch = text.match(/(?:openapi|openai)[^\n=:\r]*(?:api|key)\s*[:=]\s*([^\s]+)/i);
  if (namedMatch?.[1]) {
    return namedMatch[1].trim();
  }

  const rawKeyMatch = text.match(/\bsk-[A-Za-z0-9_-]{20,}\b/);
  return rawKeyMatch?.[0]?.trim() ?? '';
}

function resolveApiKey(keyFile, options = {}) {
  const envKey = process.env.VICODE_OPENAI_COMPATIBLE_API_KEY || process.env.VICODE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (options.allowEnvKey && envKey?.trim()) {
    return {
      apiKey: envKey.trim(),
      source: 'environment',
      keyFile: null
    };
  }

  if (!keyFile) {
    throw new Error('Set --key-file <path>, VICODE_PROVIDER_KEY_FILE, or --allow-env-key for certification.');
  }

  if (!fs.existsSync(keyFile)) {
    throw new Error(`Operator key file not found: ${keyFile}`);
  }

  const apiKey = extractKeyFromText(fs.readFileSync(keyFile, 'utf8'));
  if (!apiKey) {
    throw new Error(`No OpenAI-compatible testing API key found in operator key file: ${keyFile}`);
  }

  return {
    apiKey,
    source: 'operator_key_file',
    keyFile
  };
}

function runSuite(suite, env) {
  const startedAt = Date.now();
  console.log(`[run] ${suite.name}`);
  const result = spawnSync(process.execPath, suite.args, {
    env,
    shell: false,
    stdio: 'inherit'
  });
  const durationMs = Date.now() - startedAt;
  const passed = result.status === 0;
  console.log(`[${passed ? 'pass' : 'fail'}] ${suite.name}`);
  return {
    id: suite.id,
    name: suite.name,
    status: passed ? 'passed' : 'failed',
    exitCode: result.status,
    signal: result.signal,
    durationMs,
    proves: suite.proves
  };
}

function writeReport(report) {
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(usage());
  process.exit(0);
}

const credential = resolveApiKey(options.keyFile, { allowEnvKey: options.allowEnvKey });
const env = {
  ...process.env,
  VICODE_OPENAI_COMPATIBLE_API_KEY: credential.apiKey,
  VICODE_OPENAI_COMPATIBLE_BASE_URL: options.baseUrl,
  VICODE_OPENAI_COMPATIBLE_MODEL: options.model
};

const suites = [
  {
    id: 'fake_openai_compatible_tool_loop',
    name: 'Fake OpenAI-compatible saved-provider tool loop',
    args: [
      vitestCli,
      'run',
      'src/main/services/provider-model-evaluation-harness.test.ts',
      '-t',
      'certifies a saved OpenAI-compatible custom provider through the fake tool-call loop'
    ],
    proves: [
      'saved custom provider resolves to the OpenAI-compatible transport',
      'tool calls are parsed from provider output',
      'app-owned tool results are returned to the model in OpenAI-compatible chat format'
    ]
  },
  {
    id: 'live_openai_compatible_tool_loop',
    name: 'Live OpenAI-compatible custom-provider tool loop',
    args: [
      vitestCli,
      'run',
      'src/main/services/provider-model-evaluation-harness.test.ts',
      '-t',
      'certifies an OpenAI-compatible custom provider through a live tool-call loop'
    ],
    proves: [
      'operator key is mapped into runtime env without committing or echoing it',
      'selected OpenAI-compatible base URL and model complete a real tool-call loop',
      'live model output reaches terminal completion after app-owned tool execution'
    ]
  }
];

console.log(`[config] provider=${options.providerName}`);
console.log(`[config] baseUrl=${options.baseUrl}`);
console.log(`[config] model=${options.model}`);
console.log(`[config] keySource=${credential.source}`);

const results = suites.map((suite) => runSuite(suite, env));
const failed = results.some((result) => result.status !== 'passed');
const report = {
  generatedAt: new Date().toISOString(),
  status: failed ? 'failed' : 'passed',
  provider: {
    name: options.providerName,
    transportKind: 'openai_compatible_chat',
    baseUrl: options.baseUrl,
    model: options.model,
    keySource: credential.source,
    keyFile: credential.keyFile ? '<operator-key-file>' : null,
    keyMaterialStoredInReport: false
  },
  suites: results
};

writeReport(report);
console.log(`[report] ${path.relative(process.cwd(), reportPath)}`);

if (failed) {
  process.exit(1);
}
