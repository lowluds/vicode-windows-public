import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function requireArg(flag) {
  const value = getArg(flag);
  if (!value) {
    throw new Error(`Missing required argument: ${flag}`);
  }
  return value;
}

function formatToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function runNodeScript(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: 'inherit',
      shell: false
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Initializer exited with code ${code ?? -1}.`));
    });
  });
}

async function ensureTemplateFile(filePath, content, { force, preserveExisting = true }) {
  try {
    await fs.access(filePath);
    if (preserveExisting) {
      return;
    }

    if (!force) {
      throw new Error(`Refusing to overwrite existing file: ${filePath}. Re-run with --force to replace it.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Refusing')) {
      throw error;
    }
  }

  await fs.writeFile(filePath, content, 'utf8');
}

async function main() {
  const date = getArg('--date') ?? formatToday();
  const workspace = requireArg('--workspace');
  const force = process.argv.includes('--force');

  const runs = [
    { id: 'openai-mixed-use-gpt-5.4', provider: 'openai', model: 'gpt-5.4' },
    { id: 'gemini-mixed-use-gemini-2.5-pro', provider: 'gemini', model: 'gemini-2.5-pro' },
    { id: 'ollama-mixed-use-qwen3-coder-next', provider: 'ollama', model: 'qwen3-coder-next' }
  ];

  for (const run of runs) {
    await runNodeScript([
      path.resolve('scripts', 'init-mixed-use-validation-run.mjs'),
      '--id',
      run.id,
      '--provider',
      run.provider,
      '--model',
      run.model,
      '--date',
      date,
      '--workspace',
      workspace,
      ...(force ? ['--force'] : [])
    ]);
  }

  const comparisonDir = path.resolve('docs', 'engineering', 'validation-runs', date);
  await fs.mkdir(comparisonDir, { recursive: true });
  const comparisonMemo = `# ${date} mixed-use provider comparison

## Scope

- Scenario: [mixed-use-provider-validation.md](<repo-root>/docs/engineering/mixed-use-provider-validation.md)
- Workspace: ${workspace}
- Providers:
  - OpenAI / gpt-5.4
  - Gemini / gemini-2.5-pro
  - Ollama / qwen3-coder-next

## Summary Table

| Provider | Continuity | Transcript quality | Reasoning visibility | Command handling | Recovery quality | Overall |
| --- | --- | --- | --- | --- | --- | --- |
| OpenAI | <pass/mixed/fail> | <pass/mixed/fail> | <pass/mixed/fail> | <pass/mixed/fail> | <pass/mixed/fail> | <pass/mixed/fail> |
| Gemini | <pass/mixed/fail> | <pass/mixed/fail> | <pass/mixed/fail> | <pass/mixed/fail> | <pass/mixed/fail> | <pass/mixed/fail> |
| Ollama | <pass/mixed/fail> | <pass/mixed/fail> | <pass/mixed/fail> | <pass/mixed/fail> | <pass/mixed/fail> | <pass/mixed/fail> |

## Comparative Notes

### OpenAI

- strongest behavior:
- weakest behavior:
- evidence packet:

### Gemini

- strongest behavior:
- weakest behavior:
- evidence packet:

### Ollama

- strongest behavior:
- weakest behavior:
- evidence packet:

## Cross-Provider Findings

- best transcript behavior:
- weakest continuity behavior:
- weakest recovery behavior:
- biggest parity gap against Codex-like expectations:

## Next Engineering Slice

- target:
- likely files:
- confidence:
`;

  await ensureTemplateFile(path.join(comparisonDir, 'comparison-memo.md'), comparisonMemo, {
    force,
    preserveExisting: true
  });
  process.stdout.write(`${comparisonDir}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
