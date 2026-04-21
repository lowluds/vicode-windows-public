import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { closeApp, launchApp, waitForBridge } from './helpers/electron';

test('opens workspace bootstrap from the thread header and writes reviewed workspace files', async () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'vicode-workspace-bootstrap-e2e-'));
  writeFileSync(
    join(workspaceDir, 'package.json'),
    JSON.stringify(
      {
        name: 'bootstrap-flow-project',
        private: true,
        scripts: {
          build: 'vite build',
          test: 'vitest run'
        },
        dependencies: {
          react: '^19.0.0'
        },
        devDependencies: {
          vite: '^7.0.0',
          typescript: '^5.0.0'
        }
      },
      null,
      2
    ),
    'utf8'
  );

  const { app, window: launchedWindow } = await launchApp({
    bridgePaths: ['vicode.app', 'vicode.workspaceBootstrap', 'vicode.projects', 'vicode.settings']
  });

  let window: Page | null = launchedWindow;
  let projectId: string | null = null;
  let threadId: string | null = null;
  let originalFolderPath: string | null = null;
  let originalTrusted = false;

  try {
    await window.setViewportSize({ width: 1600, height: 1400 });

    const seeded = await window.evaluate(async (targetWorkspaceDir) => {
      const bootstrap = await window.vicode.app.getBootstrap();
      const project = bootstrap.projects.find((entry) => entry.id === bootstrap.preferences.selectedProjectId) ?? bootstrap.projects[0];
      if (!project) {
        throw new Error('Expected an existing project for the workspace bootstrap E2E.');
      }

      await window.vicode.projects.update({
        id: project.id,
        folderPath: targetWorkspaceDir,
        trusted: true
      });
      const thread = await window.vicode.threads.create({
        projectId: project.id,
        providerId: project.defaultProviderId,
        modelId: project.defaultModelByProvider[project.defaultProviderId],
        executionPermission: 'default'
      });
      await window.vicode.settings.save({
        selectedProjectId: project.id,
        lastOpenedThreadId: thread.id
      });
      return {
        projectId: project.id,
        threadId: thread.id,
        originalFolderPath: project.folderPath,
        originalTrusted: project.trusted
      };
    }, workspaceDir);

    projectId = seeded.projectId;
    threadId = seeded.threadId;
    originalFolderPath = seeded.originalFolderPath;
    originalTrusted = seeded.originalTrusted;

    await window.reload();
    await waitForBridge(window, ['vicode.app', 'vicode.workspaceBootstrap', 'vicode.projects', 'vicode.settings']);

    await expect(window.getByTestId('workspace-bootstrap-suggestion')).toHaveCount(0);
    await window.getByTestId('workspace-bootstrap-open').click();

    const bootstrapDialog = window.getByTestId('workspace-bootstrap-dialog');
    await expect(window.getByText('Set up workspace files')).toBeVisible();
    await expect(bootstrapDialog).toContainText('How this works');

    const projectIntentField = window
      .getByText('What are you building here?')
      .locator('..')
      .getByRole('textbox');
    await expect(projectIntentField).not.toHaveValue('');

    await window.getByTestId('workspace-bootstrap-generate').scrollIntoViewIfNeeded();
    await window.getByTestId('workspace-bootstrap-generate').click({ force: true });
    await expect(window.getByText('Workspace Operating Guide')).toBeVisible();

    await window.getByRole('button', { name: 'AGENTS.md', exact: true }).click();
    const editor = window.getByTestId('workspace-bootstrap-editor');
    await expect(editor).toContainText('Workspace Operating Guide');

    await window.getByTestId('workspace-bootstrap-regenerate').click();
    await expect(editor).toContainText('Workspace Operating Guide');

    await window.getByTestId('workspace-bootstrap-write').scrollIntoViewIfNeeded();
    await window.getByTestId('workspace-bootstrap-write').click({ force: true });
    await expect(window.getByTestId('workspace-bootstrap-dialog')).toHaveCount(0);
    await expect(window.getByTestId('workspace-bootstrap-open')).toHaveCount(0);

    expect(existsSync(join(workspaceDir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(workspaceDir, 'USER.md'))).toBe(true);
    expect(existsSync(join(workspaceDir, 'MEMORY.md'))).toBe(true);
    expect(readFileSync(join(workspaceDir, 'AGENTS.md'), 'utf8')).toContain('Workspace Operating Guide');
    expect(readFileSync(join(workspaceDir, 'USER.md'), 'utf8')).toContain('Default provider for this workspace');
  } finally {
    if (window && projectId) {
      try {
        await window.evaluate(
          async ({ targetProjectId, targetThreadId, targetFolderPath, targetTrusted }) => {
            if (targetThreadId) {
              await window.vicode.threads.remove(targetThreadId);
            }
            await window.vicode.projects.update({
              id: targetProjectId,
              folderPath: targetFolderPath,
              trusted: targetTrusted
            });
            await window.vicode.settings.save({
              selectedProjectId: targetProjectId,
              lastOpenedThreadId: null
            });
          },
          {
            targetProjectId: projectId,
            targetThreadId: threadId,
            targetFolderPath: originalFolderPath,
            targetTrusted: originalTrusted
          }
        );
      } catch {
        // Best-effort cleanup only.
      }
    }

    await closeApp(app);
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
