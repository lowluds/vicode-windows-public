import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PROVIDER_IDS, type ProviderId, type SkillDefinition } from '../../shared/domain';
import { buildSkillDocument, normalizeSkillMetadata, type SkillMetadataShape, type SkillSyncState } from '../../shared/skills';
import { assertOutsideOperatorCodexHome, isInsideOperatorCodexHome, isPathInsideRoot } from './codex-app-boundary';

const CODEX_APP_HOME_SYNC_BLOCKED_MESSAGE =
  'Vicode does not write to the Codex app home. Manage Codex native skills in Codex, or use Vicode runtime skills without provider-folder export.';
const CODEX_APP_HOME_REMOVE_BLOCKED_MESSAGE =
  'Vicode did not remove provider files inside the Codex app home. Manage Codex native skills in Codex.';

function ensureDirectory(path: string) {
  mkdirSync(path, { recursive: true });
}

function safeDelete(path: string) {
  rmSync(path, { recursive: true, force: true });
}

type SkillFileOwnershipDependencies = {
  root: string;
  upsertSkill: (skill: SkillDefinition) => SkillDefinition;
};

export class SkillFileOwnershipService {
  constructor(private readonly deps: SkillFileOwnershipDependencies) {}

  persistSkill(skill: SkillDefinition) {
    if (skill.origin === 'provider_native') {
      return this.deps.upsertSkill(skill);
    }

    let next = this.ensureCanonicalFiles(this.deps.upsertSkill(skill));
    next = this.applyProviderSync(next);
    return next;
  }

  hydrateSkill(skill: SkillDefinition) {
    if (skill.origin === 'provider_native') {
      return skill;
    }

    let next = this.ensureCanonicalFiles(skill);
    next = this.refreshProviderSyncState(next);
    return next;
  }

  removeProviderSync(skill: SkillDefinition, providerId: ProviderId): SkillSyncState {
    const current = normalizeSkillMetadata(skill.metadata, skill.name).syncState[providerId];
    if (current?.path) {
      const providerRoot = resolve(this.getProviderRoot(providerId));
      const targetDir = resolve(dirname(current.path));
      if (isInsideOperatorCodexHome(targetDir)) {
        return {
          exported: false,
          path: null,
          updatedAt: current.updatedAt ?? new Date().toISOString(),
          error: CODEX_APP_HOME_REMOVE_BLOCKED_MESSAGE
        };
      }
      if (isPathInsideRoot(providerRoot, targetDir)) {
        assertOutsideOperatorCodexHome(targetDir, 'remove provider skill export');
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

  getProviderRoot(providerId: ProviderId) {
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

  getDefaultFolderName(skillId: string, slug: string, origin: SkillDefinition['origin']) {
    return origin === 'built_in_style' ? slug : `${slug}--${skillId.slice(0, 8)}`;
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

    return this.deps.upsertSkill({
      ...skill,
      path: canonicalSkillPath,
      metadata: {
        ...metadata,
        folderName: metadata.folderName ?? this.getDefaultFolderName(skill.id, metadata.slug, skill.origin)
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

    nextSkill = this.deps.upsertSkill({
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

    return this.deps.upsertSkill({
      ...skill,
      metadata: {
        ...metadata,
        syncState: nextSyncState
      }
    });
  }

  private writeProviderSync(skill: SkillDefinition, providerId: ProviderId): SkillSyncState {
    if (providerId === 'openai') {
      return {
        exported: false,
        path: null,
        updatedAt: new Date().toISOString(),
        error: CODEX_APP_HOME_SYNC_BLOCKED_MESSAGE
      };
    }

    const metadata = normalizeSkillMetadata(skill.metadata, skill.name);
    const folderName = metadata.folderName ?? this.getDefaultFolderName(skill.id, metadata.slug, skill.origin);
    const folder = join(this.getProviderRoot(providerId), folderName);
    const path = join(folder, 'SKILL.md');

    try {
      assertOutsideOperatorCodexHome(folder, 'write provider skill export');
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

  private getCanonicalFolder(skill: SkillDefinition, metadata: SkillMetadataShape) {
    const folderName = metadata.folderName ?? this.getDefaultFolderName(skill.id, metadata.slug, skill.origin);
    if (skill.origin === 'built_in_style') {
      return join(this.deps.root, 'built-in', folderName);
    }
    if (skill.scope === 'project' && skill.projectId) {
      return join(this.deps.root, 'project', skill.projectId, folderName);
    }
    return join(this.deps.root, 'user', folderName);
  }
}
