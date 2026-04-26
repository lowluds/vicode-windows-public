import { useMemo } from 'react';
import { ActionButton, PrimaryButton, SelectField, SurfaceCard, TextArea } from '../ui';
import { ArchiveIcon, RefreshIcon, SaveIcon } from '../icons';
import { StatusPill } from '../ui';
import type { PersonalizationSettings } from '../../../shared/domain';
import type { SettingsViewProps } from './types';
import { providerDisplayName, formatStorageAmount, formatTime } from './support';
import {
  SETTINGS_INLINE_ACTIONS_CLASS,
  SETTINGS_SECTION_CLASS,
  SettingsPanel,
  SettingsRow,
  SettingsSectionHeader
} from './shared';

interface PersonalizationSettingsSectionProps {
  settings: SettingsViewProps;
  personalizationDraft: PersonalizationSettings;
  setDraftField: (field: 'globalInstructions' | 'useWorkspaceInstructions', value: string | boolean) => void;
  setDraftProviderField: (providerId: keyof PersonalizationSettings['providerInstructions'], value: string) => void;
  onReset: () => void;
}

export function PersonalizationSettingsSection({
  settings,
  personalizationDraft,
  setDraftField,
  setDraftProviderField,
  onReset
}: PersonalizationSettingsSectionProps) {
  return (
    <div className={SETTINGS_SECTION_CLASS}>
      <SettingsSectionHeader
        title="Instructions"
        description="Set the short instructions Vicode adds before project files and skills."
      />
      <div className="settings-detail-block settings-personalization-block flex flex-col gap-4 rounded-[24px] border border-transparent bg-transparent p-5">
        <label className="settings-field flex flex-col gap-2">
          <span>Global instructions</span>
          <TextArea
            className="settings-personalization-area"
            value={personalizationDraft.globalInstructions}
            onChange={(event) => setDraftField('globalInstructions', event.target.value)}
            placeholder="Applies to every provider before project instructions and skills."
          />
        </label>
        {settings.providers.map((provider) => (
          <label
            key={`provider-personalization-${provider.id}`}
            className="settings-field flex flex-col gap-2"
          >
            <span>{providerDisplayName(provider.id)} instructions</span>
            <TextArea
              className="settings-personalization-area"
              value={personalizationDraft.providerInstructions[provider.id]}
              onChange={(event) => setDraftProviderField(provider.id, event.target.value)}
              placeholder={`Only applies to ${providerDisplayName(provider.id)} runs.`}
            />
          </label>
        ))}
        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={personalizationDraft.useWorkspaceInstructions}
            onChange={(event) => setDraftField('useWorkspaceInstructions', event.target.checked)}
          />
          <span>
            Use trusted workspace instruction files when present.
          </span>
        </label>
        <div className={SETTINGS_INLINE_ACTIONS_CLASS}>
          <PrimaryButton
            onClick={() => void settings.savePersonalization(personalizationDraft)}
            leadingIcon={<SaveIcon />}
          >
            Save changes
          </PrimaryButton>
          <ActionButton onClick={onReset} leadingIcon={<RefreshIcon />}>
            Reset to saved
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

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
        description="Diagnostics, storage maintenance, and experimental memory controls."
      />

      <SettingsPanel title="Diagnostics" description="Export a redacted local package when support needs it.">
        <SettingsRow
          label="Export package"
          description="Includes app state, provider status, and logs for inspection."
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

      <SettingsPanel title="Experimental memory" description="Derived summaries stay separate from project files.">
        <SettingsRow
          label="Use generated recall"
          description="Use summaries from prior trusted threads when they match the task."
        >
          <SelectField
            className="settings-row-select"
            menuClassName="settings-general-select-menu"
            value={settings.preferences?.generatedMemoryUseEnabled ? 'enabled' : 'disabled'}
            onChange={(event) =>
              void settings.savePreferences({
                generatedMemoryUseEnabled: event.target.value === 'enabled'
              })
            }
          >
            <option value="disabled">Disabled</option>
            <option value="enabled">Enabled</option>
          </SelectField>
        </SettingsRow>
        <SettingsRow
          label="Generate derived memory"
          description="Create summaries after trusted threads complete."
        >
          <SelectField
            className="settings-row-select"
            menuClassName="settings-general-select-menu"
            value={settings.preferences?.generatedMemoryGenerationEnabled === false ? 'disabled' : 'enabled'}
            onChange={(event) =>
              void settings.savePreferences({
                generatedMemoryGenerationEnabled: event.target.value === 'enabled'
              })
            }
          >
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </SelectField>
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
