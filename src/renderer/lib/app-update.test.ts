import { describe, expect, it } from 'vitest';
import type { AppUpdateState } from '../../shared/domain';
import {
  deriveTitleBarUpdateActionState,
  deriveUpdateInstallActionLabel,
  hasAnyActiveThreadRun
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

  it('describes the downloaded titlebar action as an immediate restart', () => {
    const downloaded = createUpdateState({
      status: 'downloaded',
      availableVersion: '0.2.2'
    });

    expect(deriveTitleBarUpdateActionState(downloaded)).toMatchObject({
      variant: 'downloaded',
      label: 'Restart to update'
    });

    expect(deriveUpdateInstallActionLabel()).toBe('Restart to update');
  });
});
