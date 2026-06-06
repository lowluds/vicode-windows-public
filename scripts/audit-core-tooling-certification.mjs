import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const strict = process.argv.includes('--strict');
const requireLocalOllamaModel = strict || process.argv.includes('--require-local-ollama-model');
const OLLAMA_LIST_TIMEOUT_MS = 5000;

const requiredFiles = [
  'src/providers/agent-runtime-native-tools.ts',
  'src/providers/agent-tool-catalog.ts',
  'src/main/services/agent-runtime.ts',
  'src/main/services/browser-preview.ts',
  'src/main/services/tool-approval-service.ts',
  'src/main/services/web-research.ts',
  'src/main/services/mcp/registry.ts',
  'src/main/services/skill-context.ts',
  'src/main/services/provider-model-context-assembler.ts',
  'src/main/services/provider-model-harness-runner.ts',
  'src/main/services/provider-model-transport-registry.ts',
  'src/providers/ollama/adapter.ts',
  'src/providers/ollama/chat-transport.ts',
  'src/providers/ollama/tool-loop-responses-runner.ts',
  'src/providers/ollama/tool-loop-model.ts',
  'src/providers/ollama/app-preview-validation.ts',
  'src/providers/ollama/tool-loop-guardrails.ts',
  'src/shared/agent-tool-policy.ts',
  'scripts/electron-smoke.mjs',
  'scripts/electron-packaged-smoke.mjs',
  'scripts/electron-installed-smoke.mjs',
  'e2e/browser-preview-evidence.spec.ts',
  'e2e/ollama-first-run.spec.ts',
  'e2e/tool-approval-surface.spec.ts',
  'e2e/golden-transcript-evidence.spec.ts',
  'e2e/plugins-skills-visual.spec.ts',
  'e2e/manual-visual-review.spec.ts',
  'docs/engineering/core-tooling-certification-2026-05-24.md',
  'docs/engineering/test-matrix.md',
  'docs/engineering/manual-packaged-certification-2026-05-23.md',
  'docs/engineering/visual-review/2026-05-24/README.md',
  'docs/engineering/visual-review/2026-05-24/composer-with-skills-entrypoint.png',
  'docs/engineering/visual-review/2026-05-24/settings-provider-copy.png',
  'docs/engineering/visual-review/2026-05-24/skills-plugins-surface.png',
  'docs/engineering/visual-review/2026-05-24/skills-skills-surface.png',
  'docs/engineering/visual-review/2026-05-24/approval-surface.png',
  'docs/engineering/visual-review/2026-05-24/transcript-tool-evidence.png'
];

const requiredText = [
  {
    file: 'src/providers/agent-runtime-native-tools.ts',
    pattern: /\bbrowser_preview_check\b/u,
    label: 'native browser preview tool definition'
  },
  {
    file: 'src/shared/agent-tool-policy.ts',
    pattern: /\bbrowser_preview_check\b/u,
    label: 'browser preview policy entry'
  },
  {
    file: 'src/main/services/agent-runtime.ts',
    pattern: /\bbrowser_preview_check\b/u,
    label: 'browser preview runtime dispatch'
  },
  {
    file: 'src/providers/agent-tool-catalog.ts',
    pattern: /\bcreate_skill_bundle\b/u,
    label: 'explicit advanced skill-creator catalog entry'
  },
  {
    file: 'src/providers/agent-tool-catalog.ts',
    pattern: /\bcreatorToolsEnabled\b/u,
    label: 'creator tools require explicit catalog opt-in'
  },
  {
    file: 'src/main/services/provider-model-context-assembler.ts',
    pattern: /\bbrowser_preview_check\b/u,
    label: 'provider-neutral context assembler includes browser preview contract'
  },
  {
    file: 'src/providers/ollama/app-preview-validation.ts',
    pattern: /\bmaybeRunAppOwnedPreviewValidation\b/u,
    label: 'app-owned preview fallback helper'
  },
  {
    file: 'e2e/golden-transcript-evidence.spec.ts',
    pattern: /web research, MCP, skills, and sources/u,
    label: 'golden transcript evidence coverage'
  },
  {
    file: 'scripts/electron-smoke.mjs',
    pattern: /Skills should remain reachable from the titlebar during the narrow beta/u,
    label: 'smoke keeps narrow titlebar Skills entrypoint reachable'
  },
  {
    file: 'scripts/electron-smoke.mjs',
    pattern: /skills-tab-plugins.*skills-tab-skills/su,
    label: 'smoke verifies both Skills catalog tabs'
  },
  {
    file: 'scripts/electron-packaged-smoke.mjs',
    pattern: /verifyNarrowChrome/u,
    label: 'packaged smoke includes narrow chrome verification helper'
  },
  {
    file: 'scripts/electron-packaged-smoke.mjs',
    pattern: /nav-plugins.*nav-automations.*nav-skills/su,
    label: 'packaged smoke verifies legacy nav absence and titlebar Skills presence'
  },
  {
    file: 'scripts/electron-packaged-smoke.mjs',
    pattern: /skills-tab-plugins.*skills-tab-skills/su,
    label: 'packaged smoke verifies both Skills catalog tabs'
  },
  {
    file: 'scripts/electron-installed-smoke.mjs',
    pattern: /assertNarrowProviderSurface/u,
    label: 'installed smoke verifies narrow provider surface'
  },
  {
    file: 'scripts/electron-installed-smoke.mjs',
    pattern: /nav-plugins.*nav-automations.*nav-skills/su,
    label: 'installed smoke verifies legacy nav absence and titlebar Skills presence'
  },
  {
    file: 'scripts/electron-installed-smoke.mjs',
    pattern: /skills-tab-plugins.*skills-tab-skills/su,
    label: 'installed smoke verifies both Skills catalog tabs'
  },
  {
    file: 'e2e/plugins-skills-visual.spec.ts',
    pattern: /nav-skills/u,
    label: 'focused visual spec covers titlebar Skills entrypoint'
  },
  {
    file: 'e2e/plugins-skills-visual.spec.ts',
    pattern: /nav-plugins.*nav-automations.*Build Control/su,
    label: 'focused visual spec keeps legacy plugin automation chrome parked'
  },
  {
    file: 'e2e/manual-visual-review.spec.ts',
    pattern: /captures current narrow beta visual review surfaces without legacy setup noise/u,
    label: 'repeatable manual visual review coverage'
  },
  {
    file: 'e2e/manual-visual-review.spec.ts',
    pattern: /SOUL\.md.*USER\.md.*MEMORY\.md.*Build Control.*Autonomous Builds.*Gemini.*Kimi/su,
    label: 'manual visual review asserts legacy setup/provider noise is absent'
  },
  {
    file: 'src/main/services/provider-model-context-assembler.test.ts',
    pattern: /assembles runtime skill resources through the neutral prompt context/u,
    label: 'provider-neutral runtime skill context prompt coverage'
  },
  {
    file: 'src/main/services/provider-model-context-assembler.test.ts',
    pattern: /assembles connected MCP tools through the neutral prompt context/u,
    label: 'provider-neutral MCP context prompt and tool payload coverage'
  },
  {
    file: 'e2e/golden-transcript-evidence.spec.ts',
    pattern: /create_skill_bundle'\)\)\.toHaveCount\(0\).*create_plugin_bundle'\)\)\.toHaveCount\(0\).*spawn_subagents'\)\)\.toHaveCount\(0\)/su,
    label: 'golden transcript hides raw advanced helper tool ids'
  },
  {
    file: 'e2e/browser-preview-evidence.spec.ts',
    pattern: /browser_preview_check'\)\)\.toHaveCount\(0\)/u,
    label: 'browser preview evidence hides raw helper tool id'
  },
  {
    file: 'e2e/tool-approval-surface.spec.ts',
    pattern: /run_command'\)\)\.toHaveCount\(0\)/u,
    label: 'command approval evidence hides raw command helper id'
  },
  {
    file: 'e2e/manual-visual-review.spec.ts',
    pattern: /browser_preview_check'\)\)\.toHaveCount\(0\)/u,
    label: 'manual visual review hides raw browser preview helper id'
  },
  {
    file: 'src/main/services/provider-model-context-assembler.test.ts',
    pattern: /assembles full-access command policy into the neutral tool payload/u,
    label: 'provider-neutral run_command exposure requires full access'
  },
  {
    file: 'src/main/services/provider-model-context-assembler.test.ts',
    pattern: /run_command requires user approval every time/u,
    label: 'provider-neutral command prompt requires approval copy'
  },
  {
    file: 'src/main/services/provider-model-harness-runner.test.ts',
    pattern: /prompts the model to mutate the workspace before final text/u,
    label: 'provider-neutral mutation reminder coverage'
  },
  {
    file: 'src/main/services/provider-model-harness-runner.test.ts',
    pattern: /does not fall back after a mutating tool has changed the workspace/u,
    label: 'provider-neutral mutation fallback guard coverage'
  },
  {
    file: 'src/main/services/provider-model-harness-runner.test.ts',
    pattern: /runs app-owned preview validation before accepting final text/u,
    label: 'provider-neutral app-owned preview fallback coverage'
  },
  {
    file: 'e2e/ollama-first-run.spec.ts',
    pattern: /local Ollama first-run setup persists provider, local model, trusted project, and thread after relaunch/u,
    label: 'local Ollama first-run persistence proof'
  },
  {
    file: 'e2e/ollama-first-run.spec.ts',
    pattern: /local Ollama first-run execution writes a file through the app harness/u,
    label: 'local Ollama first-run execution proof'
  },
  {
    file: 'docs/engineering/visual-review/2026-05-24/README.md',
    pattern: /composer-with-skills-entrypoint\.png.*settings-provider-copy\.png.*approval-surface\.png.*transcript-tool-evidence\.png/su,
    label: 'visual review packet lists current captured surfaces'
  },
  {
    file: 'docs/engineering/manual-packaged-certification-2026-05-23.md',
    pattern: /docs\/engineering\/visual-review\/2026-05-24\//u,
    label: 'packaged certification references current visual review packet'
  },
  {
    file: 'docs/engineering/manual-packaged-certification-2026-05-23.md',
    pattern: /`37` checked files and `44` checked text contracts/u,
    label: 'packaged certification records current core tooling audit count'
  },
  {
    file: 'e2e/tool-approval-surface.spec.ts',
    pattern: /Pending approval|approval/u,
    label: 'command approval surface coverage'
  },
  {
    file: 'docs/engineering/public-beta-verification-goal-0.2.8.md',
    pattern: /local Ollama API.*OpenAI-compatible Custom API/su,
    label: 'current public beta provider scope is documented'
  },
  {
    file: 'docs/engineering/test-matrix.md',
    pattern: /golden-transcript-evidence\.spec\.ts/u,
    label: 'golden transcript test matrix entry'
  },
  {
    file: 'docs/engineering/test-matrix.md',
    pattern: /smoke:packaged.*titlebar Skills.*smoke:installed.*seeded thread restore/su,
    label: 'test matrix documents packaged and installed narrow chrome smoke scope'
  },
  {
    file: 'docs/engineering/release-gates.md',
    pattern: /smoke:packaged.*titlebar Skills.*smoke:installed.*seeded thread restore/su,
    label: 'release gates document packaged and installed narrow chrome smoke scope'
  },
  {
    file: 'docs/engineering/release-gates.md',
    pattern: /`Gemini`, `Qwen`, and `Kimi` CLI lanes are retired for the current beta scope and must not surface in the beta provider list, block release, or appear in launch claims/u,
    label: 'retired provider CLI lanes are excluded from current beta release claims'
  }
];

function readRelative(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function auditFiles(findings) {
  for (const relativePath of requiredFiles) {
    if (!existsSync(path.join(root, relativePath))) {
      findings.push({
        severity: 'fail',
        check: 'required_file',
        detail: `${relativePath} is missing`
      });
    }
  }
}

function auditText(findings) {
  for (const check of requiredText) {
    let content = '';
    try {
      content = readRelative(check.file);
    } catch {
      findings.push({
        severity: 'fail',
        check: 'required_text',
        detail: `${check.label}: ${check.file} could not be read`
      });
      continue;
    }

    if (!check.pattern.test(content)) {
      findings.push({
        severity: 'fail',
        check: 'required_text',
        detail: `${check.label}: ${check.file} did not match ${check.pattern}`
      });
    }
  }
}

function parseOllamaList(output) {
  const lines = output
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return [];
  }

  return lines
    .slice(1)
    .filter((line) => !/^NAME\s+ID\s+SIZE\s+MODIFIED$/iu.test(line))
    .map((line) => line.split(/\s+/u)[0])
    .filter(Boolean);
}

function auditLocalOllama(findings) {
  try {
    const output = execFileSync('ollama', ['list'], {
      cwd: root,
      encoding: 'utf8',
      timeout: OLLAMA_LIST_TIMEOUT_MS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const models = parseOllamaList(output);
    if (models.length === 0) {
      findings.push({
        severity: requireLocalOllamaModel ? 'fail' : 'info',
        check: 'local_ollama_model',
        detail: requireLocalOllamaModel
          ? 'Ollama is installed/reachable but no local models are installed; local-runtime compatibility proof was required for this audit.'
          : 'Ollama is installed/reachable but no local models are installed; local-runtime proof was not required for this audit invocation.'
      });
    }
    return {
      available: true,
      modelCount: models.length,
      models
    };
  } catch (error) {
    findings.push({
      severity: requireLocalOllamaModel ? 'fail' : 'info',
      check: 'local_ollama_model',
      detail: requireLocalOllamaModel
        ? `Ollama local runtime could not be queried and local-runtime compatibility proof was required: ${
            error instanceof Error ? error.message : String(error)
          }`
        : `Ollama local runtime could not be queried; local-runtime proof was not required for this audit invocation: ${
            error instanceof Error ? error.message : String(error)
          }`
    });
    return {
      available: false,
      modelCount: 0,
      models: []
    };
  }
}

function main() {
  const findings = [];
  auditFiles(findings);
  auditText(findings);
  const localOllama = auditLocalOllama(findings);
  const failures = findings.filter((finding) => finding.severity === 'fail');
  const warnings = findings.filter((finding) => finding.severity === 'warn');

  const result = {
    status: failures.length > 0 ? 'failed' : warnings.length > 0 ? 'ok_with_warnings' : 'ok',
    strict,
    requireLocalOllamaModel,
    checkedFiles: requiredFiles.length,
    checkedTextContracts: requiredText.length,
    localOllama,
    findings
  };

  console.log(JSON.stringify(result, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main();
