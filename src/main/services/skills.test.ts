import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDER_IDS, type ProviderId, type ProviderModel, type SkillDefinition } from '../../shared/domain';
import type { DiscoveredNativeSkill, ProviderAdapter, ProviderRunCallbacks, ProviderRunContext, ProviderRunHandle } from '../../providers/types';

let mockedHome = '';
const runHiddenExecutableMock = vi.fn();
const fetchMock = vi.fn();

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => mockedHome
  };
});

vi.mock('../../providers/util', async () => {
  const actual = await vi.importActual<typeof import('../../providers/util')>('../../providers/util');
  return {
    ...actual,
    runHiddenExecutable: runHiddenExecutableMock
  };
});

describe('SkillCatalogService', () => {
  let root = '';
  let db!: {
    listSkills: () => SkillDefinition[];
    getSkill: (skillId: string) => SkillDefinition;
    upsertSkill: (skill: SkillDefinition) => SkillDefinition;
    deleteSkill: (skillId: string) => void;
  };

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'vicode-skills-'));
    mockedHome = join(root, 'home');
    runHiddenExecutableMock.mockReset();
    runHiddenExecutableMock.mockResolvedValue({ stdout: '', stderr: '' });
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    const skills = new Map<string, SkillDefinition>();
    db = {
      listSkills: () => [...skills.values()],
      getSkill: (skillId: string) => {
        const skill = skills.get(skillId);
        if (!skill) {
          throw new Error(`Skill not found: ${skillId}`);
        }
        return skill;
      },
      upsertSkill: (skill: SkillDefinition) => {
        skills.set(skill.id, skill);
        return skill;
      },
      deleteSkill: (skillId: string) => {
        skills.delete(skillId);
      }
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(root, { recursive: true, force: true });
  });

  function createAdapter(nativeSkills: DiscoveredNativeSkill[], providerId: ProviderId = 'openai'): ProviderAdapter {
    return {
      id: providerId,
      label:
        providerId === 'openai'
          ? 'OpenAI'
          : providerId === 'gemini'
            ? 'Gemini'
            : providerId === 'qwen'
              ? 'Qwen'
              : 'Kimi',
      listStaticModels: (): ProviderModel[] => [],
      discoverApiModels: async () => null,
      discoverRuntimeModels: async () => null,
      detectInstall: async () => ({ installed: true, cliPath: null }),
      getAuthState: async () => ({ authState: 'disconnected', authMode: null }),
      startAuth: async () => {},
      clearAuth: async () => {},
      discoverNativeSkills: async () => nativeSkills,
      validateProjectContext: () => ({ valid: true }),
      startRun: async (_context: ProviderRunContext, _callbacks: ProviderRunCallbacks): Promise<ProviderRunHandle> => ({
        runId: 'test-run',
        cancel: async () => {}
      })
    };
  }

  function createAdapters(overrides: Partial<Record<ProviderId, ProviderAdapter>> = {}): Record<ProviderId, ProviderAdapter> {
    return {
      ...Object.fromEntries(PROVIDER_IDS.map((providerId) => [providerId, createAdapter([], providerId)])),
      ...overrides
    } as Record<ProviderId, ProviderAdapter>;
  }

  it('throws a clear error when injected adapters are incomplete', async () => {
    const { SkillCatalogService } = await import('./skills');

    expect(
      () =>
        new SkillCatalogService(
          db as never,
          join(root, 'state'),
          {
            openai: createAdapter([], 'openai')
          } as unknown as Record<ProviderId, ProviderAdapter>
        )
    ).toThrowError('SkillCatalogService requires adapters for: gemini, qwen, ollama, kimi');
  });

  it('removes stale generated live-cert skills during startup refresh', async () => {
    const staleFolder = join(root, 'state', 'skills', 'live-cert-ollama-123');
    const stalePath = join(staleFolder, 'SKILL.md');
    const staleSkill: SkillDefinition = {
      id: 'skill-live-cert-ollama',
      name: 'live-cert-ollama-1774306198205-a9ed01',
      description: 'Deterministic live certification prompt skill for ollama.',
      instructions: 'Follow the user request exactly.',
      origin: 'custom_local',
      scope: 'global',
      providerTargets: ['ollama'],
      enabled: true,
      projectId: null,
      metadata: {},
      path: stalePath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.upsertSkill(staleSkill);

    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));

    await service.listSkills();

    expect(db.listSkills().some((skill) => skill.id === staleSkill.id)).toBe(false);
    expect(existsSync(staleFolder)).toBe(false);
  });

  it('removes stale generated ollama workflow skills when listing skills in a live session', async () => {
    const staleFolder = join(root, 'state', 'skills', 'ollama-rich-workflow-123');
    const stalePath = join(staleFolder, 'SKILL.md');
    const staleSkill: SkillDefinition = {
      id: 'skill-ollama-rich-workflow',
      name: 'ollama-rich-workflow-1775158378987-4c8817',
      description: 'Deterministic live certification prompt skill for ollama.',
      instructions: 'Follow the user request exactly.',
      origin: 'custom_local',
      scope: 'global',
      providerTargets: ['ollama'],
      enabled: true,
      projectId: null,
      metadata: {},
      path: stalePath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.upsertSkill(staleSkill);

    const staleReactFolder = join(root, 'state', 'skills', 'react-thread-direction-ollama-123');
    const staleReactPath = join(staleReactFolder, 'SKILL.md');
    db.upsertSkill({
      id: 'skill-react-thread-direction',
      name: 'react-thread-direction-ollama-1774647371389-37159b',
      description: 'Steers same-thread React landing-page work toward premium component continuity and restrained design.',
      instructions: 'Keep the same-thread implementation continuous.',
      origin: 'custom_local',
      scope: 'global',
      providerTargets: ['ollama'],
      enabled: true,
      projectId: null,
      metadata: {},
      path: staleReactPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));

    const skills = await service.listSkills();

    expect(skills.some((skill) => skill.id === staleSkill.id)).toBe(false);
    expect(skills.some((skill) => skill.id === 'skill-react-thread-direction')).toBe(false);
  });

  it('removes stale ollama build-cert and react-landing-direction skills when listing skills', async () => {
    db.upsertSkill({
      id: 'skill-ollama-build-cert',
      name: 'ollama-build-cert-1774311179233-878f6d',
      description: 'Deterministic live certification prompt skill for ollama.',
      instructions: 'Follow the user request exactly.',
      origin: 'custom_local',
      scope: 'global',
      providerTargets: ['ollama'],
      enabled: true,
      projectId: null,
      metadata: {},
      path: join(root, 'state', 'skills', 'user', 'ollama-build-cert-1774311179233-878f6d--deadbeef', 'SKILL.md'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    db.upsertSkill({
      id: 'skill-react-landing-direction',
      name: 'react-landing-direction-ollama-1774617726189-0a9b7b',
      description: 'Steers React landing pages toward premium component structure and restrained design.',
      instructions: 'Keep React landing-page structure restrained and premium.',
      origin: 'custom_local',
      scope: 'global',
      providerTargets: ['ollama'],
      enabled: true,
      projectId: null,
      metadata: {},
      path: join(root, 'state', 'skills', 'user', 'react-landing-direction-ollama-1774617726189-0a9b7b--deadbeef', 'SKILL.md'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));

    const skills = await service.listSkills();

    expect(skills.some((skill) => skill.id === 'skill-ollama-build-cert')).toBe(false);
    expect(skills.some((skill) => skill.id === 'skill-react-landing-direction')).toBe(false);
  });

  it('writes canonical skill files without exporting into the Codex app home', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));

    const skill = service.saveSkill({
      name: 'Premium Frontend Build',
      description: 'Build polished UI.',
      instructions: 'Use a premium frontend system.',
      scope: 'global',
      providerTargets: ['openai', 'gemini'],
      syncTargets: ['openai'],
      enabled: true,
      projectId: null
    });

    expect(skill.path).not.toBeNull();
    expect(existsSync(String(skill.path))).toBe(true);
    expect(readFileSync(String(skill.path), 'utf8')).toContain('Premium Frontend Build');

    const exportedPath = join(mockedHome, '.codex', 'skills');
    const syncState = (skill.metadata.syncState as Record<string, { exported: boolean; path: string | null; error?: string | null }>).openai;
    expect(existsSync(exportedPath)).toBe(false);
    expect(syncState?.exported).toBe(false);
    expect(syncState?.path).toBeNull();
    expect(syncState?.error).toMatch(/does not write to the Codex app home/i);
  });

  it('detects file-backed imported skills from the Vicode state folder after an explicit refresh', async () => {
    const statePath = join(root, 'state');
    const importedFolder = join(statePath, 'skills', 'user', 'ci-triage');
    mkdirSync(importedFolder, { recursive: true });
    writeFileSync(
      join(importedFolder, 'SKILL.md'),
      [
        '---',
        'name: CI Triage',
        'description: Helps triage flaky CI failures.',
        '---',
        '',
        'Inspect the failing jobs, compare recent changes, and propose the smallest credible next step.'
      ].join('\n'),
      'utf8'
    );
    writeFileSync(
      join(importedFolder, '.vicode-skill.json'),
      JSON.stringify(
        {
          id: 'file-backed-ci-triage',
          slug: 'ci-triage',
          providerTargets: ['openai', 'gemini', 'qwen'],
          syncTargets: ['openai'],
          category: 'automation'
        },
        null,
        2
      ),
      'utf8'
    );

    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, statePath);
    service.refreshSkillsFromDisk();

    const imported = (await service.listSkills()).find((skill) => skill.id === 'file-backed-ci-triage');

    expect(imported).toBeTruthy();
    expect(imported?.name).toBe('CI Triage');
    expect(imported?.scope).toBe('global');
    expect(imported?.providerTargets).toEqual(['openai', 'gemini', 'qwen']);
    expect(imported?.metadata.slug).toBe('ci-triage');
    expect(imported?.metadata.syncTargets).toEqual(['openai']);
    expect(imported?.path).toBe(join(importedFolder, 'SKILL.md'));
  });

  it('removes provider exports when sync is disabled', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));

    const skill = service.saveSkill({
      name: 'Reviewer',
      description: 'Review code critically.',
      instructions: 'Lead with findings.',
      scope: 'global',
      providerTargets: ['openai'],
      syncTargets: ['openai'],
      enabled: true,
      projectId: null
    });

    const synced = service.syncSkill(skill.id, 'openai', false);
    const syncState = (synced.metadata.syncState as Record<string, { exported: boolean; path: string | null }>).openai;

    expect(syncState.exported).toBe(false);
    expect(syncState.path).toBeNull();
  });

  it('does not delete existing files under the Codex app home when disabling sync', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));
    const codexSkillFolder = join(mockedHome, '.codex', 'skills', 'reviewer');
    const codexSkillPath = join(codexSkillFolder, 'SKILL.md');
    mkdirSync(codexSkillFolder, { recursive: true });
    writeFileSync(codexSkillPath, '# Reviewer\n\nKeep this Codex-owned skill.\n', 'utf8');

    db.upsertSkill({
      id: 'skill-reviewer',
      name: 'Reviewer',
      description: 'Review code critically.',
      instructions: 'Lead with findings.',
      origin: 'custom_local',
      scope: 'global',
      providerTargets: ['openai'],
      enabled: true,
      projectId: null,
      metadata: {
        syncTargets: ['openai'],
        syncState: {
          openai: {
            exported: true,
            path: codexSkillPath,
            updatedAt: new Date().toISOString(),
            error: null
          }
        }
      },
      path: join(root, 'state', 'skills', 'user', 'reviewer--skill-re', 'SKILL.md'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const synced = service.syncSkill('skill-reviewer', 'openai', false);
    const syncState = (synced.metadata.syncState as Record<string, { exported: boolean; path: string | null; error?: string | null }>).openai;

    expect(existsSync(codexSkillPath)).toBe(true);
    expect(readFileSync(codexSkillPath, 'utf8')).toContain('Codex-owned skill');
    expect(syncState.exported).toBe(false);
    expect(syncState.path).toBeNull();
    expect(syncState.error).toMatch(/did not remove provider files inside the Codex app home/i);
  });

  it('refuses to enable Codex provider-folder sync from Vicode', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));

    const skill = service.saveSkill({
      name: 'Reviewer',
      description: 'Review code critically.',
      instructions: 'Lead with findings.',
      scope: 'global',
      providerTargets: ['openai'],
      syncTargets: [],
      enabled: true,
      projectId: null
    });

    expect(() => service.syncSkill(skill.id, 'openai', true)).toThrow(/does not write to the Codex app home/i);
    expect(existsSync(join(mockedHome, '.codex', 'skills'))).toBe(false);
  });

  it('discovers provider-native skills and skips exported Vicode copies', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(
      db as never,
      join(root, 'state'),
      createAdapters({
        openai: createAdapter([
          {
            id: 'provider-native:openai:skill:cloudflare-deploy',
            name: 'Cloudflare Deploy',
            description: 'Deploy to Cloudflare.',
            instructions: 'Deploy with the provider runtime.',
            path: join(mockedHome, '.codex', 'skills', 'cloudflare-deploy', 'SKILL.md'),
            providerTargets: ['openai'],
            attachMode: 'runtime',
            kind: 'skill',
            metadata: { providerOrigin: 'openai', browseUrl: 'https://developers.openai.com/codex/skills/' }
          },
          {
            id: 'provider-native:openai:skill:reviewer--abcd1234',
            name: 'Reviewer Export',
            description: 'Exported custom reviewer.',
            instructions: 'Lead with findings.',
            path: '__TO_BE_REPLACED__',
            providerTargets: ['openai'],
            attachMode: 'runtime',
            kind: 'skill',
            metadata: { providerOrigin: 'openai' }
          }
        ]),
        gemini: {
          ...createAdapter([], 'gemini'),
          id: 'gemini',
          label: 'Gemini'
        }
      })
    );

    const saved = service.saveSkill({
      name: 'Reviewer',
      description: 'Review code critically.',
      instructions: 'Lead with findings.',
      scope: 'global',
      providerTargets: ['openai'],
      syncTargets: [],
      enabled: true,
      projectId: null
    });
    const exportedPath = join(mockedHome, '.codex', 'skills', 'reviewer--abcd1234', 'SKILL.md');
    db.upsertSkill({
      ...saved,
      metadata: {
        ...saved.metadata,
        syncState: {
          openai: {
            exported: true,
            path: exportedPath,
            updatedAt: new Date().toISOString(),
            error: null
          }
        }
      }
    });
    const openAiAdapter = (
      service as unknown as {
        adapters: Record<ProviderId, ProviderAdapter>;
      }
    ).adapters.openai;
    vi.spyOn(openAiAdapter, 'discoverNativeSkills').mockResolvedValueOnce([
      {
        id: 'provider-native:openai:skill:cloudflare-deploy',
        name: 'Cloudflare Deploy',
        description: 'Deploy to Cloudflare.',
        instructions: 'Deploy with the provider runtime.',
        path: join(mockedHome, '.codex', 'skills', 'cloudflare-deploy', 'SKILL.md'),
        providerTargets: ['openai'],
        attachMode: 'runtime',
        kind: 'skill',
        metadata: { providerOrigin: 'openai', browseUrl: 'https://developers.openai.com/codex/skills/' }
      },
      {
        id: 'provider-native:openai:skill:reviewer--abcd1234',
        name: 'Reviewer Export',
        description: 'Exported custom reviewer.',
        instructions: 'Lead with findings.',
        path: exportedPath,
        providerTargets: ['openai'],
        attachMode: 'runtime',
        kind: 'skill',
        metadata: { providerOrigin: 'openai' }
      }
    ]);

    const skills = await service.listSkills();

    expect(skills.some((skill) => skill.id === 'provider-native:openai:skill:cloudflare-deploy')).toBe(true);
    expect(skills.some((skill) => skill.id === 'provider-native:openai:skill:reviewer--abcd1234')).toBe(false);
  });

  it('reads provider-native skill detail from the source file', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(
      db as never,
      join(root, 'state'),
      createAdapters({
        openai: createAdapter([], 'openai'),
        gemini: {
          ...createAdapter([], 'gemini'),
          id: 'gemini',
          label: 'Gemini'
        }
      })
    );

    const nativeFolder = join(root, 'native-skill');
    const nativePath = join(nativeFolder, 'SKILL.md');
    db.upsertSkill({
      id: 'provider-native:openai:skill:test-skill',
      name: 'Test Skill',
      description: 'Native detail file.',
      instructions: 'Use the provider runtime.',
      origin: 'provider_native',
      scope: 'global',
      providerTargets: ['openai'],
      enabled: true,
      projectId: null,
      metadata: {
        providerOrigin: 'openai',
        kind: 'skill',
        attachMode: 'runtime',
        examplePrompt: 'Deploy this app.'
      },
      path: nativePath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const fs = await import('node:fs');
    fs.mkdirSync(nativeFolder, { recursive: true });
    fs.writeFileSync(nativePath, '# Test Skill\n\nUse the native skill.\n', 'utf8');

    const detail = service.getSkillDetail('provider-native:openai:skill:test-skill');

    expect(detail.markdown).toContain('# Test Skill');
    expect(detail.examplePrompt).toBe('Deploy this app.');
    expect(detail.attachMode).toBe('runtime');
  });

  it('uninstalls provider-native Gemini extensions from the provider folder', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(
      db as never,
      join(root, 'state'),
      createAdapters({
        openai: createAdapter([], 'openai'),
        gemini: {
          ...createAdapter([], 'gemini'),
          id: 'gemini',
          label: 'Gemini'
        }
      })
    );

    const extensionDir = join(mockedHome, '.gemini', 'extensions', 'superpowers');
    const extensionPath = join(extensionDir, 'GEMINI.md');
    const fs = await import('node:fs');
    fs.mkdirSync(extensionDir, { recursive: true });
    fs.writeFileSync(extensionPath, '# Superpowers\n', 'utf8');

    db.upsertSkill({
      id: 'provider-native:gemini:extension:superpowers',
      name: 'Superpowers',
      description: 'Installed Gemini extension.',
      instructions: 'Use the provider runtime.',
      origin: 'provider_native',
      scope: 'global',
      providerTargets: ['gemini'],
      enabled: true,
      projectId: null,
      metadata: {
        providerOrigin: 'gemini',
        kind: 'extension',
        attachMode: 'runtime'
      },
      path: extensionPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    service.removeSkill('provider-native:gemini:extension:superpowers');

    expect(existsSync(extensionDir)).toBe(false);
    expect(() => db.getSkill('provider-native:gemini:extension:superpowers')).toThrow();
  });

  it('does not install provider-native OpenAI skills into the Codex app home', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));
    const codexSkillDir = join(mockedHome, '.codex', 'skills', 'cloudflare-deploy');
    const codexSkillPath = join(codexSkillDir, 'SKILL.md');
    mkdirSync(codexSkillDir, { recursive: true });
    writeFileSync(codexSkillPath, '# Existing Codex Skill\n', 'utf8');

    await expect(
      service.installSuggestedSkill({
        installKind: 'provider_native',
        providerId: 'openai',
        token: 'cloudflare-deploy'
      })
    ).rejects.toThrow(/does not install provider-native Codex skills/i);

    expect(existsSync(codexSkillPath)).toBe(true);
    expect(readFileSync(codexSkillPath, 'utf8')).toContain('Existing Codex Skill');
  });

  it('installs Gemini extensions without opening an external terminal', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(
      db as never,
      join(root, 'state'),
      createAdapters({
        openai: createAdapter([], 'openai'),
        gemini: {
          ...createAdapter([], 'gemini'),
          id: 'gemini',
          label: 'Gemini',
          detectInstall: async () => ({
            installed: true,
            cliPath: 'C:\\Users\\test\\AppData\\Roaming\\npm\\gemini.cmd'
          })
        }
      })
    );

    const result = await service.installSuggestedSkill({
      installKind: 'provider_native',
      providerId: 'gemini',
      token: '@browserbase/mcp-server-browserbase',
      installTarget: '@browserbase/mcp-server-browserbase'
    });

    expect(runHiddenExecutableMock).toHaveBeenCalledTimes(1);
    expect(runHiddenExecutableMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        'extensions',
        'install',
        '@browserbase/mcp-server-browserbase',
        '--consent'
      ])
    );
    expect(result.status).toBe('completed');
    expect(result.message).toContain('Installed Gemini extension');
  });

  it('installs GitHub-backed skills as Vicode-managed cross-provider skills', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            type: 'file',
            name: 'SKILL.md',
            path: 'skills/docx/SKILL.md',
            download_url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/docx/SKILL.md'
          }
        ]
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          Buffer.from('# Docx\n\nCreate, edit, and analyze Word documents.\n\n## Instructions\nUse docx workflows.\n').buffer
      });

    const result = await service.installSuggestedSkill({
      installKind: 'github_folder',
      token: 'docx',
      owner: 'anthropics',
      repo: 'skills',
      path: 'skills/docx',
      name: 'Docx',
      description: 'Create, edit, and analyze Word documents.',
      browseUrl: 'https://github.com/anthropics/skills/tree/main/skills/docx',
      category: 'documents',
      providerTargets: ['openai', 'gemini']
    });

    const skills = await service.listSkills();
    const installed = skills.find((skill) => skill.name === 'Docx');

    expect(result.status).toBe('completed');
    expect(result.providerId).toBeNull();
    expect(installed).toBeTruthy();
    expect(installed?.providerTargets).toEqual(['openai', 'gemini']);
    expect(installed?.metadata.category).toBe('documents');
    expect(installed?.metadata.browseUrl).toBe('https://github.com/anthropics/skills/tree/main/skills/docx');
  });
});
