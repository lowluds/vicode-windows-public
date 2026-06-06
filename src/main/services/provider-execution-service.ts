import { randomUUID } from 'node:crypto';
import type { AgentToolExecutionResult } from '../../providers/agent-runtime';
import type {
  ProviderAdapter,
  ProviderInfoPayload,
  ProviderRunCallbacks,
  ProviderRunContext,
  ProviderRunHandle
} from '../../providers/types';
import { RetiredProviderAdapter } from '../../providers/retired-adapter';
import type {
  AutonomyDelegationProfile,
  ComposerSubmitInput,
  PlannerPlan,
  PlannerQuestionAnswer,
  Project,
  ProviderId,
  RunEvent,
  RunProgressState,
  RunToolApprovalRequest,
  RunToolApprovalRequestInput,
  ThreadDetail
} from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import {
  decodeOllamaModelId,
  providerCapabilities,
  providerDisplayName,
  providerRetiredMessage,
  resolveOllamaApiKeyForModel
} from '../../shared/providers';
import { decodeCustomProviderModelId } from '../../shared/custom-provider-routing';
import {
  deriveRunProgressFromPlanner,
  deriveRunProgressFromResolvedTaskPacket,
  shouldAdvanceRunProgressFromActivity
} from '../../shared/run-progress';
import { deriveHarnessTaskContract } from '../../shared/harness-task-contract';
import { resolveConversationTaskPacket } from '../../shared/conversation-task-resolver';
import { DatabaseService } from '../../storage/database';
import { captureWorkspaceSnapshot } from './workspace-changes';
import { deriveWorkspaceVerificationPlan } from './provider-verification-plan';
import { normalizeProviderInfoEvent } from './provider-run-event-normalizer';
import { createProviderReplyAssembly } from './provider-reply-assembly';
import { formatProviderCompletionOutput, resolveProviderCompletionText } from './provider-completion-output';
import {
  buildEffectivePrompt,
  formatDisclosureReferences,
  formatApprovedPlanExecutionContract,
} from './provider-manager-prompt-builder';
import { resolveExecutionContinuity } from './provider-manager-continuity';
import type { VicodeGuidanceContext } from './vicode-guidance';
import type { ProviderModelExecutionService } from './provider-model-execution-service';
import type { ThreadContextCompactionTriggerInput } from './thread-context-compaction-trigger';
import {
  legacyProviderRuntimeAuthority,
  usesAppToolApprovalAuthority
} from './provider-model-runtime-authority';
import {
  buildProviderCompatibilityDispatchTraceDetail,
  resolveProviderCompatibilityDispatchPolicy
} from './provider-compatibility-dispatch-policy';
import type { ToolApprovalRequestOptions } from './tool-approval-service';
import {
  resolveProviderExecutionWorkspace,
  type ProviderExecutionWorkspaceHost
} from './provider-execution-workspace';
import {
  assembleProviderExecutionContext,
  buildProviderExecutionWorkspaceContextTraceDetail,
  type ProviderExecutionContextHost
} from './provider-execution-context';
import {
  buildProviderExecutionAbortedFinalization,
  buildProviderExecutionCleanupSuccessFinalization,
  buildProviderExecutionEmptyOutputFailure,
  buildProviderExecutionFailedFinalization,
  buildProviderExecutionSuccessFinalization,
  resolveProviderExecutionApprovedPlan,
  resolveProviderExecutionTitlePrompt,
  type ProviderExecutionFinalizationHost
} from './provider-execution-finalization';

const OLLAMA_IMAGE_REVIEW_TIMEOUT_MS = 1000 * 60 * 2;
const APPROVED_PLAN_TASK_PROMPT = 'Implement the approved plan to completion.';

export interface ExecutionContext {
  approvedPlan?: PlannerPlan | null;
  plannerAnswers?: Record<string, PlannerQuestionAnswer> | null;
  contextProfile?: 'main' | 'delegated';
  includeMemory?: boolean;
  includeGeneratedMemory?: boolean;
  delegation?: {
    mode: 'background';
    profile: AutonomyDelegationProfile;
    title: string;
  } | null;
}

export interface ProviderExecutionProgressHost {
  createBackgroundDelegationRunProgress(
    runId: string,
    threadId: string,
    providerId: ProviderId,
    delegation: NonNullable<ExecutionContext['delegation']>
  ): RunProgressState;
  recordInfoEvent(threadId: string, runId: string, normalizedInfo: ReturnType<typeof normalizeProviderInfoEvent>): RunEvent | null;
  publishProviderRunProgress(runId: string, progress: RunProgressState): void;
  advanceRunProgress(runId: string): void;
  refreshDerivedRunProgress(threadId: string, runId: string, providerId: ProviderId, modelId: string): void;
  maybeCreateThreadContextCompactionFromContextUsage(input: ThreadContextCompactionTriggerInput): void;
}

export interface ProviderExecutionToolHost {
  usesAppAuthoritativeToolApproval(providerId: ProviderId): boolean;
  requestToolApproval(
    request: RunToolApprovalRequestInput,
    runtimeCommandPolicy: Project['runtimeCommandPolicy'],
    options?: ToolApprovalRequestOptions
  ): Promise<'approved' | 'rejected' | 'cancelled'>;
  executeProviderRuntimeToolCall(input: {
    call: Record<string, unknown>;
    workspaceRoot: string;
    trustedWorkspace: boolean;
    threadId: string;
    runId: string;
    providerId: ProviderId;
    appAuthoritativeToolApproval?: boolean;
    executionPermission: ComposerSubmitInput['executionPermission'];
    executionConstraints: ComposerSubmitInput['executionConstraints'];
    runtimeCommandPolicy: Project['runtimeCommandPolicy'];
    runtimeNetworkPolicy: Project['runtimeNetworkPolicy'];
    onInfo: (payload: ProviderInfoPayload) => void;
  }): Promise<Record<string, unknown>>;
}

export interface ProviderExecutionServiceHost
  extends ProviderExecutionWorkspaceHost,
    ProviderExecutionContextHost,
    ProviderExecutionProgressHost,
    ProviderExecutionToolHost,
    ProviderExecutionFinalizationHost {
  adapters: Record<ProviderId, ProviderAdapter>;
  db: DatabaseService;
  providerModelExecutionService: ProviderModelExecutionService;
  isDisposed(): boolean;
  assertProviderRunPermission(providerId: ProviderId, executionPermission: ComposerSubmitInput['executionPermission']): void;
  assertProviderProjectContext(providerId: ProviderId, folderPath: string | null, trusted: boolean): void;
  createMemoryRecallActivity(
    memoryBlocks: Array<{ fileName: string }>,
    generatedMemoryBlocks: Array<{ itemId: string }>
  ): import('../../shared/domain').RunActivityInfo | null;
  createProjectKnowledgeActivity?(
    projectKnowledgeBlocks: Array<{
      title: string;
      relativePath: string;
      heading: string | null;
      path: string;
      retrievalReason: { reason: string };
    }>,
    routerEvidence?: { reason: string } | null
  ): import('../../shared/domain').RunActivityInfo | null;
  createSkillActivity?(
    workspaceContext: {
      selectedSkillIds: string[];
      autoSelectedSkillIds?: string[];
      mentionedSkillIds?: string[];
    }
  ): import('../../shared/domain').RunActivityInfo | null;
  resolveVicodeGuidance(input: {
    prompt: string;
    selectedSkillIds: string[];
  }): VicodeGuidanceContext | null;
  resolveExecutionModelId(
    providerId: ProviderId,
    requestedModelId: string,
    imageAttachments: ComposerSubmitInput['imageAttachments']
  ): Promise<string>;
  resolveImageAttachmentRouting(
    providerId: ProviderId,
    executionModelId: string,
    imageAttachments: ComposerSubmitInput['imageAttachments']
  ): Promise<{
    needsInternalReview: boolean;
    reviewModelId: string | null;
    passImagesToExecution: boolean;
  }>;
  decryptApiKey(encrypted: string): string;
  resolveOllamaTransportMode(providerId: ProviderId): string | undefined;
  collectAssistantText(threadId: string, runId: string): string;
  collectRunDeltaText(threadId: string, runId: string): string;
  emit(event: AppEvent): void;
  onRunRegistered(runId: string, handle: ProviderRunHandle, threadId: string): void;
}

function buildProviderRunSourcePrompt(prompt: string, approvedPlan?: PlannerPlan | null) {
  if (!approvedPlan) {
    return prompt;
  }

  return [
    APPROVED_PLAN_TASK_PROMPT,
    formatApprovedPlanExecutionContract(approvedPlan)
  ].join('\n\n');
}

export class ProviderExecutionService {
  constructor(private readonly host: ProviderExecutionServiceHost) {}

  private buildTaskPolicyWaitMessage(
    packet: NonNullable<ReturnType<typeof resolveConversationTaskPacket>>
  ): string | null {
    switch (packet.executionPolicy) {
      case 'ask_clarifying_question':
        return packet.clarificationQuestion
          ?? 'What should I implement, and what outcome should I verify?';
      case 'approval_required':
        return [
          packet.riskReason ?? 'This task needs confirmation before execution.',
          'Reply with explicit confirmation if you want me to proceed.'
        ].join(' ');
      case 'scope_replan':
        return 'The task scope changed enough that I should re-plan before continuing. Tell me what to keep or change.';
      default:
        return null;
    }
  }

  private recordInternalGuidanceEvent(threadId: string, runId: string, guidanceReferences: string[]) {
    if (guidanceReferences.length === 0) {
      return;
    }

    const visibleReferences = guidanceReferences.slice(0, 10);
    const remainingCount = guidanceReferences.length - visibleReferences.length;
    const referenceText = remainingCount > 0
      ? `${visibleReferences.join(', ')}, and ${remainingCount} more`
      : visibleReferences.join(', ');
    const summary = `Context: ${referenceText}`;
    const event = this.host.db.addRunEvent(threadId, runId, 'info', {
      transcriptVisible: false,
      activity: {
        kind: 'guidance',
        summary,
        text: summary,
        providerEventType: 'vicode_guidance_context'
      }
    });
    this.host.emit({ type: 'raw.event', event });
  }

  private buildOllamaImageReviewPrompt(userPrompt: string, imageCount: number) {
    return [
      'You are Vicode\'s internal image reviewer.',
      `Review the attached ${imageCount === 1 ? 'image' : `${imageCount} images`} for another coding agent.`,
      'Do not write code. Do not propose implementation steps. Do not claim files were changed.',
      'Return concise visual evidence only:',
      '- image type or screen type',
      '- visible UI, layout, colors, spacing, or error details',
      '- any visible text that matters',
      '- how the image relates to the user request',
      '',
      'User request:',
      userPrompt
    ].join('\n');
  }

  private async reviewOllamaImages(input: {
    adapter: ProviderAdapter;
    threadId: string;
    runId: string;
    prompt: string;
    imageAttachments: NonNullable<ComposerSubmitInput['imageAttachments']>;
    reviewModelId: string;
    apiKey: string | null;
  }) {
    this.host.recordRuntimeTraceMark(input.threadId, input.runId, 'image_review_started', {
      providerId: 'ollama',
      modelId: input.reviewModelId,
      imageCount: input.imageAttachments.length
    });

    let handle: ProviderRunHandle | null = null;
    let deltaText = '';
    let settled = false;

    const reviewText = await new Promise<string>((resolve, reject) => {
      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        callback();
      };
      const timeout = setTimeout(() => {
        void handle?.cancel('Image review timed out.');
        finish(() => reject(new Error('Ollama image review timed out before the coding model could start.')));
      }, OLLAMA_IMAGE_REVIEW_TIMEOUT_MS);

      input.adapter.startRun(
        {
          threadId: input.threadId,
          runId: `${input.runId}:image-review`,
          prompt: this.buildOllamaImageReviewPrompt(input.prompt, input.imageAttachments.length),
          sourcePrompt: 'Review attached image for the coding agent.',
          imageAttachments: input.imageAttachments,
          textAttachments: [],
          modelId: input.reviewModelId,
          reasoningEffort: null,
          thinkingEnabled: false,
          executionConstraints: null,
          resumeSessionId: null,
          folderPath: null,
          trusted: false,
          apiKey: input.apiKey,
          runMode: 'default',
          executionPermission: 'default',
          runtimeCommandPolicy: 'approval_required',
          runtimeNetworkPolicy: 'disabled',
          ollamaTransportMode: 'chat',
          runtimeSkillResources: [],
          skipFinalAnswerRewrite: true
        },
        {
          onStart: () => {},
          onDelta: (delta) => {
            deltaText += delta;
          },
          onAssistantSnapshot: (snapshot) => {
            deltaText = snapshot;
          },
          onInfo: () => {},
          onComplete: (output) => {
            const text = output.trim() || deltaText.trim();
            if (!text) {
              finish(() => reject(new Error('Ollama image review completed without visual context.')));
              return;
            }
            finish(() => resolve(text));
          },
          onError: (message) => {
            finish(() => reject(new Error(message || 'Ollama image review failed.')));
          },
          onAbort: (message) => {
            finish(() => reject(new Error(message || 'Ollama image review was stopped.')));
          }
        }
      )
        .then((nextHandle) => {
          handle = nextHandle;
        })
        .catch((error) => {
          finish(() => reject(error));
        });
    });

    this.host.recordRuntimeTraceMark(input.threadId, input.runId, 'image_review_completed', {
      providerId: 'ollama',
      modelId: input.reviewModelId,
      imageCount: input.imageAttachments.length,
      reviewLength: reviewText.length
    });

    return reviewText;
  }

  async startExecutionRun(
    input: ComposerSubmitInput,
    thread: ThreadDetail,
    project: Project,
    executionContext: ExecutionContext,
    userTurnMetadata: Record<string, unknown> | null = null,
    shouldGenerateTitle = false
  ): Promise<{ thread: ThreadDetail; runId: string }> {
    const adapter = this.host.adapters[input.providerId];
    const preferences = this.host.db.getPreferences();
    this.host.assertProviderRunPermission(input.providerId, input.executionPermission);
    this.host.assertProviderProjectContext(input.providerId, project.folderPath, project.trusted);
    const runId = randomUUID();
    const approvedPlan = resolveProviderExecutionApprovedPlan(executionContext);
    const titlePrompt = resolveProviderExecutionTitlePrompt({
      shouldGenerateTitle,
      prompt: input.prompt
    });
    this.host.recordRuntimeTraceMark(thread.id, runId, 'submit_received', {
      providerId: input.providerId,
      threadId: thread.id,
      hasTrustedWorkspace: project.trusted,
      hasFolderPath: Boolean(project.folderPath)
    });
    this.host.recordRuntimeTraceMark(thread.id, runId, 'workspace_context_started', {
      includeRuntimeSkills: providerCapabilities(input.providerId).supportsRuntimeSkillResources,
      contextProfile: executionContext.contextProfile ?? 'main'
    });
    const {
      sourceWorkspaceRoot,
      runtimeWorkspaceRoot,
      harnessWorktreeSession
    } = await resolveProviderExecutionWorkspace({
      composerInput: input,
      project,
      runId,
      threadId: thread.id,
      host: this.host
    });
    const taskContractPrompt = buildProviderRunSourcePrompt(input.prompt, executionContext.approvedPlan);
    const harnessTaskContract = deriveHarnessTaskContract({
      prompt: taskContractPrompt,
      mode: input.runMode ?? 'default',
      workspaceRoot: runtimeWorkspaceRoot,
      executionPermission: input.executionPermission,
      isolationMode: input.isolationMode ?? 'direct_workspace',
      trustedWorkspace: project.trusted,
      runtimeCommandPolicy: project.runtimeCommandPolicy,
      runtimeNetworkPolicy: project.runtimeNetworkPolicy
    });
    const verificationPlan = deriveWorkspaceVerificationPlan({
      workspaceRoot: runtimeWorkspaceRoot,
      executionPermission: input.executionPermission,
      runtimeNetworkPolicy: project.runtimeNetworkPolicy
    });
    const rawResolvedTaskPacket = resolveConversationTaskPacket({
      prompt: taskContractPrompt,
      turns: thread.turns,
      taskContract: harnessTaskContract
    });
    const resolvedTaskPacket = rawResolvedTaskPacket && executionContext.approvedPlan
      ? {
          ...rawResolvedTaskPacket,
          executionPolicy: 'auto_execute' as const,
          riskReason: undefined
        }
      : rawResolvedTaskPacket;
    const {
      workspaceContext,
      generatedMemoryBlocks,
      generatedMemoryTraceDetail
    } = assembleProviderExecutionContext({
      composerInput: input,
      thread,
      runtimeWorkspaceRoot,
      trusted: project.trusted,
      executionContext,
      preferences,
      resolvedTaskPacket,
      host: this.host
    });
    this.host.recordRuntimeTraceMark(
      thread.id,
      runId,
      'workspace_context_completed',
      buildProviderExecutionWorkspaceContextTraceDetail({
        workspaceContext,
        generatedMemoryTraceDetail,
        harnessTaskContract,
        verificationPlan,
        resolvedTaskPacket
      })
    );
    this.host.db.appendTurn(thread.id, 'user', input.prompt, {
      skillIds: workspaceContext.selectedSkillIds,
      imageAttachments: input.imageAttachments ?? [],
      textAttachments: input.textAttachments ?? [],
      executionPermission: input.executionPermission,
      ...(userTurnMetadata ?? {}),
      harnessTaskContract,
      ...(resolvedTaskPacket ? { resolvedTaskPacket } : {}),
      verificationPlan
    });

    const policyWaitMessage = resolvedTaskPacket && !executionContext.approvedPlan
      ? this.buildTaskPolicyWaitMessage(resolvedTaskPacket)
      : null;
    if (policyWaitMessage) {
      this.host.recordRuntimeTraceMark(thread.id, runId, 'task_execution_policy_waiting', {
        executionPolicy: resolvedTaskPacket?.executionPolicy,
        confidence: resolvedTaskPacket?.confidence,
        objective: resolvedTaskPacket?.objective,
        riskReason: resolvedTaskPacket?.riskReason ?? null,
        clarificationQuestion: resolvedTaskPacket?.clarificationQuestion ?? null
      });
      this.host.db.updateAssistantTurn(runId, thread.id, policyWaitMessage, {
        resolvedTaskPacket,
        taskExecutionPolicy: resolvedTaskPacket.executionPolicy
      });
      this.host.db.addRunEvent(thread.id, runId, 'delta', { delta: policyWaitMessage });
      this.host.db.updateThreadStatus(thread.id, 'completed');
      this.host.emit({ type: 'run.replace', threadId: thread.id, runId, text: policyWaitMessage });
      this.host.emit({ type: 'run.status', threadId: thread.id, runId, status: 'completed', message: policyWaitMessage });
      return { thread: this.host.db.getThread(thread.id), runId };
    }

    this.host.db.updateThreadStatus(thread.id, 'queued');

    const customProviderRoute =
      input.providerId === 'openai_compatible'
        ? decodeCustomProviderModelId(input.modelId)
        : null;
    const account = input.providerId === 'openai_compatible' ? null : this.host.db.getProviderAccount(input.providerId);
    const auth = input.providerId === 'openai_compatible'
      ? { authState: 'connected' as const, authMode: 'api_key' as const }
      : await adapter.getAuthState(account);
    const explicitOpenAiApiKeyAuth = input.providerId === 'openai' && account?.authMode === 'api_key' && Boolean(account.encryptedApiKey);
    const authMode = explicitOpenAiApiKeyAuth ? 'api_key' : auth.authMode;
    const providerApiKey = input.providerId === 'openai_compatible'
      ? null
      : authMode === 'api_key' && account?.encryptedApiKey
        ? this.host.decryptApiKey(account.encryptedApiKey)
        : null;
    const resolvedModelId = await this.host.resolveExecutionModelId(input.providerId, input.modelId, input.imageAttachments ?? []);
    const modelId = input.providerId === 'ollama' ? decodeOllamaModelId(resolvedModelId) : resolvedModelId;
    const apiKey =
      input.providerId === 'ollama'
        ? resolveOllamaApiKeyForModel(resolvedModelId, providerApiKey)
        : providerApiKey;
    const imageAttachments = input.imageAttachments ?? [];
    let executionImageAttachments = imageAttachments;
    let imageReviewText: string | null = null;

    try {
      const imageRouting = await this.host.resolveImageAttachmentRouting(input.providerId, resolvedModelId, imageAttachments);
      executionImageAttachments = imageRouting.passImagesToExecution ? imageAttachments : [];

      if (imageRouting.needsInternalReview) {
        if (!imageRouting.reviewModelId) {
          throw new Error('This Ollama model cannot read images, and no vision-capable Ollama model is available for image review.');
        }

        imageReviewText = await this.reviewOllamaImages({
          adapter,
          threadId: thread.id,
          runId,
          prompt: input.prompt,
          imageAttachments,
          reviewModelId: imageRouting.reviewModelId,
          apiKey
        });
      }
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'Ollama image review failed before the coding model could start.';
      this.host.recordRuntimeTraceMark(thread.id, runId, 'image_review_failed', { message });
      this.host.finalizeExecutionRunFailure(buildProviderExecutionFailedFinalization({
        threadId: thread.id,
        runId,
        message,
        tracePayload: { message },
        approvedPlan,
        titlePrompt
      }));
      return { thread: this.host.db.getThread(thread.id), runId };
    }

    const continuity =
      executionContext.contextProfile === 'delegated' && executionContext.delegation?.mode === 'background'
        ? { strategy: 'none' as const, resumeSessionId: null, includeInlineThreadHistory: false }
        : resolveExecutionContinuity(input.providerId, thread);
    const vicodeGuidance = this.host.resolveVicodeGuidance({
      prompt: input.prompt,
      selectedSkillIds: workspaceContext.selectedSkillIds
    });
    const disclosureReferences = formatDisclosureReferences(vicodeGuidance, workspaceContext as never);
    const threadCompaction = this.host.db.getLatestThreadCompaction(thread.id);
    const effectivePrompt = buildEffectivePrompt({ ...input, imageReviewText }, workspaceContext as never, {
      approvedPlan: executionContext.approvedPlan ?? null,
      approvedPlanMarkdown: executionContext.approvedPlan?.proposedPlanMarkdown ?? null,
      plannerAnswers: executionContext.plannerAnswers ?? null,
      thread,
      threadCompaction,
      continuity,
      resolvedTaskPacket,
      vicodeGuidance
    });
    this.host.recordRuntimeTraceMark(thread.id, runId, 'prompt_assembled', {
      promptLength: effectivePrompt.length,
      workspaceBlockCount: workspaceContext.blocks.length,
      memoryBlockCount: workspaceContext.memoryBlocks.length,
      generatedMemoryBlockCount: generatedMemoryBlocks.length,
      projectKnowledgeBlockCount: workspaceContext.projectKnowledgeBlocks?.length ?? 0,
      skillBlockCount: workspaceContext.skillBlocks.length,
      runtimeSkillResourceCount: workspaceContext.runtimeSkillResources.length,
      vicodeContextReferenceCount: disclosureReferences.contextReferences.length,
      vicodeCapabilityUsingCount: disclosureReferences.usingReferences.length,
      vicodeGuidanceDocumentCount: vicodeGuidance?.documents.length ?? 0,
      ...generatedMemoryTraceDetail
    });
    const workspaceSnapshot = captureWorkspaceSnapshot(runtimeWorkspaceRoot);
    const initialRunProgress =
      executionContext.approvedPlan
        ? deriveRunProgressFromPlanner(executionContext.approvedPlan, 'executing_from_plan', runId, thread.id)
        : executionContext.delegation?.mode === 'background'
          ? this.host.createBackgroundDelegationRunProgress(runId, thread.id, input.providerId, executionContext.delegation)
          : deriveRunProgressFromResolvedTaskPacket(resolvedTaskPacket, runId, thread.id);
    let sawFirstDelta = false;
    let sawFirstToolCall = false;
    let sawFirstToolResult = false;
    let runCallbacksClosed = false;
    const isRunCallbackOpen = () => !runCallbacksClosed && !this.host.isDisposed();
    const closeRunCallbacks = () => {
      if (!isRunCallbackOpen()) {
        return false;
      }
      runCallbacksClosed = true;
      return true;
    };
    const stoppedToolResult = (call: { name: string }): AgentToolExecutionResult => ({
      toolName: call.name,
      content: 'Run was stopped before this tool could execute.',
      isError: true
    });

    try {
      const runMode = input.runMode ?? 'default';
      this.host.recordRuntimeTraceMark(thread.id, runId, 'provider_dispatch_started', {
        modelId,
        authMode,
        runMode
      });
      const handleProviderInfo = (payload: ProviderInfoPayload) => {
        if (!isRunCallbackOpen()) {
          return;
        }
        const normalizedInfo = normalizeProviderInfoEvent(input.providerId, payload);
        const event = this.host.recordInfoEvent(thread.id, runId, normalizedInfo);
        if (normalizedInfo.providerProgress) {
          this.host.publishProviderRunProgress(runId, normalizedInfo.providerProgress);
        } else if (shouldAdvanceRunProgressFromActivity(normalizedInfo.activity)) {
          this.host.advanceRunProgress(runId);
        }
        this.host.refreshDerivedRunProgress(thread.id, runId, input.providerId, modelId);
        if (normalizedInfo.contextWindow) {
          this.host.maybeCreateThreadContextCompactionFromContextUsage({
            threadId: thread.id,
            runId,
            providerId: input.providerId,
            modelId,
            contextWindow: normalizedInfo.contextWindow
          });
        }
        if (normalizedInfo.activity?.kind === 'tool_call' && !sawFirstToolCall) {
          sawFirstToolCall = true;
          this.host.recordRuntimeTraceMark(thread.id, runId, 'first_tool_call', {
            ...generatedMemoryTraceDetail,
            toolName: normalizedInfo.activity.toolName ?? null,
            summary: normalizedInfo.activity.summary,
            command: normalizedInfo.activity.command ?? null,
            cwd: normalizedInfo.activity.cwd ?? null,
            firstSubstantiveAction: normalizedInfo.activity.summary ?? null
          });
        }
        if (normalizedInfo.activity?.kind === 'tool_result' && !sawFirstToolResult) {
          sawFirstToolResult = true;
          this.host.recordRuntimeTraceMark(thread.id, runId, 'first_tool_result', {
            toolName: normalizedInfo.activity.toolName ?? null,
            summary: normalizedInfo.activity.summary,
            status: normalizedInfo.activity.status ?? null,
            command: normalizedInfo.activity.command ?? null,
            cwd: normalizedInfo.activity.cwd ?? null,
            ...generatedMemoryTraceDetail
          });
        }
        if (!event) {
          return;
        }
        this.host.emit({ type: 'raw.event', event });
        if (normalizedInfo.message) {
          this.host.emit({ type: 'run.status', threadId: thread.id, runId, status: 'info', message: normalizedInfo.message });
        }
      };
      const replyAssembly = createProviderReplyAssembly({
        providerId: input.providerId,
        readCurrentText: () => this.host.collectAssistantText(thread.id, runId),
        onFirstDelta: ({ deltaLength, textLength }) => {
          this.host.recordRuntimeTraceMark(thread.id, runId, 'first_delta', {
            deltaLength: deltaLength || textLength
          });
        },
        persistDelta: (delta) => {
          this.host.db.addRunEvent(thread.id, runId, 'delta', { delta });
        },
        persistText: (text) => {
          this.host.db.updateAssistantTurn(runId, thread.id, text);
        },
        emitDelta: (delta) => {
          this.host.emit({ type: 'run.delta', threadId: thread.id, runId, delta });
        },
        emitReplace: (text) => {
          this.host.emit({ type: 'run.replace', threadId: thread.id, runId, text });
        }
      });
      const providerRunContext: ProviderRunContext = {
        threadId: thread.id,
        runId,
        prompt: effectivePrompt,
        sourcePrompt: buildProviderRunSourcePrompt(input.prompt, executionContext.approvedPlan),
        imageAttachments: executionImageAttachments,
        textAttachments: input.textAttachments ?? [],
        modelId,
        customProviderId: customProviderRoute?.customProviderId ?? null,
        reasoningEffort: input.reasoningEffort ?? null,
        thinkingEnabled: providerCapabilities(input.providerId).supportsThinkingToggle ? input.thinkingEnabled ?? false : undefined,
        executionConstraints: input.executionConstraints ?? null,
        resumeSessionId: continuity.resumeSessionId,
        folderPath: runtimeWorkspaceRoot,
        sourceWorkspaceRoot,
        runtimeWorkspaceRoot,
        trusted: project.trusted,
        apiKey,
        runMode,
        executionPermission: input.executionPermission,
        runtimeCommandPolicy: project.runtimeCommandPolicy,
        runtimeNetworkPolicy: project.runtimeNetworkPolicy,
        harnessTaskContract,
        resolvedTaskPacket,
        verificationPlan,
        harnessWorktreeSession,
        ollamaTransportMode: this.host.resolveOllamaTransportMode(input.providerId),
        runtimeSkillResources: workspaceContext.runtimeSkillResources as never
      };
      const normalizedRunResolution = this.host.providerModelExecutionService.resolveNormalizedRun({
        providerId: input.providerId,
        context: providerRunContext
      });
      const compatibilityDispatchPolicy = resolveProviderCompatibilityDispatchPolicy({
        providerId: input.providerId,
        context: providerRunContext,
        retiredProvider: adapter instanceof RetiredProviderAdapter
      });
      const runtimeAuthority =
        normalizedRunResolution?.runtimeAuthority ?? legacyProviderRuntimeAuthority(input.providerId);
      const usesAppApprovalAuthority = usesAppToolApprovalAuthority(runtimeAuthority);
      const requestProviderToolApproval =
        usesAppApprovalAuthority
          ? (request: { toolName: string; command: string; cwd: string | null; workspaceRoot: string }) =>
              isRunCallbackOpen()
                ? this.host.requestToolApproval(
                    {
                      threadId: thread.id,
                      runId,
                      providerId: input.providerId,
                      ...request
                    },
                    project.runtimeCommandPolicy,
                    {
                      appAuthoritative: usesAppApprovalAuthority
                    }
                  )
                : Promise.resolve('cancelled' as const)
          : undefined;
      const providerRunCallbacks: ProviderRunCallbacks = {
        onStart: () => {
          if (!isRunCallbackOpen()) {
            return;
          }
          this.host.db.updateThreadStatus(thread.id, 'running');
          this.host.db.addRunEvent(thread.id, runId, 'started', {
            providerId: input.providerId,
            modelId,
            continuityStrategy: continuity.strategy,
            resumeSessionId: continuity.resumeSessionId
          });
          this.host.recordRuntimeTraceMark(thread.id, runId, 'run_started', { providerId: input.providerId, modelId });
          this.recordInternalGuidanceEvent(
            thread.id,
            runId,
            vicodeGuidance?.documents.map((document) => document.title) ?? []
          );
          const projectKnowledgeActivity = this.host.createProjectKnowledgeActivity?.(
            workspaceContext.projectKnowledgeBlocks ?? [],
            workspaceContext.projectKnowledgeRouter ?? null
          );
          if (projectKnowledgeActivity) {
            const event = this.host.db.addRunEvent(thread.id, runId, 'info', {
              activity: projectKnowledgeActivity
            });
            this.host.emit({ type: 'raw.event', event });
          }
          const skillActivity = this.host.createSkillActivity?.({
            selectedSkillIds: workspaceContext.selectedSkillIds,
            autoSelectedSkillIds: workspaceContext.autoSelectedSkillIds ?? [],
            mentionedSkillIds: workspaceContext.mentionedSkillIds ?? []
          });
          if (skillActivity) {
            const event = this.host.db.addRunEvent(thread.id, runId, 'info', {
              activity: skillActivity
            });
            this.host.emit({ type: 'raw.event', event });
          }
          if (initialRunProgress) {
            this.host.publishProviderRunProgress(runId, initialRunProgress);
          }
          const memoryRecallActivity = this.host.createMemoryRecallActivity(
            workspaceContext.memoryBlocks,
            workspaceContext.generatedMemoryBlocks ?? []
          );
          if (memoryRecallActivity) {
            const event = this.host.db.addRunEvent(thread.id, runId, 'info', {
              activity: memoryRecallActivity
            });
            this.host.emit({ type: 'raw.event', event });
          }
          this.host.emit({ type: 'run.started', threadId: thread.id, runId });
        },
        onDelta: (delta) => {
          if (!isRunCallbackOpen()) {
            return;
          }
          if (!sawFirstDelta) {
            sawFirstDelta = true;
          }
          replyAssembly.handleDelta(delta);
        },
        onAssistantSnapshot: (snapshot) => {
          if (!isRunCallbackOpen()) {
            return;
          }
          if (!sawFirstDelta) {
            sawFirstDelta = true;
          }
          replyAssembly.handleSnapshot(snapshot);
        },
        onInfo: handleProviderInfo,
        requestToolApproval: requestProviderToolApproval,
        invokeRuntimeTool:
          runtimeWorkspaceRoot?.trim()
            ? (call) =>
                isRunCallbackOpen()
                  ? this.host.executeProviderRuntimeToolCall({
                      call: call as Record<string, unknown>,
                      workspaceRoot: runtimeWorkspaceRoot!,
                      trustedWorkspace: project.trusted,
                      threadId: thread.id,
                      runId,
                      providerId: input.providerId,
                      appAuthoritativeToolApproval: usesAppApprovalAuthority,
                      executionPermission: input.executionPermission,
                      executionConstraints: input.executionConstraints ?? null,
                      runtimeCommandPolicy: project.runtimeCommandPolicy,
                      runtimeNetworkPolicy: project.runtimeNetworkPolicy,
                      onInfo: handleProviderInfo
                    })
                  : Promise.resolve(stoppedToolResult(call))
            : undefined,
        onComplete: (output) => {
          if (!closeRunCallbacks()) {
            return;
          }
          const resolvedOutput = resolveProviderCompletionText({
            providerId: input.providerId,
            output,
            streamedDeltaOutput: this.host.collectRunDeltaText(thread.id, runId),
            assistantTurnOutput: this.host.collectAssistantText(thread.id, runId)
          });
          const completionOutput = formatProviderCompletionOutput(input.providerId, resolvedOutput);
          if (!completionOutput) {
            this.host.finalizeExecutionRunFailure(buildProviderExecutionEmptyOutputFailure({
              providerId: input.providerId,
              threadId: thread.id,
              runId,
              approvedPlan,
              titlePrompt
            }));
            return;
          }
          if (this.host.shouldFinalizeWithProviderCleanup(input.providerId, completionOutput)) {
            void this.host.finalizeSuccessfulExecutionRunWithProviderCleanup(buildProviderExecutionCleanupSuccessFinalization({
              providerId: input.providerId,
              modelId,
              threadId: thread.id,
              runId,
              output: completionOutput,
              workspaceSnapshot,
              projectFolderPath: runtimeWorkspaceRoot!,
              approvedPlan,
              titlePrompt,
              harnessWorktreeSession
            }));
            return;
          }
          this.host.finalizeSuccessfulExecutionRun(buildProviderExecutionSuccessFinalization({
            threadId: thread.id,
            runId,
            output: completionOutput,
            workspaceSnapshot,
            projectFolderPath: runtimeWorkspaceRoot!,
            approvedPlan,
            titlePrompt,
            harnessWorktreeSession
          }));
        },
        onError: (message) => {
          if (!closeRunCallbacks()) {
            return;
          }
          this.host.finalizeExecutionRunFailure(buildProviderExecutionFailedFinalization({
            threadId: thread.id,
            runId,
            message,
            tracePayload: { message },
            approvedPlan,
            titlePrompt
          }));
        },
        onAbort: (message) => {
          if (!closeRunCallbacks()) {
            return;
          }
          this.host.finalizeExecutionRunFailure(buildProviderExecutionAbortedFinalization({
            threadId: thread.id,
            runId,
            message,
            approvedPlan
          }));
        }
      };
      const normalizedRun = await this.host.providerModelExecutionService.tryStartNormalizedRun({
        providerId: input.providerId,
        context: providerRunContext,
        callbacks: providerRunCallbacks,
        resolvedRun: normalizedRunResolution,
        finalizeAssistantOutput: (runContext, output) =>
          this.host.finalizeProviderModelAssistantOutput(runContext, output),
        recordTrace: (stage, payload) =>
          this.host.recordRuntimeTraceMark(thread.id, runId, stage, payload ?? null)
      });
      if (!normalizedRun && compatibilityDispatchPolicy.reason === 'retired_provider') {
        const message = providerRetiredMessage(input.providerId);
        this.host.recordRuntimeTraceMark(thread.id, runId, 'provider_model_compatibility_dispatch_blocked', {
          providerId: input.providerId,
          runMode,
          reason: compatibilityDispatchPolicy.reason
        });
        this.host.finalizeExecutionRunFailure(buildProviderExecutionFailedFinalization({
          threadId: thread.id,
          runId,
          message,
          tracePayload: { message, reason: compatibilityDispatchPolicy.reason },
          approvedPlan,
          titlePrompt: null
        }));
        return { thread: this.host.db.getThread(thread.id), runId };
      }
      if (!normalizedRun && compatibilityDispatchPolicy.requireNormalizedTransport) {
        const message = `${providerDisplayName(input.providerId)} requires an app-owned normalized transport for trusted workspace runs, but no normalized transport was available.`;
        this.host.recordRuntimeTraceMark(thread.id, runId, 'provider_model_normalized_transport_missing', {
          providerId: input.providerId,
          runMode,
          reason: compatibilityDispatchPolicy.reason,
          requestedTransportMode: providerRunContext.ollamaTransportMode ?? null
        });
        this.host.finalizeExecutionRunFailure(buildProviderExecutionFailedFinalization({
          threadId: thread.id,
          runId,
          message,
          tracePayload: { message, reason: compatibilityDispatchPolicy.reason },
          approvedPlan,
          titlePrompt: null
        }));
        return { thread: this.host.db.getThread(thread.id), runId };
      }
      if (!normalizedRun && !compatibilityDispatchPolicy.allowCompatibilityDispatch) {
        const message = `${providerDisplayName(input.providerId)} cannot use the legacy provider adapter path for this run.`;
        this.host.recordRuntimeTraceMark(thread.id, runId, 'provider_model_compatibility_dispatch_blocked', {
          providerId: input.providerId,
          runMode,
          reason: compatibilityDispatchPolicy.reason
        });
        this.host.finalizeExecutionRunFailure(buildProviderExecutionFailedFinalization({
          threadId: thread.id,
          runId,
          message,
          tracePayload: { message, reason: compatibilityDispatchPolicy.reason },
          approvedPlan,
          titlePrompt: null
        }));
        return { thread: this.host.db.getThread(thread.id), runId };
      }
      const run = normalizedRun ?? await (async () => {
        this.host.recordRuntimeTraceMark(
          thread.id,
          runId,
          'provider_model_compatibility_dispatch_started',
          buildProviderCompatibilityDispatchTraceDetail({
            providerId: input.providerId,
            runMode
          })
        );
        return adapter.startRun(providerRunContext, providerRunCallbacks);
      })();
      this.host.onRunRegistered(runId, run, thread.id);
      const detail = this.host.db.getThread(thread.id);
      this.host.emit({ type: 'thread.detail', thread: detail });
      this.host.emit({ type: 'thread.updated', thread: this.host.db.getThreadSummary(thread.id) });
      return { thread: detail, runId };
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message.trim() : `Failed to start ${providerDisplayName(input.providerId)}.`;
      this.host.recordRuntimeTraceMark(thread.id, runId, 'provider_dispatch_failed', { message });
      this.host.finalizeExecutionRunFailure(buildProviderExecutionFailedFinalization({
        threadId: thread.id,
        runId,
        message,
        tracePayload: { message },
        approvedPlan,
        titlePrompt
      }));
      return { thread: this.host.db.getThread(thread.id), runId };
    }
  }
}
