import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const builtInSkillsPath = path.join(root, 'src', 'shared', 'builtInSkills.ts');
const scenariosPath = path.join(root, 'docs', 'engineering', 'skill-command-scenarios.md');

const removedBuiltInIds = [
  'built-in-planner',
  'built-in-pdf-toolkit',
  'built-in-spreadsheet-analyst',
  'built-in-doc-writer',
  'built-in-slide-writer'
];

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function parseBuiltInNames(source) {
  const names = [];
  for (const match of source.matchAll(/id:\s*'built-in-[^']+'[\s\S]*?name:\s*'([^']+)'/gu)) {
    names.push(match[1]);
  }
  return names;
}

function parseBuiltInScenarioOutcomes(markdown) {
  const sectionStart = markdown.indexOf('## Built-In Skills');
  const nextSection = markdown.indexOf('## Provider-Native Runtime Skill Paths', sectionStart);
  if (sectionStart < 0 || nextSection < 0) {
    throw new Error('Could not locate the Built-In Skills section in skill-command-scenarios.md.');
  }

  const section = markdown.slice(sectionStart, nextSection);
  const outcomes = new Map();
  for (const line of section.split(/\r?\n/gu)) {
    if (!line.startsWith('| `')) {
      continue;
    }
    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean);
    const surface = cells[0]?.replace(/^`|`$/gu, '');
    const outcome = cells[4]?.replace(/^`|`$/gu, '');
    if (surface && outcome) {
      outcomes.set(surface, outcome);
    }
  }
  return outcomes;
}

function main() {
  const findings = [];
  const builtInSource = readText(builtInSkillsPath);
  const scenarios = readText(scenariosPath);
  const builtInNames = parseBuiltInNames(builtInSource);
  const scenarioOutcomes = parseBuiltInScenarioOutcomes(scenarios);

  if (builtInNames.length === 0) {
    findings.push('No built-in skill seeds were parsed from src/shared/builtInSkills.ts.');
  }

  for (const id of removedBuiltInIds) {
    if (builtInSource.includes(id)) {
      findings.push(`${id} is listed as removed for the current beta but still appears in builtInSkills.ts.`);
    }
  }

  for (const name of builtInNames) {
    const outcome = scenarioOutcomes.get(name);
    if (!outcome) {
      findings.push(`Built-in skill "${name}" is missing from docs/engineering/skill-command-scenarios.md.`);
      continue;
    }
    if (outcome !== 'keep') {
      findings.push(`Built-in skill "${name}" has release outcome "${outcome}", expected "keep".`);
    }
  }

  for (const [name, outcome] of scenarioOutcomes) {
    if (outcome === 'fix' || outcome === 'experimental' || outcome === 'remove') {
      findings.push(`Built-in skill scenario "${name}" still has release outcome "${outcome}".`);
    }
  }

  if (findings.length > 0) {
    console.error('Skill release readiness audit failed:');
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        checkedBuiltInSkills: builtInNames.length,
        checkedScenarioRows: scenarioOutcomes.size,
        removedBuiltInIds
      },
      null,
      2
    )
  );
}

main();
