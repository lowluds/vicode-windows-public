import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';

import { closeApp, launchApp, waitForBridge } from './helpers/electron';

const tightViewport = { width: 980, height: 760 };
const sidebarWidthStorageKey = 'vicode.sidebar.width';
const sidebarCollapsedStorageKey = 'vicode.sidebar.collapsed';
const maxSidebarWidth = '420';

test('sidebar thread rows keep archive actions inside the shell at minimum app width', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-sidebar-tight-layout-'));
  let app: ElectronApplication | null = null;

  try {
    const launched = await launchApp({
      bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']
    });
    app = launched.app;
    const { window } = launched;

    await window.setViewportSize(tightViewport);

    const fixture = await window.evaluate(
      async ({ workspaceDir }) => {
        const bootstrap = await window.vicode.app.getBootstrap();
        const provider = bootstrap.providers.find((entry) => entry.installed) ?? bootstrap.providers[0] ?? null;

        if (!provider) {
          throw new Error('Expected at least one provider for sidebar tight-layout coverage.');
        }

        const project = await window.vicode.projects.create({
          name: 'Sidebar tight layout',
          folderPath: workspaceDir,
          trusted: true
        });

        const modelId =
          project.defaultModelByProvider[provider.id] ??
          bootstrap.preferences.defaultModelByProvider[provider.id] ??
          provider.models[0]?.id ??
          'gpt-5';

        const primaryThread = await window.vicode.threads.create({
          projectId: project.id,
          title: 'https://portfolioite.framer.website/ research this page and draft a focused implementation brief',
          providerId: provider.id,
          modelId,
          executionPermission: 'default'
        });

        await window.vicode.threads.create({
          projectId: project.id,
          title: 'Add Toronto Weather Feature',
          providerId: provider.id,
          modelId,
          executionPermission: 'default'
        });

        await window.vicode.settings.save({
          selectedProjectId: project.id,
          lastOpenedThreadId: primaryThread.id
        });

        return {
          projectId: project.id,
          threadId: primaryThread.id
        };
      },
      { workspaceDir: workspaceDir.replace(/\\/g, '/') }
    );

    await window.evaluate(
      ({ sidebarWidthStorageKey, sidebarCollapsedStorageKey, maxSidebarWidth }) => {
        window.localStorage.setItem(sidebarWidthStorageKey, maxSidebarWidth);
        window.localStorage.setItem(sidebarCollapsedStorageKey, 'false');
      },
      { sidebarWidthStorageKey, sidebarCollapsedStorageKey, maxSidebarWidth }
    );

    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']);
    await window.setViewportSize(tightViewport);

    const projectRow = window.getByTestId(`project-row-${fixture.projectId}`);
    await expect(projectRow).toBeVisible();
    if ((await projectRow.getAttribute('aria-expanded')) !== 'true') {
      await projectRow.click();
    }

    const threadRow = window.getByTestId(`thread-row-${fixture.threadId}`);
    await expect(threadRow).toBeVisible();
    await threadRow.hover();
    await window.waitForTimeout(150);

    const layout = await window.evaluate(({ threadId }) => {
      const row = document.querySelector(`[data-testid="thread-row-${threadId}"]`);
      const shell = row?.parentElement;
      const archiveButton = shell?.querySelector('.sidebar-thread-archive-button');
      const separator = document.querySelector('.sidebar-resize-rail');
      const scroll = document.querySelector('.workspace-sidebar-scroll.thread-tree');

      if (!(row instanceof HTMLElement) || !(shell instanceof HTMLElement) || !(archiveButton instanceof HTMLElement)) {
        throw new Error('Expected tight-layout sidebar elements to be present.');
      }
      if (!(separator instanceof HTMLElement) || !(scroll instanceof HTMLElement)) {
        throw new Error('Expected the sidebar separator and scroll container to be present.');
      }

      const rowRect = row.getBoundingClientRect();
      const archiveRect = archiveButton.getBoundingClientRect();
      const separatorRect = separator.getBoundingClientRect();
      const scrollRect = scroll.getBoundingClientRect();

      return {
        rowRight: rowRect.right,
        archiveRight: archiveRect.right,
        archiveWidth: archiveRect.width,
        archiveOpacity: window.getComputedStyle(archiveButton).opacity,
        separatorLeft: separatorRect.left,
        scrollRight: scrollRect.right
      };
    }, { threadId: fixture.threadId });

    expect(layout.archiveOpacity).toBe('1');
    expect(layout.archiveWidth).toBeGreaterThan(0);
    expect(layout.rowRight).toBeLessThanOrEqual(layout.separatorLeft - 4);
    expect(layout.archiveRight).toBeLessThanOrEqual(layout.separatorLeft - 4);
    expect(layout.archiveRight).toBeLessThanOrEqual(layout.scrollRight);
  } finally {
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
