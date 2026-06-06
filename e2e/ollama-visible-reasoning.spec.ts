import type { AddressInfo } from 'node:net';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { closeApp, launchApp, waitForBridge } from './helpers/electron';

const OLLAMA_MODEL_ID = 'qwen3-visible-reasoning:latest';
const bridgePaths = [
  'vicode.app',
  'vicode.projects',
  'vicode.threads',
  'vicode.settings',
  'vicode.composer'
];

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

interface ScriptedOllamaTurn {
  thinking: string[];
  content?: string;
  toolCalls?: Array<ReturnType<typeof toolCall>>;
}

function createDeferredTurn() {
  let release: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    wait: () => promise,
    release: () => release?.()
  };
}

async function writeOllamaChatResponse(response: ServerResponse, turn: ScriptedOllamaTurn) {
  response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  for (const thinking of turn.thinking) {
    response.write(`${JSON.stringify({
      message: {
        role: 'assistant',
        thinking
      }
    })}\n`);
  }
  response.end(`${JSON.stringify({
    message: {
      role: 'assistant',
      ...(turn.content ? { content: turn.content } : {}),
      ...(turn.toolCalls?.length ? { tool_calls: turn.toolCalls } : {})
    },
    done: true
  })}\n`);
}

async function startScriptedOllamaProvider() {
  const requests: string[] = [];
  const releaseFinalTurn = createDeferredTurn();
  const scriptedTurns: ScriptedOllamaTurn[] = [
    {
      thinking: [
        'Checking README.md and web evidence before making changes.',
        ' Keeping this as a visible progress summary.'
      ],
      toolCalls: [
        toolCall('read_file', { path: 'README.md' }),
        toolCall('web_search', { query: 'visible reasoning transcript UI', max_results: 1 })
      ]
    },
    {
      thinking: [
        'Writing a small proof file from the inspection and search results.',
        ' This should appear as the next reasoning row before the write evidence.'
      ],
      toolCalls: [
        toolCall('write_file', {
          path: 'VISIBLE_REASONING.md',
          content: [
            '# Visible Reasoning QA',
            '',
            '- Read README.md.',
            '- Used web evidence.',
            '- Wrote this proof file before verification.'
          ].join('\n')
        })
      ]
    },
    {
      thinking: [
        'Running a focused command after the file change so the transcript shows verification.',
        ' The visible reasoning row should stay above the command evidence.'
      ],
      toolCalls: [
        toolCall('run_command', {
          command: 'echo visible-reasoning-ok',
          cwd: '.'
        })
      ]
    },
    {
      thinking: [
        'Summarizing the completed read, search, write, and verification steps for the final answer.'
      ],
      content: 'Visible reasoning QA completed: I read README.md, searched for UI evidence, wrote VISIBLE_REASONING.md, and verified with echo visible-reasoning-ok.'
    }
  ];

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url === '/api/tags') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        models: [
          {
            name: OLLAMA_MODEL_ID,
            model: OLLAMA_MODEL_ID,
            details: {
              families: ['qwen3']
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
        '<html><body><table>',
        '<tr><td><a href="https://example.com/visible-reasoning">Visible reasoning UI notes</a></td></tr>',
        '<tr><td class="result-snippet">Readable agent transcripts should show concise progress before tool evidence.</td></tr>',
        '</table></body></html>'
      ].join('\n'));
      return;
    }

    if (request.url === '/api/chat') {
      const body = await readRequestBody(request);
      requests.push(body);
      const turnIndex = requests.length - 1;
      if (turnIndex === 3) {
        await releaseFinalTurn.wait();
      }
      await writeOllamaChatResponse(response, scriptedTurns[Math.min(turnIndex, scriptedTurns.length - 1)]!);
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
    releaseFinalTurn: releaseFinalTurn.release,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    })
  };
}

async function createOllamaThread(window: Page, workspaceDir: string) {
  return await window.evaluate(async ({ workspaceDir, modelId }) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    const project = await window.vicode.projects.create({
      name: `Ollama visible reasoning ${Date.now()}`,
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
      onboardingComplete: true,
      selectedProjectId: project.id,
      lastOpenedThreadId: thread.id,
      defaultProviderId: 'ollama',
      defaultModelByProvider: {
        ...bootstrap.preferences.defaultModelByProvider,
        ollama: modelId
      },
      defaultThinkingByProvider: {
        ...bootstrap.preferences.defaultThinkingByProvider,
        ollama: true
      },
      defaultExecutionPermission: 'full_access',
      ollamaTransportMode: 'chat'
    });
    return {
      projectId: project.id,
      threadId: thread.id
    };
  }, { workspaceDir, modelId: OLLAMA_MODEL_ID });
}

async function collectReasoningLayoutMetrics(window: Page) {
  return await window.evaluate(() => {
    const timeline = document.querySelector('.run-transcript-timeline');
    const transcript = document.querySelector('.thread-transcript-rail, .thread-view');
    const reasoningRows = Array.from(document.querySelectorAll(
      '.run-transcript-running-reasoning, .run-transcript-activity-line-thinking, .run-transcript-activity-thought'
    ));
    const activityRows = Array.from(document.querySelectorAll(
      '.run-transcript-activity-line-tool_call, .run-transcript-activity-line-tool_result, .run-transcript-activity-line-web_search, .run-transcript-terminal-tool, .run-transcript-command-group, .run-transcript-command-entry, .run-transcript-activity-group'
    ));
    const rowSummaries = [...reasoningRows, ...activityRows]
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: element.className,
          text: element.textContent?.replace(/\s+/g, ' ').trim().slice(0, 160) ?? '',
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height
        };
      })
      .sort((left, right) => left.top - right.top);

    return {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      transcriptScrollWidth: transcript instanceof HTMLElement ? transcript.scrollWidth : null,
      transcriptClientWidth: transcript instanceof HTMLElement ? transcript.clientWidth : null,
      timelineText: timeline?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 1400) ?? '',
      reasoningCount: reasoningRows.length,
      activityCount: activityRows.length,
      rowSummaries
    };
  });
}

test('Ollama visible thinking renders above tool evidence in the thread transcript', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-ollama-visible-reasoning-'));
  writeFileSync(
    path.join(workspaceDir, 'README.md'),
    'This workspace validates Ollama visible reasoning rows before read, search, write, and command evidence.',
    'utf8'
  );
  const provider = await startScriptedOllamaProvider();
  const { app, window } = await launchApp({
    bridgePaths,
    env: {
      VICODE_OLLAMA_BASE_URL: provider.baseUrl,
      VICODE_WEB_SEARCH_BASE_URL: provider.searchBaseUrl
    }
  });

  try {
    const setup = await createOllamaThread(window, workspaceDir);

    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, bridgePaths);
    await window.getByTestId(`thread-row-${setup.threadId}`).click();
    await expect(window.getByTestId('composer-input')).toBeVisible();

    await window.evaluate(async ({ projectId, threadId, modelId }) =>
      window.vicode.composer.submit({
        projectId,
        threadId,
        prompt: 'Read README.md, search for visible reasoning UI notes, write VISIBLE_REASONING.md, and run echo visible-reasoning-ok.',
        providerId: 'ollama',
        modelId,
        thinkingEnabled: true,
        executionPermission: 'full_access',
        skillIds: []
      }), {
        projectId: setup.projectId,
        threadId: setup.threadId,
        modelId: OLLAMA_MODEL_ID
      });

    const timeline = window.locator('.run-transcript-timeline').first();
    await expect(timeline).toBeVisible({ timeout: 30_000 });
    await expect(timeline.getByText('Checking README.md and web evidence before making changes.').first()).toBeVisible({ timeout: 30_000 });
    await expect(timeline.getByText('Writing a small proof file from the inspection and search results.').first()).toBeVisible({ timeout: 30_000 });
    await expect(timeline.getByText('Running a focused command after the file change so the transcript shows verification.').first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => provider.requests.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(4);

    const activeMetrics = await collectReasoningLayoutMetrics(window);
    expect(activeMetrics.reasoningCount).toBeGreaterThanOrEqual(3);
    expect(activeMetrics.timelineText).toContain('Reasoning');
    expect(activeMetrics.timelineText).toContain('README.md');
    expect(activeMetrics.timelineText).toMatch(/web search|visible reasoning/i);
    expect(activeMetrics.timelineText).toMatch(/VISIBLE_REASONING\.md|file/i);
    expect(activeMetrics.timelineText).toMatch(/echo visible-reasoning-ok|command/i);
    expect(activeMetrics.transcriptScrollWidth ?? 0).toBeLessThanOrEqual((activeMetrics.transcriptClientWidth ?? 0) + 4);

    const firstReasoningRow = activeMetrics.rowSummaries.find((row) =>
      row.className.includes('run-transcript-running-reasoning')
      || row.className.includes('run-transcript-activity-line-thinking')
      || row.className.includes('run-transcript-activity-thought')
    );
    const firstToolRow = activeMetrics.rowSummaries.find((row) =>
      !row.className.includes('run-transcript-activity-line-thinking')
      && (
        row.className.includes('run-transcript-activity-line-tool_call')
        || row.className.includes('run-transcript-activity-line-web_search')
        || row.className.includes('run-transcript-activity-group')
      )
    );
    expect(firstReasoningRow, JSON.stringify(activeMetrics, null, 2)).toBeTruthy();
    expect(firstToolRow, JSON.stringify(activeMetrics, null, 2)).toBeTruthy();
    expect(firstReasoningRow!.top).toBeLessThan(firstToolRow!.top);

    const activeScreenshotPath = testInfo.outputPath('ollama-visible-reasoning-active.png');
    await window.screenshot({ path: activeScreenshotPath, fullPage: false });
    console.log(JSON.stringify({ activeScreenshotPath, activeMetrics }, null, 2));

    const commandGroup = timeline.locator('.run-transcript-command-group, .run-transcript-command-entry').first();
    if (await commandGroup.isVisible().catch(() => false)) {
      await commandGroup.getByRole('button').first().click().catch(() => undefined);
    }
    await window.screenshot({
      path: testInfo.outputPath('ollama-visible-reasoning-tool-details.png'),
      fullPage: false
    });

    provider.releaseFinalTurn();
    await expect.poll(async () => {
      const detail = await window.evaluate(async (threadId) => window.vicode.threads.open(threadId), setup.threadId);
      return detail.status;
    }, { timeout: 30_000 }).toBe('completed');

    await expect.poll(async () => await readFile(path.join(workspaceDir, 'VISIBLE_REASONING.md'), 'utf8'), { timeout: 15_000 })
      .toContain('Visible Reasoning QA');
    await expect(window.getByText(/Visible reasoning QA completed/i).first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => {
      const toolLoopRequests = provider.requests
        .slice(0, 4)
        .map((request) => JSON.parse(request) as { think?: unknown });
      return toolLoopRequests.length === 4 && toolLoopRequests.every((request) => request.think === true);
    })
      .toBe(true);

    const workedSummary = timeline.getByRole('button', { name: /Worked for/i }).first();
    await expect(workedSummary).toBeVisible();
    await workedSummary.click();
    await expect(timeline.getByText('Summarizing the completed read, search, write, and verification steps for the final answer.').first()).toBeVisible();
    const completedMetrics = await collectReasoningLayoutMetrics(window);
    expect(completedMetrics.reasoningCount).toBeGreaterThanOrEqual(4);
    expect(completedMetrics.transcriptScrollWidth ?? 0).toBeLessThanOrEqual((completedMetrics.transcriptClientWidth ?? 0) + 4);

    const completedScreenshotPath = testInfo.outputPath('ollama-visible-reasoning-completed-expanded.png');
    await window.screenshot({ path: completedScreenshotPath, fullPage: false });
    console.log(JSON.stringify({ completedScreenshotPath, completedMetrics }, null, 2));
  } finally {
    await closeApp(app);
    await provider.close().catch(() => undefined);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
