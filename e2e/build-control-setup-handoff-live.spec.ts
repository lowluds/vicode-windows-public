import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  closeApp,
  dismissWelcomeIfVisible,
  launchApp as launchElectronApp,
  type LaunchStatePaths,
  waitForBridge
} from './helpers/electron';

const root = process.cwd();
const workspaceRoot = path.join(root, 'test', '.e2e-workspaces', 'build-control-setup-handoff-live');

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

async function waitForPlanReady(window: Page, threadId: string, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  let lastDetail: Awaited<ReturnType<Page['evaluate']>> | null = null;

  while (Date.now() < deadline) {
    const detail = await window.evaluate(async ({ threadId }) => window.vicode.threads.open(threadId), { threadId });
    lastDetail = detail;

    if (detail.planner?.pendingQuestionSet) {
      const answers = Object.fromEntries(
        detail.planner.pendingQuestionSet.questions.map((question: {
          id: string;
          options: Array<{ label: string }>;
        }) => [question.id, { answers: [question.options[0]?.label ?? 'Proceed with the bounded maintenance path.'] }])
      );
      await window.evaluate(
        async ({ threadId, callId, answers }) =>
          window.vicode.planner.answer({
            threadId,
            callId,
            answers
          }),
        {
          threadId,
          callId: detail.planner.pendingQuestionSet.callId,
          answers
        }
      );
      await sleep(1_000);
      continue;
    }

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
        `Setup thread ${threadId} failed before build-plan handoff. Last planner: ${JSON.stringify(detail.planner ?? null)}. Last events: ${JSON.stringify(detail.rawOutput?.slice(-8) ?? [])}`
      );
    }

    await sleep(1_000);
  }

  throw new Error(
    `Timed out waiting for setup thread ${threadId} to become plan-ready. Last status: ${lastDetail?.status ?? 'unknown'}. Last planner: ${JSON.stringify(lastDetail?.planner ?? null)}.`
  );
}

async function openThreadInUi(window: Page, projectId: string, threadId: string) {
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
}

const durableStatePaths = getDurableStatePaths();
test.skip(!durableStatePaths, 'APPDATA and LOCALAPPDATA must be available for durable-state live E2E.');

test('approving a build-plan setup thread starts Build Control handoff instead of normal execution @live-provider', async () => {
  let app: Awaited<ReturnType<typeof launchDurableApp>>['app'] | null = null;
  let window: Page | null = null;
  let projectId: string | null = null;

  try {
    ({ app, window } = await launchDurableApp(durableStatePaths!));

    const bootstrap = await getBootstrap(window);
    const provider =
      bootstrap.providers.find((entry) => entry.id === 'openai' && entry.installed && entry.authState === 'connected' && entry.plannerPolicy.supported) ??
      bootstrap.providers.find((entry) => entry.id === 'gemini' && entry.installed && entry.authState === 'connected' && entry.plannerPolicy.supported) ??
      null;
    test.skip(!provider, 'A connected planner-capable OpenAI or Gemini provider is required for live setup-handoff E2E.');

    const modelId = provider!.models[0]?.id ?? provider!.defaultModelId;
    test.skip(!modelId, 'The connected provider must expose at least one model.');

    const projectName = `Build control setup handoff ${Date.now()}`;
    const project = await ensureProject(window, projectName, workspaceRoot);
    projectId = project.id;

    const thread = await window.evaluate(
      async ({ projectId, providerId, modelId }) =>
        window.vicode.threads.create({
          projectId,
          title: 'Build plan setup / Verify setup handoff into Build Control',
          providerId,
          modelId,
          executionPermission: 'full_access'
        }),
      { projectId: project.id, providerId: provider!.id, modelId }
    );

    await window.evaluate(
      async ({ projectId, threadId, providerId, modelId, prompt }) =>
        window.vicode.planner.submit({
          projectId,
          threadId,
          prompt,
          providerId,
          modelId,
          reasoningEffort: 'low',
          executionPermission: 'full_access',
          skillIds: [],
          imageAttachments: []
        }),
      {
        projectId: project.id,
        threadId: thread.id,
        providerId: provider!.id,
        modelId,
        prompt: [
          'You are setting up a new Vicode build plan.',
          '',
          'Goal: Audit the Vitest 3 thread handoff path so approved setup threads enter Build Control cleanly without falling back into ordinary execution.',
          '',
          'Work only inside this setup thread.',
          'If the goal is already clear enough, say that no clarification is needed and propose a minimal build plan.',
          'Do not edit files yet. Stay in planning and setup mode until the user confirms the shape of the build plan.'
        ].join('\n')
      }
    );

    await waitForPlanReady(window, thread.id);
    await openThreadInUi(window, project.id, thread.id);
    await expect(window.getByTestId('planner-approve-button')).toContainText('Accept and start Autonomous Builds', {
      timeout: 30_000
    });

    await window.getByTestId('planner-approve-button').click();

    const handoff = await expect
      .poll(
        async () =>
          await window!.evaluate(
            async ({ projectId, threadId }) => {
              const snapshot = await window.vicode.vicodeBuild.getSnapshot(projectId);
              const team = snapshot.teams[0] ?? null;
              const plannerLane = team?.lanes.find((lane) => lane.laneId === 'planner') ?? null;
              const thread = await window.vicode.threads.open(threadId);
              return {
                teamId: team?.teamId ?? null,
                plannerThreadId: plannerLane?.threadId ?? null,
                plannerStatus: plannerLane?.status ?? null,
                threadTitle: thread.title,
                threadStatus: thread.status
              };
            },
            { projectId: project.id, threadId: thread.id }
          ),
        {
          timeout: 120_000,
          intervals: [2_000]
        }
      )
      .toMatchObject({
        plannerThreadId: thread.id
      });

    const snapshot = await window.evaluate(async ({ projectId }) => window.vicode.vicodeBuild.getSnapshot(projectId), {
      projectId: project.id
    });
    expect(snapshot.teams.length).toBeGreaterThan(0);

    const reboundThread = await window.evaluate(async ({ threadId }) => window.vicode.threads.open(threadId), {
      threadId: thread.id
    });
    expect(reboundThread.title).toMatch(/^Vicode Build \//u);
  } finally {
    if (window && projectId) {
      await removeProject(window, projectId).catch(() => undefined);
    }
    await closeApp(app).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('better_sqlite3.node is locked')) {
        throw error;
      }
    });
    await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
  }
});
