import { describe, expect, it } from 'vitest';
import { builtInSkillSeeds } from './builtInSkills';

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

  it('keeps Vicode-specific guardrails on higher-risk built-ins', () => {
    const byId = new Map(builtInSkillSeeds.map((skill) => [skill.id, skill]));

    expect(byId.get('built-in-planner')?.instructions).toContain('do not replace or fake the provider-native planner state machine');
    expect(byId.get('built-in-pdf-toolkit')?.instructions).toContain('Do not imply that a file was inspected');
    expect(byId.get('built-in-spreadsheet-analyst')?.instructions).toContain('Do not invent columns, formulas, or certainty');
    expect(byId.get('built-in-doc-writer')?.instructions).toContain('preserve the source intent');
    expect(byId.get('built-in-slide-writer')?.instructions).toContain('Prefer slide-ready structure over long prose');
    expect(byId.get('built-in-reviewer')?.instructions).toContain('Lead with the highest-signal findings');
  });
});
