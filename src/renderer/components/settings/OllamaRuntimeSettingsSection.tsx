import type { Dispatch, SetStateAction } from 'react';
import type {
  OllamaPullProgress,
  Project,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy,
  ProviderDescriptor,
  ProviderId
} from '../../../shared/domain';
import type { OllamaRuntimeSnapshot } from '../../../shared/ipc';
import {
  OLLAMA_DEFAULT_LOCAL_MODEL_ID,
  providerModelRecommendationLabel,
  providerRecommendedRouteSummary
} from '../../../shared/providers';
import {
  deriveRuntimePolicy,
  PROJECT_RUNTIME_COMMAND_POLICY_OPTIONS,
  PROJECT_RUNTIME_NETWORK_POLICY_OPTIONS
} from '../../../shared/runtime-policy';
import { ActionButton, PrimaryButton, SelectField, StatusPill, TextInput } from '../ui';
import { ChevronRightIcon } from '../icons';
import {
  formatOllamaPullPercent,
  ollamaPullProgressTone,
  ollamaRuntimeControlSummary,
  recommendationTone,
  shortStatus
} from './support';

export type OllamaBusyAction = 'pull' | `delete:${string}` | null;

const providerSummaryClass = 'settings-provider-summary rounded-2xl border border-transparent bg-transparent p-4';
const detailBlockClass = 'settings-detail-block flex flex-col gap-4 rounded-[24px] border border-transparent bg-transparent p-5';

function visibleModelRecommendationLabel(recommendation: string | null) {
  return recommendation === 'Preview' ? recommendation : null;
}

export function OllamaRuntimeSettingsSection({
  provider,
  selectedProject,
  defaultModelByProvider,
  ollamaModelDraft,
  setOllamaModelDraft,
  ollamaBusyAction,
  setOllamaBusyAction,
  ollamaPullProgress,
  ollamaRuntimeStatus,
  pullOllamaModel,
  deleteOllamaModel,
  saveProjectRuntimeCommandPolicy,
  saveProjectRuntimeNetworkPolicy
}: {
  provider: ProviderDescriptor;
  selectedProject: Project | null;
  defaultModelByProvider: Record<ProviderId, string>;
  ollamaModelDraft: string;
  setOllamaModelDraft: Dispatch<SetStateAction<string>>;
  ollamaBusyAction: OllamaBusyAction;
  setOllamaBusyAction: Dispatch<SetStateAction<OllamaBusyAction>>;
  ollamaPullProgress: OllamaPullProgress | null;
  ollamaRuntimeStatus: OllamaRuntimeSnapshot | null;
  pullOllamaModel: (model: string) => Promise<void>;
  deleteOllamaModel: (model: string) => Promise<void>;
  saveProjectRuntimeCommandPolicy: (
    projectId: string,
    runtimeCommandPolicy: ProjectRuntimeCommandPolicy
  ) => Promise<void>;
  saveProjectRuntimeNetworkPolicy: (
    projectId: string,
    runtimeNetworkPolicy: ProjectRuntimeNetworkPolicy
  ) => Promise<void>;
}) {
  const selectedProjectRuntimeCommandPolicy =
    selectedProject?.runtimeCommandPolicy ?? 'approval_required';
  const selectedProjectRuntimeNetworkPolicy =
    selectedProject?.runtimeNetworkPolicy ?? 'disabled';
  const ollamaDefaultPolicy = deriveRuntimePolicy(
    'default',
    selectedProjectRuntimeCommandPolicy,
    selectedProjectRuntimeNetworkPolicy
  );
  const ollamaFullAccessPolicy = deriveRuntimePolicy(
    'full_access',
    selectedProjectRuntimeCommandPolicy,
    selectedProjectRuntimeNetworkPolicy
  );
  return (
    <details className="settings-provider-advanced">
      <summary>
        <span>Local Ollama controls</span>
        <ChevronRightIcon />
      </summary>
      <div className={detailBlockClass}>
        <div className="settings-provider-copy">
          <strong>Local Ollama</strong>
          <p>These controls only affect Ollama models running on this PC.</p>
          <p>API-key providers are configured separately through Custom API.</p>
        </div>
        {selectedProject ? (
          <div className="settings-provider-detail-row flex flex-col gap-3 rounded-2xl border border-transparent bg-transparent p-4">
            <div className="settings-provider-copy">
              <strong>Command access</strong>
              <span>{selectedProject.name}</span>
              <p>
                Choose whether Full access can request host-local commands. This is policy, not contained sandbox execution.
              </p>
            </div>
            <SelectField
              menuClassName="settings-select-menu"
              value={selectedProjectRuntimeCommandPolicy}
              onChange={(event) =>
                void saveProjectRuntimeCommandPolicy(
                  selectedProject.id,
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
                Choose whether approved or auto-approved host-local commands can use this machine's network.
              </p>
            </div>
            <SelectField
              menuClassName="settings-select-menu"
              value={selectedProjectRuntimeNetworkPolicy}
              onChange={(event) =>
                void saveProjectRuntimeNetworkPolicy(
                  selectedProject.id,
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
        <div className="settings-provider-detail-row flex flex-col gap-2 rounded-2xl border border-transparent bg-transparent p-4">
          <div className="settings-provider-copy">
            <strong>Local runtime</strong>
            <span>{ollamaRuntimeControlSummary(ollamaRuntimeStatus)}</span>
          </div>
          {ollamaRuntimeStatus ? (
            <div className="skill-meta">
              <span>{ollamaRuntimeStatus.managedByApp ? 'Managed by Vicode' : 'Not managed by Vicode'}</span>
              <span>{ollamaRuntimeStatus.canManageProcess ? 'Process control available' : 'Process control unavailable'}</span>
            </div>
          ) : null}
        </div>
        <div className="settings-provider-detail-list flex flex-col gap-3">
          <div className="settings-provider-detail-row flex flex-col gap-2 rounded-2xl border border-transparent bg-transparent p-4">
            <div className="settings-provider-copy">
              <strong>Default permissions</strong>
              <span>
                {ollamaDefaultPolicy.defaultToolLabels.join(', ')}
                {selectedProjectRuntimeNetworkPolicy === 'enabled' ? ', native web research' : ''}
              </span>
              <p>
                {selectedProjectRuntimeNetworkPolicy === 'enabled'
                  ? 'Workspace file tools stay available. Native web research can reach the public web. Default blocks local shell commands.'
                  : 'Workspace file tools stay available. Default blocks local shell commands.'}
              </p>
            </div>
          </div>
          <div className="settings-provider-detail-row flex flex-col gap-2 rounded-2xl border border-transparent bg-transparent p-4">
            <div className="settings-provider-copy">
              <strong>Full access adds</strong>
              <span>{ollamaFullAccessPolicy.elevatedToolLabels.join(', ') || 'No additional tools'}</span>
              <p>Full access enables host-local command access; this is not contained sandbox execution.</p>
              <p>
                {selectedProjectRuntimeCommandPolicy === 'disabled'
                  ? 'This workspace keeps host-local commands off, even with Full access.'
                  : selectedProjectRuntimeCommandPolicy === 'auto_approve'
                    ? 'Auto-approve starts host-local commands immediately without a per-command prompt.'
                    : 'Commands need approval before they run on the local host.'}
              </p>
              <p>{ollamaFullAccessPolicy.commandSummary}</p>
              <p>
                {selectedProjectRuntimeNetworkPolicy === 'enabled'
                  ? 'Approved or auto-approved host-local commands can use internet access.'
                  : 'Host-local command internet access stays blocked unless you allow it.'}
              </p>
            </div>
          </div>
        </div>
        <>
          <div className="settings-provider-copy">
            <strong>Local models</strong>
            <p>Pull or remove local models. Vicode refreshes the composer model list after changes.</p>
            <p>{providerRecommendedRouteSummary(provider.id)}</p>
          </div>
            <div className="settings-provider-key grid grid-cols-[minmax(0,1fr)_auto] gap-3">
              <TextInput
                className="settings-provider-input"
                placeholder={OLLAMA_DEFAULT_LOCAL_MODEL_ID}
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
                    await pullOllamaModel(ollamaModelDraft);
                    setOllamaModelDraft('');
                  } finally {
                    setOllamaBusyAction(null);
                  }
                }}
              >
                {ollamaBusyAction === 'pull' ? 'Pulling...' : 'Pull model'}
              </PrimaryButton>
            </div>
            {ollamaPullProgress ? (
              <OllamaPullProgressPanel progress={ollamaPullProgress} />
            ) : null}
            {provider.models.length > 0 ? (
              <div className="settings-provider-detail-list flex flex-col gap-3">
                {provider.models.map((model) => {
                  const deleteAction = `delete:${model.id}` as const;
                  const recommendationLabel = visibleModelRecommendationLabel(providerModelRecommendationLabel(model.recommendation));
                  const isDefaultModel = defaultModelByProvider[provider.id] === model.id;
                  return (
                    <div key={model.id} className="settings-provider-detail-row flex items-center justify-between gap-3 rounded-2xl border border-transparent bg-transparent p-4">
                      <div className="settings-provider-copy">
                        <strong>{model.label}</strong>
                        <span>{model.id}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {recommendationLabel ? (
                          <StatusPill tone={recommendationTone(recommendationLabel)}>{recommendationLabel}</StatusPill>
                        ) : null}
                        {isDefaultModel ? (
                          <span className="settings-provider-meta">Current default</span>
                        ) : null}
                        <ActionButton
                          size="compact"
                          tone="quiet"
                          disabled={!provider.installed || provider.authState === 'checking' || ollamaBusyAction !== null}
                          onClick={async () => {
                            setOllamaBusyAction(deleteAction);
                            try {
                              await deleteOllamaModel(model.id);
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
                <span>{`Pull a model here, or run \`ollama pull ${OLLAMA_DEFAULT_LOCAL_MODEL_ID}\` outside Vicode and refresh.`}</span>
              </div>
            )}
        </>
      </div>
    </details>
  );
}

function OllamaPullProgressPanel({ progress }: { progress: OllamaPullProgress }) {
  return (
    <div className="settings-provider-detail-row flex flex-col gap-3 rounded-2xl border border-transparent bg-transparent p-4">
      <div className="settings-provider-top flex items-start justify-between gap-4">
        <div className="settings-provider-copy">
          <strong>Pulling {progress.model}</strong>
          <span>{progress.status}</span>
        </div>
        <StatusPill tone={ollamaPullProgressTone(progress)}>
          {formatOllamaPullPercent(progress) ?? shortStatus(progress.state)}
        </StatusPill>
      </div>
      <div className="settings-provider-progress-bar">
        <div
          className={`settings-provider-progress-fill is-${ollamaPullProgressTone(progress)}`}
          style={{
            width: formatOllamaPullPercent(progress)
              ? `${Math.max(
                  4,
                  Math.min(
                    100,
                    ((progress.completed ?? 0) / Math.max(progress.total ?? 1, 1)) * 100
                  )
                )}%`
              : '4%'
          }}
        />
      </div>
      <div className="skill-meta">
        <span>
          {progress.completed !== null && progress.total !== null
            ? `${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()} bytes`
            : 'Preparing pull progress...'}
        </span>
        {progress.digest ? <span>{progress.digest}</span> : null}
      </div>
    </div>
  );
}
