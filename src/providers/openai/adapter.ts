import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import type { PlannerQuestion, ProviderAccount, ProviderModel, RunChangeArtifact } from '../../shared/domain';
import { resolveContextWindowAutoCompactTokenLimit, resolveContextWindowLimit } from '../../shared/context-window';
import { providerCliAuthLaunch, providerCliCommands, providerCliExecutableName } from '../../shared/providers';
import { deriveRunProgressFromProviderTodos, type ProviderTodoItem } from '../../shared/run-progress';
import { skillSlug } from '../../shared/skills';
import { getProviderFallbackModels, sanitizeDiscoveredModels } from '../catalog';
import { extractCodexCliInfoMessages } from '../run-activity';
import {
  appendAssistantTextDelta
} from '../text-normalization';
import type {
  ProviderAdapter,
  ProviderInfoPayload,
  ProviderDiagnosticsPayload,
  ProviderPlannerAnswerContext,
  ProviderRunCallbacks,
  ProviderRunContext,
  ProviderRunHandle
} from '../types';
import { detectCliInstall, fileExists, killProcessTree, launchTerminalExecutable, spawnHiddenExecutable } from '../util';

const MODELS: ProviderModel[] = getProviderFallbackModels('openai');
const APP_SERVER_REQUEST_TIMEOUT_MS = 10_000;
const MODEL_LIST_PAGE_SIZE = 100;
// Codex exec can legitimately go quiet between partial assistant output and the next
// tool/result chunk while it continues reasoning on longer same-thread tasks.
const CODEX_IDLE_FAILURE_TIMEOUT_MS = 300_000;

interface CodexAppServerEnvelope {
  jsonrpc?: '2.0';
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: {
    message?: string;
  };
}

interface CodexAppServerOptions {
  cwd?: string | null;
  env?: NodeJS.ProcessEnv;
  configOverrides?: string[];
  onNotification?: (method: string, params: Record<string, unknown> | undefined) => void;
  onRequest?: (id: number, method: string, params: Record<string, unknown> | undefined) => void;
}

interface CodexModelListResult {
  data?: Array<{
    id?: string;
    model?: string;
    displayName?: string;
    description?: string;
    inputModalities?: string[];
    additionalSpeedTiers?: string[];
    isDefault?: boolean;
  }>;
  nextCursor?: string | null;
}

interface CodexAgentInterface {
  displayName: string | null;
  shortDescription: string | null;
  iconSmall: string | null;
  iconLarge: string | null;
  defaultPrompt: string | null;
}

interface CodexPlannerSession {
  runId: string;
  threadId: string;
  client: CodexAppServerClient;
  providerThreadId: string;
  currentTurnId: string | null;
  assistantText: string;
  planText: string;
  planProgressText: string;
  lastTodoSignature: string | null;
  seenDiagnosticSignatures: Set<string>;
}

function buildCodexLongContextOverrides(modelId: string) {
  const autoCompactTokenLimit = resolveContextWindowAutoCompactTokenLimit('openai', modelId);
  if (autoCompactTokenLimit == null) {
    return [];
  }

  return [
    `model_context_window=${resolveContextWindowLimit('openai', modelId)}`,
    `model_auto_compact_token_limit=${autoCompactTokenLimit}`
  ];
}

function buildCodexCliConfigArgs(context: Pick<ProviderRunContext, 'modelId' | 'reasoningEffort'>) {
  const overrides = [
    ...(context.reasoningEffort ? [`model_reasoning_effort="${context.reasoningEffort}"`] : []),
    ...buildCodexLongContextOverrides(context.modelId)
  ];
  return overrides.flatMap((value) => ['-c', value]);
}

function stripQuotedValue(value: string) {
  return value.replace(/^['"]|['"]$/gu, '').trim();
}

function parseFrontMatter(markdown: string) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u);
  if (!match) {
    return { name: null, description: null };
  }

  let name: string | null = null;
  let description: string | null = null;

  for (const line of match[1].split(/\r?\n/u)) {
    const nameMatch = line.match(/^name:\s*(.+)$/u);
    if (nameMatch) {
      name = stripQuotedValue(nameMatch[1]);
      continue;
    }

    const descriptionMatch = line.match(/^description:\s*(.+)$/u);
    if (descriptionMatch) {
      description = stripQuotedValue(descriptionMatch[1]);
    }
  }

  return { name, description };
}

function extractFirstHeading(markdown: string) {
  const match = markdown.match(/^#\s+(.+)$/mu);
  return match?.[1]?.trim() ?? null;
}

function extractFirstParagraph(markdown: string) {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, '');
  const blocks = body.split(/\r?\n\r?\n/u).map((block) => block.trim());
  return (
    blocks.find((block) => block && !block.startsWith('#') && !block.startsWith('```') && !block.startsWith('|')) ??
    null
  );
}

async function readCodexAgentInterface(skillDir: string): Promise<CodexAgentInterface | null> {
  const agentsDir = join(skillDir, 'agents');
  let entries;

  try {
    entries = await readdir(agentsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const manifestEntry = entries.find((entry) => entry.isFile() && /\.ya?ml$/iu.test(entry.name));
  if (!manifestEntry) {
    return null;
  }

  try {
    const source = await readFile(join(agentsDir, manifestEntry.name), 'utf8');
    let inInterface = false;
    const parsed: CodexAgentInterface = {
      displayName: null,
      shortDescription: null,
      iconSmall: null,
      iconLarge: null,
      defaultPrompt: null
    };

    for (const rawLine of source.split(/\r?\n/u)) {
      if (!inInterface) {
        if (/^interface:\s*$/u.test(rawLine)) {
          inInterface = true;
        }
        continue;
      }

      if (/^\S/u.test(rawLine)) {
        break;
      }

      const match = rawLine.match(/^\s{2}([a-z_]+):\s*(.+)\s*$/u);
      if (!match) {
        continue;
      }

      const value = stripQuotedValue(match[2]);
      switch (match[1]) {
        case 'display_name':
          parsed.displayName = value;
          break;
        case 'short_description':
          parsed.shortDescription = value;
          break;
        case 'icon_small':
          parsed.iconSmall = value;
          break;
        case 'icon_large':
          parsed.iconLarge = value;
          break;
        case 'default_prompt':
          parsed.defaultPrompt = value;
          break;
      }
    }

    return parsed;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanJsonText(value: string) {
  return value.replace(/\r\n/g, '\n').trim();
}

function splitLines(value: string | null, limit = 8) {
  if (!value) {
    return [];
  }

  return value
    .split(/\r?\n/u)
    .map((line) => cleanJsonText(line))
    .filter(Boolean)
    .slice(0, limit);
}

function isCodexCliOperationalDiagnostic(line: string) {
  const normalized = line
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

  return (
    /\b(?:WARN|INFO|DEBUG|TRACE)\b\s+(?:codex_[a-z0-9_:.-]+|rmcp::[a-z0-9_:.-]+)\b/iu.test(normalized) ||
    /\bcodex_core_plugins::\s*manifest:/iu.test(normalized) ||
    /\bcodex_analytics::\s*client:/iu.test(normalized) ||
    /\bERROR\s+codex_core::session:\s+failed to load skill\b/iu.test(normalized)
  );
}

function startsCodexCliDiagnosticBody(line: string) {
  return /\b(?:status\s+403\s+Forbidden|<html\b|Enable JavaScript and cookies to continue)\b/iu.test(line);
}

function endsCodexCliDiagnosticBody(line: string) {
  return /<\/html>/iu.test(line);
}

function normalizeCodexTodoStatus(value: unknown): ProviderTodoItem['status'] | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.toLowerCase().replace(/[\s_-]+/gu, '');
  if (['pending', 'todo', 'notstarted', 'open', 'queued', 'planned'].includes(normalized)) {
    return 'pending';
  }
  if (['inprogress', 'active', 'running', 'current', 'started'].includes(normalized)) {
    return 'in_progress';
  }
  if (['completed', 'complete', 'done', 'finished', 'resolved'].includes(normalized)) {
    return 'completed';
  }
  if (['cancelled', 'canceled', 'skipped', 'blocked', 'failed'].includes(normalized)) {
    return 'cancelled';
  }

  return null;
}

function normalizeCodexTodoItem(entry: unknown): ProviderTodoItem | null {
  if (!isRecord(entry)) {
    return null;
  }

  const label =
    [entry.description, entry.title, entry.text, entry.label, entry.name, entry.task]
      .find((value) => typeof value === 'string' && cleanJsonText(value).length > 0);
  if (typeof label !== 'string') {
    return null;
  }

  const explicitStatus =
    normalizeCodexTodoStatus(entry.status) ??
    normalizeCodexTodoStatus(entry.state) ??
    normalizeCodexTodoStatus(entry.phase);

  const booleanStatus =
    typeof entry.completed === 'boolean'
      ? entry.completed
        ? 'completed'
        : 'pending'
      : typeof entry.done === 'boolean'
        ? entry.done
          ? 'completed'
          : 'pending'
        : typeof entry.current === 'boolean'
          ? entry.current
            ? 'in_progress'
            : null
          : null;

  const status = explicitStatus ?? booleanStatus;
  if (!status) {
    return null;
  }

  return {
    description: cleanJsonText(label),
    status
  };
}

function extractCodexChecklistTodos(text: string) {
  const todos = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^[-*]?\s*\[( |x|X|~|-)\]\s+(.+)$/u);
      if (!match) {
        return null;
      }

      const marker = match[1];
      const label = cleanJsonText(match[2]);
      if (!label) {
        return null;
      }

      return {
        description: label,
        status:
          marker === 'x' || marker === 'X'
            ? ('completed' as const)
            : marker === '~' || marker === '-'
              ? ('in_progress' as const)
              : ('pending' as const)
      } satisfies ProviderTodoItem;
    })
    .filter((value): value is ProviderTodoItem => Boolean(value));

  return todos.length > 0 ? todos : null;
}

function createCodexTodoSignature(todos: ProviderTodoItem[]) {
  return JSON.stringify(todos);
}

function collectCodexTodoItemsFromValue(
  value: unknown,
  options: { taskLike: boolean; currentKey?: string | null },
  depth = 0
): ProviderTodoItem[] | null {
  if (depth > 4 || value == null) {
    return null;
  }

  if (Array.isArray(value)) {
    const todos = value.map((entry) => normalizeCodexTodoItem(entry)).filter((entry): entry is ProviderTodoItem => Boolean(entry));
    if (todos.length > 0 && options.taskLike) {
      return todos;
    }

    for (const entry of value) {
      const nested = collectCodexTodoItemsFromValue(entry, options, depth + 1);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const keyHint = options.currentKey?.toLowerCase() ?? '';
  const typeHints = [
    typeof value.type === 'string' ? value.type : null,
    typeof value.kind === 'string' ? value.kind : null,
    typeof value.role === 'string' ? value.role : null,
    keyHint
  ]
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => entry.toLowerCase());
  const taskLike = options.taskLike || typeHints.some((entry) => /(todo|task|checklist|step|subtask)/u.test(entry));

  for (const [key, entry] of Object.entries(value)) {
    const candidateTaskLike = taskLike || /(todo|task|checklist|step|subtask|milestone)/iu.test(key);
    const nested = collectCodexTodoItemsFromValue(entry, { taskLike: candidateTaskLike, currentKey: key }, depth + 1);
    if (nested) {
      return nested;
    }
  }

  if (!taskLike) {
    return null;
  }

  const textCandidate =
    [value.text, value.content, value.message, value.output]
      .find((entry) => typeof entry === 'string' && cleanJsonText(entry).length > 0);
  if (typeof textCandidate === 'string') {
    return extractCodexChecklistTodos(textCandidate);
  }

  return null;
}

function extractCodexTodoItems(item: Record<string, unknown>, providerEventType: string) {
  const typeHints = [
    typeof item.type === 'string' ? item.type : null,
    typeof item.kind === 'string' ? item.kind : null,
    providerEventType
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  const looksTaskLike = typeHints.some((value) => /(todo|task|checklist|step|subtask)/u.test(value));

  return collectCodexTodoItemsFromValue(item, { taskLike: looksTaskLike, currentKey: null });
}

function collectContentStrings(value: unknown, depth = 0, maxDepth = 4, results: string[] = []) {
  if (depth > maxDepth || value == null) {
    return results;
  }

  if (typeof value === 'string') {
    const cleaned = cleanJsonText(value);
    if (cleaned) {
      results.push(cleaned);
    }
    return results;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectContentStrings(entry, depth + 1, maxDepth, results);
    }
    return results;
  }

  if (!isRecord(value)) {
    return results;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (key === 'type' || key === 'role' || key === 'kind') {
      continue;
    }

    if (key === 'text' || key === 'content' || key === 'message' || key === 'output') {
      collectContentStrings(entry, depth + 1, maxDepth, results);
      continue;
    }

    if (Array.isArray(entry) || isRecord(entry)) {
      collectContentStrings(entry, depth + 1, maxDepth, results);
    }
  }

  return results;
}

function extractCodexAssistantText(event: unknown) {
  const candidates = [
    isRecord(event) ? event.item : null,
    event
  ].filter((value): value is Record<string, unknown> => isRecord(value));

  for (const candidate of candidates) {
    const typeLabel = [candidate.type, candidate.role, candidate.kind]
      .find((value) => typeof value === 'string');
    const normalizedType = typeof typeLabel === 'string' ? typeLabel.toLowerCase() : '';

    if (normalizedType && !/(assistant|agent|output|message|final)/u.test(normalizedType)) {
      continue;
    }

    const joined = collectContentStrings(candidate)
      .filter(Boolean)
      .join('\n')
      .trim();
    if (joined) {
      return joined;
    }
  }

  return '';
}

type CodexPlannerFileChangeKind = 'add' | 'delete' | 'update';

interface CodexPlannerFileChangeInfo {
  path: string;
  kind: CodexPlannerFileChangeKind;
  movePath: string | null;
}

function normalizeCodexPlannerFileChangeKind(value: unknown): CodexPlannerFileChangeKind | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }

  const normalized = value.type.toLowerCase();
  return normalized === 'add' || normalized === 'delete' || normalized === 'update' ? normalized : null;
}

function extractCodexPlannerFileChanges(item: Record<string, unknown>): CodexPlannerFileChangeInfo[] {
  if (!Array.isArray(item.changes)) {
    return [];
  }

  return item.changes
    .map((entry) => {
      if (!isRecord(entry) || typeof entry.path !== 'string') {
        return null;
      }

      const kind = normalizeCodexPlannerFileChangeKind(entry.kind);
      if (!kind) {
        return null;
      }

      const movePath =
        kind === 'update'
          ? (isRecord(entry.kind) && typeof entry.kind.move_path === 'string'
              ? cleanJsonText(entry.kind.move_path)
              : isRecord(entry.kind) && typeof entry.kind.movePath === 'string'
                ? cleanJsonText(entry.kind.movePath)
                : null)
          : null;

      return {
        path: cleanJsonText(entry.path),
        kind,
        movePath
      } satisfies CodexPlannerFileChangeInfo;
    })
    .filter((change): change is CodexPlannerFileChangeInfo => Boolean(change?.path));
}

function extractCodexPlannerFileEntries(item: Record<string, unknown>): CodexPlannerFileChangeInfo[] {
  if (!Array.isArray(item.files)) {
    return [];
  }

  return item.files
    .map((entry) => {
      if (!isRecord(entry) || typeof entry.path !== 'string') {
        return null;
      }

      const normalizedPath = cleanJsonText(entry.path);
      if (!normalizedPath) {
        return null;
      }

      const explicitKind = normalizeCodexPlannerFileChangeKind(entry.kind);
      const changeHint =
        typeof entry.changeType === 'string'
          ? entry.changeType.toLowerCase()
          : typeof entry.status === 'string'
            ? entry.status.toLowerCase()
            : null;
      const kind =
        explicitKind
        ?? (changeHint === 'add' || changeHint === 'added' || changeHint === 'create' || changeHint === 'created'
          ? 'add'
          : changeHint === 'delete' || changeHint === 'deleted' || changeHint === 'remove' || changeHint === 'removed'
            ? 'delete'
            : changeHint === 'update' || changeHint === 'updated' || changeHint === 'modify' || changeHint === 'modified'
              ? 'update'
              : null)
        ?? 'update';

      return {
        path: normalizedPath,
        kind,
        movePath: null
      } satisfies CodexPlannerFileChangeInfo;
    })
    .filter((change): change is CodexPlannerFileChangeInfo => Boolean(change));
}

function summarizeCodexPlannerFileChange(change: CodexPlannerFileChangeInfo, phase: 'started' | 'completed' | 'stopped') {
  if (change.movePath) {
    return phase === 'completed'
      ? `Moved ${change.path} to ${change.movePath}`
      : phase === 'stopped'
        ? `Failed to move ${change.path}`
        : `Moving ${change.path} to ${change.movePath}`;
  }

  if (change.kind === 'delete') {
    return phase === 'completed'
      ? `Deleted ${change.path}`
      : phase === 'stopped'
        ? `Failed to delete ${change.path}`
        : `Deleting ${change.path}`;
  }

  return phase === 'completed'
    ? `Wrote ${change.path}`
    : phase === 'stopped'
      ? `Failed to write ${change.path}`
      : `Writing ${change.path}`;
}

function isCodexEvidenceLike(
  providerEventType: string,
  itemType: string | null,
  itemKeys: string[]
) {
  return [providerEventType, itemType ?? '', ...itemKeys].some((value) =>
    /(file|path|dir|directory|search|grep|glob|patch|write|edit|read|mkdir|diff|change)/iu.test(
      value
    )
  );
}

function isCodexApprovalLike(
  providerEventType: string,
  itemType: string | null,
  itemKeys: string[]
) {
  return [providerEventType, itemType ?? '', ...itemKeys].some((value) =>
    /(approval|approve|review|decision|decline|rejected)/iu.test(value)
  );
}

function extractCodexDiagnosticPaths(value: Record<string, unknown>) {
  const paths = new Set<string>();
  for (const change of extractCodexPlannerFileChanges(value)) {
    if (change.path) {
      paths.add(change.path);
    }
  }

  const changes = Array.isArray(value.changes) ? value.changes : [];
  for (const entry of changes) {
    if (isRecord(entry) && typeof entry.path === 'string') {
      const path = cleanJsonText(entry.path);
      if (path) {
        paths.add(path);
      }
    }
  }

  const files = Array.isArray(value.files) ? value.files : [];
  for (const entry of files) {
    if (isRecord(entry) && typeof entry.path === 'string') {
      const path = cleanJsonText(entry.path);
      if (path) {
        paths.add(path);
      }
    }
  }

  if (typeof value.path === 'string') {
    const path = cleanJsonText(value.path);
    if (path) {
      paths.add(path);
    }
  }

  return paths.size > 0 ? [...paths] : null;
}

function extractCodexDiagnosticDecision(value: Record<string, unknown>) {
  const decision =
    typeof value.decision === 'string'
      ? cleanJsonText(value.decision)
      : typeof value.approvalDecision === 'string'
        ? cleanJsonText(value.approvalDecision)
        : typeof value.reviewDecision === 'string'
          ? cleanJsonText(value.reviewDecision)
          : null;
  return decision || null;
}

function extractCodexDiagnosticStatus(value: Record<string, unknown>) {
  const status =
    typeof value.status === 'string'
      ? cleanJsonText(value.status)
      : typeof value.state === 'string'
        ? cleanJsonText(value.state)
        : typeof value.phase === 'string'
          ? cleanJsonText(value.phase)
          : null;
  return status || null;
}

function summarizeCodexPlannerApproval(item: Record<string, unknown>, phase: 'started' | 'completed' | 'stopped') {
  const paths = extractCodexDiagnosticPaths(item) ?? [];
  const decision = extractCodexDiagnosticDecision(item)?.toLowerCase() ?? null;
  const label =
    paths.length === 0
      ? 'file changes'
      : paths.length === 1
        ? paths[0]
        : `${paths.length} files`;

  if (decision === 'approved' || decision === 'accepted') {
    return `Approved file changes for ${label}`;
  }

  if (
    decision === 'rejected'
    || decision === 'declined'
    || decision === 'denied'
    || phase === 'stopped'
  ) {
    return `Rejected file changes for ${label}`;
  }

  return `Pending file-change approval for ${label}`;
}

function summarizeCodexTurnDiff(params: Record<string, unknown>) {
  const paths = extractCodexDiagnosticPaths(params) ?? [];
  if (paths.length === 0) {
    return {
      summary: 'Codex reported file changes',
      text: 'Codex reported file changes'
    };
  }

  return {
    summary:
      paths.length === 1
        ? `Codex reported changes for ${paths[0]}`
        : `Codex reported changes for ${paths.length} files`,
    text: paths.join('\n')
  };
}

function createCodexProviderReportedChangeArtifact(
  value: Record<string, unknown>
): RunChangeArtifact | null {
  const plannerChanges = [
    ...extractCodexPlannerFileChanges(value),
    ...extractCodexPlannerFileEntries(value)
  ];
  const filesFromPlannerChanges = plannerChanges.map((change) => ({
    path: change.path,
    status:
      change.kind === 'add'
        ? ('added' as const)
        : change.kind === 'delete'
          ? ('deleted' as const)
          : ('modified' as const),
    insertions: 0,
    deletions: 0,
    beforeContent: null,
    afterContent: null,
    previewLines: [],
    previewTruncated: true
  }));
  const plannerChangePaths = new Set(filesFromPlannerChanges.map((file) => file.path));
  const fallbackPaths = (extractCodexDiagnosticPaths(value) ?? []).filter((path) => !plannerChangePaths.has(path));
  const files = [
    ...filesFromPlannerChanges,
    ...fallbackPaths.map((path) => ({
      path,
      status: 'modified' as const,
      insertions: 0,
      deletions: 0,
      beforeContent: null,
      afterContent: null,
      previewLines: [],
      previewTruncated: true
    }))
  ];
  if (files.length === 0) {
    return null;
  }

  return {
    source: 'provider_reported',
    summary: {
      filesChanged: files.length,
      insertions: 0,
      deletions: 0
    },
    files
  };
}

function normalizePlannerQuestionOptions(options: unknown) {
  if (!Array.isArray(options) || options.length === 0) {
    return null;
  }

  const normalized = options
    .map((option, index) => {
      if (!isRecord(option) || typeof option.label !== 'string' || typeof option.description !== 'string') {
        return null;
      }

      const label = cleanJsonText(option.label);
      const description = cleanJsonText(option.description);
      if (!label || !description) {
        return null;
      }

      return {
        id: `option-${index + 1}`,
        label,
        description
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .slice(0, 3);

  return normalized.length >= 2 ? normalized : null;
}

function normalizeCodexPlannerQuestions(params: Record<string, unknown>) {
  const rawQuestions = Array.isArray(params.questions) ? params.questions : null;
  if (!rawQuestions || rawQuestions.length === 0) {
    return null;
  }

  const questions: PlannerQuestion[] = [];
  for (const [index, rawQuestion] of rawQuestions.entries()) {
    if (!isRecord(rawQuestion)) {
      return null;
    }

    const header = typeof rawQuestion.header === 'string' ? cleanJsonText(rawQuestion.header) : '';
    const question = typeof rawQuestion.question === 'string' ? cleanJsonText(rawQuestion.question) : '';
    const options = normalizePlannerQuestionOptions(rawQuestion.options);
    if (!header || !question || !options) {
      return null;
    }

    questions.push({
      id:
        typeof rawQuestion.id === 'string' && cleanJsonText(rawQuestion.id)
          ? cleanJsonText(rawQuestion.id)
          : `question-${index + 1}`,
      header,
      question,
      options,
      recommendedOptionId: options[0].id,
      allowOther: rawQuestion.isOther !== false
    });
  }

  return questions.length > 0 ? questions.slice(0, 3) : null;
}

function mapCodexApprovalPolicy(executionPermission: ProviderRunContext['executionPermission']) {
  return executionPermission === 'full_access' ? 'never' : 'never';
}

function mapCodexSandboxMode(executionPermission: ProviderRunContext['executionPermission']) {
  return executionPermission === 'full_access' ? 'danger-full-access' : 'workspace-write';
}

function mapCodexSandboxPolicy(context: ProviderRunContext) {
  if (context.executionPermission === 'full_access') {
    return { type: 'dangerFullAccess' as const };
  }

  return {
    type: 'workspaceWrite' as const,
    writableRoots: context.folderPath ? [context.folderPath] : [],
    readOnlyAccess: { type: 'restricted' as const, includePlatformDefaults: true, readableRoots: [] },
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  };
}

function parseImageAttachmentDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/iu);
  if (!match) {
    throw new Error('Unsupported image attachment payload.');
  }

  return {
    mimeType: match[1],
    bytes: Buffer.from(match[2], 'base64')
  };
}

function sanitizeImageAttachmentName(name: string, mimeType: string, index: number) {
  const baseName = basename(name || `image-${index + 1}`).replace(/[^a-z0-9._-]/giu, '-');
  const extension = extname(baseName) || `.${mimeType.split('/')[1] ?? 'png'}`;
  const stem = extname(baseName) ? baseName.slice(0, -extname(baseName).length) : baseName;
  return `${stem || `image-${index + 1}`}${extension}`;
}

class CodexAppServerClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timeout: NodeJS.Timeout }>();
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private nextRequestId = 1;
  private closed = false;

  constructor(executable: string, private readonly options: CodexAppServerOptions = {}) {
    this.child = spawnHiddenExecutable(
      executable,
      [...(options.configOverrides ?? []).flatMap((value) => ['-c', value]), 'app-server'],
      {
        cwd: options.cwd ?? undefined,
        env: options.env
      }
    );

    this.child.stdout.on('data', (chunk: Buffer | string) => {
      this.stdoutBuffer += String(chunk);
      this.flushMessages();
    });

    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderrBuffer += String(chunk);
    });

    this.child.once('error', (error) => {
      this.rejectAll(error.message);
    });

    this.child.once('close', (code) => {
      if (!this.closed) {
        const message = this.stderrBuffer.trim() || `Codex app-server exited with code ${code ?? -1}.`;
        this.rejectAll(message);
      }
      this.closed = true;
    });
  }

  async initialize() {
    await this.request('initialize', {
      clientInfo: {
        name: 'vicode',
        version: '0.0.0'
      },
      capabilities: {
        experimentalApi: true
      }
    });
    this.notify('initialized', {});
  }

  async request<Result>(method: string, params: Record<string, unknown>): Promise<Result> {
    const id = this.nextRequestId++;
    const promise = new Promise<Result>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for Codex app-server response to ${method}.`));
      }, APP_SERVER_REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (value) => resolve(value as Result),
        reject,
        timeout
      });
    });

    this.send({
      id,
      method,
      params
    });

    return promise;
  }

  notify(method: string, params: Record<string, unknown>) {
    this.send({
      method,
      params
    });
  }

  respond(id: number, result: unknown) {
    this.child.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.child.stdin.end();
    void killProcessTree(this.child);
    this.rejectAll('Codex app-server session closed.');
  }

  private send(message: CodexAppServerEnvelope) {
    const { jsonrpc: _jsonrpc, ...payload } = message;
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private flushMessages() {
    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }

      const body = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/u, '').trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!body) {
        continue;
      }
      this.handleMessage(body);
    }
  }

  private handleMessage(body: string) {
    let parsed: CodexAppServerEnvelope;
    try {
      parsed = JSON.parse(body) as CodexAppServerEnvelope;
    } catch {
      return;
    }

    if (typeof parsed.id === 'number' && this.pending.has(parsed.id)) {
      const pending = this.pending.get(parsed.id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeout);
      this.pending.delete(parsed.id);

      if (parsed.error?.message) {
        pending.reject(new Error(parsed.error.message));
        return;
      }

      pending.resolve(parsed.result);
      return;
    }

    if (typeof parsed.id === 'number' && typeof parsed.method === 'string') {
      this.options.onRequest?.(parsed.id, parsed.method, isRecord(parsed.params) ? parsed.params : undefined);
      return;
    }

    if (typeof parsed.method === 'string') {
      this.options.onNotification?.(parsed.method, isRecord(parsed.params) ? parsed.params : undefined);
      return;
    }
  }

  private rejectAll(message: string) {
    const error = new Error(message);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly id = 'openai' as const;
  readonly label = 'OpenAI';
  private readonly plannerSessions = new Map<string, CodexPlannerSession>();

  private async stageCliImageAttachments(context: ProviderRunContext) {
    const attachments = context.imageAttachments ?? [];
    if (attachments.length === 0) {
      return {
        imagePaths: [] as string[],
        cleanup: async () => {}
      };
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'vicode-codex-images-'));
    const imagePaths: string[] = [];

    for (const [index, attachment] of attachments.entries()) {
      const { mimeType, bytes } = parseImageAttachmentDataUrl(attachment.dataUrl);
      const filePath = join(tempDir, sanitizeImageAttachmentName(attachment.name, mimeType, index));
      await writeFile(filePath, bytes);
      imagePaths.push(filePath);
    }

    return {
      imagePaths,
      cleanup: async () => {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    };
  }

  listStaticModels(): ProviderModel[] {
    return MODELS;
  }

  getPlannerCapability() {
    return {
      supported: true,
      executionMode: 'workspace-write' as const,
      enforcement: 'hard-enforced' as const,
      message: 'Codex planner runs through the native Codex app-server plan mode.'
    };
  }

  async discoverApiModels(input: {
    account: ProviderAccount | null;
    authMode: 'cli' | 'api_key' | null;
    apiKey: string | null;
    cliPath: string | null;
  }) {
    if (!input.apiKey) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${input.apiKey}`
        },
        signal: controller.signal
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as { data?: Array<{ id?: string }> };
      const discovered = (payload.data ?? [])
        .map((item) => {
          const modelId = item.id?.trim();
          if (!modelId) {
            return null;
          }
          return {
            id: modelId,
            label: modelId,
            description: ''
          } satisfies ProviderModel;
        })
        .filter((value): value is ProviderModel => Boolean(value));

      return sanitizeDiscoveredModels(this.id, discovered);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async discoverRuntimeModels(input: {
    account: ProviderAccount | null;
    authMode: 'cli' | 'api_key' | null;
    cliPath: string | null;
  }) {
    if (!input.cliPath) {
      return null;
    }

    const client = new CodexAppServerClient(input.cliPath);

    try {
      await client.initialize();
      const discovered: ProviderModel[] = [];
      let cursor: string | null = null;

      do {
        const response =
          (await client.request<CodexModelListResult>('model/list', {
            cursor,
            includeHidden: false,
            limit: MODEL_LIST_PAGE_SIZE
          })) ?? {};

        for (const model of response.data ?? []) {
          const modelId = model.model?.trim() || model.id?.trim();
          if (!modelId) {
            continue;
          }

          discovered.push({
            id: modelId,
            label: model.displayName?.trim() || modelId,
            description: model.description?.trim() || '',
            supportsVision: Array.isArray(model.inputModalities) ? model.inputModalities.includes('image') : false,
            recommendation: Array.isArray(model.additionalSpeedTiers) && model.additionalSpeedTiers.includes('fast')
              ? 'fast'
              : undefined
          });
        }

        cursor = response.nextCursor?.trim() || null;
      } while (cursor);

      return sanitizeDiscoveredModels(this.id, discovered);
    } catch {
      return null;
    } finally {
      client.close();
    }
  }

  async detectInstall() {
    return detectCliInstall(providerCliCommands('openai'));
  }

  async getAuthState(account: ProviderAccount | null) {
    const authFile = join(homedir(), '.codex', 'auth.json');
    if (await fileExists(authFile)) {
      return { authState: 'connected' as const, authMode: 'cli' as const, message: 'Codex CLI auth detected.' };
    }

    if (account?.encryptedApiKey) {
      return { authState: 'connected' as const, authMode: 'api_key' as const, message: 'Using encrypted API key as fallback.' };
    }

    return {
      authState: 'disconnected' as const,
      authMode: null,
      message: 'Launch Codex CLI login to connect your ChatGPT plan.'
    };
  }

  async startAuth(_mode, cliPath?: string | null) {
    const authLaunch = providerCliAuthLaunch('openai');
    await launchTerminalExecutable(
      authLaunch.title ?? 'OpenAI Codex Login',
      cliPath ?? providerCliExecutableName('openai'),
      authLaunch.args
    );
  }

  async clearAuth() {
    return;
  }

  async discoverNativeSkills() {
    const root = join(homedir(), '.codex', 'skills');
    let entries;

    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return [];
    }

    const discovered = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(async (entry) => {
          const folderPath = join(root, entry.name);
          const skillPath = join(folderPath, 'SKILL.md');
          if (!(await fileExists(skillPath))) {
            return null;
          }

          try {
            const markdown = await readFile(skillPath, 'utf8');
            const frontMatter = parseFrontMatter(markdown);
            const agentInterface = await readCodexAgentInterface(folderPath);
            const name =
              agentInterface?.displayName ?? frontMatter.name ?? extractFirstHeading(markdown) ?? entry.name;
            const description =
              agentInterface?.shortDescription ??
              frontMatter.description ??
              extractFirstParagraph(markdown) ??
              'Installed Codex skill.';
            const iconPath = agentInterface?.iconSmall
              ? resolve(folderPath, agentInterface.iconSmall)
              : agentInterface?.iconLarge
                ? resolve(folderPath, agentInterface.iconLarge)
                : null;

            return {
              id: `provider-native:openai:skill:${entry.name}`,
              name,
              description,
              instructions: description,
              path: skillPath,
              providerTargets: ['openai'],
              attachMode: 'runtime',
              kind: 'skill',
              metadata: {
                providerOrigin: 'openai',
                kind: 'skill',
                attachMode: 'runtime',
                folderName: entry.name,
                slug: skillSlug(name),
                examplePrompt: agentInterface?.defaultPrompt ?? null,
                iconPath,
                browseUrl: 'https://github.com/openai/skills/tree/main/skills/.curated'
              }
            } satisfies Awaited<ReturnType<ProviderAdapter['discoverNativeSkills']>>[number];
          } catch {
            return null;
          }
        })
    );

    return discovered.filter((value): value is NonNullable<(typeof discovered)[number]> => Boolean(value));
  }

  validateProjectContext(_folderPath: string | null, _trusted: boolean) {
    return { valid: true };
  }

  async startRun(context: ProviderRunContext, callbacks: ProviderRunCallbacks): Promise<ProviderRunHandle> {
    const validation = this.validateProjectContext(context.folderPath, context.trusted);
    if (!validation.valid) {
      throw new Error(validation.message ?? 'Project is not trusted for provider execution.');
    }

    if (context.runMode === 'plan') {
      return this.startPlannerRun(context, callbacks);
    }

    callbacks.onStart();
    const configArgs = buildCodexCliConfigArgs(context);
    const args =
      context.executionPermission === 'full_access'
        ? [...configArgs, 'exec', '--ephemeral', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', '-m', context.modelId]
        : ['--sandbox', 'workspace-write', '--ask-for-approval', 'never', ...configArgs, 'exec', '--ephemeral', '--skip-git-repo-check', '--json', '-m', context.modelId];

    if (context.folderPath) {
      if (context.executionPermission === 'full_access') {
        args.push('-C', context.folderPath);
      } else {
        const execIndex = args.indexOf('exec');
        args.splice(execIndex > -1 ? execIndex : args.length, 0, '-C', context.folderPath);
      }
    }

    args.push('-');

    let stagedImages: Awaited<ReturnType<OpenAIAdapter['stageCliImageAttachments']>> | null = null;

    try {
      stagedImages = await this.stageCliImageAttachments(context);
      if (stagedImages.imagePaths.length > 0) {
        const execIndex = args.indexOf('exec');
        const imageArgs = stagedImages.imagePaths.flatMap((imagePath) => ['--image', imagePath]);
        args.splice(execIndex > -1 ? execIndex + 1 : args.length, 0, ...imageArgs);
      }
      const executable = (await this.detectInstall()).cliPath ?? providerCliExecutableName('openai');
      const child = spawnHiddenExecutable(executable, args, {
        cwd: context.folderPath ?? process.cwd(),
        env: {
          ...process.env,
          ...(context.apiKey ? { OPENAI_API_KEY: context.apiKey } : {})
        }
      });

      child.stdin.write(context.prompt);
      if (!context.prompt.endsWith('\n')) {
        child.stdin.write('\n');
      }
      child.stdin.end();

      let stdoutBuffer = '';
      let stderrBuffer = '';
      let stderrFailureOutput = '';
      let assistantText = '';
      let closed = false;
      let suppressStdoutDiagnosticBody = false;
      let suppressStderrDiagnosticBody = false;
      const seenDiagnosticSignatures = new Set<string>();
      let idleFailureTimer: NodeJS.Timeout | null = null;

      const clearIdleFailureTimer = () => {
        if (!idleFailureTimer) {
          return;
        }
        clearTimeout(idleFailureTimer);
        idleFailureTimer = null;
      };

      const scheduleIdleFailureTimer = () => {
        clearIdleFailureTimer();
        if (closed || !assistantText.trim()) {
          return;
        }

        idleFailureTimer = setTimeout(() => {
          if (closed || !assistantText.trim()) {
            return;
          }

          closed = true;
          clearIdleFailureTimer();
          void stagedImages.cleanup();
          void killProcessTree(child);
          callbacks.onError('Codex CLI became idle after partial output and was stopped before reaching a real completion state.');
        }, CODEX_IDLE_FAILURE_TIMEOUT_MS);
      };

      const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return;
        }
        if (!trimmed.startsWith('{')) {
          if (suppressStdoutDiagnosticBody) {
            suppressStdoutDiagnosticBody = !endsCodexCliDiagnosticBody(trimmed);
            return;
          }
          if (isCodexCliOperationalDiagnostic(trimmed)) {
            suppressStdoutDiagnosticBody = startsCodexCliDiagnosticBody(trimmed) && !endsCodexCliDiagnosticBody(trimmed);
          } else {
            callbacks.onInfo(trimmed);
          }
          return;
        }

        try {
          const event = JSON.parse(trimmed) as { type?: string; item?: Record<string, unknown> };
          const nextText = extractCodexAssistantText(event);
          if (nextText) {
            assistantText = nextText;
            callbacks.onAssistantSnapshot?.(nextText);
          }

          const infoMessages = extractCodexCliInfoMessages(event);
          for (const infoMessage of infoMessages) {
            callbacks.onInfo(infoMessage);
          }
          const diagnostics =
            infoMessages.length === 0
              ? this.createCliDiagnosticsFromEvent(
                  event,
                  seenDiagnosticSignatures
                )
              : null;
          if (diagnostics) {
            callbacks.onInfo({
              providerDiagnostics: diagnostics
            });
          }
        } catch {
          if (suppressStdoutDiagnosticBody) {
            suppressStdoutDiagnosticBody = !endsCodexCliDiagnosticBody(trimmed);
            return;
          }
          if (isCodexCliOperationalDiagnostic(trimmed)) {
            suppressStdoutDiagnosticBody = startsCodexCliDiagnosticBody(trimmed) && !endsCodexCliDiagnosticBody(trimmed);
          } else {
            callbacks.onInfo(trimmed);
          }
        }
      };

      child.stdout.on('data', (chunk) => {
        clearIdleFailureTimer();
        stdoutBuffer += String(chunk);
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          processLine(line);
        }
        scheduleIdleFailureTimer();
      });

      child.stderr.on('data', (chunk) => {
        clearIdleFailureTimer();
        const text = String(chunk);
        stderrBuffer += text;
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          if (suppressStderrDiagnosticBody) {
            suppressStderrDiagnosticBody = !endsCodexCliDiagnosticBody(trimmed);
            continue;
          }
          if (isCodexCliOperationalDiagnostic(trimmed)) {
            suppressStderrDiagnosticBody = startsCodexCliDiagnosticBody(trimmed) && !endsCodexCliDiagnosticBody(trimmed);
            continue;
          }
          if (trimmed) {
            stderrFailureOutput += `${trimmed}\n`;
            callbacks.onInfo(trimmed);
          }
        }
        scheduleIdleFailureTimer();
      });

      child.on('error', (error) => {
        if (closed) {
          return;
        }
        closed = true;
        clearIdleFailureTimer();
        void stagedImages.cleanup();
        const message = error instanceof Error && error.message.trim() ? error.message.trim() : 'Failed to launch Codex CLI.';
        callbacks.onError(message.startsWith('Failed to launch Codex CLI') ? message : `Failed to launch Codex CLI: ${message}`);
      });

      child.on('close', (code) => {
        if (closed) {
          return;
        }
        closed = true;
        clearIdleFailureTimer();
        void stagedImages.cleanup();
        if (stdoutBuffer.trim()) {
          processLine(stdoutBuffer);
        }
        const finalAssistantText = assistantText.trim();
        if (code === 0) {
          if (finalAssistantText) {
            callbacks.onComplete(finalAssistantText);
            return;
          }
          callbacks.onError('Codex CLI exited successfully without producing assistant output.');
          return;
        }
        const leftoverStderr = stderrBuffer.trim();
        if (leftoverStderr && !suppressStderrDiagnosticBody && !isCodexCliOperationalDiagnostic(leftoverStderr)) {
          stderrFailureOutput += `${leftoverStderr}\n`;
        }
        const finalStderr = stderrFailureOutput.trim();
        if (finalStderr) {
          callbacks.onError(finalStderr);
          return;
        }
        if (finalAssistantText) {
          callbacks.onError(`Codex CLI exited with code ${code ?? -1} after producing partial output.`);
          return;
        }
        callbacks.onError(`Codex CLI exited with code ${code ?? -1}.`);
      });

      return {
        runId: context.runId,
        child,
        cancel: async (reason) => {
          clearIdleFailureTimer();
          await killProcessTree(child);
          await stagedImages.cleanup();
          callbacks.onAbort(reason ?? 'Codex run was stopped.');
        }
      };
    } catch (error) {
      await stagedImages?.cleanup().catch(() => undefined);
      if (error instanceof Error && error.message.trim()) {
        throw new Error(`Failed to start Codex CLI: ${error.message.trim()}`);
      }
      throw new Error('Failed to start Codex CLI.');
    }
  }

  async replyPlannerQuestions(context: ProviderPlannerAnswerContext): Promise<void> {
    const session = this.plannerSessions.get(context.runId);
    if (!session) {
      throw new Error('Codex planner session is no longer active.');
    }

    const requestId = Number(context.callId);
    if (!Number.isFinite(requestId)) {
      throw new Error('Codex planner question call id was invalid.');
    }

    const answers = Object.fromEntries(
      Object.entries(context.answers).map(([questionId, answer]) => [
        questionId,
        { answers: answer.answers }
      ])
    );

    session.client.respond(requestId, { answers });
  }

  private async startPlannerRun(context: ProviderRunContext, callbacks: ProviderRunCallbacks): Promise<ProviderRunHandle> {
    callbacks.onStart();

    try {
      const executable = (await this.detectInstall()).cliPath ?? providerCliExecutableName('openai');
      const configOverrides = buildCodexLongContextOverrides(context.modelId);
      let client!: CodexAppServerClient;
      client = new CodexAppServerClient(executable, {
        cwd: context.folderPath ?? process.cwd(),
        env: {
          ...process.env,
          ...(context.apiKey ? { OPENAI_API_KEY: context.apiKey } : {})
        },
        configOverrides,
        onNotification: (method, params) => {
          this.handlePlannerNotification(context.runId, method, params, callbacks);
        },
        onRequest: (id, method, params) => {
          void this.handlePlannerServerRequest(context.runId, id, method, params, callbacks, client);
        }
      });

      await client.initialize();
      const threadResponse = context.resumeSessionId
        ? await client.request<{ thread: { id: string } }>('thread/resume', {
            threadId: context.resumeSessionId,
            model: context.modelId,
            cwd: context.folderPath,
            approvalPolicy: mapCodexApprovalPolicy(context.executionPermission),
            sandbox: mapCodexSandboxMode(context.executionPermission),
            persistExtendedHistory: false
          })
        : await client.request<{ thread: { id: string } }>('thread/start', {
            model: context.modelId,
            cwd: context.folderPath,
            approvalPolicy: mapCodexApprovalPolicy(context.executionPermission),
            sandbox: mapCodexSandboxMode(context.executionPermission),
            experimentalRawEvents: false,
            persistExtendedHistory: false
          });

      const providerThreadId = threadResponse.thread.id;
      this.plannerSessions.set(context.runId, {
        runId: context.runId,
        threadId: context.threadId,
        client,
        providerThreadId,
        currentTurnId: null,
        assistantText: '',
        planText: '',
        planProgressText: '',
        lastTodoSignature: null,
        seenDiagnosticSignatures: new Set<string>()
      });
      callbacks.onInfo({
        planner: {
          kind: 'session',
          sessionId: providerThreadId
        }
      });

      const turnResponse = await client.request<{ turn: { id: string } }>('turn/start', {
        threadId: providerThreadId,
        input: [
          {
            type: 'text',
            text: context.prompt,
            text_elements: []
          },
          ...(context.imageAttachments ?? []).map((attachment) => ({
            type: 'input_image',
            image_url: attachment.dataUrl,
            detail: 'auto'
          }))
        ],
        cwd: context.folderPath,
        approvalPolicy: mapCodexApprovalPolicy(context.executionPermission),
        sandboxPolicy: mapCodexSandboxPolicy(context),
        model: context.modelId,
        effort: context.reasoningEffort ?? null,
        collaborationMode: {
          mode: 'plan',
          settings: {
            model: context.modelId,
            reasoning_effort: context.reasoningEffort ?? null,
            developer_instructions: null
          }
        }
      });

      const session = this.plannerSessions.get(context.runId);
      if (session) {
        session.currentTurnId = turnResponse.turn.id;
      }

      return {
        runId: context.runId,
        cancel: async (reason) => {
          this.closePlannerSession(context.runId);
          callbacks.onAbort(reason ?? 'Codex planner run was stopped.');
        }
      };
    } catch (error) {
      callbacks.onError(error instanceof Error ? error.message : 'Failed to start Codex planner session.');
      return {
        runId: context.runId,
        cancel: async (reason) => {
          callbacks.onAbort(reason ?? 'Codex planner run was stopped.');
        }
      };
    }
  }

  private handlePlannerNotification(
    runId: string,
    method: string,
    params: Record<string, unknown> | undefined,
    callbacks: ProviderRunCallbacks
  ) {
    const session = this.plannerSessions.get(runId);
    if (!session) {
      return;
    }

    if (params && isRecord(params.item)) {
      const progress = this.createPlannerProgressFromItem(session, params.item, method);
      if (progress) {
        callbacks.onInfo({
          message: 'Codex updated its task list.',
          progress
        });
      }
    }

    if (method === 'turn/started' && params && isRecord(params.turn) && typeof params.turn.id === 'string') {
      session.currentTurnId = params.turn.id;
      return;
    }

    if (method === 'item/agentMessage/delta' && params && typeof params.delta === 'string') {
      session.assistantText += params.delta;
      callbacks.onDelta(params.delta);
      return;
    }

    if (method === 'item/plan/delta' && params && typeof params.delta === 'string') {
      session.planText += params.delta;
      session.planProgressText = appendAssistantTextDelta(session.planProgressText, params.delta).text;
      callbacks.onDelta(params.delta);
      const progress = this.createPlannerProgressFromPlanText(session);
      if (progress) {
        callbacks.onInfo({
          message: 'Codex updated its task list.',
          progress
        });
      }
      return;
    }

    if (method === 'item/reasoning/summaryTextDelta' && params && typeof params.delta === 'string') {
      const delta = cleanJsonText(params.delta);
      if (delta) {
        callbacks.onInfo({
          message: delta,
          activity: {
            kind: 'thinking',
            summary: delta,
            text: delta,
            providerEventType: method
          }
        });
      }
      return;
    }

    if (method.includes('reasoning') && params && typeof params.delta === 'string') {
      const delta = cleanJsonText(params.delta);
      if (delta) {
        callbacks.onInfo({
          message: delta,
          activity: {
            kind: 'thinking',
            summary: delta,
            text: delta,
            providerEventType: method
          }
        });
      }
      return;
    }

    if (params && isRecord(params.item)) {
      const inferredInfo = this.createPlannerInfoFromItemNotification(params.item, method);
      if (inferredInfo.length > 0) {
        for (const payload of inferredInfo) {
          callbacks.onInfo(payload);
        }
      }
    }

    if (method === 'turn/diff' && params) {
      const diffSummary = summarizeCodexTurnDiff(params);
      const changeArtifact = createCodexProviderReportedChangeArtifact(params);
      callbacks.onInfo({
        message: diffSummary.summary,
        activity: {
          kind: 'change_summary',
          summary: diffSummary.summary,
          text: diffSummary.summary,
          changeArtifact,
          providerEventType: method
        }
      });
    }

    if (method === 'item/completed' && params && isRecord(params.item)) {
      const item = params.item;
      if (item.type === 'plan' && typeof item.text === 'string') {
        session.planText = cleanJsonText(item.text);
        session.planProgressText = session.planText;
        callbacks.onAssistantSnapshot?.(session.planText);
        const progress = this.createPlannerProgressFromPlanText(session);
        if (progress) {
          callbacks.onInfo({
            message: 'Codex updated its task list.',
            progress
          });
        }
        return;
      }

      if (item.type === 'agentMessage' && typeof item.text === 'string') {
        session.assistantText = cleanJsonText(item.text);
        callbacks.onAssistantSnapshot?.(session.assistantText);
        return;
      }

    }

    const diagnostics = this.createPlannerDiagnosticsFromNotification(
      session,
      method,
      params
    );
    if (diagnostics) {
      callbacks.onInfo({
        providerDiagnostics: diagnostics
      });
    }

    if (method === 'turn/completed') {
      const output = session.planText.trim() || session.assistantText.trim();
      this.closePlannerSession(runId);
      callbacks.onComplete(output);
    }
  }

  private createPlannerInfoFromItemNotification(item: Record<string, unknown>, providerEventType: string): ProviderInfoPayload[] {
    const itemType = typeof item.type === 'string' ? item.type : null;
    if (!itemType) {
      return [];
    }

    const lowerType = itemType.toLowerCase();
    const lowerMethod = providerEventType.toLowerCase();
    const phase =
      lowerMethod.includes('complete') || lowerMethod.includes('completed')
        ? 'completed'
        : lowerMethod.includes('stop') || lowerMethod.includes('abort') || lowerMethod.includes('fail')
          ? 'stopped'
          : 'started';

    if (lowerType === 'websearch') {
      const query = typeof item.query === 'string' ? cleanJsonText(item.query) : null;
      const url = typeof item.url === 'string' ? cleanJsonText(item.url) : null;
      return [{
        message: query
          ? `${phase === 'completed' ? 'Searched web for' : 'Searching web for'} ${query}`
          : phase === 'completed'
            ? 'Searched web'
            : 'Searching web',
        activity: {
          kind: 'web_search' as const,
          phase: phase === 'stopped' ? 'completed' : phase,
          summary: query
            ? `${phase === 'completed' ? 'Searched web for' : 'Searching web for'} ${query}`
            : phase === 'completed'
              ? 'Searched web'
              : 'Searching web',
          query,
          url,
          providerEventType
        }
      }];
    }

    if (lowerType === 'commandexecution') {
      const command = typeof item.command === 'string' ? cleanJsonText(item.command) : null;
      const cwd = typeof item.cwd === 'string' ? cleanJsonText(item.cwd) : null;
      const summaryLabel = command && cwd ? `${command} · ${cwd}` : command ?? cwd ?? 'command';
      const output = typeof item.aggregatedOutput === 'string' ? splitLines(item.aggregatedOutput, 8) : [];
      return [{
        message:
          phase === 'completed'
            ? `Ran ${summaryLabel}`
            : phase === 'stopped'
              ? `Stopped ${summaryLabel}`
              : `Running ${summaryLabel}`,
        activity: {
          kind: 'terminal_command' as const,
          phase,
          summary:
            phase === 'completed'
              ? `Ran ${summaryLabel}`
              : phase === 'stopped'
                ? `Stopped ${summaryLabel}`
                : `Running ${summaryLabel}`,
          command,
          cwd,
          outputLines: output,
          providerEventType
        }
      }];
    }

    if (lowerType === 'filechange') {
      const changes = extractCodexPlannerFileChanges(item);
      if (changes.length === 0) {
        return [];
      }
      return changes.map((change) => ({
        message: summarizeCodexPlannerFileChange(change, phase),
        activity: {
          kind: 'file_write' as const,
          summary: summarizeCodexPlannerFileChange(change, phase),
          path: change.path,
          status: phase === 'started' ? 'started' : phase === 'completed' ? 'completed' : 'failed',
          providerEventType
        }
      }));
    }

    if (lowerType === 'filechangeapproval') {
      const summary = summarizeCodexPlannerApproval(item, phase);
      const changeArtifact = createCodexProviderReportedChangeArtifact(item);
      return [{
        message: summary,
        activity: {
          kind: 'change_summary' as const,
          summary,
          text: summary,
          status: extractCodexDiagnosticDecision(item) ?? phase,
          changeArtifact,
          providerEventType
        }
      }];
    }

    if (lowerType === 'reasoning' && Array.isArray(item.summary)) {
      const summary = item.summary
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => cleanJsonText(entry))
        .find(Boolean);
      if (!summary) {
        return [];
      }
      return [{
        message: summary,
        activity: {
          kind: 'thinking' as const,
          summary,
          text: summary,
          providerEventType
        }
      }];
    }

    if (lowerType === 'reasoning') {
      const text =
        typeof item.text === 'string'
          ? cleanJsonText(item.text)
          : typeof item.delta === 'string'
            ? cleanJsonText(item.delta)
            : null;
      if (!text) {
        return [];
      }
      return [{
        message: text,
        activity: {
          kind: 'thinking' as const,
          summary: text,
          text,
          providerEventType
        }
      }];
    }

    return [];
  }

  private async handlePlannerServerRequest(
    runId: string,
    id: number,
    method: string,
    params: Record<string, unknown> | undefined,
    callbacks: ProviderRunCallbacks,
    client: CodexAppServerClient
  ) {
    if (!params) {
      return;
    }

    if (method === 'item/tool/call') {
      const toolName = typeof params.tool === 'string' ? params.tool.trim() : '';
      const toolArguments = isRecord(params.arguments) ? params.arguments : {};
      if (!toolName) {
        client.respond(id, {
          success: false,
          contentItems: [
            {
              type: 'inputText',
              text: 'Codex requested a runtime tool call without a valid tool name.'
            }
          ]
        });
        return;
      }

      if (!callbacks.invokeRuntimeTool) {
        client.respond(id, {
          success: false,
          contentItems: [
            {
              type: 'inputText',
              text: `Dynamic runtime tool ${toolName} is not available for this Codex run.`
            }
          ]
        });
        return;
      }

      try {
        const result = await callbacks.invokeRuntimeTool({
          name: toolName,
          arguments: toolArguments
        });
        client.respond(id, {
          success: !result.isError,
          contentItems: [
            {
              type: 'inputText',
              text: result.content
            }
          ]
        });
      } catch (error) {
        client.respond(id, {
          success: false,
          contentItems: [
            {
              type: 'inputText',
              text:
                error instanceof Error && error.message.trim()
                  ? error.message.trim()
                  : `Runtime tool ${toolName} failed.`
            }
          ]
        });
      }
      return;
    }

    if (method !== 'item/tool/requestUserInput') {
      return;
    }

    const questions = normalizeCodexPlannerQuestions(params);
    if (!questions) {
      return;
    }

    const session = this.plannerSessions.get(runId);
    callbacks.onInfo({
      message: 'Codex planner asked a clarifying question.',
      planner: {
        kind: 'questions',
        sessionId: session?.providerThreadId ?? null,
        callId: String(id),
        questions
      }
    });
  }

  private createPlannerProgressFromItem(
    session: CodexPlannerSession,
    item: Record<string, unknown>,
    providerEventType: string
  ) {
    const todos = extractCodexTodoItems(item, providerEventType);
    if (!todos) {
      return null;
    }

    const signature = createCodexTodoSignature(todos);
    if (signature === session.lastTodoSignature) {
      return null;
    }

    session.lastTodoSignature = signature;
    return deriveRunProgressFromProviderTodos(todos, session.runId, session.threadId, 'Codex tasks');
  }

  private createPlannerProgressFromPlanText(session: CodexPlannerSession) {
    const todos = extractCodexChecklistTodos(session.planProgressText);
    if (!todos) {
      return null;
    }

    const signature = createCodexTodoSignature(todos);
    if (signature === session.lastTodoSignature) {
      return null;
    }

    session.lastTodoSignature = signature;
    return deriveRunProgressFromProviderTodos(todos, session.runId, session.threadId, 'Codex tasks');
  }

  private createPlannerDiagnosticsFromItem(
    session: CodexPlannerSession,
    item: Record<string, unknown>,
    providerEventType: string
  ): ProviderDiagnosticsPayload | null {
    if (!providerEventType.startsWith('item/')) {
      return null;
    }

    const itemType = typeof item.type === 'string' ? item.type : typeof item.kind === 'string' ? item.kind : null;
    const normalizedItemType = itemType?.toLowerCase() ?? null;
    if (
      normalizedItemType === 'websearch'
      || normalizedItemType === 'commandexecution'
      || normalizedItemType === 'filechange'
      || normalizedItemType === 'filechangeapproval'
      || normalizedItemType === 'reasoning'
    ) {
      return null;
    }
    const itemKeys = Object.keys(item).sort();
    const taskLike =
      [providerEventType, itemType ?? '', ...itemKeys]
        .some((value) => /(todo|task|checklist|step|subtask|milestone)/iu.test(value));
    const approvalLike = isCodexApprovalLike(providerEventType, itemType, itemKeys);
    const evidenceLike = isCodexEvidenceLike(providerEventType, itemType, itemKeys);

    if (!taskLike && !approvalLike && !evidenceLike) {
      return null;
    }

    const classification = taskLike
      ? 'task_candidate_unparsed'
      : approvalLike
        ? 'approval_candidate_unparsed'
        : 'evidence_candidate_unparsed';
    const paths = extractCodexDiagnosticPaths(item);
    const decision = extractCodexDiagnosticDecision(item);
    const status = extractCodexDiagnosticStatus(item);

    const signature = JSON.stringify({
      providerEventType,
      itemType,
      itemKeys,
      classification,
      paths,
      decision,
      status
    });
    if (session.seenDiagnosticSignatures.has(signature)) {
      return null;
    }

    session.seenDiagnosticSignatures.add(signature);
    return {
      kind: 'provider_event_classification',
      source: 'codex_app_server',
      providerEventType,
      itemType,
      itemKeys,
      paths,
      decision,
      status,
      taskLike,
      classification
    };
  }

  private createPlannerDiagnosticsFromNotification(
    session: CodexPlannerSession,
    providerEventType: string,
    params: Record<string, unknown> | undefined
  ): ProviderDiagnosticsPayload | null {
    if (!params) {
      return null;
    }

    if (isRecord(params.item)) {
      return this.createPlannerDiagnosticsFromItem(
        session,
        params.item,
        providerEventType
      );
    }

    const itemKeys = Object.keys(params).sort();
    const approvalLike = isCodexApprovalLike(providerEventType, null, itemKeys);
    const evidenceLike = isCodexEvidenceLike(providerEventType, null, itemKeys);
    if (!approvalLike && !evidenceLike) {
      return null;
    }

    const classification = approvalLike
      ? 'approval_candidate_unparsed'
      : 'evidence_candidate_unparsed';
    const paths = extractCodexDiagnosticPaths(params);
    const decision = extractCodexDiagnosticDecision(params);
    const status = extractCodexDiagnosticStatus(params);

    const signature = JSON.stringify({
      providerEventType,
      itemType: null,
      itemKeys,
      classification,
      paths,
      decision,
      status
    });
    if (session.seenDiagnosticSignatures.has(signature)) {
      return null;
    }

    session.seenDiagnosticSignatures.add(signature);
    return {
      kind: 'provider_event_classification',
      source: 'codex_app_server',
      providerEventType,
      itemType: null,
      itemKeys,
      paths,
      decision,
      status,
      taskLike: false,
      classification
    };
  }

  private createCliDiagnosticsFromEvent(
    event: { type?: string; item?: Record<string, unknown> },
    seenDiagnosticSignatures: Set<string>
  ): ProviderDiagnosticsPayload | null {
    const providerEventType =
      typeof event.type === 'string' ? cleanJsonText(event.type) : null;
    if (!providerEventType) {
      return null;
    }

    const itemType =
      isRecord(event.item) && typeof event.item.type === 'string'
        ? cleanJsonText(event.item.type)
        : isRecord(event.item) && typeof event.item.kind === 'string'
          ? cleanJsonText(event.item.kind)
          : null;
    const itemKeys = Object.keys(event).sort();

    const approvalLike = isCodexApprovalLike(
      providerEventType,
      itemType,
      itemKeys
    );
    const evidenceLike = isCodexEvidenceLike(
      providerEventType,
      itemType,
      itemKeys
    );
    if (!approvalLike && !evidenceLike) {
      return null;
    }

    const classification = approvalLike
      ? 'approval_candidate_unparsed'
      : 'evidence_candidate_unparsed';
    const paths = extractCodexDiagnosticPaths(event as Record<string, unknown>);
    const decision = extractCodexDiagnosticDecision(
      event as Record<string, unknown>
    );
    const status = extractCodexDiagnosticStatus(event as Record<string, unknown>);

    const signature = JSON.stringify({
      source: 'codex_cli_json',
      providerEventType,
      itemType,
      itemKeys,
      classification,
      paths,
      decision,
      status
    });
    if (seenDiagnosticSignatures.has(signature)) {
      return null;
    }

    seenDiagnosticSignatures.add(signature);
    return {
      kind: 'provider_event_classification',
      source: 'codex_cli_json',
      providerEventType,
      itemType,
      itemKeys,
      paths,
      decision,
      status,
      taskLike: false,
      classification
    };
  }

  private closePlannerSession(runId: string) {
    const session = this.plannerSessions.get(runId);
    if (!session) {
      return;
    }

    this.plannerSessions.delete(runId);
    session.client.close();
  }
}
