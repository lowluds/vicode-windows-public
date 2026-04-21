import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, parse, resolve } from 'node:path';
import type { PlannerQuestion, ProviderAccount, ProviderAuthMode, ProviderModel, ProviderQuotaStatus } from '../../shared/domain';
import { providerCliAuthLaunch, providerCliCommands, providerCliExecutableName } from '../../shared/providers';
import { deriveRunProgressFromProviderTodos, type ProviderTodoItem } from '../../shared/run-progress';
import { skillSlug } from '../../shared/skills';
import { getProviderFallbackModels, sanitizeDiscoveredModels } from '../catalog';
import { extractGeminiCliInfoMessages } from '../run-activity';
import type {
  ProviderAdapter,
  ProviderDiagnosticsPayload,
  ProviderInfoPayload,
  ProviderPlannerSignal,
  ProviderRunCallbacks,
  ProviderRunContext,
  ProviderRunHandle
} from '../types';
import {
  detectCliInstall,
  fileExists,
  getWindowsCmdExecutable,
  killProcessTree,
  quotePowerShellArg,
  spawnHiddenExecutable
} from '../util';
const MODELS: ProviderModel[] = getProviderFallbackModels('gemini');
const GEMINI_POST_INIT_STALL_TIMEOUT_MS = 45_000;
const GEMINI_BROWSER_AUTH_PROMPT_PATTERN =
  /opening authentication page in your browser\.\s*do you want to continue\?\s*\[y\/n\]:/iu;
const GEMINI_RUNTIME_TOOL_BRIDGE_EXTENSION_NAME = 'vicode-runtime-bridge';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeComparableText(value: string) {
  return value.replace(/\s+/gu, ' ').trim().toLowerCase();
}

function resolveGeminiRuntimeBridgeScriptPath() {
  if (typeof process.resourcesPath === 'string' && process.resourcesPath.trim()) {
    const packagedPath = join(process.resourcesPath, 'mcp', 'gemini-runtime-tool-bridge.mjs');
    if (existsSync(packagedPath)) {
      return packagedPath;
    }
  }

  return resolve(process.cwd(), 'resources', 'mcp', 'gemini-runtime-tool-bridge.mjs');
}

function isGeminiCliBanner(line: string) {
  const normalized = normalizeComparableText(line);
  return (
    normalized === 'loaded cached credentials.' ||
    normalized === 'loaded cached credentials' ||
    normalized === 'yolo mode is enabled. all tool calls will be automatically approved.' ||
    normalized === 'plan mode is enabled. gemini may ask clarifying questions before execution.'
  );
}

function isLikelyCliDiagnostic(line: string) {
  return /^(error|warning|failed|exception|traceback|info)\b/iu.test(line.trim());
}

const nodeInternalStackLinePattern =
  /^\s*at .*(?:\((?:node:)?internal[/:].+\)|\((?:node:)?diagnostics_channel:.+\)|(?:node:)?internal[/:].+|(?:node:)?diagnostics_channel:.+)$/u;

function isIgnorableConptyDiagnosticLine(line: string) {
  const normalized = normalizeComparableText(line);
  if (!normalized) {
    return false;
  }

  return (
    nodeInternalStackLinePattern.test(line) ||
    normalized.includes('conpty_console_list_agent.js:11') ||
    normalized.includes('var consoleprocesslist = getconsoleprocesslist(shellpid);') ||
    normalized === '^' ||
    normalized.includes('@lydell/node-pty/conpty_console_list_agent.js')
  );
}

function isIgnorableGeminiErrorContinuationLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }

  return (
    /^at\s+/u.test(trimmed) ||
    /^node\.js v\d+/iu.test(trimmed) ||
    /^(config|response|request|headers|data|error):/iu.test(trimmed) ||
    /^\{|\}|\[|\]|statusText:|status:|method:|url:|params:|responseType:|signal:|retry:|body:/iu.test(trimmed) ||
    trimmed.includes('gaxios.js:') ||
    trimmed.includes('oauth2client.js:') ||
    trimmed.includes('code_assist/server.js:') ||
    trimmed.includes('loggingContentGenerator.js:') ||
    trimmed.includes('trace.js:') ||
    trimmed.includes('retry.js:') ||
    trimmed.includes('geminiChat.js:') ||
    trimmed.includes('google-api-nodejs-client') ||
    trimmed.includes('cloudcode-pa.googleapis.com') ||
    trimmed.includes('Symbol(gaxios-gaxios-error)')
  );
}

function toGeminiCliRetryInfoMessage(line: string, modelId: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.match(/^Attempt \d+ failed with status 429\b.*retrying with backoff/iu)) {
    return `Gemini is retrying because ${modelId} is currently rate limited or out of capacity.`;
  }

  return null;
}

function isUnstableGeminiModelId(modelId: string) {
  const normalized = modelId.trim().toLowerCase();
  return normalized === 'auto-gemini-3' || /^gemini-3(?:[.-].*preview)?$/u.test(normalized);
}

function buildGeminiCapacityGuidance(modelId: string) {
  return isUnstableGeminiModelId(modelId)
    ? 'Try Gemini 2.5 Flash or Gemini 2.5 Pro and retry. Gemini 3 auto and preview routes are less reliable when capacity is tight.'
    : 'Try Gemini 2.5 Flash or Gemini 2.5 Pro and retry.';
}

function toGeminiCliErrorMessage(line: string, modelId: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const capacityMatch = trimmed.match(/No capacity available for model ([^"\s]+) on the server/iu);
  if (capacityMatch) {
    const unavailableModel = capacityMatch[1] ?? modelId;
    return `Gemini could not run because ${unavailableModel} has no server capacity right now. ${buildGeminiCapacityGuidance(unavailableModel)}`;
  }

  if (
    trimmed.includes('RESOURCE_EXHAUSTED') ||
    trimmed.includes('MODEL_CAPACITY_EXHAUSTED') ||
    trimmed.includes('rateLimitExceeded') ||
    trimmed.match(/\bstatus 429\b/iu)
  ) {
    return `Gemini could not run because ${modelId} is currently rate limited or out of capacity. ${buildGeminiCapacityGuidance(modelId)}`;
  }

  if (trimmed.includes('AttachConsole failed')) {
    return 'Gemini CLI failed while attaching its Windows console helper.';
  }

  return null;
}

function isIgnorableAskUserDiagnostic(value: string | null | undefined) {
  const normalized = normalizeComparableText(value ?? '');
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('tool "ask_user" not found') ||
    normalized.includes("tool 'ask_user' not found") ||
    normalized.includes('error executing tool ask_user')
  );
}

function isIgnorablePlannerToolDiagnostic(value: string | null | undefined) {
  const normalized = normalizeComparableText(value ?? '');
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('tool "investigate" not found') ||
    normalized.includes("tool 'investigate' not found") ||
    normalized.includes('error executing tool investigate') ||
    normalized.includes('tool "write_file" not found') ||
    normalized.includes("tool 'write_file' not found") ||
    normalized.includes('error executing tool write_file') ||
    normalized.includes('tool "exit_plan_mode" not found') ||
    normalized.includes("tool 'exit_plan_mode' not found") ||
    normalized.includes('error executing tool exit_plan_mode')
  );
}

function shouldIgnoreGeminiPlannerInfoPayload(payload: ProviderInfoPayload) {
  const message =
    typeof payload === 'string'
      ? payload
      : typeof payload.message === 'string'
        ? payload.message
        : payload.activity?.text ?? payload.activity?.summary ?? '';

  if (isIgnorablePlannerToolDiagnostic(message)) {
    return true;
  }

  if (
    typeof payload !== 'string'
    && payload.activity?.kind === 'thinking'
    && payload.activity.providerEventType === 'status'
  ) {
    return true;
  }

  return false;
}

function shouldIgnoreGeminiInfoPayload(payload: ProviderInfoPayload) {
  if (typeof payload === 'string') {
    return isIgnorableAskUserDiagnostic(payload);
  }

  return (
    isIgnorableAskUserDiagnostic(payload.message) ||
    isIgnorableAskUserDiagnostic(payload.activity?.summary) ||
    isIgnorableAskUserDiagnostic(payload.activity?.text ?? null)
  );
}

function buildGeminiProviderDiagnostics(event: Record<string, unknown>): ProviderDiagnosticsPayload | null {
  const providerEventType = typeof event.type === 'string' ? event.type : null;
  if (!providerEventType || providerEventType === 'message' || providerEventType === 'status') {
    return null;
  }

  if (
    providerEventType === 'tool_result'
    && typeof event.tool_name === 'string'
    && event.tool_name === 'ask_user'
    && typeof event.status === 'string'
    && event.status === 'error'
  ) {
    return null;
  }

  const paths = [
    typeof event.path === 'string' ? event.path : null,
    typeof event.file_path === 'string' ? event.file_path : null,
    typeof event.dir_path === 'string' ? event.dir_path : null,
    typeof event.cwd === 'string' ? event.cwd : null
  ].filter((value): value is string => Boolean(value));

  const classification =
    providerEventType === 'tool_use' || providerEventType === 'tool_result'
      ? 'evidence_candidate_unparsed'
      : providerEventType === 'status' && typeof event.status === 'string'
        ? 'approval_candidate_unparsed'
        : 'unclassified';

  return {
    kind: 'provider_event_classification',
    source: 'gemini_cli_json',
    providerEventType,
    itemType: typeof event.tool_name === 'string' ? event.tool_name : null,
    itemKeys: Object.keys(event),
    paths,
    decision: null,
    status: typeof event.status === 'string' ? event.status : null,
    taskLike: providerEventType === 'status',
    classification
  };
}

interface GeminiExtensionManifest {
  name?: string;
  description?: string;
  version?: string;
  contextFileName?: string;
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
      name = nameMatch[1].replace(/^['"]|['"]$/gu, '').trim();
      continue;
    }

    const descriptionMatch = line.match(/^description:\s*(.+)$/u);
    if (descriptionMatch) {
      description = descriptionMatch[1].replace(/^['"]|['"]$/gu, '').trim();
    }
  }

  return { name, description };
}

function extractFirstHeading(markdown: string) {
  const match = markdown.match(/^#\s+(.+)$/mu);
  return match?.[1]?.trim() ?? null;
}

function buildGeminiExtensionMarkdown(
  manifest: GeminiExtensionManifest,
  folderName: string,
  contextFileName: string | null,
  contextMarkdown: string | null
) {
  if (contextMarkdown?.trim().startsWith('#')) {
    const appendix: string[] = [];

    appendix.push('', '---', '', '## Runtime', 'This extension is loaded by Gemini CLI when Gemini runs through Vicode.');
    if (manifest.version?.trim()) {
      appendix.push('', '## Version', manifest.version.trim());
    }
    if (contextFileName) {
      appendix.push('', '## Context file', `\`${contextFileName}\``);
    }

    return `${contextMarkdown.trim()}\n${appendix.join('\n')}`.trim();
  }

  const sections = [
    `# ${manifest.name?.trim() || folderName}`,
    '',
    manifest.description?.trim() || 'Installed Gemini CLI extension.',
    '',
    '## Provider',
    'This extension is loaded by Gemini CLI when Gemini runs through Vicode.',
    ''
  ];

  if (manifest.version?.trim()) {
    sections.push('## Version', manifest.version.trim(), '');
  }

  if (contextFileName) {
    sections.push('## Context file', `\`${contextFileName}\``, '');
  }

  if (contextMarkdown?.trim()) {
    sections.push('## Context', '', contextMarkdown.trim(), '');
  }

  return sections.join('\n').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectRecords(value: unknown, depth = 0, maxDepth = 5, results: Record<string, unknown>[] = []) {
  if (depth > maxDepth || !value) {
    return results;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectRecords(entry, depth + 1, maxDepth, results);
    }
    return results;
  }

  if (!isRecord(value)) {
    return results;
  }

  results.push(value);
  for (const entry of Object.values(value)) {
    if (Array.isArray(entry) || isRecord(entry)) {
      collectRecords(entry, depth + 1, maxDepth, results);
    }
  }

  return results;
}

function normalizeText(value: string | null | undefined) {
  return value?.replace(/\s+/gu, ' ').trim() ?? '';
}

function extractGeminiResultErrorMessage(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const message = findString(value, ['message', 'error', 'detail']);
  return message ? message.replace(/^\[API Error:\s*/u, '').replace(/\]$/u, '').trim() : null;
}

function extractGeminiResultText(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  for (const current of collectRecords(value)) {
    for (const key of ['content', 'text', 'response', 'result', 'finalResponse', 'final_response', 'answer', 'markdown']) {
      const candidate = current[key];
      if (typeof candidate === 'string' && normalizeText(candidate)) {
        return normalizeText(candidate);
      }
    }
  }

  return null;
}

function isGeminiTodoStatus(value: unknown): value is ProviderTodoItem['status'] {
  return value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'cancelled';
}

function extractGeminiTodoItems(value: unknown): ProviderTodoItem[] | null {
  if (!isRecord(value) || !Array.isArray(value.todos)) {
    return null;
  }

  const todos: ProviderTodoItem[] = [];
  for (const entry of value.todos) {
    if (!isRecord(entry) || typeof entry.description !== 'string' || !isGeminiTodoStatus(entry.status)) {
      return null;
    }
    todos.push({
      description: entry.description,
      status: entry.status
    });
  }

  return todos.length > 0 ? todos : null;
}

function findString(record: Record<string, unknown>, keys: string[]) {
  for (const current of collectRecords(record)) {
    for (const key of keys) {
      const value = current[key];
      if (typeof value === 'string' && normalizeText(value)) {
        return normalizeText(value);
      }
    }
  }
  return null;
}

function findQuestionCandidates(record: Record<string, unknown>) {
  for (const current of collectRecords(record)) {
    const questions = current.questions;
    if (Array.isArray(questions) && questions.length > 0) {
      return questions;
    }
  }
  return null;
}

function findLatestJsonLine(stdout: string) {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .find((line) => line.startsWith('{') && line.endsWith('}'));
}

function normalizePlannerQuestions(rawQuestions: unknown): PlannerQuestion[] | null {
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return null;
  }

  const questions: PlannerQuestion[] = [];

  for (const [questionIndex, rawQuestion] of rawQuestions.entries()) {
    if (!isRecord(rawQuestion)) {
      return null;
    }

    const header =
      normalizeText(
        typeof rawQuestion.header === 'string'
          ? rawQuestion.header
          : typeof rawQuestion.title === 'string'
            ? rawQuestion.title
            : typeof rawQuestion.label === 'string'
              ? rawQuestion.label
              : null
      ) || `Question ${questionIndex + 1}`;
    const question =
      normalizeText(
        typeof rawQuestion.question === 'string'
          ? rawQuestion.question
          : typeof rawQuestion.prompt === 'string'
            ? rawQuestion.prompt
            : typeof rawQuestion.text === 'string'
              ? rawQuestion.text
              : null
      );

    const rawOptions =
      Array.isArray(rawQuestion.options) ? rawQuestion.options : Array.isArray(rawQuestion.choices) ? rawQuestion.choices : null;
    if (!question || !rawOptions || rawOptions.length === 0) {
      return null;
    }

    const options = rawOptions
      .map((rawOption, optionIndex) => {
        if (typeof rawOption === 'string') {
          const label = normalizeText(rawOption);
          if (!label) {
            return null;
          }
          return {
            id: `option-${questionIndex + 1}-${optionIndex + 1}`,
            label,
            description: label,
            recommended: false
          };
        }

        if (!isRecord(rawOption)) {
          return null;
        }

        const label =
          normalizeText(
            typeof rawOption.label === 'string'
              ? rawOption.label
              : typeof rawOption.title === 'string'
                ? rawOption.title
                : typeof rawOption.value === 'string'
                  ? rawOption.value
                  : null
          );
        if (!label) {
          return null;
        }

        return {
          id: normalizeText(typeof rawOption.id === 'string' ? rawOption.id : null) || `option-${questionIndex + 1}-${optionIndex + 1}`,
          label,
          description:
            normalizeText(
              typeof rawOption.description === 'string'
                ? rawOption.description
                : typeof rawOption.details === 'string'
                  ? rawOption.details
                  : typeof rawOption.reason === 'string'
                    ? rawOption.reason
                    : label
            ) || label,
          recommended:
            rawOption.recommended === true ||
            rawOption.isRecommended === true ||
            rawOption.default === true ||
            rawOption.selected === true
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .slice(0, 3);

    if (options.length < 2) {
      return null;
    }

    const recommendedOptionId = options.find((option) => option.recommended)?.id ?? options[0].id;
    questions.push({
      id: normalizeText(typeof rawQuestion.id === 'string' ? rawQuestion.id : null) || `question-${questionIndex + 1}`,
      header,
      question,
      options: options.map(({ recommended: _recommended, ...option }) => option),
      recommendedOptionId,
      allowOther: true
    });
  }

  return questions.length > 0 ? questions.slice(0, 3) : null;
}

function extractGeminiPlannerSignals(event: unknown): ProviderPlannerSignal[] {
  if (!isRecord(event)) {
    return [];
  }

  const signals: ProviderPlannerSignal[] = [];
  const sessionId = extractGeminiExecutionSessionId(event);
  if (sessionId) {
    signals.push({
      kind: 'session',
      sessionId
    });
  }

  for (const record of collectRecords(event)) {
    const toolName = (
      findString(record, ['toolName', 'tool_name', 'tool', 'name', 'action']) ?? ''
    ).toLowerCase();
    const type = (findString(record, ['type', 'event', 'kind']) ?? '').toLowerCase();

    if (!toolName.includes('ask_user') && !type.includes('ask_user')) {
      continue;
    }

    const questions = normalizePlannerQuestions(findQuestionCandidates(record));
    if (!questions) {
      continue;
    }

    signals.push({
      kind: 'questions',
      sessionId,
      callId:
        findString(record, ['callId', 'call_id', 'toolCallId', 'tool_call_id', 'invocationId', 'invocation_id']) ??
        `gemini-ask-user-${randomUUID()}`,
      questions
    });
  }

  return signals;
}

function extractGeminiExecutionSessionId(event: unknown) {
  if (!isRecord(event)) {
    return null;
  }

  return findString(event, ['sessionId', 'session_id', 'conversationId', 'conversation_id']) ?? null;
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

export class GeminiAdapter implements ProviderAdapter {
  readonly id = 'gemini' as const;
  readonly label = 'Gemini';
  private headlessRunTimeoutMs = 15 * 60 * 1000;

  private async stageWorkspaceImageAttachments(context: ProviderRunContext) {
    const attachments = context.imageAttachments ?? [];
    if (attachments.length === 0) {
      return {
        prompt: context.prompt,
        cleanup: async () => {}
      };
    }

    if (!context.folderPath) {
      throw new Error('Gemini image attachments require a project folder so the CLI can resolve local multimodal files.');
    }

    const attachmentDir = join(context.folderPath, '.vicode', 'composer-images', context.runId);
    await mkdir(attachmentDir, { recursive: true });
    const promptLines = [context.prompt, '', 'Attached images:'];

    for (const [index, attachment] of attachments.entries()) {
      const { mimeType, bytes } = parseImageAttachmentDataUrl(attachment.dataUrl);
      const filePath = join(attachmentDir, sanitizeImageAttachmentName(attachment.name, mimeType, index));
      await writeFile(filePath, bytes);
      promptLines.push(`@{${filePath}}`);
    }

    return {
      prompt: promptLines.join('\n').trim(),
      cleanup: async () => {
        await rm(attachmentDir, { recursive: true, force: true }).catch(() => undefined);
      }
    };
  }

  listStaticModels(): ProviderModel[] {
    return MODELS;
  }

  getPlannerCapability() {
    return {
      supported: true,
      executionMode: 'full-access' as const,
      enforcement: 'best-effort' as const,
      message: 'Gemini planner runs through the native Gemini CLI plan mode. Approval enforcement still depends on the CLI runtime.'
    };
  }

  async discoverApiModels(input: {
    account: ProviderAccount | null;
    authMode: ProviderAuthMode | null;
    apiKey: string | null;
    cliPath: string | null;
  }) {
    if (!input.apiKey) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(input.apiKey)}`,
        {
          method: 'GET',
          signal: controller.signal
        }
      );

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        models?: Array<{
          name?: string;
          displayName?: string;
          description?: string;
          supportedGenerationMethods?: string[];
        }>;
      };

      const discovered = (payload.models ?? [])
        .filter((model) =>
          Array.isArray(model.supportedGenerationMethods)
            ? model.supportedGenerationMethods.some((method) => method === 'generateContent' || method === 'streamGenerateContent')
            : true
        )
        .map((model) => {
          const modelId = model.name?.replace(/^models\//u, '').trim();
          if (!modelId) {
            return null;
          }
          return {
            id: modelId,
            label: model.displayName?.trim() || modelId,
            description: model.description?.trim() || ''
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
    authMode: ProviderAuthMode | null;
    cliPath: string | null;
  }) {
    if (!input.cliPath || !input.authMode) {
      return null;
    }
    // Official Gemini CLI docs expose model selection at the CLI surface, but not a
    // supported machine-readable runtime catalog. Keep Vicode on the canonical
    // repo-owned Gemini model list instead of importing private gemini-cli-core
    // internals that drift between releases.
    return null;
  }

  async detectInstall() {
    return detectCliInstall(providerCliCommands('gemini'));
  }

  async getAuthState(account: ProviderAccount | null) {
    const configDir = join(homedir(), '.gemini');
    const oauthCredentials = join(configDir, 'oauth_creds.json');
    const googleAccounts = join(configDir, 'google_accounts.json');
    const hasOauthCredentials = await fileExists(oauthCredentials);
    const hasGoogleAccounts = await fileExists(googleAccounts);

    if (hasOauthCredentials && hasGoogleAccounts) {
      return {
        authState: 'connected' as const,
        authMode: 'cli' as const,
        message: 'Gemini CLI sign-in detected.'
      };
    }

    if (hasOauthCredentials || hasGoogleAccounts) {
      return {
        authState: 'detected' as const,
        authMode: 'cli' as const,
        message: 'Gemini auth files were detected. Refresh after sign-in or repair the CLI if Vicode cannot use it yet.'
      };
    }

    if (account?.encryptedApiKey) {
      return { authState: 'connected' as const, authMode: 'api_key' as const, message: 'Using encrypted Gemini API key as fallback.' };
    }

    return {
      authState: 'disconnected' as const,
      authMode: null,
      message: 'Use Google sign-in through Gemini CLI or store an API key locally.'
    };
  }

  async getQuotaStatus(input: {
    account: ProviderAccount | null;
    authMode: ProviderAuthMode | null;
    cliPath: string | null;
    apiKey: string | null;
    modelId?: string | null;
  }): Promise<ProviderQuotaStatus | null> {
    void input;
    // Google documents Gemini CLI quotas at the product/account level, but does
    // not expose a supported machine-readable quota API for the CLI runtime.
    // Avoid scraping private gemini-cli-core internals until an official surface
    // exists.
    return null;
  }

  async startAuth(mode?: ProviderAuthMode, cliPath?: string | null) {
    if (mode === 'api_key') {
      return;
    }

    const authLaunch = providerCliAuthLaunch('gemini');
    const settingsOverrideRoot = await mkdtemp(join(tmpdir(), 'vicode-gemini-auth-'));
    const settingsOverridePath = join(settingsOverrideRoot, 'settings.json');
    await writeFile(
      settingsOverridePath,
      JSON.stringify(
        {
          security: {
            auth: {
              enforcedType: 'oauth-personal',
              selectedType: 'oauth-personal',
              useExternal: true
            }
          }
        },
        null,
        2
      ),
      'utf8'
    );

    const child = spawnHiddenExecutable(
      cliPath ?? providerCliExecutableName('gemini'),
      authLaunch.args,
      {
        env: {
          ...process.env,
          GEMINI_CLI_NO_RELAUNCH: 'true',
          GEMINI_CLI_SYSTEM_SETTINGS_PATH: settingsOverridePath
        }
      }
    );

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      void rm(settingsOverrideRoot, { recursive: true, force: true }).catch(() => undefined);
    };

    let promptBuffer = '';
    let browserConfirmSent = false;
    const handlePromptChunk = (chunk: string) => {
      promptBuffer = `${promptBuffer}${chunk}`.slice(-4096);
      if (!browserConfirmSent && GEMINI_BROWSER_AUTH_PROMPT_PATTERN.test(promptBuffer)) {
        browserConfirmSent = true;
        child.stdin.write('y\n');
      }
    };

    child.stdout.on('data', (chunk) => {
      handlePromptChunk(String(chunk));
    });
    child.stderr.on('data', (chunk) => {
      handlePromptChunk(String(chunk));
    });
    child.once('error', cleanup);
    child.once('close', cleanup);
  }

  async clearAuth() {
    return;
  }

  async discoverNativeSkills() {
    const discoveredFromSkills = await this.discoverNativeSkillFolders();
    const discoveredFromExtensions = await this.discoverNativeExtensions();
    return [...discoveredFromSkills, ...discoveredFromExtensions];
  }

  private async discoverNativeSkillFolders() {
    const root = join(homedir(), '.gemini', 'skills');
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
          const skillPath = (await fileExists(join(folderPath, 'SKILL.md')))
            ? join(folderPath, 'SKILL.md')
            : (await fileExists(join(folderPath, 'GEMINI.md')))
              ? join(folderPath, 'GEMINI.md')
              : null;
          if (!skillPath) {
            return null;
          }

          try {
            const markdown = await readFile(skillPath, 'utf8');
            const frontMatter = parseFrontMatter(markdown);
            const name = frontMatter.name ?? extractFirstHeading(markdown) ?? entry.name;
            const description = frontMatter.description ?? 'Installed Gemini skill.';

            return {
              id: `provider-native:gemini:skill:${entry.name}`,
              name,
              description,
              instructions: description,
              path: skillPath,
              providerTargets: ['gemini'],
              attachMode: 'runtime',
              kind: 'skill',
              metadata: {
                providerOrigin: 'gemini',
                kind: 'skill',
                attachMode: 'runtime',
                folderName: entry.name,
                slug: skillSlug(name),
                browseUrl: 'https://geminicli.com/extensions/'
              }
            } satisfies Awaited<ReturnType<ProviderAdapter['discoverNativeSkills']>>[number];
          } catch {
            return null;
          }
        })
    );

    return discovered.filter((value): value is NonNullable<(typeof discovered)[number]> => Boolean(value));
  }

  private async discoverNativeExtensions() {
    const root = join(homedir(), '.gemini', 'extensions');
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
          const manifestPath = join(folderPath, 'gemini-extension.json');
          if (!(await fileExists(manifestPath))) {
            return null;
          }

          try {
            const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as GeminiExtensionManifest;
            const contextFileName = manifest.contextFileName?.trim() || null;
            const contextCandidates = [
              contextFileName ? join(folderPath, contextFileName) : null,
              join(folderPath, 'GEMINI.md'),
              join(folderPath, 'README.md')
            ].filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);
            const resolvedContextPath =
              (await Promise.all(contextCandidates.map(async (candidate) => ((await fileExists(candidate)) ? candidate : null))))
                .find((candidate): candidate is string => Boolean(candidate)) ?? null;
            const contextMarkdown = resolvedContextPath ? await readFile(resolvedContextPath, 'utf8') : null;
            const name = manifest.name?.trim() || entry.name;
            const description = manifest.description?.trim() || 'Installed Gemini CLI extension.';

            return {
              id: `provider-native:gemini:extension:${entry.name}`,
              name,
              description,
              instructions: description,
              path: resolvedContextPath ?? manifestPath,
              providerTargets: ['gemini'],
              attachMode: 'runtime',
              kind: 'extension',
              metadata: {
                providerOrigin: 'gemini',
                kind: 'extension',
                attachMode: 'runtime',
                folderName: entry.name,
                slug: skillSlug(name),
                browseUrl: 'https://geminicli.com/extensions/',
                detailMarkdown: buildGeminiExtensionMarkdown(
                  manifest,
                  entry.name,
                  resolvedContextPath ? basename(resolvedContextPath) : contextFileName,
                  contextMarkdown
                )
              }
            } satisfies Awaited<ReturnType<ProviderAdapter['discoverNativeSkills']>>[number];
          } catch {
            return null;
          }
        })
    );

    return discovered.filter((value): value is NonNullable<(typeof discovered)[number]> => Boolean(value));
  }

  validateProjectContext(folderPath: string | null, trusted: boolean) {
    if (folderPath && !trusted) {
      return {
        valid: false,
        message: 'Trust the project before running Gemini against this workspace.'
      };
    }

    return { valid: true };
  }

  async startRun(context: ProviderRunContext, callbacks: ProviderRunCallbacks): Promise<ProviderRunHandle> {
    const validation = this.validateProjectContext(context.folderPath, context.trusted);
    if (!validation.valid) {
      throw new Error(validation.message ?? 'Project is not trusted for provider execution.');
    }

    callbacks.onStart();
    const baseRuntimeContext =
      context.runMode === 'plan'
        ? {
            ...context,
            runtimeSkillResources: (context.runtimeSkillResources ?? []).filter((resource) => resource.kind !== 'extension')
          }
        : context;

    let stagedImages: Awaited<ReturnType<GeminiAdapter['stageWorkspaceImageAttachments']>> | null = null;
    let runtimeToolBridge: Awaited<ReturnType<GeminiAdapter['createRuntimeToolBridge']>> | null = null;

    try {
      runtimeToolBridge = await this.createRuntimeToolBridge(baseRuntimeContext, callbacks);
      const runtimeContext =
        runtimeToolBridge.resource
          ? {
              ...baseRuntimeContext,
              runtimeSkillResources: [...(baseRuntimeContext.runtimeSkillResources ?? []), runtimeToolBridge.resource]
            }
          : baseRuntimeContext;
      stagedImages = await this.stageWorkspaceImageAttachments(runtimeContext);
      const args = ['-m', context.modelId, '-p', stagedImages.prompt, '--output-format', 'stream-json'];
      if (context.resumeSessionId) {
        args.push('-r', context.resumeSessionId);
      }

      if (context.runMode === 'plan') {
        args.push('--approval-mode', 'plan');
      } else if (context.executionPermission === 'full_access') {
        args.push('--approval-mode', 'yolo');
      }

      const isolatedRuntime = await this.prepareIsolatedRuntime(runtimeContext);
      const detectedCliPath = (await this.detectInstall()).cliPath ?? providerCliExecutableName('gemini');
      const { executable, args: resolvedArgs } = await this.resolveHeadlessCommand(detectedCliPath, args);
      const processor = this.createStreamProcessor(runtimeContext, callbacks);
      return this.startHeadlessRun(
        executable,
        resolvedArgs,
        runtimeContext,
        callbacks,
        processor,
        isolatedRuntime,
        async () => {
          await runtimeToolBridge?.cleanup();
          await stagedImages.cleanup();
        }
      );
    } catch (error) {
      await runtimeToolBridge?.cleanup().catch(() => undefined);
      await stagedImages?.cleanup().catch(() => undefined);
      const message = error instanceof Error && error.message ? error.message : 'Failed to prepare Gemini CLI.';
      queueMicrotask(() => callbacks.onError(message));
      return {
        runId: context.runId,
        cancel: async (reason) => {
          callbacks.onAbort(reason ?? 'Gemini run was stopped.');
        }
      };
    }
  }

  private async createRuntimeToolBridge(context: ProviderRunContext, callbacks: ProviderRunCallbacks) {
    if (context.runMode === 'plan' || !callbacks.invokeRuntimeTool) {
      return {
        resource: null,
        cleanup: async () => undefined
      };
    }

    const bridgeScriptPath = resolveGeminiRuntimeBridgeScriptPath();
    if (!(await fileExists(bridgeScriptPath))) {
      return {
        resource: null,
        cleanup: async () => undefined
      };
    }

    const token = randomUUID();
    const runtimeToolBridge = createServer(async (request, response) => {
      if (request.method !== 'POST' || request.url !== '/runtime-tool') {
        response.writeHead(404).end();
        return;
      }

      if (request.headers.authorization !== `Bearer ${token}`) {
        response.writeHead(403).end();
        return;
      }

      let body = '';
      for await (const chunk of request) {
        body += String(chunk);
      }

      try {
        const parsed = JSON.parse(body) as { name?: unknown; arguments?: unknown };
        const callName = typeof parsed.name === 'string' ? parsed.name.trim() : '';
        const callArguments = isPlainObject(parsed.arguments) ? parsed.arguments : {};
        if (!callName) {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ toolName: '', content: 'Runtime tool call name was missing.', isError: true }));
          return;
        }

        const result = await callbacks.invokeRuntimeTool?.({
          name: callName,
          arguments: callArguments
        });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify(
            result ?? {
              toolName: callName,
              content: `Runtime tool ${callName} is not available for this Gemini run.`,
              isError: true
            }
          )
        );
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            toolName: 'spawn_subagents',
            content: error instanceof Error && error.message ? error.message : 'Gemini runtime bridge failed.',
            isError: true
          })
        );
      }
    });

    const address = await new Promise<{ port: number }>((resolveAddress, reject) => {
      runtimeToolBridge.once('error', reject);
      runtimeToolBridge.listen(0, '127.0.0.1', () => {
        const serverAddress = runtimeToolBridge.address();
        if (!serverAddress || typeof serverAddress === 'string') {
          reject(new Error('Gemini runtime bridge did not bind to a local port.'));
          return;
        }
        resolveAddress(serverAddress);
      });
    });

    const extensionRoot = await mkdtemp(join(tmpdir(), 'vicode-gemini-bridge-'));
    const extensionDir = join(extensionRoot, GEMINI_RUNTIME_TOOL_BRIDGE_EXTENSION_NAME);
    await mkdir(extensionDir, { recursive: true });

    const manifest = {
      name: GEMINI_RUNTIME_TOOL_BRIDGE_EXTENSION_NAME,
      version: '0.0.0',
      description: 'Expose Vicode runtime delegation tools inside Gemini CLI runs.',
      contextFileName: 'GEMINI.md',
      mcpServers: {
        vicode_runtime_bridge: {
          command: process.execPath,
          args: [bridgeScriptPath, `http://127.0.0.1:${address.port}/runtime-tool`, token],
          cwd: dirname(bridgeScriptPath)
        }
      }
    };
    await writeFile(join(extensionDir, 'gemini-extension.json'), JSON.stringify(manifest, null, 2), 'utf8');
    await writeFile(
      join(extensionDir, 'GEMINI.md'),
      [
        '# Vicode Runtime Bridge',
        '',
        'This Gemini CLI run can call the Vicode `spawn_subagents` tool for bounded parallel investigation.',
        'Use it only when parallel repo inspection or verification will materially help, not for the immediate blocking next step.',
        'Keep each helper focused, self-contained, and limited to 1-3 delegated tasks.'
      ].join('\n'),
      'utf8'
    );

    return {
      resource: {
        kind: 'extension' as const,
        path: join(extensionDir, 'GEMINI.md')
      },
      cleanup: async () => {
        await new Promise<void>((resolveClose) => {
          runtimeToolBridge.close(() => resolveClose());
        }).catch(() => undefined);
        await rm(extensionRoot, { recursive: true, force: true }).catch(() => undefined);
      }
    };
  }

  private async prepareIsolatedRuntime(context: ProviderRunContext) {
    const runtimeHome = await mkdtemp(join(tmpdir(), 'vicode-gemini-home-'));
    const geminiDir = join(runtimeHome, '.gemini');
    const roamingAppDataDir = join(runtimeHome, 'AppData', 'Roaming');
    const localAppDataDir = join(runtimeHome, 'AppData', 'Local');
    const tempDir = join(localAppDataDir, 'Temp');
    const powerShellCachePath = join(localAppDataDir, 'Microsoft', 'Windows', 'PowerShell', 'ModuleAnalysisCache');
    await mkdir(geminiDir, { recursive: true });
    await mkdir(roamingAppDataDir, { recursive: true });
    await mkdir(tempDir, { recursive: true });
    await mkdir(dirname(powerShellCachePath), { recursive: true });

    await this.writeRuntimeSettings(join(homedir(), '.gemini', 'settings.json'), join(geminiDir, 'settings.json'));
    await this.copyIfPresent(join(homedir(), '.gemini', 'installation_id'), join(geminiDir, 'installation_id'));
    await this.copyIfPresent(join(homedir(), '.gemini', 'projects.json'), join(geminiDir, 'projects.json'));
    await this.copyIfPresent(join(homedir(), '.gemini', 'state.json'), join(geminiDir, 'state.json'));
    await this.copyIfPresent(join(homedir(), '.gemini', 'trustedFolders.json'), join(geminiDir, 'trustedFolders.json'));
    await this.copyDirectoryIfPresent(join(homedir(), '.gemini', 'policies'), join(geminiDir, 'policies'));

    if (!context.apiKey) {
      await this.copyIfPresent(join(homedir(), '.gemini', 'oauth_creds.json'), join(geminiDir, 'oauth_creds.json'));
      await this.copyIfPresent(join(homedir(), '.gemini', 'google_accounts.json'), join(geminiDir, 'google_accounts.json'));
    }

    for (const resource of context.runtimeSkillResources ?? []) {
      const sourceDir = dirname(resource.path);
      const targetRoot = resource.kind === 'extension' ? join(geminiDir, 'extensions') : join(geminiDir, 'skills');
      const targetDir = join(targetRoot, this.resolveRuntimeFolderName(sourceDir));
      await mkdir(targetRoot, { recursive: true });
      await cp(sourceDir, targetDir, { recursive: true, force: true });
    }

    const parsedHome = parse(runtimeHome);
    return {
      cleanup: async () => {
        await rm(runtimeHome, { recursive: true, force: true }).catch(() => undefined);
      },
      env: {
        HOME: runtimeHome,
        USERPROFILE: runtimeHome,
        HOMEDRIVE: parsedHome.root.replace(/[\\\/]+$/u, ''),
        HOMEPATH: runtimeHome.slice(parsedHome.root.length - 1),
        APPDATA: roamingAppDataDir,
        LOCALAPPDATA: localAppDataDir,
        TEMP: tempDir,
        TMP: tempDir,
        PSModuleAnalysisCachePath: powerShellCachePath,
        GEMINI_CLI_NO_RELAUNCH: 'true'
      }
    };
  }

  private resolveRuntimeFolderName(sourceDir: string) {
    return sourceDir.replace(/[\\\/]+$/u, '').split(/[\\\/]/u).pop() || `runtime-skill-${randomUUID()}`;
  }

  private async writeRuntimeSettings(sourcePath: string, targetPath: string) {
    let settings: Record<string, unknown> = {};

    try {
      const contents = await readFile(sourcePath, 'utf8');
      const parsed = JSON.parse(contents) as unknown;
      if (isPlainObject(parsed)) {
        settings = parsed;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    const tools = isPlainObject(settings.tools) ? settings.tools : {};
    const shell = isPlainObject(tools.shell) ? tools.shell : {};
    const nextSettings = {
      ...settings,
      tools: {
        ...tools,
        shell: {
          ...shell,
          enableInteractiveShell: false
        }
      }
    };

    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, `${JSON.stringify(nextSettings, null, 2)}\n`, 'utf8');
  }

  private async copyIfPresent(sourcePath: string, targetPath: string) {
    try {
      const contents = await readFile(sourcePath);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, contents);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private async copyDirectoryIfPresent(sourcePath: string, targetPath: string) {
    try {
      await cp(sourcePath, targetPath, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private async resolveHeadlessCommand(executable: string, args: string[]) {
    if (process.platform !== 'win32' || !executable.toLowerCase().endsWith('.cmd')) {
      return { executable, args };
    }

    const installDir = dirname(executable);
    const packageRoot = join(installDir, 'node_modules', '@google', 'gemini-cli');
    const nodeScriptCandidates = [
      join(packageRoot, 'bundle', 'gemini.js'),
      join(packageRoot, 'dist', 'index.js')
    ];
    let nodeScript: string | null = null;
    for (const candidate of nodeScriptCandidates) {
      if (await fileExists(candidate)) {
        nodeScript = candidate;
        break;
      }
    }

    if (!nodeScript) {
      return { executable, args };
    }

    const bundledNode = join(installDir, 'node.exe');
    const nodeExecutable = (await fileExists(bundledNode)) ? bundledNode : 'node';
    return {
      executable: nodeExecutable,
      args: ['--no-warnings=DEP0040', nodeScript, ...args]
    };
  }

  private createStreamProcessor(context: ProviderRunContext, callbacks: ProviderRunCallbacks) {
    let assistantText = '';
    const seenPlannerSignals = new Set<string>();
    const seenExecutionSessionIds = new Set<string>();
    const toolNamesById = new Map<string, string>();
    const toolMetadataById = new Map<string, Record<string, unknown>>();
    const promptText = normalizeComparableText(context.prompt);
    const seenInfoMessages = new Set<string>();
    let fatalErrorMessage: string | null = null;
    let executionSessionStartedAt: number | null = null;
    let meaningfulProgressObserved = false;

    const markMeaningfulProgress = () => {
      meaningfulProgressObserved = true;
    };

    const captureFatalError = (line: string) => {
      const parsed = toGeminiCliErrorMessage(line, context.modelId);
      if (parsed) {
        fatalErrorMessage = parsed;
        return true;
      }

      return Boolean(fatalErrorMessage && isIgnorableGeminiErrorContinuationLine(line));
    };

    const processLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      if (isIgnorableConptyDiagnosticLine(trimmed)) {
        return;
      }
      if (captureFatalError(trimmed)) {
        return;
      }
      if (!trimmed.startsWith('{')) {
        if (isIgnorableGeminiErrorContinuationLine(trimmed)) {
          return;
        }
        const retryInfoMessage = toGeminiCliRetryInfoMessage(trimmed, context.modelId);
        if (retryInfoMessage) {
          if (!seenInfoMessages.has(retryInfoMessage)) {
            seenInfoMessages.add(retryInfoMessage);
            callbacks.onInfo(retryInfoMessage);
          }
          return;
        }
        if (isGeminiCliBanner(trimmed) || normalizeComparableText(trimmed) === promptText) {
          return;
        }
        if (isLikelyCliDiagnostic(trimmed)) {
          callbacks.onInfo(trimmed);
        }
        return;
      }

      try {
        const event = JSON.parse(trimmed) as {
          type?: string;
          role?: string;
          content?: string;
          delta?: boolean;
          status?: string;
          tool_name?: string;
          tool_id?: string;
          parameters?: unknown;
          output?: unknown;
          error?: unknown;
          command?: string;
          cwd?: string;
          path?: string;
          file_path?: string;
          dir_path?: string;
          query?: string;
          url?: string;
          pattern?: string;
          backgroundPids?: unknown;
        };
        const executionSessionId = extractGeminiExecutionSessionId(event);
        if (executionSessionId && !seenExecutionSessionIds.has(executionSessionId)) {
          seenExecutionSessionIds.add(executionSessionId);
          executionSessionStartedAt = executionSessionStartedAt ?? Date.now();
          callbacks.onInfo({
            session: {
              kind: 'execution',
              providerId: 'gemini',
              sessionId: executionSessionId
            }
          });
        }
        if (event.type === 'message' && event.role === 'assistant' && typeof event.content === 'string') {
          if (event.delta) {
            assistantText += event.content;
            markMeaningfulProgress();
            callbacks.onDelta(event.content);
          } else if (event.content !== assistantText) {
            assistantText = event.content;
            markMeaningfulProgress();
            callbacks.onAssistantSnapshot?.(event.content);
          }
        } else if (event.type === 'tool_use' && typeof event.tool_id === 'string' && typeof event.tool_name === 'string') {
          markMeaningfulProgress();
          toolNamesById.set(event.tool_id, event.tool_name);
          if (isRecord(event.parameters)) {
            toolMetadataById.set(event.tool_id, { ...event.parameters });
          }
        } else if (event.type === 'tool_result' && typeof event.tool_id === 'string') {
          markMeaningfulProgress();
          const toolName = toolNamesById.get(event.tool_id) ?? null;
          const toolMetadata = toolMetadataById.get(event.tool_id) ?? null;
          if (toolName && typeof event.tool_name !== 'string') {
            event.tool_name = toolName;
          }
          if (toolMetadata) {
            for (const [key, value] of Object.entries(toolMetadata)) {
              if (!(key in event)) {
                (event as Record<string, unknown>)[key] = value;
              }
            }
          }
          if (toolName === 'write_todos' && event.status === 'success') {
            const todos = extractGeminiTodoItems(event.output);
            const progress = todos
              ? deriveRunProgressFromProviderTodos(todos, context.runId, context.threadId, 'Gemini tasks')
              : null;
            if (progress) {
              callbacks.onInfo({
                message: 'Gemini updated its task list.',
                progress
              });
            }
          }
          toolMetadataById.delete(event.tool_id);
        } else if (event.type === 'result') {
          markMeaningfulProgress();
          if (event.status === 'success') {
            const resultText = extractGeminiResultText(event);
            if (resultText && resultText !== assistantText) {
              assistantText = resultText;
              callbacks.onAssistantSnapshot?.(resultText);
            }
          } else {
            const resultErrorMessage =
              extractGeminiResultErrorMessage(event.error) ?? `Gemini run ended with status ${event.status ?? 'unknown'}.`;
            fatalErrorMessage = fatalErrorMessage ?? resultErrorMessage;
            callbacks.onError(resultErrorMessage);
          }
        }

        const providerDiagnostics = buildGeminiProviderDiagnostics(event);
        if (providerDiagnostics) {
          callbacks.onInfo({
            providerDiagnostics
          });
        }

        if (context.runMode === 'plan') {
          for (const signal of extractGeminiPlannerSignals(event)) {
            const key =
              signal.kind === 'session'
                ? `session:${signal.sessionId}`
                : `questions:${signal.callId}`;
            if (seenPlannerSignals.has(key)) {
              continue;
            }
            seenPlannerSignals.add(key);

            const plannerPayload: ProviderInfoPayload =
              signal.kind === 'session'
                ? {
                    planner: signal
                  }
                : {
                    message: 'Gemini planner asked a clarifying question.',
                    planner: signal
                  };
            callbacks.onInfo(plannerPayload);
          }
        }

        for (const infoMessage of extractGeminiCliInfoMessages(event)) {
          if (context.runMode === 'plan' && shouldIgnoreGeminiPlannerInfoPayload(infoMessage)) {
            continue;
          }
          if (shouldIgnoreGeminiInfoPayload(infoMessage)) {
            continue;
          }
          callbacks.onInfo(infoMessage);
        }
      } catch {
        if (
          !captureFatalError(trimmed) &&
          !isIgnorableGeminiErrorContinuationLine(trimmed) &&
          !(context.runMode === 'plan' && isIgnorablePlannerToolDiagnostic(trimmed)) &&
          !isIgnorableAskUserDiagnostic(trimmed)
        ) {
          const retryInfoMessage = toGeminiCliRetryInfoMessage(trimmed, context.modelId);
          if (retryInfoMessage) {
            if (!seenInfoMessages.has(retryInfoMessage)) {
              seenInfoMessages.add(retryInfoMessage);
              callbacks.onInfo(retryInfoMessage);
            }
            return;
          }
          callbacks.onInfo(trimmed);
        }
      }
    };

    return {
      processLine,
      getAssistantText: () => assistantText,
      getFatalErrorMessage: () => fatalErrorMessage,
      getExecutionSessionStartedAt: () => executionSessionStartedAt,
      hasMeaningfulProgress: () => meaningfulProgressObserved
    };
  }

  private startHeadlessRun(
    executable: string,
    args: string[],
    context: ProviderRunContext,
    callbacks: ProviderRunCallbacks,
    processor: ReturnType<GeminiAdapter['createStreamProcessor']>,
    isolatedRuntime: Awaited<ReturnType<GeminiAdapter['prepareIsolatedRuntime']>>,
    stagedImageCleanup: () => Promise<void>
  ): ProviderRunHandle {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let cancelled = false;
    let settled = false;
    let retryCount = 0;
    let activeChild: ReturnType<typeof spawn> | null = null;
    let activeStallWatcher: NodeJS.Timeout | null = null;
    const cleanupRunResources = () => Promise.all([isolatedRuntime.cleanup(), stagedImageCleanup()]);
    const runTimeout = setTimeout(() => {
      if (settled || cancelled || !activeChild) {
        return;
      }
      cancelled = true;
      void killProcessTree(activeChild);
      settleError("Gemini did not finish before Vicode's run timeout elapsed. Vicode ended the run to avoid leaving the thread stuck indefinitely.");
    }, this.headlessRunTimeoutMs);

    const stopStallWatcher = () => {
      if (activeStallWatcher) {
        clearInterval(activeStallWatcher);
        activeStallWatcher = null;
      }
    };
    const clearRunTimeout = () => {
      clearTimeout(runTimeout);
    };

    const settleError = (message: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearRunTimeout();
      stopStallWatcher();
      void cleanupRunResources();
      callbacks.onError(message);
    };

    const settleComplete = (output: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearRunTimeout();
      stopStallWatcher();
      void cleanupRunResources();
      callbacks.onComplete(output);
    };

    const settleAbort = (message?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearRunTimeout();
      stopStallWatcher();
      void cleanupRunResources();
      callbacks.onAbort(message);
    };

    const createChild = () =>
      executable.endsWith('.cmd')
        ? spawn(getWindowsCmdExecutable(), ['/d', '/s', '/c', executable, ...args], {
            cwd: context.folderPath ?? process.cwd(),
            windowsHide: true,
            env: {
              ...process.env,
              ...isolatedRuntime.env,
              ...(context.apiKey ? { GEMINI_API_KEY: context.apiKey } : {})
            }
          })
        : spawn(executable, args, {
            cwd: context.folderPath ?? process.cwd(),
            windowsHide: true,
            env: {
              ...process.env,
              ...isolatedRuntime.env,
              ...(context.apiKey ? { GEMINI_API_KEY: context.apiKey } : {})
            }
          });

    const startAttempt = () => {
      const child = createChild();
      activeChild = child;
      stdoutBuffer = '';
      stderrBuffer = '';
      stopStallWatcher();
      activeStallWatcher = setInterval(() => {
        if (cancelled || settled || activeChild !== child) {
          return;
        }
        const sessionStartedAt = processor.getExecutionSessionStartedAt();
        if (!sessionStartedAt || processor.hasMeaningfulProgress()) {
          return;
        }
        if (Date.now() - sessionStartedAt < GEMINI_POST_INIT_STALL_TIMEOUT_MS) {
          return;
        }
        settled = true;
        cancelled = true;
        void killProcessTree(child);
        void cleanupRunResources();
        callbacks.onError('Gemini CLI started a session but produced no useful progress before timing out.');
      }, 1_000);

      child.stdout.on('data', (chunk) => {
        stdoutBuffer += String(chunk);
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          processor.processLine(line);
        }
      });

      child.stderr.on('data', (chunk) => {
        stderrBuffer += String(chunk);
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (
            !trimmed ||
            isIgnorableConptyDiagnosticLine(trimmed) ||
            isGeminiCliBanner(trimmed) ||
            normalizeComparableText(trimmed) === normalizeComparableText(context.prompt)
          ) {
            continue;
          }
          const detectedFatalError = processor.getFatalErrorMessage() || toGeminiCliErrorMessage(trimmed, context.modelId);
          if (detectedFatalError) {
            processor.processLine(trimmed);
            const fatalErrorMessage = processor.getFatalErrorMessage() ?? detectedFatalError;
            if (fatalErrorMessage && !settled) {
              settled = true;
              cancelled = true;
              void killProcessTree(child);
              void cleanupRunResources();
              callbacks.onError(fatalErrorMessage);
            }
            continue;
          }
          if (trimmed && !isIgnorableAskUserDiagnostic(trimmed)) {
            callbacks.onInfo(trimmed);
          }
        }
      });

      child.on('error', () => {
        stopStallWatcher();
        if (!cancelled) {
          settleError('Failed to launch Gemini CLI.');
        }
      });

      child.on('close', (code) => {
        stopStallWatcher();
        if (cancelled || activeChild !== child) {
          return;
        }
        if (stdoutBuffer.trim()) {
          processor.processLine(stdoutBuffer);
        }
        if (stderrBuffer.trim()) {
          processor.processLine(stderrBuffer);
        }
        const fatalErrorMessage = processor.getFatalErrorMessage();
        if (fatalErrorMessage && !processor.getAssistantText()) {
          settleError(fatalErrorMessage);
          return;
        }
        const assistantText = processor.getAssistantText().trim();
        if (code === 0) {
          if (assistantText || context.runMode === 'plan') {
            settleComplete(assistantText);
            return;
          }
          if (retryCount === 0) {
            retryCount += 1;
            callbacks.onInfo('Gemini finished without a reply. Retrying once.');
            startAttempt();
            return;
          }
          settleError('Gemini CLI exited successfully without producing assistant output.');
          return;
        }
        if (!assistantText && stderrBuffer.trim()) {
          settleError(stderrBuffer.trim());
          return;
        }
        if (assistantText) {
          settleError(`Gemini CLI exited with code ${code ?? -1} after producing partial output.`);
          return;
        }
        settleError(`Gemini CLI exited with code ${code ?? -1}.`);
      });

      return child;
    };

    const child = startAttempt();

    return {
      runId: context.runId,
      child,
      cancel: async (reason) => {
        cancelled = true;
        clearRunTimeout();
        stopStallWatcher();
        if (activeChild) {
          await killProcessTree(activeChild);
        }
        await cleanupRunResources();
        settleAbort(reason ?? 'Gemini run was stopped.');
      }
    };
  }

  private async startInteractiveApprovalRun(
    executable: string,
    args: string[],
    context: ProviderRunContext,
    callbacks: ProviderRunCallbacks,
    processor: ReturnType<GeminiAdapter['createStreamProcessor']>
  ): Promise<ProviderRunHandle> {
    callbacks.onInfo('Gemini approvals open in a native terminal window while the run is active.');

    const outputRoot = await mkdtemp(join(tmpdir(), 'vicode-gemini-'));
    const transcriptPath = join(outputRoot, `${context.runId}.log`);
    const command = [
      `$host.UI.RawUI.WindowTitle = ${quotePowerShellArg(`Vicode Gemini Approvals · ${context.modelId}`)}`,
      '$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      context.folderPath ? `Set-Location -LiteralPath ${quotePowerShellArg(context.folderPath)}` : null,
      context.apiKey ? `$env:GEMINI_API_KEY = ${quotePowerShellArg(context.apiKey)}` : null,
      `& ${quotePowerShellArg(executable)} ${args.map(quotePowerShellArg).join(' ')} 2>&1 | Tee-Object -FilePath ${quotePowerShellArg(transcriptPath)}`,
      'exit $LASTEXITCODE'
    ]
      .filter((part): part is string => Boolean(part))
      .join('; ');

    const child = spawn('powershell.exe', ['-NoLogo', '-Command', command], {
      shell: false,
      windowsHide: false,
      stdio: 'ignore'
    });

    let transcriptLength = 0;
    let transcriptBuffer = '';
    let cancelled = false;
    const flushTranscript = async () => {
      try {
        const nextContent = await readFile(transcriptPath, 'utf8');
        if (nextContent.length <= transcriptLength) {
          return;
        }
        transcriptBuffer += nextContent.slice(transcriptLength);
        transcriptLength = nextContent.length;
        const lines = transcriptBuffer.split(/\r?\n/);
        transcriptBuffer = lines.pop() ?? '';
        for (const line of lines) {
          processor.processLine(line);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          callbacks.onInfo('Vicode could not read Gemini terminal output in real time.');
        }
      }
    };
    const poller = setInterval(() => {
      void flushTranscript();
    }, 150);
    const cleanup = async () => {
      clearInterval(poller);
      await rm(outputRoot, { recursive: true, force: true }).catch(() => undefined);
    };

    child.on('error', () => {
      void cleanup();
      if (!cancelled) {
        callbacks.onError('Failed to launch Gemini approval window.');
      }
    });

    child.on('close', (code) => {
      void (async () => {
        await flushTranscript();
        if (transcriptBuffer.trim()) {
          processor.processLine(transcriptBuffer);
        }
        await cleanup();
        const assistantText = processor.getAssistantText().trim();
        if (cancelled) {
          return;
        }
        if (code === 0) {
          if (assistantText || context.runMode === 'plan') {
            callbacks.onComplete(assistantText);
            return;
          }
          callbacks.onError('Gemini CLI exited successfully without producing assistant output.');
          return;
        }
        if (assistantText) {
          callbacks.onError(`Gemini CLI exited with code ${code ?? -1} after producing partial output.`);
          return;
        }
        callbacks.onError(`Gemini CLI exited with code ${code ?? -1}.`);
      })().catch(() => {
        if (!cancelled) {
          callbacks.onError('Gemini run ended before Vicode could finish reading its output.');
        }
      });
    });

    return {
      runId: context.runId,
      cancel: async (reason) => {
        cancelled = true;
        await killProcessTree(child);
        callbacks.onAbort(reason ?? 'Gemini approval run was stopped.');
      }
    };
  }

}
