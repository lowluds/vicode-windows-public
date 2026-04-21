import { promises as fs } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const WORKSPACE_ROOT = path.resolve(process.env.VICODE_INTERNAL_ANALYSIS_ROOT ?? process.cwd());
const ENGINEERING_DOCS_ROOT = path.join(WORKSPACE_ROOT, 'docs', 'engineering');
const BUILD_CONTROL_ROOT = path.join(WORKSPACE_ROOT, '.vicode', 'control');
const STATE_DB_PATH = process.env.VICODE_STATE_DB_PATH ? path.resolve(process.env.VICODE_STATE_DB_PATH) : null;
const MAX_SEARCH_RESULTS = 20;
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.idea',
  '.vscode',
  'node_modules',
  'out',
  'dist',
  'release',
  'playwright-report',
  'test-results'
]);

function safeWorkspacePath(relativePath) {
  const resolved = path.resolve(WORKSPACE_ROOT, relativePath);
  return resolved.startsWith(WORKSPACE_ROOT) ? resolved : null;
}

async function fileExists(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function dirExists(dirPath) {
  try {
    return (await fs.stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

async function readTextFile(filePath) {
  return await fs.readFile(filePath, 'utf8');
}

async function listEngineeringDocs() {
  if (!(await dirExists(ENGINEERING_DOCS_ROOT))) {
    return [];
  }

  const entries = await fs.readdir(ENGINEERING_DOCS_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => ({
      name: entry.name,
      relativePath: path.join('docs', 'engineering', entry.name).replace(/\\/gu, '/')
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function findMaintainabilityReportPath() {
  const docs = await listEngineeringDocs();
  return docs.find((entry) => /^maintainability-audit-.*\.md$/iu.test(entry.name))?.relativePath ?? null;
}

async function readJsonIfPresent(filePath) {
  if (!(await fileExists(filePath))) {
    return null;
  }
  try {
    return JSON.parse(await readTextFile(filePath));
  } catch {
    return null;
  }
}

function openStateDb() {
  if (!STATE_DB_PATH) {
    return null;
  }
  try {
    return new Database(STATE_DB_PATH, { readonly: true });
  } catch {
    return null;
  }
}

function listProjectsFromState() {
  const db = openStateDb();
  if (!db) {
    return [];
  }
  try {
    return db
      .prepare(
        `SELECT id, name, folder_path AS folderPath, trusted, updated_at AS updatedAt
         FROM projects
         ORDER BY updated_at DESC`
      )
      .all()
      .map((row) => ({
        id: String(row.id),
        name: String(row.name),
        folderPath: typeof row.folderPath === 'string' ? row.folderPath : null,
        trusted: Boolean(row.trusted),
        updatedAt: String(row.updatedAt)
      }));
  } finally {
    db.close();
  }
}

function listThreadsForProject(projectId) {
  const db = openStateDb();
  if (!db) {
    return [];
  }
  try {
    return db
      .prepare(
        `SELECT id, title, status, provider_id AS providerId, model_id AS modelId,
                execution_permission AS executionPermission, archived,
                updated_at AS updatedAt, last_preview AS lastPreview
         FROM threads
         WHERE project_id = ?
         ORDER BY updated_at DESC`
      )
      .all(projectId)
      .map((row) => ({
        id: String(row.id),
        title: String(row.title),
        status: String(row.status),
        providerId: String(row.providerId),
        modelId: String(row.modelId),
        executionPermission: String(row.executionPermission),
        archived: Boolean(row.archived),
        updatedAt: String(row.updatedAt),
        lastPreview: typeof row.lastPreview === 'string' ? row.lastPreview : null
      }));
  } finally {
    db.close();
  }
}

function listAutonomousTasksForProject(projectId) {
  const db = openStateDb();
  if (!db) {
    return [];
  }
  try {
    return db
      .prepare(
        `SELECT id, kind, thread_id AS threadId, run_id AS runId, source_id AS sourceId,
                title, summary, owner_label AS ownerLabel, provenance_label AS provenanceLabel,
                trust_label AS trustLabel, approval_label AS approvalLabel, status,
                status_label AS statusLabel, blocked_by AS blockedBy,
                updated_at AS updatedAt
         FROM autonomous_tasks
         WHERE project_id = ?
         ORDER BY updated_at DESC`
      )
      .all(projectId)
      .map((row) => ({
        id: String(row.id),
        kind: String(row.kind),
        threadId: typeof row.threadId === 'string' ? row.threadId : null,
        runId: typeof row.runId === 'string' ? row.runId : null,
        sourceId: String(row.sourceId),
        title: String(row.title),
        summary: String(row.summary),
        ownerLabel: String(row.ownerLabel),
        provenanceLabel: String(row.provenanceLabel),
        trustLabel: typeof row.trustLabel === 'string' ? row.trustLabel : null,
        approvalLabel: typeof row.approvalLabel === 'string' ? row.approvalLabel : null,
        status: String(row.status),
        statusLabel: String(row.statusLabel),
        blockedBy: typeof row.blockedBy === 'string' ? row.blockedBy : null,
        updatedAt: String(row.updatedAt)
      }));
  } finally {
    db.close();
  }
}

function summarizeTicketQueue(queueJson) {
  const tickets = Array.isArray(queueJson?.tickets) ? queueJson.tickets : [];
  const inProgress = tickets.find((ticket) => ticket?.status === 'in_progress') ?? null;
  return {
    totalTickets: tickets.length,
    todoTickets: tickets.filter((ticket) => ticket?.status === 'todo').length,
    blockedTickets: tickets.filter((ticket) => ticket?.status === 'blocked').length,
    doneTickets: tickets.filter((ticket) => ticket?.status === 'done').length,
    activeTicketTitle: typeof inProgress?.title === 'string' ? inProgress.title : null
  };
}

async function getBuildControlSummary() {
  const configPath = path.join(BUILD_CONTROL_ROOT, 'vicode-build-teams.json');
  const config = await readJsonIfPresent(configPath);
  const controls = Array.isArray(config?.teams) ? config.teams : Array.isArray(config?.controls) ? config.controls : [];
  const teams = [];

  for (const control of controls) {
    const controlId = String(control?.id ?? 'unknown');
    const heartbeatRelativePath =
      typeof control?.heartbeat_path === 'string'
        ? control.heartbeat_path
        : typeof control?.heartbeatPath === 'string'
          ? control.heartbeatPath
          : 'HEARTBEAT.md';
    const queueRelativePath = path.join('.vicode', 'control', 'build-tickets', `${controlId}.json`).replace(/\\/gu, '/');
    const heartbeatPath = safeWorkspacePath(heartbeatRelativePath);
    const queuePath = safeWorkspacePath(queueRelativePath);
    const heartbeatText =
      heartbeatPath && (await fileExists(heartbeatPath))
        ? await readTextFile(heartbeatPath)
        : null;
    const queueJson = queuePath ? await readJsonIfPresent(queuePath) : null;

    teams.push({
      id: controlId,
      label: typeof control?.label === 'string' ? control.label : controlId,
      goal: typeof control?.goal === 'string' ? control.goal : null,
      worktreePath:
        typeof control?.worktree_path === 'string'
          ? control.worktree_path
          : typeof control?.worktreePath === 'string'
            ? control.worktreePath
            : null,
      heartbeatPath: heartbeatRelativePath.replace(/\\/gu, '/'),
      heartbeatStatus: heartbeatText?.match(/status:\s*(.+)$/imu)?.[1]?.trim() ?? null,
      ...summarizeTicketQueue(queueJson)
    });
  }

  return {
    workspaceRoot: WORKSPACE_ROOT,
    available: Boolean(config),
    configPath: path.join('.vicode', 'control', 'vicode-build-teams.json').replace(/\\/gu, '/'),
    teamCount: teams.length,
    teams
  };
}

async function walkWorkspace(relativeDir = '') {
  const absoluteDir = safeWorkspacePath(relativeDir);
  if (!absoluteDir || !(await dirExists(absoluteDir))) {
    return [];
  }

  const results = [];
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    if (entry.name.startsWith('.') && entry.name !== '.vicode' && !relativeDir) {
      continue;
    }

    const childRelative = relativeDir
      ? path.join(relativeDir, entry.name).replace(/\\/gu, '/')
      : entry.name;
    if (entry.isDirectory()) {
      results.push(...(await walkWorkspace(childRelative)));
    } else {
      results.push(childRelative);
    }
  }
  return results;
}

async function searchWorkspace(query, maxResults = MAX_SEARCH_RESULTS) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const files = await walkWorkspace('');
  const results = [];
  for (const relativePath of files) {
    if (results.length >= maxResults) {
      break;
    }
    const absolutePath = safeWorkspacePath(relativePath);
    if (!absolutePath) {
      continue;
    }

    let content;
    try {
      content = await readTextFile(absolutePath);
    } catch {
      continue;
    }

    for (const [index, line] of content.split(/\r?\n/u).entries()) {
      if (results.length >= maxResults) {
        break;
      }
      if (line.toLowerCase().includes(normalized)) {
        results.push({
          path: relativePath,
          lineNumber: index + 1,
          line: line.trim()
        });
      }
    }
  }

  return results;
}

const server = new Server(
  { name: 'vicode-internal-analysis', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {}
    }
  }
);

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const resources = [
    {
      uri: 'vicode://engineering/readme',
      name: 'Engineering README',
      description: 'Canonical engineering execution brief for this workspace.',
      mimeType: 'text/markdown'
    },
    {
      uri: 'vicode://engineering/worklog',
      name: 'Autonomous Worklog',
      description: 'Durable execution log for the active engineering programs.',
      mimeType: 'text/markdown'
    },
    {
      uri: 'vicode://engineering/adoption-plan',
      name: 'Claude Code Adoption Plan',
      description: 'Current phased adoption plan against the Claude Code upstream reference.',
      mimeType: 'text/markdown'
    },
    {
      uri: 'vicode://build-control/summary',
      name: 'Build Control Summary',
      description: 'Current build-control teams, heartbeat state, and ticket queue summary.',
      mimeType: 'application/json'
    },
    {
      uri: 'vicode://app/projects',
      name: 'Local Projects',
      description: 'Local Vicode projects from the app state database.',
      mimeType: 'application/json'
    }
  ];

  if (await findMaintainabilityReportPath()) {
    resources.push({
      uri: 'vicode://engineering/maintainability-report',
      name: 'Maintainability Audit',
      description: 'Most recent maintainability audit in docs/engineering.',
      mimeType: 'text/markdown'
    });
  }

  return { resources };
});

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [
    {
      uriTemplate: 'vicode://source/{path}',
      name: 'Workspace source file',
      description: 'Read a UTF-8 file inside the trusted workspace root.',
      mimeType: 'text/plain'
    }
  ]
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  if (uri === 'vicode://engineering/readme') {
    return {
      contents: [{ uri, mimeType: 'text/markdown', text: await readTextFile(path.join(ENGINEERING_DOCS_ROOT, 'README.md')) }]
    };
  }
  if (uri === 'vicode://engineering/worklog') {
    return {
      contents: [{ uri, mimeType: 'text/markdown', text: await readTextFile(path.join(ENGINEERING_DOCS_ROOT, 'WORKLOG.md')) }]
    };
  }
  if (uri === 'vicode://engineering/adoption-plan') {
    return {
      contents: [{ uri, mimeType: 'text/markdown', text: await readTextFile(path.join(ENGINEERING_DOCS_ROOT, 'claude-code-adoption-plan.md')) }]
    };
  }
  if (uri === 'vicode://engineering/maintainability-report') {
    const relativePath = await findMaintainabilityReportPath();
    if (!relativePath) {
      throw new Error('Maintainability report not found.');
    }
    const absolutePath = safeWorkspacePath(relativePath);
    if (!absolutePath) {
      throw new Error('Maintainability report path is invalid.');
    }
    return {
      contents: [{ uri, mimeType: 'text/markdown', text: await readTextFile(absolutePath) }]
    };
  }
  if (uri === 'vicode://build-control/summary') {
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(await getBuildControlSummary(), null, 2) }]
    };
  }
  if (uri === 'vicode://app/projects') {
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(listProjectsFromState(), null, 2) }]
    };
  }
  if (uri.startsWith('vicode://source/')) {
    const relativePath = decodeURIComponent(uri.slice('vicode://source/'.length));
    const absolutePath = safeWorkspacePath(relativePath);
    if (!absolutePath) {
      throw new Error('Invalid workspace path.');
    }
    return {
      contents: [{ uri, mimeType: 'text/plain', text: await readTextFile(absolutePath) }]
    };
  }
  throw new Error(`Unknown resource: ${uri}`);
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_engineering_docs',
      description: 'List markdown docs in docs/engineering for the current workspace.',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'get_build_control_summary',
      description: 'Return a bounded summary of build-control teams, heartbeat files, and ticket queues.',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'list_projects',
      description: 'List local Vicode projects from the app state database.',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'get_project_threads',
      description: 'Return thread metadata for one local Vicode project.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Project id to inspect.' }
        },
        required: ['project_id']
      }
    },
    {
      name: 'get_project_autonomous_tasks',
      description: 'Return canonical autonomous task records for one local Vicode project.',
      inputSchema: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'Project id to inspect.' }
        },
        required: ['project_id']
      }
    },
    {
      name: 'search_workspace',
      description: 'Search UTF-8 workspace files for a case-insensitive text query.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Query to search for.' },
          max_results: { type: 'number', description: 'Maximum number of matches to return.' }
        },
        required: ['query']
      }
    },
    {
      name: 'read_workspace_file',
      description: 'Read a UTF-8 file inside the trusted workspace root.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative path to read.' }
        },
        required: ['path']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  if (name === 'list_engineering_docs') {
    return { content: [{ type: 'text', text: JSON.stringify(await listEngineeringDocs(), null, 2) }] };
  }
  if (name === 'get_build_control_summary') {
    return { content: [{ type: 'text', text: JSON.stringify(await getBuildControlSummary(), null, 2) }] };
  }
  if (name === 'list_projects') {
    return { content: [{ type: 'text', text: JSON.stringify(listProjectsFromState(), null, 2) }] };
  }
  if (name === 'get_project_threads') {
    const projectId = typeof args.project_id === 'string' ? args.project_id : '';
    return { content: [{ type: 'text', text: JSON.stringify(listThreadsForProject(projectId), null, 2) }] };
  }
  if (name === 'get_project_autonomous_tasks') {
    const projectId = typeof args.project_id === 'string' ? args.project_id : '';
    return { content: [{ type: 'text', text: JSON.stringify(listAutonomousTasksForProject(projectId), null, 2) }] };
  }
  if (name === 'search_workspace') {
    const query = typeof args.query === 'string' ? args.query : '';
    const maxResults =
      typeof args.max_results === 'number' && Number.isFinite(args.max_results)
        ? Math.max(1, Math.min(50, Math.floor(args.max_results)))
        : MAX_SEARCH_RESULTS;
    return { content: [{ type: 'text', text: JSON.stringify(await searchWorkspace(query, maxResults), null, 2) }] };
  }
  if (name === 'read_workspace_file') {
    const relativePath = typeof args.path === 'string' ? args.path : '';
    const absolutePath = safeWorkspacePath(relativePath);
    if (!absolutePath) {
      throw new Error('Invalid workspace path.');
    }
    return { content: [{ type: 'text', text: await readTextFile(absolutePath) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'summarize_build_control_health',
      description: 'Summarize build-control health from the local workspace.',
      arguments: []
    }
  ]
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name !== 'summarize_build_control_health') {
    throw new Error(`Unknown prompt: ${request.params.name}`);
  }
  return {
    description: 'Summarize build-control health from the current workspace.',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: 'Use the local build-control summary and engineering docs to summarize the current build-plan health, blockers, and next recommended action.'
        }
      }
    ]
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
