import type { ProviderDescriptor, ProviderId, ProviderModelRecommendation } from './domain-provider';
import { isOllamaLocalModelId } from './provider-model-selection';
import { isRetiredProviderId, providerCliLabel, providerDisplayName, providerRetiredMessage } from './provider-metadata';

export interface ProviderOllamaRuntimeLike {
  installed?: boolean | null;
  reachable?: boolean | null;
  starting?: boolean | null;
  managedByApp?: boolean | null;
  canManageProcess?: boolean | null;
}

export function providerModelRecommendationLabel(recommendation: ProviderModelRecommendation | null | undefined) {
  if (recommendation === 'recommended') {
    return 'Default';
  }
  if (recommendation === 'fast') {
    return 'Quick';
  }
  if (recommendation === 'preview') {
    return 'Preview';
  }
  return null;
}

export function providerRecommendedRouteSummary(providerId: ProviderId) {
  if (isRetiredProviderId(providerId)) {
    return providerRetiredMessage(providerId);
  }

  if (providerId === 'ollama') {
    return 'Qwen 2.5 Coder 14B Q6 for local models.';
  }

  if (providerId === 'openai_compatible') {
    return 'Saved custom OpenAI-compatible model.';
  }

  return providerRetiredMessage(providerId);
}

export function providerSetupMenuSummary(
  provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authState' | 'authMode'>
) {
  if (isRetiredProviderId(provider.id)) {
    return 'Provider retired';
  }

  if (!providerCanRunInComposer(provider)) {
    return provider.id === 'ollama'
      ? 'Set up Ollama'
      : provider.id === 'openai_compatible'
        ? 'Add custom API'
        : `Install ${providerCliLabel(provider.id)}`;
  }

  if (provider.authState === 'checking') {
    return provider.id === 'ollama' ? 'Starting local runtime' : 'Finishing sign-in';
  }

  if (provider.authState === 'detected') {
    return provider.id === 'ollama' ? 'Start local runtime' : 'Finish setup';
  }

  if (provider.authState === 'disconnected' || provider.authState === 'missing_cli') {
    return 'Finish setup';
  }

  return null;
}

export function providerModelTriggerSummary(
  provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authState' | 'authMode' | 'models'>,
  activeModelLabel?: string | null
) {
  if (activeModelLabel) {
    return activeModelLabel;
  }

  const setupSummary = providerSetupMenuSummary(provider);
  if (setupSummary) {
    return setupSummary;
  }

  return provider.models.length > 0 ? 'Choose a model' : 'Refresh models';
}

export function providerSetupGuidance(
  provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authState' | 'authMode'>
) {
  if (isRetiredProviderId(provider.id)) {
    return providerRetiredMessage(provider.id);
  }

  if (!providerCanRunInComposer(provider)) {
    return provider.id === 'ollama'
      ? 'Install Ollama and pull a local model.'
      : provider.id === 'openai_compatible'
        ? 'Add an enabled custom provider with a base URL, API key, and model in Settings > Providers.'
      : `Install ${providerCliLabel(provider.id)} and finish setup in Settings > Providers.`;
  }

  if (provider.authState === 'checking') {
    return provider.id === 'ollama'
      ? 'Local Ollama is starting. Try again in a moment.'
      : `${providerDisplayName(provider.id)} sign-in is finishing. Try again in a moment.`;
  }

  if (provider.authState === 'detected') {
    return provider.id === 'ollama'
      ? 'Local Ollama is installed but not running yet. Start it in Settings > Providers.'
      : 'A machine-local sign-in was found. Finish setup explicitly in Settings > Providers.';
  }

  if (provider.authState === 'disconnected' || provider.authState === 'missing_cli') {
    return provider.id === 'ollama'
      ? 'Start local Ollama in Settings > Providers.'
      : provider.id === 'openai_compatible'
        ? 'Add an enabled custom provider in Settings > Providers before sending.'
      : `Finish ${providerDisplayName(provider.id)} setup in Settings > Providers.`;
  }

  return 'No models are loaded yet. Refresh to try again.';
}

export function providerBlockedRunMessage(
  provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authState' | 'authMode'>
) {
  if (isRetiredProviderId(provider.id)) {
    return providerRetiredMessage(provider.id);
  }

  if (provider.authState === 'checking') {
    return providerSetupGuidance(provider);
  }

  if (provider.authState === 'detected') {
    return providerSetupGuidance(provider);
  }

  if (provider.authState === 'disconnected' || provider.authState === 'missing_cli') {
    return provider.id === 'ollama'
      ? 'Finish Ollama setup in Settings > Providers before sending.'
      : provider.id === 'openai_compatible'
        ? 'Add an enabled custom provider in Settings > Providers before sending.'
      : `Finish ${providerDisplayName(provider.id)} setup in Settings > Providers before sending.`;
  }

  return providerSetupGuidance(provider);
}

export function providerUsesHostedApi(provider: Pick<ProviderDescriptor, 'id' | 'authMode'>) {
  return false;
}

export function providerSettingsAuthTitle(provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authState' | 'authMode'>) {
  if (isRetiredProviderId(provider.id)) {
    return 'Provider retired';
  }

  if (provider.id === 'ollama') {
    if (!provider.installed) {
      return 'Install local Ollama';
    }
    if (provider.authState === 'checking') {
      return 'Starting local Ollama';
    }
    if (provider.authState === 'connected') {
      return 'Ollama is available';
    }
    if (provider.authState === 'detected') {
      return 'Local Ollama is installed';
    }
    return 'Start local Ollama';
  }

  if (provider.id === 'openai_compatible') {
    return provider.authState === 'connected' ? 'Custom APIs are ready' : 'Add custom API';
  }

  if (!provider.installed) {
    return `Install ${providerCliLabel(provider.id)}`;
  }
  if (provider.authState === 'disconnected' && provider.authMode !== null) {
    return 'Reconnect in Vicode';
  }
  if (provider.authState === 'checking') {
    return 'Checking sign-in';
  }
  if (provider.authState === 'connected') {
    return 'Ready to run';
  }
  if (provider.authState === 'detected') {
    return 'Local sign-in found';
  }
  return 'Sign in to continue';
}

export function providerSettingsAuthDescription(provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authState' | 'authMode' | 'message'>) {
  if (isRetiredProviderId(provider.id)) {
    return providerRetiredMessage(provider.id);
  }

  if (provider.id === 'ollama') {
    if (!provider.installed) {
      return provider.message ?? 'Install Ollama to use local models from this PC.';
    }
    if (provider.authState === 'checking') {
      return 'Starting local Ollama.';
    }
    if (provider.authState === 'connected') {
      return provider.message ?? 'Use local models from this PC.';
    }
    if (provider.authState === 'detected') {
      return 'Local Ollama is installed. Start the local runtime to use models on this PC.';
    }
    return provider.message ?? 'Use local Ollama models from this PC.';
  }

  if (provider.id === 'openai_compatible') {
    return provider.message ?? 'Enabled custom OpenAI-compatible providers appear here after you save a base URL, API key, and model.';
  }

  if (!provider.installed) {
    return provider.message ?? `Install ${providerCliLabel(provider.id)} on this PC, then sign in here.`;
  }
  if (provider.authState === 'checking') {
    return 'Finishing sign-in.';
  }
  if (provider.authState === 'detected') {
    return (
      provider.message ??
      'A machine-local sign-in is available. Choose Connect to use it in Vicode.'
    );
  }
  if (provider.authMode === 'cli' && provider.authState === 'connected') {
    return 'Ready to use.';
  }
  if (provider.authMode === 'api_key' && provider.authState === 'connected') {
    return 'Saved API key is ready.';
  }
  if (provider.authState === 'disconnected' && provider.authMode === 'cli') {
    return provider.message ?? 'This provider is disconnected in Vicode, but a machine-local sign-in is still available.';
  }
  return provider.message ?? 'Sign in first. Use a saved API key only if you need it.';
}

export function providerSettingsPillLabel(provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authState' | 'authMode'>) {
  if (isRetiredProviderId(provider.id)) {
    return 'Retired';
  }

  if (provider.id === 'ollama') {
    if (!provider.installed) {
      return 'Not installed';
    }
    if (provider.authState === 'checking') {
      return 'Starting';
    }
    if (provider.authState === 'detected') {
      return 'Needs start';
    }
    if (provider.authState === 'connected') {
      return 'Ready';
    }
    return 'Unavailable';
  }

  if (!provider.installed) {
    return 'Install needed';
  }
  if (provider.authState === 'disconnected' && provider.authMode !== null) {
    return provider.authMode === 'cli' ? 'Reconnect' : 'Needs sign-in';
  }
  if (provider.authState === 'checking') {
    return 'Checking';
  }
  if (provider.authState === 'detected') {
    return 'Found locally';
  }
  if (provider.authState === 'connected' && provider.authMode === 'api_key') {
    return 'Saved key';
  }
  if (provider.authState === 'connected') {
    return 'Ready';
  }
  return 'Not ready';
}

export function providerSettingsConnectLabel(provider: Pick<ProviderDescriptor, 'id' | 'authState' | 'authMode'>) {
  if (isRetiredProviderId(provider.id)) {
    return 'Unavailable';
  }

  if (provider.id === 'openai_compatible') {
    return provider.authState === 'connected' ? 'Ready' : 'Not ready';
  }

  if (provider.id === 'ollama') {
    if (provider.authState === 'checking') {
      return 'Starting local runtime';
    }
    if (provider.authState === 'detected') {
      return 'Start local runtime';
    }
    return 'Start local runtime';
  }

  return 'Connect';
}

export function providerSettingsInstallActionLabel(provider: Pick<ProviderDescriptor, 'id' | 'authMode'>) {
  if (isRetiredProviderId(provider.id)) {
    return 'Unavailable';
  }

  if (provider.id === 'ollama') {
    return 'Install Ollama';
  }
  if (provider.id === 'openai_compatible') {
    return 'Configure custom API';
  }
  return `Install ${providerCliLabel(provider.id)}`;
}

export function providerSettingsInstallLabel(
  provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authMode'>,
  ollamaRuntimeStatus: ProviderOllamaRuntimeLike | null
) {
  if (isRetiredProviderId(provider.id)) {
    return 'Retired';
  }

  if (provider.id === 'ollama') {
    const localInstalled = ollamaRuntimeStatus?.installed ?? provider.installed;
    return localInstalled ? 'Local install found' : 'Local install optional';
  }
  if (provider.id === 'openai_compatible') {
    return provider.installed ? 'Configured' : 'Not configured';
  }
  return provider.installed ? 'Installed' : 'Install required';
}

export function providerSettingsStatusSummary(
  provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authState' | 'authMode' | 'models'>,
  ollamaRuntimeStatus: ProviderOllamaRuntimeLike | null
) {
  if (isRetiredProviderId(provider.id)) {
    return providerRetiredMessage(provider.id);
  }

  if (provider.id === 'ollama') {
    if (!provider.installed) {
      return 'Install Ollama and pull a local model before running Ollama threads.';
    }
    if (ollamaRuntimeStatus?.managedByApp) {
      if (ollamaRuntimeStatus.reachable) {
        return provider.models.length > 0
          ? `${provider.models.length} local model${provider.models.length === 1 ? '' : 's'} ready in local Ollama`
          : 'No local models found. Pull a local model first.';
      }
      if (ollamaRuntimeStatus.starting) {
        return 'Starting local Ollama...';
      }
    }
    if (ollamaRuntimeStatus?.reachable) {
      return provider.models.length > 0
        ? `${provider.models.length} local model${provider.models.length === 1 ? '' : 's'} available`
        : 'No local models found. Pull a local model first.';
    }
    if (provider.authState === 'connected') {
      return provider.models.length > 0
        ? `${provider.models.length} local model${provider.models.length === 1 ? '' : 's'} available`
        : 'No local models found. Pull a local model first.';
    }
    if (provider.authState === 'checking') {
      return 'Starting local Ollama...';
    }
    if (provider.authState === 'detected') {
      return 'Local Ollama is installed, but not running yet';
    }
    return 'Local Ollama status unavailable';
  }

  if (provider.id === 'openai_compatible') {
    return provider.models.length > 0
      ? `${provider.models.length} custom model${provider.models.length === 1 ? '' : 's'} available`
      : 'No enabled custom providers are ready yet';
  }

  if (!provider.installed) {
    return `Install ${providerCliLabel(provider.id)} on this PC to continue.`;
  }
  if (provider.authState === 'checking') {
    return provider.id === 'gemini'
      ? 'Vicode is waiting for browser sign-in to finish.'
      : 'Vicode is waiting for sign-in to finish.';
  }
  if (provider.authState === 'connected') {
    return 'Ready to use.';
  }
  if (provider.authState === 'detected') {
    return 'A machine-local sign-in is available. Connect it before starting new runs.';
  }
  if (provider.authState === 'disconnected') {
    return provider.authMode === 'cli'
      ? 'This provider is disconnected in Vicode, but a machine-local sign-in is still available.'
      : 'Sign in to refresh models and start new runs.';
  }
  return 'Provider status is available in Vicode.';
}

export function providerSettingsOllamaModeSummary(
  provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authState' | 'authMode'>,
  ollamaRuntimeStatus: ProviderOllamaRuntimeLike | null
) {
  if (provider.id !== 'ollama') {
    return '';
  }
  if (provider.installed && (provider.authState === 'connected' || ollamaRuntimeStatus?.reachable)) {
    return 'Use local models from this PC.';
  }
  if (provider.installed) {
    return 'Ollama is installed, but not running yet. Start it here when you want local models.';
  }
  return 'Install Ollama and pull a local model to use this provider.';
}

export function providerCanRunInComposer(
  provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authMode'> & Partial<Pick<ProviderDescriptor, 'authState' | 'models'>>
) {
  if (isRetiredProviderId(provider.id)) {
    return false;
  }
  if (provider.id === 'openai_compatible') {
    return provider.installed && provider.authState === 'connected' && (provider.models?.length ?? 0) > 0;
  }
  return provider.installed;
}
