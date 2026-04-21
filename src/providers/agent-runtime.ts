import type {
  AgentExecutionConstraints,
  ExecutionPermission,
  McpToolDescriptor,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy,
  RunActivityInfo,
  RunToolApprovalDecision
} from '../shared/domain';

export interface AgentToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentToolApprovalRequest {
  toolName: string;
  command: string;
  cwd: string | null;
  workspaceRoot: string;
}

export interface AgentToolExecutionContext {
  workspaceRoot: string;
  threadId?: string;
  runId?: string;
  trustedWorkspace?: boolean;
  executionPermission: ExecutionPermission;
  executionConstraints?: AgentExecutionConstraints | null;
  runtimeCommandPolicy?: ProjectRuntimeCommandPolicy;
  runtimeNetworkPolicy?: ProjectRuntimeNetworkPolicy;
  signal?: AbortSignal;
  onInfo?: (payload: {
    message?: string | null;
    activity?: RunActivityInfo | null;
  }) => void;
  requestApproval?: (request: AgentToolApprovalRequest) => Promise<RunToolApprovalDecision>;
}

export interface AgentToolExecutionResult {
  toolName: string;
  content: string;
  isError?: boolean;
}

export type AgentRuntimeToolOrigin = 'native' | 'mcp';
export type AgentRuntimeToolContentTrust = 'trusted' | 'untrusted_content';
export type AgentRuntimeToolVisibilityGroup =
  | 'workspace_read'
  | 'workspace_write'
  | 'web_research'
  | 'host_command'
  | 'delegate'
  | 'mcp';
export type AgentRuntimeToolRenderHint = 'workspace' | 'shell' | 'web' | 'delegate' | 'mcp';
export type AgentRuntimeToolReviewHint =
  | 'none'
  | 'workspace_mutation'
  | 'host_execution'
  | 'external_research'
  | 'mcp';
export type AgentRuntimeToolOrchestrationHint = 'inspect' | 'modify' | 'research' | 'execute' | 'delegate';

export interface AgentRuntimeToolDescriptor {
  id: string;
  name: string;
  callName: string;
  description: string | null;
  inputJsonSchema: Record<string, unknown> | null;
  origin: AgentRuntimeToolOrigin;
  executionAuthority: 'app_runtime';
  requiresApproval: boolean | null;
  concurrencySafe: boolean | null;
  visibilityGroup: AgentRuntimeToolVisibilityGroup;
  renderHint: AgentRuntimeToolRenderHint;
  reviewHint: AgentRuntimeToolReviewHint;
  orchestrationHint: AgentRuntimeToolOrchestrationHint;
  mutatesWorkspace: boolean | null;
  readsWorkspace: boolean | null;
  usesNetwork: boolean | null;
  contentTrust: AgentRuntimeToolContentTrust;
  serverId: string | null;
  serverName: string | null;
  mcpToolName: string | null;
}

export interface AgentRuntimeToolCatalogContext {
  executionPermission: ExecutionPermission;
  trustedWorkspace?: boolean;
  executionConstraints?: AgentExecutionConstraints | null;
  runtimeCommandPolicy?: ProjectRuntimeCommandPolicy;
  runtimeNetworkPolicy?: ProjectRuntimeNetworkPolicy;
}

export interface AgentRuntimeToolCatalog {
  nativeWebResearchEnabled: boolean;
  nativeTools: AgentRuntimeToolDescriptor[];
  mcpTools: AgentRuntimeToolDescriptor[];
  tools: AgentRuntimeToolDescriptor[];
}

export interface AgentRuntime {
  executeToolCall(call: AgentToolCall, context: AgentToolExecutionContext): Promise<AgentToolExecutionResult>;
  listToolCatalog?(context: AgentRuntimeToolCatalogContext): Promise<AgentRuntimeToolCatalog>;
  listAvailableMcpTools?(): Promise<McpToolDescriptor[]>;
  hasNativeWebResearch?(): Promise<boolean> | boolean;
}
