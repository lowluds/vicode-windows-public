import type { Project, ProviderId, SkillDefinition, SkillSaveInput } from '../../shared/domain';
import { SURFACED_PROVIDER_IDS } from '../../shared/providers';
import {
  getSkillCommandToken,
  getSkillKind,
  getSkillProviderOrigin
} from '../../shared/skills';
import { providerLabel } from './SkillsView.labels';
import type { SuggestedSkill } from './SkillsView.suggested';

export type SkillDraft = {
  id?: string;
  name: string;
  description: string;
  instructions: string;
  scope: 'global' | 'project';
  providerTargets: ProviderId[];
  enabled: boolean;
};

export function emptyDraft(selectedProject: Project | null = null): SkillDraft {
  return {
    name: '',
    description: '',
    instructions: '',
    scope: selectedProject ? 'project' : 'global',
    providerTargets: [...SURFACED_PROVIDER_IDS],
    enabled: true
  };
}

export function createDraftFromSkill(skill: SkillDefinition): SkillDraft {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    scope: skill.scope,
    providerTargets: [...skill.providerTargets],
    enabled: skill.enabled
  };
}

export function canSaveSkillDraft(draft: SkillDraft) {
  return Boolean(
    draft.name.trim() &&
      draft.description.trim() &&
      draft.instructions.trim() &&
      draft.providerTargets.length > 0
  );
}

export function toggleDraftProviderTargets(providerTargets: readonly ProviderId[], providerId: ProviderId) {
  return providerTargets.includes(providerId)
    ? providerTargets.filter((target) => target !== providerId)
    : [...providerTargets, providerId];
}

export function buildSkillSaveInput(draft: SkillDraft, selectedProject: Project | null): SkillSaveInput {
  return {
    id: draft.id,
    name: draft.name,
    description: draft.description,
    instructions: draft.instructions,
    scope: draft.scope,
    providerTargets: draft.providerTargets,
    enabled: draft.enabled,
    projectId: draft.scope === 'project' ? selectedProject?.id ?? null : null
  };
}

export function skillDraftScopeHelp(draft: SkillDraft, selectedProject: Project | null) {
  if (draft.scope === 'project') {
    return selectedProject
      ? `Only available in ${selectedProject.name}. This is the safer default for new skills.`
      : 'Project skills require an active project.';
  }
  return 'Available in every project and thread on this device. Use this only for stable personal workflows.';
}

export function skillScopeLabel(skill: SkillDefinition) {
  return skill.scope === 'project' ? 'Project' : 'Global';
}

export function skillOriginLabel(skill: SkillDefinition) {
  if (skill.origin === 'built_in_style') {
    return 'Built-in';
  }

  if (skill.origin === 'custom_local') {
    return 'Custom';
  }

  const providerOrigin = getSkillProviderOrigin(skill);
  return `${providerOrigin ? providerLabel(providerOrigin) : 'Provider'} ${getSkillKind(skill) === 'extension' ? 'extension' : 'skill'}`;
}

export function skillAvatarClass(skill: SkillDefinition) {
  let providerClass = 'is-vicode';
  const providerOrigin = getSkillProviderOrigin(skill);

  if (skill.scope === 'project') {
    providerClass = 'is-project';
  } else if (providerOrigin === 'openai' || (skill.providerTargets.length === 1 && skill.providerTargets[0] === 'openai')) {
    providerClass = 'is-openai';
  } else if (providerOrigin === 'gemini' || (skill.providerTargets.length === 1 && skill.providerTargets[0] === 'gemini')) {
    providerClass = 'is-gemini';
  } else if (providerOrigin === 'qwen' || (skill.providerTargets.length === 1 && skill.providerTargets[0] === 'qwen')) {
    providerClass = 'is-vicode';
  } else if (skill.origin === 'custom_local') {
    providerClass = 'is-custom';
  } else if (skill.origin === 'built_in_style') {
    providerClass = 'is-built-in';
  }

  return `skills-avatar ${providerClass} ${skill.enabled ? 'is-installed' : 'is-available'}`;
}

export function sortSkills(items: SkillDefinition[]) {
  const providerRank = (skill: SkillDefinition) => {
    if (skill.origin === 'built_in_style') {
      return 0;
    }
    const providerOrigin = getSkillProviderOrigin(skill);
    if (providerOrigin === 'openai') {
      return 1;
    }
    if (providerOrigin === 'gemini') {
      return 2;
    }
    if (skill.providerTargets.length === 1 && skill.providerTargets[0] === 'openai') {
      return 1;
    }
    if (skill.providerTargets.length === 1 && skill.providerTargets[0] === 'gemini') {
      return 2;
    }
    return 3;
  };

  return [...items].sort((left, right) => {
    const providerDelta = providerRank(left) - providerRank(right);
    if (providerDelta !== 0) {
      return providerDelta;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}

export function isSkillAttachable(
  skill: SkillDefinition,
  composerProviderId: ProviderId,
  selectedProjectId: string | null
) {
  return Boolean(
    skill.enabled &&
      skill.providerTargets.includes(composerProviderId) &&
      (skill.scope === 'global' || skill.projectId === selectedProjectId)
  );
}

export function hasMatchingInstalledSkill(skill: SuggestedSkill, installedSkills: SkillDefinition[]) {
  const expectedTargets = [...skill.providerTargets].sort();
  return installedSkills.some((item) => {
    const token = getSkillCommandToken(item);
    const sameTargets =
      [...item.providerTargets].sort().join('|') === expectedTargets.join('|');
    return sameTargets && (token === skill.token || item.name.localeCompare(skill.name, undefined, { sensitivity: 'base' }) === 0);
  });
}
