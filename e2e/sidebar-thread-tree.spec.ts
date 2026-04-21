import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './helpers/electron';

async function seedSidebarFixture(page: Page, workspaceRoot: string) {
  return await page.evaluate(async ({ workspaceRoot }) => {
    const bootstrap = await window.vicode.app.getBootstrap();
    const provider = bootstrap.providers.find((entry) => entry.id === 'openai') ?? bootstrap.providers[0];
    if (!provider) {
      throw new Error('Expected at least one provider for sidebar coverage.');
    }

    const modelId =
      bootstrap.preferences.defaultModelByProvider[provider.id] ??
      provider.models[0]?.id ??
      'gpt-5';

    const projectIds: string[] = [];

    for (let projectIndex = 0; projectIndex < 18; projectIndex += 1) {
      const project = await window.vicode.projects.create({
        name: `Sidebar stress ${projectIndex + 1}`,
        folderPath: `${workspaceRoot.replace(/\\/g, '/')}/project-${projectIndex + 1}`,
        trusted: true
      });
      projectIds.push(project.id);

      for (let threadIndex = 0; threadIndex < 4; threadIndex += 1) {
        await window.vicode.threads.create({
          projectId: project.id,
          providerId: provider.id,
          modelId,
          executionPermission: 'default'
        });
      }
    }

    await window.vicode.settings.save({
      selectedProjectId: projectIds[0] ?? null
    });

    return { projectIds };
  }, { workspaceRoot });
}

async function collectVisibleRowOverlaps(page: Page) {
  return await page.evaluate(() => {
    const scroll = document.querySelector('.workspace-sidebar-scroll.thread-tree');
    if (!(scroll instanceof HTMLElement)) {
      throw new Error('Sidebar thread tree scroll container is missing.');
    }

    const scrollRect = scroll.getBoundingClientRect();
    const rows = Array.from(
      scroll.querySelectorAll('.project-row-shell, .sidebar-thread-shell, .sidebar-thread-show-more')
    )
      .map((element) => {
        const rect = (element as HTMLElement).getBoundingClientRect();
        const visibleTop = Math.max(rect.top, scrollRect.top);
        const visibleBottom = Math.min(rect.bottom, scrollRect.bottom);
        return {
          className: (element as HTMLElement).className,
          top: rect.top,
          bottom: rect.bottom,
          visibleTop,
          visibleBottom,
          visibleHeight: visibleBottom - visibleTop
        };
      })
      .filter((row) => row.visibleHeight > 4)
      .sort((left, right) => left.visibleTop - right.visibleTop);

    const overlaps: Array<{ previousBottom: number; currentTop: number; previous: string; current: string }> = [];
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      const current = rows[index];
      if (current.visibleTop < previous.visibleBottom - 1) {
        overlaps.push({
          previousBottom: previous.visibleBottom,
          currentTop: current.visibleTop,
          previous: previous.className,
          current: current.className
        });
      }
    }

    const firstLabel = scroll.querySelector('.project-row .project-name, .sidebar-thread-title span:last-child');
    const firstLabelRect = firstLabel instanceof HTMLElement ? firstLabel.getBoundingClientRect() : null;

    return {
      metrics: {
        clientHeight: scroll.clientHeight,
        scrollHeight: scroll.scrollHeight,
        scrollTop: scroll.scrollTop,
        overflowY: getComputedStyle(scroll).overflowY
      },
      overlaps,
      firstLabelX: firstLabelRect?.x ?? null
    };
  });
}

test('thread tree stays scrollable and non-overlapping with many expanded projects', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'vicode-sidebar-tree-'));
  for (let index = 0; index < 18; index += 1) {
    mkdirSync(join(workspaceRoot, `project-${index + 1}`), { recursive: true });
  }

  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings']
  });

  try {
    await seedSidebarFixture(window, workspaceRoot);
    await window.reload({ waitUntil: 'domcontentloaded' });

    const projectRows = window.locator('[data-testid^="project-row-"]');
    await expect(projectRows.first()).toBeVisible();
    const count = await projectRows.count();
    for (let index = 0; index < count; index += 1) {
      await projectRows.nth(index).click();
    }

    const sidebarScroll = window.locator('.workspace-sidebar-scroll.thread-tree');
    await expect(sidebarScroll).toBeVisible();

    const topState = await collectVisibleRowOverlaps(window);
    expect(topState.metrics.overflowY).toBe('scroll');
    expect(topState.metrics.scrollHeight).toBeGreaterThan(topState.metrics.clientHeight + 120);
    expect(topState.overlaps).toEqual([]);

    const xBeforeHover = topState.firstLabelX;
    await sidebarScroll.hover();
    await window.waitForTimeout(150);
    const hoveredState = await collectVisibleRowOverlaps(window);
    expect(hoveredState.overlaps).toEqual([]);
    expect(Math.abs((hoveredState.firstLabelX ?? 0) - (xBeforeHover ?? 0))).toBeLessThan(0.5);

    await sidebarScroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await window.waitForTimeout(150);

    const bottomState = await collectVisibleRowOverlaps(window);
    expect(bottomState.overlaps).toEqual([]);
  } finally {
    await app.close().catch(() => {});
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
