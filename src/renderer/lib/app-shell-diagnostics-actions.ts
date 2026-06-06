import type {
  SettingsSection,
  ThreadDetail
} from '../../shared/domain';
import type {
  StorageCompactionResult,
  StorageDiagnostics,
  StorageMaintenanceResult
} from '../../shared/ipc';
import { formatUserErrorMessage } from './error-format';

type ToastLevel = 'info' | 'warning' | 'error';

export interface AppShellDiagnosticsActionsHost {
  diagnostics: {
    export(): Promise<string>;
    exportThread(threadId: string): Promise<string>;
    exportThreadReport(threadId: string): Promise<string>;
    getStorage(): Promise<StorageDiagnostics>;
    compactRunEvents(): Promise<StorageMaintenanceResult>;
    maintainStorage(input?: { vacuum?: boolean }): Promise<StorageMaintenanceResult>;
  };
  getActiveThread(): ThreadDetail | null;
  getRoute(): string;
  getSettingsSection(): SettingsSection;
  getStorageDiagnostics(): StorageDiagnostics | null;
  setStorageDiagnostics(value: StorageDiagnostics | null): void;
  showToast(level: ToastLevel, message: string): void;
}

export async function exportDiagnosticsInShell(host: AppShellDiagnosticsActionsHost) {
  host.showToast('info', `Diagnostics exported to ${await host.diagnostics.export()}`);
}

export async function exportActiveThreadDiagnosticsInShell(host: AppShellDiagnosticsActionsHost) {
  const activeThread = host.getActiveThread();
  if (!activeThread) {
    host.showToast('warning', 'Open a thread first.');
    return;
  }

  try {
    const path = await host.diagnostics.exportThread(activeThread.id);
    host.showToast('info', `Thread diagnostics exported to ${path}`);
  } catch (error) {
    host.showToast('error', formatUserErrorMessage(error, 'Failed to export thread diagnostics.'));
  }
}

export async function exportActiveThreadReportInShell(host: AppShellDiagnosticsActionsHost) {
  const activeThread = host.getActiveThread();
  if (!activeThread) {
    host.showToast('warning', 'Open a thread first.');
    return;
  }

  try {
    const path = await host.diagnostics.exportThreadReport(activeThread.id);
    host.showToast('info', `Thread report created at ${path}`);
  } catch (error) {
    host.showToast('error', formatUserErrorMessage(error, 'Failed to create thread report.'));
  }
}

export async function loadStorageDiagnosticsInShell(host: AppShellDiagnosticsActionsHost) {
  try {
    host.setStorageDiagnostics(await host.diagnostics.getStorage());
  } catch {
    host.setStorageDiagnostics(null);
  }
}

export async function refreshStorageDiagnosticsIfVisibleInShell(host: AppShellDiagnosticsActionsHost) {
  if (
    (host.getRoute() === 'settings' &&
      (host.getSettingsSection() === 'diagnostics' || host.getSettingsSection() === 'storage')) ||
    host.getStorageDiagnostics() !== null
  ) {
    await loadStorageDiagnosticsInShell(host);
  }
}

function storageCompactionToast(result: StorageCompactionResult & { reclaimedBytes: number }) {
  return result.deltaEventsDeleted > 0
    ? `Compacted ${result.deltaEventsDeleted} delta events across ${result.runsCompacted} archived runs and checkpointed SQLite. Reclaimed ${result.reclaimedBytes.toLocaleString()} bytes immediately.`
    : result.reclaimedBytes > 0
      ? `No archived terminal runs older than ${result.cutoffDays} days were eligible for compaction, but SQLite checkpointing still reclaimed ${result.reclaimedBytes.toLocaleString()} bytes.`
    : `No archived terminal runs older than ${result.cutoffDays} days were eligible for compaction.`;
}

export async function compactRunEventsInShell(host: AppShellDiagnosticsActionsHost) {
  try {
    const result = await host.diagnostics.compactRunEvents();
    await loadStorageDiagnosticsInShell(host);
    host.showToast('info', storageCompactionToast(result));
  } catch (error) {
    host.showToast('error', formatUserErrorMessage(error, 'Failed to compact old run events.'));
  }
}

export async function maintainStorageInShell(
  host: AppShellDiagnosticsActionsHost,
  input?: { vacuum?: boolean }
) {
  try {
    const result = await host.diagnostics.maintainStorage(input);
    await loadStorageDiagnosticsInShell(host);
    host.showToast(
      'info',
      result.vacuumApplied
        ? `Deep cleanup finished. Reclaimed ${result.reclaimedBytes.toLocaleString()} bytes after compaction, WAL checkpoint, and VACUUM.`
        : `SQLite maintenance finished. Reclaimed ${result.reclaimedBytes.toLocaleString()} bytes.`
    );
  } catch (error) {
    host.showToast('error', formatUserErrorMessage(error, 'Failed to run SQLite maintenance.'));
  }
}
