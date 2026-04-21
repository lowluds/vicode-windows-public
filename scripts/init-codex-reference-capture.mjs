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

async function ensureMissing(filePath, content, force) {
  if (!force) {
    try {
      await fs.access(filePath);
      throw new Error(`Refusing to overwrite existing file: ${filePath}. Re-run with --force to replace it.`);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('Refusing')) {
        // File does not exist; continue.
      } else {
        throw error;
      }
    }
  }
  await fs.writeFile(filePath, content, 'utf8');
}

async function main() {
  const runId = requireArg('--id');
  const runFamily = getArg('--family') ?? runId;
  const prompt = getArg('--prompt') ?? '';
  const workspace = getArg('--workspace') ?? '';
  const thread = getArg('--thread') ?? '';
  const date = getArg('--date') ?? formatToday();
  const force = process.argv.includes('--force');

  const baseDir = path.resolve('docs', 'engineering', 'reference-captures', date, runId);
  const screensDir = path.join(baseDir, 'screens');
  await fs.mkdir(screensDir, { recursive: true });

  const brief = `# ${runId}

## Run Metadata

- Date: ${date}
- Run id: ${runId}
- Run family: ${runFamily}
- Workspace: ${workspace || '<fill me>'}
- Thread: ${thread || '<fill me>'}
- Prompt:

\`\`\`text
${prompt || '<fill me>'}
\`\`\`

## Expected Surface

- Expected reasoning summaries:
- Expected tool activity:
- Expected command activity:
- Expected approvals:
- Expected final state:
`;

  const timeline = `# ${runId} timeline

## Observed Timeline

- \`t+0s\` user prompt submitted:
- \`t+\` first visible response:
- \`t+\` first reasoning summary:
- \`t+\` first tool row:
- \`t+\` first command row:
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

## Visible Wording

- Reasoning labels:
- Tool labels:
- Command labels:
- Approval labels:
- Failure or stop labels:

## Transcript Shape Notes

- grouping:
- spacing:
- collapse behavior:
- redundancy suppression:
- transition from work-log to prose:

## Comparison Notes Against Vicode

- what Codex did better:
- what Vicode already matches:
- what Vicode should copy:
- what Vicode should intentionally not copy:

## Saved Artifacts

- recording path:
- screenshot path:
- transcript copy path:
- additional notes:
`;

  await ensureMissing(path.join(baseDir, 'brief.md'), brief, force);
  await ensureMissing(path.join(baseDir, 'timeline.md'), timeline, force);
  await ensureMissing(path.join(baseDir, 'observations.md'), observations, force);

  process.stdout.write(`${baseDir}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
