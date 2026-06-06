import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { closeApp, launchApp, waitForBridge } from './helpers/electron';
import {
  detectAssistantTextQuality,
  type AssistantTextQualitySummary
} from '../src/shared/assistant-text/text-quality-detector';

const OLLAMA_14B_MODEL = 'qwen2.5-coder:14b-instruct-q6_K';

const bridgePaths = [
  'vicode.app',
  'vicode.projects',
  'vicode.threads',
  'vicode.settings',
  'vicode.providers',
  'vicode.composer'
];

function createRu01Workspace() {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-real-user-ru-01-'));
  mkdirSync(path.join(workspaceDir, 'src'), { recursive: true });
  writeFileSync(
    path.join(workspaceDir, 'package.json'),
    JSON.stringify(
      {
        name: 'vicode-real-user-ru-01',
        private: true,
        scripts: {
          dev: 'vite --host 127.0.0.1',
          build: 'vite build',
          test: 'vitest run'
        },
        dependencies: {
          '@vitejs/plugin-react': '^5.1.0',
          vite: '^7.2.2',
          typescript: '^5.9.3'
        }
      },
      null,
      2
    ),
    'utf8'
  );
  writeFileSync(
    path.join(workspaceDir, 'README.md'),
    [
      '# RU-01 Real User Workspace',
      '',
      'This temporary project verifies that Vicode can open a real folder,',
      'create a project, restore a thread, and show the core composer UI.'
    ].join('\n'),
    'utf8'
  );
  writeFileSync(path.join(workspaceDir, 'src', 'main.ts'), 'console.log("ru-01");\n', 'utf8');
  return workspaceDir;
}

async function seedProjectAndThread(window: Page, workspaceDir: string) {
  const seeded = await window.evaluate(
    async ({ workspaceDir, preferredModel }) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const provider =
        bootstrap.providers.find((entry) => entry.id === 'ollama') ??
        bootstrap.providers.find((entry) => entry.id === 'openai_compatible') ??
        bootstrap.providers[0] ??
        null;

      if (!provider) {
        throw new Error('Expected at least one configured provider for RU-01.');
      }

      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const modelId =
        provider.models.find((model) => model.id === preferredModel)?.id ??
        bootstrap.preferences.defaultModelByProvider[provider.id] ??
        provider.models[0]?.id ??
        'qwen2.5-coder:14b-instruct-q6_K';
      const project = await window.vicode.projects.create({
        name: `RU-01 harness ${suffix}`,
        folderPath: workspaceDir,
        trusted: true,
        runtimeCommandPolicy: 'approval_required',
        runtimeNetworkPolicy: 'enabled'
      });
      const thread = await window.vicode.threads.create({
        projectId: project.id,
        providerId: provider.id,
        modelId,
        executionPermission: 'default'
      });

      await window.vicode.settings.save({
        onboardingComplete: true,
        selectedProjectId: project.id,
        lastOpenedThreadId: thread.id,
        defaultProviderId: provider.id,
        defaultModelByProvider: {
          ...bootstrap.preferences.defaultModelByProvider,
          [provider.id]: modelId
        }
      });

      return {
        modelId,
        projectId: project.id,
        projectName: project.name,
        providerId: provider.id,
        threadId: thread.id
      };
    },
    { workspaceDir, preferredModel: OLLAMA_14B_MODEL }
  );

  await window.reload({ waitUntil: 'domcontentloaded' });
  await waitForBridge(window, bridgePaths);
  await expect(window.getByTestId('composer-input')).toBeVisible();
  return seeded;
}

async function cleanupProjectAndThread(
  window: Page | null,
  fixture: { projectId: string | null; threadId: string | null }
) {
  if (!window) {
    return;
  }

  await window.evaluate(async ({ projectId, threadId }) => {
    if (threadId) {
      await window.vicode.threads.remove(threadId).catch(() => {});
    }
    if (projectId) {
      await window.vicode.projects.remove(projectId).catch(() => {});
    }
    await window.vicode.settings.save({
      selectedProjectId: null,
      lastOpenedThreadId: null
    });
  }, fixture).catch(() => {});
}

async function collectRu01Metrics(window: Page, fixture: {
  projectId: string;
  projectName: string;
  providerId: string;
  modelId: string;
  workspaceName: string;
}) {
  return await window.evaluate(({ projectId, projectName, providerId, modelId, workspaceName }) => {
    const issues: string[] = [];

    const isVisible = (element: Element | null) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0.01;
    };

    const measure = (label: string, selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        issues.push(`${label} missing`);
        return null;
      }
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      if (!isVisible(element)) {
        issues.push(`${label} hidden`);
      }
      if (rect.left < -2 || rect.top < -2 || rect.right > window.innerWidth + 2 || rect.bottom > window.innerHeight + 2) {
        issues.push(`${label} outside viewport ${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.right)},${Math.round(rect.bottom)}`);
      }
      return {
        bottom: rect.bottom,
        boxShadow: style.boxShadow,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        text: element.textContent?.replace(/\s+/g, ' ').trim().slice(0, 180) ?? '',
        top: rect.top,
        width: rect.width
      };
    };

    const regions = {
      appShell: measure('app shell', '.app-workspace-shell'),
      sidebar: measure('sidebar', '.sidebar-shell'),
      mainSurface: measure('main surface', '.main-surface'),
      threadView: measure('thread view', '.thread-view'),
      transcriptRail: measure('transcript rail', '.thread-transcript-rail'),
      composerStack: measure('composer stack', '.thread-composer-stack'),
      composerShell: measure('composer shell', '.composer-shell'),
      projectRow: measure('project row', `[data-testid="project-row-${projectId}"]`),
      composerInput: measure('composer input', '[data-testid="composer-input"]')
    };

    const controls = [
      ['actions', '[data-testid="composer-action-menu-trigger"]'],
      ['model', '[data-testid="composer-model-select"]'],
      ['workspace', '[data-testid="composer-workspace-select"]'],
      ['voice', '[data-testid="composer-voice-button"]'],
      ['submit', '[data-testid="composer-submit-button"]']
    ] as const;
    const controlRects = controls.flatMap(([label, selector]) => {
      const measured = measure(`composer ${label}`, selector);
      if (!measured) {
        return [];
      }
      if (measured.width < 28 || measured.height < 28) {
        issues.push(`composer ${label} too small ${Math.round(measured.width)}x${Math.round(measured.height)}`);
      }
      return [{ label, ...measured }];
    });

    for (let outer = 0; outer < controlRects.length; outer += 1) {
      for (let inner = outer + 1; inner < controlRects.length; inner += 1) {
        const first = controlRects[outer]!;
        const second = controlRects[inner]!;
        const overlapX = Math.min(first.right, second.right) - Math.max(first.left, second.left);
        const overlapY = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
        if (overlapX > 2 && overlapY > 2) {
          issues.push(`composer ${first.label} overlaps ${second.label}`);
        }
      }
    }

    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) {
      issues.push(`horizontal page overflow ${root.scrollWidth} > ${root.clientWidth}`);
    }

    const bodyText = document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const projectRowText = regions.projectRow?.text ?? '';
    const titlebarText = document.querySelector('.windows-titlebar-context')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const inlineNoticeCount = document.querySelectorAll('[data-testid="app-inline-notice"]').length;
    const legacySetupCount =
      document.querySelectorAll('[data-testid="workspace-bootstrap-open"]').length +
      (bodyText.match(/\bSet up project\b/g)?.length ?? 0);
    const composerContextCounterCount = document.querySelectorAll('[data-testid="composer-context-window-trigger"]').length;
    const transcriptPills = document.querySelectorAll('.run-transcript-timeline .ui-status-pill, .run-transcript-timeline .status-pill').length;

    if (!projectRowText.includes(projectName) && !projectRowText.includes(workspaceName)) {
      issues.push('project row does not show selected project or workspace name');
    }
    if (!titlebarText.includes(projectName)) {
      issues.push('titlebar does not show selected project name');
    }
    if (inlineNoticeCount > 0) {
      issues.push(`unexpected inline notices ${inlineNoticeCount}`);
    }
    if (legacySetupCount > 0) {
      issues.push(`legacy setup surface visible ${legacySetupCount}`);
    }
    if (composerContextCounterCount > 0) {
      issues.push('composer shows context usage counter');
    }
    if (transcriptPills > 0) {
      issues.push(`transcript shows status pills before run ${transcriptPills}`);
    }

    return {
      bodyText: bodyText.slice(0, 1000),
      composerContextCounterCount,
      controlRects,
      inlineNoticeCount,
      legacySetupCount,
      modelId,
      projectId,
      projectName,
      providerId,
      regions,
      screenshotViewport: `${window.innerWidth}x${window.innerHeight}`,
      titlebarText,
      transcriptPills,
      workspaceName,
      issues
    };
  }, fixture);
}

function expectNoVisibleShadow(value: string | undefined | null) {
  if (!value || value === 'none') {
    return;
  }
  expect(value).toMatch(/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/u);
  expect(value.replace(/rgba\([^)]+\)/gu, '').replace(/,/gu, '').trim()).toMatch(/^(0px\s*)+$/u);
}

async function waitForChatTurnCompletion(window: Page, threadId: string, assistantCount: number, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  let lastDetail: Awaited<ReturnType<Page['evaluate']>> | null = null;

  while (Date.now() < deadline) {
    const detail = await window.evaluate(async (id) => window.vicode.threads.open(id), threadId);
    lastDetail = detail;
    const assistantTurns = detail.turns.filter((turn) => turn.role === 'assistant' && turn.content.trim().length > 0);
    if (detail.status === 'completed' && assistantTurns.length >= assistantCount) {
      return {
        detail,
        assistantTurn: assistantTurns[assistantTurns.length - 1]!
      };
    }
    await window.waitForTimeout(750);
  }

  throw new Error(`Timed out waiting for chat turn ${assistantCount}. Last thread detail: ${JSON.stringify(lastDetail, null, 2)}`);
}

async function collectChatOnlyMetrics(window: Page, threadId: string) {
  return await window.evaluate(async (id) => {
    const detail = await window.vicode.threads.open(id);
    const bodyText = document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const rawActivityKinds = detail.rawOutput
      .map((event) => {
        const payload = event.payload as { activity?: { kind?: unknown } } | undefined;
        return typeof payload?.activity?.kind === 'string' ? payload.activity.kind : null;
      })
      .filter((kind): kind is string => Boolean(kind));
    return {
      assistantTurnCount: detail.turns.filter((turn) => turn.role === 'assistant').length,
      bodyPreview: bodyText.slice(0, 1200),
      commandEvidenceRows: document.querySelectorAll('.run-transcript-command-entry, .run-transcript-command-group-label').length,
      fileChangeRows: document.querySelectorAll('.run-change-card, .run-transcript-file-change').length,
      inlineNoticeCount: document.querySelectorAll('[data-testid="app-inline-notice"]').length,
      rawActivityKinds,
      runStoppedCopyCount: (bodyText.match(/Run stopped by user\./g) ?? []).length,
      startTaskButtonCount: Array.from(document.querySelectorAll('button')).filter((button) => /start task/i.test(button.textContent ?? '')).length,
      status: detail.status,
      transcriptPills: document.querySelectorAll('.run-transcript-timeline .ui-status-pill, .run-transcript-timeline .status-pill').length,
      userTurnCount: detail.turns.filter((turn) => turn.role === 'user').length,
      workedForCount: document.querySelectorAll('.run-transcript-worked-for, .run-transcript-activity-group.is-worked-for-summary').length
    };
  }, threadId);
}

test('@live-provider RU-01 opens a real project thread without startup layout or popup defects', async ({}, testInfo) => {
  const workspaceDir = createRu01Workspace();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  let app: Awaited<ReturnType<typeof launchApp>>['app'] | null = null;
  let window: Page | null = null;
  const fixture = {
    projectId: null as string | null,
    threadId: null as string | null
  };

  try {
    const launched = await launchApp({ bridgePaths });
    app = launched.app;
    window = launched.window;
    window.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    window.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    const seeded = await seedProjectAndThread(window, workspaceDir);
    fixture.projectId = seeded.projectId;
    fixture.threadId = seeded.threadId;

    const metrics = await collectRu01Metrics(window, {
      ...seeded,
      workspaceName: path.basename(workspaceDir)
    });
    const screenshotPath = testInfo.outputPath('ru-01-project-thread-opened.png');
    await window.screenshot({ path: screenshotPath, fullPage: false });
    await testInfo.attach('ru-01-project-thread-opened.png', {
      path: screenshotPath,
      contentType: 'image/png'
    });
    console.log(JSON.stringify({
      ruScenario: 'RU-01',
      screenshotPath,
      workspaceDir,
      pageErrors,
      consoleErrors,
      metrics
    }, null, 2));

    expect(metrics.providerId).toBe('ollama');
    expect(metrics.modelId).toBe(OLLAMA_14B_MODEL);
    expect(metrics.inlineNoticeCount).toBe(0);
    expect(metrics.legacySetupCount).toBe(0);
    expect(metrics.composerContextCounterCount).toBe(0);
    expect(metrics.transcriptPills).toBe(0);
    expect(metrics.issues).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expectNoVisibleShadow(metrics.regions.composerShell?.boxShadow);
  } finally {
    await cleanupProjectAndThread(window, fixture);
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('@live-provider RU-02 keeps a 10-message Ollama brainstorming thread chat-only and captures evidence', async ({}, testInfo) => {
  test.setTimeout(900_000);
  const workspaceDir = createRu01Workspace();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const observations: Array<{
    index: number;
    prompt: string;
    assistantPreview: string;
    textQuality: AssistantTextQualitySummary;
    malformedPatterns: string[];
    screenshotPath?: string;
  }> = [];
  let app: Awaited<ReturnType<typeof launchApp>>['app'] | null = null;
  let window: Page | null = null;
  const fixture = {
    projectId: null as string | null,
    threadId: null as string | null
  };
  const prompts = [
    'Let us brainstorm a tiny calculator app. Reply in two short sentences and keep this as discussion only; do not edit files.',
    'Who is the target user for this calculator? Keep it conversational and do not use tools or files.',
    'What are the first three features we should keep in scope? Keep this as chat only.',
    'What should the layout feel like if we want it simple and easy to scan?',
    'Should this first version be plain HTML or React? Discuss the tradeoff briefly; do not start building.',
    'What edge cases should we consider before implementation?',
    'How could a user manually verify the calculator after it is built?',
    'What should we avoid overbuilding in the first slice?',
    'Summarize the current plan in four short bullets, still discussion only and no file changes.',
    'Before we build, confirm you understand the goal in one short paragraph and keep this thread in brainstorming mode.'
  ];

  try {
    const launched = await launchApp({ bridgePaths });
    app = launched.app;
    window = launched.window;
    window.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });
    window.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    const seeded = await seedProjectAndThread(window, workspaceDir);
    fixture.projectId = seeded.projectId;
    fixture.threadId = seeded.threadId;
    expect(seeded.providerId).toBe('ollama');
    expect(seeded.modelId).toBe(OLLAMA_14B_MODEL);

    for (let index = 0; index < prompts.length; index += 1) {
      const prompt = prompts[index]!;
      const composer = window.getByTestId('composer-input');
      await composer.fill(prompt);
      await window.getByTestId('composer-submit-button').click();
      await expect(window.getByTestId('composer-submit-button')).toHaveAttribute('aria-label', 'Stop', { timeout: 30_000 });

      if (index === 0) {
        const activeScreenshotPath = testInfo.outputPath('ru-02-turn-01-active.png');
        await window.screenshot({ path: activeScreenshotPath, fullPage: false });
        await testInfo.attach('ru-02-turn-01-active.png', {
          path: activeScreenshotPath,
          contentType: 'image/png'
        });
      }

      const { assistantTurn } = await waitForChatTurnCompletion(window, seeded.threadId, index + 1);
      const assistantText = assistantTurn.content.trim();
      expect(assistantText.length).toBeGreaterThan(0);
      await expect(window.getByTestId('composer-submit-button')).toHaveAttribute('aria-label', 'Send');
      await expect(window.getByTestId('app-inline-notice')).toHaveCount(0);
      await expect(window.getByText(/Run stopped by user\./i)).toHaveCount(0);
      await expect(window.getByRole('button', { name: /start task/i })).toHaveCount(0);
      expect(assistantText).not.toMatch(/^\s*Using:\s+Vicode guidance/iu);
      const textQuality = detectAssistantTextQuality(assistantText);
      const malformedPatterns = textQuality.issues.map((issue) => issue.label);
      console.log(JSON.stringify({
        ruScenario: 'RU-02',
        turn: index + 1,
        assistantPreview: assistantText.replace(/\s+/g, ' ').slice(0, 260),
        textQuality
      }, null, 2));
      expect(
        malformedPatterns,
        JSON.stringify({
          turn: index + 1,
          assistantText,
          textQuality
        }, null, 2)
      ).toEqual([]);

      const observation: {
        index: number;
        prompt: string;
        assistantPreview: string;
        textQuality: AssistantTextQualitySummary;
        malformedPatterns: string[];
        screenshotPath?: string;
      } = {
        index: index + 1,
        prompt,
        assistantPreview: assistantText.replace(/\s+/g, ' ').slice(0, 260),
        textQuality,
        malformedPatterns
      };

      if (index === 0 || index === 4 || index === prompts.length - 1) {
        const screenshotPath = testInfo.outputPath(`ru-02-turn-${String(index + 1).padStart(2, '0')}-completed.png`);
        await window.screenshot({ path: screenshotPath, fullPage: false });
        await testInfo.attach(`ru-02-turn-${String(index + 1).padStart(2, '0')}-completed.png`, {
          path: screenshotPath,
          contentType: 'image/png'
        });
        observation.screenshotPath = screenshotPath;
      }

      observations.push(observation);
    }

    const metrics = await collectChatOnlyMetrics(window, seeded.threadId);
    const reportPath = testInfo.outputPath('ru-02-chat-only-audit.json');
    writeFileSync(reportPath, `${JSON.stringify({
      ruScenario: 'RU-02',
      workspaceDir,
      providerId: seeded.providerId,
      modelId: seeded.modelId,
      pageErrors,
      consoleErrors,
      metrics,
      observations
    }, null, 2)}\n`, 'utf8');
    await testInfo.attach('ru-02-chat-only-audit.json', {
      path: reportPath,
      contentType: 'application/json'
    });

    expect(metrics.status).toBe('completed');
    expect(metrics.userTurnCount).toBe(10);
    expect(metrics.assistantTurnCount).toBeGreaterThanOrEqual(10);
    expect(metrics.inlineNoticeCount).toBe(0);
    expect(metrics.runStoppedCopyCount).toBe(0);
    expect(metrics.startTaskButtonCount).toBe(0);
    expect(metrics.commandEvidenceRows).toBe(0);
    expect(metrics.fileChangeRows).toBe(0);
    expect(metrics.workedForCount).toBe(0);
    expect(metrics.transcriptPills).toBe(0);
    expect(metrics.rawActivityKinds.some((kind) => /command|file|write|patch|terminal/iu.test(kind))).toBe(false);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  } finally {
    await cleanupProjectAndThread(window, fixture);
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
