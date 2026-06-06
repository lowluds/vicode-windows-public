import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { closeApp, launchApp, type LaunchStatePaths } from './helpers/electron';

const workspaceRoot = path.join(process.cwd(), 'test', '.e2e-workspaces', 'thread-link-safety-modal');

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
        throw new Error('Expected a release-facing provider for E2E setup.');
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
        modelId: provider.models[0]?.id ?? 'qwen2.5-coder:14b-instruct-q6_K',
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

async function restartWithState(statePaths: LaunchStatePaths, bridgePaths: string[]) {
  return await launchApp({
    bridgePaths,
    statePaths
  });
}

test.beforeAll(async () => {
  await mkdir(workspaceRoot, { recursive: true });
});

test.afterAll(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

test('assistant markdown links open a readable Vicode safety modal', async ({}, testInfo) => {
  const initial = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']
  });

  const cleanupState = initial.cleanupState;
  const statePaths = initial.statePaths;
  let initialClosed = false;
  let dbPath: string | null = null;

  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `links-${suffix}`);
    await mkdir(projectPath, { recursive: true });

    const seeded = await seedProjectAndThread(
      initial.window,
      `Link modal ${suffix}`,
      projectPath,
      `Link modal ${suffix}`
    );
    const meta = await initial.window.evaluate(() => window.vicode.app.getMeta());
    dbPath = path.join(meta.statePath, 'vicode.sqlite');

    await closeApp(initial.app, { cleanupState: false });
    initialClosed = true;

    runPythonSeed(
      `
        import sqlite3
        import sys
        import json
        from uuid import uuid4

        db_path, thread_id, project_path = sys.argv[1:4]
        connection = sqlite3.connect(db_path)
        try:
          completed_at = '2026-05-24T12:00:04.000Z'
          started_at = '2026-05-24T12:00:00.000Z'
          file_write_at = '2026-05-24T12:00:02.000Z'
          run_id = 'run-thread-reference-links'
          assistant_turn_id = str(uuid4())
          local_link = project_path.replace('\\\\', '/') + '/src/message.tsx:202'
          assistant_text = f'Reference links updated.\\n\\nPreview ready: [Preview Beacon](http://127.0.0.1:49189/index.html). Updated \`src/index.html\`, \`script.js\`, \`styles.css\`, and [message.tsx]({local_link}).'

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
                'kind': 'file_write',
                'summary': 'Wrote src/index.html',
                'path': 'src/index.html'
              }
            }), file_write_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'file_write',
                'summary': 'Wrote script.js',
                'path': 'script.js'
              }
            }), file_write_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'file_write',
                'summary': 'Wrote styles.css',
                'path': 'styles.css'
              }
            }), file_write_at),
            (str(uuid4()), thread_id, run_id, 'completed', json.dumps({}), completed_at)
          ]
          connection.executemany(
            "INSERT INTO run_events (id, thread_id, run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            events
          )
          connection.commit()
        finally:
          connection.close()
      `,
      [dbPath, seeded.threadId, projectPath]
    );

    const relaunched = await restartWithState(statePaths, ['vicode.app', 'vicode.projects', 'vicode.threads']);
    try {
      await relaunched.window.getByTestId(`thread-row-${seeded.threadId}`).click();
      const htmlReference = relaunched.window.getByRole('button', { name: 'src/index.html' }).first();
      await expect(htmlReference).toBeVisible();
      await expect(htmlReference).toHaveAttribute('data-reference-kind', 'file');
      await expect(htmlReference).toHaveAttribute('title', /src[\\/]index\.html/u);
      await expect(htmlReference.locator('.turn-reference-brand-icon')).toHaveAttribute('data-icon-slug', 'html5');

      const scriptReference = relaunched.window.getByRole('button', { name: 'script.js' }).first();
      const cssReference = relaunched.window.getByRole('button', { name: 'styles.css' }).first();
      const tsxReference = relaunched.window.getByRole('button', { name: 'message.tsx' });
      await expect(scriptReference).toBeVisible();
      await expect(scriptReference.locator('.turn-reference-brand-icon')).toHaveAttribute('data-icon-slug', 'javascript');
      await expect(cssReference).toBeVisible();
      await expect(cssReference.locator('.turn-reference-brand-icon')).toHaveAttribute('data-icon-slug', 'css');
      await expect(tsxReference).toHaveAttribute('title', /message\.tsx \(line 202\)$/u);
      await expect(tsxReference.locator('.turn-reference-brand-icon')).toHaveAttribute('data-icon-slug', 'typescript');
      await expect(relaunched.window.locator('.turn-reference-file-badge')).toHaveCount(0);

      const summary = relaunched.window.locator('.run-transcript-resolution-summary');
      await expect(summary).toBeVisible();
      await expect(summary.getByText('Changed')).toBeVisible();
      const summaryHtmlReference = summary.getByRole('button', { name: 'src/index.html' });
      await expect(summaryHtmlReference).toBeVisible();
      await expect(summaryHtmlReference).toHaveAttribute('data-reference-kind', 'file');
      await expect(summaryHtmlReference).toHaveAttribute('title', /src[\\/]index\.html/u);
      await expect(summaryHtmlReference.locator('.turn-reference-brand-icon')).toHaveAttribute('data-icon-slug', 'html5');
      await expect(summary.getByRole('button', { name: 'script.js' }).locator('.turn-reference-brand-icon')).toHaveAttribute('data-icon-slug', 'javascript');
      await expect(summary.getByRole('button', { name: 'styles.css' }).locator('.turn-reference-brand-icon')).toHaveAttribute('data-icon-slug', 'css');

      const referenceStyle = await htmlReference.evaluate((element) => {
        const styles = window.getComputedStyle(element);
        return {
          backgroundColor: styles.backgroundColor,
          color: styles.color,
          textDecorationLine: styles.textDecorationLine
        };
      });
      expect(referenceStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(referenceStyle.color).not.toBe('rgb(0, 0, 0)');
      expect(referenceStyle.textDecorationLine).toContain('underline');
      await relaunched.window.screenshot({ path: testInfo.outputPath('thread-reference-links.png') });

      await expect(relaunched.window.getByRole('button', { name: 'Preview Beacon' })).toBeVisible();
      await relaunched.window.getByRole('button', { name: 'Preview Beacon' }).click();

      const dialog = relaunched.window.getByTestId('turn-link-safety-modal');
      await expect(dialog).toBeVisible();
      await expect(relaunched.window.getByText('Open external link?')).toBeVisible();
      await expect(relaunched.window.getByText('http://127.0.0.1:49189/index.html')).toBeVisible();
      await expect(relaunched.window.getByRole('button', { name: 'Copy link' })).toBeVisible();
      await expect(relaunched.window.getByRole('button', { name: 'Open link' })).toBeVisible();
      await expect(relaunched.window.locator('[data-streamdown="link-safety-modal"]')).toHaveCount(0);

      const dialogStyle = await dialog.locator('.turn-link-safety-dialog').evaluate((element) => {
        const styles = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          backgroundColor: styles.backgroundColor,
          width: rect.width
        };
      });
      expect(dialogStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(dialogStyle.width).toBeGreaterThan(300);
      expect(dialogStyle.width).toBeLessThanOrEqual(440);
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
