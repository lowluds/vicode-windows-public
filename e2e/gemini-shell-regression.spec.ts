import { expect, test, type Page } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { closeApp, launchApp as launchElectronApp } from './helpers/electron';

const root = process.cwd();
const workspaceRoot = path.join(root, 'test', '.e2e-workspaces');
const WINDOWS_CONSOLE_HELPER_ERROR = 'Gemini CLI failed while attaching its Windows console helper.';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGeminiCapacityFailure(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('rate limited or out of capacity') ||
    normalized.includes('no server capacity right now') ||
    normalized.includes('exhausted your capacity')
  );
}

async function launchApp() {
  return await launchElectronApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.providers', 'vicode.composer'],
    timeoutMs: 60_000
  });
}

async function ensureProject(window: Page, projectName: string, folderPath: string) {
  await mkdir(folderPath, { recursive: true });
  return await window.evaluate(
    async ({ projectName, folderPath }) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const existing = bootstrap.projects.find((project) => project.name === projectName);
      if (existing) {
        return await window.vicode.projects.update({
          id: existing.id,
          folderPath,
          trusted: true
        });
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

async function getProvider(window: Page) {
  const bootstrap = await window.evaluate(() => window.vicode.app.getBootstrap());
  const provider = bootstrap.providers.find((entry) => entry.id === 'gemini');
  if (!provider) {
    throw new Error('Gemini provider not found.');
  }
  return provider;
}

async function createThread(window: Page, projectId: string, modelId: string) {
  return await window.evaluate(
    async ({ projectId, modelId }) =>
      window.vicode.threads.create({
        projectId,
        providerId: 'gemini',
        modelId,
        executionPermission: 'default'
      }),
    { projectId, modelId }
  );
}

async function waitForThreadCompletion(window: Page, threadId: string, timeoutMs = 180_000) {
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
        `Thread ${threadId} failed. Last events: ${JSON.stringify(detail.rawOutput?.slice(-12) ?? [])}`
      );
    }
    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for thread ${threadId}. Last status: ${lastDetail?.status ?? 'unknown'}. Last events: ${JSON.stringify(lastDetail?.rawOutput?.slice(-12) ?? [])}`
  );
}

async function submitPrompt(window: Page, projectId: string, threadId: string, modelId: string, prompt: string) {
  return await window.evaluate(
    async ({ projectId, threadId, modelId, prompt }) =>
      window.vicode.composer.submit({
        projectId,
        threadId,
        prompt,
        providerId: 'gemini',
        modelId,
        executionPermission: 'default',
        skillIds: []
      }),
    { projectId, threadId, modelId, prompt }
  );
}

async function seedWorkspace(folderPath: string) {
  await mkdir(path.join(folderPath, 'tests'), { recursive: true });
  await writeFile(
    path.join(folderPath, 'package.json'),
    JSON.stringify(
      {
        name: 'gemini-shell-regression',
        private: true,
        type: 'module',
        scripts: {
          test: 'node tests/message-check.mjs'
        }
      },
      null,
      2
    ),
    'utf8'
  );
  await writeFile(
    path.join(folderPath, 'index.html'),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Messages</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <main class="device">
      <button id="message-button" type="button" aria-controls="message-panel">Messages</button>
      <section id="message-panel" class="message-panel is-open">
        <h1>Messages</h1>
        <p>The panel should remain visible after the button is clicked.</p>
      </section>
    </main>
  </body>
</html>
`,
    'utf8'
  );
  await writeFile(
    path.join(folderPath, 'style.css'),
    `.device {
  width: 360px;
  margin: 40px auto;
}

.message-panel {
  display: block;
}
`,
    'utf8'
  );
  await writeFile(
    path.join(folderPath, 'tests', 'message-check.mjs'),
    `import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const css = readFileSync(path.join(root, 'style.css'), 'utf8');

if (!html.includes('id="message-button"')) {
  throw new Error('Missing message button.');
}

if (!html.includes('id="message-panel"')) {
  throw new Error('Missing message panel.');
}

if (!css.includes('.message-panel')) {
  throw new Error('Missing message panel styles.');
}

if (!css.includes('display: block')) {
  throw new Error('Message panel is not visible by default.');
}

console.log('message panel check passed');
`,
    'utf8'
  );
}

test.describe.serial('@live-provider Gemini shell regression', () => {
  test('runs shell commands across multiple prompts without the Windows console helper failure', async () => {
    test.slow();
    test.setTimeout(240_000);

    const { app, window } = await launchApp();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `gemini-shell-regression-${suffix}`);
    let projectId: string | null = null;

    try {
      await seedWorkspace(projectPath);
      const provider = await getProvider(window);
      test.skip(!provider.installed || provider.authState !== 'connected', 'Gemini CLI must be installed and connected for live E2E.');
      const shellModelId = provider.models.some((model) => model.id === 'auto-gemini-2.5')
        ? 'auto-gemini-2.5'
        : provider.models.some((model) => model.id === 'gemini-2.5-pro')
          ? 'gemini-2.5-pro'
        : provider.models.some((model) => model.id === 'gemini-2.5-flash')
          ? 'gemini-2.5-flash'
          : null;
      test.skip(!shellModelId, 'Auto Gemini 2.5, Gemini 2.5 Pro, or Gemini 2.5 Flash must be available in the connected CLI.');

      const project = await ensureProject(window, `E2E Gemini Shell Regression ${suffix}`, projectPath);
      projectId = project.id;
      const thread = await createThread(window, project.id, shellModelId!);

      const prompts = [
        {
          prompt: 'Reply with exactly: Gemini shell regression chat passed. Do not use tools.',
          expectedAssistantText: 'Gemini shell regression chat passed.'
        },
        {
          prompt: 'Read index.html and style.css and summarize the page in one sentence. Do not run shell commands.'
        },
        {
          prompt: 'Run npm test exactly once. Do not run any other shell commands. Tell me whether it passed.'
        },
        {
          prompt: 'Run node tests/message-check.mjs exactly once. Do not run any other shell commands. Tell me whether it passed.'
        }
      ];

      try {
        for (const entry of prompts) {
          const submitted = await submitPrompt(window, project.id, thread.id, shellModelId!, entry.prompt);
          expect(submitted.disposition).toBe('started');
          const detail = await waitForThreadCompletion(window, thread.id);
          const rawOutput = JSON.stringify(detail.rawOutput ?? []);
          expect(rawOutput).not.toContain(WINDOWS_CONSOLE_HELPER_ERROR);
          if (entry.expectedAssistantText) {
            const assistantTurn = [...detail.turns]
              .reverse()
              .find((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
            expect(assistantTurn?.content.trim()).toContain(entry.expectedAssistantText);
          }
        }

        const detail = await window.evaluate(async ({ threadId }) => window.vicode.threads.open(threadId), { threadId: thread.id });
        const rawOutput = JSON.stringify(detail.rawOutput ?? []);
        expect(rawOutput).toContain('npm test');
        expect(rawOutput).toContain('node tests/message-check.mjs');
        expect(rawOutput).not.toContain(WINDOWS_CONSOLE_HELPER_ERROR);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isGeminiCapacityFailure(message)) {
          test.skip(true, `Gemini capacity exhausted for ${shellModelId} during the shell regression flow.`);
        }
        throw error;
      }
    } finally {
      await closeApp(app).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
