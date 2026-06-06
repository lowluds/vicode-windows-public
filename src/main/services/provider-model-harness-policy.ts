import type { AgentToolCall } from '../../providers/agent-runtime';
import {
  buildAgentRuntimeToolCallSignature,
  buildAgentRuntimeToolResultSignature,
  formatAgentRuntimeToolLabel,
  formatAgentRuntimeToolResultForModel,
  isMutatingAgentRuntimeToolCall,
  isUntrustedAgentRuntimeToolResult
} from '../../providers/agent-runtime-tool-helpers';
import type { AssistantTextNormalizationOptions } from '../../shared/assistant-text-normalization';
import { appendAssistantStreamChunk } from '../../shared/assistant-text/stream-assembler';
import type { ProviderRunContext } from '../../providers/types';
import type { ProviderModelHarnessLimits, ProviderModelHarnessPolicy } from './provider-model-harness-runner';

export const DEFAULT_PROVIDER_MODEL_RESPONSE_TIMEOUT_MS = 1000 * 60 * 5;

export const DEFAULT_PROVIDER_MODEL_HARNESS_LIMITS: ProviderModelHarnessLimits = {
  maxTurns: 96,
  maxRuntimeMs: 1000 * 60 * 30,
  maxStalledToolTurns: 6,
  maxRequiredWebResearchReminders: 2,
  maxRequiredMutationReminders: 2
};

export function assistantSignalsPendingWorkspaceMutation(text: string) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return [
    /\blet me\b.{0,60}\b(?:fix|change|update|edit|modify|rewrite|replace|refactor|build|implement|add|remove)\b/u,
    /\bi(?:'ll| will)\b.{0,60}\b(?:fix|change|update|edit|modify|rewrite|replace|refactor|build|implement|add|remove)\b/u,
    /\bgoing to\b.{0,60}\b(?:fix|change|update|edit|modify|rewrite|replace|refactor|build|implement|add|remove)\b/u
  ].some((pattern) => pattern.test(normalized));
}

export function buildRequiredWebResearchReminder() {
  return [
    'Internal runtime reminder:',
    'The user explicitly asked for online research and native web research tools are available in this run.',
    'Before answering, you must call research_topic or web_search.',
    'Do not answer from memory and do not claim that you cannot browse or search online.'
  ].join('\n');
}

export function buildRequiredMutationReminder(
  reminderCount = 0,
  runMode: ProviderRunContext['runMode'] = 'default'
) {
  if (runMode === 'plan') {
    const lines = [
      'Internal runtime reminder:',
      'This is a planning lane, not an implementation lane.',
      'Do not stop at inspection or explanation while the plan still needs concrete next steps.',
      'Do not edit product files such as README.md, AGENTS.md, source files, or docs directly from planner.',
      'If the next slice is clear, summarize it as one bounded implementation step with verification.'
    ];

    if (reminderCount > 0) {
      lines.push('Your next turn must produce a concrete bounded plan instead of attempting a product-file edit.');
    }

    return lines.join('\n');
  }

  const lines = [
    'Internal runtime reminder:',
    'The user asked for actual workspace changes.',
    'Do not stop at inspection or explanation while the requested files are still unchanged.',
    'If the required edits are not complete yet, call the next relevant write-capable tool now.',
    'Use mkdir when a target directory does not exist, then use write_file or apply_patch to make the requested file changes.'
  ];

  if (reminderCount > 0) {
    lines.push('Your next turn must call a write-capable tool instead of returning an empty or explanation-only response.');
  }

  return lines.join('\n');
}

export function buildRequiredPostMutationVerificationReminder(
  lastVerificationFailed = false,
  plannedCommand?: string | null
) {
  const normalizedPlannedCommand = plannedCommand?.trim() || null;
  const lines = [
    'Internal runtime reminder:',
    'The user explicitly asked you to verify the workspace changes after editing.',
    'Do not stop after writing files until a post-edit verification command has passed.',
    normalizedPlannedCommand
      ? `Call run_command now with: ${normalizedPlannedCommand}`
      : 'Call run_command now with the smallest relevant verification command, such as the project test command.'
  ];

  if (lastVerificationFailed) {
    lines.push('The latest post-edit verification command failed. Inspect that output, fix the root cause, and rerun verification before answering.');
  }

  return lines.join('\n');
}

export function isVerificationCommandToolCall(toolCall: AgentToolCall) {
  if (toolCall.name !== 'run_command') {
    return false;
  }

  const command = Object.values(toolCall.arguments)
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  return /\b(?:test|node --test|vitest|jest|playwright|build|lint|typecheck|tsc|check|smoke)\b/u.test(command);
}

function formatDuration(timeoutMs: number) {
  const timeoutMinutes = timeoutMs >= 60_000 ? Math.round(timeoutMs / 60_000) : null;
  if (timeoutMinutes && timeoutMinutes > 1) {
    return `${timeoutMinutes} minutes`;
  }
  if (timeoutMs >= 60_000) {
    return '1 minute';
  }
  return `${Math.round(timeoutMs / 1000)} seconds`;
}

export function formatProviderModelTransportError(error: unknown, providerLabel: string, timeoutMs = DEFAULT_PROVIDER_MODEL_RESPONSE_TIMEOUT_MS) {
  if (error instanceof Error) {
    const normalized = error.message.trim().toLowerCase();
    if (normalized === 'fetch failed' || normalized === 'failed to fetch' || normalized.includes('fetch failed')) {
      return `Failed to reach ${providerLabel}. Check your network connection, then retry.`;
    }

    if (normalized === 'terminated' || normalized.includes('terminated')) {
      return `${providerLabel} terminated the response before a final answer was returned.`;
    }

    if (
      normalized === 'this operation was aborted'
      || normalized === 'the operation was aborted'
      || normalized.includes('aborterror')
      || normalized.includes('aborted')
    ) {
      return `${providerLabel} did not produce the next response within ${formatDuration(timeoutMs)}.`;
    }

    if (error.message.trim()) {
      return error.message;
    }
  }

  return `Failed to reach ${providerLabel}.`;
}

function defaultStripToolCallMarkup(content: string) {
  return content;
}

function appendProviderModelVisibleText(
  current: string,
  rawChunk: string,
  textNormalizationOptions?: AssistantTextNormalizationOptions
) {
  return appendAssistantStreamChunk(current, rawChunk, textNormalizationOptions);
}

export interface CreateProviderModelHarnessPolicyOptions {
  providerLabel: string;
  providerEventTypePrefix: string;
  textNormalizationOptions?: AssistantTextNormalizationOptions;
  stripToolCallMarkup?: (content: string) => string;
  formatTransportError?: ProviderModelHarnessPolicy['formatTransportError'];
  shouldFallbackFromTransportError?: ProviderModelHarnessPolicy['shouldFallbackFromTransportError'];
  fallbackInfoMessage?: string;
  runAppPreviewValidation?: ProviderModelHarnessPolicy['runAppPreviewValidation'];
  buildPreviewValidationSummaryPrompt?: ProviderModelHarnessPolicy['buildPreviewValidationSummaryPrompt'];
  buildToolCallContractReminder?: ProviderModelHarnessPolicy['buildToolCallContractReminder'];
}

export function createDefaultProviderModelHarnessPolicy({
  providerLabel,
  providerEventTypePrefix,
  textNormalizationOptions,
  stripToolCallMarkup = defaultStripToolCallMarkup,
  formatTransportError,
  shouldFallbackFromTransportError,
  fallbackInfoMessage,
  runAppPreviewValidation,
  buildPreviewValidationSummaryPrompt,
  buildToolCallContractReminder
}: CreateProviderModelHarnessPolicyOptions): ProviderModelHarnessPolicy {
  return {
    providerLabel,
    providerEventTypePrefix,
    appendVisibleText: (current, rawChunk) =>
      appendProviderModelVisibleText(current, rawChunk, textNormalizationOptions),
    stripToolCallMarkup,
    assistantSignalsPendingWorkspaceMutation,
    buildRequiredWebResearchReminder,
    buildRequiredMutationReminder,
    buildToolCallContractReminder,
    buildRequiredPostMutationVerificationReminder,
    formatToolLabel: formatAgentRuntimeToolLabel,
    formatToolResultForModel: formatAgentRuntimeToolResultForModel,
    isMutatingToolCall: isMutatingAgentRuntimeToolCall,
    isUntrustedToolResult: isUntrustedAgentRuntimeToolResult,
    isVerificationCommandToolCall,
    buildToolCallSignature: buildAgentRuntimeToolCallSignature,
    buildToolResultSignature: buildAgentRuntimeToolResultSignature,
    formatLimitError: (maxTurns) =>
      `${providerLabel} agent runtime exceeded ${maxTurns} tool turns without reaching a final answer. Continue the task in the same thread to let the model finish from its current workspace progress.`,
    formatRuntimeError: (maxRuntimeMs) =>
      `${providerLabel} agent runtime exceeded ${Math.round(maxRuntimeMs / 60_000)} minutes without reaching a final answer. Continue the task in the same thread to let the model finish from its current workspace progress.`,
    formatStallError: () =>
      `${providerLabel} kept requesting the same tool work without making visible progress. Continue the task in the same thread or adjust the prompt to break the loop.`,
    formatMissingRequiredWebResearchError: () =>
      `${providerLabel} was explicitly asked to research online but kept answering without using the available native web research tools. Continue the thread with a direct instruction to use the research tool, or try a different provider if this repeats.`,
    formatMissingRequiredMutationError: () =>
      `${providerLabel} stopped before writing the required file contents. Continue the thread and ask it to write the missing files, or try a different provider if this repeats.`,
    formatTransportError: formatTransportError ?? ((error, _context, timeoutMs) =>
      formatProviderModelTransportError(error, providerLabel, timeoutMs)),
    shouldFallbackFromTransportError,
    fallbackInfoMessage,
    runAppPreviewValidation,
    buildPreviewValidationSummaryPrompt
  };
}
