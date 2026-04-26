import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import type { ProviderAccount, ProviderModel } from '../../shared/domain';
import { providerCliAuthLaunch, providerCliCommands, providerCliExecutableName } from '../../shared/providers';
import { getProviderFallbackModels, sanitizeDiscoveredModels } from '../catalog';
import type { ProviderAdapter, ProviderRunCallbacks, ProviderRunContext, ProviderRunHandle } from '../types';
import { detectCliInstall, fileExists, killProcessTree, launchTerminalExecutable } from '../util';
const MODELS: ProviderModel[] = getProviderFallbackModels('qwen');

function normalizeComparableText(value: string) {
  return value.replace(/\s+/gu, ' ').trim().toLowerCase();
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

function collectRawString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readNestedString(record: Record<string, unknown> | null | undefined, path: string[]) {
  let current: unknown = record;
  for (const segment of path) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[segment];
  }

  return typeof current === 'string' && current.trim() ? current.trim() : null;
}

function readSelectedAuthType(settings: Record<string, unknown> | null) {
  return (
    collectString(settings ?? {}, ['selectedAuthType', 'selected_type', 'authType', 'auth_type']) ??
    readNestedString(settings, ['security', 'auth', 'selectedType']) ??
    readNestedString(settings, ['auth', 'selectedType'])
  )?.toLowerCase() ?? '';
}

function readConfiguredModelId(settings: Record<string, unknown> | null) {
  return (
    readNestedString(settings, ['model', 'name']) ??
    collectString(settings ?? {}, ['model', 'name'])
  );
}

function isValidQwenOAuthCredentials(value: unknown): value is {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number;
} {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.access_token === 'string' &&
    value.access_token.trim().length > 0 &&
    typeof value.refresh_token === 'string' &&
    value.refresh_token.trim().length > 0 &&
    typeof value.token_type === 'string' &&
    value.token_type.trim().length > 0 &&
    typeof value.expiry_date === 'number' &&
    Number.isFinite(value.expiry_date) &&
    value.expiry_date > 0
  );
}

function extractAssistantText(event: Record<string, unknown>) {
  const type = collectString(event, ['type', 'event', 'kind'])?.toLowerCase() ?? '';
  const role = collectString(event, ['role'])?.toLowerCase() ?? '';
  const messageType = collectString(event, ['messageType', 'message_type'])?.toLowerCase() ?? '';

  if (role && role !== 'assistant') {
    return null;
  }

  if (type && !/(message|assistant|output|result|response|content|chunk|delta)/u.test(type) && !messageType.includes('assistant')) {
    return null;
  }

  const direct =
    collectRawString(event, ['content', 'text', 'delta', 'message']) ??
    (event.message && typeof event.message === 'object'
      ? collectRawString(event.message as Record<string, unknown>, ['content', 'text'])
      : null);

  if (typeof direct !== 'string') {
    return null;
  }

  return direct.length > 0 ? direct : null;
}

async function readQwenSettings() {
  const settingsPath = join(homedir(), '.qwen', 'settings.json');
  try {
    const raw = await readFile(settingsPath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readQwenOAuthCredentials() {
  const credentialsPath = join(homedir(), '.qwen', 'oauth_creds.json');
  try {
    const raw = await readFile(credentialsPath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function getQwenCredentialFileStatus() {
  const credentialsPath = join(homedir(), '.qwen', 'oauth_creds.json');
  try {
    const details = await stat(credentialsPath);
    return {
      exists: true,
      path: credentialsPath,
      modifiedAt: details.mtime.toISOString()
    };
  } catch {
    return {
      exists: false,
      path: credentialsPath,
      modifiedAt: null
    };
  }
}

export class QwenAdapter implements ProviderAdapter {
  readonly id = 'qwen' as const;
  readonly label = 'Qwen';

  listStaticModels(): ProviderModel[] {
    return MODELS;
  }

  getPlannerCapability() {
    return {
      supported: false,
      executionMode: 'workspace-write' as const,
      enforcement: 'best-effort' as const,
      message: 'Qwen planner mode is not wired into Vicode yet.'
    };
  }

  async discoverApiModels() {
    return null;
  }

  async discoverRuntimeModels() {
    const settings = await readQwenSettings();
    const configuredModel = readConfiguredModelId(settings);
    if (!configuredModel) {
      return null;
    }

    return sanitizeDiscoveredModels('qwen', [
      {
        id: configuredModel,
        label: configuredModel,
        description: 'Model discovered from local Qwen settings.',
        supportsVision: true
      }
    ]);
  }

  async detectInstall() {
    return detectCliInstall(providerCliCommands('qwen'));
  }

  async getAuthState(account: ProviderAccount | null) {
    if (account?.authMode === 'api_key' && account.encryptedApiKey) {
      return {
        authState: 'disconnected' as const,
        authMode: null,
        message: 'Qwen API key auth is not wired into Vicode yet. Use Qwen OAuth sign-in.'
      };
    }

    const settings = await readQwenSettings();
    const credentials = await readQwenOAuthCredentials();
    const settingsPath = join(homedir(), '.qwen', 'settings.json');
    const credentialFile = await getQwenCredentialFileStatus();
    const qwenDirExists = await fileExists(join(homedir(), '.qwen'));
    const selectedAuthType = readSelectedAuthType(settings);
    const hasValidOAuthCredentials = isValidQwenOAuthCredentials(credentials);
    const qwenOAuthSelected = selectedAuthType === 'qwen-oauth' || selectedAuthType === 'oauth';

    if (qwenOAuthSelected && hasValidOAuthCredentials) {
      return {
        authState: 'connected' as const,
        authMode: 'cli' as const,
        message: 'Qwen OAuth is ready on this machine.'
      };
    }

    if (selectedAuthType === 'openai' && credentialFile.exists) {
      return {
        authState: 'detected' as const,
        authMode: 'cli' as const,
        message: `Qwen OAuth credentials were found at ${credentialFile.path}, but the CLI is currently configured for OpenAI-compatible auth. Use /auth in Qwen CLI to switch back to Qwen OAuth.`
      };
    }

    if (qwenOAuthSelected && credentialFile.exists && !hasValidOAuthCredentials) {
      return {
        authState: 'detected' as const,
        authMode: 'cli' as const,
        message: `Qwen OAuth was selected in ${settingsPath}, but ${credentialFile.path} is incomplete or expired. Re-run /auth in Qwen CLI to refresh the saved session.`
      };
    }

    if (settings || qwenDirExists || credentialFile.exists) {
      return {
        authState: 'detected' as const,
        authMode: 'cli' as const,
        message: credentialFile.exists
          ? `Qwen local auth files were detected, including ${credentialFile.path}${credentialFile.modifiedAt ? ` (updated ${credentialFile.modifiedAt})` : ''}. Finish or refresh sign-in from the Qwen CLI if runs are not working yet.`
          : `Qwen settings were detected at ${settingsPath}. Finish OAuth sign-in from the Qwen CLI if runs are not working yet.`
      };
    }

    return {
      authState: 'disconnected' as const,
      authMode: null,
      message: 'Sign in with Qwen OAuth to use the free qwen3.5-plus tier.'
    };
  }

  async startAuth(mode?: 'cli' | 'api_key', cliPath?: string | null) {
    if (mode === 'api_key') {
      throw new Error('Qwen API key auth is not supported in Vicode yet.');
    }

    const authLaunch = providerCliAuthLaunch('qwen');
    await launchTerminalExecutable(
      authLaunch.title ?? 'Qwen Login',
      cliPath ?? providerCliExecutableName('qwen'),
      authLaunch.args
    );
  }

  async clearAuth() {
    return;
  }

  async discoverNativeSkills() {
    return [];
  }

  validateProjectContext(_folderPath: string | null, _trusted: boolean) {
    return { valid: true };
  }

  async startRun(context: ProviderRunContext, callbacks: ProviderRunCallbacks): Promise<ProviderRunHandle> {
    callbacks.onStart();

    const install = await this.detectInstall();
    const executable = install.cliPath ?? providerCliExecutableName('qwen');
    const isolatedRuntime = await this.prepareIsolatedRuntime(context.thinkingEnabled ?? false);
    const args = [
      '-p',
      context.prompt,
      '--model',
      context.modelId,
      '--output-format',
      'stream-json',
      '--include-partial-messages'
    ];

    if (context.folderPath) {
      args.push('--cwd', context.folderPath);
    }

    if (context.resumeSessionId) {
      args.push('--resume', context.resumeSessionId);
    }

    if (context.imageAttachments?.length) {
      callbacks.onInfo('Qwen image attachments are not wired into Vicode yet. Continuing with text only.');
    }

    const approvalMode =
      context.executionPermission === 'full_access'
        ? 'yolo'
        : context.runMode === 'plan'
          ? 'plan'
          : 'default';
    args.push('--approval-mode', approvalMode);

    const child =
      executable.toLowerCase().endsWith('.cmd')
        ? spawn('cmd.exe', ['/d', '/s', '/c', executable, ...args], {
            cwd: context.folderPath ?? process.cwd(),
            windowsHide: true,
            env: {
              ...process.env,
              ...isolatedRuntime.env
            }
          })
        : spawn(executable, args, {
            cwd: context.folderPath ?? process.cwd(),
            windowsHide: true,
            env: {
              ...process.env,
              ...isolatedRuntime.env
            }
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
        const normalized = normalizeComparableText(trimmed);
        if (normalized !== normalizeComparableText(context.prompt)) {
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

        const errorMessage = collectString(event, ['error', 'message']);
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
        void isolatedRuntime.cleanup();
        settleError('Failed to launch Qwen CLI.');
      }
    });

    child.on('close', (code) => {
      if (cancelled) {
        void isolatedRuntime.cleanup();
        return;
      }
      void isolatedRuntime.cleanup();

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

        settleError('Qwen CLI exited successfully without producing assistant output.');
        return;
      }

      if (assistantText.trim()) {
        settleComplete(assistantText.trim());
        return;
      }

      settleError(stderrBuffer.trim() || `Qwen CLI exited with code ${code ?? -1}.`);
    });

    return {
      runId: context.runId,
      child,
      cancel: async (reason) => {
        cancelled = true;
        await killProcessTree(child);
        await isolatedRuntime.cleanup();
        settleAbort(reason ?? 'Qwen run was stopped.');
      }
    };
  }

  private async prepareIsolatedRuntime(thinkingEnabled: boolean) {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'vicode-qwen-home-'));
    const qwenDir = join(runtimeHome, '.qwen');
    const sourceQwenDir = join(homedir(), '.qwen');
    const localAppDataDir = join(runtimeHome, 'AppData', 'Local');
    const roamingAppDataDir = join(runtimeHome, 'AppData', 'Roaming');
    const tempDir = join(localAppDataDir, 'Temp');
    const powerShellCachePath = join(localAppDataDir, 'Microsoft', 'Windows', 'PowerShell', 'ModuleAnalysisCache');

    await mkdir(qwenDir, { recursive: true });
    await mkdir(roamingAppDataDir, { recursive: true });
    await mkdir(tempDir, { recursive: true });
    await mkdir(dirname(powerShellCachePath), { recursive: true });

    if (await fileExists(sourceQwenDir)) {
      await cp(sourceQwenDir, qwenDir, { recursive: true, force: true });
    }

    const settingsPath = join(qwenDir, 'settings.json');
    const currentSettings = (await readQwenSettings()) ?? {};
    const nextSettings = {
      ...currentSettings,
      model: {
        ...(typeof currentSettings.model === 'object' && currentSettings.model ? (currentSettings.model as Record<string, unknown>) : {}),
        generationConfig: {
          ...(
            typeof currentSettings.model === 'object' &&
            currentSettings.model &&
            typeof (currentSettings.model as Record<string, unknown>).generationConfig === 'object' &&
            (currentSettings.model as Record<string, unknown>).generationConfig
              ? ((currentSettings.model as Record<string, unknown>).generationConfig as Record<string, unknown>)
              : {}
          ),
          extra_body: {
            ...(
              typeof currentSettings.model === 'object' &&
              currentSettings.model &&
              typeof (currentSettings.model as Record<string, unknown>).generationConfig === 'object' &&
              (currentSettings.model as Record<string, unknown>).generationConfig &&
              typeof (((currentSettings.model as Record<string, unknown>).generationConfig as Record<string, unknown>).extra_body) === 'object' &&
              (((currentSettings.model as Record<string, unknown>).generationConfig as Record<string, unknown>).extra_body)
                ? ((((currentSettings.model as Record<string, unknown>).generationConfig as Record<string, unknown>).extra_body) as Record<string, unknown>)
                : {}
            ),
            enable_thinking: thinkingEnabled
          }
        }
      }
    };

    await writeFile(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, 'utf8');

    const parsedHome = parse(runtimeHome);
    return {
      cleanup: async () => {
        await rm(runtimeHome, { recursive: true, force: true }).catch(() => undefined);
      },
      env: {
        HOME: runtimeHome,
        USERPROFILE: runtimeHome,
        HOMEDRIVE: parsedHome.root.replace(/[\\\/]+$/u, ''),
        HOMEPATH: runtimeHome.slice(parsedHome.root.length - 1),
        APPDATA: roamingAppDataDir,
        LOCALAPPDATA: localAppDataDir,
        TEMP: tempDir,
        TMP: tempDir,
        PSModuleAnalysisCachePath: powerShellCachePath
      }
    };
  }
}
