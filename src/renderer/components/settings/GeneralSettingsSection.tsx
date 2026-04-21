import { ActionButton, PrimaryButton, SelectField, StatusPill, TextInput } from '../ui';
import { RefreshIcon } from '../icons';
import { deriveUpdateInstallActionLabel, isQueuedUpdateInstall } from '../../lib/app-update';
import { normalizeHexColor } from '../../lib/theme';
import type { SettingsViewProps } from './types';
import {
  accentModeOptions,
  appearanceModeOptions,
  followUpBehaviorOptions,
  formatStorageAmount
} from './support';
import {
  SETTINGS_INLINE_ACTIONS_CLASS,
  SETTINGS_SECTION_CLASS,
  SettingsPanel,
  SettingsRow,
  SettingsSectionHeader
} from './shared';

function formatUpdateTime(value: string | null) {
  if (!value) {
    return 'Never';
  }
  return new Date(value).toLocaleString();
}

function updateStatusTone(state: SettingsViewProps['appUpdateState']) {
  switch (state?.status) {
    case 'up_to_date':
    case 'downloaded':
      return 'connected';
    case 'checking':
    case 'available':
    case 'downloading':
      return 'checking';
    case 'error':
      return 'failed';
    default:
      return 'detected';
  }
}

function updateStatusLabel(state: SettingsViewProps['appUpdateState']) {
  switch (state?.status) {
    case 'checking':
      return 'Checking';
    case 'available':
      return 'Available';
    case 'downloading':
      return state.downloadPercent !== null ? `Downloading ${Math.round(state.downloadPercent)}%` : 'Downloading';
    case 'downloaded':
      return 'Restart ready';
    case 'up_to_date':
      return 'Up to date';
    case 'error':
      return 'Check failed';
    case 'disabled':
      return 'Unavailable';
    default:
      return 'Idle';
  }
}

interface GeneralSettingsSectionProps {
  settings: SettingsViewProps;
  defaultAccentColor: string;
  currentAccentColor: string;
  onOpenCompactRunEvents: () => void;
  onOpenVacuumStorage: () => void;
}

export function GeneralSettingsSection({
  settings,
  defaultAccentColor,
  currentAccentColor,
  onOpenCompactRunEvents,
  onOpenVacuumStorage
}: GeneralSettingsSectionProps) {
  const updateInstallQueued = isQueuedUpdateInstall(settings.appUpdateState, settings.queuedUpdateInstallKey);
  const updateInstallLabel = deriveUpdateInstallActionLabel({
    appUpdateState: settings.appUpdateState,
    hasActiveRun: settings.hasActiveRun,
    queuedUpdateInstallKey: settings.queuedUpdateInstallKey
  });
  const updateDescription = updateInstallQueued
    ? settings.appUpdateState?.availableVersion
      ? `Version ${settings.appUpdateState.availableVersion} is queued and will install when the current run finishes.`
      : 'The downloaded desktop update is queued and will install when the current run finishes.'
    : settings.appUpdateState?.status === 'downloaded' && settings.hasActiveRun
      ? settings.appUpdateState.availableVersion
        ? `Version ${settings.appUpdateState.availableVersion} is ready. Installing it will wait until the current run finishes.`
        : 'The downloaded desktop update is ready. Installing it will wait until the current run finishes.'
      : settings.appUpdateState?.message ?? 'Installed Windows builds check GitHub Releases on launch. npm installs remain manual-update only.';

  return (
    <div className={`${SETTINGS_SECTION_CLASS} settings-general-section`}>
      <SettingsSectionHeader
        title="General"
        description="Configure the desktop shell, workspace defaults, and local housekeeping without leaving the current machine."
      />

      <SettingsPanel title="Desktop behavior" description="Keep the shell predictable and low-noise.">
        <SettingsRow
          label="Follow-up behavior"
          description="Choose what Send does while a thread is already running."
        >
          <SelectField
            className="settings-row-select"
            menuClassName="settings-general-select-menu"
            value={settings.preferences?.followUpBehavior ?? 'queue'}
            onChange={(event) =>
              void settings.savePreferences({
                followUpBehavior: event.target.value as (typeof followUpBehaviorOptions)[number]['value']
              })
            }
          >
            {followUpBehaviorOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
        </SettingsRow>
        <SettingsRow
          label="Theme mode"
          description="Follow the system theme or force a consistent app shell."
        >
          <SelectField
            className="settings-row-select"
            menuClassName="settings-general-select-menu"
            value={settings.preferences?.appearanceMode ?? 'system'}
            onChange={(event) =>
              void settings.savePreferences({
                appearanceMode: event.target.value as (typeof appearanceModeOptions)[number]['value']
              })
            }
          >
            {appearanceModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
        </SettingsRow>
        <SettingsRow
          label="Accent source"
          description="Use the current Windows accent or pin a Vicode-specific accent."
        >
          <SelectField
            className="settings-row-select"
            menuClassName="settings-general-select-menu"
            value={settings.preferences?.accentMode ?? 'system'}
            onChange={(event) => {
              const nextMode = event.target.value as (typeof accentModeOptions)[number]['value'];
              void settings.savePreferences({
                accentMode: nextMode,
                accentColor: nextMode === 'custom' ? currentAccentColor : null
              });
            }}
          >
            {accentModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectField>
        </SettingsRow>
        {(settings.preferences?.accentMode ?? 'system') === 'custom' ? (
          <SettingsRow
            label="Custom accent"
            description="Applied immediately across the renderer shell."
            className="is-compact"
          >
            <div className="settings-accent-row">
              <TextInput
                type="color"
                value={currentAccentColor}
                onChange={(event) =>
                  void settings.savePreferences({
                    accentMode: 'custom',
                    accentColor: normalizeHexColor(event.target.value) ?? defaultAccentColor
                  })
                }
                className="settings-accent-picker"
              />
              <TextInput value={currentAccentColor} readOnly className="settings-accent-value" />
            </div>
          </SettingsRow>
        ) : null}
      </SettingsPanel>

      <SettingsPanel
        title="Generated memory"
        description="Control the derived Codex-style memory lane separately from canonical workspace files."
      >
        <SettingsRow
          label="Use generated recall"
          description="Allow bounded derived recall from prior trusted threads in the same workspace. Canonical workspace files still win."
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
          description="Capture conservative derived memory from completed trusted threads into the shadow memory lane."
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

      <SettingsPanel
        title="Workspace overview"
        description="Current app and workspace state on this machine."
      >
        <SettingsRow
          label="Current project"
          description={settings.selectedProject?.folderPath ?? 'No workspace folder attached yet.'}
        >
          <span className="settings-row-value">
            {settings.selectedProject?.name ?? 'No project selected'}
          </span>
        </SettingsRow>
        <SettingsRow label="App version" description="Desktop build currently running.">
          <span className="settings-row-value">{settings.appMeta?.version ?? 'Unknown'}</span>
        </SettingsRow>
        <SettingsRow
          label="Updates"
          description={updateDescription}
        >
          <div className="settings-row-actions">
            <StatusPill tone={updateStatusTone(settings.appUpdateState)}>
              {updateStatusLabel(settings.appUpdateState)}
            </StatusPill>
            <ActionButton
              size="compact"
              tone="quiet"
              onClick={() => void settings.checkForAppUpdates()}
              disabled={
                !settings.appUpdateState?.enabled ||
                settings.appUpdateState.status === 'checking' ||
                settings.appUpdateState.status === 'downloading'
              }
            >
              {settings.appUpdateState?.status === 'checking'
                ? 'Checking...'
                : settings.appUpdateState?.status === 'downloading'
                  ? 'Downloading...'
                  : 'Check now'}
            </ActionButton>
            {settings.appUpdateState?.status === 'downloaded' ? (
              <PrimaryButton
                size="compact"
                onClick={() => void settings.restartToUpdate()}
                disabled={updateInstallQueued}
              >
                {updateInstallLabel}
              </PrimaryButton>
            ) : null}
          </div>
        </SettingsRow>
        <SettingsRow
          label="Last checked"
          description={settings.appUpdateState?.availableVersion ? 'Newest available desktop build detected for this install channel.' : 'Last successful desktop update check for this app install.'}
        >
          <span className="settings-row-value">{formatUpdateTime(settings.appUpdateState?.lastCheckedAt ?? null)}</span>
        </SettingsRow>
      </SettingsPanel>

      <SettingsPanel
        title="Storage and cleanup"
        description="Local thread storage, maintenance, and compaction."
      >
        <SettingsRow
          label="Thread storage"
          description="Refresh the current SQLite footprint and local counts."
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
          are the only runs eligible for compaction. WAL checkpointing reclaims lagging write-ahead
          storage, and vacuum is available for deeper cleanup.
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
      </SettingsPanel>

      <SettingsPanel
        title="Current workspace bootstrap"
        description="Review or bootstrap durable workspace files for the selected project."
      >
        <div className="settings-workspace-bootstrap-copy flex items-start justify-between gap-4">
          <div className="settings-inline-note">
            {settings.selectedProject
              ? `Project: ${settings.selectedProject.name}`
              : 'Select a project with a real workspace folder.'}
            {settings.selectedProject?.folderPath ? ` ${settings.selectedProject.folderPath}` : ''}
          </div>
          <StatusPill
            tone={
              settings.workspaceBootstrapStatus?.eligible
                ? settings.workspaceBootstrapStatus.needsBootstrap
                  ? 'checking'
                  : 'connected'
                : 'detected'
            }
          >
            {!settings.selectedProject
              ? 'No project'
              : !settings.workspaceBootstrapStatus?.eligible
                ? 'Unavailable'
                : settings.workspaceBootstrapStatus.dismissed &&
                    settings.workspaceBootstrapStatus.needsBootstrap
                  ? 'Dismissed'
                  : settings.workspaceBootstrapStatus.needsBootstrap
                    ? 'Ready'
                    : 'Complete'}
          </StatusPill>
        </div>
        <div className="settings-stat-grid">
          <span>
            {settings.workspaceBootstrapStatus?.reason ??
              settings.workspaceBootstrapStatus?.folderPath ??
              'Select a project with a real workspace folder.'}
          </span>
          {settings.selectedProject ? (
            <span>
              {settings.selectedProject.trusted ? 'Workspace access: trusted for this project' : 'Workspace access: not trusted yet'}
            </span>
          ) : null}
          {settings.workspaceBootstrapStatus?.missingFiles.length ? (
            <span>Missing: {settings.workspaceBootstrapStatus.missingFiles.join(', ')}</span>
          ) : settings.workspaceBootstrapStatus?.dismissed ? (
            <span>
              The project-level suggestion is dismissed for this workspace, but you can still manage
              its files here.
            </span>
          ) : settings.workspaceBootstrapStatus?.eligible ? (
            <span>Core workspace files already exist for this project.</span>
          ) : null}
        </div>
        <div className={SETTINGS_INLINE_ACTIONS_CLASS}>
          <PrimaryButton
            onClick={() => void settings.openWorkspaceBootstrap()}
            disabled={!settings.workspaceBootstrapStatus?.eligible}
          >
            {settings.workspaceBootstrapStatus?.needsBootstrap
              ? 'Set up current workspace'
              : 'Review current workspace files'}
          </PrimaryButton>
        </div>
      </SettingsPanel>
    </div>
  );
}
