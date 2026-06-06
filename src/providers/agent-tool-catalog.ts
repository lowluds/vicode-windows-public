import type {
  AgentExecutionConstraints,
  AgentToolPreset,
  ExecutionPermission,
  McpToolDescriptor,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy
} from '../shared/domain';
import {
  evaluateRuntimeCommandAccess,
  evaluateRuntimeNetworkAccess
} from '../shared/runtime-policy';
import {
  isNativeWebResearchToolName,
  NATIVE_AGENT_RUNTIME_TOOL_DEFINITIONS
} from './agent-runtime-native-tools';
import type {
  AgentRuntimeToolCatalog,
  AgentRuntimeToolDescriptor,
  AgentRuntimeToolOrchestrationHint,
  AgentRuntimeToolRenderHint,
  AgentRuntimeToolReviewHint,
  AgentRuntimeToolVisibilityGroup
} from './agent-runtime';

export interface BuildAgentRuntimeToolCatalogInput {
  executionPermission: ExecutionPermission;
  trustedWorkspace?: boolean;
  executionConstraints?: AgentExecutionConstraints | null;
  runtimeCommandPolicy?: ProjectRuntimeCommandPolicy;
  runtimeNetworkPolicy?: ProjectRuntimeNetworkPolicy;
  nativeWebResearchEnabled: boolean;
  projectKnowledgeEnabled?: boolean;
  delegationEnabled?: boolean;
  creatorToolsEnabled?: boolean;
  mcpTools: McpToolDescriptor[];
}

const TOOL_PRESET_VISIBILITY_GROUPS: Record<
  AgentToolPreset,
  ReadonlySet<AgentRuntimeToolVisibilityGroup>
> = {
  default: new Set<AgentRuntimeToolVisibilityGroup>([
    'workspace_read',
    'workspace_write',
    'web_research',
    'browser_preview',
    'host_command',
    'delegate',
    'knowledge',
    'mcp'
  ]),
  planner: new Set<AgentRuntimeToolVisibilityGroup>([
    'workspace_read',
    'web_research',
    'knowledge',
    'mcp'
  ]),
  subagent: new Set<AgentRuntimeToolVisibilityGroup>([
    'workspace_read',
    'web_research',
    'knowledge',
    'mcp'
  ])
};

function compareToolNames(a: AgentRuntimeToolDescriptor, b: AgentRuntimeToolDescriptor) {
  return a.name.localeCompare(b.name);
}

function normalizeToolNameSet(values: string[] | undefined) {
  return new Set(
    (values ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  );
}

function matchesToolCallConstraint(
  tool: AgentRuntimeToolDescriptor,
  names: Set<string>
) {
  return names.has(tool.callName) || names.has(tool.id) || names.has(tool.name);
}

function applyExecutionConstraintFilters(
  tools: AgentRuntimeToolDescriptor[],
  constraints: AgentExecutionConstraints | null | undefined
) {
  if (!constraints) {
    return tools;
  }

  const visibleGroups = TOOL_PRESET_VISIBILITY_GROUPS[constraints.toolPolicy.preset];
  const allowedToolNames = normalizeToolNameSet(
    constraints.toolPolicy.allowedToolCallNames
  );
  const disallowedToolNames = normalizeToolNameSet(
    constraints.toolPolicy.disallowedToolCallNames
  );

  return tools.filter((tool) => {
    if (!visibleGroups.has(tool.visibilityGroup)) {
      return false;
    }
    if (disallowedToolNames.size > 0 && matchesToolCallConstraint(tool, disallowedToolNames)) {
      return false;
    }
    if (allowedToolNames.size > 0) {
      return matchesToolCallConstraint(tool, allowedToolNames);
    }
    return true;
  });
}

function deriveNativeToolHints(visibilityGroup: AgentRuntimeToolVisibilityGroup): {
  renderHint: AgentRuntimeToolRenderHint;
  reviewHint: AgentRuntimeToolReviewHint;
  orchestrationHint: AgentRuntimeToolOrchestrationHint;
} {
  switch (visibilityGroup) {
    case 'workspace_read':
      return {
        renderHint: 'workspace',
        reviewHint: 'none',
        orchestrationHint: 'inspect'
      };
    case 'workspace_write':
      return {
        renderHint: 'workspace',
        reviewHint: 'workspace_mutation',
        orchestrationHint: 'modify'
      };
    case 'web_research':
      return {
        renderHint: 'web',
        reviewHint: 'external_research',
        orchestrationHint: 'research'
      };
    case 'browser_preview':
      return {
        renderHint: 'web',
        reviewHint: 'none',
        orchestrationHint: 'execute'
      };
    case 'host_command':
      return {
        renderHint: 'shell',
        reviewHint: 'host_execution',
        orchestrationHint: 'execute'
      };
    case 'delegate':
      return {
        renderHint: 'delegate',
        reviewHint: 'none',
        orchestrationHint: 'delegate'
      };
    case 'knowledge':
      return {
        renderHint: 'workspace',
        reviewHint: 'none',
        orchestrationHint: 'inspect'
      };
    case 'mcp':
      return {
        renderHint: 'mcp',
        reviewHint: 'mcp',
        orchestrationHint: 'delegate'
      };
  }
}

function createNativeToolDescriptor(
  callName: string,
  description: string,
  inputJsonSchema: Record<string, unknown>,
  requiresApproval: boolean | null,
  metadata: {
    concurrencySafe: boolean;
    visibilityGroup: AgentRuntimeToolVisibilityGroup;
    mutatesWorkspace: boolean;
    readsWorkspace: boolean;
    usesNetwork: boolean;
  }
): AgentRuntimeToolDescriptor {
  const hints = deriveNativeToolHints(metadata.visibilityGroup);
  return {
    id: `native:${callName}`,
    name: callName,
    callName,
    description,
    inputJsonSchema,
    origin: 'native',
    executionAuthority: 'app_runtime',
    requiresApproval,
    concurrencySafe: metadata.concurrencySafe,
    visibilityGroup: metadata.visibilityGroup,
    renderHint: hints.renderHint,
    reviewHint: hints.reviewHint,
    orchestrationHint: hints.orchestrationHint,
    mutatesWorkspace: metadata.mutatesWorkspace,
    readsWorkspace: metadata.readsWorkspace,
    usesNetwork: metadata.usesNetwork,
    contentTrust: metadata.visibilityGroup === 'web_research' || metadata.visibilityGroup === 'browser_preview'
      ? 'untrusted_content'
      : 'trusted',
    serverId: null,
    serverName: null,
    mcpToolName: null
  };
}

function createMcpToolDescriptor(
  tool: McpToolDescriptor,
  trustedWorkspace = false
): AgentRuntimeToolDescriptor {
  return {
    id: `mcp:${tool.serverId}:${tool.name}`,
    name: `${tool.serverId} / ${tool.name}`,
    callName: 'use_mcp_tool',
    description: tool.description,
    inputJsonSchema: tool.inputSchema && typeof tool.inputSchema === 'object'
      ? tool.inputSchema as Record<string, unknown>
      : null,
    origin: 'mcp',
    executionAuthority: 'app_runtime',
    requiresApproval: trustedWorkspace ? false : tool.requiresApproval,
    concurrencySafe: null,
    visibilityGroup: 'mcp',
    renderHint: 'mcp',
    reviewHint: 'mcp',
    orchestrationHint: 'delegate',
    mutatesWorkspace: null,
    readsWorkspace: null,
    usesNetwork: null,
    contentTrust: 'trusted',
    serverId: tool.serverId,
    serverName: tool.serverName,
    mcpToolName: tool.name
  };
}

export function findAgentRuntimeToolDescriptor(
  catalog: AgentRuntimeToolCatalog,
  callName: string
) {
  return catalog.tools.find((tool) => tool.callName === callName) ?? null;
}

export function buildAgentRuntimeProviderToolDefinitions(catalog: AgentRuntimeToolCatalog) {
  const definitions = catalog.nativeTools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.callName,
      description: tool.description ?? '',
      parameters: tool.inputJsonSchema ?? {
        type: 'object',
        properties: {}
      }
    }
  }));

  if (catalog.mcpTools.length > 0) {
    definitions.push({
      type: 'function' as const,
      function: {
        name: 'use_mcp_tool',
        description: 'Call one connected MCP tool through Vicode when a connected MCP capability is directly relevant to the task.',
        parameters: {
          type: 'object',
          properties: {
            server_id: {
              type: 'string',
              description: 'Connected MCP server identifier.'
            },
            tool_name: {
              type: 'string',
              description: 'Connected MCP tool name.'
            },
            arguments: {
              type: 'object',
              description: 'Arguments to pass to the MCP tool.'
            }
          },
          required: ['server_id', 'tool_name']
        }
      }
    });
  }

  return definitions;
}

function dedupeMcpTools(tools: McpToolDescriptor[]) {
  const deduped = new Map<string, McpToolDescriptor>();
  for (const tool of tools) {
    if (tool.invocationMode === 'deny') {
      continue;
    }

    const key = `${tool.serverId}:${tool.name}`;
    if (!deduped.has(key)) {
      deduped.set(key, tool);
    }
  }

  return [...deduped.values()];
}

export function buildAgentRuntimeToolCatalog(
  input: BuildAgentRuntimeToolCatalogInput
): AgentRuntimeToolCatalog {
  const commandAccess = evaluateRuntimeCommandAccess(
    input.executionPermission,
    input.runtimeCommandPolicy ?? 'approval_required',
    input.runtimeNetworkPolicy ?? 'disabled'
  );
  const networkAccess = evaluateRuntimeNetworkAccess(
    input.executionPermission,
    input.runtimeCommandPolicy ?? 'approval_required',
    input.runtimeNetworkPolicy ?? 'disabled'
  );
  const nativeWebResearchEnabled =
    input.nativeWebResearchEnabled && networkAccess.access !== 'disabled';

  const nativeTools = NATIVE_AGENT_RUNTIME_TOOL_DEFINITIONS
    .filter((tool) => {
      if (tool.callName === 'run_command') {
        return commandAccess.access !== 'blocked';
      }

      if (isNativeWebResearchToolName(tool.callName)) {
        return nativeWebResearchEnabled;
      }

      if (tool.visibilityGroup === 'knowledge') {
        return input.projectKnowledgeEnabled === true;
      }

      if (tool.callName === 'spawn_subagents') {
        return input.delegationEnabled === true;
      }
      if (tool.callName === 'create_skill_bundle' || tool.callName === 'create_plugin_bundle') {
        return input.creatorToolsEnabled === true;
      }

      return true;
    })
    .map((tool) =>
      createNativeToolDescriptor(
        tool.callName,
        tool.description,
        tool.inputJsonSchema,
        tool.callName === 'run_command' ? commandAccess.requiresApproval : tool.requiresApproval,
        {
          concurrencySafe: tool.concurrencySafe,
          visibilityGroup: tool.visibilityGroup,
          mutatesWorkspace: tool.mutatesWorkspace,
          readsWorkspace: tool.readsWorkspace,
          usesNetwork: tool.callName === 'run_command'
            ? commandAccess.access !== 'blocked' && networkAccess.access !== 'disabled'
            : tool.usesNetwork
        }
        )
    )
    .sort(compareToolNames);

  const mcpTools = dedupeMcpTools(input.mcpTools)
    .map((tool) => createMcpToolDescriptor(tool, input.trustedWorkspace === true))
    .sort(compareToolNames);

  const filteredNativeTools = applyExecutionConstraintFilters(
    nativeTools,
    input.executionConstraints
  );
  const filteredMcpTools = applyExecutionConstraintFilters(
    mcpTools,
    input.executionConstraints
  );

  return {
    nativeWebResearchEnabled,
    nativeTools: filteredNativeTools,
    mcpTools: filteredMcpTools,
    tools: [...filteredNativeTools, ...filteredMcpTools]
  };
}
