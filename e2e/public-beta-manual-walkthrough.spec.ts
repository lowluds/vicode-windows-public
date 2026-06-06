import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { encodeCustomProviderModelId } from '../src/shared/custom-provider-routing';
import { closeApp, launchApp, waitForBridge } from './helpers/electron';
import { expectNoVisibleRunFailures } from './helpers/run-failure-diagnostics';

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

async function startScriptedWalkthroughProvider() {
  const requests: string[] = [];
  let responseIndex = 0;
  const fixedCounterScript = [
    "const button = document.getElementById('counter');",
    "const status = document.getElementById('status');",
    "button?.addEventListener('click', () => {",
    "  if (status) status.textContent = 'bug fixed';",
    '});'
  ].join('\n');
  const responses = [
    [
      toolCall('read_file', {
        path: 'README.md'
      }, 1)
    ],
    {
      content: 'README.md explains that this beta walkthrough project has one small counter bug to fix.'
    },
    [
      toolCall('read_file', {
        path: 'app.js'
      }, 2)
    ],
    [
      toolCall('write_file', {
        path: 'app.js',
        content: fixedCounterScript
      }, 3)
    ],
    {
      content: 'bug fixed.'
    }
  ];

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    requests.push(await readRequestBody(request));
    const scripted = responses[Math.min(responseIndex, responses.length - 1)] ?? {};
    responseIndex += 1;
    const toolCalls = Array.isArray(scripted) ? scripted : [];
    const content = !Array.isArray(scripted) && 'content' in scripted ? scripted.content : '';

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      choices: [
        {
          message: {
            role: 'assistant',
            content,
            tool_calls: toolCalls
          }
        }
      ]
    }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    })
  };
}

async function waitForThreadStatus(window: Page, threadId: string, expectedStatus: 'completed' | 'failed') {
  await expect.poll(async () => {
    const detail = await window.evaluate(async (id) => window.vicode.threads.open(id), threadId);
    return detail.status;
  }, { timeout: 60_000 }).toBe(expectedStatus);
}

async function waitForAssistantTurnCount(window: Page, threadId: string, expectedCount: number) {
  await expect.poll(async () => {
    const detail = await window.evaluate(async (id) => window.vicode.threads.open(id), threadId);
    return detail.turns.filter((turn) => turn.role === 'assistant').length;
  }, { timeout: 60_000 }).toBeGreaterThanOrEqual(expectedCount);
}

test('public beta walkthrough explains a file and fixes a tiny bug through the composer', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-public-beta-walkthrough-'));
  writeFileSync(
    path.join(workspaceDir, 'README.md'),
    'This beta walkthrough project has one small counter bug to fix.',
    'utf8'
  );
  writeFileSync(
    path.join(workspaceDir, 'app.js'),
    [
      "const button = document.getElementById('counter');",
      "const status = document.getElementById('status');",
      "button?.addEventListener('click', () => {",
      "  if (status) status.textContent = 'still broken';",
      '});'
    ].join('\n'),
    'utf8'
  );
  const provider = await startScriptedWalkthroughProvider();
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.providers', 'vicode.composer']
  });
  let projectId: string | null = null;

  try {
    const setup = await window.evaluate(async ({ workspaceDir, baseUrl }) => {
      const customProvider = await window.vicode.providers.saveCustom({
        name: 'Public Beta Walkthrough Test',
        transportKind: 'openai_compatible_chat',
        baseUrl,
        apiKey: 'public-beta-walkthrough-secret',
        defaultModelId: 'public-beta-walkthrough-model',
        enabled: true
      });
      const project = await window.vicode.projects.create({
        name: `Public beta walkthrough ${Date.now()}`,
        folderPath: workspaceDir,
        trusted: true
      });
      return {
        customProviderId: customProvider.id,
        projectId: project.id
      };
    }, { workspaceDir, baseUrl: provider.baseUrl });
    projectId = setup.projectId;
    const modelId = encodeCustomProviderModelId({
      customProviderId: setup.customProviderId,
      modelId: 'public-beta-walkthrough-model'
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

    await expect(window.evaluate(
      async ({ projectId, threadId, modelId }) =>
        window.vicode.composer.submit({
          projectId,
          threadId,
          prompt: 'Explain README.md in one short sentence before changing anything.',
          providerId: 'openai_compatible',
          modelId,
          executionPermission: 'full_access',
          skillIds: []
        }),
      { projectId, threadId: thread.id, modelId }
    )).resolves.toMatchObject({ disposition: 'started' });
    await waitForThreadStatus(window, thread.id, 'completed');
    await waitForAssistantTurnCount(window, thread.id, 1);
    await expectNoVisibleRunFailures(window, testInfo, {
      label: 'public beta file explanation',
      threadId: thread.id,
      workspaceDir
    });

    await expect(window.evaluate(
      async ({ projectId, threadId, modelId }) =>
        window.vicode.composer.submit({
          projectId,
          threadId,
          prompt: 'Fix the tiny bug in app.js so clicking the counter sets the status text to exactly "bug fixed".',
          providerId: 'openai_compatible',
          modelId,
          executionPermission: 'full_access',
          skillIds: []
        }),
      { projectId, threadId: thread.id, modelId }
    )).resolves.toMatchObject({ disposition: 'started' });
    await waitForThreadStatus(window, thread.id, 'completed');
    await waitForAssistantTurnCount(window, thread.id, 2);
    await expectNoVisibleRunFailures(window, testInfo, {
      label: 'public beta bug fix',
      threadId: thread.id,
      workspaceDir
    });

    const detail = await window.evaluate(async (threadId) => window.vicode.threads.open(threadId), thread.id);
    const assistantText = detail.turns
      .filter((turn) => turn.role === 'assistant')
      .map((turn) => turn.content)
      .join('\n');
    expect(assistantText).toContain('README.md explains');
    expect(assistantText).toContain('bug fixed');
    expect(JSON.stringify(detail.rawOutput)).toContain('read_file');
    expect(JSON.stringify(detail.rawOutput)).toContain('write_file');
    await expect.poll(async () => await readFile(path.join(workspaceDir, 'app.js'), 'utf8'), { timeout: 15_000 }).toContain("'bug fixed'");
    expect(provider.requests.some((request) => request.includes('Explain README.md'))).toBe(true);
    const providerBodies = provider.requests.map((request) => JSON.parse(request) as {
      messages?: Array<{
        role?: string;
        content?: string;
      }>;
    });
    expect(providerBodies.some((body) =>
      body.messages?.some((message) =>
        message.role === 'tool' &&
        typeof message.content === 'string' &&
        message.content.includes('This beta walkthrough project has one small counter bug to fix.')
      )
    )).toBe(true);
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
