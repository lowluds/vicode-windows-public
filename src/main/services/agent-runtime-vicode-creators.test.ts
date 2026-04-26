import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../storage/database';
import { McpRegistryService } from './mcp/registry';
import { SkillCatalogService } from './skills';
import { createAgentRuntimeVicodeCreatorBridge } from './agent-runtime-vicode-creators';

describe('createAgentRuntimeVicodeCreatorBridge', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const current = tempDirs.pop();
      if (current) {
        rmSync(current, { recursive: true, force: true });
      }
    }
  });

  function createStateDir() {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-creator-bridge-'));
    tempDirs.push(dir);
    return dir;
  }

  it('creates and imports a skill bundle through the app-owned state bridge', async () => {
    const statePath = createStateDir();
    const db = new DatabaseService(join(statePath, 'vicode.sqlite'));
    db.migrate();
    const skills = new SkillCatalogService(db, statePath);
    const mcp = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' }, { statePath });
    const bridge = createAgentRuntimeVicodeCreatorBridge({
      statePath,
      skills,
      mcp
    });

    const result = await bridge.createSkillBundle({
      scope: 'global',
      projectId: null,
      folderName: 'ci-triage',
      files: [
        {
          path: 'SKILL.md',
          content: [
            '---',
            'name: CI Triage',
            'description: Helps triage flaky CI failures.',
            '---',
            '',
            'Inspect the failing jobs and propose the smallest credible next step.'
          ].join('\n')
        },
        {
          path: '.vicode-skill.json',
          content: JSON.stringify(
            {
              id: 'file-backed-ci-triage',
              slug: 'ci-triage',
              providerTargets: ['openai', 'gemini'],
              syncTargets: ['openai'],
              category: 'automation'
            },
            null,
            2
          )
        }
      ]
    });

    const skillPath = join(statePath, 'skills', 'user', 'ci-triage', 'SKILL.md');

    expect(result.relativeRootPath).toBe('skills/user/ci-triage');
    expect(result.filePaths).toEqual(['SKILL.md', '.vicode-skill.json']);
    expect(result.importedId).toBe('file-backed-ci-triage');
    expect(existsSync(skillPath)).toBe(true);
    expect(readFileSync(skillPath, 'utf8')).toContain('CI Triage');
    expect((await skills.listSkills()).some((skill) => skill.id === 'file-backed-ci-triage')).toBe(true);

    await mcp.dispose();
    db.close();
  });

  it('creates and imports a plugin bundle through the app-owned state bridge', async () => {
    const statePath = createStateDir();
    const db = new DatabaseService(join(statePath, 'vicode.sqlite'));
    db.migrate();
    const skills = new SkillCatalogService(db, statePath);
    const mcp = new McpRegistryService(db, { name: 'vicode-test', version: '0.0.0' }, { statePath });
    const bridge = createAgentRuntimeVicodeCreatorBridge({
      statePath,
      skills,
      mcp
    });

    const result = await bridge.createPluginBundle({
      scope: 'global',
      projectId: null,
      folderName: 'fixture-plugin',
      files: [
        {
          path: '.codex-plugin/plugin.json',
          content: JSON.stringify(
            {
              name: 'Fixture Plugin',
              description: 'File-backed plugin for tests.'
            },
            null,
            2
          )
        },
        {
          path: '.mcp.json',
          content: JSON.stringify(
            {
              command: process.execPath,
              args: ['--version'],
              enabled: false,
              toolInvocationMode: 'ask',
              launchApproved: false
            },
            null,
            2
          )
        }
      ]
    });

    const manifestPath = join(statePath, 'plugins', 'user', 'fixture-plugin', '.codex-plugin', 'plugin.json');

    expect(result.relativeRootPath).toBe('plugins/user/fixture-plugin');
    expect(result.importedId).toBe('file-plugin:global:fixture-plugin');
    expect(existsSync(manifestPath)).toBe(true);
    expect(readFileSync(manifestPath, 'utf8')).toContain('Fixture Plugin');
    expect(mcp.listServerViews().some((server) => server.id === 'file-plugin:global:fixture-plugin')).toBe(true);

    await mcp.dispose();
    db.close();
  });
});
