import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type {
  McpServerDefinition,
  McpServerRecord,
  McpServerSaveInput,
  McpServerState
} from '../shared/domain';

type Row = Record<string, unknown>;

export class McpServerRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly mapRecord: (row: Row) => McpServerRecord
  ) {}

  listMcpServers(): McpServerRecord[] {
    return this.db
      .prepare(
        `SELECT
          servers.*,
          state.server_id AS state_server_id,
          state.status AS state_status,
          state.capabilities_json AS state_capabilities_json,
          state.last_seen_at AS state_last_seen_at,
          state.last_error AS state_last_error,
          state.tool_count AS state_tool_count,
          state.resource_count AS state_resource_count,
          state.prompt_count AS state_prompt_count,
          state.updated_at AS state_updated_at
         FROM mcp_servers servers
         LEFT JOIN mcp_server_state state ON state.server_id = servers.id
         ORDER BY servers.updated_at DESC`
      )
      .all()
      .map((row) => this.mapRecord(row as Row));
  }

  getMcpServer(serverId: string): McpServerRecord {
    const row = this.db
      .prepare(
        `SELECT
          servers.*,
          state.server_id AS state_server_id,
          state.status AS state_status,
          state.capabilities_json AS state_capabilities_json,
          state.last_seen_at AS state_last_seen_at,
          state.last_error AS state_last_error,
          state.tool_count AS state_tool_count,
          state.resource_count AS state_resource_count,
          state.prompt_count AS state_prompt_count,
          state.updated_at AS state_updated_at
         FROM mcp_servers servers
         LEFT JOIN mcp_server_state state ON state.server_id = servers.id
         WHERE servers.id = ?`
      )
      .get(serverId) as Row | undefined;
    if (!row) {
      throw new Error(`MCP server not found: ${serverId}`);
    }
    return this.mapRecord(row);
  }

  saveMcpServer(input: McpServerSaveInput): McpServerRecord {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const exists = input.id ? this.db.prepare('SELECT id FROM mcp_servers WHERE id = ?').get(input.id) : undefined;

    if (exists) {
      const current = this.getMcpServer(id);
      this.db
        .prepare(
          `UPDATE mcp_servers
           SET name = @name,
               scope = @scope,
               project_id = @projectId,
               transport_type = @transportType,
               command = @command,
               args_json = @argsJson,
               cwd = @cwd,
               env_json = @envJson,
               enabled = @enabled,
               tool_invocation_mode = @toolInvocationMode,
               launch_approved = @launchApproved,
               updated_at = @updatedAt
           WHERE id = @id`
        )
        .run({
          id,
          name: input.name,
          scope: input.scope ?? current.definition.scope,
          projectId: input.projectId === undefined ? current.definition.projectId : input.projectId,
          transportType: input.transportType ?? 'stdio',
          command: input.command,
          argsJson: JSON.stringify(input.args ?? []),
          cwd: input.cwd ?? null,
          envJson: JSON.stringify(input.env ?? {}),
          enabled: input.enabled ? 1 : 0,
          toolInvocationMode: input.toolInvocationMode ?? 'ask',
          launchApproved:
            input.launchApproved === undefined
              ? (current.definition.launchApproved ? 1 : 0)
              : input.launchApproved ? 1 : 0,
          updatedAt: now
        });
    } else {
      this.db
        .prepare(
          `INSERT INTO mcp_servers (
            id, name, scope, project_id, transport_type, command, args_json, cwd, env_json, enabled, tool_invocation_mode, launch_approved, created_at, updated_at
          ) VALUES (
            @id, @name, @scope, @projectId, @transportType, @command, @argsJson, @cwd, @envJson, @enabled, @toolInvocationMode, @launchApproved, @createdAt, @updatedAt
          )`
        )
        .run({
          id,
          name: input.name,
          scope: input.scope ?? 'global',
          projectId: input.projectId ?? null,
          transportType: input.transportType ?? 'stdio',
          command: input.command,
          argsJson: JSON.stringify(input.args ?? []),
          cwd: input.cwd ?? null,
          envJson: JSON.stringify(input.env ?? {}),
          enabled: input.enabled ? 1 : 0,
          toolInvocationMode: input.toolInvocationMode ?? 'ask',
          launchApproved: input.launchApproved ? 1 : 0,
          createdAt: now,
          updatedAt: now
        });
    }

    return this.getMcpServer(id);
  }

  deleteMcpServer(serverId: string) {
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(serverId);
  }

  saveMcpServerState(input: {
    serverId: string;
    status: McpServerState['status'];
    capabilities: Record<string, unknown> | null;
    lastSeenAt: string | null;
    lastError: string | null;
    toolCount: number;
    resourceCount: number;
    promptCount: number;
    updatedAt: string;
  }) {
    this.db
      .prepare(
        `INSERT INTO mcp_server_state (
          server_id, status, capabilities_json, last_seen_at, last_error, tool_count, resource_count, prompt_count, updated_at
        ) VALUES (
          @serverId, @status, @capabilitiesJson, @lastSeenAt, @lastError, @toolCount, @resourceCount, @promptCount, @updatedAt
        )
        ON CONFLICT(server_id) DO UPDATE SET
          status = excluded.status,
          capabilities_json = excluded.capabilities_json,
          last_seen_at = excluded.last_seen_at,
          last_error = excluded.last_error,
          tool_count = excluded.tool_count,
          resource_count = excluded.resource_count,
          prompt_count = excluded.prompt_count,
          updated_at = excluded.updated_at`
      )
      .run({
        serverId: input.serverId,
        status: input.status,
        capabilitiesJson: input.capabilities ? JSON.stringify(input.capabilities) : null,
        lastSeenAt: input.lastSeenAt,
        lastError: input.lastError,
        toolCount: input.toolCount,
        resourceCount: input.resourceCount,
        promptCount: input.promptCount,
        updatedAt: input.updatedAt
      });
  }
}
