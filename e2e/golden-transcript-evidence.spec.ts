import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { closeApp, dismissWelcomeIfVisible, launchApp, type LaunchStatePaths, waitForThreadSurfaceReady } from './helpers/electron';

const workspaceRoot = path.join(process.cwd(), 'test', '.e2e-workspaces', 'golden-transcript-evidence');

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
    const timeline = document.querySelector('.run-transcript-timeline');
    const failureSummary = Array.from(document.querySelectorAll('div, section, article'))
      .filter((element): element is HTMLElement =>
        element instanceof HTMLElement
        && element.textContent?.includes('No page files were written.') === true
        && element.getBoundingClientRect().width > 0
        && element.getBoundingClientRect().height > 0
      )
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
      })[0] ?? null;
    const lastTimelineItem =
      document.querySelector('.run-transcript-resolution-summary')
      ?? failureSummary
      ?? timeline?.lastElementChild
      ?? null;
    if (!(transcript instanceof HTMLElement) || !(composer instanceof HTMLElement) || !(lastTimelineItem instanceof HTMLElement)) {
      return null;
    }

    const transcriptRect = transcript.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    const lastItemRect = lastTimelineItem.getBoundingClientRect();

    return {
      transcriptBottom: transcriptRect.bottom,
      composerTop: composerRect.top,
      composerBottom: composerRect.bottom,
      lastItemBottom: lastItemRect.bottom,
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

test('completed threads render web research, MCP, skills, and sources as minimal evidence', async () => {
  const initial = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads']
  });

  const cleanupState = initial.cleanupState;
  const statePaths = initial.statePaths;
  let initialClosed = false;
  let dbPath: string | null = null;

  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `golden-${suffix}`);
    await mkdir(projectPath, { recursive: true });

    const seeded = await seedProjectAndThread(
      initial.window,
      `Golden transcript evidence ${suffix}`,
      projectPath,
      `Golden transcript evidence ${suffix}`
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
          started_at = '2026-05-24T13:00:00.000Z'
          skill_at = '2026-05-24T13:00:01.000Z'
          web_at = '2026-05-24T13:00:02.000Z'
          mcp_call_at = '2026-05-24T13:00:04.000Z'
          mcp_result_at = '2026-05-24T13:00:05.000Z'
          skill_creator_call_at = '2026-05-24T13:00:05.250Z'
          skill_creator_result_at = '2026-05-24T13:00:05.500Z'
          plugin_creator_call_at = '2026-05-24T13:00:05.750Z'
          helper_result_at = '2026-05-24T13:00:06.000Z'
          completed_at = '2026-05-24T13:00:07.000Z'
          run_id = 'run-golden-transcript-evidence'
          assistant_turn_id = str(uuid4())
          assistant_text = 'I used the attached research skill, checked current agent tooling references, and used the dashboard MCP snapshot.'
          assistant_metadata = {
            'sources': [
              {
                'url': 'https://example.com/vicode-agent-tooling',
                'title': 'Vicode Agent Tooling Note',
                'snippet': 'Reference note for concise coding-agent tool evidence.',
                'excerpt': 'Tool evidence should stay visible without raw backend noise.'
              }
            ]
          }

          connection.execute(
            "UPDATE threads SET status = ?, updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?",
            ('completed', completed_at, completed_at, assistant_text, thread_id)
          )
          connection.execute(
            "INSERT INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (assistant_turn_id, thread_id, run_id, 'assistant', assistant_text, json.dumps(assistant_metadata), completed_at)
          )
          events = [
            (str(uuid4()), thread_id, run_id, 'started', json.dumps({}), started_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'skill',
                'summary': 'qa-research-pack',
                'text': 'qa-research-pack',
                'toolName': None,
                'status': None,
                'providerEventType': 'skill_context'
              }
            }), skill_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'web_search',
                'phase': 'completed',
                'summary': 'Searched web for Vicode agent tooling',
                'query': 'Vicode agent tooling',
                'url': 'https://example.com/vicode-agent-tooling',
                'status': 'completed'
              }
            }), web_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'tool_call',
                'summary': 'Calling MCP tool dashboard_snapshot',
                'toolName': 'use_mcp_tool'
              }
            }), mcp_call_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'tool_result',
                'summary': 'Completed MCP tool dashboard_snapshot',
                'toolName': 'use_mcp_tool',
                'status': 'completed',
                'text': 'Returned dashboard data.'
              }
            }), mcp_result_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'tool_call',
                'summary': 'Calling create_skill_bundle',
                'toolName': 'create_skill_bundle',
                'text': 'folder_name: ux-review\\nscope: project\\nfiles: [{ "path": "SKILL.md" }]'
              }
            }), skill_creator_call_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'tool_result',
                'summary': 'Completed create_skill_bundle',
                'toolName': 'create_skill_bundle',
                'status': 'completed',
                'text': 'folder_name: ux-review'
              }
            }), skill_creator_result_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'tool_call',
                'summary': 'Calling create_plugin_bundle',
                'toolName': 'create_plugin_bundle',
                'text': 'folder_name: project-tools\\nscope: global\\nfiles: [{ "path": ".mcp.json" }]'
              }
            }), plugin_creator_call_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'tool_result',
                'summary': 'Completed spawn_subagents',
                'toolName': 'spawn_subagents',
                'status': 'completed',
                'text': 'tasks: [{ "title": "Verify settings copy" }]'
              }
            }), helper_result_at),
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

      const workedButton = relaunched.window.getByRole('button', { name: /Worked for 7s/i });
      await expect(workedButton).toBeVisible();
      await expect(relaunched.window.getByText('qa-research-pack')).toBeHidden();
      await workedButton.click();

      await expect(relaunched.window.getByText('qa-research-pack')).toBeVisible();
      const researchDetails = relaunched.window.getByText('1 research step');
      await expect(researchDetails).toBeVisible();
      await researchDetails.click();
      await expect(relaunched.window.getByText('Searched web for Vicode agent tooling')).toBeVisible();

      const toolDetails = relaunched.window.getByText('6 tool details');
      await expect(toolDetails).toBeVisible();
      await toolDetails.click();
      await expect(relaunched.window.getByText('Used MCP tool')).toBeVisible();
      await expect(relaunched.window.getByText('Returned dashboard data.')).toBeVisible();
      await expect(relaunched.window.getByText('Creating skill')).toBeVisible();
      await expect(relaunched.window.getByText('Created skill')).toBeVisible();
      await expect(relaunched.window.getByText('Creating plugin')).toBeVisible();
      await expect(relaunched.window.getByText('Started helper agents')).toBeVisible();
      await expect(relaunched.window.getByText('Skill folder: ux-review')).toBeVisible();
      await relaunched.window.getByText('Creating plugin').click();
      await expect(relaunched.window.getByText('Plugin folder: project-tools')).toBeVisible();
      await expect(relaunched.window.getByText('use_mcp_tool')).toHaveCount(0);
      await expect(relaunched.window.getByText('web_search')).toHaveCount(0);
      await expect(relaunched.window.getByText('create_skill_bundle')).toHaveCount(0);
      await expect(relaunched.window.getByText('create_plugin_bundle')).toHaveCount(0);
      await expect(relaunched.window.getByText('spawn_subagents')).toHaveCount(0);

      const sourcesButton = relaunched.window.getByRole('button', { name: 'Used 1 source' });
      await expect(sourcesButton).toBeVisible();
      await sourcesButton.click();
      await expect(relaunched.window.getByText('Vicode Agent Tooling Note')).toBeVisible();
      await expect(relaunched.window.getByText('Reference note for concise coding-agent tool evidence.')).toBeVisible();
      await expect(relaunched.window.getByRole('link', { name: /Vicode Agent Tooling Note/i })).toBeVisible();
      await expect(
        relaunched.window.getByText('I used the attached research skill, checked current agent tooling references, and used the dashboard MCP snapshot.')
      ).toBeVisible();
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

test('aborted threads collapse reasoning and tool evidence under worked summary', async () => {
  const initial = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads']
  });

  const cleanupState = initial.cleanupState;
  const statePaths = initial.statePaths;
  let initialClosed = false;
  let dbPath: string | null = null;

  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `reasoning-first-${suffix}`);
    await mkdir(projectPath, { recursive: true });

    const seeded = await seedProjectAndThread(
      initial.window,
      `Reasoning first timeline ${suffix}`,
      projectPath,
      `Reasoning first timeline ${suffix}`
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
          run_id = 'run-reasoning-first-timeline'
          user_turn_id = str(uuid4())
          assistant_turn_id = str(uuid4())
          started_at = '2026-05-24T14:00:00.000Z'
          tool_call_at = '2026-05-24T14:00:01.000Z'
          reasoning_at = '2026-05-24T14:00:02.000Z'
          tool_result_at = '2026-05-24T14:00:03.000Z'
          command_at = '2026-05-24T14:00:04.000Z'
          aborted_at = '2026-05-24T14:00:05.000Z'
          prompt = 'Show the running agent reasoning before tool evidence.'

          connection.execute(
            "UPDATE threads SET status = ?, updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?",
            ('aborted', aborted_at, started_at, prompt, thread_id)
          )
          connection.execute(
            "INSERT INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_turn_id, thread_id, run_id, 'user', prompt, json.dumps({}), started_at)
          )
          connection.execute(
            "INSERT INTO thread_turns (id, thread_id, run_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (assistant_turn_id, thread_id, run_id, 'assistant', '', json.dumps({}), command_at)
          )
          events = [
            (str(uuid4()), thread_id, run_id, 'started', json.dumps({}), started_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'tool_call',
                'summary': 'Calling run command',
                'toolName': 'run_command',
                'text': 'command: npm test'
              }
            }), tool_call_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'thinking',
                'summary': 'Inspecting run events before executing tools.',
                'text': 'Inspecting run events before executing tools.',
                'providerEventType': 'test_reasoning_delta'
              }
            }), reasoning_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'tool_result',
                'summary': 'Completed run command',
                'toolName': 'run_command',
                'status': 'completed',
                'text': 'exit_code: 0'
              }
            }), tool_result_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'activity': {
                'kind': 'terminal_command',
                'summary': 'Running npm test',
                'command': 'npm test',
                'phase': 'started'
              }
            }), command_at),
            (str(uuid4()), thread_id, run_id, 'aborted', json.dumps({ 'message': 'Run interrupted during seeded E2E.' }), aborted_at)
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

      const timeline = relaunched.window.locator('.run-transcript-timeline').first();
      const workedSummary = timeline.locator('.run-transcript-activity-group.is-worked-for-summary').first();
      await expect(workedSummary.getByText('Worked for 5s').first()).toBeVisible();
      await expect(workedSummary.getByText(/\d+ previous steps?/).first()).toBeVisible();
      await expect(timeline.getByText('Inspecting run events before executing tools.').first()).toBeHidden();

      const timelineText = await timeline.innerText();
      expect(timelineText.indexOf('Worked for 5s')).toBeGreaterThanOrEqual(0);
      expect(timelineText).not.toContain('Inspecting run events before executing tools.');
      expect(timelineText).not.toContain('command: npm test');

      await workedSummary.getByRole('button', { name: /Worked for 5s/ }).click();
      await expect(timeline.getByText('Inspecting run events before executing tools.').first()).toBeVisible();
      await expect(timeline.getByText(/\d+ tool details?/)).toHaveCount(0);
      await expect(timeline.getByText(/1 command|Running 1 command|Stopped 1 command|Ran 1 command/).first()).toBeVisible();

      const expandedTimelineText = await timeline.innerText();
      expect(expandedTimelineText.indexOf('Worked for 5s')).toBeLessThan(
        expandedTimelineText.indexOf('Inspecting run events before executing tools.')
      );
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

test('failed threads hide control-plane leakage while preserving readable failure summary', async () => {
  const initial = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads']
  });

  const cleanupState = initial.cleanupState;
  const statePaths = initial.statePaths;
  let initialClosed = false;
  let dbPath: string | null = null;

  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `control-plane-leakage-${suffix}`);
    await mkdir(projectPath, { recursive: true });

    const seeded = await seedProjectAndThread(
      initial.window,
      `Control plane leakage ${suffix}`,
      projectPath,
      `Control plane leakage ${suffix}`
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
          run_id = 'run-control-plane-leakage'
          started_at = '2026-05-24T15:00:00.000Z'
          reminder_at = '2026-05-24T15:00:01.000Z'
          diagnostic_at = '2026-05-24T15:00:02.000Z'
          failed_at = '2026-05-24T15:00:03.000Z'
          failure = 'No page files were written. Created only roofing-landing before the provider stopped.'
          reminder = 'Internal runtime reminder:\\nThe user asked for actual workspace changes.\\nIf the required edits are not complete yet, call the next relevant write-capable tool now.\\nTool result for read_file should stay model-only.'

          connection.execute(
            "UPDATE threads SET status = ?, updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?",
            ('failed', failed_at, failed_at, failure, thread_id)
          )
          events = [
            (str(uuid4()), thread_id, run_id, 'started', json.dumps({}), started_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'eventKind': 'internal_runtime_reminder',
              'transcriptVisible': False,
              'message': 'Prompting model to continue writing files.',
              'activity': {
                'kind': 'thinking',
                'summary': 'Prompting model to continue writing files.',
                'text': reminder,
                'providerEventType': 'ollama_tool_loop_thinking'
              }
            }), reminder_at),
            (str(uuid4()), thread_id, run_id, 'info', json.dumps({
              'eventKind': 'provider_diagnostic',
              'transcriptVisible': False,
              'providerDiagnostics': {
                'kind': 'provider_event_classification',
                'source': 'ollama_chat_json',
                'providerEventType': 'message/tool_calls',
                'itemType': 'raw_json_diagnostic',
                'itemKeys': ['rawPayload', 'stack'],
                'taskLike': False,
                'classification': 'unclassified'
              }
            }), diagnostic_at),
            (str(uuid4()), thread_id, run_id, 'failed', json.dumps({ 'message': failure }), failed_at)
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

      await expect(relaunched.window.getByText('No page files were written.')).toBeVisible();
      const visibleText = await relaunched.window.locator('body').innerText();
      expect(visibleText).not.toContain('Internal runtime reminder');
      expect(visibleText).not.toContain('write-capable tool');
      expect(visibleText).not.toContain('Tool result for');
      expect(visibleText).not.toContain('message/tool_calls');
      expect(visibleText).not.toContain('raw_json_diagnostic');

      const layout = await collectTranscriptLayoutMetrics(relaunched.window);
      expect(layout).not.toBeNull();
      expect(layout?.transcriptScrollWidth ?? 0).toBeLessThanOrEqual((layout?.transcriptClientWidth ?? 0) + 4);
      expect(layout?.composerBottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(layout?.viewportHeight ?? 0);
      expect(layout?.lastItemBottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(layout?.viewportHeight ?? 0);
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
