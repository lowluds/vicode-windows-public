import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
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

export class McpServerClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
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
          ? normalizeToolCatalog(this.definition, (await this.client.listTools()).tools)
          : [];
      const resources =
        this.client && capabilities && 'resources' in capabilities
          ? normalizeResourceCatalog(this.definition, (await this.client.listResources()).resources)
          : [];
      const prompts =
        this.client && capabilities && 'prompts' in capabilities
          ? normalizePromptCatalog(this.definition, (await this.client.listPrompts()).prompts)
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
      await this.close();
      return {
        status: 'error',
        capabilities: null,
        lastSeenAt: null,
        lastError: stderr ? `${message}\n${stderr}` : message,
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

    return await this.client.callTool({
      name,
      arguments: args
    });
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
}
