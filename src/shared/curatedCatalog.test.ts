import { describe, expect, it } from 'vitest';
import { curatedSkillCatalog, officialSkillPack } from './curatedCatalog';

describe('curated skill catalog', () => {
  it('uses unique ids and tokens across the catalog', () => {
    expect(new Set(curatedSkillCatalog.map((entry) => entry.id)).size).toBe(curatedSkillCatalog.length);
    expect(
      new Set(curatedSkillCatalog.map((entry) => `${entry.token}::${[...entry.providerTargets].sort().join('|')}`)).size
    ).toBe(curatedSkillCatalog.length);
  });

  it('keeps starter-pack skills official, retained, and centrally cataloged', () => {
    for (const entry of officialSkillPack.filter((candidate) => candidate.starterPack)) {
      expect(entry.official).toBe(true);
      expect(entry.status).toBe('keep');
      expect(entry.starterPack).toBe(true);
      expect(curatedSkillCatalog.some((candidate) => candidate.id === entry.id)).toBe(true);
    }
  });

  it('defines provenance and curation notes for every entry', () => {
    for (const entry of curatedSkillCatalog) {
      expect(entry.publisher.trim().length).toBeGreaterThan(0);
      expect(entry.description.trim().endsWith('.')).toBe(true);
      expect(entry.notes.length).toBeGreaterThan(0);
      expect(entry.verification === 'vicode-reviewed' || entry.verification === 'source-reviewed').toBe(true);
      if (entry.status === 'keep') {
        expect(entry.official).toBe(true);
      }
    }
  });

  it('keeps install metadata coherent for provider-native and imported skills', () => {
    for (const entry of curatedSkillCatalog) {
      if (entry.installKind === 'provider_native') {
        expect(entry.providerId).toBeTruthy();
        expect(entry.providerTargets).toHaveLength(1);
      } else {
        expect(entry.owner).toBeTruthy();
        expect(entry.repo).toBeTruthy();
        expect(entry.path).toBeTruthy();
      }
    }
  });
});
