import type { McpCatalogSnapshot, McpServerView } from '../../shared/domain';

type ToastLevel = 'info' | 'warning' | 'error';

export interface SkillsMcpServerActionsHost {
  getSelectedProjectId(): string | null;
  getMcpServers(): McpServerView[];
  setupRecommendedMcp(input: {
    entryId: string;
    projectId: string | null;
  }): Promise<McpServerView>;
  approveMcpLaunch(serverId: string): Promise<McpServerView>;
  refreshMcpServer(serverId: string): Promise<McpServerView>;
  setMcpServerEnabled(serverId: string, enabled: boolean): Promise<McpServerView>;
  removeMcpServer(serverId: string): Promise<void>;
  listMcpCatalog(): Promise<McpCatalogSnapshot>;
  setMcpServers(
    value: McpServerView[] | ((current: McpServerView[]) => McpServerView[])
  ): void;
  setMcpCatalog(value: McpCatalogSnapshot): void;
  setSettingUpMcpId(value: string | null): void;
  showToast(level: ToastLevel, message: string): void;
}

export function upsertMcpServer(
  current: McpServerView[],
  server: McpServerView
): McpServerView[] {
  const next = current.filter((item) => item.id !== server.id);
  next.push(server);
  return next.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  );
}

export async function setupRecommendedMcp(
  host: SkillsMcpServerActionsHost,
  entryId: string
) {
  host.setSettingUpMcpId(entryId);
  try {
    const server = await host.setupRecommendedMcp({
      entryId,
      projectId: entryId === 'internal-analysis' ? host.getSelectedProjectId() : null
    });
    host.setMcpServers((current) => upsertMcpServer(current, server));
    host.setMcpCatalog(await host.listMcpCatalog());
    host.showToast(
      'info',
      server.launchApproved
        ? `${server.name} added and started.`
        : `${server.name} added. Launch remains approval-gated.`
    );
  } catch (error) {
    host.showToast(
      'error',
      error instanceof Error ? error.message : 'Failed to configure MCP integration.'
    );
  } finally {
    host.setSettingUpMcpId(null);
  }
}

export async function approveMcpLaunch(
  host: SkillsMcpServerActionsHost,
  serverId: string
) {
  host.setSettingUpMcpId(serverId);
  try {
    const server = await host.approveMcpLaunch(serverId);
    host.setMcpServers((current) => upsertMcpServer(current, server));
    host.setMcpCatalog(await host.listMcpCatalog());
    host.showToast('info', `${server.name} approved and started.`);
  } catch (error) {
    host.showToast(
      'error',
      error instanceof Error ? error.message : 'Failed to approve MCP server launch.'
    );
  } finally {
    host.setSettingUpMcpId(null);
  }
}

export async function refreshMcpServer(
  host: SkillsMcpServerActionsHost,
  serverId: string
) {
  host.setSettingUpMcpId(serverId);
  try {
    const server = await host.refreshMcpServer(serverId);
    host.setMcpServers((current) => upsertMcpServer(current, server));
    host.setMcpCatalog(await host.listMcpCatalog());
    host.showToast('info', `${server.name} refreshed.`);
  } catch (error) {
    host.showToast(
      'error',
      error instanceof Error ? error.message : 'Failed to refresh MCP server.'
    );
  } finally {
    host.setSettingUpMcpId(null);
  }
}

export async function toggleMcpServer(
  host: SkillsMcpServerActionsHost,
  server: McpServerView,
  enabled: boolean
) {
  host.setSettingUpMcpId(server.id);
  try {
    const updated = await host.setMcpServerEnabled(server.id, enabled);
    host.setMcpServers((current) => upsertMcpServer(current, updated));
    host.setMcpCatalog(await host.listMcpCatalog());
    host.showToast('info', `${server.name} ${enabled ? 'enabled' : 'disabled'}.`);
  } catch (error) {
    host.showToast(
      'error',
      error instanceof Error
        ? error.message
        : `Failed to ${enabled ? 'enable' : 'disable'} MCP server.`
    );
  } finally {
    host.setSettingUpMcpId(null);
  }
}

export async function removeMcpServer(
  host: SkillsMcpServerActionsHost,
  serverId: string
) {
  host.setSettingUpMcpId(serverId);
  try {
    const server = host.getMcpServers().find((item) => item.id === serverId) ?? null;
    await host.removeMcpServer(serverId);
    host.setMcpServers((current) => current.filter((item) => item.id !== serverId));
    host.setMcpCatalog(await host.listMcpCatalog());
    host.showToast('info', `${server?.name ?? 'Integration'} removed.`);
  } catch (error) {
    host.showToast(
      'error',
      error instanceof Error ? error.message : 'Failed to remove MCP server.'
    );
  } finally {
    host.setSettingUpMcpId(null);
  }
}
