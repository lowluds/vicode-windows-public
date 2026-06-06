import type { McpCatalogSnapshot, McpServerView } from '../../shared/domain';
import type { CuratedMcpCatalogEntry } from '../../shared/curatedCatalog';
import { pluginCategoryLabel } from './SkillsView.labels';

export type PluginCatalogSection = {
  title: string;
  entries: CuratedMcpCatalogEntry[];
};

export type PluginCatalogSections = {
  featuredEntries: CuratedMcpCatalogEntry[];
  sections: PluginCatalogSection[];
};

function isInternalAnalysisServer(server: Pick<McpServerView, 'args'>) {
  return server.args.includes('--vicode-internal-analysis-server');
}

function matchesCatalogEntry(server: McpServerView, entry: CuratedMcpCatalogEntry) {
  if (entry.id === 'internal-analysis') {
    return isInternalAnalysisServer(server);
  }

  return entry.command
    ? server.command.toLowerCase() === entry.command.toLowerCase() &&
        JSON.stringify(server.args) === JSON.stringify(entry.args ?? [])
    : false;
}

export function findConfiguredMcpServer(
  catalog: readonly CuratedMcpCatalogEntry[],
  servers: readonly McpServerView[],
  entryId: string,
  selectedProjectId: string | null
) {
  const entry = catalog.find((candidate) => candidate.id === entryId);
  if (!entry) {
    return null;
  }

  if (entry.id === 'internal-analysis') {
    return (
      servers.find((server) =>
        server.projectId === selectedProjectId && isInternalAnalysisServer(server)
      ) ?? null
    );
  }

  return servers.find((server) => matchesCatalogEntry(server, entry)) ?? null;
}

export function findOfficialEntryForServer(
  catalog: readonly CuratedMcpCatalogEntry[],
  server: McpServerView
) {
  return catalog.find((entry) => matchesCatalogEntry(server, entry)) ?? null;
}

export function filterOfficialMcpCatalogForQuery(
  catalog: readonly CuratedMcpCatalogEntry[],
  query: string
) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...catalog];
  }

  return catalog.filter((entry) =>
    `${entry.name} ${entry.description} ${entry.category} ${entry.publisher} ${entry.command ?? ''} ${(entry.args ?? []).join(' ')}`
      .toLowerCase()
      .includes(needle)
  );
}

export function filterConfiguredMcpServersForQuery(
  servers: readonly McpServerView[],
  catalog: readonly CuratedMcpCatalogEntry[],
  mcpCatalog: McpCatalogSnapshot | null,
  query: string
) {
  const sortedServers = [...servers].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  );
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return sortedServers;
  }

  return sortedServers.filter((server) => {
    const officialEntry = findOfficialEntryForServer(catalog, server);
    const serverCatalog = [
      ...(mcpCatalog?.tools ?? []).filter((tool) => tool.serverId === server.id).map((tool) => tool.name),
      ...(mcpCatalog?.resources ?? []).filter((resource) => resource.serverId === server.id).map((resource) => resource.name || resource.uri),
      ...(mcpCatalog?.prompts ?? []).filter((prompt) => prompt.serverId === server.id).map((prompt) => prompt.name)
    ];
    return `${server.name} ${server.command} ${server.args.join(' ')} ${server.url ?? ''} ${server.headerKeys.join(' ')} ${server.state?.lastError ?? ''} ${officialEntry?.description ?? ''} ${officialEntry?.category ?? 'custom'} ${server.toolInvocationMode} ${serverCatalog.join(' ')}`
      .toLowerCase()
      .includes(needle);
  });
}

export function formatMcpServerConnectionDiagnostic(server: McpServerView) {
  const lastError = server.state?.lastError?.trim();
  if (!lastError) {
    return null;
  }

  const transportLabel =
    server.transportType === 'streamable_http'
      ? 'Streamable HTTP'
      : server.transportType === 'sse'
        ? 'SSE'
        : 'stdio';
  const endpoint = server.transportType === 'stdio'
    ? server.command
    : (server.url ?? '');
  const credentialShape = server.transportType === 'stdio'
    ? (server.envKeys.length > 0 ? `Env keys: ${server.envKeys.join(', ')}.` : 'Env keys: none.')
    : (server.headerKeys.length > 0 ? `Header keys: ${server.headerKeys.join(', ')}.` : 'Header keys: none.');

  return `${transportLabel} diagnostic: ${lastError} ${endpoint ? `Endpoint: ${endpoint}.` : ''} ${credentialShape}`;
}

export function buildPluginCatalogSections(
  filteredPluginEntries: readonly CuratedMcpCatalogEntry[]
): PluginCatalogSections {
  const featuredEntries = filteredPluginEntries.filter((entry) => entry.supportState === 'supported');
  const categorizedEntries = filteredPluginEntries.filter((entry) => entry.supportState !== 'supported');
  const sections = ['Coding', 'Design', 'Engineering', 'Collaboration', 'Plugins']
    .map((title) => ({
      title,
      entries: categorizedEntries.filter((entry) => pluginCategoryLabel(entry.category) === title)
    }))
    .filter((section) => section.entries.length > 0);

  return {
    featuredEntries,
    sections
  };
}
