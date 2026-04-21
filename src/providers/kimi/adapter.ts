import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProviderAccount, ProviderModel } from '../../shared/domain';
import {
  providerCliAuthLaunch,
  providerCliCommands,
  providerCliExecutableName,
  providerCliLogoutLaunch
} from '../../shared/providers';
import { getProviderFallbackModels, sanitizeDiscoveredModels } from '../catalog';
import type { ProviderAdapter, ProviderRunCallbacks, ProviderRunContext, ProviderRunHandle } from '../types';
import { detectCliInstall, fileExists, killProcessTree, launchTerminalExecutable } from '../util';
const MODELS: ProviderModel[] = getProviderFallbackModels('kimi');
const KIMI_CONFIG_PATH = join(homedir(), '.kimi', 'config.toml');

interface KimiConfigProvider {
  id: string;
  type: string | null;
  baseUrl: string | null;
  apiKey: string | null;
}

interface KimiConfigModel {
  id: string;
  provider: string | null;
  model: string | null;
  capabilities: string[];
}

interface ParsedKimiConfig {
  providers: KimiConfigProvider[];
  models: KimiConfigModel[];
}

function normalizeComparableText(value: string) {
  return value.replace(/\s+/gu, ' ').trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function cleanJsonText(value: string) {
  return value.replace(/\r\n/g, '\n').trim();
}

function collectContentStrings(value: unknown, depth = 0, maxDepth = 4, results: string[] = []) {
  if (depth > maxDepth || value == null) {
    return results;
  }

  if (typeof value === 'string') {
    const cleaned = cleanJsonText(value);
    if (cleaned) {
      results.push(cleaned);
    }
    return results;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectContentStrings(entry, depth + 1, maxDepth, results);
    }
    return results;
  }

  if (!isRecord(value)) {
    return results;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (key === 'type' || key === 'role' || key === 'kind') {
      continue;
    }

    if (key === 'text' || key === 'content' || key === 'message' || key === 'output') {
      collectContentStrings(entry, depth + 1, maxDepth, results);
      continue;
    }

    if (Array.isArray(entry) || isRecord(entry)) {
      collectContentStrings(entry, depth + 1, maxDepth, results);
    }
  }

  return results;
}

function extractAssistantText(event: unknown) {
  const candidate = isRecord(event) ? event : null;
  if (!candidate) {
    return null;
  }

  const status = collectString(candidate, ['status'])?.toLowerCase() ?? '';
  if (status.includes('error') || status.includes('fail')) {
    return null;
  }

  const role = collectString(candidate, ['role'])?.toLowerCase() ?? '';
  if (role && role !== 'assistant') {
    return null;
  }

  const type = collectString(candidate, ['type', 'event', 'kind', 'messageType', 'message_type'])?.toLowerCase() ?? '';
  if (type && !/(assistant|message|output|result|response|content|delta|chunk|final)/u.test(type)) {
    return null;
  }

  const direct = collectString(candidate, ['content', 'text', 'delta', 'message', 'output']);
  if (direct) {
    return direct;
  }

  const nested = collectContentStrings(candidate)
    .filter(Boolean)
    .join('\n')
    .trim();

  return nested || null;
}

function parseTomlString(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const quoted = trimmed.match(/^"(.*)"$/u) ?? trimmed.match(/^'(.*)'$/u);
  if (quoted) {
    return quoted[1].replace(/\\"/gu, '"').trim();
  }

  return trimmed;
}

function parseTomlStringArray(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return [];
  }

  const matches = [...trimmed.matchAll(/"([^"]+)"|'([^']+)'/gu)];
  return matches
    .map((match) => (match[1] ?? match[2] ?? '').trim())
    .filter(Boolean);
}

function parseSectionId(rawValue: string) {
  return rawValue
    .trim()
    .replace(/^["']|["']$/gu, '');
}

function parseKimiConfig(source: string): ParsedKimiConfig {
  const providers = new Map<string, KimiConfigProvider>();
  const models = new Map<string, KimiConfigModel>();
  let currentSection: { kind: 'provider' | 'model'; id: string } | null = null;

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const sectionMatch = line.match(/^\[(providers|models)\.([^\]]+)\]$/u);
    if (sectionMatch) {
      const kind = sectionMatch[1] === 'providers' ? 'provider' : 'model';
      const id = parseSectionId(sectionMatch[2]);
      currentSection = { kind, id };
      if (kind === 'provider') {
        providers.set(id, providers.get(id) ?? { id, type: null, baseUrl: null, apiKey: null });
      } else {
        models.set(id, models.get(id) ?? { id, provider: null, model: null, capabilities: [] });
      }
      continue;
    }

    if (!currentSection) {
      continue;
    }

    const entryMatch = rawLine.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+)\s*$/u);
    if (!entryMatch) {
      continue;
    }

    const key = entryMatch[1];
    const rawValue = entryMatch[2].trim();

    if (currentSection.kind === 'provider') {
      const provider = providers.get(currentSection.id);
      if (!provider) {
        continue;
      }

      if (key === 'type') {
        provider.type = parseTomlString(rawValue);
      } else if (key === 'base_url') {
        provider.baseUrl = parseTomlString(rawValue);
      } else if (key === 'api_key') {
        provider.apiKey = parseTomlString(rawValue);
      }
      continue;
    }

    const model = models.get(currentSection.id);
    if (!model) {
      continue;
    }

    if (key === 'provider') {
      model.provider = parseTomlString(rawValue);
    } else if (key === 'model') {
      model.model = parseTomlString(rawValue);
    } else if (key === 'capabilities') {
      model.capabilities = parseTomlStringArray(rawValue).map((entry) => entry.toLowerCase());
    }
  }

  return {
    providers: [...providers.values()],
    models: [...models.values()]
  };
}

async function readKimiConfig() {
  try {
    const raw = await readFile(KIMI_CONFIG_PATH, 'utf8');
    return parseKimiConfig(raw);
  } catch {
    return null;
  }
}

function buildKimiModelDescription(model: KimiConfigModel) {
  const notes: string[] = ['Model discovered from local Kimi config.'];
  if (model.capabilities.includes('thinking')) {
    notes.push('Supports thinking mode.');
  }
  if (model.capabilities.includes('always_thinking')) {
    notes.push('Always uses thinking mode.');
  }
  if (model.capabilities.includes('image_in')) {
    notes.push('Supports image input.');
  }
  return notes.join(' ');
}

export class KimiAdapter implements ProviderAdapter {
  readonly id = 'kimi' as const;
  readonly label = 'Kimi';

  listStaticModels(): ProviderModel[] {
    return MODELS;
  }

  getPlannerCapability() {
    return {
      supported: false,
      executionMode: 'workspace-write' as const,
      enforcement: 'best-effort' as const,
      message: 'Kimi planner mode is not wired into Vicode yet.'
    };
  }

  async discoverApiModels() {
    return null;
  }

  async discoverRuntimeModels() {
    const config = await readKimiConfig();
    if (!config) {
      return null;
    }

    const kimiProviderIds = new Set(
      config.providers
        .filter((provider) => provider.type?.toLowerCase() === 'kimi')
        .map((provider) => provider.id)
    );

    const discovered = config.models
      .filter((model) => model.provider && kimiProviderIds.has(model.provider))
      .map((model) => ({
        id: model.id,
        label: model.id,
        description: buildKimiModelDescription(model),
        supportsVision: model.capabilities.includes('image_in')
      }));

    return discovered.length > 0 ? sanitizeDiscoveredModels('kimi', discovered) : null;
  }

  async detectInstall() {
    return detectCliInstall(providerCliCommands('kimi'));
  }

  async getAuthState(account: ProviderAccount | null) {
    if (account?.authMode === 'api_key' && account.encryptedApiKey) {
      return {
        authState: 'disconnected' as const,
        authMode: null,
        message: 'Kimi API key auth is not wired into Vicode yet. Use `kimi login` or configure ~/.kimi/config.toml.'
      };
    }

    const config = await readKimiConfig();
    const kimiDirExists = await fileExists(join(homedir(), '.kimi'));
    const configExists = await fileExists(KIMI_CONFIG_PATH);
    const hasKimiProvider = Boolean(config?.providers.some((provider) => provider.type?.toLowerCase() === 'kimi'));
    const hasKimiModels = Boolean(
      config?.models.some((model) =>
        model.provider
          ? config.providers.some((provider) => provider.id === model.provider && provider.type?.toLowerCase() === 'kimi')
          : false
      )
    );

    if (hasKimiProvider && (hasKimiModels || configExists)) {
      return {
        authState: 'connected' as const,
        authMode: 'cli' as const,
        message:
          'Kimi Code CLI is configured on this machine. Note: Vicode uses Kimi non-interactively, and the official CLI documents that print mode implies auto-approval.'
      };
    }

    if (configExists || kimiDirExists) {
      return {
        authState: 'detected' as const,
        authMode: 'cli' as const,
        message: `Kimi config files were detected at ${KIMI_CONFIG_PATH}. Finish Kimi login or configure a Kimi provider in config.toml if runs are not working yet.`
      };
    }

    return {
      authState: 'disconnected' as const,
      authMode: null,
      message: 'Sign in with `kimi login` to configure Kimi Code CLI on this machine.'
    };
  }

  async startAuth(mode?: 'cli' | 'api_key', cliPath?: string | null) {
    if (mode === 'api_key') {
      throw new Error('Kimi API key auth is not supported in Vicode yet.');
    }

    const authLaunch = providerCliAuthLaunch('kimi');
    await launchTerminalExecutable(
      authLaunch.title ?? 'Kimi Login',
      cliPath ?? providerCliExecutableName('kimi'),
      authLaunch.args
    );
  }

  async clearAuth() {
    const logoutLaunch = providerCliLogoutLaunch('kimi');
    await launchTerminalExecutable(
      logoutLaunch.title ?? 'Kimi Logout',
      providerCliExecutableName('kimi'),
      logoutLaunch.args
    );
  }

  async discoverNativeSkills() {
    return [];
  }

  validateProjectContext(folderPath: string | null, trusted: boolean) {
    if (folderPath && !trusted) {
      return {
        valid: false,
        message: 'Project folder must be trusted before Kimi provider runs.'
      };
    }

    return { valid: true };
  }

  async startRun(context: ProviderRunContext, callbacks: ProviderRunCallbacks): Promise<ProviderRunHandle> {
    callbacks.onStart();

    const install = await this.detectInstall();
    const executable = install.cliPath ?? providerCliExecutableName('kimi');
    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--prompt',
      context.prompt,
      '--model',
      context.modelId,
      '--yolo'
    ];

    if (context.folderPath) {
      args.push('--work-dir', context.folderPath);
    }

    if (context.resumeSessionId) {
      args.push('--session', context.resumeSessionId);
    }

    if (context.imageAttachments?.length) {
      callbacks.onInfo('Kimi image attachments are not wired into Vicode yet. Continuing with text only.');
    }

    const child =
      executable.toLowerCase().endsWith('.cmd')
        ? spawn('cmd.exe', ['/d', '/s', '/c', executable, ...args], {
            cwd: context.folderPath ?? process.cwd(),
            windowsHide: true
          })
        : spawn(executable, args, {
            cwd: context.folderPath ?? process.cwd(),
            windowsHide: true
          });

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let assistantText = '';
    let cancelled = false;
    let settled = false;

    const settleComplete = (output: string) => {
      if (settled) {
        return;
      }
      settled = true;
      callbacks.onComplete(output);
    };

    const settleError = (message: string) => {
      if (settled) {
        return;
      }
      settled = true;
      callbacks.onError(message);
    };

    const settleAbort = (message?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      callbacks.onAbort(message);
    };

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      if (!trimmed.startsWith('{')) {
        if (normalizeComparableText(trimmed) !== normalizeComparableText(context.prompt)) {
          callbacks.onInfo(trimmed);
        }
        return;
      }

      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;
        const nextAssistantText = extractAssistantText(event);
        if (nextAssistantText) {
          assistantText += nextAssistantText;
          callbacks.onDelta(nextAssistantText);
          return;
        }

        const errorMessage =
          collectString(event, ['error', 'message']) ??
          (isRecord(event.error) ? collectString(event.error, ['message']) : null);
        const status = collectString(event, ['status'])?.toLowerCase() ?? '';
        if (errorMessage && (status.includes('error') || status.includes('fail'))) {
          callbacks.onError(errorMessage);
          return;
        }

        const infoText = collectString(event, ['message', 'summary', 'text']);
        if (infoText) {
          callbacks.onInfo(infoText);
        }
      } catch {
        callbacks.onInfo(trimmed);
      }
    };

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += String(chunk);
      const lines = stdoutBuffer.split(/\r?\n/u);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        processLine(line);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrBuffer += String(chunk);
      const lines = stderrBuffer.split(/\r?\n/u);
      stderrBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          callbacks.onInfo(trimmed);
        }
      }
    });

    child.on('error', () => {
      if (!cancelled) {
        settleError('Failed to launch Kimi CLI.');
      }
    });

    child.on('close', (code) => {
      if (cancelled) {
        return;
      }

      if (stdoutBuffer.trim()) {
        processLine(stdoutBuffer);
      }
      if (stderrBuffer.trim()) {
        callbacks.onInfo(stderrBuffer.trim());
      }

      if (code === 0) {
        if (assistantText.trim()) {
          settleComplete(assistantText.trim());
          return;
        }

        settleError('Kimi CLI exited successfully without producing assistant output.');
        return;
      }

      if (assistantText.trim()) {
        settleComplete(assistantText.trim());
        return;
      }

      settleError(stderrBuffer.trim() || `Kimi CLI exited with code ${code ?? -1}.`);
    });

    return {
      runId: context.runId,
      child,
      cancel: async (reason) => {
        cancelled = true;
        await killProcessTree(child);
        settleAbort(reason ?? 'Kimi run was stopped.');
      }
    };
  }
}
