import { execFileSync } from 'node:child_process';
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

const ORIGINAL_SOURCE = [
  'export function harnessLabel() {',
  "  return 'original worktree source';",
  '}'
].join('\n');
const UPDATED_SOURCE = [
  'export function harnessLabel() {',
  "  return 'reviewed worktree source';",
  '}'
].join('\n');

function normalizeLineEndings(value: unknown) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n') : value;
}

interface ScriptedResponse {
  content?: string;
  toolCalls?: Array<ReturnType<typeof toolCall>>;
}

function runGit(cwd: string, args: string[]) {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    windowsHide: true
  });
}

async function seedGitWorkspace(workspaceDir: string) {
  await mkdir(path.join(workspaceDir, 'src'), { recursive: true });
  await writeFile(path.join(workspaceDir, 'src', 'app.ts'), ORIGINAL_SOURCE, 'utf8');
  runGit(workspaceDir, ['init']);
  runGit(workspaceDir, ['config', 'core.autocrlf', 'false']);
  runGit(workspaceDir, ['config', 'core.eol', 'lf']);
  runGit(workspaceDir, ['config', 'user.email', 'vicode-e2e@example.invalid']);
  runGit(workspaceDir, ['config', 'user.name', 'Vicode E2E']);
  runGit(workspaceDir, ['add', 'src/app.ts']);
  runGit(workspaceDir, ['commit', '-m', 'seed source workspace']);
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
  let responseIndex = 0;
  const requests: string[] = [];

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
      name: 'Git Worktree Real App Validation',
      transportKind: 'openai_compatible_chat',
      baseUrl,
      apiKey: 'git-worktree-validation-secret',
      defaultModelId: 'git-worktree-validation-model',
      enabled: true
    });
    const project = await window.vicode.projects.create({
      name: `Git worktree validation ${Date.now()}`,
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
    modelId: 'git-worktree-validation-model'
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

async function submitWorktreeTurn(
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
        isolationMode: 'git_worktree',
        skillIds: [],
        imageAttachments: []
      }),
    input
  );
  expect(result.disposition).toBe('started');
  if (result.disposition !== 'started') {
    throw new Error('Expected git_worktree validation run to start immediately.');
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

async function latestWorktreeArtifactSummary(window: Page, threadId: string, runId: string) {
  const artifact = await window.evaluate(async ({ threadId, runId }) => {
    const detail = await window.vicode.threads.open(threadId);
    for (const event of detail.rawOutput) {
      if (event.runId !== runId || event.eventType !== 'info') {
        continue;
      }
      const activity = event.payload.activity;
      if (!activity || typeof activity !== 'object' || Array.isArray(activity)) {
        continue;
      }
      const changeArtifact = (activity as { changeArtifact?: unknown }).changeArtifact;
      if (!changeArtifact || typeof changeArtifact !== 'object' || Array.isArray(changeArtifact)) {
        continue;
      }
      const artifact = changeArtifact as {
        source?: unknown;
        summary?: { filesChanged?: unknown; insertions?: unknown; deletions?: unknown };
        files?: Array<{ path?: unknown; beforeContent?: unknown; afterContent?: unknown }>;
      };
      if (artifact.source === 'worktree_diff') {
        return {
          source: artifact.source,
          filesChanged: artifact.summary?.filesChanged,
          insertions: artifact.summary?.insertions,
          deletions: artifact.summary?.deletions,
          firstPath: artifact.files?.[0]?.path,
          beforeContent: artifact.files?.[0]?.beforeContent,
          afterContent: artifact.files?.[0]?.afterContent
        };
      }
    }
    return null;
  }, { threadId, runId });

  if (!artifact) {
    throw new Error(`No worktree_diff artifact was recorded for run ${runId}.`);
  }
  return artifact;
}

test('git_worktree keeps source checkout unchanged until review apply and supports revert and cleanup', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-git-worktree-validation-'));
  const sourcePath = path.join(workspaceDir, 'src', 'app.ts');
  await seedGitWorkspace(workspaceDir);

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
      content: 'Wrote the source edit inside the app-owned Git worktree for review.'
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

    const runId = await submitWorktreeTurn(window, {
      projectId: setup.projectId,
      threadId: setup.threadId,
      modelId: setup.modelId,
      prompt: 'Use Isolated worktree mode to update src/app.ts. Keep my source checkout unchanged until I apply the review.'
    });
    await waitForRunCompleted(window, setup.threadId, runId);
    await expectNoVisibleRunFailures(window, testInfo, {
      label: 'git worktree proposal before apply',
      threadId: setup.threadId,
      workspaceDir
    });

    await expect.poll(async () => readFile(sourcePath, 'utf8'), { timeout: 10_000 }).toBe(ORIGINAL_SOURCE);
    await expect(window.getByTestId('run-worktree-review-card').last()).toContainText('Worktree workspace changes');
    await expect(window.getByTestId('run-worktree-review-card').last()).toContainText('src/app.ts');

    const artifact = await latestWorktreeArtifactSummary(window, setup.threadId, runId);
    expect(artifact.source).toBe('worktree_diff');
    expect(artifact.firstPath).toBe('src/app.ts');
    expect(normalizeLineEndings(artifact.beforeContent)).toBe(ORIGINAL_SOURCE);
    expect(normalizeLineEndings(artifact.afterContent)).toBe(UPDATED_SOURCE);

    const reviewInput = {
      threadId: setup.threadId,
      runId
    };
    const applyResult = await window.evaluate(
      async (input) => window.vicode.runs.applyWorktreeReview(input),
      reviewInput
    );
    expect(applyResult.decision.status).toBe('applied');
    await expect.poll(async () => readFile(sourcePath, 'utf8'), { timeout: 10_000 }).toBe(UPDATED_SOURCE);

    const revertResult = await window.evaluate(
      async (input) => window.vicode.runs.revertWorktreeReview(input),
      reviewInput
    );
    expect(revertResult.decision.status).toBe('reverted');
    await expect.poll(async () => readFile(sourcePath, 'utf8'), { timeout: 10_000 }).toBe(ORIGINAL_SOURCE);

    const cleanupResult = await window.evaluate(
      async (input) => window.vicode.runs.cleanupWorktreeReview(input),
      reviewInput
    );
    expect(cleanupResult.decision.status).toBe('cleaned');
    expect(cleanupResult.thread.rawOutput.some((event) =>
      event.runId === runId
      && event.eventType === 'info'
      && (event.payload.worktreeCleanupDecision as { status?: unknown } | undefined)?.status === 'cleaned'
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
