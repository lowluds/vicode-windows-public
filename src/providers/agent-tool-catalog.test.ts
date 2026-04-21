import { describe, expect, it } from 'vitest';
import {
  buildAgentRuntimeProviderToolDefinitions,
  buildAgentRuntimeToolCatalog
} from './agent-tool-catalog';

describe('buildAgentRuntimeToolCatalog', () => {
  it('filters deny-mode MCP tools before exposing the merged catalog', () => {
    const catalog = buildAgentRuntimeToolCatalog({
      executionPermission: 'workspace_write',
      nativeWebResearchEnabled: false,
      mcpTools: [
        {
          serverId: 'zeta-mcp',
          serverName: 'Zeta MCP',
          name: 'echo',
          title: null,
          description: 'Echo values.',
          inputSchema: null,
          invocationMode: 'allow',
          requiresApproval: false
        },
        {
          serverId: 'alpha-mcp',
          serverName: 'Alpha MCP',
          name: 'hidden',
          title: null,
          description: 'Should be filtered.',
          inputSchema: null,
          invocationMode: 'deny',
          requiresApproval: false
        },
        {
          serverId: 'zeta-mcp',
          serverName: 'Zeta MCP',
          name: 'echo',
          title: null,
          description: 'Duplicate echo values.',
          inputSchema: null,
          invocationMode: 'allow',
          requiresApproval: false
        }
      ]
    });

    expect(catalog.mcpTools.map((tool) => tool.name)).toEqual([
      'zeta-mcp / echo'
    ]);
    expect(catalog.tools.at(-1)).toEqual(
      expect.objectContaining({
        id: 'mcp:zeta-mcp:echo',
        callName: 'use_mcp_tool',
        origin: 'mcp',
        visibilityGroup: 'mcp',
        concurrencySafe: null,
        renderHint: 'mcp',
        reviewHint: 'mcp',
        orchestrationHint: 'delegate'
      })
    );
  });

  it('keeps app-owned web research tools available when host-network shell access is disabled', () => {
    const catalog = buildAgentRuntimeToolCatalog({
      executionPermission: 'workspace_write',
      runtimeNetworkPolicy: 'disabled',
      nativeWebResearchEnabled: true,
      mcpTools: []
    });

    expect(catalog.nativeWebResearchEnabled).toBe(true);
    expect(
      catalog.nativeTools.some((tool) => tool.callName === 'web_search')
    ).toBe(true);
    expect(
      catalog.nativeTools.some((tool) => tool.callName === 'research_topic')
    ).toBe(true);
    expect(
      catalog.nativeTools.find((tool) => tool.callName === 'web_search')
    ).toEqual(
      expect.objectContaining({
        visibilityGroup: 'web_research',
        concurrencySafe: true,
        renderHint: 'web',
        reviewHint: 'external_research',
        orchestrationHint: 'research',
        mutatesWorkspace: false,
        readsWorkspace: false,
        usesNetwork: true
      })
    );
  });

  it('describes run_command as a serial host command with approval-aware policy metadata', () => {
    const catalog = buildAgentRuntimeToolCatalog({
      executionPermission: 'full_access',
      runtimeCommandPolicy: 'approval_required',
      runtimeNetworkPolicy: 'enabled',
      nativeWebResearchEnabled: false,
      mcpTools: []
    });

    expect(
      catalog.nativeTools.find((tool) => tool.callName === 'run_command')
    ).toEqual(
      expect.objectContaining({
        visibilityGroup: 'host_command',
        concurrencySafe: false,
        renderHint: 'shell',
        reviewHint: 'host_execution',
        orchestrationHint: 'execute',
        mutatesWorkspace: true,
        readsWorkspace: true,
        usesNetwork: true,
        requiresApproval: true
      })
    );
  });

  it('describes spawn_subagents as a delegated native tool', () => {
    const catalog = buildAgentRuntimeToolCatalog({
      executionPermission: 'workspace_write',
      delegationEnabled: true,
      nativeWebResearchEnabled: false,
      mcpTools: []
    });

    expect(
      catalog.nativeTools.find((tool) => tool.callName === 'spawn_subagents')
    ).toEqual(
      expect.objectContaining({
        visibilityGroup: 'delegate',
        concurrencySafe: false,
        renderHint: 'delegate',
        reviewHint: 'none',
        orchestrationHint: 'delegate',
        mutatesWorkspace: false,
        readsWorkspace: false,
        usesNetwork: false,
        requiresApproval: false
      })
    );
  });

  it('builds provider tool definitions from the canonical catalog without a second native registry', () => {
    const catalog = buildAgentRuntimeToolCatalog({
      executionPermission: 'workspace_write',
      nativeWebResearchEnabled: true,
      mcpTools: [
        {
          serverId: 'alpha-mcp',
          serverName: 'Alpha MCP',
          name: 'echo',
          title: null,
          description: 'Echo values.',
          inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
          invocationMode: 'allow',
          requiresApproval: false
        }
      ]
    });

    const definitions = buildAgentRuntimeProviderToolDefinitions(catalog);

    expect(definitions.find((definition) => definition.function.name === 'read_file')).toEqual(
      expect.objectContaining({
        function: expect.objectContaining({
          name: 'read_file',
          description: 'Read one text file inside the trusted workspace.',
          parameters: expect.objectContaining({
            type: 'object'
          })
        })
      })
    );
    expect(definitions.at(-1)).toEqual(
      expect.objectContaining({
        function: expect.objectContaining({
          name: 'use_mcp_tool'
        })
      })
    );
  });

  it('filters the catalog through the planner preset before exposing tools to the model', () => {
    const catalog = buildAgentRuntimeToolCatalog({
      executionPermission: 'full_access',
      executionConstraints: {
        permissionMode: 'plan',
        toolPolicy: {
          preset: 'planner',
          allowedToolCallNames: [],
          disallowedToolCallNames: []
        },
        maxTurns: 6,
        maxReasoningTokens: null,
        taskBudgetTokens: null,
        costBudgetUsd: null,
        maxDelegationDepth: 1,
        maxAutomaticRetries: 0,
        maxUnchangedHandoffs: 1,
        maxSiblingDelegates: 1
      },
      nativeWebResearchEnabled: true,
      mcpTools: []
    });

    expect(catalog.tools.some((tool) => tool.callName === 'read_file')).toBe(true);
    expect(catalog.tools.some((tool) => tool.callName === 'web_search')).toBe(true);
    expect(catalog.tools.some((tool) => tool.callName === 'write_file')).toBe(false);
    expect(catalog.tools.some((tool) => tool.callName === 'run_command')).toBe(false);
    expect(catalog.tools.some((tool) => tool.callName === 'spawn_subagents')).toBe(false);
  });

  it('allows build-control planner lanes to reach control-friendly command and write tools', () => {
    const catalog = buildAgentRuntimeToolCatalog({
      executionPermission: 'full_access',
      delegationEnabled: true,
      executionConstraints: {
        permissionMode: 'plan',
        toolPolicy: {
          preset: 'build_planner',
          allowedToolCallNames: [],
          disallowedToolCallNames: ['apply_patch']
        },
        maxTurns: 6,
        maxReasoningTokens: null,
        taskBudgetTokens: null,
        costBudgetUsd: null,
        maxDelegationDepth: 1,
        maxAutomaticRetries: 0,
        maxUnchangedHandoffs: 1,
        maxSiblingDelegates: 1
      },
      nativeWebResearchEnabled: true,
      mcpTools: []
    });

    expect(catalog.tools.some((tool) => tool.callName === 'read_file')).toBe(true);
    expect(catalog.tools.some((tool) => tool.callName === 'web_search')).toBe(true);
    expect(catalog.tools.some((tool) => tool.callName === 'run_command')).toBe(true);
    expect(catalog.tools.some((tool) => tool.callName === 'write_file')).toBe(true);
    expect(catalog.tools.some((tool) => tool.callName === 'apply_patch')).toBe(false);
    expect(catalog.tools.some((tool) => tool.callName === 'spawn_subagents')).toBe(true);
  });

  it('keeps the delegation tool out of delegated helper presets', () => {
    const catalog = buildAgentRuntimeToolCatalog({
      executionPermission: 'full_access',
      executionConstraints: {
        permissionMode: 'default',
        toolPolicy: {
          preset: 'subagent',
          allowedToolCallNames: [],
          disallowedToolCallNames: []
        },
        maxTurns: 12,
        maxReasoningTokens: null,
        taskBudgetTokens: null,
        costBudgetUsd: null,
        maxDelegationDepth: 0,
        maxAutomaticRetries: 0,
        maxUnchangedHandoffs: 1,
        maxSiblingDelegates: 0
      },
      nativeWebResearchEnabled: true,
      mcpTools: []
    });

    expect(catalog.tools.some((tool) => tool.callName === 'spawn_subagents')).toBe(false);
    expect(catalog.tools.some((tool) => tool.callName === 'read_file')).toBe(true);
    expect(catalog.tools.some((tool) => tool.callName === 'write_file')).toBe(false);
  });

  it('honors explicit allow and deny rules on top of the selected tool preset', () => {
    const catalog = buildAgentRuntimeToolCatalog({
      executionPermission: 'full_access',
      executionConstraints: {
        permissionMode: 'default',
        toolPolicy: {
          preset: 'builder',
          allowedToolCallNames: ['read_file', 'search_text', 'run_command'],
          disallowedToolCallNames: ['run_command']
        },
        maxTurns: 10,
        maxReasoningTokens: null,
        taskBudgetTokens: null,
        costBudgetUsd: null,
        maxDelegationDepth: 0,
        maxAutomaticRetries: 1,
        maxUnchangedHandoffs: 1,
        maxSiblingDelegates: 0
      },
      nativeWebResearchEnabled: true,
      mcpTools: []
    });

    expect(catalog.tools.map((tool) => tool.callName)).toEqual([
      'read_file',
      'search_text'
    ]);
  });
});
