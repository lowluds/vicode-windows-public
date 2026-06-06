import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpServerDefinition } from '../../../shared/domain';

const captured = vi.hoisted(() => ({
  clientConnectError: null as Error | null,
  clientRuntimeErrorOnConnect: null as Error | null,
  clientListToolsError: null as Error | null,
  clientListToolsResponse: null as unknown,
  clientCallToolResponse: null as unknown,
  streamableHttp: [] as Array<{ url: string; options: Record<string, unknown> }>,
  sse: [] as Array<{ url: string; options: Record<string, unknown> }>
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    onerror?: (error: Error) => void;

    constructor(readonly info: { name: string; version: string }) {}

    async connect() {
      if (captured.clientConnectError) {
        throw captured.clientConnectError;
      }
      if (captured.clientRuntimeErrorOnConnect) {
        this.onerror?.(captured.clientRuntimeErrorOnConnect);
      }
    }

    getServerCapabilities() {
      return {
        tools: {}
      };
    }

    async listTools() {
      if (captured.clientListToolsError) {
        throw captured.clientListToolsError;
      }
      if (captured.clientListToolsResponse) {
        return captured.clientListToolsResponse;
      }
      return {
        tools: []
      };
    }

    async callTool() {
      return captured.clientCallToolResponse ?? {
        content: [
          {
            type: 'text',
            text: 'ok'
          }
        ]
      };
    }

    async close() {}
  }
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(url: URL, options: Record<string, unknown>) {
      captured.streamableHttp.push({
        url: url.toString(),
        options
      });
    }

    async close() {}
  }
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class {
    constructor(url: URL, options: Record<string, unknown>) {
      captured.sse.push({
        url: url.toString(),
        options
      });
    }

    async close() {}
  }
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    stderr = {
      on: vi.fn()
    };

    async close() {}
  }
}));

import { McpServerClient } from './client';

function createDefinition(overrides: Partial<McpServerDefinition>): McpServerDefinition {
  return {
    id: 'server-1',
    name: 'Remote MCP',
    scope: 'global',
    projectId: null,
    transportType: 'streamable_http',
    command: '',
    args: [],
    cwd: null,
    env: {},
    url: 'https://mcp.example.com/mcp',
    headers: {},
    enabled: true,
    toolInvocationMode: 'ask',
    launchApproved: true,
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:00:00.000Z',
    ...overrides
  };
}

describe('McpServerClient remote transports', () => {
  afterEach(() => {
    captured.clientConnectError = null;
    captured.clientRuntimeErrorOnConnect = null;
    captured.clientListToolsError = null;
    captured.clientListToolsResponse = null;
    captured.clientCallToolResponse = null;
  });

  it('connects streamable HTTP MCP servers with configured headers', async () => {
    captured.streamableHttp.length = 0;
    const client = new McpServerClient(
      createDefinition({
        transportType: 'streamable_http',
        headers: {
          Authorization: 'Bearer test-token'
        }
      }),
      { name: 'vicode-test', version: '0.0.0' }
    );

    const result = await client.refreshCatalog();

    expect(result.status).toBe('connected');
    expect(captured.streamableHttp).toHaveLength(1);
    expect(captured.streamableHttp[0]).toMatchObject({
      url: 'https://mcp.example.com/mcp',
      options: {
        requestInit: {
          headers: {
            Authorization: 'Bearer test-token'
          }
        }
      }
    });
  });

  it('connects legacy SSE MCP servers with configured headers on SSE and POST requests', async () => {
    captured.sse.length = 0;
    const client = new McpServerClient(
      createDefinition({
        transportType: 'sse',
        url: 'https://mcp.example.com/sse',
        headers: {
          'X-API-Key': 'test-token'
        }
      }),
      { name: 'vicode-test', version: '0.0.0' }
    );

    const result = await client.refreshCatalog();

    expect(result.status).toBe('connected');
    expect(captured.sse).toHaveLength(1);
    expect(captured.sse[0]?.url).toBe('https://mcp.example.com/sse');
    expect(captured.sse[0]?.options).toMatchObject({
      requestInit: {
        headers: {
          'X-API-Key': 'test-token'
        }
      }
    });
    expect(captured.sse[0]?.options).toHaveProperty('eventSourceInit.fetch');
  });

  it('merges configured SSE headers when the SDK fetches without an init object', async () => {
    captured.sse.length = 0;
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response('ok'));
    globalThis.fetch = fetchMock as never;
    try {
      const client = new McpServerClient(
        createDefinition({
          transportType: 'sse',
          url: 'https://mcp.example.com/sse',
          headers: {
            Authorization: 'Bearer remote-secret'
          }
        }),
        { name: 'vicode-test', version: '0.0.0' }
      );

      await client.refreshCatalog();
      const options = captured.sse[0]?.options as {
        eventSourceInit?: {
          fetch?: (url: string, init?: RequestInit) => Promise<Response>;
        };
      };
      await options.eventSourceInit?.fetch?.('https://mcp.example.com/events');

      expect(fetchMock).toHaveBeenCalledWith('https://mcp.example.com/events', {
        headers: {
          Authorization: 'Bearer remote-secret'
        }
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('redacts remote MCP header values from connection errors', async () => {
    captured.clientConnectError = new Error('failed with Bearer remote-secret');
    const client = new McpServerClient(
      createDefinition({
        transportType: 'streamable_http',
        headers: {
          Authorization: 'Bearer remote-secret'
        }
      }),
      { name: 'vicode-test', version: '0.0.0' }
    );

    const result = await client.refreshCatalog();

    expect(result.status).toBe('error');
    expect(result.lastError).toContain('Bearer [REDACTED]');
    expect(result.lastError).not.toContain('remote-secret');
  });

  it('reports invalid remote headers without exposing header values', async () => {
    const client = new McpServerClient(
      createDefinition({
        transportType: 'streamable_http',
        headers: {
          'Bad Header': 'secret-token'
        }
      }),
      { name: 'vicode-test', version: '0.0.0' }
    );

    const result = await client.refreshCatalog();

    expect(result.status).toBe('error');
    expect(result.lastError).toContain('Remote MCP headers are invalid.');
    expect(result.lastError).toContain('Bad Header');
    expect(result.lastError).not.toContain('secret-token');
  });

  it('classifies expired or rejected static header keys as authentication failures', async () => {
    captured.clientConnectError = new Error('HTTP 401 Unauthorized for Bearer remote-secret');
    const client = new McpServerClient(
      createDefinition({
        transportType: 'streamable_http',
        headers: {
          Authorization: 'Bearer remote-secret'
        }
      }),
      { name: 'vicode-test', version: '0.0.0' }
    );

    const result = await client.refreshCatalog();

    expect(result.status).toBe('error');
    expect(result.lastError).toContain('Remote MCP authentication failed.');
    expect(result.lastError).toContain('rotate the expired key');
    expect(result.lastError).toContain('Bearer [REDACTED]');
    expect(result.lastError).not.toContain('remote-secret');
  });

  it('classifies unavailable remote endpoints', async () => {
    captured.clientConnectError = new Error('fetch failed ECONNREFUSED 127.0.0.1:9');
    const client = new McpServerClient(
      createDefinition({
        transportType: 'streamable_http'
      }),
      { name: 'vicode-test', version: '0.0.0' }
    );

    const result = await client.refreshCatalog();

    expect(result.status).toBe('error');
    expect(result.lastError).toContain('Remote MCP endpoint is unavailable.');
    expect(result.lastError).toContain('Check the URL and network reachability.');
  });

  it('classifies SSE disconnects and redacts static headers', async () => {
    captured.clientRuntimeErrorOnConnect = new Error('SSE stream disconnected Bearer remote-secret');
    captured.clientListToolsError = new Error('connection closed before catalog refresh');
    const client = new McpServerClient(
      createDefinition({
        transportType: 'sse',
        url: 'https://mcp.example.com/sse',
        headers: {
          Authorization: 'Bearer remote-secret'
        }
      }),
      { name: 'vicode-test', version: '0.0.0' }
    );

    const result = await client.refreshCatalog();

    expect(result.status).toBe('error');
    expect(result.lastError).toContain('Remote MCP SSE connection disconnected');
    expect(result.lastError).toContain('Bearer [REDACTED]');
    expect(result.lastError).not.toContain('remote-secret');
  });

  it('reports malformed remote catalog responses', async () => {
    captured.clientListToolsResponse = {
      tools: null
    };
    const client = new McpServerClient(
      createDefinition({
        transportType: 'streamable_http'
      }),
      { name: 'vicode-test', version: '0.0.0' }
    );

    const result = await client.refreshCatalog();

    expect(result.status).toBe('error');
    expect(result.lastError).toContain('Remote MCP response was malformed.');
    expect(result.lastError).toContain('tool catalog');
  });

  it('rejects malformed remote tool responses', async () => {
    captured.clientCallToolResponse = {
      content: null
    };
    const client = new McpServerClient(
      createDefinition({
        transportType: 'streamable_http'
      }),
      { name: 'vicode-test', version: '0.0.0' }
    );

    await client.refreshCatalog();

    await expect(client.callTool('broken_tool', {})).rejects.toThrow('Remote MCP tool returned a malformed response');
  });

  it('redacts stdio MCP env values from connection errors', async () => {
    captured.clientConnectError = new Error('failed with env-secret');
    const client = new McpServerClient(
      createDefinition({
        transportType: 'stdio',
        command: 'node',
        env: {
          MCP_API_KEY: 'env-secret'
        }
      }),
      { name: 'vicode-test', version: '0.0.0' }
    );

    const result = await client.refreshCatalog();

    expect(result.status).toBe('error');
    expect(result.lastError).toContain('[REDACTED]');
    expect(result.lastError).not.toContain('env-secret');
  });
});
