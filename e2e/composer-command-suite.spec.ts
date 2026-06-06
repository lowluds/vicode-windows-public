import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { ProviderId } from '../src/shared/domain';
import { buildNativeComposerCommandPrompt, nativeComposerCommands } from '../src/shared/nativeCommands';
import { closeApp, launchApp as launchElectronApp, waitForBridge } from './helpers/electron';

async function launchApp() {
  return await launchElectronApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.skills', 'vicode.providers']
  });
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
            content: 'Composer command suite Custom API run completed.',
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

async function seedComposerFixture(window: Page, workspaceDir: string, baseUrl: string) {
  return await window.evaluate(async ({ workspaceDir, baseUrl }) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const fallbackProvider =
      bootstrap.providers.find((provider) => provider.id === 'ollama') ??
      bootstrap.providers.find((provider) => provider.id === 'openai_compatible') ??
      bootstrap.providers[0] ??
      null;
    const providerTargets = [
      ...new Set([
        ...bootstrap.providers.map((provider) => provider.id),
        'ollama' as const,
        'openai_compatible' as const
      ])
    ];
    if (!fallbackProvider) {
      throw new Error('Expected at least one provider.');
    }
    const customProvider = await window.vicode.providers.saveCustom({
      name: `Composer Command Suite ${suffix}`,
      transportKind: 'openai_compatible_chat',
      baseUrl,
      apiKey: 'composer-suite-secret',
      defaultModelId: 'composer-suite-model',
      enabled: true
    });

    const project = await window.vicode.projects.create({
      name: `Composer command suite ${suffix}`,
      folderPath: workspaceDir,
      trusted: true
    });

    const customModelId = [
      'openai-compatible',
      encodeURIComponent(customProvider.id),
      encodeURIComponent('composer-suite-model')
    ].join(':');
    const providerId = 'openai_compatible';
    const modelId = customModelId;

    const thread = await window.vicode.threads.create({
      projectId: project.id,
      providerId,
      modelId,
      executionPermission: 'full_access'
    });

    const webSkill = await window.vicode.skills.save({
      name: 'qa-web-artifacts-builder',
      description: 'Build polished web artifacts with stronger frontend rigor.',
      instructions: 'Use this skill when building premium web artifacts.',
      scope: 'global',
      providerTargets,
      enabled: true,
      projectId: null
    });

    const researchSkill = await window.vicode.skills.save({
      name: 'qa-research-pack',
      description: 'Collect sources and summarize them carefully.',
      instructions: 'Use this skill when research quality matters.',
      scope: 'global',
      providerTargets,
      enabled: true,
      projectId: null
    });

    await window.vicode.settings.save({
      selectedProjectId: project.id,
      lastOpenedThreadId: thread.id
    });

    return {
      projectId: project.id,
      threadId: thread.id,
      providerId,
      modelId,
      customApiReady: true,
      customModelId,
      skills: [
        { id: webSkill.id, name: webSkill.name },
        { id: researchSkill.id, name: researchSkill.name }
      ]
    };
  }, { workspaceDir, baseUrl });
}

async function cleanupFixture(window: Page | null, fixture: {
  projectId: string | null;
  threadId: string | null;
  skills: Array<{ id: string; name: string }>;
}) {
  if (!window) {
    return;
  }

  await window
    .evaluate(async ({ projectId, threadId, skills }) => {
      if (threadId) {
        await window.vicode.threads.remove(threadId).catch(() => {});
      }
      if (projectId) {
        await window.vicode.projects.remove(projectId).catch(() => {});
      }
      for (const skillId of skills.map((skill) => skill.id)) {
        await window.vicode.skills.remove(skillId).catch(() => {});
      }
    }, fixture)
    .catch(() => {});
}

async function resetComposer(window: Page) {
  const commandChipRemove = window.locator('.composer-command-chip-remove');
  if (await commandChipRemove.count()) {
    await commandChipRemove.first().click();
    await expect(window.locator('.composer-command-chip')).toHaveCount(0);
  }
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

async function appendSkillMention(window: Page, partialToken: string, expectedSkillName: string, method: 'click' | 'enter') {
  const composer = window.getByTestId('composer-input');
  await composer.evaluate((element) => {
    if (!(element instanceof HTMLTextAreaElement)) {
      return;
    }
    element.focus();
    const end = element.value.length;
    element.setSelectionRange(end, end);
    element.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await composer.pressSequentially(partialToken);
  const skillPickerItem = window.locator('.composer-skill-picker-item').filter({ hasText: expectedSkillName }).first();
  await expect(skillPickerItem).toBeVisible();
  if (method === 'click') {
    await skillPickerItem.click();
  } else {
    await composer.press('Enter');
  }

  const value = await composer.inputValue();
  const matches = Array.from(value.matchAll(/\$[a-z0-9-]+/gi));
  const insertedToken = matches.at(-1)?.[0] ?? null;
  if (!insertedToken) {
    throw new Error('Expected a skill token to be inserted into the composer.');
  }

  return insertedToken;
}

async function pollThread(window: Page, threadId: string) {
  return await window.evaluate(async (targetThreadId) => window.vicode.threads.open(targetThreadId), threadId);
}

async function setDefaultComposerModel(window: Page, providerId: string, modelId: string) {
  await window.evaluate(async ({ providerId, modelId }) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    await window.vicode.settings.save({
      defaultProviderId: providerId as ProviderId,
      defaultModelByProvider: {
        ...bootstrap.preferences.defaultModelByProvider,
        [providerId]: modelId
      }
    });
  }, { providerId, modelId });
}

async function restorePrimaryComposerThread(window: Page, projectId: string, threadId: string) {
  await window.evaluate(async ({ projectId, threadId }) => {
    await window.vicode.planner.setMode({ threadId, mode: 'default' }).catch(() => {});
    await window.vicode.settings.save({
      selectedProjectId: projectId,
      lastOpenedThreadId: threadId
    });
  }, { projectId, threadId });
  await window.reload({ waitUntil: 'domcontentloaded' });
  await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.skills']);
}

async function createOllamaPlannerThread(window: Page, projectId: string | null) {
  const threadId = await window.evaluate(async ({ projectId }) => {
    if (!projectId) {
      throw new Error('Expected a project id for native Plan mode validation.');
    }
    const bootstrap = await window.vicode.app.getBootstrap();
    const provider = bootstrap.providers.find((entry) => entry.id === 'ollama' && entry.plannerPolicy.supported) ?? null;
    if (!provider) {
      return null;
    }
    const modelId =
      bootstrap.preferences.defaultModelByProvider[provider.id] ??
      provider.models[0]?.id ??
      'qwen2.5-coder:14b-instruct-q6_K';
    const thread = await window.vicode.threads.create({
      projectId,
      providerId: provider.id,
      modelId,
      executionPermission: 'full_access'
    });
    await window.vicode.settings.save({
      selectedProjectId: projectId,
      lastOpenedThreadId: thread.id,
      defaultProviderId: provider.id,
      defaultModelByProvider: {
        ...bootstrap.preferences.defaultModelByProvider,
        [provider.id]: modelId
      }
    });
    return thread.id;
  }, { projectId });

  if (!threadId) {
    return null;
  }

  await window.reload({ waitUntil: 'domcontentloaded' });
  await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.skills']);
  return threadId;
}

async function installEnhancePromptStub(window: Page, delayMs = 0) {
  await window.evaluate(async (stubDelayMs) => {
    const globalWindow = window as typeof window & {
      __composerEnhancePromptOriginal__?: typeof window.vicode.composer.enhancePrompt;
    };
    if (!globalWindow.__composerEnhancePromptOriginal__) {
      globalWindow.__composerEnhancePromptOriginal__ = window.vicode.composer.enhancePrompt;
    }

    window.vicode.composer.enhancePrompt = async ({ prompt }) => {
      if (stubDelayMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, stubDelayMs));
      }
      return {
        prompt: `${prompt.trim()}\n\nRefined for testing with clearer structure and scope.`
      };
    };
  }, delayMs);
}

async function restoreEnhancePromptStub(window: Page) {
  await window.evaluate(() => {
    const globalWindow = window as typeof window & {
      __composerEnhancePromptOriginal__?: typeof window.vicode.composer.enhancePrompt;
    };
    if (globalWindow.__composerEnhancePromptOriginal__) {
      window.vicode.composer.enhancePrompt = globalWindow.__composerEnhancePromptOriginal__;
      delete globalWindow.__composerEnhancePromptOriginal__;
    }
  });
}

test.describe.serial('composer command suite', () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-composer-command-suite-'));
  let app: ElectronApplication | null = null;
  let window: Page | null = null;
  let compatibleServer: Awaited<ReturnType<typeof startCompatibleServer>> | null = null;
  let fixture: {
    projectId: string | null;
    threadId: string | null;
    providerId: string;
    modelId: string;
    customApiReady: boolean;
    customModelId: string | null;
    skills: Array<{ id: string; name: string }>;
  } = {
    projectId: null,
    threadId: null,
    providerId: 'openai_compatible',
    modelId: 'openai-compatible:test:composer-suite-model',
    customApiReady: false,
    customModelId: null,
    skills: []
  };

  test.beforeAll(async () => {
    compatibleServer = await startCompatibleServer();
    ({ app, window } = await launchApp());
    fixture = await seedComposerFixture(window, workspaceDir, compatibleServer.baseUrl);
    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.skills', 'vicode.providers']);
  });

  test.afterAll(async () => {
    await cleanupFixture(window, {
      projectId: fixture.projectId,
      threadId: fixture.threadId,
      skills: fixture.skills
    });
    await closeApp(app);
    await compatibleServer?.close().catch(() => {});
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  test('native slash commands select with Enter and rewrite the body locally', async () => {
    test.skip(!window);
    const localCommands = nativeComposerCommands.filter((command) => !['enhance', 'plan'].includes(command.id));

    for (const command of localCommands) {
      await resetComposer(window!);
      await selectSlashCommand(window!, command.token);
      const composer = window!.getByTestId('composer-input');
      const rawInput = `Source material for ${command.token}`;
      await composer.fill(rawInput);
      await window!.getByTestId('composer-submit-button').click();
      await expect(window!.locator('.composer-command-chip')).toHaveCount(0);
      await expect(composer).toHaveValue(buildNativeComposerCommandPrompt(command.id, rawInput));
    }
  });

  test('parked autonomous-build commands are not exposed in the composer', async () => {
    test.skip(!window);
    await resetComposer(window!);
    await window!.getByTestId('composer-input').fill('/autonomous');
    await expect(window!.locator('.composer-command-menu')).toHaveCount(0);
    await window!.getByTestId('composer-input').fill('/build-plan');
    await expect(window!.locator('.composer-command-menu')).toHaveCount(0);
    await restorePrimaryComposerThread(window!, fixture.projectId!, fixture.threadId!);
  });

  test('plan slash command switches plan mode and preserves the body', async () => {
    test.skip(!window);
    const plannerThreadId = await createOllamaPlannerThread(window!, fixture.projectId);
    test.skip(!plannerThreadId, 'Ollama planner provider must be available for native Plan mode validation.');
    await resetComposer(window!);
    await selectSlashCommand(window!, 'plan');
    const composer = window!.getByTestId('composer-input');
    await composer.fill('Plan the implementation in 3 steps.');
    await window!.getByTestId('composer-submit-button').click();
    await expect(window!.locator('.composer-command-chip')).toHaveCount(0);
    await expect(window!.locator('.composer-plan-pill')).toBeVisible();
    await expect(composer).toHaveValue('Plan the implementation in 3 steps.');
  });

  test('skills insert by click and Enter under a slash-command chip and keep select-all working', async () => {
    test.skip(!window);
    await restorePrimaryComposerThread(window!, fixture.projectId!, fixture.threadId!);
    const composer = window!.getByTestId('composer-input');
    for (const [method, partialToken, skillName] of [
      ['click', '$qa-web', fixture.skills[0]?.name ?? 'qa-web-artifacts-builder'],
      ['enter', '$qa-research', fixture.skills[1]?.name ?? 'qa-research-pack']
    ] as const) {
      await resetComposer(window!);
      await selectSlashCommand(window!, 'review');
      await composer.fill('Audit the current renderer flow.\n\n');
      const insertedToken = await appendSkillMention(window!, partialToken, skillName, method);
      await expect(composer).toHaveValue(new RegExp(`\\${insertedToken}`));

      await window!.getByTestId('composer-submit-button').click();
      const nextValue = await composer.inputValue();
      expect(nextValue).toContain(insertedToken);

      await composer.focus();
      await composer.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      const selectionState = await window!.evaluate(() => {
        const textarea = document.querySelector('[data-testid="composer-input"]');
        if (!(textarea instanceof HTMLTextAreaElement)) {
          return null;
        }
        return {
          valueLength: textarea.value.length,
          selectionStart: textarea.selectionStart,
          selectionEnd: textarea.selectionEnd
        };
      });
      expect(selectionState).not.toBeNull();
      expect(selectionState?.selectionStart).toBe(0);
      expect(selectionState?.selectionEnd).toBe(selectionState?.valueLength);
    }
  });

  test('composer actions attach images through the hidden picker and keep placeholder copy out of the menu', async () => {
    test.skip(!window);

    await resetComposer(window!);
    await window!.locator('.composer-attach-button').click();
    await expect(window!.locator('.composer-attach-menu').getByText('Add images')).toBeVisible();
    await expect(window!.getByText('Attachments are planned but not wired yet.')).toHaveCount(0);
    await expect(window!.locator('.composer-attach-menu').getByText('Speed')).toHaveCount(0);

    const imagePath = join(workspaceDir, 'composer-attachment.png');
    writeFileSync(
      imagePath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z1ioAAAAASUVORK5CYII=',
        'base64'
      )
    );

    await window!.locator('input[type="file"]').setInputFiles(imagePath);
    await expect(window!.locator('.composer-image-chip')).toContainText('composer-attachment.png');
  });

  test('blocked provider actions from the model picker open Settings > Providers', async () => {
    test.skip(!window);

    await window!.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window!);
    await expect(window!.getByTestId('composer-model-select')).toBeVisible();
    await window!.getByTestId('composer-model-select').click();
    const blockedProviderAction = window!
      .getByRole('menuitem')
      .filter({ hasText: /Set up .* in Settings/i })
      .first();
    test.skip((await blockedProviderAction.count()) === 0, 'No blocked provider currently routes through Settings > Providers.');
    await expect(blockedProviderAction).toBeVisible();
    await blockedProviderAction.click();
    await expect(window!.getByRole('heading', { name: 'Providers' })).toBeVisible();
  });

  test('Custom API model sends a normal prompt with Enter and starts a run', async () => {
    test.skip(!window);
    test.skip(!fixture.customApiReady || !fixture.customModelId, 'Custom API model must be configured for Enter-send validation.');

    await window!.evaluate(async ({ threadId }) => {
      if (!threadId) {
        throw new Error('Expected a thread id.');
      }
      await window.vicode.planner.setMode({ threadId, mode: 'default' });
    }, { threadId: fixture.threadId }).catch(() => {});

    await window!.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window!);
    await setDefaultComposerModel(window!, 'openai_compatible', fixture.customModelId!);
    await window!.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window!);

    await resetComposer(window!);
    const composer = window!.getByTestId('composer-input');
    await composer.fill('Reply with exactly: composer enter send passed.');
    await composer.press('Enter');

    await expect(composer).toHaveValue('', { timeout: 30_000 });
    await expect
      .poll(async () => {
        const detail = await pollThread(window!, fixture.threadId!);
        return detail.turns.some((turn) => turn.role === 'assistant');
      }, { timeout: 60_000 })
      .toBe(true);
  });

  test('plan-mode enhance flow enhances first, then second Enter sends', async () => {
    test.skip(!window);
    const plannerThreadId = await createOllamaPlannerThread(window!, fixture.projectId);
    test.skip(!plannerThreadId, 'Ollama planner provider must be available for plan-mode enhance validation.');
    await window!.evaluate(async ({ threadId }) => {
      if (!threadId) {
        throw new Error('Expected a thread id.');
      }
      await window.vicode.planner.setMode({ threadId, mode: 'plan' });
    }, { threadId: plannerThreadId });

    await window!.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window!);
    await installEnhancePromptStub(window!);

    try {
      const composer = window!.getByTestId('composer-input');
      await composer.click();
      await composer.pressSequentially('/enhance');
      await composer.press('Enter');
      await expect(window!.locator('.composer-command-chip')).toContainText('/enhance');

      await composer.fill('Create a concise 3-step plan for a premium landing page.\n\n');
      const insertedToken = await appendSkillMention(window!, '$qa-web', fixture.skills[0]?.name ?? 'qa-web-artifacts-builder', 'enter');
      const promptBeforeEnhance = await composer.inputValue();

      await composer.press('Enter');
      await expect(window!.locator('.composer-command-chip')).toHaveCount(0, { timeout: 15_000 });
      await expect
        .poll(async () => await composer.inputValue(), { timeout: 15_000 })
        .not.toBe(promptBeforeEnhance);

      const enhancedPrompt = await composer.inputValue();
      expect(enhancedPrompt).toContain(insertedToken);
      expect(enhancedPrompt.trim()).not.toBe(promptBeforeEnhance.trim());
      const userTurnCountBeforeSend = (await pollThread(window!, plannerThreadId)).turns.filter((turn) => turn.role === 'user').length;

      await composer.press('Enter');
      await expect(composer).toHaveValue('', { timeout: 30_000 });
      await expect
        .poll(async () => {
          const detail = await pollThread(window!, plannerThreadId);
          return detail.turns.filter((turn) => turn.role === 'user').length;
        }, { timeout: 60_000 })
        .toBeGreaterThan(userTurnCountBeforeSend);
    } finally {
      await restoreEnhancePromptStub(window!);
    }
  });

  test('enhance shows a visible in-flight button state while rewriting', async () => {
    test.skip(!window);
    const threadId = await createOllamaPlannerThread(window!, fixture.projectId);
    test.skip(!threadId, 'Ollama planner provider must be available for plan-mode enhance validation.');

    await window!.evaluate(async ({ threadId }) => {
      await window.vicode.planner.setMode({ threadId, mode: 'plan' });
    }, { threadId });

    await window!.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window!);
    await expect(window!.getByLabel('Vicode is loading')).toHaveCount(0, { timeout: 30_000 });
    await installEnhancePromptStub(window!, 900);

    try {
      await resetComposer(window!);
      await selectSlashCommand(window!, 'enhance');
      const composer = window!.getByTestId('composer-input');
      const submitButton = window!.getByTestId('composer-submit-button');
      const rawPrompt = 'Rewrite this into a tighter premium plan prompt.';

      await composer.fill(rawPrompt);

      await submitButton.click();
      await expect
        .poll(async () => {
          return await window!.evaluate(() => {
            const enhanceStatus = document.querySelector('[data-testid="composer-enhance-status"]');
            const button = document.querySelector('[data-testid="composer-submit-button"]');
            const indicator = document.querySelector('.composer-send-enhance-indicator');
            return {
              statusVisible: Boolean(enhanceStatus),
              buttonClassName: button instanceof HTMLElement ? button.className : '',
              busyState: button instanceof HTMLElement ? button.getAttribute('aria-busy') : null,
              indicatorVisible: Boolean(indicator)
            };
          });
        }, { timeout: 5_000 })
        .toMatchObject({
          statusVisible: true,
          busyState: 'true',
          indicatorVisible: true
        });

      await expect(submitButton).toHaveClass(/is-enhancing/, { timeout: 5_000 });
    } finally {
      await restoreEnhancePromptStub(window!);
    }
  });
});
