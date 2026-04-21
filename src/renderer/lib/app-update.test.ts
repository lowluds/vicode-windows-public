import { describe, expect, it } from 'vitest';
import type { AppUpdateState } from '../../shared/domain';
import {
  deriveTitleBarUpdateActionState,
  deriveUpdateInstallActionLabel,
  getDownloadedUpdateKey,
  hasAnyActiveThreadRun,
  isQueuedUpdateInstall
} from './app-update';

function createUpdateState(overrides: Partial<AppUpdateState> = {}): AppUpdateState {
  return {
    enabled: true,
    status: 'idle',
    currentVersion: '0.2.1',
    availableVersion: null,
    downloadPercent: null,
    bytesPerSecond: null,
    transferredBytes: null,
    totalBytes: null,
    lastCheckedAt: null,
    message: null,
    ...overrides
  };
}

describe('app-update helpers', () => {
  it('detects active runs from the active thread and project summaries', () => {
    expect(
      hasAnyActiveThreadRun({
        activeThread: { status: 'completed' },
        threadsByProject: {
          alpha: [{ status: 'completed' }, { status: 'running' }]
        }
      })
    ).toBe(true);

    expect(
      hasAnyActiveThreadRun({
        activeThread: { status: 'queued' },
        threadsByProject: {
          alpha: [{ status: 'completed' }]
        }
      })
    ).toBe(true);

    expect(
      hasAnyActiveThreadRun({
        activeThread: null,
        threadsByProject: {
          alpha: [{ status: 'completed' }, { status: 'failed' }]
        }
      })
    ).toBe(false);
  });

  it('tracks queued installs against the current downloaded update', () => {
    const state = createUpdateState({
      status: 'downloaded',
      availableVersion: '0.2.2'
    });
    const key = getDownloadedUpdateKey(state);

    expect(key).toBe('0.2.2');
    expect(isQueuedUpdateInstall(state, key)).toBe(true);
    expect(isQueuedUpdateInstall(state, '0.2.3')).toBe(false);
  });

  it('describes the downloaded titlebar action for queued and idle installs', () => {
    const downloaded = createUpdateState({
      status: 'downloaded',
      availableVersion: '0.2.2'
    });

    expect(
      deriveTitleBarUpdateActionState({
        appUpdateState: downloaded,
        hasActiveRun: true,
        queuedUpdateInstallKey: null
      })
    ).toMatchObject({
      variant: 'downloaded',
      label: 'Install update when idle'
    });

    expect(
      deriveTitleBarUpdateActionState({
        appUpdateState: downloaded,
        hasActiveRun: true,
        queuedUpdateInstallKey: '0.2.2'
      })
    ).toMatchObject({
      variant: 'queued',
      label: 'Update queued'
    });

    expect(
      deriveUpdateInstallActionLabel({
        appUpdateState: downloaded,
        hasActiveRun: false,
        queuedUpdateInstallKey: null
      })
    ).toBe('Restart to update');
  });
});
