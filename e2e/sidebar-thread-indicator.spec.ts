import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { closeApp, launchApp, waitForBridge } from './helpers/electron';

async function seedSidebarFixture(window: Page, workspaceDir: string) {
  return await window.evaluate(async ({ workspaceDir }) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    const provider =
      bootstrap.providers.find((entry) => entry.id === 'openai') ??
      bootstrap.providers.find((entry) => entry.id === 'gemini') ??
      bootstrap.providers.find((entry) => entry.id === 'ollama') ??
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
      'gpt-5';

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

  test('draws one connector rail with row elbows for thread rows', async () => {
    const launched = await launchApp({
      bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']
    });
    app = launched.app;
    window = launched.window;

    fixture = await seedSidebarFixture(window, workspaceDir);
    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']);

    const activeRow = window.getByTestId(`thread-row-${fixture.activeThreadId}`);
    const inactiveRow = window.getByTestId(`thread-row-${fixture.inactiveThreadId}`);
    await expect(activeRow).toBeVisible();
    await expect(inactiveRow).toBeVisible();

    const connectorState = await window.evaluate(({ activeThreadId, inactiveThreadId }) => {
      const readConnector = (threadId: string | null) => {
        if (!threadId) {
          return null;
        }
        const row = document.querySelector(`[data-testid="thread-row-${threadId}"]`);
        const shell = row?.parentElement;
        const list = shell?.closest('.project-thread-list');
        if (!shell) {
          return null;
        }
        const pseudo = window.getComputedStyle(shell, '::before');
        const listPseudo = list ? window.getComputedStyle(list, '::before') : null;
        return {
          className: shell.className,
          width: pseudo.width,
          height: pseudo.height,
          borderLeftStyle: pseudo.borderLeftStyle,
          borderBottomStyle: pseudo.borderBottomStyle,
          borderBottomLeftRadius: pseudo.borderBottomLeftRadius,
          content: pseudo.content,
          listRailWidth: listPseudo?.width ?? null,
          listRailContent: listPseudo?.content ?? null
        };
      };

      return {
        active: readConnector(activeThreadId),
        inactive: readConnector(inactiveThreadId)
      };
    }, {
      activeThreadId: fixture.activeThreadId,
      inactiveThreadId: fixture.inactiveThreadId
    });

    expect(connectorState.active).not.toBeNull();
    expect(connectorState.active?.className).toContain('is-active-thread');
    expect(connectorState.active?.content).toBe('""');
    expect(connectorState.active?.listRailContent).toBe('""');
    expect(connectorState.active?.listRailWidth).toBe('1px');
    expect(connectorState.active?.borderLeftStyle).toBe('solid');
    expect(connectorState.active?.borderBottomStyle).toBe('solid');
    expect(connectorState.active?.width).not.toBe('0px');
    expect(connectorState.active?.height).not.toBe('0px');
    expect(connectorState.active?.borderBottomLeftRadius).not.toBe('0px');

    expect(connectorState.inactive).not.toBeNull();
    expect(connectorState.inactive?.className).not.toContain('is-active-thread');
    expect(connectorState.inactive?.content).toBe('""');
    expect(connectorState.inactive?.listRailContent).toBe('""');
    expect(connectorState.inactive?.listRailWidth).toBe('1px');
    expect(connectorState.inactive?.borderLeftStyle).toBe('solid');
    expect(connectorState.inactive?.borderBottomStyle).toBe('solid');
    expect(connectorState.inactive?.width).not.toBe('0px');
    expect(connectorState.inactive?.height).not.toBe('0px');
    expect(connectorState.inactive?.borderBottomLeftRadius).not.toBe('0px');
  });
});
