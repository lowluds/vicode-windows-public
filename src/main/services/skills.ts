import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PROVIDER_IDS, type ProviderId, type SkillCategory, type SkillDefinition, type SkillDetail, type SkillInstallResult, type SkillSaveInput } from '../../shared/domain';
import { getSkillAttachMode, getSkillBrowseUrl, getSkillDetailMarkdown, getSkillExamplePrompt, getSkillIconPath, getSkillKind, normalizeSkillMetadata, skillSlug, type SkillMetadataShape } from '../../shared/skills';
import { DatabaseService } from '../../storage/database';
import { SkillCatalogReadService } from './skill-catalog-read-service';
import { SkillDiskSyncService } from './skill-disk-sync-service';
import { SkillFileOwnershipService } from './skill-file-ownership-service';
import { SkillInstallService } from './skill-install-service';

function ensureDirectory(path: string) {
  mkdirSync(path, { recursive: true });
}

function safeDelete(path: string) {
  rmSync(path, { recursive: true, force: true });
}

const GENERATED_CERT_SKILL_NAME_PATTERNS = [
  /^live-cert-(openai|gemini|ollama|qwen|kimi)-\d+-[a-f0-9]+$/i,
  /^ollama-build-cert-\d+-[a-f0-9]+$/i,
  /^ollama-rich-workflow-\d+-[a-f0-9]+$/i,
  /^react-thread-direction-(openai|gemini|ollama|qwen|kimi)-\d+-[a-f0-9]+$/i,
  /^react-landing-direction-(openai|gemini|ollama|qwen|kimi)-\d+-[a-f0-9]+$/i
];
const GENERATED_CERT_SKILL_DESCRIPTION_PATTERNS = [
  /^Deterministic live certification prompt skill for (openai|gemini|ollama|qwen|kimi)\.$/i,
  /^Steers same-thread React landing-page work toward premium component continuity and restrained design\.$/i,
  /^Steers React landing pages toward premium component structure and restrained design\.$/i
];

export class SkillCatalogService {
  private readonly root: string;
  private latestListDiagnostics: {
    capturedAt: string;
    durationMs: number;
    skillCount: number;
  } | null = null;
  private readonly fileOwnership: SkillFileOwnershipService;
  private readonly reads: SkillCatalogReadService;
  private readonly diskSync: SkillDiskSyncService;
  private readonly installs: SkillInstallService;

  constructor(
    private readonly db: DatabaseService,
    private readonly statePath: string
  ) {
    this.root = join(statePath, 'skills');
    ensureDirectory(this.root);
    ensureDirectory(join(this.root, 'user'));
    ensureDirectory(join(this.root, 'project'));
    this.fileOwnership = new SkillFileOwnershipService({
      root: this.root,
      upsertSkill: (skill) => this.db.upsertSkill(skill)
    });
    this.cleanupGeneratedCertificationSkills();
    this.reads = new SkillCatalogReadService(
      () => this.db.listSkills(),
      (skillId) => this.db.getSkill(skillId),
      (skill) => this.fileOwnership.hydrateSkill(skill)
    );
    this.diskSync = new SkillDiskSyncService({
      root: this.root,
      listSkills: () => this.db.listSkills(),
      persistSkill: (skill) => this.fileOwnership.persistSkill(skill),
      buildMetadata: (input) => this.buildMetadata(input),
      getExternalSkillRoots: () => {
        const preferencesReader = (
          this.db as Partial<Pick<DatabaseService, 'getPreferences'>>
        ).getPreferences;
        if (typeof preferencesReader !== 'function') {
          return [];
        }
        const path = preferencesReader.call(this.db).skillsLibraryPath?.trim();
        return path ? [path] : [];
      }
    });
    this.installs = new SkillInstallService({
      root: this.root,
      db: this.db,
      saveSkill: (input) => this.saveSkill(input),
      refreshSkillsFromDisk: () => this.refreshSkillsFromDisk()
    });
  }

  async listSkills() {
    const startedAt = Date.now();
    this.cleanupGeneratedCertificationSkills();
    this.refreshSkillsFromDisk();
    const skills = this.reads.listSkills();
    this.latestListDiagnostics = {
      capturedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      skillCount: skills.length
    };
    return skills;
  }

  getListDiagnostics() {
    return this.latestListDiagnostics;
  }

  getSkillDetail(skillId: string): SkillDetail {
    return this.reads.getSkillDetail(skillId);
  }

  saveSkill(input: SkillSaveInput) {
    const now = new Date().toISOString();
    const current = input.id ? this.tryGetSkill(input.id) : null;
    const skillId = current?.id ?? input.id ?? randomUUID();

    if (current && current.origin !== 'custom_local') {
      throw new Error('Built-in and provider-native skills are read-only.');
    }

    const baseMetadata = normalizeSkillMetadata(current?.metadata, input.name);
    const nextMetadata = this.buildMetadata({
      metadata: baseMetadata,
      skillId,
      name: input.name,
      origin: current?.origin ?? 'custom_local',
      scope: input.scope
    });

    const skill: SkillDefinition = {
      id: skillId,
      name: input.name.trim(),
      description: input.description.trim(),
      instructions: input.instructions.trim(),
      origin: current?.origin ?? 'custom_local',
      scope: input.scope,
      providerTargets: [...new Set(input.providerTargets)],
      enabled: input.enabled,
      projectId: input.scope === 'project' ? input.projectId ?? null : null,
      metadata: nextMetadata,
      path: current?.path ?? null,
      createdAt: current?.createdAt ?? now,
      updatedAt: now
    };

    const persisted = this.fileOwnership.persistSkill(skill);
    this.refreshSkillsFromDisk();
    return this.fileOwnership.hydrateSkill(this.db.getSkill(persisted.id));
  }

  toggleSkill(skillId: string, enabled: boolean) {
    const skill = this.db.getSkill(skillId);
    return this.fileOwnership.persistSkill({
      ...skill,
      enabled,
      updatedAt: new Date().toISOString()
    });
  }

  removeSkill(skillId: string) {
    const skill = this.db.getSkill(skillId);
    if (skill.origin === 'provider_native') {
      this.hideProviderNativeSkill(skill);
      return;
    }

    if (skill.origin !== 'custom_local') {
      throw new Error('Built-in skills cannot be removed.');
    }

    for (const providerId of PROVIDER_IDS) {
      this.fileOwnership.removeProviderSync(skill, providerId);
    }

    if (skill.path) {
      safeDelete(dirname(skill.path));
    }

    this.db.deleteSkill(skillId);
    this.refreshSkillsFromDisk();
  }

  async installSuggestedSkill(input: {
    installKind: 'github_folder';
    providerTargets?: ProviderId[];
    token: string;
    owner?: string | null;
    repo?: string | null;
    path?: string | null;
    name?: string | null;
    description?: string | null;
    browseUrl?: string | null;
    category?: SkillCategory | null;
  }): Promise<SkillInstallResult> {
    return await this.installs.installSuggestedSkill(input);
  }

  private buildMetadata(input: {
    metadata: SkillMetadataShape;
    skillId: string;
    name: string;
    origin: SkillDefinition['origin'];
    scope: SkillDefinition['scope'];
  }): SkillMetadataShape {
    return {
      manifestVersion: 1,
      slug: input.metadata.slug || skillSlug(input.name),
      folderName:
        input.metadata.folderName ??
        this.fileOwnership.getDefaultFolderName(input.skillId, input.metadata.slug || skillSlug(input.name), input.origin),
      syncState: input.metadata.syncState ?? {},
      providerOrigin: input.metadata.providerOrigin ?? null,
      kind: input.metadata.kind ?? 'skill',
      attachMode: input.metadata.attachMode ?? 'prompt',
      iconPath: input.metadata.iconPath ?? null,
      examplePrompt: input.metadata.examplePrompt ?? null,
      browseUrl: input.metadata.browseUrl ?? null,
      detailMarkdown: input.metadata.detailMarkdown ?? null,
      category: input.metadata.category ?? null
    };
  }

  private cleanupGeneratedCertificationSkills() {
    const existingSkills = this.db.listSkills();
    for (const skill of existingSkills) {
      if (skill.origin !== 'custom_local') {
        continue;
      }

      if (
        !GENERATED_CERT_SKILL_NAME_PATTERNS.some((pattern) => pattern.test(skill.name.trim()))
        || !GENERATED_CERT_SKILL_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(skill.description.trim()))
      ) {
        continue;
      }

      for (const providerId of PROVIDER_IDS) {
        this.fileOwnership.removeProviderSync(skill, providerId);
      }

      if (skill.path) {
        safeDelete(dirname(skill.path));
      }

      this.db.deleteSkill(skill.id);
    }
  }

  refreshSkillsFromDisk() {
    this.diskSync.refreshSkillsFromDisk();
  }

  async rescanLibrarySkills() {
    this.refreshSkillsFromDisk();
    return await this.listSkills();
  }

  private tryGetSkill(skillId: string) {
    try {
      return this.db.getSkill(skillId);
    } catch {
      return null;
    }
  }

  private hideProviderNativeSkill(skill: SkillDefinition) {
    const now = new Date().toISOString();
    this.db.upsertSkill({
      ...skill,
      enabled: false,
      metadata: {
        ...skill.metadata,
        hiddenFromCatalog: true,
        hiddenAt: now
      },
      updatedAt: now
    });
  }

}
