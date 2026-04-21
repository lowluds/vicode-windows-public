import type {
  ExecutionPermission,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderId,
  ProviderModel,
  ProviderModelRecommendation,
  ProviderReasoningEffort
} from './domain';

export interface ProviderMetadata {
  label: string;
  cliLabel: string;
  authBrand: string;
  cliCommands: string[];
  authLaunchTitle: string | null;
  authLaunchArgs: string[];
  logoutLaunchTitle?: string | null;
  logoutLaunchArgs?: string[];
  defaultModelId: string;
  defaultReasoningEffort: ProviderReasoningEffort | null;
  defaultThinking: boolean;
  capabilities: ProviderCapabilities;
}

export const PROVIDER_METADATA: Record<ProviderId, ProviderMetadata> = {
  openai: {
    label: 'Codex',
    cliLabel: 'Codex CLI',
    authBrand: 'ChatGPT',
    cliCommands: ['codex.cmd', 'codex.exe', 'codex'],
    authLaunchTitle: 'OpenAI Codex Login',
    authLaunchArgs: ['login'],
    defaultModelId: 'gpt-5.4',
    defaultReasoningEffort: 'high',
    defaultThinking: false,
    capabilities: {
      supportsThinkingToggle: false,
      supportsRuntimeSkillResources: true,
      supportsNativeRunProgress: true,
      executionAuthority: 'provider_cli',
      approvalAuthority: 'none',
      sandboxAuthority: 'provider_cli',
      requiresTrustedWorkspace: true,
      requiresFullAccessForAppRuns: false,
      workspaceInstructionFileName: 'codex.md'
    }
  },
  gemini: {
    label: 'Gemini',
    cliLabel: 'Gemini CLI',
    authBrand: 'Google',
    cliCommands: ['gemini.cmd', 'gemini.exe', 'gemini'],
    authLaunchTitle: 'Gemini CLI Login',
    authLaunchArgs: [],
    defaultModelId: 'auto-gemini-2.5',
    defaultReasoningEffort: null,
    defaultThinking: false,
    capabilities: {
      supportsThinkingToggle: false,
      supportsRuntimeSkillResources: true,
      supportsNativeRunProgress: true,
      executionAuthority: 'provider_cli',
      approvalAuthority: 'provider_cli',
      sandboxAuthority: 'provider_cli',
      requiresTrustedWorkspace: true,
      requiresFullAccessForAppRuns: false,
      workspaceInstructionFileName: 'gemini.md'
    }
  },
  qwen: {
    label: 'Qwen',
    cliLabel: 'Qwen CLI',
    authBrand: 'Qwen',
    cliCommands: ['qwen.cmd', 'qwen.exe', 'qwen'],
    authLaunchTitle: 'Qwen Login',
    authLaunchArgs: ['/auth'],
    defaultModelId: 'qwen3.5-plus',
    defaultReasoningEffort: null,
    defaultThinking: true,
    capabilities: {
      supportsThinkingToggle: true,
      supportsRuntimeSkillResources: false,
      supportsNativeRunProgress: false,
      executionAuthority: 'provider_cli',
      approvalAuthority: 'provider_cli',
      sandboxAuthority: 'provider_cli',
      requiresTrustedWorkspace: true,
      requiresFullAccessForAppRuns: false,
      workspaceInstructionFileName: 'qwen.md'
    }
  },
  ollama: {
    label: 'Ollama',
    cliLabel: 'Ollama CLI',
    authBrand: 'Local runtime',
    cliCommands: ['ollama.exe', 'ollama'],
    authLaunchTitle: null,
    authLaunchArgs: [],
    defaultModelId: 'qwen3-coder',
    defaultReasoningEffort: null,
    defaultThinking: false,
    capabilities: {
      supportsThinkingToggle: false,
      supportsRuntimeSkillResources: true,
      supportsNativeRunProgress: false,
      executionAuthority: 'app_runtime',
      approvalAuthority: 'app',
      sandboxAuthority: 'app_runtime',
      requiresTrustedWorkspace: true,
      requiresFullAccessForAppRuns: false,
      workspaceInstructionFileName: 'ollama.md'
    }
  },
  kimi: {
    label: 'Kimi',
    cliLabel: 'Kimi Code CLI',
    authBrand: 'Kimi',
    cliCommands: ['kimi.cmd', 'kimi.exe', 'kimi'],
    authLaunchTitle: 'Kimi Login',
    authLaunchArgs: ['login'],
    logoutLaunchTitle: 'Kimi Logout',
    logoutLaunchArgs: ['logout'],
    defaultModelId: 'kimi-k2-thinking',
    defaultReasoningEffort: null,
    defaultThinking: false,
    capabilities: {
      supportsThinkingToggle: false,
      supportsRuntimeSkillResources: false,
      supportsNativeRunProgress: false,
      executionAuthority: 'provider_cli',
      approvalAuthority: 'none',
      sandboxAuthority: 'none',
      requiresTrustedWorkspace: true,
      requiresFullAccessForAppRuns: true,
      workspaceInstructionFileName: 'kimi.md'
    }
  }
};

export function createProviderRecord<T>(factory: (providerId: ProviderId) => T): Record<ProviderId, T> {
  return Object.fromEntries(Object.keys(PROVIDER_METADATA).map((providerId) => [providerId, factory(providerId as ProviderId)])) as Record<ProviderId, T>;
}

export function getProviderMetadata(providerId: ProviderId) {
  return PROVIDER_METADATA[providerId];
}

export function providerDisplayName(providerId: ProviderId) {
  return getProviderMetadata(providerId).label;
}

export function providerCliLabel(providerId: ProviderId) {
  return getProviderMetadata(providerId).cliLabel;
}

export function providerCliCommands(providerId: ProviderId) {
  return getProviderMetadata(providerId).cliCommands;
}

export function providerCliExecutableName(providerId: ProviderId) {
  return providerCliCommands(providerId)[0] ?? providerDisplayName(providerId).toLowerCase();
}

export function providerCliAuthLaunch(providerId: ProviderId) {
  const metadata = getProviderMetadata(providerId);
  return {
    title: metadata.authLaunchTitle,
    args: metadata.authLaunchArgs
  };
}

export function providerCliLogoutLaunch(providerId: ProviderId) {
  const metadata = getProviderMetadata(providerId);
  return {
    title: metadata.logoutLaunchTitle ?? null,
    args: metadata.logoutLaunchArgs ?? []
  };
}

export function providerAuthBrand(providerId: ProviderId) {
  return getProviderMetadata(providerId).authBrand;
}

export function providerCapabilities(providerId: ProviderId) {
  return getProviderMetadata(providerId).capabilities;
}

export function providerPermissionOptionDisabled(providerId: ProviderId, executionPermission: ExecutionPermission) {
  return executionPermission === 'default' && providerCapabilities(providerId).requiresFullAccessForAppRuns;
}

export function providerPermissionBoundaryNote(providerId: ProviderId, executionPermission: ExecutionPermission) {
  const capabilities = providerCapabilities(providerId);
  const label = providerDisplayName(providerId);

  if (capabilities.requiresFullAccessForAppRuns && executionPermission !== 'full_access') {
    return `${label} currently requires Full access for app-driven runs. This lane does not expose an app approval pause or a separate sandbox guarantee in Vicode.`;
  }

  if (capabilities.approvalAuthority === 'app') {
    return executionPermission === 'default'
      ? 'Vicode owns approvals in this lane. Default keeps the runtime on trusted-workspace file tools only.'
      : 'Vicode owns approvals in this lane. Full access can unlock host-local commands under the workspace runtime policy.';
  }

  if (capabilities.approvalAuthority === 'provider_cli') {
    return `${label} owns approval and sandbox behavior for this lane. Widening access here does not make Vicode's app approval queue authoritative.`;
  }

  if (capabilities.sandboxAuthority === 'none') {
    return `${label} runs without an app approval pause or a separate sandbox guarantee in this lane.`;
  }

  return `${label} does not expose an app approval pause in this lane. The provider runtime still owns the execution boundary.`;
}

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

export function providerRecommendedRouteSummary(
  providerId: ProviderId,
  options?: { hosted?: boolean }
) {
  if (providerId === 'openai') {
    return 'Default: GPT-5.4.';
  }

  if (providerId === 'gemini') {
    return 'Default: Auto Gemini 2.5.';
  }

  if (providerId === 'ollama') {
    return options?.hosted
      ? 'Cloud default: Qwen 3 Coder.'
      : 'Local default: Qwen 3 Coder.';
  }

  if (providerId === 'qwen') {
    return 'Default: Qwen 3.5 Plus.';
  }

  return 'Default: Kimi K2 Thinking.';
}

export function providerSetupMenuSummary(
  provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authState' | 'authMode'>
) {
  if (!providerCanRunInComposer(provider)) {
    return provider.id === 'ollama' ? 'Set up Ollama' : `Install ${providerCliLabel(provider.id)}`;
  }

  if (provider.authState === 'checking') {
    return provider.id === 'ollama' ? 'Starting local runtime' : 'Finishing sign-in';
  }

  if (provider.authState === 'detected') {
    return provider.id === 'ollama' && !providerUsesHostedApi(provider) ? 'Start local runtime' : 'Finish setup';
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
  if (!providerCanRunInComposer(provider)) {
    return provider.id === 'ollama'
      ? 'Use cloud models with an Ollama API key, or install Ollama for local models.'
      : `Install ${providerCliLabel(provider.id)} and finish setup in Settings > Providers.`;
  }

  if (provider.authState === 'checking') {
    return provider.id === 'ollama'
      ? 'Local Ollama is starting. Try again in a moment.'
      : `${providerDisplayName(provider.id)} sign-in is finishing. Try again in a moment.`;
  }

  if (provider.authState === 'detected') {
    return provider.id === 'ollama' && !providerUsesHostedApi(provider)
      ? 'Local Ollama is installed but not running yet. Start it in Settings > Providers.'
      : 'A machine-local sign-in was found. Finish setup explicitly in Settings > Providers.';
  }

  if (provider.authState === 'disconnected' || provider.authState === 'missing_cli') {
    return provider.id === 'ollama'
      ? providerUsesHostedApi(provider)
        ? 'Add your Ollama API key in Settings > Providers.'
        : 'Start local Ollama in Settings > Providers.'
      : `Finish ${providerDisplayName(provider.id)} setup in Settings > Providers.`;
  }

  return 'No models are loaded yet. Refresh to try again.';
}

export function providerBlockedRunMessage(
  provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authState' | 'authMode'>
) {
  if (provider.authState === 'checking') {
    return providerSetupGuidance(provider);
  }

  if (provider.authState === 'detected') {
    return providerSetupGuidance(provider);
  }

  if (provider.authState === 'disconnected' || provider.authState === 'missing_cli') {
    return provider.id === 'ollama'
      ? 'Finish Ollama setup in Settings > Providers before sending.'
      : `Finish ${providerDisplayName(provider.id)} setup in Settings > Providers before sending.`;
  }

  return providerSetupGuidance(provider);
}

export function providerUsesHostedApi(provider: Pick<ProviderDescriptor, 'id' | 'authMode'>) {
  return provider.id === 'ollama' && provider.authMode === 'api_key';
}

export function providerSettingsAuthTitle(provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authState' | 'authMode'>) {
  if (provider.id === 'ollama') {
    if (providerUsesHostedApi(provider) && provider.authState === 'connected') {
      return 'Cloud models are ready';
    }
    if (!provider.installed) {
      return 'Choose cloud or local Ollama';
    }
    if (provider.authState === 'checking') {
      return 'Starting local Ollama';
    }
    if (provider.authState === 'connected') {
      return 'Local Ollama is ready';
    }
    if (provider.authState === 'detected') {
      return 'Local Ollama is installed';
    }
    return 'Start local Ollama';
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
    return `${providerDisplayName(provider.id)} is ready`;
  }
  if (provider.authState === 'detected') {
    return 'Local sign-in found';
  }
  return 'Sign in to continue';
}

export function providerSettingsAuthDescription(provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authState' | 'authMode' | 'message'>) {
  if (provider.id === 'ollama') {
    if (providerUsesHostedApi(provider) && provider.authState === 'connected') {
      return provider.message ?? 'Use cloud Ollama models in Vicode. Install Ollama only if you want local models.';
    }
    if (!provider.installed) {
      return provider.message ?? 'Use cloud Ollama with an API key, or install Ollama if you want local models.';
    }
    if (provider.authState === 'checking') {
      return 'Starting local Ollama.';
    }
    return provider.message ?? 'Use local Ollama models here, or add an API key if you also want cloud models.';
  }

  if (!provider.installed) {
    return provider.message ??
      (provider.id === 'openai'
        ? 'Install Codex CLI and sign in to use OpenAI models in Vicode.'
        : provider.id === 'gemini'
          ? 'Install Gemini CLI and sign in to use Gemini models in Vicode.'
          : `Install ${providerCliLabel(provider.id)} on this PC, then sign in here.`);
  }
  if (provider.authState === 'checking') {
    return 'Vicode is finishing sign-in.';
  }
  if (provider.authState === 'detected') {
    return (
      provider.message ??
      'Vicode found a machine-local sign-in. Nothing is imported automatically. Use it explicitly here or open the official CLI sign-in flow again.'
    );
  }
  if (provider.authMode === 'cli' && provider.authState === 'connected') {
    return `${providerDisplayName(provider.id)} is ready in Vicode.`;
  }
  if (provider.authMode === 'api_key' && provider.authState === 'connected') {
    return 'Your saved API key is ready in Vicode.';
  }
  if (provider.authState === 'disconnected' && provider.authMode === 'cli') {
    return provider.message ?? 'This provider is disconnected in Vicode, but a machine-local sign-in is still available.';
  }
  return provider.message ?? (provider.id === 'qwen'
    ? 'Sign in with Qwen first. API keys are not supported here yet.'
    : 'Sign in first. Use a saved API key only if you need it.');
}

export function providerSettingsPillLabel(provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authState' | 'authMode'>) {
  if (provider.id === 'ollama') {
    if (providerUsesHostedApi(provider) && provider.authState === 'connected') {
      return 'Cloud ready';
    }
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
  if (provider.id === 'ollama') {
    if (providerUsesHostedApi(provider)) {
      return 'Cloud ready';
    }
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
  if (provider.id === 'ollama') {
    return providerUsesHostedApi(provider) ? 'Open local setup' : 'Install Ollama';
  }
  return `Install ${providerCliLabel(provider.id)}`;
}

export function providerSettingsInstallLabel(
  provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authMode'>,
  ollamaRuntimeStatus: ProviderOllamaRuntimeLike | null
) {
  if (provider.id === 'ollama') {
    const localInstalled = ollamaRuntimeStatus?.installed ?? provider.installed;
    if (providerUsesHostedApi(provider)) {
      return localInstalled ? 'Cloud + local' : 'Cloud only';
    }
    return localInstalled ? 'Local install found' : 'Local install optional';
  }
  return provider.installed ? 'Installed' : 'Install required';
}

export function providerSettingsStatusSummary(
  provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authState' | 'authMode' | 'models'>,
  ollamaRuntimeStatus: ProviderOllamaRuntimeLike | null
) {
  if (provider.id === 'ollama') {
    if (providerUsesHostedApi(provider)) {
      return provider.models.length > 0
        ? `${provider.models.length} cloud model${provider.models.length === 1 ? '' : 's'} available`
        : 'Cloud models are connected, but no models were loaded yet';
    }
    if (!provider.installed) {
      return 'You can use cloud models with an API key right away. Install Ollama only if you want local models.';
    }
    if (ollamaRuntimeStatus?.managedByApp) {
      if (ollamaRuntimeStatus.reachable) {
        return provider.models.length > 0
          ? `${provider.models.length} local model${provider.models.length === 1 ? '' : 's'} ready in local Ollama`
          : 'Local Ollama is running, but no local models were found yet';
      }
      if (ollamaRuntimeStatus.starting) {
        return 'Starting local Ollama...';
      }
    }
    if (ollamaRuntimeStatus?.reachable) {
      return provider.models.length > 0
        ? `${provider.models.length} local model${provider.models.length === 1 ? '' : 's'} available`
        : 'Local Ollama is reachable, but no local models were found yet';
    }
    if (provider.authState === 'connected') {
      return provider.models.length > 0
        ? `${provider.models.length} local model${provider.models.length === 1 ? '' : 's'} available`
        : 'Local Ollama is reachable, but no local models were found yet';
    }
    if (provider.authState === 'checking') {
      return 'Starting local Ollama...';
    }
    if (provider.authState === 'detected') {
      return 'Local Ollama is installed, but not running yet';
    }
    return 'Local Ollama status unavailable';
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
    return `${providerDisplayName(provider.id)} is ready to use.`;
  }
  if (provider.authState === 'detected') {
    return 'A machine-local sign-in is available. Use it explicitly here before new runs can start.';
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
  if (providerUsesHostedApi(provider) && provider.authState === 'connected') {
    return 'Cloud models are active. You can use Ollama now without installing anything locally.';
  }
  if (provider.installed && (provider.authState === 'connected' || ollamaRuntimeStatus?.reachable)) {
    return 'Local Ollama is ready. Use local models here, or add a cloud API key if you also want cloud models.';
  }
  if (provider.installed) {
    return 'Ollama is installed, but not running yet. Start it here when you want local models.';
  }
  return 'You do not need to install Ollama for cloud models. Save an API key below, or install Ollama only if you want local models.';
}

export function providerCanRunInComposer(
  provider: Pick<ProviderDescriptor, 'id' | 'installed' | 'authMode'>
) {
  return provider.installed || providerUsesHostedApi(provider);
}

export function selectPreferredOllamaModel<T extends { id: string }>(models: readonly T[]) {
  return (
    models.find((entry) => /coder/i.test(entry.id)) ??
    models.find((entry) => /deepseek/i.test(entry.id)) ??
    models.find((entry) => /qwen/i.test(entry.id)) ??
    models.find((entry) => /llama/i.test(entry.id)) ??
    models[0]
  );
}

export function selectPreferredOllamaVisionModel<T extends { id: string; supportsVision?: boolean }>(
  models: readonly T[]
) {
  const visionModels = models.filter((model) => model.supportsVision);
  if (visionModels.length === 0) {
    return null;
  }

  return (
    visionModels.find((entry) => /qwen.*(?:vl|vision)/i.test(entry.id)) ??
    visionModels.find((entry) => /gemma3/i.test(entry.id)) ??
    visionModels.find((entry) => /llava|bakllava/i.test(entry.id)) ??
    visionModels.find((entry) => /minicpm-v|moondream|mllama/i.test(entry.id)) ??
    visionModels[0]
  );
}

export function selectPreferredOllamaValidationModels<T extends { id: string }>(models: readonly T[]) {
  const primary = selectPreferredOllamaModel(models);
  if (!primary) {
    return [];
  }

  const alternate =
    models.find((entry) => entry.id !== primary.id && /qwen|llama/i.test(entry.id)) ??
    models.find((entry) => entry.id !== primary.id && /deepseek|coder/i.test(entry.id)) ??
    models.find((entry) => entry.id !== primary.id) ??
    null;

  return alternate ? [primary, alternate] : [primary];
}

function parseModelSizeBillions(modelId: string) {
  const match = modelId.match(/(?:^|[:\-])(\d+(?:\.\d+)?)b(?:$|[^a-z])/i) ?? modelId.match(/\b(\d+(?:\.\d+)?)b\b/i);
  return match ? Number.parseFloat(match[1]) : Number.POSITIVE_INFINITY;
}

function selectByIdPattern<T extends { id: string }>(models: readonly T[], pattern: RegExp) {
  return models.find((model) => pattern.test(model.id)) ?? null;
}

function selectByRecommendation<T extends { recommendation?: ProviderModelRecommendation }>(
  models: readonly T[],
  recommendation: ProviderModelRecommendation
) {
  return models.find((model) => model.recommendation === recommendation) ?? null;
}

export function selectPreferredSubagentModel<T extends Pick<ProviderModel, 'id' | 'recommendation'>>(
  providerId: ProviderId,
  models: readonly T[]
) {
  if (models.length === 0) {
    return null;
  }

  if (providerId === 'openai') {
    return (
      selectByIdPattern(models, /^gpt-5(?:\.\d+)?-mini$/i) ??
      selectByRecommendation(models, 'fast') ??
      selectByIdPattern(models, /\bmini\b/i) ??
      selectByRecommendation(models, 'recommended') ??
      models[0]
    );
  }

  if (providerId === 'gemini') {
    return (
      selectByRecommendation(models, 'fast') ??
      selectByIdPattern(models, /flash-lite/i) ??
      selectByIdPattern(models, /\bflash\b/i) ??
      selectByRecommendation(models, 'recommended') ??
      models[0]
    );
  }

  if (providerId === 'ollama') {
    const preferredPool = models.filter((model) => /coder|qwen|deepseek|llama/i.test(model.id));
    const ranked = (preferredPool.length > 0 ? preferredPool : models).slice().sort((left, right) => {
      const leftCategory = /coder|qwen/i.test(left.id) ? 0 : /deepseek/i.test(left.id) ? 1 : /llama/i.test(left.id) ? 2 : 3;
      const rightCategory = /coder|qwen/i.test(right.id) ? 0 : /deepseek/i.test(right.id) ? 1 : /llama/i.test(right.id) ? 2 : 3;
      if (leftCategory !== rightCategory) {
        return leftCategory - rightCategory;
      }

      const leftSize = parseModelSizeBillions(left.id);
      const rightSize = parseModelSizeBillions(right.id);
      if (leftSize !== rightSize) {
        return leftSize - rightSize;
      }

      return left.id.localeCompare(right.id, undefined, { sensitivity: 'base' });
    });

    return selectByRecommendation(models, 'fast') ?? ranked[0] ?? selectPreferredOllamaModel(models) ?? models[0];
  }

  if (providerId === 'qwen') {
    return (
      selectByRecommendation(models, 'fast') ??
      selectByIdPattern(models, /turbo|lite|mini/i) ??
      selectByRecommendation(models, 'recommended') ??
      models[0]
    );
  }

  return (
    selectByRecommendation(models, 'fast') ??
    selectByIdPattern(models, /lite|mini|fast/i) ??
    selectByRecommendation(models, 'recommended') ??
    models[0]
  );
}

export function providerSubagentConcurrencyLimit(providerId: ProviderId) {
  switch (providerId) {
    case 'openai':
    case 'gemini':
      return 4;
    case 'qwen':
    case 'kimi':
      return 3;
    case 'ollama':
      return 2;
    default:
      return 3;
  }
}
