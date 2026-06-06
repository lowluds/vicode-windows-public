import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { closeApp, launchApp, waitForBridge } from './helpers/electron';

type LayoutIssue = {
  kind: 'horizontal-overflow' | 'out-of-bounds';
  selector: string;
  text: string;
  metrics: Record<string, number>;
};

async function seedAuditFixture(window: Page, workspaceDir: string) {
  return await window.evaluate(async ({ workspaceDir }) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const provider =
      bootstrap.providers.find((entry) => entry.id === 'ollama') ??
      bootstrap.providers.find((entry) => entry.id === 'openai_compatible') ??
      bootstrap.providers[0];
    if (!provider) {
      throw new Error('Expected at least one provider for UI audit.');
    }

    const modelId =
      bootstrap.preferences.defaultModelByProvider[provider.id] ??
      provider.models[0]?.id ??
      'qwen2.5-coder:14b-instruct-q6_K';

    const project = await window.vicode.projects.create({
      name: `UI audit ${suffix}`,
      folderPath: workspaceDir,
      trusted: true
    });

    const thread = await window.vicode.threads.create({
      projectId: project.id,
      providerId: provider.id,
      modelId,
      executionPermission: 'default'
    });

    const skill = await window.vicode.skills.save({
      name: 'qa-layout-audit-skill',
      description: 'Used to verify inline skill mention layout in the composer.',
      instructions: 'Audit the UI layout carefully.',
      scope: 'global',
      providerTargets: bootstrap.providers.map((entry) => entry.id),
      enabled: true,
      projectId: null
    });

    await window.vicode.settings.save({
      selectedProjectId: project.id,
      lastOpenedThreadId: thread.id
    });

    return {
      projectId: project.id,
      threadId: thread.id,
      skillId: skill.id
    };
  }, { workspaceDir });
}

async function cleanupAuditFixture(
  window: Page | null,
  fixture: { projectId: string | null; threadId: string | null; skillId: string | null }
) {
  if (!window) {
    return;
  }

  await window.evaluate(async ({ projectId, threadId, skillId }) => {
    if (threadId) {
      await window.vicode.threads.remove(threadId).catch(() => {});
    }
    if (projectId) {
      await window.vicode.projects.remove(projectId).catch(() => {});
    }
    if (skillId) {
      await window.vicode.skills.remove(skillId).catch(() => {});
    }
  }, fixture).catch(() => {});
}

async function collectLayoutIssues(window: Page, rootSelectors: string[]) {
  return await window.evaluate((selectors) => {
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element as HTMLElement);
      return rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        Number(style.opacity || '1') > 0.01;
    };

    const roots = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const issues: Array<{
      kind: 'horizontal-overflow' | 'out-of-bounds';
      selector: string;
      text: string;
      metrics: Record<string, number>;
    }> = [];
    const seen = new Set<string>();

    const pushIssue = (
      kind: 'horizontal-overflow' | 'out-of-bounds',
      element: Element,
      metrics: Record<string, number>
    ) => {
      const selector = (element as HTMLElement).className || element.tagName.toLowerCase();
      const text = (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const key = `${kind}:${selector}:${text}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      issues.push({
        kind,
        selector,
        text,
        metrics
      });
    };

    for (const root of roots) {
      if (!visible(root)) {
        continue;
      }

      const rootRect = root.getBoundingClientRect();
      if (rootRect.left < -2 || rootRect.right > window.innerWidth + 2) {
        pushIssue('out-of-bounds', root, {
          left: rootRect.left,
          right: rootRect.right,
          width: rootRect.width,
          viewportWidth: window.innerWidth
        });
      }

      const candidates = [root, ...Array.from(root.querySelectorAll('*'))];
      for (const element of candidates) {
        if (!visible(element)) {
          continue;
        }

        if (element.closest('pre, textarea, .run-change-preview-code, .run-activity-terminal-output')) {
          continue;
        }

        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);
        const overflowX = style.overflowX;
        const overflowAllowed = overflowX === 'hidden' || overflowX === 'clip' || overflowX === 'scroll' || overflowX === 'auto';
        const isLeafLike =
          htmlElement.children.length === 0 ||
          htmlElement.matches('button, [role="button"], [role="option"], [role="menuitem"], input, label');

        if (isLeafLike && !overflowAllowed && htmlElement.clientWidth > 0 && htmlElement.scrollWidth > htmlElement.clientWidth + 4) {
          pushIssue('horizontal-overflow', element, {
            clientWidth: htmlElement.clientWidth,
            scrollWidth: htmlElement.scrollWidth
          });
        }

        const rect = htmlElement.getBoundingClientRect();
        if (rect.left < -2 || rect.right > window.innerWidth + 2) {
          pushIssue('out-of-bounds', element, {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            viewportWidth: window.innerWidth
          });
        }
      }
    }

    return issues;
  }, rootSelectors);
}

async function measureShellAlignment(window: Page) {
  return await window.evaluate(() => {
    const measure = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) {
        return null;
      }
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width
      };
    };

    return {
      sidebar: measure('.sidebar-shell'),
      main: measure('.main-surface'),
      titlebarBrand: measure('.windows-titlebar-brand'),
      titlebarContext: measure('.windows-titlebar-context'),
      titlebarActions: measure('.windows-titlebar-actions'),
      sidebarTools: measure('.workspace-sidebar-tools'),
      sidebarToolCount: document.querySelectorAll('.workspace-sidebar-tools .workspace-sidebar-tool').length,
      browserOptionCount: document.querySelectorAll('.work-library-column-menu-button').length
    };
  });
}

async function measureComposerLayout(window: Page) {
  return await window.evaluate(() => {
    const measure = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        return null;
      }
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width
      };
    };

    return {
      main: measure('.main-surface'),
      rail: measure('.thread-composer-rail'),
      stack: measure('.thread-composer-rail > .composer-stack'),
      shell: measure('.thread-composer-rail .composer-shell')
    };
  });
}

function expectTitlebarControlsSeparated(shell: Awaited<ReturnType<typeof measureShellAlignment>>) {
  expect(shell.titlebarContext?.width ?? 0).toBeGreaterThan(40);
  expect(shell.titlebarContext?.left ?? 0).toBeGreaterThan((shell.titlebarBrand?.right ?? 0) + 8);
  expect(shell.titlebarActions?.left ?? 0).toBeGreaterThan((shell.titlebarContext?.right ?? 0) + 8);
}

async function measureSettingsGeneralScrollState(window: Page) {
  return await window.evaluate(() => {
    const shell = document.querySelector('.main-surface-settings-overlay');
    const root = document.querySelector('.settings-root');
    const main = document.querySelector('.settings-shell-main');
    const panels = Array.from(document.querySelectorAll('.settings-general-section > .settings-panel'));
    const lastPanel = panels[panels.length - 1];
    if (!(shell instanceof HTMLElement) || !(root instanceof HTMLElement) || !(main instanceof HTMLElement) || !(lastPanel instanceof HTMLElement)) {
      return null;
    }

    root.scrollTop = root.scrollHeight;
    shell.scrollTop = shell.scrollHeight;
    main.scrollTop = main.scrollHeight;
    const rootRect = root.getBoundingClientRect();
    const lastPanelRect = lastPanel.getBoundingClientRect();
    const shellStyle = window.getComputedStyle(shell);
    const rootStyle = window.getComputedStyle(root);
    const mainStyle = window.getComputedStyle(main);

    return {
      bodyOverflowY: window.getComputedStyle(document.body).overflowY,
      documentOverflowY: window.getComputedStyle(document.documentElement).overflowY,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentClientHeight: document.documentElement.clientHeight,
      gapAfterLastPanel: Math.max(0, rootRect.bottom - lastPanelRect.bottom),
      panelCount: panels.length,
      rootOverflowY: rootStyle.overflowY,
      rootScrollHeight: root.scrollHeight,
      rootClientHeight: root.clientHeight,
      rootScrollTop: root.scrollTop,
      mainOverflowY: mainStyle.overflowY,
      mainScrollHeight: main.scrollHeight,
      mainClientHeight: main.clientHeight,
      mainScrollTop: main.scrollTop,
      shellOverflowY: shellStyle.overflowY,
      shellScrollHeight: shell.scrollHeight,
      shellClientHeight: shell.clientHeight,
      shellScrollTop: shell.scrollTop
    };
  });
}

async function measureSettingsRailEdge(window: Page) {
  return await window.evaluate(() => {
    const workspace = document.querySelector('.app-workspace-shell');
    const rail = document.querySelector('.settings-shell-rail');
    const overlay = document.querySelector('.settings-route-overlay');
    const settingsWindow = document.querySelector('.settings-floating-window');
    const settingsLayout = document.querySelector('.settings-shell-layout');
    const resizeHandle = document.querySelector('.settings-floating-resize-handle');
    const threadSurface = document.querySelector('.thread-view');
    if (
      !(workspace instanceof HTMLElement) ||
      !(rail instanceof HTMLElement) ||
      !(overlay instanceof HTMLElement) ||
      !(settingsWindow instanceof HTMLElement) ||
      !(settingsLayout instanceof HTMLElement) ||
      !(resizeHandle instanceof HTMLElement) ||
      !(threadSurface instanceof HTMLElement)
    ) {
      return null;
    }

    const workspaceRect = workspace.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const windowRect = settingsWindow.getBoundingClientRect();
    const layoutRect = settingsLayout.getBoundingClientRect();
    const resizeHandleRect = resizeHandle.getBoundingClientRect();
    const threadRect = threadSurface.getBoundingClientRect();
    return {
      workspaceLeft: workspaceRect.left,
      workspaceRight: workspaceRect.right,
      workspaceWidth: workspaceRect.width,
      overlayLeft: overlayRect.left,
      overlayWidth: overlayRect.width,
      windowLeft: windowRect.left,
      windowTop: windowRect.top,
      windowRight: windowRect.right,
      windowBottom: windowRect.bottom,
      windowWidth: windowRect.width,
      windowHeight: windowRect.height,
      layoutBottomGap: windowRect.bottom - layoutRect.bottom,
      resizeHandleBottomInset: windowRect.bottom - resizeHandleRect.bottom,
      resizeHandleRightInset: windowRect.right - resizeHandleRect.right,
      threadWidth: threadRect.width,
      workspaceBackground: window.getComputedStyle(workspace).backgroundColor,
      overlayBackground: window.getComputedStyle(overlay).backgroundColor,
      railBackground: window.getComputedStyle(rail).backgroundColor
    };
  });
}

test.describe.serial('ui layout audit', () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-ui-layout-audit-'));
  let app: ElectronApplication | null = null;
  let window: Page | null = null;
  let fixture: { projectId: string | null; threadId: string | null; skillId: string | null } = {
    projectId: null,
    threadId: null,
    skillId: null
  };

  test.beforeAll(async () => {
    ({ app, window } = await launchApp({
      bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.skills', 'vicode.settings', 'vicode.collab', 'vicode.providers']
    }));
    fixture = await seedAuditFixture(window, workspaceDir);
    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.skills', 'vicode.settings', 'vicode.collab', 'vicode.providers']);
  });

  test.afterAll(async () => {
    await window?.evaluate(() => window.vicode.collab.clearConfig()).catch(() => {});
    await cleanupAuditFixture(window, fixture);
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  test('main renderer surfaces do not show obvious overflow or clipping', async () => {
    test.skip(!window);
    const page = window!;

    const composer = page.getByTestId('composer-input');
    await expect(composer).toBeVisible();
    await expect(page.getByTestId('nav-sidebar-toggle')).toBeVisible();

    const expandedShell = await measureShellAlignment(page);
    expect(expandedShell.sidebar?.width ?? 0).toBeGreaterThan(240);
    expect(expandedShell.main?.left ?? 0).toBeGreaterThan(240);
    expectTitlebarControlsSeparated(expandedShell);
    expect(expandedShell.browserOptionCount).toBeGreaterThanOrEqual(2);

    await page.getByTestId('nav-sidebar-toggle').click({ force: true });
    await expect
      .poll(async () => (await measureShellAlignment(page)).sidebar?.width ?? -1)
      .toBeLessThanOrEqual(0);

    const collapsedShell = await measureShellAlignment(page);
    expect(collapsedShell.sidebar).toBeNull();
    expect(collapsedShell.main?.left ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(4);
    expectTitlebarControlsSeparated(collapsedShell);
    expect(collapsedShell.sidebarTools).toBeNull();
    await expect(page.locator('.workspace-sidebar.is-collapsed .work-library-category')).toHaveCount(0);

    await page.getByTestId('nav-sidebar-toggle').click({ force: true });
    await expect
      .poll(async () => (await measureShellAlignment(page)).sidebar?.width ?? 0)
      .toBeGreaterThan(240);

    const restoredShell = await measureShellAlignment(page);
    expect(restoredShell.sidebar?.width ?? 0).toBeGreaterThan(240);
    expect(restoredShell.main?.left ?? 0).toBeGreaterThan(240);
    expectTitlebarControlsSeparated(restoredShell);
    expect(restoredShell.browserOptionCount).toBeGreaterThanOrEqual(2);

    const composerLayout = await measureComposerLayout(page);
    expect(composerLayout.rail?.width ?? 0).toBeGreaterThan(0);
    expect(composerLayout.stack?.width ?? 0).toBeGreaterThanOrEqual((composerLayout.rail?.width ?? 0) - 2);
    expect(composerLayout.shell?.width ?? 0).toBeGreaterThanOrEqual((composerLayout.rail?.width ?? 0) - 2);
    expect(composerLayout.shell?.width ?? 0).toBeGreaterThanOrEqual(
      Math.min(700, Math.max(0, (composerLayout.main?.width ?? 0) - 96))
    );

    await composer.fill('/pla');
    await expect(page.locator('.composer-skill-picker-item').first()).toBeVisible();

    let issues = await collectLayoutIssues(page, ['.thread-composer-stack', '.composer-skill-picker', '.thread-transcript-rail', '.sidebar']);
    expect(issues).toEqual([]);

    await composer.press('Escape');
    await composer.fill('Testing inline skill mention layout with a long prefix so the picker has to align cleanly inside the composer shell. $qa');
    await expect(page.locator('.composer-skill-picker-item').first()).toBeVisible();

    issues = await collectLayoutIssues(page, ['.thread-composer-stack', '.composer-skill-picker', '.thread-transcript-rail', '.sidebar']);
    expect(issues).toEqual([]);

    await page.getByTestId('composer-model-select').click();
    await expect(page.locator('.ui-menu-content').first()).toBeVisible();

    issues = await collectLayoutIssues(page, ['.thread-composer-stack', '.ui-menu-content', '.thread-transcript-rail', '.sidebar']);
    expect(issues).toEqual([]);

    await page.keyboard.press('Escape');
    await page.getByTestId('nav-settings').click();
    await expect(page.getByRole('heading', { name: 'App' })).toBeVisible();
    await expect(page.locator('.sidebar-shell')).toHaveCount(1);
    await expect(page.locator('.thread-composer-stack')).toBeVisible();
    await expect(page.locator('.settings-route-overlay')).toBeVisible();
    await expect(page.locator('.settings-shell-rail')).toBeVisible();
    await expect(page.locator('.settings-shell-rail-eyebrow')).toHaveCount(0);
    await expect(page.locator('.settings-floating-resize-handle')).toBeVisible();
    const settingsRailEdge = await measureSettingsRailEdge(page);
    expect(settingsRailEdge).not.toBeNull();
    expect(settingsRailEdge?.overlayLeft ?? 0).toBeGreaterThanOrEqual(settingsRailEdge?.workspaceLeft ?? 0);
    expect(settingsRailEdge?.overlayWidth ?? 0).toBeLessThanOrEqual(settingsRailEdge?.workspaceWidth ?? 0);
    expect(settingsRailEdge?.windowLeft ?? 0).toBeGreaterThanOrEqual(settingsRailEdge?.workspaceLeft ?? 0);
    expect(settingsRailEdge?.windowRight ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(settingsRailEdge?.workspaceRight ?? 0);
    expect(settingsRailEdge?.layoutBottomGap ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(2);
    expect(settingsRailEdge?.resizeHandleBottomInset ?? Number.POSITIVE_INFINITY).toBeGreaterThanOrEqual(6);
    expect(settingsRailEdge?.resizeHandleBottomInset ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(12);
    expect(settingsRailEdge?.resizeHandleRightInset ?? Number.POSITIVE_INFINITY).toBeGreaterThanOrEqual(6);
    expect(settingsRailEdge?.resizeHandleRightInset ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(12);
    expect(settingsRailEdge?.overlayBackground).toBe('rgba(0, 0, 0, 0)');

    const titlebar = page.locator('.settings-floating-titlebar');
    const titlebarBox = await titlebar.boundingBox();
    expect(titlebarBox).not.toBeNull();
    if (titlebarBox) {
      await page.mouse.move(titlebarBox.x + titlebarBox.width / 2, titlebarBox.y + titlebarBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(0, 0, { steps: 4 });
      await page.mouse.up();
    }
    const draggedSettingsWindow = await measureSettingsRailEdge(page);
    expect(draggedSettingsWindow?.windowLeft ?? -1).toBeGreaterThanOrEqual(draggedSettingsWindow?.workspaceLeft ?? 0);
    expect(draggedSettingsWindow?.windowTop ?? -1).toBeGreaterThanOrEqual(40);

    const resizeHandle = page.locator('.settings-floating-resize-handle');
    const resizeBox = await resizeHandle.boundingBox();
    const beforeResize = await measureSettingsRailEdge(page);
    expect(resizeBox).not.toBeNull();
    if (resizeBox) {
      await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(resizeBox.x + 120, resizeBox.y + 80, { steps: 4 });
      await page.mouse.up();
    }
    const afterResize = await measureSettingsRailEdge(page);
    expect(afterResize?.windowWidth ?? 0).toBeGreaterThanOrEqual(beforeResize?.windowWidth ?? 0);
    expect(afterResize?.windowHeight ?? 0).toBeGreaterThanOrEqual(beforeResize?.windowHeight ?? 0);
    expect(afterResize?.windowRight ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(afterResize?.workspaceRight ?? 0);

    issues = await collectLayoutIssues(page, ['.main-surface-settings-overlay', '.settings-root', '.sidebar']);
    expect(issues).toEqual([]);

    const settingsScroll = await measureSettingsGeneralScrollState(page);
    expect(settingsScroll).not.toBeNull();
    expect(settingsScroll?.panelCount ?? 0).toBeGreaterThan(0);
    expect(settingsScroll?.bodyOverflowY).toBe('hidden');
    expect(settingsScroll?.documentOverflowY).toBe('hidden');
    expect(settingsScroll?.shellOverflowY).toBe('hidden');
    expect(settingsScroll?.shellScrollTop).toBe(0);
    expect(settingsScroll?.rootOverflowY).toBe('hidden');
    expect(settingsScroll?.rootScrollTop).toBe(0);
    expect(settingsScroll?.mainOverflowY).toBe('auto');
    expect(settingsScroll?.mainScrollHeight ?? 0).toBeGreaterThanOrEqual(settingsScroll?.mainClientHeight ?? 0);
    expect(settingsScroll?.mainScrollTop ?? 0).toBeGreaterThanOrEqual(0);

    await page.locator('.settings-nav-item').filter({ hasText: 'Archived threads' }).click();
    await expect(page.getByRole('heading', { name: 'Archived threads', exact: true })).toBeVisible();

    issues = await collectLayoutIssues(page, ['.main-surface-settings-overlay', '.settings-root', '.sidebar']);
    expect(issues).toEqual([]);

    await page.evaluate(() => window.vicode.collab.clearConfig());
    await expect(page.getByLabel('Rooms')).toHaveCount(0);

    issues = await collectLayoutIssues(page, ['.main-surface-settings-overlay', '.settings-root', '.sidebar']);
    expect(issues).toEqual([]);

    await expect(page.getByTestId('nav-plugins')).toHaveCount(0);
    await expect(page.getByTestId('nav-automations')).toHaveCount(0);
  });
});
