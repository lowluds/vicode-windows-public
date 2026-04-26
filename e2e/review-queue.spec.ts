import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { closeApp, launchApp } from './helpers/electron';

const workspaceRoot = path.join(process.cwd(), 'test', '.e2e-workspaces', 'review-queue');

async function openAutomations(window: Page) {
  const getStarted = window.getByRole('button', { name: 'Get Started' });
  if (await getStarted.isVisible().catch(() => false)) {
    await getStarted.click();
  }
  await window.getByTestId('nav-automations').click();
  await expect(window.getByRole('heading', { name: 'Automations', exact: true })).toBeVisible();
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

test.beforeAll(async () => {
  await mkdir(workspaceRoot, { recursive: true });
});

test.afterAll(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

test('rejects a pending automation review from the automations view', async () => {
  const { app, window: launchedWindow } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.automations', 'vicode.jobs', 'vicode.projects']
  });

  let window: Page | null = launchedWindow;
  let projectId: string | null = null;
  let automationId: string | null = null;
  let reviewItemId: string | null = null;
  let automationName: string | null = null;

  try {
    const seeded = await window.evaluate(async (workspaceRoot) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const provider =
        bootstrap.providers.find((entry) => entry.id === 'openai') ??
        bootstrap.providers.find((entry) => entry.id === 'gemini') ??
        bootstrap.providers.find((entry) => entry.id === 'ollama') ??
        null;
      if (!provider) {
        throw new Error('Expected a release-facing provider for the review queue test.');
      }

      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const project = await window.vicode.projects.create({
        name: `Review queue ${suffix}`,
        folderPath: workspaceRoot,
        trusted: true
      });
      const modelId =
        project.defaultModelByProvider[provider.id] ??
        bootstrap.preferences.defaultModelByProvider[provider.id] ??
        provider.models[0]?.id ??
        'gpt-5';
      const automation = await window.vicode.automations.save({
        name: `Review queue smoke ${suffix}`,
        projectId: project.id,
        providerId: provider.id,
        modelId,
        promptTemplate: 'Review queue test prompt',
        enabled: true,
        scheduleType: 'manual'
      });
      const queued = await window.vicode.automations.runNow(automation.id);
      return {
        projectId: project.id,
        automationId: automation.id,
        automationName: automation.name,
        reviewItemId: queued.reviewItem.id
      };
    }, workspaceRoot);

    projectId = seeded.projectId;
    automationId = seeded.automationId;
    automationName = seeded.automationName;
    reviewItemId = seeded.reviewItemId;

    await expect
      .poll(async () => {
        return await window.evaluate(async (targetReviewItemId) => {
          const pending = await window.vicode.jobs.listPendingReviews();
          return pending.some((item) => item.id === targetReviewItemId);
        }, reviewItemId);
      })
      .toBe(true);

    await openAutomations(window);

    const reviewCard = window.getByTestId(`pending-review-card-${reviewItemId}`);
    await expect(reviewCard).toContainText(automationName);
    await expect(reviewCard).toContainText('pending review');

    await reviewCard.getByRole('button', { name: 'Reject' }).click();

    await expect(reviewCard).toHaveCount(0);

    const pendingReviewStillExists = await window.evaluate(async (targetReviewItemId) => {
      const pending = await window.vicode.jobs.listPendingReviews();
      return pending.some((item) => item.id === targetReviewItemId);
    }, reviewItemId);
    expect(pendingReviewStillExists).toBe(false);
  } finally {
    if (window && automationId) {
      try {
        if (reviewItemId) {
          await window.evaluate(async ({ targetReviewItemId }) => {
            const pending = await window.vicode.jobs.listPendingReviews();
            const review = pending.find((item) => item.id === targetReviewItemId);
            if (review) {
              await window.vicode.jobs.rejectReview(review.id);
            }
          }, { targetReviewItemId: reviewItemId });
        }
        await window.evaluate(async ({ targetAutomationId }) => {
          const automations = await window.vicode.automations.list();
          if (automations.some((automation) => automation.id === targetAutomationId)) {
            await window.vicode.automations.remove(targetAutomationId);
          }
        }, { targetAutomationId: automationId });
        if (projectId) {
          await window.evaluate(async (targetProjectId) => {
            const bootstrap = await window.vicode.app.getBootstrap();
            if (bootstrap.projects.some((project) => project.id === targetProjectId)) {
              await window.vicode.projects.remove(targetProjectId);
            }
          }, projectId);
        }
      } catch {
        // Best-effort cleanup only.
      }
    }
    await closeApp(app);
  }
});

test('edits a manual review draft before approving the file write', async () => {
  const { app, window: launchedWindow } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.composer', 'vicode.memoryWrites', 'vicode.jobs']
  });

  let window: Page | null = launchedWindow;
  const meta = await window.evaluate(() => window.vicode.app.getMeta());
  const statePath = meta.statePath;
  const projectPath = path.join(workspaceRoot, `manual-review-${Date.now()}`);
  const projectName = `Review queue manual ${Date.now()}`;
  let projectId: string | null = null;
  let reviewItemId: string | null = null;
  let expectedDailyNotePath: string | null = null;

  try {
    const seeded = await window.evaluate(
      async ({ projectName, projectPath }) => {
        const bootstrap = await window.vicode.app.getBootstrap();
        const provider =
          bootstrap.providers.find((entry) => entry.id === 'openai') ??
          bootstrap.providers.find((entry) => entry.id === 'gemini') ??
          bootstrap.providers.find((entry) => entry.id === 'ollama') ??
          null;
        if (!provider) {
          throw new Error('Expected a release-facing provider for manual review setup.');
        }

        const existing = bootstrap.projects.find((project) => project.name === projectName);
        const project = existing
          ? await window.vicode.projects.update({
              id: existing.id,
              folderPath: projectPath,
              trusted: true
            })
          : await window.vicode.projects.create({
              name: projectName,
              folderPath: projectPath,
              trusted: true
            });

        const providerId = provider.id;
        const modelId =
          project.defaultModelByProvider[provider.id] ??
          bootstrap.preferences.defaultModelByProvider[provider.id] ??
          provider.models[0]?.id ??
          'gpt-5';

        const thread = await window.vicode.threads.create({
          projectId: project.id,
          title: 'Manual review edit flow',
          providerId,
          modelId,
          executionPermission: 'full_access'
        });

        return {
          projectId: project.id,
          threadId: thread.id
        };
      },
      { projectName, projectPath }
    );

    projectId = seeded.projectId;
    runPythonSeed(
      `
        import sqlite3
        import sys
        from uuid import uuid4

        db_path, thread_id = sys.argv[1:3]
        connection = sqlite3.connect(db_path)
        try:
          now = '2026-03-21T14:10:00.000Z'
          user_turn_id = str(uuid4())
          assistant_turn_id = str(uuid4())

          connection.execute(
            "UPDATE threads SET status = ?, updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?",
            ('completed', now, now, 'review queue seed ready.', thread_id)
          )
          connection.execute(
            "INSERT INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_turn_id, thread_id, None, 'user', 'Capture this thread into a daily note draft for later review.', None, now)
          )
          connection.execute(
            "INSERT INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (assistant_turn_id, thread_id, None, 'assistant', 'review queue seed ready.', None, now)
          )
          connection.commit()
        finally:
          connection.close()
      `,
      [path.join(statePath, 'vicode.sqlite'), seeded.threadId]
    );

    expectedDailyNotePath = path.join(projectPath, 'memory', `${new Date().toISOString().slice(0, 10)}.md`);
    const queuedJobId = randomUUID();
    reviewItemId = randomUUID();

    runPythonSeed(
      `
        import json
        import sqlite3
        import sys

        db_path, project_id, thread_id, job_id, review_item_id, target_path, relative_path = sys.argv[1:8]
        connection = sqlite3.connect(db_path)
        try:
          now = '2026-03-21T14:11:00.000Z'
          details = json.dumps({
            'actionType': 'daily_note_capture',
            'projectId': project_id,
            'threadId': thread_id,
            'targetPath': target_path,
            'content': '# Daily Workspace Note\\n\\n## Generated draft\\n- Replace me.',
            'relativePath': relative_path
          })
          connection.execute(
            "INSERT INTO jobs (id, project_id, source_type, source_id, title, status, thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (job_id, project_id, 'manual', f'daily-note:{thread_id}:manual-test', 'Capture daily note', 'waiting_for_review', thread_id, now, now)
          )
          connection.execute(
            "INSERT INTO review_items (id, job_id, job_run_id, kind, status, summary, details_json, decision_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (review_item_id, job_id, None, 'manual_review', 'pending', 'Review daily note update', details, None, now, now)
          )
          connection.commit()
        finally:
          connection.close()
      `,
      [
        path.join(statePath, 'vicode.sqlite'),
        seeded.projectId,
        seeded.threadId,
        queuedJobId,
        reviewItemId,
        expectedDailyNotePath,
        `memory/${new Date().toISOString().slice(0, 10)}.md`
      ]
    );

    await expect
      .poll(async () => {
        return await window.evaluate(async (targetReviewItemId) => {
          const pending = await window.vicode.jobs.listPendingReviews();
          return pending.some((item) => item.id === targetReviewItemId);
        }, reviewItemId);
      })
      .toBe(true);

    await openAutomations(window);

    const reviewCard = window.getByTestId(`pending-review-card-${reviewItemId}`);
    await expect(reviewCard).toBeVisible();
    const editor = reviewCard.locator('textarea');
    await editor.fill('# Daily Workspace Note\n\n## Edited manually\n- Keep this custom review draft.');
    await expect(reviewCard.getByText('Edited locally')).toBeVisible();
    await reviewCard.getByRole('button', { name: 'Save draft changes' }).click();
    await expect(reviewCard.getByText('Edited locally')).toHaveCount(0);

    await reviewCard.getByRole('button', { name: 'Approve and write' }).click();
    await expect(reviewCard).toHaveCount(0);

    const pendingReviewStillExists = await window.evaluate(async (targetReviewItemId) => {
      const pending = await window.vicode.jobs.listPendingReviews();
      return pending.some((item) => item.id === targetReviewItemId);
    }, reviewItemId);
    expect(pendingReviewStillExists).toBe(false);

    await expect.poll(async () => {
      if (!expectedDailyNotePath) {
        return '';
      }
      try {
        return await readFile(expectedDailyNotePath, 'utf8');
      } catch {
        return '';
      }
    }).toContain('Keep this custom review draft.');
  } finally {
    if (window && reviewItemId) {
      try {
        await window.evaluate(async (targetReviewItemId) => {
          const pending = await window.vicode.jobs.listPendingReviews();
          const review = pending.find((item) => item.id === targetReviewItemId);
          if (review) {
            await window.vicode.jobs.rejectReview(review.id);
          }
        }, reviewItemId);
      } catch {
        // Best-effort cleanup only.
      }
    }
    if (window && projectId) {
      try {
        await window.evaluate(async (targetProjectId) => {
          const bootstrap = await window.vicode.app.getBootstrap();
          if (bootstrap.projects.some((project) => project.id === targetProjectId)) {
            await window.vicode.projects.remove(targetProjectId);
          }
        }, projectId);
      } catch {
        // Best-effort cleanup only.
      }
    }
    await closeApp(app);
  }
});
