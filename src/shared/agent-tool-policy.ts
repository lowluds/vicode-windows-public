import type { ExecutionPermission } from './domain';
import { evaluateRuntimeCommandAccess } from './runtime-policy';

export const AGENT_TOOL_NAMES = [
  'list_directory',
  'read_file',
  'search_text',
  'web_search',
  'extract_web_page',
  'map_site',
  'crawl_site',
  'research_topic',
  'mkdir',
  'write_file',
  'apply_patch',
  'run_command'
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];
export type AgentToolPolicyCategory = 'read' | 'write' | 'command' | 'network';

export interface AgentToolPolicy {
  name: AgentToolName;
  label: string;
  description: string;
  category: AgentToolPolicyCategory;
  minimumPermission: ExecutionPermission;
  workspaceBounded: boolean;
}

const AGENT_TOOL_POLICIES: AgentToolPolicy[] = [
  {
    name: 'list_directory',
    label: 'List directories',
    description: 'Inspect folders inside the workspace.',
    category: 'read',
    minimumPermission: 'default',
    workspaceBounded: true
  },
  {
    name: 'read_file',
    label: 'Read files',
    description: 'Open text files inside the workspace.',
    category: 'read',
    minimumPermission: 'default',
    workspaceBounded: true
  },
  {
    name: 'search_text',
    label: 'Search text',
    description: 'Search file contents inside the workspace.',
    category: 'read',
    minimumPermission: 'default',
    workspaceBounded: true
  },
  {
    name: 'web_search',
    label: 'Search the web',
    description: 'Search the public web through Vicode-owned web research tools.',
    category: 'network',
    minimumPermission: 'default',
    workspaceBounded: false
  },
  {
    name: 'extract_web_page',
    label: 'Extract web pages',
    description: 'Extract one public web page through Vicode-owned web research tools.',
    category: 'network',
    minimumPermission: 'default',
    workspaceBounded: false
  },
  {
    name: 'map_site',
    label: 'Map websites',
    description: 'Discover crawlable URLs from one public web page through Vicode-owned web research tools.',
    category: 'network',
    minimumPermission: 'default',
    workspaceBounded: false
  },
  {
    name: 'crawl_site',
    label: 'Crawl websites',
    description: 'Collect bounded multi-page content from one public website through Vicode-owned web research tools.',
    category: 'network',
    minimumPermission: 'default',
    workspaceBounded: false
  },
  {
    name: 'research_topic',
    label: 'Research topics',
    description: 'Build a bounded multi-source research packet from public web sources through Vicode-owned web research tools.',
    category: 'network',
    minimumPermission: 'default',
    workspaceBounded: false
  },
  {
    name: 'mkdir',
    label: 'Create folders',
    description: 'Create directories inside the workspace.',
    category: 'write',
    minimumPermission: 'default',
    workspaceBounded: true
  },
  {
    name: 'write_file',
    label: 'Write files',
    description: 'Create or replace UTF-8 text files inside the workspace.',
    category: 'write',
    minimumPermission: 'default',
    workspaceBounded: true
  },
  {
    name: 'apply_patch',
    label: 'Apply patches',
    description: 'Apply unified diff patches inside the workspace.',
    category: 'write',
    minimumPermission: 'default',
    workspaceBounded: true
  },
  {
    name: 'run_command',
    label: 'Run shell commands',
    description: 'Execute local shell commands starting from the workspace root or a nested workspace path.',
    category: 'command',
    minimumPermission: 'full_access',
    workspaceBounded: true
  }
];

export function listAgentToolPolicies() {
  return AGENT_TOOL_POLICIES.slice();
}

export function getAgentToolPolicy(name: string) {
  return AGENT_TOOL_POLICIES.find((policy) => policy.name === name) ?? null;
}

export function isAgentToolAllowed(name: string, executionPermission: ExecutionPermission) {
  const policy = getAgentToolPolicy(name);
  if (!policy) {
    return false;
  }

  return policy.minimumPermission === 'default' || executionPermission === 'full_access';
}

export function getAgentToolDeniedMessage(name: string, executionPermission: ExecutionPermission) {
  const policy = getAgentToolPolicy(name);
  if (!policy) {
    return `Unsupported tool requested: ${name}.`;
  }

  if (isAgentToolAllowed(name, executionPermission)) {
    return null;
  }

  if (policy.minimumPermission === 'full_access') {
    const runtimePolicy = evaluateRuntimeCommandAccess(executionPermission);
    return runtimePolicy.deniedReason ?? `${name} requires Full access. ${runtimePolicy.commandSummary}`;
  }

  return `Tool ${name} is not permitted under the current execution policy.`;
}
