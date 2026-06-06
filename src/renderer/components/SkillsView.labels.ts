import type { ProviderId, SkillCategory, SkillDefinition } from '../../shared/domain';
import type { CuratedMcpCatalogCategory } from '../../shared/curatedCatalog';
import { providerDisplayName, SURFACED_PROVIDER_IDS } from '../../shared/providers';
import {
  getSkillCategory,
  getSkillCommandToken,
  getSkillKind
} from '../../shared/skills';

export const PROVIDER_OPTIONS: ProviderId[] = [...SURFACED_PROVIDER_IDS];

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  engineering: 'Engineering',
  documents: 'Documents',
  design: 'Design',
  testing: 'Testing',
  automation: 'Automation',
  mcp: 'MCP & Plugins',
  templates: 'Templates',
  provider: 'Provider Runtime'
};

const BUILT_IN_SKILL_CATEGORIES: Partial<Record<string, SkillCategory>> = {
  'doc-writer': 'documents',
  'pdf-toolkit': 'documents',
  'slide-writer': 'documents',
  'spreadsheet-analyst': 'documents',
  'cloudflare-deploy': 'automation',
  'openai-docs': 'engineering',
  'playwright-interactive': 'testing',
  'premium-frontend-build': 'frontend',
  'premium-reference-frontend': 'design',
  'reference-to-system': 'design',
  'ui-polish-pass': 'design',
  'vercel-deploy': 'automation',
  'web-ship-review': 'testing',
  imagegen: 'design',
  screenshot: 'testing',
  sora: 'design',
  'skill-creator': 'templates'
};

export function providerLabel(providerId: ProviderId) {
  return providerDisplayName(providerId);
}

export function skillCategoryLabel(category: SkillCategory) {
  return CATEGORY_LABELS[category];
}

export function compatibilityLabel(providerTargets: ProviderId[]) {
  if (providerTargets.length > 1) {
    return providerTargets.map((providerId) => providerLabel(providerId)).join(' + ');
  }
  return providerTargets[0] ? providerLabel(providerTargets[0]) : 'Provider';
}

export function pluginCategoryLabel(category: CuratedMcpCatalogCategory) {
  switch (category) {
    case 'ui':
      return 'Coding';
    case 'design':
    case 'component-system':
      return 'Design';
    case 'deploy':
    case 'backend':
      return 'Engineering';
    case 'collaboration':
      return 'Collaboration';
    default:
      return 'Plugins';
  }
}

export function isSystemSkill(skill: SkillDefinition) {
  const token = getSkillCommandToken(skill);
  return token === 'skill-creator' || token === 'plugin-creator' || token === 'skill-installer';
}

export function resolveSkillCategoryLabel(skill: SkillDefinition) {
  const explicitCategory = getSkillCategory(skill);
  if (explicitCategory) {
    return skillCategoryLabel(explicitCategory);
  }

  const tokenCategory = BUILT_IN_SKILL_CATEGORIES[getSkillCommandToken(skill)];
  if (tokenCategory) {
    return skillCategoryLabel(tokenCategory);
  }

  if (getSkillKind(skill) === 'extension') {
    return skillCategoryLabel('provider');
  }

  return skillCategoryLabel('engineering');
}
