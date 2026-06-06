import type { AgentRuntime, AgentRuntimeToolCatalog, AgentToolCall } from '../agent-runtime';
import {
  cleanFinalAssistantDisplayText,
  normalizeAssistantVisibleDisplayText
} from '../../shared/assistant-text/final-display-cleanup';
import type { AssistantStreamAppendResult } from '../../shared/assistant-text/stream-assembler';
import type { ProviderDiagnosticsPayload, ProviderModelToolDefinition, ProviderRunContext } from '../types';
import {
  assembleProviderModelContext,
  buildInitialWebResearchFastPathDirective as buildProviderInitialWebResearchFastPathDirective,
  buildProviderModelAgentPrompt,
  buildProviderModelPlainChatSystemPrompt,
  buildProviderModelPlannerSystemPrompt,
  buildProviderModelToolDefinitions,
  focusProviderModelToolCatalogForWebResearch,
  providerPromptRequiresNativeWebResearch,
  providerPromptRequiresWorkspaceMutation,
  shouldUseFocusedProviderModelWebResearchLane
} from '../../main/services/provider-model-context-assembler';
export { promptIsCasualConversation } from '../../main/services/provider-model-prompt-routing';
export {
  assistantSignalsPendingWorkspaceMutation,
  buildRequiredMutationReminder,
  buildRequiredWebResearchReminder
} from '../../main/services/provider-model-harness-policy';

const OLLAMA_VISIBLE_TEXT_NORMALIZATION_OPTIONS = {
  stripXmlFunctionCallMarkup: true,
  stripReasoningLabels: true
} as const;

const OLLAMA_BOUNDARY_START_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'but',
  'for',
  'from',
  'how',
  'if',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'well',
  'what',
  'when',
  'where',
  'with',
  'you',
  'your'
]);

const OLLAMA_BOUNDARY_END_WORDS = new Set([
  'are',
  'doing',
  'is',
  'it',
  'thanks',
  'was',
  'were'
]);

interface OllamaResponsesToolCall extends AgentToolCall {
  callId: string;
}

interface ExtractToolCallsOptions {
  toolDefinitions?: ProviderModelToolDefinition[] | null;
  jsonAliasNormalization?: boolean;
}

export type OllamaToolCallContentDecision =
  | {
      status: 'accepted';
      toolCalls: AgentToolCall[];
      source:
        | 'structured'
        | 'xml'
        | 'exact_json'
        | 'alias_normalized_json'
        | 'strict_fenced_json'
        | 'strict_unlabeled_fence';
      sanitizedContent: string;
    }
  | {
      status: 'recoverable_contract_violation';
      toolCalls: [];
      reason:
        | 'surrounding_prose'
        | 'final_answer_outside_envelope'
        | 'unlabeled_fence_with_surrounding_prose'
        | 'candidate_requires_reemit';
      candidateToolName: string | null;
      sanitizedContent: string;
    }
  | {
      status: 'rejected';
      toolCalls: [];
      reason:
        | 'no_candidate'
        | 'malformed_json'
        | 'multiple_candidates'
        | 'inactive_tool'
        | 'missing_required_arguments';
      sanitizedContent: string;
    };

type ToolCallValidationFailure = 'inactive_tool' | 'missing_required_arguments';

type JsonToolCallParseResult =
  | {
      status: 'parsed';
      toolCalls: AgentToolCall[];
      source: 'exact_json' | 'alias_normalized_json';
    }
  | {
      status: 'malformed_json' | 'no_candidate';
      toolCalls: [];
    };

interface NormalizedJsonToolCall {
  toolCall: AgentToolCall;
  usedAlias: boolean;
}

interface FencedToolCallCandidate {
  label: string;
  body: string;
  start: number;
  end: number;
}

export function buildToolDefinitions(toolCatalog: AgentRuntimeToolCatalog) {
  return buildProviderModelToolDefinitions(toolCatalog);
}

export async function prepareOllamaToolLoopRun(agentRuntime: AgentRuntime, context: ProviderRunContext) {
  return assembleProviderModelContext(agentRuntime, context);
}

export function focusToolCatalogForWebResearch(toolCatalog: AgentRuntimeToolCatalog): AgentRuntimeToolCatalog {
  return focusProviderModelToolCatalogForWebResearch(toolCatalog);
}

export function appendOllamaVisibleText(current: string, rawChunk: string) {
  const cleanedChunk = cleanFinalAssistantDisplayText(rawChunk, {
    ...OLLAMA_VISIBLE_TEXT_NORMALIZATION_OPTIONS,
    preserveOuterWhitespace: true
  });
  let normalizedChunk = normalizeAssistantVisibleDisplayText(cleanedChunk, {
    ...OLLAMA_VISIBLE_TEXT_NORMALIZATION_OPTIONS,
    preserveLeadingBreaks: true
  });
  if (!current) {
    normalizedChunk = normalizedChunk.replace(/^\s*\n+/u, '').trimStart();
  }
  const boundary = shouldInsertOllamaBoundarySpace(current, normalizedChunk) ? ' ' : '';
  return {
    text: current + boundary + normalizedChunk,
    delta: boundary + normalizedChunk,
    normalizedChunk,
    replace: false
  } satisfies AssistantStreamAppendResult;
}

function shouldInsertOllamaBoundarySpace(current: string, chunk: string) {
  if (!current || !chunk || /\s$/u.test(current) || /^\s/u.test(chunk)) {
    return false;
  }
  if (/^[,.;:!?)}\]]/u.test(chunk) || /[(\[{]$/u.test(current)) {
    return false;
  }
  if (/[.!?,;:]$/u.test(current) && /^[A-Za-z0-9"“'([]/u.test(chunk)) {
    return true;
  }
  if (!/[A-Za-z0-9]$/u.test(current) || !/^[A-Za-z0-9]/u.test(chunk)) {
    return false;
  }

  const lastWord = current.match(/([A-Za-z]+)[^A-Za-z]*$/u)?.[1]?.toLowerCase() ?? '';
  const firstWord = chunk.match(/^[^A-Za-z]*([A-Za-z]+)/u)?.[1]?.toLowerCase() ?? '';
  return OLLAMA_BOUNDARY_START_WORDS.has(firstWord) || OLLAMA_BOUNDARY_END_WORDS.has(lastWord);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function buildAgentPrompt(
  prompt: string,
  workspaceRoot: string,
  runMode: ProviderRunContext['runMode'],
  executionPermission: ProviderRunContext['executionPermission'],
  runtimeCommandPolicy: ProviderRunContext['runtimeCommandPolicy'],
  runtimeNetworkPolicy: ProviderRunContext['runtimeNetworkPolicy'],
  toolCatalog: AgentRuntimeToolCatalog,
  runtimeSkillResources: ProviderRunContext['runtimeSkillResources'],
  options?: {
    webResearchFastPath?: boolean;
  }
) {
  return buildProviderModelAgentPrompt(
    prompt,
    workspaceRoot,
    runMode,
    executionPermission,
    runtimeCommandPolicy,
    runtimeNetworkPolicy,
    toolCatalog,
    runtimeSkillResources,
    options
  );
}

export function buildPlainChatSystemPrompt() {
  return buildProviderModelPlainChatSystemPrompt();
}

export function buildPlannerSystemPrompt() {
  return buildProviderModelPlannerSystemPrompt();
}

export function buildPlannerModePrompt(prompt: string) {
  return [
    'Draft a Vicode implementation plan for the request below.',
    'Return markdown only using exactly this structure:',
    '# <Short specific plan title>',
    '## Summary',
    '- <1-3 bullets that restate the bounded goal>',
    '## Key Changes',
    '- <specific files, subsystems, or bounded slices>',
    '## Test Plan',
    '- <focused verification steps>',
    '## Assumptions',
    '- <only if needed>',
    'Keep the title specific to the request. Avoid generic titles like "Maintenance Plan" or "Implementation Plan".',
    'If the request is docs-only, keep the plan docs-only. If it is bounded, keep it bounded.',
    '',
    prompt
  ].join('\n');
}

function decodeXmlText(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function stripXmlFunctionCallMarkup(content: string) {
  return content.replace(/<function_calls>[\s\S]*?<\/function_calls>/giu, '').trim();
}

export function containsXmlFunctionCallMarkup(content: string) {
  return /<function_calls>|<invoke\s+name=|<parameter\s+name=|<parametername=/iu.test(content);
}

export function buildOllamaProviderDiagnostics(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>
): ProviderDiagnosticsPayload | null {
  if (toolCalls.length === 0) {
    return null;
  }

  const paths = toolCalls
    .flatMap((toolCall) => {
      const values = toolCall.arguments;
      return [
        typeof values.path === 'string' ? values.path : null,
        typeof values.cwd === 'string' ? values.cwd : null
      ];
    })
    .filter((value): value is string => Boolean(value));

  return {
    kind: 'provider_event_classification',
    source: 'ollama_chat_json',
    providerEventType: 'message/tool_calls',
    itemType: toolCalls.length === 1 ? toolCalls[0]?.name ?? null : 'tool_batch',
    itemKeys: [...new Set(toolCalls.flatMap((toolCall) => Object.keys(toolCall.arguments)))],
    paths,
    decision: null,
    status: 'started',
    taskLike: false,
    classification: 'evidence_candidate_unparsed'
  };
}

function parseXmlParameterValue(attributes: string, rawValue: string) {
  const value = decodeXmlText(rawValue.trim());
  if (!value) {
    return undefined;
  }

  if (/\bboolean\s*=\s*"true"/iu.test(attributes)) {
    if (/^true$/iu.test(value)) {
      return true;
    }
    if (/^false$/iu.test(value)) {
      return false;
    }
  }

  if (/\b(?:number|integer|float)\s*=\s*"true"/iu.test(attributes)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return value;
}

function extractXmlToolCalls(content: string): AgentToolCall[] {
  if (!content || !/<function_calls>/iu.test(content)) {
    return [];
  }

  const calls: AgentToolCall[] = [];
  const invokePattern = /<invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/invoke>/giu;
  let invokeMatch: RegExpExecArray | null;
  while ((invokeMatch = invokePattern.exec(content)) !== null) {
    const name = decodeXmlText(invokeMatch[1]?.trim() ?? '');
    if (!name) {
      continue;
    }

    const args: Record<string, unknown> = {};
    const parameterPattern = /<parameter\s+([^>]*?)name="([^"]+)"([^>]*)>([\s\S]*?)<\/parameter>/giu;
    let parameterMatch: RegExpExecArray | null;
    while ((parameterMatch = parameterPattern.exec(invokeMatch[2] ?? '')) !== null) {
      const paramName = decodeXmlText(parameterMatch[2]?.trim() ?? '');
      if (!paramName) {
        continue;
      }
      const parsedValue = parseXmlParameterValue(`${parameterMatch[1] ?? ''} ${parameterMatch[3] ?? ''}`, parameterMatch[4] ?? '');
      if (parsedValue !== undefined) {
        args[paramName] = parsedValue;
      }
    }

    calls.push({
      name,
      arguments: args
    });
  }

  return calls;
}

function parseToolCallArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  return {};
}

function readFirstPresentValue(
  value: Record<string, unknown>,
  keys: string[],
  allowAliases: boolean
): { value: unknown; usedAlias: boolean } {
  const [canonicalKey, ...aliasKeys] = keys;
  if (canonicalKey && Object.hasOwn(value, canonicalKey)) {
    return {
      value: value[canonicalKey],
      usedAlias: false
    };
  }

  if (!allowAliases) {
    return {
      value: undefined,
      usedAlias: false
    };
  }

  for (const key of aliasKeys) {
    if (Object.hasOwn(value, key)) {
      return {
        value: value[key],
        usedAlias: true
      };
    }
  }

  return {
    value: undefined,
    usedAlias: false
  };
}

function normalizeJsonToolCall(value: unknown, options?: ExtractToolCallsOptions): NormalizedJsonToolCall | null {
  if (!isRecord(value)) {
    return null;
  }

  const allowAliases = options?.jsonAliasNormalization === true;
  const topLevelName = readFirstPresentValue(value, ['name', 'tool'], allowAliases);
  if (typeof topLevelName.value === 'string' && topLevelName.value.trim()) {
    const args = readFirstPresentValue(value, ['arguments', 'args', 'parameters'], allowAliases);
    return {
      toolCall: {
        name: topLevelName.value.trim(),
        arguments: parseToolCallArguments(args.value)
      },
      usedAlias: topLevelName.usedAlias || args.usedAlias
    };
  }

  if (isRecord(value.function) && typeof value.function.name === 'string' && value.function.name.trim()) {
    const args = readFirstPresentValue(value.function, ['arguments', 'args', 'parameters'], allowAliases);
    return {
      toolCall: {
        name: value.function.name.trim(),
        arguments: parseToolCallArguments(args.value)
      },
      usedAlias: args.usedAlias
    };
  }

  return null;
}

function parseJsonToolCallsWithStatus(content: string, options?: ExtractToolCallsOptions): JsonToolCallParseResult {
  const trimmed = content.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return {
      status: 'no_candidate',
      toolCalls: []
    };
  }

  try {
    const parsed = JSON.parse(trimmed);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    const normalized = values
      .map((value) => normalizeJsonToolCall(value, options))
      .filter((value): value is NormalizedJsonToolCall => Boolean(value));
    return normalized.length > 0
      ? {
          status: 'parsed',
          toolCalls: normalized.map((value) => value.toolCall),
          source: normalized.some((value) => value.usedAlias) ? 'alias_normalized_json' : 'exact_json'
        }
      : {
          status: 'no_candidate',
          toolCalls: []
        };
  } catch {
    return {
      status: 'malformed_json',
      toolCalls: []
    };
  }
}

function getToolDefinition(
  name: string,
  options?: ExtractToolCallsOptions
): ProviderModelToolDefinition | null {
  const definitions = options?.toolDefinitions?.length ? options.toolDefinitions : null;
  if (!definitions) {
    return null;
  }

  return definitions.find((definition) => definition.function.name === name) ?? null;
}

function schemaTypeIncludes(type: unknown, expected: string) {
  if (typeof type === 'string') {
    return type === expected;
  }
  if (Array.isArray(type)) {
    return type.includes(expected);
  }
  return false;
}

function requiredPropertyIsValid(schema: unknown, value: unknown) {
  if (!isRecord(schema) || schema.type === undefined) {
    return true;
  }

  if (schemaTypeIncludes(schema.type, 'string')) {
    return typeof value === 'string';
  }
  if (schemaTypeIncludes(schema.type, 'number') || schemaTypeIncludes(schema.type, 'integer')) {
    return typeof value === 'number' && Number.isFinite(value);
  }
  if (schemaTypeIncludes(schema.type, 'boolean')) {
    return typeof value === 'boolean';
  }
  if (schemaTypeIncludes(schema.type, 'array')) {
    return Array.isArray(value);
  }
  if (schemaTypeIncludes(schema.type, 'object')) {
    return isRecord(value);
  }

  return true;
}

function getToolCallValidationFailure(
  toolCall: AgentToolCall,
  options?: ExtractToolCallsOptions
): ToolCallValidationFailure | null {
  const definitions = options?.toolDefinitions?.length ? options.toolDefinitions : null;
  if (!definitions) {
    return null;
  }

  const definition = getToolDefinition(toolCall.name, options);
  if (!definition) {
    return 'inactive_tool';
  }

  const parameters = definition.function.parameters;
  if (!isRecord(parameters)) {
    return null;
  }

  const required = Array.isArray(parameters.required)
    ? parameters.required.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const properties = isRecord(parameters.properties) ? parameters.properties : {};
  for (const key of required) {
    if (!Object.hasOwn(toolCall.arguments, key)) {
      return 'missing_required_arguments';
    }
    if (!requiredPropertyIsValid(properties[key], toolCall.arguments[key])) {
      return 'missing_required_arguments';
    }
  }

  return null;
}

function toolCallMatchesDefinition(toolCall: AgentToolCall, options?: ExtractToolCallsOptions) {
  return getToolCallValidationFailure(toolCall, options) === null;
}

function filterToolCallsForActiveDefinitions(
  toolCalls: AgentToolCall[],
  options?: ExtractToolCallsOptions
) {
  return toolCalls.filter((toolCall) => toolCallMatchesDefinition(toolCall, options));
}

function parseJsonToolCalls(content: string, options?: ExtractToolCallsOptions): AgentToolCall[] {
  const result = parseJsonToolCallsWithStatus(content, options);
  return result.status === 'parsed' ? result.toolCalls : [];
}

function extractJsonToolCalls(content: string, options?: ExtractToolCallsOptions): AgentToolCall[] {
  return filterToolCallsForActiveDefinitions(parseJsonToolCalls(content, options), options);
}

function normalizeStructuredToolCalls(message: Record<string, unknown>): AgentToolCall[] {
  return Array.isArray(message.tool_calls)
    ? message.tool_calls
        .map((entry) => {
          if (!isRecord(entry) || !isRecord(entry.function) || typeof entry.function.name !== 'string' || !entry.function.name.trim()) {
            return null;
          }

          let args: Record<string, unknown> = {};
          if (isRecord(entry.function.arguments)) {
            args = entry.function.arguments;
          } else if (typeof entry.function.arguments === 'string') {
            try {
              const parsed = JSON.parse(entry.function.arguments);
              args = isRecord(parsed) ? parsed : {};
            } catch {
              args = {};
            }
          }
          return {
            name: entry.function.name.trim(),
            arguments: args
          } satisfies AgentToolCall;
        })
        .filter((value): value is AgentToolCall => Boolean(value))
    : [];
}

function acceptedToolCallDecision(
  source: Extract<OllamaToolCallContentDecision, { status: 'accepted' }>['source'],
  toolCalls: AgentToolCall[],
  sanitizedContent = ''
): OllamaToolCallContentDecision {
  return {
    status: 'accepted',
    source,
    sanitizedContent,
    toolCalls
  };
}

function rejectedToolCallDecision(
  reason: Extract<OllamaToolCallContentDecision, { status: 'rejected' }>['reason'],
  sanitizedContent: string
): OllamaToolCallContentDecision {
  return {
    status: 'rejected',
    reason,
    sanitizedContent,
    toolCalls: []
  };
}

function recoverableToolCallDecision(
  reason: Extract<OllamaToolCallContentDecision, { status: 'recoverable_contract_violation' }>['reason'],
  candidateToolName: string | null,
  sanitizedContent: string
): OllamaToolCallContentDecision {
  return {
    status: 'recoverable_contract_violation',
    reason,
    candidateToolName,
    sanitizedContent,
    toolCalls: []
  };
}

function validateToolCallCandidates(
  toolCalls: AgentToolCall[],
  options?: ExtractToolCallsOptions
):
  | {
      status: 'accepted';
      toolCalls: AgentToolCall[];
    }
  | {
      status: 'rejected';
      reason: ToolCallValidationFailure | 'no_candidate';
      candidateToolName: string | null;
    } {
  if (toolCalls.length === 0) {
    return {
      status: 'rejected',
      reason: 'no_candidate',
      candidateToolName: null
    };
  }

  for (const toolCall of toolCalls) {
    const failure = getToolCallValidationFailure(toolCall, options);
    if (failure) {
      return {
        status: 'rejected',
        reason: failure,
        candidateToolName: toolCall.name || null
      };
    }
  }

  return {
    status: 'accepted',
    toolCalls
  };
}

function classifyParsedToolCalls(
  parseResult: JsonToolCallParseResult,
  sanitizedContent: string,
  options?: ExtractToolCallsOptions
): OllamaToolCallContentDecision {
  if (parseResult.status !== 'parsed') {
    return rejectedToolCallDecision(parseResult.status, sanitizedContent);
  }

  const validated = validateToolCallCandidates(parseResult.toolCalls, options);
  return validated.status === 'accepted'
    ? acceptedToolCallDecision(parseResult.source, validated.toolCalls)
    : rejectedToolCallDecision(validated.reason, sanitizedContent);
}

function findFencedToolCallCandidates(content: string): FencedToolCallCandidate[] {
  const candidates: FencedToolCallCandidate[] = [];
  const fencePattern = /```([^\r\n`]*)[ \t]*\r?\n([\s\S]*?)\r?\n```/gu;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(content)) !== null) {
    const label = (match[1] ?? '').trim().toLowerCase();
    if (label && label !== 'json') {
      continue;
    }
    candidates.push({
      label,
      body: match[2] ?? '',
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return candidates;
}

function classifyFencedToolCallContent(
  content: string,
  options?: ExtractToolCallsOptions
): OllamaToolCallContentDecision | null {
  const candidates = findFencedToolCallCandidates(content);
  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length > 1) {
    return rejectedToolCallDecision('multiple_candidates', content);
  }

  const candidate = candidates[0];
  if (!candidate) {
    return null;
  }

  const parseResult = parseJsonToolCallsWithStatus(candidate.body, options);
  if (parseResult.status !== 'parsed') {
    return rejectedToolCallDecision(parseResult.status, content);
  }

  const validated = validateToolCallCandidates(parseResult.toolCalls, options);
  if (validated.status === 'rejected') {
    return rejectedToolCallDecision(validated.reason, content);
  }

  const before = content.slice(0, candidate.start).trim();
  const after = content.slice(candidate.end).trim();
  if (!before && !after) {
    return acceptedToolCallDecision(
      parseResult.source === 'alias_normalized_json'
        ? 'alias_normalized_json'
        : candidate.label === '' ? 'strict_unlabeled_fence' : 'strict_fenced_json',
      validated.toolCalls
    );
  }

  const candidateToolName = validated.toolCalls.length === 1 ? validated.toolCalls[0]?.name ?? null : null;
  if (candidate.label === '') {
    return recoverableToolCallDecision('unlabeled_fence_with_surrounding_prose', candidateToolName, content);
  }
  if (!before && after) {
    return recoverableToolCallDecision('final_answer_outside_envelope', candidateToolName, content);
  }
  return recoverableToolCallDecision('surrounding_prose', candidateToolName, content);
}

function classifyContentToolCalls(content: string, options?: ExtractToolCallsOptions): OllamaToolCallContentDecision {
  if (containsXmlFunctionCallMarkup(content)) {
    const xmlToolCalls = extractXmlToolCalls(content);
    const validated = validateToolCallCandidates(xmlToolCalls, options);
    return validated.status === 'accepted'
      ? acceptedToolCallDecision('xml', validated.toolCalls, stripXmlFunctionCallMarkup(content))
      : rejectedToolCallDecision(validated.reason, content);
  }

  if (content.startsWith('{') || content.startsWith('[')) {
    return classifyParsedToolCalls(parseJsonToolCallsWithStatus(content, options), content, options);
  }

  const fencedDecision = classifyFencedToolCallContent(content, options);
  if (fencedDecision) {
    return fencedDecision;
  }

  return rejectedToolCallDecision('no_candidate', content);
}

export function classifyOllamaToolCallContent(
  message: unknown,
  options?: ExtractToolCallsOptions
): OllamaToolCallContentDecision {
  if (!isRecord(message)) {
    return rejectedToolCallDecision('no_candidate', '');
  }

  const content = typeof message.content === 'string' ? message.content.trim() : '';
  const structuredCalls = normalizeStructuredToolCalls(message);
  if (structuredCalls.length > 0) {
    const validated = validateToolCallCandidates(structuredCalls, options);
    if (validated.status === 'rejected') {
      return rejectedToolCallDecision(validated.reason, content);
    }

    const compatibleContentCalls = content
      ? [
          ...filterToolCallsForActiveDefinitions(extractXmlToolCalls(content), options),
          ...extractJsonToolCalls(content, options)
        ]
      : [];
    return acceptedToolCallDecision('structured', [...validated.toolCalls, ...compatibleContentCalls]);
  }

  if (!content) {
    return rejectedToolCallDecision('no_candidate', '');
  }

  return classifyContentToolCalls(content, options);
}

export function stripOllamaToolCallMarkup(content: string) {
  const withoutXml = stripXmlFunctionCallMarkup(content);
  if (!withoutXml.trim()) {
    return withoutXml;
  }

  const decision = classifyOllamaToolCallContent({ content: withoutXml });
  return decision.status === 'accepted' ? decision.sanitizedContent : withoutXml;
}

export function extractToolCalls(message: unknown, options?: ExtractToolCallsOptions): AgentToolCall[] {
  const decision = classifyOllamaToolCallContent(message, options);
  return decision.status === 'accepted' ? decision.toolCalls : [];
}

export function extractResponsesText(payload: unknown) {
  if (!isRecord(payload)) {
    return '';
  }

  const chunks: string[] = [];
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    chunks.push(payload.output_text);
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const entry of output) {
    if (!isRecord(entry)) {
      continue;
    }

    if (typeof entry.content === 'string' && entry.content.trim()) {
      chunks.push(entry.content);
    }

    const contentParts = Array.isArray(entry.content) ? entry.content : [];
    for (const part of contentParts) {
      if (!isRecord(part)) {
        continue;
      }

      if (typeof part.text === 'string' && part.text.trim()) {
        chunks.push(part.text);
        continue;
      }

      if (typeof part.output_text === 'string' && part.output_text.trim()) {
        chunks.push(part.output_text);
      }
    }
  }

  return chunks
    .map((chunk) =>
      appendOllamaVisibleText('', chunk).normalizedChunk
    )
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function extractResponsesToolCalls(payload: unknown): OllamaResponsesToolCall[] {
  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    return [];
  }

  const toolCalls: OllamaResponsesToolCall[] = [];
  for (const entry of payload.output) {
    if (!isRecord(entry) || entry.type !== 'function_call' || typeof entry.name !== 'string' || !entry.name.trim()) {
      continue;
    }

    let argumentsRecord: Record<string, unknown> = {};
    if (isRecord(entry.arguments)) {
      argumentsRecord = entry.arguments;
    } else if (typeof entry.arguments === 'string') {
      try {
        const parsed = JSON.parse(entry.arguments);
        argumentsRecord = isRecord(parsed) ? parsed : {};
      } catch {
        argumentsRecord = {};
      }
    }

    const callId =
      typeof entry.call_id === 'string' && entry.call_id.trim()
        ? entry.call_id.trim()
        : `call_${toolCalls.length + 1}`;

    toolCalls.push({
      name: entry.name.trim(),
      arguments: argumentsRecord,
      callId
    });
  }

  return toolCalls;
}

export function promptRequiresNativeWebResearch(prompt: string) {
  return providerPromptRequiresNativeWebResearch(prompt);
}

export function promptRequiresWorkspaceMutation(prompt: string) {
  return providerPromptRequiresWorkspaceMutation(prompt);
}

export function buildInitialWebResearchFastPathDirective() {
  return buildProviderInitialWebResearchFastPathDirective();
}

export function shouldUseFocusedWebResearchLane(
  toolCatalog: AgentRuntimeToolCatalog,
  prompt: string,
  runMode: ProviderRunContext['runMode']
) {
  return shouldUseFocusedProviderModelWebResearchLane(toolCatalog, prompt, runMode);
}
