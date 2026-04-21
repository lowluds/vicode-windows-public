import { describe, expect, it } from 'vitest';
import type { SkillDefinition } from './domain';
import { buildSkillDocument, findPromptSkillMentions, resolveMentionedSkillIds, splitPromptMentionedSkills } from './skills';

function createSkill(id: string, name: string): SkillDefinition {
  return {
    id,
    name,
    description: `${name} description`,
    instructions: `${name} instructions`,
    origin: 'custom_local',
    scope: 'global',
    providerTargets: ['openai', 'gemini'],
    enabled: true,
    projectId: null,
    metadata: {},
    path: null,
    createdAt: '2026-03-14T00:00:00.000Z',
    updatedAt: '2026-03-14T00:00:00.000Z'
  };
}

describe('shared skills helpers', () => {
  it('resolves $skill-name mentions against the canonical slug', () => {
    const skills = [createSkill('skill-1', 'Premium Frontend Build'), createSkill('skill-2', 'Reviewer')];

    expect(resolveMentionedSkillIds('Use $premium-frontend-build and $reviewer for this.', skills)).toEqual([
      'skill-1',
      'skill-2'
    ]);
  });

  it('keeps recognizing a selected skill token when the next text lands immediately after it', () => {
    const skills = [createSkill('skill-1', 'Composer Overlay Skill 123')];

    expect(findPromptSkillMentions('$composer-overlay-skill-123for animations', skills)).toEqual([
      {
        start: 0,
        end: '$composer-overlay-skill-123'.length,
        token: '$composer-overlay-skill-123',
        skill: skills[0]
      }
    ]);
    expect(resolveMentionedSkillIds('$composer-overlay-skill-123for animations', skills)).toEqual(['skill-1']);
  });

  it('builds a provider-friendly skill document', () => {
    expect(buildSkillDocument(createSkill('skill-1', 'Reviewer'))).toContain('## Instructions');
  });

  it('splits mentioned skills from the prose prompt while preserving tokens and ids', () => {
    const skills = [createSkill('skill-1', 'Web Artifacts Builder'), createSkill('skill-2', 'Reviewer')];

    expect(
      splitPromptMentionedSkills('Long prompt body.\n\n$web-artifacts-builder\n$reviewer', skills)
    ).toEqual({
      promptWithoutMentions: 'Long prompt body.',
      mentionedSkillIds: ['skill-1', 'skill-2'],
      mentionedTokens: ['$web-artifacts-builder', '$reviewer']
    });
  });
});
