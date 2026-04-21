import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppUpdaterService } from './app-updater';
import type { AppEvent } from '../../shared/events';
import type { AppUpdater } from 'electron-updater';

class MockUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  forceDevUpdateConfig = false;
  checkForUpdates = vi.fn(async () => ({}));
  quitAndInstall = vi.fn();
}

function createUpdater() {
  return new MockUpdater() as unknown as AppUpdater & MockUpdater;
}

afterEach(() => {
  delete process.env.VICODE_ENABLE_DEV_UPDATES;
});

describe('AppUpdaterService', () => {
  it('stays disabled outside the installed Windows app path by default', () => {
    const service = new AppUpdaterService(createUpdater(), { currentVersion: '0.2.1' });

    expect(service.getState()).toEqual({
      enabled: false,
      status: 'disabled',
      currentVersion: '0.2.1',
      availableVersion: null,
      downloadPercent: null,
      bytesPerSecond: null,
      transferredBytes: null,
      totalBytes: null,
      lastCheckedAt: null,
      message: 'Desktop auto-updates are available on installed Windows builds.'
    });
  });

  it('enables dev update mode when explicitly requested and checks on initialize', async () => {
    process.env.VICODE_ENABLE_DEV_UPDATES = '1';
    const updater = createUpdater();
    const service = new AppUpdaterService(updater, {
      currentVersion: '0.2.1',
      updateCheckIntervalMs: 60_000
    });

    service.initialize();
    await Promise.resolve();

    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.forceDevUpdateConfig).toBe(true);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);

    service.dispose();
  });

  it('maps updater events into app update state snapshots', () => {
    process.env.VICODE_ENABLE_DEV_UPDATES = '1';
    const updater = createUpdater();
    const service = new AppUpdaterService(updater, { currentVersion: '0.2.1' });
    const events: AppEvent[] = [];

    service.onEvent((event) => {
      events.push(event);
    });
    service.initialize();

    updater.emit('update-available', { version: '0.2.2' });
    updater.emit('download-progress', {
      percent: 42,
      bytesPerSecond: 4096,
      transferred: 1024,
      total: 2048
    });
    updater.emit('update-downloaded', { version: '0.2.2' });

    const lastEvent = events.at(-1);
    expect(lastEvent).toEqual({
      type: 'app.updateStateChanged',
      update: {
        enabled: true,
        status: 'downloaded',
        currentVersion: '0.2.1',
        availableVersion: '0.2.2',
        downloadPercent: 100,
        bytesPerSecond: 4096,
        transferredBytes: 1024,
        totalBytes: 2048,
        lastCheckedAt: expect.any(String),
        message: 'Version 0.2.2 is ready. Restart Vicode to finish updating.'
      }
    });

    service.dispose();
  });

  it('only restarts when an update has already been downloaded', async () => {
    process.env.VICODE_ENABLE_DEV_UPDATES = '1';
    const updater = createUpdater();
    const service = new AppUpdaterService(updater, { currentVersion: '0.2.1' });

    await expect(service.restartToUpdate()).rejects.toThrow('No downloaded desktop update is ready to install.');

    service.initialize();
    updater.emit('update-downloaded', { version: '0.2.2' });

    await expect(service.restartToUpdate()).resolves.toBeUndefined();
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);

    service.dispose();
  });
});
