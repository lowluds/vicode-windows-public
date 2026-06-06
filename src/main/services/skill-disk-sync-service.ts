import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PROVIDER_IDS, type ProviderId, type SkillCategory, type SkillDefinition } from '../../shared/domain';
import { SURFACED_PROVIDER_IDS } from '../../shared/providers';
import { normalizeSkillMetadata, skillSlug, type SkillMetadataShape } from '../../shared/skills';
import { parseSkillMarkdown } from './skill-markdown';

const FILE_BACKED_SKILL_CONFIG_NAME = '.vicode-skill.json';
const FILE_BACKED_SKILL_ID_PREFIX = 'file-skill';

type FileBackedSkillConfig = {
  id?: string;
  name?: string;
  description?: string;
  slug?: string;
  providerTargets?: ProviderId[];
  enabled?: boolean;
  category?: SkillCategory | null;
};

type FileBackedSkillBundle = {
  folderName: string;
  scope: 'global' | 'project';
  projectId: string | null;
  skillFilePath: string;
  configFilePath: string | null;
};

type BuildMetadataInput = {
  metadata: SkillMetadataShape;
  skillId: string;
  name: string;
  origin: SkillDefinition['origin'];
  scope: SkillDefinition['scope'];
};

type SkillDiskSyncDependencies = {
  root: string;
  listSkills: () => SkillDefinition[];
  persistSkill: (skill: SkillDefinition) => SkillDefinition;
  buildMetadata: (input: BuildMetadataInput) => SkillMetadataShape;
  getExternalSkillRoots?: () => string[];
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
      category: candidate.category === null ? null : isSkillCategory(candidate.category) ? candidate.category : undefined
    };
  } catch {
    return null;
  }
}

export class SkillDiskSyncService {
  constructor(private readonly deps: SkillDiskSyncDependencies) {}

  refreshSkillsFromDisk() {
    const existingCustomSkills = this.deps.listSkills().filter((skill) => skill.origin === 'custom_local');
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
            : [...SURFACED_PROVIDER_IDS];
      const skillId =
        config?.id ??
        existing?.id ??
        `${FILE_BACKED_SKILL_ID_PREFIX}:${bundle.scope}:${bundle.projectId ?? 'global'}:${bundle.folderName}`;
      const skill: SkillDefinition = {
        id: skillId,
        name: parsed.name.trim(),
        description: parsed.description.trim(),
        instructions: parsed.instructions.trim(),
        origin: 'custom_local',
        scope: bundle.scope,
        providerTargets,
        enabled: config?.enabled ?? existing?.enabled ?? true,
        projectId: bundle.scope === 'project' ? bundle.projectId : null,
        metadata: this.deps.buildMetadata({
          metadata: {
            ...baseMetadata,
            slug: config?.slug?.trim() || baseMetadata.slug || skillSlug(parsed.name),
            folderName: bundle.folderName,
            detailMarkdown: markdown,
            category:
              config?.category === undefined
                ? baseMetadata.category
                : config.category
          },
          skillId,
          name: parsed.name,
          origin: 'custom_local',
          scope: bundle.scope
        }),
        path: bundle.skillFilePath,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };

      const persisted = this.deps.persistSkill(skill);
      existingById.set(persisted.id, persisted);
      if (persisted.path) {
        existingByPath.set(resolve(persisted.path), persisted);
      }
    }
  }

  private listFileBackedSkillBundles(): FileBackedSkillBundle[] {
    const bundles: FileBackedSkillBundle[] = [];
    this.collectUserSkillBundles(join(this.deps.root, 'user'), bundles);
    for (const externalRoot of this.deps.getExternalSkillRoots?.() ?? []) {
      this.collectUserSkillBundles(resolve(externalRoot), bundles);
    }

    const projectRoot = join(this.deps.root, 'project');
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

  private collectUserSkillBundles(root: string, bundles: FileBackedSkillBundle[]) {
    if (!existsSync(root)) {
      return;
    }

    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillFilePath = join(root, entry.name, 'SKILL.md');
      if (!existsSync(skillFilePath)) {
        continue;
      }

      const configFilePath = join(root, entry.name, FILE_BACKED_SKILL_CONFIG_NAME);
      bundles.push({
        folderName: entry.name,
        scope: 'global',
        projectId: null,
        skillFilePath,
        configFilePath: existsSync(configFilePath) ? configFilePath : null
      });
    }
  }
}
