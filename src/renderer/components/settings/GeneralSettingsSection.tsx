import { ActionButton, PrimaryButton, SelectField, StatusPill, TextInput } from '../ui';
import { deriveUpdateInstallActionLabel } from '../../lib/app-update';
import { normalizeHexColor } from '../../lib/theme';
import type { SettingsViewProps } from './types';
import type { WorkspaceContractFileStatus } from '../../../shared/ipc';
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

const GITHUB_BUG_REPORT_URL = 'https://github.com/lowluds/vicode-windows/issues/new?template=bug-report.yml';

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

const fallbackContractFiles: WorkspaceContractFileStatus[] = [
  {
    kind: 'agents',
    label: 'Operating guide',
    fileName: 'AGENTS.md',
    relativePath: 'AGENTS.md',
    purpose: 'Stable repo rules and working standards.',
    exists: false,
    required: true,
    loadMode: 'direct_prompt'
  },
  {
    kind: 'soul',
    label: 'Agent identity',
    fileName: 'SOUL.md',
    relativePath: 'SOUL.md',
    purpose: 'Optional workspace tone and collaborator posture.',
    exists: false,
    required: false,
    loadMode: 'direct_prompt'
  },
  {
    kind: 'user',
    label: 'User preferences',
    fileName: 'USER.md',
    relativePath: 'USER.md',
    purpose: 'Durable communication and approval preferences.',
    exists: false,
    required: false,
    loadMode: 'direct_prompt'
  },
  {
    kind: 'memory',
    label: 'Long-term memory',
    fileName: 'MEMORY.md',
    relativePath: 'MEMORY.md',
    purpose: 'Curated facts and decisions that survive threads.',
    exists: false,
    required: false,
    loadMode: 'memory_retrieval'
  },
  {
    kind: 'daily_note',
    label: 'Recent notes',
    fileName: 'memory/YYYY-MM-DD.md',
    relativePath: 'memory/YYYY-MM-DD.md',
    purpose: 'Rolling workspace notes promoted through review.',
    exists: false,
    required: false,
    loadMode: 'memory_retrieval'
  }
];

function getWorkspaceContractFiles(status: SettingsViewProps['workspaceBootstrapStatus']) {
  if (status?.contractFiles?.length) {
    return status.contractFiles;
  }

  const existing = new Set(status?.existingFiles ?? []);
  return fallbackContractFiles.map((file) => ({
    ...file,
    exists: existing.has(file.relativePath)
  }));
}

function workspaceProfileTone(settings: SettingsViewProps) {
  if (!settings.selectedProject) {
    return 'detected';
  }
  if (!settings.selectedProject.trusted || settings.workspaceBootstrapStatus?.needsBootstrap) {
    return 'checking';
  }
  return settings.workspaceBootstrapStatus?.eligible ? 'connected' : 'detected';
}

function workspaceProfileLabel(settings: SettingsViewProps) {
  if (!settings.selectedProject) {
    return 'No project';
  }
  if (!settings.selectedProject.trusted) {
    return 'Not trusted';
  }
  if (!settings.workspaceBootstrapStatus?.eligible) {
    return 'Unavailable';
  }
  return settings.workspaceBootstrapStatus.needsBootstrap ? 'Setup needed' : 'Active';
}

function fileStatusTone(file: WorkspaceContractFileStatus) {
  if (file.exists) {
    return 'connected';
  }
  return file.required ? 'checking' : 'detected';
}

function fileStatusLabel(file: WorkspaceContractFileStatus) {
  if (file.exists) {
    return 'Present';
  }
  return file.required ? 'Needed' : 'Optional';
}

function formatLoadMode(file: WorkspaceContractFileStatus) {
  switch (file.loadMode) {
    case 'direct_prompt':
      return 'Prompt';
    case 'memory_retrieval':
      return 'Recall';
    default:
      return 'Draft only';
  }
}

function workspaceSetupDescription(settings: SettingsViewProps) {
  if (!settings.selectedProject) {
    return 'Select a project before setting up workspace files.';
  }
  if (!settings.selectedProject.trusted) {
    return 'Trust this workspace before providers can use project files.';
  }
  if (!settings.workspaceBootstrapStatus?.eligible) {
    return settings.workspaceBootstrapStatus?.reason ?? 'Workspace setup is unavailable for this project.';
  }
  if (settings.workspaceBootstrapStatus.needsBootstrap) {
    const missing = settings.workspaceBootstrapStatus.missingFiles.join(', ');
    return missing ? `Missing: ${missing}` : 'Required workspace files are not ready yet.';
  }
  return 'Project files and memory are ready for trusted runs.';
}

function formatActiveThreadReviewDescription(settings: SettingsViewProps) {
  if (!settings.selectedProject?.trusted) {
    return 'Trust the current workspace before saving notes from a thread.';
  }
  if (!settings.activeThreadTitle) {
    return 'Open a thread to create a review draft before saving.';
  }
  const title =
    settings.activeThreadTitle.length > 72
      ? `${settings.activeThreadTitle.slice(0, 69).trim()}...`
      : settings.activeThreadTitle;
  return `Creates a review draft from "${title}" before saving.`;
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
  const workspaceContractFiles = getWorkspaceContractFiles(settings.workspaceBootstrapStatus);
  const canCreateThreadMemoryReviews = Boolean(settings.activeThreadTitle && settings.selectedProject?.trusted);
  const updateInstallLabel = deriveUpdateInstallActionLabel();
  const updateDescription = settings.appUpdateState?.status === 'downloaded'
    ? settings.appUpdateState.availableVersion
      ? `Version ${settings.appUpdateState.availableVersion} is ready. Restarting now installs it immediately and stops the current run if one is active.`
      : 'The downloaded desktop update is ready. Restarting now installs it immediately and stops the current run if one is active.'
    : settings.appUpdateState?.message ?? 'Installed Windows builds check GitHub Releases on launch. npm installs remain manual-update only.';

  return (
    <div className={`${SETTINGS_SECTION_CLASS} settings-general-section`}>
      <SettingsSectionHeader
        title="App"
        description="Keep routine behavior, workspace setup, and desktop updates predictable."
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
        title="Workspace"
        description="What Vicode can use when trusted runs work in this project."
        className="settings-workspace-agent-panel"
      >
        <SettingsRow
          label="Project setup"
          description={workspaceSetupDescription(settings)}
          className="settings-workspace-project-row"
        >
          <div className="settings-row-actions">
            <StatusPill tone={workspaceProfileTone(settings)}>{workspaceProfileLabel(settings)}</StatusPill>
            <PrimaryButton
              size="compact"
              onClick={() => void settings.openWorkspaceBootstrap()}
              disabled={!settings.workspaceBootstrapStatus?.eligible}
            >
              {settings.workspaceBootstrapStatus?.needsBootstrap ? 'Set up' : 'Review files'}
            </PrimaryButton>
          </div>
        </SettingsRow>
        <div className="settings-workspace-project-path">
          {settings.selectedProject
            ? `${settings.selectedProject.name}${settings.selectedProject.folderPath ? ` - ${settings.selectedProject.folderPath}` : ''}`
            : 'No project selected'}
        </div>
        <div className="settings-workspace-file-list" aria-label="Workspace files">
          {workspaceContractFiles.map((file) => (
            <div key={file.kind} className="settings-workspace-file-row">
              <div className="settings-workspace-agent-file-copy">
                <strong>{file.fileName}</strong>
                <span>{file.label}</span>
              </div>
              <div className="settings-workspace-agent-file-meta">
                <StatusPill tone={fileStatusTone(file)}>{fileStatusLabel(file)}</StatusPill>
                <span>{formatLoadMode(file)}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="settings-stat-grid settings-workspace-agent-context">
          <span>Context files: {settings.personalization.useWorkspaceInstructions ? 'on' : 'off'}</span>
          <span>Memory recall: when relevant</span>
        </div>
        <SettingsRow
          label="Save from this thread"
          description={formatActiveThreadReviewDescription(settings)}
          className="settings-memory-save-row"
        >
          <div className="settings-row-actions">
            <ActionButton
              size="compact"
              tone="quiet"
              onClick={() => void settings.captureDailyNoteFromThread()}
              disabled={!canCreateThreadMemoryReviews}
            >
              Daily note
            </ActionButton>
            <ActionButton
              size="compact"
              tone="quiet"
              onClick={() => void settings.promoteThreadToMemory()}
              disabled={!canCreateThreadMemoryReviews}
            >
              Project fact
            </ActionButton>
            <ActionButton
              size="compact"
              tone="quiet"
              onClick={() => void settings.suggestUserPreferenceFromThread()}
              disabled={!canCreateThreadMemoryReviews}
            >
              User preference
            </ActionButton>
          </div>
        </SettingsRow>
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
                disabled={updateInstallQueued}
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
          description="Open the public GitHub Issues form to report a bug or track known fixes."
        >
          <ActionButton
            size="compact"
            tone="quiet"
            onClick={() => void window.vicode.app.openExternal(GITHUB_BUG_REPORT_URL)}
          >
            Open GitHub Issues
          </ActionButton>
        </SettingsRow>
      </SettingsPanel>
    </div>
  );
}
