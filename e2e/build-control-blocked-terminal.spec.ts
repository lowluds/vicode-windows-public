import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { closeApp, launchApp } from './helpers/electron';

const workspaceRoot = path.join(process.cwd(), 'test', '.e2e-workspaces', 'build-control-blocked-terminal');

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
    JSON.stringify({ name: 'build-control-blocked-terminal', private: true }, null, 2),
    'utf-8'
  );
});

test.afterAll(async () => {
  await rm(workspaceRoot, { recursive: true, force: true });
});

test('keeps blocked finisher outcomes in attention without waking planner again', async () => {
  const { app, window: launchedWindow } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.settings', 'vicode.vicodeBuild']
  });

  const window = launchedWindow;

  try {
    const meta = await window.evaluate(() => window.vicode.app.getMeta());
    const statePath = meta.statePath;

    const seeded = await window.evaluate(async ({ workspaceRoot }) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const openai = bootstrap.providers.find((provider) => provider.id === 'openai');
      if (!openai || !openai.installed || openai.authState !== 'connected') {
        throw new Error('OpenAI must be connected for the blocked-terminal live run.');
      }

      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const project = await window.vicode.projects.create({
        name: `Build control blocked terminal ${suffix}`,
        folderPath: workspaceRoot,
        trusted: true
      });
      await window.vicode.settings.save({
        selectedProjectId: project.id,
        lastOpenedThreadId: null
      });

      const snapshot = await window.vicode.vicodeBuild.createPlan({
        projectId: project.id,
        name: 'Blocked Terminal Validation',
        goal: 'Verify that finisher-blocked plans stop truthfully instead of recycling planner.',
        worktreePath: '.'
      });
      const team = snapshot.teams[0];
      if (!team) {
        throw new Error('Expected a build-control team to be created.');
      }

      const finisherThread = await window.vicode.threads.create({
        projectId: project.id,
        title: `Vicode Build / ${team.label} / Finisher`,
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
        finisherThreadId: finisherThread.id
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
          "goal": "Verify blocked terminal behavior.",
          "updatedAt": "2026-03-30T00:00:00.000Z",
          "tickets": [
            {
              "id": "ticket-1",
              "title": "Planner bootstrap complete",
              "status": "done",
              "ownerLane": "planner",
              "summary": "Planner already handed off the bounded slice.",
              "updatedAt": "2026-03-30T00:00:00.000Z"
            },
            {
              "id": "ticket-2",
              "title": "Verification blocked in sibling worktree",
              "status": "blocked",
              "ownerLane": "builder",
              "summary": "Targeted tests cannot run because the execution worktree has no toolchain available.",
              "updatedAt": "2026-03-30T00:00:00.000Z"
            }
          ]
        }, indent=2), encoding='utf-8')

        connection = sqlite3.connect(db_path)
        try:
          now = '2026-03-30T00:05:00.000Z'
          connection.execute(
            "UPDATE threads SET status = ?, updated_at = ?, last_message_at = ?, last_preview = ? WHERE id = ?",
            ('completed', now, now, 'Finisher confirmed the active slice is blocked.', thread_id)
          )
          connection.execute(
            "INSERT OR REPLACE INTO vicode_build_lanes (project_id, team_id, lane_id, thread_id, paused, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (project_id, team_id, 'finisher', thread_id, 0, now)
          )
          connection.execute(
            "INSERT INTO run_events (id, thread_id, run_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (str(uuid4()), thread_id, 'finisher-blocked-run', 'completed', json.dumps({'message': 'Finisher confirmed the active slice is blocked.'}), now)
          )
          connection.commit()
        finally:
          connection.close()
      `,
      [
        path.join(statePath, 'vicode.sqlite'),
        seeded.projectId,
        seeded.teamId,
        seeded.finisherThreadId,
        workspaceRoot
      ]
    );

    const snapshot = await window.evaluate(
      async ({ projectId }) => window.vicode.vicodeBuild.getSnapshot(projectId),
      { projectId: seeded.projectId }
    );

    const team = snapshot.teams.find((entry) => entry.teamId === seeded.teamId) ?? null;
    const planner = team?.lanes.find((lane) => lane.laneId === 'planner') ?? null;
    const finisher = team?.lanes.find((lane) => lane.laneId === 'finisher') ?? null;

    expect(team).not.toBeNull();
    expect(team?.status).toBe('attention');
    expect(team?.activeTicketTitle).toBeNull();
    expect(team?.blockedTicketCount).toBeGreaterThan(0);
    expect(planner?.status ?? 'idle').not.toBe('running');
    expect(finisher?.status).toBe('completed');
  } finally {
    await closeApp(app);
  }
});
