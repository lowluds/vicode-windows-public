#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const files = {
  registry: read('src/main/services/provider-model-transport-registry.ts'),
  capabilityProfiles: read('src/main/services/provider-model-capability-profile.ts'),
  evaluationHarness: read('src/main/services/provider-model-evaluation-harness.test.ts'),
  liveValidation: read('scripts/run-normalized-provider-validation.mjs'),
  graduationMatrix: read('docs/engineering/provider-graduation-matrix.md')
};

const lanes = [
  {
    label: 'Ollama local responses',
    transportKind: 'ollama_responses',
    capabilityProfile: 'OLLAMA_RESPONSES_CAPABILITY_PROFILE',
    liveValidation: 'manual_local'
  },
  {
    label: 'Ollama local chat',
    transportKind: 'ollama_chat',
    capabilityProfile: 'OLLAMA_CHAT_CAPABILITY_PROFILE',
    liveValidation: 'manual_local'
  },
  {
    label: 'OpenAI-compatible chat',
    transportKind: 'openai_compatible_chat',
    capabilityProfile: 'OPENAI_COMPATIBLE_CHAT_CAPABILITY_PROFILE',
    liveValidation: 'runner'
  }
];

const requiredScenarioNeedles = [
  'completes text-only normalized run',
  'returns tool results to the model',
  'runs multi-turn tool-result loops',
  'returns tool errors to the model',
  'passes $decision command approval through the app runtime',
  'requires workspace mutation before completing',
  'requires verification after workspace mutation',
  'reports provider transport errors through normalized callbacks',
  'cancels normalized transport work without completing the run'
];

const findings = [];

function requireMatch(name, matched, detail) {
  if (!matched) {
    findings.push({ name, detail });
  }
}

for (const lane of lanes) {
  requireMatch(
    `${lane.transportKind}: registry resolution has app authority and capability profile`,
    new RegExp(
      `transportKind:\\s*'${lane.transportKind}'[\\s\\S]*?runtimeAuthority:\\s*APP_RUNTIME_MODEL_AUTHORITY[\\s\\S]*?capabilityProfile:\\s*${lane.capabilityProfile}`,
      'u'
    ).test(files.registry),
    'normalized registry branch must set transportKind, runtimeAuthority, and capabilityProfile together'
  );

  requireMatch(
    `${lane.transportKind}: capability profile is defined`,
    new RegExp(`export const ${lane.capabilityProfile}:[\\s\\S]*?supportsTools:\\s*true`, 'u').test(files.capabilityProfiles),
    'capability profile must be exported and must declare tool support'
  );

  requireMatch(
    `${lane.transportKind}: deterministic scenario matrix includes lane`,
    files.evaluationHarness.includes(`transportKind: '${lane.transportKind}'`),
    'provider-model-evaluation-harness.test.ts must include the lane in NORMALIZED_EVALUATION_LANES'
  );

  requireMatch(
    `${lane.transportKind}: graduation matrix row exists`,
    files.graduationMatrix.includes(`| ${lane.label} | \`${lane.transportKind}\``),
    'docs/engineering/provider-graduation-matrix.md must document the normalized lane'
  );

  if (lane.liveValidation === 'runner') {
    requireMatch(
      `${lane.transportKind}: live validation runner maps lane`,
      files.liveValidation.includes(`id: '${lane.transportKind}'`)
        && files.liveValidation.includes(`transportKind: '${lane.transportKind}'`),
      'scripts/run-normalized-provider-validation.mjs must include a suite for this live-certifiable lane'
    );
  } else if (lane.liveValidation === 'retired_internal') {
    requireMatch(
      `${lane.transportKind}: retired live validation lane is not in runner`,
      !files.liveValidation.includes(`id: '${lane.transportKind}'`),
      'retired first-class OpenAI validation must stay out of scripts/run-normalized-provider-validation.mjs'
    );
  } else {
    requireMatch(
      `${lane.transportKind}: local live validation boundary is documented`,
      files.graduationMatrix.includes(`| ${lane.label} | \`${lane.transportKind}\` | Passing | Manual/local`),
      'local Ollama chat must remain explicitly documented as manual/local live proof'
    );
  }
}

for (const needle of requiredScenarioNeedles) {
  requireMatch(
    `deterministic scenario exists: ${needle}`,
    files.evaluationHarness.includes(needle),
    'provider-model-evaluation-harness.test.ts must keep the shared normalized behavior scenario'
  );
}

requireMatch(
  'Ollama responses fallback scenario exists',
  files.evaluationHarness.includes('falls back from Ollama responses before app work starts'),
  'deterministic evaluation must cover fallback from responses to local chat before tool work starts'
);

requireMatch(
  'live validation report stays in ignored test output',
  files.liveValidation.includes("path.join(process.cwd(), 'test-results', 'normalized-provider-validation')")
    && files.liveValidation.includes('last-run.json'),
  'live validation reports must be written under ignored test-results'
);

requireMatch(
  'OpenAI live validation defaults to gpt-5.4-nano',
  files.liveValidation.includes("const DEFAULT_OPENAI_TEST_MODEL = 'gpt-5.4-nano'"),
  'OpenAI live validation must default to the free-eligible nano model'
);

if (findings.length > 0) {
  console.error(JSON.stringify({
    status: 'failed',
    findings
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  status: 'ok',
  checkedLanes: lanes.map((lane) => lane.transportKind),
  checkedScenarios: requiredScenarioNeedles.length + 1,
  liveValidationReportPath: 'test-results/normalized-provider-validation/last-run.json'
}, null, 2));
