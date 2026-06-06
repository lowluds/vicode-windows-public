import { describe, expect, it } from 'vitest';
import type {
  AgentRuntimeToolCatalog,
  AgentRuntimeToolDescriptor
} from './agent-runtime';
import {
  buildAgentRuntimeToolCallSignature,
  buildAgentRuntimeToolResultSignature,
  formatAgentRuntimeToolLabel,
  formatAgentRuntimeToolResultForModel,
  isMutatingAgentRuntimeToolCall,
  isUntrustedAgentRuntimeToolResult
} from './agent-runtime-tool-helpers';

function createTool(
  callName: string,
  overrides: Partial<AgentRuntimeToolDescriptor> = {}
): AgentRuntimeToolDescriptor {
  return {
    id: `native:${callName}`,
    name: callName,
    callName,
    description: null,
    inputJsonSchema: null,
    origin: 'native',
    executionAuthority: 'app_runtime',
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'workspace_read',
    renderHint: 'workspace',
    reviewHint: 'none',
    orchestrationHint: 'inspect',
    mutatesWorkspace: false,
    readsWorkspace: true,
    usesNetwork: false,
    contentTrust: 'trusted',
    serverId: null,
    serverName: null,
    mcpToolName: null,
    ...overrides
  };
}

function createCatalog(tools: AgentRuntimeToolDescriptor[]): AgentRuntimeToolCatalog {
  return {
    nativeWebResearchEnabled: tools.some((tool) => tool.visibilityGroup === 'web_research'),
    nativeTools: tools.filter((tool) => tool.origin === 'native'),
    mcpTools: tools.filter((tool) => tool.origin === 'mcp'),
    tools
  };
}

describe('agent runtime tool helpers', () => {
  it('derives model-facing tool labels from provider-neutral tool names', () => {
    expect(formatAgentRuntimeToolLabel('browser_preview_check')).toBe('browser preview check');
    expect(formatAgentRuntimeToolLabel('run-command')).toBe('run command');
  });

  it('classifies mutation and untrusted result behavior from tool descriptors', () => {
    const catalog = createCatalog([
      createTool('write_file', {
        visibilityGroup: 'workspace_write',
        mutatesWorkspace: true
      }),
      createTool('web_search', {
        visibilityGroup: 'web_research',
        contentTrust: 'untrusted_content'
      })
    ]);

    expect(isMutatingAgentRuntimeToolCall(catalog, 'write_file')).toBe(true);
    expect(isMutatingAgentRuntimeToolCall(catalog, 'web_search')).toBe(false);
    expect(isUntrustedAgentRuntimeToolResult(catalog, 'web_search')).toBe(true);
    expect(isUntrustedAgentRuntimeToolResult(catalog, 'write_file')).toBe(false);
  });

  it('wraps untrusted model-visible tool output exactly once', () => {
    const catalog = createCatalog([
      createTool('web_search', {
        visibilityGroup: 'web_research',
        contentTrust: 'untrusted_content'
      })
    ]);
    const wrapped = formatAgentRuntimeToolResultForModel(
      catalog,
      'web_search',
      'Search result body',
      false
    );

    expect(wrapped).toContain('Untrusted web/tool content:');
    expect(wrapped).toContain('Search result body');
    expect(formatAgentRuntimeToolResultForModel(catalog, 'web_search', wrapped, false)).toBe(wrapped);
    expect(formatAgentRuntimeToolResultForModel(catalog, 'web_search', 'Tool failed', true)).toBe('Tool failed');
  });

  it('builds stable signatures for tool-loop stall detection', () => {
    expect(
      buildAgentRuntimeToolCallSignature([
        {
          name: 'read_file',
          arguments: {
            path: 'src/example.ts'
          }
        }
      ])
    ).toBe('[{"name":"read_file","arguments":{"path":"src/example.ts"}}]');

    expect(
      buildAgentRuntimeToolResultSignature([
        {
          toolName: 'read_file',
          content: 'abcdefghijklmnopqrstuvwxyz',
          isError: false
        }
      ])
    ).toBe('[{"toolName":"read_file","isError":false,"contentLength":26,"preview":"abcdefghijklmnopqrstuvwxyz"}]');
  });
});
