import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceBootstrapService } from './workspace-bootstrap';

describe('WorkspaceBootstrapService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const current = tempDirs.pop();
      if (current) {
        rmSync(current, { recursive: true, force: true });
      }
    }
  });

  function createWorkspace(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-workspace-bootstrap-'));
    tempDirs.push(dir);

    for (const [fileName, content] of Object.entries(files)) {
      const target = join(dir, fileName);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }

    return dir;
  }

  it('only allows bootstrap for workspaces with a real folder', () => {
    const service = new WorkspaceBootstrapService();

    expect(service.getStatus({ id: 'project-1', folderPath: null, trusted: true }).eligible).toBe(false);
    expect(service.getStatus({ id: 'project-1', folderPath: 'C:/workspace/project', trusted: false }).eligible).toBe(false);
    expect(service.getStatus({ id: 'project-1', folderPath: 'C:/workspace/project', trusted: true }).eligible).toBe(true);
  });

  it('creates drafts only for missing files by default', () => {
    const workspace = createWorkspace({
      'package.json': JSON.stringify({
        name: 'project',
        scripts: { build: 'vite build', test: 'vitest run' },
        dependencies: { react: '^19.0.0' },
        devDependencies: { vite: '^7.0.0', typescript: '^5.0.0' }
      }),
      'AGENTS.md': '# Existing agent guide'
    });
    const service = new WorkspaceBootstrapService();

    const bundle = service.createDrafts(
      { id: 'project-1', folderPath: workspace, trusted: true },
      {
        projectIntent: 'Ship a polished app.'
      },
      { includeSoul: true, date: new Date('2026-03-17T12:00:00.000Z') }
    );

    expect(bundle.status.missingFiles).not.toContain('USER.md');
    expect(bundle.status.missingFiles).not.toContain('MEMORY.md');
    expect(bundle.status.missingFiles).toContain('SOUL.md');
    expect(bundle.drafts.map((draft) => draft.fileName)).toEqual(['USER.md', 'MEMORY.md', 'SOUL.md']);
  });

  it('writes approved drafts into the workspace root and memory directory', () => {
    const workspace = createWorkspace({
      'package.json': JSON.stringify({
        name: 'project',
        description: 'Desktop app workspace.',
        scripts: { build: 'vite build', test: 'vitest run' },
        dependencies: { react: '^19.0.0' },
        devDependencies: { vite: '^7.0.0', typescript: '^5.0.0' }
      })
    });
    const service = new WorkspaceBootstrapService();
    const bundle = service.createDrafts(
      { id: 'project-1', folderPath: workspace, trusted: true },
      {
        projectIntent: 'Ship durable workspace files.',
        communicationStyle: 'direct and concise'
      },
      { includeDailyNote: true, date: new Date('2026-03-17T12:00:00.000Z') }
    );

    const writtenPaths = service.writeDrafts({ id: 'project-1', folderPath: workspace, trusted: true }, bundle.drafts);

    expect(writtenPaths).toEqual(
      expect.arrayContaining([
        join(workspace, 'AGENTS.md'),
        join(workspace, 'USER.md'),
        join(workspace, 'MEMORY.md'),
        join(workspace, 'memory', '2026-03-17.md')
      ])
    );
    expect(readFileSync(join(workspace, 'AGENTS.md'), 'utf8')).toContain('Ship durable workspace files.');
    expect(readFileSync(join(workspace, 'memory', '2026-03-17.md'), 'utf8')).toContain('2026-03-17');
  });

  it('reports durable profile file status for the workspace settings surface', () => {
    const workspace = createWorkspace({
      'AGENTS.md': '# Existing agent guide',
      'USER.md': '# User preferences',
      'MEMORY.md': '# Workspace memory',
      'memory/2026-04-20.md': '# Recent note'
    });
    const service = new WorkspaceBootstrapService();

    const status = service.getStatus({ id: 'project-1', folderPath: workspace, trusted: true });

    expect(status.contractFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'agents',
          relativePath: 'AGENTS.md',
          exists: true,
          required: true,
          loadMode: 'direct_prompt'
        }),
        expect.objectContaining({
          kind: 'user',
          relativePath: 'USER.md',
          exists: true,
          loadMode: 'direct_prompt'
        }),
        expect.objectContaining({
          kind: 'memory',
          relativePath: 'MEMORY.md',
          exists: true,
          loadMode: 'memory_retrieval'
        }),
        expect.objectContaining({
          kind: 'daily_note',
          relativePath: 'memory/2026-04-20.md',
          exists: true,
          loadMode: 'memory_retrieval'
        }),
        expect.objectContaining({
          kind: 'soul',
          relativePath: 'SOUL.md',
          exists: false,
          required: false
        })
      ])
    );
  });

  it('marks suggestion eligibility false after dismissal until files are written', () => {
    let dismissed = false;
    const workspace = createWorkspace({
      'package.json': JSON.stringify({
        name: 'project'
      })
    });
    const service = new WorkspaceBootstrapService(undefined, undefined, {
      isDismissed: () => dismissed,
      dismiss: () => {
        dismissed = true;
      },
      clearDismissal: () => {
        dismissed = false;
      }
    });

    expect(service.getStatus({ id: 'project-1', folderPath: workspace, trusted: true }).suggestionEligible).toBe(true);
    service.dismissSuggestion({ id: 'project-1' });
    expect(service.getStatus({ id: 'project-1', folderPath: workspace, trusted: true }).dismissed).toBe(true);
    expect(service.getStatus({ id: 'project-1', folderPath: workspace, trusted: true }).suggestionEligible).toBe(false);
  });
});
