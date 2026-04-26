import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { GeminiAdapter } from '../../providers/gemini/adapter';
import { OllamaAdapter } from '../../providers/ollama/adapter';
import { OpenAIAdapter } from '../../providers/openai/adapter';
import { KimiAdapter } from '../../providers/kimi/adapter';
import { QwenAdapter } from '../../providers/qwen/adapter';
import type { ProviderAdapter } from '../../providers/types';
import { PROVIDER_IDS, type ProviderId, type SkillCategory, type SkillDefinition, type SkillDetail, type SkillInstallResult, type SkillSaveInput } from '../../shared/domain';
import { providerDisplayName } from '../../shared/providers';
import { getSkillAttachMode, getSkillBrowseUrl, getSkillDetailMarkdown, getSkillExamplePrompt, getSkillIconPath, getSkillKind, normalizeSkillMetadata, skillSlug, type SkillMetadataShape } from '../../shared/skills';
import { DatabaseService } from '../../storage/database';
import { SkillCatalogReadService } from './skill-catalog-read-service';
import { SkillDiskSyncService } from './skill-disk-sync-service';
import { SkillFileOwnershipService } from './skill-file-ownership-service';
import { SkillInstallService } from './skill-install-service';
import { ProviderNativeSkillService } from './provider-native-skill-service';

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
    providerNativeRefreshIncluded: boolean;
  } | null = null;
  private readonly adapters: Record<ProviderId, ProviderAdapter>;
  private readonly fileOwnership: SkillFileOwnershipService;
  private readonly reads: SkillCatalogReadService;
  private readonly diskSync: SkillDiskSyncService;
  private readonly installs: SkillInstallService;
  private readonly providerNative: ProviderNativeSkillService;

  constructor(
    private readonly db: DatabaseService,
    private readonly statePath: string,
    adapters?: Record<ProviderId, ProviderAdapter>
  ) {
    this.root = join(statePath, 'skills');
    const resolvedAdapters =
      adapters ?? {
        openai: new OpenAIAdapter(),
        gemini: new GeminiAdapter(),
        qwen: new QwenAdapter(),
        ollama: new OllamaAdapter(),
        kimi: new KimiAdapter()
      };
    const missingProviders = PROVIDER_IDS.filter((providerId) => !resolvedAdapters[providerId]);
    if (missingProviders.length > 0) {
      throw new Error(`SkillCatalogService requires adapters for: ${missingProviders.join(', ')}`);
    }
    this.adapters = resolvedAdapters;
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
      buildMetadata: (input) => this.buildMetadata(input)
    });
    this.installs = new SkillInstallService({
      root: this.root,
      db: this.db,
      adapters: this.adapters,
      saveSkill: (input) => this.saveSkill(input),
      refreshSkillsFromDisk: () => this.refreshSkillsFromDisk(),
      refreshProviderNativeSkills: () => this.providerNative.refreshProviderNativeSkills()
    });
    this.providerNative = new ProviderNativeSkillService({
      adapters: this.adapters,
      listSkills: () => this.db.listSkills(),
      upsertSkill: (skill) => this.db.upsertSkill(skill),
      deleteSkill: (skillId) => this.db.deleteSkill(skillId)
    });
  }

  async listSkills() {
    const startedAt = Date.now();
    this.cleanupGeneratedCertificationSkills();
    await this.providerNative.refreshProviderNativeSkills();
    const skills = this.reads.listSkills();
    this.latestListDiagnostics = {
      capturedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      skillCount: skills.length,
      providerNativeRefreshIncluded: true
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
    const nextSyncTargets =
      input.scope === 'global'
        ? (input.syncTargets ?? baseMetadata.syncTargets).filter((providerId) => input.providerTargets.includes(providerId))
        : [];

    const nextMetadata = this.buildMetadata({
      metadata: baseMetadata,
      skillId,
      name: input.name,
      origin: current?.origin ?? 'custom_local',
      scope: input.scope,
      syncTargets: nextSyncTargets
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
      this.providerNative.removeProviderNativeSkill(skill, (targetDir) => safeDelete(targetDir));
      this.db.deleteSkill(skillId);
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

  syncSkill(skillId: string, providerId: ProviderId, enabled: boolean) {
    const skill = this.db.getSkill(skillId);
    if (enabled && providerId === 'openai') {
      throw new Error(
        'Vicode does not write to the Codex app home. Use Vicode runtime skills without provider-folder export, or manage Codex native skills in Codex.'
      );
    }
    if (enabled && !skill.providerTargets.includes(providerId)) {
      throw new Error(`${providerDisplayName(providerId)} export is not enabled for this skill.`);
    }
    if (enabled && skill.scope !== 'global') {
      throw new Error('Only global skills can be exported to provider folders.');
    }
    const metadata = normalizeSkillMetadata(skill.metadata, skill.name);
    const syncTargets = enabled
      ? [...new Set([...metadata.syncTargets, providerId])]
      : metadata.syncTargets.filter((target) => target !== providerId);

    const nextSkill: SkillDefinition = {
      ...skill,
      metadata: this.buildMetadata({
        metadata,
        skillId: skill.id,
        name: skill.name,
        origin: skill.origin,
        scope: skill.scope,
        syncTargets
      }),
      updatedAt: new Date().toISOString()
    };

    return this.fileOwnership.persistSkill(nextSkill);
  }

  async installSuggestedSkill(input: {
    installKind: 'provider_native' | 'github_folder';
    providerId?: ProviderId | null;
    providerTargets?: ProviderId[];
    token: string;
    installTarget?: string | null;
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
    syncTargets: ProviderId[];
  }): SkillMetadataShape {
    return {
      manifestVersion: 1,
      slug: input.metadata.slug || skillSlug(input.name),
      folderName:
        input.metadata.folderName ??
        this.fileOwnership.getDefaultFolderName(input.skillId, input.metadata.slug || skillSlug(input.name), input.origin),
      syncTargets: input.scope === 'global' ? [...new Set(input.syncTargets)] : [],
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

  private tryGetSkill(skillId: string) {
    try {
      return this.db.getSkill(skillId);
    } catch {
      return null;
    }
  }

}
