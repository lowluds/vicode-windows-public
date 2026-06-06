import { z } from 'zod';
import type { AgentRuntimeToolVisibilityGroup } from './agent-runtime';

export interface NativeAgentRuntimeToolDefinition {
  callName: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  inputJsonSchema: Record<string, unknown>;
  requiresApproval: boolean | null;
  concurrencySafe: boolean;
  visibilityGroup: AgentRuntimeToolVisibilityGroup;
  mutatesWorkspace: boolean;
  readsWorkspace: boolean;
  usesNetwork: boolean;
}

type NativeAgentRuntimeToolInput = Omit<NativeAgentRuntimeToolDefinition, 'inputJsonSchema'>;

function toProviderJsonSchema(inputSchema: z.ZodTypeAny) {
  return z.toJSONSchema(inputSchema) as Record<string, unknown>;
}

function defineNativeTool(input: NativeAgentRuntimeToolInput): NativeAgentRuntimeToolDefinition {
  return {
    ...input,
    inputJsonSchema: toProviderJsonSchema(input.inputSchema)
  };
}

function nonEmptyString(description: string) {
  return z.string().trim().min(1).describe(description);
}

const optionalString = (description: string) => z.string().describe(description).optional();
const optionalNumber = (description: string) => z.number().describe(description).optional();

const bundleFileSchema = z.object({
  path: nonEmptyString('Path inside the bundle, such as SKILL.md, .vicode-skill.json, .codex-plugin/plugin.json, or .mcp.json.'),
  content: z.string().describe('UTF-8 file content.')
});

const creatorBundleInputSchema = z.object({
  scope: z.enum(['global', 'project']).describe('Whether the bundle should be global or project-scoped.'),
  project_id: optionalString('Project id required when scope is "project".'),
  folder_name: nonEmptyString('Single folder name for the bundle.'),
  files: z.array(bundleFileSchema)
    .min(1)
    .max(16)
    .describe('Files to write inside the bundle root.')
});

export const NATIVE_AGENT_RUNTIME_TOOL_DEFINITIONS: NativeAgentRuntimeToolDefinition[] = [
  defineNativeTool({
    callName: 'apply_patch',
    description: 'Apply a unified patch to files inside the workspace.',
    inputSchema: z.object({
      patch: nonEmptyString('Unified patch content to apply inside the workspace.')
    }),
    requiresApproval: true,
    concurrencySafe: false,
    visibilityGroup: 'workspace_write',
    mutatesWorkspace: true,
    readsWorkspace: false,
    usesNetwork: false
  }),
  defineNativeTool({
    callName: 'create_plugin_bundle',
    description: 'Create or update one Vicode plugin bundle inside Vicode app state.',
    inputSchema: creatorBundleInputSchema,
    requiresApproval: false,
    concurrencySafe: false,
    visibilityGroup: 'workspace_write',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: false
  }),
  defineNativeTool({
    callName: 'create_skill_bundle',
    description: 'Create or update one Vicode skill bundle inside Vicode app state.',
    inputSchema: creatorBundleInputSchema,
    requiresApproval: false,
    concurrencySafe: false,
    visibilityGroup: 'workspace_write',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: false
  }),
  defineNativeTool({
    callName: 'crawl_site',
    description: 'Crawl a site and extract a bounded set of relevant pages.',
    inputSchema: z.object({
      url: nonEmptyString('HTTP or HTTPS seed URL to crawl.'),
      query: optionalString('Optional research focus to keep the crawl relevant.'),
      max_pages: optionalNumber('Optional maximum number of pages to crawl.'),
      same_origin_only: z.boolean()
        .describe('Optional flag to keep the crawl on the same origin as the seed URL. Defaults to true.')
        .optional()
    }),
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'web_research',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: true
  }),
  defineNativeTool({
    callName: 'browser_preview_check',
    description: 'Load a local browser preview and report whether the page renders without obvious runtime failures.',
    inputSchema: z.object({
      url: nonEmptyString('Local HTTP or HTTPS preview URL to check, such as http://localhost:5173.'),
      expected_text: optionalString('Optional visible text expected to appear on the page.'),
      expected_selectors: z.array(z.string())
        .max(8)
        .describe('Optional CSS selectors expected to exist on the page.')
        .optional(),
      capture_screenshot: z.boolean()
        .describe('Whether to save a bounded screenshot artifact for the thread.')
        .optional(),
      timeout_ms: optionalNumber('Optional load timeout in milliseconds. Defaults to 10000 and is capped at 30000.')
    }),
    requiresApproval: false,
    concurrencySafe: false,
    visibilityGroup: 'browser_preview',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: false
  }),
  defineNativeTool({
    callName: 'extract_web_page',
    description: 'Fetch and summarize one web page relevant to the task.',
    inputSchema: z.object({
      url: nonEmptyString('HTTP or HTTPS URL to extract.'),
      query: optionalString('Optional user intent to focus the extracted page content.')
    }),
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'web_research',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: true
  }),
  defineNativeTool({
    callName: 'list_directory',
    description: 'List files and folders inside the workspace.',
    inputSchema: z.object({
      path: optionalString('Optional directory path relative to the active workspace root.'),
      max_entries: optionalNumber('Optional maximum number of entries to return.')
    }),
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'workspace_read',
    mutatesWorkspace: false,
    readsWorkspace: true,
    usesNetwork: false
  }),
  defineNativeTool({
    callName: 'map_site',
    description: 'Map a site structure before reading specific pages.',
    inputSchema: z.object({
      url: nonEmptyString('HTTP or HTTPS URL to inspect for crawlable links.'),
      max_pages: optionalNumber('Optional maximum number of discovered URLs to return.'),
      same_origin_only: z.boolean()
        .describe('Optional flag to keep results on the same origin as the seed URL. Defaults to true.')
        .optional()
    }),
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'web_research',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: true
  }),
  defineNativeTool({
    callName: 'mkdir',
    description: 'Create a directory inside the workspace.',
    inputSchema: z.object({
      path: nonEmptyString('Directory path to create, relative to the active workspace root.')
    }),
    requiresApproval: false,
    concurrencySafe: false,
    visibilityGroup: 'workspace_write',
    mutatesWorkspace: true,
    readsWorkspace: false,
    usesNetwork: false
  }),
  defineNativeTool({
    callName: 'project_knowledge_search',
    description: 'Search the user-connected Project Knowledge folder for relevant markdown sections.',
    inputSchema: z.object({
      query: nonEmptyString('Search query for Project Knowledge.'),
      max_results: optionalNumber('Optional maximum number of results to return.')
    }),
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'knowledge',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: false
  }),
  defineNativeTool({
    callName: 'project_knowledge_read',
    description: 'Read one source-backed Project Knowledge markdown section by relative path and optional heading.',
    inputSchema: z.object({
      path: nonEmptyString('Relative markdown path inside the Project Knowledge folder.'),
      heading: optionalString('Optional markdown heading to focus.')
    }),
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'knowledge',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: false
  }),
  defineNativeTool({
    callName: 'project_knowledge_list',
    description: 'List indexed Project Knowledge markdown sources with titles and relative paths.',
    inputSchema: z.object({
      max_results: optionalNumber('Optional maximum number of sources to list.')
    }),
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'knowledge',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: false
  }),
  defineNativeTool({
    callName: 'read_file',
    description: 'Read one text file inside the workspace.',
    inputSchema: z.object({
      path: nonEmptyString('Path to the file, relative to the active workspace root.')
    }),
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'workspace_read',
    mutatesWorkspace: false,
    readsWorkspace: true,
    usesNetwork: false
  }),
  defineNativeTool({
    callName: 'research_topic',
    description: 'Run a broader web research pass for a topic.',
    inputSchema: z.object({
      query: nonEmptyString('Search query describing the information to look up.'),
      max_results: optionalNumber('Optional maximum number of search results to return.'),
      max_pages: optionalNumber('Optional maximum number of fetched pages to include.')
    }),
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'web_research',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: true
  }),
  defineNativeTool({
    callName: 'run_command',
    description: 'Run one Windows shell command starting in the workspace.',
    inputSchema: z.object({
      command: nonEmptyString('Shell command to execute.'),
      cwd: optionalString('Optional working directory relative to the active workspace root.')
    }),
    requiresApproval: null,
    concurrencySafe: false,
    visibilityGroup: 'host_command',
    mutatesWorkspace: true,
    readsWorkspace: true,
    usesNetwork: true
  }),
  defineNativeTool({
    callName: 'spawn_subagents',
    description: 'Launch one or more bounded background explorer or verifier helpers for parallel investigation.',
    inputSchema: z.object({
      tasks: z.array(z.object({
        name: optionalString('Optional helper name for the transcript.'),
        title: nonEmptyString('Short task title that will appear in the delegated activity card.'),
        prompt: nonEmptyString('Self-contained delegated instructions for the helper.'),
        delegation_profile: z.enum(['research', 'verify', 'heartbeat'])
          .describe('Optional helper role. Defaults to research.')
          .optional(),
        reasoning_effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
          .describe('Optional reasoning effort override for this helper.')
          .optional()
      }))
        .min(1)
        .max(3)
        .describe('One or more delegated helper tasks to run in parallel.')
    }),
    requiresApproval: false,
    concurrencySafe: false,
    visibilityGroup: 'delegate',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: false
  }),
  defineNativeTool({
    callName: 'search_text',
    description: 'Search workspace text content with bounded results.',
    inputSchema: z.object({
      query: nonEmptyString('Case-insensitive text query to search for.'),
      path: optionalString('Optional file or directory path relative to the active workspace root.'),
      max_results: optionalNumber('Optional maximum number of search matches to return.')
    }),
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'workspace_read',
    mutatesWorkspace: false,
    readsWorkspace: true,
    usesNetwork: false
  }),
  defineNativeTool({
    callName: 'web_search',
    description: 'Search the web when network-backed research is relevant.',
    inputSchema: z.object({
      query: nonEmptyString('Search query describing the information to look up.'),
      max_results: optionalNumber('Optional maximum number of search results to return.')
    }),
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'web_research',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: true
  }),
  defineNativeTool({
    callName: 'write_file',
    description: 'Create or overwrite a file inside the workspace.',
    inputSchema: z.object({
      path: nonEmptyString('Path to the file, relative to the active workspace root.'),
      content: z.string().describe('Full UTF-8 text content to write into the file.')
    }),
    requiresApproval: false,
    concurrencySafe: false,
    visibilityGroup: 'workspace_write',
    mutatesWorkspace: true,
    readsWorkspace: false,
    usesNetwork: false
  })
];

export const NATIVE_WEB_RESEARCH_TOOL_NAMES = new Set(
  NATIVE_AGENT_RUNTIME_TOOL_DEFINITIONS
    .filter((tool) => tool.visibilityGroup === 'web_research')
    .map((tool) => tool.callName)
);

export function findNativeAgentRuntimeToolDefinition(callName: string) {
  return NATIVE_AGENT_RUNTIME_TOOL_DEFINITIONS.find((tool) => tool.callName === callName) ?? null;
}

export function isNativeWebResearchToolName(callName: string) {
  return NATIVE_WEB_RESEARCH_TOOL_NAMES.has(callName);
}
