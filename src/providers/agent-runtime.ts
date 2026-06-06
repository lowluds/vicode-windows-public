import type {
  AgentExecutionConstraints,
  ExecutionPermission,
  McpToolDescriptor,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy,
  RunActivityInfo,
  RunToolApprovalRequestInput,
  RunToolApprovalDecision
} from '../shared/domain';
import type { HarnessIsolationMode } from '../shared/harness-task-contract';

export interface AgentToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export type AgentToolApprovalRequest = Omit<RunToolApprovalRequestInput, 'threadId' | 'runId' | 'providerId'>;

export interface AgentToolExecutionContext {
  workspaceRoot: string;
  threadId?: string;
  runId?: string;
  isolationMode?: HarnessIsolationMode;
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

export type StagedWorkspaceSourceToolName = 'mkdir' | 'write_file' | 'apply_patch';
export type StagedWorkspaceOperationKind = 'mkdir' | 'write_file' | 'apply_patch' | 'delete';

export interface StagedWorkspaceOperation {
  operation: StagedWorkspaceOperationKind;
  path: string;
  beforeContent: string | null;
  proposedAfterContent: string | null;
  patchText: string | null;
}

export interface StagedWorkspaceChangeSet {
  threadId: string | null;
  runId: string | null;
  sourceToolName: StagedWorkspaceSourceToolName;
  isolationMode: 'patch_buffer';
  status: 'proposed';
  requestedPath: string | null;
  changedPaths: string[];
  operations: StagedWorkspaceOperation[];
  summary: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

export interface AgentToolExecutionResult {
  toolName: string;
  content: string;
  isError?: boolean;
  stagedWorkspaceChangeSet?: StagedWorkspaceChangeSet | null;
}

export type AgentRuntimeToolOrigin = 'native' | 'mcp';
export type AgentRuntimeToolContentTrust = 'trusted' | 'untrusted_content';
export type AgentRuntimeToolVisibilityGroup =
  | 'workspace_read'
  | 'workspace_write'
  | 'web_research'
  | 'browser_preview'
  | 'host_command'
  | 'delegate'
  | 'knowledge'
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
  enableDelegationTools?: boolean;
  enableCreatorTools?: boolean;
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
