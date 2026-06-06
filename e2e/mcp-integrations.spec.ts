import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, test, type Page } from '@playwright/test';
import { closeApp, launchApp, waitForBridge, waitForThreadSurfaceReady } from './helpers/electron';

async function appendSkillMention(window: Page, partialToken: string, expectedSkillName: string) {
  const composer = window.getByTestId('composer-input');
  await composer.click();
  await composer.pressSequentially(partialToken);
  const skillPickerItem = window.locator('.composer-skill-picker-item').filter({ hasText: expectedSkillName }).first();
  await expect(skillPickerItem).toBeVisible();
  await skillPickerItem.click();
  const value = await composer.inputValue();
  expect(value).toMatch(/\$[a-z0-9-]+/i);
  return value.match(/\$[a-z0-9-]+/i)?.[0] ?? '';
}

test('parked MCP tooling supports official setup, approval gating, removal, and persistence', async () => {
  const { app, window: launchedWindow } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.mcp']
  });

  let window: Page | null = launchedWindow;

  try {
    await window.evaluate(async () => {
      const servers = await window.vicode.mcp.listServers();
      await Promise.all(servers.map((server) => window.vicode.mcp.removeServer(server.id)));
    });

    await expect(window.getByTestId('nav-plugins')).toHaveCount(0);

    const shadcn = await window.evaluate(async () => {
      const server = await window.vicode.mcp.setupRecommended({ entryId: 'shadcn', projectId: null });
      const servers = await window.vicode.mcp.listServers();
      const persisted = servers.find((entry) => entry.id === server.id) ?? null;
      return {
        server,
        persisted
      };
    });
    expect(shadcn.server.command.toLowerCase()).toBe('npx');
    expect(shadcn.server.args).toEqual(['shadcn@latest', 'mcp']);
    expect(shadcn.server.state?.status).toBe('approval_required');
    expect(shadcn.persisted?.id).toBe(shadcn.server.id);

    await window.evaluate(async (serverId) => {
      await window.vicode.mcp.removeServer(serverId);
    }, shadcn.server.id);
    await expect
      .poll(async () => {
        return await window!.evaluate(async (serverId) => {
          const servers = await window.vicode.mcp.listServers();
          return servers.some((server) => server.id === serverId);
        }, shadcn.server.id);
      })
      .toBe(false);
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

test('skills stay backend-owned while composer mentions expose the minimal user flow', async () => {
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
        'qwen2.5-coder:14b-instruct-q6_K';
      const thread = await window.vicode.threads.create({
        projectId: project.id,
        providerId: provider.id,
        modelId,
        executionPermission: 'default'
      });
      const existingSkills = await window.vicode.skills.list();
      await Promise.all(existingSkills.filter((skill) => skill.name === name).map((skill) => window.vicode.skills.remove(skill.id)));
      await window.vicode.skills.save({
        name,
        description: 'Used to verify the minimal composer skill mention flow.',
        instructions: 'Use this skill when the e2e suite needs a deterministic custom skill.',
        scope: 'global',
        providerTargets: bootstrap.providers.map((entry) => entry.id),
        enabled: true,
        projectId: null
      });
      await window.vicode.settings.save({
        selectedProjectId: project.id,
        lastOpenedThreadId: thread.id
      });
      return { projectId: project.id };
    }, { name: skillName, workspaceDir });
    projectId = seeded.projectId;

    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.skills', 'vicode.threads', 'vicode.projects', 'vicode.settings']);
    await waitForThreadSurfaceReady(window);

    await expect(window.getByTestId('nav-plugins')).toHaveCount(0);
    const composer = window.getByTestId('composer-input');
    await expect(composer).toBeVisible();
    const insertedToken = await appendSkillMention(window, '$ui', skillName);
    await expect(composer).toHaveValue(new RegExp(`^\\${insertedToken}\\s*$`, 'u'));
  } finally {
    try {
      await window.evaluate(async (name) => {
        const skills = await window.vicode.skills.list();
        await Promise.all(skills.filter((skill) => skill.name === name).map((skill) => window.vicode.skills.remove(skill.id)));
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
