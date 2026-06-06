import type { Dispatch, SetStateAction } from 'react';
import type {
  CustomProviderSettings,
  CustomProviderSettingsSaveInput,
  ProviderId
} from '../../../shared/domain';
import { ActionButton, SelectField, StatusPill } from '../ui';
import { LogoutIcon } from '../icons';
import { ProviderAuthActions } from './ProviderAuthActions';
import { CustomProviderSettingsSection } from './CustomProviderSettingsSection';
import {
  OllamaRuntimeSettingsSection,
  type OllamaBusyAction
} from './OllamaRuntimeSettingsSection';
import { SETTINGS_COMPACT_SECTION_CLASS, SETTINGS_INLINE_ACTIONS_CLASS, SettingsSectionHeader } from './shared';
import type { SettingsViewProps } from './types';
import {
  providerAuthDescription,
  providerAuthTitle,
  providerDisplayName,
  providerInstallLabel,
  providerPillLabel,
  providerRecommendedRouteSummary,
  providerStatusSummary
} from './support';

const providerStackClass = 'settings-provider-stack flex flex-col gap-4';
const providerCardClass = 'settings-provider-card flex flex-col gap-4 rounded-[24px] border border-transparent bg-transparent p-5';
const providerTopClass = 'settings-provider-top flex items-start justify-between gap-4';
const providerCopyClass = 'settings-provider-copy flex min-w-0 flex-1 flex-col gap-2';
const providerSummaryClass = 'settings-provider-summary rounded-2xl border border-transparent bg-transparent p-4';
const providerActionsClass = 'settings-provider-actions flex flex-wrap items-center justify-between gap-3';

export function ProviderSettingsSection({
  settings,
  defaultModelByProvider,
  revealedApiKeys,
  setRevealedApiKeys,
  customProviderDraft,
  setCustomProviderDraft,
  customProviderBusyId,
  editCustomProvider,
  removeCustomProvider,
  resetCustomProviderDraft,
  saveCustomProviderDraft,
  ollamaModelDraft,
  setOllamaModelDraft,
  ollamaBusyAction,
  setOllamaBusyAction,
  saveDefaultModel,
  onRequestDisconnectAll
}: {
  settings: SettingsViewProps;
  defaultModelByProvider: Record<ProviderId, string>;
  revealedApiKeys: Record<ProviderId, boolean>;
  setRevealedApiKeys: Dispatch<SetStateAction<Record<ProviderId, boolean>>>;
  customProviderDraft: CustomProviderSettingsSaveInput;
  setCustomProviderDraft: Dispatch<SetStateAction<CustomProviderSettingsSaveInput>>;
  customProviderBusyId: string | null;
  editCustomProvider: (provider: CustomProviderSettings) => void;
  removeCustomProvider: (providerId: string) => Promise<void>;
  resetCustomProviderDraft: () => void;
  saveCustomProviderDraft: () => Promise<void>;
  ollamaModelDraft: string;
  setOllamaModelDraft: Dispatch<SetStateAction<string>>;
  ollamaBusyAction: OllamaBusyAction;
  setOllamaBusyAction: Dispatch<SetStateAction<OllamaBusyAction>>;
  saveDefaultModel: (providerId: ProviderId, modelId: string) => Promise<void>;
  onRequestDisconnectAll: () => void;
}) {
  return (
    <div className={SETTINGS_COMPACT_SECTION_CLASS}>
      <SettingsSectionHeader
        title="Providers"
        description="Connect the local Ollama runtime and OpenAI-compatible Custom API keys Vicode can run."
      />
      <div className={providerStackClass}>
        <CustomProviderSettingsSection
          customProviders={settings.customProviders}
          customProviderDraft={customProviderDraft}
          customProviderBusyId={customProviderBusyId}
          setCustomProviderDraft={setCustomProviderDraft}
          editCustomProvider={editCustomProvider}
          removeCustomProvider={removeCustomProvider}
          resetCustomProviderDraft={resetCustomProviderDraft}
          saveCustomProviderDraft={saveCustomProviderDraft}
        />
        {settings.providers.map((provider) => (
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
              <span>{providerStatusSummary(provider, settings.ollamaRuntimeStatus)}</span>
            </div>
            <div className={`${providerSummaryClass} settings-provider-default-row`}>
              <div className="settings-provider-copy">
                <strong>Default model</strong>
                <span>{provider.models.length > 0 ? 'Used for new threads unless you choose another model in the composer.' : providerRecommendedRouteSummary(provider.id)}</span>
              </div>
              {provider.models.length > 0 ? (
                <SelectField
                  className="settings-provider-default-select settings-select-field"
                  menuClassName="settings-select-menu"
                  aria-label={`${providerDisplayName(provider.id)} default model`}
                  value={defaultModelByProvider[provider.id]}
                  onChange={(event) => void saveDefaultModel(provider.id, event.currentTarget.value)}
                >
                  {provider.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </SelectField>
              ) : null}
            </div>
            {provider.id === 'ollama' ? (
              <div className={providerSummaryClass}>
                <strong>Ollama mode</strong>
                <span>Use local models from this PC through the local Ollama API.</span>
              </div>
            ) : null}
            <div className={providerActionsClass}>
              <span className={`settings-provider-meta ${provider.installed ? '' : 'settings-provider-meta-warning'}`}>{providerInstallLabel(provider, settings.ollamaRuntimeStatus)}</span>
              <ProviderAuthActions
                provider={provider}
                canStopOllamaRuntime={Boolean(provider.id === 'ollama' && settings.ollamaRuntimeStatus?.canStop)}
                beginProviderInstall={settings.beginProviderInstall}
                connectProvider={settings.connectProvider}
                adoptProviderAuth={settings.adoptProviderAuth}
                refreshProvider={settings.refreshProvider}
                clearProviderAuth={settings.clearProviderAuth}
                stopOllamaRuntime={settings.stopOllamaRuntime}
              />
            </div>
            {provider.id === 'ollama' ? (
              <OllamaRuntimeSettingsSection
                provider={provider}
                selectedProject={settings.selectedProject}
                defaultModelByProvider={defaultModelByProvider}
                ollamaModelDraft={ollamaModelDraft}
                setOllamaModelDraft={setOllamaModelDraft}
                ollamaBusyAction={ollamaBusyAction}
                setOllamaBusyAction={setOllamaBusyAction}
                ollamaPullProgress={settings.ollamaPullProgress}
                ollamaRuntimeStatus={settings.ollamaRuntimeStatus}
                pullOllamaModel={settings.pullOllamaModel}
                deleteOllamaModel={settings.deleteOllamaModel}
                saveProjectRuntimeCommandPolicy={settings.saveProjectRuntimeCommandPolicy}
                saveProjectRuntimeNetworkPolicy={settings.saveProjectRuntimeNetworkPolicy}
              />
            ) : null}
          </article>
        ))}
      </div>
      <div className={SETTINGS_INLINE_ACTIONS_CLASS}>
        <ActionButton className="settings-disconnect-all" tone="danger" onClick={onRequestDisconnectAll} leadingIcon={<LogoutIcon />}>
          Disconnect all
        </ActionButton>
      </div>
    </div>
  );
}
