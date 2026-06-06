import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { encodeCustomProviderModelId } from '../src/shared/custom-provider-routing';
import { closeApp, launchApp, waitForBridge } from './helpers/electron';
import { expectNoVisibleRunFailures } from './helpers/run-failure-diagnostics';

const NATURAL_ROOFING_PROMPT = [
  'I want to build a html / css / js landing page hero section just like this.',
  '',
  'I want you to get an image from unsplash for a roofing business that will go as the hero image.'
].join('\n');

function readRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function toolCall(name: string, args: Record<string, unknown>, index: number) {
  return {
    id: `call-${index}`,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args)
    }
  };
}

async function startScriptedAppBuilderServer() {
  const requests: string[] = [];
  let responseIndex = 0;
  let fixtureUrl = '';
  const responses = [
    () => [
      toolCall('extract_web_page', {
        url: fixtureUrl,
        query: 'roofing hero image'
      }, 1)
    ],
    [
      toolCall('write_file', {
        path: 'index.html',
        content: [
          '<!doctype html>',
          '<html lang="en">',
          '<head>',
          '  <meta charset="utf-8" />',
          '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
          '  <title>Swift Roofer</title>',
          '  <link rel="stylesheet" href="styles.css" />',
          '</head>',
          '<body>',
          '  <main id="hero" class="hero">',
          '    <img class="hero-image" src="https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1600&q=80" alt="Roofing crew working on a home" />',
          '    <section class="hero-copy">',
          '      <p class="eyebrow">Swift Roofer</p>',
          '      <h1>Fast & Reliable Roofing Services</h1>',
          '      <p>Storm repairs, replacements, and inspections for homes that need a clean, durable roof.</p>',
          '      <button id="roofing-status" type="button">Checking availability</button>',
          '    </section>',
          '  </main>',
          '  <script src="main.js"></script>',
          '</body>',
          '</html>'
        ].join('\n')
      }, 2),
      toolCall('write_file', {
        path: 'styles.css',
        content: [
          ':root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }',
          'body { margin: 0; background: #101418; color: #f8fafc; }',
          '.hero { min-height: 100vh; display: grid; grid-template-columns: 1.1fr 0.9fr; align-items: center; overflow: hidden; }',
          '.hero-image { width: 100%; height: 100vh; object-fit: cover; }',
          '.hero-copy { padding: 64px; max-width: 620px; }',
          '.eyebrow { color: #fbbf24; font-weight: 700; letter-spacing: 0; }',
          'h1 { font-size: 56px; line-height: 1.02; margin: 0 0 20px; }',
          'button { border: 0; padding: 14px 18px; font-weight: 700; background: #fbbf24; color: #111827; }',
          '@media (max-width: 720px) { .hero { grid-template-columns: 1fr; } .hero-image { height: 42vh; } .hero-copy { padding: 32px; } h1 { font-size: 38px; } }'
        ].join('\n')
      }, 3),
      toolCall('write_file', {
        path: 'main.js',
        content: [
          "const status = document.getElementById('roofing-status');",
          "if (status) status.textContent = 'roofing landing ready';"
        ].join('\n')
      }, 4)
    ],
    []
  ];

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url?.startsWith('/fixture/roofing-image')) {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end([
        '<!doctype html>',
        '<title>Roofing hero image fixture</title>',
        '<main>',
        '  <h1>Unsplash roofing business hero image</h1>',
        '  <a href="https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1600&q=80">Roofing crew working on a home</a>',
        '</main>'
      ].join('\n'));
      return;
    }

    requests.push(await readRequestBody(request));
    const scripted = responses[Math.min(responseIndex, responses.length - 1)] ?? [];
    const toolCalls = typeof scripted === 'function' ? scripted() : scripted;
    responseIndex += 1;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      choices: [
        {
          message: {
            role: 'assistant',
            content: toolCalls.length > 0 ? '' : 'roofing landing page built.',
            tool_calls: toolCalls
          }
        }
      ]
    }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  fixtureUrl = `http://127.0.0.1:${address.port}/fixture/roofing-image`;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    })
  };
}

test('natural app-builder prompt writes real HTML CSS and JS files through the Electron composer', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-natural-app-builder-'));
  const compatibleServer = await startScriptedAppBuilderServer();
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.providers', 'vicode.composer']
  });
  let projectId: string | null = null;

  try {
    const setup = await window.evaluate(async ({ workspaceDir, baseUrl }) => {
      const customProvider = await window.vicode.providers.saveCustom({
        name: 'Natural Builder Test',
        transportKind: 'openai_compatible_chat',
        baseUrl,
        apiKey: 'natural-builder-secret',
        defaultModelId: 'natural-builder-model',
        enabled: true
      });
      const project = await window.vicode.projects.create({
        name: `Natural app builder ${Date.now()}`,
        folderPath: workspaceDir,
        trusted: true
      });
      return {
        customProviderId: customProvider.id,
        projectId: project.id
      };
    }, { workspaceDir, baseUrl: compatibleServer.baseUrl });
    projectId = setup.projectId;
    const modelId = encodeCustomProviderModelId({
      customProviderId: setup.customProviderId,
      modelId: 'natural-builder-model'
    });

    const thread = await window.evaluate(async ({ projectId, modelId }) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const created = await window.vicode.threads.create({
        projectId,
        providerId: 'openai_compatible',
        modelId,
        executionPermission: 'full_access'
      });
      await window.vicode.settings.save({
        selectedProjectId: projectId,
        lastOpenedThreadId: created.id,
        defaultProviderId: 'openai_compatible',
        defaultModelByProvider: {
          ...bootstrap.preferences.defaultModelByProvider,
          openai_compatible: modelId
        }
      });
      return created;
    }, { projectId, modelId });

    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.providers', 'vicode.composer']);

    const submitted = await window.evaluate(
      async ({ projectId, threadId, modelId, prompt }) =>
        window.vicode.composer.submit({
          projectId,
          threadId,
          prompt,
          providerId: 'openai_compatible',
          modelId,
          executionPermission: 'full_access',
          skillIds: []
        }),
      {
        projectId,
        threadId: thread.id,
        modelId,
        prompt: NATURAL_ROOFING_PROMPT
      }
    );
    expect(submitted.disposition).toBe('started');
    expect(submitted.runId?.length ?? 0).toBeGreaterThan(0);

    await expect.poll(async () => {
      const detail = await window.evaluate(async (threadId) => window.vicode.threads.open(threadId), thread.id);
      return detail.status;
    }, { timeout: 45_000 }).toBe('completed');
    await expectNoVisibleRunFailures(window, testInfo, {
      label: 'natural app-builder success',
      threadId: thread.id,
      workspaceDir
    });

    const changeCard = window.getByTestId('run-change-card').last();
    await expect(changeCard).toContainText('3 files changed');
    await expect(changeCard).toContainText('index.html');
    await expect(changeCard).toContainText('styles.css');
    await expect(changeCard).toContainText('main.js');
    await expect(window.getByTestId('run-staged-workspace-card')).toHaveCount(0);
    await expect(window.getByTestId('run-worktree-review-card')).toHaveCount(0);

    await expect.poll(async () => await readdir(workspaceDir), { timeout: 15_000 }).toEqual(
      expect.arrayContaining(['index.html', 'styles.css', 'main.js'])
    );
    await expect.poll(async () => await readFile(path.join(workspaceDir, 'index.html'), 'utf8'), { timeout: 15_000 }).toContain('Fast & Reliable Roofing Services');
    await expect.poll(async () => await readFile(path.join(workspaceDir, 'index.html'), 'utf8'), { timeout: 15_000 }).toContain('unsplash.com');
    await expect.poll(async () => await readFile(path.join(workspaceDir, 'styles.css'), 'utf8'), { timeout: 15_000 }).toContain('@media (max-width: 720px)');
    await expect.poll(async () => await readFile(path.join(workspaceDir, 'main.js'), 'utf8'), { timeout: 15_000 }).toContain('roofing landing ready');
    const firstRequest = JSON.parse(compatibleServer.requests[0] ?? '{}') as {
      messages?: Array<{ content?: unknown }>;
    };
    const secondRequestText = compatibleServer.requests[1] ?? '';
    expect(
      firstRequest.messages?.some((message) =>
        typeof message.content === 'string' && message.content.includes(NATURAL_ROOFING_PROMPT)
      )
    ).toBe(true);
    expect(compatibleServer.requests.length).toBeGreaterThanOrEqual(3);
    expect(secondRequestText).toContain('"role":"tool"');
    expect(secondRequestText).toContain('Extracted page: Roofing hero image fixture');
  } finally {
    await compatibleServer.close().catch(() => undefined);
    if (projectId) {
      await window.evaluate(async (projectId) => {
        await window.vicode.projects.remove(projectId).catch(() => undefined);
      }, projectId).catch(() => undefined);
    }
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
