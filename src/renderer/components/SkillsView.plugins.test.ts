import { describe, expect, it } from 'vitest';

import {
  buildPluginCatalogSections,
  filterConfiguredMcpServersForQuery,
  filterOfficialMcpCatalogForQuery,
  formatMcpServerConnectionDiagnostic,
  findConfiguredMcpServer,
  findOfficialEntryForServer
} from './SkillsView.plugins';
import type { McpCatalogSnapshot, McpServerView } from '../../shared/domain';
import type { CuratedMcpCatalogEntry } from '../../shared/curatedCatalog';

describe('SkillsView plugin helpers', () => {
  const now = '2026-05-22T00:00:00.000Z';

  function createCatalogEntry(input: Partial<CuratedMcpCatalogEntry> & { id: string; name: string }): CuratedMcpCatalogEntry {
    return {
      id: input.id,
      name: input.name,
      publisher: input.publisher ?? 'Vicode',
      description: input.description ?? `${input.name} integration.`,
      docsUrl: input.docsUrl ?? `https://example.com/${input.id}`,
      category: input.category ?? 'backend',
      supportState: input.supportState ?? 'supported',
      transport: input.transport ?? 'stdio',
      command: input.command,
      args: input.args,
      envVars: input.envVars ?? [],
      setupNotes: input.setupNotes ?? []
    };
  }

  function createServer(input: Partial<McpServerView> & { id: string; name: string; command: string; args?: string[] }): McpServerView {
    return {
      id: input.id,
      name: input.name,
      scope: input.scope ?? 'global',
      projectId: input.projectId ?? null,
      transportType: input.transportType ?? 'stdio',
      command: input.command,
      args: input.args ?? [],
      cwd: input.cwd ?? null,
      enabled: input.enabled ?? true,
      toolInvocationMode: input.toolInvocationMode ?? 'ask',
      launchApproved: input.launchApproved ?? true,
      envKeys: input.envKeys ?? [],
      url: input.url ?? null,
      headerKeys: input.headerKeys ?? [],
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      state: input.state ?? {
        serverId: input.id,
        status: 'connected',
        capabilities: null,
        lastSeenAt: now,
        lastError: null,
        toolCount: 0,
        resourceCount: 0,
        promptCount: 0,
        updatedAt: now
      }
    };
  }

  function createMcpCatalog(): McpCatalogSnapshot {
    return {
      tools: [
        {
          serverId: 'server-1',
          serverName: 'Server One',
          name: 'semantic_search',
          title: null,
          description: null,
          inputSchema: null,
          invocationMode: 'ask',
          requiresApproval: true
        }
      ],
      resources: [],
      prompts: [],
      refreshedAt: now
    };
  }

  it('matches configured servers to official plugin entries', () => {
    const catalog = [
      createCatalogEntry({ id: 'internal-analysis', name: 'Internal Analysis' }),
      createCatalogEntry({ id: 'playwright', name: 'Playwright', command: 'npx', args: ['@playwright/mcp'] })
    ];
    const servers = [
      createServer({
        id: 'internal',
        name: 'Internal Analysis',
        command: 'node',
        args: ['--vicode-internal-analysis-server'],
        projectId: 'project-1'
      }),
      createServer({
        id: 'playwright-server',
        name: 'Playwright',
        command: 'NPX',
        args: ['@playwright/mcp']
      })
    ];

    expect(findConfiguredMcpServer(catalog, servers, 'internal-analysis', 'project-1')?.id).toBe('internal');
    expect(findConfiguredMcpServer(catalog, servers, 'internal-analysis', 'other-project')).toBeNull();
    expect(findConfiguredMcpServer(catalog, servers, 'playwright', null)?.id).toBe('playwright-server');
    expect(findOfficialEntryForServer(catalog, servers[1])?.id).toBe('playwright');
  });

  it('filters plugin catalog and configured servers by searchable metadata', () => {
    const catalog = [
      createCatalogEntry({ id: 'playwright', name: 'Playwright', description: 'Browser automation', command: 'npx', args: ['@playwright/mcp'] }),
      createCatalogEntry({ id: 'stripe', name: 'Stripe', description: 'Payments tooling' })
    ];
    const servers = [
      createServer({ id: 'server-1', name: 'Local Tools', command: 'node', args: ['server.js'] })
    ];

    expect(filterOfficialMcpCatalogForQuery(catalog, 'payments').map((entry) => entry.id)).toEqual(['stripe']);
    expect(filterConfiguredMcpServersForQuery(servers, catalog, createMcpCatalog(), 'semantic').map((server) => server.id)).toEqual(['server-1']);
  });

  it('formats remote MCP diagnostics without header values and makes errors searchable', () => {
    const server = createServer({
      id: 'remote-error',
      name: 'Remote Error',
      command: '',
      transportType: 'streamable_http',
      url: 'https://mcp.example.com/mcp',
      headerKeys: ['Authorization'],
      state: {
        serverId: 'remote-error',
        status: 'error',
        capabilities: null,
        lastSeenAt: null,
        lastError: 'Remote MCP authentication failed. Check static headers or rotate the expired key. Bearer [REDACTED]',
        toolCount: 0,
        resourceCount: 0,
        promptCount: 0,
        updatedAt: now
      }
    });

    expect(formatMcpServerConnectionDiagnostic(server)).toBe(
      'Streamable HTTP diagnostic: Remote MCP authentication failed. Check static headers or rotate the expired key. Bearer [REDACTED] Endpoint: https://mcp.example.com/mcp. Header keys: Authorization.'
    );
    expect(JSON.stringify(server)).not.toContain('remote-secret');
    expect(filterConfiguredMcpServersForQuery([server], [], null, 'expired key').map((entry) => entry.id)).toEqual(['remote-error']);
  });

  it('groups supported plugins as featured and planned plugins by product category', () => {
    const sections = buildPluginCatalogSections([
      createCatalogEntry({ id: 'supported', name: 'Supported', supportState: 'supported', category: 'backend' }),
      createCatalogEntry({ id: 'coding', name: 'Coding', supportState: 'planned', category: 'ui' }),
      createCatalogEntry({ id: 'design', name: 'Design', supportState: 'planned', category: 'component-system' }),
      createCatalogEntry({ id: 'collab', name: 'Collab', supportState: 'planned', category: 'collaboration' })
    ]);

    expect(sections.featuredEntries.map((entry) => entry.id)).toEqual(['supported']);
    expect(sections.sections.map((section) => [section.title, section.entries.map((entry) => entry.id)])).toEqual([
      ['Coding', ['coding']],
      ['Design', ['design']],
      ['Collaboration', ['collab']]
    ]);
  });
});
