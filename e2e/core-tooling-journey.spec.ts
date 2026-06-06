import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { encodeCustomProviderModelId } from '../src/shared/custom-provider-routing';
import { closeApp, launchApp, waitForBridge } from './helpers/electron';
import {
  expectNoVisibleRunFailures,
  expectVisibleRunFailure
} from './helpers/run-failure-diagnostics';

const SETUP_PROMPT = 'Can you look at this reference and tell me what kind of page we should build?';
const BUILD_PROMPT = [
  'Build a small html / css / js landing page like the attached reference image.',
  '',
  'Use a roofing business hero section, include an image reference, use the existing project notes if helpful, and write the actual files into this workspace.'
].join('\n');
const TINY_REFERENCE_IMAGE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

interface ScriptedResponse {
  content?: string;
  toolCalls?: Array<ReturnType<typeof toolCall>>;
}

type ScriptedResponseEntry = ScriptedResponse | (() => ScriptedResponse);

interface ScriptedFixture {
  fixtureUrl(): string;
}

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

async function startScriptedProvider(createResponses: (fixture: ScriptedFixture) => ScriptedResponseEntry[]) {
  const requests: string[] = [];
  let responseIndex = 0;
  let fixtureUrl = '';
  const responses = createResponses({
    fixtureUrl: () => fixtureUrl
  });

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url?.startsWith('/search/')) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end([
        '<!doctype html>',
        '<html>',
        '<body>',
        '<table>',
        '<tr>',
        `<td><a rel="nofollow" href="/l/?uddg=${encodeURIComponent(fixtureUrl)}" class="result-link">Roofing hero image fixture</a></td>`,
        '</tr>',
        '<tr>',
        '<td class="result-snippet">A roofing hero image source with an Unsplash reference.</td>',
        '</tr>',
        '</table>',
        '</body>',
        '</html>'
      ].join('\n'));
      return;
    }

    if (request.url?.startsWith('/fixture/roofing-image')) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end([
        '<!doctype html>',
        '<title>Roofing hero image fixture</title>',
        '<main>',
        '  <h1>Unsplash roofing business hero image</h1>',
        '  <a href="https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1400&q=80">Roofing crew repairing shingles</a>',
        '</main>'
      ].join('\n'));
      return;
    }

    requests.push(await readRequestBody(request));
    const responseEntry = responses[Math.min(responseIndex, responses.length - 1)] ?? {};
    const scripted = typeof responseEntry === 'function' ? responseEntry() : responseEntry;
    responseIndex += 1;
    const toolCalls = scripted.toolCalls ?? [];

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      choices: [
        {
          message: {
            role: 'assistant',
            content: scripted.content ?? '',
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
    searchBaseUrl: `http://127.0.0.1:${address.port}/search/`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    })
  };
}

function successResponses(fixture: ScriptedFixture): ScriptedResponseEntry[] {
  return [
    {
      content: 'The reference suggests a focused hero section with a strong service headline and image-led layout.'
    },
    () => ({
      toolCalls: [
        toolCall('read_file', {
          path: 'reference-notes.txt'
        }, 1),
        toolCall('web_search', {
          query: 'roofing business hero image unsplash',
          max_results: 1
        }, 2),
        toolCall('extract_web_page', {
          url: fixture.fixtureUrl(),
          query: 'roofing hero image'
        }, 3)
      ]
    }),
    {
      toolCalls: [
        toolCall('write_file', {
          path: 'index.html',
          content: [
            '<!doctype html>',
            '<html lang="en">',
            '<head>',
            '  <meta charset="utf-8" />',
            '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
            '  <title>Northline Roofing</title>',
            '  <link rel="stylesheet" href="styles.css" />',
            '</head>',
            '<body>',
            '  <main class="hero">',
            '    <img class="hero-image" src="https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1400&q=80" alt="Roofing crew repairing shingles" />',
            '    <section class="hero-copy">',
            '      <p class="eyebrow">Northline Roofing</p>',
            '      <h1>Fast roof repairs before the next storm.</h1>',
            '      <p>Inspections, replacements, and emergency service for homeowners who need the work done cleanly.</p>',
            '      <button id="quote-status" type="button">Check same-week openings</button>',
            '    </section>',
            '  </main>',
            '  <script src="main.js"></script>',
            '</body>',
            '</html>'
          ].join('\n')
        }, 4),
        toolCall('write_file', {
          path: 'styles.css',
          content: [
            ':root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }',
            'body { margin: 0; background: #151718; color: #f8fafc; }',
            '.hero { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 560px); }',
            '.hero-image { width: 100%; height: 100vh; object-fit: cover; }',
            '.hero-copy { display: grid; align-content: center; gap: 18px; padding: 56px; }',
            '.eyebrow { margin: 0; color: #f4b942; font-weight: 800; }',
            'h1 { margin: 0; font-size: 56px; line-height: 1.02; }',
            'p { font-size: 18px; line-height: 1.6; }',
            'button { width: fit-content; border: 0; padding: 14px 18px; background: #f4b942; color: #151718; font-weight: 800; }',
            '@media (max-width: 760px) { .hero { grid-template-columns: 1fr; } .hero-image { height: 42vh; } .hero-copy { padding: 30px; } h1 { font-size: 38px; } }'
          ].join('\n')
        }, 5),
        toolCall('write_file', {
          path: 'main.js',
          content: [
            "const status = document.getElementById('quote-status');",
            "if (status) status.textContent = 'Same-week roofing quote ready';"
          ].join('\n')
        }, 6)
      ]
    },
    {
      content: 'Built the roofing landing page and wrote index.html, styles.css, and main.js.'
    }
  ];
}

function folderOnlyFailureResponses(): ScriptedResponseEntry[] {
  return [
    {
      content: 'The reference suggests a simple hero section with an image, headline, and call to action.'
    },
    {
      toolCalls: [
        toolCall('mkdir', {
          path: 'roofing-landing'
        }, 1)
      ]
    },
    {},
    {},
    {}
  ];
}

async function createProjectAndThread(window: Page, workspaceDir: string, baseUrl: string) {
  const setup = await window.evaluate(async ({ workspaceDir, baseUrl }) => {
    const customProvider = await window.vicode.providers.saveCustom({
      name: 'Core Tooling Journey Test',
      transportKind: 'openai_compatible_chat',
      baseUrl,
      apiKey: 'core-tooling-secret',
      defaultModelId: 'core-tooling-model',
      enabled: true
    });
    const project = await window.vicode.projects.create({
      name: `Core tooling journey ${Date.now()}`,
      folderPath: workspaceDir,
      trusted: true
    });
    return {
      customProviderId: customProvider.id,
      projectId: project.id
    };
  }, { workspaceDir, baseUrl });
  const modelId = encodeCustomProviderModelId({
    customProviderId: setup.customProviderId,
    modelId: 'core-tooling-model'
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
  }, { projectId: setup.projectId, modelId });

  return {
    projectId: setup.projectId,
    modelId,
    threadId: thread.id
  };
}

async function submitJourneyTurn(
  window: Page,
  input: {
    projectId: string;
    threadId: string;
    modelId: string;
    prompt: string;
    includeImage?: boolean;
  }
) {
  return await window.evaluate(
    async ({ projectId, threadId, modelId, prompt, includeImage, imageDataUrl }) =>
      window.vicode.composer.submit({
        projectId,
        threadId,
        prompt,
        providerId: 'openai_compatible',
        modelId,
        executionPermission: 'full_access',
        skillIds: [],
        imageAttachments: includeImage
          ? [
              {
                id: 'reference-image',
                name: 'roofing-reference.png',
                mimeType: 'image/png',
                dataUrl: imageDataUrl
              }
            ]
          : []
      }),
    {
      ...input,
      imageDataUrl: TINY_REFERENCE_IMAGE_DATA_URL
    }
  );
}

async function waitForThreadStatus(window: Page, threadId: string, expectedStatus: 'completed' | 'failed') {
  await expect.poll(async () => {
    const detail = await window.evaluate(async (threadId) => window.vicode.threads.open(threadId), threadId);
    return detail.status;
  }, { timeout: 60_000 }).toBe(expectedStatus);
}

function parseProviderRequests(requests: string[]) {
  return requests.map((request) => JSON.parse(request) as { messages?: Array<{ role?: string; content?: unknown }> });
}

function requestIncludesPrompt(request: { messages?: Array<{ content?: unknown }> }, prompt: string) {
  return request.messages?.some((message) => {
    if (typeof message.content === 'string') {
      return message.content.includes(prompt);
    }
    return Array.isArray(message.content) && message.content.some((item) =>
      Boolean(item)
      && typeof item === 'object'
      && 'text' in item
      && typeof item.text === 'string'
      && item.text.includes(prompt)
    );
  }) ?? false;
}

function requestIncludesImageAttachment(request: { messages?: Array<{ content?: unknown }> }) {
  return request.messages?.some((message) =>
    Array.isArray(message.content) && message.content.some((item) =>
      Boolean(item)
      && typeof item === 'object'
      && 'type' in item
      && item.type === 'image_url'
      && 'image_url' in item
      && Boolean(item.image_url)
      && typeof item.image_url === 'object'
      && 'url' in item.image_url
      && typeof item.image_url.url === 'string'
      && item.image_url.url.startsWith('data:image/png;base64,')
    )
  ) ?? false;
}

function collectToolResultText(requests: Array<{ messages?: Array<{ role?: string; content?: unknown }> }>) {
  return requests.flatMap((request) =>
    request.messages
      ?.filter((message) => message.role === 'tool')
      .map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content))
      ?? []
  ).join('\n');
}

test('core tooling journey writes HTML CSS and JS from a multi-turn image-backed app request', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-core-tooling-success-'));
  await writeFile(
    path.join(workspaceDir, 'reference-notes.txt'),
    'Prioritize storm repair trust proof, same-week inspection availability, and a clear roofing quote CTA.',
    'utf8'
  );
  const provider = await startScriptedProvider(successResponses);
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.providers', 'vicode.composer'],
    env: {
      VICODE_WEB_SEARCH_BASE_URL: provider.searchBaseUrl
    }
  });
  let projectId: string | null = null;

  try {
    const setup = await createProjectAndThread(window, workspaceDir, provider.baseUrl);
    projectId = setup.projectId;

    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.providers', 'vicode.composer']);

    await expect(submitJourneyTurn(window, {
      projectId: setup.projectId,
      threadId: setup.threadId,
      modelId: setup.modelId,
      prompt: SETUP_PROMPT
    })).resolves.toMatchObject({ disposition: 'started' });
    await waitForThreadStatus(window, setup.threadId, 'completed');
    await expectNoVisibleRunFailures(window, testInfo, {
      label: 'core tooling setup turn',
      threadId: setup.threadId,
      workspaceDir
    });

    await expect(submitJourneyTurn(window, {
      projectId: setup.projectId,
      threadId: setup.threadId,
      modelId: setup.modelId,
      prompt: BUILD_PROMPT,
      includeImage: true
    })).resolves.toMatchObject({ disposition: 'started' });
    await waitForThreadStatus(window, setup.threadId, 'completed');
    await expectNoVisibleRunFailures(window, testInfo, {
      label: 'core tooling build success',
      threadId: setup.threadId,
      workspaceDir
    });

    await expect.poll(async () => await readdir(workspaceDir), { timeout: 15_000 }).toEqual(
      expect.arrayContaining(['index.html', 'styles.css', 'main.js'])
    );
    await expect.poll(async () => await readFile(path.join(workspaceDir, 'index.html'), 'utf8'), { timeout: 15_000 }).toContain('styles.css');
    await expect.poll(async () => await readFile(path.join(workspaceDir, 'index.html'), 'utf8'), { timeout: 15_000 }).toContain('main.js');
    await expect.poll(async () => await readFile(path.join(workspaceDir, 'index.html'), 'utf8'), { timeout: 15_000 }).toContain('unsplash.com');
    await expect.poll(async () => await readFile(path.join(workspaceDir, 'styles.css'), 'utf8'), { timeout: 15_000 }).toContain('@media');
    await expect.poll(async () => await readFile(path.join(workspaceDir, 'main.js'), 'utf8'), { timeout: 15_000 }).toContain('Same-week roofing quote ready');

    const parsedRequests = parseProviderRequests(provider.requests);
    expect(parsedRequests.some((request) => requestIncludesPrompt(request, SETUP_PROMPT))).toBe(true);
    expect(parsedRequests.some((request) => requestIncludesPrompt(request, BUILD_PROMPT))).toBe(true);
    expect(parsedRequests.some(requestIncludesImageAttachment)).toBe(true);
    const toolResultText = collectToolResultText(parsedRequests);
    expect(toolResultText).toContain('Prioritize storm repair trust proof');
    expect(toolResultText).toContain('Web search results for "roofing business hero image unsplash"');
    expect(toolResultText).toContain('Extracted page: Roofing hero image fixture');

    await expect(window.getByText(/Wrote file|Built the roofing landing page|index\.html/i).first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await provider.close().catch(() => undefined);
    if (projectId) {
      await window.evaluate(async (projectId) => {
        await window.vicode.projects.remove(projectId).catch(() => undefined);
      }, projectId).catch(() => undefined);
    }
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('core tooling journey fails visibly when the provider creates only a folder for a page request', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-core-tooling-failure-'));
  const provider = await startScriptedProvider(folderOnlyFailureResponses);
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.providers', 'vicode.composer'],
    env: {
      VICODE_WEB_SEARCH_BASE_URL: provider.searchBaseUrl
    }
  });
  let projectId: string | null = null;

  try {
    const setup = await createProjectAndThread(window, workspaceDir, provider.baseUrl);
    projectId = setup.projectId;

    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.providers', 'vicode.composer']);

    await expect(submitJourneyTurn(window, {
      projectId: setup.projectId,
      threadId: setup.threadId,
      modelId: setup.modelId,
      prompt: SETUP_PROMPT
    })).resolves.toMatchObject({ disposition: 'started' });
    await waitForThreadStatus(window, setup.threadId, 'completed');
    await expectNoVisibleRunFailures(window, testInfo, {
      label: 'core tooling failure setup turn',
      threadId: setup.threadId,
      workspaceDir
    });

    await expect(submitJourneyTurn(window, {
      projectId: setup.projectId,
      threadId: setup.threadId,
      modelId: setup.modelId,
      prompt: BUILD_PROMPT,
      includeImage: true
    })).resolves.toMatchObject({ disposition: 'started' });
    await waitForThreadStatus(window, setup.threadId, 'failed');

    const workspaceEntries = await readdir(workspaceDir);
    expect(workspaceEntries).toEqual(expect.arrayContaining(['roofing-landing']));
    expect(existsSync(path.join(workspaceDir, 'index.html'))).toBe(false);
    expect(existsSync(path.join(workspaceDir, 'styles.css'))).toBe(false);
    expect(existsSync(path.join(workspaceDir, 'main.js'))).toBe(false);

    const parsedRequests = parseProviderRequests(provider.requests);
    expect(parsedRequests.some((request) => requestIncludesPrompt(request, BUILD_PROMPT))).toBe(true);
    expect(parsedRequests.some(requestIncludesImageAttachment)).toBe(true);

    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.providers', 'vicode.composer']);
    await window.getByTestId(`thread-row-${setup.threadId}`).click();

    await expectVisibleRunFailure(
      window,
      {
        expectedClass: 'missing_file_write',
        message: /No page files were written/i
      },
      testInfo,
      {
        label: 'core tooling folder-only failure',
        threadId: setup.threadId,
        workspaceDir
      }
    );
    await expect(window.getByText(/No page files were written/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(window.getByText(/Created only roofing-landing before the provider stopped/i).first()).toBeVisible();
  } finally {
    await provider.close().catch(() => undefined);
    if (projectId) {
      await window.evaluate(async (projectId) => {
        await window.vicode.projects.remove(projectId).catch(() => undefined);
      }, projectId).catch(() => undefined);
    }
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
