import { describe, expect, it } from 'vitest';
import { curatedSkillCatalog, officialSkillPack, providerReferenceCatalog } from './curatedCatalog';

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

  it('keeps visible install metadata coherent for imported skills', () => {
    for (const entry of curatedSkillCatalog) {
      expect(entry.installKind).toBe('github_folder');
      expect(entry.owner).toBeTruthy();
      expect(entry.repo).toBeTruthy();
      expect(entry.path).toBeTruthy();
    }
  });

  it('keeps provider-managed references separate from installable Vicode skills', () => {
    expect(providerReferenceCatalog.length).toBeGreaterThan(0);
    for (const entry of providerReferenceCatalog) {
      expect(entry.installKind).toBe('provider_reference');
      expect(curatedSkillCatalog.some((candidate) => candidate.id === entry.id)).toBe(false);
      expect(entry.browseUrl).toMatch(/^https:\/\//);
      expect(entry.providerId).toBeTruthy();
      expect(entry).not.toHaveProperty('installTarget');
    }
  });
});
