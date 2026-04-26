import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { closeApp, launchApp as launchElectronApp, waitForBridge } from './helpers/electron';

async function createPlannerCancelFixture(window: Page, workspaceDir: string) {
  return await window.evaluate(async ({ workspaceDir }) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    const providerCandidates = bootstrap.providers.filter((provider) => provider.models.length > 0);
    if (providerCandidates.length === 0) {
      throw new Error('Expected at least one provider with models.');
    }

    let provider =
      providerCandidates.find((candidate) => candidate.id === 'ollama') ??
      providerCandidates.find((candidate) => candidate.id === 'openai') ??
      providerCandidates.find((candidate) => candidate.id === 'gemini') ??
      providerCandidates[0];

    if (provider.authState === 'detected') {
      provider = await window.vicode.providers.adoptAuth(provider.id);
    }

    const project = await window.vicode.projects.create({
      name: `Planner cancel flash ${Date.now()}`,
      folderPath: workspaceDir,
      trusted: true
    });
    const modelId =
      project.defaultModelByProvider[provider.id] ??
      bootstrap.preferences.defaultModelByProvider[provider.id] ??
      provider.models[0]?.id ??
      'gpt-5';
    const thread = await window.vicode.threads.create({
      projectId: project.id,
      providerId: provider.id,
      modelId,
      executionPermission: 'full_access'
    });

    await window.vicode.settings.save({
      selectedProjectId: project.id,
      lastOpenedThreadId: thread.id
    });
    await window.vicode.planner.setMode({ threadId: thread.id, mode: 'plan' });
    await window.vicode.planner.cancel({ threadId: thread.id });

    return {
      projectId: project.id,
      threadId: thread.id
    };
  }, { workspaceDir });
}

async function installDelayedSubmitStub(window: Page) {
  await window.evaluate(() => {
    const globalWindow = window as typeof window & {
      __originalComposerSubmit__?: typeof window.vicode.composer.submit;
      __composerHeaderSamples__?: Array<{
        timestamp: number;
        shelfTitles: string[];
        shelfText: string;
        headerText: string;
        headerHtml: string;
      }>;
      __composerHeaderObserver__?: MutationObserver;
    };

    if (!globalWindow.__originalComposerSubmit__) {
      globalWindow.__originalComposerSubmit__ = window.vicode.composer.submit;
    }

    const recordSample = () => {
      const header = document.querySelector('.prompt-input-header');
      const shelf = document.querySelector('[data-testid="composer-activity-shelf"]');
      const shelfTitles = shelf
        ? Array.from(shelf.querySelectorAll('.composer-activity-card-copy strong'))
            .map((node) => node.textContent?.trim() ?? '')
            .filter(Boolean)
        : [];
      const shelfText = shelf?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      const headerText = header?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      const headerHtml = header?.innerHTML ?? '';
      globalWindow.__composerHeaderSamples__ ??= [];
      globalWindow.__composerHeaderSamples__.push({
        timestamp: Date.now(),
        shelfTitles,
        shelfText,
        headerText,
        headerHtml
      });
    };

    globalWindow.__composerHeaderSamples__ = [];
    globalWindow.__composerHeaderObserver__?.disconnect();
    const observer = new MutationObserver(() => recordSample());
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true
    });
    globalWindow.__composerHeaderObserver__ = observer;
    recordSample();

    window.vicode.composer.submit = async (input) => {
      await new Promise((resolve) => window.setTimeout(resolve, 900));
      const thread = await window.vicode.threads.open(input.threadId!);
      return {
        disposition: 'started',
        thread,
        runId: 'flash-check-run'
      };
    };
  });
}

async function installPlannerDraftSubmitStub(window: Page, threadId: string) {
  await window.evaluate(({ threadId }) => {
    const globalWindow = window as typeof window & {
      __originalPlannerSubmit__?: typeof window.vicode.planner.submit;
      __originalPlannerCancel__?: typeof window.vicode.planner.cancel;
      __originalThreadOpen__?: typeof window.vicode.threads.open;
      __plannerDraftThread__?: Awaited<ReturnType<typeof window.vicode.threads.open>> | null;
    };

    if (!globalWindow.__originalPlannerSubmit__) {
      globalWindow.__originalPlannerSubmit__ = window.vicode.planner.submit;
    }
    if (!globalWindow.__originalPlannerCancel__) {
      globalWindow.__originalPlannerCancel__ = window.vicode.planner.cancel;
    }
    if (!globalWindow.__originalThreadOpen__) {
      globalWindow.__originalThreadOpen__ = window.vicode.threads.open;
    }

    window.vicode.threads.open = async (targetThreadId) => {
      if (targetThreadId === threadId && globalWindow.__plannerDraftThread__) {
        return globalWindow.__plannerDraftThread__;
      }
      return await globalWindow.__originalThreadOpen__!(targetThreadId);
    };

    window.vicode.planner.cancel = async (input) => {
      globalWindow.__plannerDraftThread__ = null;
      return await globalWindow.__originalPlannerCancel__!(input);
    };

    window.vicode.planner.submit = async () => {
      const thread = await globalWindow.__originalThreadOpen__!(threadId);
      const draftThread = {
        ...thread,
        status: 'completed' as const,
        planner: {
          ...thread.planner,
          composerMode: 'plan' as const,
          turnState: 'plan_ready' as const,
          activePlanId: 'fake-plan-1',
          pendingQuestionCallId: null,
          activePlan: {
            id: 'fake-plan-1',
            threadId: thread.id,
            createdTurnId: thread.turns.at(-1)?.id ?? `turn-${thread.id}`,
            proposedPlanMarkdown: [
              '# Fake plan',
              '',
              '1. Audit the current state.',
              '2. Implement the narrow fix.',
              '3. Verify the change.'
            ].join('\n'),
            structuredPlan: {
              title: 'Fake plan',
              summary: ['Audit the current state before making changes.'],
              keyChanges: ['Implement the narrow fix in the composer shelf path.'],
              testPlan: ['Verify the shelf no longer flashes after cancel.'],
              assumptions: ['This fake draft exists only for Electron regression coverage.']
            },
            status: 'draft' as const,
            createdAt: new Date().toISOString()
          },
          pendingQuestionSet: null,
          updatedAt: new Date().toISOString()
        }
      };
      globalWindow.__plannerDraftThread__ = draftThread;
      return {
        thread: draftThread,
        runId: 'fake-plan-run'
      };
    };
  }, { threadId });
}

async function restoreSubmitStub(window: Page) {
  await window.evaluate(() => {
    const globalWindow = window as typeof window & {
      __originalComposerSubmit__?: typeof window.vicode.composer.submit;
      __originalPlannerSubmit__?: typeof window.vicode.planner.submit;
      __originalPlannerCancel__?: typeof window.vicode.planner.cancel;
      __originalThreadOpen__?: typeof window.vicode.threads.open;
      __composerHeaderObserver__?: MutationObserver;
      __plannerDraftThread__?: Awaited<ReturnType<typeof window.vicode.threads.open>> | null;
    };

    if (globalWindow.__originalComposerSubmit__) {
      window.vicode.composer.submit = globalWindow.__originalComposerSubmit__;
      delete globalWindow.__originalComposerSubmit__;
    }
    if (globalWindow.__originalPlannerSubmit__) {
      window.vicode.planner.submit = globalWindow.__originalPlannerSubmit__;
      delete globalWindow.__originalPlannerSubmit__;
    }
    if (globalWindow.__originalPlannerCancel__) {
      window.vicode.planner.cancel = globalWindow.__originalPlannerCancel__;
      delete globalWindow.__originalPlannerCancel__;
    }
    if (globalWindow.__originalThreadOpen__) {
      window.vicode.threads.open = globalWindow.__originalThreadOpen__;
      delete globalWindow.__originalThreadOpen__;
    }
    delete globalWindow.__plannerDraftThread__;
    globalWindow.__composerHeaderObserver__?.disconnect();
    delete globalWindow.__composerHeaderObserver__;
  });
}

async function readComposerHeaderSamples(window: Page) {
  return await window.evaluate(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 1_200));
    const globalWindow = window as typeof window & {
      __composerHeaderSamples__?: Array<{
        timestamp: number;
        shelfTitles: string[];
        shelfText: string;
        headerText: string;
        headerHtml: string;
      }>;
      __composerHeaderObserver__?: MutationObserver;
    };

    globalWindow.__composerHeaderObserver__?.disconnect();
    delete globalWindow.__composerHeaderObserver__;
    return globalWindow.__composerHeaderSamples__ ?? [];
  });
}

test.describe.serial('planner cancel flash regression', () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-planner-cancel-flash-workspace-'));
  let app: ElectronApplication | null = null;
  let window: Page | null = null;

  test.beforeAll(async () => {
    ({ app, window } = await launchElectronApp({
      bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.composer', 'vicode.planner', 'vicode.providers']
    }));
    await createPlannerCancelFixture(window, workspaceDir);
    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.composer', 'vicode.planner', 'vicode.providers']);
  });

  test.afterAll(async () => {
    if (window) {
      await restoreSubmitStub(window).catch(() => {});
    }
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  test('does not flash a composer activity shelf after cancelling plan mode and sending a normal prompt', async () => {
    test.skip(!window);

    await expect(window!.getByTestId('composer-input')).toBeVisible();
    await expect(window!.getByTestId('composer-activity-shelf')).toHaveCount(0);

    await installDelayedSubmitStub(window!);

    try {
      const composer = window!.getByTestId('composer-input');
      await composer.fill('Check whether anything flashes above the composer.');
      await window!.getByTestId('composer-submit-button').click();

      const samples = await readComposerHeaderSamples(window!);
      const flashes = samples.filter((sample) => sample.shelfTitles.length > 0);
      expect(flashes).toEqual([]);
    } finally {
      await restoreSubmitStub(window!);
    }
  });

  test.fixme('does not flash after cancelling a rendered planner draft and sending a normal prompt', async () => {
    test.skip(!window);

    const threadId = await window!.evaluate(async () => {
      const settings = await window.vicode.settings.get();
      if (!settings.lastOpenedThreadId) {
        throw new Error('Expected a selected thread.');
      }
      return settings.lastOpenedThreadId;
    });

    await installPlannerDraftSubmitStub(window!, threadId);

    try {
      await window!.evaluate(async ({ threadId }) => {
        await window.vicode.planner.setMode({ threadId, mode: 'plan' });
      }, { threadId });

      const composer = window!.getByTestId('composer-input');
      await composer.fill('Make a plan first.');
      await window!.getByTestId('composer-submit-button').click();

      await expect(window!.getByTestId('planner-plan-card')).toBeVisible();
      await window!.getByTestId('planner-cancel-plan').click();
      await expect(window!.getByTestId('planner-plan-card')).toHaveCount(0);
      await expect(window!.getByTestId('composer-activity-shelf')).toHaveCount(0);

      await installDelayedSubmitStub(window!);
      await composer.fill('Check whether anything flashes after cancelling a draft.');
      await window!.getByTestId('composer-submit-button').click();

      const samples = await readComposerHeaderSamples(window!);
      const flashes = samples.filter((sample) => sample.shelfTitles.length > 0);
      expect(flashes).toEqual([]);
    } finally {
      await restoreSubmitStub(window!);
    }
  });
});
