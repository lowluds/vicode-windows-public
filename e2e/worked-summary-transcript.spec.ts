import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { closeApp, launchApp, type LaunchStatePaths } from './helpers/electron';

const workspaceRoot = path.join(process.cwd(), 'test', '.e2e-workspaces', 'worked-summary-transcript');

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

test('worked-for disclosure nests compact sources and exposes command details', async () => {
  const initial = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads']
  });

  const cleanupState = initial.cleanupState;
  const statePaths = initial.statePaths;
  let initialClosed = false;
  let dbPath: string | null = null;

  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `worked-${suffix}`);
    await mkdir(projectPath, { recursive: true });

    const seeded = await seedProjectAndThread(
      initial.window,
      `Worked summary ${suffix}`,
      projectPath,
      `Worked summary ${suffix}`
    );
    const meta = await initial.window.evaluate(() => window.vicode.app.getMeta());
    dbPath = path.join(meta.statePath, 'vicode.sqlite');

    await closeApp(initial.app, { cleanupState: false });
    initialClosed = true;

    const sources = [
      {
        url: 'https://example.com/source-1',
        title: 'Open-source finetuning guide',
        snippet: 'Fine-tuning tradeoffs for self-hosted models.',
        excerpt: null
      },
      {
        url: 'https://example.com/source-2',
        title: 'Model comparison',
        snippet: 'A benchmark comparison for smaller open-source models.',
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
          search_at = '2026-04-17T12:00:07.000Z'
          command_at = '2026-04-17T12:00:12.000Z'
          output_at = '2026-04-17T12:00:18.000Z'
          completed_at = '2026-04-17T12:00:27.000Z'
          run_id = 'run-worked-summary'
          assistant_turn_id = str(uuid4())
          assistant_text = 'Here are the strongest self-hosted options after checking recent guidance.'
          metadata = json.dumps({ 'sources': json.loads(sources_json) })

          connection.execute(
            "UPDATE threads SET status = ?, updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?",
            ('completed', completed_at, completed_at, assistant_text, thread_id)
          )
          connection.execute(
            "INSERT INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (assistant_turn_id, thread_id, run_id, 'assistant', assistant_text, metadata, completed_at)
          )
          events = [
            (str(uuid4()), thread_id, run_id, 'started', json.dumps({}), started_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'web_search',
                'summary': 'Calling research topic',
                'text': 'query: best open source LLM models for fine-tuning self-hosted Hugging Face 2026'
              }
            }), search_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'terminal_command',
                'summary': 'Running Select-String -Path src/renderer/components/AppSidebar.tsx',
                'command': "Select-String -Path src/renderer/components/AppSidebar.tsx,'src/renderer/components/ui/*.tsx' -Pattern 'Archive'",
                'cwd': 'D:/Workspace/vicode-windows',
                'isolationMode': 'host_job_object_temp_profile',
                'phase': 'started'
              }
            }), command_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'terminal_output',
                'summary': 'Archive references located',
                'text': "src/renderer/components/AppSidebar.tsx: import type { DragEvent } from 'react';",
                'outputLines': [
                  "src/renderer/components/AppSidebar.tsx: import type { DragEvent } from 'react';",
                  "src/renderer/components/AppSidebar.tsx: import { ActionButton, ConfirmDialog, DisclosureButton, IconButton } from './ui';"
                ]
              }
            }), output_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'terminal_command',
                'summary': 'Background terminal finished with Select-String -Path src/renderer/components/AppSidebar.tsx',
                'command': "Select-String -Path src/renderer/components/AppSidebar.tsx,'src/renderer/components/ui/*.tsx' -Pattern 'Archive'",
                'cwd': 'D:/Workspace/vicode-windows',
                'isolationMode': 'host_job_object_temp_profile',
                'phase': 'completed'
              }
            }), '2026-04-17T12:00:20.000Z'),
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
      [dbPath, seeded.threadId, JSON.stringify(sources)]
    );

    const relaunched = await restartWithState(statePaths, ['vicode.app', 'vicode.projects', 'vicode.threads']);
    try {
      await relaunched.window.getByTestId(`thread-row-${seeded.threadId}`).click();

      const workedButton = relaunched.window.getByRole('button', { name: /Worked for 27s/i });
      await expect(workedButton).toBeVisible();
      await expect(relaunched.window.getByRole('button', { name: 'Used 2 sources' })).toBeHidden();
      await workedButton.click();

      const compactSourcesButton = relaunched.window.getByRole('button', { name: 'Used 2 sources' });
      await expect(compactSourcesButton).toBeVisible();
      await compactSourcesButton.click();
      await expect(relaunched.window.getByText('Open-source finetuning guide')).toBeVisible();
      await expect(relaunched.window.getByText('Model comparison')).toBeVisible();

      const commandGroupDisclosure = relaunched.window.getByRole('button', { name: /Ran 1 command/i });
      await expect(commandGroupDisclosure).toBeVisible();
      await commandGroupDisclosure.click();

      const commandEntry = relaunched.window.locator('.run-transcript-command-entry').filter({ hasText: /Select-String/i }).first();
      await expect(commandEntry).toBeVisible();
      await commandEntry.getByRole('button').click();
      await expect(relaunched.window.getByText(/\$ Select-String -Path src\/renderer\/components\/AppSidebar\.tsx/i)).toBeVisible();
      await expect(relaunched.window.getByText(/src\/renderer\/components\/AppSidebar\.tsx: import type \{ DragEvent \} from 'react';/i)).toBeVisible();
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
