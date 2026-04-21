import fs from 'node:fs/promises';
import path from 'node:path';

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
  const runId = requireArg('--id');
  const provider = requireArg('--provider');
  const model = requireArg('--model');
  const scenario = getArg('--scenario') ?? 'mixed-use-provider-validation';
  const workspace = getArg('--workspace') ?? '';
  const thread = getArg('--thread') ?? '';
  const date = getArg('--date') ?? formatToday();
  const force = process.argv.includes('--force');

  const baseDir = path.resolve('docs', 'engineering', 'validation-runs', date, runId);
  const screensDir = path.join(baseDir, 'screens');
  await fs.mkdir(screensDir, { recursive: true });

  const canonicalPrompts = [
    {
      stage: 'Conversational baseline',
      prompt:
        'Summarize how this repo is organized and which areas are most relevant to provider runtime, diagnostics export, and transcript rendering. Do not edit anything.'
    },
    {
      stage: 'Read-only inspection',
      prompt:
        'Inspect the repo to verify your summary. Read files as needed, but do not edit anything. Tell me which files control provider continuity, diagnostics export, and mixed-use validation.'
    },
    {
      stage: 'Code-consideration turn',
      prompt:
        'Before editing, recommend the smallest high-value improvement to strengthen the mixed-use provider validation lane or runtime continuity in this repo. Explain the tradeoffs only and do not edit yet.'
    },
    {
      stage: 'Deterministic edit',
      prompt:
        'Implement the smallest docs-first improvement you recommended. Keep the diff narrow and edit only the relevant engineering docs or validation scripts.'
    },
    {
      stage: 'Skill-assisted or capability-assisted follow-up',
      prompt:
        'Refine the new validation docs or packet flow so the next operator run is harder to drift. Use a built-in skill only if it materially helps, and keep the change minimal.'
    },
    {
      stage: 'Verification command',
      prompt:
        'Run the smallest safe verification command needed for your change and report the result truthfully.'
    },
    {
      stage: 'Recovery and closeout',
      prompt:
        'If the verification exposed a problem, fix it. Otherwise summarize exactly what changed, which files changed, and any remaining risk or next step.'
    }
  ];

  const promptsBlock = canonicalPrompts
    .map(
      (entry, index) => `${index + 1}. ${entry.stage}\n${entry.prompt}`
    )
    .join('\n\n');

  const brief = `# ${runId}

## Run Metadata

- Date: ${date}
- Scenario: ${scenario}
- Provider: ${provider}
- Model: ${model}
- Workspace: ${workspace || '<fill me>'}
- Thread: ${thread || '<fill me>'}

## Canonical Stages

1. Conversational baseline
2. Read-only inspection
3. Code-consideration turn
4. Deterministic edit
5. Skill-assisted or capability-assisted follow-up
6. Verification command
7. Recovery and closeout

## Exact Prompts

\`\`\`text
${promptsBlock}
\`\`\`
`;

  const timeline = `# ${runId} timeline

## Observed Timeline

- \`t+0s\` prompt submitted:
- \`t+\` first visible response:
- \`t+\` first reasoning summary:
- \`t+\` first tool row:
- \`t+\` first command row:
- \`t+\` follow-up refinement:
- \`t+\` final assistant prose:
- \`t+\` final run state:

## Observable Event Order

1.
2.
3.
4.
5.
`;

  const observations = `# ${runId} observations

## Continuity Notes

- remembers earlier turns:
- remembers command output:
- loses context where:

## Transcript Notes

- reasoning visibility:
- tool grouping:
- command output treatment:
- narration restraint:
- raw leakage or malformed output:

## Recovery Notes

- after verification command:
- after any failure or partial result:

## Diagnostics

- exported diagnostics path:
- runtime trace highlights:
`;

  const scorecard = `# ${runId} scorecard

| Dimension | Rating | Notes |
| --- | --- | --- |
| Thread continuity | <pass/mixed/fail> | |
| Transcript quality | <pass/mixed/fail> | |
| Reasoning visibility | <pass/mixed/fail> | |
| Workspace correctness | <pass/mixed/fail> | |
| Capability routing | <pass/mixed/fail> | |
| Command handling | <pass/mixed/fail> | |
| Recovery quality | <pass/mixed/fail> | |
| Failure truth | <pass/mixed/fail> | |
| Final response quality | <pass/mixed/fail> | |
| Narration restraint | <pass/mixed/fail> | |

## Overall

- overall result:
- strongest behavior:
- weakest behavior:
- next suggested engineering slice:
`;

  const transcript = `# ${runId} transcript

\`\`\`text
<fill me when a copyable transcript is available>
\`\`\`
`;

  await ensureTemplateFile(path.join(baseDir, 'brief.md'), brief, { force });
  await ensureTemplateFile(path.join(baseDir, 'timeline.md'), timeline, { force, preserveExisting: true });
  await ensureTemplateFile(path.join(baseDir, 'observations.md'), observations, { force, preserveExisting: true });
  await ensureTemplateFile(path.join(baseDir, 'scorecard.md'), scorecard, { force, preserveExisting: true });
  await ensureTemplateFile(path.join(baseDir, 'transcript.md'), transcript, { force, preserveExisting: true });

  process.stdout.write(`${baseDir}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
