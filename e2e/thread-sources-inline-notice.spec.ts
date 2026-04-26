import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { closeApp, launchApp, type LaunchStatePaths } from './helpers/electron';

const workspaceRoot = path.join(process.cwd(), 'test', '.e2e-workspaces', 'thread-sources-inline-notice');

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
        bootstrap.providers.find((entry) => entry.id === 'openai') ??
        bootstrap.providers.find((entry) => entry.id === 'gemini') ??
        bootstrap.providers.find((entry) => entry.id === 'ollama') ??
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
        modelId: provider.models[0]?.id ?? 'gpt-5',
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

test('completed threads render AI Elements sources from structured assistant turn metadata', async () => {
  const stateful = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads']
  });

  const cleanupState = stateful.cleanupState;
  let statePaths = stateful.statePaths;
  let statefulClosed = false;
  let dbPath: string | null = null;
  let seededThreadId: string | null = null;

  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `sources-${suffix}`);
    await mkdir(projectPath, { recursive: true });

    const seeded = await seedProjectAndThread(
      stateful.window,
      `Sources project ${suffix}`,
      projectPath,
      `Structured sources ${suffix}`
    );
    seededThreadId = seeded.threadId;
    const meta = await stateful.window.evaluate(() => window.vicode.app.getMeta());
    dbPath = path.join(meta.statePath, 'vicode.sqlite');

    await closeApp(stateful.app, { cleanupState: false });
    statefulClosed = true;

    const sources = [
      {
        url: 'https://react.dev/reference/react/useState',
        title: 'React useState',
        snippet: 'useState lets you add state to a component.',
        excerpt: null
      },
      {
        url: 'https://react.dev/reference/react/useEffect',
        title: 'React useEffect',
        snippet: 'useEffect lets you synchronize a component with an external system.',
        excerpt: null
      }
    ];

    runPythonSeed(
      `
        import json
        import sqlite3
        import sys
        from uuid import uuid4

        db_path, thread_id, sources_json = sys.argv[1:4]
        connection = sqlite3.connect(db_path)
        try:
          started_at = '2026-04-17T12:00:00.000Z'
          completed_at = '2026-04-17T12:00:04.000Z'
          user_turn_id = str(uuid4())
          assistant_turn_id = str(uuid4())
          run_id = 'run-structured-sources'
          assistant_text = 'I verified the hook guidance and attached the source cards.\\n\\nSources:\\n- https://react.dev/reference/react/useState\\n- https://react.dev/reference/react/useEffect'
          metadata = json.dumps({ 'sources': json.loads(sources_json) })

          connection.execute(
            "UPDATE threads SET status = ?, updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?",
            ('completed', completed_at, completed_at, 'I verified the hook guidance and attached the source cards.', thread_id)
          )
          connection.execute(
            "INSERT INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_turn_id, thread_id, None, 'user', 'Check the hook docs and keep the evidence attached to the answer.', None, started_at)
          )
          connection.execute(
            "INSERT INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (assistant_turn_id, thread_id, run_id, 'assistant', assistant_text, metadata, completed_at)
          )
          connection.execute(
            "INSERT INTO run_events (id, thread_id, run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (str(uuid4()), thread_id, run_id, 'started', '{}', started_at)
          )
          connection.execute(
            "INSERT INTO run_events (id, thread_id, run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (str(uuid4()), thread_id, run_id, 'completed', json.dumps({ 'output': assistant_text }), completed_at)
          )
          connection.commit()
        finally:
          connection.close()
      `,
      [dbPath, seeded.threadId, JSON.stringify(sources)]
    );

    const relaunched = await restartWithState(statePaths, ['vicode.app', 'vicode.projects', 'vicode.threads']);
    try {
      await relaunched.window.getByTestId(`thread-row-${seeded.threadId}`).click();
      await expect(relaunched.window.getByRole('button', { name: 'Used 2 sources' })).toBeVisible();
      await relaunched.window.getByRole('button', { name: 'Used 2 sources' }).click();
      await expect(relaunched.window.getByText('React useState')).toBeVisible();
      await expect(relaunched.window.getByText('React useEffect')).toBeVisible();
      await expect(relaunched.window.getByText(/^Sources:$/)).toHaveCount(0);
    } finally {
      await closeApp(relaunched.app);
    }
  } finally {
    if (!statefulClosed) {
      await closeApp(stateful.app, { cleanupState: false });
    }
    cleanupState();
    if (dbPath && seededThreadId) {
      // No-op: state cleanup happens when the relaunched app closes.
    }
  }
});

test('pending review alerts render as an overlay notice instead of shifting page content', async () => {
  const initial = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads']
  });

  const cleanupState = initial.cleanupState;
  const statePaths = initial.statePaths;
  let initialClosed = false;
  let dbPath: string | null = null;
  let reviewItemId: string | null = null;
  let threadId: string | null = null;

  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `notice-${suffix}`);
    await mkdir(projectPath, { recursive: true });

    const seeded = await seedProjectAndThread(
      initial.window,
      `Notice project ${suffix}`,
      projectPath,
      `Inline notice ${suffix}`
    );
    threadId = seeded.threadId;
    const meta = await initial.window.evaluate(() => window.vicode.app.getMeta());
    dbPath = path.join(meta.statePath, 'vicode.sqlite');
    reviewItemId = randomUUID();
    const jobId = randomUUID();

    await closeApp(initial.app, { cleanupState: false });
    initialClosed = true;

    runPythonSeed(
      `
        import json
        import sqlite3
        import sys

        db_path, project_id, thread_id, job_id, review_item_id = sys.argv[1:6]
        connection = sqlite3.connect(db_path)
        try:
          now = '2026-04-17T12:10:00.000Z'
          details = json.dumps({
            'actionType': 'workflow_resume',
            'trigger': 'manual',
            'providerId': 'openai',
            'modelId': 'gpt-5.4',
            'projectId': project_id,
            'threadId': thread_id
          })

          connection.execute(
            "UPDATE threads SET status = ?, updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?",
            ('completed', now, now, 'Pending review seeded.', thread_id)
          )
          connection.execute(
            "INSERT INTO jobs (id, project_id, source_type, source_id, title, status, thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (job_id, project_id, 'manual', f'workflow-resume:{thread_id}:seed', 'Resume nightly sync', 'waiting_for_review', thread_id, now, now)
          )
          connection.execute(
            "INSERT INTO review_items (id, job_id, job_run_id, kind, status, summary, details_json, decision_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (review_item_id, job_id, None, 'manual_review', 'pending', 'Review automation checkpoint', details, None, now, now)
          )
          connection.commit()
        finally:
          connection.close()
      `,
      [dbPath, seeded.projectId, seeded.threadId, jobId, reviewItemId]
    );

    const relaunched = await restartWithState(statePaths, ['vicode.app', 'vicode.jobs']);
    try {
      const notice = relaunched.window.getByTestId('app-inline-notice');
      await expect(notice).toBeVisible();
      await expect(notice).toContainText('Resume nightly sync');
      await expect(notice).toContainText('1 pending review waiting.');
      await expect(relaunched.window.locator('.toast')).toHaveCount(0);
      const noticePosition = await notice.evaluate((node) => window.getComputedStyle(node).position);
      expect(noticePosition).toBe('fixed');
      await expect(notice).toHaveAttribute('data-level', 'warning');
      const border = await notice.evaluate((node) => {
        const style = window.getComputedStyle(node);
        return {
          color: style.borderTopColor,
          style: style.borderTopStyle,
          width: style.borderTopWidth
        };
      });
      expect(border.style).toBe('solid');
      expect(border.width).toBe('1px');
      expect(border.color).not.toBe('rgba(0, 0, 0, 0)');
      const actionBackground = await notice
        .getByRole('button', { name: 'View queue' })
        .evaluate((node) => window.getComputedStyle(node).backgroundColor);
      expect(actionBackground).toBe('rgba(0, 0, 0, 0)');
      await notice.getByRole('button', { name: 'View queue' }).click();
      await expect(relaunched.window.getByTestId(`pending-review-card-${reviewItemId}`)).toBeVisible();
    } finally {
      await closeApp(relaunched.app);
    }
  } finally {
    if (!initialClosed) {
      await closeApp(initial.app, { cleanupState: false });
    }
    cleanupState();
    if (dbPath && threadId) {
      // State cleanup happens when the relaunched app closes.
    }
  }
});
