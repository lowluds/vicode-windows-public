import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
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

interface ScriptedProviderResponse {
  content: string;
  delayMs?: number;
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

function delayOrRequestClose(request: IncomingMessage, ms: number) {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    request.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function startProvider(responses: ScriptedProviderResponse[]) {
  let responseIndex = 0;

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    await readRequestBody(request);
    const scripted = responses[Math.min(responseIndex, responses.length - 1)] ?? { content: 'Done.' };
    responseIndex += 1;
    if (scripted.delayMs) {
      await delayOrRequestClose(request, scripted.delayMs);
    }
    if (response.destroyed || response.writableEnded) {
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      choices: [
        {
          message: {
            role: 'assistant',
            content: scripted.content
          }
        }
      ]
    }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    })
  };
}

async function createComposerThread(
  window: Page,
  options: {
    workspaceDir: string;
    baseUrl: string;
    providerName: string;
    modelId: string;
  }
) {
  const setup = await window.evaluate(async ({ workspaceDir, baseUrl, providerName, modelId }) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    const customProvider = await window.vicode.providers.saveCustom({
      name: providerName,
      transportKind: 'openai_compatible_chat',
      baseUrl,
      apiKey: 'composer-button-visual-secret',
      defaultModelId: modelId,
      enabled: true
    });
    const project = await window.vicode.projects.create({
      name: `${providerName} ${Date.now()}`,
      folderPath: workspaceDir,
      trusted: true
    });
    return {
      customProviderId: customProvider.id,
      defaultModelByProvider: bootstrap.preferences.defaultModelByProvider,
      projectId: project.id
    };
  }, options);

  const encodedModelId = encodeCustomProviderModelId({
    customProviderId: setup.customProviderId,
    modelId: options.modelId
  });

  const threadId = await window.evaluate(async ({ defaultModelByProvider, projectId, modelId }) => {
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
      defaultProviderId: 'openai_compatible',
      defaultModelByProvider: {
        ...defaultModelByProvider,
        openai_compatible: modelId
      }
    });
    return thread.id;
  }, {
    defaultModelByProvider: setup.defaultModelByProvider,
    projectId: setup.projectId,
    modelId: encodedModelId
  });

  await window.reload({ waitUntil: 'domcontentloaded' });
  await waitForBridge(window, bridgePaths);
  await expect(window.getByTestId('composer-input')).toBeVisible();
  return threadId;
}

async function expectComposerControlsVisible(window: Page) {
  await expect(window.getByTestId('composer-input')).toBeVisible();
  await expect(window.getByTestId('composer-action-menu-trigger')).toBeVisible();
  await expect(window.getByTestId('composer-model-select')).toBeVisible();
  await expect(window.getByTestId('composer-workspace-select')).toBeVisible();
  await expect(window.getByTestId('composer-voice-button')).toBeVisible();
  await expect(window.getByTestId('composer-submit-button')).toBeVisible();
  await expect(window.getByTestId('composer-context-window-trigger')).toHaveCount(0);
  await expect(window.getByTestId('sidebar-context-window-status')).toBeVisible();
}

async function expectComposerControlsFit(window: Page) {
  const result = await window.evaluate(() => {
    const controls = [
      ['actions', '[data-testid="composer-action-menu-trigger"]'],
      ['model', '[data-testid="composer-model-select"]'],
      ['workspace', '[data-testid="composer-workspace-select"]'],
      ['voice', '[data-testid="composer-voice-button"]'],
      ['submit', '[data-testid="composer-submit-button"]']
    ] as const;
    const issues: string[] = [];
    const rects = controls.flatMap(([name, selector]) => {
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

    const compactChevronControls = [
      ['model', '[data-testid="composer-model-select"]'],
      ['workspace', '[data-testid="composer-workspace-select"]']
    ] as const;
    compactChevronControls.forEach(([name, selector]) => {
      const control = document.querySelector(selector);
      if (!(control instanceof HTMLElement)) {
        return;
      }
      const label = control.querySelector('.ui-control-label');
      const trailingIcon = control.querySelector('.ui-control-icon:last-child');
      if (!(label instanceof HTMLElement) || !(trailingIcon instanceof HTMLElement)) {
        issues.push(`${name} label or chevron missing`);
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(label);
      const labelContentRects = Array.from(range.getClientRects());
      range.detach();
      const labelRight = labelContentRects.length > 0
        ? Math.max(...labelContentRects.map((rect) => rect.right))
        : label.getBoundingClientRect().right;
      const iconLeft = trailingIcon.getBoundingClientRect().left;
      const contentToChevronGap = iconLeft - labelRight;
      if (contentToChevronGap > 12) {
        issues.push(`${name} chevron gap too wide ${Math.round(contentToChevronGap)}px`);
      }
    });

    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) {
      issues.push(`horizontal page overflow ${root.scrollWidth} > ${root.clientWidth}`);
    }

    if (document.querySelector('[data-testid="composer-context-window-trigger"]')) {
      issues.push('composer shows context usage counter');
    }

    return { issues, rects };
  });

  expect(result.issues).toEqual([]);
}

async function expectOpenMenusFit(window: Page) {
  const result = await window.evaluate(() => {
    const issues: string[] = [];
    const menus = Array.from(document.querySelectorAll('.ui-menu-content'));
    menus.forEach((menu, index) => {
      const rect = menu.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 28) {
        issues.push(`menu ${index} too small ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
      if (rect.left < -1 || rect.top < -1 || rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1) {
        issues.push(`menu ${index} outside viewport`);
      }
    });
    return { count: menus.length, issues };
  });

  expect(result.count).toBeGreaterThan(0);
  expect(result.issues).toEqual([]);
}

function expectNoVisibleShadow(value: string | null | undefined) {
  if (!value || value === 'none') {
    return;
  }
  expect(value).toMatch(/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/u);
  expect(value.replace(/rgba\([^)]+\)/gu, '').replace(/,/gu, '').trim()).toMatch(/^(0px\s*)+$/u);
}

async function readChromeMetrics(window: Page, selector: string) {
  return await window.evaluate((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!(element instanceof HTMLElement)) {
      return null;
    }
    const style = window.getComputedStyle(element);
    return {
      backgroundImage: style.backgroundImage,
      borderRadius: Number.parseFloat(style.borderTopLeftRadius || '0'),
      boxShadow: style.boxShadow,
      text: element.innerText
    };
  }, selector);
}

test('composer action buttons open menus, enhance prompts, and show unsupported plan feedback', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-composer-buttons-action-'));
  const provider = await startProvider([
    {
      content: 'Refined composer button prompt.',
      delayMs: 750
    }
  ]);
  const { app, window } = await launchApp({ bridgePaths });

  try {
    await createComposerThread(window, {
      workspaceDir,
      baseUrl: provider.baseUrl,
      providerName: 'Composer Button Action Audit',
      modelId: 'composer-button-action-model'
    });

    await expectComposerControlsVisible(window);
    await expectComposerControlsFit(window);

    await window.getByTestId('composer-action-menu-trigger').click();
    await expect(window.getByTestId('composer-action-add-images')).toBeVisible();
    await expect(window.getByTestId('composer-action-enhance')).toBeVisible();
    await expect(window.getByTestId('composer-action-enhance')).toHaveAttribute('aria-disabled', 'true');
    await expect(window.getByTestId('composer-action-plan-mode')).toBeVisible();
    await expectOpenMenusFit(window);
    await window.screenshot({ path: testInfo.outputPath('composer-actions-menu-empty.png'), fullPage: false });
    await window.mouse.click(16, 16);
    await expect(window.locator('.composer-attach-menu')).toHaveCount(0);
    await window.waitForTimeout(350);
    await expect(window.locator('.composer-tooltip')).toHaveCount(0);

    const composer = window.getByTestId('composer-input');
    await composer.fill('Make the composer button audit easier to verify.');
    await window.getByTestId('composer-action-menu-trigger').click();
    await expect(window.getByTestId('composer-action-enhance')).not.toHaveAttribute('aria-disabled', 'true');
    await window.getByTestId('composer-action-enhance').click();
    await expect(window.getByTestId('app-inline-notice')).toContainText('Prompt enhancement is not available for Custom API yet.');
    const unsupportedEnhanceNotice = await readChromeMetrics(window, '[data-testid="app-inline-notice"]');
    expect(unsupportedEnhanceNotice?.borderRadius ?? 99).toBeLessThanOrEqual(8);
    expectNoVisibleShadow(unsupportedEnhanceNotice?.boxShadow);
    await expect(window.getByTestId('composer-submit-button')).toHaveAttribute('aria-label', 'Send');
    await expect(composer).toHaveValue('Make the composer button audit easier to verify.');

    await window.getByRole('button', { name: 'Dismiss notice' }).click();
    await window.keyboard.press('Escape');
    await window.getByTestId('composer-action-menu-trigger').click();
    await expect(window.getByTestId('composer-action-plan-mode')).toBeVisible();
    await window.getByTestId('composer-action-plan-mode').click();
    await expect(window.getByTestId('app-inline-notice')).toContainText(/does not support native Plan mode/i);
    await expect(composer).toHaveAttribute('placeholder', /follow-up/i);
    await expect(window.getByTestId('composer-plan-mode-pill')).toHaveCount(0);
    await expectComposerControlsFit(window);
  } finally {
    await provider.close().catch(() => undefined);
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('composer status and provider buttons open without clipping and update selected state', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-composer-buttons-status-'));
  const provider = await startProvider([{ content: 'Done.' }]);
  const { app, window } = await launchApp({ bridgePaths });

  try {
    await createComposerThread(window, {
      workspaceDir,
      baseUrl: provider.baseUrl,
      providerName: 'Composer Button Status Audit',
      modelId: 'composer-button-status-model'
    });

    await expectComposerControlsVisible(window);
    await expectComposerControlsFit(window);
    await expect(window.getByTestId('composer-workspace-select')).not.toContainText('shell access');

    await window.getByTestId('composer-workspace-select').click();
    await expect(window.getByRole('menuitemcheckbox', { name: /Proposed changes/i })).toBeVisible();
    await expect(window.getByRole('menuitemcheckbox', { name: /Isolated worktree/i })).toBeVisible();
    await expect(window.getByRole('menuitemcheckbox', { name: /Ask first/i })).toBeVisible();
    await expect(window.getByRole('menuitemcheckbox', { name: /Full access/i })).toBeVisible();
    await expectOpenMenusFit(window);
    await window.screenshot({ path: testInfo.outputPath('composer-workspace-menu.png'), fullPage: false });
    await window.getByRole('menuitemcheckbox', { name: /Full access/i }).click();
    await expect(window.getByTestId('composer-workspace-select')).toContainText('Full access');
    await expect(window.getByTestId('composer-workspace-select')).not.toContainText('shell access');
    await expect(window.locator('.composer-workspace-menu-content')).toHaveCount(0);
    await window.waitForTimeout(350);
    await expect(window.locator('.composer-status-tooltip')).toHaveCount(0);

    await window.getByTestId('composer-workspace-select').click();
    await expect(window.getByRole('menuitemcheckbox', { name: /Proposed changes/i })).toBeVisible();
    await window.mouse.click(16, 16);
    await expect(window.locator('.composer-workspace-menu-content')).toHaveCount(0);
    await expect(window.locator('.composer-status-tooltip')).toHaveCount(0);

    await window.getByTestId('composer-workspace-select').click();
    await window.getByRole('menuitemcheckbox', { name: /Proposed changes/i }).click();
    await expect(window.getByTestId('composer-workspace-select')).toContainText('Proposed changes');

    await window.getByTestId('composer-workspace-select').click();
    await expect(window.getByRole('menuitemcheckbox', { name: /Ask first/i })).toBeVisible();
    await expect(window.getByRole('menuitemcheckbox', { name: /Full access/i })).toBeVisible();
    await expectOpenMenusFit(window);
    await window.getByRole('menuitemcheckbox', { name: /Ask first/i }).click();
    await expect(window.getByTestId('composer-workspace-select')).toContainText('Proposed changes');
    await expect(window.getByTestId('composer-workspace-select')).not.toContainText('shell access');

    await window.getByTestId('composer-model-select').click();
    await expect(window.getByText('Custom API').first()).toBeVisible();
    await expectOpenMenusFit(window);
    await window.screenshot({ path: testInfo.outputPath('composer-provider-menu.png'), fullPage: false });
    await window.keyboard.press('Escape');

    await expectComposerControlsFit(window);
  } finally {
    await provider.close().catch(() => undefined);
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('composer send button becomes stop and stops a delayed run', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-composer-buttons-stop-'));
  const provider = await startProvider([
    {
      content: 'This delayed response should be stopped before it completes.',
      delayMs: 20_000
    }
  ]);
  const { app, window } = await launchApp({ bridgePaths });

  try {
    const threadId = await createComposerThread(window, {
      workspaceDir,
      baseUrl: provider.baseUrl,
      providerName: 'Composer Button Stop Audit',
      modelId: 'composer-button-stop-model'
    });

    await expectComposerControlsVisible(window);
    await window.getByTestId('composer-input').fill('Start a delayed run so the Stop button can be verified.');
    await window.getByTestId('composer-submit-button').click();
    await expect(window.getByTestId('run-activity-live')).toBeVisible({ timeout: 15_000 });
    await expect(window.getByTestId('composer-submit-button')).toHaveAttribute('aria-label', 'Stop');
    await expectComposerControlsFit(window);
    await window.screenshot({ path: testInfo.outputPath('composer-running-stop-button.png'), fullPage: false });

    await window.getByTestId('composer-submit-button').click();
    await expect.poll(async () => {
      const detail = await window.evaluate(async (targetThreadId) => window.vicode.threads.open(targetThreadId), threadId);
      return detail.status;
    }, { timeout: 30_000 }).toBe('aborted');
    await expect(window.getByTestId('composer-submit-button')).toHaveAttribute('aria-label', 'Send');
    await expect(window.getByTestId('app-inline-notice')).toHaveCount(0);
    await expect(window.locator('.run-activity-outcome-aborted')).toHaveCount(1);
    await expect(window.locator('.run-activity-outcome-aborted .run-activity-outcome-message')).toHaveText('Run stopped by user.');
    await expect(window.locator('.run-activity-outcome-aborted .ui-status-pill')).toHaveCount(0);
    const stoppedOutcome = await readChromeMetrics(window, '.run-activity-outcome-aborted');
    expect(stoppedOutcome?.borderRadius ?? 99).toBeLessThanOrEqual(8);
    expect(stoppedOutcome?.backgroundImage).toBe('none');
    expectNoVisibleShadow(stoppedOutcome?.boxShadow);
    expect((stoppedOutcome?.text.match(/run stopped/giu) ?? []).length).toBe(1);
    const userTurn = await readChromeMetrics(window, '.turn-content-user');
    expect(userTurn?.backgroundImage).toBe('none');
    expectNoVisibleShadow(userTurn?.boxShadow);
    await expect(window.locator('.thread-composer-stack .run-activity-outcome-aborted')).toHaveCount(0);
    await window.screenshot({ path: testInfo.outputPath('composer-stopped-single-outcome.png'), fullPage: false });
    await expectComposerControlsFit(window);
  } finally {
    await provider.close().catch(() => undefined);
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
