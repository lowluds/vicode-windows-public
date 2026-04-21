import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type {
  McpCatalogSnapshot,
  McpPermissionMode,
  McpServerRecord,
  McpServerScope,
  McpServerSaveInput,
  McpServerView
} from '../../../shared/domain';
import { officialMcpCatalog } from '../../../shared/curatedCatalog';
import type { AppEvent } from '../../../shared/events';
import { DatabaseService } from '../../../storage/database';
import { emptyCatalogSnapshot } from './catalog';
import { McpServerClient } from './client';
import {
  buildInternalAnalysisServerInput,
  INTERNAL_ANALYSIS_MCP_ID,
  isInternalAnalysisServerInput
} from './internal-analysis';

const FILE_BACKED_PLUGIN_ID_PREFIX = 'file-plugin';

type FileBackedPluginBundle = {
  folderName: string;
  scope: McpServerScope;
  projectId: string | null;
  rootPath: string;
  manifestPath: string;
  mcpPath: string;
};

type FileBackedPluginManifest = {
  name?: string;
  description?: string;
};

type FileBackedPluginConfig = {
  name?: string;
  command: string;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
  enabled: boolean;
  toolInvocationMode: McpPermissionMode;
  launchApproved: boolean;
};

function safeDelete(path: string) {
  rmSync(path, { recursive: true, force: true });
}

function parseFileBackedPluginManifest(raw: string): FileBackedPluginManifest | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const candidate = parsed as Record<string, unknown>;
    return {
      name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name : undefined,
      description:
        typeof candidate.description === 'string' && candidate.description.trim()
          ? candidate.description
          : undefined
    };
  } catch {
    return null;
  }
}

function isPermissionMode(value: unknown): value is McpPermissionMode {
  return value === 'ask' || value === 'allow' || value === 'deny';
}

function parseEnvRecord(value: unknown) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      typeof entry === 'string' ? [[key, entry] as const] : []
    )
  );
}

function parseFileBackedPluginConfig(raw: string): FileBackedPluginConfig | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const root = parsed as Record<string, unknown>;
    const candidate =
      root.mcpServer && typeof root.mcpServer === 'object'
        ? (root.mcpServer as Record<string, unknown>)
        : root.server && typeof root.server === 'object'
          ? (root.server as Record<string, unknown>)
          : root;
    const command = typeof candidate.command === 'string' ? candidate.command.trim() : '';
    if (!command) {
      return null;
    }

    return {
      name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name : undefined,
      command,
      args: Array.isArray(candidate.args)
        ? candidate.args.flatMap((value) => (typeof value === 'string' ? [value] : []))
        : [],
      cwd: typeof candidate.cwd === 'string' && candidate.cwd.trim() ? candidate.cwd : null,
      env: parseEnvRecord(candidate.env),
      enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : true,
      toolInvocationMode: isPermissionMode(candidate.toolInvocationMode) ? candidate.toolInvocationMode : 'ask',
      launchApproved: typeof candidate.launchApproved === 'boolean' ? candidate.launchApproved : false
    };
  } catch {
    return null;
  }
}

export class McpRegistryService {
  private readonly emitter = new EventEmitter();
  private readonly connections = new Map<string, McpServerClient>();
  private readonly catalogs = new Map<string, McpCatalogSnapshot>();
  private readonly appRoot: string;
  private readonly pluginRoot: string | null;

  constructor(
    private readonly db: DatabaseService,
    private readonly clientInfo: { name: string; version: string },
    options: { appRoot?: string; statePath?: string } = {}
  ) {
    this.appRoot = options.appRoot ?? process.cwd();
    this.pluginRoot = options.statePath ? join(options.statePath, 'plugins') : null;
    if (this.pluginRoot) {
      mkdirSync(join(this.pluginRoot, 'user'), { recursive: true });
      mkdirSync(join(this.pluginRoot, 'project'), { recursive: true });
    }
  }

  async initialize() {
    await this.syncImports();
    for (const server of this.db.listMcpServers()) {
      if (server.definition.enabled) {
        await this.refreshServer(server.definition.id);
      }
    }
  }

  async dispose() {
    for (const connection of this.connections.values()) {
      await connection.close();
    }
    this.connections.clear();
    this.catalogs.clear();
    this.emitter.removeAllListeners('event');
  }

  listServers() {
    return this.db.listMcpServers();
  }

  listServerViews(): McpServerView[] {
    return this.db.listMcpServers().map((server) => ({
      id: server.definition.id,
      name: server.definition.name,
      scope: server.definition.scope,
      projectId: server.definition.projectId,
      transportType: server.definition.transportType,
      command: server.definition.command,
      args: server.definition.args,
      cwd: server.definition.cwd,
      enabled: server.definition.enabled,
      toolInvocationMode: server.definition.toolInvocationMode,
      launchApproved: server.definition.launchApproved,
      envKeys: Object.keys(server.definition.env).sort(),
      createdAt: server.definition.createdAt,
      updatedAt: server.definition.updatedAt,
      state: server.state
    }));
  }

  async syncImports(): Promise<void> {
    if (!this.pluginRoot) {
      return;
    }

    const seenIds = new Set<string>();
    for (const bundle of this.listFileBackedPluginBundles()) {
      const manifest = parseFileBackedPluginManifest(readFileSync(bundle.manifestPath, 'utf8'));
      const config = parseFileBackedPluginConfig(readFileSync(bundle.mcpPath, 'utf8'));
      if (!config) {
        continue;
      }

      const id = this.buildFileBackedPluginId(bundle.scope, bundle.folderName, bundle.projectId);
      seenIds.add(id);
      await this.saveServer({
        id,
        name: manifest?.name?.trim() || config.name?.trim() || bundle.folderName,
        scope: bundle.scope,
        projectId: bundle.scope === 'project' ? bundle.projectId : null,
        transportType: 'stdio',
        command: config.command,
        args: config.args,
        cwd: config.cwd ?? bundle.rootPath,
        env: config.env,
        enabled: config.enabled,
        toolInvocationMode: config.toolInvocationMode,
        launchApproved: config.launchApproved
      });
    }

    for (const server of this.db.listMcpServers()) {
      if (!server.definition.id.startsWith(`${FILE_BACKED_PLUGIN_ID_PREFIX}:`)) {
        continue;
      }
      if (seenIds.has(server.definition.id)) {
        continue;
      }
      await this.removeServer(server.definition.id);
    }
  }

  async saveServerView(input: McpServerSaveInput): Promise<McpServerView> {
    const record = await this.saveServer(input);
    return this.requireServerView(record.definition.id, 'Failed to save MCP server.');
  }

  async setupRecommendedServer(entryId: string, projectId?: string | null): Promise<McpServerView> {
    const entry = officialMcpCatalog.find((candidate) => candidate.id === entryId);
    if (!entry) {
      throw new Error('Unknown MCP recommendation.');
    }

    if (entry.id === INTERNAL_ANALYSIS_MCP_ID) {
      if (!projectId) {
        throw new Error('Select a trusted project before adding the internal analysis MCP.');
      }

      const existing = this.listServers().find((server) =>
        server.definition.projectId === projectId
        && isInternalAnalysisServerInput({ args: server.definition.args })
      );

      const saved = await this.saveServer(
        buildInternalAnalysisServerInput(this.db, projectId, existing?.definition.id, { appRoot: this.appRoot })
      );
      return this.requireServerView(saved.definition.id, 'Failed to create internal analysis MCP.');
    }

    if (entry.supportState !== 'supported' || entry.transport !== 'stdio' || !entry.command) {
      throw new Error(`${entry.name} is not available in Vicode yet.`);
    }

    const existing = this.listServers().find((server) => {
      const definition = server.definition;
      return (
        definition.command.toLowerCase() === entry.command.toLowerCase() &&
        JSON.stringify(definition.args) === JSON.stringify(entry.args ?? [])
      );
    });

    if (existing) {
      if (!existing.definition.enabled) {
        await this.saveServer({
          id: existing.definition.id,
          name: existing.definition.name,
          scope: existing.definition.scope,
          projectId: existing.definition.projectId,
          transportType: existing.definition.transportType,
          command: existing.definition.command,
          args: existing.definition.args,
          cwd: existing.definition.cwd,
          env: existing.definition.env,
          enabled: true,
          toolInvocationMode: existing.definition.toolInvocationMode,
          launchApproved: existing.definition.launchApproved
        });
      }

      const refreshed = this.listServerViews().find((server) => server.id === existing.definition.id);
      if (!refreshed) {
        throw new Error('Failed to load configured MCP server.');
      }
      return refreshed;
    }

    const saved = await this.saveServer({
      name: entry.name,
      scope: 'global',
      projectId: null,
      transportType: 'stdio',
      command: entry.command,
      args: entry.args ?? [],
      enabled: true,
      toolInvocationMode: 'ask',
      launchApproved: false
    });

    const view = this.listServerViews().find((server) => server.id === saved.definition.id);
    if (!view) {
      throw new Error('Failed to create MCP server.');
    }

    return view;
  }

  async approveServerLaunch(serverId: string): Promise<McpServerView> {
    const server = this.db.getMcpServer(serverId);
    const refreshed = await this.saveServer({
      id: server.definition.id,
      name: server.definition.name,
      scope: server.definition.scope,
      projectId: server.definition.projectId,
      transportType: server.definition.transportType,
      command: server.definition.command,
      args: server.definition.args,
      cwd: server.definition.cwd,
      env: server.definition.env,
      enabled: server.definition.enabled,
      toolInvocationMode: server.definition.toolInvocationMode,
      launchApproved: true
    });

    const view = this.listServerViews().find((item) => item.id === refreshed.definition.id);
    if (!view) {
      throw new Error('Failed to approve MCP server launch.');
    }

    return view;
  }

  async setServerEnabled(serverId: string, enabled: boolean): Promise<McpServerView> {
    const server = this.db.getMcpServer(serverId);
    const refreshed = await this.saveServer({
      id: server.definition.id,
      name: server.definition.name,
      scope: server.definition.scope,
      projectId: server.definition.projectId,
      transportType: server.definition.transportType,
      command: server.definition.command,
      args: server.definition.args,
      cwd: server.definition.cwd,
      env: server.definition.env,
      enabled,
      toolInvocationMode: server.definition.toolInvocationMode,
      launchApproved: server.definition.launchApproved
    });

    return this.requireServerView(refreshed.definition.id, 'Failed to update MCP server state.');
  }

  onEvent(listener: (event: AppEvent) => void) {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  async saveServer(input: McpServerSaveInput): Promise<McpServerRecord> {
    const server = this.db.saveMcpServer(input);
    if (!server.definition.enabled) {
      await this.disconnectServer(server.definition.id);
      this.db.saveMcpServerState({
        serverId: server.definition.id,
        status: 'disabled',
        capabilities: null,
        lastSeenAt: null,
        lastError: null,
        toolCount: 0,
        resourceCount: 0,
        promptCount: 0,
        updatedAt: new Date().toISOString()
      });
      const result = this.db.getMcpServer(server.definition.id);
      this.emitUpdate();
      return result;
    }

    if (!server.definition.launchApproved) {
      await this.disconnectServer(server.definition.id);
      this.db.saveMcpServerState({
        serverId: server.definition.id,
        status: 'approval_required',
        capabilities: null,
        lastSeenAt: null,
        lastError: 'Launch approval required before starting this MCP server.',
        toolCount: 0,
        resourceCount: 0,
        promptCount: 0,
        updatedAt: new Date().toISOString()
      });
      const result = this.db.getMcpServer(server.definition.id);
      this.emitUpdate();
      return result;
    }

    return this.refreshServer(server.definition.id);
  }

  async refreshServer(serverId: string): Promise<McpServerRecord> {
    const server = this.db.getMcpServer(serverId);
    const now = new Date().toISOString();

    if (!server.definition.enabled) {
      await this.disconnectServer(serverId);
      this.db.saveMcpServerState({
        serverId,
        status: 'disabled',
        capabilities: null,
        lastSeenAt: null,
        lastError: null,
        toolCount: 0,
        resourceCount: 0,
        promptCount: 0,
        updatedAt: now
      });
      const result = this.db.getMcpServer(serverId);
      this.emitUpdate();
      return result;
    }

    if (!server.definition.launchApproved) {
      await this.disconnectServer(serverId);
      this.db.saveMcpServerState({
        serverId,
        status: 'approval_required',
        capabilities: null,
        lastSeenAt: null,
        lastError: 'Launch approval required before starting this MCP server.',
        toolCount: 0,
        resourceCount: 0,
        promptCount: 0,
        updatedAt: now
      });
      const result = this.db.getMcpServer(serverId);
      this.emitUpdate();
      return result;
    }

    this.db.saveMcpServerState({
      serverId,
      status: 'connecting',
      capabilities: server.state?.capabilities ?? null,
      lastSeenAt: server.state?.lastSeenAt ?? null,
      lastError: null,
      toolCount: server.state?.toolCount ?? 0,
      resourceCount: server.state?.resourceCount ?? 0,
      promptCount: server.state?.promptCount ?? 0,
      updatedAt: now
    });

    await this.disconnectServer(serverId);
    const connection = new McpServerClient(server.definition, this.clientInfo);
    this.connections.set(serverId, connection);
    const result = await connection.refreshCatalog();

    if (result.status === 'connected') {
      this.catalogs.set(serverId, result.catalog);
    } else {
      this.catalogs.delete(serverId);
      if (result.status !== 'disabled') {
        await this.disconnectServer(serverId);
      }
    }

    this.db.saveMcpServerState({
      serverId,
      status: result.status,
      capabilities: result.capabilities,
      lastSeenAt: result.lastSeenAt,
      lastError: result.lastError,
      toolCount: result.catalog.tools.length,
      resourceCount: result.catalog.resources.length,
      promptCount: result.catalog.prompts.length,
      updatedAt: new Date().toISOString()
    });

    const refreshed = this.db.getMcpServer(serverId);
    this.emitUpdate();
    return refreshed;
  }

  async removeServer(serverId: string) {
    await this.disconnectServer(serverId);
    const fileBackedBundlePath = this.resolveFileBackedPluginBundlePath(serverId);
    if (fileBackedBundlePath) {
      safeDelete(fileBackedBundlePath);
    }
    this.db.deleteMcpServer(serverId);
    this.emitUpdate();
  }

  async removeServerView(serverId: string): Promise<void> {
    await this.removeServer(serverId);
  }

  async listCatalog(): Promise<McpCatalogSnapshot> {
    const tools = [...this.catalogs.values()].flatMap((catalog) => catalog.tools);
    const resources = [...this.catalogs.values()].flatMap((catalog) => catalog.resources);
    const prompts = [...this.catalogs.values()].flatMap((catalog) => catalog.prompts);
    return {
      tools,
      resources,
      prompts,
      refreshedAt: new Date().toISOString()
    };
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>) {
    const connection = this.connections.get(serverId);
    if (!connection) {
      throw new Error('MCP server is not connected.');
    }

    return await connection.callTool(toolName, args);
  }

  private async disconnectServer(serverId: string) {
    const connection = this.connections.get(serverId);
    this.connections.delete(serverId);
    this.catalogs.delete(serverId);
    if (connection) {
      await connection.close();
    }
  }

  private emitUpdate() {
    this.emitter.emit('event', {
      type: 'mcp.updated',
      servers: this.listServerViews(),
      catalog: this.snapshotCatalog()
    } satisfies AppEvent);
  }

  private requireServerView(serverId: string, message: string) {
    const view = this.listServerViews().find((server) => server.id === serverId);
    if (!view) {
      throw new Error(message);
    }

    return view;
  }

  private snapshotCatalog(): McpCatalogSnapshot {
    const tools = [...this.catalogs.values()].flatMap((catalog) => catalog.tools);
    const resources = [...this.catalogs.values()].flatMap((catalog) => catalog.resources);
    const prompts = [...this.catalogs.values()].flatMap((catalog) => catalog.prompts);
    return {
      tools,
      resources,
      prompts,
      refreshedAt: new Date().toISOString()
    };
  }

  private listFileBackedPluginBundles(): FileBackedPluginBundle[] {
    if (!this.pluginRoot) {
      return [];
    }

    const bundles: FileBackedPluginBundle[] = [];
    const userRoot = join(this.pluginRoot, 'user');
    if (existsSync(userRoot)) {
      for (const entry of readdirSync(userRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }

        const rootPath = join(userRoot, entry.name);
        const manifestPath = join(rootPath, '.codex-plugin', 'plugin.json');
        const mcpPath = join(rootPath, '.mcp.json');
        if (!existsSync(manifestPath) || !existsSync(mcpPath)) {
          continue;
        }

        bundles.push({
          folderName: entry.name,
          scope: 'global',
          projectId: null,
          rootPath,
          manifestPath,
          mcpPath
        });
      }
    }

    const projectRoot = join(this.pluginRoot, 'project');
    if (!existsSync(projectRoot)) {
      return bundles;
    }

    for (const projectEntry of readdirSync(projectRoot, { withFileTypes: true })) {
      if (!projectEntry.isDirectory()) {
        continue;
      }

      const projectDir = join(projectRoot, projectEntry.name);
      for (const pluginEntry of readdirSync(projectDir, { withFileTypes: true })) {
        if (!pluginEntry.isDirectory()) {
          continue;
        }

        const rootPath = join(projectDir, pluginEntry.name);
        const manifestPath = join(rootPath, '.codex-plugin', 'plugin.json');
        const mcpPath = join(rootPath, '.mcp.json');
        if (!existsSync(manifestPath) || !existsSync(mcpPath)) {
          continue;
        }

        bundles.push({
          folderName: pluginEntry.name,
          scope: 'project',
          projectId: projectEntry.name,
          rootPath,
          manifestPath,
          mcpPath
        });
      }
    }

    return bundles;
  }

  private buildFileBackedPluginId(scope: McpServerScope, folderName: string, projectId: string | null) {
    return scope === 'project'
      ? `${FILE_BACKED_PLUGIN_ID_PREFIX}:project:${projectId ?? 'missing'}:${folderName}`
      : `${FILE_BACKED_PLUGIN_ID_PREFIX}:global:${folderName}`;
  }

  private resolveFileBackedPluginBundlePath(serverId: string) {
    if (!this.pluginRoot || !serverId.startsWith(`${FILE_BACKED_PLUGIN_ID_PREFIX}:`)) {
      return null;
    }

    const parts = serverId.split(':');
    if (parts.length === 3 && parts[1] === 'global' && parts[2]) {
      return join(this.pluginRoot, 'user', parts[2]);
    }
    if (parts.length === 4 && parts[1] === 'project' && parts[2] && parts[3]) {
      return join(this.pluginRoot, 'project', parts[2], parts[3]);
    }
    return null;
  }
}
