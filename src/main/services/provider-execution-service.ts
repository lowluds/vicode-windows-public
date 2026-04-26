import { randomUUID } from 'node:crypto';
import type { AgentToolExecutionResult } from '../../providers/agent-runtime';
import type { ProviderAdapter, ProviderInfoPayload, ProviderRunHandle } from '../../providers/types';
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
  ThreadDetail
} from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import { providerCapabilities, providerDisplayName } from '../../shared/providers';
import { deriveRunProgressFromPlanner, shouldAdvanceRunProgressFromActivity } from '../../shared/run-progress';
import { DatabaseService } from '../../storage/database';
import { captureWorkspaceSnapshot } from './workspace-changes';
import { normalizeProviderInfoEvent } from './provider-run-event-normalizer';
import { createProviderReplyAssembly } from './provider-reply-assembly';
import { formatProviderCompletionOutput, resolveProviderCompletionText } from './provider-completion-output';
import { buildEffectivePrompt, formatUsingReferences } from './provider-manager-prompt-builder';
import { resolveExecutionContinuity } from './provider-manager-continuity';
import type { VicodeGuidanceContext } from './vicode-guidance';

const OLLAMA_IMAGE_REVIEW_TIMEOUT_MS = 1000 * 60 * 2;

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

export interface ProviderExecutionServiceHost {
  adapters: Record<ProviderId, ProviderAdapter>;
  db: DatabaseService;
  isDisposed(): boolean;
  assertProviderRunPermission(providerId: ProviderId, executionPermission: ComposerSubmitInput['executionPermission']): void;
  assertProviderProjectContext(providerId: ProviderId, folderPath: string | null, trusted: boolean): void;
  recordRuntimeTraceMark(threadId: string, runId: string, stage: string, payload?: Record<string, unknown> | null): void;
  assembleWorkspaceContext(
    input: ComposerSubmitInput,
    thread: ThreadDetail,
    folderPath: string | null,
    trusted: boolean,
    options: {
      includeRuntimeSkills: boolean;
      contextProfile?: 'main' | 'delegated';
      includeMemory?: boolean;
      includeGeneratedMemory?: boolean;
    }
  ): {
    blocks: string[];
    memoryBlocks: Array<{ itemId?: string }>;
    generatedMemoryBlocks?: Array<{ itemId: string; evidenceCount: number }>;
    skillBlocks: string[];
    runtimeSkillResources: unknown[];
    selectedSkillIds: string[];
    diagnostics: Record<string, unknown>;
  };
  createGeneratedMemoryTraceDetail(input: {
    folderPath: string | null;
    trusted: boolean;
    generatedMemoryEnabled: boolean;
    generatedMemoryGenerationEnabled: boolean;
    memoryBlocks: Array<{ itemId?: string }>;
    generatedMemoryBlocks: Array<{ itemId: string; evidenceCount: number }>;
    repeatSteeringCount: number;
  }): Record<string, unknown>;
  createMemoryRecallActivity(
    memoryBlocks: Array<{ fileName: string }>,
    generatedMemoryBlocks: Array<{ itemId: string }>
  ): import('../../shared/domain').RunActivityInfo | null;
  resolveVicodeGuidance(input: {
    prompt: string;
    selectedSkillIds: string[];
  }): VicodeGuidanceContext | null;
  countQueuedSteerFollowUps(thread: ThreadDetail): number;
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
  usesAppAuthoritativeToolApproval(providerId: ProviderId): boolean;
  requestToolApproval(
    request: {
      threadId: string;
      runId: string;
      providerId: ProviderId;
      toolName: string;
      command: string;
      cwd: string | null;
      workspaceRoot: string;
    },
    runtimeCommandPolicy: Project['runtimeCommandPolicy']
  ): Promise<'approved' | 'rejected' | 'cancelled'>;
  executeProviderRuntimeToolCall(input: {
    call: Record<string, unknown>;
    workspaceRoot: string;
    trustedWorkspace: boolean;
    threadId: string;
    runId: string;
    providerId: ProviderId;
    executionPermission: ComposerSubmitInput['executionPermission'];
    executionConstraints: ComposerSubmitInput['executionConstraints'];
    runtimeCommandPolicy: Project['runtimeCommandPolicy'];
    runtimeNetworkPolicy: Project['runtimeNetworkPolicy'];
    onInfo: (payload: ProviderInfoPayload) => void;
  }): Promise<Record<string, unknown>>;
  collectAssistantText(threadId: string, runId: string): string;
  collectRunDeltaText(threadId: string, runId: string): string;
  emit(event: AppEvent): void;
  onRunRegistered(runId: string, handle: ProviderRunHandle, threadId: string): void;
  finalizeSuccessfulExecutionRun(input: {
    threadId: string;
    runId: string;
    output: string;
    workspaceSnapshot: ReturnType<typeof captureWorkspaceSnapshot>;
    projectFolderPath: string;
    approvedPlan: boolean;
    titlePrompt: string | null;
  }): void;
  finalizeExecutionRunFailure(input: {
    threadId: string;
    runId: string;
    message: string;
    traceStage: 'failed' | 'aborted';
    tracePayload?: Record<string, unknown> | null;
    eventType: 'failed' | 'aborted';
    threadStatus: 'failed' | 'aborted';
    runStatus: 'failed' | 'aborted';
    progressStatus: 'failed' | 'blocked';
    approvedPlan: boolean;
    titlePrompt: string | null;
  }): void;
  shouldFinalizeWithProviderCleanup(providerId: ProviderId, output: string): boolean;
  finalizeSuccessfulExecutionRunWithProviderCleanup(input: {
    providerId: ProviderId;
    modelId: string;
    threadId: string;
    runId: string;
    output: string;
    workspaceSnapshot: ReturnType<typeof captureWorkspaceSnapshot>;
    projectFolderPath: string;
    approvedPlan: boolean;
    titlePrompt: string | null;
  }): Promise<void>;
}

export class ProviderExecutionService {
  constructor(private readonly host: ProviderExecutionServiceHost) {}

  private recordVisibleUsingEvent(threadId: string, runId: string, usingReferences: string[]) {
    if (usingReferences.length === 0) {
      return;
    }

    const visibleReferences = usingReferences.slice(0, 10);
    const remainingCount = usingReferences.length - visibleReferences.length;
    const referenceText = remainingCount > 0
      ? `${visibleReferences.join(', ')}, and ${remainingCount} more`
      : visibleReferences.join(', ');
    const summary = `Using: ${referenceText}`;
    const event = this.host.db.addRunEvent(threadId, runId, 'info', {
      activity: {
        kind: 'guidance',
        summary,
        text: summary,
        providerEventType: 'vicode_guidance_using'
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
    const workspaceContext = this.host.assembleWorkspaceContext(input, thread, project.folderPath, project.trusted, {
      includeRuntimeSkills: providerCapabilities(input.providerId).supportsRuntimeSkillResources,
      contextProfile: executionContext.contextProfile ?? 'main',
      includeMemory: executionContext.includeMemory ?? true,
      includeGeneratedMemory: executionContext.includeGeneratedMemory ?? preferences.generatedMemoryUseEnabled
    });
    const generatedMemoryBlocks = workspaceContext.generatedMemoryBlocks ?? [];
    const generatedMemoryTraceDetail = this.host.createGeneratedMemoryTraceDetail({
      folderPath: project.folderPath,
      trusted: project.trusted,
      generatedMemoryEnabled: executionContext.includeGeneratedMemory ?? preferences.generatedMemoryUseEnabled,
      generatedMemoryGenerationEnabled: preferences.generatedMemoryGenerationEnabled,
      memoryBlocks: workspaceContext.memoryBlocks,
      generatedMemoryBlocks,
      repeatSteeringCount: this.host.countQueuedSteerFollowUps(thread)
    });
    this.host.recordRuntimeTraceMark(thread.id, runId, 'workspace_context_completed', {
      ...workspaceContext.diagnostics,
      ...generatedMemoryTraceDetail
    });
    this.host.db.appendTurn(thread.id, 'user', input.prompt, {
      skillIds: workspaceContext.selectedSkillIds,
      imageAttachments: input.imageAttachments ?? [],
      textAttachments: input.textAttachments ?? [],
      executionPermission: input.executionPermission,
      ...(userTurnMetadata ?? {})
    });
    this.host.db.updateThreadStatus(thread.id, 'queued');

    const account = this.host.db.getProviderAccount(input.providerId);
    const auth = await adapter.getAuthState(account);
    const apiKey = auth.authMode === 'api_key' && account?.encryptedApiKey ? this.host.decryptApiKey(account.encryptedApiKey) : null;
    const modelId = await this.host.resolveExecutionModelId(input.providerId, input.modelId, input.imageAttachments ?? []);
    const imageAttachments = input.imageAttachments ?? [];
    let executionImageAttachments = imageAttachments;
    let imageReviewText: string | null = null;

    try {
      const imageRouting = await this.host.resolveImageAttachmentRouting(input.providerId, modelId, imageAttachments);
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
      this.host.finalizeExecutionRunFailure({
        threadId: thread.id,
        runId,
        message,
        traceStage: 'failed',
        tracePayload: { message },
        eventType: 'failed',
        threadStatus: 'failed',
        runStatus: 'failed',
        progressStatus: 'failed',
        approvedPlan: Boolean(executionContext.approvedPlan),
        titlePrompt: shouldGenerateTitle ? input.prompt : null
      });
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
    const usingReferences = formatUsingReferences(vicodeGuidance, workspaceContext as never);
    const effectivePrompt = buildEffectivePrompt({ ...input, imageReviewText }, workspaceContext as never, {
      personalization: this.host.db.getPersonalization(),
      approvedPlanMarkdown: executionContext.approvedPlan?.proposedPlanMarkdown ?? null,
      plannerAnswers: executionContext.plannerAnswers ?? null,
      thread,
      continuity,
      vicodeGuidance
    });
    this.host.recordRuntimeTraceMark(thread.id, runId, 'prompt_assembled', {
      promptLength: effectivePrompt.length,
      workspaceBlockCount: workspaceContext.blocks.length,
      memoryBlockCount: workspaceContext.memoryBlocks.length,
      generatedMemoryBlockCount: generatedMemoryBlocks.length,
      skillBlockCount: workspaceContext.skillBlocks.length,
      runtimeSkillResourceCount: workspaceContext.runtimeSkillResources.length,
      vicodeGuidanceUsingCount: usingReferences.length,
      vicodeGuidanceDocumentCount: vicodeGuidance?.documents.length ?? 0,
      ...generatedMemoryTraceDetail
    });
    const workspaceSnapshot = captureWorkspaceSnapshot(project.folderPath);
    const initialRunProgress =
      executionContext.approvedPlan
        ? deriveRunProgressFromPlanner(executionContext.approvedPlan, 'executing_from_plan', runId, thread.id)
        : executionContext.delegation?.mode === 'background'
          ? this.host.createBackgroundDelegationRunProgress(runId, thread.id, input.providerId, executionContext.delegation)
          : null;
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
        authMode: auth.authMode,
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
      const requestProviderToolApproval =
        this.host.usesAppAuthoritativeToolApproval(input.providerId)
          ? (request: { toolName: string; command: string; cwd: string | null; workspaceRoot: string }) =>
              isRunCallbackOpen()
                ? this.host.requestToolApproval({
                    threadId: thread.id,
                    runId,
                    providerId: input.providerId,
                    ...request
                  }, project.runtimeCommandPolicy)
                : Promise.resolve('cancelled' as const)
          : undefined;
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
      const run = await adapter.startRun(
        {
          threadId: thread.id,
          runId,
          prompt: effectivePrompt,
          sourcePrompt: input.prompt,
          imageAttachments: executionImageAttachments,
          textAttachments: input.textAttachments ?? [],
          modelId,
          reasoningEffort: input.reasoningEffort ?? null,
          thinkingEnabled: providerCapabilities(input.providerId).supportsThinkingToggle ? input.thinkingEnabled ?? false : undefined,
          executionConstraints: input.executionConstraints ?? null,
          resumeSessionId: continuity.resumeSessionId,
          folderPath: project.folderPath,
          trusted: project.trusted,
          apiKey,
          runMode,
          executionPermission: input.executionPermission,
          runtimeCommandPolicy: project.runtimeCommandPolicy,
          runtimeNetworkPolicy: project.runtimeNetworkPolicy,
          ollamaTransportMode: this.host.resolveOllamaTransportMode(input.providerId),
          runtimeSkillResources: workspaceContext.runtimeSkillResources as never
        },
        {
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
            this.recordVisibleUsingEvent(thread.id, runId, usingReferences);
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
            project.folderPath?.trim()
              ? (call) =>
                  isRunCallbackOpen()
                    ? this.host.executeProviderRuntimeToolCall({
                        call: call as Record<string, unknown>,
                        workspaceRoot: project.folderPath!,
                        trustedWorkspace: project.trusted,
                        threadId: thread.id,
                        runId,
                        providerId: input.providerId,
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
              this.host.finalizeExecutionRunFailure({
                threadId: thread.id,
                runId,
                message: `${providerDisplayName(input.providerId)} completed without producing assistant output.`,
                traceStage: 'failed',
                tracePayload: { reason: 'empty_output' },
                eventType: 'failed',
                threadStatus: 'failed',
                runStatus: 'failed',
                progressStatus: 'failed',
                approvedPlan: Boolean(executionContext.approvedPlan),
                titlePrompt: shouldGenerateTitle ? input.prompt : null
              });
              return;
            }
            if (this.host.shouldFinalizeWithProviderCleanup(input.providerId, completionOutput)) {
              void this.host.finalizeSuccessfulExecutionRunWithProviderCleanup({
                providerId: input.providerId,
                modelId,
                threadId: thread.id,
                runId,
                output: completionOutput,
                workspaceSnapshot,
                projectFolderPath: project.folderPath!,
                approvedPlan: Boolean(executionContext.approvedPlan),
                titlePrompt: shouldGenerateTitle ? input.prompt : null
              });
              return;
            }
            this.host.finalizeSuccessfulExecutionRun({
              threadId: thread.id,
              runId,
              output: completionOutput,
              workspaceSnapshot,
              projectFolderPath: project.folderPath!,
              approvedPlan: Boolean(executionContext.approvedPlan),
              titlePrompt: shouldGenerateTitle ? input.prompt : null
            });
          },
          onError: (message) => {
            if (!closeRunCallbacks()) {
              return;
            }
            this.host.finalizeExecutionRunFailure({
              threadId: thread.id,
              runId,
              message,
              traceStage: 'failed',
              tracePayload: { message },
              eventType: 'failed',
              threadStatus: 'failed',
              runStatus: 'failed',
              progressStatus: 'failed',
              approvedPlan: Boolean(executionContext.approvedPlan),
              titlePrompt: shouldGenerateTitle ? input.prompt : null
            });
          },
          onAbort: (message) => {
            if (!closeRunCallbacks()) {
              return;
            }
            this.host.finalizeExecutionRunFailure({
              threadId: thread.id,
              runId,
              message,
              traceStage: 'aborted',
              tracePayload: message ? { message } : null,
              eventType: 'aborted',
              threadStatus: 'aborted',
              runStatus: 'aborted',
              progressStatus: 'blocked',
              approvedPlan: Boolean(executionContext.approvedPlan),
              titlePrompt: null
            });
          }
        }
      );
      this.host.onRunRegistered(runId, run, thread.id);
      const detail = this.host.db.getThread(thread.id);
      this.host.emit({ type: 'thread.detail', thread: detail });
      this.host.emit({ type: 'thread.updated', thread: this.host.db.getThreadSummary(thread.id) });
      return { thread: detail, runId };
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message.trim() : `Failed to start ${providerDisplayName(input.providerId)}.`;
      this.host.recordRuntimeTraceMark(thread.id, runId, 'provider_dispatch_failed', { message });
      this.host.finalizeExecutionRunFailure({
        threadId: thread.id,
        runId,
        message,
        traceStage: 'failed',
        tracePayload: { message },
        eventType: 'failed',
        threadStatus: 'failed',
        runStatus: 'failed',
        progressStatus: 'failed',
        approvedPlan: Boolean(executionContext.approvedPlan),
        titlePrompt: shouldGenerateTitle ? input.prompt : null
      });
      return { thread: this.host.db.getThread(thread.id), runId };
    }
  }
}
