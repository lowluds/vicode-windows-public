import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { McpServerView, SkillDefinition } from '../../shared/domain';
import {
  readStringArgument
} from './agent-runtime-arguments';

const MAX_BUNDLE_FILES = 16;
const MAX_BUNDLE_FILE_CHARS = 256 * 1024;

export type VicodeCreatorBundleScope = 'global' | 'project';

export interface VicodeCreatorBundleFileInput {
  path: string;
  content: string;
}

export interface VicodeCreatorBundleInput {
  scope: VicodeCreatorBundleScope;
  projectId: string | null;
  folderName: string;
  files: VicodeCreatorBundleFileInput[];
}

export interface VicodeCreatorBundleResult {
  scope: VicodeCreatorBundleScope;
  projectId: string | null;
  folderName: string;
  relativeRootPath: string;
  filePaths: string[];
  existed: boolean;
  importedId: string | null;
}

export interface AgentRuntimeVicodeCreatorBridge {
  createSkillBundle(input: VicodeCreatorBundleInput): Promise<VicodeCreatorBundleResult>;
  createPluginBundle(input: VicodeCreatorBundleInput): Promise<VicodeCreatorBundleResult>;
}

function readScope(raw: unknown, toolName: string): VicodeCreatorBundleScope {
  if (raw === 'global' || raw === 'project') {
    return raw;
  }

  throw new Error(`${toolName} requires scope to be "global" or "project".`);
}

function normalizeFolderName(raw: string, toolName: string) {
  const value = raw.trim();
  if (!value) {
    throw new Error(`${toolName} requires a non-empty folder_name.`);
  }
  if (value === '.' || value === '..' || /[\\/]/u.test(value)) {
    throw new Error(`${toolName} folder_name must be one folder name, not a path.`);
  }
  if (/[\u0000-\u001f]/u.test(value)) {
    throw new Error(`${toolName} folder_name contains unsupported control characters.`);
  }
  return value;
}

function normalizeBundleFilePath(
  bundleRoot: string,
  rawPath: string,
  toolName: string
) {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error(`${toolName} file paths must be non-empty.`);
  }

  const absolutePath = resolve(bundleRoot, trimmed);
  const relativePath = relative(bundleRoot, absolutePath);
  if (!relativePath || relativePath === '.') {
    throw new Error(`${toolName} file paths must point to files inside the bundle.`);
  }
  if (relativePath.startsWith('..')) {
    throw new Error(`${toolName} file paths must stay inside the bundle root.`);
  }

  return {
    absolutePath,
    relativePath: relativePath.replace(/\\/gu, '/')
  };
}

function readFilesArgument(args: Record<string, unknown>, toolName: string) {
  const rawFiles = args.files;
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    throw new Error(`${toolName} requires a non-empty files array.`);
  }
  if (rawFiles.length > MAX_BUNDLE_FILES) {
    throw new Error(`${toolName} can write at most ${MAX_BUNDLE_FILES} files per bundle.`);
  }

  const files: VicodeCreatorBundleFileInput[] = [];
  for (let index = 0; index < rawFiles.length; index += 1) {
    const entry = rawFiles[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${toolName} file ${index + 1} must be an object.`);
    }

    const path = typeof (entry as { path?: unknown }).path === 'string'
      ? (entry as { path: string }).path
      : '';
    const content = typeof (entry as { content?: unknown }).content === 'string'
      ? (entry as { content: string }).content
      : null;
    if (!path.trim()) {
      throw new Error(`${toolName} file ${index + 1} requires a path.`);
    }
    if (content === null) {
      throw new Error(`${toolName} file ${index + 1} requires string content.`);
    }
    if (content.length > MAX_BUNDLE_FILE_CHARS) {
      throw new Error(`${toolName} file ${index + 1} exceeds the size limit.`);
    }

    files.push({
      path,
      content
    });
  }

  return files;
}

function validateJsonObjectFile(
  filePath: string,
  content: string,
  toolName: string,
  options: {
    requiredStringKeys?: string[];
    requireCommand?: boolean;
  } = {}
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`${toolName} file ${filePath} must contain valid JSON.`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${toolName} file ${filePath} must contain a JSON object.`);
  }

  const candidate = parsed as Record<string, unknown>;
  for (const key of options.requiredStringKeys ?? []) {
    const value = candidate[key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${toolName} file ${filePath} must include a non-empty ${key} string.`);
    }
  }

  if (options.requireCommand) {
    const root =
      candidate.mcpServer && typeof candidate.mcpServer === 'object'
        ? candidate.mcpServer as Record<string, unknown>
        : candidate.server && typeof candidate.server === 'object'
          ? candidate.server as Record<string, unknown>
          : candidate;
    if (typeof root.command !== 'string' || !root.command.trim()) {
      throw new Error(`${toolName} file ${filePath} must include a non-empty command string.`);
    }
  }
}

function validateSkillBundleInput(
  input: VicodeCreatorBundleInput,
  toolName: string
) {
  const filePathSet = new Set(input.files.map((file) => file.path.trim()));
  if (!filePathSet.has('SKILL.md')) {
    throw new Error(`${toolName} requires files to include SKILL.md.`);
  }

  const metadataFile = input.files.find((file) => file.path.trim() === '.vicode-skill.json');
  if (metadataFile) {
    validateJsonObjectFile('.vicode-skill.json', metadataFile.content, toolName);
  }
}

function validatePluginBundleInput(
  input: VicodeCreatorBundleInput,
  toolName: string
) {
  const manifestFile = input.files.find(
    (file) => file.path.trim() === '.codex-plugin/plugin.json'
  );
  if (!manifestFile) {
    throw new Error(`${toolName} requires files to include .codex-plugin/plugin.json.`);
  }
  validateJsonObjectFile(
    '.codex-plugin/plugin.json',
    manifestFile.content,
    toolName,
    { requiredStringKeys: ['name', 'description'] }
  );

  const mcpFile = input.files.find((file) => file.path.trim() === '.mcp.json');
  if (!mcpFile) {
    throw new Error(`${toolName} requires files to include .mcp.json.`);
  }
  validateJsonObjectFile('.mcp.json', mcpFile.content, toolName, { requireCommand: true });
}

function parseBundleInput(
  args: Record<string, unknown>,
  toolName: string
): VicodeCreatorBundleInput {
  const scope = readScope(args.scope, toolName);
  const projectIdRaw =
    typeof args.project_id === 'string' && args.project_id.trim()
      ? args.project_id.trim()
      : null;
  if (scope === 'project' && !projectIdRaw) {
    throw new Error(`${toolName} requires project_id when scope is "project".`);
  }

  return {
    scope,
    projectId: scope === 'project' ? projectIdRaw : null,
    folderName: normalizeFolderName(readStringArgument(args, 'folder_name'), toolName),
    files: readFilesArgument(args, toolName)
  };
}

function writeBundleFiles(
  bundleRoot: string,
  input: VicodeCreatorBundleInput,
  toolName: string
) {
  const existed = existsSync(bundleRoot);
  const writtenFilePaths: string[] = [];

  mkdirSync(bundleRoot, { recursive: true });
  for (const file of input.files) {
    const resolved = normalizeBundleFilePath(bundleRoot, file.path, toolName);
    mkdirSync(dirname(resolved.absolutePath), { recursive: true });
    writeFileSync(resolved.absolutePath, file.content, 'utf8');
    writtenFilePaths.push(resolved.relativePath);
  }

  return {
    existed,
    writtenFilePaths
  };
}

function resolveScopeRoot(baseRoot: string, input: VicodeCreatorBundleInput) {
  return input.scope === 'project'
    ? join(baseRoot, 'project', input.projectId ?? 'missing', input.folderName)
    : join(baseRoot, 'user', input.folderName);
}

function buildRelativeRootPath(kind: 'skill' | 'plugin', input: VicodeCreatorBundleInput) {
  const scopePath =
    input.scope === 'project'
      ? `project/${input.projectId ?? 'missing'}/${input.folderName}`
      : `user/${input.folderName}`;
  return `${kind === 'skill' ? 'skills' : 'plugins'}/${scopePath}`;
}

export function parseSkillBundleToolInput(args: Record<string, unknown>) {
  const input = parseBundleInput(args, 'create_skill_bundle');
  validateSkillBundleInput(input, 'create_skill_bundle');
  return input;
}

export function parsePluginBundleToolInput(args: Record<string, unknown>) {
  const input = parseBundleInput(args, 'create_plugin_bundle');
  validatePluginBundleInput(input, 'create_plugin_bundle');
  return input;
}

export function createAgentRuntimeVicodeCreatorBridge(input: {
  statePath: string;
  skills: {
    refreshSkillsFromDisk(): void;
    listSkills(): Promise<SkillDefinition[]>;
  };
  mcp: {
    syncImports(): Promise<void>;
    listServerViews(): McpServerView[];
  };
}): AgentRuntimeVicodeCreatorBridge {
  const skillBaseRoot = join(input.statePath, 'skills');
  const pluginBaseRoot = join(input.statePath, 'plugins');

  return {
    async createSkillBundle(bundle) {
      const bundleRoot = resolveScopeRoot(skillBaseRoot, bundle);
      const { existed, writtenFilePaths } = writeBundleFiles(
        bundleRoot,
        bundle,
        'create_skill_bundle'
      );
      input.skills.refreshSkillsFromDisk();
      const skills = await input.skills.listSkills();
      const imported = skills.find((skill) => {
        if (!skill.path) {
          return false;
        }

        const normalizedPath = resolve(skill.path);
        return normalizedPath.startsWith(resolve(bundleRoot));
      }) ?? null;

      if (!imported) {
        throw new Error(
          'Skill bundle was written, but Vicode did not detect it. Check that SKILL.md and any metadata are valid.'
        );
      }

      return {
        scope: bundle.scope,
        projectId: bundle.projectId,
        folderName: bundle.folderName,
        relativeRootPath: buildRelativeRootPath('skill', bundle),
        filePaths: writtenFilePaths,
        existed,
        importedId: imported.id
      };
    },
    async createPluginBundle(bundle) {
      const bundleRoot = resolveScopeRoot(pluginBaseRoot, bundle);
      const { existed, writtenFilePaths } = writeBundleFiles(
        bundleRoot,
        bundle,
        'create_plugin_bundle'
      );
      await input.mcp.syncImports();
      const expectedId =
        bundle.scope === 'project'
          ? `file-plugin:project:${bundle.projectId ?? 'missing'}:${bundle.folderName}`
          : `file-plugin:global:${bundle.folderName}`;
      const imported = input.mcp.listServerViews().find((server) => server.id === expectedId) ?? null;

      if (!imported) {
        throw new Error(
          'Plugin bundle was written, but Vicode did not import it. Check .codex-plugin/plugin.json and .mcp.json.'
        );
      }

      return {
        scope: bundle.scope,
        projectId: bundle.projectId,
        folderName: bundle.folderName,
        relativeRootPath: buildRelativeRootPath('plugin', bundle),
        filePaths: writtenFilePaths,
        existed,
        importedId: imported.id
      };
    }
  };
}
