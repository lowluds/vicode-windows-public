import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  closeApp,
  launchApp,
  type LaunchStatePaths
} from './helpers/electron';
import {
  encodeOllamaLocalModelId,
  isOllamaLocalModelId,
  selectPreferredOllamaModel
} from '../src/shared/providers';

const workspaceRoot = path.join(process.cwd(), 'test', '.e2e-workspaces', 'ollama-first-run');

async function restartWithState(statePaths: LaunchStatePaths) {
  return await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.providers', 'vicode.settings'],
    statePaths
  });
}

async function waitForThreadCompletion(window: Page, threadId: string, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  let lastDetail: Awaited<ReturnType<Page['evaluate']>> | null = null;
  while (Date.now() < deadline) {
    const detail = await window.evaluate(async ({ threadId }) => window.vicode.threads.open(threadId), { threadId });
    lastDetail = detail;
    if (detail.status === 'completed' && detail.turns.some((turn) => turn.role === 'assistant' && turn.content.trim().length > 0)) {
      return detail;
    }
    if (detail.status === 'failed') {
      throw new Error(`Thread ${threadId} failed. Last events: ${JSON.stringify(detail.rawOutput?.slice(-8) ?? [])}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `Timed out waiting for thread ${threadId} to complete. Last status: ${lastDetail?.status ?? 'unknown'}. Last events: ${JSON.stringify(lastDetail?.rawOutput?.slice(-5) ?? [])}`
  );
}

test.beforeAll(async () => {
  await mkdir(workspaceRoot, { recursive: true });
});

test.afterAll(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

test('local Ollama first-run setup persists provider, local model, trusted project, and thread after relaunch', async () => {
  const initial = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.providers', 'vicode.settings']
  });
  const cleanupState = initial.cleanupState;
  const statePaths = initial.statePaths;
  let initialClosed = false;

  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `local-${suffix}`);
    await mkdir(projectPath, { recursive: true });

    const provider = await initial.window.evaluate(async () => window.vicode.providers.refresh('ollama'));
    test.skip(provider.authState !== 'connected', 'Local Ollama must be connected for first-run setup proof.');

    const localModels = provider.models.filter((model) => provider.authMode !== 'api_key' || isOllamaLocalModelId(model.id));
    const selectedModel = selectPreferredOllamaModel(localModels);
    test.skip(!selectedModel, 'Local Ollama must expose at least one local model for first-run setup proof.');

    const seeded = await initial.window.evaluate(
      async ({ projectName, projectPath, modelId }) => {
        const bootstrap = await window.vicode.app.getBootstrap();
        const createdProject = await window.vicode.projects.create({
          name: projectName,
          folderPath: projectPath,
          trusted: true
        });
        const project = await window.vicode.projects.update({
          id: createdProject.id,
          defaultProviderId: 'ollama',
          defaultModelId: modelId
        });
        const thread = await window.vicode.threads.create({
          projectId: project.id,
          providerId: 'ollama',
          modelId,
          executionPermission: 'default'
        });

        await window.vicode.settings.save({
          onboardingComplete: true,
          selectedProjectId: project.id,
          lastOpenedThreadId: thread.id,
          defaultProviderId: 'ollama',
          defaultModelByProvider: {
            ...bootstrap.preferences.defaultModelByProvider,
            ollama: modelId
          }
        });

        return {
          projectId: project.id,
          threadId: thread.id,
          threadTitle: thread.title
        };
      },
      {
        projectName: `Local Ollama first run ${suffix}`,
        projectPath,
        modelId: selectedModel!.id
      }
    );

    await closeApp(initial.app, { cleanupState: false });
    initialClosed = true;

    const relaunched = await restartWithState(statePaths);
    try {
      await expect(relaunched.window.locator('.windows-titlebar-context-thread')).toHaveText(seeded.threadTitle, {
        timeout: 30_000
      });

      const persisted = await relaunched.window.evaluate(async ({ projectId, threadId }) => {
        const bootstrap = await window.vicode.app.getBootstrap();
        const project = bootstrap.projects.find((entry) => entry.id === projectId) ?? null;
        const provider = bootstrap.providers.find((entry) => entry.id === 'ollama') ?? null;
        const thread = await window.vicode.threads.open(threadId);

        return {
          preferences: bootstrap.preferences,
          project,
          provider: provider
            ? {
                authState: provider.authState,
                authMode: provider.authMode,
                localModelIds: provider.models
                  .map((model) => model.id)
                  .filter((modelId) => provider.authMode !== 'api_key' || modelId.startsWith('local:'))
              }
            : null,
          thread
        };
      }, seeded);

      expect(persisted.provider?.authState).toBe('connected');
      expect(persisted.provider?.authMode !== 'api_key' || isOllamaLocalModelId(selectedModel!.id)).toBe(true);
      expect(persisted.provider?.localModelIds).toContain(selectedModel!.id);
      expect(persisted.preferences.selectedProjectId).toBe(seeded.projectId);
      expect(persisted.preferences.lastOpenedThreadId).toBe(seeded.threadId);
      expect(persisted.preferences.defaultProviderId).toBe('ollama');
      expect(persisted.preferences.defaultModelByProvider.ollama).toBe(selectedModel!.id);
      expect(persisted.project?.trusted).toBe(true);
      expect(persisted.project?.defaultProviderId).toBe('ollama');
      expect(persisted.project?.defaultModelByProvider.ollama).toBe(selectedModel!.id);
      expect(persisted.thread.providerId).toBe('ollama');
      expect(persisted.thread.modelId).toBe(selectedModel!.id);
      expect(persisted.thread.executionPermission).toBe('default');
    } finally {
      await closeApp(relaunched.app);
    }
  } finally {
    if (!initialClosed) {
      await closeApp(initial.app, { cleanupState: false }).catch(() => undefined);
    }
    cleanupState();
  }
});

test('local Ollama first-run execution writes a file through the app harness', async () => {
  test.skip(
    process.env.VICODE_RUN_LOCAL_OLLAMA_FIRST_RUN_EXECUTION !== '1',
    'Set VICODE_RUN_LOCAL_OLLAMA_FIRST_RUN_EXECUTION=1 to run local Ollama first-run execution proof.'
  );
  test.setTimeout(360_000);

  const initial = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.providers', 'vicode.settings', 'vicode.composer']
  });
  const cleanupState = initial.cleanupState;

  try {
    const requestedModelId = process.env.VICODE_LOCAL_OLLAMA_FIRST_RUN_MODEL?.trim() || 'qwen2.5-coder:14b-instruct-q6_K';
    const requestedLocalModelId = encodeOllamaLocalModelId(requestedModelId);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `local-execution-${suffix}`);
    const proofPath = path.join(projectPath, 'local-ollama-first-run-proof.txt');
    await mkdir(projectPath, { recursive: true });

    const provider = await initial.window.evaluate(async () => window.vicode.providers.refresh('ollama'));
    test.skip(provider.authState !== 'connected', 'Local Ollama must be connected for first-run execution proof.');

    const localModels = provider.models.filter((model) => provider.authMode !== 'api_key' || isOllamaLocalModelId(model.id));
    const selectedModel =
      localModels.find((model) => model.id === requestedModelId || model.id === requestedLocalModelId)
      ?? null;
    test.skip(!selectedModel, `Local Ollama must expose requested model ${requestedModelId}.`);

    const seeded = await initial.window.evaluate(
      async ({ projectName, projectPath, modelId }) => {
        const bootstrap = await window.vicode.app.getBootstrap();
        const createdProject = await window.vicode.projects.create({
          name: projectName,
          folderPath: projectPath,
          trusted: true
        });
        const project = await window.vicode.projects.update({
          id: createdProject.id,
          defaultProviderId: 'ollama',
          defaultModelId: modelId
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
          }
        });

        return {
          projectId: project.id,
          threadId: thread.id,
          threadTitle: thread.title
        };
      },
      {
        projectName: `Local Ollama first-run execution ${suffix}`,
        projectPath,
        modelId: selectedModel!.id
      }
    );

    const submitted = await initial.window.evaluate(
      async ({ projectId, threadId, modelId }) =>
        window.vicode.composer.submit({
          projectId,
          threadId,
          providerId: 'ollama',
          modelId,
          prompt: [
            'Create a file named local-ollama-first-run-proof.txt in this project.',
            'The entire file contents must be exactly: LOCAL_OLLAMA_FIRST_RUN_EXECUTION_OK',
            'Your first assistant action must be exactly one executable write_file tool call and no prose.',
            'Use this exact JSON tool-call envelope:',
            '{"name":"write_file","arguments":{"path":"local-ollama-first-run-proof.txt","content":"LOCAL_OLLAMA_FIRST_RUN_EXECUTION_OK"}}',
            'Do not create any other files.',
            'After writing the file, reply exactly: LOCAL_OLLAMA_FIRST_RUN_EXECUTION_OK'
          ].join('\n'),
          executionPermission: 'full_access',
          skillIds: []
        }),
      {
        projectId: seeded.projectId,
        threadId: seeded.threadId,
        modelId: selectedModel!.id
      }
    );
    expect(submitted.disposition).toBe('started');
    expect(submitted.runId?.length ?? 0).toBeGreaterThan(0);

    const completed = await waitForThreadCompletion(initial.window, seeded.threadId, 300_000);
    expect(completed.status).toBe('completed');
    expect(completed.providerId).toBe('ollama');
    expect(completed.modelId).toBe(selectedModel!.id);
    expect(JSON.stringify(completed.rawOutput ?? [])).toContain('write_file');
    await expect.poll(async () => (await readFile(proofPath, 'utf8')).trim(), { timeout: 30_000 }).toBe('LOCAL_OLLAMA_FIRST_RUN_EXECUTION_OK');
    expect(completed.turns.some((turn) => turn.role === 'assistant' && turn.content.trim().length > 0)).toBe(true);
  } finally {
    await closeApp(initial.app, { cleanupState: false }).catch(() => undefined);
    cleanupState();
  }
});

test('local Ollama first-run execution restores completed thread after relaunch', async () => {
  test.skip(
    process.env.VICODE_RUN_LOCAL_OLLAMA_FIRST_RUN_RELAUNCH !== '1',
    'Set VICODE_RUN_LOCAL_OLLAMA_FIRST_RUN_RELAUNCH=1 to run local Ollama post-run relaunch proof.'
  );
  test.setTimeout(420_000);

  const initial = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.providers', 'vicode.settings', 'vicode.composer']
  });
  const cleanupState = initial.cleanupState;
  const statePaths = initial.statePaths;
  let initialClosed = false;

  try {
    const requestedModelId = process.env.VICODE_LOCAL_OLLAMA_FIRST_RUN_MODEL?.trim() || 'qwen2.5-coder:14b-instruct-q6_K';
    const requestedLocalModelId = encodeOllamaLocalModelId(requestedModelId);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `local-relaunch-${suffix}`);
    const proofPath = path.join(projectPath, 'local-ollama-first-run-proof.txt');
    await mkdir(projectPath, { recursive: true });

    const provider = await initial.window.evaluate(async () => window.vicode.providers.refresh('ollama'));
    test.skip(provider.authState !== 'connected', 'Local Ollama must be connected for first-run relaunch proof.');

    const localModels = provider.models.filter((model) => provider.authMode !== 'api_key' || isOllamaLocalModelId(model.id));
    const selectedModel =
      localModels.find((model) => model.id === requestedModelId || model.id === requestedLocalModelId)
      ?? null;
    test.skip(!selectedModel, `Local Ollama must expose requested model ${requestedModelId}.`);

    const seeded = await initial.window.evaluate(
      async ({ projectName, projectPath, modelId }) => {
        const bootstrap = await window.vicode.app.getBootstrap();
        const createdProject = await window.vicode.projects.create({
          name: projectName,
          folderPath: projectPath,
          trusted: true
        });
        const project = await window.vicode.projects.update({
          id: createdProject.id,
          defaultProviderId: 'ollama',
          defaultModelId: modelId
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
          }
        });

        return {
          projectId: project.id,
          threadId: thread.id,
          threadTitle: thread.title
        };
      },
      {
        projectName: `Local Ollama first-run relaunch ${suffix}`,
        projectPath,
        modelId: selectedModel!.id
      }
    );

    const submitted = await initial.window.evaluate(
      async ({ projectId, threadId, modelId }) =>
        window.vicode.composer.submit({
          projectId,
          threadId,
          providerId: 'ollama',
          modelId,
          prompt: [
            'Create a file named local-ollama-first-run-proof.txt in this project.',
            'The entire file contents must be exactly: LOCAL_OLLAMA_FIRST_RUN_EXECUTION_OK',
            'Your first assistant action must be exactly one executable write_file tool call and no prose.',
            'Use this exact JSON tool-call envelope:',
            '{"name":"write_file","arguments":{"path":"local-ollama-first-run-proof.txt","content":"LOCAL_OLLAMA_FIRST_RUN_EXECUTION_OK"}}',
            'Do not create any other files.',
            'After writing the file, reply exactly: LOCAL_OLLAMA_FIRST_RUN_EXECUTION_OK'
          ].join('\n'),
          executionPermission: 'full_access',
          skillIds: []
        }),
      {
        projectId: seeded.projectId,
        threadId: seeded.threadId,
        modelId: selectedModel!.id
      }
    );
    expect(submitted.disposition).toBe('started');
    expect(submitted.runId?.length ?? 0).toBeGreaterThan(0);

    const completed = await waitForThreadCompletion(initial.window, seeded.threadId, 300_000);
    expect(completed.status).toBe('completed');
    expect(completed.providerId).toBe('ollama');
    expect(completed.modelId).toBe(selectedModel!.id);
    expect(JSON.stringify(completed.rawOutput ?? [])).toContain('write_file');
    await expect.poll(async () => (await readFile(proofPath, 'utf8')).trim(), { timeout: 30_000 }).toBe('LOCAL_OLLAMA_FIRST_RUN_EXECUTION_OK');

    await closeApp(initial.app, { cleanupState: false });
    initialClosed = true;

    const relaunched = await restartWithState(statePaths);
    try {
      const relaunchedState = await relaunched.window.evaluate(async ({ projectId, threadId }) => {
        const bootstrap = await window.vicode.app.getBootstrap();
        const project = bootstrap.projects.find((entry) => entry.id === projectId) ?? null;
        const thread = await window.vicode.threads.open(threadId);
        const titlebarThreadText = document.querySelector('.windows-titlebar-context-thread')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

        return {
          preferences: bootstrap.preferences,
          project,
          thread,
          titlebarThreadText
        };
      }, seeded);

      expect(relaunchedState.preferences.selectedProjectId).toBe(seeded.projectId);
      expect(relaunchedState.preferences.lastOpenedThreadId).toBe(seeded.threadId);
      expect(relaunchedState.project?.trusted).toBe(true);
      expect(relaunchedState.thread.status).toBe('completed');
      expect(relaunchedState.thread.providerId).toBe('ollama');
      expect(relaunchedState.thread.modelId).toBe(selectedModel!.id);
      expect(JSON.stringify(relaunchedState.thread.rawOutput ?? [])).toContain('write_file');
      expect(relaunchedState.titlebarThreadText).toBe(relaunchedState.thread.title);
      await expect(relaunched.window.locator('.windows-titlebar-context-thread')).toHaveText(
        relaunchedState.thread.title,
        { timeout: 30_000 }
      );
      await expect.poll(async () => (await readFile(proofPath, 'utf8')).trim(), { timeout: 30_000 }).toBe('LOCAL_OLLAMA_FIRST_RUN_EXECUTION_OK');
    } finally {
      await closeApp(relaunched.app);
    }
  } finally {
    if (!initialClosed) {
      await closeApp(initial.app, { cleanupState: false }).catch(() => undefined);
    }
    cleanupState();
  }
});
