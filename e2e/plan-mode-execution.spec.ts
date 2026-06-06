import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { closeApp, launchApp, waitForBridge } from './helpers/electron';

const OLLAMA_MODEL_ID = 'qwen2.5-coder:7b';
const PLAN_PROMPT = [
  'Create a small landing page from an approved plan.',
  '',
  'The plan must search the web for an Unsplash hero image, read reference-notes.txt, create index.html, styles.css, and main.js, then run npm test.',
  'Keep executing every plan item after each completed slice; do not stop after only one file.'
].join('\n');

interface ScriptedResponse {
  content?: string;
  toolCalls?: Array<ReturnType<typeof toolCall>>;
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

function toolCall(name: string, args: Record<string, unknown>) {
  return {
    function: {
      name,
      arguments: args
    }
  };
}

function plannerMarkdown() {
  return [
    '# Landing Page Plan Mode Execution',
    '',
    '## Summary',
    '- Build a small static landing page and complete every approved plan item.',
    '',
    '## Key Changes',
    '- Search the web for an Unsplash hero image source.',
    '- Read `reference-notes.txt` before writing files.',
    '- Create `index.html` for the landing page structure.',
    '- Create `styles.css` for responsive styling.',
    '- Create `main.js` for the button interaction.',
    '',
    '## Test Plan',
    '- Run `npm test` after all files are written.',
    '',
    '## Assumptions',
    '- If context compacts, resume from this approved plan and current workspace state.'
  ].join('\n');
}

function executionResponses(): ScriptedResponse[] {
  return [
    {
      content: plannerMarkdown()
    },
    {
      toolCalls: [
        toolCall('web_search', {
          query: 'Unsplash landing page hero image',
          max_results: 1
        }),
        toolCall('read_file', {
          path: 'reference-notes.txt'
        })
      ]
    },
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
            '  <title>Plan Mode Landing</title>',
            '  <link rel="stylesheet" href="styles.css" />',
            '</head>',
            '<body>',
            '  <main class="hero">',
            '    <img src="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=80" alt="Landscape hero" />',
            '    <section>',
            '      <p class="eyebrow">Plan Mode</p>',
            '      <h1>Approved plans execute every slice.</h1>',
            '      <p>Search, read, write, and verify steps complete in one approved run.</p>',
            '      <button id="status-button" type="button">Waiting for verification</button>',
            '    </section>',
            '  </main>',
            '  <script src="main.js"></script>',
            '</body>',
            '</html>'
          ].join('\n')
        })
      ]
    },
    {
      content: 'Index file is ready.'
    },
    {
      toolCalls: [
        toolCall('write_file', {
          path: 'styles.css',
          content: [
            ':root { font-family: Inter, system-ui, sans-serif; color-scheme: light; }',
            'body { margin: 0; background: #f8fafc; color: #111827; }',
            '.hero { min-height: 100vh; display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 540px); }',
            '.hero img { width: 100%; height: 100vh; object-fit: cover; }',
            '.hero section { display: grid; align-content: center; gap: 18px; padding: 56px; }',
            '.eyebrow { margin: 0; color: #0f766e; font-weight: 800; text-transform: uppercase; }',
            'h1 { margin: 0; font-size: 56px; line-height: 1.02; }',
            'p { font-size: 18px; line-height: 1.6; }',
            'button { width: fit-content; border: 0; padding: 14px 18px; background: #0f766e; color: white; font-weight: 800; }',
            '@media (max-width: 760px) { .hero { grid-template-columns: 1fr; } .hero img { height: 42vh; } .hero section { padding: 30px; } h1 { font-size: 38px; } }'
          ].join('\n')
        })
      ]
    },
    {
      content: 'Styles are ready.'
    },
    {
      toolCalls: [
        toolCall('write_file', {
          path: 'main.js',
          content: [
            "const button = document.getElementById('status-button');",
            "if (button) button.textContent = 'Plan mode verification complete';"
          ].join('\n')
        })
      ]
    },
    {
      toolCalls: [
        toolCall('run_command', {
          command: 'npm test'
        })
      ]
    },
    {
      content: 'Plan mode execution finished: web research, workspace read, index.html, styles.css, main.js, and npm test are complete.'
    }
  ];
}

async function startScriptedOllamaProvider() {
  const requests: string[] = [];
  let plannerReturned = false;
  let indexWritten = false;
  let stylesWritten = false;
  let scriptWritten = false;
  let verified = false;

  const resolveResponse = (body: string): ScriptedResponse => {
    if (!plannerReturned) {
      plannerReturned = true;
      return {
        content: plannerMarkdown()
      };
    }

    if (!body.includes('Tool result for web_search')) {
      return {
        toolCalls: [
          toolCall('web_search', {
            query: 'Unsplash landing page hero image',
            max_results: 1
          }),
          toolCall('read_file', {
            path: 'reference-notes.txt'
          })
        ]
      };
    }

    if (!indexWritten) {
      indexWritten = true;
      return executionResponses()[2]!;
    }

    if (!stylesWritten) {
      stylesWritten = true;
      return executionResponses()[4]!;
    }

    if (!scriptWritten) {
      scriptWritten = true;
      return executionResponses()[6]!;
    }

    if (!verified) {
      verified = true;
      return executionResponses()[7]!;
    }

    return executionResponses()[8]!;
  };

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url === '/api/tags') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        models: [
          {
            name: OLLAMA_MODEL_ID,
            model: OLLAMA_MODEL_ID,
            details: {
              families: ['qwen2']
            }
          }
        ]
      }));
      return;
    }

    if (request.url === '/api/show') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ parameters: 'num_ctx 8192' }));
      return;
    }

    if (request.url?.startsWith('/search/')) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end([
        '<!doctype html>',
        '<html>',
        '<body>',
        '<table>',
        '<tr><td><a href="https://unsplash.com/photos/landscape">Unsplash landscape hero image</a></td></tr>',
        '<tr><td class="result-snippet">A usable hero image source for the landing page.</td></tr>',
        '</table>',
        '</body>',
        '</html>'
      ].join('\n'));
      return;
    }

    if (request.url === '/api/chat') {
      const body = await readRequestBody(request);
      requests.push(body);
      const scripted = resolveResponse(body);
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      response.end(`${JSON.stringify({
        message: {
          role: 'assistant',
          content: scripted.content ?? '',
          ...(scripted.toolCalls?.length ? { tool_calls: scripted.toolCalls } : {})
        },
        done: true
      })}\n`);
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    searchBaseUrl: `${baseUrl}/search/`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    })
  };
}

async function createPlanModeProjectAndThread(window: Page, workspaceDir: string) {
  return await window.evaluate(async ({ workspaceDir, modelId }) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    const project = await window.vicode.projects.create({
      name: `Plan mode execution ${Date.now()}`,
      folderPath: workspaceDir,
      trusted: true,
      runtimeCommandPolicy: 'auto_approve',
      runtimeNetworkPolicy: 'enabled'
    });
    const thread = await window.vicode.threads.create({
      projectId: project.id,
      providerId: 'ollama',
      modelId,
      executionPermission: 'full_access'
    });
    await window.vicode.settings.save({
      selectedProjectId: project.id,
      lastOpenedThreadId: thread.id,
      defaultProviderId: 'ollama',
      defaultModelByProvider: {
        ...bootstrap.preferences.defaultModelByProvider,
        ollama: modelId
      },
      ollamaTransportMode: 'chat'
    });
    return {
      projectId: project.id,
      threadId: thread.id,
      modelId
    };
  }, { workspaceDir, modelId: OLLAMA_MODEL_ID });
}

async function waitForThreadStatus(window: Page, threadId: string, expectedStatus: 'completed' | 'failed') {
  await expect.poll(async () => {
    const detail = await window.evaluate(async (threadId) => window.vicode.threads.open(threadId), threadId);
    return detail.status;
  }, { timeout: 90_000 }).toBe(expectedStatus);
}

test('approved Plan Mode run executes all planned tool slices before completing', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-plan-mode-execution-'));
  const provider = await startScriptedOllamaProvider();
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.planner'],
    env: {
      VICODE_OLLAMA_BASE_URL: provider.baseUrl,
      VICODE_WEB_SEARCH_BASE_URL: provider.searchBaseUrl
    }
  });
  let projectId: string | null = null;

  try {
    await writeFile(
      path.join(workspaceDir, 'reference-notes.txt'),
      'Use concise copy, a visible hero image, and a button whose text changes after JavaScript loads.',
      'utf8'
    );
    await writeFile(
      path.join(workspaceDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'node verify-files.js' } }, null, 2),
      'utf8'
    );
    await writeFile(
      path.join(workspaceDir, 'verify-files.js'),
      [
        "const fs = require('fs');",
        "for (const file of ['index.html', 'styles.css', 'main.js']) {",
        "  if (!fs.existsSync(file)) process.exit(1);",
        '}'
      ].join('\n'),
      'utf8'
    );

    const setup = await createPlanModeProjectAndThread(window, workspaceDir);
    projectId = setup.projectId;

    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.planner']);
    await window.getByTestId(`thread-row-${setup.threadId}`).click();

    await window.evaluate(async ({ projectId, threadId, prompt, modelId }) =>
      window.vicode.planner.submit({
        projectId,
        threadId,
        prompt,
        providerId: 'ollama',
        modelId,
        executionPermission: 'full_access',
        skillIds: []
      }), {
        projectId: setup.projectId,
        threadId: setup.threadId,
        prompt: PLAN_PROMPT,
        modelId: setup.modelId
      });

    await expect(window.getByTestId('planner-plan-card')).toBeVisible({ timeout: 30_000 });
    await expect(window.getByText('Landing Page Plan Mode Execution')).toBeVisible();
    await window.getByTestId('planner-approve-button').click();

    const approvedPlanRow = window.getByTestId('planner-plan-status-row');
    await expect(approvedPlanRow).toBeVisible({ timeout: 30_000 });
    await expect(approvedPlanRow.getByTestId('planner-plan-preview-list')).toContainText('Search the web for an Unsplash hero image source.', { timeout: 30_000 });
    await expect(approvedPlanRow.locator('[data-task-status="in_progress"], [data-task-status="completed"]').first()).toBeVisible({ timeout: 30_000 });

    const transcriptTimeline = window.locator('.run-transcript-timeline').first();
    await expect(transcriptTimeline).toBeVisible({ timeout: 30_000 });
    await expect(transcriptTimeline).toContainText(/web search|reference-notes|index\.html|run command/i, { timeout: 30_000 });

    await waitForThreadStatus(window, setup.threadId, 'completed');

    await expect.poll(async () => await readdir(workspaceDir), { timeout: 15_000 }).toEqual(
      expect.arrayContaining(['index.html', 'styles.css', 'main.js', 'reference-notes.txt'])
    );
    await expect.poll(async () => await readFile(path.join(workspaceDir, 'index.html'), 'utf8'), { timeout: 15_000 }).toContain('styles.css');
    await expect.poll(async () => await readFile(path.join(workspaceDir, 'index.html'), 'utf8'), { timeout: 15_000 }).toContain('main.js');
    await expect.poll(async () => await readFile(path.join(workspaceDir, 'styles.css'), 'utf8'), { timeout: 15_000 }).toContain('@media');
    await expect.poll(async () => await readFile(path.join(workspaceDir, 'main.js'), 'utf8'), { timeout: 15_000 }).toContain('Plan mode verification complete');

    const parsedRequests = provider.requests.map((request) => JSON.parse(request) as { messages?: Array<{ content?: string }> });
    expect(parsedRequests.some((request) => JSON.stringify(request).includes('Search the web for an Unsplash hero image source.'))).toBe(true);
    expect(parsedRequests.some((request) => JSON.stringify(request).includes('Expected tool groups: workspace_read, workspace_write, web_research, command, verification'))).toBe(true);
    expect(parsedRequests.some((request) => JSON.stringify(request).includes('Tool result for web_search'))).toBe(true);
    expect(parsedRequests.some((request) => JSON.stringify(request).includes('Tool result for read_file'))).toBe(true);
    expect(parsedRequests.some((request) => JSON.stringify(request).includes('Tool result for run_command'))).toBe(true);

    await expect(window.getByText(/Plan mode execution finished/i).first()).toBeVisible({ timeout: 15_000 });
    await testInfo.attach('plan-mode-execution.png', {
      body: await window.screenshot({ fullPage: true }),
      contentType: 'image/png'
    });
  } finally {
    if (projectId) {
      await window.evaluate(async (projectId) => {
        await window.vicode.projects.remove(projectId).catch(() => undefined);
      }, projectId).catch(() => undefined);
    }
    await closeApp(app);
    await provider.close().catch(() => undefined);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
