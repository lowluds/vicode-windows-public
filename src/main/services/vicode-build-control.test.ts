import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEvent } from '../../shared/events';
import type { ComposerSubmitInput, ComposerSubmitResult } from '../../shared/domain';
import { DatabaseService } from '../../storage/database';
import { VicodeBuildControlService } from './vicode-build-control';

const tempDirs: string[] = [];

function createTempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(projectRoot: string) {
  const controlRoot = join(projectRoot, '.vicode', 'control');
  writeFileSync(
    join(projectRoot, 'package.json'),
    JSON.stringify({ name: 'vicode-build-test', private: true }, null, 2),
    'utf-8'
  );
  mkdirSync(controlRoot, { recursive: true });
  mkdirSync(join(controlRoot, 'build-prompts', 'core'), { recursive: true });
  writeFileSync(join(controlRoot, 'build-prompts', 'core', 'planner.md'), 'Planner prompt from repo-local file.', 'utf-8');
  writeFileSync(join(controlRoot, 'build-prompts', 'core', 'builder.md'), 'Builder prompt from repo-local file.', 'utf-8');
  writeFileSync(join(controlRoot, 'build-prompts', 'core', 'finisher.md'), 'Finisher prompt from repo-local file.', 'utf-8');
  writeFileSync(
    join(controlRoot, 'vicode-build-teams.json'),
    JSON.stringify(
      {
        version: 3,
        teams: [
          {
            id: 'core',
            label: 'Core',
            heartbeatPath: '.vicode/control/build-heartbeats/core.md',
            worktreePath: '.',
            lanes: {
              planner: { label: 'Planner', automationId: 'vicode-research-lead', promptPath: '.vicode/control/build-prompts/core/planner.md', skillIds: ['built-in-planner', 'built-in-concise'], providerId: 'openai', modelId: 'gpt-5.4', reasoningEffort: 'medium', executionPermission: 'full_access' },
              builder: { label: 'Builder', automationId: 'vicode-frontier-heartbeat', promptPath: '.vicode/control/build-prompts/core/builder.md', skillIds: ['built-in-concise'], providerId: 'openai', modelId: 'gpt-5.4', reasoningEffort: 'medium', executionPermission: 'full_access' },
              finisher: { label: 'Finisher', automationId: 'vicode-finisher', promptPath: '.vicode/control/build-prompts/core/finisher.md', skillIds: ['built-in-reviewer', 'built-in-concise'], providerId: 'openai', modelId: 'gpt-5.4', reasoningEffort: 'medium', executionPermission: 'full_access' }
            }
          }
        ]
      },
      null,
      2
    ),
    'utf-8'
  );
  mkdirSync(join(controlRoot, 'build-heartbeats'), { recursive: true });
  writeFileSync(
    join(controlRoot, 'build-heartbeats', 'core.md'),
    [
      '# Build Heartbeat',
      '',
      'Goal: Core',
      'Worktree: .',
      'Status: active',
      'Summary: Core build control is active.',
      '',
      '## Active Checklist',
      '- [ ] Keep planner slices bounded.',
      '- [ ] Wake finisher only after real changes.',
      '',
      '## Blockers',
      '- None.'
    ].join('\n'),
    'utf-8'
  );
  writeFileSync(
    join(controlRoot, 'update_build_ticket_queue.py'),
    [
      'import json',
      'import sys',
      '',
      'if __name__ == "__main__":',
      '    print(json.dumps({"ok": True, "argv": sys.argv[1:]}))'
    ].join('\n'),
    'utf-8'
  );
}

function seedPromptDefinitions(codexHome: string) {
  const automationsRoot = join(codexHome, 'automations');
  mkdirSync(automationsRoot, { recursive: true });

  const entries = [
    ['vicode-research-lead', 'Vicode Planner'],
    ['vicode-frontier-heartbeat', 'Vicode Builder'],
    ['vicode-finisher', 'Vicode Finisher']
  ] as const;

  for (const [automationId, name] of entries) {
    const dir = join(automationsRoot, automationId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'automation.toml'),
      [
        'version = 1',
        `id = "${automationId}"`,
        `name = "${name}"`,
        'prompt = "Execute one bounded lane slice. If you finish with a real promotable slice, run python .vicode/control/wake_automation.py --automation-id vicode-finisher --reason \\"handoff\\" before stopping so the finisher can review it immediately. Do not wake the finisher after a true no-op run."',
        'status = "PAUSED"',
        'model = "gpt-5.4"',
        'reasoning_effort = "medium"'
      ].join('\n'),
      'utf-8'
    );
  }
}

function writeQueue(projectRoot: string, teamId: string, tickets: Array<Record<string, unknown>>) {
  const queuePath = join(projectRoot, '.vicode', 'control', 'build-tickets', `${teamId}.json`);
  mkdirSync(join(projectRoot, '.vicode', 'control', 'build-tickets'), { recursive: true });
  writeFileSync(
    queuePath,
    JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        tickets
      },
      null,
      2
    ),
    'utf-8'
  );
}

function buildPromptForTest(goal: string) {
  return [
    'You are setting up a new Vicode build plan.',
    '',
    `Goal: ${goal}`,
    '',
    'Work only inside this setup thread.'
  ].join('\n');
}

afterEach(() => {
  vi.useRealTimers();
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('VicodeBuildControlService', () => {
  it('claims only dependency-satisfied builder tickets from the queue', () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    writeFileSync(join(projectRoot, 'AGENTS.md'), 'Use small diffs.', 'utf-8');
    writeFileSync(join(projectRoot, 'SOUL.md'), 'Stay sharp and practical.', 'utf-8');
    writeFileSync(join(projectRoot, 'USER.md'), 'Prefer concise explanations.', 'utf-8');
    writeFileSync(join(projectRoot, 'MEMORY.md'), 'Build Control tickets must stay bounded.', 'utf-8');
    mkdirSync(join(projectRoot, 'memory'), { recursive: true });
    writeFileSync(join(projectRoot, 'memory', '2026-04-02.md'), '# Daily Memory Log\n\n- Planner refined the bounded slice.', 'utf-8');
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    writeQueue(projectRoot, 'core', [
      {
        id: 'planner-1',
        title: 'Planner already shaped the first bounded slice',
        status: 'done',
        ownerLane: 'planner',
        summary: 'Planner finished the dependency ticket.',
        dependencies: [],
        targetPaths: [],
        acceptanceCriteria: [],
        verificationSteps: [],
        refs: [],
        stopWhen: null,
        updatedAt: new Date().toISOString()
      },
      {
        id: 'builder-1',
        title: 'Builder ticket still depends on a finisher result',
        status: 'todo',
        ownerLane: 'builder',
        summary: 'Do not claim until finisher-1 is done.',
        dependencies: ['finisher-1'],
        targetPaths: ['src/renderer/app.tsx'],
        acceptanceCriteria: ['Wait for finisher-1 to complete first.'],
        verificationSteps: ['Recheck the queue after finisher-1 lands.'],
        refs: [],
        stopWhen: 'The ticket is claimable without guessing.',
        updatedAt: new Date().toISOString()
      },
      {
        id: 'builder-2',
        title: 'Implement the first bounded slice',
        status: 'todo',
        ownerLane: 'builder',
        summary: 'This slice depends only on planner-1.',
        dependencies: ['planner-1'],
        targetPaths: ['src/main/startup.ts'],
        acceptanceCriteria: ['Land the bounded startup change.'],
        verificationSteps: ['Run the focused verification slice.'],
        refs: [],
        stopWhen: 'The bounded slice is implemented and verified.',
        updatedAt: new Date().toISOString()
      }
    ]);

    const service = new VicodeBuildControlService(appDb, {
      onEvent: () => () => undefined
    } as never);

    const context = (service as any).loadContext(project.id);
    expect(context.ok).toBe(true);
    const claimed = (service as any).claimLaneTicket(projectRoot, context.value.teams[0], 'builder') as {
      tickets: Array<{ id: string; status: string }>;
    };

    const active = claimed.tickets.find((ticket) => ticket.status === 'in_progress');
    expect(active?.id).toBe('builder-2');

    service.dispose();
    appDb.close();
  });

  it('parses structured checklist fields from the build queue', () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    writeQueue(projectRoot, 'core', [
      {
        id: 'builder-structured',
        title: 'Refresh Build Control prompts',
        status: 'in_progress',
        ownerLane: 'builder',
        summary: 'Builder is executing a structured checklist slice.',
        dependencies: ['planner-1'],
        targetPaths: ['src/main/services/vicode-build-control.ts', 'docs/engineering/WORKLOG.md'],
        acceptanceCriteria: ['Update the prompt copy.', 'Record the change in the worklog.'],
        verificationSteps: ['npm run build', 'npm test'],
        refs: ['docs/engineering/claude-code-adoption-plan.md'],
        stopWhen: 'Both files are updated and the verification steps are green.',
        updatedAt: new Date().toISOString()
      }
    ]);

    const service = new VicodeBuildControlService(appDb, {
      onEvent: () => () => undefined
    } as never);

    const context = (service as any).loadContext(project.id);
    expect(context.ok).toBe(true);
    const queue = (service as any).readTicketQueueState(projectRoot, context.value.teams[0]) as {
      tickets: Array<{
        dependencies: string[];
        targetPaths: string[];
        acceptanceCriteria: string[];
        verificationSteps: string[];
        refs: string[];
        stopWhen: string | null;
      }>;
    };

    expect(queue.tickets[0]?.dependencies).toEqual(['planner-1']);
    expect(queue.tickets[0]?.targetPaths).toEqual([
      'src/main/services/vicode-build-control.ts',
      'docs/engineering/WORKLOG.md'
    ]);
    expect(queue.tickets[0]?.acceptanceCriteria).toEqual([
      'Update the prompt copy.',
      'Record the change in the worklog.'
    ]);
    expect(queue.tickets[0]?.verificationSteps).toEqual(['npm run build', 'npm test']);
    expect(queue.tickets[0]?.refs).toEqual(['docs/engineering/claude-code-adoption-plan.md']);
    expect(queue.tickets[0]?.stopWhen).toBe('Both files are updated and the verification steps are green.');

    service.dispose();
    appDb.close();
  });

  it('surfaces dependency-held queue truth in the snapshot summary and lane guidance', () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const builderThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Builder',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.updateThreadStatus(builderThread.id, 'completed');
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'builder',
      threadId: builderThread.id,
      paused: false
    });

    writeQueue(projectRoot, 'core', [
      {
        id: 'planner-1',
        title: 'Validate current runtime behavior',
        status: 'todo',
        ownerLane: 'planner',
        summary: 'Planner still needs to confirm the current runtime behavior.',
        dependencies: [],
        targetPaths: ['src/shared/domain.ts'],
        acceptanceCriteria: ['Document the real runtime behavior.'],
        verificationSteps: ['Inspect the runtime contracts.'],
        refs: [],
        stopWhen: 'The planner can shape the next bounded slice without guessing.',
        updatedAt: new Date().toISOString()
      },
      {
        id: 'builder-1',
        title: 'Apply the bounded docs update',
        status: 'todo',
        ownerLane: 'builder',
        summary: 'Builder is waiting on planner research.',
        dependencies: ['planner-1'],
        targetPaths: ['README.md'],
        acceptanceCriteria: ['README is current.'],
        verificationSteps: ['Inspect the README.'],
        refs: [],
        stopWhen: 'The docs update is grounded in current runtime truth.',
        updatedAt: new Date().toISOString()
      }
    ]);

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );
    const snapshot = service.getSnapshot(project.id);
    const team = snapshot.teams[0]!;
    const builder = team.lanes.find((lane) => lane.laneId === 'builder');

    expect(team.ticketSummary).toContain('Ready: Validate current runtime behavior');
    expect(team.tickets.find((ticket) => ticket.id === 'builder-1')).toMatchObject({
      blockedByTicketIds: ['planner-1'],
      readyToClaim: false,
      active: false,
      ownerThreadId: builderThread.id
    });
    expect(builder?.recommendedAction).toContain('waiting on Validate current runtime behavior');

    service.dispose();
    appDb.close();
  });

  it('applies lane-specific execution constraints to snapshots and lane launches', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    writeQueue(projectRoot, 'core', []);

    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => ({
      disposition: 'started',
      thread: appDb.getThread(input.threadId!),
      runId: 'planner-constrained-run'
    } satisfies ComposerSubmitResult));

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer
      } as unknown as never,
      { codexHome }
    );

    const initial = service.getSnapshot(project.id);
    const plannerLane = initial.teams[0]?.lanes.find((lane) => lane.laneId === 'planner');
    const builderLane = initial.teams[0]?.lanes.find((lane) => lane.laneId === 'builder');
    const finisherLane = initial.teams[0]?.lanes.find((lane) => lane.laneId === 'finisher');

    expect(plannerLane?.executionConstraints).toMatchObject({
      permissionMode: 'plan',
      toolPolicy: {
        preset: 'build_planner'
      },
      maxTurns: 6
    });
    expect(builderLane?.executionConstraints).toMatchObject({
      permissionMode: 'default',
      toolPolicy: {
        preset: 'builder'
      },
      maxAutomaticRetries: 1
    });
    expect(finisherLane?.executionConstraints).toMatchObject({
      permissionMode: 'plan',
      toolPolicy: {
        preset: 'finisher'
      }
    });

    await service.wakeLane(project.id, 'core', 'planner');

    expect(submitComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        executionConstraints: expect.objectContaining({
          permissionMode: 'plan',
          toolPolicy: expect.objectContaining({
            preset: 'build_planner',
            disallowedToolCallNames: expect.arrayContaining(['apply_patch'])
          }),
          maxTurns: 6
        })
      })
    );

    service.dispose();
    appDb.close();
  });

  it('loads a snapshot from repo-local config and internal lane threads', () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const builderThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Builder',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.updateThreadStatus(builderThread.id, 'running');
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      paused: true
    });
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'builder',
      threadId: builderThread.id,
      paused: false
    });

    const providers = {
      onEvent: vi.fn(() => () => undefined),
      submitComposer: vi.fn()
    } as unknown as {
      onEvent: (listener: (event: unknown) => void) => () => void;
      submitComposer: (input: ComposerSubmitInput) => Promise<ComposerSubmitResult>;
    };

    const service = new VicodeBuildControlService(appDb, providers as never, { codexHome });
    const snapshot = service.getSnapshot(project.id);

    expect(snapshot.available).toBe(true);
    expect(snapshot.teams).toHaveLength(1);
    expect(snapshot.teams[0]?.heartbeatSummary).toBe('Core build control is active.');
    expect(snapshot.teams[0]?.heartbeatOpenItems).toContain('Keep planner slices bounded.');
    expect(snapshot.teams[0]?.lanes[0]?.status).toBe('paused');
    expect(snapshot.teams[0]?.lanes[0]?.skillNames).toEqual(['Planner', 'Concise']);
    expect(snapshot.teams[0]?.lanes[1]?.status).toBe('running');
    expect(snapshot.teams[0]?.lanes[1]?.threadTitle).toBe('Vicode Build / Core / Builder');
    service.dispose();
    appDb.close();
  });

  it('pauses and resumes a team in local lane state without mutating paused prompt definitions', () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    const providers = {
      onEvent: vi.fn(() => () => undefined),
      submitComposer: vi.fn()
    } as unknown as {
      onEvent: (listener: (event: unknown) => void) => () => void;
      submitComposer: (input: ComposerSubmitInput) => Promise<ComposerSubmitResult>;
    };

    const service = new VicodeBuildControlService(appDb, providers as never, { codexHome });
    service.setTeamPaused(project.id, 'core', true);

    const plannerState = appDb.getVicodeBuildLaneState(project.id, 'core', 'planner');
    expect(plannerState.paused).toBe(true);

    const automationToml = readFileSync(join(codexHome, 'automations', 'vicode-research-lead', 'automation.toml'), 'utf-8');
    expect(automationToml).toContain('status = "PAUSED"');
    service.dispose();
    appDb.close();
  });

  it('wakes a lane by creating a dedicated thread and launching a native Vicode run', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    writeFileSync(join(projectRoot, 'AGENTS.md'), 'Use small diffs.', 'utf-8');
    writeFileSync(join(projectRoot, 'SOUL.md'), 'Stay sharp and practical.', 'utf-8');
    writeFileSync(join(projectRoot, 'USER.md'), 'Prefer concise explanations.', 'utf-8');
    writeFileSync(join(projectRoot, 'MEMORY.md'), 'Build Control tickets must stay bounded.', 'utf-8');
    mkdirSync(join(projectRoot, 'memory'), { recursive: true });
    writeFileSync(join(projectRoot, 'memory', '2026-04-02.md'), '# Daily Memory Log\n\n- Planner refined the bounded slice.', 'utf-8');
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => {
      if (!input.threadId) {
        throw new Error('Expected build control to target a dedicated thread.');
      }
      appDb.updateThreadStatus(input.threadId, 'running');
      appDb.appendTurn(input.threadId, 'user', input.prompt);
      return {
        disposition: 'started',
        thread: appDb.getThread(input.threadId),
        runId: 'run-1'
      } satisfies ComposerSubmitResult;
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer
      } as unknown as never,
      { codexHome }
    );
    const snapshot = await service.wakeLane(project.id, 'core', 'planner');
    const planner = snapshot.teams[0]?.lanes.find((lane) => lane.laneId === 'planner');

    expect(submitComposer).toHaveBeenCalledTimes(1);
    expect(planner?.status).toBe('running');
    expect(planner?.threadTitle).toBe('Vicode Build / Core / Planner');
    expect(planner?.threadId).not.toBeNull();
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain('Planner prompt from repo-local file.');
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain(
      `Heartbeat file: ${join(projectRoot, '.vicode', 'control', 'build-heartbeats', 'core.md')}`
    );
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain(
      `Ticket queue helper: ${join(projectRoot, '.vicode', 'control', 'update_build_ticket_queue.py')}`
    );
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain(
      `Workspace contract files: ${join(projectRoot, 'AGENTS.md')} | ${join(projectRoot, 'SOUL.md')} | ${join(projectRoot, 'USER.md')} | ${join(projectRoot, 'MEMORY.md')} | ${join(projectRoot, 'memory', '2026-04-02.md')}`
    );
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain(
      'Use AGENTS.md as the operating contract. When completion or task meaning depends on project identity, user preference, or prior findings, consult SOUL.md, USER.md, MEMORY.md, and the newest daily note'
    );
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain(
      'Current active ticket: Validate the current repository state and identify the first bounded slice'
    );
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain(
      'Do not keep waking the same unchanged slice.'
    );
    expect(submitComposer.mock.calls[0]?.[0].skillIds).toEqual(['built-in-planner', 'built-in-concise']);
    expect(snapshot.recentEvents[0]?.kind).toBe('manual_wake');
    service.dispose();
    appDb.close();
  });

  it('claims the next todo ticket for a lane when that lane wakes', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);
    writeQueue(projectRoot, 'core', [
      {
        id: 'planner-1',
        title: 'Planner bootstrap complete',
        status: 'done',
        ownerLane: 'planner',
        summary: 'Initial queue bootstrap is done.',
        updatedAt: new Date().toISOString()
      },
      {
        id: 'builder-1',
        title: 'Implement the first bounded slice',
        status: 'todo',
        ownerLane: 'builder',
        summary: 'Builder should claim this ticket on wake.',
        updatedAt: new Date().toISOString()
      }
    ]);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn(async (input: ComposerSubmitInput) => ({
          disposition: 'started',
          thread: appDb.getThread(input.threadId!),
          runId: 'builder-claim-run'
        }))
      } as unknown as never,
      { codexHome }
    );

    await service.wakeLane(project.id, 'core', 'builder');
    const queue = JSON.parse(
      readFileSync(join(projectRoot, '.vicode', 'control', 'build-tickets', 'core.json'), 'utf-8')
    ) as { tickets: Array<{ id: string; status: string }> };

    expect(queue.tickets.find((ticket) => ticket.id === 'builder-1')?.status).toBe('in_progress');
    service.dispose();
    appDb.close();
  });

  it('creates a new build plan from a goal prompt and scaffolds repo-local lane prompts', () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const coreThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Planner',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.updateThreadStatus(coreThread.id, 'running');
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      threadId: coreThread.id,
      paused: false
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    const snapshot = service.createPlan(project.id, {
      goal: 'Build a minimal build-plan creator flow inside Vicode.',
      name: 'Build Plan Creator',
      worktreePath: '.'
    });

    const createdPlan = snapshot.teams.find((team) => team.teamId === 'build-plan-creator');
    expect(createdPlan?.goal).toBe('Build a minimal build-plan creator flow inside Vicode.');
    expect(createdPlan?.heartbeatPath).toBe('.vicode/control/build-heartbeats/build-plan-creator.md');
    expect(existsSync(join(projectRoot, '.vicode', 'control', 'build-prompts', 'build-plan-creator', 'planner.md'))).toBe(true);
    expect(existsSync(join(projectRoot, '.vicode', 'control', 'build-prompts', 'build-plan-creator', 'builder.md'))).toBe(true);
    expect(existsSync(join(projectRoot, '.vicode', 'control', 'build-prompts', 'build-plan-creator', 'finisher.md'))).toBe(true);
    expect(
      readFileSync(join(projectRoot, '.vicode', 'control', 'build-prompts', 'build-plan-creator', 'builder.md'), 'utf-8')
    ).toContain('Leave one short progress update in the thread if the slice will take longer than about a minute');
    expect(
      readFileSync(join(projectRoot, '.vicode', 'control', 'build-prompts', 'build-plan-creator', 'builder.md'), 'utf-8')
    ).toContain('Once the bounded slice is implemented, verified, and written back into the queue, stop promptly.');
    expect(
      readFileSync(join(projectRoot, '.vicode', 'control', 'build-prompts', 'build-plan-creator', 'planner.md'), 'utf-8')
    ).toContain('Populate structured queue fields whenever you shape a real slice');
    expect(existsSync(join(projectRoot, '.vicode', 'control', 'build-heartbeats', 'build-plan-creator.md'))).toBe(true);
    expect(existsSync(join(projectRoot, '.vicode', 'control', 'build-tickets', 'build-plan-creator.json'))).toBe(true);
    expect(createdPlan?.openTicketCount).toBeGreaterThanOrEqual(1);
    expect(createdPlan?.activeTicketTitle).toBe('Validate the current repository state and identify the first bounded slice');
    expect(createdPlan?.activeTicketOwnerLane).toBe('planner');
    expect(createdPlan?.ownedSliceSummary).toContain('Planner owns "Validate the current repository state and identify the first bounded slice"');
    expect(createdPlan?.tickets[0]?.acceptanceCriteria).toEqual([
      'Confirm the repository state that matters for the next slice.',
      'Shape one bounded next ticket with named target files or subsystem.'
    ]);
    expect(createdPlan?.tickets[0]?.verificationSteps).toEqual([
      'Read the current heartbeat and queue before broad exploration.'
    ]);
    expect(createdPlan?.tickets[0]?.stopWhen).toBe('The next builder-ready slice can be written without guessing.');
    expect(readFileSync(join(projectRoot, '.vicode', 'control', 'vicode-build-teams.json'), 'utf-8')).toContain('"controls"');
    service.dispose();
    appDb.close();
  });

  it('scaffolds dedicated-worktree plans into the execution root and wakes them with absolute artifact paths', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    const executionRoot = join(projectRoot, 'dedicated-worktree');
    mkdirSync(executionRoot, { recursive: true });
    writeFileSync(join(executionRoot, 'README.md'), '# Dedicated worktree', 'utf-8');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => {
      appDb.updateThreadStatus(input.threadId!, 'running');
      appDb.appendTurn(input.threadId!, 'user', input.prompt);
      return {
        disposition: 'started',
        thread: appDb.getThread(input.threadId!),
        runId: 'dedicated-worktree-run'
      } satisfies ComposerSubmitResult;
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer
      } as unknown as never,
      { codexHome }
    );

    service.createPlan(project.id, {
      goal: 'Clean up Build Control maintenance drift in Vicode.',
      name: 'Maintenance Cleanup',
      worktreePath: relative(projectRoot, executionRoot)
    });

    await service.wakeLane(project.id, 'maintenance-cleanup', 'planner');

    expect(existsSync(join(executionRoot, '.vicode', 'control', 'build-prompts', 'maintenance-cleanup', 'planner.md'))).toBe(true);
    expect(existsSync(join(executionRoot, '.vicode', 'control', 'build-heartbeats', 'maintenance-cleanup.md'))).toBe(true);
    expect(existsSync(join(executionRoot, '.vicode', 'control', 'build-tickets', 'maintenance-cleanup.json'))).toBe(true);
    expect(existsSync(join(executionRoot, '.vicode', 'control', 'update_build_ticket_queue.py'))).toBe(true);
    expect(submitComposer).toHaveBeenCalledTimes(1);
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain(
      `Prompt source: ${join(executionRoot, '.vicode', 'control', 'build-prompts', 'maintenance-cleanup', 'planner.md')}`
    );
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain(
      `Heartbeat file: ${join(executionRoot, '.vicode', 'control', 'build-heartbeats', 'maintenance-cleanup.md')}`
    );
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain(
      `Ticket queue helper: ${join(executionRoot, '.vicode', 'control', 'update_build_ticket_queue.py')}`
    );
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain('## Active Ticket Contract');
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain('The heartbeat and queue are the durable state contract for this build.');
    service.dispose();
    appDb.close();
  });

  it('bootstraps the control-plane support scripts into a fresh workspace during build-plan creation', () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);
    for (const fileName of [
      'archive_noop_automation_runs.py',
      'check_automation_gate.py',
      'check_queue_health.py',
      'promote_control_plane_changes.py',
      'promote_product_work_changes.py',
      'select_claimable_ticket.py',
      'team_config.py',
      'ticket_state.py',
      'update_build_ticket_queue.py',
      'wake_automation.py',
      'write_automation_status.py'
    ]) {
      rmSync(join(projectRoot, '.vicode', 'control', fileName), { force: true });
    }

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    service.createPlan(project.id, {
      goal: 'Create a fresh build plan without a pre-seeded queue helper.',
      name: 'Fresh Workspace Bootstrap',
      worktreePath: '.'
    });

    for (const fileName of [
      'archive_noop_automation_runs.py',
      'check_automation_gate.py',
      'check_queue_health.py',
      'promote_control_plane_changes.py',
      'promote_product_work_changes.py',
      'select_claimable_ticket.py',
      'team_config.py',
      'ticket_state.py',
      'update_build_ticket_queue.py',
      'wake_automation.py',
      'write_automation_status.py'
    ]) {
      expect(existsSync(join(projectRoot, '.vicode', 'control', fileName))).toBe(true);
    }
    service.dispose();
    appDb.close();
  });

  it('accepts add-style JSON and flexible flag payloads in the queue helper copied into live worktrees', () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);
    rmSync(join(projectRoot, '.vicode', 'control', 'update_build_ticket_queue.py'), { force: true });

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    service.createPlan(project.id, {
      goal: 'Create a fresh build plan without a pre-seeded queue helper.',
      name: 'Fresh Workspace Bootstrap',
      worktreePath: '.'
    });

    const queuePath = join(projectRoot, '.vicode', 'control', 'build-tickets', 'fresh-workspace-bootstrap.json');
    const helperPath = join(projectRoot, '.vicode', 'control', 'update_build_ticket_queue.py');
    const ticketPayload = JSON.stringify({
      id: 'ticket-2',
      ownerLane: 'Builder',
      summary: 'Update README.md to reflect build planner status',
      dependencies: [],
      targetPaths: ['README.md'],
      acceptanceCriteria: ['README.md should state the build planner is shipped and visible in the UI'],
      verificationSteps: ['Confirm README.md content matches AGENTS.md and STALE-DOCS-NOTES.md'],
      refs: [],
      stopWhen: 'README.md is updated with correct build planner status'
    });

    execFileSync('python', [helperPath, 'add', '--queue', queuePath, '--ticket', ticketPayload], {
      cwd: projectRoot,
      stdio: 'pipe'
    });

    execFileSync(
      'python',
      [
        helperPath,
        'create',
        '--queue',
        queuePath,
        '--title',
        'Refresh STALE-DOCS-NOTES.md to match current provider support',
        '--description',
        'Refresh STALE-DOCS-NOTES.md to match current provider support',
        '--summary',
        'Refresh STALE-DOCS-NOTES.md to match current provider support',
        '--targetPaths',
        'docs/engineering/STALE-DOCS-NOTES.md',
        '--acceptanceCriteria',
        'STALE-DOCS-NOTES.md matches the current provider and planner status',
        '--verificationSteps',
        'Read STALE-DOCS-NOTES.md after changes'
      ],
      {
        cwd: projectRoot,
        stdio: 'pipe'
      }
    );

    const queue = JSON.parse(readFileSync(queuePath, 'utf-8')) as {
      tickets: Array<{ id: string; title: string; ownerLane: string; status: string }>;
    };
    expect(queue.tickets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ticket-2',
          title: 'Update README.md to reflect build planner status',
          ownerLane: 'builder',
          status: 'todo'
        }),
        expect.objectContaining({
          title: 'Refresh STALE-DOCS-NOTES.md to match current provider support',
          ownerLane: 'builder',
          status: 'todo'
        })
      ])
    );

    service.dispose();
    appDb.close();
  });

  it('rejects build-plan creation for workspaces that only contain controller artifacts', () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    mkdirSync(join(projectRoot, '.vicode', 'control'), { recursive: true });
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    expect(() =>
      service.createPlan(project.id, {
        goal: 'Clarify Vicode review queue truth and blocked approval reasons.',
        name: 'Review Queue Truth',
        worktreePath: '.'
      })
    ).toThrow(/only contains controller artifacts or empty scaffolding/i);
    service.dispose();
    appDb.close();
  });

  it('surfaces structured verification failure reasons from non-zero helper exits', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const controlRoot = join(projectRoot, '.vicode', 'control');
    const okScript = [
      'import json',
      '',
      'if __name__ == "__main__":',
      '    print(json.dumps({"ok": True, "reason": "ok"}))'
    ].join('\n');
    const failingScript = [
      'import json',
      'import sys',
      '',
      'if __name__ == "__main__":',
      '    print(json.dumps({"ok": False, "reason": "source-dirty-overlap", "message": "Source repo has uncommitted control-plane changes in the promotion scope; refusing to promote."}))',
      '    raise SystemExit(3)'
    ].join('\n');

    for (const fileName of [
      'check_queue_health.py',
      'check_automation_gate.py',
      'archive_noop_automation_runs.py',
      'promote_product_work_changes.py'
    ]) {
      writeFileSync(join(controlRoot, fileName), okScript, 'utf-8');
    }
    writeFileSync(join(controlRoot, 'promote_control_plane_changes.py'), failingScript, 'utf-8');

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    const result = await service.runVerification(project.id);
    const promoteControl = result.steps.find((step) => step.label === 'Control-plane promote dry run');

    expect(promoteControl).toMatchObject({
      ok: false,
      summary: 'source-dirty-overlap',
      detail: 'Source repo has uncommitted control-plane changes in the promotion scope; refusing to promote.'
    });
    service.dispose();
    appDb.close();
  });

  it('treats fresh team scaffold overlap as expected pending review during control promotion verification', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const controlRoot = join(projectRoot, '.vicode', 'control');
    const okScript = [
      'import json',
      '',
      'if __name__ == "__main__":',
      '    print(json.dumps({"ok": True, "reason": "ok"}))'
    ].join('\n');

    for (const fileName of [
      'check_queue_health.py',
      'check_automation_gate.py',
      'archive_noop_automation_runs.py',
      'promote_product_work_changes.py'
    ]) {
      writeFileSync(join(controlRoot, fileName), okScript, 'utf-8');
    }

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    const snapshot = service.createPlan(project.id, {
      goal: 'Realign stale docs and verification notes.',
      name: 'Docs Maintenance',
      worktreePath: '.'
    });
    const team = snapshot.teams.find((entry) => entry.teamId === 'docs-maintenance');
    expect(team).toBeTruthy();

    const failingScript = [
      'import json',
      'import sys',
      '',
      'if __name__ == "__main__":',
      `    print(json.dumps({"ok": False, "reason": "source-dirty-overlap", "dirty_paths": [".vicode/control/vicode-build-teams.json", ".vicode/control/build-tickets/docs-maintenance.json", ".vicode/control/build-heartbeats/docs-maintenance.md", ".vicode/control/build-prompts/docs-maintenance/planner.md", ".vicode/control/build-prompts/docs-maintenance/builder.md", ".vicode/control/build-prompts/docs-maintenance/finisher.md"], "message": "Source repo has uncommitted control-plane changes in the promotion scope; refusing to promote."}))`,
      '    raise SystemExit(3)'
    ].join('\n');
    writeFileSync(join(controlRoot, 'promote_control_plane_changes.py'), failingScript, 'utf-8');

    try {
      const result = await service.runVerification(project.id);
      const promoteControl = result.steps.find(
        (step) => step.id === 'docs-maintenance:promote-control'
      );

      expect(promoteControl).toMatchObject({
        ok: true,
        summary: 'scaffold-pending-review',
        detail:
          'Fresh build-plan control artifacts for this team are present in the source worktree. Control-plane promotion is correctly deferred until the lane finishes or review resolves those scaffold changes.'
      });
    } finally {
      service.dispose();
      appDb.close();
    }
  });

  it('enriches queue health verification with the current blocking ticket relationship', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const controlRoot = join(projectRoot, '.vicode', 'control');
    writeFileSync(
      join(controlRoot, 'check_queue_health.py'),
      [
        'import json',
        '',
        'if __name__ == "__main__":',
        '    print(json.dumps({"ok": False, "reason": "queue-blocked", "message": "Queue has stalled work items."}))'
      ].join('\n'),
      'utf-8'
    );
    const okScript = [
      'import json',
      '',
      'if __name__ == "__main__":',
      '    print(json.dumps({"ok": True, "reason": "ok"}))'
    ].join('\n');
    for (const fileName of [
      'check_automation_gate.py',
      'archive_noop_automation_runs.py',
      'promote_control_plane_changes.py',
      'promote_product_work_changes.py'
    ]) {
      writeFileSync(join(controlRoot, fileName), okScript, 'utf-8');
    }

    writeQueue(projectRoot, 'core', [
      {
        id: 'planner-1',
        title: 'Audit current runtime behavior',
        ownerLane: 'planner',
        status: 'in_progress',
        summary: 'Confirm how the current runtime behaves before rewriting the slice.',
        dependencies: [],
        verificationSteps: ['Capture the current behavior.']
      },
      {
        id: 'builder-1',
        title: 'Implement the first bounded slice',
        ownerLane: 'builder',
        status: 'todo',
        summary: 'Land the first bounded change after the planner pass.',
        dependencies: ['planner-1'],
        verificationSteps: ['Run the targeted tests.']
      }
    ]);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    try {
      const result = await service.runVerification(project.id);
      const queueHealth = result.steps.find((step) => step.id === 'core:queue-health');

      expect(queueHealth).toMatchObject({
        ok: false,
        summary: 'queue-blocked',
        detail:
          'Queue has stalled work items. Current bounded queue state: "Implement the first bounded slice" is waiting on Audit current runtime behavior.'
      });
    } finally {
      service.dispose();
      appDb.close();
    }
  });

  it('clears inactive build plans from repo-local config and scaffold files', () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const coreThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Planner',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.updateThreadStatus(coreThread.id, 'running');
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      threadId: coreThread.id,
      paused: false
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    service.createPlan(project.id, {
      goal: 'Clean up inactive build plans in Vicode.',
      name: 'Inactive Build Plan',
      worktreePath: '.'
    });

    const snapshot = service.clearInactivePlans(project.id);
    expect(snapshot.teams.map((team) => team.teamId)).toEqual(['core']);
    expect(existsSync(join(projectRoot, '.vicode', 'control', 'build-prompts', 'inactive-build-plan'))).toBe(false);
    expect(existsSync(join(projectRoot, '.vicode', 'control', 'build-tickets', 'inactive-build-plan.json'))).toBe(false);
    service.dispose();
    appDb.close();
  });

  it('generates a build plan draft from a plain-language goal', () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    const draft = service.generatePlanDraft(project.id, 'Create a goal-first build control flow inside Vicode.');

    expect(draft.controlId.startsWith('create-a-goal-first-build-control-flow')).toBe(true);
    expect(draft.name).toBe('Create a goal-first build control flow inside Vicode');
    expect(draft.worktreePath).toBe('.');
    expect(draft.heartbeatPath).toBe('.vicode/control/build-heartbeats/create-a-goal-first-build-control-flow-inside-vi.md');
    expect(draft.laneSummaries.planner).toContain('bounded slice');
    expect(draft.laneSkillIds.planner).toEqual(['built-in-concise', 'built-in-planner']);
    expect(draft.laneSkillNames.finisher).toEqual(['Concise', 'Reviewer']);
    expect(draft.lanePrompts.planner).toContain('Create a goal-first build control flow inside Vicode.');
    expect(draft.lanePrompts.planner).toContain('Own the ticket queue');
    expect(draft.reasoningEffort).toBe('medium');
    expect(draft.lanePrompts.planner).toContain('Treat the current planner ticket as a bounded planning pass');
    expect(draft.lanePrompts.planner).toContain('Aim to finish this planner pass after one short targeted repo check');
    expect(draft.lanePrompts.planner).toContain('A builder-ready ticket must name the target files or subsystem');
    expect(draft.lanePrompts.planner).toContain('If you cannot name target files, expected code change, and verification');
    expect(draft.lanePrompts.builder).toContain('Target worktree: .');
    expect(draft.lanePrompts.builder).toContain('Use the latest planner thread, heartbeat summary, and ticket queue');
    expect(draft.lanePrompts.finisher).toContain('Prefer deterministic verification and concrete blocker reporting');
    service.dispose();
    appDb.close();
  });

  it('creates a build plan from a setup thread and reuses that thread as the planner lane', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const setupThread = appDb.createThread({
      projectId: project.id,
      title: 'Build plan setup / Silent build queue autonomy',
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      executionPermission: 'full_access'
    });

    appDb.appendTurn(
      setupThread.id,
      'user',
      [
        'You are setting up a new Vicode build plan.',
        '',
        'Goal: Make Vicode silently reconcile stale memory and review writes so the user does not need to click through queue noise.',
        '',
        'Work only inside this setup thread.'
      ].join('\n')
    );
    appDb.appendTurn(
      setupThread.id,
      'assistant',
      'Planner draft is ready.'
    );
    appDb.setThreadPlannerMode(setupThread.id, 'plan');
    appDb.createPlannerPlan(
      setupThread.id,
      appDb.getThread(setupThread.id).turns.at(-1)!.id,
      [
        '# Silent Build Queue Autonomy## SummaryTarget outcome: Remove stale review noise',
        '',
        '- Remove stale review noise while keeping explicit automation approvals visible.',
        '- Reconcile stale pending review items on startup.'
      ].join('\n'),
      {
        title: 'Silent Build Queue Autonomy## SummaryTarget outcome: Remove stale review noise',
        summary: ['Remove stale review noise while keeping explicit automation approvals visible.'],
        keyChanges: ['Reconcile stale pending review items on startup.'],
        testPlan: ['Verify stale pending review items are auto-reconciled on startup.'],
        assumptions: ['Explicit automation approvals must stay visible.']
      }
    );
    appDb.updateThreadStatus(setupThread.id, 'completed');

    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => {
      if (!input.threadId) {
        throw new Error('Expected planner launch to reuse the setup thread.');
      }
      appDb.updateThreadStatus(input.threadId, 'running');
      appDb.appendTurn(input.threadId, 'user', input.prompt);
      if (input.runMode === 'plan') {
        appDb.setThreadPlannerMode(input.threadId, 'plan');
        appDb.setThreadPlannerTurnState(input.threadId, 'generating_plan');
      }
      return {
        disposition: 'started',
        thread: appDb.getThread(input.threadId),
        runId: 'planner-run-from-thread'
      } satisfies ComposerSubmitResult;
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer
      } as unknown as never,
      { codexHome }
    );

    const snapshot = await service.createPlanFromThread(setupThread.id);
    const createdPlan = snapshot.teams.find((team) =>
      team.goal.includes('silently reconcile stale memory and review writes')
    );
    const planner = createdPlan?.lanes.find((lane) => lane.laneId === 'planner');
    const reboundThread = appDb.getThread(setupThread.id);

    expect(submitComposer).toHaveBeenCalledTimes(1);
    expect(planner?.threadId).toBe(setupThread.id);
    expect(planner?.status).toBe('running');
    expect(reboundThread.title).toBe(
      'Vicode Build / Make Vicode silently reconcile stale memory and review wr... / Planner'
    );
    expect(reboundThread.planner.composerMode).toBe('default');
    expect(reboundThread.planner.turnState).toBe('idle');
    expect(reboundThread.planner.activePlan).toBeNull();
    expect(submitComposer.mock.calls[0]?.[0].threadId).toBe(setupThread.id);
    expect(submitComposer.mock.calls[0]?.[0].providerId).toBe('ollama');
    expect(submitComposer.mock.calls[0]?.[0].modelId).toBe('qwen3-coder');
    expect(submitComposer.mock.calls[0]?.[0].runMode).toBe('default');
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain('Goal: Make Vicode silently reconcile stale memory and review writes');
    expect(
      existsSync(join(projectRoot, '.vicode', 'control', 'build-prompts', createdPlan!.teamId, 'planner.md'))
    ).toBe(true);
    expect(readFileSync(join(projectRoot, '.vicode', 'control', 'vicode-build-teams.json'), 'utf-8')).toContain(
      `"${createdPlan!.teamId}"`
    );
    service.dispose();
    appDb.close();
  });

  it('rejects setup threads that do not have a structured planner draft yet', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const setupThread = appDb.createThread({
      projectId: project.id,
      title: 'Build plan setup / Queue autonomy',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.appendTurn(setupThread.id, 'user', buildPromptForTest('Fix Vicode queue noise.'));
    appDb.updateThreadStatus(setupThread.id, 'completed');

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    await expect(service.createPlanFromThread(setupThread.id)).rejects.toThrow(/planner draft/i);
    service.dispose();
    appDb.close();
  });

  it('anchors build-plan scope to the original freeform setup prompt when the planner title is generic', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const setupThread = appDb.createThread({
      projectId: project.id,
      title: 'Build plan setup / Docs maintenance',
      providerId: 'ollama',
      modelId: 'rnj-1:8b',
      executionPermission: 'full_access'
    });

    appDb.appendTurn(
      setupThread.id,
      'user',
      [
        'Audit this Vicode workspace for stale documentation and propose a bounded maintenance build plan.',
        'Compare README.md and docs/engineering/STALE-DOCS-NOTES.md against the current docs and verification sources.',
        'This is documentation-only work.'
      ].join(' '),
      {
        composerMode: 'plan',
        plannerPhase: 'request'
      }
    );
    appDb.createPlannerPlan(
      setupThread.id,
      appDb.appendTurn(
        setupThread.id,
        'assistant',
        [
          '# Maintenance Plan for vicode-windows',
          '',
          '## Summary',
          '- Do a maintenance pass for the repo.',
          '',
          '## Key Changes',
          '- Update the necessary files.',
          '',
          '## Test Plan',
          '- Verify the docs look right.'
        ].join('\n'),
        {
          plannerArtifactType: 'plan',
          plannerNative: true,
          plannerProvider: 'ollama'
        }
      ).id,
      [
        '# Maintenance Plan for vicode-windows',
        '',
        '## Summary',
        '- Do a maintenance pass for the repo.',
        '',
        '## Key Changes',
        '- Update the necessary files.',
        '',
        '## Test Plan',
        '- Verify the docs look right.'
      ].join('\n'),
      {
        title: 'Maintenance Plan for vicode-windows',
        summary: ['Do a maintenance pass for the repo.'],
        keyChanges: ['Update the necessary files.'],
        testPlan: ['Verify the docs look right.'],
        assumptions: []
      }
    );
    appDb.updateThreadStatus(setupThread.id, 'completed');

    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => ({
      disposition: 'started',
      thread: appDb.getThread(input.threadId ?? setupThread.id),
      runId: 'planner-run-from-thread'
    }) satisfies ComposerSubmitResult);

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer
      } as unknown as never,
      { codexHome }
    );

    const snapshot = await service.createPlanFromThread(setupThread.id);
    const createdPlan = snapshot.teams.find((team) => team.teamId !== 'core');

    expect(createdPlan?.goal).toContain('stale documentation');
    expect(createdPlan?.goal).toContain('bounded maintenance build plan');
    expect(createdPlan?.label).not.toMatch(/^maintenance plan/i);
    expect(submitComposer.mock.calls[0]?.[0].providerId).toBe('ollama');
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain('Goal: Audit this Vicode workspace for stale documentation');

    service.dispose();
    appDb.close();
  });

  it('rejects duplicate build plans for the same label and worktree', () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    service.createPlan(project.id, {
      goal: 'Fix Vicode stale build and review queue noise',
      name: 'Fix Vicode stale build and review queue noise',
      worktreePath: '.'
    });

    expect(() =>
      service.createPlan(project.id, {
        goal: 'Fix Vicode stale build and review queue noise',
        name: 'Fix Vicode stale build and review queue noise',
        worktreePath: '.'
      })
    ).toThrow(/already exists/i);
    service.dispose();
    appDb.close();
  });

  it('rejects overlapping active build plans before a duplicate maintenance pass starts', () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    service.createPlan(project.id, {
      goal: 'Clean Vicode build-control maintenance drift, archive stale docs, and remove dead plan artifacts.',
      name: 'Maintenance Cleanup',
      worktreePath: '.'
    });

    expect(() =>
      service.createPlan(project.id, {
        goal: 'Clean Vicode build-control maintenance drift, archive stale docs, and remove dead plan artifacts.',
        name: 'Maintenance Cleanup Pass 2',
        worktreePath: './dedicated-worktree'
      })
    ).toThrow(/planner owns "validate the current repository state and identify the first bounded slice"/i);
    service.dispose();
    appDb.close();
  });

  it('surfaces overlap-held plans as waiting instead of generic paused', () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    service.createPlan(project.id, {
      goal: 'Clarify Vicode review queue truth and blocked approval reasons.',
      name: 'Review Queue Truth',
      worktreePath: '.'
    });

    writeFileSync(
      join(projectRoot, '.vicode', 'control', 'build-heartbeats', 'review-queue-truth.md'),
      [
        '# Build Heartbeat',
        '',
        'Goal: Review Queue Truth',
        'Worktree: .',
        'Status: paused',
        'Summary: Waiting on an existing overlapping slice.',
        '',
        '## Active Checklist',
        '- [ ] Wait for the existing jobs.ts slice to land or stall.',
        '',
        '## Blockers',
        '- Overlapping builder work already owns the current review-queue slice.'
      ].join('\n'),
      'utf-8'
    );
    appDb.addVicodeBuildEvent({
      projectId: project.id,
      teamId: 'review-queue-truth',
      laneId: 'planner',
      kind: 'auto_handoff_skipped',
      trigger: 'system',
      summary: 'Planner completed, but the plan heartbeat is paused.',
      detail:
        "Repository state validated. This pass overlaps an already-active builder slice in '.vicode/control/build-tickets/silent-review-queue-cons-istency.json' that is modifying 'src/main/services/jobs.ts'. Keep this pass paused to avoid duplicate builder work until that overlapping slice lands or clearly stalls."
    });

    const snapshot = service.getSnapshot(project.id);
    expect(snapshot.teams[0]?.status).toBe('waiting');
    expect(snapshot.teams[0]?.heartbeatStatus).toBe('paused');
    expect(snapshot.teams[0]?.openTicketCount).toBeGreaterThan(0);
    service.dispose();
    appDb.close();
  });

  it('records config_mismatch when a lane prompt source cannot be resolved', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);
    rmSync(join(projectRoot, '.vicode', 'control', 'build-prompts', 'core', 'planner.md'), { force: true });
    rmSync(join(codexHome, 'automations', 'vicode-research-lead', 'automation.toml'), { force: true });

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    await expect(service.wakeLane(project.id, 'core', 'planner')).rejects.toThrow(/lane prompt definition not found/i);
    const snapshot = service.getSnapshot(project.id);
    expect(snapshot.recentEvents[0]?.kind).toBe('config_mismatch');
    expect(snapshot.recentEvents[0]?.summary).toContain('Planner could not start');
    service.dispose();
    appDb.close();
  });

  it('surfaces long-running lanes as stalled in Build Control snapshots', () => {
    vi.useFakeTimers();
    const baseTime = new Date('2026-03-30T00:00:00.000Z');
    vi.setSystemTime(baseTime);

    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const plannerThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Planner',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.updateThreadStatus(plannerThread.id, 'running');
    appDb.appendTurn(plannerThread.id, 'assistant', 'Planner is investigating the current ticket.');
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      threadId: plannerThread.id,
      paused: false
    });

    vi.setSystemTime(new Date(baseTime.getTime() + 125_000));

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    const snapshot = service.getSnapshot(project.id);
    const team = snapshot.teams[0]!;
    const planner = team.lanes.find((lane) => lane.laneId === 'planner')!;

    expect(team.status).toBe('attention');
    expect(planner.status).toBe('running');
    expect(planner.blockedReason).toContain('running without a visible update');
    expect(planner.recommendedAction).toContain('stalled run');
    expect(planner.recentEvents[0]?.kind).toBe('run_stalled');
    service.dispose();
    appDb.close();
  });

  it('names the downstream ticket when a stalled lane is blocking dependency-held work', () => {
    vi.useFakeTimers();
    const baseTime = new Date('2026-03-30T00:00:00.000Z');
    vi.setSystemTime(baseTime);

    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);
    writeQueue(projectRoot, 'core', [
      {
        id: 'planner-1',
        title: 'Validate current runtime behavior',
        status: 'in_progress',
        ownerLane: 'planner',
        summary: 'Planner is validating the current repository state.',
        updatedAt: baseTime.toISOString()
      },
      {
        id: 'builder-1',
        title: 'Implement the first bounded slice',
        status: 'todo',
        ownerLane: 'builder',
        summary: 'Builder is waiting on planner research.',
        dependencies: ['planner-1'],
        updatedAt: baseTime.toISOString()
      }
    ]);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const plannerThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Planner',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.updateThreadStatus(plannerThread.id, 'running');
    appDb.appendTurn(plannerThread.id, 'assistant', 'Planner is investigating the current ticket.');
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      threadId: plannerThread.id,
      paused: false
    });

    vi.setSystemTime(new Date(baseTime.getTime() + 125_000));

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    const snapshot = service.getSnapshot(project.id);
    const planner = snapshot.teams[0]!.lanes.find((lane) => lane.laneId === 'planner')!;

    expect(planner.blockedReason).toContain('Validate current runtime behavior');
    expect(planner.recentEvents[0]?.detail).toContain('"Implement the first bounded slice" is waiting on "Validate current runtime behavior".');
    service.dispose();
    appDb.close();
  });

  it('does not mark a lane stalled when provider run events are still arriving', () => {
    vi.useFakeTimers();
    const baseTime = new Date('2026-03-30T00:00:00.000Z');
    vi.setSystemTime(baseTime);

    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const plannerThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Planner',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.updateThreadStatus(plannerThread.id, 'running');
    appDb.addRunEvent(plannerThread.id, 'planner-run-1', 'started', {});
    appDb.appendTurn(plannerThread.id, 'assistant', 'Planner is investigating the current ticket.');
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      threadId: plannerThread.id,
      paused: false
    });

    vi.setSystemTime(new Date(baseTime.getTime() + 125_000));
    appDb.addRunEvent(plannerThread.id, 'planner-run-1', 'progress', { message: 'Still validating bounded repo truth.' });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    const snapshot = service.getSnapshot(project.id);
    const planner = snapshot.teams[0]!.lanes.find((lane) => lane.laneId === 'planner')!;

    expect(snapshot.teams[0]?.status).toBe('active');
    expect(planner.blockedReason).toBeNull();
    expect(planner.recentEvents[0]?.kind).not.toBe('run_stalled');
    service.dispose();
    appDb.close();
  });

  it('keeps repeated planner failures on the active ticket in attention state', () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);
    writeQueue(projectRoot, 'core', [
      {
        id: 'ticket-1',
        title: 'Narrow the review queue truth slice',
        status: 'in_progress',
        ownerLane: 'planner',
        summary: 'Planner should turn this into one builder-ready change.',
        updatedAt: new Date().toISOString()
      }
    ]);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const plannerThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Planner',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.updateThreadStatus(plannerThread.id, 'running');
    appDb.appendTurn(plannerThread.id, 'assistant', 'Planner is retrying the active ticket.');
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      threadId: plannerThread.id,
      paused: false
    });
    appDb.addVicodeBuildEvent({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      kind: 'run_failed',
      trigger: 'system',
      summary: 'Planner ended without a clean completion.',
      detail: 'Run stopped by user.'
    });
    appDb.addVicodeBuildEvent({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      kind: 'run_failed',
      trigger: 'system',
      summary: 'Planner ended without a clean completion.',
      detail: 'Codex CLI exited with code 1 after producing partial output.'
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    const snapshot = service.getSnapshot(project.id);
    expect(snapshot.teams[0]?.status).toBe('attention');
    expect(snapshot.teams[0]?.lanes[0]?.blockedReason).toContain('stalled or failed multiple times');
    expect(snapshot.teams[0]?.lanes[0]?.recommendedAction).toContain('split or rewrite');
    service.dispose();
    appDb.close();
  });

  it('retries a stalled lane by stopping the active run and restarting it', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const plannerThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Planner',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.updateThreadStatus(plannerThread.id, 'running');
    appDb.addRunEvent(plannerThread.id, 'planner-run-1', 'started', {});
    appDb.appendTurn(plannerThread.id, 'assistant', 'Planner is still investigating the current ticket.');
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      threadId: plannerThread.id,
      paused: false
    });

    const stopRun = vi.fn(async () => {
      appDb.addRunEvent(plannerThread.id, 'planner-run-1', 'aborted', { message: 'Run stopped by user.' });
      appDb.updateThreadStatus(plannerThread.id, 'aborted');
    });
    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => {
      appDb.updateThreadStatus(input.threadId!, 'running');
      appDb.appendTurn(input.threadId!, 'user', input.prompt);
      return {
        disposition: 'started',
        thread: appDb.getThread(input.threadId!),
        runId: 'planner-run-2'
      } satisfies ComposerSubmitResult;
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer,
        stopRun
      } as unknown as never,
      { codexHome }
    );

    await service.retryLane(project.id, 'core', 'planner');

    expect(stopRun).toHaveBeenCalledWith('planner-run-1');
    expect(submitComposer).toHaveBeenCalledTimes(1);
    expect(appDb.getThread(plannerThread.id).status).toBe('running');
    const snapshot = service.getSnapshot(project.id);
    expect(snapshot.teams[0]?.lanes.find((lane) => lane.laneId === 'planner')?.lastWakeReason).toContain('Retried Planner');

    service.dispose();
    appDb.close();
  });

  it('recovers a stalled planner handoff by stopping planner and waking builder', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T12:00:00.000Z'));

    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);
    writeQueue(projectRoot, 'core', [
      {
        id: 'ticket-1',
        title: 'Planner bootstrap',
        status: 'done',
        ownerLane: 'planner',
        summary: 'Planner already validated the first slice.',
        updatedAt: new Date().toISOString()
      },
      {
        id: 'ticket-2',
        title: 'Builder slice',
        status: 'in_progress',
        ownerLane: 'builder',
        summary: 'Builder should take over, but planner never exited.',
        updatedAt: new Date().toISOString()
      }
    ]);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const plannerThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Planner',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.updateThreadStatus(plannerThread.id, 'running');
    appDb.addRunEvent(plannerThread.id, 'planner-run-handoff-drift', 'started', {});
    appDb.appendTurn(plannerThread.id, 'assistant', 'Planner advanced the queue but is still running.');
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      threadId: plannerThread.id,
      paused: false
    });

    vi.setSystemTime(new Date('2026-03-30T12:03:00.000Z'));

    const stopRun = vi.fn(async () => {
      appDb.addRunEvent(plannerThread.id, 'planner-run-handoff-drift', 'aborted', { message: 'Recovered stalled handoff.' });
      appDb.updateThreadStatus(plannerThread.id, 'aborted');
    });
    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => {
      appDb.updateThreadStatus(input.threadId!, 'running');
      appDb.appendTurn(input.threadId!, 'user', input.prompt);
      return {
        disposition: 'started',
        thread: appDb.getThread(input.threadId!),
        runId: 'builder-run-recovered'
      } satisfies ComposerSubmitResult;
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer,
        stopRun
      } as unknown as never,
      { codexHome }
    );

    await (service as { sweepRecoverableHandoffs: () => Promise<void> }).sweepRecoverableHandoffs();

    expect(stopRun).toHaveBeenCalledWith('planner-run-handoff-drift');
    expect(submitComposer).toHaveBeenCalledTimes(1);

    const snapshot = service.getSnapshot(project.id);
    const planner = snapshot.teams[0]?.lanes.find((lane) => lane.laneId === 'planner');
    const builder = snapshot.teams[0]?.lanes.find((lane) => lane.laneId === 'builder');
    expect(snapshot.teams[0]?.status).toBe('active');
    expect(planner?.status).toBe('cancelled');
    expect(planner?.blockedReason).toBeNull();
    expect(planner?.recommendedAction).toContain('Builder is already active');
    expect(builder?.status).toBe('running');
    expect(builder?.lastWakeReason).toContain('Recovered a stalled planner handoff and woke Builder');

    service.dispose();
    appDb.close();
  });

  it('blocks builder from starting when the active ticket targets source-root files outside the worktree', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);
    mkdirSync(join(projectRoot, 'docs-worktree'), { recursive: true });
    writeFileSync(join(projectRoot, 'docs-worktree', 'README.md'), '# docs worktree\n', 'utf-8');

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer: vi.fn()
      } as unknown as never,
      { codexHome }
    );

    service.createPlan(project.id, {
      goal: 'Audit stale docs in a bounded maintenance worktree.',
      name: 'Docs Worktree Maintenance',
      worktreePath: 'docs-worktree'
    });

    writeQueue(join(projectRoot, 'docs-worktree'), 'docs-worktree-maintenance', [
      {
        id: 'ticket-1',
        title: 'Planner bootstrap',
        status: 'done',
        ownerLane: 'planner',
        summary: 'Planner already shaped the next slice.',
        updatedAt: new Date().toISOString()
      },
      {
        id: 'ticket-2',
        title: 'Remove orphaned entries from .vicode/control/vicode-build-teams.json',
        status: 'in_progress',
        ownerLane: 'builder',
        summary: 'Edit .vicode/control/vicode-build-teams.json to remove stale maintenance-live entries, then verify the queue stays valid.',
        updatedAt: new Date().toISOString()
      }
    ]);

    await expect(
      service.wakeLane(project.id, 'docs-worktree-maintenance', 'builder')
    ).rejects.toThrow(/source-root files outside the worktree/i);

    const snapshot = service.getSnapshot(project.id);
    expect(snapshot.recentEvents[0]?.kind).toBe('config_mismatch');
    expect(snapshot.recentEvents[0]?.detail).toContain('.vicode/control/vicode-build-teams.json');

    service.dispose();
    appDb.close();
  });

  it('stops a stalled planner pass that still owns the active ticket', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T12:00:00.000Z'));

    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);
    writeQueue(projectRoot, 'core', [
      {
        id: 'ticket-1',
        title: 'Planner bootstrap',
        status: 'in_progress',
        ownerLane: 'planner',
        summary: 'Planner still owns the bounded pass.',
        updatedAt: new Date().toISOString()
      }
    ]);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const plannerThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Planner',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.updateThreadStatus(plannerThread.id, 'running');
    appDb.addRunEvent(plannerThread.id, 'planner-run-bounded-pass', 'started', {});
    appDb.appendTurn(plannerThread.id, 'assistant', 'Planner is still investigating the first bounded slice.');
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      threadId: plannerThread.id,
      paused: false
    });

    vi.setSystemTime(new Date('2026-03-30T12:03:00.000Z'));

    const stopRun = vi.fn(async () => {
      appDb.addRunEvent(plannerThread.id, 'planner-run-bounded-pass', 'aborted', { message: 'Planner pass stopped by Build Control.' });
      appDb.updateThreadStatus(plannerThread.id, 'aborted');
    });
    const submitComposer = vi.fn();

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer,
        stopRun
      } as unknown as never,
      { codexHome }
    );

    await (service as { sweepControllerRecovery: () => Promise<void> }).sweepControllerRecovery();

    expect(stopRun).toHaveBeenCalledWith('planner-run-bounded-pass');
    expect(submitComposer).not.toHaveBeenCalled();

    const snapshot = service.getSnapshot(project.id);
    const planner = snapshot.teams[0]?.lanes.find((lane) => lane.laneId === 'planner');
    expect(planner?.status).toBe('cancelled');
    expect(snapshot.teams[0]?.status).toBe('attention');
    expect(snapshot.recentEvents.some((event) => event.summary.includes('bounded pass without advancing the queue'))).toBe(true);

    service.dispose();
    appDb.close();
  });

  it('retries a stale builder ticket once when target file evidence shows partial progress', async () => {
    vi.useFakeTimers();
    const baseTime = new Date('2026-03-30T12:00:00.000Z');
    vi.setSystemTime(baseTime);

    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);
    mkdirSync(join(projectRoot, 'docs', 'engineering'), { recursive: true });
    writeFileSync(join(projectRoot, 'README.md'), '# stale\n', 'utf-8');
    writeFileSync(join(projectRoot, 'docs', 'engineering', 'STALE-DOCS-NOTES.md'), '# stale notes\n', 'utf-8');
    utimesSync(join(projectRoot, 'README.md'), new Date(baseTime.getTime() - 60_000), new Date(baseTime.getTime() - 60_000));
    utimesSync(
      join(projectRoot, 'docs', 'engineering', 'STALE-DOCS-NOTES.md'),
      new Date(baseTime.getTime() - 60_000),
      new Date(baseTime.getTime() - 60_000)
    );
    writeQueue(projectRoot, 'core', [
      {
        id: 'builder-1',
        title: 'Rewrite README and stale docs notes',
        status: 'in_progress',
        ownerLane: 'builder',
        summary: 'Builder owns the docs slice.',
        targetPaths: ['README.md', 'docs/engineering/STALE-DOCS-NOTES.md'],
        updatedAt: baseTime.toISOString()
      }
    ]);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const builderThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Builder',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.updateThreadStatus(builderThread.id, 'running');
    appDb.appendTurn(builderThread.id, 'status', 'Lane run starting with queue snapshot.', {
      laneControlMarker: 'build-controller:core:builder',
      buildQueueMarker: 'lane_run_start',
      buildQueueSignature: JSON.stringify([
        {
          id: 'builder-1',
          status: 'in_progress',
          ownerLane: 'builder',
          title: 'Rewrite README and stale docs notes'
        }
      ]),
      buildActiveTicketId: 'builder-1'
    });
    appDb.addRunEvent(builderThread.id, 'builder-run-partial', 'started', {});
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'builder',
      threadId: builderThread.id,
      paused: false
    });

    vi.setSystemTime(new Date(baseTime.getTime() + 30_000));
    writeFileSync(join(projectRoot, 'README.md'), '# updated\n', 'utf-8');
    utimesSync(
      join(projectRoot, 'README.md'),
      new Date(baseTime.getTime() + 30_000),
      new Date(baseTime.getTime() + 30_000)
    );

    vi.setSystemTime(new Date(baseTime.getTime() + 4 * 60_000));

    const stopRun = vi.fn(async () => {
      appDb.addRunEvent(builderThread.id, 'builder-run-partial', 'aborted', { message: 'Builder stopped by Build Control.' });
      appDb.updateThreadStatus(builderThread.id, 'aborted');
    });
    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => {
      appDb.updateThreadStatus(input.threadId!, 'running');
      appDb.appendTurn(input.threadId!, 'user', input.prompt);
      return {
        disposition: 'started',
        thread: appDb.getThread(input.threadId!),
        runId: 'builder-run-retry'
      } satisfies ComposerSubmitResult;
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer,
        stopRun
      } as unknown as never,
      { codexHome }
    );

    const partialStall = (
      service as unknown as {
        resolveActiveRunId: (thread: ThreadDetail) => string | null;
        readLatestLaneQueueRunMarker: (
          thread: ThreadDetail,
          teamId: string,
          laneId: 'builder'
        ) => { activeTicketId: string | null; startedAt: string | null };
        deriveTicketProgressSince: (
          projectRoot: string,
          team: { worktreeRoot: string },
          ticket: { targetPaths: string[] },
          startedAt: string | null
        ) => { touchedPaths: string[]; remainingPaths: string[] };
        findRecoverablePartialTicketStall: (
          projectRoot: string,
          team: { id: string; worktreeRoot: string },
          laneStates: Map<string, unknown>,
          recentEvents: Array<unknown>
        ) => unknown;
        loadContext: (projectId: string) => { ok: true; value: { projectRoot: string; teams: Array<{ id: string; worktreeRoot: string }> } };
      }
    );
    const context = partialStall.loadContext(project.id);
    const laneStates = new Map(
      appDb
        .listVicodeBuildLaneStates(project.id)
        .map((state) => [`${state.teamId}:${state.laneId}`, state])
    );
    const builderDetail = appDb.getThread(builderThread.id);
    const queueMarker = partialStall.readLatestLaneQueueRunMarker(builderDetail, 'core', 'builder');
    expect(partialStall.resolveActiveRunId(builderDetail)).toBe('builder-run-partial');
    expect(queueMarker.activeTicketId).toBe('builder-1');
    expect(
      partialStall.deriveTicketProgressSince(
        context.value.projectRoot,
        context.value.teams[0]!,
        { targetPaths: ['README.md', 'docs/engineering/STALE-DOCS-NOTES.md'] },
        queueMarker.startedAt
      )
    ).toMatchObject({
      touchedPaths: ['README.md'],
      remainingPaths: ['docs/engineering/STALE-DOCS-NOTES.md']
    });
    expect(
      partialStall.findRecoverablePartialTicketStall(
        context.value.projectRoot,
        context.value.teams[0]!,
        laneStates,
        appDb.listVicodeBuildEvents({ projectId: project.id, limit: 60 }).map((event) => ({
          ...event,
          laneId: event.laneId,
          teamId: event.teamId
        }))
      )
    ).not.toBeNull();

    await (service as { sweepControllerRecovery: () => Promise<void> }).sweepControllerRecovery();

    expect(stopRun).toHaveBeenCalledWith('builder-run-partial');
    expect(submitComposer).toHaveBeenCalledTimes(1);
    expect(submitComposer.mock.calls[0]?.[0].threadId).toBe(builderThread.id);
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain('Recovery guidance:');
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain('README.md');
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain('docs/engineering/STALE-DOCS-NOTES.md');

    const queue = JSON.parse(
      readFileSync(join(projectRoot, '.vicode', 'control', 'build-tickets', 'core.json'), 'utf-8')
    ) as { tickets: Array<{ id: string; status: string }> };
    expect(queue.tickets.find((ticket) => ticket.id === 'builder-1')?.status).toBe('in_progress');
    expect(service.getSnapshot(project.id).recentEvents.some((event) => event.summary.includes('partial progress'))).toBe(true);

    service.dispose();
    appDb.close();
  });

  it('blocks a repeatedly stale partial builder ticket and hands it back to planner', async () => {
    vi.useFakeTimers();
    const baseTime = new Date('2026-03-30T12:00:00.000Z');
    vi.setSystemTime(baseTime);

    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);
    mkdirSync(join(projectRoot, 'docs', 'engineering'), { recursive: true });
    writeFileSync(join(projectRoot, 'README.md'), '# stale\n', 'utf-8');
    writeFileSync(join(projectRoot, 'docs', 'engineering', 'STALE-DOCS-NOTES.md'), '# stale notes\n', 'utf-8');
    utimesSync(join(projectRoot, 'README.md'), new Date(baseTime.getTime() - 60_000), new Date(baseTime.getTime() - 60_000));
    utimesSync(
      join(projectRoot, 'docs', 'engineering', 'STALE-DOCS-NOTES.md'),
      new Date(baseTime.getTime() - 60_000),
      new Date(baseTime.getTime() - 60_000)
    );
    writeQueue(projectRoot, 'core', [
      {
        id: 'builder-1',
        title: 'Rewrite README and stale docs notes',
        status: 'in_progress',
        ownerLane: 'builder',
        summary: 'Builder owns the docs slice.',
        targetPaths: ['README.md', 'docs/engineering/STALE-DOCS-NOTES.md'],
        updatedAt: baseTime.toISOString()
      }
    ]);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const builderThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Builder',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.updateThreadStatus(builderThread.id, 'running');
    appDb.appendTurn(builderThread.id, 'status', 'Lane run starting with queue snapshot.', {
      laneControlMarker: 'build-controller:core:builder',
      buildQueueMarker: 'lane_run_start',
      buildQueueSignature: JSON.stringify([
        {
          id: 'builder-1',
          status: 'in_progress',
          ownerLane: 'builder',
          title: 'Rewrite README and stale docs notes'
        }
      ]),
      buildActiveTicketId: 'builder-1'
    });
    appDb.addRunEvent(builderThread.id, 'builder-run-partial-repeat', 'started', {});
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'builder',
      threadId: builderThread.id,
      paused: false
    });
    appDb.addVicodeBuildEvent({
      projectId: project.id,
      teamId: 'core',
      laneId: 'builder',
      kind: 'run_stalled',
      trigger: 'system',
      summary: 'Builder stalled after partial progress on "Rewrite README and stale docs notes".',
      detail: 'Ticket id: builder-1 | Touched: README.md | Remaining: docs/engineering/STALE-DOCS-NOTES.md'
    });

    vi.setSystemTime(new Date(baseTime.getTime() + 30_000));
    writeFileSync(join(projectRoot, 'README.md'), '# updated\n', 'utf-8');
    utimesSync(
      join(projectRoot, 'README.md'),
      new Date(baseTime.getTime() + 30_000),
      new Date(baseTime.getTime() + 30_000)
    );

    vi.setSystemTime(new Date(baseTime.getTime() + 4 * 60_000));

    const stopRun = vi.fn(async () => {
      appDb.addRunEvent(builderThread.id, 'builder-run-partial-repeat', 'aborted', { message: 'Builder stopped by Build Control.' });
      appDb.updateThreadStatus(builderThread.id, 'aborted');
    });
    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => {
      appDb.updateThreadStatus(input.threadId!, 'running');
      appDb.appendTurn(input.threadId!, 'user', input.prompt);
      return {
        disposition: 'started',
        thread: appDb.getThread(input.threadId!),
        runId: 'planner-run-rewrite'
      } satisfies ComposerSubmitResult;
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn(() => () => undefined),
        submitComposer,
        stopRun
      } as unknown as never,
      { codexHome }
    );

    await (service as { sweepControllerRecovery: () => Promise<void> }).sweepControllerRecovery();

    expect(stopRun).toHaveBeenCalledWith('builder-run-partial-repeat');
    expect(submitComposer).toHaveBeenCalledTimes(1);
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain('Builder stalled twice after partial progress');

    const queue = JSON.parse(
      readFileSync(join(projectRoot, '.vicode', 'control', 'build-tickets', 'core.json'), 'utf-8')
    ) as {
      tickets: Array<{ id: string; status: string; ownerLane: string; summary?: string; refs?: string[] }>;
    };
    expect(queue.tickets.find((ticket) => ticket.id === 'builder-1')?.status).toBe('blocked');
    expect(queue.tickets.find((ticket) => ticket.id === 'builder-1')?.summary).toContain('Remaining: docs/engineering/STALE-DOCS-NOTES.md');
    expect(queue.tickets.find((ticket) => ticket.id === 'builder-1-planner-recovery')).toMatchObject({
      status: 'in_progress',
      ownerLane: 'planner'
    });

    const snapshot = service.getSnapshot(project.id);
    const planner = snapshot.teams[0]?.lanes.find((lane) => lane.laneId === 'planner');
    expect(planner?.status).toBe('running');
    expect(snapshot.recentEvents.some((event) => event.summary.includes('handed back to Planner'))).toBe(true);

    service.dispose();
    appDb.close();
  });

  it('hands planner completion to the finisher when a promotable slice lands', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const plannerThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Planner',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      threadId: plannerThread.id,
      paused: false
    });

    const runId = 'planner-run-1';
    appDb.addRunEvent(plannerThread.id, runId, 'info', {
      activity: {
        changeArtifact: {
          summary: { filesChanged: 2 },
          files: [{ path: 'src/main/ipc.ts' }, { path: 'src/preload/index.ts' }]
        }
      }
    });
    appDb.addRunEvent(plannerThread.id, runId, 'completed', { message: 'Planner slice finished.' });
    appDb.updateThreadStatus(plannerThread.id, 'completed');

    let providerListener: ((event: AppEvent) => void) | null = null;
    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => {
      if (!input.threadId) {
        throw new Error('Expected handoff to target a dedicated finisher thread.');
      }
      appDb.updateThreadStatus(input.threadId, 'running');
      appDb.appendTurn(input.threadId, 'user', input.prompt);
      return {
        disposition: 'started',
        thread: appDb.getThread(input.threadId),
        runId: 'finisher-run-1'
      } satisfies ComposerSubmitResult;
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn((listener: (event: AppEvent) => void) => {
          providerListener = listener;
          return () => {
            providerListener = null;
          };
        }),
        submitComposer
      } as unknown as never,
      { codexHome }
    );

    providerListener?.({ type: 'run.status', threadId: plannerThread.id, runId, status: 'completed' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = service.getSnapshot(project.id);
    const finisher = snapshot.teams[0]?.lanes.find((lane) => lane.laneId === 'finisher');

    expect(submitComposer).toHaveBeenCalledTimes(1);
    expect(finisher?.status).toBe('running');
    expect(finisher?.threadTitle).toBe('Vicode Build / Core / Finisher');
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain('Finisher prompt from repo-local file.');
    expect(finisher?.lastWakeReason).toContain('woke Finisher');
    service.dispose();
    appDb.close();
  });

  it('hands planner completion to the builder when the planner only changes planning artifacts', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const plannerThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Planner',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      threadId: plannerThread.id,
      paused: false
    });

    const runId = 'planner-run-planning-artifacts';
    appDb.addRunEvent(plannerThread.id, runId, 'info', {
      activity: {
        changeArtifact: {
          summary: { filesChanged: 2 },
          files: [
            { path: '.vicode/control/build-heartbeats/core.md' },
            { path: '.vicode/control/build-prompts/core/planner.md' }
          ]
        }
      }
    });
    appDb.addRunEvent(plannerThread.id, runId, 'completed', { message: 'Planner refined the next slice contract.' });
    appDb.updateThreadStatus(plannerThread.id, 'completed');

    let providerListener: ((event: AppEvent) => void) | null = null;
    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => {
      if (!input.threadId) {
        throw new Error('Expected builder handoff to target a dedicated thread.');
      }
      appDb.updateThreadStatus(input.threadId, 'running');
      appDb.appendTurn(input.threadId, 'user', input.prompt);
      return {
        disposition: 'started',
        thread: appDb.getThread(input.threadId),
        runId: 'builder-run-planning-artifacts'
      } satisfies ComposerSubmitResult;
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn((listener: (event: AppEvent) => void) => {
          providerListener = listener;
          return () => {
            providerListener = null;
          };
        }),
        submitComposer
      } as unknown as never,
      { codexHome }
    );

    providerListener?.({ type: 'run.status', threadId: plannerThread.id, runId, status: 'completed' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = service.getSnapshot(project.id);
    const builder = snapshot.teams[0]?.lanes.find((lane) => lane.laneId === 'builder');
    const finisher = snapshot.teams[0]?.lanes.find((lane) => lane.laneId === 'finisher');

    expect(submitComposer).toHaveBeenCalledTimes(1);
    expect(builder?.status).toBe('running');
    expect(builder?.lastWakeReason).toContain('woke Builder');
    expect(finisher?.status).toBe('idle');
    service.dispose();
    appDb.close();
  });

  it('hands planner completion to the builder when the queue now points at a builder ticket', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);
    writeQueue(projectRoot, 'core', [
      {
        id: 'planner-1',
        title: 'Shape the first Gemini repro slice',
        status: 'done',
        ownerLane: 'planner',
        summary: 'Planner completed the repro design.',
        updatedAt: new Date().toISOString()
      },
      {
        id: 'builder-1',
        title: 'Implement the Gemini repro and timing harness',
        status: 'todo',
        ownerLane: 'builder',
        summary: 'Builder should take over from queue state.',
        updatedAt: new Date().toISOString()
      }
    ]);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const plannerThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Planner',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.appendTurn(plannerThread.id, 'status', 'Lane run starting with queue snapshot.', {
      laneControlMarker: 'build-controller:core:planner',
      buildQueueMarker: 'lane_run_start',
      buildQueueSignature: JSON.stringify([
        {
          id: 'planner-1',
          status: 'in_progress',
          ownerLane: 'planner',
          title: 'Shape the first Gemini repro slice',
          summary: 'Planner owns this before handing off.'
        }
      ]),
      buildActiveTicketId: 'planner-1'
    });
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      threadId: plannerThread.id,
      paused: false
    });

    const runId = 'planner-run-queue-directed';
    appDb.addRunEvent(plannerThread.id, runId, 'completed', { message: 'Planner advanced the ticket queue.' });
    appDb.updateThreadStatus(plannerThread.id, 'completed');

    let providerListener: ((event: AppEvent) => void) | null = null;
    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => {
      appDb.updateThreadStatus(input.threadId!, 'running');
      return {
        disposition: 'started',
        thread: appDb.getThread(input.threadId!),
        runId: 'builder-run-queue-directed'
      } satisfies ComposerSubmitResult;
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn((listener: (event: AppEvent) => void) => {
          providerListener = listener;
          return () => {
            providerListener = null;
          };
        }),
        submitComposer
      } as unknown as never,
      { codexHome }
    );

    providerListener?.({ type: 'run.status', threadId: plannerThread.id, runId, status: 'completed' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = service.getSnapshot(project.id);
    const builder = snapshot.teams[0]?.lanes.find((lane) => lane.laneId === 'builder');

    expect(builder?.status).toBe('running');
    expect(builder?.lastWakeReason).toContain('woke Builder');
    service.dispose();
    appDb.close();
  });

  it('does not auto-handoff when planner changes non-control files without advancing the queue', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);
    writeQueue(projectRoot, 'core', [
      {
        id: 'planner-1',
        title: 'Validate the current repository state and identify the first bounded slice',
        status: 'in_progress',
        ownerLane: 'planner',
        summary: 'Planner still owns the bounded pass.',
        updatedAt: new Date().toISOString()
      }
    ]);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const plannerThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Planner',
      providerId: 'ollama',
      modelId: 'rnj-1:8b',
      executionPermission: 'full_access'
    });
    appDb.appendTurn(plannerThread.id, 'status', 'Lane run starting with queue snapshot.', {
      laneControlMarker: 'build-controller:core:planner',
      buildQueueMarker: 'lane_run_start',
      buildQueueSignature: JSON.stringify([
        {
          id: 'planner-1',
          status: 'in_progress',
          ownerLane: 'planner',
          title: 'Validate the current repository state and identify the first bounded slice',
          summary: 'Planner still owns the bounded pass.',
          dependencies: [],
          targetPaths: [],
          acceptanceCriteria: [],
          verificationSteps: [],
          refs: [],
          stopWhen: null
        }
      ]),
      buildActiveTicketId: 'planner-1'
    });
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      threadId: plannerThread.id,
      paused: false
    });

    const runId = 'planner-run-wrong-write';
    appDb.addRunEvent(plannerThread.id, runId, 'info', {
      activity: {
        kind: 'change_artifact',
        changeArtifact: {
          summary: { filesChanged: 1 },
          files: [{ path: 'README.current.md' }]
        }
      }
    });
    appDb.addRunEvent(plannerThread.id, runId, 'completed', { message: 'Planner updated the docs audit.' });
    appDb.updateThreadStatus(plannerThread.id, 'completed');

    let providerListener: ((event: AppEvent) => void) | null = null;
    const submitComposer = vi.fn(async (_input: ComposerSubmitInput) => {
      throw new Error('Planner contract violation should not auto-start another lane.');
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn((listener: (event: AppEvent) => void) => {
          providerListener = listener;
          return () => {
            providerListener = null;
          };
        }),
        submitComposer
      } as unknown as never,
      { codexHome }
    );

    providerListener?.({ type: 'run.status', threadId: plannerThread.id, runId, status: 'completed' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = service.getSnapshot(project.id);
    const planner = snapshot.teams[0]?.lanes.find((lane) => lane.laneId === 'planner');

    expect(submitComposer).not.toHaveBeenCalled();
    expect(planner?.status).toBe('completed');
    expect(snapshot.recentEvents.some((event) =>
      event.summary.includes('Planner changed non-control files without advancing the ticket queue.')
    )).toBe(true);
    service.dispose();
    appDb.close();
  });

  it('does not auto-wake a paused target lane and records the skipped handoff', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const plannerThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Planner',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      threadId: plannerThread.id,
      paused: false
    });
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'finisher',
      paused: true
    });

    const runId = 'planner-run-paused-finisher';
    appDb.addRunEvent(plannerThread.id, runId, 'info', {
      activity: {
        changeArtifact: {
          summary: { filesChanged: 1 },
          files: [{ path: 'src/main/index.ts' }]
        }
      }
    });
    appDb.addRunEvent(plannerThread.id, runId, 'completed', { message: 'Planner finished a promotable slice.' });
    appDb.updateThreadStatus(plannerThread.id, 'completed');

    let providerListener: ((event: AppEvent) => void) | null = null;
    const submitComposer = vi.fn();

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn((listener: (event: AppEvent) => void) => {
          providerListener = listener;
          return () => {
            providerListener = null;
          };
        }),
        submitComposer
      } as unknown as never,
      { codexHome }
    );

    providerListener?.({ type: 'run.status', threadId: plannerThread.id, runId, status: 'completed' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = service.getSnapshot(project.id);
    const finisher = snapshot.teams[0]?.lanes.find((lane) => lane.laneId === 'finisher');

    expect(submitComposer).not.toHaveBeenCalled();
    expect(finisher?.status).toBe('paused');
    expect(finisher?.lastHandoffSummary).toContain('Finisher is paused');
    expect(snapshot.recentEvents.some((event) => event.kind === 'auto_handoff_skipped')).toBe(true);
    service.dispose();
    appDb.close();
  });

  it('hands finisher completion back to the builder for control-plane-only changes', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const finisherThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Finisher',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'finisher',
      threadId: finisherThread.id,
      paused: false
    });

    const runId = 'finisher-run-control';
    appDb.addRunEvent(finisherThread.id, runId, 'info', {
      activity: {
        changeArtifact: {
          summary: { filesChanged: 2 },
          files: [
            { path: '.vicode/control/check_queue_health.py' },
            { path: 'docs/engineering/autonomous-team-brief.md' }
          ]
        }
      }
    });
    appDb.addRunEvent(finisherThread.id, runId, 'completed', { message: 'Finisher landed a control-plane slice.' });
    appDb.updateThreadStatus(finisherThread.id, 'completed');

    let providerListener: ((event: AppEvent) => void) | null = null;
    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => {
      if (!input.threadId) {
        throw new Error('Expected builder handoff to target a dedicated thread.');
      }
      appDb.updateThreadStatus(input.threadId, 'running');
      appDb.appendTurn(input.threadId, 'user', input.prompt);
      return {
        disposition: 'started',
        thread: appDb.getThread(input.threadId),
        runId: 'builder-run-1'
      } satisfies ComposerSubmitResult;
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn((listener: (event: AppEvent) => void) => {
          providerListener = listener;
          return () => {
            providerListener = null;
          };
        }),
        submitComposer
      } as unknown as never,
      { codexHome }
    );

    providerListener?.({ type: 'run.status', threadId: finisherThread.id, runId, status: 'completed' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = service.getSnapshot(project.id);
    const builder = snapshot.teams[0]?.lanes.find((lane) => lane.laneId === 'builder');

    expect(submitComposer).toHaveBeenCalledTimes(1);
    expect(builder?.status).toBe('running');
    expect(builder?.threadTitle).toBe('Vicode Build / Core / Builder');
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain('Builder prompt from repo-local file.');
    service.dispose();
    appDb.close();
  });

  it('hands finisher completion back to the planner for product-work changes', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const finisherThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Finisher',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'finisher',
      threadId: finisherThread.id,
      paused: false
    });

    const runId = 'finisher-run-product';
    appDb.addRunEvent(finisherThread.id, runId, 'info', {
      activity: {
        changeArtifact: {
          summary: { filesChanged: 1 },
          files: [{ path: 'src/renderer/components/VicodeBuildControlView.tsx' }]
        }
      }
    });
    appDb.addRunEvent(finisherThread.id, runId, 'completed', { message: 'Finisher landed a product slice.' });
    appDb.updateThreadStatus(finisherThread.id, 'completed');

    let providerListener: ((event: AppEvent) => void) | null = null;
    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => {
      if (!input.threadId) {
        throw new Error('Expected planner handoff to target a dedicated thread.');
      }
      appDb.updateThreadStatus(input.threadId, 'running');
      appDb.appendTurn(input.threadId, 'user', input.prompt);
      return {
        disposition: 'started',
        thread: appDb.getThread(input.threadId),
        runId: 'planner-run-2'
      } satisfies ComposerSubmitResult;
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn((listener: (event: AppEvent) => void) => {
          providerListener = listener;
          return () => {
            providerListener = null;
          };
        }),
        submitComposer
      } as unknown as never,
      { codexHome }
    );

    providerListener?.({ type: 'run.status', threadId: finisherThread.id, runId, status: 'completed' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = service.getSnapshot(project.id);
    const planner = snapshot.teams[0]?.lanes.find((lane) => lane.laneId === 'planner');

    expect(submitComposer).toHaveBeenCalledTimes(1);
    expect(planner?.status).toBe('running');
    expect(planner?.threadTitle).toBe('Vicode Build / Core / Planner');
    expect(submitComposer.mock.calls[0]?.[0].prompt).toContain('Planner prompt from repo-local file.');
    service.dispose();
    appDb.close();
  });

  it('keeps an active plan moving by waking planner after a builder no-op', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);
    writeQueue(projectRoot, 'core', [
      {
        id: 'builder-1',
        title: 'Implement the first bounded slice',
        status: 'in_progress',
        ownerLane: 'builder',
        summary: 'Builder owns this slice.',
        updatedAt: new Date().toISOString()
      }
    ]);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const builderThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Builder',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.appendTurn(builderThread.id, 'status', 'Lane run starting with queue snapshot.', {
      laneControlMarker: 'build-controller:core:builder',
      buildQueueMarker: 'lane_run_start',
      buildQueueSignature: JSON.stringify([
        {
          id: 'builder-1',
          status: 'in_progress',
          ownerLane: 'builder',
          title: 'Implement the first bounded slice',
          summary: 'Builder owns this slice.'
        }
      ]),
      buildActiveTicketId: 'builder-1'
    });
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'builder',
      threadId: builderThread.id,
      paused: false
    });

    const runId = 'builder-run-noop';
    appDb.addRunEvent(builderThread.id, runId, 'completed', { message: 'Builder found no safe implementation slice.' });
    appDb.updateThreadStatus(builderThread.id, 'completed');

    let providerListener: ((event: AppEvent) => void) | null = null;
    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => {
      if (!input.threadId) {
        throw new Error('Expected planner continuation to target a dedicated thread.');
      }
      appDb.updateThreadStatus(input.threadId, 'running');
      appDb.appendTurn(input.threadId, 'user', input.prompt);
      return {
        disposition: 'started',
        thread: appDb.getThread(input.threadId),
        runId: 'planner-run-after-builder-noop'
      } satisfies ComposerSubmitResult;
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn((listener: (event: AppEvent) => void) => {
          providerListener = listener;
          return () => {
            providerListener = null;
          };
        }),
        submitComposer
      } as unknown as never,
      { codexHome }
    );

    providerListener?.({ type: 'run.status', threadId: builderThread.id, runId, status: 'completed' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = service.getSnapshot(project.id);
    const builder = snapshot.teams[0]?.lanes.find((lane) => lane.laneId === 'builder');
    const planner = snapshot.teams[0]?.lanes.find((lane) => lane.laneId === 'planner');

    expect(submitComposer).toHaveBeenCalledTimes(1);
    expect(builder?.blockedReason ?? builder?.recommendedAction ?? '').not.toContain('source-root files outside the worktree');
    expect(planner?.status).toBe('running');
    expect(planner?.lastWakeReason).toContain('Builder completed and woke Planner');
    service.dispose();
    appDb.close();
  });

  it('holds a repeated builder no-op handoff when the queue still has not advanced', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);
    writeQueue(projectRoot, 'core', [
      {
        id: 'builder-1',
        title: 'Implement the first bounded slice',
        status: 'in_progress',
        ownerLane: 'builder',
        summary: 'Builder owns this slice.',
        updatedAt: new Date().toISOString()
      }
    ]);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const builderThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Builder',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.appendTurn(builderThread.id, 'status', 'Lane run starting with queue snapshot.', {
      laneControlMarker: 'build-controller:core:builder',
      buildQueueMarker: 'lane_run_start',
      buildQueueSignature: JSON.stringify([
        {
          id: 'builder-1',
          status: 'in_progress',
          ownerLane: 'builder',
          title: 'Implement the first bounded slice',
          summary: 'Builder owns this slice.'
        }
      ]),
      buildActiveTicketId: 'builder-1'
    });
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'builder',
      threadId: builderThread.id,
      paused: false
    });
    appDb.addVicodeBuildEvent({
      projectId: project.id,
      teamId: 'core',
      laneId: 'planner',
      kind: 'auto_handoff',
      trigger: 'automatic',
      summary: 'Builder completed and woke Planner.',
      sourceLaneId: 'builder',
      targetLaneId: 'planner',
      threadId: builderThread.id,
      runId: 'builder-run-noop-previous'
    });

    const runId = 'builder-run-noop-repeat';
    appDb.addRunEvent(builderThread.id, runId, 'completed', { message: 'Builder found no safe implementation slice again.' });
    appDb.updateThreadStatus(builderThread.id, 'completed');

    let providerListener: ((event: AppEvent) => void) | null = null;
    const submitComposer = vi.fn(async (_input: ComposerSubmitInput) => {
      throw new Error('Repeated non-advancing handoff should not start another lane.');
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn((listener: (event: AppEvent) => void) => {
          providerListener = listener;
          return () => {
            providerListener = null;
          };
        }),
        submitComposer
      } as unknown as never,
      { codexHome }
    );

    providerListener?.({ type: 'run.status', threadId: builderThread.id, runId, status: 'completed' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = service.getSnapshot(project.id);
    const team = snapshot.teams[0]!;
    const builder = team.lanes.find((lane) => lane.laneId === 'builder');

    expect(submitComposer).not.toHaveBeenCalled();
    expect(team.status).toBe('attention');
    expect(builder?.blockedReason).toContain('repeated Builder -> Planner handoff');
    expect(builder?.recommendedAction).toContain('Rewrite, split, or block "Implement the first bounded slice"');
    expect(snapshot.recentEvents.some((event) => event.summary.includes('repeated Builder -> Planner handoff'))).toBe(true);
    service.dispose();
    appDb.close();
  });

  it('keeps an active plan moving by waking planner after a finisher no-op', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const finisherThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Finisher',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'finisher',
      threadId: finisherThread.id,
      paused: false
    });

    const runId = 'finisher-run-noop';
    appDb.addRunEvent(finisherThread.id, runId, 'completed', { message: 'Finisher found nothing safe to promote.' });
    appDb.updateThreadStatus(finisherThread.id, 'completed');

    let providerListener: ((event: AppEvent) => void) | null = null;
    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => {
      if (!input.threadId) {
        throw new Error('Expected planner continuation to target a dedicated thread.');
      }
      appDb.updateThreadStatus(input.threadId, 'running');
      appDb.appendTurn(input.threadId, 'user', input.prompt);
      return {
        disposition: 'started',
        thread: appDb.getThread(input.threadId),
        runId: 'planner-run-after-finisher-noop'
      } satisfies ComposerSubmitResult;
    });

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn((listener: (event: AppEvent) => void) => {
          providerListener = listener;
          return () => {
            providerListener = null;
          };
        }),
        submitComposer
      } as unknown as never,
      { codexHome }
    );

    providerListener?.({ type: 'run.status', threadId: finisherThread.id, runId, status: 'completed' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = service.getSnapshot(project.id);
    const planner = snapshot.teams[0]?.lanes.find((lane) => lane.laneId === 'planner');

    expect(submitComposer).toHaveBeenCalledTimes(1);
    expect(planner?.status).toBe('running');
    expect(planner?.lastWakeReason).toContain('Finisher completed and woke Planner');
    service.dispose();
    appDb.close();
  });

  it('does not wake planner again when finisher leaves only blocked tickets behind', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);
    writeQueue(projectRoot, 'core', [
      {
        id: 'ticket-1',
        title: 'Bootstrap planner ticket',
        status: 'done',
        ownerLane: 'planner',
        summary: 'Planner already handed off the bounded slice.',
        updatedAt: new Date().toISOString()
      },
      {
        id: 'ticket-2',
        title: 'Repair startup bootstrap truth',
        status: 'blocked',
        ownerLane: 'builder',
        summary: 'Verification is blocked until the worktree can run targeted tests.',
        updatedAt: new Date().toISOString()
      }
    ]);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const finisherThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Finisher',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'finisher',
      threadId: finisherThread.id,
      paused: false
    });

    const runId = 'finisher-run-blocked';
    appDb.addRunEvent(finisherThread.id, runId, 'completed', { message: 'Finisher confirmed the active slice is blocked.' });
    appDb.updateThreadStatus(finisherThread.id, 'completed');

    let providerListener: ((event: AppEvent) => void) | null = null;
    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => ({
      disposition: 'started',
      thread: appDb.getThread(input.threadId!),
      runId: 'planner-should-not-run'
    } satisfies ComposerSubmitResult));

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn((listener: (event: AppEvent) => void) => {
          providerListener = listener;
          return () => {
            providerListener = null;
          };
        }),
        submitComposer
      } as unknown as never,
      { codexHome }
    );

    providerListener?.({ type: 'run.status', threadId: finisherThread.id, runId, status: 'completed' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = service.getSnapshot(project.id);
    expect(submitComposer).not.toHaveBeenCalled();
    expect(snapshot.teams[0]?.status).toBe('attention');
    expect(snapshot.recentEvents.some((event) => event.summary.includes('only blocked tickets remain'))).toBe(true);
    service.dispose();
    appDb.close();
  });

  it('does not wake planner again when finisher leaves a fully resolved queue behind', async () => {
    const projectRoot = createTempDir('vicode-build-project-');
    const codexHome = createTempDir('vicode-build-codex-');
    writeConfig(projectRoot);
    seedPromptDefinitions(codexHome);
    writeQueue(projectRoot, 'core', [
      {
        id: 'ticket-1',
        title: 'Bootstrap planner ticket',
        status: 'done',
        ownerLane: 'planner',
        summary: 'Planner already handed off the bounded slice.',
        updatedAt: new Date().toISOString()
      },
      {
        id: 'ticket-2',
        title: 'Queue helper compatibility fix',
        status: 'done',
        ownerLane: 'builder',
        summary: 'The maintenance slice landed and verification is complete.',
        updatedAt: new Date().toISOString()
      }
    ]);

    const appDb = new DatabaseService(join(createTempDir('vicode-build-appdb-'), 'vicode.sqlite'));
    appDb.migrate();
    const project = appDb.createProject({ name: 'Vicode', folderPath: projectRoot, trusted: true });
    const finisherThread = appDb.createThread({
      projectId: project.id,
      title: 'Vicode Build / Core / Finisher',
      providerId: 'openai',
      modelId: 'gpt-5.4',
      executionPermission: 'full_access'
    });
    appDb.saveVicodeBuildLaneState({
      projectId: project.id,
      teamId: 'core',
      laneId: 'finisher',
      threadId: finisherThread.id,
      paused: false
    });

    const runId = 'finisher-run-resolved';
    appDb.addRunEvent(finisherThread.id, runId, 'completed', { message: 'Finisher confirmed the queue is fully resolved.' });
    appDb.updateThreadStatus(finisherThread.id, 'completed');

    let providerListener: ((event: AppEvent) => void) | null = null;
    const submitComposer = vi.fn(async (input: ComposerSubmitInput) => ({
      disposition: 'started',
      thread: appDb.getThread(input.threadId!),
      runId: 'planner-should-not-run-resolved'
    } satisfies ComposerSubmitResult));

    const service = new VicodeBuildControlService(
      appDb,
      {
        onEvent: vi.fn((listener: (event: AppEvent) => void) => {
          providerListener = listener;
          return () => {
            providerListener = null;
          };
        }),
        submitComposer
      } as unknown as never,
      { codexHome }
    );

    providerListener?.({ type: 'run.status', threadId: finisherThread.id, runId, status: 'completed' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot = service.getSnapshot(project.id);
    expect(submitComposer).not.toHaveBeenCalled();
    expect(snapshot.teams[0]?.status).toBe('idle');
    expect(snapshot.recentEvents.some((event) => event.summary.includes('queue is fully resolved'))).toBe(true);
    service.dispose();
    appDb.close();
  });
});
