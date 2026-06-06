import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { encodeCustomProviderModelId } from '../src/shared/custom-provider-routing';
import { closeApp, launchApp, waitForBridge } from './helpers/electron';
import { expectNoVisibleRunFailures } from './helpers/run-failure-diagnostics';

const ORIGINAL_NOTES = [
  '# Harness Notes',
  '',
  '- baseline review text'
].join('\n');
const APPLIED_NOTES = [
  '# Harness Notes',
  '',
  '- patch buffer proposal applied through review'
].join('\n');
const REJECTED_NOTES = [
  '# Harness Notes',
  '',
  '- patch buffer proposal that should be rejected'
].join('\n');
const ORIGINAL_SOURCE = [
  'export function harnessMode() {',
  "  return 'direct source baseline';",
  '}'
].join('\n');
const UPDATED_SOURCE = [
  'export function harnessMode() {',
  "  return 'patch buffer reviewed source';",
  '}'
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

async function startScriptedProvider(responses: ScriptedResponse[]) {
  const requests: string[] = [];
  let responseIndex = 0;

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    requests.push(await readRequestBody(request));
    const scripted = responses[Math.min(responseIndex, responses.length - 1)] ?? {};
    responseIndex += 1;

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
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    })
  };
}

async function createProjectAndThread(window: Page, workspaceDir: string, baseUrl: string) {
  const setup = await window.evaluate(async ({ workspaceDir, baseUrl }) => {
    const customProvider = await window.vicode.providers.saveCustom({
      name: 'Patch Buffer Real App Validation',
      transportKind: 'openai_compatible_chat',
      baseUrl,
      apiKey: 'patch-buffer-validation-secret',
      defaultModelId: 'patch-buffer-validation-model',
      enabled: true
    });
    const project = await window.vicode.projects.create({
      name: `Patch buffer validation ${Date.now()}`,
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
    modelId: 'patch-buffer-validation-model'
  });

  const thread = await window.evaluate(async ({ projectId, modelId }) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    const created = await window.vicode.threads.create({
      projectId,
      providerId: 'openai_compatible',
      modelId,
      executionPermission: 'default'
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

async function submitPatchBufferTurn(
  window: Page,
  input: {
    projectId: string;
    threadId: string;
    modelId: string;
    prompt: string;
  }
) {
  const result = await window.evaluate(
    async ({ projectId, threadId, modelId, prompt }) =>
      window.vicode.composer.submit({
        projectId,
        threadId,
        prompt,
        providerId: 'openai_compatible',
        modelId,
        executionPermission: 'default',
        isolationMode: 'patch_buffer',
        skillIds: [],
        imageAttachments: []
      }),
    input
  );
  expect(result.disposition).toBe('started');
  if (result.disposition !== 'started') {
    throw new Error('Expected patch-buffer validation run to start immediately.');
  }
  return result.runId;
}

async function waitForRunCompleted(window: Page, threadId: string, runId: string) {
  await expect.poll(async () => {
    const detail = await window.evaluate(async (threadId) => window.vicode.threads.open(threadId), threadId);
    const runEvents = detail.rawOutput.filter((event) => event.runId === runId);
    if (runEvents.some((event) => event.eventType === 'failed')) {
      return 'failed';
    }
    if (runEvents.some((event) => event.eventType === 'completed')) {
      return 'completed';
    }
    return detail.status;
  }, { timeout: 60_000 }).toBe('completed');
}

async function latestStagedChange(window: Page, threadId: string, runId: string) {
  const staged = await window.evaluate(async ({ threadId, runId }) => {
    const detail = await window.vicode.threads.open(threadId);
    const stagedEvents = detail.rawOutput.filter((event) =>
      event.runId === runId
      && event.eventType === 'info'
      && Boolean(event.payload.stagedWorkspaceChangeSet)
    );
    const event = stagedEvents.at(-1);
    if (!event) {
      return null;
    }
    return {
      threadId: event.threadId,
      runId: event.runId,
      stagedEventId: event.id
    };
  }, { threadId, runId });

  if (!staged) {
    throw new Error(`No staged workspace change was recorded for run ${runId}.`);
  }
  return staged;
}

function parseProviderRequests(requests: string[]) {
  return requests.map((request) => JSON.parse(request) as { messages?: Array<{ role?: string; content?: unknown }> });
}

function toolResultText(requests: Array<{ messages?: Array<{ role?: string; content?: unknown }> }>) {
  return requests.flatMap((request) =>
    request.messages
      ?.filter((message) => message.role === 'tool')
      .map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content))
      ?? []
  ).join('\n');
}

test('patch_buffer keeps workspace unchanged until review apply and supports revert and reject', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-patch-buffer-validation-'));
  const notesPath = path.join(workspaceDir, 'notes.md');
  await writeFile(notesPath, ORIGINAL_NOTES, 'utf8');

  const provider = await startScriptedProvider([
    {
      toolCalls: [
        toolCall('write_file', {
          path: 'notes.md',
          content: APPLIED_NOTES
        }, 1)
      ]
    },
    {
      content: 'Prepared the notes.md patch-buffer proposal for review.'
    },
    {
      toolCalls: [
        toolCall('write_file', {
          path: 'notes.md',
          content: REJECTED_NOTES
        }, 2)
      ]
    },
    {
      content: 'Prepared a second notes.md patch-buffer proposal for review.'
    }
  ]);

  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.providers', 'vicode.composer', 'vicode.runs']
  });
  let projectId: string | null = null;

  try {
    const setup = await createProjectAndThread(window, workspaceDir, provider.baseUrl);
    projectId = setup.projectId;

    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.providers', 'vicode.composer', 'vicode.runs']);

    const applyRunId = await submitPatchBufferTurn(window, {
      projectId: setup.projectId,
      threadId: setup.threadId,
      modelId: setup.modelId,
      prompt: 'Propose a small edit to notes.md without directly changing my active workspace.'
    });
    await waitForRunCompleted(window, setup.threadId, applyRunId);
    await expectNoVisibleRunFailures(window, testInfo, {
      label: 'patch buffer proposal before apply',
      threadId: setup.threadId,
      workspaceDir
    });

    await expect.poll(async () => readFile(notesPath, 'utf8'), { timeout: 10_000 }).toBe(ORIGINAL_NOTES);
    await expect(window.getByTestId('run-staged-workspace-card').last()).toContainText('Proposed workspace changes');
    await expect(window.getByTestId('run-staged-workspace-card').last()).toContainText('notes.md');

    const applyInput = await latestStagedChange(window, setup.threadId, applyRunId);
    const preview = await window.evaluate(
      async (input) => window.vicode.runs.previewStagedWorkspaceChange(input),
      applyInput
    );
    expect(preview.source).toBe('staged_workspace_preview');
    expect(preview.files).toHaveLength(1);
    expect(preview.files[0]?.path).toBe('notes.md');
    expect(preview.files[0]?.beforeContent).toBe(ORIGINAL_NOTES);
    expect(preview.files[0]?.afterContent).toBe(APPLIED_NOTES);

    const applyResult = await window.evaluate(
      async (input) => window.vicode.runs.applyStagedWorkspaceChange(input),
      applyInput
    );
    expect(applyResult.decision.status).toBe('applied');
    await expect.poll(async () => readFile(notesPath, 'utf8'), { timeout: 10_000 }).toBe(APPLIED_NOTES);

    const revertResult = await window.evaluate(
      async (input) => window.vicode.runs.revertStagedWorkspaceChange(input),
      applyInput
    );
    expect(revertResult.decision.status).toBe('reverted');
    await expect.poll(async () => readFile(notesPath, 'utf8'), { timeout: 10_000 }).toBe(ORIGINAL_NOTES);

    const rejectRunId = await submitPatchBufferTurn(window, {
      projectId: setup.projectId,
      threadId: setup.threadId,
      modelId: setup.modelId,
      prompt: 'Propose another notes.md edit, but keep it staged until I decide.'
    });
    await waitForRunCompleted(window, setup.threadId, rejectRunId);
    await expectNoVisibleRunFailures(window, testInfo, {
      label: 'patch buffer proposal before reject',
      threadId: setup.threadId,
      workspaceDir
    });
    await expect.poll(async () => readFile(notesPath, 'utf8'), { timeout: 10_000 }).toBe(ORIGINAL_NOTES);

    const rejectInput = await latestStagedChange(window, setup.threadId, rejectRunId);
    const rejectResult = await window.evaluate(
      async (input) => window.vicode.runs.rejectStagedWorkspaceChange(input),
      rejectInput
    );
    expect(rejectResult.decision.status).toBe('rejected');
    await expect.poll(async () => readFile(notesPath, 'utf8'), { timeout: 10_000 }).toBe(ORIGINAL_NOTES);

    const parsedRequests = parseProviderRequests(provider.requests);
    expect(toolResultText(parsedRequests)).toContain('Staged write_file notes.md');
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

test('patch_buffer validates source-file apply and revert without direct workspace mutation', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-patch-buffer-source-validation-'));
  const sourcePath = path.join(workspaceDir, 'src', 'app.ts');
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, ORIGINAL_SOURCE, 'utf8');

  const provider = await startScriptedProvider([
    {
      toolCalls: [
        toolCall('write_file', {
          path: 'src/app.ts',
          content: UPDATED_SOURCE
        }, 1)
      ]
    },
    {
      content: 'Prepared the src/app.ts patch-buffer proposal for review.'
    }
  ]);

  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.providers', 'vicode.composer', 'vicode.runs']
  });
  let projectId: string | null = null;

  try {
    const setup = await createProjectAndThread(window, workspaceDir, provider.baseUrl);
    projectId = setup.projectId;

    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.providers', 'vicode.composer', 'vicode.runs']);

    const runId = await submitPatchBufferTurn(window, {
      projectId: setup.projectId,
      threadId: setup.threadId,
      modelId: setup.modelId,
      prompt: 'Propose a small TypeScript source edit in src/app.ts, but do not change the active workspace until review.'
    });
    await waitForRunCompleted(window, setup.threadId, runId);
    await expectNoVisibleRunFailures(window, testInfo, {
      label: 'patch buffer source proposal before apply',
      threadId: setup.threadId,
      workspaceDir
    });

    await expect.poll(async () => readFile(sourcePath, 'utf8'), { timeout: 10_000 }).toBe(ORIGINAL_SOURCE);
    await expect(window.getByTestId('run-staged-workspace-card').last()).toContainText('Proposed workspace changes');
    await expect(window.getByTestId('run-staged-workspace-card').last()).toContainText('src/app.ts');

    const reviewInput = await latestStagedChange(window, setup.threadId, runId);
    const preview = await window.evaluate(
      async (input) => window.vicode.runs.previewStagedWorkspaceChange(input),
      reviewInput
    );
    expect(preview.source).toBe('staged_workspace_preview');
    expect(preview.files).toHaveLength(1);
    expect(preview.files[0]?.path).toBe('src/app.ts');
    expect(preview.files[0]?.beforeContent).toBe(ORIGINAL_SOURCE);
    expect(preview.files[0]?.afterContent).toBe(UPDATED_SOURCE);

    const applyResult = await window.evaluate(
      async (input) => window.vicode.runs.applyStagedWorkspaceChange(input),
      reviewInput
    );
    expect(applyResult.decision.status).toBe('applied');
    await expect.poll(async () => readFile(sourcePath, 'utf8'), { timeout: 10_000 }).toBe(UPDATED_SOURCE);

    const revertResult = await window.evaluate(
      async (input) => window.vicode.runs.revertStagedWorkspaceChange(input),
      reviewInput
    );
    expect(revertResult.decision.status).toBe('reverted');
    await expect.poll(async () => readFile(sourcePath, 'utf8'), { timeout: 10_000 }).toBe(ORIGINAL_SOURCE);
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
