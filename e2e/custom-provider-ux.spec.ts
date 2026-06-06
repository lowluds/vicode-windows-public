import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { encodeCustomProviderModelId } from '../src/shared/custom-provider-routing';
import { closeApp, launchApp, openTitlebarSurface, waitForBridge, waitForThreadSurfaceReady } from './helpers/electron';

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

async function startCompatibleServer() {
  const requests: Array<{ authorization: string | undefined; body: string; url: string | undefined }> = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readRequestBody(request);
    requests.push({
      authorization: request.headers.authorization,
      body,
      url: request.url
    });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Gateway provider run completed.',
            tool_calls: []
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

async function openProviderSettings(window: Page) {
  await openTitlebarSurface(window, 'nav-settings', window.locator('.settings-root'));
  await window.getByRole('button', { name: 'Providers' }).click();
  await expect(window.getByRole('heading', { name: 'Providers' })).toBeVisible();
  await expect(window.getByTestId('custom-provider-settings-panel')).toBeVisible();
}

async function closeSettings(window: Page) {
  await window.getByLabel('Close settings').click();
  await expect(window.locator('.settings-root')).toHaveCount(0);
}

async function fillCustomProviderDraft(window: Page, input: {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  enabled?: boolean;
}) {
  if (input.name !== undefined) {
    await window.getByTestId('custom-provider-name-input').fill(input.name);
  }
  if (input.baseUrl !== undefined) {
    await window.getByTestId('custom-provider-base-url-input').fill(input.baseUrl);
  }
  if (input.apiKey !== undefined) {
    await window.getByTestId('custom-provider-api-key-input').fill(input.apiKey);
  }
  if (input.model !== undefined) {
    await window.getByTestId('custom-provider-model-input').fill(input.model);
  }
  if (input.enabled !== undefined) {
    const checkbox = window.getByTestId('custom-provider-enabled-input');
    if ((await checkbox.isChecked()) !== input.enabled) {
      await checkbox.click();
    }
  }
}

async function saveCustomProviderDraft(window: Page) {
  await window.getByTestId('custom-provider-save-button').click();
  await expect(window.getByTestId('custom-provider-save-button')).not.toHaveText('Saving...', { timeout: 10_000 });
}

async function resolveSavedCustomModelId(window: Page, providerName: string, modelId: string) {
  const providerId = await expect
    .poll(async () => {
      const providers = await window.evaluate(async () => window.vicode.providers.listCustom());
      return providers.find((provider) => provider.name === providerName)?.id ?? null;
    }, { timeout: 10_000 })
    .toBeTruthy()
    .then(async () => {
      const providers = await window.evaluate(async () => window.vicode.providers.listCustom());
      return providers.find((provider) => provider.name === providerName)?.id;
    });
  if (!providerId) {
    throw new Error(`Custom provider not found after save: ${providerName}`);
  }
  return encodeCustomProviderModelId({
    customProviderId: providerId,
    modelId
  });
}

async function expectCustomApiPickerState(window: Page, encodedModelId: string, visible: boolean) {
  await window.getByTestId('composer-model-select').click();
  const option = window.locator(`[data-testid="composer-model-option-openai_compatible-${encodedModelId}"]`);
  if (visible) {
    await window.getByRole('menuitem').filter({ hasText: 'Custom API' }).hover();
    await expect(option).toBeVisible();
  } else {
    await expect(window.getByRole('menuitem').filter({ hasText: 'Custom API' })).toHaveCount(0);
  }
  await window.keyboard.press('Escape');
}

async function selectCustomApiModel(window: Page, encodedModelId: string) {
  await window.getByTestId('composer-model-select').click();
  await window.getByRole('menuitem').filter({ hasText: 'Custom API' }).hover();
  await window.locator(`[data-testid="composer-model-option-openai_compatible-${encodedModelId}"]`).click();
  await expect(window.getByTestId('composer-model-select')).toContainText('Gateway UX');
}

test('Custom API provider UX supports add, select, use, break, repair, and remove', async () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-custom-provider-ux-'));
  writeFileSync(path.join(workspaceDir, 'package.json'), JSON.stringify({ name: 'custom-provider-ux', private: true }, null, 2));
  const compatibleServer = await startCompatibleServer();
  let encodedModelId = '';
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.providers']
  });
  let projectId: string | null = null;
  let threadId: string | null = null;

  try {
    const seeded = await window.evaluate(async ({ workspaceDir }) => {
      const project = await window.vicode.projects.create({
        name: `Custom provider UX ${Date.now()}`,
        folderPath: workspaceDir,
        trusted: true
      });
      const bootstrap = await window.vicode.app.getBootstrap();
      const provider =
        bootstrap.providers.find((entry) => entry.id === 'ollama') ??
        bootstrap.providers.find((entry) => entry.id === 'openai_compatible') ??
        bootstrap.providers[0];
      const thread = await window.vicode.threads.create({
        projectId: project.id,
        providerId: provider.id,
        modelId: provider.models[0]?.id ?? 'qwen2.5-coder:14b-instruct-q6_K',
        executionPermission: 'default'
      });
      await window.vicode.settings.save({
        selectedProjectId: project.id,
        lastOpenedThreadId: thread.id
      });
      return { projectId: project.id, threadId: thread.id };
    }, { workspaceDir });
    projectId = seeded.projectId;
    threadId = seeded.threadId;

    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.providers']);
    await waitForThreadSurfaceReady(window);

    await openProviderSettings(window);
    await fillCustomProviderDraft(window, {
      name: 'Gateway UX',
      baseUrl: compatibleServer.baseUrl,
      apiKey: 'ux-secret-key',
      model: 'ux-model',
      enabled: true
    });
    await saveCustomProviderDraft(window);
    await expect(window.getByTestId('custom-provider-settings-panel')).toContainText('Gateway UX');
    encodedModelId = await resolveSavedCustomModelId(window, 'Gateway UX', 'ux-model');
    await closeSettings(window);

    await expectCustomApiPickerState(window, encodedModelId, true);

    await openProviderSettings(window);
    await window.getByTestId('custom-provider-settings-panel').getByRole('button', { name: 'Edit' }).click();
    await fillCustomProviderDraft(window, {
      apiKey: 'ux-secret-key',
      enabled: false
    });
    await saveCustomProviderDraft(window);
    await expect(window.getByTestId('custom-provider-settings-panel')).toContainText('Disabled');
    await closeSettings(window);
    await expectCustomApiPickerState(window, encodedModelId, false);

    await openProviderSettings(window);
    await window.getByTestId('custom-provider-settings-panel').getByRole('button', { name: 'Edit' }).click();
    await fillCustomProviderDraft(window, {
      apiKey: 'ux-secret-key',
      enabled: true
    });
    await saveCustomProviderDraft(window);
    await expect(window.getByTestId('custom-provider-settings-panel')).toContainText('Enabled');
    await closeSettings(window);

    await selectCustomApiModel(window, encodedModelId);
    await window.getByTestId('composer-input').fill('Reply with exactly the gateway provider success text.');
    await window.getByTestId('composer-input').press('Enter');

    await expect
      .poll(async () => {
        return await window.evaluate(async (threadId) => {
          const detail = await window.vicode.threads.open(threadId);
          return detail.turns.some((turn) => turn.role === 'assistant' && turn.content.includes('Gateway provider run completed.'));
        }, threadId);
      }, { timeout: 30_000 })
      .toBe(true);
    expect(compatibleServer.requests).toHaveLength(1);
    expect(compatibleServer.requests[0]?.authorization).toBe('Bearer ux-secret-key');
    expect(compatibleServer.requests[0]?.body).toContain('"model":"ux-model"');

    await openProviderSettings(window);
    await window.getByTestId('custom-provider-settings-panel').getByRole('button', { name: 'Remove' }).click();
    await expect(window.getByTestId('custom-provider-settings-panel')).not.toContainText('Gateway UX');
    await closeSettings(window);
    await expectCustomApiPickerState(window, encodedModelId, false);
  } finally {
    await compatibleServer.close().catch(() => {});
    if (projectId) {
      await window.evaluate(async (projectId) => {
        await window.vicode.projects.remove(projectId).catch(() => {});
      }, projectId).catch(() => {});
    }
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
