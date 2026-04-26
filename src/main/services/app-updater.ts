import { EventEmitter } from 'node:events';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import electronUpdater, { type AppUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import type { AppUpdateState } from '../../shared/domain';
import type { AppEvent } from '../../shared/events';

const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 6;

function getAutoUpdater(): AppUpdater {
  const { autoUpdater } = electronUpdater;
  return autoUpdater;
}

function createInitialState(input: {
  currentVersion: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
}): AppUpdateState {
  const devUpdatesEnabled = process.env.VICODE_ENABLE_DEV_UPDATES === '1';

  if (input.platform !== 'win32') {
    return {
      enabled: false,
      status: 'disabled',
      currentVersion: input.currentVersion,
      availableVersion: null,
      downloadPercent: null,
      bytesPerSecond: null,
      transferredBytes: null,
      totalBytes: null,
      lastCheckedAt: null,
      message: 'Desktop auto-updates are only enabled for the Windows installer path.'
    };
  }

  if (!input.isPackaged && !devUpdatesEnabled) {
    return {
      enabled: false,
      status: 'disabled',
      currentVersion: input.currentVersion,
      availableVersion: null,
      downloadPercent: null,
      bytesPerSecond: null,
      transferredBytes: null,
      totalBytes: null,
      lastCheckedAt: null,
      message: 'Desktop auto-updates are available on installed Windows builds.'
    };
  }

  return {
    enabled: true,
    status: 'idle',
    currentVersion: input.currentVersion,
    availableVersion: null,
    downloadPercent: null,
    bytesPerSecond: null,
    transferredBytes: null,
    totalBytes: null,
    lastCheckedAt: null,
      message: devUpdatesEnabled && !input.isPackaged
        ? 'Dev update mode is enabled. Provide dev-app-update.yml before testing the updater locally.'
        : 'Vicode checks for desktop updates on launch and when requested.'
  };
}

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return 'Desktop update check failed.';
}

export class AppUpdaterService {
  private readonly emitter = new EventEmitter();
  private readonly currentVersion: string;
  private readonly detachListeners: Array<() => void> = [];
  private readonly updateCheckIntervalMs: number;
  private readonly logPath: string | null;
  private state: AppUpdateState;
  private initialized = false;
  private scheduledCheckTimer: NodeJS.Timeout | null = null;
  private checkPromise: Promise<AppUpdateState> | null = null;

  constructor(
    private readonly updater: AppUpdater = getAutoUpdater(),
    options?: {
      currentVersion?: string;
      updateCheckIntervalMs?: number;
      isPackaged?: boolean;
      platform?: NodeJS.Platform;
      logPath?: string | null;
    }
  ) {
    this.currentVersion = options?.currentVersion ?? app?.getVersion?.() ?? '0.0.0';
    this.updateCheckIntervalMs = options?.updateCheckIntervalMs ?? DEFAULT_UPDATE_CHECK_INTERVAL_MS;
    this.logPath = options?.logPath?.trim() ? options.logPath : null;
    this.state = createInitialState({
      currentVersion: this.currentVersion,
      isPackaged: options?.isPackaged ?? Boolean(app?.isPackaged),
      platform: options?.platform ?? process.platform
    });
    this.log('constructed', {
      currentVersion: this.currentVersion,
      enabled: this.state.enabled,
      status: this.state.status,
      message: this.state.message
    });
  }

  getState(): AppUpdateState {
    return { ...this.state };
  }

  onEvent(listener: (event: AppEvent) => void) {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  initialize() {
    if (this.initialized) {
      this.log('initialize.skip', { reason: 'already_initialized' });
      return;
    }
    this.initialized = true;
    this.log('initialize.start', {
      enabled: this.state.enabled,
      packaged: Boolean(app?.isPackaged),
      platform: process.platform
    });

    if (!this.state.enabled) {
      this.log('initialize.disabled', { message: this.state.message });
      return;
    }

    this.updater.autoDownload = true;
    this.updater.autoInstallOnAppQuit = true;

    if (!app?.isPackaged && process.env.VICODE_ENABLE_DEV_UPDATES === '1') {
      this.updater.forceDevUpdateConfig = true;
    }

    this.attachUpdaterListeners();
    this.log('initialize.listeners_attached', {
      autoDownload: this.updater.autoDownload,
      autoInstallOnAppQuit: this.updater.autoInstallOnAppQuit,
      forceDevUpdateConfig: this.updater.forceDevUpdateConfig
    });
    void this.checkForUpdates().catch(() => undefined);
    this.scheduledCheckTimer = setInterval(() => {
      void this.checkForUpdates().catch(() => undefined);
    }, this.updateCheckIntervalMs);
  }

  async checkForUpdates(): Promise<AppUpdateState> {
    if (!this.state.enabled) {
      this.log('check.skip', { reason: 'disabled' });
      return this.getState();
    }

    if (this.checkPromise) {
      this.log('check.skip', { reason: 'already_running' });
      return this.checkPromise;
    }

    this.checkPromise = (async () => {
      try {
        this.log('check.start', { currentVersion: this.currentVersion });
        await this.updater.checkForUpdates();
        this.log('check.complete', {
          status: this.state.status,
          availableVersion: this.state.availableVersion
        });
        return this.getState();
      } catch (error) {
        const message = normalizeErrorMessage(error);
        this.log('check.error', { message });
        this.updateState({
          status: 'error',
          lastCheckedAt: new Date().toISOString(),
          message,
          downloadPercent: null,
          bytesPerSecond: null,
          transferredBytes: null,
          totalBytes: null
        });
        throw new Error(message);
      } finally {
        this.checkPromise = null;
      }
    })();

    return this.checkPromise;
  }

  async restartToUpdate() {
    if (this.state.status !== 'downloaded') {
      this.log('restart.skip', {
        reason: 'not_downloaded',
        status: this.state.status
      });
      throw new Error('No downloaded desktop update is ready to install.');
    }
    this.log('restart.start', { availableVersion: this.state.availableVersion });
    this.updater.quitAndInstall();
  }

  dispose() {
    if (this.scheduledCheckTimer) {
      clearInterval(this.scheduledCheckTimer);
      this.scheduledCheckTimer = null;
    }
    for (const detach of this.detachListeners.splice(0)) {
      detach();
    }
  }

  private attachUpdaterListeners() {
    this.attachListener('checking-for-update', () => {
      this.updateState({
        status: 'checking',
        lastCheckedAt: new Date().toISOString(),
        message: 'Checking for a newer desktop build...',
        downloadPercent: null,
        bytesPerSecond: null,
        transferredBytes: null,
        totalBytes: null
      });
    });

    this.attachListener('update-available', (info: UpdateInfo) => {
      this.updateState({
        status: 'available',
        lastCheckedAt: new Date().toISOString(),
        availableVersion: info.version ?? null,
        message: info.version ? `Version ${info.version} is available.` : 'A newer desktop build is available.'
      });
    });

    this.attachListener('download-progress', (progress: ProgressInfo) => {
      this.updateState({
        status: 'downloading',
        message: this.state.availableVersion
          ? `Downloading ${this.state.availableVersion}...`
          : 'Downloading the latest desktop build...',
        downloadPercent: Number.isFinite(progress.percent) ? progress.percent : null,
        bytesPerSecond: Number.isFinite(progress.bytesPerSecond) ? progress.bytesPerSecond : null,
        transferredBytes: Number.isFinite(progress.transferred) ? progress.transferred : null,
        totalBytes: Number.isFinite(progress.total) ? progress.total : null
      });
    });

    this.attachListener('update-downloaded', (info: UpdateInfo) => {
      this.updateState({
        status: 'downloaded',
        availableVersion: info.version ?? this.state.availableVersion,
        downloadPercent: 100,
        message: info.version
          ? `Version ${info.version} is ready. Restart Vicode to finish updating.`
          : 'The latest desktop build is ready. Restart Vicode to finish updating.'
      });
    });

    this.attachListener('update-not-available', () => {
      this.updateState({
        status: 'up_to_date',
        availableVersion: null,
        downloadPercent: null,
        bytesPerSecond: null,
        transferredBytes: null,
        totalBytes: null,
        lastCheckedAt: new Date().toISOString(),
        message: 'This installed desktop build is up to date.'
      });
    });

    this.attachListener('error', (error: unknown) => {
      const message = normalizeErrorMessage(error);
      this.updateState({
        status: 'error',
        lastCheckedAt: new Date().toISOString(),
        message,
        downloadPercent: null,
        bytesPerSecond: null,
        transferredBytes: null,
        totalBytes: null
      });
    });
  }

  private attachListener(eventName: string, listener: (...args: any[]) => void) {
    const wrappedListener = (...args: any[]) => {
      this.log(`event.${eventName}`, args[0] ?? null);
      listener(...args);
    };
    this.updater.on(eventName as never, wrappedListener as never);
    this.detachListeners.push(() => {
      this.updater.off(eventName as never, wrappedListener as never);
    });
  }

  private updateState(partial: Partial<AppUpdateState>) {
    this.state = {
      ...this.state,
      ...partial,
      currentVersion: this.currentVersion,
      enabled: this.state.enabled
    };
    this.log('state.update', this.state);
    this.emitter.emit('event', {
      type: 'app.updateStateChanged',
      update: this.getState()
    } satisfies AppEvent);
  }

  private log(event: string, detail: unknown) {
    if (!this.logPath) {
      return;
    }

    try {
      mkdirSync(path.dirname(this.logPath), { recursive: true });
      appendFileSync(
        this.logPath,
        `${JSON.stringify({
          at: new Date().toISOString(),
          event,
          detail
        })}\n`,
        'utf8'
      );
    } catch {
      // Logging must never break updater behavior.
    }
  }
}
