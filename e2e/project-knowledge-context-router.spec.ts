import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  closeApp,
  dismissWelcomeIfVisible,
  launchApp,
  type LaunchStatePaths,
  waitForThreadSurfaceReady
} from './helpers/electron';

const workspaceRoot = path.join(process.cwd(), 'test', '.e2e-workspaces', 'project-knowledge-context-router');

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
        throw new Error('Expected a provider for Project Knowledge E2E setup.');
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
        'qwen3-coder';

      const thread = await window.vicode.threads.create({
        projectId: project.id,
        title: threadTitle,
        providerId: provider.id,
        modelId,
        executionPermission: 'default'
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

async function collectTranscriptLayoutMetrics(window: Page) {
  return await window.evaluate(() => {
    const transcript = document.querySelector('.thread-transcript-rail, .thread-view');
    const composerInput = document.querySelector('[data-testid="composer-input"]');
    const composer =
      document.querySelector('.thread-composer-stack, .composer-stack')
      ?? composerInput?.closest('.thread-composer-stack, .composer-stack, form, section')
      ?? null;
    if (!(transcript instanceof HTMLElement) || !(composer instanceof HTMLElement)) {
      return null;
    }

    const composerRect = composer.getBoundingClientRect();

    return {
      composerBottom: composerRect.bottom,
      viewportHeight: window.innerHeight,
      transcriptScrollWidth: transcript.scrollWidth,
      transcriptClientWidth: transcript.clientWidth
    };
  });
}

test.beforeAll(async () => {
  await mkdir(workspaceRoot, { recursive: true });
});

test.afterAll(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

test('renders project knowledge router evidence without backend leakage', async ({}, testInfo) => {
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
      `Project Knowledge evidence ${suffix}`,
      projectPath,
      `Project Knowledge evidence ${suffix}`
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
          run_id = 'run-project-knowledge-context-router'
          started_at = '2026-06-02T12:00:00.000Z'
          context_at = '2026-06-02T12:00:01.000Z'
          skill_at = '2026-06-02T12:00:02.000Z'
          completed_at = '2026-06-02T12:00:08.000Z'
          assistant_turn_id = str(uuid4())
          assistant_text = 'I used the Project Knowledge router evidence and the attached reviewer skill.'

          connection.execute(
            "UPDATE threads SET status = ?, updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?",
            ('completed', completed_at, completed_at, assistant_text, thread_id)
          )
          connection.execute(
            "INSERT INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (assistant_turn_id, thread_id, run_id, 'assistant', assistant_text, json.dumps({}), completed_at)
          )
          events = [
            (str(uuid4()), thread_id, run_id, 'started', json.dumps({}), started_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'guidance',
                'summary': 'Context: Mobile Web Performance, Search And Retrieval',
                'text': 'Context: Mobile Web Performance, Search And Retrieval\\n- Router: built from prompt and task objective\\n- frontend/mobile.md > Mobile Web Performance: matched title, heading: mobile, frontend\\n- search.md > Search And Retrieval: matched explicit route',
                'path': 'C:/knowledge/frontend/mobile.md',
                'providerEventType': 'project_knowledge_context'
              }
            }), context_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'skill',
                'summary': 'Using: Reviewer',
                'text': 'Using: Reviewer\\n- Reviewer: auto-selected from prompt',
                'providerEventType': 'skills_using'
              }
            }), skill_at),
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
      await dismissWelcomeIfVisible(relaunched.window);
      await waitForThreadSurfaceReady(relaunched.window);
      await relaunched.window.getByTestId(`thread-row-${seeded.threadId}`).click();
      await waitForThreadSurfaceReady(relaunched.window);

      const contextDisclosure = relaunched.window.getByRole('button', { name: /previous steps/i });
      await expect(contextDisclosure).toBeVisible();
      await expect(relaunched.window.getByText('Context: Mobile Web Performance, Search And Retrieval')).toBeHidden();
      await contextDisclosure.click();

      await expect(relaunched.window.getByText('Context: Mobile Web Performance, Search And Retrieval')).toBeVisible();
      await expect(relaunched.window.getByText('Using: Reviewer')).toBeVisible();
      await relaunched.window.getByRole('button', { name: /Context: Mobile Web Performance, Search And Retrieval/i }).click();
      await expect(relaunched.window.getByText('Router: built from prompt and task objective')).toBeVisible();
      await expect(relaunched.window.getByText('frontend/mobile.md > Mobile Web Performance')).toBeVisible();
      await expect(relaunched.window.getByText('project_knowledge_search')).toHaveCount(0);
      await expect(relaunched.window.getByText('C:/knowledge/frontend/mobile.md')).toHaveCount(0);

      const layout = await collectTranscriptLayoutMetrics(relaunched.window);
      expect(layout).not.toBeNull();
      expect(layout?.transcriptScrollWidth ?? 0).toBeLessThanOrEqual(layout?.transcriptClientWidth ?? 0);
      expect(layout?.composerBottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(layout?.viewportHeight ?? 0);

      await relaunched.window.screenshot({
        path: testInfo.outputPath('project-knowledge-context-router.png'),
        fullPage: false
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
