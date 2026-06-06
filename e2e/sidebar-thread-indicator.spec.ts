import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { closeApp, launchApp, waitForBridge } from './helpers/electron';

async function seedSidebarFixture(window: Page, workspaceDir: string) {
  return await window.evaluate(async ({ workspaceDir }) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    const provider =
      bootstrap.providers.find((entry) => entry.id === 'ollama') ??
      bootstrap.providers.find((entry) => entry.id === 'openai_compatible') ??
      null;

    if (!provider) {
      throw new Error('Expected a release-facing provider for the sidebar fixture.');
    }

    const project = await window.vicode.projects.create({
      name: `Sidebar indicator ${Date.now()}`,
      folderPath: workspaceDir,
      trusted: true
    });

    const modelId =
      project.defaultModelByProvider[provider.id] ??
      bootstrap.preferences.defaultModelByProvider[provider.id] ??
      provider.models[0]?.id ??
      'qwen2.5-coder:14b-instruct-q6_K';

    const firstThread = await window.vicode.threads.create({
      projectId: project.id,
      providerId: provider.id,
      modelId,
      executionPermission: 'default'
    });

    const activeThread = await window.vicode.threads.create({
      projectId: project.id,
      providerId: provider.id,
      modelId,
      executionPermission: 'default'
    });

    await window.vicode.settings.save({
      selectedProjectId: project.id,
      lastOpenedThreadId: activeThread.id
    });

    return {
      projectId: project.id,
      threadIds: [firstThread.id, activeThread.id],
      activeThreadId: activeThread.id,
      inactiveThreadId: firstThread.id
    };
  }, { workspaceDir });
}

async function cleanupFixture(
  window: Page | null,
  fixture: { projectId: string | null; threadIds: string[] }
) {
  if (!window) {
    return;
  }

  await window.evaluate(async ({ projectId, threadIds }) => {
    for (const threadId of threadIds) {
      await window.vicode.threads.remove(threadId).catch(() => {});
    }
    if (projectId) {
      await window.vicode.projects.remove(projectId).catch(() => {});
    }
  }, fixture).catch(() => {});
}

test.describe.serial('sidebar thread indicator', () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-sidebar-indicator-'));
  let app: ElectronApplication | null = null;
  let window: Page | null = null;
  let fixture: { projectId: string | null; threadIds: string[]; activeThreadId: string | null; inactiveThreadId: string | null } = {
    projectId: null,
    threadIds: [],
    activeThreadId: null,
    inactiveThreadId: null
  };

  test.afterAll(async () => {
    await cleanupFixture(window, { projectId: fixture.projectId, threadIds: fixture.threadIds });
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  test('keeps active highlight on the selected thread instead of the expanded project', async () => {
    const launched = await launchApp({
      bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']
    });
    app = launched.app;
    window = launched.window;

    fixture = await seedSidebarFixture(window, workspaceDir);
    await window.evaluate(() => {
      window.localStorage.setItem('vicode.sidebar.collapsed', 'false');
      window.localStorage.setItem('vicode.sidebar.width', '340');
    });
    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']);

    const activeRow = window.getByTestId(`thread-row-${fixture.activeThreadId}`);
    const inactiveRow = window.getByTestId(`thread-row-${fixture.inactiveThreadId}`);
    await expect(activeRow).toBeVisible();
    await expect(inactiveRow).toBeVisible();

    const selectionState = await window.evaluate(({ projectId, activeThreadId, inactiveThreadId }) => {
      const project = document.querySelector(`[data-testid="project-row-${projectId}"]`);
      const activeRow = document.querySelector(`[data-testid="thread-row-${activeThreadId}"]`);
      const inactiveRow = document.querySelector(`[data-testid="thread-row-${inactiveThreadId}"]`);
      const activeShell = activeRow?.parentElement;
      const inactiveShell = inactiveRow?.parentElement;
      return {
        projectClassName: project instanceof HTMLElement ? project.className : null,
        projectShellClassName: project?.parentElement instanceof HTMLElement ? project.parentElement.className : null,
        activeThreadClassName: activeRow instanceof HTMLElement ? activeRow.className : null,
        activeShellClassName: activeShell instanceof HTMLElement ? activeShell.className : null,
        inactiveThreadClassName: inactiveRow instanceof HTMLElement ? inactiveRow.className : null,
        inactiveShellClassName: inactiveShell instanceof HTMLElement ? inactiveShell.className : null,
        activeThreadBackground: activeRow instanceof HTMLElement ? window.getComputedStyle(activeRow).backgroundColor : null,
        projectBackground: project instanceof HTMLElement ? window.getComputedStyle(project).backgroundColor : null
      };
    }, {
      projectId: fixture.projectId,
      activeThreadId: fixture.activeThreadId,
      inactiveThreadId: fixture.inactiveThreadId
    });

    expect(selectionState.projectClassName).not.toBeNull();
    expect(selectionState.projectShellClassName).toContain('is-expanded');
    expect(selectionState.projectClassName).not.toContain('is-active');
    expect(selectionState.activeThreadClassName).toContain('is-active');
    expect(selectionState.activeShellClassName).toContain('is-active-thread');
    expect(selectionState.inactiveThreadClassName).not.toContain('is-active');
    expect(selectionState.inactiveShellClassName).not.toContain('is-active-thread');
    expect(selectionState.activeThreadBackground).not.toBe(selectionState.projectBackground);
  });
});
