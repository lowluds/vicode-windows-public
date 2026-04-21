import type { ProviderId, SkillDefinition } from '../../shared/domain';
import { providerDisplayName } from '../../shared/providers';
import {
  getSkillAttachMode,
  getSkillCommandToken,
  getSkillKind,
  getSkillProviderOrigin,
  resolveMentionedSkillIds
} from '../../shared/skills';
import { DatabaseService } from '../../storage/database';

export interface ResolvedSkillContext {
  selectedSkillIds: string[];
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
          skill.providerTargets.includes(input.providerId) &&
          (skill.scope === 'global' || skill.projectId === input.projectId)
      );
    const availableById = new Map(availableSkills.map((skill) => [skill.id, skill]));
    const mentionedSkillIds = resolveMentionedSkillIds(input.prompt, availableSkills);
    const selectedSkillIds = [...new Set([...input.explicitSkillIds, ...mentionedSkillIds])].filter((skillId) =>
      availableById.has(skillId)
    );
    const selectedSkills = selectedSkillIds
      .map((skillId) => availableById.get(skillId) ?? null)
      .filter((skill): skill is SkillDefinition => skill !== null);

    return {
      selectedSkillIds,
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
}
