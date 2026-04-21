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
    const provider = bootstrap.providers.find((entry) => entry.id === 'openai') ?? bootstrap.providers[0];
    if (!provider) {
      throw new Error('Expected at least one provider for UI audit.');
    }

    const modelId =
      bootstrap.preferences.defaultModelByProvider[provider.id] ??
      provider.models[0]?.id ??
      'gpt-5';

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
      titlebarContext: measure('.windows-titlebar-center'),
      sidebarFooter: measure('.workspace-sidebar-footer')
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
    await expect(page.getByTestId('titlebar-toggle-sidebar')).toBeVisible();

    const expandedShell = await measureShellAlignment(page);
    expect(expandedShell.sidebar?.width ?? 0).toBeGreaterThan(240);
    expect(expandedShell.main?.left ?? 0).toBeGreaterThan(240);
    expect(expandedShell.titlebarContext?.left ?? 0).toBeGreaterThan(240);
    expect(expandedShell.sidebarFooter?.width ?? 0).toBeGreaterThan(120);

    await page.getByTestId('titlebar-toggle-sidebar').click();
    await expect
      .poll(async () => (await measureShellAlignment(page)).sidebar?.width ?? -1)
      .toBeLessThanOrEqual(1);

    const collapsedShell = await measureShellAlignment(page);
    expect(collapsedShell.main?.left ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);
    expect(collapsedShell.titlebarContext?.left ?? Number.POSITIVE_INFINITY).toBeLessThan(expandedShell.titlebarContext?.left ?? 0);
    expect(collapsedShell.sidebarFooter?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1);

    await page.getByTestId('titlebar-toggle-sidebar').click();
    await expect
      .poll(async () => (await measureShellAlignment(page)).sidebar?.width ?? 0)
      .toBeGreaterThan(240);

    const restoredShell = await measureShellAlignment(page);
    expect(restoredShell.sidebar?.width ?? 0).toBeGreaterThan(240);
    expect(restoredShell.main?.left ?? 0).toBeGreaterThan(240);
    expect(restoredShell.titlebarContext?.left ?? 0).toBeGreaterThan(240);
    expect(restoredShell.sidebarFooter?.width ?? 0).toBeGreaterThan(120);

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
    await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();

    issues = await collectLayoutIssues(page, ['.main-surface-settings', '.settings-root', '.sidebar']);
    expect(issues).toEqual([]);

    await page.locator('.settings-nav-item').filter({ hasText: 'Archived threads' }).click();
    await expect(page.getByRole('heading', { name: 'Archived threads', exact: true })).toBeVisible();

    issues = await collectLayoutIssues(page, ['.main-surface-settings', '.settings-root', '.sidebar']);
    expect(issues).toEqual([]);

    await page.evaluate(() => window.vicode.collab.clearConfig());
    await expect(page.getByLabel('Rooms')).toHaveCount(0);

    issues = await collectLayoutIssues(page, ['.main-surface-settings', '.settings-root', '.sidebar']);
    expect(issues).toEqual([]);

  await page.getByTestId('nav-plugins').click();
  await expect(page.getByTestId('skills-tab-plugins')).toBeVisible();
  await page.getByTestId('skills-tab-plugins').click();
  await expect(page.getByText('Recommended plugins')).toBeVisible();

    issues = await collectLayoutIssues(page, ['.skills-page-shell', '.sidebar']);
    expect(issues).toEqual([]);
  });
});
