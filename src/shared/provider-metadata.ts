import type { ExecutionPermission } from './domain-thread';
import type { ProviderCapabilities, ProviderId, ProviderReasoningEffort } from './domain-provider';
import { OLLAMA_DEFAULT_LOCAL_MODEL_ID } from './provider-model-selection';

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

export const SURFACED_PROVIDER_IDS = ['ollama', 'openai_compatible'] as const satisfies readonly ProviderId[];
const SURFACED_PROVIDER_ID_SET = new Set<ProviderId>(SURFACED_PROVIDER_IDS);

export const RETIRED_PROVIDER_IDS = ['openai', 'gemini', 'qwen', 'kimi'] as const satisfies readonly ProviderId[];
const RETIRED_PROVIDER_ID_SET = new Set<ProviderId>(RETIRED_PROVIDER_IDS);

export const PROVIDER_METADATA: Record<ProviderId, ProviderMetadata> = {
  openai: {
    label: 'OpenAI',
    cliLabel: 'Retired OpenAI CLI',
    authBrand: 'OpenAI API key',
    cliCommands: [],
    authLaunchTitle: null,
    authLaunchArgs: [],
    defaultModelId: 'gpt-5.5',
    defaultReasoningEffort: 'high',
    defaultThinking: false,
    capabilities: {
      supportsThinkingToggle: false,
      supportsRuntimeSkillResources: true,
      supportsNativeRunProgress: false,
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
    cliLabel: 'Retired Gemini CLI',
    authBrand: 'Google',
    cliCommands: [],
    authLaunchTitle: null,
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
    cliLabel: 'Retired Qwen CLI',
    authBrand: 'Qwen',
    cliCommands: [],
    authLaunchTitle: null,
    authLaunchArgs: [],
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
    defaultModelId: OLLAMA_DEFAULT_LOCAL_MODEL_ID,
    defaultReasoningEffort: null,
    defaultThinking: true,
    capabilities: {
      supportsThinkingToggle: true,
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
    cliLabel: 'Retired Kimi CLI',
    authBrand: 'Kimi',
    cliCommands: [],
    authLaunchTitle: null,
    authLaunchArgs: [],
    logoutLaunchTitle: null,
    logoutLaunchArgs: [],
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
  },
  openai_compatible: {
    label: 'Custom API',
    cliLabel: 'Custom API',
    authBrand: 'Custom API key',
    cliCommands: [],
    authLaunchTitle: null,
    authLaunchArgs: [],
    defaultModelId: 'openai-compatible',
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
      workspaceInstructionFileName: 'custom-api.md'
    }
  }
};

export function isSurfacedProviderId(providerId: ProviderId) {
  return SURFACED_PROVIDER_ID_SET.has(providerId);
}

export function isRetiredProviderId(providerId: ProviderId) {
  return RETIRED_PROVIDER_ID_SET.has(providerId);
}

export function providerRetiredMessage(providerId: ProviderId) {
  const label = providerDisplayName(providerId);
  if (providerId === 'openai') {
    return `${label} CLI has been retired in Vicode. Use Ollama or add OpenAI as an OpenAI-compatible custom API key instead.`;
  }
  if (providerId === 'qwen') {
    return `${label} CLI has been retired in Vicode. Use Qwen models through the normalized Ollama lane instead.`;
  }
  if (providerId === 'gemini') {
    return `${label} CLI has been retired in Vicode. Use Ollama or an OpenAI-compatible custom API key instead.`;
  }
  if (providerId === 'kimi') {
    return `${label} CLI has been retired in Vicode. Use Ollama or an OpenAI-compatible custom API key instead.`;
  }
  return `${label} is not available in this Vicode build.`;
}

export function createProviderRecord<T>(factory: (providerId: ProviderId) => T): Record<ProviderId, T> {
  return Object.fromEntries(Object.keys(PROVIDER_METADATA).map((providerId) => [providerId, factory(providerId as ProviderId)])) as Record<ProviderId, T>;
}

export function getProviderMetadata(providerId: ProviderId) {
  return PROVIDER_METADATA[providerId];
}

export function resolveProviderThinkingDefault(providerId: ProviderId) {
  const metadata = getProviderMetadata(providerId);
  return metadata.capabilities.supportsThinkingToggle ? metadata.defaultThinking : false;
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
  if (isRetiredProviderId(providerId)) {
    return true;
  }
  return executionPermission === 'default' && providerCapabilities(providerId).requiresFullAccessForAppRuns;
}

export function providerPermissionBoundaryNote(providerId: ProviderId, executionPermission: ExecutionPermission) {
  if (isRetiredProviderId(providerId)) {
    return providerRetiredMessage(providerId);
  }

  const capabilities = providerCapabilities(providerId);
  const label = providerDisplayName(providerId);

  if (capabilities.requiresFullAccessForAppRuns && executionPermission !== 'full_access') {
    return `${label} currently requires Full access for app-driven runs. This lane does not expose an app approval pause or a separate sandbox guarantee in Vicode.`;
  }

  if (capabilities.approvalAuthority === 'app') {
    return executionPermission === 'default'
      ? 'Vicode owns approvals in this lane. Default keeps the runtime on workspace file tools only.'
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

export function providerSubagentConcurrencyLimit(providerId: ProviderId) {
  if (isRetiredProviderId(providerId)) {
    return 0;
  }

  switch (providerId) {
    case 'openai':
    case 'gemini':
      return 4;
    case 'qwen':
    case 'kimi':
      return 3;
    case 'ollama':
      return 2;
    case 'openai_compatible':
      return 2;
    default:
      return 3;
  }
}
