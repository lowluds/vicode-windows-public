import type { Dispatch, SetStateAction } from 'react';
import {
  ActionButton,
  Menu,
  MenuButton,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuItemLabel,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  ModalDialog,
  PrimaryButton,
  TextArea
} from '../components/ui';
import { VicodeBuildControlView } from '../components/VicodeBuildControlView';
import {
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  PlayIcon
} from '../components/icons';
import { cx } from '../components/ui/utils';
import type {
  ProviderDescriptor,
  ProviderReasoningEffort,
  ProviderId,
  VicodeBuildLaneId,
  VicodeBuildSnapshot,
  VicodeBuildVerificationResult
} from '../../shared/domain';
import {
  buildPlanReasoningLabel,
  modelBadgeClassName
} from '../lib/build-plan';
import {
  getProviderMetadata,
  providerDisplayName,
  providerModelRecommendationLabel,
  providerModelTriggerSummary
} from '../../shared/providers';

export type BuildPlanLaunchState = {
  goal: string;
  providerId: ProviderId;
  modelId: string;
  reasoningEffort: ProviderReasoningEffort | null;
};

interface BuildControlRouteContainerProps {
  snapshot: VicodeBuildSnapshot | null;
  verification: VicodeBuildVerificationResult | null;
  busyAction: string | null;
  onRefresh: () => void;
  onCreatePlan: () => void;
  onClearInactivePlans: () => Promise<void>;
  onSetTeamPaused: (teamId: string, paused: boolean) => Promise<void>;
  onWakeLane: (teamId: string, laneId: VicodeBuildLaneId) => Promise<void>;
  onRetryLane: (teamId: string, laneId: VicodeBuildLaneId) => Promise<void>;
  onOpenThread: (threadId: string) => Promise<void>;
  onRunVerification: () => Promise<void>;
  onBack: () => void;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  closeDialog: () => void;
  launchBuildPlanSetupThread: () => Promise<void>;
  buildPlanLaunch: BuildPlanLaunchState;
  setBuildPlanLaunch: Dispatch<SetStateAction<BuildPlanLaunchState>>;
  visibleProviders: ProviderDescriptor[];
  buildPlanLaunchModelOptions: ProviderDescriptor['models'];
  buildPlanLaunchProvider: ProviderDescriptor | null;
}

export function BuildControlRouteContainer({
  snapshot,
  verification,
  busyAction,
  onRefresh,
  onCreatePlan,
  onClearInactivePlans,
  onSetTeamPaused,
  onWakeLane,
  onRetryLane,
  onOpenThread,
  onRunVerification,
  onBack,
  dialogOpen,
  setDialogOpen,
  closeDialog,
  launchBuildPlanSetupThread,
  buildPlanLaunch,
  setBuildPlanLaunch,
  visibleProviders,
  buildPlanLaunchModelOptions,
  buildPlanLaunchProvider
}: BuildControlRouteContainerProps) {
  return (
    <>
      <section className="catalog-view automation-view">
        <div className="automation-page-shell">
          <header className="view-header automation-view-header flex items-start justify-between gap-4">
            <div>
              <h2>Autonomous Builds</h2>
              <p>Prompt-driven build plans with visible planner, builder, and finisher threads.</p>
            </div>
            <div className="automation-view-header-actions">
              <PrimaryButton
                className="automation-toolbar-primary"
                size="compact"
                leadingIcon={<PlayIcon />}
                onClick={onCreatePlan}
              >
                New build plan
              </PrimaryButton>
              <ActionButton
                className="automation-toolbar-close rounded-xl"
                size="compact"
                tone="quiet"
                leadingIcon={<CloseIcon />}
                onClick={onBack}
              >
                Close
              </ActionButton>
            </div>
          </header>
          <div className="automation-route-shell">
            <section className="automation-main-column">
              <VicodeBuildControlView
                snapshot={snapshot}
                verification={verification}
                busyAction={busyAction}
                onRefresh={onRefresh}
                onCreatePlan={onCreatePlan}
                onClearInactivePlans={onClearInactivePlans}
                onSetTeamPaused={onSetTeamPaused}
                onWakeLane={onWakeLane}
                onRetryLane={onRetryLane}
                onOpenThread={onOpenThread}
                onRunVerification={onRunVerification}
              />
            </section>
          </div>
        </div>
      </section>

      <ModalDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog();
            return;
          }
          setDialogOpen(true);
        }}
        title="Start build plan"
        description="Launch a dedicated setup thread. That thread will ask clarifying questions if needed, then shape the planner, builder, and finisher flow."
        className="automation-editor-dialog build-plan-launch-dialog"
        actions={
          <>
            <ActionButton tone="quiet" onClick={closeDialog}>
              Cancel
            </ActionButton>
            <PrimaryButton
              onClick={() => void launchBuildPlanSetupThread()}
              leadingIcon={<PlayIcon />}
              disabled={busyAction === 'launch-plan'}
            >
              {busyAction === 'launch-plan' ? 'Starting...' : 'Start setup thread'}
            </PrimaryButton>
          </>
        }
      >
        <div className="automation-editor-form">
          <label className="settings-field">
            <span>Goal</span>
            <TextArea
              rows={7}
              value={buildPlanLaunch.goal}
              onChange={(event) =>
                setBuildPlanLaunch((current) => ({
                  ...current,
                  goal: event.target.value
                }))
              }
              placeholder="Describe what you want this build plan to accomplish. The setup thread will turn this into a concrete planner, builder, and finisher workflow."
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="settings-field">
              <span>Setup provider</span>
              <Menu>
                <MenuTrigger asChild>
                  <MenuButton
                    className="h-10 w-full rounded-[var(--ui-radius-lg)] px-3 text-left"
                    trailingIcon={<ChevronDownIcon />}
                  >
                    {buildPlanLaunchProvider
                      ? `${providerDisplayName(buildPlanLaunch.providerId)} / ${providerModelTriggerSummary(buildPlanLaunchProvider, buildPlanLaunchModelOptions.find((model) => model.id === buildPlanLaunch.modelId)?.label ?? null)}`
                      : providerDisplayName(buildPlanLaunch.providerId)}
                  </MenuButton>
                </MenuTrigger>
                <MenuContent className="composer-menu composer-model-menu build-plan-menu" align="start">
                  {visibleProviders.map((provider) => (
                    <MenuSub key={provider.id}>
                      <MenuSubTrigger className={cx(buildPlanLaunch.providerId === provider.id ? 'is-selected' : '', 'rounded-xl')}>
                        <MenuItemLabel>{providerDisplayName(provider.id)}</MenuItemLabel>
                        <span>{providerModelTriggerSummary(provider, provider.models.find((model) => model.id === buildPlanLaunch.modelId)?.label ?? null)}</span>
                      </MenuSubTrigger>
                      <MenuSubContent className="composer-menu composer-submenu composer-model-menu build-plan-menu">
                        {provider.models.length > 0 ? (
                          provider.models.map((model) => {
                            const selected = buildPlanLaunch.providerId === provider.id && buildPlanLaunch.modelId === model.id;
                            const recommendationLabel = providerModelRecommendationLabel(model.recommendation);
                            return (
                              <MenuCheckboxItem
                                key={`${provider.id}:${model.id}`}
                                className={cx(selected ? 'is-selected' : '', 'rounded-xl')}
                                checked={selected}
                                onCheckedChange={() => {
                                  setBuildPlanLaunch((current) => ({
                                    ...current,
                                    providerId: provider.id,
                                    modelId: model.id,
                                    reasoningEffort:
                                      current.providerId === provider.id
                                        ? current.reasoningEffort
                                        : getProviderMetadata(provider.id).defaultReasoningEffort
                                  }));
                                }}
                              >
                                <MenuItemLabel>
                                  <span className="flex items-center gap-2">
                                    <span>{model.label}</span>
                                    {recommendationLabel ? (
                                      <span className={cx('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]', modelBadgeClassName(recommendationLabel))}>
                                        {recommendationLabel}
                                      </span>
                                    ) : null}
                                  </span>
                                </MenuItemLabel>
                                {selected ? <CheckIcon /> : null}
                              </MenuCheckboxItem>
                            );
                          })
                        ) : (
                          <MenuItem onSelect={(event) => event.preventDefault()} className="rounded-xl">
                            <MenuItemLabel>No models available</MenuItemLabel>
                          </MenuItem>
                        )}
                      </MenuSubContent>
                    </MenuSub>
                  ))}
                </MenuContent>
              </Menu>
            </label>
            <label className="settings-field">
              <span>Setup model</span>
              <Menu>
                <MenuTrigger asChild>
                  <MenuButton
                    className="h-10 w-full rounded-[var(--ui-radius-lg)] px-3 text-left"
                    trailingIcon={<ChevronDownIcon />}
                  >
                    {buildPlanLaunchModelOptions.find((model) => model.id === buildPlanLaunch.modelId)?.label ?? 'Select model'}
                  </MenuButton>
                </MenuTrigger>
                <MenuContent className="composer-menu composer-model-menu build-plan-menu" align="start">
                  {buildPlanLaunchModelOptions.map((model) => {
                    const selected = buildPlanLaunch.modelId === model.id;
                    const recommendationLabel = providerModelRecommendationLabel(model.recommendation);
                    return (
                      <MenuCheckboxItem
                        key={model.id}
                        className={cx(selected ? 'is-selected' : '', 'rounded-xl')}
                        checked={selected}
                        onCheckedChange={() =>
                          setBuildPlanLaunch((current) => ({
                            ...current,
                            modelId: model.id
                          }))
                        }
                      >
                        <MenuItemLabel>
                          <span className="flex items-center gap-2">
                            <span>{model.label}</span>
                            {recommendationLabel ? (
                              <span className={cx('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]', modelBadgeClassName(recommendationLabel))}>
                                {recommendationLabel}
                              </span>
                            ) : null}
                          </span>
                        </MenuItemLabel>
                        {selected ? <CheckIcon /> : null}
                      </MenuCheckboxItem>
                    );
                  })}
                </MenuContent>
              </Menu>
            </label>
          </div>
          {buildPlanLaunch.providerId === 'openai' ? (
            <label className="settings-field">
              <span>Reasoning level</span>
              <Menu>
                <MenuTrigger asChild>
                  <MenuButton
                    className="h-10 w-full rounded-[var(--ui-radius-lg)] px-3 text-left md:w-[220px]"
                    trailingIcon={<ChevronDownIcon />}
                  >
                    {buildPlanReasoningLabel(buildPlanLaunch.reasoningEffort)}
                  </MenuButton>
                </MenuTrigger>
                <MenuContent className="composer-menu composer-submenu build-plan-menu" align="start">
                  {(['low', 'medium', 'high', 'xhigh'] as const).map((candidate) => {
                    const selected = buildPlanLaunch.reasoningEffort === candidate;
                    return (
                      <MenuCheckboxItem
                        key={candidate}
                        className={cx(selected ? 'is-selected' : '', 'rounded-xl')}
                        checked={selected}
                        onCheckedChange={() =>
                          setBuildPlanLaunch((current) => ({
                            ...current,
                            reasoningEffort: candidate
                          }))
                        }
                      >
                        <MenuItemLabel>{buildPlanReasoningLabel(candidate)}</MenuItemLabel>
                        {selected ? <CheckIcon /> : null}
                      </MenuCheckboxItem>
                    );
                  })}
                </MenuContent>
              </Menu>
            </label>
          ) : null}
          <p className="text-sm text-[color:var(--ui-text-muted)]">
            Use the current workspace provider if you want the build-plan conversation to match the rest of the thread flow. The actual planning conversation happens in the setup thread, not in this modal.
          </p>
        </div>
      </ModalDialog>
    </>
  );
}
