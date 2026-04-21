import type {
  McpCatalogSnapshot,
  McpPromptDescriptor,
  McpResourceDescriptor,
  McpServerDefinition,
  McpToolDescriptor
} from '../../../shared/domain';
import { requiresToolApproval } from './permissions';

export function emptyCatalogSnapshot(): McpCatalogSnapshot {
  return {
    tools: [],
    resources: [],
    prompts: [],
    refreshedAt: new Date(0).toISOString()
  };
}

export function normalizeToolCatalog(
  server: McpServerDefinition,
  tools: Array<{
    name: string;
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>
): McpToolDescriptor[] {
  return tools.map((tool) => ({
    serverId: server.id,
    serverName: server.name,
    name: tool.name,
    title: tool.title ?? null,
    description: tool.description ?? null,
    inputSchema: tool.inputSchema ?? null,
    invocationMode: server.toolInvocationMode,
    requiresApproval: requiresToolApproval(server.toolInvocationMode)
  }));
}

export function normalizeResourceCatalog(
  server: McpServerDefinition,
  resources: Array<{
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
  }>
): McpResourceDescriptor[] {
  return resources.map((resource) => ({
    serverId: server.id,
    serverName: server.name,
    uri: resource.uri,
    name: resource.name,
    description: resource.description ?? null,
    mimeType: resource.mimeType ?? null
  }));
}

export function normalizePromptCatalog(
  server: McpServerDefinition,
  prompts: Array<{
    name: string;
    description?: string;
    arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  }>
): McpPromptDescriptor[] {
  return prompts.map((prompt) => ({
    serverId: server.id,
    serverName: server.name,
    name: prompt.name,
    description: prompt.description ?? null,
    arguments: (prompt.arguments ?? []).map((argument) => ({
      name: argument.name,
      description: argument.description ?? null,
      required: Boolean(argument.required)
    }))
  }));
}
