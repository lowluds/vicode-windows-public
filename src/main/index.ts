import { existsSync, mkdirSync } from 'node:fs';
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
import { WorkspaceBootstrapService } from './services/workspace-bootstrap';
import { DatabaseService } from '../storage/database';
import { createAppServices, startDeferredAppServices } from './startup';

let mainWindow: BrowserWindow | null = null;
let appServices: ReturnType<typeof createAppServices> | null = null;
let db: DatabaseService | null = null;
let updater: AppUpdaterService | null = null;
let automations: AutomationScheduler | null = null;
let providers: ProviderManager | null = null;
let ollamaRuntime: OllamaRuntimeService | null = null;
let mcp: McpRegistryService | null = null;
let jobs: JobsService | null = null;
let heartbeat: HeartbeatService | null = null;
let workspaceBootstrap: WorkspaceBootstrapService | null = null;
let collab: CollaborationService | null = null;
let ipcCleanup: (() => void) | null = null;
let deferredCleanup: (() => void) | null = null;
const WINDOWS_APP_ID = 'com.vicode.windows';
const WINDOWS_APP_NAME = 'Vicode';
const HEARTBEAT_AUTONOMY_ENABLED = process.env.VICODE_ENABLE_HEARTBEAT_AUTONOMY === '1';
const APP_ZOOM_STEP = 0.1;
const APP_ZOOM_MIN = 0.75;
const APP_ZOOM_MAX = 1.6;
const userDataOverridePath = process.env.VICODE_USER_DATA_PATH?.trim() || null;
if (userDataOverridePath) {
  mkdirSync(userDataOverridePath, { recursive: true });
  app.setPath('userData', userDataOverridePath);
}

const localAppDataPath =
  process.env.LOCALAPPDATA ??
  join(process.env.USERPROFILE ?? app.getPath('home'), 'AppData', 'Local');
const sessionDataPath =
  process.env.VICODE_SESSION_DATA_PATH?.trim() ||
  (userDataOverridePath ? join(userDataOverridePath, 'session') : join(localAppDataPath, 'vicode-windows', 'session'));

mkdirSync(sessionDataPath, { recursive: true });
app.setPath('sessionData', sessionDataPath);

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
  nativeTheme.themeSource = 'dark';
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

  mainWindow = new BrowserWindow(windowOptions);
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

  const stateDir = join(app.getPath('userData'), 'state');
  mkdirSync(stateDir, { recursive: true });
  const services =
    appServices ??
    createAppServices({
      stateDir,
      heartbeatAutonomyEnabled: HEARTBEAT_AUTONOMY_ENABLED
    });
  appServices = services;
  db = services.db;
  updater = services.updater;
  providers = services.providers;
  ollamaRuntime = services.ollamaRuntime;
  mcp = services.mcp;
  jobs = services.jobs;
  heartbeat = services.heartbeat;
  workspaceBootstrap = services.workspaceBootstrap;
  automations = services.automations;
  collab = services.collab;

  if (!ipcCleanup) {
    ipcCleanup = registerIpc(() => mainWindow, {
      db: services.db,
      updater: services.updater,
      providers: services.providers,
      ollamaRuntime: services.ollamaRuntime,
      skills: services.skills,
      automations: services.automations,
      vicodeBuild: services.vicodeBuild,
      diagnostics: services.diagnostics,
      mcp: services.mcp,
      jobs: services.jobs,
      autonomousTasks: services.autonomousTasks,
      subagents: services.subagents,
      workspaceBootstrap: services.workspaceBootstrap,
      voice: services.voice,
      collab: services.collab,
      composerTextAttachments: services.composerTextAttachments
    });
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

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
}

app.whenReady().then(async () => {
  app.setName(WINDOWS_APP_NAME);
  app.setAppUserModelId(WINDOWS_APP_ID);
  await createWindow();
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  ipcCleanup?.();
  deferredCleanup?.();
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
  appServices = null;
  updater = null;
});
