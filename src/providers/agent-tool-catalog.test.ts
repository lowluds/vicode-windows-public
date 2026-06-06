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

  it('describes browser_preview_check as a bounded app-owned preview tool', () => {
    const catalog = buildAgentRuntimeToolCatalog({
      executionPermission: 'workspace_write',
      nativeWebResearchEnabled: false,
      mcpTools: []
    });

    expect(
      catalog.nativeTools.find((tool) => tool.callName === 'browser_preview_check')
    ).toEqual(
      expect.objectContaining({
        visibilityGroup: 'browser_preview',
        concurrencySafe: false,
        renderHint: 'web',
        reviewHint: 'none',
        orchestrationHint: 'execute',
        mutatesWorkspace: false,
        readsWorkspace: false,
        usesNetwork: false,
        requiresApproval: false,
        contentTrust: 'untrusted_content'
      })
    );
  });

  it('keeps the default beta catalog focused on core composer tools', () => {
    const catalog = buildAgentRuntimeToolCatalog({
      executionPermission: 'full_access',
      runtimeCommandPolicy: 'approval_required',
      runtimeNetworkPolicy: 'enabled',
      nativeWebResearchEnabled: true,
      mcpTools: []
    });

    expect(catalog.nativeTools.map((tool) => tool.callName)).toEqual([
      'apply_patch',
      'browser_preview_check',
      'crawl_site',
      'extract_web_page',
      'list_directory',
      'map_site',
      'mkdir',
      'read_file',
      'research_topic',
      'run_command',
      'search_text',
      'web_search',
      'write_file'
    ]);
    expect(catalog.nativeTools.some((tool) => tool.callName === 'spawn_subagents')).toBe(false);
    expect(catalog.nativeTools.some((tool) => tool.callName === 'create_skill_bundle')).toBe(false);
    expect(catalog.nativeTools.some((tool) => tool.callName === 'create_plugin_bundle')).toBe(false);
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

  it('describes creator bundle tools as bounded app-owned write tools', () => {
    const catalog = buildAgentRuntimeToolCatalog({
      executionPermission: 'workspace_write',
      nativeWebResearchEnabled: false,
      creatorToolsEnabled: true,
      mcpTools: []
    });

    expect(
      catalog.nativeTools.find((tool) => tool.callName === 'create_skill_bundle')
    ).toEqual(
      expect.objectContaining({
        visibilityGroup: 'workspace_write',
        concurrencySafe: false,
        renderHint: 'workspace',
        reviewHint: 'workspace_mutation',
        orchestrationHint: 'modify',
        mutatesWorkspace: false,
        readsWorkspace: false,
        usesNetwork: false,
        requiresApproval: false
      })
    );
    expect(
      catalog.nativeTools.find((tool) => tool.callName === 'create_plugin_bundle')
    ).toEqual(
      expect.objectContaining({
        visibilityGroup: 'workspace_write',
        mutatesWorkspace: false,
        readsWorkspace: false
      })
    );
  });

  it('exposes Project Knowledge tools only when knowledge is configured', () => {
    const withoutKnowledge = buildAgentRuntimeToolCatalog({
      executionPermission: 'workspace_write',
      nativeWebResearchEnabled: false,
      projectKnowledgeEnabled: false,
      mcpTools: []
    });
    expect(withoutKnowledge.nativeTools.some((tool) => tool.visibilityGroup === 'knowledge')).toBe(false);

    const withKnowledge = buildAgentRuntimeToolCatalog({
      executionPermission: 'workspace_write',
      nativeWebResearchEnabled: false,
      projectKnowledgeEnabled: true,
      mcpTools: []
    });

    expect(withKnowledge.nativeTools.map((tool) => tool.callName)).toEqual(expect.arrayContaining([
      'project_knowledge_search',
      'project_knowledge_read',
      'project_knowledge_list'
    ]));
    expect(withKnowledge.nativeTools.find((tool) => tool.callName === 'project_knowledge_search')).toEqual(
      expect.objectContaining({
        visibilityGroup: 'knowledge',
        concurrencySafe: true,
        renderHint: 'workspace',
        reviewHint: 'none',
        orchestrationHint: 'inspect',
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
          description: 'Read one text file inside the workspace.',
          parameters: expect.objectContaining({
            type: 'object'
          })
        })
      })
    );
    expect(definitions.find((definition) => definition.function.name === 'read_file')?.function.parameters).toEqual(
      expect.objectContaining({
        required: expect.arrayContaining(['path'])
      })
    );
    expect(definitions.find((definition) => definition.function.name === 'write_file')?.function.parameters).toEqual(
      expect.objectContaining({
        required: expect.arrayContaining(['path', 'content'])
      })
    );
    expect(definitions.find((definition) => definition.function.name === 'apply_patch')?.function.parameters).toEqual(
      expect.objectContaining({
        required: expect.arrayContaining(['patch'])
      })
    );
    expect(definitions.find((definition) => definition.function.name === 'browser_preview_check')?.function.parameters).toEqual(
      expect.objectContaining({
        required: expect.arrayContaining(['url'])
      })
    );
    const fullAccessDefinitions = buildAgentRuntimeProviderToolDefinitions(
      buildAgentRuntimeToolCatalog({
        executionPermission: 'full_access',
        runtimeCommandPolicy: 'auto_approve',
        nativeWebResearchEnabled: true,
        mcpTools: []
      })
    );
    expect(fullAccessDefinitions.find((definition) => definition.function.name === 'run_command')?.function.parameters).toEqual(
      expect.objectContaining({
        required: expect.arrayContaining(['command'])
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
    expect(catalog.tools.some((tool) => tool.callName === 'browser_preview_check')).toBe(false);
    expect(catalog.tools.some((tool) => tool.callName === 'run_command')).toBe(false);
    expect(catalog.tools.some((tool) => tool.callName === 'spawn_subagents')).toBe(false);
    expect(catalog.tools.some((tool) => tool.callName === 'create_skill_bundle')).toBe(false);
  });

  it('keeps the delegation tool out of the explicit subagent preset', () => {
    const catalog = buildAgentRuntimeToolCatalog({
      executionPermission: 'full_access',
      creatorToolsEnabled: true,
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
    expect(catalog.tools.some((tool) => tool.callName === 'browser_preview_check')).toBe(false);
    expect(catalog.tools.some((tool) => tool.callName === 'create_skill_bundle')).toBe(false);
  });

  it('supports normal helper tools when delegation is explicitly denied on the default preset', () => {
    const catalog = buildAgentRuntimeToolCatalog({
      executionPermission: 'full_access',
      creatorToolsEnabled: true,
      executionConstraints: {
        permissionMode: 'default',
        toolPolicy: {
          preset: 'default',
          allowedToolCallNames: [],
          disallowedToolCallNames: ['spawn_subagents']
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
    expect(catalog.tools.some((tool) => tool.callName === 'write_file')).toBe(true);
    expect(catalog.tools.some((tool) => tool.callName === 'browser_preview_check')).toBe(true);
    expect(catalog.tools.some((tool) => tool.callName === 'create_skill_bundle')).toBe(true);
    expect(catalog.tools.some((tool) => tool.callName === 'run_command')).toBe(true);
  });

  it('honors explicit allow and deny rules on top of the selected tool preset', () => {
    const catalog = buildAgentRuntimeToolCatalog({
      executionPermission: 'full_access',
      executionConstraints: {
        permissionMode: 'default',
        toolPolicy: {
          preset: 'default',
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
