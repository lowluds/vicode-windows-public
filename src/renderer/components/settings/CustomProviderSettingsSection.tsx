import type { Dispatch, SetStateAction } from 'react';
import type {
  CustomProviderSettings,
  CustomProviderSettingsSaveInput
} from '../../../shared/domain';
import { ActionButton, PrimaryButton, StatusPill, TextInput } from '../ui';

const providerCardClass = 'settings-provider-card flex flex-col gap-4 rounded-[24px] border border-transparent bg-transparent p-5';
const providerTopClass = 'settings-provider-top flex items-start justify-between gap-4';
const providerCopyClass = 'settings-provider-copy flex min-w-0 flex-1 flex-col gap-2';
const providerSummaryClass = 'settings-provider-summary rounded-2xl border border-transparent bg-transparent p-4';
const providerActionGroupClass = 'settings-provider-action-group flex flex-wrap items-center gap-2';
const detailBlockClass = 'settings-detail-block flex flex-col gap-4 rounded-[24px] border border-transparent bg-transparent p-5';

export function CustomProviderSettingsSection({
  customProviders,
  customProviderDraft,
  customProviderBusyId,
  setCustomProviderDraft,
  editCustomProvider,
  removeCustomProvider,
  resetCustomProviderDraft,
  saveCustomProviderDraft
}: {
  customProviders: CustomProviderSettings[];
  customProviderDraft: CustomProviderSettingsSaveInput;
  customProviderBusyId: string | null;
  setCustomProviderDraft: Dispatch<SetStateAction<CustomProviderSettingsSaveInput>>;
  editCustomProvider: (provider: CustomProviderSettings) => void;
  removeCustomProvider: (providerId: string) => Promise<void>;
  resetCustomProviderDraft: () => void;
  saveCustomProviderDraft: () => Promise<void>;
}) {
  const hasEnabledProvider = customProviders.some(
    (provider) => provider.enabled && provider.hasApiKey && provider.baseUrl && provider.defaultModelId
  );

  return (
    <article className={providerCardClass} data-testid="custom-provider-settings-panel">
      <div className={providerTopClass}>
        <div className={providerCopyClass}>
          <strong>Custom API</strong>
          <p>Experimental beta lane for OpenAI-compatible endpoints that run through Vicode's app-owned tool loop.</p>
        </div>
        <StatusPill tone={hasEnabledProvider ? 'connected' : 'detected'}>
          {customProviders.length > 0 ? `${customProviders.length} saved` : 'None saved'}
        </StatusPill>
      </div>
      <div className="settings-provider-detail-list flex flex-col gap-3">
        {customProviders.length === 0 ? (
          <div className={providerSummaryClass}>
            <strong>No custom providers</strong>
            <span>Add a base URL, API key, and default model to surface the experimental Custom API lane in the picker.</span>
          </div>
        ) : (
          customProviders.map((provider) => (
            <div
              key={provider.id}
              className="settings-provider-detail-row flex items-center justify-between gap-3 rounded-2xl border border-transparent bg-transparent p-4"
              data-testid={`custom-provider-row-${provider.id}`}
            >
              <div className="settings-provider-copy">
                <strong>{provider.name}</strong>
                <span>{provider.defaultModelId}</span>
                <p>{provider.baseUrl}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill tone={provider.enabled && provider.hasApiKey ? 'connected' : 'detected'}>
                  {provider.enabled ? 'Enabled' : 'Disabled'}
                </StatusPill>
                <ActionButton size="compact" tone="quiet" onClick={() => editCustomProvider(provider)}>
                  Edit
                </ActionButton>
                <ActionButton
                  size="compact"
                  tone="danger"
                  disabled={customProviderBusyId === provider.id}
                  onClick={() => void removeCustomProvider(provider.id)}
                >
                  {customProviderBusyId === provider.id ? 'Removing...' : 'Remove'}
                </ActionButton>
              </div>
            </div>
          ))
        )}
      </div>
      <div className={detailBlockClass}>
        <div className="settings-provider-copy">
          <strong>{customProviderDraft.id ? 'Edit custom provider' : 'Add custom provider'}</strong>
          <p>Use a tested OpenAI-compatible /v1 base URL. API keys stay on this device after you save.</p>
        </div>
        <div className="settings-provider-key grid grid-cols-2 gap-3">
          <TextInput
            data-testid="custom-provider-name-input"
            className="settings-provider-input"
            placeholder="Provider name"
            value={customProviderDraft.name}
            onChange={(event) => setCustomProviderDraft((current) => ({ ...current, name: event.target.value }))}
          />
          <TextInput
            data-testid="custom-provider-model-input"
            className="settings-provider-input"
            placeholder="Default model"
            value={customProviderDraft.defaultModelId}
            onChange={(event) => setCustomProviderDraft((current) => ({ ...current, defaultModelId: event.target.value }))}
          />
          <TextInput
            data-testid="custom-provider-base-url-input"
            className="settings-provider-input"
            placeholder="https://api.example.com/v1"
            value={customProviderDraft.baseUrl}
            onChange={(event) => setCustomProviderDraft((current) => ({ ...current, baseUrl: event.target.value }))}
          />
          <TextInput
            data-testid="custom-provider-api-key-input"
            className="settings-provider-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={customProviderDraft.id ? 'Paste key again to update' : 'API key'}
            value={customProviderDraft.apiKey}
            onChange={(event) => setCustomProviderDraft((current) => ({ ...current, apiKey: event.target.value }))}
          />
        </div>
        <label className="settings-inline-note flex items-center gap-2">
          <input
            data-testid="custom-provider-enabled-input"
            type="checkbox"
            checked={customProviderDraft.enabled}
            onChange={(event) => setCustomProviderDraft((current) => ({ ...current, enabled: event.target.checked }))}
          />
          Enabled providers appear in the model picker.
        </label>
        <div className={providerActionGroupClass}>
          <PrimaryButton
            data-testid="custom-provider-save-button"
            size="compact"
            disabled={customProviderBusyId !== null}
            onClick={() => void saveCustomProviderDraft()}
          >
            {customProviderBusyId ? 'Saving...' : customProviderDraft.id ? 'Update custom provider' : 'Add custom provider'}
          </PrimaryButton>
          {customProviderDraft.id ? (
            <ActionButton size="compact" tone="quiet" onClick={resetCustomProviderDraft}>
              Cancel edit
            </ActionButton>
          ) : null}
        </div>
      </div>
    </article>
  );
}
