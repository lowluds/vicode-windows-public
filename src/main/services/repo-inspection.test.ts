import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RepoInspectionService } from './repo-inspection';

describe('RepoInspectionService', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'vicode-repo-inspection-'));
    tempDirs.push(dir);

    for (const [fileName, content] of Object.entries(files)) {
      const target = join(dir, fileName);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }

    return dir;
  }

  it('infers repo stack and commands from package.json and common project files', () => {
    const workspace = createWorkspace({
      'package.json': JSON.stringify(
        {
          name: 'vicode-windows',
          description: 'Minimal Windows-first Electron desktop app.',
          scripts: {
            dev: 'electron-vite dev',
            build: 'electron-vite build',
            test: 'vitest run',
            lint: 'eslint .'
          },
          dependencies: {
            electron: '^39.0.0',
            react: '^19.0.0',
            'better-sqlite3': '^12.0.0',
            zod: '^4.0.0'
          },
          devDependencies: {
            vite: '^7.0.0',
            typescript: '^5.0.0'
          }
        },
        null,
        2
      ),
      'package-lock.json': '',
      'tsconfig.json': '{}',
      'README.md': '# Vicode\n\nBuild a focused desktop shell for AI-assisted coding workflows.'
    });
    const service = new RepoInspectionService();

    const result = service.inspect(workspace);

    expect(result.repoName).toBe('vicode-windows');
    expect(result.repoPurpose).toContain('focused desktop shell');
    expect(result.packageManager).toBe('npm');
    expect(result.installCommand).toBe('npm install');
    expect(result.buildCommand).toBe('npm run build');
    expect(result.testCommand).toBe('npm run test');
    expect(result.lintCommand).toBe('npm run lint');
    expect(result.repoStack).toContain('Electron');
    expect(result.repoStack).toContain('React');
    expect(result.repoStack).toContain('Vite');
    expect(result.repoStack).toContain('TypeScript');
  });

  it('extracts durable constraints and platform focus from repo AGENTS guidance', () => {
    const workspace = createWorkspace({
      'package.json': JSON.stringify({
        name: 'windows-app',
        dependencies: {
          electron: '^39.0.0'
        }
      }),
      'AGENTS.md': [
        '- Windows-first. Optimize native module behavior.',
        '- No new dependencies unless justified.',
        '- Renderer must remain unprivileged.'
      ].join('\n')
    });
    const service = new RepoInspectionService();

    const result = service.inspect(workspace);

    expect(result.platformFocus).toBe('Windows-first');
    expect(result.constraints).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Windows-first'),
        expect.stringContaining('No new dependencies'),
        expect.stringContaining('Renderer must remain unprivileged')
      ])
    );
  });
});
