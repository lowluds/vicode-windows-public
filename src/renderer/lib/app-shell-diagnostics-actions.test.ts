import { describe, expect, it, vi } from 'vitest';
import type { SettingsSection, ThreadDetail } from '../../shared/domain';
import type {
  StorageDiagnostics,
  StorageMaintenanceResult
} from '../../shared/ipc';
import {
  compactRunEventsInShell,
  exportActiveThreadDiagnosticsInShell,
  exportActiveThreadReportInShell,
  exportDiagnosticsInShell,
  loadStorageDiagnosticsInShell,
  maintainStorageInShell,
  refreshStorageDiagnosticsIfVisibleInShell,
  type AppShellDiagnosticsActionsHost
} from './app-shell-diagnostics-actions';

type Toast = {
  level: 'info' | 'warning' | 'error';
  message: string;
};

function createStorageDiagnostics(overrides: Partial<StorageDiagnostics> = {}) {
  return {
    databasePath: 'D:/Projects/vicode/app.db',
    databaseSizeBytes: 1,
    walSizeBytes: 2,
    shmSizeBytes: 3,
    totalStorageBytes: 6,
    projectCount: 1,
    threadCount: 2,
    archivedThreadCount: 1,
    activeThreadCount: 1,
    turnCount: 10,
    runEventCount: 20,
    compactableRunCount: 1,
    compactableDeltaEventCount: 5,
    compactionCutoffDays: 30,
    ...overrides
  } as StorageDiagnostics;
}

function createMaintenanceResult(overrides: Partial<StorageMaintenanceResult> = {}) {
  return {
    cutoffIso: '2026-01-01T00:00:00.000Z',
    cutoffDays: 30,
    runsCompacted: 2,
    deltaEventsDeleted: 3,
    vacuumApplied: false,
    sizeBeforeBytes: 1000,
    sizeAfterBytes: 600,
    reclaimedBytes: 400,
    ...overrides
  } as StorageMaintenanceResult;
}

function createHost(overrides?: Partial<AppShellDiagnosticsActionsHost>) {
  let activeThread: ThreadDetail | null = { id: 'thread-1' } as ThreadDetail;
  let route = 'thread';
  let settingsSection: SettingsSection = 'general';
  let storageDiagnostics: StorageDiagnostics | null = null;
  const toasts: Toast[] = [];
  const host: AppShellDiagnosticsActionsHost = {
    diagnostics: {
      export: vi.fn(async () => 'D:/tmp/vicode-diagnostics.json'),
      exportThread: vi.fn(async () => 'D:/tmp/thread-diagnostics.json'),
      exportThreadReport: vi.fn(async () => 'D:/tmp/thread-report.md'),
      getStorage: vi.fn(async () => createStorageDiagnostics()),
      compactRunEvents: vi.fn(async () => createMaintenanceResult()),
      maintainStorage: vi.fn(async () => createMaintenanceResult())
    },
    getActiveThread: () => activeThread,
    getRoute: () => route,
    getSettingsSection: () => settingsSection,
    getStorageDiagnostics: () => storageDiagnostics,
    setStorageDiagnostics: (value) => {
      storageDiagnostics = value;
    },
    showToast: (level, message) => {
      toasts.push({ level, message });
    },
    ...overrides
  };

  return {
    host,
    toasts,
    setActiveThread: (value: ThreadDetail | null) => {
      activeThread = value;
    },
    setVisibleStorageRoute: () => {
      route = 'settings';
      settingsSection = 'storage';
    },
    setStorageDiagnostics: (value: StorageDiagnostics | null) => {
      storageDiagnostics = value;
    },
    getStorageDiagnostics: () => storageDiagnostics
  };
}

describe('app shell diagnostics actions', () => {
  it('exports full diagnostics using existing toast copy', async () => {
    const state = createHost();

    await exportDiagnosticsInShell(state.host);

    expect(state.host.diagnostics.export).toHaveBeenCalled();
    expect(state.toasts).toEqual([
      { level: 'info', message: 'Diagnostics exported to D:/tmp/vicode-diagnostics.json' }
    ]);
  });

  it('warns before thread diagnostics when no thread is open', async () => {
    const state = createHost();
    state.setActiveThread(null);

    await exportActiveThreadDiagnosticsInShell(state.host);

    expect(state.host.diagnostics.exportThread).not.toHaveBeenCalled();
    expect(state.toasts).toEqual([
      { level: 'warning', message: 'Open a thread first.' }
    ]);
  });

  it('exports thread reports from the active thread', async () => {
    const state = createHost();

    await exportActiveThreadReportInShell(state.host);

    expect(state.host.diagnostics.exportThreadReport).toHaveBeenCalledWith('thread-1');
    expect(state.toasts).toEqual([
      { level: 'info', message: 'Thread report created at D:/tmp/thread-report.md' }
    ]);
  });

  it('clears storage diagnostics when loading storage state fails', async () => {
    const state = createHost({
      diagnostics: {
        ...createHost().host.diagnostics,
        getStorage: vi.fn(async () => {
          throw new Error('unavailable');
        })
      }
    });
    state.setStorageDiagnostics(createStorageDiagnostics());

    await loadStorageDiagnosticsInShell(state.host);

    expect(state.getStorageDiagnostics()).toBeNull();
  });

  it('refreshes storage diagnostics only when storage settings are visible or already loaded', async () => {
    const state = createHost();

    await refreshStorageDiagnosticsIfVisibleInShell(state.host);
    expect(state.host.diagnostics.getStorage).not.toHaveBeenCalled();

    state.setVisibleStorageRoute();
    await refreshStorageDiagnosticsIfVisibleInShell(state.host);
    expect(state.host.diagnostics.getStorage).toHaveBeenCalledTimes(1);
    expect(state.getStorageDiagnostics()).toEqual(expect.objectContaining({ databaseSizeBytes: 1 }));
  });

  it('compacts old run events, refreshes diagnostics, and preserves detailed copy', async () => {
    const state = createHost();

    await compactRunEventsInShell(state.host);

    expect(state.host.diagnostics.compactRunEvents).toHaveBeenCalled();
    expect(state.host.diagnostics.getStorage).toHaveBeenCalled();
    expect(state.toasts).toEqual([
      {
        level: 'info',
        message: 'Compacted 3 delta events across 2 archived runs and checkpointed SQLite. Reclaimed 400 bytes immediately.'
      }
    ]);
  });

  it('runs deep storage maintenance with the existing vacuum copy', async () => {
    const state = createHost({
      diagnostics: {
        ...createHost().host.diagnostics,
        export: vi.fn(async () => 'D:/tmp/vicode-diagnostics.json'),
        exportThread: vi.fn(async () => 'D:/tmp/thread-diagnostics.json'),
        exportThreadReport: vi.fn(async () => 'D:/tmp/thread-report.md'),
        getStorage: vi.fn(async () => createStorageDiagnostics()),
        compactRunEvents: vi.fn(async () => createMaintenanceResult()),
        maintainStorage: vi.fn(async () => createMaintenanceResult({ vacuumApplied: true, reclaimedBytes: 1000 }))
      }
    });

    await maintainStorageInShell(state.host, { vacuum: true });

    expect(state.host.diagnostics.maintainStorage).toHaveBeenCalledWith({ vacuum: true });
    expect(state.toasts).toEqual([
      {
        level: 'info',
        message: 'Deep cleanup finished. Reclaimed 1,000 bytes after compaction, WAL checkpoint, and VACUUM.'
      }
    ]);
  });
});
