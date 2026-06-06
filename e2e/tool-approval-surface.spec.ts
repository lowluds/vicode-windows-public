import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { AppEvent } from '../src/shared/events';
import type { RunToolApprovalRequest } from '../src/shared/domain';
import { closeApp, launchApp, waitForBridge, waitForThreadSurfaceReady } from './helpers/electron';

async function emitVicodeEvent(app: Awaited<ReturnType<typeof launchApp>>['app'], event: AppEvent) {
  await app.evaluate(
    ({ BrowserWindow }, payload: AppEvent) => {
      const targetWindow = BrowserWindow.getAllWindows()[0];
      if (!targetWindow) {
        throw new Error('Expected a Vicode Electron window.');
      }
      targetWindow.webContents.send('vicode:event', payload);
    },
    event
  );
}

test('pending command approvals render with minimal thread chrome and icon-only secondary action', async ({}, testInfo) => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-tool-approval-surface-'));
  writeFileSync(
    join(workspaceDir, 'package.json'),
    JSON.stringify(
      {
        name: 'tool-approval-surface-project',
        private: true,
        scripts: {
          build: 'vite build'
        }
      },
      null,
      2
    ),
    'utf8'
  );

  const { app, window } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.projects', 'vicode.threads', 'vicode.settings', 'vicode.events', 'vicode.runs']
  });

  let projectId: string | null = null;
  let threadId: string | null = null;

  try {
    const seeded = await window.evaluate(async (targetWorkspaceDir) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const provider = bootstrap.providers.find((entry) => entry.id === 'ollama');
      if (!provider) {
        throw new Error('Expected local Ollama provider for approval surface coverage.');
      }

      const project = await window.vicode.projects.create({
        name: `Approval surface ${Date.now()}`,
        folderPath: targetWorkspaceDir,
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
        executionPermission: 'full_access'
      });
      await window.vicode.settings.save({
        selectedProjectId: project.id,
        lastOpenedThreadId: thread.id
      });

      return {
        projectId: project.id,
        threadId: thread.id,
        providerId: provider.id
      };
    }, workspaceDir);

    projectId = seeded.projectId;
    threadId = seeded.threadId;

    await window.reload({ waitUntil: 'domcontentloaded' });
    await waitForBridge(window, ['vicode.app', 'vicode.threads', 'vicode.events', 'vicode.runs']);
    await waitForThreadSurfaceReady(window);

    const approval: RunToolApprovalRequest = {
      id: 'approval-e2e-command',
      threadId,
      runId: 'run-e2e-command-approval',
      providerId: seeded.providerId,
      toolName: 'run_command',
      command: 'npm run build',
      cwd: '.',
      workspaceRoot: workspaceDir,
      requestedAt: '2026-05-24T12:00:00.000Z'
    };

    await emitVicodeEvent(app, {
      type: 'run.approvalRequested',
      approval
    });

    const panel = window.getByTestId('tool-approval-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Command approval')).toBeVisible();
    await expect(panel.getByText('Pending approval')).toBeVisible();
    await expect(panel.getByText('Vicode paused a command')).toBeVisible();
    await expect(panel.getByRole('button', { name: /Shell command/i })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Deny' })).toBeVisible();
    const approveButton = panel.getByRole('button', { name: 'Approve command' });
    await expect(approveButton).toBeVisible();

    const moreButton = panel.getByRole('button', { name: 'More approval actions' });
    await expect(moreButton).toBeVisible();
    const moreButtonBox = await moreButton.boundingBox();
    expect(moreButtonBox?.width ?? 0).toBeLessThanOrEqual(34);

    await expect(panel.getByText('npm run build')).toBeVisible();
    await expect(panel.getByText('Workspace root')).toBeVisible();
    await expect(panel.getByText('run_command')).toHaveCount(0);
    await expect(window.getByText('run_command')).toHaveCount(0);
    await expect(panel.getByText(workspaceDir)).toBeVisible();
    await expect(panel.locator('.tool-header-state')).toHaveText('Awaiting approval');
    await expect(panel.locator('.ui-status-pill')).toHaveCount(0);
    await expect(panel.locator('.tool-header-trigger .size-6')).toHaveCount(0);

    const panelChrome = await panel.evaluate((element) => {
      const panelStyle = window.getComputedStyle(element);
      const detail = element.querySelector('.tool-approval-detail');
      const detailStyle = detail instanceof HTMLElement ? window.getComputedStyle(detail) : null;
      return {
        boxShadow: panelStyle.boxShadow,
        borderRadius: Number.parseFloat(panelStyle.borderTopLeftRadius || '0'),
        detailBoxShadow: detailStyle?.boxShadow ?? null,
        detailBackground: detailStyle?.backgroundColor ?? null
      };
    });
    expect(panelChrome.boxShadow).toBe('none');
    expect(panelChrome.detailBoxShadow).toBe('none');
    expect(panelChrome.borderRadius).toBeLessThanOrEqual(12);
    const approveBox = await approveButton.boundingBox();
    const composerBox = await window.getByTestId('composer-input').boundingBox();
    expect(approveBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect((approveBox?.y ?? 0) + (approveBox?.height ?? 0)).toBeLessThanOrEqual((composerBox?.y ?? 0) - 4);

    await panel.screenshot({ path: testInfo.outputPath('tool-approval-panel.png') });

    await moreButton.click();
    await expect(window.getByRole('menuitem', { name: /Always allow in workspace/i })).toBeVisible();
    const menuBox = await window.locator('.ui-menu-content').first().boundingBox();
    const viewport = await window.evaluate(() => ({
      height: window.innerHeight,
      width: window.innerWidth
    }));
    expect(menuBox).not.toBeNull();
    expect((menuBox?.x ?? 0) + (menuBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);
    expect((menuBox?.y ?? 0) + (menuBox?.height ?? 0)).toBeLessThanOrEqual(viewport.height + 1);
    await window.keyboard.press('Escape');

    await emitVicodeEvent(app, {
      type: 'run.approvalResolved',
      approvalId: approval.id,
      threadId: approval.threadId,
      runId: approval.runId,
      decision: 'cancelled'
    });
    await expect(panel).toHaveCount(0);
  } finally {
    if (projectId) {
      await window.evaluate(
        async ({ targetProjectId, targetThreadId }) => {
          if (targetThreadId) {
            await window.vicode.threads.remove(targetThreadId).catch(() => {});
          }
          await window.vicode.projects.remove(targetProjectId).catch(() => {});
        },
        { targetProjectId: projectId, targetThreadId: threadId }
      ).catch(() => {});
    }

    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
