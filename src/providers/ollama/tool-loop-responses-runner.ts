import type { ProviderModelHarnessPolicy } from '../../main/services/provider-model-harness-runner';
import {
  buildRequiredPostMutationVerificationReminder,
  createDefaultProviderModelHarnessPolicy,
  isVerificationCommandToolCall
} from '../../main/services/provider-model-harness-policy';
import {
  formatOllamaTransportError,
  shouldFallbackFromResponsesTransport
} from './plain-runners';
import {
  appendOllamaVisibleText,
  stripOllamaToolCallMarkup
} from './tool-loop-model';
import {
  buildPreviewValidationSummaryPrompt,
  maybeRunAppOwnedPreviewValidation
} from './app-preview-validation';
import {
  TOOL_LOOP_RESPONSE_TIMEOUT_MS,
  formatMissingRequiredMutationError,
  formatMissingRequiredWebResearchError,
  formatToolLoopLimitError,
  formatToolLoopRuntimeError,
  formatToolLoopStallError
} from './tool-loop-guardrails';

const buildOllamaToolCallContractReminder: NonNullable<ProviderModelHarnessPolicy['buildToolCallContractReminder']> = ({
  reason,
  candidateToolName,
  runMode
}) => {
  if (runMode === 'plan') {
    return null;
  }

  const lines = [
    'Internal runtime reminder:',
    'Your previous response included a possible tool call, but Vicode did not execute it because it had an invalid tool-call envelope shape.',
    `Contract violation: ${reason}.`,
    'For the next turn, emit exactly one executable tool call and no prose.',
    'Use one of these formats only:',
    '{"name":"write_file","arguments":{"path":"relative/file.txt","content":"..."}}',
    'or a single ```json fenced block containing that same JSON object.',
    'Do not include the final answer until after Vicode returns the tool result.',
    'Use only active tool names and include all required arguments.'
  ];

  if (candidateToolName) {
    lines.push(`If you intended to call ${candidateToolName}, re-emit it using a valid envelope now.`);
  }

  return lines.join('\n');
};

export function createOllamaResponsesHarnessPolicy(): ProviderModelHarnessPolicy {
  return {
    ...createDefaultProviderModelHarnessPolicy({
      providerLabel: 'Ollama',
      providerEventTypePrefix: 'ollama_tool_loop',
      stripToolCallMarkup: stripOllamaToolCallMarkup,
      formatTransportError: (error, context) =>
        formatOllamaTransportError(error, false, TOOL_LOOP_RESPONSE_TIMEOUT_MS),
      shouldFallbackFromTransportError: shouldFallbackFromResponsesTransport,
      fallbackInfoMessage: 'Ollama /v1/responses was unavailable for this tool run. Falling back to the normalized local chat transport.',
      runAppPreviewValidation: maybeRunAppOwnedPreviewValidation,
      buildPreviewValidationSummaryPrompt,
      buildToolCallContractReminder: buildOllamaToolCallContractReminder
    }),
    appendVisibleText: appendOllamaVisibleText,
    buildRequiredPostMutationVerificationReminder,
    isVerificationCommandToolCall,
    formatLimitError: () => formatToolLoopLimitError(),
    formatRuntimeError: () => formatToolLoopRuntimeError(),
    formatStallError: () => formatToolLoopStallError(),
    formatMissingRequiredWebResearchError,
    formatMissingRequiredMutationError
  };
}
