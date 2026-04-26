import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { ActionButton, ConfirmDialog, IconButton, Menu, MenuContent, MenuItem, MenuItemLabel, MenuTrigger, PrimaryButton, SelectField, StatusPill, TextInput } from './ui';
import type {
  AppMeta,
  AppUpdateState,
  OllamaPullProgress,
  OllamaTransportMode,
  PersonalizationSettings,
  Preferences,
  Project,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy,
  ProviderDescriptor,
  ProviderId,
  SettingsSection,
  ThreadSummary
} from '../../shared/domain';
import type { OllamaRuntimeSnapshot, StorageDiagnostics, WorkspaceBootstrapStatus } from '../../shared/ipc';
import {
  deriveRuntimePolicy,
  PROJECT_RUNTIME_COMMAND_POLICY_OPTIONS,
  PROJECT_RUNTIME_NETWORK_POLICY_OPTIONS
} from '../../shared/runtime-policy';
import {
  createProviderRecord,
  providerDisplayName,
  providerModelRecommendationLabel,
  providerRecommendedRouteSummary,
  providerSettingsAuthDescription,
  providerSettingsAuthTitle,
  providerSettingsInstallLabel,
  providerSettingsPillLabel,
  providerSettingsStatusSummary,
  providerUsesHostedApi
} from '../../shared/providers';
import {
  AccountIcon,
  ArchiveIcon,
  ChevronRightIcon,
  ClipboardIcon,
  CloseIcon,
  CpuIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  LogoutIcon,
  MoreIcon,
  SettingsIcon
} from './icons';
import { normalizeHexColor } from '../lib/theme';
import { normalizeProviderApiKeyDraft, resolveProviderApiKeyFieldValue } from '../lib/provider-api-key';
import { GeneralSettingsSection } from './settings/GeneralSettingsSection';
import { ProviderAuthActions } from './settings/ProviderAuthActions';
import {
  AdvancedSettingsSection,
  ArchivedThreadsSection,
  PersonalizationSettingsSection
} from './settings/SecondarySettingsSections';
import { settingsSections } from './settings/support';

const OLLAMA_API_KEY_DOCS_URL = 'https://docs.ollama.com/api/authentication';
const OLLAMA_ACCOUNT_URL = 'https://ollama.com/';

function shortStatus(status: string) {
  return status.replaceAll('_', ' ');
}

function recommendationTone(recommendation: string | null) {
  if (recommendation === 'Default') {
    return 'connected' as const;
  }
  if (recommendation === 'Quick') {
    return 'checking' as const;
  }
  if (recommendation === 'Preview') {
    return 'detected' as const;
  }
  return 'detected' as const;
}

function isOllamaCloudProvider(provider: ProviderDescriptor) {
  return providerUsesHostedApi(provider);
}

function providerAuthTitle(provider: ProviderDescriptor) {
  return providerSettingsAuthTitle(provider);
}

function providerAuthDescription(provider: ProviderDescriptor) {
  return providerSettingsAuthDescription(provider);
}

function providerPillLabel(provider: ProviderDescriptor) {
  return providerSettingsPillLabel(provider);
}

function providerInstallLabel(provider: ProviderDescriptor, ollamaRuntimeStatus: OllamaRuntimeSnapshot | null) {
  return providerSettingsInstallLabel(provider, ollamaRuntimeStatus);
}

function providerStatusSummary(provider: ProviderDescriptor, ollamaRuntimeStatus: OllamaRuntimeSnapshot | null) {
  return providerSettingsStatusSummary(provider, ollamaRuntimeStatus);
}

function ollamaPullProgressTone(progress: OllamaPullProgress) {
  if (progress.state === 'failed') {
    return 'failed' as const;
  }
  if (progress.state === 'completed') {
    return 'connected' as const;
  }
  return 'checking' as const;
}

function formatOllamaPullPercent(progress: OllamaPullProgress) {
  if (progress.total === null || progress.completed === null || progress.total <= 0) {
    return null;
  }

  const percent = Math.max(0, Math.min(100, (progress.completed / progress.total) * 100));
  return `${Math.round(percent)}%`;
}

function ollamaRuntimeControlSummary(snapshot: OllamaRuntimeSnapshot | null) {
  if (!snapshot) {
    return 'Runtime control status unavailable.';
  }
  if (snapshot.managedByApp) {
    return snapshot.reachable ? 'Vicode-managed runtime' : 'Vicode-managed runtime starting';
  }
  if (snapshot.reachable) {
    return snapshot.canManageProcess ? 'External runtime currently active' : 'External runtime active, but Vicode cannot own the process on this machine';
  }
  if (snapshot.canManageProcess) {
    return 'Runtime installed and startable under Vicode control';
  }
  return 'Runtime not reachable yet';
}

function formatTime(value: string | null) {
  if (!value) {
    return 'Never';
  }
  return new Date(value).toLocaleString();
}

function formatQuotaPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return `${Math.max(0, Math.min(100, value * 100)).toFixed(value * 100 >= 10 ? 0 : 1)}%`;
}

function formatQuotaAmount(remaining: number | null, limit: number | null) {
  if (remaining === null && limit === null) {
    return null;
  }

  if (remaining !== null && limit !== null) {
    return `${remaining.toLocaleString()} / ${limit.toLocaleString()}`;
  }

  return remaining !== null ? remaining.toLocaleString() : limit?.toLocaleString() ?? null;
}

function quotaTone(value: number | null) {
  if (value === null) {
    return 'detected';
  }
  if (value <= 0.1) {
    return 'failed';
  }
  if (value <= 0.35) {
    return 'checking';
  }
  return 'connected';
}

const ollamaTransportModeOptions: Array<{ value: OllamaTransportMode; label: string; description: string }> = [
  {
    value: 'chat',
    label: '/api/chat',
    description: 'Stable default. Uses the native Ollama chat surface for plain replies and the existing Vicode-owned tool loop.'
  },
  {
    value: 'responses',
    label: '/v1/responses',
    description: 'Experimental OpenAI-compatible surface. Keeps Vicode in charge of the tool loop, but swaps the transport.'
  }
];

const settingsSectionIcons: Record<SettingsSection, ReactNode> = {
  general: <SettingsIcon />,
  providers: <CpuIcon />,
  personalization: <AccountIcon />,
  diagnostics: <ClipboardIcon />,
  storage: <FolderIcon />,
  archived_threads: <ArchiveIcon />
};


interface SettingsViewProps {
  section: SettingsSection;
  setSection: (section: SettingsSection) => void;
  onBack: () => void;
  providers: ProviderDescriptor[];
  preferences: Preferences | null;
  savePreferences: (input: Partial<Preferences>) => Promise<void>;
  personalization: PersonalizationSettings;
  savePersonalization: (input: Partial<PersonalizationSettings>) => Promise<void>;
  resetPersonalization: () => Promise<void>;
  apiKeys: Record<ProviderId, string>;
  setApiKeys: Dispatch<SetStateAction<Record<ProviderId, string>>>;
  connectProvider: (providerId: ProviderId, mode?: 'cli' | 'api_key') => Promise<void>;
  adoptProviderAuth: (providerId: ProviderId) => Promise<void>;
  beginProviderInstall: (providerId: ProviderId) => void;
  clearProviderAuth: (providerId: ProviderId) => Promise<void>;
  refreshProvider: (providerId: ProviderId) => Promise<void>;
  pullOllamaModel: (model: string) => Promise<void>;
  ollamaPullProgress: OllamaPullProgress | null;
  ollamaRuntimeStatus: OllamaRuntimeSnapshot | null;
  stopOllamaRuntime: () => Promise<void>;
  deleteOllamaModel: (model: string) => Promise<void>;
  saveProviderApiKey: (providerId: ProviderId) => Promise<void>;
  exportDiagnostics: () => Promise<void>;
  clearAllProviderAuth: () => Promise<void>;
  appMeta: AppMeta | null;
  appUpdateState: AppUpdateState | null;
  checkForAppUpdates: () => Promise<void>;
  restartToUpdate: () => Promise<void>;
  storageDiagnostics: StorageDiagnostics | null;
  refreshStorageDiagnostics: () => Promise<void>;
  compactRunEvents: () => Promise<void>;
  maintainStorage: (input?: { vacuum?: boolean }) => Promise<void>;
  selectedProject: Project | null;
  saveProjectRuntimeCommandPolicy: (
    projectId: string,
    runtimeCommandPolicy: ProjectRuntimeCommandPolicy
  ) => Promise<void>;
  saveProjectRuntimeNetworkPolicy: (
    projectId: string,
    runtimeNetworkPolicy: ProjectRuntimeNetworkPolicy
  ) => Promise<void>;
  workspaceBootstrapStatus: WorkspaceBootstrapStatus | null;
  openWorkspaceBootstrap: () => Promise<void>;
  activeThreadTitle: string | null;
  captureDailyNoteFromThread: () => Promise<void>;
  promoteThreadToMemory: () => Promise<void>;
  suggestUserPreferenceFromThread: () => Promise<void>;
  archivedThreads: ThreadSummary[];
  projects: Project[];
  restoreArchivedThread: (threadId: string) => Promise<void>;
  deleteArchivedThread: (threadId: string) => Promise<void>;
}

export function SettingsView(props: SettingsViewProps) {
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [deleteArchivedThreadId, setDeleteArchivedThreadId] = useState<string | null>(null);
  const [compactRunEventsDialogOpen, setCompactRunEventsDialogOpen] = useState(false);
  const [vacuumStorageDialogOpen, setVacuumStorageDialogOpen] = useState(false);
  const [personalizationDraft, setPersonalizationDraft] = useState(props.personalization);
  const [ollamaModelDraft, setOllamaModelDraft] = useState('');
  const [ollamaBusyAction, setOllamaBusyAction] = useState<'pull' | `delete:${string}` | null>(null);
  const [revealedApiKeys, setRevealedApiKeys] = useState<Record<ProviderId, boolean>>(() =>
    createProviderRecord(() => false)
  );
  const selectedProjectRuntimeCommandPolicy =
    props.selectedProject?.runtimeCommandPolicy ?? 'approval_required';
  const selectedProjectRuntimeNetworkPolicy =
    props.selectedProject?.runtimeNetworkPolicy ?? 'disabled';
  const ollamaDefaultPolicy = useMemo(
    () =>
      deriveRuntimePolicy(
        'default',
        selectedProjectRuntimeCommandPolicy,
        selectedProjectRuntimeNetworkPolicy
      ),
    [selectedProjectRuntimeCommandPolicy, selectedProjectRuntimeNetworkPolicy]
  );
  const ollamaFullAccessPolicy = useMemo(
    () =>
      deriveRuntimePolicy(
        'full_access',
        selectedProjectRuntimeCommandPolicy,
        selectedProjectRuntimeNetworkPolicy
      ),
    [selectedProjectRuntimeCommandPolicy, selectedProjectRuntimeNetworkPolicy]
  );

  useEffect(() => {
    setRevealedApiKeys((current) => {
      let changed = false;
      const next = { ...current };
      for (const provider of props.providers) {
        if (props.apiKeys[provider.id].length === 0 && next[provider.id]) {
          next[provider.id] = false;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [props.apiKeys, props.providers]);

  useEffect(() => {
    setRevealedApiKeys((current) => {
      let changed = false;
      const next = { ...current };
      for (const provider of props.providers) {
        if (props.apiKeys[provider.id].length === 0 && next[provider.id]) {
          next[provider.id] = false;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [props.apiKeys, props.providers]);

  useEffect(() => {
    setPersonalizationDraft(props.personalization);
  }, [props.personalization]);

  const setDraftField = (field: 'globalInstructions' | 'useWorkspaceInstructions', value: string | boolean) => {
    setPersonalizationDraft((current) => ({ ...current, [field]: value } as PersonalizationSettings));
  };

  const setDraftProviderField = (providerId: ProviderId, value: string) => {
    setPersonalizationDraft((current) => ({
      ...current,
      providerInstructions: {
        ...current.providerInstructions,
        [providerId]: value
      }
    }));
  };

  const settingsRootClass = 'settings-root settings-content settings-content-standalone ui-stable-scroll flex min-h-0 w-full flex-1 flex-col';
  const providersSectionClass = 'settings-section-stack settings-section-stack-compact flex flex-col gap-5';
  const settingsInlineActionsClass = 'settings-inline-actions flex flex-wrap items-center gap-3';
  const providerStackClass = 'settings-provider-stack flex flex-col gap-4';
  const providerCardClass = 'settings-provider-card flex flex-col gap-4 rounded-[24px] border border-transparent bg-transparent p-5';
  const providerTopClass = 'settings-provider-top flex items-start justify-between gap-4';
  const providerCopyClass = 'settings-provider-copy flex min-w-0 flex-1 flex-col gap-2';
  const providerSummaryClass = 'settings-provider-summary rounded-2xl border border-transparent bg-transparent p-4';
  const providerActionsClass = 'settings-provider-actions flex flex-wrap items-center justify-between gap-3';
  const providerActionGroupClass = 'settings-provider-action-group flex flex-wrap items-center gap-2';
  const detailBlockClass = 'settings-detail-block flex flex-col gap-4 rounded-[24px] border border-transparent bg-transparent p-5';
  const defaultAccentColor = getComputedStyle(document.documentElement).getPropertyValue('--ui-default-accent').trim();
  const currentAccentColor = normalizeHexColor(props.preferences?.accentColor) ?? defaultAccentColor;
  const activeSettingsSection = props.section === 'storage' ? 'diagnostics' : props.section;

  return (
    <section className={settingsRootClass}>
      <div className="settings-shell-layout">
        <aside className="settings-shell-rail">
          <div className="settings-shell-rail-sticky">
            <header className="settings-shell-rail-header">
              <div className="settings-shell-rail-copy">
                <span className="settings-shell-rail-eyebrow">Preferences</span>
                <strong>Settings</strong>
              </div>
              <IconButton className="settings-shell-close" label="Close settings" onClick={props.onBack}>
                <CloseIcon />
              </IconButton>
            </header>
            <nav className="settings-inline-shell-tabs settings-nav settings-shell-nav" data-active-section={activeSettingsSection}>
              {settingsSections.map((entry) => (
                <ActionButton
                  key={entry.value}
                  tone={activeSettingsSection === entry.value ? 'default' : 'quiet'}
                  size="compact"
                  className="settings-shell-tab settings-nav-item"
                  leadingIcon={settingsSectionIcons[entry.value]}
                  data-active={activeSettingsSection === entry.value ? 'true' : 'false'}
                  onClick={() => props.setSection(entry.value)}
                >
                  {entry.label}
                </ActionButton>
              ))}
            </nav>
          </div>
        </aside>
        <div className="settings-shell-main">
        {props.section === 'general' ? (
          <GeneralSettingsSection
            settings={props}
            defaultAccentColor={defaultAccentColor}
            currentAccentColor={currentAccentColor}
          />
        ) : null}

        {props.section === 'providers' ? (
          <div className={providersSectionClass}>
            <header className="settings-detail-header flex flex-col gap-2 pb-1">
              <h2 className="text-[28px] font-semibold tracking-[-0.04em] text-[color:var(--ui-text-title)]">
                Providers
              </h2>
              <p className="max-w-4xl text-[14px] leading-6 text-[color:var(--ui-text-muted)]">
                Connect the CLIs and keys Vicode can run. CLI sign-ins stay on this PC until
                you choose Connect. Ollama can use a cloud API key or a local runtime.
              </p>
            </header>
            <div className={providerStackClass}>
              {props.providers.map((provider) => (
                <article key={provider.id} className={providerCardClass}>
                  <div className={providerTopClass}>
                    <div className={providerCopyClass}>
                      <strong>{providerDisplayName(provider.id)}</strong>
                      <p>{providerAuthDescription(provider)}</p>
                    </div>
                    <StatusPill tone={provider.authState}>{providerPillLabel(provider)}</StatusPill>
                  </div>
                  <div className={providerSummaryClass}>
                    <strong>{providerAuthTitle(provider)}</strong>
                    <span>{providerStatusSummary(provider, props.ollamaRuntimeStatus)}</span>
                  </div>
                  <div className={providerSummaryClass}>
                    <strong>Default model</strong>
                    <span>{providerRecommendedRouteSummary(provider.id, { hosted: isOllamaCloudProvider(provider) })}</span>
                  </div>
                  {provider.id === 'ollama' ? (
                    <div className={providerSummaryClass}>
                      <strong>Ollama mode</strong>
                      <span>Use cloud models with an API key, or local models from this PC.</span>
                    </div>
                  ) : null}
                  <div className={providerActionsClass}>
                    <span className={`settings-provider-meta ${provider.installed ? '' : 'settings-provider-meta-warning'}`}>{providerInstallLabel(provider, props.ollamaRuntimeStatus)}</span>
                    <ProviderAuthActions
                      provider={provider}
                      canStopOllamaRuntime={Boolean(provider.id === 'ollama' && !isOllamaCloudProvider(provider) && props.ollamaRuntimeStatus?.canStop)}
                      beginProviderInstall={props.beginProviderInstall}
                      connectProvider={props.connectProvider}
                      adoptProviderAuth={props.adoptProviderAuth}
                      refreshProvider={props.refreshProvider}
                      clearProviderAuth={props.clearProviderAuth}
                      stopOllamaRuntime={props.stopOllamaRuntime}
                    />
                  </div>
                  {provider.id !== 'qwen' ? (
                  <details className="settings-provider-advanced">
                    <summary>
                      <span>{provider.id === 'ollama' ? 'Cloud API key' : 'Use an API key instead'}</span>
                      <ChevronRightIcon />
                    </summary>
                    <p>{provider.id === 'ollama' ? 'Save an Ollama API key to use cloud models.' : 'Save a key only if you do not want to use the CLI sign-in.'}</p>
                    <div className="settings-provider-key grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                      <div className="settings-provider-input-shell">
                        <TextInput
                          className="settings-provider-input"
                          type={revealedApiKeys[provider.id] && props.apiKeys[provider.id].length > 0 ? 'text' : 'password'}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={provider.id === 'gemini' ? 'Paste Gemini API key' : provider.id === 'ollama' ? 'Paste Ollama API key' : 'Paste OpenAI API key'}
                          value={resolveProviderApiKeyFieldValue(provider, props.apiKeys[provider.id])}
                          onChange={(event) =>
                            props.setApiKeys((current) => ({
                              ...current,
                              [provider.id]: normalizeProviderApiKeyDraft(
                                provider,
                                current[provider.id],
                                event.target.value
                              )
                            }))
                          }
                        />
                        {resolveProviderApiKeyFieldValue(provider, props.apiKeys[provider.id]).length > 0 ? (
                          <IconButton
                            className="settings-provider-visibility"
                            size="compact"
                            label={`${revealedApiKeys[provider.id] ? 'Hide' : 'Show'} ${providerDisplayName(provider.id)} API key`}
                            disabled={props.apiKeys[provider.id].length === 0}
                            onClick={() =>
                              setRevealedApiKeys((current) => ({
                                ...current,
                                [provider.id]: !current[provider.id]
                              }))
                            }
                          >
                            {revealedApiKeys[provider.id] ? <EyeOffIcon /> : <EyeIcon />}
                          </IconButton>
                        ) : null}
                      </div>
                      <div className="settings-provider-key-actions">
                        <PrimaryButton className="settings-provider-save" size="compact" onClick={() => void props.saveProviderApiKey(provider.id)}>
                          Save key
                        </PrimaryButton>
                        {provider.id === 'ollama' ? (
                          <Menu>
                            <MenuTrigger asChild>
                              <IconButton
                                className="settings-provider-menu-trigger"
                                size="compact"
                                label="Ollama cloud key actions"
                              >
                                <MoreIcon />
                              </IconButton>
                            </MenuTrigger>
                            <MenuContent className="settings-provider-menu" align="end" sideOffset={8}>
                              <MenuItem onSelect={() => void window.vicode.app.openExternal(OLLAMA_API_KEY_DOCS_URL)}>
                                <MenuItemLabel>Get API key</MenuItemLabel>
                              </MenuItem>
                              <MenuItem onSelect={() => void window.vicode.app.openExternal(OLLAMA_ACCOUNT_URL)}>
                                <MenuItemLabel>Open Ollama</MenuItemLabel>
                              </MenuItem>
                            </MenuContent>
                          </Menu>
                        ) : null}
                      </div>
                    </div>
                  </details>
                  ) : provider.id === 'qwen' ? (
                    <div className={providerSummaryClass}>
                      <strong>CLI sign-in only</strong>
                      <span>Qwen uses its normal sign-in flow in this build. API keys are not supported here yet.</span>
                    </div>
                  ) : (
                    <div className={providerSummaryClass}>
                      <strong>Cloud or local</strong>
                        <span>Use an API key for hosted Ollama, or install Ollama for local models.</span>
                    </div>
                  )}
                  {provider.id === 'ollama' ? (
                    <details className="settings-provider-advanced">
                      <summary>
                        <span>Local Ollama controls</span>
                        <ChevronRightIcon />
                      </summary>
                    <div className={detailBlockClass}>
                      <div className="settings-provider-copy">
                        <strong>Local Ollama</strong>
                        <p>These controls only affect Ollama models running on this PC.</p>
                        <p>Codex and Gemini keep their own CLI approval and sandbox behavior.</p>
                      </div>
                      {props.selectedProject ? (
                        <div className="settings-quota-row flex flex-col gap-3 rounded-2xl border border-transparent bg-transparent p-4">
                          <div className="settings-provider-copy">
                            <strong>Command access</strong>
                            <span>{props.selectedProject.name}</span>
                            <p>
                              Choose how local Ollama handles commands in this workspace.
                            </p>
                          </div>
                          <SelectField
                            menuClassName="settings-select-menu"
                            value={selectedProjectRuntimeCommandPolicy}
                            onChange={(event) =>
                              void props.saveProjectRuntimeCommandPolicy(
                                props.selectedProject!.id,
                                event.target.value as ProjectRuntimeCommandPolicy
                              )
                            }
                          >
                            {PROJECT_RUNTIME_COMMAND_POLICY_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </SelectField>
                          <div className="skill-meta">
                            {PROJECT_RUNTIME_COMMAND_POLICY_OPTIONS.map((option) =>
                              option.value === selectedProjectRuntimeCommandPolicy ? (
                                <span key={option.value}>{option.description}</span>
                              ) : null
                            )}
                          </div>
                          <div className="settings-provider-copy pt-2">
                            <strong>Internet access</strong>
                            <p>
                              Choose whether approved local commands can use the internet.
                            </p>
                          </div>
                          <SelectField
                            menuClassName="settings-select-menu"
                            value={selectedProjectRuntimeNetworkPolicy}
                            onChange={(event) =>
                              void props.saveProjectRuntimeNetworkPolicy(
                                props.selectedProject!.id,
                                event.target.value as ProjectRuntimeNetworkPolicy
                              )
                            }
                          >
                            {PROJECT_RUNTIME_NETWORK_POLICY_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </SelectField>
                          <div className="skill-meta">
                            {PROJECT_RUNTIME_NETWORK_POLICY_OPTIONS.map((option) =>
                              option.value === selectedProjectRuntimeNetworkPolicy ? (
                                <span key={option.value}>{option.description}</span>
                              ) : null
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className={providerSummaryClass}>
                          <strong>No active workspace</strong>
                          <span>Select a workspace to change local Ollama command access.</span>
                        </div>
                      )}
                      {isOllamaCloudProvider(provider) ? (
                        <div className="settings-quota-row flex flex-col gap-2 rounded-2xl border border-transparent bg-transparent p-4">
                          <div className="settings-provider-copy">
                            <strong>Cloud models</strong>
                            <span>Cloud models are active</span>
                            <p>Ignore local settings unless you also want models on this PC.</p>
                          </div>
                        </div>
                      ) : (
                        <div className="settings-quota-row flex flex-col gap-2 rounded-2xl border border-transparent bg-transparent p-4">
                          <div className="settings-provider-copy">
                            <strong>Local runtime</strong>
                            <span>{ollamaRuntimeControlSummary(props.ollamaRuntimeStatus)}</span>
                          </div>
                          {props.ollamaRuntimeStatus ? (
                            <div className="skill-meta">
                              <span>{props.ollamaRuntimeStatus.managedByApp ? 'Managed by Vicode' : 'Not managed by Vicode'}</span>
                              <span>{props.ollamaRuntimeStatus.canManageProcess ? 'Process control available' : 'Process control unavailable'}</span>
                            </div>
                          ) : null}
                        </div>
                      )}
                      <div className="settings-quota-list flex flex-col gap-3">
                        <div className="settings-quota-row flex flex-col gap-2 rounded-2xl border border-transparent bg-transparent p-4">
                          <div className="settings-provider-copy">
                            <strong>Transport</strong>
                            <span>{props.preferences?.ollamaTransportMode === 'responses' ? 'Experimental OpenAI-compatible responses transport' : 'Default Ollama chat transport'}</span>
                            <p>Choose which Ollama HTTP API Vicode should use.</p>
                          </div>
                          <SelectField
                            menuClassName="settings-select-menu"
                            value={props.preferences?.ollamaTransportMode ?? 'chat'}
                            onChange={(event) =>
                              void props.savePreferences({
                                ollamaTransportMode: event.target.value as OllamaTransportMode
                              })
                            }
                          >
                            {ollamaTransportModeOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </SelectField>
                          <div className="skill-meta">
                            {ollamaTransportModeOptions.map((option) =>
                              option.value === (props.preferences?.ollamaTransportMode ?? 'chat') ? (
                                <span key={option.value}>{option.description}</span>
                              ) : null
                            )}
                          </div>
                        </div>
                        <div className="settings-quota-row flex flex-col gap-2 rounded-2xl border border-transparent bg-transparent p-4">
                          <div className="settings-provider-copy">
                            <strong>Default permissions</strong>
                            <span>
                              {ollamaDefaultPolicy.defaultToolLabels.join(', ')}
                              {selectedProjectRuntimeNetworkPolicy === 'enabled' ? ', native web research' : ''}
                            </span>
                            <p>
                              {selectedProjectRuntimeNetworkPolicy === 'enabled'
                                ? 'Workspace file tools stay available. Native web research can reach the public web. Commands stay off.'
                                : 'Workspace files only. Commands stay off.'}
                            </p>
                          </div>
                        </div>
                        <div className="settings-quota-row flex flex-col gap-2 rounded-2xl border border-transparent bg-transparent p-4">
                          <div className="settings-provider-copy">
                            <strong>Full access adds</strong>
                            <span>{ollamaFullAccessPolicy.elevatedToolLabels.join(', ') || 'No additional tools'}</span>
                            <p>
                              {selectedProjectRuntimeCommandPolicy === 'disabled'
                                ? 'This workspace keeps commands off, even with Full access.'
                                : 'Commands need approval before they run.'}
                            </p>
                            <p>
                              {selectedProjectRuntimeNetworkPolicy === 'enabled'
                                ? 'Approved commands can use internet access.'
                                : 'Internet access stays blocked unless you allow it.'}
                            </p>
                          </div>
                        </div>
                      </div>
                      {isOllamaCloudProvider(provider) ? (
                        <>
                          <div className="settings-provider-copy">
                            <strong>Cloud models</strong>
                            <p>Cloud models come from your Ollama account. Refresh to reload the list.</p>
                            <p>{providerRecommendedRouteSummary(provider.id, { hosted: true })}</p>
                          </div>
                          {provider.models.length > 0 ? (
                            <div className="settings-quota-list flex flex-col gap-3">
                              {provider.models.map((model) => {
                                const recommendationLabel = providerModelRecommendationLabel(model.recommendation);
                                return (
                                <div key={model.id} className="settings-quota-row flex items-center justify-between gap-3 rounded-2xl border border-transparent bg-transparent p-4">
                                  <div className="settings-provider-copy">
                                    <strong>{model.label}</strong>
                                    <span>{model.id}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {recommendationLabel ? (
                                      <StatusPill tone={recommendationTone(recommendationLabel)}>{recommendationLabel}</StatusPill>
                                    ) : null}
                                    <StatusPill tone="connected">Cloud</StatusPill>
                                  </div>
                                </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className={providerSummaryClass}>
                              <strong>No cloud models</strong>
                              <span>Save your API key, then refresh Ollama.</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="settings-provider-copy">
                            <strong>Local models</strong>
                            <p>Pull or remove local models. Vicode refreshes the composer model list after changes.</p>
                            <p>{providerRecommendedRouteSummary(provider.id, { hosted: false })}</p>
                          </div>
                          <div className="settings-provider-key grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                            <TextInput
                              className="settings-provider-input"
                              placeholder="qwen3-coder:30b"
                              value={ollamaModelDraft}
                              onChange={(event) => setOllamaModelDraft(event.target.value)}
                            />
                            <PrimaryButton
                              className="settings-provider-save"
                              size="compact"
                              disabled={!provider.installed || provider.authState === 'checking' || ollamaBusyAction !== null}
                              onClick={async () => {
                                setOllamaBusyAction('pull');
                                try {
                                  await props.pullOllamaModel(ollamaModelDraft);
                                  setOllamaModelDraft('');
                                } finally {
                                  setOllamaBusyAction(null);
                                }
                              }}
                            >
                              {ollamaBusyAction === 'pull' ? 'Pulling...' : 'Pull model'}
                            </PrimaryButton>
                          </div>
                          {props.ollamaPullProgress ? (
                            <div className="settings-quota-row flex flex-col gap-3 rounded-2xl border border-transparent bg-transparent p-4">
                              <div className="settings-provider-top flex items-start justify-between gap-4">
                                <div className="settings-provider-copy">
                                  <strong>Pulling {props.ollamaPullProgress.model}</strong>
                                  <span>{props.ollamaPullProgress.status}</span>
                                </div>
                                <StatusPill tone={ollamaPullProgressTone(props.ollamaPullProgress)}>
                                  {formatOllamaPullPercent(props.ollamaPullProgress) ?? shortStatus(props.ollamaPullProgress.state)}
                                </StatusPill>
                              </div>
                              <div className="settings-quota-bar">
                                <div
                                  className={`settings-quota-bar-fill is-${ollamaPullProgressTone(props.ollamaPullProgress)}`}
                                  style={{
                                    width: formatOllamaPullPercent(props.ollamaPullProgress)
                                      ? `${Math.max(
                                          4,
                                          Math.min(
                                            100,
                                            ((props.ollamaPullProgress.completed ?? 0) / Math.max(props.ollamaPullProgress.total ?? 1, 1)) * 100
                                          )
                                        )}%`
                                      : '4%'
                                  }}
                                />
                              </div>
                              <div className="skill-meta">
                                <span>
                                  {props.ollamaPullProgress.completed !== null && props.ollamaPullProgress.total !== null
                                    ? `${props.ollamaPullProgress.completed.toLocaleString()} / ${props.ollamaPullProgress.total.toLocaleString()} bytes`
                                    : 'Preparing pull progress...'}
                                </span>
                                {props.ollamaPullProgress.digest ? <span>{props.ollamaPullProgress.digest}</span> : null}
                              </div>
                            </div>
                          ) : null}
                          {provider.models.length > 0 ? (
                            <div className="settings-quota-list flex flex-col gap-3">
                              {provider.models.map((model) => {
                                const deleteAction = `delete:${model.id}` as const;
                                const recommendationLabel = providerModelRecommendationLabel(model.recommendation);
                                return (
                                  <div key={model.id} className="settings-quota-row flex items-center justify-between gap-3 rounded-2xl border border-transparent bg-transparent p-4">
                                    <div className="settings-provider-copy">
                                      <strong>{model.label}</strong>
                                      <span>{model.id}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {recommendationLabel ? (
                                        <StatusPill tone={recommendationTone(recommendationLabel)}>{recommendationLabel}</StatusPill>
                                      ) : null}
                                      <ActionButton
                                        size="compact"
                                        tone="quiet"
                                        disabled={!provider.installed || provider.authState === 'checking' || ollamaBusyAction !== null}
                                        onClick={async () => {
                                          setOllamaBusyAction(deleteAction);
                                          try {
                                            await props.deleteOllamaModel(model.id);
                                          } finally {
                                            setOllamaBusyAction(null);
                                          }
                                        }}
                                      >
                                        {ollamaBusyAction === deleteAction ? 'Deleting...' : 'Delete'}
                                      </ActionButton>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className={providerSummaryClass}>
                              <strong>No local models</strong>
                              <span>Pull a model here, or run `ollama pull qwen3-coder` outside Vicode and refresh.</span>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    </details>
                  ) : null}
                  {provider.id === 'qwen' ? (
                    <div className={providerActionsClass}>
                      <span className="settings-provider-meta">Default CLI thinking</span>
                      <div className={providerActionGroupClass}>
                        <ActionButton
                          size="compact"
                          tone={
                            props.preferences?.defaultThinkingByProvider.qwen ?? true
                              ? 'default'
                              : 'quiet'
                          }
                          onClick={() =>
                            void props.savePreferences({
                              defaultThinkingByProvider: {
                                openai: props.preferences?.defaultThinkingByProvider.openai ?? false,
                                gemini: props.preferences?.defaultThinkingByProvider.gemini ?? false,
                                qwen: true,
                                ollama: props.preferences?.defaultThinkingByProvider.ollama ?? false,
                                kimi: props.preferences?.defaultThinkingByProvider.kimi ?? false
                              }
                            })
                          }
                        >
                          Thinking on
                        </ActionButton>
                        <ActionButton
                          size="compact"
                          tone={
                            !(props.preferences?.defaultThinkingByProvider.qwen ?? true)
                              ? 'default'
                              : 'quiet'
                          }
                          onClick={() =>
                            void props.savePreferences({
                              defaultThinkingByProvider: {
                                openai: props.preferences?.defaultThinkingByProvider.openai ?? false,
                                gemini: props.preferences?.defaultThinkingByProvider.gemini ?? false,
                                qwen: false,
                                ollama: props.preferences?.defaultThinkingByProvider.ollama ?? false,
                                kimi: props.preferences?.defaultThinkingByProvider.kimi ?? false
                              }
                            })
                          }
                        >
                          Thinking off
                        </ActionButton>
                      </div>
                    </div>
                  ) : null}
                  {provider.id === 'gemini' ? (
                    <div className="settings-detail-block settings-quota-block flex flex-col gap-4 rounded-2xl border border-transparent bg-transparent p-4">
                        <div className="settings-quota-header flex items-start justify-between gap-4">
                          <div>
                          <strong>Rate limits</strong>
                          <span>{provider.quota?.tierName ?? 'Quota details unavailable'}</span>
                          </div>
                          {provider.quota?.note ? <p>{provider.quota.note}</p> : null}
                        </div>
                      <div className="settings-quota-summary-grid grid grid-cols-1 gap-3 md:grid-cols-3">
                        <div className="settings-quota-stat">
                          <span>Pooled</span>
                          <strong>{formatQuotaAmount(provider.quota?.pooledRemaining ?? null, provider.quota?.pooledLimit ?? null) ?? 'Unavailable'}</strong>
                        </div>
                        <div className="settings-quota-stat">
                          <span>Resets</span>
                          <strong>{formatTime(provider.quota?.pooledResetAt ?? null)}</strong>
                        </div>
                        <div className="settings-quota-stat">
                          <span>Refreshed</span>
                          <strong>{formatTime(provider.quota?.fetchedAt ?? null)}</strong>
                        </div>
                      </div>
                      {provider.quota?.buckets.length ? (
                        <div className="settings-quota-list flex flex-col gap-3">
                          {provider.quota.buckets.map((bucket) => (
                            <div key={`${bucket.modelId}-${bucket.tokenType ?? 'quota'}`} className="settings-quota-row flex flex-col gap-3 rounded-2xl border border-transparent bg-transparent p-4">
                              <div className="settings-quota-row-top flex items-start justify-between gap-4">
                                <div>
                                  <strong>{bucket.modelId}</strong>
                                  <div className="skill-meta">
                                    <span>{bucket.tokenType ?? 'Usage limit'}</span>
                                    <span>{formatQuotaAmount(bucket.remainingAmount, bucket.limit) ?? 'Remaining count unavailable'}</span>
                                    <span>{formatTime(bucket.resetAt)}</span>
                                  </div>
                                </div>
                                <StatusPill tone={quotaTone(bucket.remainingFraction)}>
                                  {formatQuotaPercent(bucket.remainingFraction) ?? 'Unknown'}
                                </StatusPill>
                              </div>
                              <div className="settings-quota-bar">
                                <div
                                  className={`settings-quota-bar-fill is-${quotaTone(bucket.remainingFraction)}`}
                                  style={{ width: formatQuotaPercent(bucket.remainingFraction) ? `${Math.max(4, Math.min(100, (bucket.remainingFraction ?? 0) * 100))}%` : '4%' }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={`${providerSummaryClass} settings-quota-empty`}>
                          <strong>Quota details unavailable</strong>
                          <span>Gemini is ready. Refresh to check quota details again.</span>
                        </div>
                      )}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
            <div className={settingsInlineActionsClass}>
              <ActionButton className="settings-disconnect-all" tone="danger" onClick={() => setLogoutDialogOpen(true)} leadingIcon={<LogoutIcon />}>
                Disconnect all
              </ActionButton>
            </div>
          </div>
        ) : null}

        {props.section === 'personalization' ? (
          <PersonalizationSettingsSection
            settings={props}
            personalizationDraft={personalizationDraft}
            setDraftField={setDraftField}
            setDraftProviderField={setDraftProviderField}
            onReset={() => {
              setPersonalizationDraft(props.personalization);
              void props.resetPersonalization();
            }}
          />
        ) : null}

        {props.section === 'diagnostics' || props.section === 'storage' ? (
          <AdvancedSettingsSection
            settings={props}
            onOpenCompactRunEvents={() => setCompactRunEventsDialogOpen(true)}
            onOpenVacuumStorage={() => setVacuumStorageDialogOpen(true)}
          />
        ) : null}

        {props.section === 'archived_threads' ? (
          <ArchivedThreadsSection
            settings={props}
            onRequestDeleteArchivedThread={setDeleteArchivedThreadId}
          />
        ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={compactRunEventsDialogOpen}
        onOpenChange={setCompactRunEventsDialogOpen}
        title="Compact old run events?"
        description={`This only removes delta events from archived terminal runs older than ${props.storageDiagnostics?.compactionCutoffDays ?? 30} days when planner state is idle and no review items are pending. Turns, final outcomes, and archived threads stay intact. Event counts drop immediately, but file size can lag while SQLite checkpoints its WAL.`}
        confirmLabel="Compact + checkpoint"
        onConfirm={() => {
          setCompactRunEventsDialogOpen(false);
          void props.compactRunEvents();
        }}
      />
      <ConfirmDialog
        open={vacuumStorageDialogOpen}
        onOpenChange={setVacuumStorageDialogOpen}
        title="Run deep SQLite cleanup?"
        description="This runs the normal archived-run compaction, checkpoints the WAL, and then VACUUMs the local SQLite store to reclaim free pages. It can take longer than normal compaction, but it does not delete canonical threads, turns, jobs, or reviews."
        confirmLabel="Run deep cleanup"
        onConfirm={() => {
          setVacuumStorageDialogOpen(false);
          void props.maintainStorage({ vacuum: true });
        }}
      />
      <ConfirmDialog
        open={logoutDialogOpen}
        onOpenChange={setLogoutDialogOpen}
        title="Disconnect providers?"
        description="This only disconnects providers inside Vicode. It does not log you out of Codex CLI, Gemini CLI, Qwen CLI, or any other app on this machine."
        confirmLabel="Disconnect"
        tone="danger"
        onConfirm={() => void props.clearAllProviderAuth()}
      />
      <ConfirmDialog
        open={Boolean(deleteArchivedThreadId)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteArchivedThreadId(null);
          }
        }}
        title="Delete archived thread permanently?"
        description="Archive keeps history and hides it from active lists. Delete permanently removes this archived thread from Vicode's local app store and cannot be undone."
        confirmLabel="Delete permanently"
        tone="danger"
        onConfirm={() => {
          if (!deleteArchivedThreadId) {
            return;
          }
          void props.deleteArchivedThread(deleteArchivedThreadId);
          setDeleteArchivedThreadId(null);
        }}
      />
    </section>
  );
}
