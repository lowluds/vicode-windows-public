import { useMemo } from 'react';
import { ActionButton, PrimaryButton, SurfaceCard, TextArea } from '../ui';
import { ArchiveIcon, RefreshIcon, SaveIcon } from '../icons';
import { StatusPill } from '../ui';
import type { PersonalizationSettings } from '../../../shared/domain';
import type { SettingsViewProps } from './types';
import { providerDisplayName, formatTime } from './support';
import {
  SETTINGS_INLINE_ACTIONS_CLASS,
  SETTINGS_SECTION_CLASS,
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
        title="Personalization"
        description="Layer global and provider-specific instructions on top of the built-in app rules for new runs."
      />
      <div className="settings-detail-block settings-personalization-block flex flex-col gap-4 rounded-[24px] border border-transparent bg-transparent p-5">
        <label className="settings-field flex flex-col gap-2">
          <span>Global instructions</span>
          <TextArea
            className="settings-personalization-area"
            value={personalizationDraft.globalInstructions}
            onChange={(event) => setDraftField('globalInstructions', event.target.value)}
            placeholder="Instructions applied to both providers before project instructions and skills."
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
              placeholder={`Additional instructions for ${providerDisplayName(provider.id)} runs.`}
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
            Use trusted workspace instruction files when present (`AGENTS.md`, `codex.md`,
            `gemini.md`, `ollama.md`, `qwen.md`, `kimi.md`).
          </span>
        </label>
        <div className={SETTINGS_INLINE_ACTIONS_CLASS}>
          <PrimaryButton
            onClick={() => void settings.savePersonalization(personalizationDraft)}
            leadingIcon={<SaveIcon />}
          >
            Save personalization
          </PrimaryButton>
          <ActionButton onClick={onReset} leadingIcon={<RefreshIcon />}>
            Reset to saved
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

export function DiagnosticsSettingsSection({ settings }: { settings: SettingsViewProps }) {
  return (
    <div className={SETTINGS_SECTION_CLASS}>
      <SettingsSectionHeader
        title="Diagnostics"
        description="Export local app state and logs when a provider or startup flow needs inspection."
      />
      <div className="settings-card-grid grid grid-cols-1 gap-4">
        <SurfaceCard>
          <h3>Diagnostics export</h3>
          <p>Create a redacted local export of threads, providers, and app state.</p>
          <PrimaryButton onClick={() => void settings.exportDiagnostics()}>Export diagnostics</PrimaryButton>
        </SurfaceCard>
        <SurfaceCard>
          <h3>State path</h3>
          <p>{settings.appMeta?.statePath ?? 'Unavailable'}</p>
        </SurfaceCard>
      </div>
    </div>
  );
}

export function StorageSettingsSection({ settings }: { settings: SettingsViewProps }) {
  return (
    <div className={SETTINGS_SECTION_CLASS}>
      <SettingsSectionHeader
        title="Local storage"
        description="Threads, remembered selections, and diagnostics remain on this machine unless you export them."
      />
      <div className="settings-card-grid grid grid-cols-1 gap-4">
        <SurfaceCard>
          <h3>App data path</h3>
          <p>{settings.appMeta?.userDataPath ?? 'Unavailable'}</p>
        </SurfaceCard>
        <SurfaceCard>
          <h3>Exports path</h3>
          <p>{settings.appMeta?.exportsPath ?? 'Unavailable'}</p>
        </SurfaceCard>
        <SurfaceCard>
          <h3>Active project</h3>
          <p>{settings.selectedProject?.folderPath ?? 'No folder attached yet'}</p>
        </SurfaceCard>
      </div>
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
        description="Archive hides threads from active lists but keeps their local history. Restore them here when you want them back in the working set."
      />
      <div className="settings-archived-list flex flex-1 flex-col gap-4 min-h-0">
        {settings.archivedThreads.length === 0 ? (
          <SurfaceCard>
            <h3>No archived threads</h3>
            <p>
              Archived threads will appear here when you archive them from the main thread surface
              instead of deleting them permanently.
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
