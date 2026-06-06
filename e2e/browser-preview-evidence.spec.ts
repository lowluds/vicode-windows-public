import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { closeApp, launchApp, type LaunchStatePaths } from './helpers/electron';

const workspaceRoot = path.join(process.cwd(), 'test', '.e2e-workspaces', 'browser-preview-evidence');

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
        null;
      if (!provider) {
        throw new Error('Expected Ollama for E2E setup.');
      }

      const project = await window.vicode.projects.create({
        name: projectName,
        folderPath: projectPath,
        trusted: true
      });

      const thread = await window.vicode.threads.create({
        projectId: project.id,
        title: threadTitle,
        providerId: provider.id,
        modelId: provider.models[0]?.id ?? 'qwen3-coder',
        executionPermission: 'default'
      });

      await window.vicode.settings.save({
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

test('completed threads render browser preview evidence without raw tool noise', async () => {
  const initial = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads']
  });

  const cleanupState = initial.cleanupState;
  const statePaths = initial.statePaths;
  let initialClosed = false;
  let dbPath: string | null = null;

  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `preview-${suffix}`);
    await mkdir(projectPath, { recursive: true });

    const seeded = await seedProjectAndThread(
      initial.window,
      `Preview evidence ${suffix}`,
      projectPath,
      `Preview evidence ${suffix}`
    );
    const meta = await initial.window.evaluate(() => window.vicode.app.getMeta());
    dbPath = path.join(meta.statePath, 'vicode.sqlite');

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
          started_at = '2026-05-24T12:00:00.000Z'
          call_at = '2026-05-24T12:00:02.000Z'
          result_at = '2026-05-24T12:00:05.000Z'
          completed_at = '2026-05-24T12:00:06.000Z'
          run_id = 'run-browser-preview-evidence'
          assistant_turn_id = str(uuid4())
          assistant_text = 'Preview loaded cleanly and the expected launch text is visible.'

          connection.execute(
            "UPDATE threads SET status = ?, updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?",
            ('completed', completed_at, completed_at, assistant_text, thread_id)
          )
          connection.execute(
            "INSERT INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (assistant_turn_id, thread_id, run_id, 'assistant', assistant_text, None, completed_at)
          )
          events = [
            (str(uuid4()), thread_id, run_id, 'started', json.dumps({}), started_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'tool_call',
                'summary': 'Calling browser_preview_check',
                'toolName': 'browser_preview_check',
                'text': 'url: http://localhost:4173/\\nexpected text: launch ready'
              }
            }), call_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'tool_result',
                'summary': 'Completed browser_preview_check',
                'toolName': 'browser_preview_check',
                'status': 'completed',
                'url': 'http://localhost:4173/',
                'text': 'Status: passed\\nURL: http://localhost:4173/\\nExpected text: found\\nSelectors:\\n- #app-status: found\\nConsole errors: 0\\nLoad errors: 0\\nScreenshot: C:/Users/test/AppData/Local/Vicode/exports/browser-preview/preview.png'
              }
            }), result_at),
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

      const workedButton = relaunched.window.getByRole('button', { name: /Worked for 6s/i });
      await expect(workedButton).toBeVisible();
      await workedButton.click();

      const toolDetails = relaunched.window.getByRole('button', { name: /2 tool details/i });
      await expect(toolDetails).toBeVisible();
      await toolDetails.click();
      await expect(relaunched.window.getByText('Checking preview')).toBeVisible();
      await expect(relaunched.window.getByText('Checked preview')).toBeVisible();

      const previewCall = relaunched.window.getByRole('button', { name: /Checking preview/i });
      await expect(previewCall).toBeVisible();
      await previewCall.click();
      await expect(relaunched.window.getByText('Preview URL: http://localhost:4173/')).toBeVisible();

      const previewDetails = relaunched.window.getByRole('button', { name: /Checked preview/i });
      await expect(previewDetails).toBeVisible();
      await previewDetails.click();

      await expect(relaunched.window.getByText('Status: passed')).toBeVisible();
      await expect(relaunched.window.getByText('Expected text: found')).toBeVisible();
      await expect(relaunched.window.getByText('Console errors: 0')).toBeVisible();
      await expect(relaunched.window.getByText('Load errors: 0')).toBeVisible();
      await expect(relaunched.window.getByText('browser_preview_check')).toHaveCount(0);
      await expect(relaunched.window.getByText('Preview loaded cleanly and the expected launch text is visible.')).toBeVisible();
    } finally {
      await closeApp(relaunched.app);
    }
  } finally {
    if (!initialClosed) {
      await closeApp(initial.app, { cleanupState: false });
    }
    cleanupState();
    if (dbPath) {
      // State cleanup happens when the relaunched app closes.
    }
  }
});
