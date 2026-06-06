import { describe, expect, it } from 'vitest';

import {
  buildSuggestedSkillDocument,
  canInstallSuggestedSkill,
  SUGGESTED_SKILLS,
  suggestedSkillAvailabilityLabel
} from './SkillsView.suggested';
import {
  compatibilityLabel,
  pluginCategoryLabel,
  PROVIDER_OPTIONS,
  resolveSkillCategoryLabel
} from './SkillsView.labels';
import {
  buildSkillSaveInput,
  canSaveSkillDraft,
  createDraftFromSkill,
  emptyDraft,
  hasMatchingInstalledSkill,
  isSkillAttachable,
  skillDraftScopeHelp,
  skillAvatarClass,
  skillOriginLabel,
  skillScopeLabel,
  sortSkills,
  toggleDraftProviderTargets
} from './SkillsView.activeSkills';
import {
  buildSkillCatalogSections,
  filterActiveSkillsForQuery,
  filterSuggestedSkillsForQuery
} from './SkillsView.catalog';
import {
  attachModeFactLabel,
  detailCategoryLabel,
  detailCommandLabel,
  detailProvidersLabel,
  detailSourceLabel,
  providerNativeStatusMessage,
  suggestedSkillAvatarClass,
  suggestedSkillStatusLabel,
  suggestedSkillStatusMessage,
  unavailableSkillFootnote
} from './SkillsView.detail';
import { SkillsIcon } from './icons';
import type { Project, ProviderId, SkillCategory, SkillDefinition } from '../../shared/domain';
import type { CuratedSkillCatalogEntry } from '../../shared/curatedCatalog';

function createSuggestedSkill(input: {
  installKind: 'provider_reference' | 'github_folder';
  providerTargets: ProviderId[];
  id?: string;
  name?: string;
  token?: string;
  category?: SkillCategory;
  featured?: boolean;
}) {
  return {
    id: input.id ?? 'sample-skill',
    name: input.name ?? 'Sample Skill',
    publisher: 'Vicode',
    official: true,
    description: 'Sample description.',
    installKind: input.installKind,
    providerTargets: input.providerTargets,
    browseUrl: 'https://example.com/sample',
    token: input.token ?? 'sample-skill',
    category: input.category ?? 'engineering' as SkillCategory,
    icon: SkillsIcon,
    status: 'keep' as CuratedSkillCatalogEntry['status'],
    verification: 'source-reviewed' as CuratedSkillCatalogEntry['verification'],
    notes: ['Sample note.'],
    featured: input.featured
  };
}

describe('SkillsView copy helpers', () => {
  it('treats provider-managed references as browse-only references', () => {
    const skill = createSuggestedSkill({
      installKind: 'provider_reference',
      providerTargets: ['gemini']
    });

    expect(canInstallSuggestedSkill(skill)).toBe(false);
    expect(suggestedSkillAvailabilityLabel(skill)).toBe('Provider-managed reference');
    expect(buildSuggestedSkillDocument(skill)).toContain(
      'Browse this provider-managed resource here, then install or manage it in the provider app.'
    );
  });

  it('keeps GitHub folder suggestions installable as Vicode-managed skills', () => {
    const skill = createSuggestedSkill({
      installKind: 'github_folder',
      providerTargets: ['openai', 'gemini']
    });

    expect(canInstallSuggestedSkill(skill)).toBe(true);
    expect(suggestedSkillAvailabilityLabel(skill)).toBe('Importable skill');
    expect(buildSuggestedSkillDocument(skill)).toContain(
      'Import this skill into Vicode to attach it in the composer and use its instructions during runs.'
    );
  });

  it('keeps suggested skills on the surfaced beta providers', () => {
    expect(SUGGESTED_SKILLS.some((skill) => skill.installKind === 'provider_reference')).toBe(false);
    expect(
      SUGGESTED_SKILLS.every((skill) =>
        skill.providerTargets.every((providerId) => PROVIDER_OPTIONS.includes(providerId))
      )
    ).toBe(true);
    expect(SUGGESTED_SKILLS[0]?.providerTargets).toEqual(['ollama', 'openai_compatible']);
  });
});

describe('SkillsView label helpers', () => {
  function createSkill(input: {
    token: string;
    category?: SkillCategory | null;
    kind?: 'skill' | 'extension';
  }): SkillDefinition {
    return {
      id: `skill-${input.token}`,
      name: input.token,
      description: 'Sample skill.',
      instructions: 'Use the sample skill.',
      origin: 'custom_local',
      scope: 'global',
      providerTargets: ['openai'],
      enabled: true,
      projectId: null,
      metadata: {
        slug: input.token,
        category: input.category ?? null,
        kind: input.kind ?? 'skill'
      },
      path: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  it('formats provider compatibility in product language', () => {
    expect(compatibilityLabel(['openai', 'gemini'])).toBe('OpenAI + Gemini');
    expect(compatibilityLabel([])).toBe('Provider');
  });

  it('resolves explicit, known built-in, and extension categories', () => {
    expect(resolveSkillCategoryLabel(createSkill({ token: 'custom', category: 'frontend' }))).toBe('Frontend');
    expect(resolveSkillCategoryLabel(createSkill({ token: 'pdf-toolkit' }))).toBe('Documents');
    expect(resolveSkillCategoryLabel(createSkill({ token: 'native-helper', kind: 'extension' }))).toBe('Provider Runtime');
  });

  it('groups plugin catalog categories for the Skills surface', () => {
    expect(pluginCategoryLabel('component-system')).toBe('Design');
    expect(pluginCategoryLabel('backend')).toBe('Engineering');
  });
});

describe('SkillsView active skill helpers', () => {
  const now = '2026-05-22T00:00:00.000Z';

  function createProject(): Project {
    return {
      id: 'project-1',
      name: 'Project One',
      path: 'D:/Projects/sample',
      trusted: true,
      createdAt: now,
      updatedAt: now
    };
  }

  function createSkill(input: {
    id?: string;
    name?: string;
    token?: string;
    origin?: SkillDefinition['origin'];
    scope?: SkillDefinition['scope'];
    providerTargets?: ProviderId[];
    providerOrigin?: ProviderId | null;
    kind?: 'skill' | 'extension';
    enabled?: boolean;
  } = {}): SkillDefinition {
    const token = input.token ?? input.name ?? 'sample-skill';
    return {
      id: input.id ?? `skill-${token}`,
      name: input.name ?? token,
      description: 'Sample skill.',
      instructions: 'Use the sample skill.',
      origin: input.origin ?? 'custom_local',
      scope: input.scope ?? 'global',
      providerTargets: input.providerTargets ?? ['openai'],
      enabled: input.enabled ?? true,
      projectId: input.scope === 'project' ? 'project-1' : null,
      metadata: {
        slug: token,
        providerOrigin: input.providerOrigin ?? null,
        kind: input.kind ?? 'skill'
      },
      path: null,
      createdAt: now,
      updatedAt: now
    };
  }

  it('creates project-scoped drafts when a project is selected', () => {
    expect(emptyDraft(createProject())).toMatchObject({
      scope: 'project',
      providerTargets: ['ollama', 'openai_compatible'],
      enabled: true
    });
    expect(emptyDraft(null).scope).toBe('global');
  });

  it('limits visible provider target toggles to beta providers', () => {
    expect(PROVIDER_OPTIONS).toEqual(['ollama', 'openai_compatible']);
  });

  it('creates editable drafts without sharing provider target arrays', () => {
    const source = createSkill({ providerTargets: ['openai', 'gemini'] });
    const draft = createDraftFromSkill(source);

    draft.providerTargets.push('qwen');

    expect(draft).toMatchObject({
      id: source.id,
      name: source.name,
      providerTargets: ['openai', 'gemini', 'qwen']
    });
    expect(source.providerTargets).toEqual(['openai', 'gemini']);
  });

  it('validates draft completeness before save', () => {
    expect(
      canSaveSkillDraft({
        ...emptyDraft(),
        name: 'Review',
        description: 'Review code.',
        instructions: 'Review the current diff.',
        providerTargets: ['openai']
      })
    ).toBe(true);
    expect(
      canSaveSkillDraft({
        ...emptyDraft(),
        name: 'Review',
        description: '',
        instructions: 'Review the current diff.',
        providerTargets: ['openai']
      })
    ).toBe(false);
    expect(
      canSaveSkillDraft({
        ...emptyDraft(),
        name: 'Review',
        description: 'Review code.',
        instructions: 'Review the current diff.',
        providerTargets: []
      })
    ).toBe(false);
  });

  it('toggles draft provider targets without mutating the existing target array', () => {
    const currentTargets: ProviderId[] = ['openai', 'gemini'];

    expect(toggleDraftProviderTargets(currentTargets, 'gemini')).toEqual(['openai']);
    expect(toggleDraftProviderTargets(currentTargets, 'qwen')).toEqual(['openai', 'gemini', 'qwen']);
    expect(currentTargets).toEqual(['openai', 'gemini']);
  });

  it('builds skill save payloads and scope help copy from draft state', () => {
    const project = createProject();
    const draft = {
      ...emptyDraft(project),
      id: 'skill-1',
      name: 'Project Review',
      description: 'Review this project.',
      instructions: 'Inspect the project diff.',
      providerTargets: ['gemini'] as ProviderId[]
    };

    expect(buildSkillSaveInput(draft, project)).toEqual({
      id: 'skill-1',
      name: 'Project Review',
      description: 'Review this project.',
      instructions: 'Inspect the project diff.',
      scope: 'project',
      providerTargets: ['gemini'],
      enabled: true,
      projectId: 'project-1'
    });
    expect(skillDraftScopeHelp(draft, project)).toBe(
      'Only available in Project One. This is the safer default for new skills.'
    );
    expect(skillDraftScopeHelp({ ...draft, scope: 'global' }, project)).toBe(
      'Available in every project and thread on this device. Use this only for stable personal workflows.'
    );
    expect(skillDraftScopeHelp(draft, null)).toBe('Project skills require an active project.');
  });

  it('formats scope, origin, and avatar state for active skills', () => {
    expect(skillScopeLabel(createSkill({ scope: 'project' }))).toBe('Project');
    expect(skillScopeLabel(createSkill({ scope: 'global' }))).toBe('Global');
    expect(skillOriginLabel(createSkill({ origin: 'built_in_style' }))).toBe('Built-in');
    expect(skillOriginLabel(createSkill({ origin: 'custom_local' }))).toBe('Custom');
    expect(
      skillOriginLabel(
        createSkill({
          origin: 'provider_native',
          providerOrigin: 'gemini',
          kind: 'extension'
        })
      )
    ).toBe('Gemini extension');
    expect(skillAvatarClass(createSkill({ scope: 'project', enabled: false }))).toBe(
      'skills-avatar is-project is-available'
    );
    expect(skillAvatarClass(createSkill({ providerTargets: ['gemini'] }))).toBe(
      'skills-avatar is-gemini is-installed'
    );
  });

  it('sorts built-in, Codex, Gemini, and custom skills predictably', () => {
    const sorted = sortSkills([
      createSkill({ id: 'custom', name: 'Zeta', providerTargets: ['qwen'] }),
      createSkill({ id: 'gemini', name: 'Beta', providerTargets: ['gemini'] }),
      createSkill({ id: 'openai', name: 'Alpha', providerTargets: ['openai'] }),
      createSkill({ id: 'built-in', name: 'Omega', origin: 'built_in_style', providerTargets: ['qwen'] })
    ]);

    expect(sorted.map((skill) => skill.id)).toEqual(['built-in', 'openai', 'gemini', 'custom']);
  });

  it('checks attachability against enabled state, provider target, and project scope', () => {
    const projectSkill = createSkill({
      id: 'project-skill',
      scope: 'project',
      providerTargets: ['openai']
    });

    expect(isSkillAttachable(projectSkill, 'openai', 'project-1')).toBe(true);
    expect(isSkillAttachable(projectSkill, 'gemini', 'project-1')).toBe(false);
    expect(isSkillAttachable(projectSkill, 'openai', 'other-project')).toBe(false);
    expect(isSkillAttachable(projectSkill, 'openai', null)).toBe(false);
    expect(isSkillAttachable({ ...projectSkill, enabled: false }, 'openai', 'project-1')).toBe(false);
    expect(isSkillAttachable(createSkill({ scope: 'global', providerTargets: ['gemini'] }), 'gemini', null)).toBe(true);
  });

  it('matches suggested skills by token or name only when provider targets match', () => {
    const suggested = createSuggestedSkill({
      installKind: 'github_folder',
      providerTargets: ['openai', 'gemini']
    });

    expect(
      hasMatchingInstalledSkill(suggested, [
        createSkill({ name: 'Different Name', token: 'sample-skill', providerTargets: ['gemini', 'openai'] })
      ])
    ).toBe(true);
    expect(
      hasMatchingInstalledSkill(suggested, [
        createSkill({ name: 'Sample Skill', token: 'different-token', providerTargets: ['openai'] })
      ])
    ).toBe(false);
  });
});

describe('SkillsView catalog helpers', () => {
  const now = '2026-05-22T00:00:00.000Z';

  function createSkill(input: {
    id?: string;
    name?: string;
    token?: string;
    description?: string;
    instructions?: string;
    origin?: SkillDefinition['origin'];
    scope?: SkillDefinition['scope'];
    providerTargets?: ProviderId[];
    category?: SkillCategory | null;
    enabled?: boolean;
  } = {}): SkillDefinition {
    const token = input.token ?? input.name ?? 'sample-skill';
    return {
      id: input.id ?? `skill-${token}`,
      name: input.name ?? token,
      description: input.description ?? 'Sample skill.',
      instructions: input.instructions ?? 'Use the sample skill.',
      origin: input.origin ?? 'custom_local',
      scope: input.scope ?? 'global',
      providerTargets: input.providerTargets ?? ['openai'],
      enabled: input.enabled ?? true,
      projectId: input.scope === 'project' ? 'project-1' : null,
      metadata: {
        slug: token,
        category: input.category ?? null
      },
      path: null,
      createdAt: now,
      updatedAt: now
    };
  }

  it('filters active skills by searchable catalog text', () => {
    const skills = [
      createSkill({ id: 'frontend', name: 'UI Polish', category: 'frontend', providerTargets: ['openai'] }),
      createSkill({ id: 'gemini', name: 'Review Notes', providerTargets: ['gemini'] })
    ];

    expect(filterActiveSkillsForQuery(skills, 'front').map((skill) => skill.id)).toEqual(['frontend']);
    expect(filterActiveSkillsForQuery(skills, 'Gemini').map((skill) => skill.id)).toEqual(['gemini']);
    expect(filterActiveSkillsForQuery(skills, '').map((skill) => skill.id)).toEqual(['frontend', 'gemini']);
  });

  it('filters and sorts suggested skills with featured entries first', () => {
    const suggestions = [
      createSuggestedSkill({
        id: 'zeta',
        name: 'Zeta Review',
        token: 'zeta-review',
        installKind: 'github_folder',
        providerTargets: ['openai'],
        category: 'testing'
      }),
      createSuggestedSkill({
        id: 'alpha',
        name: 'Alpha Design',
        token: 'alpha-design',
        installKind: 'github_folder',
        providerTargets: ['gemini'],
        category: 'design',
        featured: true
      })
    ];

    expect(filterSuggestedSkillsForQuery(suggestions, '').map((skill) => skill.id)).toEqual(['alpha', 'zeta']);
    expect(filterSuggestedSkillsForQuery(suggestions, 'design').map((skill) => skill.id)).toEqual(['alpha']);
  });

  it('sections installed, available, and suggested skills without duplicating installed matches', () => {
    const installed = createSkill({
      id: 'installed-sample',
      name: 'Installed Sample',
      token: 'sample-skill',
      providerTargets: ['openai', 'gemini'],
      enabled: true
    });
    const available = createSkill({
      id: 'available-docs',
      name: 'Document Skill',
      token: 'document-skill',
      providerTargets: ['openai'],
      category: 'documents',
      enabled: false
    });
    const suggestions = [
      createSuggestedSkill({
        id: 'sample-skill',
        name: 'Sample Skill',
        token: 'sample-skill',
        installKind: 'github_folder',
        providerTargets: ['openai', 'gemini'],
        category: 'engineering',
        featured: true
      }),
      createSuggestedSkill({
        id: 'doc-suggestion',
        name: 'Doc Suggestion',
        token: 'doc-suggestion',
        installKind: 'github_folder',
        providerTargets: ['openai'],
        category: 'documents'
      })
    ];

    const sections = buildSkillCatalogSections([available, installed], suggestions);
    const documents = sections.categories.find((section) => section.category === 'documents');

    expect(sections.installed.map((skill) => skill.id)).toEqual(['installed-sample']);
    expect(sections.officialSuggestions).toEqual([]);
    expect(documents?.installed.map((skill) => skill.id)).toEqual(['available-docs']);
    expect(documents?.suggested.map((skill) => skill.id)).toEqual(['doc-suggestion']);
  });

  it('separates enabled built-in, project, and user skills for clearer catalog groups', () => {
    const system = createSkill({
      id: 'built-in-skill-creator',
      name: 'Skill Creator',
      token: 'skill-creator',
      origin: 'built_in_style'
    });
    const builtIn = createSkill({
      id: 'built-in-reviewer',
      name: 'Reviewer',
      token: 'reviewer',
      origin: 'built_in_style'
    });
    const project = createSkill({
      id: 'project-review',
      name: 'Project Review',
      token: 'project-review',
      scope: 'project'
    });
    const user = createSkill({
      id: 'user-review',
      name: 'User Review',
      token: 'user-review'
    });

    const sections = buildSkillCatalogSections([user, project, builtIn, system], []);

    expect(sections.installedSystem.map((skill) => skill.id)).toEqual(['built-in-skill-creator']);
    expect(sections.installedBuiltIn.map((skill) => skill.id)).toEqual(['built-in-reviewer']);
    expect(sections.installedProject.map((skill) => skill.id)).toEqual(['project-review']);
    expect(sections.installedUser.map((skill) => skill.id)).toEqual(['user-review']);
  });
});

describe('SkillsView detail helpers', () => {
  const now = '2026-05-22T00:00:00.000Z';

  function createSkill(input: {
    id?: string;
    name?: string;
    token?: string;
    origin?: SkillDefinition['origin'];
    scope?: SkillDefinition['scope'];
    providerTargets?: ProviderId[];
    providerOrigin?: ProviderId | null;
    kind?: 'skill' | 'extension';
    category?: SkillCategory | null;
    enabled?: boolean;
    projectId?: string | null;
  } = {}): SkillDefinition {
    const token = input.token ?? input.name ?? 'sample-skill';
    return {
      id: input.id ?? `skill-${token}`,
      name: input.name ?? token,
      description: 'Sample skill.',
      instructions: 'Use the sample skill.',
      origin: input.origin ?? 'custom_local',
      scope: input.scope ?? 'global',
      providerTargets: input.providerTargets ?? ['openai'],
      enabled: input.enabled ?? true,
      projectId: input.projectId ?? (input.scope === 'project' ? 'project-1' : null),
      metadata: {
        slug: token,
        providerOrigin: input.providerOrigin ?? null,
        kind: input.kind ?? 'skill',
        category: input.category ?? null
      },
      path: null,
      createdAt: now,
      updatedAt: now
    };
  }

  it('formats suggested skill detail status and avatar classes', () => {
    const providerReference = createSuggestedSkill({
      installKind: 'provider_reference',
      providerTargets: ['gemini']
    });
    const experimental = {
      ...createSuggestedSkill({
        installKind: 'github_folder',
        providerTargets: ['openai'],
        category: 'testing'
      }),
      status: 'experimental' as CuratedSkillCatalogEntry['status']
    };

    expect(suggestedSkillAvatarClass(providerReference, 'large')).toBe('skills-avatar is-gemini is-available is-large');
    expect(suggestedSkillStatusLabel(providerReference)).toBe('Curated for Vicode');
    expect(suggestedSkillStatusMessage(providerReference)).toBe(
      'This is a provider-managed resource. Vicode links to the source but does not install it into provider-owned folders.'
    );
    expect(suggestedSkillStatusMessage(experimental)).toBe(
      'This skill is source-reviewed but still experimental in Vicode. Review the notes here before installing it.'
    );
  });

  it('formats provider-native detail copy without implying Vicode owns provider folders', () => {
    const extension = createSkill({
      origin: 'provider_native',
      providerTargets: ['gemini'],
      providerOrigin: 'gemini',
      kind: 'extension'
    });
    const providerSkill = createSkill({
      origin: 'provider_native',
      providerTargets: ['openai'],
      providerOrigin: 'openai',
      kind: 'skill'
    });

    expect(providerNativeStatusMessage(extension, 'openai')).toContain('Gemini loads this extension through its own runtime.');
    expect(providerNativeStatusMessage(providerSkill, 'gemini')).toContain("Delete removes it from Vicode's catalog without changing provider-owned files.");
  });

  it('formats detail facts for active and suggested skills', () => {
    const active = createSkill({
      token: 'frontend-review',
      category: 'frontend',
      providerTargets: ['openai', 'gemini']
    });
    const suggested = createSuggestedSkill({
      installKind: 'github_folder',
      providerTargets: ['openai'],
      token: 'doc-suggestion',
      category: 'documents'
    });

    expect(detailSourceLabel(active, null)).toBe('Vicode managed');
    expect(detailSourceLabel(null, suggested)).toBe('Suggested');
    expect(detailCommandLabel(active, null)).toBe('$frontend-review');
    expect(detailCommandLabel(null, suggested)).toBe('$doc-suggestion');
    expect(detailProvidersLabel(active, null)).toBe('OpenAI, Gemini');
    expect(detailCategoryLabel(active, null)).toBe('Frontend');
    expect(detailCategoryLabel(null, suggested)).toBe('Documents');
    expect(attachModeFactLabel('runtime')).toBe('Provider runtime');
    expect(attachModeFactLabel('prompt')).toBe('Composer prompt');
  });

  it('formats unavailable attach footnotes for project and provider mismatch', () => {
    const projectSkill = createSkill({
      scope: 'project',
      projectId: 'project-1'
    });
    const providerSkill = createSkill({
      providerTargets: ['gemini']
    });

    expect(unavailableSkillFootnote(projectSkill, 'other-project', 'openai')).toBe(
      'Switch to the matching project before attaching this project skill.'
    );
    expect(unavailableSkillFootnote(providerSkill, null, 'openai')).toBe(
      'This skill is not available for the current OpenAI composer.'
    );
  });
});
