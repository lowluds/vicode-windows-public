import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  closeApp,
  launchApp,
  type LaunchStatePaths,
  waitForThreadSurfaceReady
} from './helpers/electron';

const workspaceRoot = path.join(process.cwd(), 'test', '.e2e-workspaces', 'context-compaction-transcript');

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

async function seedProjectAndThread(window: Page, projectName: string, projectPath: string, threadTitle: string) {
  return await window.evaluate(
    async ({ projectName, projectPath, threadTitle }) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const provider =
        bootstrap.providers.find((entry) => entry.id === 'ollama') ??
        bootstrap.providers.find((entry) => entry.id === 'openai_compatible') ??
        null;

      if (!provider) {
        throw new Error('Expected a provider for the context compaction fixture.');
      }

      const project = await window.vicode.projects.create({
        name: projectName,
        folderPath: projectPath,
        trusted: true
      });

      const modelId =
        project.defaultModelByProvider[provider.id] ??
        bootstrap.preferences.defaultModelByProvider[provider.id] ??
        provider.models[0]?.id ??
        'qwen2.5-coder:14b-instruct-q6_K';

      const thread = await window.vicode.threads.create({
        projectId: project.id,
        title: threadTitle,
        providerId: provider.id,
        modelId,
        executionPermission: 'full_access'
      });

      await window.vicode.settings.save({
        onboardingComplete: true,
        selectedProjectId: project.id,
        lastOpenedThreadId: thread.id
      });

      return {
        projectId: project.id,
        threadId: thread.id
      };
    },
    { projectName, projectPath, threadTitle }
  );
}

async function restartWithState(statePaths: LaunchStatePaths) {
  return await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads'],
    statePaths
  });
}

test.beforeAll(async () => {
  await mkdir(workspaceRoot, { recursive: true });
});

test.afterAll(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

test('renders automatic context compaction as a visible thread transcript divider', async () => {
  const initial = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads']
  });

  const cleanupState = initial.cleanupState;
  const statePaths = initial.statePaths;
  let initialClosed = false;

  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `thread-${suffix}`);
    await mkdir(projectPath, { recursive: true });

    const seeded = await seedProjectAndThread(
      initial.window,
      `Context compaction transcript ${suffix}`,
      projectPath,
      `Context compaction transcript ${suffix}`
    );
    const meta = await initial.window.evaluate(() => window.vicode.app.getMeta());
    const dbPath = path.join(meta.statePath, 'vicode.sqlite');

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
          run_id = 'run-context-compaction-transcript'
          started_at = '2026-06-01T12:00:00.000Z'
          compaction_at = '2026-06-01T12:00:01.000Z'
          completed_at = '2026-06-01T12:00:02.000Z'
          user_turn_id = str(uuid4())
          assistant_turn_id = str(uuid4())
          prompt = 'Fill the context window until compaction is required.'
          answer = 'Continuing after compacting the older thread context.'

          connection.execute(
            "UPDATE threads SET status = ?, updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?",
            ('completed', completed_at, completed_at, answer, thread_id)
          )
          connection.execute(
            "INSERT INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_turn_id, thread_id, run_id, 'user', prompt, json.dumps({}), started_at)
          )
          connection.execute(
            "INSERT INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (assistant_turn_id, thread_id, run_id, 'assistant', answer, json.dumps({}), completed_at)
          )
          events = [
            (str(uuid4()), thread_id, run_id, 'started', json.dumps({}), started_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'message': 'Context automatically compacted',
              'eventKind': 'tool_activity',
              'transcriptVisible': True,
              'activity': {
                'kind': 'context_compaction',
                'summary': 'Context automatically compacted',
                'text': 'Older thread context was summarized so the run can continue within the model context window.',
                'providerEventType': 'vicode_thread_context_compaction'
              },
              'threadCompaction': {
                'id': 'compaction-context-transcript',
                'sourceStartEventId': 'event-start',
                'sourceEndEventId': 'event-end',
                'inputTokenEstimate': 91372,
                'outputTokenEstimate': 420
              }
            }), compaction_at),
            (str(uuid4()), thread_id, run_id, 'completed', json.dumps({ 'output': answer }), completed_at)
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
      await waitForThreadSurfaceReady(relaunched.window);
      await relaunched.window.getByTestId(`thread-row-${seeded.threadId}`).click();
      await waitForThreadSurfaceReady(relaunched.window);

      const timeline = relaunched.window.locator('.run-transcript-timeline').first();
      const marker = timeline.locator('.run-transcript-context-divider', {
        hasText: 'Context automatically compacted'
      });
      await expect(marker).toBeVisible();
      await expect(marker).toHaveAttribute('role', 'status');
      await expect(marker).toHaveAttribute('aria-label', 'Context automatically compacted');
      await expect(relaunched.window.getByText('Continuing after compacting the older thread context.')).toBeVisible();

      const bodyText = await relaunched.window.locator('body').innerText();
      expect(bodyText).not.toContain('Older thread context was summarized');
      expect(bodyText).not.toContain('vicode_thread_context_compaction');
      expect(bodyText).not.toContain('compaction-context-transcript');
      expect(bodyText).not.toContain('91372');

      const markerBox = await marker.boundingBox();
      const composerBox = await relaunched.window.getByTestId('composer-input').boundingBox();
      expect(markerBox).not.toBeNull();
      expect(composerBox).not.toBeNull();
      expect(markerBox!.width).toBeGreaterThan(120);
      expect(markerBox!.x).toBeGreaterThanOrEqual(0);
      expect(markerBox!.y + markerBox!.height).toBeLessThan(composerBox!.y);

      await relaunched.window.screenshot({
        path: path.join('test-results', 'context-compaction-thread-marker.png'),
        fullPage: true
      });
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
