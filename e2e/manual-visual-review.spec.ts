import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { RunToolApprovalRequest } from '../src/shared/domain';
import type { AppEvent } from '../src/shared/events';
import { closeApp, launchApp, type LaunchStatePaths, waitForBridge, waitForThreadSurfaceReady } from './helpers/electron';

const visualReviewDir = path.join(process.cwd(), 'docs', 'engineering', 'visual-review', '2026-05-24');
const workspaceRoot = path.join(process.cwd(), 'test', '.e2e-workspaces', 'manual-visual-review');

async function emitVicodeEvent(app: Awaited<ReturnType<typeof launchApp>>['app'], event: AppEvent) {
  await app.evaluate(
    ({ BrowserWindow }, payload: AppEvent) => {
      const targetWindow =
        BrowserWindow.getFocusedWindow() ??
        BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible() && !candidate.isDestroyed()) ??
        BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      if (!targetWindow) {
        throw new Error('Expected a Vicode Electron window.');
      }
      targetWindow.webContents.send('vicode:event', payload);
    },
    event
  );
}

function runPythonSeed(script: string, args: string[]) {
  const command = process.platform === 'win32' ? 'py' : 'python3';
  const trimmedScript = script.replace(/^\s*\r?\n/u, '').replace(/\r\n/g, '\n');
  const indents = trimmedScript
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^\s*/u)?.[0].length ?? 0);
  const sharedIndent = indents.length > 0 ? Math.min(...indents) : 0;
  const normalizedScript = trimmedScript
    .split('\n')
    .map((line) => line.slice(sharedIndent))
    .join('\n');
  const commandArgs = process.platform === 'win32' ? ['-3', '-c', normalizedScript, ...args] : ['-c', normalizedScript, ...args];
  execFileSync(command, commandArgs, {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
}

async function capture(window: Page, name: string) {
  await mkdir(visualReviewDir, { recursive: true });
  await window.screenshot({
    path: path.join(visualReviewDir, name),
    fullPage: false
  });
}

async function expectLegacyNoiseAbsent(window: Page) {
  for (const label of [
    'SOUL.md',
    'USER.md',
    'MEMORY.md',
    'daily note',
    'workspace setup',
    'Build Control',
    'Autonomous Builds',
    'Gemini',
    'Kimi'
  ]) {
    await expect(window.getByText(label, { exact: false })).toHaveCount(0);
  }
}

async function seedProjectAndThread(window: Page, projectPath: string) {
  return await window.evaluate(async (targetProjectPath) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    const provider = bootstrap.providers.find((entry) => entry.id === 'ollama') ?? null;
    if (!provider) {
      throw new Error('Expected local Ollama provider for visual review.');
    }

    const project = await window.vicode.projects.create({
      name: 'Manual visual review',
      folderPath: targetProjectPath,
      trusted: true
    });
    const thread = await window.vicode.threads.create({
      projectId: project.id,
      title: 'Manual visual review transcript',
      providerId: provider.id,
      modelId:
        project.defaultModelByProvider[provider.id] ??
        bootstrap.preferences.defaultModelByProvider[provider.id] ??
        provider.models[0]?.id ??
        'qwen3-coder',
      executionPermission: 'full_access'
    });
    await window.vicode.settings.save({
      selectedProjectId: project.id,
      lastOpenedThreadId: thread.id
    });

    return {
      projectId: project.id,
      threadId: thread.id,
      providerId: provider.id
    };
  }, projectPath);
}

async function restartWithState(statePaths: LaunchStatePaths) {
  return await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads'],
    statePaths
  });
}

test.beforeAll(async () => {
  await mkdir(visualReviewDir, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
});

test.afterAll(async () => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

test('captures current narrow beta visual review surfaces without legacy setup noise', async () => {
  const projectPath = path.join(workspaceRoot, 'review-current');
  mkdirSync(projectPath, { recursive: true });
  writeFileSync(
    path.join(projectPath, 'package.json'),
    JSON.stringify(
      {
        name: 'manual-visual-review',
        private: true,
        scripts: {
          build: 'vite build'
        }
      },
      null,
      2
    ),
    'utf8'
  );

  const initial = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.events', 'vicode.runs']
  });
  const statePaths = initial.statePaths;
  const cleanupState = initial.cleanupState;
  let initialClosed = false;

  try {
    const seeded = await seedProjectAndThread(initial.window, projectPath);
    const meta = await initial.window.evaluate(() => window.vicode.app.getMeta());
    const dbPath = path.join(meta.statePath, 'vicode.sqlite');

    await initial.window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(initial.window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.events', 'vicode.runs']);
    await waitForThreadSurfaceReady(initial.window);

    await expect(initial.window.getByTestId('nav-settings')).toBeVisible();
    await expect(initial.window.getByTestId('nav-skills')).toBeVisible();
    await expect(initial.window.getByTestId('nav-plugins')).toHaveCount(0);
    await expect(initial.window.getByTestId('nav-automations')).toHaveCount(0);
    await expectLegacyNoiseAbsent(initial.window);
    await capture(initial.window, 'composer-with-skills-entrypoint.png');

    await initial.window.getByTestId('nav-settings').click();
    await expect(initial.window.getByRole('heading', { name: 'App' })).toBeVisible();
    await initial.window.locator('.settings-nav-item').filter({ hasText: 'Providers' }).click();
    await expect(initial.window.getByRole('heading', { name: 'Providers' })).toBeVisible();
    await expect(initial.window.getByText('Connect the local Ollama runtime and OpenAI-compatible Custom API keys Vicode can run.')).toBeVisible();
    await expect(initial.window.getByText('Cloud API key', { exact: true })).toHaveCount(0);
    await expect(initial.window.getByText('Use local models from this PC through the local Ollama API.')).toBeVisible();
    await expectLegacyNoiseAbsent(initial.window);
    await capture(initial.window, 'settings-provider-copy.png');

    await initial.window.getByTestId('nav-skills').click();
    await expect(initial.window.locator('.skills-page-shell')).toBeVisible();
    await expect(initial.window.getByTestId('skills-tab-plugins')).toBeVisible();
    await expect(initial.window.getByTestId('skills-tab-skills')).toBeVisible();
    await expectLegacyNoiseAbsent(initial.window);
    await capture(initial.window, 'skills-plugins-surface.png');
    await initial.window.getByTestId('skills-tab-skills').click();
    await expectLegacyNoiseAbsent(initial.window);
    await capture(initial.window, 'skills-skills-surface.png');
    await initial.window.getByRole('button', { name: 'Close catalog' }).click();
    await expect(initial.window.getByTestId('composer-input')).toBeVisible();

    const approval: RunToolApprovalRequest = {
      id: 'approval-manual-visual-review',
      threadId: seeded.threadId,
      runId: 'run-manual-visual-review',
      providerId: seeded.providerId,
      toolName: 'run_command',
      command: 'npm run build',
      cwd: '.',
      workspaceRoot: projectPath,
      requestedAt: '2026-05-24T16:00:00.000Z'
    };
    await emitVicodeEvent(initial.app, {
      type: 'run.approvalRequested',
      approval
    });
    const panel = initial.window.getByTestId('tool-approval-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Command approval')).toBeVisible();
    await expect(panel.getByText('Vicode paused a command')).toBeVisible();
    await expect(initial.window.getByText('run_command')).toHaveCount(0);
    await capture(initial.window, 'approval-surface.png');
    await emitVicodeEvent(initial.app, {
      type: 'run.approvalResolved',
      approvalId: approval.id,
      threadId: approval.threadId,
      runId: approval.runId,
      decision: 'cancelled'
    });

    await closeApp(initial.app, { cleanupState: false });
    initialClosed = true;

    runPythonSeed(
      `
        import json
        import sqlite3
        import sys
        from uuid import uuid4

        db_path, thread_id = sys.argv[1:3]
        connection = sqlite3.connect(db_path)
        try:
          run_id = 'run-manual-visual-review-transcript'
          assistant_turn_id = str(uuid4())
          completed_at = '2026-05-24T16:00:07.000Z'
          assistant_text = 'I checked the project files, searched the workspace, used the review skill, and captured the preview evidence.'
          connection.execute(
            "UPDATE threads SET status = ?, updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?",
            ('completed', completed_at, completed_at, assistant_text, thread_id)
          )
          connection.execute(
            "INSERT INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (assistant_turn_id, thread_id, run_id, 'assistant', assistant_text, json.dumps({}), completed_at)
          )
          events = [
            (str(uuid4()), thread_id, run_id, 'started', json.dumps({}), '2026-05-24T16:00:00.000Z'),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'tool_call',
                'summary': 'Reading file package.json',
                'toolName': 'read_file'
              }
            }), '2026-05-24T16:00:01.000Z'),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'tool_result',
                'summary': 'Read package.json',
                'toolName': 'read_file',
                'status': 'completed',
                'text': 'package.json'
              }
            }), '2026-05-24T16:00:02.000Z'),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'skill',
                'summary': 'ui-visual-review',
                'text': 'ui-visual-review',
                'providerEventType': 'skill_context'
              }
            }), '2026-05-24T16:00:03.000Z'),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'tool_result',
                'summary': 'Preview validation passed',
                'toolName': 'browser_preview_check',
                'status': 'completed',
                'text': 'Expected selector #app matched.'
              }
            }), '2026-05-24T16:00:04.000Z'),
            (str(uuid4()), thread_id, run_id, 'completed', json.dumps({ 'output': assistant_text }), completed_at)
          ]
          connection.executemany(
            "INSERT INTO run_events (id, thread_id, run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            events
          )
          connection.commit()
        finally:
          connection.close()
      `,
      [dbPath, seeded.threadId]
    );

    const relaunched = await restartWithState(statePaths);
    try {
      await relaunched.window.getByTestId(`thread-row-${seeded.threadId}`).click();
      const persistedThread = await relaunched.window.evaluate(async (targetThreadId) => {
        return await window.vicode.threads.open(targetThreadId);
      }, seeded.threadId);
      const runId = 'run-manual-visual-review-transcript';
      const completedAt = '2026-05-24T16:00:07.000Z';
      const assistantText = 'I checked the project files, searched the workspace, used the review skill, and captured the preview evidence.';
      const thread = {
        ...persistedThread,
        status: 'completed' as const,
        updatedAt: completedAt,
        lastMessageAt: completedAt,
        lastPreview: assistantText,
        turns: [
          {
            id: 'turn-manual-visual-review-transcript',
            threadId: seeded.threadId,
            runId,
            role: 'assistant' as const,
            content: assistantText,
            metadata: {},
            createdAt: completedAt
          }
        ],
        rawOutput: [
          {
            id: 'event-manual-visual-review-started',
            threadId: seeded.threadId,
            runId,
            eventType: 'started' as const,
            payload: {},
            createdAt: '2026-05-24T16:00:00.000Z'
          },
          {
            id: 'event-manual-visual-review-read-call',
            threadId: seeded.threadId,
            runId,
            eventType: 'info' as const,
            payload: {
              activity: {
                kind: 'tool_call',
                summary: 'Reading file package.json',
                toolName: 'read_file'
              }
            },
            createdAt: '2026-05-24T16:00:01.000Z'
          },
          {
            id: 'event-manual-visual-review-read-result',
            threadId: seeded.threadId,
            runId,
            eventType: 'info' as const,
            payload: {
              activity: {
                kind: 'tool_result',
                summary: 'Read package.json',
                toolName: 'read_file',
                status: 'completed',
                text: 'package.json'
              }
            },
            createdAt: '2026-05-24T16:00:02.000Z'
          },
          {
            id: 'event-manual-visual-review-skill',
            threadId: seeded.threadId,
            runId,
            eventType: 'info' as const,
            payload: {
              activity: {
                kind: 'skill',
                summary: 'ui-visual-review',
                text: 'ui-visual-review',
                providerEventType: 'skill_context'
              }
            },
            createdAt: '2026-05-24T16:00:03.000Z'
          },
          {
            id: 'event-manual-visual-review-preview',
            threadId: seeded.threadId,
            runId,
            eventType: 'info' as const,
            payload: {
              activity: {
                kind: 'tool_result',
                summary: 'Preview validation passed',
                toolName: 'browser_preview_check',
                status: 'completed',
                text: 'Expected selector #app matched.'
              }
            },
            createdAt: '2026-05-24T16:00:04.000Z'
          },
          {
            id: 'event-manual-visual-review-completed',
            threadId: seeded.threadId,
            runId,
            eventType: 'completed' as const,
            payload: { output: assistantText },
            createdAt: completedAt
          }
        ]
      };
      await emitVicodeEvent(relaunched.app, {
        type: 'thread.detail',
        thread
      });
      const workedButton = relaunched.window.getByRole('button', { name: /Worked for 7s/i });
      await expect(workedButton).toBeVisible();
      await workedButton.click();
      const toolDetailButtons = relaunched.window.getByRole('button', { name: /1 tool detail/i });
      await expect(toolDetailButtons).toHaveCount(2);
      await toolDetailButtons.nth(0).click();
      await expect(relaunched.window.getByText('Reading file', { exact: true })).toBeVisible();
      await expect(relaunched.window.getByText('ui-visual-review')).toBeVisible();
      await toolDetailButtons.nth(1).click();
      await expect(relaunched.window.getByText('Checked preview', { exact: true })).toBeVisible();
      await expect(relaunched.window.getByText('Expected selector #app matched.')).toBeVisible();
      await expect(relaunched.window.getByText('read_file')).toHaveCount(0);
      await expect(relaunched.window.getByText('browser_preview_check')).toHaveCount(0);
      await expectLegacyNoiseAbsent(relaunched.window);
      await capture(relaunched.window, 'transcript-tool-evidence.png');
    } finally {
      await closeApp(relaunched.app);
    }
  } finally {
    if (!initialClosed) {
      await closeApp(initial.app, { cleanupState: false });
    }
    cleanupState();
  }
});
