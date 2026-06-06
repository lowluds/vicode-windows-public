import {
  readFile,
  readdir,
  stat
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { getAgentToolDeniedMessage } from '../../shared/agent-tool-policy';
import {
  evaluateRuntimeNetworkAccess
} from '../../shared/runtime-policy';
import type {
  AutonomyDelegationProfile,
  McpCatalogSnapshot,
  McpToolDescriptor,
  ProviderReasoningEffort,
  RunToolApprovalDecision,
  SubagentSpawnInput,
  SubagentSummary
} from '../../shared/domain';
import type {
  AgentRuntime,
  AgentRuntimeToolCatalog,
  AgentRuntimeToolCatalogContext,
  AgentToolCall,
  AgentToolExecutionContext,
  AgentToolExecutionResult
} from '../../providers/agent-runtime';
import { buildAgentRuntimeToolCatalog } from '../../providers/agent-tool-catalog';
import {
  findNativeAgentRuntimeToolDefinition,
  isNativeWebResearchToolName
} from '../../providers/agent-runtime-native-tools';
import {
  readBoundedIntegerArgument,
  readOptionalStringArgument,
  readStringArgument
} from './agent-runtime-arguments';
import type {
  BrowserPreviewService
} from './browser-preview';
import {
  formatBrowserPreviewResult,
  isBrowserPreviewHealthy,
  readBrowserPreviewExpectedSelectors
} from './agent-runtime-browser-preview';
import {
  assertRunCommandToolPolicy,
  requestRunCommandApprovalIfNeeded,
  resolveRunCommandExecution
} from './agent-runtime-command-policy';
import { normalizeWorkspacePath } from './agent-runtime-workspace-paths';
import {
  applyStagedWorkspaceChangeSet,
  createWorkspaceDirectory,
  stageWorkspaceDirectory,
  stageWorkspacePatch,
  stageWorkspaceTextFile,
  writeWorkspaceTextFile
} from './agent-runtime-workspace-writes';
import { createStagedWorkspacePreviewArtifact } from './staged-workspace-review';
import type {
  AgentRuntimeVicodeCreatorBridge
} from './agent-runtime-vicode-creators';
import {
  parsePluginBundleToolInput,
  parseSkillBundleToolInput
} from './agent-runtime-vicode-creators';
import {
  buildToolCallActivity,
  buildToolResultActivity,
  flattenMcpToolResultContent,
  formatMcpToolInvocationLabel
} from './agent-runtime-tool-activity';
import {
  spawnIsolatedCommand
} from '../../providers/util';
import type { WebResearchService } from './web-research';

const MAX_READ_FILE_BYTES = 256 * 1024;
const MAX_DIRECTORY_ENTRIES = 200;
const MAX_SEARCH_RESULTS = 50;
const MAX_COMMAND_OUTPUT_CHARS = 12_000;
const COMMAND_TIMEOUT_MS = 120_000;
const MAX_TOOL_ACTIVITY_TEXT_CHARS = 240;
const MAX_SUBAGENT_TASKS_PER_CALL = 3;
const MAX_SUBAGENT_TITLE_CHARS = 120;
const MAX_SUBAGENT_PROMPT_CHARS = 16_000;
const SEARCH_IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'out',
  'release',
  'dist',
  'build',
  '.next'
]);
function containsGlobSyntax(pathValue: string) {
  return /[*?[\]{}]/u.test(pathValue);
}

function getGlobSearchBasePath(pathValue: string) {
  const normalized = pathValue.replace(/\\/g, '/').trim();
  const firstGlobIndex = normalized.search(/[*?[\]{}]/u);
  if (firstGlobIndex < 0) {
    return normalized || '.';
  }

  const slashIndex = normalized.lastIndexOf('/', firstGlobIndex);
  if (slashIndex < 0) {
    return '.';
  }
  const base = normalized.slice(0, slashIndex);
  return base || '.';
}
const SUBAGENT_PROFILES = new Set<AutonomyDelegationProfile>([
  'heartbeat',
  'research',
  'implement',
  'verify'
]);
const PROVIDER_REASONING_EFFORTS = new Set<ProviderReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh'
]);
const ACTIVE_SUBAGENT_STATUSES = new Set<SubagentSummary['status']>(['queued', 'running']);
const NON_EMPTY_STRING_ARGUMENT_NAMES = new Set([
  'command',
  'folder_name',
  'patch',
  'path',
  'prompt',
  'query',
  'title',
  'url'
]);

interface AgentRuntimeSubagentBridge {
  listForThread(threadId: string): SubagentSummary[];
  spawn(input: SubagentSpawnInput): Promise<SubagentSummary>;
}

export interface AgentRuntimeProjectKnowledgeBridge {
  isConfigured(): boolean;
  search(query: string, maxResults?: number): Array<{
    title: string;
    relativePath: string;
    heading: string | null;
    content: string;
    retrievalReason: { reason: string };
  }>;
  read(path: string, heading?: string | null): {
    title: string;
    relativePath: string;
    heading: string | null;
    content: string;
  } | null;
  list(maxResults?: number): Array<{
    title: string;
    relativePath: string;
    heading: string | null;
  }>;
}

interface ParsedSubagentTaskInput {
  name?: string;
  title: string;
  prompt: string;
  delegationProfile: AutonomyDelegationProfile;
  reasoningEffort?: ProviderReasoningEffort | null;
}

function formatWorkspacePathLabel(value: string) {
  if (value === '.' || value === './' || value === '.\\') {
    return 'Workspace root';
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createAbortError() {
  const error = new Error('Agent runtime was aborted.');
  error.name = 'AbortError';
  return error;
}

function truncateOutput(value: string) {
  if (value.length <= MAX_COMMAND_OUTPUT_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_COMMAND_OUTPUT_CHARS)}\n...[truncated]`;
}

function truncateToolActivityText(value: string) {
  if (value.length <= MAX_TOOL_ACTIVITY_TEXT_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_TOOL_ACTIVITY_TEXT_CHARS)}...`;
}

function formatValidationPath(path: Array<string | number>) {
  return path.length > 0 ? path.map(String).join('.') : 'arguments';
}

function formatNativeToolValidationIssue(issue: {
  code?: string;
  expected?: string;
  message?: string;
  maximum?: number;
  origin?: string;
  path?: Array<string | number>;
  values?: unknown[];
}) {
  const path = formatValidationPath(issue.path ?? []);
  const fieldName = path.split('.').at(-1) ?? path;
  if (issue.code === 'invalid_type') {
    if (issue.expected === 'string') {
      return NON_EMPTY_STRING_ARGUMENT_NAMES.has(fieldName)
        ? `${path} must be a non-empty string.`
        : `${path} must be a string.`;
    }
    if (issue.expected === 'number') {
      return `${path} must be a number.`;
    }
    if (issue.expected === 'boolean') {
      return `${path} must be a boolean.`;
    }
    if (issue.expected === 'array') {
      return `${path} must be an array.`;
    }
    if (issue.expected === 'object') {
      return `${path} must be an object.`;
    }
  }

  if (issue.code === 'too_small' && issue.origin === 'string') {
    return `${path} must be a non-empty string.`;
  }

  if (issue.code === 'too_big' && issue.origin === 'array' && Number.isFinite(issue.maximum)) {
    return `${path} must contain at most ${issue.maximum} items.`;
  }

  if (issue.code === 'invalid_value' && Array.isArray(issue.values) && issue.values.length > 0) {
    return `${path} must be one of: ${issue.values.join(', ')}.`;
  }

  return issue.message?.trim() || `${path} is invalid.`;
}

function validateNativeToolArguments(call: AgentToolCall): AgentToolExecutionResult | Record<string, unknown> {
  const definition = findNativeAgentRuntimeToolDefinition(call.name);
  if (!definition) {
    return call.arguments;
  }

  const result = definition.inputSchema.safeParse(call.arguments);
  if (result.success) {
    return result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? result.data as Record<string, unknown>
      : {};
  }

  return {
    toolName: call.name,
    content: `Invalid arguments for ${call.name}: ${formatNativeToolValidationIssue(result.error.issues[0] ?? {})}`,
    isError: true
  };
}

function isToolExecutionResult(value: AgentToolExecutionResult | Record<string, unknown>): value is AgentToolExecutionResult {
  return 'toolName' in value && typeof value.toolName === 'string' && 'content' in value;
}

function toPatchTargetPath(fileName: string) {
  return fileName === '/dev/null' ? fileName : fileName.replace(/^[ab]\//u, '');
}

function looksBinary(content: string) {
  return content.includes('\u0000');
}

export class AgentRuntimeService implements AgentRuntime {
  private subagents: AgentRuntimeSubagentBridge | null = null;
  private creators: AgentRuntimeVicodeCreatorBridge | null = null;

  constructor(
    private readonly mcpBridge?: {
      listCatalog(): Promise<McpCatalogSnapshot>;
      callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<{ content: Array<Record<string, unknown>> }>;
    },
    private readonly webResearch?: WebResearchService,
    private readonly browserPreview?: BrowserPreviewService,
    private readonly projectKnowledge?: AgentRuntimeProjectKnowledgeBridge
  ) {}

  setSubagents(subagents: AgentRuntimeSubagentBridge | null) {
    this.subagents = subagents;
  }

  setCreators(creators: AgentRuntimeVicodeCreatorBridge | null) {
    this.creators = creators;
  }

  async listAvailableMcpTools(): Promise<McpToolDescriptor[]> {
    if (!this.mcpBridge) {
      return [];
    }

    const catalog = await this.mcpBridge.listCatalog();
    return catalog.tools;
  }

  async listToolCatalog(
    context: AgentRuntimeToolCatalogContext
  ): Promise<AgentRuntimeToolCatalog> {
    const mcpTools = await this.listAvailableMcpTools();
    const nativeWebResearchEnabled = await this.hasNativeWebResearch();
    return buildAgentRuntimeToolCatalog({
      ...context,
      delegationEnabled: this.subagents !== null && context.enableDelegationTools === true,
      creatorToolsEnabled: this.creators !== null && context.enableCreatorTools === true,
      projectKnowledgeEnabled: this.projectKnowledge?.isConfigured() === true,
      nativeWebResearchEnabled,
      mcpTools
    });
  }

  hasNativeWebResearch() {
    return Boolean(this.webResearch?.isConfigured());
  }

  async executeToolCall(
    call: AgentToolCall,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    if (context.signal?.aborted) {
      throw createAbortError();
    }

    context.onInfo?.({
      message: `Calling ${call.name}`,
      activity: buildToolCallActivity(call)
    });

    try {
      await this.assertToolPolicy(call.name, context);
      const validatedArguments = validateNativeToolArguments(call);
      if (isToolExecutionResult(validatedArguments)) {
        context.onInfo?.({
          message: `Failed ${call.name}`,
          activity: buildToolResultActivity(call, validatedArguments, truncateToolActivityText)
        });
        return validatedArguments;
      }
      const result = await (async () => {
        switch (call.name) {
          case 'list_directory':
            return await this.listDirectory(validatedArguments, context);
          case 'read_file':
            return await this.readFile(validatedArguments, context);
          case 'search_text':
            return await this.searchText(validatedArguments, context);
          case 'web_search':
            return await this.webSearch(validatedArguments, context);
          case 'extract_web_page':
            return await this.extractWebPage(validatedArguments, context);
          case 'map_site':
            return await this.mapSite(validatedArguments, context);
          case 'crawl_site':
            return await this.crawlSite(validatedArguments, context);
          case 'research_topic':
            return await this.researchTopic(validatedArguments, context);
          case 'browser_preview_check':
            return await this.browserPreviewCheck(validatedArguments, context);
          case 'mkdir':
            return await this.makeDirectory(validatedArguments, context);
          case 'create_skill_bundle':
            return await this.createSkillBundle(validatedArguments, context);
          case 'create_plugin_bundle':
            return await this.createPluginBundle(validatedArguments, context);
          case 'write_file':
            return await this.writeFile(validatedArguments, context);
          case 'apply_patch':
            return await this.applyPatch(validatedArguments, context);
          case 'run_command':
            return await this.runCommand(validatedArguments, context);
          case 'spawn_subagents':
            return await this.spawnSubagents(validatedArguments, context);
          case 'project_knowledge_search':
            return this.projectKnowledgeSearch(validatedArguments);
          case 'project_knowledge_read':
            return this.projectKnowledgeRead(validatedArguments);
          case 'project_knowledge_list':
            return this.projectKnowledgeList(validatedArguments);
          case 'use_mcp_tool':
            return await this.useMcpTool(call.arguments, context);
          default:
            return {
              toolName: call.name,
              content: `Unsupported tool requested: ${call.name}.`,
              isError: true
            };
        }
      })();

      context.onInfo?.({
        message: result.isError
          ? `Failed ${call.name}`
          : `Completed ${call.name}`,
        activity: buildToolResultActivity(call, result, truncateToolActivityText)
      });
      return result;
    } catch (error) {
      if ((error as { name?: string } | undefined)?.name === 'AbortError') {
        throw error;
      }

      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : `Tool ${call.name} failed.`;
      context.onInfo?.({
        message: `Failed ${call.name}`,
        activity: buildToolResultActivity(call, {
          toolName: call.name,
          content: message,
          isError: true
        }, truncateToolActivityText)
      });
      return {
        toolName: call.name,
        content: message,
        isError: true
      };
    }
  }

  private async useMcpTool(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    if (!this.mcpBridge) {
      throw new Error('use_mcp_tool is not available because no MCP execution bridge is configured.');
    }

    const serverId = readStringArgument(args, 'server_id');
    const toolName = readStringArgument(args, 'tool_name');
    const toolArgs = (() => {
      const value = args.arguments;
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    })();

    const catalog = await this.mcpBridge.listCatalog();
    const tool = catalog.tools.find((entry) => entry.serverId === serverId && entry.name === toolName);
    if (!tool) {
      throw new Error(`MCP tool not found or not connected: ${serverId}/${toolName}`);
    }

    if (tool.invocationMode === 'deny') {
      return {
        toolName: 'use_mcp_tool',
        content: `MCP tool ${formatMcpToolInvocationLabel(tool)} is disabled by its invocation policy.`,
        isError: true
      };
    }

    const requiresApproval =
      tool.requiresApproval && context.trustedWorkspace !== true;

    if (requiresApproval) {
      if (!context.requestApproval) {
        return {
          toolName: 'use_mcp_tool',
          content: 'use_mcp_tool requires a runtime approval handler, but none is available for this run.',
          isError: true
        };
      }

      const decision: RunToolApprovalDecision = await context.requestApproval({
        toolName: 'use_mcp_tool',
        command: `MCP ${formatMcpToolInvocationLabel(tool)}`,
        cwd: null,
        workspaceRoot: context.workspaceRoot
      });

      if (decision !== 'approved') {
        return {
          toolName: 'use_mcp_tool',
          content: `use_mcp_tool for ${formatMcpToolInvocationLabel(tool)} was not approved by the user.`,
          isError: true
        };
      }
    }

    const result = await this.mcpBridge.callTool(serverId, toolName, toolArgs);
    const flattened = flattenMcpToolResultContent(result.content);
    if (!flattened) {
      return {
        toolName: 'use_mcp_tool',
        content: `MCP tool ${formatMcpToolInvocationLabel(tool)} returned no readable text content.`,
        isError: true
      };
    }

    return {
      toolName: 'use_mcp_tool',
      content: flattened
    };
  }

  private projectKnowledgeSearch(args: Record<string, unknown>): AgentToolExecutionResult {
    if (!this.projectKnowledge?.isConfigured()) {
      return {
        toolName: 'project_knowledge_search',
        content: 'Project Knowledge is not configured.',
        isError: true
      };
    }

    const query = readStringArgument(args, 'query');
    const maxResults = readBoundedIntegerArgument(args, 'max_results', 3, 5);
    const results = this.projectKnowledge.search(query, maxResults);

    return {
      toolName: 'project_knowledge_search',
      content: results.length > 0
        ? results.map((block) => [
            `Title: ${block.title}`,
            `Source: ${block.relativePath}${block.heading ? ` > ${block.heading}` : ''}`,
            `Matched: ${block.retrievalReason.reason}`,
            block.content
          ].join('\n')).join('\n\n---\n\n')
        : 'No Project Knowledge results matched the query.'
    };
  }

  private projectKnowledgeRead(args: Record<string, unknown>): AgentToolExecutionResult {
    if (!this.projectKnowledge?.isConfigured()) {
      return {
        toolName: 'project_knowledge_read',
        content: 'Project Knowledge is not configured.',
        isError: true
      };
    }

    const path = readStringArgument(args, 'path');
    const heading = readOptionalStringArgument(args, 'heading');
    const result = this.projectKnowledge.read(path, heading);

    return result
      ? {
          toolName: 'project_knowledge_read',
          content: [
            `Title: ${result.title}`,
            `Source: ${result.relativePath}${result.heading ? ` > ${result.heading}` : ''}`,
            result.content
          ].join('\n')
        }
      : {
          toolName: 'project_knowledge_read',
          content: `Project Knowledge source not found: ${path}${heading ? ` > ${heading}` : ''}.`,
          isError: true
        };
  }

  private projectKnowledgeList(args: Record<string, unknown>): AgentToolExecutionResult {
    if (!this.projectKnowledge?.isConfigured()) {
      return {
        toolName: 'project_knowledge_list',
        content: 'Project Knowledge is not configured.',
        isError: true
      };
    }

    const maxResults = readBoundedIntegerArgument(args, 'max_results', 20, 50);
    const sources = this.projectKnowledge.list(maxResults);

    return {
      toolName: 'project_knowledge_list',
      content: sources.length > 0
        ? sources
            .map((source) => `- ${source.title}: ${source.relativePath}${source.heading ? ` > ${source.heading}` : ''}`)
            .join('\n')
        : 'No Project Knowledge markdown sources are available.'
    };
  }

  private async webSearch(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    if (!this.webResearch) {
      throw new Error('web_search is not available because no native web research backend is configured.');
    }

    const query = readStringArgument(args, 'query');
    const maxResults = readBoundedIntegerArgument(args, 'max_results', 5, 8);
    const content = await this.webResearch.search(query, {
      maxResults,
      signal: context.signal
    });

    return {
      toolName: 'web_search',
      content
    };
  }

  private async extractWebPage(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    if (!this.webResearch) {
      throw new Error('extract_web_page is not available because no native web research backend is configured.');
    }

    const url = readStringArgument(args, 'url');
    const query = readOptionalStringArgument(args, 'query');
    const content = await this.webResearch.extractPage(url, {
      query,
      signal: context.signal
    });

    return {
      toolName: 'extract_web_page',
      content
    };
  }

  private async mapSite(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    if (!this.webResearch) {
      throw new Error('map_site is not available because no native web research backend is configured.');
    }

    const url = readStringArgument(args, 'url');
    const maxPages = readBoundedIntegerArgument(args, 'max_pages', 12, 24);
    const sameOriginOnly = typeof args.same_origin_only === 'boolean'
      ? args.same_origin_only
      : true;
    const content = await this.webResearch.mapSite(url, {
      maxPages,
      sameOriginOnly,
      signal: context.signal
    });

    return {
      toolName: 'map_site',
      content
    };
  }

  private async crawlSite(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    if (!this.webResearch) {
      throw new Error('crawl_site is not available because no native web research backend is configured.');
    }

    const url = readStringArgument(args, 'url');
    const query = readOptionalStringArgument(args, 'query');
    const maxPages = readBoundedIntegerArgument(args, 'max_pages', 4, 8);
    const sameOriginOnly = typeof args.same_origin_only === 'boolean'
      ? args.same_origin_only
      : true;
    const content = await this.webResearch.crawlSite(url, {
      query,
      maxPages,
      sameOriginOnly,
      signal: context.signal
    });

    return {
      toolName: 'crawl_site',
      content
    };
  }

  private async researchTopic(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    if (!this.webResearch) {
      throw new Error('research_topic is not available because no native web research backend is configured.');
    }

    const query = readStringArgument(args, 'query');
    const maxResults = readBoundedIntegerArgument(args, 'max_results', 5, 8);
    const maxPages = readBoundedIntegerArgument(args, 'max_pages', 3, 5);
    const content = await this.webResearch.researchTopic(query, {
      maxResults,
      maxPages,
      signal: context.signal
    });

    return {
      toolName: 'research_topic',
      content
    };
  }

  private async browserPreviewCheck(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    if (!this.browserPreview) {
      throw new Error('browser_preview_check is not available because no browser preview backend is configured.');
    }

    const url = readStringArgument(args, 'url');
    const expectedText = readOptionalStringArgument(args, 'expected_text');
    const expectedSelectors = readBrowserPreviewExpectedSelectors(args);
    const captureScreenshot = args.capture_screenshot === true;
    const timeoutMs = Math.max(
      1_000,
      readBoundedIntegerArgument(args, 'timeout_ms', 10_000, 30_000)
    );
    const result = await this.browserPreview.checkPreview({
      url,
      expectedText,
      expectedSelectors,
      captureScreenshot,
      timeoutMs,
      signal: context.signal
    });

    const healthy = isBrowserPreviewHealthy(result);
    return {
      toolName: 'browser_preview_check',
      content: formatBrowserPreviewResult(result),
      isError: healthy ? undefined : true
    };
  }

  private async listDirectory(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    const requestedPath = readOptionalStringArgument(args, 'path') ?? '.';
    const maxEntries = readBoundedIntegerArgument(
      args,
      'max_entries',
      60,
      MAX_DIRECTORY_ENTRIES
    );
    const resolved = normalizeWorkspacePath(
      context.workspaceRoot,
      requestedPath
    );
    const entries = await readdir(resolved.absolutePath, {
      withFileTypes: true
    });
    const formattedEntries = entries
      .slice()
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      })
      .slice(0, maxEntries)
      .map(
        (entry) =>
          `${entry.isDirectory() ? 'dir ' : 'file'} ${entry.name}${entry.isDirectory() ? '/' : ''}`
      );

    const displayPath = formatWorkspacePathLabel(resolved.relativePath);
    const summary = `Opened ${displayPath}`;

    context.onInfo?.({
      message: summary,
        activity: {
          kind: 'file_open',
          path: displayPath,
          summary
        }
      });

    return {
      toolName: 'list_directory',
      content:
        formattedEntries.length > 0
          ? formattedEntries.join('\n')
          : '[empty directory]'
    };
  }

  private async readFile(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    const requestedPath = readStringArgument(args, 'path');
    const resolved = normalizeWorkspacePath(
      context.workspaceRoot,
      requestedPath
    );
    const content = await readFile(resolved.absolutePath, 'utf8');
    const size = Buffer.byteLength(content, 'utf8');

    if (size > MAX_READ_FILE_BYTES) {
      throw new Error(
        `File is too large to read safely in one tool call: ${resolved.relativePath}`
      );
    }

    context.onInfo?.({
      message: `Read ${resolved.relativePath}`,
      activity: {
        kind: 'file_read',
        path: resolved.relativePath,
        summary: `Read ${resolved.relativePath}`
      }
    });

    return {
      toolName: 'read_file',
      content
    };
  }

  private async searchText(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    const query = readStringArgument(args, 'query');
    const requestedPath = readOptionalStringArgument(args, 'path') ?? '.';
    const searchPath = containsGlobSyntax(requestedPath)
      ? getGlobSearchBasePath(requestedPath)
      : requestedPath;
    const maxResults = readBoundedIntegerArgument(
      args,
      'max_results',
      20,
      MAX_SEARCH_RESULTS
    );
    const resolved = normalizeWorkspacePath(
      context.workspaceRoot,
      searchPath
    );
    const results: string[] = [];
    const lowerQuery = query.toLowerCase();

    const searchFile = async (absolutePath: string, relativePath: string) => {
      if (results.length >= maxResults) {
        return;
      }

      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile() || fileStat.size > MAX_READ_FILE_BYTES) {
        return;
      }

      const content = await readFile(absolutePath, 'utf8');
      if (looksBinary(content)) {
        return;
      }

      const lines = content.split(/\r?\n/u);
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].toLowerCase().includes(lowerQuery)) {
          results.push(
            `${relativePath}:${index + 1}: ${lines[index]}`.trimEnd()
          );
          if (results.length >= maxResults) {
            return;
          }
        }
      }
    };

    const walkDirectory = async (
      absolutePath: string,
      relativePath: string
    ) => {
      if (results.length >= maxResults) {
        return;
      }

      const entries = await readdir(absolutePath, { withFileTypes: true });
      const sorted = entries
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of sorted) {
        if (results.length >= maxResults) {
          return;
        }
        if (entry.isDirectory()) {
          if (SEARCH_IGNORED_DIRECTORIES.has(entry.name)) {
            continue;
          }
          const nextAbsolutePath = resolve(absolutePath, entry.name);
          const nextRelativePath =
            relativePath === '.' ? entry.name : `${relativePath}/${entry.name}`;
          await walkDirectory(nextAbsolutePath, nextRelativePath);
          continue;
        }
        if (entry.isFile()) {
          const nextAbsolutePath = resolve(absolutePath, entry.name);
          const nextRelativePath =
            relativePath === '.' ? entry.name : `${relativePath}/${entry.name}`;
          await searchFile(nextAbsolutePath, nextRelativePath);
        }
      }
    };

    const targetStat = await stat(resolved.absolutePath);
    if (targetStat.isFile()) {
      await searchFile(resolved.absolutePath, resolved.relativePath);
    } else if (targetStat.isDirectory()) {
      await walkDirectory(resolved.absolutePath, resolved.relativePath);
    } else {
      throw new Error(
        `Search target is not a file or directory: ${resolved.relativePath}`
      );
    }

    const summary = `Searched files for ${query}`;
    context.onInfo?.({
      message: summary,
      activity: {
        kind: 'file_search',
        path: resolved.relativePath,
        query,
        summary
      }
    });

    return {
      toolName: 'search_text',
      content:
        results.length > 0 ? results.join('\n') : `[no matches for "${query}"]`
    };
  }

  private async makeDirectory(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    const requestedPath = readStringArgument(args, 'path');
    if (context.isolationMode === 'patch_buffer') {
      const stagedWorkspaceChangeSet = stageWorkspaceDirectory(requestedPath, context);
      const summary = `Staged mkdir ${stagedWorkspaceChangeSet.changedPaths[0]}`;

      return {
        toolName: 'mkdir',
        content: summary,
        stagedWorkspaceChangeSet
      };
    }

    const resolved = await createWorkspaceDirectory(requestedPath, context);

    const summary = 'Created folder';
    const content = `Created ${resolved.relativePath}`;
    context.onInfo?.({
      message: summary,
      activity: {
        kind: 'mkdir',
        path: resolved.relativePath,
        summary
      }
    });

    return {
      toolName: 'mkdir',
      content
    };
  }

  private async createSkillBundle(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    if (!this.creators) {
      throw new Error('create_skill_bundle is not available because no Vicode creator bridge is configured.');
    }

    const input = parseSkillBundleToolInput(args);
    const created = await this.creators.createSkillBundle(input);
    const summary = `${created.existed ? 'Updated' : 'Created'} ${created.relativeRootPath}`;
    context.onInfo?.({
      message: summary,
      activity: {
        kind: 'file_write',
        path: created.relativeRootPath,
        summary
      }
    });

    return {
      toolName: 'create_skill_bundle',
      content: [
        summary,
        `scope: ${created.scope}`,
        created.projectId ? `project_id: ${created.projectId}` : null,
        created.importedId ? `skill_id: ${created.importedId}` : null,
        'files:',
        ...created.filePaths.map((path) => `- ${path}`)
      ]
        .filter((value): value is string => Boolean(value))
        .join('\n')
    };
  }

  private async createPluginBundle(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    if (!this.creators) {
      throw new Error('create_plugin_bundle is not available because no Vicode creator bridge is configured.');
    }

    const input = parsePluginBundleToolInput(args);
    const created = await this.creators.createPluginBundle(input);
    const summary = `${created.existed ? 'Updated' : 'Created'} ${created.relativeRootPath}`;
    context.onInfo?.({
      message: summary,
      activity: {
        kind: 'file_write',
        path: created.relativeRootPath,
        summary
      }
    });

    return {
      toolName: 'create_plugin_bundle',
      content: [
        summary,
        `scope: ${created.scope}`,
        created.projectId ? `project_id: ${created.projectId}` : null,
        created.importedId ? `server_id: ${created.importedId}` : null,
        'files:',
        ...created.filePaths.map((path) => `- ${path}`)
      ]
        .filter((value): value is string => Boolean(value))
        .join('\n')
    };
  }

  private async writeFile(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    const requestedPath = readStringArgument(args, 'path');
    const content = typeof args.content === 'string' ? args.content : null;
    if (content === null) {
      throw new Error('Tool argument "content" must be a string.');
    }
    if (context.isolationMode === 'patch_buffer') {
      const stagedWorkspaceChangeSet = await stageWorkspaceTextFile(
        requestedPath,
        content,
        context
      );
      const summary = `Staged write_file ${stagedWorkspaceChangeSet.changedPaths[0]}`;

      return {
        toolName: 'write_file',
        content: summary,
        stagedWorkspaceChangeSet
      };
    }

    const resolved = await writeWorkspaceTextFile(
      requestedPath,
      content,
      context
    );

    const summary = `Wrote ${resolved.relativePath}`;
    context.onInfo?.({
      message: summary,
      activity: {
        kind: 'file_write',
        path: resolved.relativePath,
        summary
      }
    });

    return {
      toolName: 'write_file',
      content: summary
    };
  }

  private async applyPatch(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    const patch = readStringArgument(args, 'patch');
    if (context.isolationMode === 'patch_buffer') {
      const stagedWorkspaceChangeSet = await stageWorkspacePatch(patch, context);
      const summary =
        stagedWorkspaceChangeSet.changedPaths.length === 1
          ? `Staged apply_patch ${stagedWorkspaceChangeSet.changedPaths[0]}`
          : `Staged apply_patch ${stagedWorkspaceChangeSet.changedPaths.length} files`;

      return {
        toolName: 'apply_patch',
        content: summary,
        stagedWorkspaceChangeSet
      };
    }

    const stagedWorkspaceChangeSet = await stageWorkspacePatch(patch, context);
    const preview = createStagedWorkspacePreviewArtifact(stagedWorkspaceChangeSet);
    if (!context.requestApproval) {
      return {
        toolName: 'apply_patch',
        content: 'apply_patch requires diff approval before workspace files can be changed.',
        isError: true
      };
    }

    const operationKinds = Array.from(new Set(stagedWorkspaceChangeSet.operations.map((operation) => operation.operation)));
    const approvalDecision = await context.requestApproval({
      toolName: 'apply_patch',
      command:
        stagedWorkspaceChangeSet.changedPaths.length === 1
          ? `apply_patch ${stagedWorkspaceChangeSet.changedPaths[0]}`
          : `apply_patch ${stagedWorkspaceChangeSet.changedPaths.length} files`,
      cwd: null,
      workspaceRoot: context.workspaceRoot,
      approvalKind: 'workspace_change',
      workspaceChange: {
        sourceToolName: 'apply_patch',
        changedPaths: stagedWorkspaceChangeSet.changedPaths,
        operationKinds,
        summary: preview.summary,
        preview
      }
    });

    if (approvalDecision === 'rejected') {
      return {
        toolName: 'apply_patch',
        content: 'apply_patch was not approved by the user.',
        isError: true
      };
    }

    if (approvalDecision === 'cancelled') {
      const error = new Error('Agent runtime was aborted.');
      error.name = 'AbortError';
      throw error;
    }

    const changedPaths = await applyStagedWorkspaceChangeSet(stagedWorkspaceChangeSet, context);

    const summary =
      changedPaths.length === 1
        ? `Patched ${changedPaths[0]}`
        : `Patched ${changedPaths.length} files`;

    context.onInfo?.({
      message: summary,
      activity: {
        kind: 'file_write',
        path: changedPaths.length === 1 ? changedPaths[0] : null,
        summary
      }
    });

    return {
      toolName: 'apply_patch',
      content: summary
    };
  }

  private async runCommand(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    const requestedCwd =
      typeof args.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : '.';
    const command = readStringArgument(args, 'command');
    const executionResolution = resolveRunCommandExecution(
      command,
      requestedCwd,
      context
    );
    if ('errorResult' in executionResolution) {
      return executionResolution.errorResult;
    }
    const { resolvedCwd } = executionResolution;
    const approvalResult = await requestRunCommandApprovalIfNeeded(
      command,
      resolvedCwd,
      context
    );
    if (approvalResult) {
      return approvalResult;
    }

    const commandSession = await spawnIsolatedCommand(
      'cmd.exe',
      ['/d', '/s', '/c', command],
      {
        cwd: resolvedCwd.absolutePath,
        env: process.env
      }
    );
    const child = commandSession.child;

    context.onInfo?.({
      message: `Running ${command}`,
      activity: {
        kind: 'terminal_command',
        phase: 'started',
        command,
        cwd: resolvedCwd.absolutePath,
        isolationMode: commandSession.isolationMode,
        summary: `Running ${command}`
      }
    });

    return await new Promise<AgentToolExecutionResult>(
      (resolvePromise, rejectPromise) => {
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;
        const finishReject = async (error: Error) => {
          if (settled) {
            return;
          }
          settled = true;
          await commandSession.cleanup();
          rejectPromise(error);
        };

        const finishResolve = async (result: AgentToolExecutionResult) => {
          if (settled) {
            return;
          }
          settled = true;
          await commandSession.cleanup();
          resolvePromise(result);
        };

        const handleAbort = () => {
          void commandSession.terminate();
        };

        const cleanupAbort = () => {
          if (context.signal) {
            context.signal.removeEventListener('abort', handleAbort);
          }
          clearTimeout(timer);
        };

        if (context.signal?.aborted) {
          void commandSession.terminate();
          cleanupAbort();
          void finishReject(createAbortError());
          return;
        }

        const timer = setTimeout(() => {
          timedOut = true;
          void commandSession.terminate();
        }, COMMAND_TIMEOUT_MS);

        context.signal?.addEventListener('abort', handleAbort, { once: true });

        child.stdout.on('data', (chunk) => {
          stdout += String(chunk);
        });
        child.stderr.on('data', (chunk) => {
          stderr += String(chunk);
        });
        child.on('error', (error) => {
          cleanupAbort();
          void finishReject(
            error instanceof Error
              ? error
              : new Error('Failed to launch command.')
          );
        });
        child.on('close', (code) => {
          cleanupAbort();
          if (context.signal?.aborted) {
            void finishReject(createAbortError());
            return;
          }
          if (timedOut) {
            void finishReject(
              new Error(
                `Command timed out after ${Math.round(COMMAND_TIMEOUT_MS / 1000)} seconds.`
              )
            );
            return;
          }

          const truncatedStdout = truncateOutput(stdout.trim());
          const truncatedStderr = truncateOutput(stderr.trim());
          const summary =
            code === 0
              ? `Ran ${command}`
              : `Command exited with code ${code ?? -1}: ${command}`;

          context.onInfo?.({
            message: summary,
            activity: {
              kind: 'terminal_command',
              phase: 'completed',
              command,
              cwd: resolvedCwd.absolutePath,
              isolationMode: commandSession.isolationMode,
              summary,
              outputLines: [truncatedStdout, truncatedStderr].filter(Boolean)
            }
          });

          const content = [
            `exit_code: ${code ?? -1}`,
            `cwd: ${resolvedCwd.absolutePath}`,
            `stdout:\n${truncatedStdout || '[empty]'}`,
            `stderr:\n${truncatedStderr || '[empty]'}`
          ].join('\n\n');

          void finishResolve({
            toolName: 'run_command',
            content,
            isError: code !== 0
          });
        });
      }
    );
  }

  private parseSubagentTaskInput(
    value: unknown,
    index: number
  ): ParsedSubagentTaskInput {
    if (!isRecord(value)) {
      throw new Error(`spawn_subagents task ${index + 1} must be an object.`);
    }

    const rawName = typeof value.name === 'string' ? value.name.trim() : '';
    const name = rawName.length > 0 ? rawName.slice(0, 48) : undefined;
    const title = typeof value.title === 'string' ? value.title.trim() : '';
    if (!title) {
      throw new Error(`spawn_subagents task ${index + 1} requires a title.`);
    }
    if (title.length > MAX_SUBAGENT_TITLE_CHARS) {
      throw new Error(
        `spawn_subagents task ${index + 1} title must be ${MAX_SUBAGENT_TITLE_CHARS} characters or fewer.`
      );
    }

    const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
    if (!prompt) {
      throw new Error(`spawn_subagents task ${index + 1} requires a prompt.`);
    }
    if (prompt.length > MAX_SUBAGENT_PROMPT_CHARS) {
      throw new Error(
        `spawn_subagents task ${index + 1} prompt must be ${MAX_SUBAGENT_PROMPT_CHARS} characters or fewer.`
      );
    }

    const rawProfile = typeof value.delegation_profile === 'string'
      ? value.delegation_profile.trim().toLowerCase()
      : '';
    if (rawProfile && !SUBAGENT_PROFILES.has(rawProfile as AutonomyDelegationProfile)) {
      throw new Error(`spawn_subagents task ${index + 1} has an unsupported delegation_profile.`);
    }

    const rawReasoningEffort = typeof value.reasoning_effort === 'string'
      ? value.reasoning_effort.trim().toLowerCase()
      : null;
    if (rawReasoningEffort && !PROVIDER_REASONING_EFFORTS.has(rawReasoningEffort as ProviderReasoningEffort)) {
      throw new Error(`spawn_subagents task ${index + 1} has an unsupported reasoning_effort.`);
    }

    return {
      name,
      title,
      prompt,
      delegationProfile: (rawProfile as AutonomyDelegationProfile) || 'research',
      reasoningEffort: (rawReasoningEffort as ProviderReasoningEffort | null) ?? null
    };
  }

  private async spawnSubagents(
    args: Record<string, unknown>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult> {
    if (!this.subagents) {
      throw new Error('spawn_subagents is not available because no subagent orchestrator is configured.');
    }
    if (!context.threadId || !context.runId) {
      throw new Error('spawn_subagents requires an active parent thread and run context.');
    }

    const maxDelegationDepth = context.executionConstraints?.maxDelegationDepth;
    if (typeof maxDelegationDepth === 'number' && maxDelegationDepth <= 0) {
      throw new Error('spawn_subagents is disabled for delegated helper runs.');
    }

    const rawTasks = args.tasks;
    if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
      throw new Error('spawn_subagents requires a non-empty tasks array.');
    }
    if (rawTasks.length > MAX_SUBAGENT_TASKS_PER_CALL) {
      throw new Error(
        `spawn_subagents can launch at most ${MAX_SUBAGENT_TASKS_PER_CALL} helpers in one call.`
      );
    }

    const siblingLimit =
      typeof context.executionConstraints?.maxSiblingDelegates === 'number'
        ? context.executionConstraints.maxSiblingDelegates
        : MAX_SUBAGENT_TASKS_PER_CALL;
    if (siblingLimit <= 0) {
      throw new Error('spawn_subagents is disabled under the active execution constraints.');
    }
    if (rawTasks.length > siblingLimit) {
      throw new Error(
        `spawn_subagents can launch at most ${siblingLimit} helper${siblingLimit === 1 ? '' : 's'} in this run.`
      );
    }

    const activeSubagents = this.subagents
      .listForThread(context.threadId)
      .filter((subagent) => ACTIVE_SUBAGENT_STATUSES.has(subagent.status));
    if (activeSubagents.length + rawTasks.length > siblingLimit) {
      const remaining = Math.max(siblingLimit - activeSubagents.length, 0);
      throw new Error(
        remaining === 0
          ? 'This run already has the maximum number of active delegated helpers.'
          : `This run can launch only ${remaining} more delegated helper${remaining === 1 ? '' : 's'} right now.`
      );
    }

    const tasks = rawTasks.map((task, index) => this.parseSubagentTaskInput(task, index));
    const spawned: SubagentSummary[] = [];

    try {
      for (const task of tasks) {
        const subagent = await this.subagents.spawn({
          parentThreadId: context.threadId,
          parentRunId: context.runId,
          name: task.name,
          title: task.title,
          prompt: task.prompt,
          reasoningEffort: task.reasoningEffort,
          executionPermission: context.executionPermission,
          delegationProfile: task.delegationProfile
        });
        spawned.push(subagent);
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Unable to launch delegated helpers.';
      if (spawned.length > 0) {
        throw new Error(
          `Spawned ${spawned.length} delegated helper${spawned.length === 1 ? '' : 's'}, then hit a blocker: ${message}`
        );
      }
      throw error;
    }

    return {
      toolName: 'spawn_subagents',
      content: [
        `Spawned ${spawned.length} delegated helper${spawned.length === 1 ? '' : 's'}:`,
        ...spawned.map(
          (subagent) =>
            `- ${subagent.name}: ${subagent.title} [${subagent.delegationProfile}, ${subagent.status}]`
        ),
        'These helpers are running in the background. Continue the parent task without waiting unless their findings are immediately required.'
      ].join('\n')
    };
  }

  private async assertToolPolicy(
    toolName: string,
    context: AgentToolExecutionContext
  ) {
    const constraints = context.executionConstraints;
    if (constraints) {
      const catalog = await this.listToolCatalog({
        executionPermission: context.executionPermission,
        trustedWorkspace: context.trustedWorkspace,
        executionConstraints: constraints,
        runtimeCommandPolicy: context.runtimeCommandPolicy,
        runtimeNetworkPolicy: context.runtimeNetworkPolicy
      });
      const toolAllowed = catalog.tools.some((tool) => tool.callName === toolName);
      if (!toolAllowed) {
        throw new Error(
          `Tool ${toolName} is not available under the active execution constraints.`
        );
      }
    }

    if (toolName === 'run_command') {
      assertRunCommandToolPolicy(context);
      return;
    }

    if (isNativeWebResearchToolName(toolName)) {
      const runtimePolicy = evaluateRuntimeNetworkAccess(
        context.executionPermission,
        context.runtimeCommandPolicy,
        context.runtimeNetworkPolicy
      );
      if (runtimePolicy.access === 'disabled' && runtimePolicy.deniedReason) {
        throw new Error(
          `${toolName} is blocked by this workspace network policy. Approved network access is disabled here.`
        );
      }
    }

    const deniedMessage = getAgentToolDeniedMessage(
      toolName,
      context.executionPermission
    );
    if (!deniedMessage) {
      return;
    }

    if (deniedMessage.startsWith('Unsupported tool requested:')) {
      return;
    }

    throw new Error(deniedMessage);
  }
}
