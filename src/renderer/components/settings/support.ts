import type {
  AccentMode,
  AppearanceMode,
  FollowUpBehavior,
  OllamaPullProgress,
  OllamaTransportMode,
  ProviderDescriptor,
  SettingsSection
} from '../../../shared/domain';
import type { OllamaRuntimeSnapshot } from '../../../shared/ipc';
import {
  providerDisplayName,
  providerModelRecommendationLabel,
  providerRecommendedRouteSummary,
  providerSettingsAuthDescription,
  providerSettingsAuthTitle,
  providerSettingsConnectLabel,
  providerSettingsInstallActionLabel,
  providerSettingsInstallLabel,
  providerSettingsPillLabel,
  providerSettingsStatusSummary,
  providerUsesHostedApi
} from '../../../shared/providers';

export const OLLAMA_API_KEY_DOCS_URL = 'https://docs.ollama.com/api/authentication';
export const OLLAMA_ACCOUNT_URL = 'https://ollama.com/';

export const followUpBehaviorOptions: Array<{ value: FollowUpBehavior; label: string }> = [
  { value: 'queue', label: 'Queue by default' },
  { value: 'steer', label: 'Steer by default' }
];

export const appearanceModeOptions: Array<{ value: AppearanceMode; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' }
];

export const accentModeOptions: Array<{ value: AccentMode; label: string }> = [
  { value: 'system', label: 'Use Windows accent' },
  { value: 'custom', label: 'Use custom accent' }
];

export const ollamaTransportModeOptions: Array<{
  value: OllamaTransportMode;
  label: string;
  description: string;
}> = [
  {
    value: 'chat',
    label: '/api/chat',
    description:
      'Stable default. Uses the native Ollama chat surface for plain replies and the existing Vicode-owned tool loop.'
  },
  {
    value: 'responses',
    label: '/v1/responses',
    description:
      'Experimental OpenAI-compatible surface. Keeps Vicode in charge of the tool loop, but swaps the transport.'
  }
];

export const settingsSections: Array<{ value: SettingsSection; label: string }> = [
  { value: 'general', label: 'App' },
  { value: 'providers', label: 'Providers' },
  { value: 'personalization', label: 'Instructions' },
  { value: 'diagnostics', label: 'Advanced' },
  { value: 'archived_threads', label: 'Archived threads' }
];

export function shortStatus(status: string) {
  return status.replaceAll('_', ' ');
}

export function recommendationTone(recommendation: string | null) {
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

export function isOllamaCloudProvider(provider: ProviderDescriptor) {
  return providerUsesHostedApi(provider);
}

export function providerAuthTitle(provider: ProviderDescriptor) {
  return providerSettingsAuthTitle(provider);
}

export function providerAuthDescription(provider: ProviderDescriptor) {
  return providerSettingsAuthDescription(provider);
}

export function providerPillLabel(provider: ProviderDescriptor) {
  return providerSettingsPillLabel(provider);
}

export function providerConnectLabel(provider: ProviderDescriptor) {
  return providerSettingsConnectLabel(provider);
}

export function providerInstallActionLabel(provider: ProviderDescriptor) {
  return providerSettingsInstallActionLabel(provider);
}

export function canDisconnectProvider(provider: ProviderDescriptor) {
  if (provider.id === 'ollama') {
    return isOllamaCloudProvider(provider) && provider.authState === 'connected';
  }
  return provider.installed && provider.authState === 'connected';
}

export function providerInstallLabel(
  provider: ProviderDescriptor,
  ollamaRuntimeStatus: OllamaRuntimeSnapshot | null
) {
  return providerSettingsInstallLabel(provider, ollamaRuntimeStatus);
}

export function shouldShowInstallAction(provider: ProviderDescriptor) {
  if (provider.id === 'ollama' && isOllamaCloudProvider(provider)) {
    return false;
  }
  return !provider.installed;
}

export function providerStatusSummary(
  provider: ProviderDescriptor,
  ollamaRuntimeStatus: OllamaRuntimeSnapshot | null
) {
  return providerSettingsStatusSummary(provider, ollamaRuntimeStatus);
}

export function ollamaPullProgressTone(progress: OllamaPullProgress) {
  if (progress.state === 'failed') {
    return 'failed' as const;
  }
  if (progress.state === 'completed') {
    return 'connected' as const;
  }
  return 'checking' as const;
}

export function formatOllamaPullPercent(progress: OllamaPullProgress) {
  if (progress.total === null || progress.completed === null || progress.total <= 0) {
    return null;
  }

  const percent = Math.max(0, Math.min(100, (progress.completed / progress.total) * 100));
  return `${Math.round(percent)}%`;
}

export function shouldShowPrimaryProviderAction(provider: ProviderDescriptor) {
  if (provider.id === 'ollama' && isOllamaCloudProvider(provider)) {
    return false;
  }
  if (!provider.installed || provider.authState === 'connected' || provider.authState === 'checking') {
    return false;
  }
  return true;
}

export function shouldAdoptDetectedProviderAuth(provider: ProviderDescriptor) {
  if (provider.id === 'ollama') {
    return false;
  }

  if (!provider.installed || provider.authMode !== 'cli') {
    return false;
  }

  return provider.authState === 'detected' || provider.authState === 'disconnected';
}

export function shouldShowCliSignInAction(provider: ProviderDescriptor) {
  if (provider.id === 'ollama' || !provider.installed || provider.authMode !== 'cli') {
    return false;
  }

  return provider.authState === 'detected' || provider.authState === 'disconnected';
}

export function ollamaRuntimeControlSummary(snapshot: OllamaRuntimeSnapshot | null) {
  if (!snapshot) {
    return 'Runtime control status unavailable.';
  }
  if (snapshot.managedByApp) {
    return snapshot.reachable ? 'Vicode-managed runtime' : 'Vicode-managed runtime starting';
  }
  if (snapshot.reachable) {
    return snapshot.canManageProcess
      ? 'External runtime currently active'
      : 'External runtime active, but Vicode cannot own the process on this machine';
  }
  if (snapshot.canManageProcess) {
    return 'Runtime installed and startable under Vicode control';
  }
  return 'Runtime not reachable yet';
}

export function formatTime(value: string | null) {
  if (!value) {
    return 'Never';
  }
  return new Date(value).toLocaleString();
}

export function formatQuotaPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return `${Math.max(0, Math.min(100, value * 100)).toFixed(value * 100 >= 10 ? 0 : 1)}%`;
}

export function formatQuotaAmount(remaining: number | null, limit: number | null) {
  if (remaining === null && limit === null) {
    return null;
  }

  if (remaining !== null && limit !== null) {
    return `${remaining.toLocaleString()} / ${limit.toLocaleString()}`;
  }

  return remaining !== null ? remaining.toLocaleString() : limit?.toLocaleString() ?? null;
}

export function formatStorageAmount(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return 'Unavailable';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function quotaTone(value: number | null) {
  if (value === null) {
    return 'detected' as const;
  }
  if (value <= 0.1) {
    return 'failed' as const;
  }
  if (value <= 0.35) {
    return 'checking' as const;
  }
  return 'connected' as const;
}

export {
  providerDisplayName,
  providerModelRecommendationLabel,
  providerRecommendedRouteSummary
};
