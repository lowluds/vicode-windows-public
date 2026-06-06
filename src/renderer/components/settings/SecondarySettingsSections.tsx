import { useMemo } from 'react';
import { ActionButton, PrimaryButton, SurfaceCard } from '../ui';
import { ArchiveIcon, RefreshIcon } from '../icons';
import { StatusPill } from '../ui';
import type { SettingsViewProps } from './types';
import { providerDisplayName, formatStorageAmount, formatTime } from './support';
import {
  SETTINGS_INLINE_ACTIONS_CLASS,
  SETTINGS_SECTION_CLASS,
  SettingsPanel,
  SettingsRow,
  SettingsSectionHeader
} from './shared';

export function AdvancedSettingsSection({
  settings,
  onOpenCompactRunEvents,
  onOpenVacuumStorage
}: {
  settings: SettingsViewProps;
  onOpenCompactRunEvents: () => void;
  onOpenVacuumStorage: () => void;
}) {
  return (
    <div className={SETTINGS_SECTION_CLASS}>
      <SettingsSectionHeader
        title="Advanced"
        description="Diagnostics and local storage maintenance."
      />

      <SettingsPanel title="Diagnostics" description="Export local app diagnostics for deeper support review.">
        <SettingsRow
          label="Export app diagnostics"
          description="Includes broad app state, provider status, and run diagnostics. Use thread reports for public bug reports."
        >
          <PrimaryButton size="compact" onClick={() => void settings.exportDiagnostics()}>
            Export
          </PrimaryButton>
        </SettingsRow>
        <SettingsRow
          label="State path"
          description="Local folder used for app state."
          className="is-path-row"
        >
          <span className="settings-row-value">{settings.appMeta?.statePath ?? 'Unavailable'}</span>
        </SettingsRow>
      </SettingsPanel>

      <SettingsPanel title="Local storage" description="Local database size, cleanup, and app-owned paths.">
        <SettingsRow
          label="Thread storage"
          description="Refresh local storage size and counts."
        >
          <div className="settings-row-actions">
            <span className="settings-row-value">
              {formatStorageAmount(settings.storageDiagnostics?.totalStorageBytes)}
            </span>
            <ActionButton
              size="compact"
              tone="quiet"
              onClick={() => void settings.refreshStorageDiagnostics()}
              leadingIcon={<RefreshIcon />}
            >
              Refresh
            </ActionButton>
          </div>
        </SettingsRow>
        <div className="settings-stat-grid">
          <span>Database: {formatStorageAmount(settings.storageDiagnostics?.databaseSizeBytes)}</span>
          <span>WAL: {formatStorageAmount(settings.storageDiagnostics?.walSizeBytes)}</span>
          <span>Projects: {settings.storageDiagnostics?.projectCount ?? 'Unavailable'}</span>
          <span>Threads: {settings.storageDiagnostics?.threadCount ?? 'Unavailable'}</span>
          <span>Archived: {settings.storageDiagnostics?.archivedThreadCount ?? 'Unavailable'}</span>
          <span>Run events: {settings.storageDiagnostics?.runEventCount ?? 'Unavailable'}</span>
        </div>
        <div className="settings-inline-note">
          Archived terminal runs older than {settings.storageDiagnostics?.compactionCutoffDays ?? 30} days
          can be compacted. Checkpointing reclaims write-ahead storage. Deep cleanup runs VACUUM.
        </div>
        <div className={SETTINGS_INLINE_ACTIONS_CLASS}>
          <ActionButton
            size="compact"
            tone="quiet"
            onClick={onOpenCompactRunEvents}
            disabled={!settings.storageDiagnostics?.compactableDeltaEventCount}
          >
            Compact + checkpoint
          </ActionButton>
          <ActionButton
            size="compact"
            tone="quiet"
            onClick={onOpenVacuumStorage}
            disabled={!settings.storageDiagnostics}
          >
            Deep cleanup
          </ActionButton>
        </div>
        <SettingsRow label="App data" description="Vicode state and local database." className="is-path-row">
          <span className="settings-row-value">{settings.appMeta?.userDataPath ?? 'Unavailable'}</span>
        </SettingsRow>
        <SettingsRow label="Exports" description="Diagnostics and exported files." className="is-path-row">
          <span className="settings-row-value">{settings.appMeta?.exportsPath ?? 'Unavailable'}</span>
        </SettingsRow>
        <SettingsRow label="Active project" description="Workspace folder for current runs." className="is-path-row">
          <span className="settings-row-value">{settings.selectedProject?.folderPath ?? 'No folder attached yet'}</span>
        </SettingsRow>
      </SettingsPanel>

    </div>
  );
}

export function ArchivedThreadsSection({
  settings,
  onRequestDeleteArchivedThread
}: {
  settings: SettingsViewProps;
  onRequestDeleteArchivedThread: (threadId: string) => void;
}) {
  const projectNameById = useMemo(
    () => Object.fromEntries(settings.projects.map((project) => [project.id, project.name])),
    [settings.projects]
  );

  return (
    <div className={SETTINGS_SECTION_CLASS}>
      <SettingsSectionHeader
        title="Archived threads"
        description="Restore archived threads, or delete them permanently."
      />
      <div className="settings-archived-list flex flex-1 flex-col gap-4 min-h-0">
        {settings.archivedThreads.length === 0 ? (
          <SurfaceCard>
            <h3>No archived threads</h3>
            <p>
              Archived threads appear here after you remove them from active project lists.
            </p>
          </SurfaceCard>
        ) : (
          settings.archivedThreads.map((thread) => (
            <SurfaceCard key={thread.id} className="settings-archived-card flex flex-col gap-4">
              <div className="settings-archived-top flex items-start justify-between gap-4">
                <div>
                  <h3>{thread.title}</h3>
                  <p>{projectNameById[thread.projectId] ?? 'Unknown project'}</p>
                </div>
                <StatusPill tone={thread.status}>{thread.status}</StatusPill>
              </div>
              <div className="skill-meta">
                <span>{providerDisplayName(thread.providerId)}</span>
                <span>{thread.modelId}</span>
                <span>{formatTime(thread.updatedAt)}</span>
              </div>
              <div className={SETTINGS_INLINE_ACTIONS_CLASS}>
                <ActionButton
                  onClick={() => void settings.restoreArchivedThread(thread.id)}
                  leadingIcon={<ArchiveIcon />}
                >
                  Restore thread
                </ActionButton>
                <ActionButton tone="danger" onClick={() => onRequestDeleteArchivedThread(thread.id)}>
                  Delete permanently
                </ActionButton>
              </div>
            </SurfaceCard>
          ))
        )}
      </div>
    </div>
  );
}
