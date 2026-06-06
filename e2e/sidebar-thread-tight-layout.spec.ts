import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';

import { closeApp, launchApp, waitForBridge } from './helpers/electron';

const tightViewport = { width: 980, height: 760 };
const sidebarWidthStorageKey = 'vicode.sidebar.width';
const sidebarCollapsedStorageKey = 'vicode.sidebar.collapsed';
const workLibraryRailWidthStorageKey = 'vicode.work-library.rail.width';
const workLibraryRailCollapsedStorageKey = 'vicode.work-library.rail.collapsed';
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
        const provider =
          bootstrap.providers.find((entry) => entry.id === 'ollama') ??
          bootstrap.providers.find((entry) => entry.id === 'openai_compatible') ??
          null;

        if (!provider) {
          throw new Error('Expected a release-facing provider for sidebar tight-layout coverage.');
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
          'qwen2.5-coder:14b-instruct-q6_K';

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
      const actionButton = shell?.querySelector('.sidebar-thread-action-button');
      const separator = document.querySelector('.sidebar-resize-rail');
      const scroll = document.querySelector('.workspace-sidebar-scroll.thread-tree');

      if (!(row instanceof HTMLElement) || !(shell instanceof HTMLElement) || !(actionButton instanceof HTMLElement)) {
        throw new Error('Expected tight-layout sidebar elements to be present.');
      }
      if (!(separator instanceof HTMLElement) || !(scroll instanceof HTMLElement)) {
        throw new Error('Expected the sidebar separator and scroll container to be present.');
      }

      const rowRect = row.getBoundingClientRect();
      const actionRect = actionButton.getBoundingClientRect();
      const separatorRect = separator.getBoundingClientRect();
      const scrollRect = scroll.getBoundingClientRect();

      return {
        rowRight: rowRect.right,
        actionRight: actionRect.right,
        actionWidth: actionRect.width,
        actionOpacity: window.getComputedStyle(actionButton).opacity,
        separatorLeft: separatorRect.left,
        scrollRight: scrollRect.right
      };
    }, { threadId: fixture.threadId });

    expect(layout.actionOpacity).toBe('1');
    expect(layout.actionWidth).toBeGreaterThan(0);
    expect(layout.rowRight).toBeLessThanOrEqual(layout.separatorLeft - 4);
    expect(layout.actionRight).toBeLessThanOrEqual(layout.separatorLeft - 4);
    expect(layout.actionRight).toBeLessThanOrEqual(layout.scrollRight);
  } finally {
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('sidebar resize shows the icon-only rail while the pointer is still held', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-sidebar-live-resize-'));
  let app: ElectronApplication | null = null;

  try {
    const launched = await launchApp({
      bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']
    });
    app = launched.app;
    const { window } = launched;

    await window.setViewportSize(tightViewport);
    await window.evaluate(
      async ({ workspaceDir }) => {
        const bootstrap = await window.vicode.app.getBootstrap();
        const provider =
          bootstrap.providers.find((entry) => entry.id === 'ollama') ??
          bootstrap.providers.find((entry) => entry.id === 'openai_compatible') ??
          null;

        if (!provider) {
          throw new Error('Expected a release-facing provider for sidebar live-resize coverage.');
        }

        const project = await window.vicode.projects.create({
          name: 'Sidebar live resize',
          folderPath: workspaceDir,
          trusted: true
        });

        const modelId =
          project.defaultModelByProvider[provider.id] ??
          bootstrap.preferences.defaultModelByProvider[provider.id] ??
          provider.models[0]?.id ??
          'qwen2.5-coder:14b-instruct-q6_K';

        const thread = await window.vicode.threads.create({
          projectId: project.id,
          title: 'Sidebar live resize thread',
          providerId: provider.id,
          modelId,
          executionPermission: 'default'
        });

        await window.vicode.settings.save({
          selectedProjectId: project.id,
          lastOpenedThreadId: thread.id
        });
      },
      { workspaceDir: workspaceDir.replace(/\\/g, '/') }
    );
    await window.evaluate(
      ({ sidebarWidthStorageKey, sidebarCollapsedStorageKey }) => {
        window.localStorage.setItem(sidebarWidthStorageKey, '340');
        window.localStorage.setItem(sidebarCollapsedStorageKey, 'false');
      },
      { sidebarWidthStorageKey, sidebarCollapsedStorageKey }
    );
    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']);
    await window.setViewportSize(tightViewport);

    const resizeTarget = window.getByTestId('sidebar-resize-hit-target');
    await expect(resizeTarget).toBeVisible();
    const resizeBox = await resizeTarget.boundingBox();
    if (!resizeBox) {
      throw new Error('Expected sidebar resize target to have a bounding box.');
    }

    const dragY = resizeBox.y + resizeBox.height / 2;
    await window.mouse.move(resizeBox.x + resizeBox.width / 2, dragY);
    await window.mouse.down();
    await window.mouse.move(42, dragY, { steps: 8 });
    await window.waitForTimeout(120);

    const iconOnlyLayout = await window.evaluate(() => {
      const sidebar = document.querySelector('.workspace-sidebar');
      const rail = document.querySelector('.work-library-rail');
      const footer = document.querySelector('.work-library-rail-footer');
      const search = document.querySelector('.work-library-searchbar');
      const content = document.querySelector('.work-library-content');

      if (!(sidebar instanceof HTMLElement) || !(rail instanceof HTMLElement) || !(footer instanceof HTMLElement)) {
        throw new Error('Expected icon-only sidebar elements to be present during resize.');
      }

      const railRect = rail.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return {
        iconOnly: sidebar.classList.contains('is-icon-only'),
        searchVisible: search instanceof HTMLElement && search.getBoundingClientRect().width > 0,
        contentVisible: content instanceof HTMLElement && content.getBoundingClientRect().width > 0,
        footerBottomDistance: Math.abs(railRect.bottom - footerRect.bottom)
      };
    });

    expect(iconOnlyLayout.iconOnly).toBe(true);
    expect(iconOnlyLayout.searchVisible).toBe(false);
    expect(iconOnlyLayout.contentVisible).toBe(false);
    expect(iconOnlyLayout.footerBottomDistance).toBeLessThanOrEqual(8);

    await window.mouse.move(resizeBox.x + resizeBox.width / 2, dragY, { steps: 8 });
    await window.waitForTimeout(120);

    const expandedLayout = await window.evaluate(() => {
      const sidebar = document.querySelector('.workspace-sidebar');
      const search = document.querySelector('.work-library-searchbar');
      const content = document.querySelector('.work-library-content');

      if (!(sidebar instanceof HTMLElement)) {
        throw new Error('Expected sidebar to be present during expanded resize.');
      }

      return {
        iconOnly: sidebar.classList.contains('is-icon-only'),
        searchVisible: search instanceof HTMLElement && search.getBoundingClientRect().width > 0,
        contentVisible: content instanceof HTMLElement && content.getBoundingClientRect().width > 0
      };
    });

    expect(expandedLayout.iconOnly).toBe(false);
    expect(expandedLayout.searchVisible).toBe(true);
    expect(expandedLayout.contentVisible).toBe(true);
    await window.mouse.up();
  } finally {
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test('work library rail remembers its resized width across reloads', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-sidebar-rail-persistence-'));
  let app: ElectronApplication | null = null;

  try {
    const launched = await launchApp({
      bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']
    });
    app = launched.app;
    const { window } = launched;

    await window.setViewportSize(tightViewport);
    await window.evaluate(
      async ({ workspaceDir }) => {
        const bootstrap = await window.vicode.app.getBootstrap();
        const provider =
          bootstrap.providers.find((entry) => entry.id === 'ollama') ??
          bootstrap.providers.find((entry) => entry.id === 'openai_compatible') ??
          null;

        if (!provider) {
          throw new Error('Expected a release-facing provider for sidebar rail persistence coverage.');
        }

        const project = await window.vicode.projects.create({
          name: 'Sidebar rail persistence',
          folderPath: workspaceDir,
          trusted: true
        });

        const modelId =
          project.defaultModelByProvider[provider.id] ??
          bootstrap.preferences.defaultModelByProvider[provider.id] ??
          provider.models[0]?.id ??
          'qwen2.5-coder:14b-instruct-q6_K';

        const thread = await window.vicode.threads.create({
          projectId: project.id,
          title: 'Sidebar rail persistence thread',
          providerId: provider.id,
          modelId,
          executionPermission: 'default'
        });

        await window.vicode.settings.save({
          selectedProjectId: project.id,
          lastOpenedThreadId: thread.id
        });
      },
      { workspaceDir: workspaceDir.replace(/\\/g, '/') }
    );
    await window.evaluate(
      ({
        sidebarWidthStorageKey,
        sidebarCollapsedStorageKey,
        workLibraryRailWidthStorageKey,
        workLibraryRailCollapsedStorageKey
      }) => {
        window.localStorage.setItem(sidebarWidthStorageKey, '420');
        window.localStorage.setItem(sidebarCollapsedStorageKey, 'false');
        window.localStorage.removeItem(workLibraryRailWidthStorageKey);
        window.localStorage.setItem(workLibraryRailCollapsedStorageKey, 'false');
      },
      {
        sidebarWidthStorageKey,
        sidebarCollapsedStorageKey,
        workLibraryRailWidthStorageKey,
        workLibraryRailCollapsedStorageKey
      }
    );
    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']);
    await window.setViewportSize(tightViewport);

    const resizeTarget = window.locator('.work-library-inner-resize');
    await expect(resizeTarget).toBeVisible();
    const resizeBox = await resizeTarget.boundingBox();
    if (!resizeBox) {
      throw new Error('Expected work library rail resize target to have a bounding box.');
    }

    const dragY = resizeBox.y + resizeBox.height / 2;
    await window.mouse.move(resizeBox.x + resizeBox.width / 2, dragY);
    await window.mouse.down();
    await window.mouse.move(resizeBox.x + resizeBox.width / 2 + 42, dragY, { steps: 8 });
    await window.mouse.up();

    const resized = await window.evaluate(({ workLibraryRailWidthStorageKey }) => {
      const rail = document.querySelector('.work-library-rail');
      const storedWidth = Number.parseInt(window.localStorage.getItem(workLibraryRailWidthStorageKey) ?? '', 10);
      if (!(rail instanceof HTMLElement)) {
        throw new Error('Expected work library rail to be present after resize.');
      }
      return {
        railWidth: rail.getBoundingClientRect().width,
        storedWidth
      };
    }, { workLibraryRailWidthStorageKey });

    expect(resized.storedWidth).toBeGreaterThanOrEqual(186);
    expect(Math.abs(resized.railWidth - resized.storedWidth)).toBeLessThanOrEqual(2);

    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']);
    await window.setViewportSize(tightViewport);
    await expect(window.locator('.work-library-rail')).toBeVisible();

    const restored = await window.evaluate(({ workLibraryRailWidthStorageKey }) => {
      const rail = document.querySelector('.work-library-rail');
      const storedWidth = Number.parseInt(window.localStorage.getItem(workLibraryRailWidthStorageKey) ?? '', 10);
      if (!(rail instanceof HTMLElement)) {
        throw new Error('Expected work library rail to be present after reload.');
      }
      return {
        railWidth: rail.getBoundingClientRect().width,
        storedWidth
      };
    }, { workLibraryRailWidthStorageKey });

    expect(restored.storedWidth).toBe(resized.storedWidth);
    expect(Math.abs(restored.railWidth - restored.storedWidth)).toBeLessThanOrEqual(2);
  } finally {
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
