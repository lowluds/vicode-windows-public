import type { ProviderId, SkillCategory } from '../../shared/domain';
import type { CuratedSkillCatalogEntry } from '../../shared/curatedCatalog';
import { curatedSkillCatalog } from '../../shared/curatedCatalog';
import {
  isSurfacedProviderId,
  providerDisplayName,
  SURFACED_PROVIDER_IDS
} from '../../shared/providers';
import {
  AutomationIcon,
  BrushIcon,
  CopyIcon,
  CpuIcon,
  DocumentIcon,
  GlobeIcon,
  MonitorIcon,
  PlayIcon,
  ShieldIcon,
  SkillsIcon
} from './icons';

export type SuggestedSkill = {
  id: string;
  name: string;
  publisher?: string;
  official?: boolean;
  description: string;
  installKind: 'provider_reference' | 'github_folder';
  providerId?: ProviderId;
  providerTargets: ProviderId[];
  browseUrl: string;
  owner?: string;
  repo?: string;
  path?: string;
  token: string;
  category: SkillCategory;
  icon: typeof SkillsIcon;
  status: CuratedSkillCatalogEntry['status'];
  verification: CuratedSkillCatalogEntry['verification'];
  notes: string[];
  starterPack?: boolean;
  featured?: boolean;
};

function resolveSuggestedSkillIcon(skill: Pick<SuggestedSkill, 'category'>) {
  switch (skill.category) {
    case 'frontend':
      return MonitorIcon;
    case 'backend':
      return CpuIcon;
    case 'engineering':
      return SkillsIcon;
    case 'documents':
      return DocumentIcon;
    case 'design':
      return BrushIcon;
    case 'testing':
      return PlayIcon;
    case 'automation':
      return AutomationIcon;
    case 'mcp':
      return GlobeIcon;
    case 'templates':
      return CopyIcon;
    case 'provider':
      return ShieldIcon;
    default:
      return SkillsIcon;
  }
}

function createSuggestedSkill(seed: CuratedSkillCatalogEntry): SuggestedSkill {
  return {
    ...seed,
    providerTargets: seed.installKind === 'github_folder' ? [...SURFACED_PROVIDER_IDS] : seed.providerTargets,
    icon: resolveSuggestedSkillIcon(seed),
    featured: seed.featured,
    official: seed.official
  };
}

export const SUGGESTED_SKILLS: SuggestedSkill[] = [
  ...curatedSkillCatalog.map(createSuggestedSkill)
].filter((skill) => canInstallSuggestedSkill(skill) || skill.providerTargets.some(isSurfacedProviderId));

export function canInstallSuggestedSkill(skill: SuggestedSkill) {
  return skill.installKind === 'github_folder';
}

export function suggestedSkillAvailabilityLabel(skill: SuggestedSkill) {
  return canInstallSuggestedSkill(skill) ? 'Importable skill' : 'Provider-managed reference';
}

function compatibilityLabel(providerTargets: ProviderId[]) {
  if (providerTargets.length > 1) {
    return providerTargets.map((providerId) => providerDisplayName(providerId)).join(' + ');
  }
  return providerTargets[0] ? providerDisplayName(providerTargets[0]) : 'Provider';
}

export function buildSuggestedSkillDocument(skill: SuggestedSkill) {
  const installText =
    canInstallSuggestedSkill(skill)
      ? 'Import this skill into Vicode to attach it in the composer and use its instructions during runs.'
      : 'Browse this provider-managed resource here, then install or manage it in the provider app.';
  const statusLabel = skill.status === 'keep' ? 'Curated for Vicode' : 'Experimental in Vicode';
  const notes = skill.notes.map((note) => `- ${note}`).join('\n');

  return `# ${skill.name}

${skill.description}

## Publisher
${skill.publisher ?? 'External'}

## Compatibility
${compatibilityLabel(skill.providerTargets)}

## Vicode Status
${statusLabel}

## Verification
${skill.verification}

## Install
${installText}

## Token
\`${skill.token}\`

## Notes
${notes}
`;
}
