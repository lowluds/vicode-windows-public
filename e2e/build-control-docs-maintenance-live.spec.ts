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
const workspaceRoot = path.join(root, 'test', '.e2e-workspaces', 'build-control-docs-maintenance-live');
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

async function getProvider(window: Page, providerId: 'openai' | 'ollama') {
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

async function createThread(window: Page, projectId: string, providerId: 'openai' | 'ollama', modelId: string) {
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
    `Timed out waiting for planner state on thread ${threadId}. Last status: ${lastDetail?.status ?? 'unknown'}. Last planner: ${JSON.stringify(lastDetail?.planner ?? null)}. Last events: ${JSON.stringify(lastDetail?.rawOutput?.slice(-5) ?? [])}`
  );
}

async function waitForThreadToBePlanReady(window: Page, threadId: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastDetail: Awaited<ReturnType<Page['evaluate']>> | null = null;
  while (Date.now() < deadline) {
    const detail = await window.evaluate(async ({ threadId }) => window.vicode.threads.open(threadId), { threadId });
    lastDetail = detail;
    if (
      detail.planner?.activePlan &&
      detail.status !== 'queued' &&
      detail.status !== 'running' &&
      detail.status !== 'stopping'
    ) {
      return detail;
    }
    if (detail.status === 'failed') {
      throw new Error(
        `Planner thread ${threadId} failed before build-plan creation. Last planner: ${JSON.stringify(detail.planner ?? null)}. Last events: ${JSON.stringify(detail.rawOutput?.slice(-8) ?? [])}`
      );
    }
    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for planner thread ${threadId} to become plan-ready. Last status: ${lastDetail?.status ?? 'unknown'}. Last planner: ${JSON.stringify(lastDetail?.planner ?? null)}.`
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

  throw new Error(
    `Timed out waiting for planner lane binding. Last snapshot: ${JSON.stringify(lastSnapshot, null, 2)}`
  );
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

  throw new Error(
    `Timed out waiting for team ${teamId}. Last snapshot: ${JSON.stringify(lastSnapshot, null, 2)}`
  );
}

async function seedDocsMaintenanceWorkspace(projectPath: string) {
  await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(path.join(projectPath, 'docs', 'engineering'), { recursive: true });
  await mkdir(path.join(projectPath, 'src', 'shared'), { recursive: true });
  await mkdir(path.join(projectPath, '.vicode'), { recursive: true });

  await writeFile(
    path.join(projectPath, 'package.json'),
    JSON.stringify(
      {
        name: 'vicode-docs-maintenance-live-fixture',
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
  await writeFile(
    path.join(projectPath, '.vicode', 'control', 'vicode-build-teams.json'),
    `${JSON.stringify({ version: 3, controls: [] }, null, 2)}\n`,
    'utf-8'
  );
  await copyFile(
    path.join(root, 'docs', 'engineering', 'README.md'),
    path.join(projectPath, 'docs', 'engineering', 'README.current.md')
  );
  await copyFile(
    path.join(root, 'docs', 'engineering', 'verification-playbook.md'),
    path.join(projectPath, 'docs', 'engineering', 'verification-playbook.current.md')
  );

  await writeFile(
    path.join(projectPath, 'README.md'),
    [
      '# Vicode',
      '',
      'This desktop app currently supports only OpenAI and Gemini, and the build planner is still not shipped.',
      '',
      'Archived threads are deleted from storage rather than preserved.',
      '',
      'Collaboration is editor-shared remote control for pair programming sessions.',
      '',
      'Verification after runtime changes only requires `npm run build`.',
      '',
      'The product no longer uses a dedicated Build Control surface or durable lane threads.'
    ].join('\n'),
    'utf-8'
  );

  await writeFile(
    path.join(projectPath, 'docs', 'engineering', 'STALE-DOCS-NOTES.md'),
    [
      '# Stale Docs Notes',
      '',
      '- Assume build-control work is still experimental and hidden.',
      '- Treat OpenAI and Gemini as the only meaningful providers.',
      '- Ignore worklog drift because the renderer can compensate with startup refetches.',
      '- Do not mention trusted workspace enforcement or archived-thread cold storage.',
      '- Skip verification playbook updates because smoke coverage is optional.'
    ].join('\n'),
    'utf-8'
  );

  await execFileAsync('git', ['init'], { cwd: projectPath });
  await execFileAsync('git', ['config', 'user.name', 'Codex E2E'], { cwd: projectPath });
  await execFileAsync('git', ['config', 'user.email', 'codex-e2e@example.com'], { cwd: projectPath });
  await execFileAsync('git', ['add', '.'], { cwd: projectPath });
  await execFileAsync('git', ['commit', '-m', 'seed docs maintenance fixture'], { cwd: projectPath });
}

test.describe.serial('@live-provider build-control docs maintenance flow', () => {
  test('creates a docs-maintenance build plan from a real planner run and logs each step', async () => {
    test.setTimeout(1_200_000);

    const durableStatePaths = getDurableStatePaths();
    test.skip(!durableStatePaths, 'APPDATA and LOCALAPPDATA must be available for durable-state live E2E.');

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const projectPath = path.join(workspaceRoot, `fixture-${suffix}`);
    const projectName = `E2E Docs Maintenance ${suffix}`;
    const plannerPrompt = [
      'Audit this Vicode workspace for stale documentation and propose a bounded maintenance build plan.',
      'Compare README.md and docs/engineering/STALE-DOCS-NOTES.md against AGENTS.md, src/shared/domain.ts, docs/engineering/README.current.md, and docs/engineering/verification-playbook.current.md.',
      'Focus on stale statements about shipped surfaces, provider support, archived threads, trust enforcement, build control, and release verification.',
      'This is a documentation-maintenance plan only. Do not propose product features or code refactors outside docs and engineering notes.',
      'Ask clarifying questions if needed before proposing the plan.'
    ].join(' ');

    let app: Awaited<ReturnType<typeof launchDurableApp>>['app'] | null = null;
    let window: Page | null = null;
    let projectId: string | null = null;

    await seedDocsMaintenanceWorkspace(projectPath);

    try {
      ({ app, window } = await launchDurableApp(durableStatePaths));
      console.log('[docs-maintenance] bootstrap ready');

      const provider = await getProvider(window, 'ollama');
      test.skip(!provider.installed || !provider.plannerPolicy.supported, 'A planner-capable Ollama provider is required for live docs-maintenance E2E.');
      const modelId = provider.models.find((model) => model.id === provider.defaultModelId)?.id ?? provider.models[0]?.id ?? provider.defaultModelId;
      test.skip(!modelId, 'The Ollama provider must expose at least one model for live docs-maintenance E2E.');
      console.log('[docs-maintenance] provider ready', { providerId: provider.id, modelId });

      const project = await ensureProject(window, projectName, projectPath);
      projectId = project.id;
      console.log('[docs-maintenance] project created', { projectId: project.id, projectPath });

      const thread = await createThread(window, project.id, 'ollama', modelId);
      console.log('[docs-maintenance] setup thread created', { threadId: thread.id, title: thread.title });

      await openThreadInUi(window, project.id, thread.id, thread.title);
      console.log('[docs-maintenance] setup thread opened in UI');

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
          providerId: 'ollama',
          modelId
        }
      );
      console.log('[docs-maintenance] planner submitted', submitResult?.disposition ?? 'unknown');

      let plannerState = await waitForPlannerState(window, thread.id, 180_000);
      console.log('[docs-maintenance] planner state', plannerState.type);

      if (plannerState.type === 'questions') {
        const questionSet = plannerState.detail.planner.pendingQuestionSet;
        console.log(
          '[docs-maintenance] clarifying questions',
          questionSet.questions.map((question) => ({
            id: question.id,
            header: question.header,
            question: question.question,
            selectedOption: question.options.find((option) => option.id === question.recommendedOptionId)?.label ?? question.options[0]?.label ?? null
          }))
        );

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
        console.log('[docs-maintenance] clarifying answers submitted');
        plannerState = await waitForPlannerState(window, thread.id, 180_000);
      }

      expect(plannerState.type).toBe('plan');
      const planDetail = await waitForThreadToBePlanReady(window, thread.id, 120_000);
      const structuredPlan = planDetail.planner?.activePlan?.structuredPlan;
      expect(structuredPlan).not.toBeNull();
      console.log('[docs-maintenance] proposed plan', {
        title: structuredPlan?.title ?? null,
        summary: structuredPlan?.summary ?? [],
        keyChanges: structuredPlan?.keyChanges ?? [],
        testPlan: structuredPlan?.testPlan ?? [],
        assumptions: structuredPlan?.assumptions ?? []
      });

      const createdSnapshot = await window.evaluate(
        async ({ threadId }) => window.vicode.vicodeBuild.createPlanFromThread(threadId),
        { threadId: thread.id }
      );
      console.log('[docs-maintenance] build plan created', {
        teamCount: createdSnapshot.teams.length,
        recentEvents: createdSnapshot.recentEvents.slice(0, 3).map((event) => event.summary)
      });

      const { snapshot: boundSnapshot, team, plannerLane } = await waitForBoundPlannerLane(window, project.id, thread.id, 120_000);
      console.log('[docs-maintenance] planner lane bound', {
        teamId: team.teamId,
        teamLabel: team.label,
        plannerStatus: plannerLane.status,
        activeTicketTitle: team.activeTicketTitle,
        openTicketCount: team.openTicketCount,
        heartbeatStatus: team.heartbeatStatus
      });

      expect(team.label.trim().length).toBeGreaterThan(0);
      expect(/maint|build|docs|document|readme/u.test(team.label.toLowerCase())).toBe(true);
      expect(plannerLane.threadId).toBe(thread.id);
      expect(['queued', 'running', 'waiting_for_review', 'completed', 'idle']).toContain(plannerLane.status);

      const queuePath = team.ticketQueuePath ? path.join(projectPath, team.ticketQueuePath) : null;
      const heartbeatPath = team.heartbeatPath ? path.join(projectPath, team.heartbeatPath) : null;
      if (!queuePath) {
        throw new Error('Build snapshot did not expose a ticket queue path.');
      }

      await waitForPath(queuePath, 60_000);
      const queueText = await readFile(queuePath, 'utf-8');
      console.log('[docs-maintenance] queue file ready', queuePath);
      console.log('[docs-maintenance] queue preview', queueText.slice(0, 600));

      if (heartbeatPath) {
        try {
          await waitForPath(heartbeatPath, 45_000);
          const heartbeatText = await readFile(heartbeatPath, 'utf-8');
          console.log('[docs-maintenance] heartbeat file ready', heartbeatPath);
          console.log('[docs-maintenance] heartbeat preview', heartbeatText.slice(0, 600));
        } catch (error) {
          console.log('[docs-maintenance] heartbeat not materialized within timeout', {
            heartbeatPath,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const verification = await window.evaluate(
        async ({ projectId }) => window.vicode.vicodeBuild.runVerification(projectId),
        { projectId: project.id }
      );
      console.log('[docs-maintenance] verification result', {
        ok: verification.ok,
        steps: verification.steps.map((step) => ({
          id: step.id,
          ok: step.ok,
          label: step.label,
          summary: step.summary
        }))
      });

      const parsedQueue = JSON.parse(queueText) as {
        goal?: string;
        tickets?: Array<{ title?: string; summary?: string }>;
      };

      expect(boundSnapshot.available).toBe(true);
      expect(boundSnapshot.teams.length).toBeGreaterThan(0);
      expect(queueText).toContain('"ownerLane"');
      expect(
        [
          parsedQueue.goal ?? '',
          ...(parsedQueue.tickets ?? []).flatMap((ticket) => [ticket.title ?? '', ticket.summary ?? ''])
        ].join('\n').toLowerCase()
      ).toMatch(/doc|documentation|readme|stale/);

      const teamId = team.teamId;
      const readmePath = path.join(projectPath, 'README.md');
      const staleNotesPath = path.join(projectPath, 'docs', 'engineering', 'STALE-DOCS-NOTES.md');

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
      console.log('[docs-maintenance] builder ticket observed', builderQueue.tickets);

      const builderSnapshot = await waitForTeamSnapshot(
        window,
        project.id,
        teamId,
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
      console.log('[docs-maintenance] builder lane observed', {
        activeTicketTitle: builderSnapshot.team.activeTicketTitle,
        activeTicketOwnerLane: builderSnapshot.team.activeTicketOwnerLane,
        builderStatus: builderSnapshot.team.lanes.find((lane) => lane.laneId === 'builder')?.status ?? null
      });

      const updatedReadme = await waitForFileText(
        readmePath,
        (text) =>
          !text.includes('only OpenAI and Gemini')
          && !text.includes('deleted from storage')
          && !text.includes('remote control for pair programming sessions')
          && !text.includes('only requires `npm run build`'),
        420_000
      );
      const updatedStaleNotes = await waitForFileText(
        staleNotesPath,
        (text) =>
          !text.includes('experimental and hidden')
          && !text.includes('OpenAI and Gemini as the only meaningful providers')
          && !text.includes('startup refetches')
          && !text.includes('smoke coverage is optional'),
        420_000
      );
      console.log('[docs-maintenance] builder changed docs', {
        readmePreview: updatedReadme.slice(0, 400),
        staleNotesPreview: updatedStaleNotes.slice(0, 400)
      });

      const finisherSnapshot = await waitForTeamSnapshot(
        window,
        project.id,
        teamId,
        (teamSnapshot) => {
          const finisherLane = teamSnapshot.lanes.find((lane) => lane.laneId === 'finisher');
          return (
            finisherLane?.status === 'running'
            || finisherLane?.status === 'completed'
            || finisherLane?.lastWakeAt !== null
          );
        },
        420_000
      );
      console.log('[docs-maintenance] finisher lane observed', {
        finisherStatus: finisherSnapshot.team.lanes.find((lane) => lane.laneId === 'finisher')?.status ?? null,
        finisherLastWakeAt: finisherSnapshot.team.lanes.find((lane) => lane.laneId === 'finisher')?.lastWakeAt ?? null,
        finisherLastWakeReason:
          finisherSnapshot.team.lanes.find((lane) => lane.laneId === 'finisher')?.lastWakeReason ?? null
      });

      const progressedQueue = await waitForQueueState(
        queuePath,
        (queue) =>
          (queue.tickets ?? []).some((ticket) => ticket.ownerLane === 'builder' && ticket.status === 'done')
          || (queue.tickets ?? []).some((ticket) => ticket.ownerLane === 'finisher' && ticket.status === 'in_progress'),
        420_000
      );
      console.log('[docs-maintenance] progressed queue observed', progressedQueue.tickets);

      const completedQueue = await waitForQueueState(
        queuePath,
        (queue) => {
          const tickets = queue.tickets ?? [];
          return tickets.length > 0 && tickets.every((ticket) => ticket.status === 'done');
        },
        420_000
      );
      console.log('[docs-maintenance] completed queue observed', completedQueue.tickets);

      const finishedSnapshot = await waitForTeamSnapshot(
        window,
        project.id,
        teamId,
        (teamSnapshot) => {
          const finisherLane = teamSnapshot.lanes.find((lane) => lane.laneId === 'finisher');
          return (
            teamSnapshot.status === 'idle'
            && teamSnapshot.heartbeatStatus === 'completed'
            && (finisherLane?.status === 'completed' || finisherLane?.status === 'idle')
          );
        },
        420_000
      );
      console.log('[docs-maintenance] finished team observed', {
        teamStatus: finishedSnapshot.team.status,
        heartbeatStatus: finishedSnapshot.team.heartbeatStatus,
        finisherStatus: finishedSnapshot.team.lanes.find((lane) => lane.laneId === 'finisher')?.status ?? null
      });

      expect(completedQueue.tickets.every((ticket) => ticket.status === 'done')).toBe(true);
      expect(finishedSnapshot.team.status).toBe('idle');
      expect(finishedSnapshot.team.heartbeatStatus).toBe('completed');
      expect(
        finishedSnapshot.team.lanes.find((lane) => lane.laneId === 'finisher')?.status === 'completed'
        || finishedSnapshot.team.lanes.find((lane) => lane.laneId === 'finisher')?.status === 'idle'
      ).toBe(true);
    } finally {
      if (window && projectId) {
        await removeProject(window, projectId).catch(() => undefined);
      }
      await closeApp(app).catch(() => undefined);
      await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
