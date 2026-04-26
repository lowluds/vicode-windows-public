import { execFile } from 'node:child_process';
import { access, cp, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type Page } from '@playwright/test';
import {
  closeApp,
  dismissWelcomeIfVisible,
  launchApp as launchElectronApp,
  type LaunchStatePaths,
  waitForBridge
} from './helpers/electron';

const root = process.cwd();
const workspaceRoot = path.join(root, 'test', '.e2e-workspaces', 'build-control-control-plane-maintenance-live');
const execFileAsync = promisify(execFile);

type QueueFileState = {
  version?: number;
  goal?: string;
  updatedAt?: string;
  tickets?: Array<{
    id?: string;
    title?: string;
    status?: string;
    ownerLane?: string;
    summary?: string;
    updatedAt?: string;
  }>;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDurableStatePaths(): LaunchStatePaths | null {
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  if (!appData || !localAppData) {
    return null;
  }

  return {
    userDataPath: path.join(appData, 'vicode-windows'),
    sessionDataPath: path.join(localAppData, 'vicode-windows', 'session')
  };
}

async function launchDurableApp(statePaths: LaunchStatePaths) {
  return await launchElectronApp({
    bridgePaths: [
      'vicode.app',
      'vicode.projects',
      'vicode.threads',
      'vicode.planner',
      'vicode.providers',
      'vicode.settings',
      'vicode.vicodeBuild'
    ],
    timeoutMs: 60_000,
    statePaths
  });
}

async function getBootstrap(window: Page) {
  return await window.evaluate(async () => window.vicode.app.getBootstrap());
}

async function getProvider(window: Page, providerId: 'openai') {
  const bootstrap = await getBootstrap(window);
  const provider = bootstrap.providers.find((entry) => entry.id === providerId);
  if (!provider) {
    throw new Error(`Provider not found: ${providerId}`);
  }
  return provider;
}

async function ensureProject(window: Page, projectName: string, folderPath: string) {
  await mkdir(folderPath, { recursive: true });
  return await window.evaluate(
    async ({ projectName, folderPath }) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const existing = bootstrap.projects.find((project) => project.name === projectName);
      if (existing) {
        return await window.vicode.projects.update({
          id: existing.id,
          folderPath,
          trusted: true
        });
      }

      return await window.vicode.projects.create({
        name: projectName,
        folderPath,
        trusted: true
      });
    },
    { projectName, folderPath }
  );
}

async function removeProject(window: Page, projectId: string | null) {
  if (!projectId) {
    return;
  }

  await window.evaluate(async (currentProjectId) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    if (bootstrap.projects.some((project) => project.id === currentProjectId)) {
      await window.vicode.projects.remove(currentProjectId);
    }
  }, projectId);
}

async function createThread(window: Page, projectId: string, providerId: 'openai', modelId: string) {
  return await window.evaluate(
    async ({ projectId, providerId, modelId }) =>
      window.vicode.threads.create({
        projectId,
        providerId,
        modelId,
        executionPermission: 'full_access'
      }),
    { projectId, providerId, modelId }
  );
}

async function openThreadInUi(window: Page, projectId: string, threadId: string, threadTitle: string) {
  await window.evaluate(async ({ projectId, threadId }) => {
    await window.vicode.settings.save({
      selectedProjectId: projectId,
      lastOpenedThreadId: threadId
    });
  }, { projectId, threadId });
  await window.reload();
  await waitForBridge(window, [
    'vicode.app',
    'vicode.projects',
    'vicode.threads',
    'vicode.planner',
    'vicode.providers',
    'vicode.settings',
    'vicode.vicodeBuild'
  ]);
  await dismissWelcomeIfVisible(window);
  await expect(window.locator('.windows-titlebar-context-thread')).toHaveText(threadTitle, { timeout: 30_000 });
}

async function waitForPlannerState(
  window: Page,
  threadId: string,
  timeoutMs = 240_000
): Promise<{ type: 'questions' | 'plan'; detail: Awaited<ReturnType<Page['evaluate']>> }> {
  const deadline = Date.now() + timeoutMs;
  let lastDetail: Awaited<ReturnType<Page['evaluate']>> | null = null;
  while (Date.now() < deadline) {
    const detail = await window.evaluate(async ({ threadId }) => window.vicode.threads.open(threadId), { threadId });
    lastDetail = detail;
    if (detail.planner?.pendingQuestionSet) {
      return { type: 'questions', detail };
    }
    if (detail.planner?.activePlan) {
      return { type: 'plan', detail };
    }
    if (detail.status === 'failed') {
      throw new Error(
        `Planner thread ${threadId} failed. Last planner: ${JSON.stringify(detail.planner ?? null)}. Last events: ${JSON.stringify(detail.rawOutput?.slice(-8) ?? [])}`
      );
    }
    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for planner state on thread ${threadId}. Last status: ${lastDetail?.status ?? 'unknown'}. Last planner: ${JSON.stringify(lastDetail?.planner ?? null)}.`
  );
}

async function waitForThreadToBePlanReady(window: Page, threadId: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastDetail: Awaited<ReturnType<Page['evaluate']>> | null = null;
  while (Date.now() < deadline) {
    const detail = await window.evaluate(async ({ threadId }) => window.vicode.threads.open(threadId), { threadId });
    lastDetail = detail;
    if (
      detail.planner?.activePlan
      && detail.status !== 'queued'
      && detail.status !== 'running'
      && detail.status !== 'stopping'
    ) {
      return detail;
    }
    if (detail.status === 'failed') {
      throw new Error(
        `Planner thread ${threadId} failed before build-plan creation. Last planner: ${JSON.stringify(detail.planner ?? null)}.`
      );
    }
    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for planner thread ${threadId} to become plan-ready. Last status: ${lastDetail?.status ?? 'unknown'}.`
  );
}

async function waitForBoundPlannerLane(window: Page, projectId: string, threadId: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot: Awaited<ReturnType<Page['evaluate']>> | null = null;
  while (Date.now() < deadline) {
    const snapshot = await window.evaluate(async ({ projectId }) => window.vicode.vicodeBuild.getSnapshot(projectId), {
      projectId
    });
    lastSnapshot = snapshot;
    const team = snapshot.teams[0] ?? null;
    const plannerLane = team?.lanes.find((lane) => lane.laneId === 'planner') ?? null;
    if (team && plannerLane?.threadId === threadId) {
      return { snapshot, team, plannerLane };
    }
    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for planner lane binding. Last snapshot: ${JSON.stringify(lastSnapshot, null, 2)}`);
}

async function waitForPath(filePath: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch {
      await sleep(1_000);
    }
  }

  throw new Error(`Timed out waiting for file: ${filePath}`);
}

async function waitForPathToDisappear(filePath: string, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      await sleep(2_000);
    } catch {
      return;
    }
  }

  throw new Error(`Timed out waiting for file to disappear: ${filePath}`);
}

async function waitForQueueState(
  queuePath: string,
  predicate: (queue: QueueFileState) => boolean,
  timeoutMs = 300_000
) {
  const deadline = Date.now() + timeoutMs;
  let lastQueue: QueueFileState | null = null;
  while (Date.now() < deadline) {
    await waitForPath(queuePath, Math.min(15_000, timeoutMs));
    const queueText = await readFile(queuePath, 'utf-8');
    const queue = JSON.parse(queueText) as QueueFileState;
    lastQueue = queue;
    if (predicate(queue)) {
      return queue;
    }
    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for queue state at ${queuePath}. Last queue: ${JSON.stringify(lastQueue, null, 2)}`);
}

async function waitForFileText(
  filePath: string,
  predicate: (text: string) => boolean,
  timeoutMs = 300_000
) {
  const deadline = Date.now() + timeoutMs;
  let lastText = '';
  while (Date.now() < deadline) {
    await waitForPath(filePath, Math.min(15_000, timeoutMs));
    const text = await readFile(filePath, 'utf-8');
    lastText = text;
    if (predicate(text)) {
      return text;
    }
    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for expected file contents at ${filePath}. Last content preview: ${lastText.slice(0, 600)}`);
}

async function waitForTeamSnapshot(
  window: Page,
  projectId: string,
  teamId: string,
  predicate: (team: Awaited<ReturnType<Page['evaluate']>>['teams'][number]) => boolean,
  timeoutMs = 300_000
) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot: Awaited<ReturnType<Page['evaluate']>> | null = null;
  while (Date.now() < deadline) {
    const snapshot = await window.evaluate(async ({ projectId }) => window.vicode.vicodeBuild.getSnapshot(projectId), {
      projectId
    });
    lastSnapshot = snapshot;
    const team = snapshot.teams.find((entry) => entry.teamId === teamId) ?? null;
    if (team && predicate(team)) {
      return { snapshot, team };
    }
    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for team ${teamId}. Last snapshot: ${JSON.stringify(lastSnapshot, null, 2)}`);
}

function staleTeamConfig(teamId: string) {
  return {
    id: teamId,
    label: `Stale ${teamId}`,
    goal: 'Historical live maintenance artifact no longer active.',
    worktreePath: '.',
    heartbeatPath: `.vicode/control/build-heartbeats/${teamId}.md`,
    lanes: {
      planner: {
        label: 'Planner',
        automationId: `vicode-build-${teamId}-planner`,
        promptPath: `.vicode/control/build-prompts/${teamId}/planner.md`,
        skillIds: [],
        providerId: 'openai',
        modelId: 'gpt-5.4',
        reasoningEffort: 'medium',
        executionPermission: 'full_access'
      },
      builder: {
        label: 'Builder',
        automationId: `vicode-build-${teamId}-builder`,
        promptPath: `.vicode/control/build-prompts/${teamId}/builder.md`,
        skillIds: [],
        providerId: 'openai',
        modelId: 'gpt-5.4',
        reasoningEffort: 'medium',
        executionPermission: 'full_access'
      },
      finisher: {
        label: 'Finisher',
        automationId: `vicode-build-${teamId}-finisher`,
        promptPath: `.vicode/control/build-prompts/${teamId}/finisher.md`,
        skillIds: [],
        providerId: 'openai',
        modelId: 'gpt-5.4',
        reasoningEffort: 'medium',
        executionPermission: 'full_access'
      }
    }
  };
}

async function seedControlPlaneMaintenanceWorkspace(projectPath: string) {
  await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(path.join(projectPath, '.vicode'), { recursive: true });
  await mkdir(path.join(projectPath, 'src', 'shared'), { recursive: true });

  await writeFile(
    path.join(projectPath, 'package.json'),
    JSON.stringify(
      {
        name: 'vicode-control-plane-maintenance-live-fixture',
        private: true,
        version: '0.0.0'
      },
      null,
      2
    ),
    'utf-8'
  );

  await copyFile(path.join(root, 'AGENTS.md'), path.join(projectPath, 'AGENTS.md'));
  await copyFile(path.join(root, 'src', 'shared', 'domain.ts'), path.join(projectPath, 'src', 'shared', 'domain.ts'));
  await cp(path.join(root, '.vicode', 'control'), path.join(projectPath, '.vicode', 'control'), { recursive: true });
  await rm(path.join(projectPath, '.vicode', 'control', 'build-heartbeats'), { recursive: true, force: true }).catch(() => undefined);
  await rm(path.join(projectPath, '.vicode', 'control', 'build-prompts'), { recursive: true, force: true }).catch(() => undefined);
  await rm(path.join(projectPath, '.vicode', 'control', 'build-tickets'), { recursive: true, force: true }).catch(() => undefined);
  await mkdir(path.join(projectPath, '.vicode', 'control', 'build-heartbeats'), { recursive: true });
  await mkdir(path.join(projectPath, '.vicode', 'control', 'build-prompts'), { recursive: true });
  await mkdir(path.join(projectPath, '.vicode', 'control', 'build-tickets'), { recursive: true });

  const staleTeamIds = [
    'build-control-maintenance-cleanup-live',
    'build-control-maintenance-cleanup-live-2'
  ];
  for (const teamId of staleTeamIds) {
    await mkdir(path.join(projectPath, '.vicode', 'control', 'build-prompts', teamId), { recursive: true });
    await writeFile(
      path.join(projectPath, '.vicode', 'control', 'build-prompts', teamId, 'planner.md'),
      'Stale planner prompt that should be removed.',
      'utf-8'
    );
    await writeFile(
      path.join(projectPath, '.vicode', 'control', 'build-prompts', teamId, 'builder.md'),
      'Stale builder prompt that should be removed.',
      'utf-8'
    );
    await writeFile(
      path.join(projectPath, '.vicode', 'control', 'build-prompts', teamId, 'finisher.md'),
      'Stale finisher prompt that should be removed.',
      'utf-8'
    );
    await writeFile(
      path.join(projectPath, '.vicode', 'control', 'build-heartbeats', `${teamId}.md`),
      [
        '# Build Heartbeat',
        '',
        'Goal: Historical maintenance live test',
        'Worktree: .',
        'Status: done',
        'Summary: Historical live test artifact. No active work remains.',
        '',
        '## Active Checklist',
        '- [x] Historical slice complete.'
      ].join('\n'),
      'utf-8'
    );
    await writeFile(
      path.join(projectPath, '.vicode', 'control', 'build-tickets', `${teamId}.json`),
      JSON.stringify(
        {
          version: 1,
          updatedAt: new Date().toISOString(),
          tickets: [
            {
              id: 'ticket-1',
              title: 'Historical live test slice',
              status: 'done',
              ownerLane: 'builder',
              summary: 'This stale maintenance-live slice is fully resolved and should not remain registered.',
              updatedAt: new Date().toISOString()
            }
          ]
        },
        null,
        2
      ),
      'utf-8'
    );
  }

  await writeFile(
    path.join(projectPath, '.vicode', 'control', 'vicode-build-teams.json'),
    `${JSON.stringify({ version: 3, controls: staleTeamIds.map(staleTeamConfig) }, null, 2)}\n`,
    'utf-8'
  );

  await execFileAsync('git', ['init'], { cwd: projectPath });
  await execFileAsync('git', ['config', 'user.name', 'Codex E2E'], { cwd: projectPath });
  await execFileAsync('git', ['config', 'user.email', 'codex-e2e@example.com'], { cwd: projectPath });
  await execFileAsync('git', ['add', '.'], { cwd: projectPath });
  await execFileAsync('git', ['commit', '-m', 'seed control-plane maintenance fixture'], { cwd: projectPath });
}

test.describe.serial('@live-provider build-control control-plane maintenance flow', () => {
  test('cleans stale control-plane registry entries through planner, builder, and finisher', async () => {
    test.setTimeout(1_200_000);

    const durableStatePaths = getDurableStatePaths();
    test.skip(!durableStatePaths, 'APPDATA and LOCALAPPDATA must be available for durable-state live E2E.');

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `fixture-${suffix}`);
    const projectName = `E2E Control Plane Maintenance ${suffix}`;
    const plannerPrompt = [
      'Audit this Vicode control-plane workspace for stale build-control maintenance artifacts and propose a bounded non-doc maintenance build plan.',
      'Compare .vicode/control/vicode-build-teams.json against the actual .vicode/control/build-heartbeats, .vicode/control/build-prompts, and .vicode/control/build-tickets artifacts.',
      'Focus on orphaned maintenance-live registry entries, stale queue and heartbeat files, and stale prompt scaffold directories that no longer represent active work.',
      'This is a non-doc maintenance plan only. Do not edit README files or engineering notes.',
      'Ask clarifying questions if needed before proposing the plan.'
    ].join(' ');

    let app: Awaited<ReturnType<typeof launchDurableApp>>['app'] | null = null;
    let window: Page | null = null;
    let projectId: string | null = null;

    await seedControlPlaneMaintenanceWorkspace(projectPath);

    try {
      ({ app, window } = await launchDurableApp(durableStatePaths));
      console.log('[control-plane] bootstrap ready');

      const provider = await getProvider(window, 'openai');
      test.skip(!provider.installed || provider.authState !== 'connected', 'Codex CLI must be installed and connected for live control-plane maintenance E2E.');
      const modelId = provider.models.find((model) => model.id === 'gpt-5.4')?.id ?? provider.models[0]?.id ?? 'gpt-5.4';
      console.log('[control-plane] provider ready', { providerId: provider.id, modelId });

      const project = await ensureProject(window, projectName, projectPath);
      projectId = project.id;
      console.log('[control-plane] project created', { projectId: project.id, projectPath });

      const thread = await createThread(window, project.id, 'openai', modelId);
      console.log('[control-plane] setup thread created', { threadId: thread.id, title: thread.title });

      await openThreadInUi(window, project.id, thread.id, thread.title);
      console.log('[control-plane] setup thread opened in UI');

      const submitResult = await window.evaluate(
        async ({ projectId, threadId, prompt, providerId, modelId }) => {
          await window.vicode.planner.setMode({ threadId, mode: 'plan' });
          return await window.vicode.planner.submit({
            projectId,
            threadId,
            prompt,
            providerId,
            modelId,
            reasoningEffort: 'low',
            executionPermission: 'full_access',
            skillIds: []
          });
        },
        {
          projectId: project.id,
          threadId: thread.id,
          prompt: plannerPrompt,
          providerId: 'openai',
          modelId
        }
      );
      console.log('[control-plane] planner submitted', submitResult?.disposition ?? 'unknown');

      let plannerState = await waitForPlannerState(window, thread.id, 180_000);
      console.log('[control-plane] planner state', plannerState.type);

      if (plannerState.type === 'questions') {
        const questionSet = plannerState.detail.planner.pendingQuestionSet;
        const answers = Object.fromEntries(
          questionSet.questions.map((question) => {
            const selectedOptionId = question.recommendedOptionId || question.options[0]?.id;
            if (!selectedOptionId) {
              throw new Error(`Planner question ${question.id} did not provide any selectable option.`);
            }
            return [question.id, { answers: [selectedOptionId] }];
          })
        );
        await window.evaluate(
          async ({ threadId, callId, answers }) => window.vicode.planner.answer({ threadId, callId, answers }),
          {
            threadId: thread.id,
            callId: questionSet.callId,
            answers
          }
        );
        console.log('[control-plane] clarifying answers submitted');
        plannerState = await waitForPlannerState(window, thread.id, 180_000);
      }

      expect(plannerState.type).toBe('plan');
      const planDetail = await waitForThreadToBePlanReady(window, thread.id, 120_000);
      const structuredPlan = planDetail.planner?.activePlan?.structuredPlan;
      expect(structuredPlan).not.toBeNull();
      console.log('[control-plane] proposed plan', {
        title: structuredPlan?.title ?? null,
        summary: structuredPlan?.summary ?? [],
        keyChanges: structuredPlan?.keyChanges ?? []
      });

      const createdSnapshot = await window.evaluate(
        async ({ threadId }) => window.vicode.vicodeBuild.createPlanFromThread(threadId),
        { threadId: thread.id }
      );
      console.log('[control-plane] build plan created', {
        teamCount: createdSnapshot.teams.length,
        recentEvents: createdSnapshot.recentEvents.slice(0, 3).map((event) => event.summary)
      });

      const { team, plannerLane } = await waitForBoundPlannerLane(window, project.id, thread.id, 120_000);
      console.log('[control-plane] planner lane bound', {
        teamId: team.teamId,
        teamLabel: team.label,
        plannerStatus: plannerLane.status,
        activeTicketTitle: team.activeTicketTitle
      });

      const queuePath = team.ticketQueuePath ? path.join(projectPath, team.ticketQueuePath) : null;
      if (!queuePath) {
        throw new Error('Build snapshot did not expose a ticket queue path.');
      }

      const staleRegistryPath = path.join(projectPath, '.vicode', 'control', 'vicode-build-teams.json');
      const stalePromptDirA = path.join(projectPath, '.vicode', 'control', 'build-prompts', 'build-control-maintenance-cleanup-live');
      const stalePromptDirB = path.join(projectPath, '.vicode', 'control', 'build-prompts', 'build-control-maintenance-cleanup-live-2');
      const staleHeartbeatA = path.join(projectPath, '.vicode', 'control', 'build-heartbeats', 'build-control-maintenance-cleanup-live.md');
      const staleHeartbeatB = path.join(projectPath, '.vicode', 'control', 'build-heartbeats', 'build-control-maintenance-cleanup-live-2.md');

      const builderQueue = await waitForQueueState(
        queuePath,
        (queue) =>
          (queue.tickets ?? []).some(
            (ticket) =>
              ticket.ownerLane === 'builder'
              && (ticket.status === 'in_progress' || ticket.status === 'done')
          ),
        420_000
      );
      console.log('[control-plane] builder ticket observed', builderQueue.tickets);

      const builderSnapshot = await waitForTeamSnapshot(
        window,
        project.id,
        team.teamId,
        (teamSnapshot) => {
          const builderLane = teamSnapshot.lanes.find((lane) => lane.laneId === 'builder');
          return (
            teamSnapshot.activeTicketOwnerLane === 'builder'
            || builderLane?.status === 'running'
            || builderLane?.status === 'completed'
            || builderLane?.status === 'waiting_for_review'
          );
        },
        420_000
      );
      console.log('[control-plane] builder lane observed', {
        activeTicketTitle: builderSnapshot.team.activeTicketTitle,
        activeTicketOwnerLane: builderSnapshot.team.activeTicketOwnerLane,
        builderStatus: builderSnapshot.team.lanes.find((lane) => lane.laneId === 'builder')?.status ?? null
      });

      const cleanedRegistry = await waitForFileText(
        staleRegistryPath,
        (text) =>
          !text.includes('build-control-maintenance-cleanup-live')
          && !text.includes('build-control-maintenance-cleanup-live-2'),
        420_000
      );
      console.log('[control-plane] registry cleaned', cleanedRegistry.slice(0, 400));

      await waitForPathToDisappear(stalePromptDirA, 420_000);
      await waitForPathToDisappear(stalePromptDirB, 420_000);
      await waitForPathToDisappear(staleHeartbeatA, 420_000);
      await waitForPathToDisappear(staleHeartbeatB, 420_000);
      console.log('[control-plane] orphaned artifacts removed');

      const finisherSnapshot = await waitForTeamSnapshot(
        window,
        project.id,
        team.teamId,
        (teamSnapshot) => {
          const finisherLane = teamSnapshot.lanes.find((lane) => lane.laneId === 'finisher');
          return (
            finisherLane?.status === 'running'
            || finisherLane?.status === 'completed'
            || finisherLane?.status === 'waiting_for_review'
          );
        },
        420_000
      );
      console.log('[control-plane] finisher lane observed', {
        finisherStatus: finisherSnapshot.team.lanes.find((lane) => lane.laneId === 'finisher')?.status ?? null
      });

      const progressedQueue = await waitForQueueState(
        queuePath,
        (queue) =>
          (queue.tickets ?? []).some((ticket) => ticket.ownerLane === 'builder' && ticket.status === 'done')
          || (queue.tickets ?? []).some((ticket) => ticket.ownerLane === 'finisher' && ticket.status === 'in_progress'),
        420_000
      );
      console.log('[control-plane] progressed queue observed', progressedQueue.tickets);
    } finally {
      if (window && projectId) {
        await removeProject(window, projectId).catch(() => undefined);
      }
      await closeApp(app).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
