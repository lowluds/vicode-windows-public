import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { RuntimeCommandIsolationMode } from '../shared/domain';
import isolatedCommandRunnerModulePath from '../main/workers/isolated-command-runner?modulePath';
import type {
  IsolatedCommandRunnerRequest,
  IsolatedCommandRunnerResponse
} from '../main/workers/isolated-command-runner-protocol';

const WINDOWS_PROCESS_SET_QUOTA = 0x0100;
const WINDOWS_PROCESS_TERMINATE = 0x0001;
const WINDOWS_JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
const WINDOWS_JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9;

interface WindowsJobObjectBindings {
  koffi: typeof import('koffi');
  createJobObject: (securityAttributes: null, name: null) => unknown;
  setInformationJobObject: (
    jobHandle: unknown,
    informationClass: number,
    information: Record<string, unknown>,
    informationLength: number
  ) => boolean;
  openProcess: (desiredAccess: number, inheritHandle: boolean, processId: number) => unknown;
  assignProcessToJobObject: (jobHandle: unknown, processHandle: unknown) => boolean;
  closeHandle: (handle: unknown) => boolean;
  getLastError: () => number;
  extendedLimitInformationType: unknown;
}

interface WindowsJobObjectHandle {
  close: () => void;
}

interface UtilityProcessLike {
  pid: number | undefined;
  postMessage: (message: IsolatedCommandRunnerRequest) => void;
  kill: () => boolean;
  on(event: 'spawn', listener: () => void): this;
  on(event: 'message', listener: (message: IsolatedCommandRunnerResponse) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  on(event: 'error', listener: (type: 'FatalError', location: string, report: string) => void): this;
}

export interface CommandSessionProcessLike extends NodeJS.EventEmitter {
  pid: number | undefined;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close', listener: (code: number | null) => void): this;
}

let windowsJobObjectBindingsPromise: Promise<WindowsJobObjectBindings | null> | null = null;

export async function commandExists(command: string): Promise<string | null> {
  return await new Promise((resolve) => {
    const child = spawn('where.exe', [command], {
      windowsHide: true
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code === 0) {
        const [first] = output.split(/\r?\n/).filter(Boolean);
        resolve(first ?? null);
        return;
      }
      resolve(null);
    });
  });
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function findCommonWindowsCliShim(commands: string[]) {
  const appData = process.env.APPDATA;
  const userProfile = process.env.USERPROFILE;
  const candidatePaths = unique(
    commands.flatMap((command) => {
      const lower = command.toLowerCase();
      const fileNames =
        lower.endsWith('.cmd') || lower.endsWith('.exe')
          ? [command]
          : [`${command}.cmd`, `${command}.exe`, command];
      return [
        ...fileNames.map((fileName) => (appData ? join(appData, 'npm', fileName) : null)),
        ...fileNames.map((fileName) => (userProfile ? join(userProfile, 'AppData', 'Roaming', 'npm', fileName) : null))
      ];
    })
  );

  for (const candidate of candidatePaths) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function detectCliInstall(commandNames: string | string[]): Promise<{ installed: boolean; cliPath: string | null }> {
  const candidates = Array.isArray(commandNames) ? commandNames : [commandNames];
  let cliPath: string | null = null;

  for (const candidate of candidates) {
    cliPath = (await commandExists(candidate)) ?? cliPath;
    if (cliPath) {
      break;
    }
  }

  if (!cliPath) {
    cliPath = await findCommonWindowsCliShim(candidates);
  }

  return {
    installed: Boolean(cliPath),
    cliPath
  };
}

export function quotePowerShellArg(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

export function appendAssistantTextChunk(current: string, chunk: string) {
  if (!current) {
    return chunk;
  }

  if (!chunk) {
    return current;
  }

  return current + chunk;
}

export function getWindowsCmdExecutable() {
  const configured = process.env.ComSpec || process.env.COMSPEC;
  if (configured && isAbsolute(configured)) {
    return configured;
  }

  return join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
}

function getWindowsPowerShellExecutable() {
  const windowsPowerShell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (existsSync(windowsPowerShell)) {
    return windowsPowerShell;
  }

  const powerShell7 = join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
  if (existsSync(powerShell7)) {
    return powerShell7;
  }

  const powerShell6 = join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '6', 'pwsh.exe');
  if (existsSync(powerShell6)) {
    return powerShell6;
  }

  return windowsPowerShell;
}

function withNormalizedWindowsShellEnv(env: NodeJS.ProcessEnv | undefined) {
  const cmdExecutable = (() => {
    const configured = env?.ComSpec || env?.COMSPEC;
    if (configured && isAbsolute(configured)) {
      return configured;
    }
    return getWindowsCmdExecutable();
  })();
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const configuredComSpec = env?.ComSpec && isAbsolute(env.ComSpec) ? env.ComSpec : null;
  const configuredCOMSPEC = env?.COMSPEC && isAbsolute(env.COMSPEC) ? env.COMSPEC : null;

  return {
    ...env,
    ComSpec: configuredComSpec || configuredCOMSPEC || cmdExecutable,
    COMSPEC: configuredCOMSPEC || configuredComSpec || cmdExecutable,
    SystemRoot: env?.SystemRoot || systemRoot
  };
}

async function removeDirectoryWithRetry(path: string, attempts = 5) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }

  if (lastError) {
    throw lastError;
  }
}

function isNullWindowsHandle(koffi: typeof import('koffi'), handle: unknown) {
  if (handle == null) {
    return true;
  }

  try {
    return koffi.address(handle) === 0n;
  } catch {
    return false;
  }
}

function createWindowsError(errorCode: number, message: string) {
  return new Error(`${message} (Win32 error ${errorCode}).`);
}

async function getWindowsJobObjectBindings(): Promise<WindowsJobObjectBindings | null> {
  if (process.platform !== 'win32') {
    return null;
  }

  if (windowsJobObjectBindingsPromise) {
    return await windowsJobObjectBindingsPromise;
  }

  windowsJobObjectBindingsPromise = (async () => {
    const koffi = await import('koffi');
    const kernel32 = koffi.load('kernel32.dll');
    const HANDLE = koffi.pointer('HANDLE', koffi.opaque('HANDLE_OPAQUE'));
    const JOBOBJECT_BASIC_LIMIT_INFORMATION = koffi.struct('JOBOBJECT_BASIC_LIMIT_INFORMATION', {
      PerProcessUserTimeLimit: 'int64_t',
      PerJobUserTimeLimit: 'int64_t',
      LimitFlags: 'uint32_t',
      MinimumWorkingSetSize: 'size_t',
      MaximumWorkingSetSize: 'size_t',
      ActiveProcessLimit: 'uint32_t',
      Affinity: 'uintptr_t',
      PriorityClass: 'uint32_t',
      SchedulingClass: 'uint32_t'
    });
    const IO_COUNTERS = koffi.struct('IO_COUNTERS', {
      ReadOperationCount: 'uint64_t',
      WriteOperationCount: 'uint64_t',
      OtherOperationCount: 'uint64_t',
      ReadTransferCount: 'uint64_t',
      WriteTransferCount: 'uint64_t',
      OtherTransferCount: 'uint64_t'
    });
    const JOBOBJECT_EXTENDED_LIMIT_INFORMATION = koffi.struct(
      'JOBOBJECT_EXTENDED_LIMIT_INFORMATION',
      {
        BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION,
        IoInfo: IO_COUNTERS,
        ProcessMemoryLimit: 'size_t',
        JobMemoryLimit: 'size_t',
        PeakProcessMemoryUsed: 'size_t',
        PeakJobMemoryUsed: 'size_t'
      }
    );

    return {
      koffi,
      createJobObject: kernel32.func('__stdcall', 'CreateJobObjectW', HANDLE, ['void *', 'void *']) as (
        securityAttributes: null,
        name: null
      ) => unknown,
      setInformationJobObject: kernel32.func(
        '__stdcall',
        'SetInformationJobObject',
        'bool',
        [HANDLE, 'int', koffi.pointer(JOBOBJECT_EXTENDED_LIMIT_INFORMATION), 'uint32_t']
      ) as (
        jobHandle: unknown,
        informationClass: number,
        information: Record<string, unknown>,
        informationLength: number
      ) => boolean,
      openProcess: kernel32.func('__stdcall', 'OpenProcess', HANDLE, ['uint32_t', 'bool', 'uint32_t']) as (
        desiredAccess: number,
        inheritHandle: boolean,
        processId: number
      ) => unknown,
      assignProcessToJobObject: kernel32.func(
        '__stdcall',
        'AssignProcessToJobObject',
        'bool',
        [HANDLE, HANDLE]
      ) as (jobHandle: unknown, processHandle: unknown) => boolean,
      closeHandle: kernel32.func('__stdcall', 'CloseHandle', 'bool', [HANDLE]) as (handle: unknown) => boolean,
      getLastError: kernel32.func('__stdcall', 'GetLastError', 'uint32_t', []) as () => number,
      extendedLimitInformationType: JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    };
  })();

  return await windowsJobObjectBindingsPromise;
}

async function createWindowsJobObjectHandle(processId: number): Promise<WindowsJobObjectHandle | null> {
  const bindings = await getWindowsJobObjectBindings();
  if (!bindings) {
    return null;
  }

  const jobHandle = bindings.createJobObject(null, null);
  if (isNullWindowsHandle(bindings.koffi, jobHandle)) {
    throw createWindowsError(bindings.getLastError(), 'Failed to create a Job Object for command isolation');
  }

  let closed = false;
  const closeJobHandle = () => {
    if (closed) {
      return;
    }
    closed = true;
    bindings.closeHandle(jobHandle);
  };

  try {
    const limitInformation = {
      BasicLimitInformation: {
        PerProcessUserTimeLimit: 0,
        PerJobUserTimeLimit: 0,
        LimitFlags: WINDOWS_JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        MinimumWorkingSetSize: 0,
        MaximumWorkingSetSize: 0,
        ActiveProcessLimit: 0,
        Affinity: 0,
        PriorityClass: 0,
        SchedulingClass: 0
      },
      IoInfo: {
        ReadOperationCount: 0,
        WriteOperationCount: 0,
        OtherOperationCount: 0,
        ReadTransferCount: 0,
        WriteTransferCount: 0,
        OtherTransferCount: 0
      },
      ProcessMemoryLimit: 0,
      JobMemoryLimit: 0,
      PeakProcessMemoryUsed: 0,
      PeakJobMemoryUsed: 0
    };

    const setLimitsOk = bindings.setInformationJobObject(
      jobHandle,
      WINDOWS_JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
      limitInformation,
      bindings.koffi.sizeof(bindings.extendedLimitInformationType as Parameters<typeof bindings.koffi.sizeof>[0])
    );
    if (!setLimitsOk) {
      throw createWindowsError(
        bindings.getLastError(),
        'Failed to configure Job Object kill-on-close command isolation'
      );
    }

    const processHandle = bindings.openProcess(
      WINDOWS_PROCESS_SET_QUOTA | WINDOWS_PROCESS_TERMINATE,
      false,
      processId
    );
    if (isNullWindowsHandle(bindings.koffi, processHandle)) {
      throw createWindowsError(bindings.getLastError(), 'Failed to open command process for Job Object assignment');
    }

    try {
      const assigned = bindings.assignProcessToJobObject(jobHandle, processHandle);
      if (!assigned) {
        throw createWindowsError(bindings.getLastError(), 'Failed to assign command process to Job Object');
      }
    } finally {
      bindings.closeHandle(processHandle);
    }

    return {
      close: closeJobHandle
    };
  } catch (error) {
    closeJobHandle();
    throw error;
  }
}

const SAFE_COMMAND_ENV_KEYS = new Set([
  'APPDATA',
  'CI',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMSPEC',
  'HOMEDRIVE',
  'HOMEPATH',
  'HOME',
  'LANG',
  'LOCALAPPDATA',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'SYSTEMROOT',
  'TEMP',
  'TERM',
  'TMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'WINDIR'
]);

export function createRestrictedCommandEnv(env: NodeJS.ProcessEnv | undefined = process.env) {
  const next: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(env ?? {})) {
    if (typeof value !== 'string' || !value) {
      continue;
    }

    if (SAFE_COMMAND_ENV_KEYS.has(key.toUpperCase())) {
      next[key] = value;
    }
  }

  return withNormalizedWindowsShellEnv(next);
}

export function createTransportableCommandEnv(env: NodeJS.ProcessEnv | undefined = process.env) {
  const next: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(env ?? {})) {
    if (typeof value === 'string') {
      next[key] = value;
    }
  }

  return withNormalizedWindowsShellEnv(next);
}

export async function createIsolatedCommandEnv(
  env: NodeJS.ProcessEnv | undefined = process.env
) {
  const rootDir = await mkdtemp(join(tmpdir(), 'vicode-agent-runtime-'));
  const homeDir = join(rootDir, 'home');
  const appDataDir = join(rootDir, 'appdata');
  const localAppDataDir = join(rootDir, 'localappdata');
  const tempDir = join(rootDir, 'temp');
  const npmCacheDir = join(localAppDataDir, 'npm-cache');
  const pipCacheDir = join(localAppDataDir, 'pip-cache');
  const cargoHomeDir = join(homeDir, '.cargo');
  const rustupHomeDir = join(localAppDataDir, 'rustup');
  const bundleUserHomeDir = join(localAppDataDir, 'bundle');
  const yarnCacheDir = join(localAppDataDir, 'yarn-cache');
  const pnpmHomeDir = join(localAppDataDir, 'pnpm-home');
  const gitConfigPath = join(homeDir, '.gitconfig');
  const npmUserConfigPath = join(homeDir, '.npmrc');
  const pipConfigPath = join(homeDir, 'pip.ini');
  const pythonUserBaseDir = join(localAppDataDir, 'python-userbase');
  const bundleUserConfigPath = join(bundleUserHomeDir, 'config');
  const bundleUserCacheDir = join(bundleUserHomeDir, 'cache');
  const gemHomeDir = join(localAppDataDir, 'gem-home');
  const gemSpecCacheDir = join(localAppDataDir, 'gem-spec-cache');
  const composerHomeDir = join(localAppDataDir, 'composer-home');

  await Promise.all([
    mkdir(homeDir, { recursive: true }),
    mkdir(appDataDir, { recursive: true }),
    mkdir(localAppDataDir, { recursive: true }),
    mkdir(tempDir, { recursive: true }),
    mkdir(npmCacheDir, { recursive: true }),
    mkdir(pipCacheDir, { recursive: true }),
    mkdir(cargoHomeDir, { recursive: true }),
    mkdir(rustupHomeDir, { recursive: true }),
    mkdir(bundleUserHomeDir, { recursive: true }),
    mkdir(bundleUserCacheDir, { recursive: true }),
    mkdir(yarnCacheDir, { recursive: true }),
    mkdir(pnpmHomeDir, { recursive: true }),
    mkdir(pythonUserBaseDir, { recursive: true }),
    mkdir(gemHomeDir, { recursive: true }),
    mkdir(gemSpecCacheDir, { recursive: true }),
    mkdir(composerHomeDir, { recursive: true })
  ]);

  const restricted = createRestrictedCommandEnv(env);
  const homeDrive = homeDir.slice(0, 2);
  const homePath = homeDir.slice(2) || '\\';

  return {
    rootDir,
    env: withNormalizedWindowsShellEnv({
      ...restricted,
      HOME: homeDir,
      USERPROFILE: homeDir,
      HOMEDRIVE: homeDrive,
      HOMEPATH: homePath.startsWith('\\') ? homePath : `\\${homePath}`,
      APPDATA: appDataDir,
      LOCALAPPDATA: localAppDataDir,
      TEMP: tempDir,
      TMP: tempDir,
      npm_config_cache: npmCacheDir,
      NPM_CONFIG_CACHE: npmCacheDir,
      npm_config_userconfig: npmUserConfigPath,
      NPM_CONFIG_USERCONFIG: npmUserConfigPath,
      GIT_CONFIG_GLOBAL: gitConfigPath,
      PIP_CACHE_DIR: pipCacheDir,
      PIP_CONFIG_FILE: pipConfigPath,
      PYTHONUSERBASE: pythonUserBaseDir,
      CARGO_HOME: cargoHomeDir,
      RUSTUP_HOME: rustupHomeDir,
      BUNDLE_USER_HOME: bundleUserHomeDir,
      BUNDLE_USER_CONFIG: bundleUserConfigPath,
      BUNDLE_USER_CACHE: bundleUserCacheDir,
      YARN_CACHE_FOLDER: yarnCacheDir,
      PNPM_HOME: pnpmHomeDir,
      GEM_HOME: gemHomeDir,
      GEM_SPEC_CACHE: gemSpecCacheDir,
      COMPOSER_HOME: composerHomeDir
    }),
    cleanup: async () => {
      await removeDirectoryWithRetry(rootDir);
    }
  };
}

export interface IsolatedCommandSession {
  child: CommandSessionProcessLike;
  isolationMode: RuntimeCommandIsolationMode;
  rootDir: string;
  cleanup: () => Promise<void>;
  terminate: () => Promise<void>;
}

class UtilityProcessCommandBridge extends EventEmitter implements CommandSessionProcessLike {
  pid: number | undefined;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();

  override on(event: 'error', listener: (error: Error) => void): this;
  override on(event: 'close', listener: (code: number | null) => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}

function canUseUtilityProcessCommandRunner() {
  const electronVersion = process.versions.electron;
  const parentPort = (process as NodeJS.Process & { parentPort?: unknown }).parentPort;

  return process.platform === 'win32' && Boolean(electronVersion) && parentPort == null;
}

async function spawnUtilityProcessIsolatedCommand(
  executable: string,
  args: string[] = [],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }
): Promise<IsolatedCommandSession | null> {
  if (!canUseUtilityProcessCommandRunner()) {
    return null;
  }

  const transportEnv = createTransportableCommandEnv(options?.env ?? process.env);
  const { utilityProcess } = await import('electron/main');
  const utility = utilityProcess.fork(isolatedCommandRunnerModulePath, [], {
    cwd: options?.cwd,
    env: transportEnv,
    stdio: 'ignore',
    serviceName: 'Vicode Command Isolation Runner'
  }) as UtilityProcessLike;
  const bridge = new UtilityProcessCommandBridge();
  let exited = false;
  let settled = false;
  let terminated = false;

  const finalizeClose = (code: number | null) => {
    if (exited) {
      return;
    }
    exited = true;
    bridge.pid = undefined;
    bridge.stdout.end();
    bridge.stderr.end();
    bridge.emit('close', code);
  };

  return await new Promise<IsolatedCommandSession>((resolve, reject) => {
    const failStart = (error: Error) => {
      if (settled) {
        bridge.emit('error', error);
        return;
      }
      settled = true;
      bridge.stdout.end();
      bridge.stderr.end();
      reject(error);
    };

    utility.on('message', (message) => {
      switch (message.type) {
        case 'spawned': {
          bridge.pid = message.pid ?? utility.pid;
          if (!settled) {
            settled = true;
            resolve({
              child: bridge,
              isolationMode: message.isolationMode,
              rootDir: message.rootDir,
              cleanup: async () => {
                if (!utility.pid || exited) {
                  return;
                }
                utility.kill();
              },
              terminate: async () => {
                if (!utility.pid || terminated) {
                  return;
                }
                terminated = true;
                utility.postMessage({ type: 'terminate' });
                const killTimer = setTimeout(() => {
                  if (utility.pid) {
                    utility.kill();
                  }
                }, 300);
                killTimer.unref();
              }
            });
          }
          break;
        }
        case 'stdout':
          bridge.stdout.write(message.chunk);
          break;
        case 'stderr':
          bridge.stderr.write(message.chunk);
          break;
        case 'runtime_error':
          bridge.emit('error', new Error(message.message));
          break;
        case 'spawn_error':
          failStart(new Error(message.message));
          break;
        case 'exit':
          finalizeClose(message.code);
          break;
      }
    });

    utility.on('error', (_type, location, report) => {
      const detail = location ? ` at ${location}` : '';
      const message = `Utility command runner crashed${detail}.`;
      failStart(new Error(report ? `${message}\n${report}` : message));
    });

    utility.on('exit', (code) => {
      if (!settled) {
        settled = true;
        reject(new Error('Utility command runner exited before command launch completed.'));
        return;
      }
      finalizeClose(code);
    });

    utility.on('spawn', () => {
      utility.postMessage({
        type: 'run',
        executable,
        args,
        cwd: options?.cwd,
        env: transportEnv
      });
    });
  });
}

export async function spawnHostIsolatedCommand(
  executable: string,
  args: string[] = [],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }
): Promise<IsolatedCommandSession> {
  const isolated = await createIsolatedCommandEnv(options?.env);
  let cleanedUp = false;
  let jobObjectHandle: WindowsJobObjectHandle | null = null;

  const cleanup = async () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    jobObjectHandle?.close();
    await isolated.cleanup().catch(() => {});
  };

  try {
    const child = spawnHiddenExecutable(executable, args, {
      cwd: options?.cwd,
      env: isolated.env
    });
    let isolationMode: RuntimeCommandIsolationMode = 'host_isolated_temp_profile';

    if (process.platform === 'win32' && child.pid) {
      try {
        jobObjectHandle = await createWindowsJobObjectHandle(child.pid);
        if (jobObjectHandle) {
          isolationMode = 'host_job_object_temp_profile';
        }
      } catch {
        jobObjectHandle = null;
      }
    }

    return {
      child,
      isolationMode,
      rootDir: isolated.rootDir,
      cleanup,
      terminate: async () => {
        jobObjectHandle?.close();
        await killProcessTree(child);
      }
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function spawnIsolatedCommand(
  executable: string,
  args: string[] = [],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }
): Promise<IsolatedCommandSession> {
  const utilityProcessSession = await spawnUtilityProcessIsolatedCommand(executable, args, options);
  if (utilityProcessSession) {
    return utilityProcessSession;
  }

  return await spawnHostIsolatedCommand(executable, args, options);
}

export async function launchTerminalExecutable(title: string, executable: string, args: string[] = []): Promise<void> {
  const normalizedExecutable = executable.toLowerCase();
  if (normalizedExecutable.endsWith('.cmd')) {
    const cmdExecutable = getWindowsCmdExecutable();
    const cmdCommand = ['title', title, '&&', `"${executable}"`, ...args].join(' ');
    const shellExecutable = getWindowsPowerShellExecutable();
    const launcherCommand = [
      `Start-Process -FilePath ${quotePowerShellArg(cmdExecutable)}`,
      `-ArgumentList @(${['/d', '/k', cmdCommand].map(quotePowerShellArg).join(', ')})`,
      '-WindowStyle Normal'
    ].join(' ');

    await new Promise<void>((resolve, reject) => {
      const child = spawn(shellExecutable, ['-NoLogo', '-NonInteractive', '-Command', launcherCommand], {
        shell: false,
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
        env: withNormalizedWindowsShellEnv(process.env)
      });

      child.on('error', reject);
      child.on('spawn', () => {
        child.unref();
        resolve();
      });
    });
    return;
  }

  const shellExecutable = getWindowsPowerShellExecutable();
  const command = `$host.UI.RawUI.WindowTitle = ${quotePowerShellArg(title)}; & ${quotePowerShellArg(executable)} ${args.map(quotePowerShellArg).join(' ')}`.trim();
  const launcherCommand = [
    `Start-Process -FilePath ${quotePowerShellArg(shellExecutable)}`,
    `-ArgumentList @(${['-NoLogo', '-NoExit', '-Command', command].map(quotePowerShellArg).join(', ')})`,
    '-WindowStyle Normal'
  ].join(' ');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(shellExecutable, ['-NoLogo', '-NonInteractive', '-Command', launcherCommand], {
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
      env: withNormalizedWindowsShellEnv(process.env)
    });

    child.on('error', reject);
    child.on('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export function spawnHiddenExecutable(
  executable: string,
  args: string[] = [],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }
): ChildProcessWithoutNullStreams {
  const normalizedExecutable = executable.toLowerCase();
  const isCmdShim = normalizedExecutable.endsWith('.cmd');

  return (
    isCmdShim
      ? spawn(getWindowsCmdExecutable(), ['/d', '/s', '/c', executable, ...args], {
          windowsHide: true,
          stdio: 'pipe',
          cwd: options?.cwd,
          env: withNormalizedWindowsShellEnv(options?.env)
        })
      : spawn(executable, args, {
          windowsHide: true,
          stdio: 'pipe',
          cwd: options?.cwd,
          env: withNormalizedWindowsShellEnv(options?.env)
        })
  ) as ChildProcessWithoutNullStreams;
}

export async function runHiddenExecutable(
  executable: string,
  args: string[] = [],
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }
): Promise<{ stdout: string; stderr: string }> {
  const child = spawnHiddenExecutable(executable, args, options);

  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || `Command exited with code ${code ?? -1}.`));
    });
  });
}

export async function killProcessTree(child: ChildProcess | null | undefined): Promise<void> {
  if (!child?.pid) {
    return;
  }

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });

      killer.on('error', () => {
        try {
          child.kill();
        } catch {
          // Best effort fallback.
        }
        resolve();
      });

      killer.on('close', () => resolve());
    });
    return;
  }

  try {
    child.kill('SIGTERM');
  } catch {
    // Best effort fallback.
  }
}

export function simulateStreamingText(
  text: string,
  onChunk: (value: string) => void,
  onDone: () => void
): { cancel: () => void } {
  const tokens = text.split(' ');
  let index = 0;
  let cancelled = false;

  const tick = () => {
    if (cancelled) {
      return;
    }
    if (index >= tokens.length) {
      onDone();
      return;
    }
    onChunk(`${index === 0 ? '' : ' '}${tokens[index]}`);
    index += 1;
    setTimeout(tick, 25);
  };

  setTimeout(tick, 20);

  return {
    cancel: () => {
      cancelled = true;
    }
  };
}
