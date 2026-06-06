import { ActionButton, PrimaryButton, SelectField, StatusPill, TextInput } from '../ui';
import { deriveUpdateInstallActionLabel } from '../../lib/app-update';
import { normalizeHexColor } from '../../lib/theme';
import type { SettingsViewProps } from './types';
import {
  accentModeOptions,
  appearanceModeOptions,
  followUpBehaviorOptions
} from './support';
import {
  SETTINGS_SECTION_CLASS,
  SettingsPanel,
  SettingsRow,
  SettingsSectionHeader
} from './shared';

const GITHUB_BUG_REPORT_URL = 'https://github.com/lowluds/vicode-windows-public/issues/new';

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

function workspaceProfileTone(settings: SettingsViewProps) {
  if (!settings.selectedProject) {
    return 'detected';
  }
  if (!settings.selectedProject.trusted) {
    return 'checking';
  }
  return settings.selectedProject.folderPath ? 'connected' : 'detected';
}

function workspaceProfileLabel(settings: SettingsViewProps) {
  if (!settings.selectedProject) {
    return 'No project';
  }
  if (!settings.selectedProject.trusted) {
    return 'Not trusted';
  }
  if (!settings.selectedProject.folderPath) {
    return 'Unavailable';
  }
  return 'App managed';
}

function workspaceSetupDescription(settings: SettingsViewProps) {
  if (!settings.selectedProject) {
    return 'Open a project to let Vicode assemble context for coding runs.';
  }
  if (!settings.selectedProject.trusted) {
    return 'Trust this workspace before providers can use project files.';
  }
  if (!settings.selectedProject.folderPath) {
    return 'Project context requires a real project folder.';
  }
  return 'Vicode detects project context automatically and keeps recall, notes, and durable context app-managed.';
}

function formatProjectContextName(settings: SettingsViewProps) {
  const project = settings.selectedProject;
  if (!project) {
    return 'No project selected';
  }

  const folderName = project.folderPath?.split(/[\\/]/u).filter(Boolean).pop() ?? null;
  if (folderName && folderName !== project.name) {
    return `${project.name} - ${folderName}`;
  }
  return project.name;
}

interface GeneralSettingsSectionProps {
  settings: SettingsViewProps;
  defaultAccentColor: string;
  currentAccentColor: string;
}

export function GeneralSettingsSection({
  settings,
  defaultAccentColor,
  currentAccentColor
}: GeneralSettingsSectionProps) {
  const updateInstallLabel = deriveUpdateInstallActionLabel();
  const updateInstallDisabled = settings.appUpdateState?.status !== 'downloaded';
  const updateDescription = settings.appUpdateState?.status === 'downloaded'
    ? settings.appUpdateState.availableVersion
      ? `Version ${settings.appUpdateState.availableVersion} is ready. Restarting now installs it immediately and stops the current run if one is active.`
      : 'The downloaded desktop update is ready. Restarting now installs it immediately and stops the current run if one is active.'
    : settings.appUpdateState?.message ?? 'Installed Windows builds check GitHub Releases on launch. npm installs remain manual-update only.';

  return (
    <div className={`${SETTINGS_SECTION_CLASS} settings-general-section`}>
      <SettingsSectionHeader
        title="App"
        description="Keep routine behavior, project context, and desktop updates predictable."
      />

      <SettingsPanel title="Behavior" description="Controls that change how the app responds while you work.">
        <SettingsRow
          label="Follow-up behavior"
          description="When a run is active, choose whether new text queues or steers."
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
          description="Use system, dark, or light mode."
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
          description="Use the Windows accent or choose one for Vicode."
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
            description="Applies immediately."
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
        title="Project context"
        description="Vicode handles workspace instructions and memory behind the scenes."
        className="settings-workspace-agent-panel"
      >
        <SettingsRow
          label="Context"
          description={workspaceSetupDescription(settings)}
          className="settings-workspace-project-row"
        >
          <StatusPill tone={workspaceProfileTone(settings)}>{workspaceProfileLabel(settings)}</StatusPill>
        </SettingsRow>
        <div className="settings-workspace-project-path">
          {formatProjectContextName(settings)}
        </div>
        <div className="settings-stat-grid settings-workspace-agent-context">
          <span>Project files: detected automatically</span>
          <span>Memory: handled by Vicode</span>
        </div>
      </SettingsPanel>

      <SettingsPanel
        title="Updates"
        description="Current desktop build and update channel."
      >
        <SettingsRow label="App version" description="Current desktop build.">
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
                disabled={updateInstallDisabled}
              >
                {updateInstallLabel}
              </PrimaryButton>
            ) : null}
          </div>
        </SettingsRow>
        <SettingsRow
          label="Last checked"
          description={settings.appUpdateState?.availableVersion ? 'Newest desktop build found for this channel.' : 'Last successful desktop update check.'}
        >
          <span className="settings-row-value">{formatUpdateTime(settings.appUpdateState?.lastCheckedAt ?? null)}</span>
        </SettingsRow>
      </SettingsPanel>

      <SettingsPanel
        title="Support and feedback"
        description="Public beta reporting and follow-up."
      >
        <SettingsRow
          label="Bug reports"
          description="Open the public GitHub Issues form. Attach a thread report when the issue came from a specific run."
        >
          <ActionButton
            size="compact"
            tone="quiet"
            onClick={() => void window.vicode.app.openExternal(GITHUB_BUG_REPORT_URL)}
          >
            Open GitHub Issues
          </ActionButton>
        </SettingsRow>
        <SettingsRow
          label="Thread report"
          description={
            settings.activeThreadTitle
              ? 'Create a redacted local report for the current thread.'
              : 'Open a thread to create a redacted report for an issue.'
          }
        >
          <ActionButton
            size="compact"
            tone="quiet"
            onClick={() => void settings.exportActiveThreadReport()}
            disabled={!settings.activeThreadTitle}
          >
            Create report
          </ActionButton>
        </SettingsRow>
      </SettingsPanel>
    </div>
  );
}
