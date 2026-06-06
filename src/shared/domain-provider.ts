export const PROVIDER_IDS = ['openai', 'gemini', 'qwen', 'ollama', 'kimi', 'openai_compatible'] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ProviderAuthMode = 'cli' | 'api_key';

export type ProviderAuthState = 'connected' | 'disconnected' | 'detected' | 'checking' | 'missing_cli';

export type ProviderModelSource = 'runtime' | 'api' | 'cache' | 'fallback';

export type ProviderModelRecommendation = 'recommended' | 'fast' | 'preview';

export type ContextWindowSource = 'configured' | 'official' | 'runtime' | 'heuristic';

export type ProviderExecutionMode = 'read-only' | 'workspace-write' | 'full-access';

export type PlannerEnforcement = 'hard-enforced' | 'best-effort';

export type ProviderExecutionAuthority = 'provider_cli' | 'app_runtime';

export type ProviderApprovalAuthority = 'app' | 'provider_cli' | 'none';

export type ProviderSandboxAuthority = 'provider_cli' | 'app_runtime' | 'none';

export type OllamaTransportMode = 'chat' | 'responses';

export type ProviderReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ProviderPlannerPolicy {
  supported: boolean;
  executionMode: ProviderExecutionMode;
  enforcement: PlannerEnforcement;
  message?: string;
}

export interface ProviderCapabilities {
  supportsThinkingToggle: boolean;
  supportsRuntimeSkillResources: boolean;
  supportsNativeRunProgress: boolean;
  executionAuthority: ProviderExecutionAuthority;
  approvalAuthority: ProviderApprovalAuthority;
  sandboxAuthority: ProviderSandboxAuthority;
  requiresTrustedWorkspace: boolean;
  requiresFullAccessForAppRuns: boolean;
  workspaceInstructionFileName: string;
}

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  authState: ProviderAuthState;
  authMode: ProviderAuthMode | null;
  installed: boolean;
  models: ProviderModel[];
  modelSource: ProviderModelSource;
  modelsUpdatedAt: string | null;
  canLiveDiscoverModels: boolean;
  cliPath: string | null;
  capabilities: ProviderCapabilities;
  plannerPolicy: ProviderPlannerPolicy;
  message?: string;
}

export interface ProviderModel {
  id: string;
  label: string;
  description: string;
  supportsVision?: boolean;
  recommendation?: ProviderModelRecommendation;
  contextWindowTokens?: number | null;
  autoCompactTokenLimit?: number | null;
  contextWindowSource?: ContextWindowSource;
}

export type CustomProviderTransportKind = 'openai_compatible_chat';

export interface CustomProviderDefinition {
  id: string;
  name: string;
  transportKind: CustomProviderTransportKind;
  baseUrl: string;
  encryptedApiKey: string;
  defaultModelId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomProviderSaveInput {
  id?: string;
  name: string;
  transportKind: CustomProviderTransportKind;
  baseUrl: string;
  encryptedApiKey: string;
  defaultModelId: string;
  enabled: boolean;
}

export interface CustomProviderSettings {
  id: string;
  name: string;
  transportKind: CustomProviderTransportKind;
  baseUrl: string;
  defaultModelId: string;
  enabled: boolean;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomProviderSettingsSaveInput {
  id?: string;
  name: string;
  transportKind: CustomProviderTransportKind;
  baseUrl: string;
  apiKey: string;
  defaultModelId: string;
  enabled: boolean;
}

export interface ProviderAccount {
  providerId: ProviderId;
  authState: ProviderAuthState;
  authMode: ProviderAuthMode | null;
  encryptedApiKey: string | null;
  updatedAt: string;
}

export interface ProviderContextWindowUsage {
  usedTokens: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  providerEventType?: string | null;
}
