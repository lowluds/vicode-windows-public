import type { AgentRuntime } from '../../providers/agent-runtime';
import type {
  ProviderModelTransport,
  ProviderRunCallbacks,
  ProviderRunContext,
  ProviderRunHandle
} from '../../providers/types';
import type { ProviderId, OllamaTransportMode } from '../../shared/domain';
import {
  startProviderModelHarnessRun,
  type ProviderModelHarnessPolicy,
  type ProviderModelHarnessPreparedRun
} from './provider-model-harness-runner';
import {
  assembleProviderModelContext,
  providerPromptRequiresNativeWebResearch,
  providerPromptRequiresWorkspaceMutation
} from './provider-model-context-assembler';
import { promptIsCasualConversation } from './provider-model-prompt-routing';
import type { ProviderModelTransportResolution } from './provider-model-transport-registry';

export interface ProviderModelExecutionTransportResolverInput {
  providerId: ProviderId;
  modelId: string;
  apiKey: string | null;
  ollamaTransportMode?: OllamaTransportMode | string | null;
  customProviderId?: string | null;
}

export type ProviderModelExecutionTransportResolver = (
  input: ProviderModelExecutionTransportResolverInput
) => ProviderModelTransportResolution | null;

export interface ProviderModelExecutionServiceOptions {
  agentRuntime: AgentRuntime;
  resolveTransport: ProviderModelExecutionTransportResolver;
}

export interface TryStartNormalizedProviderModelRunInput {
  providerId: ProviderId;
  context: ProviderRunContext;
  callbacks: ProviderRunCallbacks;
  resolvedRun?: ProviderModelNormalizedRunResolution | null;
  finalizeAssistantOutput: (context: ProviderRunContext, output: string) => Promise<string>;
  recordTrace?: (
    stage: string,
    payload?: Record<string, unknown> | null
  ) => void;
}

export interface ResolveNormalizedProviderModelRunInput {
  providerId: ProviderId;
  context: ProviderRunContext;
}

export interface ProviderModelNormalizedRunResolution extends ProviderModelTransportResolution {}

function buildProviderModelRoutingEvidence(input: {
  context: ProviderRunContext;
  providerId: ProviderId;
  resolved: ProviderModelNormalizedRunResolution;
}) {
  return {
    providerId: input.providerId,
    modelId: input.context.modelId,
    customProviderId: input.context.customProviderId ?? null,
    ollamaTransportMode: input.context.ollamaTransportMode ?? null,
    providerLabel: input.resolved.providerLabel,
    transportKind: input.resolved.transportKind,
    runtimeAuthority: input.resolved.runtimeAuthority,
    reason: 'normalized provider model transport selected for this trusted workspace run'
  };
}

async function prepareProviderModelHarnessRun(
  agentRuntime: AgentRuntime,
  context: ProviderRunContext
): Promise<ProviderModelHarnessPreparedRun> {
  return assembleProviderModelContext(agentRuntime, context);
}

const OLLAMA_LOCAL_TOOL_CALL_CONTRACT = [
  'Local Ollama tool-call contract:',
  'When this task requires a Vicode tool, use native structured tool_calls when available.',
  'If native tool_calls are not emitted, return exactly one tool-call envelope and no prose.',
  'Allowed fallback envelope:',
  '{"name":"tool_name","arguments":{"arg":"value"}}',
  'or one ```json fenced block containing that same JSON object.',
  'Do not include final-answer text until after Vicode returns the tool result.'
].join('\n');

function appendOllamaLocalToolCallContract(
  prepared: ProviderModelHarnessPreparedRun
): ProviderModelHarnessPreparedRun {
  if (prepared.initialAgentPrompt.includes(OLLAMA_LOCAL_TOOL_CALL_CONTRACT)) {
    return prepared;
  }

  const initialAgentPrompt = `${prepared.initialAgentPrompt}\n\n${OLLAMA_LOCAL_TOOL_CALL_CONTRACT}`;
  const promptInput = prepared.promptPayload.input.length > 0
    ? prepared.promptPayload.input.map((message, index) =>
        index === 0 && message.role === 'user'
          ? {
              ...message,
              content: `${message.content}\n\n${OLLAMA_LOCAL_TOOL_CALL_CONTRACT}`
            }
          : message
      )
    : [
        {
          role: 'user' as const,
          content: initialAgentPrompt
        }
      ];

  return {
    ...prepared,
    initialAgentPrompt,
    harnessEvidence: prepared.harnessEvidence
      ? {
          ...prepared.harnessEvidence,
          promptSections: prepared.harnessEvidence.promptSections.map((section) =>
            section.id === 'runtime-agent-prompt'
              ? {
                  ...section,
                  characterCount: initialAgentPrompt.length,
                  reason: `${section.reason}; includes local Ollama tool-call contract`
                }
              : section
          )
        }
      : prepared.harnessEvidence,
    promptPayload: {
      ...prepared.promptPayload,
      input: promptInput
    }
  };
}

function createOllamaLocalToolCallContractPolicy(
  policy: ProviderModelHarnessPolicy
): ProviderModelHarnessPolicy {
  return {
    ...policy,
    buildRequiredMutationReminder: (reminderCount, runMode) => {
      const reminder = policy.buildRequiredMutationReminder(reminderCount, runMode);
      if (runMode === 'plan' || reminder.includes(OLLAMA_LOCAL_TOOL_CALL_CONTRACT)) {
        return reminder;
      }

      return `${reminder}\n\n${OLLAMA_LOCAL_TOOL_CALL_CONTRACT}`;
    }
  };
}

function shouldAppendOllamaLocalToolCallContract(input: {
  context: ProviderRunContext;
  providerId: ProviderId;
  resolved: ProviderModelNormalizedRunResolution;
}) {
  return input.providerId === 'ollama'
    && input.resolved.transportKind === 'ollama_chat'
    && input.context.runMode !== 'plan'
    && !input.context.apiKey;
}

function shouldUseNormalizedRun(providerId: ProviderId, context: ProviderRunContext) {
  if (!context.trusted) {
    return false;
  }

  const sourcePrompt = context.sourcePrompt || context.prompt;
  const webResearchOnlyPrompt =
    context.runMode === 'default'
    && providerPromptRequiresNativeWebResearch(sourcePrompt)
    && !providerPromptRequiresWorkspaceMutation(sourcePrompt);

  if (!context.folderPath) {
    return webResearchOnlyPrompt;
  }

  if (providerId === 'ollama') {
    if (context.runMode === 'plan') {
      return true;
    }

    return !promptIsCasualConversation(context.sourcePrompt || context.prompt);
  }

  if (providerId === 'openai_compatible') {
    return context.runMode === 'default';
  }

  return context.runMode === 'default';
}

export class ProviderModelExecutionService {
  constructor(private readonly options: ProviderModelExecutionServiceOptions) {}

  private resolveTransportForContext(
    providerId: ProviderId,
    context: ProviderRunContext
  ): ProviderModelNormalizedRunResolution | null {
    return this.options.resolveTransport({
      providerId,
      modelId: context.modelId,
      apiKey: context.apiKey,
      ollamaTransportMode: context.ollamaTransportMode,
      customProviderId: context.customProviderId
    });
  }

  resolveNormalizedRun(
    input: ResolveNormalizedProviderModelRunInput
  ): ProviderModelNormalizedRunResolution | null {
    if (!shouldUseNormalizedRun(input.providerId, input.context)) {
      return null;
    }

    return this.resolveTransportForContext(input.providerId, input.context);
  }

  private async startHarnessRun(input: {
    callbacks: ProviderRunCallbacks;
    context: ProviderRunContext;
    finalizeAssistantOutput: (context: ProviderRunContext, output: string) => Promise<string>;
    providerId: ProviderId;
    recordTrace?: (
      stage: string,
      payload?: Record<string, unknown> | null
    ) => void;
    resolved: ProviderModelNormalizedRunResolution;
  }): Promise<ProviderRunHandle> {
    return startProviderModelHarnessRun({
      agentRuntime: this.options.agentRuntime,
      buildFallbackRunContext: input.resolved.buildFallbackRunContext,
      callbacks: input.callbacks,
      context: input.context,
      fallbackToRun: input.resolved.buildFallbackRunContext
        ? async (fallbackContext, fallbackCallbacks) => {
            const fallbackResolution = this.resolveTransportForContext(input.providerId, fallbackContext);
            if (!fallbackResolution) {
              throw new Error(
                `${input.resolved.providerLabel} normalized fallback transport was unavailable.`
              );
            }

            input.recordTrace?.('provider_model_normalized_fallback_started', {
              providerId: input.providerId,
              fromTransportKind: input.resolved.transportKind,
              toTransportKind: fallbackResolution.transportKind
            });

            return this.startHarnessRun({
              callbacks: fallbackCallbacks,
              context: fallbackContext,
              finalizeAssistantOutput: input.finalizeAssistantOutput,
              providerId: input.providerId,
              recordTrace: input.recordTrace,
              resolved: {
                ...fallbackResolution,
                buildFallbackRunContext: undefined
              }
            });
          }
        : undefined,
      finalizeAssistantOutput: input.finalizeAssistantOutput,
      limits: input.resolved.limits,
      policy: shouldAppendOllamaLocalToolCallContract({
        context: input.context,
        providerId: input.providerId,
        resolved: input.resolved
      })
        ? createOllamaLocalToolCallContractPolicy(input.resolved.policy)
        : input.resolved.policy,
      prepareRun: async (agentRuntime, context) => {
        const basePrepared = await prepareProviderModelHarnessRun(agentRuntime, context);
        const prepared = shouldAppendOllamaLocalToolCallContract({
          context,
          providerId: input.providerId,
          resolved: input.resolved
        })
          ? appendOllamaLocalToolCallContract(basePrepared)
          : basePrepared;
        if (prepared.harnessEvidence) {
          input.recordTrace?.(
            'provider_model_harness_evidence_captured',
            prepared.harnessEvidence as unknown as Record<string, unknown>
          );
        }
        return prepared;
      },
      transport: input.resolved.transport as ProviderModelTransport
    });
  }

  async tryStartNormalizedRun(
    input: TryStartNormalizedProviderModelRunInput
  ): Promise<ProviderRunHandle | null> {
    const resolved =
      input.resolvedRun === undefined
        ? this.resolveNormalizedRun({
            providerId: input.providerId,
            context: input.context
          })
        : input.resolvedRun;
    if (!resolved) {
      return null;
    }

    input.callbacks.onStart();
    input.recordTrace?.('provider_model_normalized_dispatch_started', {
      providerId: input.providerId,
      transportKind: resolved.transportKind,
      modelRouting: buildProviderModelRoutingEvidence({
        context: input.context,
        providerId: input.providerId,
        resolved
      })
    });

    return this.startHarnessRun({
      callbacks: input.callbacks,
      context: input.context,
      finalizeAssistantOutput: input.finalizeAssistantOutput,
      providerId: input.providerId,
      recordTrace: input.recordTrace,
      resolved
    });
  }
}
