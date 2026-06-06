import type { SkillCategory, SkillDefinition } from '../../shared/domain';
import { officialSkillPack } from '../../shared/curatedCatalog';
import { getSkillCommandToken } from '../../shared/skills';
import {
  compatibilityLabel,
  isSystemSkill,
  resolveSkillCategoryLabel,
  skillCategoryLabel
} from './SkillsView.labels';
import {
  hasMatchingInstalledSkill,
  skillOriginLabel,
  sortSkills
} from './SkillsView.activeSkills';
import type { SuggestedSkill } from './SkillsView.suggested';

export type SkillCatalogSection = {
  category: SkillCategory;
  title: string;
  installed: SkillDefinition[];
  suggested: SuggestedSkill[];
};

export type SkillCatalogSections = {
  installed: SkillDefinition[];
  installedSystem: SkillDefinition[];
  installedBuiltIn: SkillDefinition[];
  installedProject: SkillDefinition[];
  installedUser: SkillDefinition[];
  officialSuggestions: SuggestedSkill[];
  categories: SkillCatalogSection[];
};

const CATEGORY_ORDER: SkillCategory[] = [
  'frontend',
  'backend',
  'engineering',
  'documents',
  'design',
  'testing',
  'automation',
  'mcp',
  'templates',
  'provider'
];

function sortSuggestedSkills(items: readonly SuggestedSkill[]) {
  return [...items].sort((left, right) => {
    const featuredDelta = Number(Boolean(right.featured)) - Number(Boolean(left.featured));
    if (featuredDelta !== 0) {
      return featuredDelta;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}

export function filterActiveSkillsForQuery(skills: readonly SkillDefinition[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...skills];
  }

  return skills.filter((skill) =>
    [
      skill.name,
      skill.description,
      skill.instructions,
      getSkillCommandToken(skill),
      skillOriginLabel(skill),
      resolveSkillCategoryLabel(skill),
      compatibilityLabel(skill.providerTargets)
    ].some((value) => value.toLowerCase().includes(needle))
  );
}

export function filterSuggestedSkillsForQuery(skills: readonly SuggestedSkill[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return sortSuggestedSkills(skills);
  }

  return sortSuggestedSkills(
    skills.filter((skill) =>
      `${skill.name} ${skill.description} ${skill.token} ${skill.publisher ?? ''} ${skillCategoryLabel(skill.category)} ${compatibilityLabel(skill.providerTargets)}`
        .toLowerCase()
        .includes(needle)
    )
  );
}

export function buildSkillCatalogSections(
  filteredSkills: readonly SkillDefinition[],
  filteredSuggestedSkills: readonly SuggestedSkill[]
): SkillCatalogSections {
  const installed = sortSkills(filteredSkills.filter((skill) => skill.enabled));
  const installedSystem = installed.filter(isSystemSkill);
  const installedBuiltIn = installed.filter(
    (skill) => !isSystemSkill(skill) && skill.origin === 'built_in_style'
  );
  const installedProject = installed.filter(
    (skill) => !isSystemSkill(skill) && skill.origin !== 'built_in_style' && skill.scope === 'project'
  );
  const installedUser = installed.filter(
    (skill) => !isSystemSkill(skill) && skill.origin !== 'built_in_style' && skill.scope !== 'project'
  );
  const available = filteredSkills.filter((skill) => !skill.enabled);
  const officialSuggestions = filteredSuggestedSkills.filter(
    (skill) =>
      officialSkillPack.some((entry) => entry.id === skill.id && entry.starterPack) &&
      !hasMatchingInstalledSkill(skill, installed)
  );
  const officialSuggestionIds = new Set(officialSuggestions.map((skill) => skill.id));
  const categories = CATEGORY_ORDER.map((category) => ({
    category,
    title: skillCategoryLabel(category),
    installed: sortSkills(
      available.filter((skill) => resolveSkillCategoryLabel(skill) === skillCategoryLabel(category))
    ),
    suggested: filteredSuggestedSkills.filter(
      (skill) =>
        skill.category === category &&
        !officialSuggestionIds.has(skill.id) &&
        !hasMatchingInstalledSkill(skill, installed)
    )
  }));

  return {
    installed,
    installedSystem,
    installedBuiltIn,
    installedProject,
    installedUser,
    officialSuggestions,
    categories
  };
}
