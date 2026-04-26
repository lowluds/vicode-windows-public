import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AgentRuntimeService } from './agent-runtime';

const maybeWindowsIt = process.platform === 'win32' ? it : it.skip;

describe('AgentRuntimeService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const current = tempDirs.pop();
      if (current) {
        rmSync(current, { recursive: true, force: true });
      }
    }
  });

  function createWorkspace(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-agent-runtime-'));
    tempDirs.push(dir);

    for (const [fileName, content] of Object.entries(files)) {
      const filePath = join(dir, fileName);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, 'utf8');
    }

    return dir;
  }

  it('reads a trusted workspace file and emits file activity', async () => {
    const workspace = createWorkspace({
      'src/example.ts': 'export const value = 1;\n'
    });
    const onInfo = vi.fn();
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'read_file',
        arguments: { path: 'src/example.ts' }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        onInfo
      }
    );

    expect(result).toEqual({
      toolName: 'read_file',
      content: 'export const value = 1;\n'
    });
    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'file_read',
          path: 'src/example.ts',
          summary: 'Read src/example.ts'
        })
      })
    );
  });

  it('builds a stable merged app-runtime tool catalog with native tools first', async () => {
    const service = new AgentRuntimeService({
      listCatalog: async () => ({
        tools: [
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
            name: 'search',
            title: null,
            description: 'Search remote issues.',
            inputSchema: null,
            invocationMode: 'ask',
            requiresApproval: true
          }
        ],
        resources: [],
        prompts: [],
        refreshedAt: new Date().toISOString()
      }),
      callTool: vi.fn(async () => ({ content: [] }))
    });

    const catalog = await service.listToolCatalog({
      executionPermission: 'full_access',
      runtimeCommandPolicy: 'approval_required',
      runtimeNetworkPolicy: 'disabled'
    });

    expect(catalog.nativeWebResearchEnabled).toBe(false);
    expect(catalog.nativeTools.map((tool) => tool.callName)).toEqual([
      'apply_patch',
      'list_directory',
      'mkdir',
      'read_file',
      'run_command',
      'search_text',
      'write_file'
    ]);
    expect(catalog.nativeTools.find((tool) => tool.callName === 'run_command')).toEqual(
      expect.objectContaining({
        id: 'native:run_command',
        origin: 'native',
        executionAuthority: 'app_runtime',
        requiresApproval: true,
        visibilityGroup: 'host_command',
        concurrencySafe: false,
        mutatesWorkspace: true,
        readsWorkspace: true
      })
    );
    expect(catalog.mcpTools.map((tool) => tool.name)).toEqual([
      'alpha-mcp / search',
      'zeta-mcp / echo'
    ]);
    expect(catalog.mcpTools[0]).toEqual(
      expect.objectContaining({
        id: 'mcp:alpha-mcp:search',
        callName: 'use_mcp_tool',
        origin: 'mcp',
        requiresApproval: true,
        visibilityGroup: 'mcp',
        concurrencySafe: null,
        serverId: 'alpha-mcp',
        mcpToolName: 'search'
      })
    );
    expect(catalog.tools.map((tool) => tool.origin)).toEqual([
      'native',
      'native',
      'native',
      'native',
      'native',
      'native',
      'native',
      'mcp',
      'mcp'
    ]);
  });

  it('exposes creator bundle tools when the Vicode creator bridge is configured', async () => {
    const service = new AgentRuntimeService();
    service.setCreators({
      createSkillBundle: async () => {
        throw new Error('not used');
      },
      createPluginBundle: async () => {
        throw new Error('not used');
      }
    });

    const catalog = await service.listToolCatalog({
      executionPermission: 'default'
    });

    expect(catalog.nativeTools.some((tool) => tool.callName === 'create_skill_bundle')).toBe(true);
    expect(catalog.nativeTools.some((tool) => tool.callName === 'create_plugin_bundle')).toBe(true);
  });

  it('suppresses ask-mode MCP approvals in trusted workspace tool catalogs', async () => {
    const service = new AgentRuntimeService({
      listCatalog: async () => ({
        tools: [
          {
            serverId: 'fixture-mcp',
            serverName: 'Fixture MCP',
            name: 'echo',
            title: null,
            description: 'Echo values.',
            inputSchema: null,
            invocationMode: 'ask',
            requiresApproval: true
          }
        ],
        resources: [],
        prompts: [],
        refreshedAt: new Date().toISOString()
      }),
      callTool: vi.fn(async () => ({ content: [] }))
    });

    const catalog = await service.listToolCatalog({
      executionPermission: 'full_access',
      trustedWorkspace: true,
      runtimeCommandPolicy: 'approval_required',
      runtimeNetworkPolicy: 'disabled'
    });

    expect(catalog.mcpTools).toEqual([
      expect.objectContaining({
        id: 'mcp:fixture-mcp:echo',
        callName: 'use_mcp_tool',
        requiresApproval: false
      })
    ]);
  });

  it('calls a connected MCP tool when the MCP execution bridge is available', async () => {
    const workspace = createWorkspace({});
    const service = new AgentRuntimeService({
      listCatalog: async () => ({
        tools: [
          {
            serverId: 'fixture-mcp',
            serverName: 'Fixture MCP',
            name: 'echo',
            title: null,
            description: 'Echo the provided value.',
            inputSchema: null,
            invocationMode: 'allow',
            requiresApproval: false
          }
        ],
        resources: [],
        prompts: [],
        refreshedAt: new Date().toISOString()
      }),
      callTool: async (_serverId, _toolName, args) => ({
        content: [
          {
            type: 'text',
            text: `echo:${String(args.value ?? '')}`
          }
        ]
      })
    });

    const result = await service.executeToolCall(
      {
        name: 'use_mcp_tool',
        arguments: {
          server_id: 'fixture-mcp',
          tool_name: 'echo',
          arguments: {
            value: 'hello'
          }
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access'
      }
    );

    expect(result).toEqual({
      toolName: 'use_mcp_tool',
      content: 'echo:hello'
    });
  });

  it('requests approval before invoking an ask-mode MCP tool', async () => {
    const workspace = createWorkspace({});
    const requestApproval = vi.fn(async () => 'rejected' as const);
    const callTool = vi.fn();
    const service = new AgentRuntimeService({
      listCatalog: async () => ({
        tools: [
          {
            serverId: 'fixture-mcp',
            serverName: 'Fixture MCP',
            name: 'echo',
            title: null,
            description: 'Echo the provided value.',
            inputSchema: null,
            invocationMode: 'ask',
            requiresApproval: true
          }
        ],
        resources: [],
        prompts: [],
        refreshedAt: new Date().toISOString()
      }),
      callTool: callTool as never
    });

    const result = await service.executeToolCall(
      {
        name: 'use_mcp_tool',
        arguments: {
          server_id: 'fixture-mcp',
          tool_name: 'echo'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        requestApproval
      }
    );

    expect(requestApproval).toHaveBeenCalledWith({
      toolName: 'use_mcp_tool',
      command: 'MCP Fixture MCP / echo',
      cwd: null,
      workspaceRoot: workspace
    });
    expect(callTool).not.toHaveBeenCalled();
    expect(result).toEqual({
      toolName: 'use_mcp_tool',
      content: 'use_mcp_tool for Fixture MCP / echo was not approved by the user.',
      isError: true
    });
  });

  it('skips ask-mode MCP approvals in trusted workspaces', async () => {
    const workspace = createWorkspace({});
    const requestApproval = vi.fn();
    const callTool = vi.fn(async () => ({
      content: [
        {
          type: 'text',
          text: 'echo:trusted'
        }
      ]
    }));
    const service = new AgentRuntimeService({
      listCatalog: async () => ({
        tools: [
          {
            serverId: 'fixture-mcp',
            serverName: 'Fixture MCP',
            name: 'echo',
            title: null,
            description: 'Echo the provided value.',
            inputSchema: null,
            invocationMode: 'ask',
            requiresApproval: true
          }
        ],
        resources: [],
        prompts: [],
        refreshedAt: new Date().toISOString()
      }),
      callTool: callTool as never
    });

    const result = await service.executeToolCall(
      {
        name: 'use_mcp_tool',
        arguments: {
          server_id: 'fixture-mcp',
          tool_name: 'echo'
        }
      },
      {
        workspaceRoot: workspace,
        trustedWorkspace: true,
        executionPermission: 'default',
        requestApproval: requestApproval as never
      }
    );

    expect(requestApproval).not.toHaveBeenCalled();
    expect(callTool).toHaveBeenCalledWith('fixture-mcp', 'echo', {});
    expect(result).toEqual({
      toolName: 'use_mcp_tool',
      content: 'echo:trusted'
    });
  });

  it('includes successful MCP tool output in tool-result telemetry', async () => {
    const workspace = createWorkspace({});
    const onInfo = vi.fn();
    const service = new AgentRuntimeService({
      listCatalog: vi.fn(async () => ({
        tools: [
          {
            serverId: 'fixture-mcp',
            serverName: 'Fixture MCP',
            name: 'echo',
            title: null,
            description: 'Echo the provided value.',
            inputSchema: null,
            invocationMode: 'allow',
            requiresApproval: false
          }
        ],
        resources: [],
        prompts: []
      })),
      callTool: vi.fn(async () => ({
        content: [
          {
            type: 'text',
            text: 'mcp:hello-world'
          }
        ]
      }))
    });

    await service.executeToolCall(
      {
        name: 'use_mcp_tool',
        arguments: {
          server_id: 'fixture-mcp',
          tool_name: 'echo',
          arguments: {
            text: 'mcp:hello-world'
          }
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        onInfo
      }
    );

    expect(onInfo.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'tool_call',
          toolName: 'use_mcp_tool',
          summary: 'Calling MCP tool echo'
        })
      })
    );

    expect(onInfo.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'tool_result',
          toolName: 'use_mcp_tool',
          summary: 'Completed MCP tool echo',
          status: 'completed',
          text: 'mcp:hello-world'
        })
      })
    );
  });

  it('emits additive tool-call and tool-result telemetry around workspace tools', async () => {
    const workspace = createWorkspace({
      'src/example.ts': 'export const value = 1;\n'
    });
    const onInfo = vi.fn();
    const service = new AgentRuntimeService();

    await service.executeToolCall(
      {
        name: 'read_file',
        arguments: { path: 'src/example.ts' }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        onInfo
      }
    );

    expect(onInfo.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'tool_call',
          toolName: 'read_file',
          summary: 'Calling read_file',
          text: 'path: src/example.ts'
        })
      })
    );
    expect(onInfo.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'file_read',
          path: 'src/example.ts',
          summary: 'Read src/example.ts'
        })
      })
    );
    expect(onInfo.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'tool_result',
          toolName: 'read_file',
          summary: 'Completed read_file',
          status: 'completed'
        })
      })
    );
  });

  it('lists a trusted workspace directory with stable ordering', async () => {
    const workspace = createWorkspace({
      'src/example.ts': 'export const value = 1;\n',
      'src/nested/file.ts': 'export const nested = true;\n'
    });
    const onInfo = vi.fn();
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'list_directory',
        arguments: { path: 'src' }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        onInfo
      }
    );

    expect(result).toEqual({
      toolName: 'list_directory',
      content: ['dir  nested/', 'file example.ts'].join('\n')
    });
    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'file_open',
          path: 'src',
          summary: 'Opened src'
        })
      })
    );
  });

  it('rejects path traversal outside the workspace', async () => {
    const workspace = createWorkspace({
      'src/example.ts': 'export const value = 1;\n'
    });
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'read_file',
        arguments: { path: '../outside.ts' }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default'
      }
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain(
      'Tool path must stay inside the workspace'
    );
  });

  it('searches text inside the trusted workspace and emits file-search activity', async () => {
    const workspace = createWorkspace({
      'src/example.ts': 'export const value = 1;\n',
      'src/feature.ts': 'const value = "needle";\nconsole.log(value);\n'
    });
    const onInfo = vi.fn();
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'search_text',
        arguments: {
          query: 'needle',
          path: 'src'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        onInfo
      }
    );

    expect(result).toEqual({
      toolName: 'search_text',
      content: 'src/feature.ts:1: const value = "needle";'
    });
    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'file_search',
          path: 'src',
          query: 'needle',
          summary: 'Searched files for needle'
        })
      })
    );
  });

  it('searches the web through the native research backend when workspace network access is enabled', async () => {
    const workspace = createWorkspace({});
    const onInfo = vi.fn();
    const webResearch = {
      isConfigured: vi.fn(() => true),
      search: vi.fn(async () => 'Web search results for "latest vicode release":\n\n1. Example result'),
      extractPage: vi.fn(),
      mapSite: vi.fn(),
      crawlSite: vi.fn(),
      researchTopic: vi.fn()
    };
    const service = new AgentRuntimeService(undefined, webResearch);

    const result = await service.executeToolCall(
      {
        name: 'web_search',
        arguments: {
          query: 'latest vicode release',
          max_results: 3
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        runtimeNetworkPolicy: 'enabled',
        onInfo
      }
    );

    expect(webResearch.search).toHaveBeenCalledWith('latest vicode release', {
      maxResults: 3,
      signal: undefined
    });
    expect(result).toEqual({
      toolName: 'web_search',
      content: 'Web search results for "latest vicode release":\n\n1. Example result'
    });
    expect(onInfo.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'tool_call',
          toolName: 'web_search',
          summary: 'Searching the web',
          text: 'Search query: latest vicode release\nResults limit: 3'
        })
      })
    );
  });

  it('extracts one public page through the native research backend', async () => {
    const workspace = createWorkspace({});
    const onInfo = vi.fn();
    const webResearch = {
      isConfigured: vi.fn(() => true),
      search: vi.fn(),
      extractPage: vi.fn(async () => 'Extracted page: Example\nURL: https://example.com\n\nBody'),
      mapSite: vi.fn(),
      crawlSite: vi.fn(),
      researchTopic: vi.fn()
    };
    const service = new AgentRuntimeService(undefined, webResearch);

    const result = await service.executeToolCall(
      {
        name: 'extract_web_page',
        arguments: {
          url: 'https://example.com',
          query: 'release notes'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        runtimeNetworkPolicy: 'enabled',
        onInfo
      }
    );

    expect(webResearch.extractPage).toHaveBeenCalledWith('https://example.com', {
      query: 'release notes',
      signal: undefined
    });
    expect(result).toEqual({
      toolName: 'extract_web_page',
      content: 'Extracted page: Example\nURL: https://example.com\n\nBody'
    });
    expect(onInfo.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'tool_call',
          toolName: 'extract_web_page',
          summary: 'Reading a web page',
          text: 'Page URL: https://example.com\nFocus: release notes'
        })
      })
    );
    expect(onInfo.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'tool_result',
          toolName: 'extract_web_page',
          summary: 'Read the web page',
          url: 'https://example.com/',
          sources: [
            {
              url: 'https://example.com/',
              title: 'Example',
              snippet: null,
              excerpt: null
            }
          ]
        })
      })
    );
  });

  it('maps a public site through the native research backend', async () => {
    const workspace = createWorkspace({});
    const webResearch = {
      isConfigured: vi.fn(() => true),
      search: vi.fn(),
      extractPage: vi.fn(),
      mapSite: vi.fn(async () => 'Site map for https://example.com/start:\n\n1. Docs\nURL: https://example.com/docs'),
      crawlSite: vi.fn(),
      researchTopic: vi.fn()
    };
    const service = new AgentRuntimeService(undefined, webResearch);

    const result = await service.executeToolCall(
      {
        name: 'map_site',
        arguments: {
          url: 'https://example.com/start',
          max_pages: 4,
          same_origin_only: false
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        runtimeNetworkPolicy: 'enabled'
      }
    );

    expect(webResearch.mapSite).toHaveBeenCalledWith('https://example.com/start', {
      maxPages: 4,
      sameOriginOnly: false,
      signal: undefined
    });
    expect(result).toEqual({
      toolName: 'map_site',
      content: 'Site map for https://example.com/start:\n\n1. Docs\nURL: https://example.com/docs'
    });
  });

  it('crawls a public site through the native research backend', async () => {
    const workspace = createWorkspace({});
    const webResearch = {
      isConfigured: vi.fn(() => true),
      search: vi.fn(),
      extractPage: vi.fn(),
      mapSite: vi.fn(),
      crawlSite: vi.fn(async () => 'Site crawl from https://example.com/start:\n\n1. Start\nURL: https://example.com/start'),
      researchTopic: vi.fn()
    };
    const service = new AgentRuntimeService(undefined, webResearch);

    const result = await service.executeToolCall(
      {
        name: 'crawl_site',
        arguments: {
          url: 'https://example.com/start',
          query: 'release notes',
          max_pages: 2
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        runtimeNetworkPolicy: 'enabled'
      }
    );

    expect(webResearch.crawlSite).toHaveBeenCalledWith('https://example.com/start', {
      query: 'release notes',
      maxPages: 2,
      sameOriginOnly: true,
      signal: undefined
    });
    expect(result).toEqual({
      toolName: 'crawl_site',
      content: 'Site crawl from https://example.com/start:\n\n1. Start\nURL: https://example.com/start'
    });
  });

  it('builds a native research packet through the research_topic tool', async () => {
    const workspace = createWorkspace({});
    const onInfo = vi.fn();
    const webResearch = {
      isConfigured: vi.fn(() => true),
      search: vi.fn(),
      extractPage: vi.fn(),
      mapSite: vi.fn(),
      crawlSite: vi.fn(),
      researchTopic: vi.fn(async () => [
        'Research packet for "vicode runtime":',
        'Sources reviewed: 1',
        '',
        '1. Source One',
        'URL: https://example.com/source-one',
        'Search snippet: Official runtime overview.',
        'Extracted excerpt: Vicode keeps app-owned web research separate from host network access.'
      ].join('\n'))
    };
    const service = new AgentRuntimeService(undefined, webResearch);

    const result = await service.executeToolCall(
      {
        name: 'research_topic',
        arguments: {
          query: 'vicode runtime',
          max_results: 4,
          max_pages: 3
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        runtimeNetworkPolicy: 'enabled',
        onInfo
      }
    );

    expect(webResearch.researchTopic).toHaveBeenCalledWith('vicode runtime', {
      maxResults: 4,
      maxPages: 3,
      signal: undefined
    });
    expect(result).toEqual({
      toolName: 'research_topic',
      content: [
        'Research packet for "vicode runtime":',
        'Sources reviewed: 1',
        '',
        '1. Source One',
        'URL: https://example.com/source-one',
        'Search snippet: Official runtime overview.',
        'Extracted excerpt: Vicode keeps app-owned web research separate from host network access.'
      ].join('\n')
    });
    expect(onInfo.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'tool_result',
          toolName: 'research_topic',
          summary: 'Finished research',
          url: 'https://example.com/source-one',
          sources: [
            {
              url: 'https://example.com/source-one',
              title: 'Source One',
              snippet: 'Official runtime overview.',
              excerpt: 'Vicode keeps app-owned web research separate from host network access.'
            }
          ]
        })
      })
    );
  });

  it('allows native web research when host-network shell access is disabled', async () => {
    const workspace = createWorkspace({});
    const webResearch = {
      isConfigured: vi.fn(() => true),
      search: vi.fn(async () => 'Web search results for "latest vicode release":\n\n1. Example result'),
      extractPage: vi.fn(),
      mapSite: vi.fn(),
      crawlSite: vi.fn(),
      researchTopic: vi.fn()
    };
    const onInfo = vi.fn();
    const service = new AgentRuntimeService(undefined, webResearch);

    const result = await service.executeToolCall(
      {
        name: 'web_search',
        arguments: {
          query: 'latest vicode release'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        runtimeNetworkPolicy: 'disabled',
        onInfo
      }
    );

    expect(webResearch.search).toHaveBeenCalledWith('latest vicode release', {
      maxResults: 5,
      signal: undefined
    });
    expect(result).toEqual({
      toolName: 'web_search',
      content: 'Web search results for "latest vicode release":\n\n1. Example result'
    });
    expect(onInfo.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'tool_result',
          toolName: 'web_search',
          summary: 'Searched the web',
          status: 'completed',
          text: null
        })
      })
    );
  });

  it('fails native web research clearly when no backend is configured', async () => {
    const workspace = createWorkspace({});
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'web_search',
        arguments: {
          query: 'latest vicode release'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        runtimeNetworkPolicy: 'enabled'
      }
    );

    expect(result).toEqual({
      toolName: 'web_search',
      content:
        'web_search is not available because no native web research backend is configured.',
      isError: true
    });
  });

  it('creates a directory inside the trusted workspace under the bounded default policy', async () => {
    const workspace = createWorkspace({});
    const onInfo = vi.fn();
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'mkdir',
        arguments: {
          path: 'src/generated'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        onInfo
      }
    );

    expect(result).toEqual({
      toolName: 'mkdir',
      content: 'Created src/generated'
    });
    expect(existsSync(join(workspace, 'src', 'generated'))).toBe(true);
    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'mkdir',
          path: 'src/generated',
          summary: 'Created folder'
        })
      })
    );
  });

  it('creates a Vicode skill bundle through the app-owned creator bridge', async () => {
    const workspace = createWorkspace({});
    const onInfo = vi.fn();
    const createSkillBundle = vi.fn(async () => ({
      scope: 'project' as const,
      projectId: 'project-1',
      folderName: 'ci-triage',
      relativeRootPath: 'skills/project/project-1/ci-triage',
      filePaths: ['SKILL.md', '.vicode-skill.json'],
      existed: false,
      importedId: 'file-backed-ci-triage'
    }));
    const service = new AgentRuntimeService();
    service.setCreators({
      createSkillBundle,
      createPluginBundle: vi.fn()
    });

    const result = await service.executeToolCall(
      {
        name: 'create_skill_bundle',
        arguments: {
          scope: 'project',
          project_id: 'project-1',
          folder_name: 'ci-triage',
          files: [
            {
              path: 'SKILL.md',
              content: '# CI Triage\n'
            },
            {
              path: '.vicode-skill.json',
              content: '{}'
            }
          ]
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        onInfo
      }
    );

    expect(createSkillBundle).toHaveBeenCalledWith({
      scope: 'project',
      projectId: 'project-1',
      folderName: 'ci-triage',
      files: [
        {
          path: 'SKILL.md',
          content: '# CI Triage\n'
        },
        {
          path: '.vicode-skill.json',
          content: '{}'
        }
      ]
    });
    expect(result).toEqual({
      toolName: 'create_skill_bundle',
      content: [
        'Created skills/project/project-1/ci-triage',
        'scope: project',
        'project_id: project-1',
        'skill_id: file-backed-ci-triage',
        'files:',
        '- SKILL.md',
        '- .vicode-skill.json'
      ].join('\n')
    });
    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'file_write',
          path: 'skills/project/project-1/ci-triage',
          summary: 'Created skills/project/project-1/ci-triage'
        })
      })
    );
  });

  it('creates a Vicode plugin bundle through the app-owned creator bridge', async () => {
    const workspace = createWorkspace({});
    const createPluginBundle = vi.fn(async () => ({
      scope: 'global' as const,
      projectId: null,
      folderName: 'fixture-plugin',
      relativeRootPath: 'plugins/user/fixture-plugin',
      filePaths: ['.codex-plugin/plugin.json', '.mcp.json'],
      existed: true,
      importedId: 'file-plugin:global:fixture-plugin'
    }));
    const service = new AgentRuntimeService();
    service.setCreators({
      createSkillBundle: vi.fn(),
      createPluginBundle
    });

    const result = await service.executeToolCall(
      {
        name: 'create_plugin_bundle',
        arguments: {
          scope: 'global',
          folder_name: 'fixture-plugin',
          files: [
            {
              path: '.codex-plugin/plugin.json',
              content: '{"name":"Fixture Plugin","description":"Test plugin"}'
            },
            {
              path: '.mcp.json',
              content: '{"command":"node"}'
            }
          ]
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default'
      }
    );

    expect(createPluginBundle).toHaveBeenCalledWith({
      scope: 'global',
      projectId: null,
      folderName: 'fixture-plugin',
      files: [
        {
          path: '.codex-plugin/plugin.json',
          content: '{"name":"Fixture Plugin","description":"Test plugin"}'
        },
        {
          path: '.mcp.json',
          content: '{"command":"node"}'
        }
      ]
    });
    expect(result).toEqual({
      toolName: 'create_plugin_bundle',
      content: [
        'Updated plugins/user/fixture-plugin',
        'scope: global',
        'server_id: file-plugin:global:fixture-plugin',
        'files:',
        '- .codex-plugin/plugin.json',
        '- .mcp.json'
      ].join('\n')
    });
  });

  it('writes a UTF-8 file inside the trusted workspace under the bounded default policy', async () => {
    const workspace = createWorkspace({});
    const onInfo = vi.fn();
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'write_file',
        arguments: {
          path: 'src/generated.txt',
          content: 'hello from runtime\n'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        onInfo
      }
    );

    expect(result).toEqual({
      toolName: 'write_file',
      content: 'Wrote src/generated.txt'
    });
    expect(readFileSync(join(workspace, 'src/generated.txt'), 'utf8')).toBe(
      'hello from runtime\n'
    );
    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'file_write',
          path: 'src/generated.txt',
          summary: 'Wrote src/generated.txt'
        })
      })
    );
  });

  it('rejects direct build-ticket queue writes for autonomous lane presets', async () => {
    const workspace = createWorkspace({
      '.vicode/control/build-tickets/team.json': '{"version":1,"tickets":[]}\n'
    });
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'write_file',
        arguments: {
          path: '.vicode/control/build-tickets/team.json',
          content: '{"status":"done"}'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        executionConstraints: {
          permissionMode: 'plan',
          toolPolicy: {
            preset: 'build_planner',
            allowedToolCallNames: [],
            disallowedToolCallNames: []
          },
          maxTurns: 6,
          maxReasoningTokens: null,
          taskBudgetTokens: null,
          costBudgetUsd: null,
          maxDelegationDepth: 1,
          maxAutomaticRetries: 1,
          maxUnchangedHandoffs: 1,
          maxSiblingDelegates: 0
        }
      }
    );

    expect(result).toEqual({
      toolName: 'write_file',
      content:
        'Direct queue edits are not allowed for .vicode/control/build-tickets/team.json. Use .vicode/control/update_build_ticket_queue.py instead.',
      isError: true
    });
    expect(readFileSync(join(workspace, '.vicode/control/build-tickets/team.json'), 'utf8')).toBe(
      '{"version":1,"tickets":[]}\n'
    );
  });

  it('blocks build-planner writes outside the control plane', async () => {
    const workspace = createWorkspace({
      'src/generated.txt': 'before\n'
    });
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'write_file',
        arguments: {
          path: 'src/generated.txt',
          content: 'after\n'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        executionConstraints: {
          permissionMode: 'plan',
          toolPolicy: {
            preset: 'build_planner',
            allowedToolCallNames: [],
            disallowedToolCallNames: []
          },
          maxTurns: 6,
          maxReasoningTokens: null,
          taskBudgetTokens: null,
          costBudgetUsd: null,
          maxDelegationDepth: 1,
          maxAutomaticRetries: 1,
          maxUnchangedHandoffs: 1,
          maxSiblingDelegates: 0
        }
      }
    );

    expect(result).toEqual({
      toolName: 'write_file',
      content:
        'Build planner lanes may only write planning artifacts such as build heartbeats and build prompts. src/generated.txt must be updated by Builder or Finisher instead.',
      isError: true
    });
    expect(readFileSync(join(workspace, 'src/generated.txt'), 'utf8')).toBe('before\n');
  });

  it('blocks build-planner writes to arbitrary .vicode/control files', async () => {
    const workspace = createWorkspace({
      '.vicode/control/README.md': 'before\n'
    });
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'write_file',
        arguments: {
          path: '.vicode/control/README.md',
          content: 'after\n'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        executionConstraints: {
          permissionMode: 'plan',
          toolPolicy: {
            preset: 'build_planner',
            allowedToolCallNames: [],
            disallowedToolCallNames: []
          },
          maxTurns: 6,
          maxReasoningTokens: null,
          taskBudgetTokens: null,
          costBudgetUsd: null,
          maxDelegationDepth: 1,
          maxAutomaticRetries: 1,
          maxUnchangedHandoffs: 1,
          maxSiblingDelegates: 0
        }
      }
    );

    expect(result).toEqual({
      toolName: 'write_file',
      content:
        'Build planner lanes may only write planning artifacts such as build heartbeats and build prompts. .vicode/control/README.md must be updated by Builder or Finisher instead.',
      isError: true
    });
    expect(readFileSync(join(workspace, '.vicode/control/README.md'), 'utf8')).toBe('before\n');
  });

  it('applies a unified diff patch inside the trusted workspace', async () => {
    const workspace = createWorkspace({
      'src/example.ts': 'export const value = 1;\n'
    });
    const onInfo = vi.fn();
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'apply_patch',
        arguments: {
          patch: [
            '--- a/src/example.ts',
            '+++ b/src/example.ts',
            '@@ -1 +1 @@',
            '-export const value = 1;',
            '+export const value = 2;'
          ].join('\n')
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        onInfo
      }
    );

    expect(result).toEqual({
      toolName: 'apply_patch',
      content: 'Patched src/example.ts'
    });
    expect(readFileSync(join(workspace, 'src/example.ts'), 'utf8')).toBe(
      'export const value = 2;\n'
    );
    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'tool_call',
          toolName: 'apply_patch',
          summary: 'Calling apply_patch',
          text: 'target: src/example.ts'
        })
      })
    );
    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'file_write',
          path: 'src/example.ts',
          summary: 'Patched src/example.ts'
        })
      })
    );
  });

  it('normalizes incorrect unified diff hunk counts before applying a patch', async () => {
    const workspace = createWorkspace({
      'src/example.ts': 'export const value = 1;\n'
    });
    const onInfo = vi.fn();
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'apply_patch',
        arguments: {
          patch: [
            '--- a/src/example.ts',
            '+++ b/src/example.ts',
            '@@ -1,2 +1,3 @@',
            '-export const value = 1;',
            '+export const value = 2;',
            '+export const extra = true;'
          ].join('\n')
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        onInfo
      }
    );

    expect(result).toEqual({
      toolName: 'apply_patch',
      content: 'Patched src/example.ts'
    });
    expect(readFileSync(join(workspace, 'src/example.ts'), 'utf8')).toBe(
      'export const value = 2;\nexport const extra = true;\n'
    );
    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'tool_call',
          toolName: 'apply_patch',
          text: 'target: src/example.ts'
        })
      })
    );
  });

  it('applies a patch when surrounding context has drifted slightly', async () => {
    const workspace = createWorkspace({
      'src/example.ts': [
        'export const prefix = true;',
        'export const value = 1;',
        'export const inserted = true;',
        'export const suffix = true;',
        ''
      ].join('\n')
    });
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'apply_patch',
        arguments: {
          patch: [
            '--- a/src/example.ts',
            '+++ b/src/example.ts',
            '@@ -1,3 +1,3 @@',
            ' export const prefix = true;',
            '-export const value = 1;',
            '+export const value = 2;',
            ' export const suffix = true;'
          ].join('\n')
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default'
      }
    );

    expect(result).toEqual({
      toolName: 'apply_patch',
      content: 'Patched src/example.ts'
    });
    expect(readFileSync(join(workspace, 'src/example.ts'), 'utf8')).toBe(
      [
        'export const prefix = true;',
        'export const value = 2;',
        'export const inserted = true;',
        'export const suffix = true;',
        ''
      ].join('\n')
    );
  });

  it('returns an actionable tool error for malformed patch bodies', async () => {
    const workspace = createWorkspace({
      'src/example.ts': 'export const value = 1;\n'
    });
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'apply_patch',
        arguments: {
          patch: [
            '--- a/src/example.ts',
            '+++ b/src/example.ts',
            '@@ -1 +1 @@',
            '?export const value = 2;'
          ].join('\n')
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default'
      }
    );

    expect(result).toEqual({
      toolName: 'apply_patch',
      content: expect.stringContaining('Patch is malformed:'),
      isError: true
    });
    expect(result.content).toContain('use write_file');
    expect(readFileSync(join(workspace, 'src/example.ts'), 'utf8')).toBe('export const value = 1;\n');
  });

  maybeWindowsIt(
    'runs a command inside the trusted workspace root',
    async () => {
      const workspace = createWorkspace({
        'nested/.gitkeep': ''
      });
      const service = new AgentRuntimeService();

      const result = await service.executeToolCall(
        {
          name: 'run_command',
          arguments: {
            command: 'cd',
            cwd: 'nested'
          }
        },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        requestApproval: async () => 'approved'
      }
    );

      expect(result.toolName).toBe('run_command');
      expect(result.isError).not.toBe(true);
      expect(result.content).toContain(join(workspace, 'nested'));
    }
  );

  maybeWindowsIt(
    'blocks non-control run_command usage for build-planner lanes',
    async () => {
      const workspace = createWorkspace({
        'package.json': '{"name":"fixture"}\n'
      });
      const service = new AgentRuntimeService();

      const result = await service.executeToolCall(
        {
          name: 'run_command',
          arguments: {
            command: 'git status --short'
          }
        },
        {
          workspaceRoot: workspace,
          executionPermission: 'full_access',
          requestApproval: vi.fn(async () => 'approved' as const),
          executionConstraints: {
            permissionMode: 'plan',
            toolPolicy: {
              preset: 'build_planner',
              allowedToolCallNames: [],
              disallowedToolCallNames: []
            },
            maxTurns: 6,
            maxReasoningTokens: null,
            taskBudgetTokens: null,
            costBudgetUsd: null,
            maxDelegationDepth: 1,
            maxAutomaticRetries: 1,
            maxUnchangedHandoffs: 1,
            maxSiblingDelegates: 0
          }
        }
      );

      expect(result).toEqual({
        toolName: 'run_command',
        content:
          'Build planner lanes may only use run_command for bounded control-plane helpers such as update_build_ticket_queue.py.',
        isError: true
      });
    }
  );

  maybeWindowsIt(
    'allows build-planner helper commands when Ollama emits relative helper paths and legacy --json flags',
    async () => {
      const helperSource = readFileSync(
        join(process.cwd(), '.vicode', 'control', 'update_build_ticket_queue.py'),
        'utf8'
      );
      const queuePayload = JSON.stringify(
        {
          version: 1,
          updatedAt: '2026-04-03T00:00:00.000Z',
          tickets: [
            {
              id: 'ticket-1',
              title: 'Seed ticket',
              status: 'in_progress',
              ownerLane: 'planner',
              summary: 'Seed queue',
              dependencies: [],
              targetPaths: [],
              acceptanceCriteria: [],
              verificationSteps: [],
              refs: [],
              stopWhen: 'Done',
              updatedAt: '2026-04-03T00:00:00.000Z'
            }
          ]
        },
        null,
        2
      );
      const workspace = createWorkspace({
        '.vicode/control/update_build_ticket_queue.py': helperSource,
        '.vicode/control/build-heartbeats/current.md': '# heartbeat\n',
        '.vicode/control/build-tickets/team.json': `${queuePayload}\n`
      });
      const service = new AgentRuntimeService();
      const requestApproval = vi.fn(async () => 'approved' as const);

      const result = await service.executeToolCall(
        {
          name: 'run_command',
          arguments: {
            command:
              'python update_build_ticket_queue.py show --queue "' +
              join(workspace, '.vicode', 'control', 'build-tickets', 'team.json') +
              '" --json',
            cwd: '.vicode/control/build-heartbeats'
          }
        },
        {
          workspaceRoot: workspace,
          executionPermission: 'full_access',
          requestApproval,
          executionConstraints: {
            permissionMode: 'plan',
            toolPolicy: {
              preset: 'build_planner',
              allowedToolCallNames: [],
              disallowedToolCallNames: []
            },
            maxTurns: 6,
            maxReasoningTokens: null,
            taskBudgetTokens: null,
            costBudgetUsd: null,
            maxDelegationDepth: 1,
            maxAutomaticRetries: 1,
            maxUnchangedHandoffs: 1,
            maxSiblingDelegates: 0
          }
        }
      );

      expect(result.toolName).toBe('run_command');
      expect(result.content).not.toContain(
        'Build planner lanes may only use run_command for bounded control-plane helpers such as update_build_ticket_queue.py.'
      );
      expect(requestApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'run_command',
          cwd: '.vicode/control/build-heartbeats',
          command: expect.stringContaining('.vicode/control/update_build_ticket_queue.py')
        })
      );
    }
  );

  maybeWindowsIt('aborts a running workspace command cleanly', async () => {
    const workspace = createWorkspace({});
    const service = new AgentRuntimeService();
    const controller = new AbortController();

    const promise = service.executeToolCall(
      {
        name: 'run_command',
        arguments: {
          command: 'choice /t 6 /d y > nul'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        requestApproval: async () => 'approved',
        signal: controller.signal
      }
    );

    setTimeout(() => controller.abort(), 100);

    await expect(promise).rejects.toThrow('Agent runtime was aborted.');
  });

  it('requires explicit approval before running a shell command', async () => {
    const workspace = createWorkspace({
      'nested/.gitkeep': ''
    });
    const onInfo = vi.fn();
    const requestApproval = vi.fn(async () => 'rejected' as const);
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'run_command',
        arguments: {
          command: 'dir',
          cwd: 'nested'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        requestApproval,
        onInfo
      }
    );

    expect(requestApproval).toHaveBeenCalledWith({
      toolName: 'run_command',
      command: 'dir',
      cwd: 'nested',
      workspaceRoot: workspace
    });
    expect(result).toEqual({
      toolName: 'run_command',
      content: 'run_command was not approved by the user.',
      isError: true
    });
    expect(onInfo).not.toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'terminal_command'
        })
      })
    );
  });

  maybeWindowsIt('records job-object isolated host-profile metadata on terminal command activity', async () => {
    const workspace = createWorkspace({});
    const onInfo = vi.fn();
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'run_command',
        arguments: {
          command: 'echo hello'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        runtimeNetworkPolicy: 'enabled',
        requestApproval: async () => 'approved',
        onInfo
      }
    );

    expect(result.isError).toBe(false);
    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'terminal_command',
          phase: 'started',
          isolationMode: 'host_job_object_temp_profile'
        })
      })
    );
    expect(onInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'terminal_command',
          phase: 'completed',
          isolationMode: 'host_job_object_temp_profile'
        })
      })
    );
  });

  maybeWindowsIt('runs approved shell commands without inheriting unrelated secret env vars', async () => {
    const workspace = createWorkspace({});
    const originalSecret = process.env.VICODE_TEST_SECRET;
    process.env.VICODE_TEST_SECRET = 'hidden';

    try {
      const service = new AgentRuntimeService();

      const result = await service.executeToolCall(
        {
          name: 'run_command',
          arguments: {
            command:
              'if defined VICODE_TEST_SECRET (echo present) else (echo absent)'
          }
        },
        {
          workspaceRoot: workspace,
          executionPermission: 'full_access',
          requestApproval: async () => 'approved'
        }
      );

      expect(result.toolName).toBe('run_command');
      expect(result.isError).toBe(false);
      expect(result.content).toContain('stdout:\nabsent');
      expect(result.content).not.toContain('present');
      expect(result.content).toContain('vicode-agent-runtime-');
    } finally {
      if (typeof originalSecret === 'string') {
        process.env.VICODE_TEST_SECRET = originalSecret;
      } else {
        delete process.env.VICODE_TEST_SECRET;
      }
    }
  });

  maybeWindowsIt('runs approved shell commands inside an isolated temp profile that is cleaned up after exit', async () => {
    const workspace = createWorkspace({});
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'run_command',
        arguments: {
          command: 'echo %USERPROFILE%'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        requestApproval: async () => 'approved'
      }
    );

    expect(result.toolName).toBe('run_command');
    expect(result.isError).toBe(false);
    const match = result.content.match(/stdout:\n([^\r\n]+)/u);
    expect(match?.[1]).toContain('vicode-agent-runtime-');
    if (match?.[1]) {
      expect(existsSync(match[1])).toBe(false);
    }
  });

  it('aborts the tool call when approval is cancelled', async () => {
    const workspace = createWorkspace({});
    const service = new AgentRuntimeService();

    await expect(
      service.executeToolCall(
        {
          name: 'run_command',
          arguments: {
            command: 'dir'
          }
        },
        {
          workspaceRoot: workspace,
          executionPermission: 'full_access',
          requestApproval: async () => 'cancelled'
        }
      )
    ).rejects.toThrow('Agent runtime was aborted.');
  });

  it('blocks run_command when the workspace runtime policy disables commands', async () => {
    const workspace = createWorkspace({});
    const requestApproval = vi.fn();
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'run_command',
        arguments: {
          command: 'dir'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        runtimeCommandPolicy: 'disabled',
        requestApproval
      }
    );

    expect(result).toEqual({
      toolName: 'run_command',
      content:
        'run_command is disabled for this workspace. Update the workspace runtime policy to allow approval-gated local shell commands.',
      isError: true
    });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('blocks clearly network-oriented commands when the workspace network policy disables host network access', async () => {
    const workspace = createWorkspace({});
    const requestApproval = vi.fn();
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'run_command',
        arguments: {
          command: 'curl https://example.com'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        runtimeNetworkPolicy: 'disabled',
        requestApproval
      }
    );

    expect(result).toEqual({
      toolName: 'run_command',
      content:
        'run_command is blocked by this workspace network policy. The requested command looks network-oriented (curl), and approved host network access is disabled here.',
      isError: true
    });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('blocks nested shell launchers before command execution', async () => {
    const workspace = createWorkspace({});
    const requestApproval = vi.fn();
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'run_command',
        arguments: {
          command: 'powershell -NoProfile -Command "dir"'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        runtimeNetworkPolicy: 'enabled',
        requestApproval
      }
    );

    expect(result).toEqual({
      toolName: 'run_command',
      content:
        'run_command is blocked by runtime launcher policy. Nested shell launchers such as powershell are not allowed in app-managed runs.',
      isError: true
    });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('blocks inline interpreter launchers before command execution', async () => {
    const workspace = createWorkspace({});
    const requestApproval = vi.fn();
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'run_command',
        arguments: {
          command: 'node -e "console.log(1)"'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        runtimeNetworkPolicy: 'enabled',
        requestApproval
      }
    );

    expect(result).toEqual({
      toolName: 'run_command',
      content:
        'run_command is blocked by runtime launcher policy. Inline interpreter commands such as node -e are not allowed in app-managed runs.',
      isError: true
    });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('blocks absolute path references outside the trusted workspace before command execution', async () => {
    const workspace = createWorkspace({});
    const requestApproval = vi.fn();
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'run_command',
        arguments: {
          command: 'type C:\\Windows\\win.ini'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        runtimeNetworkPolicy: 'enabled',
        requestApproval
      }
    );

    expect(result).toEqual({
      toolName: 'run_command',
      content:
        'run_command is blocked by runtime path policy. The command references an absolute path outside the workspace (C:\\Windows\\win.ini).',
      isError: true
    });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('blocks relative path escapes outside the trusted workspace before command execution', async () => {
    const workspace = createWorkspace({
      'nested/file.txt': 'hello'
    });
    const requestApproval = vi.fn();
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'run_command',
        arguments: {
          command: 'copy .\\file.txt ..\\..\\outside.txt',
          cwd: 'nested'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        runtimeNetworkPolicy: 'enabled',
        requestApproval
      }
    );

    expect(result).toEqual({
      toolName: 'run_command',
      content:
        'run_command is blocked by runtime path policy. The command references a relative path that resolves outside the workspace (..\\..\\outside.txt).',
      isError: true
    });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('blocks redirection targets that resolve outside the trusted workspace before command execution', async () => {
    const workspace = createWorkspace({
      'nested/.gitkeep': ''
    });
    const requestApproval = vi.fn();
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'run_command',
        arguments: {
          command: 'echo hello>..\\..\\outside.txt',
          cwd: 'nested'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        runtimeNetworkPolicy: 'enabled',
        requestApproval
      }
    );

    expect(result).toEqual({
      toolName: 'run_command',
      content:
        'run_command is blocked by runtime path policy. The command references a relative path that resolves outside the workspace (hello>..\\..\\outside.txt).',
      isError: true
    });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  maybeWindowsIt('allows relative paths that stay inside the trusted workspace', async () => {
    const workspace = createWorkspace({
      'src/example.ts': 'export const value = 1;\n',
      'nested/.gitkeep': ''
    });
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'run_command',
        arguments: {
          command: 'type ..\\src\\example.ts',
          cwd: 'nested'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        runtimeNetworkPolicy: 'enabled',
        requestApproval: async () => 'approved'
      }
    );

    expect(result.toolName).toBe('run_command');
    expect(result.isError).toBe(false);
    expect(result.content).toContain('export const value = 1;');
  });

  maybeWindowsIt('allows non-network commands when the workspace network policy disables host network access', async () => {
    const workspace = createWorkspace({});
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'run_command',
        arguments: {
          command: 'echo hello'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        runtimeNetworkPolicy: 'disabled',
        requestApproval: async () => 'approved'
      }
    );

    expect(result.toolName).toBe('run_command');
    expect(result.isError).toBe(false);
    expect(result.content).toContain('stdout:\nhello');
  });

  it('blocks run_command under default permissions with a clear policy error', async () => {
    const workspace = createWorkspace({});
    const onInfo = vi.fn();
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'run_command',
        arguments: {
          command: 'dir'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'default',
        onInfo
      }
    );

    expect(result).toEqual({
      toolName: 'run_command',
      content:
        'run_command requires Full access. Approved commands start in the workspace, run on the local host, and use isolated temp home/appdata directories by default, but they are not sandboxed to it.',
      isError: true
    });
    expect(onInfo.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'tool_call',
          toolName: 'run_command',
          summary: 'Calling run_command'
        })
      })
    );
    expect(onInfo.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'tool_result',
          toolName: 'run_command',
          summary: 'Failed run_command',
          status: 'error',
          text: 'run_command requires Full access. Approved commands start in the workspace, run on the local host, and use isolated temp home/appdata directories by default, but they are not sandboxed to it.'
        })
      })
    );
  });

  it('blocks run_command when full access lacks an approval handler', async () => {
    const workspace = createWorkspace({});
    const onInfo = vi.fn();
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'run_command',
        arguments: {
          command: 'dir'
        }
      },
      {
        workspaceRoot: workspace,
        executionPermission: 'full_access',
        onInfo
      }
    );

    expect(result).toEqual({
      toolName: 'run_command',
      content:
        'run_command requires a runtime approval handler, but none is available for this run.',
      isError: true
    });
    expect(onInfo.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        activity: expect.objectContaining({
          kind: 'tool_result',
          toolName: 'run_command',
          summary: 'Failed run_command',
          status: 'error',
          text: 'run_command requires a runtime approval handler, but none is available for this run.'
        })
      })
    );
  });

  it('filters the runtime tool catalog through the provided execution constraints', async () => {
    const service = new AgentRuntimeService();

    const catalog = await service.listToolCatalog({
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
      runtimeNetworkPolicy: 'enabled'
    });

    expect(catalog.tools.some((tool) => tool.callName === 'read_file')).toBe(true);
    expect(catalog.tools.some((tool) => tool.callName === 'web_search')).toBe(false);
    expect(catalog.tools.some((tool) => tool.callName === 'write_file')).toBe(false);
    expect(catalog.tools.some((tool) => tool.callName === 'run_command')).toBe(false);
  });

  it('rejects tool execution when the active execution constraints disallow the tool', async () => {
    const workspace = createWorkspace({
      'src/example.ts': 'export const value = 1;\n'
    });
    const service = new AgentRuntimeService();

    const result = await service.executeToolCall(
      {
        name: 'write_file',
        arguments: {
          path: 'src/example.ts',
          content: 'export const value = 2;\n'
        }
      },
      {
        workspaceRoot: workspace,
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
        }
      }
    );

    expect(result).toEqual({
      toolName: 'write_file',
      content: 'Tool write_file is not available under the active execution constraints.',
      isError: true
    });
  });

  it('spawns bounded background helpers through the native delegation tool', async () => {
    const workspace = createWorkspace({});
    const service = new AgentRuntimeService();
    const spawn = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'subagent-1',
        parentThreadId: 'thread-1',
        parentRunId: 'run-1',
        childThreadId: 'thread-child-1',
        childRunId: 'run-child-1',
        name: 'Locke',
        title: 'Inspect auth flow',
        prompt: 'Inspect the auth flow and report back.',
        providerId: 'ollama',
        modelId: 'qwen3-coder',
        executionPermission: 'default',
        delegationProfile: 'research',
        status: 'running',
        outputSummary: null,
        lastError: null,
        createdAt: '2026-04-18T00:00:00.000Z',
        updatedAt: '2026-04-18T00:00:00.000Z',
        startedAt: '2026-04-18T00:00:00.000Z',
        completedAt: null
      })
      .mockResolvedValueOnce({
        id: 'subagent-2',
        parentThreadId: 'thread-1',
        parentRunId: 'run-1',
        childThreadId: 'thread-child-2',
        childRunId: 'run-child-2',
        name: 'Bohr',
        title: 'Verify edge cases',
        prompt: 'Verify edge cases and report back.',
        providerId: 'ollama',
        modelId: 'qwen3-coder',
        executionPermission: 'default',
        delegationProfile: 'verify',
        status: 'running',
        outputSummary: null,
        lastError: null,
        createdAt: '2026-04-18T00:00:00.000Z',
        updatedAt: '2026-04-18T00:00:00.000Z',
        startedAt: '2026-04-18T00:00:00.000Z',
        completedAt: null
      });
    service.setSubagents({
      listForThread: () => [],
      spawn
    });

    const result = await service.executeToolCall(
      {
        name: 'spawn_subagents',
        arguments: {
          tasks: [
            {
              title: 'Inspect auth flow',
              prompt: 'Inspect the auth flow and report back.'
            },
            {
              name: 'Bohr',
              title: 'Verify edge cases',
              prompt: 'Verify edge cases and report back.',
              delegation_profile: 'verify',
              reasoning_effort: 'medium'
            }
          ]
        }
      },
      {
        workspaceRoot: workspace,
        threadId: 'thread-1',
        runId: 'run-1',
        executionPermission: 'default'
      }
    );

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        parentThreadId: 'thread-1',
        parentRunId: 'run-1',
        title: 'Inspect auth flow',
        prompt: 'Inspect the auth flow and report back.',
        delegationProfile: 'research',
        reasoningEffort: null,
        executionPermission: 'default'
      })
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        parentThreadId: 'thread-1',
        parentRunId: 'run-1',
        name: 'Bohr',
        title: 'Verify edge cases',
        prompt: 'Verify edge cases and report back.',
        delegationProfile: 'verify',
        reasoningEffort: 'medium',
        executionPermission: 'default'
      })
    );
    expect(result).toEqual({
      toolName: 'spawn_subagents',
      content: [
        'Spawned 2 delegated helpers:',
        '- Locke: Inspect auth flow [research, running]',
        '- Bohr: Verify edge cases [verify, running]',
        'These helpers are running in the background. Continue the parent task without waiting unless their findings are immediately required.'
      ].join('\n')
    });
  });

  it('blocks delegated helper spawns when the execution constraints disallow delegation', async () => {
    const workspace = createWorkspace({});
    const service = new AgentRuntimeService();
    const spawn = vi.fn();
    service.setSubagents({
      listForThread: () => [],
      spawn
    });

    const result = await service.executeToolCall(
      {
        name: 'spawn_subagents',
        arguments: {
          tasks: [
            {
              title: 'Inspect auth flow',
              prompt: 'Inspect the auth flow and report back.'
            }
          ]
        }
      },
      {
        workspaceRoot: workspace,
        threadId: 'thread-1',
        runId: 'run-1',
        executionPermission: 'default',
        executionConstraints: {
          permissionMode: 'default',
          toolPolicy: {
            preset: 'builder',
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
        }
      }
    );

    expect(spawn).not.toHaveBeenCalled();
    expect(result).toEqual({
      toolName: 'spawn_subagents',
      content: 'spawn_subagents is disabled for delegated helper runs.',
      isError: true
    });
  });
});
