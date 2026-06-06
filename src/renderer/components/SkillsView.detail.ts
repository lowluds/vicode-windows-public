import type { ProviderId, SkillDefinition, SkillDetail } from '../../shared/domain';
import {
  getSkillCommandToken,
  getSkillKind
} from '../../shared/skills';
import {
  providerLabel,
  resolveSkillCategoryLabel,
  skillCategoryLabel
} from './SkillsView.labels';
import { skillScopeLabel } from './SkillsView.activeSkills';
import {
  canInstallSuggestedSkill,
  type SuggestedSkill
} from './SkillsView.suggested';

export function suggestedSkillAvatarClass(skill: Pick<SuggestedSkill, 'providerTargets'>, size: 'default' | 'large' = 'default') {
  const providerClass =
    skill.providerTargets.length > 1
      ? 'is-vicode'
      : skill.providerTargets[0] === 'openai'
        ? 'is-openai'
        : skill.providerTargets[0] === 'gemini'
          ? 'is-gemini'
          : 'is-vicode';
  return `skills-avatar ${providerClass} is-available${size === 'large' ? ' is-large' : ''}`;
}

export function suggestedSkillStatusLabel(skill: Pick<SuggestedSkill, 'status'>) {
  return skill.status === 'keep' ? 'Curated for Vicode' : 'Experimental in Vicode';
}

export function providerNativeStatusMessage(skill: SkillDefinition, fallbackProviderId: ProviderId) {
  const provider = providerLabel(skill.providerTargets[0] ?? fallbackProviderId);
  if (getSkillKind(skill) === 'extension') {
    return `${provider} loads this extension through its own runtime. Vicode detected it in the provider folder and can use it while it stays enabled here.`;
  }
  return `${provider} manages this skill on disk. Delete removes it from Vicode's catalog without changing provider-owned files.`;
}

export function suggestedSkillStatusMessage(skill: SuggestedSkill) {
  if (!canInstallSuggestedSkill(skill)) {
    return 'This is a provider-managed resource. Vicode links to the source but does not install it into provider-owned folders.';
  }

  if (skill.status === 'experimental') {
    return 'This skill is source-reviewed but still experimental in Vicode. Review the notes here before installing it.';
  }

  return 'Review what this skill does here first. Use Browse only if you want to inspect the source repository directly.';
}

export function detailSourceLabel(skill: SkillDefinition | null, suggestedSkill: SuggestedSkill | null) {
  if (suggestedSkill) {
    return 'Suggested';
  }
  if (skill?.origin === 'provider_native') {
    return 'Provider native';
  }
  if (skill?.origin === 'custom_local') {
    return 'Vicode managed';
  }
  return 'Built-in';
}

export function detailCommandLabel(skill: SkillDefinition | null, suggestedSkill: SuggestedSkill | null) {
  return `$${skill ? getSkillCommandToken(skill) : suggestedSkill?.token ?? ''}`;
}

export function detailProvidersLabel(skill: SkillDefinition | null, suggestedSkill: SuggestedSkill | null) {
  return (skill?.providerTargets ?? suggestedSkill?.providerTargets ?? [])
    .map((providerId) => providerLabel(providerId))
    .join(', ');
}

export function detailScopeLabel(skill: SkillDefinition | null) {
  return skill ? skillScopeLabel(skill) : 'Available';
}

export function detailCategoryLabel(skill: SkillDefinition | null, suggestedSkill: SuggestedSkill | null) {
  if (skill) {
    return resolveSkillCategoryLabel(skill);
  }
  return suggestedSkill ? skillCategoryLabel(suggestedSkill.category) : 'Engineering';
}

export function attachModeFactLabel(attachMode: SkillDetail['attachMode'] | null | undefined) {
  return attachMode === 'runtime' ? 'Provider runtime' : 'Composer prompt';
}

export function instructionModeLabel(attachMode: SkillDetail['attachMode'] | null | undefined) {
  return attachMode === 'runtime' ? 'Runtime skill' : 'Prompt skill';
}

export function composerAttachButtonLabel(attached: boolean, attachMode: SkillDetail['attachMode'] | null | undefined) {
  if (attached) {
    return 'Attached';
  }
  return attachMode === 'runtime' ? 'Try in composer' : 'Attach to composer';
}

export function unavailableSkillFootnote(
  skill: SkillDefinition,
  selectedProjectId: string | null,
  composerProviderId: ProviderId
) {
  if (skill.scope === 'project' && skill.projectId !== selectedProjectId) {
    return 'Switch to the matching project before attaching this project skill.';
  }
  return `This skill is not available for the current ${providerLabel(composerProviderId)} composer.`;
}
