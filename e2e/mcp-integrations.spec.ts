import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { closeApp, launchApp, waitForBridge } from './helpers/electron';

async function openPlugins(window: Page) {
  await window.getByTestId('nav-plugins').click();
  await window.getByTestId('skills-tab-plugins').click();
}

async function openSkills(window: Page) {
  await window.getByTestId('nav-plugins').click();
  await window.getByTestId('skills-tab-skills').click();
}

test('plugins support setup, approval, refresh, disable, removal, and persistence', async () => {
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

      await window.getByRole('button', { name: 'New plugin' }).click();
      await window.getByTestId('plugin-dialog-name').fill('Fixture MCP E2E');
      await window.getByTestId('plugin-dialog-command').fill(process.execPath);
      await window
        .getByTestId('plugin-dialog-args')
        .fill(path.join(process.cwd(), 'test', 'fixtures', 'mcp', 'stdio-server.mjs'));
      await window.getByRole('button', { name: 'Save plugin' }).click();

      const fixtureServerId = await window.evaluate(async () => {
        const servers = await window.vicode.mcp.listServers();
        return servers.find((server) => server.name === 'Fixture MCP E2E')?.id ?? null;
      });
      expect(fixtureServerId).toBeTruthy();
      await expect(window.getByTestId(`mcp-configured-card-${fixtureServerId}`)).toBeVisible();

      await window.reload({ waitUntil: 'domcontentloaded' });
      await waitForBridge(window, ['vicode.app', 'vicode.mcp']);
      await openPlugins(window);

    await expect(window.getByTestId(`mcp-configured-card-${fixtureServerId}`)).toBeVisible();
    await expect(window.getByTestId(`mcp-configured-state-${fixtureServerId}`)).toContainText('approval_required');

    await window.getByTestId(`mcp-configured-approve-${fixtureServerId}`).click();
    await expect(window.getByTestId(`mcp-configured-state-${fixtureServerId}`)).toContainText('connected', { timeout: 30_000 });
    await expect(window.getByTestId(`mcp-configured-tool-${fixtureServerId}-echo`)).toBeVisible();
    await expect(window.getByTestId(`mcp-configured-prompt-${fixtureServerId}-review`)).toBeVisible();

      await window.getByTestId(`mcp-configured-refresh-${fixtureServerId}`).click();
      await expect(window.getByTestId(`mcp-configured-state-${fixtureServerId}`)).toContainText('connected', { timeout: 30_000 });

      await window.reload({ waitUntil: 'domcontentloaded' });
      await waitForBridge(window, ['vicode.app', 'vicode.mcp']);
      await openPlugins(window);

    await expect(window.getByTestId(`mcp-configured-card-${fixtureServerId}`)).toBeVisible();
    await expect(window.getByTestId(`mcp-configured-state-${fixtureServerId}`)).toContainText('connected', { timeout: 30_000 });
    await expect(window.getByTestId(`mcp-configured-tool-${fixtureServerId}-echo`)).toBeVisible();

    await window.getByTestId(`mcp-configured-disable-${fixtureServerId}`).click();
    await expect(window.getByTestId(`mcp-configured-state-${fixtureServerId}`)).toContainText('disabled', { timeout: 30_000 });
    await expect(window.getByTestId(`mcp-configured-tool-${fixtureServerId}-echo`)).toHaveCount(0);

    await window.getByTestId(`mcp-configured-remove-${fixtureServerId}`).click();
    await expect(window.getByTestId(`mcp-configured-card-${fixtureServerId}`)).toHaveCount(0);

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
  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.skills']
  });

  const skillName = 'UI Created Skill E2E';

  try {
    await window.evaluate(async (name) => {
      const skills = await window.vicode.skills.list();
      const existing = skills.find((skill) => skill.name === name);
      if (existing) {
        await window.vicode.skills.remove(existing.id);
      }
    }, skillName);

    await openSkills(window);
    await window.getByRole('button', { name: 'New skill' }).click();
    await window.getByTestId('skill-dialog-name').fill(skillName);
    await window.getByTestId('skill-dialog-description').fill('Created through the Plugins page UI.');
    await window.getByTestId('skill-dialog-scope').click();
    await window.getByRole('menuitem', { name: 'Personal across all projects' }).click();
    await window
      .getByTestId('skill-dialog-instructions')
      .fill('Use this skill to confirm that the Plugins page can create a reusable Vicode skill.');
    await window.getByRole('button', { name: 'Save skill' }).click();

    await expect(window.getByRole('heading', { name: skillName })).toBeVisible();
    await window.getByRole('button', { name: 'Close' }).click();
    await expect(window.getByText(skillName)).toBeVisible();
  } finally {
    try {
      await window.evaluate(async (name) => {
        const skills = await window.vicode.skills.list();
        const existing = skills.find((skill) => skill.name === name);
        if (existing) {
          await window.vicode.skills.remove(existing.id);
        }
      }, skillName);
    } catch {
      // Best-effort cleanup only.
    }
    await closeApp(app);
  }
});
