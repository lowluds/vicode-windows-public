import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, test, type Page } from '@playwright/test';
import { buildSkillCreatorPrompt } from '../src/shared/creatorImports';
import { closeApp, launchApp, openTitlebarSurface, waitForBridge, waitForThreadSurfaceReady } from './helpers/electron';

async function openCatalogTab(window: Page, tab: 'plugins' | 'skills') {
  const tabButton = window.getByTestId(`skills-tab-${tab}`);
  if (!(await tabButton.isVisible().catch(() => false))) {
    await openTitlebarSurface(window, 'nav-plugins', tabButton);
  }
  await expect(tabButton).toBeVisible();
  if ((await tabButton.getAttribute('aria-selected')) !== 'true') {
    await tabButton.click();
  }
}

async function openPlugins(window: Page) {
  await openCatalogTab(window, 'plugins');
}

async function openSkills(window: Page) {
  await openCatalogTab(window, 'skills');
}

test('plugins support official setup, approval, refresh, disable, removal, and persistence', async () => {
  const { app, window: launchedWindow } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.mcp']
  });

  let window: Page | null = launchedWindow;

  try {
    await window.evaluate(async () => {
        const servers = await window.vicode.mcp.listServers();
        await Promise.all(servers.map((server) => window.vicode.mcp.removeServer(server.id)));
      });

      await openPlugins(window);

      await window.getByTestId('mcp-official-add-shadcn').click();
    const shadcnServerId = await window.evaluate(async () => {
      const servers = await window.vicode.mcp.listServers();
      const shadcn = servers.find(
        (server) => server.command.toLowerCase() === 'npx' && JSON.stringify(server.args) === JSON.stringify(['shadcn@latest', 'mcp'])
      );
      return shadcn?.id ?? null;
    });
    expect(shadcnServerId).toBeTruthy();
    await expect(window.getByTestId(`mcp-configured-card-${shadcnServerId}`)).toBeVisible();
    await expect(window.getByTestId(`mcp-configured-state-${shadcnServerId}`)).toContainText('approval_required');

    await window.getByTestId(`mcp-configured-remove-${shadcnServerId}`).click();
    await expect(window.getByTestId(`mcp-configured-card-${shadcnServerId}`)).toHaveCount(0);
  } finally {
    if (window) {
      try {
        const servers = await window.evaluate(async () => window.vicode.mcp.listServers());
        await Promise.all(
          servers.map((server) => window!.evaluate(async (serverId) => window.vicode.mcp.removeServer(serverId), server.id))
        );
      } catch {
        // Best-effort cleanup only.
      }
    }
    await closeApp(app);
  }
});

test('skills can be created from the plugins surface', async () => {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vicode-skill-create-e2e-'));
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.skills', 'vicode.threads', 'vicode.projects', 'vicode.settings']
  });

  const skillName = 'UI Created Skill E2E';
  let projectId: string | null = null;

  try {
    const seeded = await window.evaluate(async ({ name, workspaceDir }) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const provider =
        bootstrap.providers.find((entry) => entry.id === 'openai') ??
        bootstrap.providers.find((entry) => entry.id === 'gemini') ??
        bootstrap.providers.find((entry) => entry.id === 'ollama') ??
        null;
      if (!provider) {
        throw new Error('Expected a release-facing provider for the skill creation test.');
      }
      const project = await window.vicode.projects.create({
        name: `Skill create ${Date.now()}`,
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
        executionPermission: 'default'
      });
      await window.vicode.settings.save({
        selectedProjectId: project.id,
        lastOpenedThreadId: thread.id
      });
      const skills = await window.vicode.skills.list();
      const existing = skills.find((skill) => skill.name === name);
      if (existing) {
        await window.vicode.skills.remove(existing.id);
      }
      return { projectId: project.id };
    }, { name: skillName, workspaceDir });
    projectId = seeded.projectId;

    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.skills', 'vicode.threads', 'vicode.projects', 'vicode.settings']);
    await waitForThreadSurfaceReady(window);

    await openSkills(window);
    await window.getByRole('button', { name: 'Create', exact: true }).click();
    await window.getByRole('menuitem', { name: 'Create skill' }).click();

    const composer = window.getByTestId('composer-input');
    await expect(composer).toBeVisible();
    await expect(window.locator('.windows-titlebar-context-thread')).toContainText('Create skill');
    await expect(composer).toHaveValue(buildSkillCreatorPrompt());
    await expect(window.getByTestId('composer-attached-skill-skill-creator')).toBeVisible();
  } finally {
    try {
      await window.evaluate(async (name) => {
        const skills = await window.vicode.skills.list();
        const existing = skills.find((skill) => skill.name === name);
        if (existing) {
          await window.vicode.skills.remove(existing.id);
        }
      }, skillName);
      if (projectId) {
        await window.evaluate(async (targetProjectId) => {
          const bootstrap = await window.vicode.app.getBootstrap();
          if (bootstrap.projects.some((project) => project.id === targetProjectId)) {
            await window.vicode.projects.remove(targetProjectId);
          }
        }, projectId);
      }
    } catch {
      // Best-effort cleanup only.
    }
    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
