import { describe, expect, it } from 'vitest';
import { builtInSkillSeeds } from './builtInSkills';
import { SURFACED_PROVIDER_IDS } from './providers';

describe('built-in skill seeds', () => {
  it('defines unique built-in skill ids and names', () => {
    expect(new Set(builtInSkillSeeds.map((skill) => skill.id)).size).toBe(builtInSkillSeeds.length);
    expect(new Set(builtInSkillSeeds.map((skill) => skill.name)).size).toBe(builtInSkillSeeds.length);
  });

  it('uses routing-friendly descriptions and example prompts', () => {
    for (const skill of builtInSkillSeeds) {
      expect(skill.description).toContain(' when ');
      expect(skill.description.trim().endsWith('.')).toBe(true);
      expect(skill.metadata?.examplePrompt).toBeTruthy();
    }
  });

  it('targets the surfaced beta providers by default', () => {
    for (const skill of builtInSkillSeeds) {
      expect(skill.providerTargets).toEqual([...SURFACED_PROVIDER_IDS]);
    }
  });

  it('keeps Vicode-specific guardrails on higher-risk built-ins', () => {
    const byId = new Map(builtInSkillSeeds.map((skill) => [skill.id, skill]));

    expect(byId.get('built-in-reviewer')?.instructions).toContain('Lead with the highest-signal findings');
    expect(byId.get('built-in-llm-wiki')?.instructions).toContain('Treat Project Knowledge as Vicode-owned guidance');
    expect(byId.get('built-in-llm-wiki')?.instructions).toContain('frontmatter titles');
    expect(byId.get('built-in-llm-wiki')?.instructions).toContain('Do not mutate');
  });

  it('does not ship experimental presets that overlap native slash commands', () => {
    expect(builtInSkillSeeds.map((skill) => skill.id)).not.toEqual(
      expect.arrayContaining([
        'built-in-planner',
        'built-in-pdf-toolkit',
        'built-in-spreadsheet-analyst',
        'built-in-doc-writer',
        'built-in-slide-writer'
      ])
    );
  });
});
