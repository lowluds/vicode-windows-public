import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { ProviderAdapter } from '../../providers/types';
import { PROVIDER_IDS, type ProviderId, type SkillDefinition } from '../../shared/domain';
import { normalizeSkillMetadata, type SkillMetadataShape } from '../../shared/skills';
import { assertOutsideOperatorCodexHome, isPathInsideRoot } from './codex-app-boundary';

type ProviderNativeSkillDependencies = {
  adapters: Record<ProviderId, ProviderAdapter>;
  listSkills: () => SkillDefinition[];
  upsertSkill: (skill: SkillDefinition) => SkillDefinition;
  deleteSkill: (skillId: string) => void;
};

export class ProviderNativeSkillService {
  constructor(private readonly deps: ProviderNativeSkillDependencies) {}

  removeProviderNativeSkill(skill: SkillDefinition, onDeletePath: (path: string) => void) {
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

    if (!targetIsKnownSkillFile || !roots.some((root) => isPathInsideRoot(root, targetDir))) {
      throw new Error('Refusing to remove provider-native skill outside the provider skill roots.');
    }

    assertOutsideOperatorCodexHome(targetDir, 'remove provider-native skill');
    onDeletePath(targetDir);
  }

  async refreshProviderNativeSkills() {
    const existingSkills = this.deps.listSkills();
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
      const discovered = await this.deps.adapters[providerId].discoverNativeSkills();
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
          this.deps.upsertSkill({
            ...next,
            updatedAt: now
          });
          continue;
        }

        if (current.path !== next.path) {
          this.deps.upsertSkill({
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
        this.deps.deleteSkill(skill.id);
      }
    }
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
}
