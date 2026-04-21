import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { closeApp, launchApp as launchElectronApp } from './helpers/electron';

const root = process.cwd();

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
    cwd: root,
    stdio: 'inherit'
  });
}

async function launchApp() {
  return await launchElectronApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads'],
    timeoutMs: 60_000
  });
}

test('completed runs render expandable inline change review cards', async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  let seededProjectId: string | null = null;
  let seededThreadId: string | null = null;
  let app: ElectronApplication | null = null;
  let window: Page | null = null;
  let statePath: string | null = null;
  let statePaths: Awaited<ReturnType<typeof launchElectronApp>>['statePaths'] | null = null;

  try {
    ({ app, window, statePaths } = await launchApp());

    const meta = await window.evaluate(() => window.vicode.app.getMeta());
    statePath = meta.statePath;

    const seeded = await window.evaluate(async () => {
      const project = await window.vicode.projects.create({
        name: 'Change review project',
        folderPath: 'C:/Users/test-user/Desktop/vicode-project/vicode-windows',
        trusted: true
      });
      const thread = await window.vicode.threads.create({
        projectId: project.id,
        providerId: 'openai',
        modelId: 'gpt-5.4',
        executionPermission: 'default'
      });
      await window.vicode.settings.save({
        selectedProjectId: project.id,
        lastOpenedThreadId: null
      });
      return { projectId: project.id, threadId: thread.id };
    });
    seededProjectId = seeded.projectId;
    seededThreadId = seeded.threadId;

    runPythonSeed(
      `
        import json
        import sqlite3
        import sys

        db_path, thread_id, suffix = sys.argv[1:4]
        connection = sqlite3.connect(db_path)
        try:
          run_id = f'run-{suffix}'
          user_turn_id = f'turn-user-{suffix}'
          assistant_turn_id = f'turn-assistant-{suffix}'
          started_at = '2026-03-19T12:00:00.000Z'
          change_at = '2026-03-19T12:00:04.000Z'
          finished_at = '2026-03-19T12:00:05.000Z'

          connection.execute(
            "UPDATE threads SET status = ?, updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?",
            ('completed', finished_at, finished_at, 'Updated the composer review surface.', thread_id)
          )
          connection.execute(
            "INSERT OR REPLACE INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_turn_id, thread_id, None, 'user', 'Update the composer review surface and show me the diff.', None, started_at)
          )
          connection.execute(
            "INSERT OR REPLACE INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (assistant_turn_id, thread_id, run_id, 'assistant', '', None, finished_at)
          )
          events = [
            (
              f'event-start-{suffix}',
              thread_id,
              run_id,
              'started',
              json.dumps({}),
              started_at
            ),
            (
              f'event-change-{suffix}',
              thread_id,
              run_id,
              'info',
              json.dumps({
                'activity': {
                  'kind': 'change_summary',
                  'summary': '2 files changed',
                  'changeArtifact': {
                    'summary': {
                      'filesChanged': 2,
                      'insertions': 8,
                      'deletions': 3
                    },
                    'files': [
                      {
                        'path': 'src/renderer/components/ComposerPanel.tsx',
                        'status': 'modified',
                        'insertions': 5,
                        'deletions': 2,
                        'previewTruncated': False,
                        'previewLines': [
                          { 'type': 'context', 'oldLineNumber': 219, 'newLineNumber': 219, 'text': '  }, [projectId, modelId]);' },
                          { 'type': 'removed', 'oldLineNumber': 220, 'newLineNumber': None, 'text': 'async function installEnhancePromptStub(window: Page) {' },
                          { 'type': 'added', 'oldLineNumber': None, 'newLineNumber': 220, 'text': 'async function installEnhancePromptStub(window: Page, delayMs = 0) {' }
                        ]
                      },
                      {
                        'path': 'src/renderer/styles/thread.css',
                        'status': 'modified',
                        'insertions': 3,
                        'deletions': 1,
                        'previewTruncated': False,
                        'previewLines': [
                          { 'type': 'context', 'oldLineNumber': 2965, 'newLineNumber': 2965, 'text': '}' },
                          { 'type': 'added', 'oldLineNumber': None, 'newLineNumber': 2966, 'text': '.composer-send-button.is-enhancing {' }
                        ]
                      }
                    ]
                  }
                }
              }),
              change_at
            ),
            (
              f'event-completed-{suffix}',
              thread_id,
              run_id,
              'completed',
              json.dumps({ 'output': 'Updated the composer review surface.' }),
              finished_at
            )
          ]
          connection.executemany(
            "INSERT OR REPLACE INTO run_events (id, thread_id, run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            events
          )
          connection.commit()
        finally:
          connection.close()
      `,
      [path.join(statePath, 'vicode.sqlite'), seededThreadId, suffix]
    );
    await closeApp(app, { cleanupState: false });
    app = null;
    window = null;
    ({ app, window } = await launchElectronApp({
      bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads'],
      timeoutMs: 60_000,
      statePaths: statePaths ?? undefined
    }));
    await expect(window.getByLabel('Vicode is loading')).toHaveCount(0, { timeout: 30_000 });

    const projectRow = window.getByTestId(`project-row-${seededProjectId}`);
    await expect(projectRow).toBeVisible({ timeout: 30_000 });

    const threadRow = window.getByTestId(`thread-row-${seededThreadId}`);
    await expect(threadRow).toBeVisible({ timeout: 30_000 });
    await threadRow.click();

    const changeCard = window.getByTestId('run-change-card');
    await expect(changeCard).toContainText('2 files changed');
    await expect(changeCard.getByText('src/renderer/components/ComposerPanel.tsx')).toBeVisible();
    await expect(changeCard.getByTestId('run-change-summary-additions')).toHaveText('+8');
    await expect(changeCard.getByTestId('run-change-summary-deletions')).toHaveText('-3');

    await window.getByRole('button', { name: /src\/renderer\/components\/ComposerPanel\.tsx/i }).click();
    await expect(window.getByText('Updated diff')).toBeVisible();
    await expect(window.getByText('async function installEnhancePromptStub(window: Page, delayMs = 0) {')).toBeVisible();
    await expect(window.getByText('async function installEnhancePromptStub(window: Page) {')).toBeVisible();
  } finally {
    await closeApp(app);

    if (statePath && seededProjectId) {
      runPythonSeed(
        `
          import sqlite3
          import sys

          db_path, project_id = sys.argv[1:3]
          connection = sqlite3.connect(db_path)
          try:
            connection.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            connection.commit()
          finally:
            connection.close()
        `,
        [path.join(statePath, 'vicode.sqlite'), seededProjectId]
      );
    }
  }
});
