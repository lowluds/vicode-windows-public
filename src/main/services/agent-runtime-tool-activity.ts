import { parsePatch } from 'diff';
import type { McpToolDescriptor } from '../../shared/domain';
import type {
  AgentToolCall,
  AgentToolExecutionResult
} from '../../providers/agent-runtime';
import { extractThreadSourcesFromText } from '../../shared/thread-sources';

function readTelemetryString(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readTelemetryNumber(args: Record<string, unknown>, key: string) {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? String(Math.floor(value))
    : null;
}

function toPatchTargetPath(fileName: string) {
  return fileName === '/dev/null' ? fileName : fileName.replace(/^[ab]\//u, '');
}

function describePatchTargetCount(patch: string | null) {
  if (!patch) {
    return null;
  }

  const parsed = parsePatch(patch);
  if (parsed.length === 0) {
    return null;
  }

  if (parsed.length === 1) {
    const filePatch = parsed[0];
    const oldFileName = toPatchTargetPath(filePatch.oldFileName ?? '');
    const newFileName = toPatchTargetPath(filePatch.newFileName ?? '');
    const target = newFileName !== '/dev/null' ? newFileName : oldFileName;
    return target || '1 file';
  }

  return `${parsed.length} files`;
}

function formatYesNo(value: boolean) {
  return value ? 'Yes' : 'No';
}

function describeToolArguments(call: AgentToolCall) {
  switch (call.name) {
    case 'list_directory': {
      const path = readTelemetryString(call.arguments, 'path') ?? '.';
      const maxEntries = readTelemetryNumber(call.arguments, 'max_entries');
      return maxEntries
        ? `path: ${path}\nmax entries: ${maxEntries}`
        : `path: ${path}`;
    }
    case 'read_file': {
      const path = readTelemetryString(call.arguments, 'path');
      return path ? `path: ${path}` : null;
    }
    case 'search_text': {
      const query = readTelemetryString(call.arguments, 'query');
      const path = readTelemetryString(call.arguments, 'path');
      const maxResults = readTelemetryNumber(call.arguments, 'max_results');
      return (
        [
          query ? `query: ${query}` : null,
          path ? `path: ${path}` : null,
          maxResults ? `max results: ${maxResults}` : null
        ]
          .filter((value): value is string => Boolean(value))
          .join('\n') || null
      );
    }
    case 'web_search': {
      const query = readTelemetryString(call.arguments, 'query');
      const maxResults = readTelemetryNumber(call.arguments, 'max_results');
      return (
        [
          query ? `Search query: ${query}` : null,
          maxResults ? `Results limit: ${maxResults}` : null
        ]
          .filter((value): value is string => Boolean(value))
          .join('\n') || null
      );
    }
    case 'extract_web_page': {
      const url = readTelemetryString(call.arguments, 'url');
      const query = readTelemetryString(call.arguments, 'query');
      return (
        [
          url ? `Page URL: ${url}` : null,
          query ? `Focus: ${query}` : null
        ]
          .filter((value): value is string => Boolean(value))
          .join('\n') || null
      );
    }
    case 'map_site':
    case 'crawl_site': {
      const url = readTelemetryString(call.arguments, 'url');
      const maxPages = readTelemetryNumber(call.arguments, 'max_pages');
      const sameOriginOnly = call.arguments.same_origin_only;
      return (
        [
          url ? `Start URL: ${url}` : null,
          maxPages ? `Page limit: ${maxPages}` : null,
          typeof sameOriginOnly === 'boolean'
            ? `Stay on one site: ${formatYesNo(sameOriginOnly)}`
            : null
        ]
          .filter((value): value is string => Boolean(value))
          .join('\n') || null
      );
    }
    case 'research_topic': {
      const query = readTelemetryString(call.arguments, 'query');
      const maxResults = readTelemetryNumber(call.arguments, 'max_results');
      const maxPages = readTelemetryNumber(call.arguments, 'max_pages');
      return (
        [
          query ? `Research topic: ${query}` : null,
          maxResults ? `Results limit: ${maxResults}` : null,
          maxPages ? `Page limit: ${maxPages}` : null
        ]
          .filter((value): value is string => Boolean(value))
          .join('\n') || null
      );
    }
    case 'mkdir': {
      const path = readTelemetryString(call.arguments, 'path');
      return path ? `path: ${path}` : null;
    }
    case 'write_file': {
      const path = readTelemetryString(call.arguments, 'path');
      return path ? `path: ${path}` : null;
    }
    case 'apply_patch': {
      const patch = readTelemetryString(call.arguments, 'patch');
      const target = describePatchTargetCount(patch);
      return target ? `target: ${target}` : 'target: unified diff patch';
    }
    case 'run_command': {
      const command = readTelemetryString(call.arguments, 'command');
      const cwd = readTelemetryString(call.arguments, 'cwd');
      return (
        [command ? `command: ${command}` : null, cwd ? `cwd: ${cwd}` : null]
          .filter((value): value is string => Boolean(value))
          .join('\n') || null
      );
    }
    case 'use_mcp_tool': {
      const serverId = readTelemetryString(call.arguments, 'server_id');
      const toolName = readTelemetryString(call.arguments, 'tool_name');
      return (
        [
          serverId ? `server: ${serverId}` : null,
          toolName ? `tool: ${toolName}` : null
        ]
          .filter((value): value is string => Boolean(value))
          .join('\n') || null
      );
    }
    default:
      return null;
  }
}

function summarizeToolCall(call: AgentToolCall) {
  if (call.name === 'use_mcp_tool') {
    const toolName = readTelemetryString(call.arguments, 'tool_name');
    return toolName ? `Calling MCP tool ${toolName}` : 'Calling MCP tool';
  }

  switch (call.name) {
    case 'web_search':
      return 'Searching the web';
    case 'extract_web_page':
      return 'Reading a web page';
    case 'research_topic':
      return 'Researching a topic';
    case 'crawl_site':
      return 'Crawling a site';
    case 'map_site':
      return 'Mapping a site';
    default:
      return `Calling ${call.name}`;
  }
}

function summarizeToolResult(call: AgentToolCall, result: AgentToolExecutionResult) {
  if (call.name === 'use_mcp_tool') {
    const toolName = readTelemetryString(call.arguments, 'tool_name');
    const toolLabel = toolName ? `MCP tool ${toolName}` : 'MCP tool';
    return result.isError ? `Failed ${toolLabel}` : `Completed ${toolLabel}`;
  }

  switch (call.name) {
    case 'web_search':
      return result.isError ? 'Web search failed' : 'Searched the web';
    case 'extract_web_page':
      return result.isError ? 'Could not read the web page' : 'Read the web page';
    case 'research_topic':
      return result.isError ? 'Research failed' : 'Finished research';
    case 'crawl_site':
      return result.isError ? 'Site crawl failed' : 'Crawled the site';
    case 'map_site':
      return result.isError ? 'Site map failed' : 'Mapped the site';
    default:
      return result.isError ? `Failed ${call.name}` : `Completed ${call.name}`;
  }
}

function extractWebResearchActivitySources(
  call: AgentToolCall,
  result: AgentToolExecutionResult
) {
  if (result.isError) {
    return {
      sources: null,
      url: null
    };
  }

  switch (call.name) {
    case 'web_search':
    case 'extract_web_page':
    case 'map_site':
    case 'crawl_site':
    case 'research_topic': {
      const sources = extractThreadSourcesFromText(result.content);
      return {
        sources: sources.length > 0 ? sources : null,
        url: sources.length === 1 ? sources[0]?.url ?? null : null
      };
    }
    default:
      return {
        sources: null,
        url: null
      };
  }
}

export function buildToolCallActivity(call: AgentToolCall) {
  return {
    kind: 'tool_call' as const,
    toolName: call.name,
    command: call.name === 'run_command' ? readTelemetryString(call.arguments, 'command') : undefined,
    cwd: call.name === 'run_command' ? readTelemetryString(call.arguments, 'cwd') : undefined,
    phase: 'started' as const,
    summary: summarizeToolCall(call),
    text: describeToolArguments(call)
  };
}

export function buildToolResultActivity(
  call: AgentToolCall,
  result: AgentToolExecutionResult,
  truncateText: (value: string) => string
) {
  const webResearchMetadata = extractWebResearchActivitySources(call, result);
  const text = result.isError
    ? truncateText(result.content)
    : call.name === 'mkdir' || call.name === 'apply_patch' || call.name === 'use_mcp_tool'
      ? truncateText(result.content)
      : null;

  return {
    kind: 'tool_result' as const,
    toolName: call.name,
    command: call.name === 'run_command' ? readTelemetryString(call.arguments, 'command') : undefined,
    cwd: call.name === 'run_command' ? readTelemetryString(call.arguments, 'cwd') : undefined,
    phase: result.isError ? ('stopped' as const) : ('completed' as const),
    status: result.isError ? 'error' : 'completed',
    summary: summarizeToolResult(call, result),
    text,
    url: webResearchMetadata.url,
    sources: webResearchMetadata.sources
  };
}

export function formatMcpToolInvocationLabel(tool: McpToolDescriptor) {
  return `${tool.serverName} / ${tool.name}`;
}

export function flattenMcpToolResultContent(content: Array<Record<string, unknown>>) {
  const parts = content.flatMap((entry) => {
    if (entry.type === 'text' && typeof entry.text === 'string' && entry.text.trim()) {
      return [entry.text.trim()];
    }

    if (
      entry.type === 'resource'
      && typeof entry.resource === 'object'
      && entry.resource !== null
      && 'text' in entry.resource
      && typeof entry.resource.text === 'string'
      && entry.resource.text.trim()
    ) {
      return [entry.resource.text.trim()];
    }

    return [];
  });

  return parts.join('\n\n').trim();
}
