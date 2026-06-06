import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { encodeCustomProviderModelId } from '../src/shared/custom-provider-routing';
import { closeApp, launchApp, waitForBridge } from './helpers/electron';

const bridgePaths = [
  'vicode.app',
  'vicode.projects',
  'vicode.threads',
  'vicode.settings',
  'vicode.providers',
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

type ScriptedToolCall = ReturnType<typeof toolCall>;

interface ScriptedProviderResponse {
  content?: string;
  delayMs?: number;
  toolCalls?: ScriptedToolCall[];
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readSearchWriteResponses(): ScriptedProviderResponse[] {
  return [
    {
      toolCalls: [
        toolCall('read_file', { path: 'README.md' }, 1),
        toolCall('web_search', { query: 'small app thread evidence ui', max_results: 1 }, 2)
      ]
    },
    {
      toolCalls: [
        toolCall('write_file', {
          path: 'SUMMARY.md',
          content: [
            '# Thread Core Visual Audit',
            '',
            'The agent read the project README, used web search evidence, and wrote this summary.'
          ].join('\n')
        }, 3)
      ]
    },
    {
      content: 'I read README.md, searched the web for UI evidence patterns, and wrote SUMMARY.md with the result.'
    }
  ];
}

async function startProvider(responses: ScriptedProviderResponse[] = readSearchWriteResponses()) {
  let responseIndex = 0;
  let fixtureUrl = '';

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url?.startsWith('/search/')) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end([
        '<!doctype html>',
        '<html><body><table>',
        `<tr><td><a rel="nofollow" href="/l/?uddg=${encodeURIComponent(fixtureUrl)}" class="result-link">Thread evidence UI fixture</a></td></tr>`,
        '<tr><td class="result-snippet">A fixture describing readable agent thread evidence.</td></tr>',
        '</table></body></html>'
      ].join('\n'));
      return;
    }

    if (request.url?.startsWith('/fixture/evidence')) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end([
        '<!doctype html>',
        '<title>Thread evidence UI fixture</title>',
        '<main>',
        '  <h1>Readable agent thread evidence</h1>',
        '  <p>Agent UIs should show a clear narrative of read, search, write, and verification steps.</p>',
        '</main>'
      ].join('\n'));
      return;
    }

    await readRequestBody(request);
    const scripted = responses[Math.min(responseIndex, responses.length - 1)] ?? {};
    responseIndex += 1;
    if (scripted.delayMs) {
      await delay(scripted.delayMs);
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      choices: [
        {
          message: {
            role: 'assistant',
            content: scripted.content ?? '',
            tool_calls: scripted.toolCalls ?? []
          }
        }
      ]
    }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  fixtureUrl = `http://127.0.0.1:${address.port}/fixture/evidence`;

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    searchBaseUrl: `http://127.0.0.1:${address.port}/search/`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    })
  };
}

async function createThreadWithCustomProvider(
  window: Page,
  options: {
    workspaceDir: string;
    baseUrl: string;
    providerName: string;
    modelId: string;
    runtimeCommandPolicy?: 'approval_required' | 'auto_approve' | 'disabled';
    runtimeNetworkPolicy?: 'disabled' | 'enabled';
  }
) {
  const setup = await window.evaluate(async ({ workspaceDir, baseUrl, providerName, modelId, runtimeCommandPolicy, runtimeNetworkPolicy }) => {
    const customProvider = await window.vicode.providers.saveCustom({
      name: providerName,
      transportKind: 'openai_compatible_chat',
      baseUrl,
      apiKey: 'visual-audit-secret',
      defaultModelId: modelId,
      enabled: true
    });
    const project = await window.vicode.projects.create({
      name: `${providerName} ${Date.now()}`,
      folderPath: workspaceDir,
      trusted: true,
      runtimeCommandPolicy,
      runtimeNetworkPolicy
    });
    return {
      customProviderId: customProvider.id,
      projectId: project.id
    };
  }, options);

  const encodedModelId = encodeCustomProviderModelId({
    customProviderId: setup.customProviderId,
    modelId: options.modelId
  });

  const threadId = await window.evaluate(async ({ projectId, modelId }) => {
    const thread = await window.vicode.threads.create({
      projectId,
      providerId: 'openai_compatible',
      modelId,
      executionPermission: 'full_access'
    });
    await window.vicode.settings.save({
      onboardingComplete: true,
      selectedProjectId: projectId,
      lastOpenedThreadId: thread.id,
      defaultExecutionPermission: 'full_access'
    });
    return thread.id;
  }, { projectId: setup.projectId, modelId: encodedModelId });

  await window.reload({ waitUntil: 'domcontentloaded' });
  await waitForBridge(window, bridgePaths);
  await expect(window.getByTestId('composer-input')).toBeVisible();
  return threadId;
}

async function expectIdleComposer(window: Page) {
  await expect(window.getByTestId('composer-input')).toBeVisible();
  await expect(window.getByTestId('composer-input')).toHaveAttribute('placeholder', /follow-up/i);
  await expect(window.getByTestId('composer-submit-button')).toBeVisible();
  await expect(window.getByTestId('composer-submit-button')).toHaveAttribute('aria-label', 'Send');
}

function expectNoVisibleShadow(value: string | undefined) {
  if (value === 'none') {
    return;
  }
  expect(value).toBeTruthy();
  expect(value).toMatch(/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/u);
  expect(value?.replace(/rgba\([^)]+\)/gu, '').replace(/,/gu, '').trim()).toMatch(/^(0px\s*)+$/u);
}

async function expectSubduedThreadEvidence(window: Page) {
  const sourceTrigger = window.getByRole('button', { name: 'Used 1 source' });
  await sourceTrigger.click();
  await expect(window.locator('.ai-sources-content')).toBeVisible();

  const metrics = await window.evaluate(() => {
    function readStyle(selector: string) {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        return null;
      }
      const style = window.getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderRadius: Number.parseFloat(style.borderTopLeftRadius || '0'),
        boxShadow: style.boxShadow,
        color: style.color
      };
    }

    return {
      activityTrigger: readStyle('.run-transcript-activity-group-trigger'),
      changeCard: readStyle('.run-change-card'),
      sourceContent: readStyle('.ai-sources-content'),
      sourceTrigger: readStyle('.ai-sources-trigger'),
      sourceRows: document.querySelectorAll('.ai-source-row').length,
      transcriptStatusPills: document.querySelectorAll('.run-transcript-timeline .ui-status-pill').length,
      toolHeaderBadges: document.querySelectorAll('.run-transcript-timeline .tool-header-trigger .ui-status-pill, .run-transcript-timeline .tool-header-trigger .size-6').length
    };
  });

  expect(metrics.sourceRows).toBeGreaterThanOrEqual(1);
  expect(metrics.transcriptStatusPills).toBe(0);
  expect(metrics.toolHeaderBadges).toBe(0);
  expectNoVisibleShadow(metrics.activityTrigger?.boxShadow);
  expectNoVisibleShadow(metrics.changeCard?.boxShadow);
  expect(metrics.changeCard?.borderRadius ?? 99).toBeLessThanOrEqual(12);
  expectNoVisibleShadow(metrics.sourceTrigger?.boxShadow);
  expectNoVisibleShadow(metrics.sourceContent?.boxShadow);
  expect(metrics.sourceContent?.borderRadius ?? 99).toBeLessThanOrEqual(10);
}

async function expectLastUserTaskContract(
  window: Page,
  threadId: string,
  expected: Record<string, unknown>
) {
  await expect.poll(async () => {
    const detail = await window.evaluate(async (id) => window.vicode.threads.open(id), threadId);
    const lastUserTurn = [...detail.turns].reverse().find((turn) => turn.role === 'user');
    return lastUserTurn?.metadata?.harnessTaskContract ?? null;
  }, { timeout: 15_000 }).toMatchObject(expected);
}

async function expectLastUserResolvedTaskPacket(
  window: Page,
  threadId: string,
  expected: Record<string, unknown>
) {
  await expect.poll(async () => {
    const detail = await window.evaluate(async (id) => window.vicode.threads.open(id), threadId);
    const lastUserTurn = [...detail.turns].reverse().find((turn) => turn.role === 'user');
    return lastUserTurn?.metadata?.resolvedTaskPacket ?? null;
  }, { timeout: 15_000 }).toMatchObject(expected);
}

async function expectComposerAndTranscriptLayoutFit(window: Page) {
  const result = await window.evaluate(() => {
    const issues: string[] = [];
    const controlSelectors = [
      ['actions', '[data-testid="composer-action-menu-trigger"]'],
      ['model', '[data-testid="composer-model-select"]'],
      ['workspace', '[data-testid="composer-workspace-select"]'],
      ['voice', '[data-testid="composer-voice-button"]'],
      ['submit', '[data-testid="composer-submit-button"]']
    ] as const;
    const rects = controlSelectors.flatMap(([name, selector]) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        issues.push(`${name} missing`);
        return [];
      }
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') {
        issues.push(`${name} hidden`);
      }
      if (rect.width < 28 || rect.height < 28) {
        issues.push(`${name} too small ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
      if (rect.left < -1 || rect.top < -1 || rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1) {
        issues.push(`${name} outside viewport`);
      }
      return [{ name, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }];
    });

    for (let outer = 0; outer < rects.length; outer += 1) {
      for (let inner = outer + 1; inner < rects.length; inner += 1) {
        const first = rects[outer]!;
        const second = rects[inner]!;
        const overlapX = Math.min(first.right, second.right) - Math.max(first.left, second.left);
        const overlapY = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
        if (overlapX > 2 && overlapY > 2) {
          issues.push(`${first.name} overlaps ${second.name}`);
        }
      }
    }

    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) {
      issues.push(`horizontal page overflow ${root.scrollWidth} > ${root.clientWidth}`);
    }

    const transcript = document.querySelector('.transcript');
    const composerStack = document.querySelector('.thread-composer-stack');
    if (transcript instanceof HTMLElement && composerStack instanceof HTMLElement) {
      const transcriptRect = transcript.getBoundingClientRect();
      const composerRect = composerStack.getBoundingClientRect();
      if (transcriptRect.bottom > composerRect.top + 1) {
        issues.push(`transcript overlaps composer ${Math.round(transcriptRect.bottom)} > ${Math.round(composerRect.top)}`);
      }
    }

    for (const selector of ['.run-transcript-timeline', '.thread-transcript-rail', '.thread-composer-stack', '.composer-shell']) {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        issues.push(`${selector} missing`);
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (rect.left < -2 || rect.right > window.innerWidth + 2) {
        issues.push(`${selector} horizontal bounds ${Math.round(rect.left)}..${Math.round(rect.right)} in ${window.innerWidth}`);
      }
    }

    if (document.querySelector('[data-testid="composer-context-window-trigger"]')) {
      issues.push('composer shows context usage counter');
    }

    return { issues };
  });

  expect(result.issues).toEqual([]);
}

async function expectAssistantTurnCount(window: Page, threadId: string, count: number) {
  await expect.poll(async () => {
    const detail = await window.evaluate(async (id) => window.vicode.threads.open(id), threadId);
    return detail.turns.filter((turn) => turn.role === 'assistant').length;
  }, { timeout: 60_000 }).toBeGreaterThanOrEqual(count);
}

async function removeWorkspaceDir(workspaceDir: string) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(workspaceDir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }

  if (lastError) {
    throw lastError;
  }
}

test('captures live reasoning followed by subdued tool evidence while a run is active', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-thread-live-transcript-'));
  writeFileSync(
    path.join(workspaceDir, 'README.md'),
    'This workspace validates live transcript reasoning, local command evidence, and finished worked-summary collapse.',
    'utf8'
  );
  const provider = await startProvider([
    {
      content: 'I will inspect README.md, run one safe command, and then summarize the result.',
      toolCalls: [
        toolCall('read_file', { path: 'README.md' }, 1),
        toolCall('run_command', { command: 'echo vicode-live-transcript', cwd: '.' }, 2)
      ]
    },
    {
      content: 'The live transcript QA completed.',
      delayMs: 60_000
    }
  ]);
  const { app, window } = await launchApp({
    bridgePaths,
    env: {
      VICODE_WEB_SEARCH_BASE_URL: provider.searchBaseUrl
    }
  });

  try {
    const threadId = await createThreadWithCustomProvider(window, {
      workspaceDir,
      baseUrl: provider.baseUrl,
      providerName: 'Thread Live Transcript Audit',
      modelId: 'thread-live-transcript-model',
      runtimeCommandPolicy: 'auto_approve',
      runtimeNetworkPolicy: 'disabled'
    });

    await window.getByTestId('composer-input').fill(
      'Inspect README.md, run one safe local command, and show readable progress while the run is active.'
    );
    await window.getByTestId('composer-submit-button').click();
    await expect(window.getByTestId('run-activity-live')).toBeVisible({ timeout: 15_000 });
    await expect(window.getByTestId('composer-submit-button')).toHaveAttribute('aria-label', 'Stop');

    const timeline = window.locator('.run-transcript-timeline');
    await expect(timeline.getByText(/I will inspect README\.md/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(timeline.locator('.run-transcript-activity-group').first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => {
      const detail = await window.evaluate(async (id) => window.vicode.threads.open(id), threadId);
      return detail.rawOutput.some((event) => event.payload.activity?.kind === 'terminal_command');
    }, { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => {
      return window.evaluate(() => {
        const timelineElement = document.querySelector('.run-transcript-timeline');
        const activityGroupText = document.querySelector('.run-transcript-activity-group')?.textContent ?? '';
        return Boolean(timelineElement?.querySelector('.run-transcript-terminal-tool')) || /command/i.test(activityGroupText);
      });
    }, { timeout: 15_000 }).toBe(true);
    await expect(window.locator('.run-transcript-activity-group.is-worked-for-summary')).toHaveCount(0);
    await expect(window.getByTestId('app-inline-notice')).toHaveCount(0);
    await expectComposerAndTranscriptLayoutFit(window);

    const liveMetrics = await window.evaluate(() => {
      const toolLine = document.querySelector('.run-transcript-activity-group');
      const commandTool = document.querySelector('.run-transcript-terminal-tool');
      const toolStyle = toolLine instanceof HTMLElement ? getComputedStyle(toolLine) : null;
      const commandStyle = commandTool instanceof HTMLElement ? getComputedStyle(commandTool) : null;
      const transcriptText = document.querySelector('.run-transcript-timeline')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      const liveStatusText = document.querySelector('[data-testid="run-activity-live"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      return {
        reasoningRows: document.querySelectorAll('.run-transcript-running-reasoning').length,
        reasoningLatestRows: document.querySelectorAll('.run-transcript-running-reasoning .run-transcript-reasoning-latest').length,
        reasoningStatusRows: document.querySelectorAll('.run-transcript-running-reasoning .run-transcript-reasoning-status').length,
        reasoningCopyOccurrences: (transcriptText.match(/I will inspect README\.md, run one safe command, and then summarize the result\./g) ?? []).length,
        liveStatusText,
        toolRows: document.querySelectorAll('.run-transcript-activity-line-tool_call, .run-transcript-activity-group').length,
        activityGroups: document.querySelectorAll('.run-transcript-activity-group').length,
        terminalTools: document.querySelectorAll('.run-transcript-terminal-tool').length,
        workedSummaryRows: document.querySelectorAll('.run-transcript-activity-group.is-worked-for-summary').length,
        toolLineBackground: toolStyle?.backgroundColor ?? null,
        toolLineShadow: toolStyle?.boxShadow ?? null,
        toolLineBorderTopWidth: toolStyle?.borderTopWidth ?? null,
        activityGroupText: toolLine instanceof HTMLElement ? toolLine.textContent?.replace(/\s+/g, ' ').trim() ?? '' : '',
        commandShadow: commandStyle?.boxShadow ?? null,
        transcriptText: transcriptText.slice(0, 900)
      };
    });
    const liveThreadSnapshot = await window.evaluate(async (id) => {
      const detail = await window.vicode.threads.open(id);
      const lastUserTurn = [...detail.turns].reverse().find((turn) => turn.role === 'user');
      return {
        status: detail.status,
        harnessTaskContract: lastUserTurn?.metadata?.harnessTaskContract ?? null,
        recentEvents: detail.rawOutput.slice(-20).map((event) => ({
          eventType: event.eventType,
          payload: event.payload
        }))
      };
    }, threadId);
    expect(liveMetrics.reasoningRows).toBe(1);
    expect(liveMetrics.reasoningLatestRows).toBe(0);
    expect(liveMetrics.reasoningStatusRows).toBe(0);
    expect(liveMetrics.reasoningCopyOccurrences).toBe(1);
    expect(liveMetrics.liveStatusText).not.toContain('I will inspect README.md, run one safe command, and then summarize the result.');
    expect(liveMetrics.toolRows).toBeGreaterThanOrEqual(1);
    expect(liveMetrics.activityGroups).toBeGreaterThanOrEqual(1);
    expect(liveMetrics.workedSummaryRows).toBe(0);
    expect(liveMetrics.toolLineBackground).toBe('rgba(0, 0, 0, 0)');
    expect(liveMetrics.toolLineBorderTopWidth).toMatch(/^(0px|1px)$/u);
    expect(
      liveMetrics.terminalTools > 0 || /command/i.test(liveMetrics.activityGroupText),
      JSON.stringify({ liveMetrics, liveThreadSnapshot }, null, 2)
    ).toBe(true);
    expect(liveMetrics.activityGroupText).not.toMatch(/\btool\b/i);
    expectNoVisibleShadow(liveMetrics.toolLineShadow ?? undefined);
    if (liveMetrics.commandShadow) {
      expectNoVisibleShadow(liveMetrics.commandShadow);
    }

    const liveScreenshotPath = testInfo.outputPath('core-thread-live-reasoning-tools.png');
    await window.screenshot({ path: liveScreenshotPath, fullPage: false });
    console.log(JSON.stringify({ liveScreenshotPath, liveMetrics }, null, 2));

    const commandAlreadyExpanded = await timeline.getByText(/echo vicode-live-transcript/i).first().isVisible().catch(() => false);
    if (!commandAlreadyExpanded) {
      await timeline.locator('.run-transcript-activity-group').first().getByRole('button').click();
      await expect(timeline.getByText(/Ran 1 command|Running 1 command/i).first()).toBeVisible();
      await timeline.getByText(/Ran 1 command|Running 1 command/i).first().click();
    }
    const commandEntry = timeline.locator('.run-transcript-command-entry').first();
    await expect(commandEntry.getByText(/Ran echo vicode-live-transcript/i)).toBeVisible();
    await expect(commandEntry.getByText(/Completed/i)).toBeVisible();
    await expect(timeline.getByText(/tool detail/i)).toHaveCount(0);
    await expect(timeline.locator('.run-transcript-terminal-tool')).toHaveCount(0);
    await commandEntry.getByRole('button').click();
    await expect(commandEntry.getByText(/\$ echo vicode-live-transcript/i)).toBeVisible();
    await expect(commandEntry.getByText(/^Command$/i)).toBeVisible();
    await expect(commandEntry.getByText(/^Output$/i)).toBeVisible();
    await window.screenshot({ path: testInfo.outputPath('core-thread-live-tool-details-expanded.png'), fullPage: false });

    await expect.poll(async () => {
      const detail = await window.evaluate(async (id) => window.vicode.threads.open(id), threadId);
      return detail.status;
    }, { timeout: 90_000 }).toBe('completed');

    await expect(window.getByText('The live transcript QA completed.')).toBeVisible({ timeout: 15_000 });
    await expectIdleComposer(window);
    const workedSummary = timeline.getByRole('button', { name: /Worked for/i }).first();
    await expect(workedSummary).toBeVisible();
    await expect(timeline.getByText(/I will inspect README\.md/i).first()).toBeHidden();
    await expect(window.locator('.run-transcript-activity-group.is-worked-for-summary')).toHaveCount(1);
    await expect(window.getByTestId('app-inline-notice')).toHaveCount(0);
    await expectComposerAndTranscriptLayoutFit(window);
    await window.screenshot({ path: testInfo.outputPath('core-thread-live-worked-summary-collapsed.png'), fullPage: false });

    await workedSummary.click();
    await expect(timeline.getByText(/I will inspect README\.md/i).first()).toBeVisible();
    await expect(timeline.getByText(/echo vicode-live-transcript/i).first()).toBeVisible();
  } finally {
    await provider.close().catch(() => undefined);
    await closeApp(app);
    await removeWorkspaceDir(workspaceDir);
  }
});

test('captures the core thread read search write UI', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-thread-core-visual-'));
  writeFileSync(
    path.join(workspaceDir, 'README.md'),
    'This workspace exists to validate that Vicode can read, search, write, and show useful thread evidence.',
    'utf8'
  );
  const provider = await startProvider();
  const { app, window } = await launchApp({
    bridgePaths,
    env: {
      VICODE_WEB_SEARCH_BASE_URL: provider.searchBaseUrl
    }
  });

  try {
    const threadId = await createThreadWithCustomProvider(window, {
      workspaceDir,
      baseUrl: provider.baseUrl,
      providerName: 'Thread Core Visual Audit',
      modelId: 'thread-core-visual-model'
    });

    await window.getByTestId('composer-input').fill('Read the README, search the web for evidence UI guidance, and write a short SUMMARY.md.');
    await window.getByTestId('composer-submit-button').click();

    await expect.poll(async () => {
      const detail = await window.evaluate(async (threadId) => window.vicode.threads.open(threadId), threadId);
      return detail.status;
    }, { timeout: 60_000 }).toBe('completed');

    await expectLastUserTaskContract(window, threadId, {
      taskKind: 'edit',
      conversationPhase: 'ready_to_task',
      taskIntentSource: 'prompt',
      expectedMutations: 'workspace_write',
      verificationPolicy: 'required'
    });
    await expect.poll(async () => existsSync(path.join(workspaceDir, 'SUMMARY.md')), { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => readFile(path.join(workspaceDir, 'SUMMARY.md'), 'utf8'), { timeout: 15_000 }).toContain('read the project README');
    await expect(window.getByText(/wrote SUMMARY\.md/i).first()).toBeVisible({ timeout: 15_000 });

    const timeline = window.locator('.run-transcript-timeline');
    const workedSummary = timeline.getByRole('button', { name: /Worked for/i }).first();
    await expect(workedSummary).toBeVisible();
    await expect(timeline.getByText('1 inspection step')).toBeHidden();
    await workedSummary.click();
    await expect(timeline.getByText('1 inspection step')).toBeVisible();
    await expect(timeline.getByText('3 research steps')).toBeVisible();
    await expect(timeline.locator('.run-transcript-command-group-label').filter({ hasText: /^1 file change$/ })).toBeVisible();
    await expect(timeline.getByRole('button', { name: 'Used 1 source' })).toBeVisible();
    await expect(timeline.getByText(/^Using:/)).toHaveCount(0);
    await expectIdleComposer(window);
    await expectSubduedThreadEvidence(window);

    const screenshotPath = testInfo.outputPath('core-thread-completed.png');
    await window.screenshot({ path: screenshotPath, fullPage: false });
    const metrics = await window.evaluate(() => {
      const timeline = document.querySelector('.run-transcript-timeline');
      const transcript = document.querySelector('.thread-transcript-rail, .thread-view');
      const timelineText = timeline?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      return {
        screenshotViewport: `${window.innerWidth}x${window.innerHeight}`,
        hasTimeline: Boolean(timeline),
        timelineText: timelineText.slice(0, 1000),
        reasoningRows: document.querySelectorAll('.run-transcript-reasoning, .run-activity-thinking-line').length,
        activityRows: document.querySelectorAll('.run-transcript-activity-row, .run-transcript-activity-group, .run-transcript-tool').length,
        transcriptScrollHeight: transcript instanceof HTMLElement ? transcript.scrollHeight : null,
        transcriptClientHeight: transcript instanceof HTMLElement ? transcript.clientHeight : null
      };
    });
    console.log(JSON.stringify({ screenshotPath, metrics }, null, 2));
  } finally {
    await provider.close().catch(() => undefined);
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('multi-turn conversation task auto-executes without a start button', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-thread-inferred-task-'));
  writeFileSync(
    path.join(workspaceDir, 'README.md'),
    'This workspace validates multi-turn conversation to task inference.',
    'utf8'
  );
  const provider = await startProvider([
    {
      content: 'React and TypeScript fit the calculator app. Tailwind can keep the keypad styling compact.'
    },
    {
      content: 'Keep the first slice to a display, keypad state, keyboard input, and a focused verification pass.'
    },
    {
      toolCalls: [
        toolCall('write_file', {
          path: 'CALCULATOR_PLAN.md',
          content: [
            '# Calculator App Plan',
            '',
            '- Build the app shell.',
            '- Add calculator state and keyboard input.',
            '- Verify the focused behavior.'
          ].join('\n')
        }, 1)
      ]
    },
    {
      content: 'I created CALCULATOR_PLAN.md from the calculator app discussion and kept the scope focused.'
    }
  ]);
  const { app, window } = await launchApp({
    bridgePaths,
    env: {
      VICODE_WEB_SEARCH_BASE_URL: provider.searchBaseUrl
    }
  });

  try {
    const threadId = await createThreadWithCustomProvider(window, {
      workspaceDir,
      baseUrl: provider.baseUrl,
      providerName: 'Thread Inferred Task Audit',
      modelId: 'thread-inferred-task-model'
    });

    await window.getByTestId('composer-input').fill(
      'Can we discuss a small calculator app? I want it to use React, TypeScript, and Tailwind.'
    );
    await window.getByTestId('composer-submit-button').click();
    await expectAssistantTurnCount(window, threadId, 1);
    await expect(window.getByText(/React and TypeScript fit the calculator app/i)).toBeVisible({ timeout: 15_000 });
    await expectLastUserTaskContract(window, threadId, {
      taskKind: 'ask',
      conversationPhase: 'chat',
      expectedMutations: 'none'
    });

    await expectIdleComposer(window);
    await window.getByTestId('composer-input').fill(
      'What should we keep simple, and should keyboard input work in the first slice?'
    );
    await window.getByTestId('composer-submit-button').click();
    await expectAssistantTurnCount(window, threadId, 2);
    await expect(window.getByText(/keyboard input, and a focused verification pass/i)).toBeVisible({ timeout: 15_000 });

    await expectIdleComposer(window);
    await window.getByTestId('composer-input').fill('Ok, go ahead and implement this plan.');
    await window.getByTestId('composer-submit-button').click();

    await expect.poll(async () => {
      const detail = await window.evaluate(async (threadId) => window.vicode.threads.open(threadId), threadId);
      return detail.status;
    }, { timeout: 60_000 }).toBe('completed');

    await expectLastUserResolvedTaskPacket(window, threadId, {
      trigger: 'inferred_proceed',
      phase: 'ready_to_task',
      executionPolicy: 'auto_execute',
      confidence: 'high',
      objective: expect.stringMatching(/calculator app/i),
      sourceTurnIds: expect.any(Array),
      expectedToolGroups: expect.arrayContaining([
        'workspace_read',
        'workspace_write',
        'verification'
      ]),
      slices: expect.arrayContaining([
        expect.objectContaining({ title: expect.stringMatching(/Inspect/i) }),
        expect.objectContaining({ title: expect.stringMatching(/Implement/i) })
      ])
    });
    await expect.poll(async () => {
      const detail = await window.evaluate(async (threadId) => window.vicode.threads.open(threadId), threadId);
      const lastUserTurn = [...detail.turns].reverse().find((turn) => turn.role === 'user');
      const packet = lastUserTurn?.metadata?.resolvedTaskPacket as { sourceTurnIds?: unknown[] } | undefined;
      return packet?.sourceTurnIds?.length ?? 0;
    }, { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
    await expect.poll(async () => existsSync(path.join(workspaceDir, 'CALCULATOR_PLAN.md')), { timeout: 15_000 }).toBe(true);
    await expect(window.getByText(/created CALCULATOR_PLAN\.md/i)).toBeVisible({ timeout: 15_000 });
    await expect(window.getByRole('button', { name: /start task/i })).toHaveCount(0);
    await expect(window.getByText(/Run stopped by user/i)).toHaveCount(0);

    const timeline = window.locator('.run-transcript-timeline');
    await expect(timeline.getByRole('button', { name: /Worked for/i }).first()).toBeVisible();
    await expect(timeline.getByText(/^1 file changed/)).toBeVisible();
    await expect(timeline.getByText('CALCULATOR_PLAN.md').first()).toBeVisible();
    await expectIdleComposer(window);

    await window.screenshot({ path: testInfo.outputPath('core-thread-inferred-task.png'), fullPage: false });
  } finally {
    await provider.close().catch(() => undefined);
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('ambiguous conversation task asks one clarification without dispatching work', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-thread-ambiguous-task-'));
  const provider = await startProvider([
    {
      content: 'This response should not be used because the task policy should pause first.'
    }
  ]);
  const { app, window } = await launchApp({
    bridgePaths,
    env: {
      VICODE_WEB_SEARCH_BASE_URL: provider.searchBaseUrl
    }
  });

  try {
    const threadId = await createThreadWithCustomProvider(window, {
      workspaceDir,
      baseUrl: provider.baseUrl,
      providerName: 'Thread Ambiguous Task Audit',
      modelId: 'thread-ambiguous-task-model'
    });

    await window.getByTestId('composer-input').fill('Ok, go ahead.');
    await window.getByTestId('composer-submit-button').click();

    await expect.poll(async () => {
      const detail = await window.evaluate(async (id) => window.vicode.threads.open(id), threadId);
      return detail.status;
    }, { timeout: 30_000 }).toBe('completed');

    await expectLastUserResolvedTaskPacket(window, threadId, {
      trigger: 'inferred_proceed',
      phase: 'ready_to_task',
      executionPolicy: 'ask_clarifying_question',
      confidence: 'low',
      expectedToolGroups: ['workspace_read'],
      clarificationQuestion: expect.stringMatching(/what should i implement/i)
    });
    await expect(window.getByText(/what should i implement/i)).toBeVisible({ timeout: 15_000 });
    await expect(window.getByText(/This response should not be used/i)).toHaveCount(0);
    await expect(window.getByRole('button', { name: /start task/i })).toHaveCount(0);
    await expect(window.getByText(/Run stopped by user/i)).toHaveCount(0);
    await expect.poll(async () => existsSync(path.join(workspaceDir, 'CALCULATOR_PLAN.md')), { timeout: 5_000 }).toBe(false);
    await expectIdleComposer(window);

    await window.screenshot({ path: testInfo.outputPath('core-thread-ambiguous-task.png'), fullPage: false });
  } finally {
    await provider.close().catch(() => undefined);
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('captures the core thread normal chat UI', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-thread-core-chat-'));
  const provider = await startProvider([
    {
      delayMs: 1_000,
      content: 'We can keep this as brainstorming until you decide the concrete task.'
    }
  ]);
  const { app, window } = await launchApp({
    bridgePaths,
    env: {
      VICODE_WEB_SEARCH_BASE_URL: provider.searchBaseUrl
    }
  });

  try {
    const threadId = await createThreadWithCustomProvider(window, {
      workspaceDir,
      baseUrl: provider.baseUrl,
      providerName: 'Thread Core Normal Chat Audit',
      modelId: 'thread-core-chat-model'
    });

    await window.getByTestId('composer-input').fill(
      'Let us brainstorm how we might build an app for WoW addon authors before deciding what the task should be.'
    );
    await window.getByTestId('composer-submit-button').click();
    await expect(window.getByTestId('run-activity-live')).toBeVisible({ timeout: 15_000 });
    await expect(window.getByTestId('composer-submit-button')).toHaveAttribute('aria-label', 'Stop');

    await expect.poll(async () => {
      const detail = await window.evaluate(async (threadId) => window.vicode.threads.open(threadId), threadId);
      return detail.status;
    }, { timeout: 60_000 }).toBe('completed');

    await expectLastUserTaskContract(window, threadId, {
      taskKind: 'ask',
      conversationPhase: 'chat',
      taskIntentSource: 'prompt',
      expectedMutations: 'none',
      verificationPolicy: 'none'
    });
    await expect(window.getByText('We can keep this as brainstorming until you decide the concrete task.')).toBeVisible();
    await expect(window.locator('.run-transcript-timeline').getByRole('button', { name: /Worked for/i })).toHaveCount(0);
    await expect(window.locator('.run-transcript-timeline .run-transcript-command-group-label')).toHaveCount(0);
    await expect(window.locator('.run-transcript-timeline').getByText(/^Using:/)).toHaveCount(0);
    await expectIdleComposer(window);

    await window.screenshot({ path: testInfo.outputPath('core-thread-normal-chat.png'), fullPage: false });
  } finally {
    await provider.close().catch(() => undefined);
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('captures visible failure when a core tool fails', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-thread-core-failure-'));
  const provider = await startProvider([
    {
      toolCalls: [
        toolCall('read_file', { path: 'DOES_NOT_EXIST.md' }, 1)
      ]
    },
    {
      content: 'I could not read DOES_NOT_EXIST.md because it was not found.'
    }
  ]);
  const { app, window } = await launchApp({
    bridgePaths,
    env: {
      VICODE_WEB_SEARCH_BASE_URL: provider.searchBaseUrl
    }
  });

  try {
    const threadId = await createThreadWithCustomProvider(window, {
      workspaceDir,
      baseUrl: provider.baseUrl,
      providerName: 'Thread Core Failure Audit',
      modelId: 'thread-core-failure-model'
    });

    await window.getByTestId('composer-input').fill('Try to read DOES_NOT_EXIST.md and explain what happened.');
    await window.getByTestId('composer-submit-button').click();

    await expect.poll(async () => {
      const detail = await window.evaluate(async (threadId) => window.vicode.threads.open(threadId), threadId);
      return detail.status;
    }, { timeout: 60_000 }).toMatch(/completed|failed/);

    await expect(window.getByText(/DOES_NOT_EXIST\.md|not found|failed/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(window.locator('.run-transcript-timeline').getByText(/^Using:/)).toHaveCount(0);
    await expectIdleComposer(window);

    await window.screenshot({ path: testInfo.outputPath('core-thread-tool-failure.png'), fullPage: false });
  } finally {
    await provider.close().catch(() => undefined);
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
