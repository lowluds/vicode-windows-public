import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { closeApp, launchApp, waitForBridge } from './helpers/electron';

const bridgePaths = ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings'];
const viewport = { width: 1120, height: 780 };
const sidebarWidthStorageKey = 'vicode.sidebar.width';
const sidebarCollapsedStorageKey = 'vicode.sidebar.collapsed';
const browserCollectionsStorageKey = 'vicode.work-library.collections.v1';

function expectNoVisibleShadow(value: string | null | undefined) {
  if (!value || value === 'none') {
    return;
  }
  expect(value).toMatch(/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/u);
  expect(value.replace(/rgba\([^)]+\)/gu, '').replace(/,/gu, '').trim()).toMatch(/^(0px\s*)+$/u);
}

async function seedThreadWorkspace(page: Page, workspaceRoot: string) {
  return await page.evaluate(async ({ workspaceRoot }) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    const provider =
      bootstrap.providers.find((entry) => entry.id === 'ollama') ??
      bootstrap.providers.find((entry) => entry.id === 'openai_compatible') ??
      bootstrap.providers[0];

    if (!provider) {
      throw new Error('Expected at least one provider for thread toolbar/sidebar visual coverage.');
    }

    const projectPath = `${workspaceRoot.replace(/\\/g, '/')}/thread-toolbar-sidebar-project`;
    const project = await window.vicode.projects.create({
      name: 'Thread Toolbar Sidebar Audit',
      folderPath: projectPath,
      trusted: true
    });

    const modelId =
      project.defaultModelByProvider[provider.id] ??
      bootstrap.preferences.defaultModelByProvider[provider.id] ??
      provider.models[0]?.id ??
      'qwen2.5-coder:14b-instruct-q6_K';

    const thread = await window.vicode.threads.create({
      projectId: project.id,
      title: 'Audit toolbar, sidebar, thread row menus, and tool chrome',
      providerId: provider.id,
      modelId,
      executionPermission: 'default'
    });

    await window.vicode.threads.create({
      projectId: project.id,
      title: 'Secondary thread for hover actions',
      providerId: provider.id,
      modelId,
      executionPermission: 'default'
    });

    await window.vicode.settings.save({
      onboardingComplete: true,
      selectedProjectId: project.id,
      lastOpenedThreadId: thread.id
    });

    return {
      projectId: project.id,
      threadId: thread.id
    };
  }, { workspaceRoot });
}

async function expectPopupInsideViewport(page: Page, selector: string) {
  const popup = await page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return {
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      borderRadius: Number.parseFloat(style.borderTopLeftRadius || '0'),
      boxShadow: style.boxShadow,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  }, selector);

  expect(popup).not.toBeNull();
  expect(popup?.width).toBeGreaterThan(0);
  expect(popup?.height).toBeGreaterThan(0);
  expect(popup?.left).toBeGreaterThanOrEqual(0);
  expect(popup?.top).toBeGreaterThanOrEqual(0);
  expect(popup?.right ?? 9999).toBeLessThanOrEqual(popup?.viewportWidth ?? 0);
  expect(popup?.bottom ?? 9999).toBeLessThanOrEqual(popup?.viewportHeight ?? 0);
  expect(popup?.borderRadius ?? 99).toBeLessThanOrEqual(8);
  expectNoVisibleShadow(popup?.boxShadow);
}

test('thread titlebar and sidebar controls stay compact, readable, and non-overlapping', async ({}, testInfo) => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'vicode-thread-toolbar-sidebar-'));
  mkdirSync(join(workspaceRoot, 'thread-toolbar-sidebar-project'), { recursive: true });
  let app: ElectronApplication | null = null;

  try {
    const launched = await launchApp({ bridgePaths });
    app = launched.app;
    const { window } = launched;

    await window.setViewportSize(viewport);
    const fixture = await seedThreadWorkspace(window, workspaceRoot);
    await window.evaluate(
      ({ sidebarWidthStorageKey, sidebarCollapsedStorageKey, browserCollectionsStorageKey }) => {
        window.localStorage.setItem(sidebarWidthStorageKey, '356');
        window.localStorage.setItem(sidebarCollapsedStorageKey, 'false');
        window.localStorage.removeItem(browserCollectionsStorageKey);
      },
      { sidebarWidthStorageKey, sidebarCollapsedStorageKey, browserCollectionsStorageKey }
    );

    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, bridgePaths);
    await window.setViewportSize(viewport);
    await expect(window.getByTestId('composer-input')).toBeVisible();

    const projectRow = window.getByTestId(`project-row-${fixture.projectId}`);
    await expect(projectRow).toBeVisible();
    if ((await projectRow.getAttribute('aria-expanded')) !== 'true') {
      await projectRow.click();
    }

    const threadRow = window.getByTestId(`thread-row-${fixture.threadId}`);
    await expect(threadRow).toBeVisible();

    await expect(window.getByTestId('nav-sidebar-toggle')).toBeVisible();
    await expect(window.getByTestId('nav-skills')).toBeVisible();
    await expect(window.getByTestId('nav-settings')).toBeVisible();
    await expect(window.getByRole('button', { name: 'Account' })).toBeVisible();
    await expect(window.locator('.work-library-category[data-collection-id]')).toHaveCount(0);

    const toolbarMetrics = await window.evaluate(() => {
      const controls = [
        { name: 'sidebar', selector: '[data-testid="nav-sidebar-toggle"]', type: 'icon' },
        { name: 'catalog', selector: '[data-testid="nav-skills"]', type: 'icon' },
        { name: 'settings', selector: '[data-testid="nav-settings"]', type: 'icon' },
        { name: 'account', selector: 'button[aria-label="Account"]', type: 'icon' },
        { name: 'workspace', selector: '.windows-titlebar-workspace-action', type: 'text' }
      ].map((control) => {
        const element = document.querySelector(control.selector);
        if (!(element instanceof HTMLElement)) {
          return null;
        }
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          ...control,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
          borderRadius: Number.parseFloat(style.borderTopLeftRadius || '0'),
          boxShadow: style.boxShadow
        };
      }).filter(Boolean);

      const overlaps: Array<{ left: string; right: string }> = [];
      for (let index = 1; index < controls.length; index += 1) {
        const previous = controls[index - 1]!;
        const current = controls[index]!;
        const verticallyAligned = current.y < previous.bottom && current.bottom > previous.y;
        if (verticallyAligned && current.x < previous.right - 1) {
          overlaps.push({ left: previous.name, right: current.name });
        }
      }

      return {
        controls,
        overlaps,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      };
    });

    expect(toolbarMetrics.controls.length).toBeGreaterThanOrEqual(4);
    expect(toolbarMetrics.overlaps).toEqual([]);
    for (const control of toolbarMetrics.controls) {
      expect(control.width).toBeGreaterThan(0);
      expect(control.height).toBeGreaterThanOrEqual(24);
      expect(control.right).toBeLessThanOrEqual(toolbarMetrics.viewportWidth);
      expect(control.bottom).toBeLessThanOrEqual(toolbarMetrics.viewportHeight);
      expect(control.borderRadius).toBeLessThanOrEqual(8);
      expectNoVisibleShadow(control.boxShadow);
      if (control.type === 'icon') {
        expect(control.width).toBeLessThanOrEqual(34);
        expect(Math.abs(control.width - control.height)).toBeLessThanOrEqual(4);
      }
    }

    await testInfo.attach('thread-toolbar-sidebar', {
      body: await window.screenshot(),
      contentType: 'image/png'
    });

    await window.getByRole('button', { name: 'Account' }).click();
    await expect(window.locator('.windows-profile-menu')).toBeVisible();
    await expectPopupInsideViewport(window, '.windows-profile-menu');
    await window.keyboard.press('Escape');

    await window.getByRole('button', { name: 'Library filters' }).click();
    await expect(window.locator('.work-library-filter-menu')).toBeVisible();
    await expectPopupInsideViewport(window, '.work-library-filter-menu');
    await window.keyboard.press('Escape');

    await window.getByRole('button', { name: 'Project browser options' }).click();
    await expect(window.locator('.work-library-column-menu')).toBeVisible();
    await expectPopupInsideViewport(window, '.work-library-column-menu');
    await window.keyboard.press('Escape');

    const threadShell = threadRow.locator('xpath=..');
    await threadShell.hover();
    await expect.poll(async () => {
      return await window.evaluate((threadId) => {
        const row = document.querySelector(`[data-testid="thread-row-${threadId}"]`);
        const actionButton = row?.parentElement?.querySelector('.sidebar-thread-action-button');
        return actionButton instanceof HTMLElement ? window.getComputedStyle(actionButton).opacity : null;
      }, fixture.threadId);
    }, { timeout: 3_000 }).toBe('1');
    await expect(window.locator('.sidebar-thread-action-button').first()).toBeVisible();

    const sidebarMetrics = await window.evaluate((threadId) => {
      const row = document.querySelector(`[data-testid="thread-row-${threadId}"]`);
      const shell = row?.parentElement;
      const actionButton = shell?.querySelector('.sidebar-thread-action-button');
      const search = document.querySelector('.work-library-search-input');
      const contextStatus = document.querySelector('.work-library-context-status-toggle');
      const categoryButtons = Array.from(document.querySelectorAll('.work-library-category'));

      if (!(row instanceof HTMLElement) || !(shell instanceof HTMLElement) || !(actionButton instanceof HTMLElement)) {
        throw new Error('Expected sidebar thread row and action control to be present.');
      }
      if (!(search instanceof HTMLElement) || !(contextStatus instanceof HTMLElement)) {
        throw new Error('Expected sidebar search and context controls to be present.');
      }

      function read(element: Element) {
        const target = element as HTMLElement;
        const rect = target.getBoundingClientRect();
        const style = window.getComputedStyle(target);
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          borderRadius: Number.parseFloat(style.borderTopLeftRadius || '0'),
          boxShadow: style.boxShadow,
          backgroundColor: style.backgroundColor,
          textDecorationLine: style.textDecorationLine
        };
      }

      return {
        row: read(row),
        actionButton: read(actionButton),
        search: read(search),
        contextStatus: read(contextStatus),
        categoryButtons: categoryButtons.map(read),
        actionOpacity: window.getComputedStyle(actionButton).opacity,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      };
    }, fixture.threadId);

    expect(sidebarMetrics.actionOpacity).toBe('1');
    expect(sidebarMetrics.actionButton.width).toBeLessThanOrEqual(24);
    expect(sidebarMetrics.actionButton.height).toBeLessThanOrEqual(24);
    expect(sidebarMetrics.actionButton.borderRadius).toBeLessThanOrEqual(6);
    expect(sidebarMetrics.actionButton.right).toBeLessThanOrEqual(sidebarMetrics.row.right);
    expectNoVisibleShadow(sidebarMetrics.actionButton.boxShadow);
    expect(sidebarMetrics.search.borderRadius).toBeLessThanOrEqual(6);
    expect(sidebarMetrics.contextStatus.borderRadius).toBeLessThanOrEqual(8);
    for (const category of sidebarMetrics.categoryButtons) {
      expect(category.borderRadius).toBeLessThanOrEqual(8);
      expect(category.right).toBeLessThanOrEqual(sidebarMetrics.viewportWidth);
      expect(category.textDecorationLine).toBe('none');
      expectNoVisibleShadow(category.boxShadow);
    }

    await threadRow.click({ button: 'right' });
    await expect(window.locator('.work-library-context-menu')).toBeVisible();
    await expect(window.getByRole('menuitem', { name: /Rename thread/i })).toBeVisible();
    await expect(window.getByRole('menuitem', { name: /Archive thread/i })).toBeVisible();
    await expect(window.getByRole('menuitem', { name: /Delete permanently/i })).toBeVisible();
    await expect(window.getByRole('menuitem', { name: /favorite/i })).toBeVisible();
    await expect(window.getByRole('menuitem', { name: /^Blue\b/i })).toBeVisible();
    await expectPopupInsideViewport(window, '.work-library-context-menu');
    await testInfo.attach('thread-sidebar-context-menu', {
      body: await window.screenshot(),
      contentType: 'image/png'
    });
    await window.getByRole('menuitem', { name: /^Blue\b/i }).click();
    await expect(window.locator('.work-library-context-menu')).toHaveCount(0);

    const collectionMarkerMetrics = await window.evaluate((threadId) => {
      const row = document.querySelector(`[data-testid="thread-row-${threadId}"]`);
      const shell = row?.parentElement;
      const marker = shell?.querySelector('[data-collection-color="blue"]');
      const title = row?.querySelector('.sidebar-thread-title span:last-child');
      if (!(row instanceof HTMLElement) || !(shell instanceof HTMLElement) || !(marker instanceof HTMLElement) || !(title instanceof HTMLElement)) {
        return null;
      }
      const markerRect = marker.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return {
        markerLeft: markerRect.left,
        markerRight: markerRect.right,
        titleRight: titleRect.right,
        rowRight: rowRect.right
      };
    }, fixture.threadId);
    expect(collectionMarkerMetrics).not.toBeNull();
    expect(collectionMarkerMetrics?.markerLeft ?? 0).toBeGreaterThanOrEqual((collectionMarkerMetrics?.titleRight ?? 0) - 1);
    expect((collectionMarkerMetrics?.rowRight ?? 0) - (collectionMarkerMetrics?.markerRight ?? 0)).toBeGreaterThanOrEqual(20);
    expect((collectionMarkerMetrics?.rowRight ?? 0) - (collectionMarkerMetrics?.markerRight ?? 0)).toBeLessThanOrEqual(50);

    await expect(window.locator('.work-library-category[data-collection-id]')).toHaveCount(1);
    await expect(window.locator('.work-library-category[data-collection-id="blue"]')).toBeVisible();
    await window.locator('.work-library-category[data-collection-id="blue"]').click();
    await expect(window.getByTestId(`thread-row-${fixture.threadId}`)).toBeVisible();
    await window.locator('.work-library-category[data-collection-id="blue"]').click({ button: 'right' });
    await expect(window.getByRole('menuitem', { name: /Rename Collection/i })).toBeVisible();
    await window.getByRole('menuitem', { name: /Rename Collection/i }).click();
    await expect(window.getByRole('dialog', { name: /Rename collection/i })).toBeVisible();
    await window.getByLabel('Collection name').fill('Reference Threads');
    await window.keyboard.press('Enter');
    await expect(window.getByRole('button', { name: /^Reference Threads$/i })).toBeVisible();

    const sidebarShell = window.locator('.sidebar-shell');
    await expect(sidebarShell).toBeVisible();
    await window.getByTestId('nav-sidebar-toggle').click();
    await expect(sidebarShell).toHaveCount(0);
    await expect(window.getByTestId('nav-sidebar-toggle')).toHaveAttribute('aria-label', 'Show sidebar');
    await window.getByTestId('nav-sidebar-toggle').click();
    await expect(window.locator('.sidebar-shell')).toBeVisible();
    await expect(window.getByTestId('nav-sidebar-toggle')).toHaveAttribute('aria-label', 'Hide sidebar');
  } finally {
    await closeApp(app);
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
