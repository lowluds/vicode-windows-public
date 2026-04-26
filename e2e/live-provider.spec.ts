import { chromium, expect, test, type Page } from '@playwright/test';
import { appendFile, copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  closeApp,
  dismissWelcomeIfVisible,
  launchApp as launchElectronApp,
  type LaunchStatePaths,
  waitForBridge
} from './helpers/electron';
import { findSuspiciousAssistantTextPatterns } from '../src/providers/text-normalization';
import { buildNativeComposerCommandPrompt } from '../src/shared/nativeCommands';
import { providerDisplayName, selectPreferredOllamaModel, selectPreferredOllamaValidationModels } from '../src/shared/providers';

const root = process.cwd();
const workspaceRoot = path.join(root, 'test', '.e2e-workspaces');
const keepFailedBenchWorkspaces = /^(1|true|yes)$/iu.test(process.env.VICODE_KEEP_FAILED_BENCH_WORKSPACES ?? '');
const execFileAsync = promisify(execFile);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMixedUsePacketDir(providerId: 'openai' | 'gemini' | 'ollama') {
  const packetDir = process.env.VICODE_MIXED_USE_PACKET_DIR;
  const packetProvider = process.env.VICODE_MIXED_USE_PROVIDER;
  if (!packetDir || packetProvider !== providerId) {
    return null;
  }
  return packetDir;
}

function getMixedUseSkipReasonPath(providerId: 'openai' | 'gemini' | 'ollama') {
  const packetDir = getMixedUsePacketDir(providerId);
  return packetDir ? path.join(packetDir, 'skip-reason.txt') : null;
}

async function appendMixedUseTimelineLine(
  providerId: 'openai' | 'gemini' | 'ollama',
  line: string
) {
  const packetDir = getMixedUsePacketDir(providerId);
  if (!packetDir) {
    return;
  }
  await appendFile(path.join(packetDir, 'timeline.md'), `${line}\n`, 'utf8');
}

async function writeMixedUseFailureSnapshot(
  providerId: 'openai' | 'gemini' | 'ollama',
  detail: unknown
) {
  const packetDir = getMixedUsePacketDir(providerId);
  if (!packetDir) {
    return;
  }
  await writeFile(
    path.join(packetDir, 'failure-snapshot.json'),
    `${JSON.stringify(detail, null, 2)}\n`,
    'utf8'
  );
}

async function markMixedUseProviderSkip(
  providerId: 'openai' | 'gemini' | 'ollama',
  reason: string
) {
  const skipReasonPath = getMixedUseSkipReasonPath(providerId);
  if (!skipReasonPath) {
    return;
  }
  await writeFile(skipReasonPath, `${reason}\n`, 'utf8');
  await appendMixedUseTimelineLine(providerId, `- ${new Date().toISOString()}: benchmark skipped: ${reason}`);
}

async function cleanupBenchmarkWorkspace(
  projectPath: string,
  options: {
    preserveOnFailure?: boolean;
    label?: string;
  } = {}
) {
  const shouldPreserve = options.preserveOnFailure && keepFailedBenchWorkspaces && test.info().errors.length > 0;
  if (shouldPreserve) {
    test.info().annotations.push({
      type: 'note',
      description: `Preserved failed benchmark workspace${options.label ? ` (${options.label})` : ''} at ${projectPath}`
    });
    return;
  }

  await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
}

async function launchApp(statePaths?: LaunchStatePaths) {
  return await launchElectronApp({
    bridgePaths: [
      'vicode.app',
      'vicode.projects',
      'vicode.threads',
      'vicode.planner',
      'vicode.providers',
      'vicode.composer',
      'vicode.skills',
      'vicode.settings',
      'vicode.diagnostics'
    ],
    timeoutMs: 60_000,
    statePaths
  });
}

function getDurableStatePaths(): LaunchStatePaths | null {
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  if (!appData || !localAppData) {
    return null;
  }

  return {
    userDataPath: path.join(appData, 'vicode-windows'),
    sessionDataPath: path.join(localAppData, 'vicode-windows', 'session')
  };
}

async function prepareHostedOllamaProvider(window: Page) {
  const envApiKey = process.env.VICODE_OLLAMA_API_KEY ?? process.env.OLLAMA_API_KEY ?? null;
  if (!envApiKey) {
    return;
  }

  await window.evaluate(async (apiKey) => {
    await window.vicode.providers.saveApiKey('ollama', apiKey);
    await window.vicode.providers.refresh('ollama');
  }, envApiKey);
}

function selectOpenAICertificationModel(models: Array<{ id: string }>) {
  return (
    models.find((entry) => entry.id === 'gpt-5.4') ??
    models.find((entry) => entry.id === 'gpt-5.3-codex') ??
    models.find((entry) => entry.id === 'gpt-5') ??
    models[0]
  );
}

function selectModelByEnv(models: Array<{ id: string }>, envVarName: string) {
  const requestedId = process.env[envVarName]?.trim();
  if (!requestedId) {
    return null;
  }

  return models.find((entry) => entry.id === requestedId) ?? null;
}

function selectOpenAISameThreadBenchmarkModel(models: Array<{ id: string }>) {
  return (
    selectModelByEnv(models, 'VICODE_OPENAI_SAME_THREAD_MODEL') ??
    models.find((entry) => entry.id === 'gpt-5.4') ??
    models.find((entry) => entry.id === 'gpt-5.3-codex') ??
    models.find((entry) => /^gpt-5(\.|-|$)/iu.test(entry.id) && !/mini/iu.test(entry.id)) ??
    selectOpenAICertificationModel(models)
  );
}

function selectGeminiCertificationModel(models: Array<{ id: string }>) {
  return (
    selectModelByEnv(models, 'VICODE_GEMINI_CERTIFICATION_MODEL') ??
    models.find((entry) => entry.id === 'gemini-3.1-pro-preview') ??
    models.find((entry) => entry.id === 'gemini-3-pro-preview') ??
    models.find((entry) => entry.id === 'gemini-2.5-pro') ??
    models.find((entry) => entry.id === 'gemini-3-flash-preview') ??
    models.find((entry) => entry.id === 'gemini-3.1-flash-lite-preview') ??
    models.find((entry) => entry.id === 'gemini-2.5-flash') ??
    models.find((entry) => entry.id === 'gemini-2.5-flash-lite') ??
    models.find((entry) => entry.id === 'auto-gemini-3') ??
    models.find((entry) => entry.id === 'auto-gemini-2.5') ??
    models.find((entry) => /gemini-(3|2\.5)/iu.test(entry.id)) ??
    models[0]
  );
}

function selectGeminiSameThreadBenchmarkModel(models: Array<{ id: string }>) {
  return (
    selectModelByEnv(models, 'VICODE_GEMINI_SAME_THREAD_MODEL') ??
    models.find((entry) => entry.id === 'gemini-3.1-pro-preview') ??
    models.find((entry) => entry.id === 'gemini-3-pro-preview') ??
    models.find((entry) => entry.id === 'gemini-3-flash-preview') ??
    models.find((entry) => entry.id === 'gemini-3.1-flash-lite-preview') ??
    models.find((entry) => entry.id === 'gemini-2.5-pro') ??
    models.find((entry) => entry.id === 'gemini-2.5-flash') ??
    models.find((entry) => entry.id === 'gemini-2.5-flash-lite') ??
    selectGeminiCertificationModel(models)
  );
}

function selectQwenCertificationModel(models: Array<{ id: string }>) {
  return (
    models.find((entry) => entry.id === 'qwen3.5-plus') ??
    models.find((entry) => /coder/i.test(entry.id)) ??
    models.find((entry) => /qwen/i.test(entry.id)) ??
    models[0]
  );
}

function selectKimiCertificationModel(models: Array<{ id: string }>) {
  return (
    models.find((entry) => entry.id === 'kimi-k2-thinking') ??
    models.find((entry) => entry.id === 'kimi-k2-thinking-turbo') ??
    models.find((entry) => /thinking/i.test(entry.id)) ??
    models[0]
  );
}

function isGeminiCapacityFailure(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('rate limited or out of capacity') ||
    normalized.includes('no server capacity right now') ||
    normalized.includes('exhausted your capacity')
  );
}

async function maybeSkipGeminiCapacityFailure(error: unknown, modelId: string, context: string) {
  const message = error instanceof Error ? error.message : String(error);
  if (isGeminiCapacityFailure(message)) {
    const reason = `Gemini capacity exhausted for ${modelId} during ${context}.`;
    await markMixedUseProviderSkip('gemini', reason);
    test.skip(true, reason);
  }
}

function isCodexIdleAfterPartialOutputFailure(message: string) {
  return message.includes('Codex CLI became idle after partial output and was stopped before reaching a real completion state.');
}

async function runMarketingSiteBenchmark(window: Page, input: {
  providerId: 'openai' | 'gemini' | 'ollama' | 'qwen' | 'kimi';
  modelId: string;
  projectId: string;
  projectPath: string;
  threadId: string;
  skillIds?: string[];
  promptPrefixLines?: string[];
}) {
  const normalizeScriptAssertion = (value: string) => value.replace(/''/g, "'");
  const indexPath = path.join(input.projectPath, 'index.html');
  const stylesPath = path.join(input.projectPath, 'styles.css');
  const scriptPath = path.join(input.projectPath, 'main.js');

  const submitted = await window.evaluate(
    async ({ projectId, threadId, providerId, modelId, prompt, skillIds }) =>
      window.vicode.composer.submit({
        projectId,
        threadId,
        prompt,
        providerId,
        modelId,
        executionPermission: 'full_access',
        skillIds
      }),
    {
      projectId: input.projectId,
      threadId: input.threadId,
      providerId: input.providerId,
      modelId: input.modelId,
      skillIds: input.skillIds ?? [],
      prompt: [
        ...(input.promptPrefixLines ?? []),
        'Build a polished one-page marketing site in the workspace root using real files.',
        'Write exactly these files: index.html, styles.css, main.js.',
        'Requirements:',
        '- index.html must include the visible headline "Northstar Studio"',
        '- index.html must include sections with ids "hero", "features", and "cta"',
        '- index.html must include a button or link with the exact text "Book intro call"',
        '- index.html must include an element with id "benchmark-status"',
        '- styles.css must include the exact text linear-gradient(',
        '- styles.css must include the exact text @media (max-width: 720px)',
        "- main.js must set document.getElementById('benchmark-status').textContent to exactly 'benchmark ready'",
        'Reply with exactly: benchmark built.'
      ].join('\n')
    }
  );

  expect(submitted.disposition).toBe('started');
  const completedThread = await waitForThreadCompletion(window, input.threadId, 300_000);
  const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
  const assistantContent = (assistantTurn?.content ?? '').trim();
  expect(assistantContent.length).toBeGreaterThan(0);
  expect(assistantContent.toLowerCase()).not.toContain('couldn’t build');
  expect(assistantContent.toLowerCase()).not.toContain("couldn't build");
  expect(assistantContent.toLowerCase()).not.toContain('read-only filesystem sandbox');

  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Northstar Studio');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="hero"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="features"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="cta"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Book intro call');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="benchmark-status"');
  await expect.poll(async () => await readFile(stylesPath, 'utf8'), { timeout: 30_000 }).toContain('linear-gradient(');
  await expect.poll(async () => await readFile(stylesPath, 'utf8'), { timeout: 30_000 }).toContain('@media (max-width: 720px)');
  await expect.poll(async () => normalizeScriptAssertion(await readFile(scriptPath, 'utf8')), { timeout: 30_000 }).toContain('benchmark-status');
  await expect.poll(async () => normalizeScriptAssertion(await readFile(scriptPath, 'utf8')), { timeout: 30_000 }).toContain('benchmark ready');
  return completedThread;
}

async function seedDurableMemory(projectPath: string, input: {
  memoryContent: string;
  dailyNoteFileName?: string;
  dailyNoteContent?: string;
}) {
  await mkdir(projectPath, { recursive: true });
  await writeFile(path.join(projectPath, 'MEMORY.md'), input.memoryContent, 'utf8');

  if (input.dailyNoteFileName && input.dailyNoteContent) {
    const memoryDir = path.join(projectPath, 'memory');
    await mkdir(memoryDir, { recursive: true });
    await writeFile(path.join(memoryDir, input.dailyNoteFileName), input.dailyNoteContent, 'utf8');
  }
}

async function runDashboardBenchmark(window: Page, input: {
  providerId: 'openai' | 'gemini' | 'ollama';
  modelId: string;
  projectId: string;
  projectPath: string;
  threadId: string;
  skillIds?: string[];
  promptPrefixLines?: string[];
}) {
  const indexPath = path.join(input.projectPath, 'index.html');
  const stylesPath = path.join(input.projectPath, 'styles.css');
  const scriptPath = path.join(input.projectPath, 'app.js');

  const submitted = await window.evaluate(
    async ({ projectId, threadId, providerId, modelId, prompt, skillIds }) =>
      window.vicode.composer.submit({
        projectId,
        threadId,
        prompt,
        providerId,
        modelId,
        executionPermission: 'full_access',
        skillIds
      }),
    {
      projectId: input.projectId,
      threadId: input.threadId,
      providerId: input.providerId,
      modelId: input.modelId,
      prompt: [
        ...(input.promptPrefixLines ?? []),
        'Build a polished product dashboard in the workspace root using real files.',
        'Write exactly these files: index.html, styles.css, app.js.',
        'Requirements:',
        '- index.html must include the visible title "Signal Ops Dashboard"',
        '- index.html must include a sidebar element with id "sidebar"',
        '- index.html must include a main shell element with id "dashboard-shell"',
        '- index.html must include sections or cards titled "Pipeline health", "Alerts", and "Deployments"',
        '- index.html must include a table or list area with id "deployments-table"',
        '- index.html must include an element with id "dashboard-status"',
        '- styles.css must include the exact text grid-template-columns',
        '- styles.css must include the exact text @media (max-width: 900px)',
        "- app.js must set document.getElementById('dashboard-status').textContent to exactly 'dashboard ready'",
        'Reply with exactly: dashboard built.'
      ].join('\n'),
      skillIds: input.skillIds ?? []
    }
  );

  expect(submitted.disposition).toBe('started');
  const completedThread = await waitForThreadCompletion(window, input.threadId, 300_000);
  const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
  const assistantContent = (assistantTurn?.content ?? '').trim();
  expect(assistantContent.length).toBeGreaterThan(0);
  expect(assistantContent.toLowerCase()).not.toContain('couldn’t build');
  expect(assistantContent.toLowerCase()).not.toContain("couldn't build");
  expect(assistantContent.toLowerCase()).not.toContain('read-only filesystem sandbox');

  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Signal Ops Dashboard');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="sidebar"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="dashboard-shell"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Pipeline health');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Alerts');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Deployments');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="deployments-table"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="dashboard-status"');
  await expect.poll(async () => await readFile(stylesPath, 'utf8'), { timeout: 30_000 }).toContain('grid-template-columns');
  await expect.poll(async () => await readFile(stylesPath, 'utf8'), { timeout: 30_000 }).toContain('@media (max-width: 900px)');
  await expect.poll(async () => await readFile(scriptPath, 'utf8'), { timeout: 30_000 }).toMatch(
    /(?:document\.getElementById\('dashboard-status'\)|dashboardStatus(?:El)?)\.textContent = 'dashboard ready'/
  );

  return completedThread;
}

async function runReactLandingBenchmark(window: Page, input: {
  providerId: 'openai' | 'gemini' | 'ollama';
  modelId: string;
  projectId: string;
  projectPath: string;
  threadId: string;
  skillIds?: string[];
  promptPrefixLines?: string[];
}) {
  await seedReactLandingWorkspace(input.projectPath);

  const srcDir = path.join(input.projectPath, 'src');
  const packagePath = path.join(input.projectPath, 'package.json');
  const componentsConfigPath = path.join(input.projectPath, 'components.json');
  const indexPath = path.join(input.projectPath, 'index.html');
  const viteConfigPath = path.join(input.projectPath, 'vite.config.js');
  const mainPath = path.join(srcDir, 'main.jsx');
  const appPath = path.join(srcDir, 'App.jsx');
  const stylesPath = path.join(srcDir, 'styles.css');
  const uiDir = path.join(srcDir, 'components', 'ui');
  const libDir = path.join(srcDir, 'lib');
  const buttonPath = path.join(uiDir, 'Button.jsx');
  const cardPath = path.join(uiDir, 'Card.jsx');
  const utilsPath = path.join(libDir, 'utils.js');

  const submitted = await window.evaluate(
    async ({ projectId, threadId, providerId, modelId, prompt, skillIds }) =>
      window.vicode.composer.submit({
        projectId,
        threadId,
        prompt,
        providerId,
        modelId,
        executionPermission: 'full_access',
        skillIds
      }),
    {
      projectId: input.projectId,
      threadId: input.threadId,
      providerId: input.providerId,
      modelId: input.modelId,
      prompt: [
        ...(input.promptPrefixLines ?? []),
        'Upgrade the existing workspace into a polished React landing page using the current Vite-style file structure.',
        'Keep the project as a real React app rooted at components.json, index.html, vite.config.js, src/main.jsx, src/App.jsx, and src/styles.css.',
        'Do not add packages, do not delete package.json, and do not switch frameworks.',
        'Use componentized React with reusable primitives in src/components/ui/Button.jsx and src/components/ui/Card.jsx.',
        'This workspace is intentionally shadcn-ready through components.json and src/lib/utils.js.',
        'Treat the UI direction like a restrained premium shadcn system with a 21st-style hero rhythm, but implement it directly in this workspace.',
        'Use write_file for any file changes. Do not call apply_patch.',
        'Do not run npm install, npm run dev, vite dev, preview servers, or verification commands yourself.',
        'Requirements:',
        '- package.json must keep scripts for dev, build, and preview using vite',
        '- package.json must keep @vitejs/plugin-react in devDependencies',
        '- components.json must keep the exact text "style": "new-york"',
        '- components.json must keep the exact text "css": "src/styles.css"',
        '- vite.config.js must import react from @vitejs/plugin-react and use plugins: [react()]',
        '- vite.config.js must keep an alias for @ that points at ./src',
        '- src/main.jsx must keep a React root render path using either ReactDOM.createRoot(document.getElementById(\'root\')).render or createRoot(root).render',
        '- src/App.jsx must compose HeroSection, MetricsStrip, and FeatureGrid either inline or via local imports',
        '- src/App.jsx must include visible text "Northstar Systems"',
        '- src/App.jsx must include visible text "Book a launch review"',
        '- src/App.jsx must include elements with ids "hero-section", "feature-grid", "metrics-strip", "testimonial-panel", and "cta-panel"',
        '- src/styles.css must include the exact text --surface-strong',
        '- src/styles.css must include the exact text @media (max-width: 900px)',
        '- src/components/ui/Button.jsx must export function Button(',
        '- src/components/ui/Card.jsx must export function Card(',
        '- src/lib/utils.js must export function cn(',
        '- the final app must remain buildable with vite build from this workspace',
        'Reply with exactly: react landing built.'
      ].join('\n'),
      skillIds: input.skillIds ?? []
    }
  );

  expect(submitted.disposition).toBe('started');
  const completedThread = await waitForThreadCompletion(window, input.threadId, 300_000);
  const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
  const assistantContent = (assistantTurn?.content ?? '').trim();
  expect(assistantContent.length).toBeGreaterThan(0);
  expect(assistantContent.toLowerCase()).not.toContain('couldn’t build');
  expect(assistantContent.toLowerCase()).not.toContain("couldn't build");
  expect(assistantContent.toLowerCase()).not.toContain('read-only filesystem sandbox');

  await assertReactLandingWorkspaceShape({
    packagePath,
    componentsConfigPath,
    viteConfigPath,
    mainPath,
    appPath,
    stylesPath,
    buttonPath,
    cardPath,
    utilsPath
  });

  await execFileAsync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
    cwd: input.projectPath
  });

  await withLocalProjectPreview(path.join(input.projectPath, 'dist', 'index.html'), async (preview) => {
    await expect(preview.locator('body')).toContainText('Northstar Systems');
    await expect(preview.locator('#hero-section')).toContainText('Book a launch review');
    await expect(preview.locator('#feature-grid')).toBeVisible();
    await expect(preview.locator('#metrics-strip')).toBeVisible();
    await expect(preview.locator('#testimonial-panel')).toBeVisible();
    await expect(preview.locator('#cta-panel')).toBeVisible();
  });

  return completedThread;
}

async function seedReactLandingWorkspace(projectPath: string) {
  const srcDir = path.join(projectPath, 'src');
  const uiDir = path.join(srcDir, 'components', 'ui');
  const libDir = path.join(srcDir, 'lib');
  await mkdir(uiDir, { recursive: true });
  await mkdir(libDir, { recursive: true });

  const packagePath = path.join(projectPath, 'package.json');
  const componentsConfigPath = path.join(projectPath, 'components.json');
  const indexPath = path.join(projectPath, 'index.html');
  const viteConfigPath = path.join(projectPath, 'vite.config.js');
  const mainPath = path.join(srcDir, 'main.jsx');
  const appPath = path.join(srcDir, 'App.jsx');
  const stylesPath = path.join(srcDir, 'styles.css');
  const buttonPath = path.join(uiDir, 'Button.jsx');
  const cardPath = path.join(uiDir, 'Card.jsx');
  const utilsPath = path.join(libDir, 'utils.js');

  await writeFile(
    packagePath,
    JSON.stringify(
      {
        name: 'frontier-react-landing',
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'vite build',
          preview: 'vite preview'
        },
        dependencies: {
          react: '^19.2.0',
          'react-dom': '^19.2.0'
        },
        devDependencies: {
          '@vitejs/plugin-react': '^5.1.0',
          vite: '^7.2.2'
        }
      },
      null,
      2
    ),
    'utf8'
  );
  await writeFile(
    componentsConfigPath,
    JSON.stringify(
      {
        $schema: 'https://ui.shadcn.com/schema.json',
        style: 'new-york',
        rsc: false,
        tsx: false,
        tailwind: {
          config: '',
          css: 'src/styles.css',
          baseColor: 'neutral',
          cssVariables: true
        },
        aliases: {
          components: '@/components',
          utils: '@/lib/utils'
        }
      },
      null,
      2
    ),
    'utf8'
  );
  await writeFile(
    indexPath,
    [
      '<!doctype html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '    <title>Northstar Systems</title>',
      '  </head>',
      '  <body>',
      '    <div id="root"></div>',
      '    <script type="module" src="/src/main.jsx"></script>',
      '  </body>',
      '</html>'
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    viteConfigPath,
    [
      "import { fileURLToPath, URL } from 'node:url';",
      "import { defineConfig } from 'vite';",
      "import react from '@vitejs/plugin-react';",
      '',
      'export default defineConfig({',
      '  plugins: [react()],',
      '  resolve: {',
      '    alias: {',
      "      '@': fileURLToPath(new URL('./src', import.meta.url))",
      '    }',
      '  }',
      '});'
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    mainPath,
    [
      "import React from 'react';",
      "import * as ReactDOM from 'react-dom/client';",
      "import App from './App.jsx';",
      "import './styles.css';",
      '',
      "ReactDOM.createRoot(document.getElementById('root')).render(",
      '  <React.StrictMode>',
      '    <App />',
      '  </React.StrictMode>',
      ');'
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    appPath,
    [
      "export default function App() {",
      "  return <div>placeholder</div>;",
      '}'
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    stylesPath,
    [
      ':root {',
      '  color-scheme: dark;',
      '  font-family: Inter, sans-serif;',
      '  background: #111;',
      '  color: #f5f5f5;',
      '}'
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    buttonPath,
    [
      'export function Button({ children, className = "", ...props }) {',
      '  return <button className={`button ${className}`.trim()} {...props}>{children}</button>;',
      '}'
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    cardPath,
    [
      'export function Card({ children, className = "" }) {',
      '  return <section className={`card ${className}`.trim()}>{children}</section>;',
      '}'
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    utilsPath,
    [
      'export function cn(...values) {',
      "  return values.filter(Boolean).join(' ');",
      '}'
    ].join('\n'),
    'utf8'
  );
}

async function assertReactLandingWorkspaceShape(input: {
  packagePath: string;
  componentsConfigPath: string;
  viteConfigPath: string;
  mainPath: string;
  appPath: string;
  stylesPath: string;
  buttonPath: string;
  cardPath: string;
  utilsPath: string;
  requireExtendedSections?: boolean;
}) {
  await expect.poll(async () => await readFile(input.packagePath, 'utf8'), { timeout: 30_000 }).toContain('"build": "vite build"');
  await expect.poll(async () => await readFile(input.packagePath, 'utf8'), { timeout: 30_000 }).toContain('"@vitejs/plugin-react"');
  await expect.poll(async () => await readFile(input.componentsConfigPath, 'utf8'), { timeout: 30_000 }).toContain('"style": "new-york"');
  await expect.poll(async () => await readFile(input.componentsConfigPath, 'utf8'), { timeout: 30_000 }).toContain('"css": "src/styles.css"');
  await expect.poll(async () => await readFile(input.viteConfigPath, 'utf8'), { timeout: 30_000 }).toContain("import react from '@vitejs/plugin-react';");
  await expect.poll(async () => await readFile(input.viteConfigPath, 'utf8'), { timeout: 30_000 }).toContain('plugins: [react()]');
  await expect.poll(async () => await readFile(input.viteConfigPath, 'utf8'), { timeout: 30_000 }).toContain("new URL('./src', import.meta.url)");
  await expect
    .poll(async () => await readFile(input.mainPath, 'utf8'), { timeout: 30_000 })
    .toMatch(/(?:ReactDOM\.createRoot\(document\.getElementById\('root'\)\)\.render|createRoot\([^)]+\)\.render)/);
  await expect.poll(async () => await readFile(input.appPath, 'utf8'), { timeout: 30_000 }).toContain('HeroSection');
  await expect.poll(async () => await readFile(input.appPath, 'utf8'), { timeout: 30_000 }).toContain('MetricsStrip');
  await expect.poll(async () => await readFile(input.appPath, 'utf8'), { timeout: 30_000 }).toContain('FeatureGrid');
  await expect.poll(async () => await readFile(input.stylesPath, 'utf8'), { timeout: 30_000 }).toContain('--surface-strong');
  await expect.poll(async () => await readFile(input.stylesPath, 'utf8'), { timeout: 30_000 }).toContain('@media (max-width: 900px)');
  await expect
    .poll(async () => await readFile(input.buttonPath, 'utf8'), { timeout: 30_000 })
    .toMatch(/(?:export\s+function\s+Button\(|const\s+Button\b|function\s+Button\(|export\s*\{\s*Button\s*\})/);
  await expect
    .poll(async () => await readFile(input.cardPath, 'utf8'), { timeout: 30_000 })
    .toMatch(/(?:export\s+function\s+Card\(|const\s+Card\b|function\s+Card\(|export\s*\{\s*Card\s*\})/);
  await expect
    .poll(async () => await readFile(input.utilsPath, 'utf8'), { timeout: 30_000 })
    .toMatch(/(?:export\s+function\s+cn\(|const\s+cn\b|function\s+cn\(|export\s*\{\s*cn\s*\})/);
}

async function readReactSourceTreeText(projectPath: string) {
  const srcDir = path.join(projectPath, 'src');
  const parts: string[] = [];

  const walk = async (currentDir: string) => {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(nextPath);
        continue;
      }
      if (!/\.(?:jsx|js|css)$/iu.test(entry.name)) {
        continue;
      }
      parts.push(await readFile(nextPath, 'utf8'));
    }
  };

  await walk(srcDir);
  return parts.join('\n');
}

async function runSameThreadReactLandingBenchmark(window: Page, input: {
  providerId: 'openai' | 'ollama';
  modelId: string;
  projectId: string;
  projectPath: string;
  threadId: string;
  skillIds?: string[];
  promptPrefixLines?: string[];
  stageTimeoutMs?: number;
  executionPermission?: 'default' | 'full_access';
}) {
  const stageTimeoutMs = input.stageTimeoutMs ?? (input.providerId === 'openai' ? 300_000 : 210_000);
  const executionPermission = input.executionPermission ?? 'full_access';
  await seedReactLandingWorkspace(input.projectPath);

  const srcDir = path.join(input.projectPath, 'src');
  const packagePath = path.join(input.projectPath, 'package.json');
  const componentsConfigPath = path.join(input.projectPath, 'components.json');
  const viteConfigPath = path.join(input.projectPath, 'vite.config.js');
  const mainPath = path.join(srcDir, 'main.jsx');
  const appPath = path.join(srcDir, 'App.jsx');
  const stylesPath = path.join(srcDir, 'styles.css');
  const uiDir = path.join(srcDir, 'components', 'ui');
  const libDir = path.join(srcDir, 'lib');
  const buttonPath = path.join(uiDir, 'Button.jsx');
  const cardPath = path.join(uiDir, 'Card.jsx');
  const utilsPath = path.join(libDir, 'utils.js');

  const submitStage = async (stageInput: { stageLabel: string; prompt: string; timeoutMs?: number }) => {
    const submitted = await window.evaluate(
      async ({ projectId, threadId, providerId, modelId, prompt, skillIds, executionPermission }) =>
        window.vicode.composer.submit({
          projectId,
          threadId,
          prompt,
          providerId,
          modelId,
          executionPermission,
          skillIds
        }),
      {
        projectId: input.projectId,
        threadId: input.threadId,
        providerId: input.providerId,
        modelId: input.modelId,
        prompt: [
          ...(input.promptPrefixLines ?? []),
          stageInput.prompt
        ].join('\n\n'),
        skillIds: input.skillIds ?? [],
        executionPermission
      }
    );

    expect(submitted.disposition).toBe('started');
    const { detail, assistantTurn } = await waitForRunCompletion(
      window,
      input.threadId,
      submitted.runId,
      stageInput.timeoutMs ?? stageTimeoutMs,
      stageInput.stageLabel
    );
    expect(assistantTurn.content.trim().length).toBeGreaterThan(0);
    return detail;
  };

  await submitStage({
    stageLabel: 'same-thread react landing build',
    prompt: [
      'Upgrade the existing workspace into a premium React landing page without replacing the current Vite project structure.',
      'Implement the feature slice now. Do not output a plan, checklist, or explanation.',
      'Keep the project rooted at components.json, index.html, vite.config.js, src/main.jsx, src/App.jsx, and src/styles.css.',
      'Do not add packages, do not add files, and do not switch frameworks.',
      'Preserve the shadcn-ready setup through components.json and src/lib/utils.js.',
      'Treat the UI like a restrained premium shadcn system with a 21st-style hero rhythm.',
      'Requirements:',
      '- the React source tree must include visible text "Northstar Systems"',
      '- the React source tree must include visible text "Book a launch review"',
      '- the React source tree must include ids "hero-section", "feature-grid", and "metrics-strip"',
      '- src/App.jsx must compose HeroSection, MetricsStrip, and FeatureGrid either inline or via local imports',
      '- keep the required ids on the rendered section roots even if you extract HeroSection, MetricsStrip, or FeatureGrid into local section files',
      '- if you use Button or Card in any extracted section file, keep explicit imports wired correctly from the shared ui primitives',
      '- src/styles.css must include the exact text --surface-strong',
      '- src/styles.css must include the exact text @media (max-width: 900px)',
      '- preserve src/components/ui/Button.jsx, src/components/ui/Card.jsx, and src/lib/utils.js as reusable primitives',
      '- use write_file for any file changes; do not call apply_patch',
      '- do not run npm install, vite dev, preview servers, or verification commands yourself',
      'Finish with a concise completion note once the build slice is done.'
    ].join('\n')
  });

  await assertReactLandingWorkspaceShape({
    packagePath,
    componentsConfigPath,
    viteConfigPath,
    mainPath,
    appPath,
    stylesPath,
    buttonPath,
    cardPath,
    utilsPath,
    requireExtendedSections: false
  });
  await expect.poll(async () => await readReactSourceTreeText(input.projectPath), { timeout: 30_000 }).toContain('id="hero-section"');
  await expect.poll(async () => await readReactSourceTreeText(input.projectPath), { timeout: 30_000 }).toContain('id="feature-grid"');
  await expect.poll(async () => await readReactSourceTreeText(input.projectPath), { timeout: 30_000 }).toContain('id="metrics-strip"');

  await submitStage({
    stageLabel: 'same-thread react landing refine',
    prompt: [
      'This is a same-thread refinement of the React landing page that already exists in the current workspace.',
      'Edit the app in place now. Do not rewrite this request into a plan, checklist, or explanation.',
      'Keep the same Vite, React, components.json, and reusable primitive structure.',
      'Do not add packages, do not add files, and do not run verification commands yourself.',
      'Requirements:',
      '- keep the existing ids "hero-section", "feature-grid", and "metrics-strip" somewhere in the React source tree',
      '- add ids "proof-strip", "testimonial-panel", and "cta-panel" somewhere in the React source tree',
      '- keep visible text "Northstar Systems" and "Book a launch review" somewhere in the React source tree',
      '- add the visible text "Operator-grade launch choreography" and "Trusted by release leads" somewhere in the React source tree',
      '- preserve reusable Button and Card usage instead of flattening everything into one anonymous div tree',
      '- keep explicit imports wired for every extracted section component and every shared ui primitive you reference',
      '- use write_file for any file changes; do not call apply_patch',
      'Finish with a concise completion note once the refinement is done.'
    ].join('\n')
  });

  await expect.poll(async () => await readReactSourceTreeText(input.projectPath), { timeout: 30_000 }).toContain('id="proof-strip"');
  await expect.poll(async () => await readReactSourceTreeText(input.projectPath), { timeout: 30_000 }).toContain('id="hero-section"');

  await writeFile(
    stylesPath,
    [
      ':root {',
      '  color-scheme: dark;',
      '  --surface-strong #1a1a1a;',
      '  background: #0f1012',
      '  color: #f6f7f4;',
      '}',
      '',
      'body {',
      '  margin: 0;',
      '  min-height: 100vh;',
      '  background: radial-gradient(circle at top, rgba(255,255,255,0.07), rgba(15,16,18,1));',
      '  color: inherit;',
      '}',
      '',
      '@media (max-width: 900px) {',
      '  body {',
      '    font-size: 15px;',
      '  }',
      '}'
    ].join('\n'),
    'utf8'
  );

  const completedThread = await submitStage({
    stageLabel: 'same-thread react landing repair',
    prompt: [
      'A regression was seeded after the last refinement and the React landing page no longer builds cleanly.',
      'Treat this as a targeted bugfix, not a redesign. Fix the existing app in place now and do not rewrite this request into a plan, checklist, or explanation.',
      'Keep the current Vite, React, components.json, and reusable primitive structure.',
      'Do not add packages, do not add files, and do not run verification commands yourself.',
      'Repair checklist:',
      '- src/styles.css must restore the exact text --surface-strong: with a valid CSS custom property declaration',
      '- src/styles.css must keep the exact text @media (max-width: 900px)',
      '- the final app must build successfully with vite build',
      '- preserve visible text "Northstar Systems", "Book a launch review", "Operator-grade launch choreography", and "Trusted by release leads" in the React source tree',
      '- preserve ids "hero-section", "feature-grid", "metrics-strip", "proof-strip", "testimonial-panel", and "cta-panel" in the React source tree',
      '- verify that every extracted section still renders its required id and that every shared ui primitive reference has a matching import before you finish',
      '- use write_file for any file changes; do not call apply_patch',
      'Finish with a concise completion note once the repair is done.'
    ].join('\n')
  });

  await assertReactLandingWorkspaceShape({
    packagePath,
    componentsConfigPath,
    viteConfigPath,
    mainPath,
    appPath,
    stylesPath,
    buttonPath,
    cardPath,
    utilsPath
  });
  await expect.poll(async () => await readReactSourceTreeText(input.projectPath), { timeout: 30_000 }).toContain('id="proof-strip"');
  await expect.poll(async () => await readFile(stylesPath, 'utf8'), { timeout: 30_000 }).toContain('--surface-strong:');

  const finalizedThread = await submitStage({
    stageLabel: 'same-thread react landing follow-through',
    prompt: [
      'This is a same-thread follow-through after the repair. Make one more minimal in-place update now without resetting the current design system or section structure.',
      'Do not rewrite this into a plan, checklist, or explanation.',
      'Keep the current Vite, React, components.json, and reusable primitive structure.',
      'Do not add packages, do not add files, and do not run verification commands yourself.',
      'Requirements:',
      '- preserve ids "hero-section", "feature-grid", "metrics-strip", "proof-strip", "testimonial-panel", and "cta-panel" in the React source tree',
      '- preserve visible text "Northstar Systems", "Book a launch review", "Operator-grade launch choreography", and "Trusted by release leads"',
      '- add visible text "Launch room pulse" and "Week-one handoff clarity" somewhere in the React source tree',
      '- keep HeroSection, MetricsStrip, and FeatureGrid composed either inline or through local imports',
      '- keep explicit imports wired for every extracted section component and every shared ui primitive reference',
      '- use write_file for any file changes; do not call apply_patch',
      'Finish with a concise completion note once the follow-through pass is done.'
    ].join('\n')
  });

  await expect.poll(async () => (await readReactSourceTreeText(input.projectPath)).toLowerCase(), {
    timeout: 30_000
  }).toContain('launch room pulse');
  await expect.poll(async () => (await readReactSourceTreeText(input.projectPath)).toLowerCase(), {
    timeout: 30_000
  }).toContain('week-one handoff clarity');

  await execFileAsync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
    cwd: input.projectPath
  });

  await withLocalProjectPreview(path.join(input.projectPath, 'dist', 'index.html'), async (preview) => {
    await expect(preview.locator('#hero-section')).toContainText('Northstar Systems');
    await expect(preview.locator('#metrics-strip')).toBeVisible();
    await expect(preview.locator('#feature-grid')).toBeVisible();
    await expect(preview.locator('#proof-strip')).toContainText('Trusted by release leads');
    await expect(preview.locator('#testimonial-panel')).toBeVisible();
    await expect(preview.locator('#cta-panel')).toContainText('Book a launch review');
    await expect(preview.locator('body')).toContainText(/Launch room pulse/i);
    await expect(preview.locator('body')).toContainText(/Week-one handoff clarity/i);
  });

  expect(finalizedThread.turns.filter((turn) => turn.role === 'user').length).toBeGreaterThanOrEqual(4);
  expect(
    finalizedThread.turns.filter((turn) => turn.role === 'assistant' && turn.content.trim().length > 0).length
  ).toBeGreaterThanOrEqual(4);

  return finalizedThread;
}

async function runExistingProjectRefinementBenchmark(window: Page, input: {
  providerId: 'openai' | 'gemini' | 'ollama';
  modelId: string;
  projectId: string;
  projectPath: string;
  threadId: string;
}) {
  const indexPath = path.join(input.projectPath, 'index.html');
  const stylesPath = path.join(input.projectPath, 'styles.css');
  const scriptPath = path.join(input.projectPath, 'app.js');

  await writeFile(
    indexPath,
    [
      '<!doctype html>',
      '<html lang="en">',
      '<head><meta charset="UTF-8"><title>Starter site</title><link rel="stylesheet" href="styles.css"></head>',
      '<body>',
      '  <main id="app-shell">',
      '    <section id="hero"><h1>Old Hero</h1><p>Replace this copy.</p><a href="#contact">Contact us</a></section>',
      '    <section id="features"><h2>Features</h2></section>',
      '    <div id="site-status">loading</div>',
      '  </main>',
      '  <script src="app.js"></script>',
      '</body>',
      '</html>'
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    stylesPath,
    ['body { background: #101010; color: #f5f5f5; }', '#app-shell { max-width: 960px; margin: 0 auto; }'].join('\n'),
    'utf8'
  );
  await writeFile(
    scriptPath,
    "document.getElementById('site-status').textContent = 'loading';\n",
    'utf8'
  );

  const submitted = await window.evaluate(
    async ({ projectId, threadId, providerId, modelId, prompt }) =>
      window.vicode.composer.submit({
        projectId,
        threadId,
        prompt,
        providerId,
        modelId,
        executionPermission: 'full_access',
        skillIds: []
      }),
    {
      projectId: input.projectId,
      threadId: input.threadId,
      providerId: input.providerId,
      modelId: input.modelId,
      prompt: [
        'Refine the existing tiny site in the current workspace without switching workspaces.',
        'Update the current files in place instead of recreating the project.',
        'Requirements:',
        '- change the hero title from "Old Hero" to "Signal Layer"',
        '- replace the hero link text with "See live board"',
        '- add a new section with id "proof"',
        '- styles.css must include the exact text box-shadow:',
        "- app.js must set document.getElementById('site-status').textContent to exactly 'refined'",
        'Reply with exactly: site refined.'
      ].join('\n')
    }
  );

  expect(submitted.disposition).toBe('started');
  const completedThread = await waitForThreadCompletion(window, input.threadId, 300_000);
  const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
  const assistantContent = (assistantTurn?.content ?? '').trim();
  expect(assistantContent.length).toBeGreaterThan(0);
  expect(assistantContent.toLowerCase()).not.toContain('couldn’t refine');
  expect(assistantContent.toLowerCase()).not.toContain("couldn't refine");
  expect(assistantContent.toLowerCase()).not.toContain('read-only filesystem sandbox');

  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Signal Layer');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('See live board');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="proof"');
  await expect.poll(async () => await readFile(stylesPath, 'utf8'), { timeout: 30_000 }).toContain('box-shadow:');
  await expect.poll(async () => await readFile(scriptPath, 'utf8'), { timeout: 30_000 }).toContain(
    "document.getElementById('site-status').textContent = 'refined'"
  );
}

async function runDocsSiteBenchmark(window: Page, input: {
  providerId: 'openai' | 'gemini' | 'ollama';
  modelId: string;
  projectId: string;
  projectPath: string;
  threadId: string;
}) {
  const indexPath = path.join(input.projectPath, 'index.html');
  const guidesPath = path.join(input.projectPath, 'guides.html');
  const stylesPath = path.join(input.projectPath, 'styles.css');
  const scriptPath = path.join(input.projectPath, 'app.js');

  const submitted = await window.evaluate(
    async ({ projectId, threadId, providerId, modelId, prompt }) =>
      window.vicode.composer.submit({
        projectId,
        threadId,
        prompt,
        providerId,
        modelId,
        executionPermission: 'full_access',
        skillIds: []
      }),
    {
      projectId: input.projectId,
      threadId: input.threadId,
      providerId: input.providerId,
      modelId: input.modelId,
      prompt: [
        'Build a small multi-page docs site in the current workspace root using real files.',
        'Write exactly these files: index.html, guides.html, styles.css, app.js.',
        'Requirements:',
        '- index.html must include the visible title "Signal Docs"',
        '- index.html must include visible navigation links "Overview", "Guides", and "API Reference"',
        '- guides.html must include the visible heading "Implementation Guide"',
        '- guides.html must include an element with id "checklist"',
        '- both HTML files must include a shared layout element with id "docs-shell"',
        '- styles.css must include the exact text .docs-sidebar',
        '- styles.css must include the exact text @media (max-width: 900px)',
        "- app.js must set document.documentElement.dataset.docsReady to exactly 'true'",
        'Reply with exactly: docs site built.'
      ].join('\n')
    }
  );

  expect(submitted.disposition).toBe('started');
  const completedThread = await waitForThreadCompletion(window, input.threadId, 300_000);
  const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
  const assistantContent = (assistantTurn?.content ?? '').trim();
  expect(assistantContent.length).toBeGreaterThan(0);
  expect(assistantContent.toLowerCase()).not.toContain('couldn’t build');
  expect(assistantContent.toLowerCase()).not.toContain("couldn't build");
  expect(assistantContent.toLowerCase()).not.toContain('read-only filesystem sandbox');

  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Signal Docs');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Overview');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Guides');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('API Reference');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="docs-shell"');
  await expect.poll(async () => await readFile(guidesPath, 'utf8'), { timeout: 30_000 }).toContain('Implementation Guide');
  await expect.poll(async () => await readFile(guidesPath, 'utf8'), { timeout: 30_000 }).toContain('id="checklist"');
  await expect.poll(async () => await readFile(guidesPath, 'utf8'), { timeout: 30_000 }).toContain('id="docs-shell"');
  await expect.poll(async () => await readFile(stylesPath, 'utf8'), { timeout: 30_000 }).toContain('.docs-sidebar');
  await expect.poll(async () => await readFile(stylesPath, 'utf8'), { timeout: 30_000 }).toContain('@media (max-width: 900px)');
  await expect.poll(async () => await readFile(scriptPath, 'utf8'), { timeout: 30_000 }).toContain(
    "document.documentElement.dataset.docsReady = 'true'"
  );
}

async function runAuthAppBenchmark(window: Page, input: {
  providerId: 'openai' | 'gemini';
  modelId: string;
  projectId: string;
  projectPath: string;
  threadId: string;
}) {
  const indexPath = path.join(input.projectPath, 'index.html');
  const stylesPath = path.join(input.projectPath, 'styles.css');
  const scriptPath = path.join(input.projectPath, 'app.js');

  const submitted = await window.evaluate(
    async ({ projectId, threadId, providerId, modelId, prompt }) =>
      window.vicode.composer.submit({
        projectId,
        threadId,
        prompt,
        providerId,
        modelId,
        executionPermission: 'full_access',
        skillIds: []
      }),
    {
      projectId: input.projectId,
      threadId: input.threadId,
      providerId: input.providerId,
      modelId: input.modelId,
      prompt: [
        'Build a small auth-aware app shell in the current workspace root using real files.',
        'Write exactly these files: index.html, styles.css, app.js.',
        'This is a local demo auth flow, not a real backend integration.',
        'Requirements:',
        '- index.html must include an app shell element with id "auth-shell"',
        '- index.html must include a sign-in form with id "signin-form"',
        '- index.html must include a protected view with id "protected-view"',
        '- index.html must include the visible text "Workspace login"',
        '- index.html must include the visible text "Demo auth only"',
        '- index.html must include the visible text "Signed in"',
        '- styles.css must include the exact text .auth-card',
        '- styles.css must include the exact text .protected-view',
        "- app.js must set document.documentElement.dataset.authReady to exactly 'true'",
        '- app.js must track a session variable',
        '- app.js must guard the protected view when no session exists',
        'Reply with exactly: auth app built.'
      ].join('\n')
    }
  );

  expect(submitted.disposition).toBe('started');
  const completedThread = await waitForThreadCompletion(window, input.threadId, 300_000);
  const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
  const assistantContent = (assistantTurn?.content ?? '').trim();
  expect(assistantContent.length).toBeGreaterThan(0);
  expect(assistantContent.toLowerCase()).not.toContain('couldn’t build');
  expect(assistantContent.toLowerCase()).not.toContain("couldn't build");
  expect(assistantContent.toLowerCase()).not.toContain('read-only filesystem sandbox');

  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="auth-shell"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="signin-form"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="protected-view"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Workspace login');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Demo auth only');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Signed in');
  await expect.poll(async () => await readFile(stylesPath, 'utf8'), { timeout: 30_000 }).toContain('.auth-card');
  await expect.poll(async () => await readFile(stylesPath, 'utf8'), { timeout: 30_000 }).toContain('.protected-view');
  await expect.poll(async () => await readFile(scriptPath, 'utf8'), { timeout: 30_000 }).toContain(
    "document.documentElement.dataset.authReady = 'true'"
  );
  await expect.poll(async () => await readFile(scriptPath, 'utf8'), { timeout: 30_000 }).toMatch(/(?:let|const)\s+session\b/);
  await expect.poll(async () => await readFile(scriptPath, 'utf8'), { timeout: 30_000 }).toMatch(/protected-view|protectedView/);
}

async function runBugfixSliceBenchmark(window: Page, input: {
  providerId: 'openai' | 'gemini' | 'ollama';
  modelId: string;
  projectId: string;
  projectPath: string;
  threadId: string;
}) {
  const indexPath = path.join(input.projectPath, 'index.html');
  const scriptPath = path.join(input.projectPath, 'app.js');

  await writeFile(
    indexPath,
    [
      '<!doctype html>',
      '<html lang="en">',
      '<head><meta charset="UTF-8"><title>Buggy status panel</title></head>',
      '<body>',
      '  <main>',
      '    <button id="refresh-status">Refresh status</button>',
      '    <div id="site-status">broken</div>',
      '  </main>',
      '  <script src="app.js"></script>',
      '</body>',
      '</html>'
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    scriptPath,
    [
      "const button = document.getElementById('refresh-status');",
      "const status = document.getElementById('status');",
      '',
      "button.addEventListener('click', () => {",
      "  status.textContent = 'done';",
      '});'
    ].join('\n'),
    'utf8'
  );

  const submitted = await window.evaluate(
    async ({ projectId, threadId, providerId, modelId, prompt }) =>
      window.vicode.composer.submit({
        projectId,
        threadId,
        prompt,
        providerId,
        modelId,
        executionPermission: 'full_access',
        skillIds: []
      }),
    {
      projectId: input.projectId,
      threadId: input.threadId,
      providerId: input.providerId,
      modelId: input.modelId,
      prompt: [
        'Diagnose and fix the broken status panel in the current workspace.',
        'Keep the existing file structure and repair the bug in place.',
        'Requirements:',
        "- app.js must stop querying document.getElementById('status')",
        "- app.js must update the element with id 'site-status'",
        "- app.js must set the clicked result text to exactly 'bug fixed'",
        "- app.js must still include addEventListener('click'",
        'Reply with exactly: bug fixed.'
      ].join('\n')
    }
  );

  expect(submitted.disposition).toBe('started');
  const completedThread = await waitForThreadCompletion(window, input.threadId, 300_000);
  const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
  const assistantContent = (assistantTurn?.content ?? '').trim();
  expect(assistantContent.length).toBeGreaterThan(0);
  expect(assistantContent.toLowerCase()).not.toContain('couldn’t fix');
  expect(assistantContent.toLowerCase()).not.toContain("couldn't fix");
  expect(assistantContent.toLowerCase()).not.toContain('read-only filesystem sandbox');

  await expect.poll(async () => await readFile(scriptPath, 'utf8'), { timeout: 30_000 }).toContain("document.getElementById('site-status')");
  await expect.poll(async () => await readFile(scriptPath, 'utf8'), { timeout: 30_000 }).not.toContain("document.getElementById('status')");
  await expect.poll(async () => await readFile(scriptPath, 'utf8'), { timeout: 30_000 }).toContain("addEventListener('click'");
  await expect.poll(async () => await readFile(scriptPath, 'utf8'), { timeout: 30_000 }).toContain("'bug fixed'");
}

async function runCrudAppBenchmark(window: Page, input: {
  providerId: 'openai' | 'gemini' | 'ollama';
  modelId: string;
  projectId: string;
  projectPath: string;
  threadId: string;
}) {
  const indexPath = path.join(input.projectPath, 'index.html');
  const stylesPath = path.join(input.projectPath, 'styles.css');
  const appPath = path.join(input.projectPath, 'app.js');
  const dataPath = path.join(input.projectPath, 'data.js');

  await writeFile(
    indexPath,
    [
      '<!doctype html>',
      '<html lang="en">',
      '<head><meta charset="UTF-8"><title>Task Board</title><link rel="stylesheet" href="styles.css"></head>',
      '<body>',
      '  <main id="task-app">',
      '    <header class="topbar"><h1>Task Board</h1></header>',
      '    <section id="controls-panel">',
      '      <form id="new-task-form">',
      '        <input id="task-title-input" name="title" placeholder="New task title" />',
      '        <select id="task-status-input" name="status">',
      '          <option value="todo">Todo</option>',
      '          <option value="in-progress">In progress</option>',
      '          <option value="done">Done</option>',
      '        </select>',
      '        <button type="submit">Add task</button>',
      '      </form>',
      '    </section>',
      '    <section id="tasks-panel">',
      '      <h2>Tasks</h2>',
      '      <div id="task-list"></div>',
      '    </section>',
      '    <div id="crud-status">loading</div>',
      '  </main>',
      '  <script type="module" src="app.js"></script>',
      '</body>',
      '</html>'
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    stylesPath,
    [
      'body { background: #111; color: #f5f5f5; font-family: sans-serif; }',
      '#task-app { max-width: 1040px; margin: 0 auto; padding: 32px; }',
      '#new-task-form { display: flex; gap: 12px; margin-bottom: 24px; }',
      '#task-list { display: grid; gap: 12px; }',
      '.task-row { border: 1px solid #333; padding: 16px; }'
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    dataPath,
    [
      'export const tasks = [',
      "  { id: 'task-1', title: 'Ship dashboard shell', status: 'todo' },",
      "  { id: 'task-2', title: 'Review alerts', status: 'in-progress' },",
      "  { id: 'task-3', title: 'Publish release notes', status: 'done' }",
      '];'
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    appPath,
    [
      "import { tasks } from './data.js';",
      '',
      "const list = document.getElementById('task-list');",
      "const form = document.getElementById('new-task-form');",
      "const titleInput = document.getElementById('task-title-input');",
      "const statusInput = document.getElementById('task-status-input');",
      "const status = document.getElementById('crud-status');",
      'const state = { tasks: [...tasks] };',
      '',
      'function renderTasks() {',
      "  list.innerHTML = state.tasks.map((task) => `<article class=\"task-row\"><strong>${task.title}</strong><span>${task.status}</span></article>`).join('');",
      '}',
      '',
      "form.addEventListener('submit', (event) => {",
      '  event.preventDefault();',
      '  state.tasks.push({',
      "    id: `task-${Date.now()}`,",
      '    title: titleInput.value.trim(),',
      '    status: statusInput.value',
      '  });',
      '  renderTasks();',
      "  titleInput.value = '';",
      '});',
      '',
      'renderTasks();',
      "status.textContent = 'loaded';"
    ].join('\n'),
    'utf8'
  );

  const submitted = await window.evaluate(
    async ({ projectId, threadId, providerId, modelId, prompt }) =>
      window.vicode.composer.submit({
        projectId,
        threadId,
        prompt,
        providerId,
        modelId,
        executionPermission: 'full_access',
        skillIds: []
      }),
    {
      projectId: input.projectId,
      threadId: input.threadId,
      providerId: input.providerId,
      modelId: input.modelId,
      prompt: [
        'Extend the existing CRUD app in the current workspace without replacing the project structure.',
        'Edit index.html, styles.css, and app.js directly. Keep data.js imported from ./data.js.',
        'Preserve the current add-task flow and the existing element ids that are already present.',
        'Requirements:',
        '- index.html must keep the existing id "task-list"',
        '- index.html must keep the existing form id "new-task-form"',
        '- add a filter control with id "status-filter"',
        '- add a visible panel or section titled "Edit task"',
        '- add the visible validation text "Title is required"',
        '- styles.css must include the exact text .filter-select',
        '- styles.css must include the exact text .task-edit-panel',
        '- app.js must still import from ./data.js',
        '- app.js must define function updateTask(',
        '- app.js must contain a statusFilter variable or constant',
        "- app.js must set document.getElementById('crud-status').textContent to exactly 'crud feature ready'",
        '- prefer rewriting full files with write_file for index.html, styles.css, and app.js instead of using apply_patch',
        'You may rewrite app.js completely if needed, but keep the app as a working CRUD-style task board.',
        'Reply with exactly: crud feature built.'
      ].join('\n')
    }
  );

  expect(submitted.disposition).toBe('started');
  const completedThread = await waitForThreadCompletion(window, input.threadId, 300_000);
  const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
  const assistantContent = (assistantTurn?.content ?? '').trim();
  expect(assistantContent.length).toBeGreaterThan(0);
  expect(assistantContent.toLowerCase()).not.toContain('couldn’t build');
  expect(assistantContent.toLowerCase()).not.toContain("couldn't build");
  expect(assistantContent.toLowerCase()).not.toContain('read-only filesystem sandbox');

  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="task-list"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="new-task-form"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="status-filter"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Edit task');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Title is required');
  await expect.poll(async () => await readFile(stylesPath, 'utf8'), { timeout: 30_000 }).toContain('.filter-select');
  await expect.poll(async () => await readFile(stylesPath, 'utf8'), { timeout: 30_000 }).toContain('.task-edit-panel');
  await expect.poll(async () => await readFile(appPath, 'utf8'), { timeout: 30_000 }).toContain("from './data.js'");
  await expect.poll(async () => await readFile(appPath, 'utf8'), { timeout: 30_000 }).toContain('function updateTask(');
  await expect.poll(async () => await readFile(appPath, 'utf8'), { timeout: 30_000 }).toMatch(/statusFilter/);
  await expect.poll(async () => await readFile(appPath, 'utf8'), { timeout: 30_000 }).toMatch(
    /(?:document\.getElementById\('crud-status'\)|crudStatus(?:El)?|status)\.textContent = 'crud feature ready'/
  );
}

async function runSameThreadComplexProjectBenchmark(window: Page, input: {
  providerId: 'openai' | 'gemini' | 'ollama';
  modelId: string;
  projectId: string;
  projectPath: string;
  threadId: string;
  skillIds?: string[];
  promptPrefixLines?: string[];
  stageTimeoutMs?: number;
}) {
  const stageTimeoutMs = input.stageTimeoutMs ?? (input.providerId === 'openai' || input.providerId === 'gemini' ? 240_000 : 150_000);
  const indexPath = path.join(input.projectPath, 'index.html');
  const stylesPath = path.join(input.projectPath, 'styles.css');
  const appPath = path.join(input.projectPath, 'app.js');
  const dataPath = path.join(input.projectPath, 'data.js');

  await writeFile(
    indexPath,
    [
      '<!doctype html>',
      '<html lang="en">',
      '<head><meta charset="UTF-8"><title>Release Tasks</title><link rel="stylesheet" href="styles.css"></head>',
      '<body>',
      '  <main id="task-app">',
      '    <header class="topbar"><h1>Release tasks</h1></header>',
      '    <section id="controls-panel">',
      '      <form id="new-task-form">',
      '        <input id="task-title-input" name="title" placeholder="New task title" />',
      '        <select id="task-status-input" name="status">',
      '          <option value="todo">Todo</option>',
      '          <option value="in-progress">In progress</option>',
      '          <option value="done">Done</option>',
      '        </select>',
      '        <button type="submit">Add task</button>',
      '      </form>',
      '    </section>',
      '    <section id="tasks-panel">',
      '      <h2>Tasks</h2>',
      '      <div id="task-list"></div>',
      '    </section>',
      '    <div id="crud-status">loading</div>',
      '  </main>',
      '  <script type="module" src="app.js"></script>',
      '</body>',
      '</html>'
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    stylesPath,
    [
      'body { background: #111; color: #f5f5f5; font-family: sans-serif; }',
      '#task-app { max-width: 1100px; margin: 0 auto; padding: 32px; }',
      '#new-task-form { display: flex; gap: 12px; margin-bottom: 24px; }',
      '#task-list { display: grid; gap: 12px; }',
      '.task-row { border: 1px solid #333; padding: 16px; }'
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    dataPath,
    [
      'export const tasks = [',
      "  { id: 'task-1', title: 'Ship release notes', status: 'todo', owner: 'Ava', lane: 'Docs' },",
      "  { id: 'task-2', title: 'Verify dashboard shell', status: 'in-progress', owner: 'Mika', lane: 'Frontend' },",
      "  { id: 'task-3', title: 'Close QA sweep', status: 'done', owner: 'Noah', lane: 'QA' }",
      '];'
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    appPath,
    [
      "import { tasks } from './data.js';",
      '',
      "const list = document.getElementById('task-list');",
      "const form = document.getElementById('new-task-form');",
      "const titleInput = document.getElementById('task-title-input');",
      "const statusInput = document.getElementById('task-status-input');",
      "const status = document.getElementById('crud-status');",
      'const state = { tasks: [...tasks] };',
      '',
      'function renderTasks() {',
      "  list.innerHTML = state.tasks.map((task) => `<article class=\"task-row\"><strong>${task.title}</strong><span>${task.status}</span></article>`).join('');",
      '}',
      '',
      "form.addEventListener('submit', (event) => {",
      '  event.preventDefault();',
      '  state.tasks.push({',
      "    id: `task-${Date.now()}`,",
      '    title: titleInput.value.trim(),',
      '    status: statusInput.value,',
      "    owner: 'Unassigned',",
      "    lane: 'Backlog'",
      '  });',
      '  renderTasks();',
      "  titleInput.value = '';",
      '});',
      '',
      'renderTasks();',
      "status.textContent = 'loaded';"
    ].join('\n'),
    'utf8'
  );

  const submitStage = async (stageInput: {
    prompt: string;
    stageLabel: string;
    expectedReply?: string;
    timeoutMs?: number;
  }) => {
    const maxAttempts = input.providerId === 'openai' ? 2 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await appendMixedUseTimelineLine(
        input.providerId,
        `- ${new Date().toISOString()}: ${stageInput.stageLabel} attempt ${attempt} starting`
      );
      const submitted = await window.evaluate(
        async ({ projectId, threadId, providerId, modelId, prompt, skillIds }) =>
          window.vicode.composer.submit({
            projectId,
            threadId,
            prompt,
            providerId,
            modelId,
            executionPermission: 'full_access',
            skillIds
          }),
        {
          projectId: input.projectId,
          threadId: input.threadId,
          providerId: input.providerId,
          modelId: input.modelId,
          prompt: [
            ...(input.promptPrefixLines ?? []),
            stageInput.prompt
          ].join('\n\n'),
          skillIds: input.skillIds ?? []
        }
      );

      expect(submitted.disposition).toBe('started');
      await appendMixedUseTimelineLine(
        input.providerId,
        `- ${new Date().toISOString()}: ${stageInput.stageLabel} attempt ${attempt} started run ${submitted.runId}`
      );

      try {
        const { detail: completedThread, assistantTurn } = await waitForRunCompletion(
          window,
          input.threadId,
          submitted.runId,
          stageInput.timeoutMs ?? 150_000,
          stageInput.stageLabel
        );
        const assistantContent = assistantTurn.content.trim();
        expect(assistantContent.length).toBeGreaterThan(0);
        if ((stageInput.expectedReply ?? '').length > 0) {
          expect(assistantContent.toLowerCase()).toContain(stageInput.expectedReply ?? '');
        }
        await appendMixedUseTimelineLine(
          input.providerId,
          `- ${new Date().toISOString()}: ${stageInput.stageLabel} attempt ${attempt} completed with thread status ${completedThread.status}`
        );
        return completedThread;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const detail = await window.evaluate(async ({ threadId }) => window.vicode.threads.open(threadId), {
          threadId: input.threadId
        });
        await writeMixedUseFailureSnapshot(input.providerId, {
          stageLabel: stageInput.stageLabel,
          attempt,
          runId: submitted.runId,
          message,
          threadStatus: detail.status,
          lastTurns: detail.turns.slice(-4),
          lastRawOutput: detail.rawOutput?.slice(-12) ?? []
        });
        await appendMixedUseTimelineLine(
          input.providerId,
          `- ${new Date().toISOString()}: ${stageInput.stageLabel} attempt ${attempt} failed: ${message}`
        );
        if (attempt < maxAttempts && isCodexIdleAfterPartialOutputFailure(message)) {
          await appendMixedUseTimelineLine(
            input.providerId,
            `- ${new Date().toISOString()}: ${stageInput.stageLabel} attempt ${attempt} retrying after Codex idle partial-output failure`
          );
          continue;
        }
        throw error;
      }
    }

    throw new Error(`${stageInput.stageLabel}: run did not complete after retry attempts.`);
  };

  await submitStage({
    stageLabel: 'same-thread complex project build',
    timeoutMs: stageTimeoutMs,
    prompt: [
      'Extend the existing release task board into a larger multi-file feature slice without replacing the project structure.',
      'Implement the feature slice now. Do not output a brief, plan, checklist, or explanation.',
      'Edit only index.html, styles.css, and app.js directly now. Keep data.js imported from ./data.js and do not add files, folders, or a new stack.',
      'Do not add packages, do not add new files, and do not run verification commands after the edits.',
      'Preserve the current add-task flow and the existing element ids that are already present.',
      'Requirements:',
      '- index.html must keep the existing id "task-list"',
      '- index.html must keep the existing form id "new-task-form"',
      '- add a search input with id "task-search"',
      '- add a detail panel with id "task-detail"',
      '- add the visible heading "Release board"',
      '- on first load, the detail panel must show the first seeded task title from data.js plus owner or lane context',
      "- typing 'release' into the search input must filter the list down to the 'Ship release notes' task",
      "- app.js must set document.getElementById('crud-status').textContent to exactly 'complex slice ready'",
      '- prefer rewriting full files with write_file for index.html, styles.css, and app.js instead of using apply_patch',
      '- do not launch preview servers, npm dev, python -m http.server, or any other long-running command',
      'Finish with a concise completion note once the feature slice is built.'
    ].join('\n'),
    expectedReply: ''
  });

  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="task-list"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="new-task-form"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="task-search"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="task-detail"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Release board');
  await expect.poll(async () => await readFile(appPath, 'utf8'), { timeout: 30_000 }).toContain("from './data.js'");
  await validateSameThreadComplexProjectStageOne(indexPath);

  await submitStage({
    stageLabel: 'same-thread complex project refine',
    timeoutMs: stageTimeoutMs,
    prompt: [
      'This is a same-thread refinement of the release planning app that already exists in the current workspace.',
      'Edit the app in place now. Do not rewrite this request into a plan, brief, checklist, or explanation.',
      'Do not add packages, do not add new files, and do not run verification commands after the edits.',
      'Keep editing index.html, styles.css, and app.js in place instead of recreating the project.',
      'Do not edit data.js in this stage.',
      'Preserve the existing ids task-list, new-task-form, task-search, and task-detail.',
      'Requirements:',
      '- add a summary card with id "summary-panel"',
      '- add a clear-done button with id "clear-done"',
      '- add the visible text "Release lane"',
      '- the summary panel should show the number of visible tasks and initially display 3 visible tasks',
      '- the clear-done action should remove done tasks',
      '- preserve the searchable detail-panel behavior from the previous stage, including the selected task title',
      "- app.js must still set the visible status to 'complex project refined'",
      '- prefer rewriting full files with write_file for index.html, styles.css, and app.js instead of using apply_patch',
      '- do not launch preview servers, npm dev, python -m http.server, or any other long-running command',
      'Finish with a concise completion note once the refinement is done.'
    ].join('\n'),
    expectedReply: ''
  });

  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="summary-panel"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="clear-done"');
  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Release lane');
  await validateSameThreadComplexProjectStageTwo(indexPath);

  await writeFile(
    appPath,
    [
      "import { tasks } from './data.js';",
      '',
      "const list = document.getElementById('task-list');",
      "const form = document.getElementById('new-task-form');",
      "const titleInput = document.getElementById('task-title-input');",
      "const statusInput = document.getElementById('task-status-input');",
      "const searchInput = document.getElementById('task-serach');",
      "const detailPanel = document.getElementById('task-detail');",
      "const summaryPanel = document.getElementById('summary-panel');",
      "const clearDoneButton = document.getElementById('clear-done');",
      "const status = document.getElementById('crud-status');",
      'const state = { tasks: [...tasks], query: "" };',
      '',
      'function getVisibleTasks() {',
      '  return state.tasks.filter((task) => task.title.toLowerCase().includes(state.query));',
      '}',
      '',
      'function renderTaskDetail(task) {',
      '  if (!detailPanel) return;',
      "  detailPanel.textContent = task ? `${task.title} · ${task.owner} · ${task.lane}` : 'Select a task';",
      '}',
      '',
      'function renderSummary() {',
      '  if (!summaryPanel) return;',
      "  summaryPanel.textContent = `Visible tasks: ${getVisibleTasks().length}`;",
      '}',
      '',
      'function renderTasks() {',
      "  const visibleTasks = getVisibleTasks();",
      "  list.innerHTML = visibleTasks.map((task) => `<article class=\"task-row\"><strong>${task.title}</strong><span>${task.status}</span></article>`).join('');",
      '  renderTaskDetail(visibleTasks[0] ?? null);',
      '  renderSummary();',
      '}',
      '',
      'function updateTask(id, patch) {',
      '  state.tasks = state.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task));',
      '  renderTasks();',
      '}',
      '',
      "form?.addEventListener('submit', (event) => {",
      '  event.preventDefault();',
      '  state.tasks.push({',
      "    id: `task-${Date.now()}`,",
      '    title: titleInput?.value.trim() ?? "",',
      '    status: statusInput?.value ?? "todo",',
      "    owner: 'Unassigned',",
      "    lane: 'Backlog'",
      '  });',
      '  renderTasks();',
      '});',
      '',
      "searchInput?.addEventListener('input', () => {",
      '  state.query = searchInput.value.trim().toLowerCase();',
      '  renderTasks();',
      '});',
      '',
      "clearDoneButton?.addEventListener('click', () => {",
      "  state.tasks = state.tasks.filter((task) => task.status !== 'done');",
      '  renderTasks();',
      '});',
      '',
      'renderTasks();',
      "status.textContent = 'search broken';"
    ].join('\n'),
    'utf8'
  );

  const completedThread = await submitStage({
    stageLabel: 'same-thread complex project repair',
    timeoutMs: stageTimeoutMs,
    prompt: [
      'A regression was seeded after the last refinement and the release board no longer works correctly.',
      'Treat this as a targeted bugfix, not a redesign. Fix the existing app in place now and do not rewrite this request into a plan, brief, checklist, or explanation.',
      'Update app.js first unless a very small supporting HTML or CSS edit is required. Keep data.js as the source import and preserve the existing ids task-list, new-task-form, task-search, task-detail, summary-panel, and clear-done.',
      'Do not add packages, do not add new files, and do not run verification commands after the edits.',
      'Repair checklist:',
      "- the search input id is task-search and app.js must bind to document.getElementById('task-search')",
      '- remove the seeded typo task-serach entirely',
      '- loading index.html in a browser must immediately render the seeded tasks from data.js',
      "- searching for 'release' must leave only the 'Ship release notes' task visible",
      '- the detail panel must show the selected task title after filtering',
      '- the summary panel must show the number of visible tasks',
      '- the clear-done button must remove done tasks',
      "- the visible status must become 'complex project repaired'",
      '- keep the current HTML structure and repair the broken behavior instead of replacing the app with a new concept',
      '- use write_file for any file changes; do not call apply_patch',
      '- do not launch preview servers, npm dev, python -m http.server, or any other long-running command',
      'Finish with a concise completion note once the repair is done.'
    ].join('\n'),
    expectedReply: ''
  });

  await validateSameThreadComplexProjectStageThree(indexPath);
  const finalizedThread = await submitStage({
    stageLabel: 'same-thread complex project follow-through',
    timeoutMs: stageTimeoutMs,
    prompt: [
      'This is one more same-thread follow-through after the repair. Make a minimal in-place update now without resetting the current release-board structure.',
      'Do not rewrite this into a plan, brief, checklist, or explanation.',
      'Keep editing index.html, styles.css, and app.js in place. Do not add packages, files, or verification commands.',
      'Preserve ids task-list, new-task-form, task-search, task-detail, summary-panel, and clear-done.',
      'Requirements:',
      '- add a lightweight metadata row with id "board-meta"',
      '- add visible text "Next ship window"',
      '- preserve the repaired search, detail, summary, and clear-done behavior',
      "- app.js must keep the visible status as 'complex project repaired'",
      '- use write_file for any file changes; do not call apply_patch',
      'Finish with a concise completion note once the follow-through pass is done.'
    ].join('\n'),
    expectedReply: ''
  });

  await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="board-meta"');
  await expect.poll(async () => (await readFile(indexPath, 'utf8')).toLowerCase(), { timeout: 30_000 }).toContain(
    'next ship window'
  );

  expect(finalizedThread.turns.filter((turn) => turn.role === 'user').length).toBeGreaterThanOrEqual(4);
  expect(
    finalizedThread.turns.filter((turn) => turn.role === 'assistant' && turn.content.trim().length > 0).length
  ).toBeGreaterThanOrEqual(4);
}

async function withLocalProjectPreview<T>(indexPath: string, callback: (preview: Page) => Promise<T>) {
  const projectRoot = path.dirname(indexPath);
  const indexName = path.basename(indexPath);
  const responseErrors: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      const requestPath = requestUrl.pathname === '/' ? indexName : requestUrl.pathname.replace(/^\/+/, '');
      const resolvedPath = path.resolve(projectRoot, requestPath);
      const relativePath = path.relative(projectRoot, resolvedPath);

      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        response.writeHead(403).end('Forbidden');
        return;
      }

      const body = await readFile(resolvedPath);
      const extension = path.extname(resolvedPath).toLowerCase();
      const contentType =
        extension === '.html'
          ? 'text/html; charset=utf-8'
          : extension === '.css'
            ? 'text/css; charset=utf-8'
            : extension === '.js' || extension === '.mjs'
              ? 'text/javascript; charset=utf-8'
              : extension === '.json'
                ? 'application/json; charset=utf-8'
                : extension === '.svg'
                  ? 'image/svg+xml'
                  : extension === '.png'
                    ? 'image/png'
                    : extension === '.jpg' || extension === '.jpeg'
                      ? 'image/jpeg'
                      : extension === '.webp'
                        ? 'image/webp'
                        : extension === '.ico'
                          ? 'image/x-icon'
                          : extension === '.woff2'
                            ? 'font/woff2'
                            : extension === '.woff'
                              ? 'font/woff'
                              : extension === '.ttf'
                                ? 'font/ttf'
                                : extension === '.map'
                                  ? 'application/json; charset=utf-8'
                                  : 'text/plain; charset=utf-8';

      response.writeHead(200, { 'Content-Type': contentType });
      response.end(body);
    } catch {
      responseErrors.push(`${request.url ?? '/'} -> 404`);
      response.writeHead(404).end('Not found');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise((resolve) => server.close(resolve));
    throw new Error('Local preview server did not expose a TCP port.');
  }

  const browser = await chromium.launch({ headless: true });
  const preview = await browser.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  preview.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  preview.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  preview.on('requestfailed', (request) => {
    requestFailures.push(`${request.method()} ${request.url()} -> ${request.failure()?.errorText ?? 'request failed'}`);
  });
  try {
    await preview.goto(`http://127.0.0.1:${address.port}/${indexName}`, { waitUntil: 'load' });
    await preview.waitForLoadState('networkidle').catch(() => undefined);
    try {
      return await callback(preview);
    } catch (error) {
      const diagnostics = [
        ...responseErrors.map((entry) => `response: ${entry}`),
        ...requestFailures.map((entry) => `request: ${entry}`),
        ...pageErrors.map((entry) => `pageerror: ${entry}`),
        ...consoleErrors.map((entry) => `console: ${entry}`)
      ];
      if (error instanceof Error && diagnostics.length > 0) {
        error.message = `${error.message}\nPreview diagnostics:\n${diagnostics.join('\n')}`;
      }
      throw error;
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function validateSameThreadComplexProjectStageOne(indexPath: string) {
  await withLocalProjectPreview(indexPath, async (preview) => {
    await expect(preview.getByRole('heading', { name: 'Release board' })).toBeVisible();
    await expect(preview.locator('#task-search')).toBeVisible();
    await expect(preview.locator('#task-detail')).toBeVisible();
    await expect(preview.locator('#task-detail')).toContainText(/ship release notes/i);
    await expect(preview.locator('#task-detail')).toContainText(/ava|docs/i);
    await preview.locator('#task-search').fill('release');
    await expect(preview.locator('#task-list')).toContainText(/ship release notes/i);
    await expect(preview.locator('#task-list')).not.toContainText(/verify dashboard shell/i);
  });
}

async function validateSameThreadComplexProjectStageTwo(indexPath: string) {
  await withLocalProjectPreview(indexPath, async (preview) => {
    await expect(preview.locator('#summary-panel')).toBeVisible();
    await expect(preview.locator('#clear-done')).toBeVisible();
    await expect(preview.locator('body')).toContainText('Release lane');
    await expect(preview.locator('#summary-panel')).toContainText(/3/);
  });
}

async function validateSameThreadComplexProjectStageThree(indexPath: string) {
  await withLocalProjectPreview(indexPath, async (preview) => {
    await expect(preview.locator('#crud-status')).toHaveText('complex project repaired');
    await preview.locator('#task-search').fill('release');
    await expect(preview.locator('#task-list')).toContainText(/ship release notes/i);
    await expect(preview.locator('#task-list')).not.toContainText(/verify dashboard shell/i);
    await expect(preview.locator('#summary-panel')).toContainText(/1/);
    await expect(preview.locator('#task-detail')).toContainText(/ship release notes/i);
    await preview.locator('#task-search').fill('');
    await preview.locator('#clear-done').click();
    await expect(preview.locator('#task-list')).not.toContainText(/close qa sweep/i);
  });
}

async function ensureProject(window: Page, projectName: string, folderPath: string) {
  await mkdir(folderPath, { recursive: true });
  return await window.evaluate(
    async ({ projectName, folderPath }) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const existing = bootstrap.projects.find((project) => project.name === projectName);
      if (existing) {
        const updated = await window.vicode.projects.update({
          id: existing.id,
          folderPath,
          trusted: true
        });
        return updated;
      }

      return await window.vicode.projects.create({
        name: projectName,
        folderPath,
        trusted: true
      });
    },
    { projectName, folderPath }
  );
}

async function createWorkspaceSteeringDecoyRepo(folderPath: string) {
  const files = [
    {
      relativePath: path.join('src', 'App.jsx'),
      content: `export default function App() {\n  return <main data-decoy-marker="workspace-steering-app">Decoy app shell</main>;\n}\n`
    },
    {
      relativePath: path.join('src', 'components', 'sections', 'home', 'HeroSection.jsx'),
      content:
        `export function HeroSection() {\n  return (\n    <section data-decoy-marker="workspace-steering-hero">\n      <h1>Decoy hero headline</h1>\n      <p>Stay unchanged unless the active workspace explicitly points here.</p>\n    </section>\n  );\n}\n`
    },
    {
      relativePath: path.join('src', 'content', 'siteContent.js'),
      content:
        `export const siteContent = {\n  hero: {\n    eyebrow: 'Decoy eyebrow',\n    title: 'Decoy title',\n    description: 'This file should remain unchanged during workspace steering certification.'\n  }\n};\n`
    }
  ] as const;

  for (const file of files) {
    const filePath = path.join(folderPath, file.relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content, 'utf8');
  }

  const snapshot = await Promise.all(
    files.map(async (file) => {
      const absolutePath = path.join(folderPath, file.relativePath);
      return [absolutePath, await readFile(absolutePath, 'utf8')] as const;
    })
  );

  return Object.fromEntries(snapshot);
}

async function expectWorkspaceSteeringDidNotTouchDecoyRepo(decoySnapshot: Record<string, string>) {
  const currentContents = await Promise.all(
    Object.keys(decoySnapshot).map(async (filePath) => [filePath, await readFile(filePath, 'utf8')] as const)
  );

  for (const [filePath, content] of currentContents) {
    expect(content).toBe(decoySnapshot[filePath]);
  }
}

async function getBootstrap(window: Page) {
  return await window.evaluate(() => window.vicode.app.getBootstrap());
}

async function getProvider(window: Page, providerId: 'openai' | 'gemini' | 'ollama' | 'qwen' | 'kimi') {
  const bootstrap = await getBootstrap(window);
  const provider = bootstrap.providers.find((entry) => entry.id === providerId);
  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`);
  }
  return provider;
}

async function submitComposerPrompt(window: Page, prompt: string) {
  const composer = window.getByTestId('composer-input');
  await composer.fill(prompt);
  await composer.press('Enter');
}

async function resetComposer(window: Page) {
  const composer = window.getByTestId('composer-input');
  await composer.click();
  await composer.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await composer.press('Backspace');
  await expect(composer).toHaveValue('');
}

async function selectSlashCommand(window: Page, token: string) {
  const composer = window.getByTestId('composer-input');
  await composer.click();
  await composer.pressSequentially(`/${token}`);
  await composer.press('Enter');
  await expect(window.locator('.composer-command-chip')).toContainText(`/${token}`);
}

async function createThread(
  window: Page,
  projectId: string,
  providerId: 'openai' | 'gemini' | 'ollama' | 'qwen' | 'kimi',
  modelId: string
) {
  return await window.evaluate(
    async ({ projectId, providerId, modelId }) =>
      window.vicode.threads.create({
        projectId,
        providerId,
        modelId,
        executionPermission: 'default'
      }),
    { projectId, providerId, modelId }
  );
}

async function createCertificationSkill(
  window: Page,
  providerId: 'openai' | 'gemini' | 'ollama' | 'qwen' | 'kimi',
  options?: { namePrefix?: string; description?: string; instructions?: string }
) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return await window.evaluate(
    async ({ providerId, suffix, namePrefix, description, instructions }) =>
      window.vicode.skills.save({
        name: `${namePrefix ?? `live-cert-${providerId}`}-${suffix}`,
        description: description ?? `Deterministic live certification prompt skill for ${providerId}.`,
        instructions: instructions ?? 'Follow the user request exactly. Keep the answer concise and do not add extra framing.',
        scope: 'global',
        providerTargets: [providerId],
        enabled: true,
        projectId: null
      }),
    {
      providerId,
      suffix,
      namePrefix: options?.namePrefix ?? null,
      description: options?.description ?? null,
      instructions: options?.instructions ?? null
    }
  );
}

async function cleanupDurableState(input: { projectId?: string | null; skillId?: string | null }) {
  if (!input.projectId && !input.skillId) {
    return;
  }

  const { app, window } = await launchApp();
  try {
    if (input.skillId) {
      await window.evaluate(async (skillId) => {
        const skills = await window.vicode.skills.list();
        if (skills.some((skill) => skill.id === skillId)) {
          await window.vicode.skills.remove(skillId);
        }
      }, input.skillId);
    }

    if (input.projectId) {
      await window.evaluate(async (projectId) => {
        const bootstrap = await window.vicode.app.getBootstrap();
        if (bootstrap.projects.some((project) => project.id === projectId)) {
          await window.vicode.projects.remove(projectId);
        }
      }, input.projectId);
    }
  } finally {
    await closeApp(app);
  }
}

async function maybeSwitchComposerModel(
  window: Page,
  providerId: 'openai' | 'gemini',
  fromModelId: string,
  toModelId: string,
  expectedToLabel: string,
  expectedFromLabel: string
) {
  if (fromModelId === toModelId) {
    return;
  }

  const switched = await chooseComposerModel(window, providerId, toModelId, expectedToLabel);
  if (!switched) {
    return;
  }

  await chooseComposerModel(window, providerId, fromModelId, expectedFromLabel);
}

async function chooseComposerModel(
  window: Page,
  providerId: 'openai' | 'gemini' | 'ollama',
  modelId: string,
  expectedLabel: string
) {
  const providerLabel = providerDisplayName(providerId);
  const optionLocator = window.getByTestId(`composer-model-option-${providerId}-${modelId}`);

  await window.getByTestId('composer-model-select').click();
  const providerTrigger = window.getByRole('menuitem', { name: new RegExp(`^${providerLabel}\\b`, 'i') }).first();
  let optionVisible = false;
  await providerTrigger.hover().catch(() => {});
  optionVisible = await optionLocator.isVisible().catch(() => false);
  if (!optionVisible) {
    await providerTrigger.click().catch(() => {});
    optionVisible = await optionLocator.isVisible({ timeout: 5_000 }).catch(() => false);
  }
  if (!optionVisible) {
    test.info().annotations.push({
      type: 'note',
      description: `Skipped ${providerId} model selection because ${modelId} was not visible in the submenu.`
    });
    await window.keyboard.press('Escape').catch(() => {});
    return false;
  }

  await optionLocator.click();
  await expect(window.getByTestId('composer-model-select')).toContainText(expectedLabel);
  return true;
}

async function openThreadInUi(window: Page, projectId: string, threadId: string, threadTitle: string) {
  await window.evaluate(async ({ projectId, threadId }) => {
    await window.vicode.settings.save({
      selectedProjectId: projectId,
      lastOpenedThreadId: threadId
    });
  }, { projectId, threadId });
  await window.reload();
  await waitForBridge(window, [
    'vicode.app',
    'vicode.projects',
    'vicode.threads',
    'vicode.planner',
    'vicode.providers',
    'vicode.composer',
    'vicode.skills',
    'vicode.settings'
  ]);
  await dismissWelcomeIfVisible(window);
  await expect(window.locator('.windows-titlebar-context-thread')).toHaveText(threadTitle, { timeout: 30_000 });
}

async function waitForThreadCompletion(window: Page, threadId: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastDetail: Awaited<ReturnType<Page['evaluate']>> | null = null;
  while (Date.now() < deadline) {
    const detail = await window.evaluate(async ({ threadId }) => window.vicode.threads.open(threadId), { threadId });
    lastDetail = detail;
    if (detail.status === 'completed' && detail.turns.some((turn) => turn.role === 'assistant' && turn.content.trim().length > 0)) {
      return detail;
    }
    if (detail.status === 'failed') {
      throw new Error(
        `Thread ${threadId} failed. Last events: ${JSON.stringify(detail.rawOutput?.slice(-8) ?? [])}`
      );
    }
    await sleep(1_000);
  }
  throw new Error(
    `Timed out waiting for thread ${threadId} to complete. Last status: ${lastDetail?.status ?? 'unknown'}. Last events: ${JSON.stringify(lastDetail?.rawOutput?.slice(-5) ?? [])}`
  );
}

async function waitForActiveRunIndicator(window: Page, timeoutMs = 30_000) {
  await expect(window.getByTestId('run-activity-live')).toBeVisible({ timeout: timeoutMs });
}

async function withStepTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return await Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    })
  ]);
}

async function maybeExportMixedUseThreadDiagnostics(window: Page, threadId: string | null, providerId: 'openai' | 'gemini' | 'ollama') {
  if (!threadId) {
    return;
  }

  const packetDir = getMixedUsePacketDir(providerId);
  if (!packetDir) {
    return;
  }

  try {
    const exportedPath = await withStepTimeout(
      window.evaluate(async ({ threadId }) => window.vicode.diagnostics.exportThread(threadId), {
        threadId
      }),
      30_000,
      `${providerId} diagnostics export`
    );
    await mkdir(packetDir, { recursive: true });
    await copyFile(exportedPath, path.join(packetDir, 'thread-diagnostics.json'));
    await writeFile(path.join(packetDir, 'thread-diagnostics-path.txt'), `${exportedPath}\n`, 'utf8');
    await appendMixedUseTimelineLine(
      providerId,
      `- ${new Date().toISOString()}: exported thread diagnostics from ${exportedPath}`
    );
  } catch (error) {
    await appendMixedUseTimelineLine(
      providerId,
      `- ${new Date().toISOString()}: thread diagnostics export failed: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

async function maybeExportMixedUseWorkspaceSnapshot(
  providerId: 'openai' | 'gemini' | 'ollama',
  projectPath: string
) {
  const packetDir = getMixedUsePacketDir(providerId);
  if (!packetDir) {
    return;
  }

  try {
    await withStepTimeout(
      (async () => {
        const snapshotDir = path.join(packetDir, 'workspace-snapshot');
        await rm(snapshotDir, { recursive: true, force: true }).catch(() => undefined);
        await mkdir(snapshotDir, { recursive: true });

        const trackedFiles = ['index.html', 'styles.css', 'app.js', 'data.js'] as const;
        const manifest: Array<{ path: string; status: 'copied' | 'missing'; message?: string }> = [];

        for (const relativePath of trackedFiles) {
          const sourcePath = path.join(projectPath, relativePath);
          const targetPath = path.join(snapshotDir, relativePath);
          try {
            await copyFile(sourcePath, targetPath);
            manifest.push({ path: relativePath, status: 'copied' });
          } catch (error) {
            manifest.push({
              path: relativePath,
              status: 'missing',
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }

        await writeFile(
          path.join(snapshotDir, 'manifest.json'),
          `${JSON.stringify({ projectPath, capturedAt: new Date().toISOString(), files: manifest }, null, 2)}\n`,
          'utf8'
        );
      })(),
      30_000,
      `${providerId} workspace snapshot export`
    );

    await appendMixedUseTimelineLine(
      providerId,
      `- ${new Date().toISOString()}: exported workspace snapshot from ${projectPath}`
    );
  } catch (error) {
    await appendMixedUseTimelineLine(
      providerId,
      `- ${new Date().toISOString()}: workspace snapshot export failed: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }
}

function getAssistantTurnForRun(
  detail: Awaited<ReturnType<Page['evaluate']>>,
  runId: string
) {
  return [...detail.turns].reverse().find((turn) => turn.runId === runId && turn.role === 'assistant' && turn.content.trim().length > 0);
}

async function waitForRunCompletion(
  window: Page,
  threadId: string,
  runId: string,
  timeoutMs = 90_000,
  stageLabel = 'run'
) {
  const deadline = Date.now() + timeoutMs;
  let lastDetail: Awaited<ReturnType<Page['evaluate']>> | null = null;
  while (Date.now() < deadline) {
    const detail = await window.evaluate(async ({ threadId }) => window.vicode.threads.open(threadId), { threadId });
    lastDetail = detail;
    const assistantTurn = getAssistantTurnForRun(detail, runId);
    if (detail.status === 'completed' && assistantTurn) {
      return { detail, assistantTurn };
    }
    if (detail.status === 'failed' || detail.status === 'aborted') {
      throw new Error(
        `${stageLabel}: run ${runId} on thread ${threadId} ${detail.status}. Last events: ${JSON.stringify(detail.rawOutput?.slice(-8) ?? [])}`
      );
    }
    await sleep(1_000);
  }
  throw new Error(
    `${stageLabel}: timed out waiting for run ${runId} on thread ${threadId}. Last status: ${lastDetail?.status ?? 'unknown'}. Last events: ${JSON.stringify(lastDetail?.rawOutput?.slice(-5) ?? [])}`
  );
}

async function maybeApprovePendingToolCommand(window: Page) {
  const approvalPanel = window.getByTestId('tool-approval-panel');
  if (!(await approvalPanel.isVisible().catch(() => false))) {
    return false;
  }

  const approveButton = approvalPanel.getByRole('button', { name: /Approve (command|tool)/i });
  if (!(await approveButton.isVisible().catch(() => false))) {
    return false;
  }

  await approveButton.click();
  await expect(approvalPanel).toBeHidden({ timeout: 30_000 });
  return true;
}

async function waitForRunCompletionAllowingToolApproval(
  window: Page,
  threadId: string,
  runId: string,
  timeoutMs = 90_000,
  stageLabel = 'run'
) {
  const deadline = Date.now() + timeoutMs;
  let lastDetail: Awaited<ReturnType<Page['evaluate']>> | null = null;
  while (Date.now() < deadline) {
    await maybeApprovePendingToolCommand(window).catch(() => false);
    const detail = await window.evaluate(async ({ threadId }) => window.vicode.threads.open(threadId), { threadId });
    lastDetail = detail;
    const assistantTurn = getAssistantTurnForRun(detail, runId);
    if (detail.status === 'completed' && assistantTurn) {
      return { detail, assistantTurn };
    }
    if (detail.status === 'failed' || detail.status === 'aborted') {
      throw new Error(
        `${stageLabel}: run ${runId} on thread ${threadId} ${detail.status}. Last events: ${JSON.stringify(detail.rawOutput?.slice(-8) ?? [])}`
      );
    }
    await sleep(1_000);
  }
  throw new Error(
    `${stageLabel}: timed out waiting for run ${runId} on thread ${threadId}. Last status: ${lastDetail?.status ?? 'unknown'}. Last events: ${JSON.stringify(lastDetail?.rawOutput?.slice(-5) ?? [])}`
  );
}

interface ConversationAuditTurn {
  label: string;
  prompt: string;
  expectWork?: boolean;
  expectMemoryRecall?: boolean;
  expectAssistantIncludes?: string[];
}

interface ConversationAuditObservation {
  label: string;
  runId: string;
  assistantText: string;
  malformedPatterns: string[];
  sawMemoryRecall: boolean;
  sawVisibleMemoryChrome: boolean;
  sawVerboseMemoryCopy: boolean;
  sawMemoryCheckpoint: boolean;
  sawWorkedForDelta: boolean;
  workedForCount: number;
  bodyPreview: string;
}

interface RichWorkflowTurn {
  label: string;
  prompt: string;
  submission: 'direct' | 'skill' | 'slash';
  slashCommandToken?: string;
  skillIds?: string[];
  executionPermission?: 'default' | 'full_access';
  expectWorkedFor?: boolean;
  expectMemoryRecall?: boolean;
  expectActivityKinds?: string[];
  expectAssistantIncludes?: string[];
  verifyFiles?: Array<{ path: string; contains: string }>;
}

interface RichWorkflowObservation {
  label: string;
  runId: string;
  assistantText: string;
  activityKinds: string[];
  malformedPatterns: string[];
  sawWorkedForDelta: boolean;
  sawMemoryRecall: boolean;
  bodyPreview: string;
}

function getConversationAuditTurns(): ConversationAuditTurn[] {
  return [
    {
      label: 'memory-tone',
      prompt: 'Use any relevant workspace memory and answer in one short sentence: what tone will you keep in this thread?',
      expectMemoryRecall: true
    },
    {
      label: 'babbage-century',
      prompt: "In two short sentences, explain why it's accurate to place Babbage's work in the 19th century."
    },
    {
      label: 'september-line',
      prompt: "In one sentence, explain why Earth, Wind & Fire's 'September' mentions the 21st night of September and why 1978 matters."
    },
    {
      label: 'quoted-phrase',
      prompt: 'Reply with one sentence that includes “Earth, Wind & Fire”, “21st”, and “it\'s”.'
    },
    {
      label: 'ampersand-spacing',
      prompt: "In one short sentence, explain whether 'rock & roll' and 'R&D' should keep spaces around ampersands in normal prose."
    },
    {
      label: 'contractions',
      prompt: "Reply with exactly two short sentences about contractions like don't, can't, and we're."
    },
    {
      label: 'workspace-write',
      prompt: [
        'Create a file named audit-note.txt in the workspace root.',
        'Write exactly these two lines:',
        'Conversation audit in progress.',
        'Spacing should stay normal.',
        'Reply with one short confirmation sentence.'
      ].join('\n'),
      expectWork: true
    },
    {
      label: 'post-write-chat',
      prompt: 'In one short sentence, confirm what you just changed and keep the answer conversational.'
    },
    {
      label: 'long-form-prose',
      prompt: [
        'In 6 short bullet points plus one closing sentence, explain why recreating the Portfolite Framer site in plain web tech requires approximation.',
        'Use these exact terms naturally in the answer: Portfolite, Tailwind, keyframes, mimicking, Framer, gradient shader.',
        'Keep the answer conversational and readable.'
      ].join('\n'),
      expectAssistantIncludes: ['Portfolite', 'Tailwind', 'keyframes', 'mimicking', 'Framer', 'gradient shader']
    },
    {
      label: 'summary',
      prompt: 'In one short sentence, summarize the thread so far without bullets.'
    },
    {
      label: 'more-context',
      prompt: 'In one short sentence, say whether you need more context to continue.'
    }
  ];
}

function detectMalformedAssistantText(value: string) {
  return findSuspiciousAssistantTextPatterns(value);
}

function extractRunActivityKinds(detail: Awaited<ReturnType<Page['evaluate']>>, runId: string) {
  return detail.rawOutput
    .filter((event) => event.runId === runId && event.eventType === 'info')
    .map((event) => {
      const payload = event.payload as { activity?: { kind?: unknown } } | undefined;
      return typeof payload?.activity?.kind === 'string' ? payload.activity.kind : null;
    })
    .filter((kind): kind is string => Boolean(kind));
}

async function seedConversationAuditWorkspace(projectPath: string) {
  await mkdir(projectPath, { recursive: true });
  await writeFile(
    path.join(projectPath, 'AGENTS.md'),
    [
      '# Workspace contract',
      '- Keep answers concise and directly useful.',
      '- Avoid bullets unless the user asks for them.',
      '- Use normal punctuation and spacing.'
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    path.join(projectPath, 'SOUL.md'),
    [
      '# Tone',
      '- Calm, premium, and restrained.',
      '- No noisy status framing in normal conversation.'
    ].join('\n'),
    'utf8'
  );
  await writeFile(
    path.join(projectPath, 'USER.md'),
    [
      '# User preferences',
      '- Prefers short direct answers.',
      '- Dislikes noisy transcript chrome.'
    ].join('\n'),
    'utf8'
  );
  await seedDurableMemory(projectPath, {
    memoryContent: [
      '# Workspace memory',
      '- Keep conversational answers concise and avoid bullets unless asked.',
      '- When writing files, keep summaries brief and verification-oriented.'
    ].join('\n'),
    dailyNoteFileName: '2026-03-28.md',
    dailyNoteContent: [
      '# Session note',
      '- This workspace is used to audit transcript quality, memory recall, and Worked for behavior during same-thread conversations.'
    ].join('\n')
  });
}

async function runConversationAudit(window: Page, input: {
  providerId: 'openai' | 'gemini' | 'ollama';
  modelId: string;
  projectId: string;
  threadId: string;
  turns: ConversationAuditTurn[];
  screenshotPrefix: string;
}) {
  const observations: ConversationAuditObservation[] = [];
  let workedForCount = 0;
  const reportPath = test.info().outputPath(`${input.screenshotPrefix}-audit.json`);

  await writeFile(reportPath, '[]\n', 'utf8');

  for (let index = 0; index < input.turns.length; index += 1) {
    const turn = input.turns[index]!;
    const submitted = await window.evaluate(
      async ({ projectId, threadId, providerId, modelId, prompt }) =>
        window.vicode.composer.submit({
          projectId,
          threadId,
          prompt,
          providerId,
          modelId,
          executionPermission: 'default',
          skillIds: []
        }),
      {
        projectId: input.projectId,
        threadId: input.threadId,
        providerId: input.providerId,
        modelId: input.modelId,
        prompt: turn.prompt
      }
    );

    expect(submitted.disposition).toBe('started');
    const runId = submitted.runId;
    expect(typeof runId).toBe('string');
    expect(runId?.length ?? 0).toBeGreaterThan(0);

    const { detail, assistantTurn } = await waitForRunCompletion(
      window,
      input.threadId,
      runId!,
      240_000,
      `${input.providerId} conversation audit ${turn.label}`
    );

    const bodyText = await window.locator('body').innerText();
    const nextWorkedForCount = await window.locator('.run-transcript-worked-for').count();
    const activityKinds = extractRunActivityKinds(detail, runId!);
    const assistantText = assistantTurn.content.trim();
    const malformedPatterns = detectMalformedAssistantText(assistantText);
    const sawMemoryRecall = activityKinds.includes('memory_recall');
    const sawVisibleMemoryChrome = bodyText.includes('Workspace memory loaded');
    const sawVerboseMemoryCopy = bodyText.includes('active prompt context');
    const sawMemoryCheckpoint = activityKinds.includes('memory_checkpoint');
    const sawWorkedForDelta = nextWorkedForCount > workedForCount;

    if (index === 0 || index === input.turns.length - 1 || malformedPatterns.length > 0) {
      await window.screenshot({
        path: test.info().outputPath(`${input.screenshotPrefix}-${String(index + 1).padStart(2, '0')}.png`),
        fullPage: true
      });
    }

    expect(assistantText.length).toBeGreaterThan(0);
    expect(malformedPatterns).toEqual([]);
    for (const expectedText of turn.expectAssistantIncludes ?? []) {
      expect(assistantText).toContain(expectedText);
    }

    if (turn.expectMemoryRecall) {
      expect(sawMemoryRecall).toBeTruthy();
      expect(sawVisibleMemoryChrome).toBeFalsy();
    }
    expect(sawVerboseMemoryCopy).toBeFalsy();

    if (turn.expectWork) {
      expect(sawWorkedForDelta).toBeTruthy();
    } else {
      expect(sawWorkedForDelta).toBeFalsy();
    }

    observations.push({
      label: turn.label,
      runId: runId!,
      assistantText,
      malformedPatterns,
      sawMemoryRecall,
      sawVisibleMemoryChrome,
      sawVerboseMemoryCopy,
      sawMemoryCheckpoint,
      sawWorkedForDelta,
      workedForCount: nextWorkedForCount,
      bodyPreview: bodyText.replace(/\s+/gu, ' ').trim().slice(0, 600)
    });

    await writeFile(reportPath, `${JSON.stringify(observations, null, 2)}\n`, 'utf8');
    console.log(
      `${input.providerId.toUpperCase()}_CONVERSATION_AUDIT_TURN ${JSON.stringify({
        label: turn.label,
        sawMemoryRecall,
        sawVisibleMemoryChrome,
        sawWorkedForDelta,
        malformedPatterns
      })}`
    );

    workedForCount = nextWorkedForCount;
  }

  return observations;
}

function extractThreadRunIds(detail: Awaited<ReturnType<Page['evaluate']>>) {
  return Array.from(
    new Set(
      detail.rawOutput
        .map((event) => event.runId)
        .filter((runId): runId is string => typeof runId === 'string' && runId.length > 0)
    )
  );
}

async function waitForNewRunId(
  window: Page,
  threadId: string,
  previousRunIds: ReadonlySet<string>,
  timeoutMs = 60_000
) {
  const deadline = Date.now() + timeoutMs;
  let lastDetail: Awaited<ReturnType<Page['evaluate']>> | null = null;

  while (Date.now() < deadline) {
    const detail = await window.evaluate(async ({ threadId }) => window.vicode.threads.open(threadId), { threadId });
    lastDetail = detail;
    const nextRunId = extractThreadRunIds(detail).find((runId) => !previousRunIds.has(runId));
    if (nextRunId) {
      return nextRunId;
    }
    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for a new run on thread ${threadId}. Last status: ${lastDetail?.status ?? 'unknown'}. Last events: ${JSON.stringify(lastDetail?.rawOutput?.slice(-8) ?? [])}`
  );
}

function getRichWorkflowTurns(skillId: string, projectPath: string): RichWorkflowTurn[] {
  return [
    {
      label: 'memory-tone',
      submission: 'direct',
      prompt: 'Use any relevant workspace memory and answer in one short sentence: what tone will you keep in this thread?',
      expectMemoryRecall: true
    },
    {
      label: 'slash-build-app',
      submission: 'slash',
      slashCommandToken: 'build-app',
      prompt: [
        'Create a tiny premium launch page for North Glass in the workspace root.',
        'Use exactly three files: index.html, styles.css, and main.js.',
        'Requirements:',
        '- index.html must include the visible text "North Glass" and a button labeled "Book demo"',
        '- index.html must include an element with id "app-status"',
        '- styles.css must contain the exact text background: #0f1115;',
        "- main.js must set document.getElementById('app-status').textContent to exactly 'ui ready'",
        'Reply with exactly: north glass built.'
      ].join('\n'),
      expectWorkedFor: true,
      expectActivityKinds: ['file_write'],
      verifyFiles: [
        { path: path.join(projectPath, 'index.html'), contains: 'North Glass' },
        { path: path.join(projectPath, 'styles.css'), contains: 'background: #0f1115;' },
        { path: path.join(projectPath, 'main.js'), contains: "document.getElementById('app-status').textContent = 'ui ready'" }
      ]
    },
    {
      label: 'skill-summary',
      submission: 'skill',
      skillIds: [skillId],
      prompt: 'In one short sentence, confirm what you just built and keep the answer crisp.'
    },
    {
      label: 'safe-command',
      submission: 'direct',
      executionPermission: 'full_access',
      prompt: [
        'Use one safe shell command to print the current working directory once.',
        'Do not edit files.',
        'Reply with exactly: command checked.'
      ].join('\n'),
      expectWorkedFor: true,
      expectActivityKinds: ['terminal_command']
    },
    {
      label: 'research-package',
      submission: 'direct',
      prompt: [
        'Search the web for Bun shell documentation and capture two short factual notes with sources.',
        'Create docs/research and docs/checklists if they do not exist.',
        'Write docs/research/bun-shell-notes.md with:',
        '- a title',
        '- exactly two bullet facts',
        '- a Sources: section with links',
        'Write docs/checklists/ui-polish.md with exactly three short bullets about transcript polish.',
        'Reply with exactly: research package created.'
      ].join('\n'),
      expectWorkedFor: true,
      expectActivityKinds: ['mkdir', 'file_write'],
      verifyFiles: [
        { path: path.join(projectPath, 'docs', 'research', 'bun-shell-notes.md'), contains: 'Sources' },
        { path: path.join(projectPath, 'docs', 'research', 'bun-shell-notes.md'), contains: 'https://bun.' },
        { path: path.join(projectPath, 'docs', 'checklists', 'ui-polish.md'), contains: '- ' }
      ]
    },
    {
      label: 'slash-summarize-doc',
      submission: 'slash',
      slashCommandToken: 'summarize-doc',
      prompt: 'Summarize docs/research/bun-shell-notes.md in one short paragraph and mention whether the sources section exists.',
      expectAssistantIncludes: ['Sources', 'Bun']
    },
    {
      label: 'checklist-refine',
      submission: 'direct',
      prompt: [
        'Update docs/checklists/ui-polish.md.',
        'Append exactly one new bullet: - keep disclosure arrows consistent',
        'Do not change the existing three bullets.',
        'Reply with exactly: checklist refined.'
      ].join('\n'),
      expectWorkedFor: true,
      verifyFiles: [
        { path: path.join(projectPath, 'docs', 'checklists', 'ui-polish.md'), contains: '- keep disclosure arrows consistent' }
      ]
    },
    {
      label: 'readback',
      submission: 'direct',
      prompt: 'Read the docs/research and docs/checklists files you created and in one short sentence confirm what exists.',
      expectAssistantIncludes: ['bun-shell-notes', 'ui-polish']
    },
    {
      label: 'tools-used',
      submission: 'direct',
      prompt: 'In one short sentence, name the kinds of tools you have used in this thread so far.'
    },
    {
      label: 'final-summary',
      submission: 'direct',
      prompt: 'In one short sentence, summarize this thread without bullets.'
    }
  ];
}

async function runRichWorkflowAudit(window: Page, input: {
  providerId: 'ollama';
  modelId: string;
  projectId: string;
  threadId: string;
  projectPath: string;
  skillId: string;
  screenshotPrefix: string;
}) {
  const observations: RichWorkflowObservation[] = [];
  const reportPath = test.info().outputPath(`${input.screenshotPrefix}-audit.json`);
  let workedForCount = 0;

  await writeFile(reportPath, '[]\n', 'utf8');

  for (const turn of getRichWorkflowTurns(input.skillId, input.projectPath)) {
    const beforeDetail = await window.evaluate(async ({ threadId }) => window.vicode.threads.open(threadId), { threadId: input.threadId });
    const knownRunIds = new Set(extractThreadRunIds(beforeDetail));
    let runId: string;

    if (turn.submission === 'slash') {
      if (!turn.slashCommandToken) {
        throw new Error(`Slash workflow turn ${turn.label} is missing a slash command token.`);
      }

      await resetComposer(window);
      await selectSlashCommand(window, turn.slashCommandToken);
      const composer = window.getByTestId('composer-input');
      await composer.fill(turn.prompt);
      await window.getByTestId('composer-submit-button').click();
      await expect(window.locator('.composer-command-chip')).toHaveCount(0);
      await composer.press('Enter');
      runId = await waitForNewRunId(window, input.threadId, knownRunIds);
    } else {
      const submitted = await window.evaluate(
        async ({ projectId, threadId, providerId, modelId, prompt, executionPermission, skillIds }) =>
          window.vicode.composer.submit({
            projectId,
            threadId,
            prompt,
            providerId,
            modelId,
            executionPermission,
            skillIds
          }),
        {
          projectId: input.projectId,
          threadId: input.threadId,
          providerId: input.providerId,
          modelId: input.modelId,
          prompt: turn.prompt,
          executionPermission: turn.executionPermission ?? 'default',
          skillIds: turn.skillIds ?? []
        }
      );

      expect(submitted.disposition).toBe('started');
      runId = submitted.runId ?? '';
      expect(runId.length).toBeGreaterThan(0);
    }

    const { detail, assistantTurn } = await waitForRunCompletionAllowingToolApproval(
      window,
      input.threadId,
      runId,
      300_000,
      `${input.providerId} rich workflow ${turn.label}`
    );
    const bodyText = await window.locator('body').innerText();
    const nextWorkedForCount = await window.locator('.run-transcript-worked-for').count();
    const activityKinds = extractRunActivityKinds(detail, runId);
    const assistantText = assistantTurn.content.trim();
    const malformedPatterns = detectMalformedAssistantText(assistantText);
    const sawWorkedForDelta = nextWorkedForCount > workedForCount;
    const sawMemoryRecall = activityKinds.includes('memory_recall');

    await window.screenshot({
      path: test.info().outputPath(`${input.screenshotPrefix}-${turn.label}.png`),
      fullPage: true
    });

    expect(assistantText.length).toBeGreaterThan(0);
    expect(malformedPatterns).toEqual([]);

    if (turn.expectMemoryRecall) {
      expect(sawMemoryRecall).toBeTruthy();
    }

    if (typeof turn.expectWorkedFor === 'boolean') {
      expect(sawWorkedForDelta).toBe(turn.expectWorkedFor);
    }

    for (const expectedKind of turn.expectActivityKinds ?? []) {
      expect(activityKinds).toContain(expectedKind);
    }

    for (const expectedSnippet of turn.expectAssistantIncludes ?? []) {
      expect(assistantText).toContain(expectedSnippet);
    }

    for (const fileCheck of turn.verifyFiles ?? []) {
      await expect.poll(async () => await readFile(fileCheck.path, 'utf8'), { timeout: 30_000 }).toContain(fileCheck.contains);
    }

    observations.push({
      label: turn.label,
      runId,
      assistantText,
      activityKinds,
      malformedPatterns,
      sawWorkedForDelta,
      sawMemoryRecall,
      bodyPreview: bodyText.replace(/\s+/gu, ' ').trim().slice(0, 800)
    });
    await writeFile(reportPath, `${JSON.stringify(observations, null, 2)}\n`, 'utf8');
    workedForCount = nextWorkedForCount;
  }

  return observations;
}

async function waitForPlannerState(
  window: Page,
  threadId: string,
  timeoutMs = 240_000
): Promise<{ type: 'questions' | 'plan'; detail: Awaited<ReturnType<Page['evaluate']>> }> {
  const deadline = Date.now() + timeoutMs;
  let lastDetail: Awaited<ReturnType<Page['evaluate']>> | null = null;
  while (Date.now() < deadline) {
    const detail = await window.evaluate(async ({ threadId }) => window.vicode.threads.open(threadId), { threadId });
    lastDetail = detail;
    if (detail.planner?.pendingQuestionSet) {
      return { type: 'questions', detail };
    }
    if (detail.planner?.activePlan) {
      return { type: 'plan', detail };
    }
    if (detail.status === 'failed') {
      throw new Error(
        `Planner thread ${threadId} failed. Last planner: ${JSON.stringify(detail.planner ?? null)}. Last events: ${JSON.stringify(detail.rawOutput?.slice(-8) ?? [])}`
      );
    }
    await sleep(1_000);
  }
  throw new Error(
    `Timed out waiting for planner state on thread ${threadId}. Last status: ${lastDetail?.status ?? 'unknown'}. Last planner: ${JSON.stringify(lastDetail?.planner ?? null)}. Last events: ${JSON.stringify(lastDetail?.rawOutput?.slice(-5) ?? [])}`
  );
}

async function waitForPlannerApprovalExecution(window: Page, threadId: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastDetail: Awaited<ReturnType<Page['evaluate']>> | null = null;
  while (Date.now() < deadline) {
    const detail = await window.evaluate(async ({ threadId }) => window.vicode.threads.open(threadId), { threadId });
    lastDetail = detail;
    const approvedPlan = detail.planner?.activePlan?.status === 'approved';
    const executionStarted = detail.status === 'queued' || detail.status === 'running' || detail.status === 'completed';

    if (approvedPlan && executionStarted) {
      return detail;
    }

    if (detail.status === 'failed') {
      throw new Error(
        `Approved planner execution failed for thread ${threadId}. Last planner: ${JSON.stringify(detail.planner ?? null)}. Last events: ${JSON.stringify(detail.rawOutput?.slice(-8) ?? [])}`
      );
    }

    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for approved planner execution on thread ${threadId}. Last status: ${lastDetail?.status ?? 'unknown'}. Last planner: ${JSON.stringify(lastDetail?.planner ?? null)}. Last events: ${JSON.stringify(lastDetail?.rawOutput?.slice(-5) ?? [])}`
  );
}

test.describe.serial('@live-provider live provider flows', () => {
  test.describe.configure({ retries: 1 });

  test.beforeAll(async () => {
    await mkdir(workspaceRoot, { recursive: true });
  });

  test.afterAll(async () => {
    try {
      await rm(workspaceRoot, { recursive: true, force: true });
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : null;
      if (code !== 'EBUSY' && code !== 'EPERM') {
        throw error;
      }
    }
  });

  test('OpenAI chat, model switch, activity display, and thread persistence', async () => {
    let { app, window, statePaths } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-chat-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const fallbackModelId = provider.models[0]?.id ?? 'gpt-5';
      const alternateModelId = provider.models.find((model) => model.id !== fallbackModelId)?.id ?? fallbackModelId;
      const project = await ensureProject(window, `E2E OpenAI Chat ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', fallbackModelId);
      await closeApp(app, { cleanupState: false });
      ({ app, window } = await launchApp(statePaths));
      await expect(window.locator('.windows-titlebar-context-thread')).toHaveText(thread.title, { timeout: 30_000 });

      await maybeSwitchComposerModel(
        window,
        'openai',
        fallbackModelId,
        alternateModelId,
        provider.models.find((model) => model.id === alternateModelId)?.label ?? alternateModelId,
        provider.models.find((model) => model.id === fallbackModelId)?.label ?? fallbackModelId
      );

      await window.getByTestId('composer-input').fill('Reply with exactly: Vicode live test passed.');
      await window.getByTestId('composer-input').press('Enter');

      await waitForActiveRunIndicator(window);
      const completedThread = await waitForThreadCompletion(window, thread.id);
      expect(completedThread.turns.some((turn) => turn.role === 'assistant' && turn.content.trim().length > 0)).toBeTruthy();

      const headerText = await window.locator('.windows-titlebar-context-thread').textContent();
      await closeApp(app, { cleanupState: false });

      const relaunched = await launchApp(statePaths);
      try {
        await expect(relaunched.window.locator('.windows-titlebar-context-thread')).toHaveText(headerText ?? '', { timeout: 30_000 });
        await expect(relaunched.window.getByText('Reply with exactly: Vicode live test passed.', { exact: false })).toBeVisible({
          timeout: 30_000
        });
      } finally {
        await closeApp(relaunched.app);
      }
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
    }
  });

  test('OpenAI skill-assisted chat flow completes with a deterministic seeded prompt skill', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-skill-chat-${suffix}`);
    let projectId: string | null = null;
    let skillId: string | null = null;

    try {
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const skill = await createCertificationSkill(window, 'openai');
      skillId = skill.id;

      const modelId = provider.models[0]?.id ?? 'gpt-5';
      const project = await ensureProject(window, `E2E OpenAI Skill Chat ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', modelId);

      const submitted = await window.evaluate(
        async ({ projectId, threadId, providerId, modelId, skillId }) =>
          window.vicode.composer.submit({
            projectId,
            threadId,
            prompt: 'Reply with exactly: OpenAI assisted live test passed.',
            providerId,
            modelId,
            executionPermission: 'default',
            skillIds: [skillId]
          }),
        {
          projectId: project.id,
          threadId: thread.id,
          providerId: 'openai',
          modelId,
          skillId: skill.id
        }
      );

      expect(submitted.disposition).toBe('started');
      const completedThread = await waitForThreadCompletion(window, thread.id);
      expect(
        completedThread.turns.some(
          (turn) =>
            turn.role === 'user' &&
            Array.isArray(turn.metadata?.skillIds) &&
            (turn.metadata.skillIds as string[]).includes(skill.id)
        )
      ).toBeTruthy();
      expect(completedThread.turns.some((turn) => turn.role === 'assistant' && turn.content.trim().length > 0)).toBeTruthy();
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId, skillId }).catch(() => undefined);
    }
  });

  test('OpenAI same-thread conversation audit keeps text readable and work signals honest across 10 turns', async () => {
    test.setTimeout(900_000);
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-conversation-audit-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const modelId = selectOpenAISameThreadBenchmarkModel(provider.models)?.id ?? 'gpt-5';

      await seedConversationAuditWorkspace(projectPath);

      const project = await ensureProject(window, `E2E OpenAI Conversation Audit ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', modelId);
      await openThreadInUi(window, project.id, thread.id, thread.title);

      const observations = await runConversationAudit(window, {
        providerId: 'openai',
        modelId,
        projectId: project.id,
        threadId: thread.id,
        turns: getConversationAuditTurns(),
        screenshotPrefix: 'openai-conversation-audit'
      });

      await expect.poll(async () => await readFile(path.join(projectPath, 'audit-note.txt'), 'utf8'), { timeout: 30_000 }).toContain('Conversation audit in progress.');
      expect(observations.filter((entry) => entry.sawWorkedForDelta)).toHaveLength(1);
      expect(observations.find((entry) => entry.label === 'workspace-write')?.sawWorkedForDelta).toBeTruthy();
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'openai conversation audit' });
    }
  });

  test('OpenAI completes the marketing-site benchmark scaffold', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-benchmark-marketing-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const modelId = selectOpenAISameThreadBenchmarkModel(provider.models)?.id ?? 'gpt-5';
      const project = await ensureProject(window, `E2E OpenAI Benchmark Marketing ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', modelId);

      await runMarketingSiteBenchmark(window, {
        providerId: 'openai',
        modelId,
        projectId: project.id,
        projectPath,
        threadId: thread.id
      });
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'openai same-thread complex-project' });
    }
  });

  test('OpenAI completes a skill-assisted marketing-site benchmark scaffold', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-benchmark-marketing-skill-${suffix}`);
    let projectId: string | null = null;
    let skillId: string | null = null;

    try {
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const modelId = selectOpenAISameThreadBenchmarkModel(provider.models)?.id ?? 'gpt-5';
      const skill = await createCertificationSkill(window, 'openai', {
        namePrefix: 'live-site-direction-openai',
        description: 'Steers live marketing-site builds toward a premium, restrained landing-page outcome.',
        instructions: [
          'Build polished marketing sites with strong hierarchy and restrained premium styling.',
          'Prefer crisp section structure, strong headlines, and intentional CTA treatment.',
          'Keep the final answer concise and verification-oriented.'
        ].join(' ')
      });
      skillId = skill.id;

      const project = await ensureProject(window, `E2E OpenAI Benchmark Marketing Skill ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', modelId);

      await runMarketingSiteBenchmark(window, {
        providerId: 'openai',
        modelId,
        projectId: project.id,
        projectPath,
        threadId: thread.id,
        skillIds: [skill.id],
        promptPrefixLines: [
          'Use the attached site-direction skill while building this benchmark.'
        ]
      });

      const completedThread = await waitForThreadCompletion(window, thread.id);
      expect(
        completedThread.turns.some(
          (turn) =>
            turn.role === 'user'
            && Array.isArray(turn.metadata?.skillIds)
            && (turn.metadata.skillIds as string[]).includes(skill.id)
        )
      ).toBeTruthy();
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId, skillId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'openai skill-assisted marketing benchmark' });
    }
  });

  test('OpenAI marketing-site benchmark surfaces durable memory recall during the run', async () => {
    test.setTimeout(480_000);
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-benchmark-marketing-memory-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const modelId = selectOpenAISameThreadBenchmarkModel(provider.models)?.id ?? 'gpt-5';

      await seedDurableMemory(projectPath, {
        memoryContent: [
          '# Marketing direction',
          'Northstar Studio should keep a restrained graphite palette, emphasize trust, and preserve the "Book intro call" CTA language.'
        ].join('\n\n'),
        dailyNoteFileName: '2026-03-27.md',
        dailyNoteContent: [
          '# Latest note',
          'When this benchmark comes up again, keep the hero calm and use the Northstar Studio brand cues instead of restarting the visual direction.'
        ].join('\n\n')
      });

      const project = await ensureProject(window, `E2E OpenAI Benchmark Marketing Memory ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', modelId);

      const completedThread = await runMarketingSiteBenchmark(window, {
        providerId: 'openai',
        modelId,
        projectId: project.id,
        projectPath,
        threadId: thread.id,
        promptPrefixLines: [
          'Preserve any durable workspace memory that is relevant to Northstar Studio and the CTA direction.'
        ]
      });

      const memoryRecallEvent = completedThread.rawOutput.find((event) => {
        if (event.eventType !== 'info') {
          return false;
        }
        const activity = event.payload?.activity as { kind?: string; text?: string } | undefined;
        return activity?.kind === 'memory_recall';
      });

      expect(memoryRecallEvent).toBeTruthy();
      expect((memoryRecallEvent?.payload?.activity as { text?: string } | undefined)?.text ?? '').toContain('MEMORY.md');
      expect((memoryRecallEvent?.payload?.activity as { text?: string } | undefined)?.text ?? '').toContain('2026-03-27.md');
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'openai marketing memory benchmark' });
    }
  });

  test('OpenAI completes a skill-assisted React landing-page benchmark', async () => {
    test.setTimeout(480_000);
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-benchmark-react-landing-${suffix}`);
    let projectId: string | null = null;
    let skillId: string | null = null;

    try {
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const modelId = selectOpenAICertificationModel(provider.models)?.id ?? 'gpt-5';
      const skill = await createCertificationSkill(window, 'openai', {
        namePrefix: 'react-landing-direction-openai',
        description: 'Steers React landing pages toward premium component structure and restrained design.',
        instructions: [
          'Build premium React landing pages with strong section hierarchy and reusable UI primitives.',
          'Prefer calm, verification-oriented closeouts and preserve the existing framework structure.',
          'Keep components intentional and avoid generic filler copy.'
        ].join(' ')
      });
      skillId = skill.id;
      const project = await ensureProject(window, `E2E OpenAI React Landing ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', modelId);

      const completedThread = await runReactLandingBenchmark(window, {
        providerId: 'openai',
        modelId,
        projectId: project.id,
        projectPath,
        threadId: thread.id,
        skillIds: [skill.id],
        promptPrefixLines: [
          'Use the attached component-direction skill while building this React landing page.',
          'Keep the output framework-shaped and componentized.'
        ]
      });

      expect(
        completedThread.turns.some(
          (turn) =>
            turn.role === 'user'
            && Array.isArray(turn.metadata?.skillIds)
            && (turn.metadata.skillIds as string[]).includes(skill.id)
        )
      ).toBeTruthy();
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId, skillId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'openai react landing benchmark' });
    }
  });

  test('OpenAI completes a skill-assisted same-thread React landing-page benchmark with durable memory recall', async () => {
    test.setTimeout(900_000);
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-benchmark-react-thread-${suffix}`);
    let projectId: string | null = null;
    let skillId: string | null = null;
    let threadId: string | null = null;

    try {
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const modelId = selectOpenAICertificationModel(provider.models)?.id ?? 'gpt-5';

      await seedDurableMemory(projectPath, {
        memoryContent: [
          '# React continuity',
          'Keep Northstar Systems branding, preserve the shadcn-ready file structure, and continue build, refine, and repair in the same thread.'
        ].join('\n\n'),
        dailyNoteFileName: '2026-03-27.md',
        dailyNoteContent: [
          '# React same-thread note',
          'Carry the same premium React landing-page direction through the entire thread and do not reset the project structure during repair.'
        ].join('\n\n')
      });

      const skill = await createCertificationSkill(window, 'openai', {
        namePrefix: 'react-thread-direction-openai',
        description: 'Steers same-thread React landing-page work toward premium component continuity and restrained design.',
        instructions: [
          'Build premium React landing pages with strong section hierarchy and reusable UI primitives.',
          'Keep the same-thread implementation continuous across build, refine, and repair.',
          'Prefer calm, verification-oriented closeouts and preserve the framework structure.'
        ].join(' ')
      });
      skillId = skill.id;

      const project = await ensureProject(window, `E2E OpenAI React Thread ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', modelId);
      threadId = thread.id;

      const completedThread = await runSameThreadReactLandingBenchmark(window, {
        providerId: 'openai',
        modelId,
        projectId: project.id,
        projectPath,
        threadId: thread.id,
        executionPermission: 'full_access',
        skillIds: [skill.id],
        promptPrefixLines: [
          'Use the attached component-direction skill throughout this same-thread React benchmark.',
          'Preserve any durable workspace memory relevant to premium React continuity and the shadcn-ready structure.',
          'Keep the implementation line continuous across build, refine, and repair.'
        ]
      });

      const memoryRecallEvent = completedThread.rawOutput.find((event) => {
        if (event.eventType !== 'info') {
          return false;
        }
        const activity = event.payload?.activity as { kind?: string; text?: string } | undefined;
        return activity?.kind === 'memory_recall';
      });

      expect(memoryRecallEvent).toBeTruthy();
      expect((memoryRecallEvent?.payload?.activity as { text?: string } | undefined)?.text ?? '').toContain('MEMORY.md');
      expect((memoryRecallEvent?.payload?.activity as { text?: string } | undefined)?.text ?? '').toContain('2026-03-27.md');
      expect(
        completedThread.turns.filter(
          (turn) =>
            turn.role === 'user'
            && Array.isArray(turn.metadata?.skillIds)
            && (turn.metadata.skillIds as string[]).includes(skill.id)
        ).length
      ).toBeGreaterThanOrEqual(4);
    } finally {
      await maybeExportMixedUseThreadDiagnostics(window, threadId, 'openai').catch(() => undefined);
      await maybeExportMixedUseWorkspaceSnapshot('openai', projectPath).catch(() => undefined);
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId, skillId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'openai same-thread react landing benchmark' });
    }
  });

  test('OpenAI completes the dashboard benchmark scaffold', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-benchmark-dashboard-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const modelId = selectOpenAICertificationModel(provider.models)?.id ?? 'gpt-5';
      const project = await ensureProject(window, `E2E OpenAI Benchmark Dashboard ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', modelId);

      await runDashboardBenchmark(window, {
        providerId: 'openai',
        modelId,
        projectId: project.id,
        projectPath,
        threadId: thread.id
      });
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'gemini same-thread complex-project' });
    }
  });

  test('OpenAI completes the docs-site benchmark', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-benchmark-docs-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const modelId = selectOpenAICertificationModel(provider.models)?.id ?? 'gpt-5';
      const project = await ensureProject(window, `E2E OpenAI Benchmark Docs ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', modelId);

      await runDocsSiteBenchmark(window, {
        providerId: 'openai',
        modelId,
        projectId: project.id,
        projectPath,
        threadId: thread.id
      });
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'ollama same-thread complex-project' });
    }
  });

  test('OpenAI completes the auth-app benchmark', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-benchmark-auth-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const modelId = selectOpenAICertificationModel(provider.models)?.id ?? 'gpt-5';
      const project = await ensureProject(window, `E2E OpenAI Benchmark Auth ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', modelId);

      await runAuthAppBenchmark(window, {
        providerId: 'openai',
        modelId,
        projectId: project.id,
        projectPath,
        threadId: thread.id
      });
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'openai same-thread complex-project' });
    }
  });

  test('OpenAI completes the existing-project-refinement benchmark', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-benchmark-refine-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const modelId = selectOpenAICertificationModel(provider.models)?.id ?? 'gpt-5';
      const project = await ensureProject(window, `E2E OpenAI Benchmark Refine ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', modelId);

      await runExistingProjectRefinementBenchmark(window, {
        providerId: 'openai',
        modelId,
        projectId: project.id,
        projectPath,
        threadId: thread.id
      });
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'openai same-thread complex-project skill' });
    }
  });

  test('OpenAI completes the bugfix-slice benchmark', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-benchmark-bugfix-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const modelId = selectOpenAICertificationModel(provider.models)?.id ?? 'gpt-5';
      const project = await ensureProject(window, `E2E OpenAI Benchmark Bugfix ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', modelId);

      await runBugfixSliceBenchmark(window, {
        providerId: 'openai',
        modelId,
        projectId: project.id,
        projectPath,
        threadId: thread.id
      });
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'openai same-thread complex-project memory' });
    }
  });

  test('OpenAI completes the crud-app benchmark', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-benchmark-feature-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const modelId = selectOpenAICertificationModel(provider.models)?.id ?? 'gpt-5';
      const project = await ensureProject(window, `E2E OpenAI Benchmark Feature ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', modelId);

      await runCrudAppBenchmark(window, {
        providerId: 'openai',
        modelId,
        projectId: project.id,
        projectPath,
        threadId: thread.id
      });
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'ollama same-thread complex-project' });
    }
  });

  test('OpenAI completes the same-thread complex-project benchmark', async () => {
    test.setTimeout(720_000);
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-benchmark-complex-thread-${suffix}`);
    let projectId: string | null = null;
    let threadId: string | null = null;

    try {
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const modelId = selectOpenAICertificationModel(provider.models)?.id ?? 'gpt-5';
      const project = await ensureProject(window, `E2E OpenAI Benchmark Complex Thread ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', modelId);
      threadId = thread.id;

      await runSameThreadComplexProjectBenchmark(window, {
        providerId: 'openai',
        modelId,
        projectId: project.id,
        projectPath,
        threadId: thread.id
      });
    } finally {
      await maybeExportMixedUseThreadDiagnostics(window, threadId, 'openai').catch(() => undefined);
      await maybeExportMixedUseWorkspaceSnapshot('openai', projectPath).catch(() => undefined);
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'ollama same-thread complex-project memory' });
    }
  });

  test('OpenAI completes a skill-assisted same-thread complex-project benchmark', async () => {
    test.setTimeout(720_000);
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-benchmark-complex-thread-skill-${suffix}`);
    let projectId: string | null = null;
    let threadId: string | null = null;
    let skillId: string | null = null;

    try {
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const modelId = selectOpenAICertificationModel(provider.models)?.id ?? 'gpt-5';
      const skill = await createCertificationSkill(window, 'openai', {
        namePrefix: 'complex-thread-direction-openai',
        description: 'Steers longer same-thread release-board work toward disciplined multi-stage edits.',
        instructions: [
          'When refining an existing project, preserve structure and continue the same implementation line instead of restarting.',
          'Keep closeouts concise, verification-oriented, and grounded in the files already edited.',
          'Favor calm multi-stage follow-through over rewriting the app from scratch.'
        ].join(' ')
      });
      skillId = skill.id;
      const project = await ensureProject(window, `E2E OpenAI Benchmark Complex Thread Skill ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', modelId);
      threadId = thread.id;

      await runSameThreadComplexProjectBenchmark(window, {
        providerId: 'openai',
        modelId,
        projectId: project.id,
        projectPath,
        threadId: thread.id,
        skillIds: [skill.id],
        promptPrefixLines: [
          'Use the attached release-board direction skill throughout this same-thread benchmark.',
          'Keep the implementation line continuous across build, refine, and repair.'
        ]
      });

      const completedThread = await waitForThreadCompletion(window, thread.id);
      expect(
        completedThread.turns.filter(
          (turn) =>
            turn.role === 'user'
            && Array.isArray(turn.metadata?.skillIds)
            && (turn.metadata.skillIds as string[]).includes(skill.id)
        ).length
      ).toBeGreaterThanOrEqual(4);
    } finally {
      await maybeExportMixedUseThreadDiagnostics(window, threadId, 'openai').catch(() => undefined);
      await maybeExportMixedUseWorkspaceSnapshot('openai', projectPath).catch(() => undefined);
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId, skillId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('OpenAI same-thread complex-project benchmark surfaces durable memory recall during the run', async () => {
    test.setTimeout(720_000);
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-benchmark-complex-thread-memory-${suffix}`);
    let projectId: string | null = null;
    let threadId: string | null = null;

    try {
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const modelId = selectOpenAICertificationModel(provider.models)?.id ?? 'gpt-5';

      await seedDurableMemory(projectPath, {
        memoryContent: [
          '# Release board continuity',
          'Preserve the release-board heading, keep the refinement path continuous, and do not restart the project structure during repair.'
        ].join('\n\n'),
        dailyNoteFileName: '2026-03-27.md',
        dailyNoteContent: [
          '# Same-thread note',
          'When the complex project benchmark returns, keep the release board framing and continue in place across build, refine, and repair.'
        ].join('\n\n')
      });

      const project = await ensureProject(window, `E2E OpenAI Benchmark Complex Thread Memory ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', modelId);
      threadId = thread.id;

      await runSameThreadComplexProjectBenchmark(window, {
        providerId: 'openai',
        modelId,
        projectId: project.id,
        projectPath,
        threadId: thread.id,
        promptPrefixLines: [
          'The workspace already contains index.html, styles.css, app.js, and data.js in the repo root. Continue from those existing files instead of treating the workspace as empty.',
          'Preserve any durable workspace memory that is relevant to the release-board direction and same-thread continuity.'
        ]
      });

      const completedThread = await waitForThreadCompletion(window, thread.id);
      const memoryRecallEvent = completedThread.rawOutput.find((event) => {
        if (event.eventType !== 'info') {
          return false;
        }
        const activity = event.payload?.activity as { kind?: string; text?: string } | undefined;
        return activity?.kind === 'memory_recall';
      });

      expect(memoryRecallEvent).toBeTruthy();
      expect((memoryRecallEvent?.payload?.activity as { text?: string } | undefined)?.text ?? '').toContain('MEMORY.md');
      expect((memoryRecallEvent?.payload?.activity as { text?: string } | undefined)?.text ?? '').toContain('2026-03-27.md');
    } finally {
      await maybeExportMixedUseThreadDiagnostics(window, threadId, 'openai').catch(() => undefined);
      await maybeExportMixedUseWorkspaceSnapshot('openai', projectPath).catch(() => undefined);
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Gemini native planner runs through Shift+Tab and continues after answering questions', async () => {
    let { app, window, statePaths } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `gemini-plan-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'gemini');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Gemini CLI must be installed and connected for live E2E.');
      const modelId = selectGeminiSameThreadBenchmarkModel(provider.models)?.id ?? 'gemini-2.5-pro';
      const project = await ensureProject(window, `E2E Gemini Plan ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'gemini', modelId);
      await closeApp(app, { cleanupState: false });
      ({ app, window } = await launchApp(statePaths));
      await expect(window.locator('.windows-titlebar-context-thread')).toHaveText(thread.title, { timeout: 30_000 });

      await expect(
        await chooseComposerModel(
          window,
          'gemini',
          modelId,
          provider.models.find((model) => model.id === modelId)?.label ?? modelId
        )
      ).toBe(true);

      try {
        const composer = window.getByTestId('composer-input');
        await composer.fill('I want to build a simple hero section for a website with a hacker theme. Ask one clarifying question before proposing a plan.');
        await composer.press('Shift+Tab');
        await expect(window.getByText('Plan', { exact: true })).toBeVisible({ timeout: 10_000 });
        await composer.press('Enter');

        const plannerState = await waitForPlannerState(window, thread.id, 90_000);
        if (plannerState.type === 'questions') {
          await expect(window.getByTestId('planner-question-card')).toBeVisible({ timeout: 30_000 });
          const questionSet = plannerState.detail.planner.pendingQuestionSet;
          const firstQuestion = questionSet.questions[0];
          const firstOption = firstQuestion.options[0];
          await window.getByTestId(`planner-option-${firstQuestion.id}-${firstOption.id}`).click();
          await window.getByTestId('planner-submit-answers').click();
        }

        const proposedPlan = await waitForPlannerState(window, thread.id, 90_000);
        expect(proposedPlan.type).toBe('plan');
        await expect(window.getByTestId('planner-plan-card')).toBeVisible({ timeout: 30_000 });
        await window.getByTestId('planner-approve-button').click();
        await waitForActiveRunIndicator(window);
        await waitForPlannerApprovalExecution(window, thread.id);
      } catch (error) {
        await maybeSkipGeminiCapacityFailure(error, modelId, 'native planner flow');
        throw error;
      }
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
    }
  });

  test('Gemini skill-assisted chat flow completes with a deterministic seeded prompt skill', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `gemini-skill-chat-${suffix}`);
    let projectId: string | null = null;
    let skillId: string | null = null;

    try {
      const provider = await getProvider(window, 'gemini');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Gemini CLI must be installed and connected for live E2E.');
      const skill = await createCertificationSkill(window, 'gemini');
      skillId = skill.id;

      const modelId = selectGeminiSameThreadBenchmarkModel(provider.models)?.id ?? 'gemini-2.5-pro';
      const project = await ensureProject(window, `E2E Gemini Skill Chat ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'gemini', modelId);

      const submitted = await window.evaluate(
        async ({ projectId, threadId, providerId, modelId, skillId }) =>
          window.vicode.composer.submit({
            projectId,
            threadId,
            prompt: 'Reply with exactly: Gemini assisted live test passed.',
            providerId,
            modelId,
            executionPermission: 'default',
            skillIds: [skillId]
          }),
        {
          projectId: project.id,
          threadId: thread.id,
          providerId: 'gemini',
          modelId,
          skillId: skill.id
        }
      );

      try {
        expect(submitted.disposition).toBe('started');
        const completedThread = await waitForThreadCompletion(window, thread.id);
        expect(
          completedThread.turns.some(
            (turn) =>
              turn.role === 'user' &&
              Array.isArray(turn.metadata?.skillIds) &&
              (turn.metadata.skillIds as string[]).includes(skill.id)
          )
        ).toBeTruthy();
        expect(completedThread.turns.some((turn) => turn.role === 'assistant' && turn.content.trim().length > 0)).toBeTruthy();
      } catch (error) {
        await maybeSkipGeminiCapacityFailure(error, modelId, 'skill-assisted chat flow');
        throw error;
      }
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId, skillId }).catch(() => undefined);
    }
  });

  test('Gemini completes the marketing-site benchmark scaffold', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `gemini-benchmark-marketing-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'gemini');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Gemini CLI must be installed and connected for live E2E.');
      const modelId = selectGeminiSameThreadBenchmarkModel(provider.models)?.id ?? 'gemini-2.5-pro';
      const project = await ensureProject(window, `E2E Gemini Benchmark Marketing ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'gemini', modelId);

      try {
        await runMarketingSiteBenchmark(window, {
          providerId: 'gemini',
          modelId,
          projectId: project.id,
          projectPath,
          threadId: thread.id
        });
      } catch (error) {
        await maybeSkipGeminiCapacityFailure(error, modelId, 'marketing-site benchmark');
        throw error;
      }
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Gemini completes the dashboard benchmark scaffold', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `gemini-benchmark-dashboard-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'gemini');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Gemini CLI must be installed and connected for live E2E.');
      const modelId = selectGeminiSameThreadBenchmarkModel(provider.models)?.id ?? 'gemini-2.5-pro';
      const project = await ensureProject(window, `E2E Gemini Benchmark Dashboard ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'gemini', modelId);

      try {
        await runDashboardBenchmark(window, {
          providerId: 'gemini',
          modelId,
          projectId: project.id,
          projectPath,
          threadId: thread.id
        });
      } catch (error) {
        await maybeSkipGeminiCapacityFailure(error, modelId, 'dashboard benchmark');
        throw error;
      }
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Gemini completes a skill-assisted React landing-page benchmark', async () => {
    test.setTimeout(480_000);
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `gemini-benchmark-react-landing-${suffix}`);
    let projectId: string | null = null;
    let skillId: string | null = null;

    try {
      const provider = await getProvider(window, 'gemini');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Gemini CLI must be installed and connected for live E2E.');
      const modelId = selectGeminiSameThreadBenchmarkModel(provider.models)?.id ?? 'gemini-2.5-pro';
      const skill = await createCertificationSkill(window, 'gemini', {
        namePrefix: 'react-landing-direction-gemini',
        description: 'Steers React landing pages toward premium component structure and restrained design.',
        instructions: [
          'Build premium React landing pages with strong section hierarchy and reusable UI primitives.',
          'Prefer calm, verification-oriented closeouts and preserve the existing framework structure.',
          'Keep components intentional and avoid generic filler copy.'
        ].join(' ')
      });
      skillId = skill.id;
      const project = await ensureProject(window, `E2E Gemini React Landing ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'gemini', modelId);

      try {
        const completedThread = await runReactLandingBenchmark(window, {
          providerId: 'gemini',
          modelId,
          projectId: project.id,
          projectPath,
          threadId: thread.id,
          skillIds: [skill.id],
          promptPrefixLines: [
            'Use the attached component-direction skill while building this React landing page.',
            'Keep the output framework-shaped and componentized.'
          ]
        });

        expect(
          completedThread.turns.some(
            (turn) =>
              turn.role === 'user'
              && Array.isArray(turn.metadata?.skillIds)
              && (turn.metadata.skillIds as string[]).includes(skill.id)
          )
        ).toBeTruthy();
      } catch (error) {
        await maybeSkipGeminiCapacityFailure(error, modelId, 'skill-assisted React landing-page benchmark');
        throw error;
      }
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId, skillId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'gemini react landing benchmark' });
    }
  });

  test('Gemini completes the docs-site benchmark', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `gemini-benchmark-docs-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'gemini');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Gemini CLI must be installed and connected for live E2E.');
      const modelId = selectGeminiSameThreadBenchmarkModel(provider.models)?.id ?? 'gemini-2.5-pro';
      const project = await ensureProject(window, `E2E Gemini Benchmark Docs ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'gemini', modelId);

      try {
        await runDocsSiteBenchmark(window, {
          providerId: 'gemini',
          modelId,
          projectId: project.id,
          projectPath,
          threadId: thread.id
        });
      } catch (error) {
        await maybeSkipGeminiCapacityFailure(error, modelId, 'docs-site benchmark');
        throw error;
      }
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Gemini completes the auth-app benchmark', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `gemini-benchmark-auth-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'gemini');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Gemini CLI must be installed and connected for live E2E.');
      const modelId = selectGeminiCertificationModel(provider.models)?.id ?? 'gemini-2.5-pro';
      const project = await ensureProject(window, `E2E Gemini Benchmark Auth ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'gemini', modelId);

      try {
        await runAuthAppBenchmark(window, {
          providerId: 'gemini',
          modelId,
          projectId: project.id,
          projectPath,
          threadId: thread.id
        });
      } catch (error) {
        await maybeSkipGeminiCapacityFailure(error, modelId, 'auth-app benchmark');
        throw error;
      }
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Gemini completes the existing-project-refinement benchmark', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `gemini-benchmark-refine-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'gemini');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Gemini CLI must be installed and connected for live E2E.');
      const modelId = selectGeminiCertificationModel(provider.models)?.id ?? 'gemini-2.5-pro';
      const project = await ensureProject(window, `E2E Gemini Benchmark Refine ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'gemini', modelId);

      try {
        await runExistingProjectRefinementBenchmark(window, {
          providerId: 'gemini',
          modelId,
          projectId: project.id,
          projectPath,
          threadId: thread.id
        });
      } catch (error) {
        await maybeSkipGeminiCapacityFailure(error, modelId, 'existing-project-refinement benchmark');
        throw error;
      }
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Gemini completes the bugfix-slice benchmark', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `gemini-benchmark-bugfix-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'gemini');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Gemini CLI must be installed and connected for live E2E.');
      const modelId = selectGeminiCertificationModel(provider.models)?.id ?? 'gemini-2.5-pro';
      const project = await ensureProject(window, `E2E Gemini Benchmark Bugfix ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'gemini', modelId);

      try {
        await runBugfixSliceBenchmark(window, {
          providerId: 'gemini',
          modelId,
          projectId: project.id,
          projectPath,
          threadId: thread.id
        });
      } catch (error) {
        await maybeSkipGeminiCapacityFailure(error, modelId, 'bugfix-slice benchmark');
        throw error;
      }
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Gemini completes the crud-app benchmark', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `gemini-benchmark-feature-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'gemini');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Gemini CLI must be installed and connected for live E2E.');
      const modelId = selectGeminiSameThreadBenchmarkModel(provider.models)?.id ?? 'gemini-2.5-pro';
      const project = await ensureProject(window, `E2E Gemini Benchmark Feature ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'gemini', modelId);

      try {
        await runCrudAppBenchmark(window, {
          providerId: 'gemini',
          modelId,
          projectId: project.id,
          projectPath,
          threadId: thread.id
        });
      } catch (error) {
        await maybeSkipGeminiCapacityFailure(error, modelId, 'crud-app benchmark');
        throw error;
      }
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Gemini completes the same-thread complex-project benchmark', async () => {
    test.setTimeout(720_000);
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `gemini-benchmark-complex-thread-${suffix}`);
    let projectId: string | null = null;
    let threadId: string | null = null;

    try {
      const provider = await getProvider(window, 'gemini');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Gemini CLI must be installed and connected for live E2E.');
      const modelId = selectGeminiSameThreadBenchmarkModel(provider.models)?.id ?? 'gemini-2.5-pro';
      const project = await ensureProject(window, `E2E Gemini Benchmark Complex Thread ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'gemini', modelId);
      threadId = thread.id;

      try {
        await runSameThreadComplexProjectBenchmark(window, {
          providerId: 'gemini',
          modelId,
          projectId: project.id,
          projectPath,
          threadId: thread.id
        });
      } catch (error) {
        await maybeSkipGeminiCapacityFailure(error, modelId, 'same-thread complex-project benchmark');
        throw error;
      }
    } finally {
      await maybeExportMixedUseThreadDiagnostics(window, threadId, 'gemini').catch(() => undefined);
      await maybeExportMixedUseWorkspaceSnapshot('gemini', projectPath).catch(() => undefined);
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Gemini same-thread conversation audit keeps text readable and work signals honest across 10 turns', async () => {
    test.setTimeout(900_000);
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `gemini-conversation-audit-${suffix}`);
    let projectId: string | null = null;
    let threadId: string | null = null;

    try {
      const provider = await getProvider(window, 'gemini');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Gemini CLI must be installed and connected for live E2E.');
      const modelId = selectGeminiSameThreadBenchmarkModel(provider.models)?.id ?? 'gemini-2.5-pro';

      await seedConversationAuditWorkspace(projectPath);

      const project = await ensureProject(window, `E2E Gemini Conversation Audit ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'gemini', modelId);
      threadId = thread.id;
      await openThreadInUi(window, project.id, thread.id, thread.title);

      try {
        const observations = await runConversationAudit(window, {
          providerId: 'gemini',
          modelId,
          projectId: project.id,
          threadId: thread.id,
          turns: getConversationAuditTurns(),
          screenshotPrefix: 'gemini-conversation-audit'
        });

        await expect.poll(async () => await readFile(path.join(projectPath, 'audit-note.txt'), 'utf8'), { timeout: 30_000 }).toContain('Conversation audit in progress.');
        expect(observations.filter((entry) => entry.sawWorkedForDelta)).toHaveLength(1);
        expect(observations.find((entry) => entry.label === 'workspace-write')?.sawWorkedForDelta).toBeTruthy();
      } catch (error) {
        await maybeSkipGeminiCapacityFailure(error, modelId, 'same-thread conversation audit');
        throw error;
      }
    } finally {
      await maybeExportMixedUseThreadDiagnostics(window, threadId, 'gemini').catch(() => undefined);
      await maybeExportMixedUseWorkspaceSnapshot('gemini', projectPath).catch(() => undefined);
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'gemini conversation audit' });
    }
  });

  test('Qwen skill-assisted chat flow completes with a deterministic seeded prompt skill', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `qwen-skill-chat-${suffix}`);
    let projectId: string | null = null;
    let skillId: string | null = null;

    try {
      const provider = await getProvider(window, 'qwen');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Qwen CLI must be installed and connected for live E2E.');
      const skill = await createCertificationSkill(window, 'qwen');
      skillId = skill.id;

      const modelId = selectQwenCertificationModel(provider.models)?.id ?? 'qwen3.5-plus';
      const project = await ensureProject(window, `E2E Qwen Skill Chat ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'qwen', modelId);

      const submitted = await window.evaluate(
        async ({ projectId, threadId, providerId, modelId, skillId }) =>
          window.vicode.composer.submit({
            projectId,
            threadId,
            prompt: 'Reply with exactly: Qwen assisted live test passed.',
            providerId,
            modelId,
            executionPermission: 'default',
            skillIds: [skillId]
          }),
        {
          projectId: project.id,
          threadId: thread.id,
          providerId: 'qwen',
          modelId,
          skillId: skill.id
        }
      );

      expect(submitted.disposition).toBe('started');
      const completedThread = await waitForThreadCompletion(window, thread.id, 180_000);
      expect(
        completedThread.turns.some(
          (turn) =>
            turn.role === 'user' &&
            Array.isArray(turn.metadata?.skillIds) &&
            (turn.metadata.skillIds as string[]).includes(skill.id)
        )
      ).toBeTruthy();
      const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
      expect((assistantTurn?.content ?? '').toLowerCase()).toContain('qwen assisted live test passed');
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId, skillId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Qwen creates and updates a text file in the workspace', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `qwen-files-${suffix}`);
    const createdFilePath = path.join(projectPath, 'hello.txt');
    const updatedFilePath = path.join(projectPath, 'notes.txt');
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'qwen');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Qwen CLI must be installed and connected for live E2E.');
      const modelId = selectQwenCertificationModel(provider.models)?.id ?? 'qwen3.5-plus';
      const project = await ensureProject(window, `E2E Qwen Files ${suffix}`, projectPath);
      projectId = project.id;

      const fileThread = await createThread(window, project.id, 'qwen', modelId);
      const fileSubmitted = await window.evaluate(
        async ({ projectId, threadId, modelId }) =>
          window.vicode.composer.submit({
            projectId,
            threadId,
            prompt: 'Create hello.txt in the workspace root. Write exactly: hello from qwen Then reply with exactly: file created.',
            providerId: 'qwen',
            modelId,
            executionPermission: 'full_access',
            skillIds: []
          }),
        {
          projectId: project.id,
          threadId: fileThread.id,
          modelId
        }
      );

      expect(fileSubmitted.disposition).toBe('started');
      const fileResult = await waitForThreadCompletion(window, fileThread.id, 240_000);
      const fileAssistant = [...fileResult.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
      expect((fileAssistant?.content ?? '').toLowerCase()).toContain('file created');
      await expect.poll(async () => (await readFile(createdFilePath, 'utf8')).trim(), { timeout: 30_000 }).toBe('hello from qwen');

      await writeFile(updatedFilePath, 'title\nreplace me\n', 'utf8');
      const updateThread = await createThread(window, project.id, 'qwen', modelId);
      const updateSubmitted = await window.evaluate(
        async ({ projectId, threadId, modelId }) =>
          window.vicode.composer.submit({
            projectId,
            threadId,
            prompt: 'Update notes.txt in the workspace root so the second line becomes exactly: updated by qwen. Reply with exactly: file updated.',
            providerId: 'qwen',
            modelId,
            executionPermission: 'full_access',
            skillIds: []
          }),
        {
          projectId: project.id,
          threadId: updateThread.id,
          modelId
        }
      );

      expect(updateSubmitted.disposition).toBe('started');
      const updateResult = await waitForThreadCompletion(window, updateThread.id, 240_000);
      const updateAssistant = [...updateResult.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
      expect((updateAssistant?.content ?? '').toLowerCase()).toContain('file updated');
      await expect
        .poll(async () => (await readFile(updatedFilePath, 'utf8')).replace(/\r\n/g, '\n').trimEnd(), { timeout: 30_000 })
        .toBe('title\nupdated by qwen');
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Kimi skill-assisted chat flow completes with a deterministic seeded prompt skill', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `kimi-skill-chat-${suffix}`);
    let projectId: string | null = null;
    let skillId: string | null = null;

    try {
      const provider = await getProvider(window, 'kimi');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Kimi CLI must be installed and connected for live E2E.');
      const skill = await createCertificationSkill(window, 'kimi');
      skillId = skill.id;

      const modelId = selectKimiCertificationModel(provider.models)?.id ?? 'kimi-k2-thinking';
      const project = await ensureProject(window, `E2E Kimi Skill Chat ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'kimi', modelId);

      const submitted = await window.evaluate(
        async ({ projectId, threadId, providerId, modelId, skillId }) =>
          window.vicode.composer.submit({
            projectId,
            threadId,
            prompt: 'Reply with exactly: Kimi assisted live test passed.',
            providerId,
            modelId,
            executionPermission: 'full_access',
            skillIds: [skillId]
          }),
        {
          projectId: project.id,
          threadId: thread.id,
          providerId: 'kimi',
          modelId,
          skillId: skill.id
        }
      );

      expect(submitted.disposition).toBe('started');
      const completedThread = await waitForThreadCompletion(window, thread.id, 180_000);
      expect(
        completedThread.turns.some(
          (turn) =>
            turn.role === 'user' &&
            Array.isArray(turn.metadata?.skillIds) &&
            (turn.metadata.skillIds as string[]).includes(skill.id)
        )
      ).toBeTruthy();
      const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
      expect((assistantTurn?.content ?? '').toLowerCase()).toContain('kimi assisted live test passed');
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId, skillId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Kimi creates a text file in the workspace', async () => {
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `kimi-files-${suffix}`);
    const createdFilePath = path.join(projectPath, 'hello.txt');
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'kimi');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Kimi CLI must be installed and connected for live E2E.');
      const modelId = selectKimiCertificationModel(provider.models)?.id ?? 'kimi-k2-thinking';
      const project = await ensureProject(window, `E2E Kimi Files ${suffix}`, projectPath);
      projectId = project.id;

      const fileThread = await createThread(window, project.id, 'kimi', modelId);
      const submitted = await window.evaluate(
        async ({ projectId, threadId, modelId }) =>
          window.vicode.composer.submit({
            projectId,
            threadId,
            prompt: 'Create hello.txt in the workspace root. Write exactly: hello from kimi Then reply with exactly: file created.',
            providerId: 'kimi',
            modelId,
            executionPermission: 'full_access',
            skillIds: []
          }),
        {
          projectId: project.id,
          threadId: fileThread.id,
          modelId
        }
      );

      expect(submitted.disposition).toBe('started');
      const completedThread = await waitForThreadCompletion(window, fileThread.id, 240_000);
      const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
      expect((assistantTurn?.content ?? '').toLowerCase()).toContain('file created');
      await expect.poll(async () => (await readFile(createdFilePath, 'utf8')).trim(), { timeout: 30_000 }).toBe('hello from kimi');
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Gemini chat generates a response across every discovered Gemini model', async () => {
    test.slow();
    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `gemini-model-matrix-${suffix}`);
    let projectId: string | null = null;

    try {
      const provider = await getProvider(window, 'gemini');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Gemini CLI must be installed and connected for live E2E.');
      const modelIds = provider.models.map((model) => model.id);
      test.skip(modelIds.length === 0, 'No Gemini models were exposed by the connected provider.');

      const project = await ensureProject(window, `E2E Gemini Models ${suffix}`, projectPath);
      projectId = project.id;

      const certifiedModels: string[] = [];
      const skippedCapacityModels: string[] = [];

      for (const modelId of modelIds) {
        const thread = await createThread(window, project.id, 'gemini', modelId);
        const submitted = await window.evaluate(
          async ({ projectId, threadId, modelId }) =>
            window.vicode.composer.submit({
              projectId,
              threadId,
              prompt: `Reply briefly so Vicode can certify that ${modelId} generated a response.`,
              providerId: 'gemini',
              modelId,
              executionPermission: 'default',
              skillIds: []
            }),
          {
            projectId: project.id,
            threadId: thread.id,
            modelId
          }
        );

        expect(submitted.disposition).toBe('started');
        let completedThread;
        try {
          completedThread = await waitForThreadCompletion(window, thread.id, 120_000);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isGeminiCapacityFailure(message)) {
            skippedCapacityModels.push(modelId);
            continue;
          }
          throw error;
        }

        expect(
          completedThread.turns.some((turn) => turn.role === 'assistant' && turn.content.trim().length > 0)
        ).toBeTruthy();
        certifiedModels.push(modelId);
      }

      expect(certifiedModels.length).toBeGreaterThan(0);
      test.info().annotations.push({
        type: 'gemini-capacity-skips',
        description: skippedCapacityModels.length > 0 ? skippedCapacityModels.join(', ') : 'none'
      });
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
    }
  });

  test('Codex native planner runs through Shift+Tab and continues after requestUserInput', async () => {
    let { app, window, statePaths } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `openai-plan-${suffix}`);
    let projectId: string | null = null;

    try {
      console.log('[codex-plan] bootstrap ready');
      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live E2E.');
      const modelId = provider.models[0]?.id ?? 'gpt-5';
      const project = await ensureProject(window, `E2E OpenAI Plan ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'openai', modelId);
      await closeApp(app, { cleanupState: false });
      ({ app, window } = await launchApp(statePaths));
      await expect(window.locator('.windows-titlebar-context-thread')).toHaveText(thread.title, { timeout: 30_000 });
      console.log('[codex-plan] thread opened', thread.id);

      await chooseComposerModel(
        window,
        'openai',
        modelId,
        provider.models.find((model) => model.id === modelId)?.label ?? modelId
      );
      console.log('[codex-plan] model confirmed', modelId);

      const composer = window.getByTestId('composer-input');
      await composer.fill('I want to build a simple hero section for a website with a hacker theme. Ask one clarifying question before proposing a plan.');
      await composer.press('Shift+Tab');
      await expect(window.getByText('Plan', { exact: true })).toBeVisible({ timeout: 10_000 });
      await composer.press('Enter');
      console.log('[codex-plan] planner submitted');

      const plannerState = await waitForPlannerState(window, thread.id, 90_000);
      console.log('[codex-plan] planner state', plannerState.type);
      if (plannerState.type !== 'questions') {
        throw new Error('Codex planner did not emit a native clarifying question.');
      }

      const detailWhileWaiting = await window.evaluate(async ({ threadId }) => window.vicode.threads.open(threadId), {
        threadId: thread.id
      });
      expect(
        detailWhileWaiting.rawOutput.some((event) => {
          if (event.eventType !== 'info') {
            return false;
          }
          const activity = event.payload?.activity as { kind?: string; summary?: string } | undefined;
          return activity?.kind === 'delegation' && activity.summary === 'Delegated planner is waiting for your answers.';
        })
      ).toBe(true);

      await expect(window.getByTestId('planner-question-card')).toBeVisible({ timeout: 30_000 });
      const questionSet = plannerState.detail.planner.pendingQuestionSet;
      const firstQuestion = questionSet.questions[0];
      const firstOption = firstQuestion.options[0];
      await window.getByTestId(`planner-option-${firstQuestion.id}-${firstOption.id}`).click();
      await window.getByTestId('planner-submit-answers').click();
      console.log('[codex-plan] answer submitted');

      const proposedPlan = await waitForPlannerState(window, thread.id, 90_000);
      console.log('[codex-plan] post-answer state', proposedPlan.type);
      expect(proposedPlan.type).toBe('plan');
      const detailWithPlan = await window.evaluate(async ({ threadId }) => window.vicode.threads.open(threadId), {
        threadId: thread.id
      });
      expect(
        detailWithPlan.rawOutput.some((event) => {
          if (event.eventType !== 'info') {
            return false;
          }
          const activity = event.payload?.activity as { kind?: string; summary?: string } | undefined;
          return activity?.kind === 'delegation' && activity.summary === 'Delegated planner proposed a plan.';
        })
      ).toBe(true);
      await expect(window.getByTestId('planner-plan-card')).toBeVisible({ timeout: 30_000 });
      await window.getByTestId('planner-approve-button').click();
      console.log('[codex-plan] plan approved');
      await waitForPlannerApprovalExecution(window, thread.id);
      console.log('[codex-plan] execution started');
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
    }
  });

  test('Hosted Ollama completes a simple chat and creates a text file in the workspace', async () => {
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-hosted-${suffix}`);
    const createdFilePath = path.join(projectPath, 'hello.txt');
    let projectId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const model = selectPreferredOllamaModel(provider.models);
      const project = await ensureProject(window, `E2E Ollama Hosted ${suffix}`, projectPath);
      projectId = project.id;

      const chatThread = await createThread(window, project.id, 'ollama', model.id);
      const chatSubmitted = await window.evaluate(
        async ({ projectId, threadId, modelId }) =>
          window.vicode.composer.submit({
            projectId,
            threadId,
            prompt: 'Reply with exactly: Ollama hosted live test passed.',
            providerId: 'ollama',
            modelId,
            executionPermission: 'default',
            skillIds: []
          }),
        {
          projectId: project.id,
          threadId: chatThread.id,
          modelId: model.id
        }
      );

      expect(chatSubmitted.disposition).toBe('started');
      const chatResult = await waitForThreadCompletion(window, chatThread.id, 180_000);
      const chatAssistant = [...chatResult.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
      expect(chatAssistant?.content ?? '').toContain('Ollama hosted live test passed.');
      expect(JSON.stringify(chatResult.rawOutput ?? [])).not.toContain('"tool_call"');

      const fileThread = await createThread(window, project.id, 'ollama', model.id);
      const fileSubmitted = await window.evaluate(
        async ({ projectId, threadId, modelId }) =>
          window.vicode.composer.submit({
            projectId,
            threadId,
            prompt: 'Create hello.txt in the workspace root using tools. Write exactly: hello from ollama Then reply with exactly: file created.',
            providerId: 'ollama',
            modelId,
            executionPermission: 'default',
            skillIds: []
          }),
        {
          projectId: project.id,
          threadId: fileThread.id,
          modelId: model.id
        }
      );

      expect(fileSubmitted.disposition).toBe('started');
      const fileResult = await waitForThreadCompletion(window, fileThread.id, 240_000);
      const fileAssistant = [...fileResult.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
      expect((fileAssistant?.content ?? '').toLowerCase()).toContain('file created');
      await expect.poll(async () => (await readFile(createdFilePath, 'utf8')).trim(), { timeout: 30_000 }).toBe('hello from ollama');

      const updateTargetPath = path.join(projectPath, 'notes.txt');
      await writeFile(updateTargetPath, 'title\nreplace me\n', 'utf8');
      const updateThread = await createThread(window, project.id, 'ollama', model.id);
      const updateSubmitted = await window.evaluate(
        async ({ projectId, threadId, modelId }) =>
          window.vicode.composer.submit({
            projectId,
            threadId,
            prompt: 'Update notes.txt in the workspace root so the second line becomes exactly: updated by ollama. Reply with exactly: file updated.',
            providerId: 'ollama',
            modelId,
            executionPermission: 'default',
            skillIds: []
          }),
        {
          projectId: project.id,
          threadId: updateThread.id,
          modelId: model.id
        }
      );

      expect(updateSubmitted.disposition).toBe('started');
      const updateResult = await waitForThreadCompletion(window, updateThread.id, 240_000);
      const updateAssistant = [...updateResult.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
      expect((updateAssistant?.content ?? '').toLowerCase()).toContain('file updated');
      await expect
        .poll(async () => (await readFile(updateTargetPath, 'utf8')).replace(/\r\n/g, '\n').trimEnd(), { timeout: 30_000 })
        .toBe('title\nupdated by ollama');

      const siteThread = await createThread(window, project.id, 'ollama', model.id);
      const siteSubmitted = await window.evaluate(
        async ({ projectId, threadId, modelId }) =>
          window.vicode.composer.submit({
            projectId,
            threadId,
            prompt:
              'Create a tiny static site in the workspace root using tools. Write exactly these files: index.html, styles.css, app.js. Requirements: index.html must reference styles.css and app.js, include the visible text "Ollama App Builder", and include an element with id "status". app.js must set that status element text to exactly "ready". styles.css must set the page background to #111. Reply with exactly: site scaffolded.',
            providerId: 'ollama',
            modelId,
            executionPermission: 'default',
            skillIds: []
          }),
        {
          projectId: project.id,
          threadId: siteThread.id,
          modelId: model.id
        }
      );

      expect(siteSubmitted.disposition).toBe('started');
      const siteResult = await waitForThreadCompletion(window, siteThread.id, 300_000);
      const siteAssistant = [...siteResult.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
      expect((siteAssistant?.content ?? '').toLowerCase()).toContain('site scaffolded');
      const indexHtmlPath = path.join(projectPath, 'index.html');
      const stylesCssPath = path.join(projectPath, 'styles.css');
      const appJsPath = path.join(projectPath, 'app.js');
      await expect.poll(async () => await readFile(indexHtmlPath, 'utf8'), { timeout: 30_000 }).toContain('Ollama App Builder');
      await expect.poll(async () => await readFile(indexHtmlPath, 'utf8'), { timeout: 30_000 }).toContain('styles.css');
      await expect.poll(async () => await readFile(indexHtmlPath, 'utf8'), { timeout: 30_000 }).toContain('app.js');
      await expect.poll(async () => await readFile(stylesCssPath, 'utf8'), { timeout: 30_000 }).toContain('#111');
      await expect.poll(async () => await readFile(appJsPath, 'utf8'), { timeout: 30_000 }).toContain('ready');

      if (projectId) {
        await window.evaluate(async (currentProjectId) => {
          await window.vicode.projects.remove(currentProjectId);
        }, projectId);
        projectId = null;
      }
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Hosted Ollama /v1/responses transport completes a live certification flow with tools and a shaped final answer', async () => {
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-responses-cert-${suffix}`);
    const briefPath = path.join(projectPath, 'brief.md');
    const reportPath = path.join(projectPath, 'certification-report.md');
    let projectId: string | null = null;
    let originalTransportMode: 'chat' | 'responses' | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const preferences = await window.evaluate(async () => await window.vicode.settings.get());
      originalTransportMode = preferences.ollamaTransportMode;
      await window.evaluate(async () => {
        await window.vicode.settings.save({
          ollamaTransportMode: 'responses'
        });
      });

      const model = selectPreferredOllamaModel(provider.models);
      const project = await ensureProject(window, `E2E Ollama Responses ${suffix}`, projectPath);
      projectId = project.id;
      await writeFile(
        briefPath,
        [
          '# Responses Transport Certification',
          '',
          '- Objective: confirm that the experimental Ollama responses transport can inspect the workspace, use tools, and produce a concise final answer.',
          '- Deliverable: certification-report.md',
          '- Required phrase: responses transport certification'
        ].join('\n'),
        'utf8'
      );

      const thread = await createThread(window, project.id, 'ollama', model.id);
      const submitted = await window.evaluate(
        async ({ projectId, threadId, modelId }) =>
          window.vicode.composer.submit({
            projectId,
            threadId,
            prompt: [
              'Read brief.md in the workspace using tools.',
              'Then create certification-report.md in the workspace root.',
              'The file must contain exactly these headings: ## Plan, ## Tool Evidence, ## Verdict.',
              'The file must mention brief.md and the exact phrase "responses transport certification".',
              'After the file is written, reply with exactly three bullets in this order:',
              '- Plan: ...',
              '- Tools used: ...',
              '- Result: ...'
            ].join('\n'),
            providerId: 'ollama',
            modelId,
            reasoningEffort: 'low',
            executionPermission: 'default',
            skillIds: []
          }),
        {
          projectId: project.id,
          threadId: thread.id,
          modelId: model.id
        }
      );

      expect(submitted.disposition).toBe('started');
      const completedThread = await waitForThreadCompletion(window, thread.id, 300_000);
      const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
      const assistantContent = (assistantTurn?.content ?? '').trim();
      expect(assistantContent).toContain('- Plan:');
      expect(assistantContent).toContain('- Tools used:');
      expect(assistantContent).toContain('- Result:');

      const rawOutputText = JSON.stringify(completedThread.rawOutput ?? []);
      expect(rawOutputText).toContain('read_file');
      expect(rawOutputText).toContain('list_directory');

      await expect.poll(async () => await readFile(reportPath, 'utf8'), { timeout: 30_000 }).toContain('## Plan');
      await expect.poll(async () => await readFile(reportPath, 'utf8'), { timeout: 30_000 }).toContain('## Tool Evidence');
      await expect.poll(async () => await readFile(reportPath, 'utf8'), { timeout: 30_000 }).toContain('## Verdict');
      await expect.poll(async () => await readFile(reportPath, 'utf8'), { timeout: 30_000 }).toContain('brief.md');
      await expect.poll(async () => await readFile(reportPath, 'utf8'), { timeout: 30_000 }).toContain('responses transport certification');
    } finally {
      if (originalTransportMode) {
        await window.evaluate(async (transportMode) => {
          await window.vicode.settings.save({
            ollamaTransportMode: transportMode
          });
        }, originalTransportMode).catch(() => undefined);
      }
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'hosted ollama responses certification' });
    }
  });

  test('Hosted Ollama completes the marketing-site benchmark scaffold', async () => {
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-benchmark-marketing-${suffix}`);
    let projectId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const model = selectPreferredOllamaModel(provider.models);
      const project = await ensureProject(window, `E2E Ollama Benchmark Marketing ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'ollama', model.id);

      await runMarketingSiteBenchmark(window, {
        providerId: 'ollama',
        modelId: model.id,
        projectId: project.id,
        projectPath,
        threadId: thread.id
      });
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Hosted Ollama marketing-site benchmark surfaces durable memory recall during the run', async () => {
    test.setTimeout(480_000);
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-benchmark-marketing-memory-${suffix}`);
    let projectId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      await seedDurableMemory(projectPath, {
        memoryContent: [
          '# Marketing direction',
          'Northstar Studio should keep a restrained graphite palette, emphasize trust, and preserve the "Book intro call" CTA language.'
        ].join('\n\n'),
        dailyNoteFileName: '2026-03-27.md',
        dailyNoteContent: [
          '# Latest note',
          'When this benchmark comes up again, keep the hero calm and use the Northstar Studio brand cues instead of restarting the visual direction.'
        ].join('\n\n')
      });

      const model = selectPreferredOllamaModel(provider.models);
      const project = await ensureProject(window, `E2E Ollama Benchmark Marketing Memory ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'ollama', model.id);

      const completedThread = await runMarketingSiteBenchmark(window, {
        providerId: 'ollama',
        modelId: model.id,
        projectId: project.id,
        projectPath,
        threadId: thread.id,
        promptPrefixLines: [
          'Preserve any durable workspace memory that is relevant to Northstar Studio and the CTA direction.'
        ]
      });

      const memoryRecallEvent = completedThread.rawOutput.find((event) => {
        if (event.eventType !== 'info') {
          return false;
        }
        const activity = event.payload?.activity as { kind?: string; text?: string } | undefined;
        return activity?.kind === 'memory_recall';
      });

      expect(memoryRecallEvent).toBeTruthy();
      expect((memoryRecallEvent?.payload?.activity as { text?: string } | undefined)?.text ?? '').toContain('MEMORY.md');
      expect((memoryRecallEvent?.payload?.activity as { text?: string } | undefined)?.text ?? '').toContain('2026-03-27.md');
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'hosted ollama marketing memory benchmark' });
    }
  });

  test('Hosted Ollama completes a skill-assisted React landing-page benchmark', async () => {
    test.setTimeout(480_000);
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-benchmark-react-landing-${suffix}`);
    let projectId: string | null = null;
    let skillId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const model = selectPreferredOllamaModel(provider.models);
      const skill = await createCertificationSkill(window, 'ollama', {
        namePrefix: 'react-landing-direction-ollama',
        description: 'Steers React landing pages toward premium component structure and restrained design.',
        instructions: [
          'Build premium React landing pages with strong section hierarchy and reusable UI primitives.',
          'Prefer calm, verification-oriented closeouts and preserve the existing framework structure.',
          'Keep components intentional and avoid generic filler copy.'
        ].join(' ')
      });
      skillId = skill.id;
      const project = await ensureProject(window, `E2E Ollama React Landing ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'ollama', model.id);

      const completedThread = await runReactLandingBenchmark(window, {
        providerId: 'ollama',
        modelId: model.id,
        projectId: project.id,
        projectPath,
        threadId: thread.id,
        skillIds: [skill.id],
        promptPrefixLines: [
          'Use the attached component-direction skill while building this React landing page.',
          'Keep the output framework-shaped and componentized.'
        ]
      });

      expect(
        completedThread.turns.some(
          (turn) =>
            turn.role === 'user'
            && Array.isArray(turn.metadata?.skillIds)
            && (turn.metadata.skillIds as string[]).includes(skill.id)
        )
      ).toBeTruthy();
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId, skillId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'hosted ollama react landing benchmark' });
    }
  });

  test('Hosted Ollama completes a skill-assisted same-thread React landing-page benchmark with durable memory recall', async () => {
    test.setTimeout(900_000);
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-benchmark-react-thread-${suffix}`);
    let projectId: string | null = null;
    let skillId: string | null = null;
    let threadId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      await seedDurableMemory(projectPath, {
        memoryContent: [
          '# React continuity',
          'Keep Northstar Systems branding, preserve the shadcn-ready file structure, and continue build, refine, and repair in the same thread.'
        ].join('\n\n'),
        dailyNoteFileName: '2026-03-27.md',
        dailyNoteContent: [
          '# React same-thread note',
          'Carry the same premium React landing-page direction through the entire thread and do not reset the project structure during repair.'
        ].join('\n\n')
      });

      const model = selectPreferredOllamaModel(provider.models);
      const skill = await createCertificationSkill(window, 'ollama', {
        namePrefix: 'react-thread-direction-ollama',
        description: 'Steers same-thread React landing-page work toward premium component continuity and restrained design.',
        instructions: [
          'Build premium React landing pages with strong section hierarchy and reusable UI primitives.',
          'Keep the same-thread implementation continuous across build, refine, and repair.',
          'Prefer calm, verification-oriented closeouts and preserve the framework structure.'
        ].join(' ')
      });
      skillId = skill.id;

      const project = await ensureProject(window, `E2E Ollama React Thread ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'ollama', model.id);
      threadId = thread.id;

      const completedThread = await runSameThreadReactLandingBenchmark(window, {
        providerId: 'ollama',
        modelId: model.id,
        projectId: project.id,
        projectPath,
        threadId: thread.id,
        executionPermission: 'default',
        skillIds: [skill.id],
        promptPrefixLines: [
          'Use the attached component-direction skill throughout this same-thread React benchmark.',
          'Preserve any durable workspace memory relevant to premium React continuity and the shadcn-ready structure.',
          'Keep the implementation line continuous across build, refine, and repair.',
          'Never call run_command, npm run build, npm install, or any verification command during this benchmark.',
          'If you think you need to verify, stop after editing files and return the result instead.'
        ]
      });

      const memoryRecallEvent = completedThread.rawOutput.find((event) => {
        if (event.eventType !== 'info') {
          return false;
        }
        const activity = event.payload?.activity as { kind?: string; text?: string } | undefined;
        return activity?.kind === 'memory_recall';
      });

      expect(memoryRecallEvent).toBeTruthy();
      expect((memoryRecallEvent?.payload?.activity as { text?: string } | undefined)?.text ?? '').toContain('MEMORY.md');
      expect((memoryRecallEvent?.payload?.activity as { text?: string } | undefined)?.text ?? '').toContain('2026-03-27.md');
      expect(
        completedThread.turns.filter(
          (turn) =>
            turn.role === 'user'
            && Array.isArray(turn.metadata?.skillIds)
            && (turn.metadata.skillIds as string[]).includes(skill.id)
        ).length
      ).toBeGreaterThanOrEqual(4);
    } finally {
      await maybeExportMixedUseThreadDiagnostics(window, threadId, 'ollama').catch(() => undefined);
      await maybeExportMixedUseWorkspaceSnapshot('ollama', projectPath).catch(() => undefined);
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId, skillId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'hosted ollama same-thread react landing benchmark' });
    }
  });

  test('Hosted Ollama completes the dashboard benchmark scaffold', async () => {
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-benchmark-dashboard-${suffix}`);
    let projectId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const model = selectPreferredOllamaModel(provider.models);
      const project = await ensureProject(window, `E2E Ollama Benchmark Dashboard ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'ollama', model.id);

      await runDashboardBenchmark(window, {
        providerId: 'ollama',
        modelId: model.id,
        projectId: project.id,
        projectPath,
        threadId: thread.id
      });
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Hosted Ollama completes the docs-site benchmark', async () => {
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-benchmark-docs-${suffix}`);
    let projectId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const model = selectPreferredOllamaModel(provider.models);
      const project = await ensureProject(window, `E2E Ollama Benchmark Docs ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'ollama', model.id);

      await runDocsSiteBenchmark(window, {
        providerId: 'ollama',
        modelId: model.id,
        projectId: project.id,
        projectPath,
        threadId: thread.id
      });
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Hosted Ollama completes the existing-project-refinement benchmark', async () => {
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-benchmark-refine-${suffix}`);
    let projectId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const model = selectPreferredOllamaModel(provider.models);
      const project = await ensureProject(window, `E2E Ollama Benchmark Refine ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'ollama', model.id);

      await runExistingProjectRefinementBenchmark(window, {
        providerId: 'ollama',
        modelId: model.id,
        projectId: project.id,
        projectPath,
        threadId: thread.id
      });
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Hosted Ollama completes the bugfix-slice benchmark', async () => {
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-benchmark-bugfix-${suffix}`);
    let projectId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const model = selectPreferredOllamaModel(provider.models);
      const project = await ensureProject(window, `E2E Ollama Benchmark Bugfix ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'ollama', model.id);

      await runBugfixSliceBenchmark(window, {
        providerId: 'ollama',
        modelId: model.id,
        projectId: project.id,
        projectPath,
        threadId: thread.id
      });
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Hosted Ollama completes the crud-app benchmark', async () => {
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-benchmark-feature-${suffix}`);
    let projectId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const model = selectPreferredOllamaModel(provider.models);
      const project = await ensureProject(window, `E2E Ollama Benchmark Feature ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'ollama', model.id);

      await runCrudAppBenchmark(window, {
        providerId: 'ollama',
        modelId: model.id,
        projectId: project.id,
        projectPath,
        threadId: thread.id
      });
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Hosted Ollama completes the same-thread complex-project benchmark', async () => {
    test.setTimeout(720_000);
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-benchmark-complex-thread-${suffix}`);
    let projectId: string | null = null;
    let threadId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const model = selectPreferredOllamaModel(provider.models);
      const project = await ensureProject(window, `E2E Ollama Benchmark Complex Thread ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'ollama', model.id);
      threadId = thread.id;

      await runSameThreadComplexProjectBenchmark(window, {
        providerId: 'ollama',
        modelId: model.id,
        projectId: project.id,
        projectPath,
        threadId: thread.id,
        promptPrefixLines: [
          'The workspace already contains index.html, styles.css, app.js, and data.js in the repo root. Continue from those existing files instead of treating the workspace as empty.',
          'Keep data.js imported from ./data.js throughout the same-thread benchmark and preserve the existing ids and release-board framing across build, refine, and repair.'
        ]
      });
    } finally {
      await maybeExportMixedUseThreadDiagnostics(window, threadId, 'ollama').catch(() => undefined);
      await maybeExportMixedUseWorkspaceSnapshot('ollama', projectPath).catch(() => undefined);
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Hosted Ollama same-thread complex-project benchmark surfaces durable memory recall during the run', async () => {
    test.setTimeout(720_000);
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-benchmark-complex-thread-memory-${suffix}`);
    let projectId: string | null = null;
    let threadId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const model = selectPreferredOllamaModel(provider.models);

      await seedDurableMemory(projectPath, {
        memoryContent: [
          '# Release board continuity',
          'Preserve the release-board heading, keep the refinement path continuous, and do not restart the project structure during repair.'
        ].join('\n\n'),
        dailyNoteFileName: '2026-03-27.md',
        dailyNoteContent: [
          '# Same-thread note',
          'When the complex project benchmark returns, keep the release board framing and continue in place across build, refine, and repair.'
        ].join('\n\n')
      });

      const project = await ensureProject(window, `E2E Ollama Benchmark Complex Thread Memory ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'ollama', model.id);
      threadId = thread.id;

      await runSameThreadComplexProjectBenchmark(window, {
        providerId: 'ollama',
        modelId: model.id,
        projectId: project.id,
        projectPath,
        threadId: thread.id,
        stageTimeoutMs: 240_000,
        promptPrefixLines: [
          'The workspace already contains index.html, styles.css, app.js, and data.js in the repo root. Continue from those existing files instead of treating the workspace as empty.',
          'Keep data.js imported from ./data.js throughout the same-thread benchmark and preserve the existing ids and release-board framing across build, refine, and repair.',
          'Preserve any durable workspace memory that is relevant to the release-board direction and same-thread continuity.'
        ]
      });

      const completedThread = await waitForThreadCompletion(window, thread.id);
      const memoryRecallEvent = completedThread.rawOutput.find((event) => {
        if (event.eventType !== 'info') {
          return false;
        }
        const activity = event.payload?.activity as { kind?: string; text?: string } | undefined;
        return activity?.kind === 'memory_recall';
      });

      expect(memoryRecallEvent).toBeTruthy();
      expect((memoryRecallEvent?.payload?.activity as { text?: string } | undefined)?.text ?? '').toContain('MEMORY.md');
      expect((memoryRecallEvent?.payload?.activity as { text?: string } | undefined)?.text ?? '').toContain('2026-03-27.md');
    } finally {
      await maybeExportMixedUseThreadDiagnostics(window, threadId, 'ollama').catch(() => undefined);
      await maybeExportMixedUseWorkspaceSnapshot('ollama', projectPath).catch(() => undefined);
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Hosted Ollama answers a plain chat across the preferred discovered hosted models', async () => {
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-hosted-multimodel-${suffix}`);
    let projectId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const models = selectPreferredOllamaValidationModels(provider.models);
      const project = await ensureProject(window, `E2E Ollama Multi Model ${suffix}`, projectPath);
      projectId = project.id;

      for (const model of models) {
        const thread = await createThread(window, project.id, 'ollama', model.id);
        const submitted = await window.evaluate(
          async ({ projectId, threadId, modelId }) =>
            window.vicode.composer.submit({
              projectId,
              threadId,
              prompt: `Reply with exactly: hosted model ${modelId} passed.`,
              providerId: 'ollama',
              modelId,
              executionPermission: 'default',
              skillIds: []
            }),
          {
            projectId: project.id,
            threadId: thread.id,
            modelId: model.id
          }
        );

        expect(submitted.disposition).toBe('started');
        const completedThread = await waitForThreadCompletion(window, thread.id, 180_000);
        const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
        expect((assistantTurn?.content ?? '').toLowerCase()).toContain(`hosted model ${model.id.toLowerCase()} passed.`);
        expect(JSON.stringify(completedThread.rawOutput ?? [])).not.toContain('"tool_call"');
      }
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Hosted Ollama completes a shaped build-app scaffold across the preferred discovered hosted models', async () => {
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-build-app-multimodel-${suffix}`);
    let projectId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const models = selectPreferredOllamaValidationModels(provider.models);
      const project = await ensureProject(window, `E2E Ollama Build App Multi ${suffix}`, projectPath);
      projectId = project.id;

      for (const [index, model] of models.entries()) {
        const folderName = `site-${index + 1}`;
        const indexPath = path.join(projectPath, folderName, 'index.html');
        const stylesPath = path.join(projectPath, folderName, 'styles.css');
        const scriptPath = path.join(projectPath, folderName, 'main.js');
        const thread = await createThread(window, project.id, 'ollama', model.id);
        const shapedPrompt = buildNativeComposerCommandPrompt(
          'build-app',
          [
            `Create a tiny launch page inside the ${folderName} folder in the current workspace.`,
            'Use exactly three files: index.html, styles.css, and main.js.',
            'Requirements:',
            `- index.html must include the visible text "Hosted ${model.id} Demo"`,
            '- index.html must include a button labeled "Open preview"',
            '- index.html must include an element with id "app-status"',
            '- styles.css must contain the exact text background: #161616;',
            "- main.js must set document.getElementById('app-status').textContent to exactly 'ready to preview'",
            `Reply with exactly: ${folderName} built.`
          ].join('\n')
        );

        const submitted = await window.evaluate(
          async ({ projectId, threadId, modelId, prompt }) =>
            window.vicode.composer.submit({
              projectId,
              threadId,
              prompt,
              providerId: 'ollama',
              modelId,
              executionPermission: 'default',
              skillIds: []
            }),
          {
            projectId: project.id,
            threadId: thread.id,
            modelId: model.id,
            prompt: shapedPrompt
          }
        );

        expect(submitted.disposition).toBe('started');
        const completedThread = await waitForThreadCompletion(window, thread.id, 300_000);
        const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
        expect((assistantTurn?.content ?? '').toLowerCase()).toContain(`${folderName} built`);

        await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain(`Hosted ${model.id} Demo`);
        await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Open preview');
        await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="app-status"');
        await expect.poll(async () => await readFile(stylesPath, 'utf8'), { timeout: 30_000 }).toContain('background: #161616;');
        await expect.poll(async () => await readFile(scriptPath, 'utf8'), { timeout: 30_000 }).toContain("document.getElementById('app-status').textContent = 'ready to preview'");
      }
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Hosted Ollama submits from the composer UI and builds a small multi-file starter', async () => {
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-hosted-ui-${suffix}`);
    const indexPath = path.join(projectPath, 'index.html');
    const stylesPath = path.join(projectPath, 'styles.css');
    const scriptPath = path.join(projectPath, 'main.js');
    let projectId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const model = selectPreferredOllamaModel(provider.models);
      const project = await ensureProject(window, `E2E Ollama Hosted UI ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'ollama', model.id);

      await openThreadInUi(window, project.id, thread.id, thread.title);
      const switched = await chooseComposerModel(window, 'ollama', model.id, model.label);
      expect(switched).toBe(true);

      await submitComposerPrompt(
        window,
        [
          'Create three files in the workspace root: index.html, styles.css, and main.js.',
          'Requirements:',
          '- index.html must include <title>Ollama Starter</title> and a button with the text Count: 0',
          '- styles.css must contain the exact text background: #111;',
          "- main.js must update the button count on click and set document.body.dataset.ready = 'true'",
          'Reply with exactly: starter created.'
        ].join('\n')
      );

      await waitForActiveRunIndicator(window);
      const completedThread = await waitForThreadCompletion(window, thread.id, 240_000);
      const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
      expect((assistantTurn?.content ?? '').toLowerCase()).toContain('starter created');

      await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('<title>Ollama Starter</title>');
      await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Count: 0');
      await expect.poll(async () => await readFile(stylesPath, 'utf8'), { timeout: 30_000 }).toContain('background: #111;');
      await expect.poll(async () => await readFile(scriptPath, 'utf8'), { timeout: 30_000 }).toContain("document.body.dataset.ready = 'true'");
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Hosted Ollama uses /build-app plus a prompt skill to build a richer starter from the composer UI', async () => {
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-build-app-ui-${suffix}`);
    const indexPath = path.join(projectPath, 'index.html');
    const stylesPath = path.join(projectPath, 'styles.css');
    const scriptPath = path.join(projectPath, 'main.js');
    let projectId: string | null = null;
    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const model = selectPreferredOllamaModel(provider.models);
      const project = await ensureProject(window, `E2E Ollama Build App ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'ollama', model.id);

      await openThreadInUi(window, project.id, thread.id, thread.title);
      const switched = await chooseComposerModel(window, 'ollama', model.id, model.label);
      expect(switched).toBe(true);

      await resetComposer(window);
      await selectSlashCommand(window, 'build-app');

      const composer = window.getByTestId('composer-input');
      await composer.fill(
        [
          'Create a tiny premium launch page for Night Lantern in the workspace root.',
          'Use exactly three files: index.html, styles.css, and main.js.',
          'Keep the visual tone dark and minimal.',
          'Requirements:',
          '- index.html must include the visible text "Night Lantern" and a button labeled "Join waitlist"',
          '- index.html must include an element with id "app-status"',
          '- styles.css must contain the exact text background: #101010;',
          "- main.js must set document.getElementById('app-status').textContent to exactly 'launch ready'",
          'Reply with exactly: launch page built.'
        ].join('\n')
      );

      await window.getByTestId('composer-submit-button').click();
      await expect(window.locator('.composer-command-chip')).toHaveCount(0);
      await expect(composer).toHaveValue(/Turn the request below into a concrete build brief/);

      await composer.press('Enter');
      await waitForActiveRunIndicator(window);

      const completedThread = await waitForThreadCompletion(window, thread.id, 300_000);
      const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
      expect((assistantTurn?.content ?? '').toLowerCase()).toContain('launch page built');

      await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Night Lantern');
      await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('Join waitlist');
      await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="app-status"');
      await expect.poll(async () => await readFile(stylesPath, 'utf8'), { timeout: 30_000 }).toContain('background: #101010;');
      await expect.poll(async () => await readFile(scriptPath, 'utf8'), { timeout: 30_000 }).toContain("document.getElementById('app-status').textContent = 'launch ready'");
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Hosted Ollama refines an existing tiny site across multiple files in the same workspace', async () => {
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-hosted-refine-${suffix}`);
    const indexPath = path.join(projectPath, 'index.html');
    const stylesPath = path.join(projectPath, 'styles.css');
    const scriptPath = path.join(projectPath, 'main.js');
    let projectId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const model = selectPreferredOllamaModel(provider.models);
      const project = await ensureProject(window, `E2E Ollama Refine ${suffix}`, projectPath);
      projectId = project.id;

      await writeFile(
        indexPath,
        [
          '<!doctype html>',
          '<html lang="en">',
          '<head><meta charset="UTF-8"><title>Starter</title><link rel="stylesheet" href="styles.css"></head>',
          '<body>',
          '  <main>',
          '    <h1>Starter Counter</h1>',
          '    <button id="counter">Count: 0</button>',
          '    <p id="status">idle</p>',
          '  </main>',
          '  <script src="main.js"></script>',
          '</body>',
          '</html>'
        ].join('\n'),
        'utf8'
      );
      await writeFile(stylesPath, 'body { background: #111; color: white; }\n', 'utf8');
      await writeFile(
        scriptPath,
        [
          "const button = document.getElementById('counter');",
          "const status = document.getElementById('status');",
          'let count = 0;',
          "button?.addEventListener('click', () => {",
          '  count += 1;',
          "  button.textContent = `Count: ${count}`;",
          "  status.textContent = 'clicked';",
          '});'
        ].join('\n'),
        'utf8'
      );

      const thread = await createThread(window, project.id, 'ollama', model.id);
      const submitted = await window.evaluate(
        async ({ projectId, threadId, modelId }) =>
          window.vicode.composer.submit({
            projectId,
            threadId,
            prompt: [
              'Upgrade the existing tiny counter site in the workspace using tools.',
              'Keep editing the existing files index.html, styles.css, and main.js.',
              'Requirements:',
              '- change the page title to exactly Ollama Counter Lab',
              '- add a reset button with id "reset" next to the counter button',
              '- update main.js so clicking reset sets the counter back to Count: 0 and the status text to exactly "reset"',
              '- update styles.css so it includes the exact text accent-color: #7fffd4;',
              'Reply with exactly: counter upgraded.'
            ].join('\n'),
            providerId: 'ollama',
            modelId,
            executionPermission: 'default',
            skillIds: []
          }),
        {
          projectId: project.id,
          threadId: thread.id,
          modelId: model.id
        }
      );

      expect(submitted.disposition).toBe('started');
      const completedThread = await waitForThreadCompletion(window, thread.id, 300_000);
      const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
      expect((assistantTurn?.content ?? '').toLowerCase()).toContain('counter upgraded');

      await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('<title>Ollama Counter Lab</title>');
      await expect.poll(async () => await readFile(indexPath, 'utf8'), { timeout: 30_000 }).toContain('id="reset"');
      await expect.poll(async () => await readFile(stylesPath, 'utf8'), { timeout: 30_000 }).toContain('accent-color: #7fffd4;');
      await expect.poll(async () => await readFile(scriptPath, 'utf8'), { timeout: 30_000 }).toContain("'reset'");
      await expect.poll(async () => await readFile(scriptPath, 'utf8'), { timeout: 30_000 }).toContain('Count: 0');
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Hosted Ollama skill-assisted chat flow completes with a deterministic seeded prompt skill', async () => {
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-skill-chat-${suffix}`);
    let projectId: string | null = null;
    let skillId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const skill = await createCertificationSkill(window, 'ollama');
      skillId = skill.id;
      const model = selectPreferredOllamaModel(provider.models);
      const project = await ensureProject(window, `E2E Ollama Skill Chat ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'ollama', model.id);

      const submitted = await window.evaluate(
        async ({ projectId, threadId, providerId, modelId, skillId }) =>
          window.vicode.composer.submit({
            projectId,
            threadId,
            prompt: 'Reply with exactly: Ollama assisted live test passed.',
            providerId,
            modelId,
            executionPermission: 'default',
            skillIds: [skillId]
          }),
        {
          projectId: project.id,
          threadId: thread.id,
          providerId: 'ollama',
          modelId: model.id,
          skillId: skill.id
        }
      );

      expect(submitted.disposition).toBe('started');
      const completedThread = await waitForThreadCompletion(window, thread.id, 180_000);
      expect(
        completedThread.turns.some(
          (turn) =>
            turn.role === 'user' &&
            Array.isArray(turn.metadata?.skillIds) &&
            (turn.metadata.skillIds as string[]).includes(skill.id)
        )
      ).toBeTruthy();
      const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
      expect(assistantTurn?.content ?? '').toContain('Ollama assisted live test passed.');
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId, skillId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Hosted Ollama same-thread conversation audit keeps text readable and work signals honest across 10 turns', async () => {
    test.setTimeout(900_000);
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-conversation-audit-${suffix}`);
    let projectId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const model = selectPreferredOllamaValidationModels(provider.models)[0] ?? selectPreferredOllamaModel(provider.models);
      test.skip(!model, 'Hosted Ollama must expose a preferred validation model for live E2E.');

      await seedConversationAuditWorkspace(projectPath);

      const project = await ensureProject(window, `E2E Ollama Conversation Audit ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'ollama', model.id);
      await openThreadInUi(window, project.id, thread.id, thread.title);

      const observations = await runConversationAudit(window, {
        providerId: 'ollama',
        modelId: model.id,
        projectId: project.id,
        threadId: thread.id,
        turns: getConversationAuditTurns(),
        screenshotPrefix: 'ollama-conversation-audit'
      });

      await expect.poll(async () => await readFile(path.join(projectPath, 'audit-note.txt'), 'utf8'), { timeout: 30_000 }).toContain('Conversation audit in progress.');
      expect(observations.filter((entry) => entry.sawWorkedForDelta)).toHaveLength(1);
      expect(observations.find((entry) => entry.label === 'workspace-write')?.sawWorkedForDelta).toBeTruthy();
    } finally {
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'hosted ollama conversation audit' });
    }
  });

  test('Hosted Ollama mixed workflow audit exercises slash commands, skills, web research, shell work, and nested file changes in one thread', async () => {
    test.setTimeout(1_200_000);
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const attemptedProjectIds: string[] = [];
    const attemptedProjectPaths: string[] = [];
    let skillId: string | null = null;
    let originalTransportMode: 'chat' | 'responses' | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      const preferences = await window.evaluate(async () => await window.vicode.settings.get());
      originalTransportMode = preferences.ollamaTransportMode;
      await window.evaluate(async () => {
        await window.vicode.settings.save({
          ollamaTransportMode: 'chat'
        });
      });

      const candidateModels = selectPreferredOllamaValidationModels(provider.models);
      const fallbackModel = selectPreferredOllamaModel(provider.models);
      if (fallbackModel && !candidateModels.some((entry) => entry.id === fallbackModel.id)) {
        candidateModels.push(fallbackModel);
      }
      test.skip(candidateModels.length === 0, 'Hosted Ollama must expose a preferred validation model for live E2E.');

      const skill = await createCertificationSkill(window, 'ollama', {
        namePrefix: 'ollama-rich-workflow',
        instructions: 'Follow the user request exactly. Keep the answer to one short sentence unless the user explicitly asks for more.'
      });
      skillId = skill.id;

      let observations: RichWorkflowObservation[] | null = null;
      let successfulProjectPath: string | null = null;
      let lastAttemptError: unknown = null;

      for (const [index, model] of candidateModels.entries()) {
        const attemptSuffix = `${suffix}-${index + 1}`;
        const projectPath = path.join(workspaceRoot, `ollama-rich-workflow-${attemptSuffix}`);
        attemptedProjectPaths.push(projectPath);
        await seedConversationAuditWorkspace(projectPath);

        const project = await ensureProject(window, `E2E Ollama Rich Workflow ${attemptSuffix}`, projectPath);
        attemptedProjectIds.push(project.id);
        const thread = await createThread(window, project.id, 'ollama', model.id);
        await openThreadInUi(window, project.id, thread.id, thread.title);
        const switched = await chooseComposerModel(window, 'ollama', model.id, model.label);
        expect(switched).toBe(true);

        try {
          observations = await runRichWorkflowAudit(window, {
            providerId: 'ollama',
            modelId: model.id,
            projectId: project.id,
            threadId: thread.id,
            projectPath,
            skillId: skill.id,
            screenshotPrefix: 'ollama-rich-workflow'
          });
          successfulProjectPath = projectPath;
          break;
        } catch (error) {
          lastAttemptError = error;
          test.info().annotations.push({
            type: 'note',
            description: `Hosted Ollama rich workflow attempt failed on model ${model.id}: ${error instanceof Error ? error.message : String(error)}`
          });
          await cleanupDurableState({ projectId: project.id }).catch(() => undefined);
          await cleanupBenchmarkWorkspace(projectPath).catch(() => undefined);
        }
      }

      if (!observations || !successfulProjectPath) {
        throw (lastAttemptError instanceof Error
          ? lastAttemptError
          : new Error('Hosted Ollama rich workflow audit did not complete on any validation model.'));
      }

      const allActivityKinds = new Set(observations.flatMap((observation) => observation.activityKinds));
      const bunResearchNotes = await readFile(path.join(successfulProjectPath, 'docs', 'research', 'bun-shell-notes.md'), 'utf8');
      expect(allActivityKinds.has('memory_recall')).toBeTruthy();
      expect(allActivityKinds.has('terminal_command')).toBeTruthy();
      expect(allActivityKinds.has('file_write') || allActivityKinds.has('mkdir')).toBeTruthy();
      expect(bunResearchNotes).toContain('Sources:');
      expect(/https?:\/\//iu.test(bunResearchNotes)).toBe(true);
      expect(observations.filter((observation) => observation.sawWorkedForDelta)).toHaveLength(4);
    } finally {
      if (originalTransportMode) {
        await window.evaluate(async (transportMode) => {
          await window.vicode.settings.save({
            ollamaTransportMode: transportMode
          });
        }, originalTransportMode).catch(() => undefined);
      }
      await closeApp(app).catch(() => undefined);
      for (const projectId of attemptedProjectIds) {
        await cleanupDurableState({ projectId }).catch(() => undefined);
      }
      if (skillId) {
        await cleanupDurableState({ skillId }).catch(() => undefined);
      }
      for (const projectPath of attemptedProjectPaths) {
        await cleanupBenchmarkWorkspace(projectPath, { preserveOnFailure: true, label: 'hosted ollama rich workflow audit' }).catch(() => undefined);
      }
    }
  });

  test('Hosted Ollama can use a connected MCP tool during a live chat run', async () => {
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-mcp-chat-${suffix}`);
    let projectId: string | null = null;
    let serverId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      serverId = await window.evaluate(async ({ command, args }) => {
        const saved = await window.vicode.mcp.saveServer({
          name: 'Fixture MCP Live',
          command,
          args,
          enabled: true,
          toolInvocationMode: 'allow',
          launchApproved: false
        });
        await window.vicode.mcp.approveLaunch(saved.id);
        return saved.id;
      }, {
        command: process.execPath,
        args: [path.join(process.cwd(), 'test', 'fixtures', 'mcp', 'stdio-server.mjs')]
      });

      await expect.poll(
        async () => {
          const catalog = await window.evaluate(async () => window.vicode.mcp.listCatalog());
          return catalog.tools.map((tool) => `${tool.serverId}/${tool.name}`).join(',');
        },
        { timeout: 30_000 }
      ).toContain(`${serverId}/echo`);

      const model = selectPreferredOllamaModel(provider.models);
      const project = await ensureProject(window, `E2E Ollama MCP Chat ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'ollama', model.id);

      const submitted = await window.evaluate(
        async ({ projectId, threadId, providerId, modelId, serverId }) =>
          window.vicode.composer.submit({
            projectId,
            threadId,
            prompt: [
              'This task is only correct if you invoke the connected MCP echo tool.',
              'Do not answer from memory and do not skip the tool call.',
              `Call server ${serverId} and tool echo with text exactly: mcp:hello-world.`,
              'After the tool returns, reply with the tool output only.'
            ].join('\n'),
            providerId,
            modelId,
            executionPermission: 'default',
            skillIds: []
          }),
        {
          projectId: project.id,
          threadId: thread.id,
          providerId: 'ollama',
          modelId: model.id,
          serverId
        }
      );

      expect(submitted.disposition).toBe('started');
      const completedThread = await waitForThreadCompletion(window, thread.id, 180_000);
      const rawOutputText = JSON.stringify(completedThread.rawOutput ?? []);
      expect(rawOutputText).toContain('"toolName":"use_mcp_tool"');
      expect(rawOutputText).toContain('Completed MCP tool echo');
      expect(rawOutputText.replace(/\s+/g, '')).toContain('mcp:hello-world');
      const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
      expect((assistantTurn?.content ?? '').toLowerCase()).toContain('hello-world');
    } finally {
      if (serverId) {
        await window.evaluate(async (currentServerId) => {
          await window.vicode.mcp.removeServer(currentServerId);
        }, serverId).catch(() => undefined);
      }
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('Hosted Ollama completes an MCP-assisted dashboard benchmark with tool-shaped data', async () => {
    const useDurableState = process.env.VICODE_LIVE_OLLAMA_USE_DURABLE_STATE === '1';
    const durableStatePaths = useDurableState ? getDurableStatePaths() : null;
    test.skip(
      !durableStatePaths && !process.env.VICODE_OLLAMA_API_KEY && !process.env.OLLAMA_API_KEY,
      'Set VICODE_OLLAMA_API_KEY or VICODE_LIVE_OLLAMA_USE_DURABLE_STATE=1 to run hosted Ollama live E2E.'
    );

    const { app, window } = await launchApp(durableStatePaths ?? undefined);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `ollama-mcp-dashboard-${suffix}`);
    const indexPath = path.join(projectPath, 'index.html');
    let projectId: string | null = null;
    let serverId: string | null = null;

    try {
      await prepareHostedOllamaProvider(window);
      const provider = await getProvider(window, 'ollama');
      test.skip(provider.authState !== 'connected', 'Hosted Ollama must be connected for live E2E.');
      test.skip(provider.models.length === 0, 'Hosted Ollama must have at least one discovered model for live E2E.');

      serverId = await window.evaluate(async ({ command, args }) => {
        const saved = await window.vicode.mcp.saveServer({
          name: 'Fixture MCP Dashboard',
          command,
          args,
          enabled: true,
          toolInvocationMode: 'allow',
          launchApproved: false
        });
        await window.vicode.mcp.approveLaunch(saved.id);
        return saved.id;
      }, {
        command: process.execPath,
        args: [path.join(process.cwd(), 'test', 'fixtures', 'mcp', 'stdio-server.mjs')]
      });

      await expect.poll(
        async () => {
          const catalog = await window.evaluate(async () => window.vicode.mcp.listCatalog());
          return catalog.tools.map((tool) => `${tool.serverId}/${tool.name}`).join(',');
        },
        { timeout: 30_000 }
      ).toContain(`${serverId}/dashboard_snapshot`);

      const model = selectPreferredOllamaModel(provider.models);
      const project = await ensureProject(window, `E2E Ollama MCP Dashboard ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, 'ollama', model.id);

      const completedThread = await runDashboardBenchmark(window, {
        providerId: 'ollama',
        modelId: model.id,
        projectId: project.id,
        projectPath,
        threadId: thread.id,
        promptPrefixLines: [
          'This dashboard task is only correct if you invoke the connected MCP dashboard snapshot tool first.',
          'Do not answer from memory and do not skip the tool call.',
          `Call server ${serverId} and tool dashboard_snapshot before writing files.`,
          'Render the exact returned environment label, deployment names, and alert labels into the built dashboard UI.',
          'If the MCP tool is unavailable, treat the task as incomplete.'
        ]
      });

      expect(JSON.stringify(completedThread.rawOutput ?? [])).toContain('dashboard_snapshot');
      expect(JSON.stringify(completedThread.rawOutput ?? [])).toContain('canary-west-17');
      await withLocalProjectPreview(indexPath, async (preview) => {
        await expect(preview.locator('body')).toContainText('3 healthy / 1 degraded');
        await expect(preview.locator('body')).toContainText('canary-west-17');
        await expect(preview.locator('body')).toContainText('ledger-sync-eu');
        await expect(preview.locator('body')).toContainText('Queue backlog > 120s');
        await expect(preview.locator('body')).toContainText('CPU saturation / jobs-api');
      });

      const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
      expect((assistantTurn?.content ?? '').toLowerCase()).toContain('dashboard');
    } finally {
      if (serverId) {
        await window.evaluate(async (currentServerId) => {
          await window.vicode.mcp.removeServer(currentServerId);
        }, serverId).catch(() => undefined);
      }
      await closeApp(app).catch(() => undefined);
      await cleanupDurableState({ projectId }).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  for (const providerId of ['openai', 'gemini'] as const) {
    test(`${providerId === 'openai' ? 'Codex' : 'Gemini'} stays in the active workspace instead of editing a sibling decoy repo`, async () => {
      const { app, window } = await launchApp();
      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const activeWorkspacePath = path.join(workspaceRoot, `${providerId}-workspace-steering-active-${suffix}`);
      const decoyWorkspacePath = path.join(workspaceRoot, `${providerId}-workspace-steering-decoy-${suffix}`);
      let projectId: string | null = null;

      try {
        const provider = await getProvider(window, providerId);
        test.skip(
          !provider.installed || provider.authState !== 'connected',
          `${providerId === 'openai' ? 'Codex' : 'Gemini'} CLI must be installed and connected for live E2E.`
        );

        const modelId =
          providerId === 'openai'
            ? (provider.models[0]?.id ?? 'gpt-5')
            : (selectGeminiCertificationModel(provider.models)?.id ?? 'gemini-2.5-pro');
        const decoySnapshot = await createWorkspaceSteeringDecoyRepo(decoyWorkspacePath);
        const project = await ensureProject(window, `E2E Workspace Steering ${providerId} ${suffix}`, activeWorkspacePath);
        projectId = project.id;
        const thread = await createThread(window, project.id, providerId, modelId);
        const submitted = await window.evaluate(
          async ({ projectId, threadId, providerId, modelId, prompt }) =>
            window.vicode.composer.submit({
              projectId,
              threadId,
              prompt,
              providerId,
              modelId,
              executionPermission: 'default',
              skillIds: []
            }),
          {
            projectId: project.id,
            threadId: thread.id,
            providerId,
            modelId,
            prompt:
              'Update the existing homepage hero section in this project. The target files are src/App.jsx, src/components/sections/home/HeroSection.jsx, and src/content/siteContent.js. If those files are not present in the active workspace, say so instead of choosing another project.'
          }
        );

        try {
          expect(submitted.disposition).toBe('started');
          const completedThread = await waitForThreadCompletion(window, thread.id, 120_000);
          const assistantTurn = [...completedThread.turns].reverse().find((turn) => turn.role === 'assistant');
          expect(assistantTurn?.content?.trim().length ?? 0).toBeGreaterThan(0);
          expect(JSON.stringify(completedThread)).not.toContain(decoyWorkspacePath);
          await expectWorkspaceSteeringDidNotTouchDecoyRepo(decoySnapshot);
        } catch (error) {
          if (providerId === 'gemini') {
            await maybeSkipGeminiCapacityFailure(error, modelId, 'workspace-steering benchmark');
          }
          throw error;
        }
      } finally {
        await closeApp(app).catch(() => undefined);
        await cleanupDurableState({ projectId }).catch(() => undefined);
      }
    });
  }
});
