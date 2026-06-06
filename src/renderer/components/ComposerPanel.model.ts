import {
  COMPOSER_TEXT_ATTACHMENT_PROMOTION_CHARS,
  MAX_COMPOSER_PROMPT_CHARS,
  type ProviderDescriptor,
  type ProviderId,
  type SkillDefinition
} from '../../shared/domain';
import type { NativeComposerCommand } from '../../shared/nativeCommands';
import {
  providerDisplayName,
  isRetiredProviderId,
  providerModelTriggerSummary,
  providerSetupGuidance,
  providerSetupMenuSummary,
  providerUsesHostedApi
} from '../../shared/providers';
import { getSkillCommandToken, getSkillProviderOrigin } from '../../shared/skills';
import { resolvePreferredProviderModel } from '../lib/provider-defaults';

export function providerModelMessage(provider: ProviderDescriptor) {
  return providerSetupGuidance(provider);
}

export function providerInstallActionLabel(provider: ProviderDescriptor) {
  if (isRetiredProviderId(provider.id)) {
    return 'Unavailable';
  }
  if (!provider.installed && !providerUsesHostedApi(provider)) {
    return `Set up ${providerDisplayName(provider.id)} in Settings`;
  }
  return 'Open Settings > Providers';
}

export function providerMenuSummary(
  providers: ProviderDescriptor[],
  provider: ProviderDescriptor,
  selectedProviderId: ProviderId,
  activeModelLabel: string | null
) {
  if (selectedProviderId === provider.id) {
    return providerModelTriggerSummary(provider, activeModelLabel);
  }

  const setupSummary = providerSetupMenuSummary(provider);
  if (setupSummary) {
    return setupSummary;
  }

  return resolvePreferredProviderModel(providers, provider.id)?.label ?? 'Refresh models';
}

export function modelBadgeClassName(recommendation: string | null) {
  if (recommendation === 'Default') {
    return 'border-[color:var(--ui-brand-border)] bg-[color:var(--ui-brand-soft)] text-[color:var(--ui-brand-text)]';
  }
  if (recommendation === 'Quick') {
    return 'border-[color:var(--ui-border-soft)] bg-[color:var(--ui-surface-3)] text-[color:var(--ui-text)]';
  }
  if (recommendation === 'Preview') {
    return 'border-[color:var(--ui-warning-border)] bg-[color:var(--ui-warning-soft)] text-[color:var(--ui-warning-text)]';
  }
  return 'border-[color:var(--ui-border-soft)] bg-[color:var(--ui-alpha-04)] text-[color:var(--ui-text-muted)]';
}

export function compareComposerSkills(left: SkillDefinition, right: SkillDefinition) {
  const leftOrigin = getSkillProviderOrigin(left);
  const rightOrigin = getSkillProviderOrigin(right);
  const leftRank = leftOrigin ? 1 : 0;
  const rightRank = rightOrigin ? 1 : 0;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  if (left.scope !== right.scope) {
    return left.scope === 'project' ? -1 : 1;
  }

  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

export function getAttachedComposerSkills(attachedSkillIds: readonly string[], installedSkills: readonly SkillDefinition[]) {
  return attachedSkillIds
    .map((skillId) => installedSkills.find((skill) => skill.id === skillId) ?? null)
    .filter((skill): skill is SkillDefinition => Boolean(skill));
}

export function getMentionSkillSuggestions(providerCompatibleSkills: readonly SkillDefinition[], query: string) {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) {
    return [...providerCompatibleSkills];
  }

  return providerCompatibleSkills.filter((skill) => {
    const token = getSkillCommandToken(skill).toLowerCase();
    const haystack = `${skill.name} ${skill.description}`.toLowerCase();
    return token.includes(trimmedQuery) || haystack.includes(trimmedQuery);
  });
}

export function shouldClearPromptOptimistically(
  pendingNativeCommandId: NativeComposerCommand['id'] | null,
  submittedPrompt: string
) {
  return pendingNativeCommandId === null && !submittedPrompt.trimStart().startsWith('/');
}

export function shouldPromotePastedTextToAttachment(
  pastedText: string,
  currentPromptLength: number,
  canCreateTextAttachments: boolean
) {
  if (!pastedText || !canCreateTextAttachments) {
    return false;
  }

  const nextPromptLength = currentPromptLength + pastedText.length;
  return (
    pastedText.length >= COMPOSER_TEXT_ATTACHMENT_PROMOTION_CHARS ||
    nextPromptLength >= MAX_COMPOSER_PROMPT_CHARS
  );
}

export function suggestedPastedTextAttachmentName(pastedText: string) {
  const firstLine = pastedText.split(/\r?\n/u, 1)[0]?.trim() ?? '';
  return firstLine ? `${firstLine.slice(0, 48)}.txt` : 'pasted-context.txt';
}
