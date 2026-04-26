import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { closeApp, launchApp } from './helpers/electron';

const workspaceRoot = path.join(process.cwd(), 'test', '.e2e-workspaces', 'build-control-planner-timebox');

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
  await writeFile(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ name: 'build-control-planner-timebox', private: true }, null, 2),
    'utf-8'
  );
});

test.afterAll(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

test('stops a stale planner pass through the live Build Control watchdog @live-provider', async () => {
  const { app, window: launchedWindow } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.vicodeBuild'],
    timeoutMs: 60_000
  });

  const window = launchedWindow;

  try {
    const meta = await window.evaluate(() => window.vicode.app.getMeta());
    const statePath = meta.statePath;

    const seeded = await window.evaluate(async ({ workspaceRoot }) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const openai = bootstrap.providers.find((provider) => provider.id === 'openai');
      if (!openai || !openai.installed || openai.authState !== 'connected') {
        throw new Error('OpenAI must be connected for the planner-timebox live run.');
      }

      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const project = await window.vicode.projects.create({
        name: `Build control planner timebox ${suffix}`,
        folderPath: workspaceRoot,
        trusted: true
      });
      await window.vicode.settings.save({
        selectedProjectId: project.id,
        lastOpenedThreadId: null
      });

      const snapshot = await window.vicode.vicodeBuild.createPlan({
        projectId: project.id,
        name: 'Planner Timebox Validation',
        goal: 'Verify that planner-owned bounded passes stop truthfully when they exceed the watchdog without advancing the queue.',
        worktreePath: '.'
      });
      const team = snapshot.teams[0];
      if (!team) {
        throw new Error('Expected the build plan to create a planner/builder/finisher team.');
      }

      const plannerThread = await window.vicode.threads.create({
        projectId: project.id,
        title: `Vicode Build / ${team.label} / Planner`,
        providerId: 'openai',
        modelId:
          project.defaultModelByProvider.openai ??
          bootstrap.preferences.defaultModelByProvider.openai ??
          openai.models[0]?.id ??
          'gpt-5.4',
        executionPermission: 'full_access'
      });

      return {
        projectId: project.id,
        teamId: team.teamId,
        plannerThreadId: plannerThread.id,
        workspaceRoot
      };
    }, { workspaceRoot });

    runPythonSeed(
      `
        import json
        import sqlite3
        import sys
        from pathlib import Path
        from uuid import uuid4

        db_path, project_id, team_id, thread_id, workspace_root = sys.argv[1:6]
        queue_path = Path(workspace_root) / '.vicode' / 'control' / 'build-tickets' / f'{team_id}.json'
        queue_path.parent.mkdir(parents=True, exist_ok=True)
        queue_path.write_text(json.dumps({
          "version": 1,
          "goal": "Verify planner timebox behavior.",
          "updatedAt": "2026-03-30T00:00:00.000Z",
          "tickets": [
            {
              "id": "ticket-1",
              "title": "Planner bootstrap",
              "status": "in_progress",
              "ownerLane": "planner",
              "summary": "Planner still owns the bounded pass.",
              "updatedAt": "2026-03-30T00:00:00.000Z"
            }
          ]
        }, indent=2), encoding='utf-8')

        connection = sqlite3.connect(db_path)
        try:
          stale_at = '2026-03-30T00:00:00.000Z'
          now = '2026-03-30T00:05:00.000Z'
          connection.execute(
            "UPDATE threads SET status = ?, updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?",
            ('running', now, stale_at, 'Planner is still investigating the current bounded pass.', thread_id)
          )
          connection.execute(
            "INSERT OR REPLACE INTO vicode_build_lanes (project_id, team_id, lane_id, thread_id, paused, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (project_id, team_id, 'planner', thread_id, 0, now)
          )
          connection.execute(
            "INSERT INTO run_events (id, thread_id, run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (str(uuid4()), thread_id, 'planner-timebox-run', 'started', json.dumps({}), stale_at)
          )
          connection.commit()
        finally:
          connection.close()
      `,
      [
        path.join(statePath, 'vicode.sqlite'),
        seeded.projectId,
        seeded.teamId,
        seeded.plannerThreadId,
        seeded.workspaceRoot
      ]
    );

    await expect
      .poll(
        async () =>
          window.evaluate(
            async ({ projectId, teamId }) => {
              const snapshot = await window.vicode.vicodeBuild.getSnapshot(projectId);
              const team = snapshot.teams.find((entry) => entry.teamId === teamId) ?? null;
              const planner = team?.lanes.find((lane) => lane.laneId === 'planner') ?? null;
              return {
                teamStatus: team?.status ?? null,
                plannerStatus: planner?.status ?? null,
                recentEventSummaries: snapshot.recentEvents.map((event) => event.summary)
              };
            },
            { projectId: seeded.projectId, teamId: seeded.teamId }
          ),
        {
          timeout: 45_000,
          intervals: [2_000]
        }
      )
      .toMatchObject({
        teamStatus: 'attention',
        plannerStatus: 'cancelled'
      });

    const finalSnapshot = await window.evaluate(
      async ({ projectId }) => window.vicode.vicodeBuild.getSnapshot(projectId),
      { projectId: seeded.projectId }
    );
    expect(
      finalSnapshot.recentEvents.some((event) => event.summary.includes('bounded pass without advancing the queue'))
    ).toBe(true);
  } finally {
    await closeApp(app);
  }
});
