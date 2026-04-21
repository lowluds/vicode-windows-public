import { spawn } from 'node:child_process';

const providerLabels = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  ollama: 'Hosted Ollama'
};

const benchmarkLabels = {
  'marketing-site': 'marketing-site benchmark scaffold',
  dashboard: 'dashboard benchmark scaffold',
  'crud-app': 'crud-app benchmark',
  'docs-site': 'docs-site benchmark',
  'auth-app': 'auth-app benchmark',
  'existing-project-refinement': 'existing-project-refinement benchmark',
  'bugfix-slice': 'bugfix-slice benchmark',
  'same-thread-complex-project': 'same-thread complex-project benchmark'
};

const providerBenchmarkRequirements = {
  openai: Object.keys(benchmarkLabels),
  gemini: Object.keys(benchmarkLabels),
  ollama: ['marketing-site', 'dashboard', 'crud-app', 'docs-site', 'existing-project-refinement', 'bugfix-slice']
};

function parseCsvFlag(argv, name) {
  const prefix = `--${name}=`;
  const value = argv.find((entry) => entry.startsWith(prefix));
  if (!value) {
    return null;
  }

  return value
    .slice(prefix.length)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildGrep(providerIds, benchmarkIds) {
  const labels = [];

  for (const providerId of providerIds) {
    const providerLabel = providerLabels[providerId];
    if (!providerLabel) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    const allowedBenchmarks = providerBenchmarkRequirements[providerId];
    if (!allowedBenchmarks) {
      throw new Error(`Missing benchmark requirements for provider: ${providerId}`);
    }

    for (const benchmarkId of benchmarkIds) {
      const benchmarkLabel = benchmarkLabels[benchmarkId];
      if (!benchmarkLabel) {
        throw new Error(`Unknown benchmark: ${benchmarkId}`);
      }
      if (!allowedBenchmarks.includes(benchmarkId)) {
        continue;
      }
      labels.push(`${providerLabel} completes the ${benchmarkLabel}`);
    }
  }

  if (labels.length === 0) {
    throw new Error('No matching provider benchmark combinations were selected.');
  }

  return labels.join('|');
}

async function main() {
  const providers = parseCsvFlag(process.argv.slice(2), 'providers') ?? Object.keys(providerLabels);
  const benchmarks = parseCsvFlag(process.argv.slice(2), 'benchmarks') ?? Object.keys(benchmarkLabels);
  const dryRun = process.argv.includes('--dry-run');
  const grep = buildGrep(providers, benchmarks);
  const args = ['playwright', 'test', 'e2e/live-provider.spec.ts', '--grep', grep];

  if (dryRun) {
    console.log(JSON.stringify({ command: 'npx', args }, null, 2));
    return;
  }

  await new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'cmd.exe' : 'npx',
      process.platform === 'win32' ? ['/d', '/s', '/c', 'npx', ...args] : args,
      {
      stdio: 'inherit',
      shell: false
      }
    );

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Live benchmark command exited with code ${code ?? -1}.`));
    });
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
