import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, Menu, nativeTheme } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { registerIpc } from './ipc';
import { AppUpdaterService } from './services/app-updater';
import { AutomationScheduler } from './services/automation-scheduler';
import { HeartbeatService } from './services/heartbeat';
import { JobsService } from './services/jobs';
import { McpRegistryService } from './services/mcp/registry';
import { OllamaRuntimeService } from './services/ollama-runtime';
import { ProviderManager } from './services/provider-manager';
import { VoiceService } from './services/voice';
import { CollaborationService } from './services/collab';
import { DatabaseService } from '../storage/database';
import { createAppServices, startDeferredAppServices } from './startup';
import { parseOllamaLaunchArgv } from './ollama-launch-args';
import { createOllamaLaunchController } from './ollama-launch-profile';
import {
  handleOllamaLaunchSecondInstance,
  type OllamaLaunchController
} from './ollama-launch-instance';

let mainWindow: BrowserWindow | null = null;
let appServices: ReturnType<typeof createAppServices> | null = null;
let launchController: OllamaLaunchController | null = null;
let db: DatabaseService | null = null;
let updater: AppUpdaterService | null = null;
let automations: AutomationScheduler | null = null;
let providers: ProviderManager | null = null;
let ollamaRuntime: OllamaRuntimeService | null = null;
let mcp: McpRegistryService | null = null;
let jobs: JobsService | null = null;
let heartbeat: HeartbeatService | null = null;
let collab: CollaborationService | null = null;
let ipcCleanup: (() => void) | null = null;
let deferredCleanup: (() => void) | null = null;
let launchPendingCleanup: (() => void) | null = null;
let pendingSecondInstanceArgv: string[] | null = null;
let initialOllamaLaunchProfilePath: string | null = null;
const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'aborted', 'cancelled']);
const WINDOWS_APP_ID = 'com.vicode.windows';
const WINDOWS_APP_NAME = 'Vicode';
const HEARTBEAT_AUTONOMY_ENABLED = process.env.VICODE_ENABLE_HEARTBEAT_AUTONOMY === '1';
const STARTUP_DEBUG_ENABLED = process.env.VICODE_STARTUP_DEBUG === '1';
const STARTUP_DEBUG_LOG_PATH = process.env.VICODE_STARTUP_DEBUG_LOG_PATH?.trim() || null;
const APP_ZOOM_STEP = 0.1;
const APP_ZOOM_MIN = 0.75;
const APP_ZOOM_MAX = 1.6;

function writeStartupDebugEntry(step: string) {
  if (!STARTUP_DEBUG_ENABLED || !STARTUP_DEBUG_LOG_PATH) {
    return;
  }
  appendFileSync(
    STARTUP_DEBUG_LOG_PATH,
    `[startup:window] ${new Date().toISOString()} ${step}\n`,
    'utf8'
  );
}

writeStartupDebugEntry('module-loaded');

try {
  initialOllamaLaunchProfilePath = parseOllamaLaunchArgv(process.argv)?.profilePath ?? null;
} catch (error) {
  console.error('[startup] Invalid Ollama launch arguments.', error);
  app.exit(1);
}

function installEditableContextMenu(window: BrowserWindow) {
  window.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) {
      return;
    }

    const template: MenuItemConstructorOptions[] = [];

    if (params.misspelledWord && params.dictionarySuggestions.length > 0) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 6)) {
        template.push({
          label: suggestion,
          click: () => window.webContents.replaceMisspelling(suggestion)
        });
      }

      template.push({ type: 'separator' });
    }

    template.push(
      { role: 'undo', enabled: params.editFlags.canUndo },
      { role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { role: 'selectAll' }
    );

    Menu.buildFromTemplate(template).popup({ window });
  });
}

function resolveAppIconPath() {
  const iconName = process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png';
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, iconName),
        join(process.resourcesPath, 'resources', iconName),
        join(app.getAppPath(), 'resources', iconName)
      ]
    : [
        join(process.cwd(), 'resources', iconName),
        join(__dirname, '../../resources', iconName),
        join(app.getAppPath(), 'resources', iconName)
      ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function isTrustedRendererOrigin(origin: string) {
  if (!origin) {
    return false;
  }

  if (origin.startsWith('file://')) {
    return true;
  }

  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname === 'localhost'
    );
  } catch {
    return false;
  }
}

function clampAppZoomFactor(value: number) {
  const bounded = Math.min(APP_ZOOM_MAX, Math.max(APP_ZOOM_MIN, value));
  return Math.round(bounded * 100) / 100;
}

function logStartupStep(step: string) {
  if (!STARTUP_DEBUG_ENABLED) {
    return;
  }
  const message = `[startup:window] ${new Date().toISOString()} ${step}`;
  if (STARTUP_DEBUG_LOG_PATH) {
    try {
      appendFileSync(STARTUP_DEBUG_LOG_PATH, `${message}\n`, 'utf8');
      return;
    } catch (error) {
      console.error('[startup] Failed to write startup debug log.', error);
    }
  }
  console.info(message);
}

function applyBrowserWindowZoom(window: BrowserWindow, action: 'in' | 'out' | 'reset') {
  const currentFactor = window.webContents.getZoomFactor();
  const nextFactor =
    action === 'reset'
      ? 1
      : clampAppZoomFactor(currentFactor + (action === 'in' ? APP_ZOOM_STEP : -APP_ZOOM_STEP));
  window.webContents.setZoomFactor(nextFactor);
  return nextFactor;
}

function installZoomShortcuts(window: BrowserWindow) {
  window.webContents.on('before-input-event', (event, input) => {
    if (!(input.control || input.meta)) {
      return;
    }

    const key = input.key.toLowerCase();
    const code = input.code;

    if (code === 'NumpadAdd' || code === 'Equal' || key === '+' || key === '=') {
      event.preventDefault();
      applyBrowserWindowZoom(window, 'in');
      return;
    }

    if (code === 'NumpadSubtract' || code === 'Minus' || key === '-' || key === '_') {
      event.preventDefault();
      applyBrowserWindowZoom(window, 'out');
      return;
    }

    if (code === 'Digit0' || code === 'Numpad0' || key === '0') {
      event.preventDefault();
      applyBrowserWindowZoom(window, 'reset');
    }
  });
}

async function createWindow() {
  logStartupStep('begin');
  nativeTheme.themeSource = 'dark';
  const stateDir = join(app.getPath('userData'), 'state');
  mkdirSync(stateDir, { recursive: true });
  logStartupStep(`state-dir-ready:${stateDir}`);
  const services =
    appServices ??
    createAppServices({
      stateDir,
      heartbeatAutonomyEnabled: HEARTBEAT_AUTONOMY_ENABLED
    });
  logStartupStep('services-created');
  appServices = services;
  db = services.db;
  updater = services.updater;
  providers = services.providers;
  ollamaRuntime = services.ollamaRuntime;
  mcp = services.mcp;
  jobs = services.jobs;
  heartbeat = services.heartbeat;
  automations = services.automations;
  collab = services.collab;
  launchController = launchController ?? createOllamaLaunchController({
    db: services.db,
    stateDir,
    hasActiveRuns: () => services.providers.hasActiveRuns()
  });
  if (!launchPendingCleanup) {
    launchPendingCleanup = services.providers.onEvent((event) => {
      if (event.type !== 'run.status' || !TERMINAL_RUN_STATUSES.has(event.status)) {
        return;
      }
      if (services.providers.hasActiveRuns()) {
        return;
      }

      void Promise.resolve(launchController?.applyPendingProfile?.()).catch((error) => {
        console.error('[startup] Failed to apply deferred Ollama launch profile.', error);
      });
    });
  }

  if (initialOllamaLaunchProfilePath) {
    const profilePath = initialOllamaLaunchProfilePath;
    initialOllamaLaunchProfilePath = null;
    try {
      const result = await launchController.handleProfilePath(profilePath);
      logStartupStep(`ollama-launch-profile:${result.status}`);
      if (result.profile?.configureOnly) {
        app.quit();
        return;
      }
    } catch (error) {
      console.error('[startup] Failed to apply Ollama launch profile.', error);
      app.quit();
      return;
    }
  }

  const iconPath = resolveAppIconPath();
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1440,
    height: 920,
    minWidth: 1220,
    minHeight: 720,
    backgroundColor: '#181818',
    hasShadow: false,
    autoHideMenuBar: true,
    title: WINDOWS_APP_NAME,
    icon: iconPath,
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'hiddenInset',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            color: '#181818',
            symbolColor: '#f5f5f5',
            height: 40
          }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  };

  logStartupStep('construct-browser-window');
  mainWindow = new BrowserWindow(windowOptions);
  logStartupStep('browser-window-created');
  mainWindow.setHasShadow(false);
  installZoomShortcuts(mainWindow);

  try {
    mainWindow.webContents.session.setSpellCheckerLanguages(['en-US']);
  } catch {
    // Ignore unavailable spellchecker language configuration on unsupported runtimes.
  }

  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (permission === 'media' || permission === 'microphone') {
      return isTrustedRendererOrigin(requestingOrigin);
    }

    return false;
  });

  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (
        (permission === 'media' || permission === 'microphone') &&
        isTrustedRendererOrigin(details.requestingUrl)
      ) {
        callback(true);
        return;
      }

      callback(false);
    }
  );

  mainWindow.webContents.session.setDevicePermissionHandler((details) => {
    if (details.deviceType !== 'audioCapture') {
      return false;
    }

    return isTrustedRendererOrigin(details.origin);
  });

  installEditableContextMenu(mainWindow);

  if (process.platform === 'win32') {
    mainWindow.setAppDetails({
      appId: WINDOWS_APP_ID,
      appIconPath: iconPath,
      appIconIndex: 0,
      relaunchCommand: process.execPath,
      relaunchDisplayName: WINDOWS_APP_NAME
    });
  }

  if (!ipcCleanup) {
    ipcCleanup = registerIpc(() => mainWindow, {
      db: services.db,
      updater: services.updater,
      providers: services.providers,
      ollamaRuntime: services.ollamaRuntime,
      skills: services.skills,
      automations: services.automations,
      diagnostics: services.diagnostics,
      mcp: services.mcp,
      jobs: services.jobs,
      autonomousTasks: services.autonomousTasks,
      subagents: services.subagents,
      voice: services.voice,
      collab: services.collab,
      composerTextAttachments: services.composerTextAttachments
    });
  }
  logStartupStep('ipc-registered');

  if (process.env.ELECTRON_RENDERER_URL) {
    logStartupStep(`load-url:${process.env.ELECTRON_RENDERER_URL}`);
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    logStartupStep(`load-file:${join(__dirname, '../renderer/index.html')}`);
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
  logStartupStep('renderer-loaded');

  if (!deferredCleanup) {
    deferredCleanup = startDeferredAppServices(services, {
      reportError: (scope, error) => {
        console.error(`[startup:${scope}] Deferred initialization failed`, error);
      },
      reportTiming: (scope, durationMs) => {
        console.info(`[startup:${scope}] ready in ${durationMs}ms`);
      }
    });
  }
  logStartupStep('deferred-startup-scheduled');

  if (pendingSecondInstanceArgv && launchController) {
    const argv = pendingSecondInstanceArgv;
    pendingSecondInstanceArgv = null;
    void handleOllamaLaunchSecondInstance({
      argv,
      controller: launchController,
      mainWindow
    }).catch((error) => {
      console.error('[startup] Failed to handle deferred Ollama launch handoff.', error);
    });
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (!launchController) {
      pendingSecondInstanceArgv = commandLine;
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.focus();
      }
      return;
    }

    void handleOllamaLaunchSecondInstance({
      argv: commandLine,
      controller: launchController,
      mainWindow
    }).catch((error) => {
      console.error('[startup] Failed to handle Ollama launch handoff.', error);
    });
  });

  app.whenReady()
    .then(async () => {
      app.setName(WINDOWS_APP_NAME);
      app.setAppUserModelId(WINDOWS_APP_ID);
      await createWindow();
      app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          await createWindow();
        }
      });
    })
    .catch((error) => {
      console.error('[startup] Failed to create the main window.', error);
      app.quit();
    });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  ipcCleanup?.();
  deferredCleanup?.();
  launchPendingCleanup?.();
  automations?.dispose();
  heartbeat?.dispose();
  jobs?.dispose();
  providers?.dispose();
  updater?.dispose();
  void ollamaRuntime?.dispose();
  collab?.dispose();
  void mcp?.dispose();
  db?.close();
  ipcCleanup = null;
  deferredCleanup = null;
  launchPendingCleanup = null;
  appServices = null;
  updater = null;
});
