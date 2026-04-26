import type { AgentRuntimeToolVisibilityGroup } from './agent-runtime';

export interface NativeAgentRuntimeToolDefinition {
  callName: string;
  description: string;
  inputJsonSchema: Record<string, unknown>;
  requiresApproval: boolean | null;
  concurrencySafe: boolean;
  visibilityGroup: AgentRuntimeToolVisibilityGroup;
  mutatesWorkspace: boolean;
  readsWorkspace: boolean;
  usesNetwork: boolean;
}

export const NATIVE_AGENT_RUNTIME_TOOL_DEFINITIONS: NativeAgentRuntimeToolDefinition[] = [
  {
    callName: 'apply_patch',
    description: 'Apply a unified patch to files inside the workspace.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        patch: {
          type: 'string',
          description: 'Unified patch content to apply inside the workspace.'
        }
      },
      required: ['patch']
    },
    requiresApproval: false,
    concurrencySafe: false,
    visibilityGroup: 'workspace_write',
    mutatesWorkspace: true,
    readsWorkspace: false,
    usesNetwork: false
  },
  {
    callName: 'create_plugin_bundle',
    description: 'Create or update one Vicode plugin bundle inside Vicode app state.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['global', 'project'],
          description: 'Whether the plugin should be global or project-scoped.'
        },
        project_id: {
          type: 'string',
          description: 'Project id required when scope is "project".'
        },
        folder_name: {
          type: 'string',
          description: 'Single folder name for the plugin bundle.'
        },
        files: {
          type: 'array',
          description: 'Files to write inside the plugin bundle root.',
          minItems: 1,
          maxItems: 16,
          items: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path inside the plugin bundle, such as .codex-plugin/plugin.json or .mcp.json.'
              },
              content: {
                type: 'string',
                description: 'UTF-8 file content.'
              }
            },
            required: ['path', 'content']
          }
        }
      },
      required: ['scope', 'folder_name', 'files']
    },
    requiresApproval: false,
    concurrencySafe: false,
    visibilityGroup: 'workspace_write',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: false
  },
  {
    callName: 'create_skill_bundle',
    description: 'Create or update one Vicode skill bundle inside Vicode app state.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['global', 'project'],
          description: 'Whether the skill should be global or project-scoped.'
        },
        project_id: {
          type: 'string',
          description: 'Project id required when scope is "project".'
        },
        folder_name: {
          type: 'string',
          description: 'Single folder name for the skill bundle.'
        },
        files: {
          type: 'array',
          description: 'Files to write inside the skill bundle root.',
          minItems: 1,
          maxItems: 16,
          items: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path inside the skill bundle, such as SKILL.md or .vicode-skill.json.'
              },
              content: {
                type: 'string',
                description: 'UTF-8 file content.'
              }
            },
            required: ['path', 'content']
          }
        }
      },
      required: ['scope', 'folder_name', 'files']
    },
    requiresApproval: false,
    concurrencySafe: false,
    visibilityGroup: 'workspace_write',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: false
  },
  {
    callName: 'crawl_site',
    description: 'Crawl a site and extract a bounded set of relevant pages.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'HTTP or HTTPS seed URL to crawl.'
        },
        query: {
          type: 'string',
          description: 'Optional research focus to keep the crawl relevant.'
        },
        max_pages: {
          type: 'number',
          description: 'Optional maximum number of pages to crawl.'
        },
        same_origin_only: {
          type: 'boolean',
          description: 'Optional flag to keep the crawl on the same origin as the seed URL. Defaults to true.'
        }
      },
      required: ['url']
    },
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'web_research',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: true
  },
  {
    callName: 'extract_web_page',
    description: 'Fetch and summarize one web page relevant to the task.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'HTTP or HTTPS URL to extract.'
        },
        query: {
          type: 'string',
          description: 'Optional user intent to focus the extracted page content.'
        }
      },
      required: ['url']
    },
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'web_research',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: true
  },
  {
    callName: 'list_directory',
    description: 'List files and folders inside the workspace.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional directory path relative to the active workspace root.'
        },
        max_entries: {
          type: 'number',
          description: 'Optional maximum number of entries to return.'
        }
      }
    },
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'workspace_read',
    mutatesWorkspace: false,
    readsWorkspace: true,
    usesNetwork: false
  },
  {
    callName: 'map_site',
    description: 'Map a site structure before reading specific pages.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'HTTP or HTTPS URL to inspect for crawlable links.'
        },
        max_pages: {
          type: 'number',
          description: 'Optional maximum number of discovered URLs to return.'
        },
        same_origin_only: {
          type: 'boolean',
          description: 'Optional flag to keep results on the same origin as the seed URL. Defaults to true.'
        }
      },
      required: ['url']
    },
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'web_research',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: true
  },
  {
    callName: 'mkdir',
    description: 'Create a directory inside the workspace.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to create, relative to the active workspace root.'
        }
      },
      required: ['path']
    },
    requiresApproval: false,
    concurrencySafe: false,
    visibilityGroup: 'workspace_write',
    mutatesWorkspace: true,
    readsWorkspace: false,
    usesNetwork: false
  },
  {
    callName: 'read_file',
    description: 'Read one text file inside the workspace.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file, relative to the active workspace root.'
        }
      },
      required: ['path']
    },
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'workspace_read',
    mutatesWorkspace: false,
    readsWorkspace: true,
    usesNetwork: false
  },
  {
    callName: 'research_topic',
    description: 'Run a broader web research pass for a topic.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query describing the information to look up.'
        },
        max_results: {
          type: 'number',
          description: 'Optional maximum number of search results to return.'
        },
        max_pages: {
          type: 'number',
          description: 'Optional maximum number of fetched pages to include.'
        }
      },
      required: ['query']
    },
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'web_research',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: true
  },
  {
    callName: 'run_command',
    description: 'Run one Windows shell command starting in the workspace.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to execute.'
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory relative to the active workspace root.'
        }
      },
      required: ['command']
    },
    requiresApproval: null,
    concurrencySafe: false,
    visibilityGroup: 'host_command',
    mutatesWorkspace: true,
    readsWorkspace: true,
    usesNetwork: true
  },
  {
    callName: 'spawn_subagents',
    description: 'Launch one or more bounded background explorer or verifier helpers for parallel investigation.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'One or more delegated helper tasks to run in parallel.',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Optional helper name for the transcript.'
              },
              title: {
                type: 'string',
                description: 'Short task title that will appear in the delegated activity card.'
              },
              prompt: {
                type: 'string',
                description: 'Self-contained delegated instructions for the helper.'
              },
              delegation_profile: {
                type: 'string',
                enum: ['research', 'verify', 'heartbeat'],
                description: 'Optional helper role. Defaults to research.'
              },
              reasoning_effort: {
                type: 'string',
                enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
                description: 'Optional reasoning effort override for this helper.'
              }
            },
            required: ['title', 'prompt']
          }
        }
      },
      required: ['tasks']
    },
    requiresApproval: false,
    concurrencySafe: false,
    visibilityGroup: 'delegate',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: false
  },
  {
    callName: 'search_text',
    description: 'Search workspace text content with bounded results.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Case-insensitive text query to search for.'
        },
        path: {
          type: 'string',
          description: 'Optional file or directory path relative to the active workspace root.'
        },
        max_results: {
          type: 'number',
          description: 'Optional maximum number of search matches to return.'
        }
      },
      required: ['query']
    },
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'workspace_read',
    mutatesWorkspace: false,
    readsWorkspace: true,
    usesNetwork: false
  },
  {
    callName: 'web_search',
    description: 'Search the web when network-backed research is relevant.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query describing the information to look up.'
        },
        max_results: {
          type: 'number',
          description: 'Optional maximum number of search results to return.'
        }
      },
      required: ['query']
    },
    requiresApproval: false,
    concurrencySafe: true,
    visibilityGroup: 'web_research',
    mutatesWorkspace: false,
    readsWorkspace: false,
    usesNetwork: true
  },
  {
    callName: 'write_file',
    description: 'Create or overwrite a file inside the workspace.',
    inputJsonSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file, relative to the active workspace root.'
        },
        content: {
          type: 'string',
          description: 'Full UTF-8 text content to write into the file.'
        }
      },
      required: ['path', 'content']
    },
    requiresApproval: false,
    concurrencySafe: false,
    visibilityGroup: 'workspace_write',
    mutatesWorkspace: true,
    readsWorkspace: false,
    usesNetwork: false
  }
];

export const NATIVE_WEB_RESEARCH_TOOL_NAMES = new Set(
  NATIVE_AGENT_RUNTIME_TOOL_DEFINITIONS
    .filter((tool) => tool.visibilityGroup === 'web_research')
    .map((tool) => tool.callName)
);

export function isNativeWebResearchToolName(callName: string) {
  return NATIVE_WEB_RESEARCH_TOOL_NAMES.has(callName);
}
