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
  const workspace = requireArg('--workspace');
  const date = getArg('--date') ?? formatToday();
  const thread = getArg('--thread') ?? '';
  const fixtureSet = getArg('--fixture-set') ?? 'codex-memory-v1';
  const force = process.argv.includes('--force');

  const modes = [
    {
      id: 'baseline-generated-memory-off',
      label: 'Baseline',
      generate: false,
      use: false,
      purpose: 'Canonical workspace memory only.'
    },
    {
      id: 'shadow-generated-memory-generate-only',
      label: 'Shadow',
      generate: true,
      use: false,
      purpose: 'Generate candidates and artifacts without injecting derived recall.'
    },
    {
      id: 'experimental-generated-memory-on',
      label: 'Experimental',
      generate: true,
      use: true,
      purpose: 'Compare canonical workspace memory plus generated-memory recall against baseline.'
    }
  ];

  const dateDir = path.resolve('docs', 'engineering', 'memory-validation-runs', date);
  await fs.mkdir(dateDir, { recursive: true });

  for (const mode of modes) {
    const baseDir = path.join(dateDir, mode.id);
    const screensDir = path.join(baseDir, 'screens');
    await fs.mkdir(screensDir, { recursive: true });

    const brief = `# ${mode.id}

## Run Metadata

- Date: ${date}
- Mode: ${mode.label}
- Workspace: ${workspace}
- Thread: ${thread || '<fill me>'}
- Fixture set: ${fixtureSet}
- Generated-memory generate: ${String(mode.generate)}
- Generated-memory use: ${String(mode.use)}
- Purpose: ${mode.purpose}

## Active Fixtures

- Positive: A1, A2, A3, A4
- Negative: N1, N2, N3

## Source Basis

- [codex-memory-evaluation-verification-brief-2026-04-20.md](<repo-root>/docs/engineering/codex-memory-evaluation-verification-brief-2026-04-20.md)
- [codex-memory-eval-fixture-pack-2026-04-20.md](<repo-root>/docs/engineering/codex-memory-eval-fixture-pack-2026-04-20.md)
- [codex-memory-targeted-test-plan-2026-04-20.md](<repo-root>/docs/engineering/codex-memory-targeted-test-plan-2026-04-20.md)

## Commands

\`\`\`text
<fill me>
\`\`\`
`;

    const timeline = `# ${mode.id} timeline

## Observed Timeline

- \`t+0s\` evaluation started:
- \`t+\` first visible recall signal:
- \`t+\` first substantive action:
- \`t+\` trace inspected:
- \`t+\` scorecard updated:
- \`t+\` final comparison note:

## Fixture Order

1. A1
2. A2
3. A3
4. A4
5. N1
6. N2
7. N3
`;

    const observations = `# ${mode.id} observations

## Recall Quality

- helpful recall:
- weak or missing recall:
- noisy recall:

## Scope Safety

- wrong-workspace evidence:
- canonical conflict evidence:
- low-value residue evidence:

## Human Review Notes

- explanation clarity:
- source-of-truth clarity:
- user-visible value:

## Per-Fixture Notes

- A1:
- A2:
- A3:
- A4:
- N1:
- N2:
- N3:
`;

    const scorecard = `# ${mode.id} scorecard

${mode.id === 'shadow-generated-memory-generate-only'
  ? '> Shadow-mode note: use `n/a` for recall or action-improvement cells when recall is intentionally disabled. Use the notes column to judge candidate quality, artifact precision, and scope safety.\n\n'
  : ''}| Fixture | Recall correctness | Action usefulness | Scope safety | Source-of-truth discipline | Result notes |
| --- | --- | --- | --- | --- | --- |
| A1 | <0/1/2/n-a> | <0/1/2/n-a> | <0/1/2> | <0/1/2> | |
| A2 | <0/1/2/n-a> | <0/1/2/n-a> | <0/1/2> | <0/1/2> | |
| A3 | <0/1/2/n-a> | <0/1/2/n-a> | <0/1/2> | <0/1/2> | |
| A4 | <0/1/2/n-a> | <0/1/2/n-a> | <0/1/2> | <0/1/2> | |
| N1 | <0/1/2/n-a> | <0/1/2/n-a> | <0/1/2> | <0/1/2> | |
| N2 | <0/1/2/n-a> | <0/1/2/n-a> | <0/1/2> | <0/1/2> | |
| N3 | <0/1/2/n-a> | <0/1/2/n-a> | <0/1/2> | <0/1/2> | |

## Summary

- total score:
- strongest fixture:
- weakest fixture:
- go / no-go:
`;

    const traceSummary = `# ${mode.id} trace summary

## Required Trace Fields

- workspaceScopeKey:
- canonicalMemoryUsed:
- generatedMemoryEnabled:
- generatedMemoryUsed:
- generatedMemoryItemIds:
- generatedMemorySourceThreadIds:
- firstSubstantiveAction:
- repeatSteeringCount:

## Trace Review Notes

- Did generated memory change the first substantive action?
- Did generated memory reduce repeated steering?
- Did any wrong-workspace or stale memory appear?
`;

    await ensureTemplateFile(path.join(baseDir, 'brief.md'), brief, { force });
    await ensureTemplateFile(path.join(baseDir, 'timeline.md'), timeline, { force, preserveExisting: true });
    await ensureTemplateFile(path.join(baseDir, 'observations.md'), observations, { force, preserveExisting: true });
    await ensureTemplateFile(path.join(baseDir, 'scorecard.md'), scorecard, { force, preserveExisting: true });
    await ensureTemplateFile(path.join(baseDir, 'trace-summary.md'), traceSummary, { force, preserveExisting: true });
  }

  const comparisonMemo = `# ${date} generated-memory comparison

## Scope

- Fixture set: ${fixtureSet}
- Workspace: ${workspace}
- Modes:
  - baseline-generated-memory-off
  - shadow-generated-memory-generate-only
  - experimental-generated-memory-on

## Summary Table

| Mode | Positive fixtures | Negative controls | First substantive action | Overall |
| --- | --- | --- | --- | --- |
| Baseline | <pass/mixed/fail> | <pass/mixed/fail> | <improved/flat/regressed> | <pass/mixed/fail> |
| Shadow | <pass/mixed/fail> | <pass/mixed/fail> | <improved/flat/regressed> | <pass/mixed/fail> |
| Experimental | <pass/mixed/fail> | <pass/mixed/fail> | <improved/flat/regressed> | <pass/mixed/fail> |

## Comparative Notes

### Baseline

- strongest behavior:
- weakest behavior:
- evidence packet:

### Shadow

- strongest behavior:
- weakest behavior:
- evidence packet:

### Experimental

- strongest behavior:
- weakest behavior:
- evidence packet:

## Cross-Mode Findings

- clearest positive gain:
- clearest negative-control risk:
- trace field that best explained the result:
- should generated-memory recall stay default-off:

## Next Engineering Slice

- target:
- likely files:
- confidence:
`;

  const runnerLog = `# Generated-Memory Runner Log

This file is for automated or manual execution notes only.
Keep the human comparison narrative in \`comparison-memo.md\`.
`;

  await ensureTemplateFile(path.join(dateDir, 'comparison-memo.md'), comparisonMemo, {
    force,
    preserveExisting: true
  });
  await ensureTemplateFile(path.join(dateDir, 'runner-log.md'), runnerLog, {
    force,
    preserveExisting: true
  });

  process.stdout.write(`${dateDir}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
