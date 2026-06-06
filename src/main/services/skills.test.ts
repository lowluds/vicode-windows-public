import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillDefinition } from '../../shared/domain';

let mockedHome = '';
const fetchMock = vi.fn();

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => mockedHome
  };
});

describe('SkillCatalogService', () => {
  let root = '';
  let db!: {
    listSkills: () => SkillDefinition[];
    getSkill: (skillId: string) => SkillDefinition;
    upsertSkill: (skill: SkillDefinition) => SkillDefinition;
    deleteSkill: (skillId: string) => void;
    getPreferences: () => { skillsLibraryPath: string | null };
  };
  let skillsLibraryPath: string | null = null;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'vicode-skills-'));
    mockedHome = join(root, 'home');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    skillsLibraryPath = null;
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
      },
      getPreferences: () => ({ skillsLibraryPath })
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(root, { recursive: true, force: true });
  });

  it('does not require provider adapters for the app-managed skill catalog', async () => {
    const { SkillCatalogService } = await import('./skills');

    expect(
      () =>
        new (SkillCatalogService as unknown as new (
          db: typeof db,
          statePath: string,
          legacyAdapters?: unknown
        ) => unknown)(
          db as never,
          join(root, 'state'),
          {
            openai: { id: 'openai' }
          }
        )
    ).not.toThrow();
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

  it('ignores legacy Codex export metadata while writing canonical skill files', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));

    const skill = service.saveSkill({
      name: 'Premium Frontend Build',
      description: 'Build polished UI.',
      instructions: 'Use a premium frontend system.',
      scope: 'global',
      providerTargets: ['openai', 'gemini'],
      enabled: true,
      projectId: null
    });

    expect(skill.path).not.toBeNull();
    expect(existsSync(String(skill.path))).toBe(true);
    expect(readFileSync(String(skill.path), 'utf8')).toContain('Premium Frontend Build');

    const exportedPath = join(mockedHome, '.codex', 'skills');
    expect(existsSync(exportedPath)).toBe(false);
    expect(skill.metadata).not.toHaveProperty('syncTargets');
    expect(readFileSync(join(dirname(String(skill.path)), 'skill.json'), 'utf8')).not.toContain('syncTargets');
  });

  it('ignores legacy provider export metadata while writing canonical skill files', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));

    const skill = service.saveSkill({
      name: 'Gemini Review Helper',
      description: 'Review code with Gemini.',
      instructions: 'Lead with findings.',
      scope: 'global',
      providerTargets: ['gemini'],
      enabled: true,
      projectId: null
    });

    const exportedPath = join(mockedHome, '.gemini', 'skills');
    expect(existsSync(exportedPath)).toBe(false);
    expect(skill.metadata).not.toHaveProperty('syncTargets');
    expect(readFileSync(join(dirname(String(skill.path)), 'skill.json'), 'utf8')).not.toContain('syncTargets');
  });

  it('detects file-backed imported skills without preserving legacy provider export metadata', async () => {
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
    expect(imported?.metadata).not.toHaveProperty('syncTargets');
    expect(imported?.path).toBe(join(importedFolder, 'SKILL.md'));
    expect(readFileSync(join(importedFolder, 'skill.json'), 'utf8')).not.toContain('syncTargets');
  });

  it('rescans configured external skill folders into the app skill catalog', async () => {
    const externalRoot = join(root, 'external-skills');
    const externalSkillFolder = join(externalRoot, 'ableton-browser-guide');
    mkdirSync(externalSkillFolder, { recursive: true });
    writeFileSync(
      join(externalSkillFolder, 'SKILL.md'),
      [
        '---',
        'name: Ableton Browser Guide',
        'description: Applies dense browser UI patterns.',
        '---',
        '',
        'Translate Ableton browser concepts into Vicode UI without copying it literally.'
      ].join('\n'),
      'utf8'
    );
    writeFileSync(
      join(externalSkillFolder, '.vicode-skill.json'),
      JSON.stringify({ enabled: true, category: 'design' }, null, 2),
      'utf8'
    );
    skillsLibraryPath = externalRoot;

    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));
    const skills = await service.rescanLibrarySkills();
    const imported = skills.find((skill) => skill.name === 'Ableton Browser Guide');

    expect(imported).toBeTruthy();
    expect(imported?.origin).toBe('custom_local');
    expect(imported?.scope).toBe('global');
    expect(imported?.enabled).toBe(true);
    expect(imported?.metadata.category).toBe('design');
    expect(imported?.path).toBe(join(root, 'state', 'skills', 'user', 'ableton-browser-guide', 'SKILL.md'));
    expect(readFileSync(String(imported?.path), 'utf8')).toContain('Ableton Browser Guide');
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

    const synced = service.saveSkill({
      id: 'skill-reviewer',
      name: 'Reviewer',
      description: 'Review code critically.',
      instructions: 'Lead with findings.',
      scope: 'global',
      providerTargets: ['openai'],
      enabled: true,
      projectId: null
    });
    const syncState = (synced.metadata.syncState as Record<string, { exported: boolean; path: string | null; error?: string | null }>).openai;

    expect(existsSync(codexSkillPath)).toBe(true);
    expect(readFileSync(codexSkillPath, 'utf8')).toContain('Codex-owned skill');
    expect(syncState.exported).toBe(false);
    expect(syncState.path).toBeNull();
    expect(synced.metadata).not.toHaveProperty('syncTargets');
  });

  it('does not delete existing files under provider-owned skill folders when disabling sync', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));
    const geminiSkillFolder = join(mockedHome, '.gemini', 'skills', 'reviewer');
    const geminiSkillPath = join(geminiSkillFolder, 'SKILL.md');
    mkdirSync(geminiSkillFolder, { recursive: true });
    writeFileSync(geminiSkillPath, '# Reviewer\n\nKeep this Gemini-owned skill.\n', 'utf8');

    db.upsertSkill({
      id: 'skill-gemini-reviewer',
      name: 'Gemini Reviewer',
      description: 'Review code critically.',
      instructions: 'Lead with findings.',
      origin: 'custom_local',
      scope: 'global',
      providerTargets: ['gemini'],
      enabled: true,
      projectId: null,
      metadata: {
        syncTargets: ['gemini'],
        syncState: {
          gemini: {
            exported: true,
            path: geminiSkillPath,
            updatedAt: new Date().toISOString(),
            error: null
          }
        }
      },
      path: join(root, 'state', 'skills', 'user', 'gemini-reviewer--skill-ge', 'SKILL.md'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const synced = service.saveSkill({
      id: 'skill-gemini-reviewer',
      name: 'Gemini Reviewer',
      description: 'Review code critically.',
      instructions: 'Lead with findings.',
      scope: 'global',
      providerTargets: ['gemini'],
      enabled: true,
      projectId: null
    });
    const syncState = (synced.metadata.syncState as Record<string, { exported: boolean; path: string | null; error?: string | null }>).gemini;

    expect(existsSync(geminiSkillPath)).toBe(true);
    expect(readFileSync(geminiSkillPath, 'utf8')).toContain('Gemini-owned skill');
    expect(syncState.exported).toBe(false);
    expect(syncState.path).toBeNull();
    expect(synced.metadata).not.toHaveProperty('syncTargets');
  });

  it('clears legacy provider export metadata during ordinary skill toggles', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));

    db.upsertSkill({
      id: 'skill-legacy-sync',
      name: 'Legacy Sync',
      description: 'Legacy provider export metadata.',
      instructions: 'Stay app-managed.',
      origin: 'custom_local',
      scope: 'global',
      providerTargets: ['gemini'],
      enabled: false,
      projectId: null,
      metadata: {
        syncTargets: ['gemini']
      },
      path: join(root, 'state', 'skills', 'user', 'legacy-sync--skill-le', 'SKILL.md'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const toggled = service.toggleSkill('skill-legacy-sync', true);

    expect(toggled.enabled).toBe(true);
    expect(toggled.metadata).not.toHaveProperty('syncTargets');
    expect(existsSync(join(mockedHome, '.gemini', 'skills'))).toBe(false);
    expect(readFileSync(join(dirname(String(toggled.path)), 'skill.json'), 'utf8')).not.toContain('syncTargets');
  });

  it('keeps provider-native skills out of the Vicode catalog during listing', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));

    db.upsertSkill({
      id: 'provider-native:openai:skill:legacy-codex',
      name: 'Legacy Codex',
      description: 'Provider-owned skill.',
      instructions: 'Use the provider runtime.',
      origin: 'provider_native',
      scope: 'global',
      providerTargets: ['openai'],
      enabled: true,
      projectId: null,
      metadata: { providerOrigin: 'openai' },
      path: join(mockedHome, '.codex', 'skills', 'legacy-codex', 'SKILL.md'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const skills = await service.listSkills();

    expect(skills.some((skill) => skill.id === 'provider-native:openai:skill:legacy-codex')).toBe(false);
  });

  it('reads provider-native skill detail from the source file', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));

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

  it('does not expose unreadable provider-native skill file text in skill details', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));

    const nativeFolder = join(root, 'native-broken-skill');
    const nativePath = join(nativeFolder, 'SKILL.md');
    db.upsertSkill({
      id: 'provider-native:openai:skill:broken-skill',
      name: 'Broken Skill',
      description: 'Installed Codex skill. The local skill file appears unreadable.',
      instructions: 'Installed Codex skill. The local skill file appears unreadable.',
      origin: 'provider_native',
      scope: 'global',
      providerTargets: ['openai'],
      enabled: true,
      projectId: null,
      metadata: {
        providerOrigin: 'openai',
        kind: 'skill',
        attachMode: 'runtime',
        browseUrl: 'https://github.com/openai/skills/tree/main/skills/.curated'
      },
      path: nativePath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const fs = await import('node:fs');
    fs.mkdirSync(nativeFolder, { recursive: true });
    fs.writeFileSync(nativePath, '\0'.repeat(512), 'utf8');

    const detail = service.getSkillDetail('provider-native:openai:skill:broken-skill');

    expect(detail.markdown).toContain('Broken Skill');
    expect(detail.markdown).toContain('could not be read as text');
    expect(detail.markdown).not.toContain('\0');
  });

  it('hides provider-native Gemini extensions without deleting provider-owned files', async () => {
    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));

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
    const skills = await service.listSkills();

    expect(existsSync(extensionPath)).toBe(true);
    expect(skills.some((skill) => skill.id === 'provider-native:gemini:extension:superpowers')).toBe(false);
  });

  it('hides Codex-native skills from Vicode without deleting files in the Codex app home', async () => {
    const codexSkillDir = join(mockedHome, '.codex', 'skills', 'content-strategy');
    const codexSkillPath = join(codexSkillDir, 'SKILL.md');
    const fs = await import('node:fs');
    fs.mkdirSync(codexSkillDir, { recursive: true });
    fs.writeFileSync(codexSkillPath, '# Content Strategy\n', 'utf8');

    const { SkillCatalogService } = await import('./skills');
    const service = new SkillCatalogService(db as never, join(root, 'state'));
    db.upsertSkill({
      id: 'provider-native:openai:skill:content-strategy',
      name: 'content-strategy',
      description: 'Installed Codex skill.',
      instructions: 'Use the provider runtime.',
      origin: 'provider_native',
      scope: 'global',
      providerTargets: ['openai'],
      enabled: true,
      projectId: null,
      metadata: { providerOrigin: 'openai' },
      path: codexSkillPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    service.removeSkill('provider-native:openai:skill:content-strategy');
    const skills = await service.listSkills();

    expect(existsSync(codexSkillPath)).toBe(true);
    expect(skills.some((skill) => skill.id === 'provider-native:openai:skill:content-strategy')).toBe(false);
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
      providerTargets: ['openai', 'ollama']
    });

    const skills = await service.listSkills();
    const installed = skills.find((skill) => skill.name === 'Docx');

    expect(result.status).toBe('completed');
    expect(result.providerId).toBeNull();
    expect(installed).toBeTruthy();
    expect(installed?.providerTargets).toEqual(['openai', 'ollama']);
    expect(installed?.metadata.category).toBe('documents');
    expect(installed?.metadata.browseUrl).toBe('https://github.com/anthropics/skills/tree/main/skills/docx');
  });
});
