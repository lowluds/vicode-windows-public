import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileExists, runHiddenExecutable } from '../../providers/util';
import type { ProviderAdapter } from '../../providers/types';
import { PROVIDER_IDS, type ProviderId, type SkillCategory, type SkillDefinition, type SkillInstallResult, type SkillSaveInput } from '../../shared/domain';
import { normalizeSkillMetadata } from '../../shared/skills';
import type { DatabaseService } from '../../storage/database';
import { parseSkillMarkdown } from './skill-markdown';

function ensureDirectory(path: string) {
  mkdirSync(path, { recursive: true });
}

function safeDelete(path: string) {
  rmSync(path, { recursive: true, force: true });
}

type SkillInstallInput = {
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
};

type SkillInstallDependencies = {
  root: string;
  db: Pick<DatabaseService, 'upsertSkill'>;
  adapters: Record<ProviderId, ProviderAdapter>;
  saveSkill: (input: SkillSaveInput) => SkillDefinition;
  refreshSkillsFromDisk: () => void;
  refreshProviderNativeSkills: () => Promise<void>;
};

export class SkillInstallService {
  constructor(private readonly deps: SkillInstallDependencies) {}

  async installSuggestedSkill(input: SkillInstallInput): Promise<SkillInstallResult> {
    if (input.installKind === 'github_folder') {
      return await this.installGithubSkill(input);
    }

    if (input.providerId === 'openai') {
      throw new Error(
        'Vicode does not install provider-native Codex skills into the Codex app home. Import the skill as a Vicode-managed GitHub skill or install it from Codex.'
      );
    }

    if (input.providerId === 'gemini') {
      const result = await this.installGeminiExtension(input.installTarget ?? null);
      this.deps.refreshSkillsFromDisk();
      return result;
    }

    if (input.providerId === 'qwen') {
      throw new Error('Qwen provider-native installs are not supported in Vicode yet.');
    }

    if (input.providerId === 'kimi') {
      throw new Error('Kimi provider-native installs are not supported in Vicode yet.');
    }

    throw new Error('Missing provider for provider-native install.');
  }

  private async installGeminiExtension(installTarget: string | null): Promise<SkillInstallResult> {
    if (!installTarget) {
      throw new Error('Missing Gemini extension install target.');
    }

    const install = await this.deps.adapters.gemini.detectInstall();
    if (!install.cliPath) {
      throw new Error('Gemini CLI is required before installing Gemini extensions.');
    }

    const installRoot = join(homedir(), '.gemini', 'extensions');
    const command = await this.resolveGeminiInstallCommand(install.cliPath, ['extensions', 'install', installTarget, '--consent']);
    await runHiddenExecutable(command.executable, command.args);
    await this.deps.refreshProviderNativeSkills();
    return {
      status: 'completed',
      providerId: 'gemini',
      installPath: installRoot,
      message: `Installed Gemini extension under ${installRoot}.`
    };
  }

  private async installGithubSkill(input: SkillInstallInput): Promise<SkillInstallResult> {
    const owner = input.owner?.trim();
    const repo = input.repo?.trim();
    const repoPath = input.path?.trim().replace(/^\/+|\/+$/g, '');
    if (!owner || !repo || !repoPath) {
      throw new Error('Missing GitHub skill source.');
    }

    const importDir = join(this.deps.root, '.imports', `${input.token}--${randomUUID().slice(0, 8)}`);
    ensureDirectory(importDir);

    try {
      await this.downloadGithubDirectoryRecursive(owner, repo, repoPath, importDir);
      const skillFilePath = join(importDir, 'SKILL.md');
      if (!existsSync(skillFilePath)) {
        throw new Error('Imported skill is missing SKILL.md.');
      }

      const markdown = readFileSync(skillFilePath, 'utf8');
      const parsed = parseSkillMarkdown(
        markdown,
        input.name?.trim() || input.token,
        input.description?.trim() || 'Imported skill.'
      );
      const saved = this.deps.saveSkill({
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
      const updated = this.deps.db.upsertSkill({
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
