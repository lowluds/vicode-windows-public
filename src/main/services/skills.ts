import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { GeminiAdapter } from '../../providers/gemini/adapter';
import { OllamaAdapter } from '../../providers/ollama/adapter';
import { OpenAIAdapter } from '../../providers/openai/adapter';
import { KimiAdapter } from '../../providers/kimi/adapter';
import { QwenAdapter } from '../../providers/qwen/adapter';
import { fileExists, runHiddenExecutable } from '../../providers/util';
import type { ProviderAdapter } from '../../providers/types';
import { PROVIDER_IDS, type ProviderId, type SkillCategory, type SkillDefinition, type SkillDetail, type SkillInstallResult, type SkillSaveInput } from '../../shared/domain';
import { providerDisplayName } from '../../shared/providers';
import {
  buildSkillDocument,
  getSkillAttachMode,
  getSkillBrowseUrl,
  getSkillDetailMarkdown,
  getSkillExamplePrompt,
  getSkillIconPath,
  getSkillKind,
  normalizeSkillMetadata,
  skillSlug,
  type SkillMetadataShape,
  type SkillSyncState
} from '../../shared/skills';
import { DatabaseService } from '../../storage/database';

const OPENAI_SKILLS_OWNER = 'openai';
const OPENAI_SKILLS_REPO = 'skills';
const OPENAI_CURATED_ROOT = 'skills/.curated';
const FILE_BACKED_SKILL_CONFIG_NAME = '.vicode-skill.json';
const FILE_BACKED_SKILL_ID_PREFIX = 'file-skill';

type FileBackedSkillConfig = {
  id?: string;
  name?: string;
  description?: string;
  slug?: string;
  providerTargets?: ProviderId[];
  enabled?: boolean;
  syncTargets?: ProviderId[];
  category?: SkillCategory | null;
};

type FileBackedSkillBundle = {
  folderName: string;
  scope: 'global' | 'project';
  projectId: string | null;
  skillFilePath: string;
  configFilePath: string | null;
};

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDER_IDS.includes(value as ProviderId);
}

function isSkillCategory(value: unknown): value is SkillCategory {
  return (
    value === 'frontend' ||
    value === 'backend' ||
    value === 'engineering' ||
    value === 'documents' ||
    value === 'design' ||
    value === 'testing' ||
    value === 'automation' ||
    value === 'mcp' ||
    value === 'templates' ||
    value === 'provider'
  );
}

function parseFileBackedSkillConfig(raw: string): FileBackedSkillConfig | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;
    return {
      id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : undefined,
      name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name : undefined,
      description:
        typeof candidate.description === 'string' && candidate.description.trim()
          ? candidate.description
          : undefined,
      slug: typeof candidate.slug === 'string' && candidate.slug.trim() ? candidate.slug : undefined,
      providerTargets: Array.isArray(candidate.providerTargets)
        ? candidate.providerTargets.filter((value): value is ProviderId => isProviderId(value))
        : undefined,
      enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : undefined,
      syncTargets: Array.isArray(candidate.syncTargets)
        ? candidate.syncTargets.filter((value): value is ProviderId => isProviderId(value))
        : undefined,
      category: candidate.category === null ? null : isSkillCategory(candidate.category) ? candidate.category : undefined
    };
  } catch {
    return null;
  }
}

function splitFrontMatter(markdown: string) {
  if (!markdown.startsWith('---')) {
    return {
      frontMatter: '',
      content: markdown
    };
  }

  const endIndex = markdown.indexOf('\n---', 3);
  if (endIndex === -1) {
    return {
      frontMatter: '',
      content: markdown
    };
  }

  return {
    frontMatter: markdown.slice(3, endIndex).trim(),
    content: markdown.slice(endIndex + 4).trimStart()
  };
}

function stripFrontMatter(markdown: string) {
  return splitFrontMatter(markdown).content;
}

function parseSkillMarkdown(markdown: string, fallbackName: string, fallbackDescription: string) {
  const { frontMatter, content } = splitFrontMatter(markdown);
  const metadata = new Map<string, string>();

  for (const line of frontMatter.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key && value) {
      metadata.set(key, value);
    }
  }

  const titleMatch = content.match(/^#\s+(.+)$/m);
  const paragraphs = content
    .split(/\r?\n\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !entry.startsWith('#'));

  return {
    name: metadata.get('name') ?? titleMatch?.[1]?.trim() ?? fallbackName,
    description: metadata.get('description') ?? paragraphs[0] ?? fallbackDescription,
    instructions: content.trim() || markdown.trim()
  };
}

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
  private readonly adapters: Record<ProviderId, ProviderAdapter>;

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
    this.cleanupGeneratedCertificationSkills();
  }

  async listSkills() {
    this.cleanupGeneratedCertificationSkills();
    this.syncFileBackedCustomSkills();
    await this.refreshProviderNativeSkills();
    return this.db.listSkills().map((skill) => this.hydrateSkill(skill));
  }

  getSkillDetail(skillId: string): SkillDetail {
    const skill = this.hydrateSkill(this.db.getSkill(skillId));
    let markdown = getSkillDetailMarkdown(skill);

    if (!markdown && skill.path && existsSync(skill.path)) {
      markdown = readFileSync(skill.path, 'utf8');
    }

    if (!markdown) {
      markdown = buildSkillDocument(skill);
    }

    markdown = stripFrontMatter(markdown);

    return {
      skillId: skill.id,
      markdown,
      examplePrompt: getSkillExamplePrompt(skill),
      iconPath: getSkillIconPath(skill),
      folderPath: skill.path ? dirname(skill.path) : null,
      browseUrl: getSkillBrowseUrl(skill),
      attachMode: getSkillAttachMode(skill),
      kind: getSkillKind(skill)
    };
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

    return this.persistSkill(skill);
  }

  toggleSkill(skillId: string, enabled: boolean) {
    const skill = this.db.getSkill(skillId);
    return this.persistSkill({
      ...skill,
      enabled,
      updatedAt: new Date().toISOString()
    });
  }

  removeSkill(skillId: string) {
    const skill = this.db.getSkill(skillId);
    if (skill.origin === 'provider_native') {
      this.removeProviderNativeSkill(skill);
      this.db.deleteSkill(skillId);
      return;
    }

    if (skill.origin !== 'custom_local') {
      throw new Error('Built-in skills cannot be removed.');
    }

    for (const providerId of PROVIDER_IDS) {
      this.removeProviderSync(skill, providerId);
    }

    if (skill.path) {
      safeDelete(dirname(skill.path));
    }

    this.db.deleteSkill(skillId);
  }

  syncSkill(skillId: string, providerId: ProviderId, enabled: boolean) {
    const skill = this.db.getSkill(skillId);
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

    return this.persistSkill(nextSkill);
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
    if (input.installKind === 'github_folder') {
      return await this.installGithubSkill(input);
    }

    if (input.providerId === 'openai') {
      const installPath = await this.installOpenAiCuratedSkill(input.token);
      await this.refreshProviderNativeSkills();
      return {
        status: 'completed',
        providerId: 'openai',
        installPath,
        message: `Installed Codex skill to ${installPath}.`
      };
    }

    if (input.providerId === 'gemini') {
      return await this.installGeminiExtension(input.installTarget ?? null);
    }

    if (input.providerId === 'qwen') {
      throw new Error('Qwen provider-native installs are not supported in Vicode yet.');
    }

    if (input.providerId === 'kimi') {
      throw new Error('Kimi provider-native installs are not supported in Vicode yet.');
    }

    throw new Error('Missing provider for provider-native install.');
  }

  private persistSkill(skill: SkillDefinition) {
    if (skill.origin === 'provider_native') {
      return this.db.upsertSkill(skill);
    }

    let next = this.ensureCanonicalFiles(this.db.upsertSkill(skill));
    next = this.applyProviderSync(next);
    return next;
  }

  private hydrateSkill(skill: SkillDefinition) {
    if (skill.origin === 'provider_native') {
      return skill;
    }

    let next = this.ensureCanonicalFiles(skill);
    next = this.refreshProviderSyncState(next);
    return next;
  }

  private ensureCanonicalFiles(skill: SkillDefinition) {
    const metadata = normalizeSkillMetadata(skill.metadata, skill.name);
    const canonicalFolder = this.getCanonicalFolder(skill, metadata);
    const canonicalSkillPath = join(canonicalFolder, 'SKILL.md');
    const manifestPath = join(canonicalFolder, 'skill.json');
    const detailMarkdown = metadata.detailMarkdown?.trim() ? metadata.detailMarkdown : null;

    ensureDirectory(canonicalFolder);
    writeFileSync(canonicalSkillPath, detailMarkdown ?? buildSkillDocument(skill), 'utf8');
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          scope: skill.scope,
          origin: skill.origin,
          providerTargets: skill.providerTargets,
          category: metadata.category,
          syncTargets: metadata.syncTargets,
          updatedAt: skill.updatedAt
        },
        null,
        2
      ),
      'utf8'
    );

    if (skill.path === canonicalSkillPath && metadata.folderName) {
      return skill;
    }

    return this.db.upsertSkill({
      ...skill,
      path: canonicalSkillPath,
      metadata: {
        ...metadata,
        folderName: metadata.folderName ?? this.defaultFolderName(skill.id, metadata.slug, skill.origin)
      }
    });
  }

  private applyProviderSync(skill: SkillDefinition) {
    const metadata = normalizeSkillMetadata(skill.metadata, skill.name);
    let nextSkill = skill;
    let nextMetadata = metadata;

    for (const providerId of PROVIDER_IDS) {
      const shouldSync = skill.enabled && skill.scope === 'global' && metadata.syncTargets.includes(providerId);
      const nextState = shouldSync ? this.writeProviderSync(nextSkill, providerId) : this.removeProviderSync(nextSkill, providerId);
      nextMetadata = {
        ...nextMetadata,
        syncState: {
          ...nextMetadata.syncState,
          [providerId]: nextState
        }
      };
    }

    if (JSON.stringify(nextMetadata) === JSON.stringify(skill.metadata)) {
      return nextSkill;
    }

    nextSkill = this.db.upsertSkill({
      ...nextSkill,
      metadata: nextMetadata
    });

    return nextSkill;
  }

  private refreshProviderSyncState(skill: SkillDefinition) {
    const metadata = normalizeSkillMetadata(skill.metadata, skill.name);
    let dirty = false;
    const nextSyncState: Partial<Record<ProviderId, SkillSyncState>> = { ...metadata.syncState };

    for (const providerId of PROVIDER_IDS) {
      const current = nextSyncState[providerId];
      if (!current?.path) {
        continue;
      }
      const exported = existsSync(current.path);
      if (current.exported !== exported) {
        nextSyncState[providerId] = {
          ...current,
          exported,
          error: exported ? null : 'Exported file is missing.'
        };
        dirty = true;
      }
    }

    if (!dirty) {
      return skill;
    }

    return this.db.upsertSkill({
      ...skill,
      metadata: {
        ...metadata,
        syncState: nextSyncState
      }
    });
  }

  private writeProviderSync(skill: SkillDefinition, providerId: ProviderId): SkillSyncState {
    const metadata = normalizeSkillMetadata(skill.metadata, skill.name);
    const folderName = metadata.folderName ?? this.defaultFolderName(skill.id, metadata.slug, skill.origin);
    const folder = join(this.getProviderRoot(providerId), folderName);
    const path = join(folder, 'SKILL.md');

    try {
      ensureDirectory(folder);
      writeFileSync(path, buildSkillDocument(skill), 'utf8');
      return {
        exported: true,
        path,
        updatedAt: new Date().toISOString(),
        error: null
      };
    } catch (error) {
      return {
        exported: false,
        path,
        updatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Failed to export skill.'
      };
    }
  }

  private removeProviderSync(skill: SkillDefinition, providerId: ProviderId): SkillSyncState {
    const current = normalizeSkillMetadata(skill.metadata, skill.name).syncState[providerId];
    if (current?.path) {
      const providerRoot = resolve(this.getProviderRoot(providerId));
      const targetDir = resolve(dirname(current.path));
      if (targetDir.startsWith(providerRoot)) {
        safeDelete(targetDir);
      }
    }

    return {
      exported: false,
      path: null,
      updatedAt: current?.updatedAt ?? null,
      error: null
    };
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
      folderName: input.metadata.folderName ?? this.defaultFolderName(input.skillId, input.metadata.slug || skillSlug(input.name), input.origin),
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

  private getCanonicalFolder(skill: SkillDefinition, metadata: SkillMetadataShape) {
    const folderName = metadata.folderName ?? this.defaultFolderName(skill.id, metadata.slug, skill.origin);
    if (skill.origin === 'built_in_style') {
      return join(this.root, 'built-in', folderName);
    }
    if (skill.scope === 'project' && skill.projectId) {
      return join(this.root, 'project', skill.projectId, folderName);
    }
    return join(this.root, 'user', folderName);
  }

  private getProviderRoot(providerId: ProviderId) {
    if (providerId === 'openai') {
      return join(homedir(), '.codex', 'skills');
    }

    if (providerId === 'gemini') {
      return join(homedir(), '.gemini', 'skills');
    }

    if (providerId === 'qwen') {
      return join(homedir(), '.qwen', 'skills');
    }

    return join(homedir(), '.kimi', 'skills');
  }

  private getProviderNativeRoots(providerId: ProviderId) {
    if (providerId === 'openai') {
      return [join(homedir(), '.codex', 'skills')];
    }

    if (providerId === 'gemini') {
      return [join(homedir(), '.gemini', 'skills'), join(homedir(), '.gemini', 'extensions')];
    }

    if (providerId === 'qwen') {
      return [join(homedir(), '.qwen', 'skills')];
    }

    return [join(homedir(), '.kimi', 'skills')];
  }

  private defaultFolderName(skillId: string, slug: string, origin: SkillDefinition['origin']) {
    return origin === 'built_in_style' ? slug : `${slug}--${skillId.slice(0, 8)}`;
  }

  private removeProviderNativeSkill(skill: SkillDefinition) {
    const providerId = skill.providerTargets[0];
    if (!providerId || !skill.path) {
      throw new Error('Provider-native skill path is missing.');
    }

    const resolvedPath = resolve(skill.path);
    const roots = this.getProviderNativeRoots(providerId).map((root) => resolve(root));
    const targetDir = resolve(dirname(skill.path));
    const targetFileName = basename(resolvedPath).toLowerCase();
    const targetIsKnownSkillFile =
      targetFileName === 'skill.md' ||
      targetFileName === 'gemini.md' ||
      targetFileName === 'gemini-extension.json' ||
      targetFileName === 'package.json';

    if (!targetIsKnownSkillFile || !roots.some((root) => targetDir.startsWith(root))) {
      throw new Error('Refusing to remove provider-native skill outside the provider skill roots.');
    }

    safeDelete(targetDir);
  }

  private async refreshProviderNativeSkills() {
    const existingSkills = this.db.listSkills();
    const existingProviderNative = existingSkills.filter((skill) => skill.origin === 'provider_native');
    const existingById = new Map(existingProviderNative.map((skill) => [skill.id, skill]));
    const exportedPaths = new Set(
      existingSkills
        .filter((skill) => skill.origin !== 'provider_native')
        .flatMap((skill) =>
          PROVIDER_IDS.map((providerId) => normalizeSkillMetadata(skill.metadata, skill.name).syncState[providerId]?.path ?? null)
        )
        .filter((value): value is string => Boolean(value))
        .map((value) => resolve(value))
    );

    const now = new Date().toISOString();
    const seen = new Set<string>();

    for (const providerId of PROVIDER_IDS) {
      const discovered = await this.adapters[providerId].discoverNativeSkills();
      for (const entry of discovered) {
        const normalizedPath = resolve(entry.path);
        if (exportedPaths.has(normalizedPath)) {
          continue;
        }

        seen.add(entry.id);
        const current = existingById.get(entry.id);
        const metadata = {
          ...normalizeSkillMetadata(entry.metadata ?? {}, entry.name, basename(dirname(entry.path))),
          providerOrigin: providerId,
          kind: entry.kind,
          attachMode: entry.attachMode,
          iconPath: typeof entry.metadata?.iconPath === 'string' ? entry.metadata.iconPath : null,
          examplePrompt: typeof entry.metadata?.examplePrompt === 'string' ? entry.metadata.examplePrompt : null,
          browseUrl: typeof entry.metadata?.browseUrl === 'string' ? entry.metadata.browseUrl : this.defaultBrowseUrl(providerId),
          detailMarkdown: typeof entry.metadata?.detailMarkdown === 'string' ? entry.metadata.detailMarkdown : null,
          category: null,
          syncTargets: [],
          syncState: {}
        } satisfies SkillMetadataShape;

        const next: SkillDefinition = {
          id: entry.id,
          name: entry.name,
          description: entry.description,
          instructions: entry.instructions,
          origin: 'provider_native',
          scope: 'global',
          providerTargets: entry.providerTargets,
          enabled: current?.enabled ?? true,
          projectId: null,
          metadata,
          path: entry.path,
          createdAt: current?.createdAt ?? now,
          updatedAt: current?.updatedAt ?? now
        };

        if (!current || this.hasProviderNativeChanged(current, next)) {
          this.db.upsertSkill({
            ...next,
            updatedAt: now
          });
          continue;
        }

        if (current.path !== next.path) {
          this.db.upsertSkill({
            ...current,
            path: next.path,
            metadata: next.metadata,
            updatedAt: now
          });
        }
      }
    }

    for (const skill of existingProviderNative) {
      if (!seen.has(skill.id)) {
        this.db.deleteSkill(skill.id);
      }
    }
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
        this.removeProviderSync(skill, providerId);
      }

      if (skill.path) {
        safeDelete(dirname(skill.path));
      }

      this.db.deleteSkill(skill.id);
    }
  }

  private syncFileBackedCustomSkills() {
    const existingCustomSkills = this.db.listSkills().filter((skill) => skill.origin === 'custom_local');
    const existingById = new Map(existingCustomSkills.map((skill) => [skill.id, skill]));
    const existingByPath = new Map(
      existingCustomSkills
        .filter((skill) => skill.path)
        .map((skill) => [resolve(skill.path as string), skill] as const)
    );

    for (const bundle of this.listFileBackedSkillBundles()) {
      const markdown = readFileSync(bundle.skillFilePath, 'utf8');
      const config = bundle.configFilePath && existsSync(bundle.configFilePath)
        ? parseFileBackedSkillConfig(readFileSync(bundle.configFilePath, 'utf8'))
        : null;
      const parsed = parseSkillMarkdown(
        markdown,
        config?.name?.trim() || bundle.folderName,
        config?.description?.trim() || 'Imported Vicode skill.'
      );
      const existing =
        (config?.id ? existingById.get(config.id) : null) ??
        existingByPath.get(resolve(bundle.skillFilePath)) ??
        null;
      const now = new Date().toISOString();
      const baseMetadata = normalizeSkillMetadata(existing?.metadata, parsed.name, bundle.folderName);
      const providerTargets =
        config?.providerTargets && config.providerTargets.length > 0
          ? [...new Set(config.providerTargets)]
          : existing?.providerTargets?.length
            ? [...new Set(existing.providerTargets)]
            : [...PROVIDER_IDS];
      const syncTargets =
        bundle.scope === 'global'
          ? [...new Set((config?.syncTargets ?? baseMetadata.syncTargets).filter((providerId) => providerTargets.includes(providerId)))]
          : [];
      const skill: SkillDefinition = {
        id:
          config?.id ??
          existing?.id ??
          `${FILE_BACKED_SKILL_ID_PREFIX}:${bundle.scope}:${bundle.projectId ?? 'global'}:${bundle.folderName}`,
        name: parsed.name.trim(),
        description: parsed.description.trim(),
        instructions: parsed.instructions.trim(),
        origin: 'custom_local',
        scope: bundle.scope,
        providerTargets,
        enabled: config?.enabled ?? existing?.enabled ?? true,
        projectId: bundle.scope === 'project' ? bundle.projectId : null,
        metadata: this.buildMetadata({
          metadata: {
            ...baseMetadata,
            slug: config?.slug?.trim() || baseMetadata.slug || skillSlug(parsed.name),
            folderName: bundle.folderName,
            syncTargets,
            detailMarkdown: markdown,
            category:
              config?.category === undefined
                ? baseMetadata.category
                : config.category
          },
          skillId:
            config?.id ??
            existing?.id ??
            `${FILE_BACKED_SKILL_ID_PREFIX}:${bundle.scope}:${bundle.projectId ?? 'global'}:${bundle.folderName}`,
          name: parsed.name,
          origin: 'custom_local',
          scope: bundle.scope,
          syncTargets
        }),
        path: bundle.skillFilePath,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };

      const persisted = this.persistSkill(skill);
      existingById.set(persisted.id, persisted);
      if (persisted.path) {
        existingByPath.set(resolve(persisted.path), persisted);
      }
    }
  }

  private hasProviderNativeChanged(current: SkillDefinition, next: SkillDefinition) {
    return (
      current.name !== next.name ||
      current.description !== next.description ||
      current.instructions !== next.instructions ||
      current.path !== next.path ||
      JSON.stringify(current.providerTargets) !== JSON.stringify(next.providerTargets) ||
      JSON.stringify(current.metadata) !== JSON.stringify(next.metadata)
    );
  }

  private defaultBrowseUrl(providerId: ProviderId) {
    if (providerId === 'openai') {
      return 'https://github.com/openai/skills/tree/main/skills/.curated';
    }

    if (providerId === 'gemini') {
      return 'https://geminicli.com/extensions/';
    }

    if (providerId === 'qwen') {
      return 'https://qwenlm.github.io/qwen-code-docs/en/users/overview/';
    }

    return 'https://moonshotai.github.io/kimi-cli/en/';
  }

  private tryGetSkill(skillId: string) {
    try {
      return this.db.getSkill(skillId);
    } catch {
      return null;
    }
  }

  private listFileBackedSkillBundles(): FileBackedSkillBundle[] {
    const bundles: FileBackedSkillBundle[] = [];
    const userRoot = join(this.root, 'user');
    if (existsSync(userRoot)) {
      for (const entry of readdirSync(userRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }

        const skillFilePath = join(userRoot, entry.name, 'SKILL.md');
        if (!existsSync(skillFilePath)) {
          continue;
        }

        const configFilePath = join(userRoot, entry.name, FILE_BACKED_SKILL_CONFIG_NAME);
        bundles.push({
          folderName: entry.name,
          scope: 'global',
          projectId: null,
          skillFilePath,
          configFilePath: existsSync(configFilePath) ? configFilePath : null
        });
      }
    }

    const projectRoot = join(this.root, 'project');
    if (!existsSync(projectRoot)) {
      return bundles;
    }

    for (const projectEntry of readdirSync(projectRoot, { withFileTypes: true })) {
      if (!projectEntry.isDirectory()) {
        continue;
      }

      const projectDir = join(projectRoot, projectEntry.name);
      for (const skillEntry of readdirSync(projectDir, { withFileTypes: true })) {
        if (!skillEntry.isDirectory()) {
          continue;
        }

        const skillFilePath = join(projectDir, skillEntry.name, 'SKILL.md');
        if (!existsSync(skillFilePath)) {
          continue;
        }

        const configFilePath = join(projectDir, skillEntry.name, FILE_BACKED_SKILL_CONFIG_NAME);
        bundles.push({
          folderName: skillEntry.name,
          scope: 'project',
          projectId: projectEntry.name,
          skillFilePath,
          configFilePath: existsSync(configFilePath) ? configFilePath : null
        });
      }
    }

    return bundles;
  }

  private async installOpenAiCuratedSkill(token: string) {
    const safeToken = token.trim().replace(/^\/+|\/+$/g, '');
    if (!safeToken || !/^[a-z0-9][a-z0-9-]*$/i.test(safeToken)) {
      throw new Error('Missing Codex skill token.');
    }

    const targetDir = join(this.getProviderRoot('openai'), safeToken);
    safeDelete(targetDir);
    ensureDirectory(targetDir);

    try {
      await this.downloadGithubDirectoryRecursive(OPENAI_SKILLS_OWNER, OPENAI_SKILLS_REPO, `${OPENAI_CURATED_ROOT}/${safeToken}`, targetDir);
      return targetDir;
    } catch (error) {
      safeDelete(targetDir);
      throw error;
    }
  }

  private async installGeminiExtension(installTarget: string | null): Promise<SkillInstallResult> {
    if (!installTarget) {
      throw new Error('Missing Gemini extension install target.');
    }

    const install = await this.adapters.gemini.detectInstall();
    if (!install.cliPath) {
      throw new Error('Gemini CLI is required before installing Gemini extensions.');
    }

    const installRoot = join(homedir(), '.gemini', 'extensions');
    const command = await this.resolveGeminiInstallCommand(install.cliPath, ['extensions', 'install', installTarget, '--consent']);
    await runHiddenExecutable(command.executable, command.args);
    await this.refreshProviderNativeSkills();
    return {
      status: 'completed',
      providerId: 'gemini',
      installPath: installRoot,
      message: `Installed Gemini extension under ${installRoot}.`
    };
  }

  private async installGithubSkill(input: {
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
    const owner = input.owner?.trim();
    const repo = input.repo?.trim();
    const repoPath = input.path?.trim().replace(/^\/+|\/+$/g, '');
    if (!owner || !repo || !repoPath) {
      throw new Error('Missing GitHub skill source.');
    }

    const importDir = join(this.root, '.imports', `${input.token}--${randomUUID().slice(0, 8)}`);
    ensureDirectory(importDir);

    try {
      await this.downloadGithubDirectoryRecursive(owner, repo, repoPath, importDir);
      const skillFilePath = join(importDir, 'SKILL.md');
      if (!existsSync(skillFilePath)) {
        throw new Error('Imported skill is missing SKILL.md.');
      }

      const markdown = readFileSync(skillFilePath, 'utf8');
      const parsed = parseSkillMarkdown(markdown, input.name?.trim() || input.token, input.description?.trim() || 'Imported skill.');
      const saved = this.saveSkill({
        name: parsed.name,
        description: parsed.description,
        instructions: parsed.instructions,
        scope: 'global',
        providerTargets: input.providerTargets?.length ? [...new Set(input.providerTargets)] : [...PROVIDER_IDS],
        syncTargets: [],
        enabled: true,
        projectId: null
      });
      const metadata = normalizeSkillMetadata(saved.metadata, saved.name);
      const updated = this.db.upsertSkill({
        ...saved,
        metadata: {
          ...metadata,
          slug: input.token,
          browseUrl: input.browseUrl?.trim() || `https://github.com/${owner}/${repo}/tree/main/${repoPath}`,
          detailMarkdown: markdown,
          category: input.category ?? metadata.category
        },
        updatedAt: new Date().toISOString()
      });

      return {
        status: 'completed',
        providerId: null,
        installPath: dirname(updated.path ?? skillFilePath),
        message: `Installed ${updated.name} as a Vicode skill.`
      };
    } finally {
      safeDelete(importDir);
    }
  }

  private async resolveGeminiInstallCommand(executable: string, args: string[]) {
    if (process.platform !== 'win32' || !executable.toLowerCase().endsWith('.cmd')) {
      return { executable, args };
    }

    const installDir = dirname(executable);
    const nodeScript = join(installDir, 'node_modules', '@google', 'gemini-cli', 'dist', 'index.js');
    if (!(await fileExists(nodeScript))) {
      return { executable, args };
    }

    const bundledNode = join(installDir, 'node.exe');
    const nodeExecutable = (await fileExists(bundledNode)) ? bundledNode : 'node';
    return {
      executable: nodeExecutable,
      args: ['--no-warnings=DEP0040', nodeScript, ...args]
    };
  }

  private async downloadGithubDirectoryRecursive(owner: string, repo: string, repoPath: string, targetDir: string): Promise<void> {
    const entries = await this.fetchGithubContents(owner, repo, repoPath);
    for (const entry of entries) {
      if (entry.type === 'dir') {
        const nextDir = join(targetDir, entry.name);
        ensureDirectory(nextDir);
        await this.downloadGithubDirectoryRecursive(owner, repo, entry.path, nextDir);
        continue;
      }

      if (entry.type !== 'file') {
        continue;
      }

      const fileUrl = entry.download_url ?? this.githubRawUrl(owner, repo, entry.path);
      const response = await fetch(fileUrl, {
        headers: {
          'User-Agent': 'vicode-windows'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to download ${entry.path}.`);
      }

      writeFileSync(join(targetDir, entry.name), Buffer.from(await response.arrayBuffer()));
    }
  }

  private async fetchGithubContents(owner: string, repo: string, repoPath: string): Promise<Array<{
    type: 'file' | 'dir' | 'symlink' | 'submodule';
    name: string;
    path: string;
    download_url: string | null;
  }>> {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${repoPath}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'vicode-windows'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Unable to fetch GitHub skill files for ${repoPath}.`);
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error(`Unexpected GitHub directory payload for ${repoPath}.`);
    }

    return payload.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }

      const type = 'type' in entry ? entry.type : null;
      const name = 'name' in entry ? entry.name : null;
      const path = 'path' in entry ? entry.path : null;
      const downloadUrl = 'download_url' in entry ? entry.download_url : null;

      if (
        (type !== 'file' && type !== 'dir' && type !== 'symlink' && type !== 'submodule') ||
        typeof name !== 'string' ||
        typeof path !== 'string'
      ) {
        return [];
      }

      return [
        {
          type,
          name,
          path,
          download_url: typeof downloadUrl === 'string' || downloadUrl === null ? downloadUrl : null
        }
      ];
    });
  }

  private githubRawUrl(owner: string, repo: string, repoPath: string) {
    return `https://raw.githubusercontent.com/${owner}/${repo}/main/${repoPath}`;
  }
}
