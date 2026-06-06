import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  McpCatalogSnapshot,
  McpServerConnectionStatus,
  McpServerDefinition
} from '../../../shared/domain';
import { emptyCatalogSnapshot, normalizePromptCatalog, normalizeResourceCatalog, normalizeToolCatalog } from './catalog';

export interface McpConnectionRefreshResult {
  status: McpServerConnectionStatus;
  capabilities: Record<string, unknown> | null;
  lastSeenAt: string | null;
  lastError: string | null;
  catalog: McpCatalogSnapshot;
}

function redactValue(value: string, secret: string) {
  const trimmedSecret = secret.trim();
  if (!trimmedSecret) {
    return value;
  }

  const bearerMatch = /^Bearer\s+(.+)$/iu.exec(trimmedSecret);
  if (bearerMatch?.[1]) {
    return value.split(trimmedSecret).join('Bearer [REDACTED]');
  }

  return value.split(trimmedSecret).join('[REDACTED]');
}

function validateRemoteHeaders(headers: Record<string, string>) {
  for (const [key, value] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(key) || /[\r\n]/u.test(value)) {
      throw new Error(`Invalid MCP remote header "${key}". Header names must be HTTP tokens and values cannot contain line breaks.`);
    }
  }
}

function readMcpListResponseArray(response: unknown, key: 'tools' | 'resources' | 'prompts', label: string) {
  if (!response || typeof response !== 'object' || !Array.isArray((response as Record<string, unknown>)[key])) {
    throw new Error(`Remote MCP server returned a malformed ${label}: expected "${key}" array.`);
  }

  return (response as Record<typeof key, unknown[]>)[key];
}

export class McpServerClient {
  private client: Client | null = null;
  private transport: Transport | null = null;
  private stderrOutput = '';

  constructor(
    private readonly definition: McpServerDefinition,
    private readonly clientInfo: { name: string; version: string }
  ) {}

  async refreshCatalog(): Promise<McpConnectionRefreshResult> {
    if (!this.definition.enabled) {
      await this.close();
      return {
        status: 'disabled',
        capabilities: null,
        lastSeenAt: null,
        lastError: null,
        catalog: {
          ...emptyCatalogSnapshot(),
          refreshedAt: new Date().toISOString()
        }
      };
    }

    try {
      await this.ensureConnected();
      const now = new Date().toISOString();
      const capabilities = (this.client?.getServerCapabilities() as Record<string, unknown> | undefined) ?? null;
      const tools =
        this.client && capabilities && 'tools' in capabilities
          ? normalizeToolCatalog(this.definition, readMcpListResponseArray(await this.client.listTools(), 'tools', 'tool catalog'))
          : [];
      const resources =
        this.client && capabilities && 'resources' in capabilities
          ? normalizeResourceCatalog(this.definition, readMcpListResponseArray(await this.client.listResources(), 'resources', 'resource catalog'))
          : [];
      const prompts =
        this.client && capabilities && 'prompts' in capabilities
          ? normalizePromptCatalog(this.definition, readMcpListResponseArray(await this.client.listPrompts(), 'prompts', 'prompt catalog'))
          : [];

      return {
        status: 'connected',
        capabilities,
        lastSeenAt: now,
        lastError: null,
        catalog: {
          tools,
          resources,
          prompts,
          refreshedAt: now
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stderr = this.stderrOutput.trim();
      const lastError = this.formatDiagnostic(stderr ? `${message}\n${stderr}` : message);
      await this.close();
      return {
        status: 'error',
        capabilities: null,
        lastSeenAt: null,
        lastError,
        catalog: {
          ...emptyCatalogSnapshot(),
          refreshedAt: new Date().toISOString()
        }
      };
    }
  }

  async callTool(name: string, args: Record<string, unknown>) {
    await this.ensureConnected();
    if (!this.client) {
      throw new Error('MCP client is not connected.');
    }

    const result = await this.client.callTool({
      name,
      arguments: args
    }) as { content?: unknown };
    if (!result || typeof result !== 'object' || !Array.isArray(result.content)) {
      throw new Error('Remote MCP tool returned a malformed response: expected content array.');
    }

    return result as { content: Array<Record<string, unknown>> };
  }

  async close() {
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    this.stderrOutput = '';
    if (transport) {
      await transport.close().catch(() => {});
    }
  }

  private async ensureConnected() {
    if (this.client && this.transport) {
      return;
    }

    const transport = this.createTransport();

    const client = new Client({
      name: this.clientInfo.name,
      version: this.clientInfo.version
    });
    client.onerror = (error) => {
      this.stderrOutput += `${error.message}\n`;
    };

    await client.connect(transport);
    this.transport = transport;
    this.client = client;
  }

  private createTransport(): Transport {
    if (this.definition.transportType === 'streamable_http') {
      if (!this.definition.url) {
        throw new Error('MCP streamable HTTP server URL is required.');
      }
      validateRemoteHeaders(this.definition.headers);
      return new StreamableHTTPClientTransport(new URL(this.definition.url), {
        requestInit: {
          headers: this.definition.headers
        }
      });
    }

    if (this.definition.transportType === 'sse') {
      if (!this.definition.url) {
        throw new Error('MCP SSE server URL is required.');
      }
      validateRemoteHeaders(this.definition.headers);
      return new SSEClientTransport(new URL(this.definition.url), {
        requestInit: {
          headers: this.definition.headers
        },
        eventSourceInit: {
          fetch: async (url, init = {}) => fetch(url, {
            ...init,
            headers: {
              ...Object.fromEntries(new Headers(init.headers).entries()),
              ...this.definition.headers
            }
          })
        }
      });
    }

    const transport = new StdioClientTransport({
      command: this.definition.command,
      args: this.definition.args,
      cwd: this.definition.cwd ?? undefined,
      env: Object.keys(this.definition.env).length > 0 ? this.definition.env : undefined,
      stderr: 'pipe'
    });
    transport.stderr?.on('data', (chunk) => {
      this.stderrOutput += chunk.toString();
    });
    return transport;
  }

  private redactSecrets(message: string) {
    return [...Object.values(this.definition.headers), ...Object.values(this.definition.env)].reduce(
      (redacted, value) => redactValue(redacted, value),
      message
    );
  }

  private formatDiagnostic(message: string) {
    const redacted = this.redactSecrets(message);
    if (this.definition.transportType === 'stdio') {
      return redacted;
    }

    const lower = redacted.toLowerCase();
    if (lower.includes('invalid mcp remote header') || lower.includes('headers must')) {
      return `Remote MCP headers are invalid. ${redacted}`;
    }
    if (/(\b401\b|\b403\b|unauthorized|forbidden|expired|invalid api key|invalid token|authentication)/iu.test(redacted)) {
      return `Remote MCP authentication failed. Check static headers or rotate the expired key. ${redacted}`;
    }
    if (this.definition.transportType === 'sse' && /(sse|eventsource|event source|stream).*(disconnect|closed|terminated|aborted|reset)|connection (closed|terminated|reset)/iu.test(redacted)) {
      return `Remote MCP SSE connection disconnected before catalog refresh completed. ${redacted}`;
    }
    if (/(econnrefused|enotfound|getaddrinfo|fetch failed|network error|timed out|timeout|\b502\b|\b503\b|\b504\b|service unavailable)/iu.test(redacted)) {
      return `Remote MCP endpoint is unavailable. Check the URL and network reachability. ${redacted}`;
    }
    if (/malformed .*catalog|malformed response|expected .*array/iu.test(redacted)) {
      return `Remote MCP response was malformed. ${redacted}`;
    }

    return redacted;
  }
}
