import type { ProviderId, SkillDefinition } from '../../shared/domain';
import { providerDisplayName } from '../../shared/providers';
import {
  getSkillAttachMode,
  getSkillCommandToken,
  getSkillKind,
  getSkillProviderOrigin,
  isSkillHiddenFromCatalog,
  resolveMentionedSkillIds
} from '../../shared/skills';
import { DatabaseService } from '../../storage/database';

const AUTO_SELECTED_SKILL_LIMIT = 2;
const SKILL_MATCH_STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'agent',
  'also',
  'and',
  'are',
  'asks',
  'best',
  'can',
  'code',
  'does',
  'for',
  'from',
  'help',
  'into',
  'like',
  'make',
  'need',
  'needs',
  'our',
  'please',
  'request',
  'should',
  'task',
  'that',
  'the',
  'their',
  'this',
  'use',
  'used',
  'user',
  'users',
  'want',
  'when',
  'with',
  'work'
]);

export interface ResolvedSkillContext {
  selectedSkillIds: string[];
  autoSelectedSkillIds: string[];
  mentionedSkillIds: string[];
  promptSkills: SkillDefinition[];
  runtimeSkills: SkillDefinition[];
}

export class SkillContextService {
  constructor(private readonly db: DatabaseService) {}

  resolve(input: {
    projectId: string;
    providerId: ProviderId;
    prompt: string;
    explicitSkillIds: string[];
  }): ResolvedSkillContext {
    const availableSkills = this.db
      .listSkills()
      .filter(
        (skill) =>
          skill.enabled &&
          !isSkillHiddenFromCatalog(skill) &&
          skill.providerTargets.includes(input.providerId) &&
          (skill.scope === 'global' || skill.projectId === input.projectId)
      );
    const availableById = new Map(availableSkills.map((skill) => [skill.id, skill]));
    const mentionedSkillIds = resolveMentionedSkillIds(input.prompt, availableSkills);
    const explicitSelectedSkillIds = [...new Set(input.explicitSkillIds)].filter((skillId) => availableById.has(skillId));
    const alreadySelectedIds = new Set([...explicitSelectedSkillIds, ...mentionedSkillIds]);
    const autoSelectedSkillIds = this.resolveAutoSelectedSkillIds(input.prompt, availableSkills, alreadySelectedIds);
    const selectedSkillIds = [...new Set([...explicitSelectedSkillIds, ...mentionedSkillIds, ...autoSelectedSkillIds])];
    const selectedSkills = selectedSkillIds
      .map((skillId) => availableById.get(skillId) ?? null)
      .filter((skill): skill is SkillDefinition => skill !== null);

    return {
      selectedSkillIds,
      autoSelectedSkillIds,
      mentionedSkillIds,
      promptSkills: selectedSkills.filter((skill) => getSkillAttachMode(skill) === 'prompt'),
      runtimeSkills: selectedSkills.filter((skill) => getSkillAttachMode(skill) === 'runtime')
    };
  }

  formatPromptSkillSection(skills: SkillDefinition[]) {
    return `Attached skills:
These instructions are already attached to this run. Do not call provider CLIs, shell commands, or activation commands to enable them.
${skills
      .map((skill) => `## ${skill.name} ($${getSkillCommandToken(skill)})\n${skill.instructions.trim()}`)
      .join('\n\n')}`;
  }

  formatRuntimeSkillSection(providerId: ProviderId, skills: SkillDefinition[]) {
    const runtimeLabel = providerDisplayName(providerId);
    return `${runtimeLabel} provider-native helpers requested:\n${skills
      .map(
        (skill) =>
          `- ${skill.name} ($${getSkillCommandToken(skill)}) (${getSkillKind(skill)}): ${skill.description.trim()}`
      )
      .join('\n')}\nUse these installed provider-native helpers if they are available in the current ${runtimeLabel} runtime.`;
  }

  resolveRuntimeSkillResources(skills: SkillDefinition[], providerId: ProviderId) {
    return skills
      .filter(
        (skill) =>
          getSkillProviderOrigin(skill) === providerId && typeof skill.path === 'string' && skill.path.trim().length > 0
      )
      .map((skill) => ({
        kind: getSkillKind(skill),
        path: skill.path as string
      }));
  }

  private resolveAutoSelectedSkillIds(
    prompt: string,
    availableSkills: SkillDefinition[],
    alreadySelectedIds: Set<string>
  ) {
    const promptProfile = createTextProfile(prompt);
    if (promptProfile.tokens.size === 0) {
      return [];
    }

    return availableSkills
      .filter((skill) => !alreadySelectedIds.has(skill.id))
      .map((skill) => ({
        skill,
        match: scoreSkillMatch(promptProfile, skill)
      }))
      .filter(({ match }) => isStrongSkillMatch(match))
      .sort((left, right) => {
        if (right.match.score !== left.match.score) {
          return right.match.score - left.match.score;
        }
        return left.skill.name.localeCompare(right.skill.name);
      })
      .slice(0, AUTO_SELECTED_SKILL_LIMIT)
      .map(({ skill }) => skill.id);
  }
}

function normalizeToken(value: string) {
  let token = value.toLowerCase();
  for (const suffix of ['ingly', 'edly', 'ing', 'ers', 'er', 'ed', 'es', 's']) {
    if (token.length > suffix.length + 3 && token.endsWith(suffix)) {
      token = token.slice(0, -suffix.length);
      break;
    }
  }
  return token;
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .match(/[a-z0-9]+/g)?.map(normalizeToken)
    .filter((token) => token.length >= 3 && !SKILL_MATCH_STOP_WORDS.has(token)) ?? [];
}

function createTextProfile(value: string) {
  return {
    normalized: ` ${tokenize(value).join(' ')} `,
    tokens: new Set(tokenize(value))
  };
}

function countMatches(promptTokens: Set<string>, values: string[]) {
  return [...new Set(values)].filter((value) => promptTokens.has(value)).length;
}

function scoreSkillMatch(
  promptProfile: ReturnType<typeof createTextProfile>,
  skill: SkillDefinition
) {
  const slug = getSkillCommandToken(skill);
  const nameTokens = tokenize(skill.name);
  const slugTokens = tokenize(slug);
  const descriptionTokens = tokenize(skill.description);
  const category = typeof skill.metadata?.category === 'string' ? skill.metadata.category : '';
  const categoryTokens = tokenize(category);
  const nameMatches = countMatches(promptProfile.tokens, [...nameTokens, ...slugTokens]);
  const descriptionMatches = countMatches(promptProfile.tokens, descriptionTokens);
  const categoryMatches = countMatches(promptProfile.tokens, categoryTokens);
  let score = nameMatches * 3 + descriptionMatches + categoryMatches;

  const skillPhrases = [skill.name, slug]
    .map((value) => tokenize(value).join(' '))
    .filter(Boolean);
  if (skillPhrases.some((phrase) => promptProfile.normalized.includes(` ${phrase} `))) {
    score += 5;
  }

  return {
    score,
    nameMatches,
    descriptionMatches,
    categoryMatches
  };
}

function isStrongSkillMatch(match: ReturnType<typeof scoreSkillMatch>) {
  if (match.score >= 7) {
    return true;
  }

  if (match.nameMatches > 0 && match.score >= 4) {
    return true;
  }

  return match.descriptionMatches >= 3 && match.score >= 3;
}
