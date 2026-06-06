import { Fragment, type ReactElement } from 'react';
import type { ProviderDescriptor, ProviderId } from '../../shared/domain';
import {
  isOllamaLocalModelId,
  providerCanRunInComposer,
  providerDisplayName,
  providerModelRecommendationLabel,
  providerModelTriggerSummary
} from '../../shared/providers';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  RefreshIcon
} from './icons';
import {
  Menu,
  MenuButton,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuItemLabel,
  MenuLabel,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from './ui';
import { cx } from './ui/utils';
import {
  modelBadgeClassName,
  providerInstallActionLabel,
  providerMenuSummary,
  providerModelMessage
} from './ComposerPanel.model';

type ComposerEffort = 'Low' | 'Medium' | 'High' | 'Extra high';

function ComposerTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="composer-tooltip">{label}</TooltipContent>
    </Tooltip>
  );
}

export function visibleComposerModelRecommendationLabel(recommendationLabel: string | null) {
  return recommendationLabel === 'Preview' ? recommendationLabel : null;
}

export function getProviderModelGroups(provider: ProviderDescriptor) {
  if (provider.id !== 'ollama') {
    return [{ label: null, models: provider.models }];
  }

  const cloudModels = provider.models.filter((model) => !isOllamaLocalModelId(model.id));
  const localModels = provider.models.filter((model) => isOllamaLocalModelId(model.id));
  if (localModels.length === 0) {
    return [{ label: null, models: provider.models }];
  }

  return [
    ...(cloudModels.length > 0 ? [{ label: 'Cloud', models: cloudModels }] : []),
    { label: 'Local', models: localModels }
  ];
}

interface ComposerProviderMenuProps {
  providers: ProviderDescriptor[];
  providerId: ProviderId;
  modelId: string;
  effort: ComposerEffort;
  selectComposerModel: (providerId: ProviderId, modelId: string) => void;
  selectComposerEffort: (effort: ComposerEffort) => void;
  refreshProvider: (providerId: ProviderId) => Promise<void>;
  openProviderSettings: () => void;
  dismissComposerTriggerOverlays: () => void;
  handleComposerMenuCloseAutoFocus: (event: Event) => void;
}

export function ComposerProviderMenu({
  providers,
  providerId,
  modelId,
  effort,
  selectComposerModel,
  selectComposerEffort,
  refreshProvider,
  openProviderSettings,
  dismissComposerTriggerOverlays,
  handleComposerMenuCloseAutoFocus
}: ComposerProviderMenuProps) {
  const activeProvider = providers.find((provider) => provider.id === providerId) ?? null;
  const visibleModels = activeProvider?.models ?? [];
  const activeModel = visibleModels.find((model) => model.id === modelId);
  const showProviderSpecificControls = providerId === 'openai';

  return (
    <Menu>
      <ComposerTooltip label="Choose provider and model">
        <MenuTrigger asChild>
          <MenuButton
            data-testid="composer-model-select"
            className="composer-trigger-button composer-model-trigger text-[12px]"
            trailingIcon={<ChevronDownIcon />}
          >
            <span className="composer-model-trigger-title truncate">
              {`${providerDisplayName(providerId)} / ${providerModelTriggerSummary(activeProvider ?? {
                id: providerId,
                installed: false,
                authState: 'missing_cli',
                authMode: null,
                models: []
              }, activeModel?.label ?? null)}`}
            </span>
          </MenuButton>
        </MenuTrigger>
      </ComposerTooltip>
      <MenuContent className="composer-menu composer-model-menu" onCloseAutoFocus={handleComposerMenuCloseAutoFocus}>
        {providers.map((provider) => (
          <MenuSub key={provider.id}>
            <MenuSubTrigger className={cx(providerId === provider.id && 'is-selected', 'rounded-lg')}>
              <MenuItemLabel>{providerDisplayName(provider.id)}</MenuItemLabel>
              <span>{providerMenuSummary(providers, provider, providerId, activeModel?.label ?? null)}</span>
              <ChevronRightIcon className="composer-provider-submenu-arrow" />
            </MenuSubTrigger>
            <MenuSubContent className="composer-menu composer-submenu composer-model-menu">
              {providerCanRunInComposer(provider) && provider.models.length > 0 ? (
                <>
                  {getProviderModelGroups(provider).map((group, groupIndex) => (
                    <Fragment key={group.label ?? 'models'}>
                      {group.label ? (
                        <>
                          {groupIndex > 0 ? <MenuSeparator /> : null}
                          <MenuLabel>{group.label}</MenuLabel>
                        </>
                      ) : null}
                      {group.models.map((model) => {
                        const selected = providerId === provider.id && modelId === model.id;
                        const recommendationLabel = providerModelRecommendationLabel(model.recommendation);
                        const visibleRecommendationLabel = visibleComposerModelRecommendationLabel(recommendationLabel);
                        return (
                          <MenuCheckboxItem
                            data-testid={`composer-model-option-${provider.id}-${model.id}`}
                            key={`${provider.id}:${model.id}`}
                            className={cx(selected && 'is-selected', 'rounded-xl')}
                            checked={selected}
                            disabled={!providerCanRunInComposer(provider)}
                            onCheckedChange={() => {
                              selectComposerModel(provider.id, model.id);
                              dismissComposerTriggerOverlays();
                            }}
                          >
                            <MenuItemLabel>
                              <span className="flex items-center gap-2">
                                <span>{model.label}</span>
                                {visibleRecommendationLabel ? (
                                  <span
                                    className={cx(
                                      'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em]',
                                      modelBadgeClassName(visibleRecommendationLabel)
                                    )}
                                  >
                                    {visibleRecommendationLabel}
                                  </span>
                                ) : null}
                              </span>
                            </MenuItemLabel>
                            {selected ? <CheckIcon /> : null}
                          </MenuCheckboxItem>
                        );
                      })}
                    </Fragment>
                  ))}
                </>
              ) : (
                <MenuItem onSelect={(event) => event.preventDefault()}>
                  <MenuItemLabel>{providerModelMessage(provider)}</MenuItemLabel>
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem onSelect={() => void refreshProvider(provider.id)} disabled={!providerCanRunInComposer(provider)}>
                <MenuItemLabel>Refresh models</MenuItemLabel>
                <RefreshIcon />
              </MenuItem>
              {!providerCanRunInComposer(provider) || provider.authState === 'disconnected' ? (
                <MenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    openProviderSettings();
                  }}
                >
                  <MenuItemLabel>{providerInstallActionLabel(provider)}</MenuItemLabel>
                </MenuItem>
              ) : null}
            </MenuSubContent>
          </MenuSub>
        ))}
        {showProviderSpecificControls ? <MenuSeparator /> : null}
        {providerId === 'openai' ? (
          <MenuSub>
            <MenuSubTrigger className="rounded-xl">
              <MenuItemLabel>Reasoning effort</MenuItemLabel>
              <span>{effort}</span>
            </MenuSubTrigger>
            <MenuSubContent className="composer-menu composer-submenu" onCloseAutoFocus={handleComposerMenuCloseAutoFocus}>
              {(['Low', 'Medium', 'High', 'Extra high'] as const).map((candidate) => (
                <MenuCheckboxItem
                  key={candidate}
                  className={cx(effort === candidate && 'is-selected', 'rounded-xl')}
                  checked={effort === candidate}
                  onCheckedChange={() => {
                    selectComposerEffort(candidate);
                    dismissComposerTriggerOverlays();
                  }}
                >
                  <MenuItemLabel>{candidate}</MenuItemLabel>
                  {effort === candidate ? <CheckIcon /> : null}
                </MenuCheckboxItem>
              ))}
            </MenuSubContent>
          </MenuSub>
        ) : null}
      </MenuContent>
    </Menu>
  );
}
