import type {
  AgentRuntime,
  AgentRuntimeToolCatalog,
  AgentToolCall,
  AgentToolExecutionContext,
  AgentToolExecutionResult
} from '../../providers/agent-runtime';
import type {
  ProviderModelHarnessEvidence
} from './provider-model-context-assembler';
import type {
  HarnessFinalEvidenceSummary,
  HarnessHookEvidence,
  HarnessHookStage,
  ProviderModelPromptPayload,
  ProviderModelToolDefinition,
  ProviderModelTransport,
  ProviderModelTurnMessage,
  ProviderRunCallbacks,
  ProviderRunContext,
  ProviderRunHandle
} from '../../providers/types';
import { buildProviderModelTurnRequest } from '../../providers/types';
import { resolveModelSamplingProfile } from '../../providers/model-sampling-profile';
import type { VerificationArtifact } from '../../shared/harness-verification';
import { createSkippedVerificationArtifact } from '../../shared/harness-verification';
import { extractThreadSourcesFromText } from '../../shared/thread-sources';
import {
  appendUnique,
  createVerificationArtifactFromRunCommandResult,
  firstLineOf,
  shortSummaryOf
} from './provider-harness-evidence';
import {
  hasToolCallName,
  isFileContentMutationToolCall,
  isPlannedPostMutationVerificationCommand,
  listedFileExtensions,
  readToolCommandArgument,
  readToolPathArgument,
  writtenFilePathExtensions
} from './provider-harness-guards';
import {
  buildMissingStaticWebPageFileSetReminder,
  buildMissingWebImageArtifactReminder,
  formatMissingFileContentMutationDiagnosticMessage,
  formatMissingFileContentMutationDiagnosticText,
  formatMissingFileContentMutationMessage
} from './provider-harness-reminders';

export interface ProviderModelHarnessPreparedRun {
  activeToolCatalog: AgentRuntimeToolCatalog;
  harnessEvidence?: ProviderModelHarnessEvidence;
  initialAgentPrompt: string;
  initialWebResearchDirective?: string | null;
  promptPayload: ProviderModelPromptPayload;
  requiresNativeWebResearch: boolean;
  requiresFileContentMutation: boolean;
  requiresPostMutationVerification: boolean;
  requiredStaticWebPageFileExtensions: string[];
  requiresWebImageArtifactReference: boolean;
  requiresWorkspaceMutation: boolean;
  systemPrompt: string;
  tools: ProviderModelToolDefinition[];
}

export interface ProviderModelHarnessLimits {
  maxTurns: number;
  maxRuntimeMs: number;
  maxStalledToolTurns: number;
  maxRequiredWebResearchReminders: number;
  maxRequiredMutationReminders: number;
}

export interface ProviderModelHarnessPolicy {
  providerLabel: string;
  providerEventTypePrefix: string;
  appendVisibleText(current: string, rawChunk: string): {
    text: string;
    delta: string;
  };
  stripToolCallMarkup(content: string): string;
  assistantSignalsPendingWorkspaceMutation(text: string): boolean;
  buildRequiredWebResearchReminder(): string;
  buildRequiredMutationReminder(reminderCount: number, runMode: ProviderRunContext['runMode']): string;
  buildToolCallContractReminder?(input: {
    reason: string;
    candidateToolName: string | null;
    runMode: ProviderRunContext['runMode'];
  }): string | null;
  buildRequiredPostMutationVerificationReminder(lastVerificationFailed: boolean, plannedCommand?: string | null): string;
  formatToolLabel(toolName: string): string;
  formatToolResultForModel(
    toolCatalog: AgentRuntimeToolCatalog,
    toolName: string,
    content: string,
    isError: boolean
  ): string;
  isMutatingToolCall(toolCatalog: AgentRuntimeToolCatalog, toolName: string): boolean;
  isUntrustedToolResult(toolCatalog: AgentRuntimeToolCatalog, toolName: string): boolean;
  isVerificationCommandToolCall(toolCall: AgentToolCall): boolean;
  buildToolCallSignature(toolCalls: AgentToolCall[]): string;
  buildToolResultSignature(results: Array<{ toolName: string; content: string; isError: boolean }>): string;
  formatLimitError(maxTurns: number): string;
  formatRuntimeError(maxRuntimeMs: number): string;
  formatStallError(): string;
  formatMissingRequiredWebResearchError(): string;
  formatMissingRequiredMutationError(): string;
  formatTransportError(error: unknown, context: ProviderRunContext, timeoutMs: number): string;
  shouldFallbackFromTransportError?(message: string): boolean;
  fallbackInfoMessage?: string;
  runAppPreviewValidation?(input: {
    agentRuntime: AgentRuntime;
    context: ProviderRunContext;
    callbacks: ProviderRunCallbacks;
    activeToolCatalog: AgentRuntimeToolCatalog;
    usedMutatingTool: boolean;
    usedBrowserPreviewTool: boolean;
    signal: AbortSignal;
  }): Promise<AgentToolExecutionResult | null>;
  buildPreviewValidationSummaryPrompt?(result: AgentToolExecutionResult): string;
}

export interface StartProviderModelHarnessRunOptions {
  agentRuntime: AgentRuntime;
  buildFallbackRunContext?: (context: ProviderRunContext) => ProviderRunContext;
  callbacks: ProviderRunCallbacks;
  context: ProviderRunContext;
  fallbackToRun?: (context: ProviderRunContext, callbacks: ProviderRunCallbacks) => Promise<ProviderRunHandle>;
  finalizeAssistantOutput: (context: ProviderRunContext, output: string) => Promise<string>;
  limits?: Partial<ProviderModelHarnessLimits>;
  policy: ProviderModelHarnessPolicy;
  prepareRun: (
    agentRuntime: AgentRuntime,
    context: ProviderRunContext
  ) => Promise<ProviderModelHarnessPreparedRun>;
  transport: ProviderModelTransport;
}

const DEFAULT_LIMITS: ProviderModelHarnessLimits = {
  maxTurns: 96,
  maxRuntimeMs: 1000 * 60 * 30,
  maxStalledToolTurns: 6,
  maxRequiredWebResearchReminders: 2,
  maxRequiredMutationReminders: 2
};

function createToolLoopActivityType(prefix: string, suffix: string) {
  return `${prefix}_${suffix}`;
}

function buildAgentToolExecutionContext(input: {
  callbacks: ProviderRunCallbacks;
  context: ProviderRunContext;
  signal: AbortSignal;
}): AgentToolExecutionContext {
  return {
    workspaceRoot: (input.context.runtimeWorkspaceRoot ?? input.context.folderPath) as string,
    threadId: input.context.threadId,
    runId: input.context.runId,
    isolationMode: input.context.harnessTaskContract?.isolationMode ?? 'direct_workspace',
    executionPermission: input.context.executionPermission,
    executionConstraints: input.context.executionConstraints ?? null,
    runtimeCommandPolicy: input.context.runtimeCommandPolicy,
    runtimeNetworkPolicy: input.context.runtimeNetworkPolicy,
    signal: input.signal,
    requestApproval: input.callbacks.requestToolApproval
      ? (request) => input.callbacks.requestToolApproval!(request)
      : undefined,
    onInfo: (payload) => {
      input.callbacks.onInfo({
        message: payload.message ?? payload.activity?.summary ?? '',
        activity: payload.activity ?? null
      });
    }
  };
}

export async function startProviderModelHarnessRun({
  agentRuntime,
  buildFallbackRunContext,
  callbacks,
  context,
  fallbackToRun,
  finalizeAssistantOutput,
  limits: limitOverrides,
  policy,
  prepareRun,
  transport
}: StartProviderModelHarnessRunOptions): Promise<ProviderRunHandle> {
  const controller = new AbortController();
  const limits = {
    ...DEFAULT_LIMITS,
    ...limitOverrides
  };
  const startedAt = Date.now();
  let settled = false;
  let fallbackHandle: ProviderRunHandle | null = null;
  let assistantText = '';
  let repeatedStallTurns = 0;
  let requiredWebResearchReminderCount = 0;
  let requiredMutationReminderCount = 0;
  let requiredVerificationReminderCount = 0;
  let requiredStaticWebPageFileSetReminderCount = 0;
  let requiredWebImageArtifactReminderCount = 0;
  let usedNativeWebResearchTool = false;
  let usedFileContentMutationTool = false;
  let usedAppliedFileContentMutationTool = false;
  let usedMutatingTool = false;
  let usedAppliedMutatingTool = false;
  let usedBrowserPreviewTool = false;
  let activeRequiresFileContentMutation = false;
  const createdDirectories: string[] = [];
  const writtenFiles: string[] = [];
  const parsedToolCallNames: string[] = [];
  let parsedFileContentMutationToolCallCount = 0;
  let postMutationVerificationPassed = false;
  let postMutationVerificationFailed = false;
  let postMutationVerificationStatus: VerificationArtifact['status'] | null = null;
  let staticWebPageFileSetPassed = false;
  let webImageArtifactReferencePassed = false;
  let previousTurnSignature: string | null = null;
  let harnessHookSequence = 0;
  let executedToolCallCount = 0;
  const successfulMutatingToolCallSignatures = new Set<string>();

  const reminderCount = () =>
    requiredWebResearchReminderCount
    + requiredMutationReminderCount
    + requiredVerificationReminderCount
    + requiredStaticWebPageFileSetReminderCount
    + requiredWebImageArtifactReminderCount;

  const emitHarnessHook = (
    stage: HarnessHookStage,
    input: Partial<Omit<HarnessHookEvidence, 'runId' | 'stage' | 'sequence' | 'at'>> = {}
  ) => {
    harnessHookSequence += 1;
    callbacks.onInfo({
      eventKind: 'debug_detail',
      transcriptVisible: false,
      harnessHookEvidence: {
        runId: context.runId,
        stage,
        sequence: harnessHookSequence,
        at: new Date().toISOString(),
        turnIndex: input.turnIndex ?? null,
        toolName: input.toolName ?? null,
        summary: input.summary ?? null,
        isError: input.isError ?? null,
        mutatesWorkspace: input.mutatesWorkspace ?? null,
        verificationCommand: input.verificationCommand ?? null,
        verificationStatus: input.verificationStatus ?? null,
        contextPressureSeverity: input.contextPressureSeverity ?? null,
        contextPressureUsagePercent: input.contextPressureUsagePercent ?? null,
        contextPressureUsedTokens: input.contextPressureUsedTokens ?? null,
        contextPressureMaxTokens: input.contextPressureMaxTokens ?? null,
        contextPressureSource: input.contextPressureSource ?? null,
        contextPressureSourceLabel: input.contextPressureSourceLabel ?? null,
        contextPressureCheckpointRecommended: input.contextPressureCheckpointRecommended ?? null,
        contextPressureCompactionLikely: input.contextPressureCompactionLikely ?? null,
        checkpointReminderKind: input.checkpointReminderKind ?? null,
        checkpointReminderTitle: input.checkpointReminderTitle ?? null,
        checkpointReminderSummary: input.checkpointReminderSummary ?? null,
        continuationReason: input.continuationReason ?? null,
        continuationReminderCount: input.continuationReminderCount ?? null,
        continuationMaxReminderCount: input.continuationMaxReminderCount ?? null
      }
    });
  };

  const emitContextPressureEvidence = () => {
    if (!context.contextPressure) {
      return;
    }

    emitHarnessHook('context_pressure', {
      summary: context.checkpointReminder?.title ?? context.contextPressure.pressureLabel,
      contextPressureSeverity: context.contextPressure.severity,
      contextPressureUsagePercent: context.contextPressure.usagePercent,
      contextPressureUsedTokens: context.contextPressure.usedTokens,
      contextPressureMaxTokens: context.contextPressure.maxTokens,
      contextPressureSource: context.contextPressure.source,
      contextPressureSourceLabel: context.contextPressure.sourceLabel,
      contextPressureCheckpointRecommended: context.contextPressure.checkpointRecommended,
      contextPressureCompactionLikely: context.contextPressure.compactionLikely,
      checkpointReminderKind: context.checkpointReminder?.kind ?? null,
      checkpointReminderTitle: context.checkpointReminder?.title ?? null,
      checkpointReminderSummary: context.checkpointReminder?.message
        ? shortSummaryOf(context.checkpointReminder.message)
        : null
    });
  };

  const emitContinuationDecision = (input: {
    turnIndex: number;
    reason: NonNullable<HarnessHookEvidence['continuationReason']>;
    reminderCount: number;
    maxReminderCount: number;
    summary: string;
  }) => {
    emitHarnessHook('continuation', {
      turnIndex: input.turnIndex,
      summary: input.summary,
      continuationReason: input.reason,
      continuationReminderCount: input.reminderCount,
      continuationMaxReminderCount: input.maxReminderCount
    });
  };

  const resolveSkippedVerificationReason = (activeToolCatalog: AgentRuntimeToolCatalog) => {
    if (!context.verificationPlan) {
      return 'No verification plan was available for this run.';
    }

    if (context.verificationPlan.status === 'skipped') {
      return context.verificationPlan.skippedReason ?? 'Verification plan was skipped.';
    }

    if (!hasToolCallName(activeToolCatalog, 'run_command')) {
      return 'Planned verification command was not executed because run_command was not available.';
    }

    if (context.runMode === 'plan') {
      return 'Post-mutation verification was not executed because the run was in plan mode.';
    }

    if (context.harnessTaskContract?.verificationPolicy !== 'required') {
      return 'Post-mutation verification was not required by the task contract.';
    }

    return 'Post-mutation verification was not executed before completion.';
  };

  const emitSkippedVerificationEvidenceIfNeeded = (activeToolCatalog: AgentRuntimeToolCatalog) => {
    if (!usedAppliedMutatingTool || postMutationVerificationStatus || !context.verificationPlan) {
      return;
    }

    const verificationArtifact = createSkippedVerificationArtifact(
      context.verificationPlan,
      resolveSkippedVerificationReason(activeToolCatalog)
    );
    postMutationVerificationStatus = verificationArtifact.status;
    callbacks.onInfo({
      eventKind: 'debug_detail',
      transcriptVisible: false,
      verificationArtifact
    });
  };

  const emitFinalEvidenceSummary = (input: {
    activeToolCatalog: AgentRuntimeToolCatalog;
    requiresPostMutationVerification: boolean;
  }) => {
    emitSkippedVerificationEvidenceIfNeeded(input.activeToolCatalog);
    const summary: HarnessFinalEvidenceSummary = {
      runId: context.runId,
      usedMutatingTool,
      usedFileContentMutationTool,
      usedNativeWebResearchTool,
      postMutationVerificationRequired: input.requiresPostMutationVerification,
      postMutationVerificationPassed,
      verificationCommand: context.verificationPlan?.command ?? null,
      verificationStatus: postMutationVerificationStatus,
      createdDirectoriesCount: createdDirectories.length,
      writtenFilesCount: writtenFiles.length,
      toolCallCount: executedToolCallCount,
      reminderCount: reminderCount()
    };
    callbacks.onInfo({
      eventKind: 'debug_detail',
      transcriptVisible: false,
      finalEvidenceSummary: summary
    });
  };

  const settleComplete = (output: string) => {
    if (settled) {
      return;
    }
    settled = true;
    callbacks.onComplete(output);
  };

  const settleError = (message: string) => {
    if (settled) {
      return;
    }
    settled = true;
    callbacks.onError(message);
  };

  const settleMissingRequiredMutationError = () => {
    const baseMessage = policy.formatMissingRequiredMutationError();
    if (
      context.runMode !== 'plan'
      && !usedFileContentMutationTool
      && activeRequiresFileContentMutation
    ) {
      const diagnosticMessage = formatMissingFileContentMutationDiagnosticMessage({
        parsedFileContentMutationToolCallCount,
        requiredMutationReminderCount
      });
      callbacks.onInfo({
        message: 'No file writes recorded before stopping',
        activity: {
          kind: 'guidance',
          summary: 'No file writes recorded before stopping',
          status: 'failed',
          text: formatMissingFileContentMutationDiagnosticText({
            parsedFileContentMutationToolCallCount,
            parsedToolCallNames,
            requiredMutationReminderCount,
            createdDirectories,
            writtenFiles
          }),
          providerEventType: createToolLoopActivityType(policy.providerEventTypePrefix, 'missing_file_write_diagnostic')
        }
      });
      settleError(
        formatMissingFileContentMutationMessage({
          baseMessage,
          createdDirectories,
          diagnosticMessage,
          writtenFiles
        })
      );
      return;
    }

    settleError(
      baseMessage
    );
  };

  const settleAbort = (message?: string) => {
    if (settled) {
      return;
    }
    settled = true;
    callbacks.onAbort(message);
  };

  const pushThinkingReminder = (history: ProviderModelTurnMessage[], content: string, message: string) => {
    history.push({
      role: 'user',
      content
    });
    callbacks.onInfo({
      message,
      activity: {
        kind: 'thinking',
        summary: message,
        text: content,
        providerEventType: createToolLoopActivityType(policy.providerEventTypePrefix, 'thinking')
      }
    });
  };

  void (async () => {
    try {
      const {
        activeToolCatalog,
        initialAgentPrompt,
        initialWebResearchDirective,
        requiresNativeWebResearch,
        requiresFileContentMutation,
        requiresPostMutationVerification,
        requiredStaticWebPageFileExtensions,
        requiresWebImageArtifactReference,
        requiresWorkspaceMutation,
        promptPayload,
        systemPrompt,
        tools
      } = await prepareRun(agentRuntime, context);
      activeRequiresFileContentMutation = requiresFileContentMutation;
      emitContextPressureEvidence();

      if (initialWebResearchDirective) {
        callbacks.onInfo({
          message: 'Preparing web research.',
          activity: {
            kind: 'thinking',
            summary: 'Preparing web research.',
            text: initialWebResearchDirective,
            providerEventType: createToolLoopActivityType(policy.providerEventTypePrefix, 'thinking')
          }
        });
      }

      const history: ProviderModelTurnMessage[] =
        promptPayload.input.length > 0
          ? promptPayload.input.map((message) => ({
              ...message
            }))
          : [
              {
                role: 'user',
                content: initialAgentPrompt
              }
            ];

      for (let turnIndex = 0; turnIndex < limits.maxTurns; turnIndex += 1) {
        if (Date.now() - startedAt >= limits.maxRuntimeMs) {
          settleError(policy.formatRuntimeError(limits.maxRuntimeMs));
          return;
        }

        emitHarnessHook('before_model', {
          turnIndex,
          summary: `Sending model turn ${turnIndex + 1}`
        });
        const turn = await transport.sendTurn(buildProviderModelTurnRequest({
          modelId: context.modelId,
          prompt: {
            ...promptPayload,
            systemInstructions: systemPrompt,
            input: history.map((message) => ({
              ...message
            })),
            tools: {
              definitions: tools
            },
            attachments: promptPayload.attachments ?? {
              imageAttachments: context.imageAttachments,
              textAttachments: context.textAttachments
            }
          },
          signal: controller.signal,
          samplingProfile: resolveModelSamplingProfile({ lane: 'tool_loop' }),
          thinkingEnabled: context.thinkingEnabled
        }));
        emitHarnessHook('after_model', {
          turnIndex,
          summary: turn.terminalState === 'error'
            ? 'Model turn returned an error'
            : `Model turn returned ${turn.toolCalls.length} tool call${turn.toolCalls.length === 1 ? '' : 's'}`,
          isError: turn.terminalState === 'error'
        });

        if (turn.contextWindowUsage) {
          callbacks.onInfo({
            contextWindow: {
              ...turn.contextWindowUsage,
              providerEventType:
                turn.contextWindowUsage.providerEventType ??
                createToolLoopActivityType(policy.providerEventTypePrefix, 'context_window_usage')
            }
          });
        }

        if (turn.terminalState === 'error') {
          const message = turn.errorMessage?.trim() || `${policy.providerLabel} returned an error.`;
          if (
            fallbackToRun
            && !controller.signal.aborted
            && !assistantText
            && !usedNativeWebResearchTool
            && !usedMutatingTool
            && policy.shouldFallbackFromTransportError?.(message)
          ) {
            callbacks.onInfo(
              policy.fallbackInfoMessage
                ?? `${policy.providerLabel} rejected the normalized transport. Falling back to the compatibility transport.`
            );
            fallbackHandle = await fallbackToRun(
              buildFallbackRunContext ? buildFallbackRunContext(context) : context,
              callbacks
            );
            return;
          }
          settleError(message);
          return;
        }

        for (const infoMessage of turn.infoMessages ?? []) {
          callbacks.onInfo(infoMessage);
        }

        let turnContent = turn.text;
        const turnToolCalls = turn.toolCalls;
        const recoverableToolCallContractViolation = turn.toolCallContractViolation?.recoverable
          ? turn.toolCallContractViolation
          : null;
        for (const toolCall of turnToolCalls) {
          appendUnique(parsedToolCallNames, toolCall.name);
          if (isFileContentMutationToolCall(toolCall.name)) {
            parsedFileContentMutationToolCallCount += 1;
          }
        }
        if (turnToolCalls.length > 0 && turnContent.trim()) {
          turnContent = policy.stripToolCallMarkup(turnContent);
        }

        if (turnContent || turnToolCalls.length > 0) {
          if (turn.providerDiagnostics) {
            callbacks.onInfo({
              providerDiagnostics: turn.providerDiagnostics
            });
          }

          if (turnContent && turnToolCalls.length > 0) {
            callbacks.onInfo({
              message: firstLineOf(turnContent),
              activity: {
                kind: 'thinking',
                summary: firstLineOf(turnContent),
                text: turnContent,
                providerEventType: createToolLoopActivityType(policy.providerEventTypePrefix, 'thinking')
              }
            });
          }

          if (turnContent && !recoverableToolCallContractViolation) {
            history.push({
              role: 'assistant',
              content: turnContent
            });
          }
        }

        const requiresWebResearchBeforeCompletion =
          turnToolCalls.length === 0
          && Boolean(turnContent.trim())
          && requiresNativeWebResearch
          && !usedNativeWebResearchTool;
        const assistantPromisesMutationBeforeCompletion =
          turnToolCalls.length === 0
          && Boolean(turnContent.trim())
          && policy.assistantSignalsPendingWorkspaceMutation(turnContent);
        const requiresMutationBeforeCompletion =
          turnToolCalls.length === 0
          && (Boolean(turnContent.trim()) || Boolean(recoverableToolCallContractViolation))
          && (
            (requiresWorkspaceMutation && !usedMutatingTool)
            || (requiresFileContentMutation && !usedFileContentMutationTool)
            || assistantPromisesMutationBeforeCompletion
          );
        const requiresVerificationBeforeCompletion =
          turnToolCalls.length === 0
          && Boolean(turnContent.trim())
          && requiresPostMutationVerification
          && usedAppliedMutatingTool
          && !postMutationVerificationPassed;
        const requiresStaticWebPageFileSetBeforeCompletion =
          turnToolCalls.length === 0
          && Boolean(turnContent.trim())
          && requiredStaticWebPageFileExtensions.length > 0
          && usedAppliedFileContentMutationTool
          && !staticWebPageFileSetPassed;
        const requiresWebImageArtifactBeforeCompletion =
          turnToolCalls.length === 0
          && Boolean(turnContent.trim())
          && requiresWebImageArtifactReference
          && usedAppliedFileContentMutationTool
          && !webImageArtifactReferencePassed;

        if (
          turnToolCalls.length === 0
          && turnContent
            && !requiresWebResearchBeforeCompletion
            && !requiresMutationBeforeCompletion
            && !requiresVerificationBeforeCompletion
            && !requiresStaticWebPageFileSetBeforeCompletion
            && !requiresWebImageArtifactBeforeCompletion
        ) {
          const next = policy.appendVisibleText(assistantText, turnContent);
          assistantText = next.text;
          if (next.delta) {
            callbacks.onDelta(next.delta);
          }
          repeatedStallTurns = 0;
          previousTurnSignature = null;
        }

        if (turnToolCalls.length === 0) {
          const contractReminder = recoverableToolCallContractViolation && requiresMutationBeforeCompletion
            ? policy.buildToolCallContractReminder?.({
              reason: recoverableToolCallContractViolation.reason,
              candidateToolName: recoverableToolCallContractViolation.candidateToolName,
              runMode: context.runMode
            })?.trim() || null
            : null;
          if (contractReminder) {
            if (requiredMutationReminderCount >= limits.maxRequiredMutationReminders) {
              settleMissingRequiredMutationError();
              return;
            }

            requiredMutationReminderCount += 1;
            assistantText = '';
            previousTurnSignature = null;
            repeatedStallTurns = 0;
            const reminderSummary = `Prompting ${policy.providerLabel} to re-emit a valid tool-call envelope.`;
            emitContinuationDecision({
              turnIndex,
              reason: 'required_mutation',
              reminderCount: requiredMutationReminderCount,
              maxReminderCount: limits.maxRequiredMutationReminders,
              summary: reminderSummary
            });
            pushThinkingReminder(
              history,
              contractReminder,
              reminderSummary
            );
            continue;
          }

          if (!turnContent.trim() && requiresNativeWebResearch && !usedNativeWebResearchTool) {
            if (requiredWebResearchReminderCount >= limits.maxRequiredWebResearchReminders) {
              settleError(policy.formatMissingRequiredWebResearchError());
              return;
            }

            requiredWebResearchReminderCount += 1;
            assistantText = '';
            previousTurnSignature = null;
            repeatedStallTurns = 0;
            const reminderSummary = `Prompting ${policy.providerLabel} to use native web research before answering.`;
            emitContinuationDecision({
              turnIndex,
              reason: 'required_web_research',
              reminderCount: requiredWebResearchReminderCount,
              maxReminderCount: limits.maxRequiredWebResearchReminders,
              summary: reminderSummary
            });
            pushThinkingReminder(
              history,
              policy.buildRequiredWebResearchReminder(),
              reminderSummary
            );
            continue;
          }

          if (
            !turnContent.trim()
            && (
              (requiresWorkspaceMutation && !usedMutatingTool)
              || (requiresFileContentMutation && !usedFileContentMutationTool)
            )
          ) {
            if (requiredMutationReminderCount >= limits.maxRequiredMutationReminders) {
              settleMissingRequiredMutationError();
              return;
            }

            requiredMutationReminderCount += 1;
            assistantText = '';
            previousTurnSignature = null;
            repeatedStallTurns = 0;
            const reminderSummary = context.runMode === 'plan'
              ? `Prompting ${policy.providerLabel} to continue until the planner state is updated.`
              : `Prompting ${policy.providerLabel} to continue until the requested workspace changes are complete.`;
            emitContinuationDecision({
              turnIndex,
              reason: 'required_mutation',
              reminderCount: requiredMutationReminderCount,
              maxReminderCount: limits.maxRequiredMutationReminders,
              summary: reminderSummary
            });
            pushThinkingReminder(
              history,
              policy.buildRequiredMutationReminder(requiredMutationReminderCount, context.runMode),
              reminderSummary
            );
            continue;
          }

          if (requiresWebResearchBeforeCompletion) {
            if (requiredWebResearchReminderCount >= limits.maxRequiredWebResearchReminders) {
              settleError(policy.formatMissingRequiredWebResearchError());
              return;
            }

            requiredWebResearchReminderCount += 1;
            assistantText = '';
            previousTurnSignature = null;
            repeatedStallTurns = 0;
            const reminderSummary = `Prompting ${policy.providerLabel} to use native web research before answering.`;
            emitContinuationDecision({
              turnIndex,
              reason: 'required_web_research',
              reminderCount: requiredWebResearchReminderCount,
              maxReminderCount: limits.maxRequiredWebResearchReminders,
              summary: reminderSummary
            });
            pushThinkingReminder(
              history,
              policy.buildRequiredWebResearchReminder(),
              reminderSummary
            );
            continue;
          }

          if (requiresMutationBeforeCompletion) {
            if (requiredMutationReminderCount >= limits.maxRequiredMutationReminders) {
              settleMissingRequiredMutationError();
              return;
            }

            requiredMutationReminderCount += 1;
            assistantText = '';
            previousTurnSignature = null;
            repeatedStallTurns = 0;
            const reminderSummary = context.runMode === 'plan'
              ? `Prompting ${policy.providerLabel} to continue until the planner state is updated.`
              : `Prompting ${policy.providerLabel} to continue until the requested workspace changes are complete.`;
            emitContinuationDecision({
              turnIndex,
              reason: 'required_mutation',
              reminderCount: requiredMutationReminderCount,
              maxReminderCount: limits.maxRequiredMutationReminders,
              summary: reminderSummary
            });
            pushThinkingReminder(
              history,
              policy.buildRequiredMutationReminder(requiredMutationReminderCount, context.runMode),
              reminderSummary
            );
            continue;
          }

          if (requiresStaticWebPageFileSetBeforeCompletion) {
            if (!hasToolCallName(activeToolCatalog, 'list_directory')) {
              settleError(`${policy.providerLabel} completed workspace changes without proving that all requested static page files exist.`);
              return;
            }

            const result = await agentRuntime.executeToolCall({
              name: 'list_directory',
              arguments: {
                path: '.'
              }
            }, buildAgentToolExecutionContext({
              callbacks,
              context,
              signal: controller.signal
            }));
            const extensions = result.isError ? new Set<string>() : listedFileExtensions(result.content);
            for (const extension of writtenFilePathExtensions(writtenFiles)) {
              extensions.add(extension);
            }
            staticWebPageFileSetPassed = requiredStaticWebPageFileExtensions.every((extension) => extensions.has(extension));
            if (staticWebPageFileSetPassed) {
              if (!requiresWebImageArtifactBeforeCompletion) {
                const next = policy.appendVisibleText(assistantText, turnContent);
                assistantText = next.text;
                if (next.delta) {
                  callbacks.onDelta(next.delta);
                }
              }
            } else {
              if (requiredStaticWebPageFileSetReminderCount >= limits.maxRequiredMutationReminders) {
                settleError(`${policy.providerLabel} completed workspace changes without creating all requested static page files.`);
                return;
              }

              requiredStaticWebPageFileSetReminderCount += 1;
              assistantText = '';
              previousTurnSignature = null;
              repeatedStallTurns = 0;
              const reminderSummary = `Prompting ${policy.providerLabel} to create all requested static page files.`;
              emitContinuationDecision({
                turnIndex,
                reason: 'missing_static_web_page_files',
                reminderCount: requiredStaticWebPageFileSetReminderCount,
                maxReminderCount: limits.maxRequiredMutationReminders,
                summary: reminderSummary
              });
              pushThinkingReminder(
                history,
                buildMissingStaticWebPageFileSetReminder(requiredStaticWebPageFileExtensions, result.content),
                reminderSummary
              );
              continue;
            }
          }

          if (requiresWebImageArtifactBeforeCompletion) {
            if (!hasToolCallName(activeToolCatalog, 'search_text')) {
              settleError(`${policy.providerLabel} completed workspace changes without proving that the generated page includes the requested Unsplash image URL.`);
              return;
            }

            const result = await agentRuntime.executeToolCall({
              name: 'search_text',
              arguments: {
                query: 'unsplash.com',
                max_results: 8
              }
            }, buildAgentToolExecutionContext({
              callbacks,
              context,
              signal: controller.signal
            }));
            webImageArtifactReferencePassed =
              !result.isError
              && !/\[no matches for "unsplash\.com"\]/iu.test(result.content);
            if (webImageArtifactReferencePassed) {
              const next = policy.appendVisibleText(assistantText, turnContent);
              assistantText = next.text;
              if (next.delta) {
                callbacks.onDelta(next.delta);
              }
            } else {
              if (requiredWebImageArtifactReminderCount >= limits.maxRequiredMutationReminders) {
                settleError(`${policy.providerLabel} completed workspace changes without including the requested Unsplash image URL in the generated files.`);
                return;
              }

              requiredWebImageArtifactReminderCount += 1;
              assistantText = '';
              previousTurnSignature = null;
              repeatedStallTurns = 0;
              const reminderSummary = `Prompting ${policy.providerLabel} to include the requested web image in the generated page.`;
              emitContinuationDecision({
                turnIndex,
                reason: 'missing_web_image_artifact',
                reminderCount: requiredWebImageArtifactReminderCount,
                maxReminderCount: limits.maxRequiredMutationReminders,
                summary: reminderSummary
              });
              pushThinkingReminder(
                history,
                buildMissingWebImageArtifactReminder(),
                reminderSummary
              );
              continue;
            }
          }

          if (requiresVerificationBeforeCompletion) {
            if (requiredVerificationReminderCount >= limits.maxRequiredMutationReminders) {
              settleError(`${policy.providerLabel} completed workspace changes without passing the requested post-edit verification command.`);
              return;
            }

            requiredVerificationReminderCount += 1;
            assistantText = '';
            previousTurnSignature = null;
            repeatedStallTurns = 0;
            const reminder = policy.buildRequiredPostMutationVerificationReminder(
              postMutationVerificationFailed,
              context.verificationPlan?.command ?? null
            );
            const reminderSummary = `Prompting ${policy.providerLabel} to verify the completed workspace changes.`;
            emitContinuationDecision({
              turnIndex,
              reason: 'required_post_mutation_verification',
              reminderCount: requiredVerificationReminderCount,
              maxReminderCount: limits.maxRequiredMutationReminders,
              summary: reminderSummary
            });
            emitHarnessHook('before_verification', {
              turnIndex,
              summary: 'Prompting model to run required post-mutation verification',
              verificationCommand: context.verificationPlan?.command ?? null,
              verificationStatus: postMutationVerificationStatus
            });
            pushThinkingReminder(
              history,
              reminder,
              reminderSummary
            );
            continue;
          }

          const previewValidationResult = await policy.runAppPreviewValidation?.({
            agentRuntime,
            context,
            callbacks,
            activeToolCatalog,
            usedMutatingTool: usedAppliedMutatingTool,
            usedBrowserPreviewTool,
            signal: controller.signal
          });
          if (previewValidationResult) {
            usedBrowserPreviewTool = true;
            assistantText = '';
            previousTurnSignature = null;
            repeatedStallTurns = 0;
            history.push({
              role: 'user',
              content: `Tool result for browser_preview_check:\n${previewValidationResult.isError
                ? `Tool error: ${previewValidationResult.content}`
                : policy.formatToolResultForModel(activeToolCatalog, 'browser_preview_check', previewValidationResult.content, false)}`
            });
            if (policy.buildPreviewValidationSummaryPrompt) {
              history.push({
                role: 'user',
                content: policy.buildPreviewValidationSummaryPrompt(previewValidationResult)
              });
            }
            continue;
          }

          const finalAssistantText = assistantText.trim();
          if (!finalAssistantText) {
            settleError(`${policy.providerLabel} completed without producing assistant output.`);
            return;
          }

          emitHarnessHook('before_finalize', {
            turnIndex,
            summary: 'Final assistant output is ready'
          });
          emitFinalEvidenceSummary({
            activeToolCatalog,
            requiresPostMutationVerification: requiresPostMutationVerification && usedAppliedMutatingTool
          });
          settleComplete(await finalizeAssistantOutput(context, finalAssistantText));
          return;
        }

        const toolResults: Array<{ toolName: string; content: string; isError: boolean }> = [];
        for (const toolCall of turnToolCalls) {
          const verificationCommandAfterMutation =
            usedAppliedMutatingTool && policy.isVerificationCommandToolCall(toolCall);
          const plannedVerificationCommandAfterMutation = isPlannedPostMutationVerificationCommand({
            plan: context.verificationPlan,
            toolCall,
            usedMutatingTool: usedAppliedMutatingTool
          });
          const fileContentMutationToolCall = isFileContentMutationToolCall(toolCall.name);
          const mutatingToolCall = policy.isMutatingToolCall(activeToolCatalog, toolCall.name);
          if (policy.isUntrustedToolResult(activeToolCatalog, toolCall.name)) {
            usedNativeWebResearchTool = true;
          }
          if (toolCall.name === 'browser_preview_check') {
            usedBrowserPreviewTool = true;
          }
          const toolCallSignature = mutatingToolCall
            ? policy.buildToolCallSignature([toolCall])
            : null;
          if (toolCallSignature && successfulMutatingToolCallSignatures.has(toolCallSignature)) {
            const toolLabel = policy.formatToolLabel(toolCall.name);
            const summary = `Skipped duplicate ${toolLabel}`;
            const content = `Duplicate mutating tool call suppressed: ${toolLabel} already completed successfully earlier in this run with the same arguments. Continue from the earlier result instead of repeating the same tool call.`;
            emitHarnessHook('after_tool', {
              turnIndex,
              toolName: toolCall.name,
              summary,
              isError: false,
              mutatesWorkspace: true
            });
            callbacks.onInfo({
              message: summary,
              activity: {
                kind: 'tool_result',
                summary,
                toolName: toolCall.name,
                status: 'skipped',
                text: content,
                providerEventType: createToolLoopActivityType(policy.providerEventTypePrefix, 'tool_result')
              }
            });
            toolResults.push({
              toolName: toolCall.name,
              content,
              isError: false
            });
            history.push({
              role: 'user',
              content: `Tool result for ${toolCall.name}:\n${content}`
            });
            continue;
          }

          emitHarnessHook('before_tool', {
            turnIndex,
            toolName: toolCall.name,
            summary: `Calling ${policy.formatToolLabel(toolCall.name)}`,
            mutatesWorkspace: mutatingToolCall
          });
          if (plannedVerificationCommandAfterMutation) {
            emitHarnessHook('before_verification', {
              turnIndex,
              toolName: toolCall.name,
              summary: 'Calling planned post-mutation verification command',
              verificationCommand: readToolCommandArgument(toolCall) ?? context.verificationPlan?.command ?? null,
              verificationStatus: postMutationVerificationStatus
            });
          }
          callbacks.onInfo({
            message: `Calling ${policy.formatToolLabel(toolCall.name)}`,
            activity: {
              kind: 'tool_call',
              summary: `Calling ${policy.formatToolLabel(toolCall.name)}`,
              toolName: toolCall.name,
              status: 'started',
              providerEventType: createToolLoopActivityType(policy.providerEventTypePrefix, 'tool_call')
            }
          });

          const toolStartedMs = Date.now();
          const toolStartedAt = new Date(toolStartedMs).toISOString();
          executedToolCallCount += 1;
          const result = await agentRuntime.executeToolCall(toolCall, buildAgentToolExecutionContext({
            callbacks,
            context,
            signal: controller.signal
          }));
          const toolFinishedMs = Date.now();
          const toolFinishedAt = new Date(toolFinishedMs).toISOString();
          const stagedWorkspaceChangeSet = !result.isError ? result.stagedWorkspaceChangeSet ?? null : null;
          emitHarnessHook('after_tool', {
            turnIndex,
            toolName: toolCall.name,
            summary: `${result.isError ? 'Failed' : 'Completed'} ${policy.formatToolLabel(toolCall.name)}`,
            isError: Boolean(result.isError),
            mutatesWorkspace: mutatingToolCall
          });
          if (result.isError) {
            emitHarnessHook('on_tool_error', {
              turnIndex,
              toolName: toolCall.name,
              summary: `Tool error from ${policy.formatToolLabel(toolCall.name)}`,
              isError: true,
              mutatesWorkspace: mutatingToolCall
            });
          }
          if (stagedWorkspaceChangeSet) {
            callbacks.onInfo({
              eventKind: 'debug_detail',
              transcriptVisible: false,
              stagedWorkspaceChangeSet
            });
          }

          const formattedContent = result.isError
            ? `Tool error: ${result.content}`
            : policy.formatToolResultForModel(activeToolCatalog, toolCall.name, result.content, false);
          toolResults.push({
            toolName: toolCall.name,
            content: result.content,
            isError: Boolean(result.isError)
          });
          if (mutatingToolCall && !result.isError) {
            if (toolCallSignature) {
              successfulMutatingToolCallSignatures.add(toolCallSignature);
            }
            usedMutatingTool = true;
            if (!stagedWorkspaceChangeSet) {
              usedAppliedMutatingTool = true;
              emitHarnessHook('after_mutation', {
                turnIndex,
                toolName: toolCall.name,
                summary: `Completed mutating tool ${policy.formatToolLabel(toolCall.name)}`,
                mutatesWorkspace: true
              });
            }
          }
          if (fileContentMutationToolCall && !result.isError) {
            usedFileContentMutationTool = true;
            if (!stagedWorkspaceChangeSet) {
              usedAppliedFileContentMutationTool = true;
              appendUnique(writtenFiles, readToolPathArgument(toolCall));
            }
          }
          if (toolCall.name === 'mkdir' && !result.isError && !stagedWorkspaceChangeSet) {
            appendUnique(createdDirectories, readToolPathArgument(toolCall));
          }
          if (verificationCommandAfterMutation) {
            postMutationVerificationPassed = !result.isError;
            postMutationVerificationFailed = Boolean(result.isError);
          }
          if (plannedVerificationCommandAfterMutation && context.verificationPlan) {
            const verificationArtifact = createVerificationArtifactFromRunCommandResult({
              command: readToolCommandArgument(toolCall) ?? context.verificationPlan.command ?? '',
              durationMs: Math.max(0, toolFinishedMs - toolStartedMs),
              finishedAt: toolFinishedAt,
              isError: Boolean(result.isError),
              plan: context.verificationPlan,
              resultContent: result.content,
              startedAt: toolStartedAt
            });
            postMutationVerificationStatus = verificationArtifact.status;
            callbacks.onInfo({
              eventKind: 'debug_detail',
              transcriptVisible: false,
              verificationArtifact
            });
            emitHarnessHook('after_verification', {
              turnIndex,
              toolName: toolCall.name,
              summary: `Verification ${verificationArtifact.status}`,
              isError: verificationArtifact.status !== 'passed',
              verificationCommand: verificationArtifact.command,
              verificationStatus: verificationArtifact.status
            });
          } else if (verificationCommandAfterMutation) {
            postMutationVerificationStatus = result.isError ? 'failed' : 'passed';
          }

          const sources = policy.isUntrustedToolResult(activeToolCatalog, toolCall.name) && !result.isError
            ? extractThreadSourcesFromText(result.content)
            : [];
          callbacks.onInfo({
            message: `${result.isError ? 'Failed' : 'Completed'} ${policy.formatToolLabel(toolCall.name)}`,
            activity: {
              kind: 'tool_result',
              summary: `${result.isError ? 'Failed' : 'Completed'} ${policy.formatToolLabel(toolCall.name)}`,
              toolName: toolCall.name,
              status: result.isError ? 'error' : 'completed',
              text: result.isError ? result.content : null,
              sources,
              providerEventType: createToolLoopActivityType(policy.providerEventTypePrefix, 'tool_result')
            }
          });

          history.push({
            role: 'user',
            content: `Tool result for ${toolCall.name}:\n${formattedContent}`
          });
        }

        const turnSignature = JSON.stringify({
          toolCalls: policy.buildToolCallSignature(turnToolCalls),
          toolResults: policy.buildToolResultSignature(toolResults),
          visibleContent: turnContent.trim()
        });
        if (!turnContent.trim() && turnSignature === previousTurnSignature) {
          repeatedStallTurns += 1;
        } else {
          repeatedStallTurns = 0;
          previousTurnSignature = turnSignature;
        }

        if (repeatedStallTurns >= limits.maxStalledToolTurns) {
          settleError(policy.formatStallError());
          return;
        }
      }

      settleError(policy.formatLimitError(limits.maxTurns));
    } catch (error) {
      if (controller.signal.aborted) {
        settleAbort(`${policy.providerLabel} run was stopped.`);
        return;
      }
      settleError(policy.formatTransportError(error, context, limits.maxRuntimeMs));
    }
  })();

  return {
    runId: context.runId,
    cancel: async (reason) => {
      if (fallbackHandle) {
        await fallbackHandle.cancel(reason);
        return;
      }
      controller.abort();
      settleAbort(reason ?? `${policy.providerLabel} run was stopped.`);
    }
  };
}
