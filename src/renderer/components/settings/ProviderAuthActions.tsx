import { useState } from 'react';
import type { ProviderDescriptor, ProviderId } from '../../../shared/domain';
import {
  providerCliLabel,
  providerDisplayName,
  providerSettingsConnectLabel,
  providerSettingsInstallActionLabel,
  providerUsesHostedApi
} from '../../../shared/providers';
import { MoreIcon } from '../icons';
import {
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuItemLabel,
  MenuTrigger,
  PrimaryButton
} from '../ui';

interface ProviderAuthActionsProps {
  provider: ProviderDescriptor;
  canStopOllamaRuntime: boolean;
  beginProviderInstall: (providerId: ProviderId) => void;
  connectProvider: (providerId: ProviderId, mode?: 'cli' | 'api_key', options?: { force?: boolean }) => Promise<void>;
  adoptProviderAuth: (providerId: ProviderId) => Promise<void>;
  refreshProvider: (providerId: ProviderId) => Promise<void>;
  clearProviderAuth: (providerId: ProviderId) => Promise<void>;
  stopOllamaRuntime: () => Promise<void>;
}

function isOllamaCloudProvider(provider: ProviderDescriptor) {
  return providerUsesHostedApi(provider);
}

function shouldShowInstallAction(provider: ProviderDescriptor) {
  if (provider.id === 'ollama' && isOllamaCloudProvider(provider)) {
    return false;
  }
  return !provider.installed;
}

function shouldShowPrimaryProviderAction(provider: ProviderDescriptor) {
  if (provider.id === 'ollama' && isOllamaCloudProvider(provider)) {
    return false;
  }
  if (!provider.installed) {
    return false;
  }
  if (provider.authState === 'connected') {
    return false;
  }
  if (provider.authState === 'checking') {
    return false;
  }
  return true;
}

function shouldAdoptDetectedProviderAuth(provider: ProviderDescriptor) {
  if (provider.id === 'ollama') {
    return false;
  }

  if (!provider.installed || provider.authMode !== 'cli') {
    return false;
  }

  return provider.authState === 'detected' || provider.authState === 'disconnected';
}

function shouldOfferCliLaunch(provider: ProviderDescriptor) {
  if (provider.id === 'ollama' || !provider.installed || provider.authMode !== 'cli') {
    return false;
  }

  return provider.authState !== 'connected';
}

function canDisconnectProvider(provider: ProviderDescriptor) {
  if (provider.id === 'ollama') {
    return isOllamaCloudProvider(provider) && provider.authState === 'connected';
  }
  return provider.installed && provider.authState === 'connected';
}

function providerManualCliLabel(providerId: ProviderId) {
  if (providerId === 'gemini') {
    return 'Retry Gemini sign-in';
  }
  return `Open ${providerCliLabel(providerId)}`;
}

export function ProviderAuthActions({
  provider,
  canStopOllamaRuntime,
  beginProviderInstall,
  connectProvider,
  adoptProviderAuth,
  refreshProvider,
  clearProviderAuth,
  stopOllamaRuntime
}: ProviderAuthActionsProps) {
  const showInstallAction = shouldShowInstallAction(provider);
  const showPrimaryAction = shouldShowPrimaryProviderAction(provider);
  const offerCliLaunch = shouldOfferCliLaunch(provider);
  const canDisconnect = canDisconnectProvider(provider);
  const showMenu = provider.installed || canDisconnect || offerCliLaunch || (provider.id === 'ollama' && canStopOllamaRuntime);
  const [isPrimaryBusy, setIsPrimaryBusy] = useState(false);
  const [isMenuBusy, setIsMenuBusy] = useState(false);
  const isBusy = isPrimaryBusy || isMenuBusy;
  const primaryActionLabel = isPrimaryBusy ? 'Connecting...' : providerSettingsConnectLabel(provider);

  async function handlePrimaryAction() {
    setIsPrimaryBusy(true);
    try {
      if (shouldAdoptDetectedProviderAuth(provider)) {
        await adoptProviderAuth(provider.id);
        return;
      }

      await connectProvider(provider.id, 'cli');
    } finally {
      setIsPrimaryBusy(false);
    }
  }

  async function runMenuAction(action: () => Promise<void>) {
    setIsMenuBusy(true);
    try {
      await action();
    } finally {
      setIsMenuBusy(false);
    }
  }

  return (
    <div className="settings-provider-action-group flex flex-wrap items-center gap-2">
      {showInstallAction ? (
        <PrimaryButton size="compact" onClick={() => beginProviderInstall(provider.id)} disabled={isBusy}>
          {providerSettingsInstallActionLabel(provider)}
        </PrimaryButton>
      ) : null}
      {showPrimaryAction ? (
        <PrimaryButton size="compact" onClick={() => void handlePrimaryAction()} disabled={!provider.installed || isBusy}>
          {primaryActionLabel}
        </PrimaryButton>
      ) : null}
      {showMenu ? (
        <Menu>
          <MenuTrigger asChild>
            <IconButton
              className="settings-provider-menu-trigger"
              size="compact"
              label={`${providerDisplayName(provider.id)} actions`}
              disabled={isBusy}
            >
              <MoreIcon />
            </IconButton>
          </MenuTrigger>
          <MenuContent className="settings-provider-menu" align="end" sideOffset={8}>
            {provider.installed ? (
              <MenuItem disabled={isBusy} onSelect={() => void runMenuAction(() => refreshProvider(provider.id))}>
                <MenuItemLabel>{`Refresh ${providerDisplayName(provider.id)}`}</MenuItemLabel>
              </MenuItem>
            ) : null}
            {offerCliLaunch ? (
              <MenuItem disabled={isBusy} onSelect={() => void runMenuAction(() => connectProvider(provider.id, 'cli', { force: true }))}>
                <MenuItemLabel>{providerManualCliLabel(provider.id)}</MenuItemLabel>
              </MenuItem>
            ) : null}
            {canDisconnect ? (
              <MenuItem disabled={isBusy} onSelect={() => void runMenuAction(() => clearProviderAuth(provider.id))}>
                <MenuItemLabel>Disconnect from Vicode</MenuItemLabel>
              </MenuItem>
            ) : null}
            {provider.id === 'ollama' && canStopOllamaRuntime ? (
              <MenuItem disabled={isBusy} onSelect={() => void runMenuAction(() => stopOllamaRuntime())}>
                <MenuItemLabel>Stop local runtime</MenuItemLabel>
              </MenuItem>
            ) : null}
          </MenuContent>
        </Menu>
      ) : null}
    </div>
  );
}
