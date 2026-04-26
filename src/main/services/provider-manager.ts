import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { safeStorage } from 'electron';
import { GeminiAdapter } from '../../providers/gemini/adapter';
import { OllamaAdapter } from '../../providers/ollama/adapter';
import { OpenAIAdapter } from '../../providers/openai/adapter';
import { KimiAdapter } from '../../providers/kimi/adapter';
import { QwenAdapter } from '../../providers/qwen/adapter';
import type {
  AutonomyDelegationProfile,
  ProviderRunHandle
} from '../../providers/types';
import type {
  AgentExecutionConstraints,
  ComposerMode,
  ComposerSubmitInput,
  ComposerSubmitResult,
  ExecutionPermission,
  ImageAttachment,
  PlannerAnswerInput,
  PlannerApprovePlanInput,
  PlannerCancelInput,
  PlannerPlan,
  PlannerQuestionSet,
  PlannerQuestionAnswer,
  PlannerSubmitInput,
  PlannerSetModeInput,
  ProviderDescriptor,
  ProviderId,
  RunActivityInfo,
  RunRuntimeTraceMark,
  RunRuntimeTraceStage,
  RunToolApprovalDecision,
  RunToolApprovalRequest,
  TextAttachment,
  ThreadFollowUp,
  ThreadDetail,
  RunProgressState
} from '../../shared/domain';
import type { ThreadCollaborationSummary } from '../../shared/ipc';
import type { AppEvent } from '../../shared/events';
import { resolveSubagentReasoningEffort } from '../../shared/subagents';
import { DatabaseService } from '../../storage/database';
import {
  providerAuthBrand,
  providerCapabilities,
  providerCliLabel,
  providerDisplayName
} from '../../shared/providers';
import { promptRequiresAttachedWorkspace } from '../../shared/workspace-run-guard';
import { WorkspaceContextService, type WorkspaceContextResult } from './workspace-context';
import { WorkspaceMemoryService } from './memory';
import { GeneratedMemoryRetrievalService } from './generated-memory-retrieval';
import { SkillContextService } from './skill-context';
import { captureWorkspaceSnapshot } from './workspace-changes';
import { OllamaRuntimeService } from './ollama-runtime';
import { OllamaFinalAnswerFormatter } from './ollama-final-answer-formatter';
import { AgentRuntimeService } from './agent-runtime';
import {
  normalizeProviderInfoEvent,
  type NormalizedProviderInfoEvent
} from './provider-run-event-normalizer';
import { createProviderReplyAssembly } from './provider-reply-assembly';
import {
  resolveProviderCompletionText,
  resolveProviderCompletionOutput
} from './provider-completion-output';
import {
  resolveExecutionContinuity,
  type ExecutionContinuityPlan
} from './provider-manager-continuity';
import {
  ExecutionContext,
  ProviderExecutionService
} from './provider-execution-service';
import { ToolApprovalService } from './tool-approval-service';
import { ProviderAuthService } from './provider-auth-service';
import {
  ProviderModelService
} from './provider-model-service';
import { ProjectPolicyService } from './project-policy-service';
import { ThreadProjectionService } from './thread-projection-service';
import { ProviderPlannerSessionService } from './provider-planner-session-service';
import { ProviderRunProgressService } from './provider-run-progress-service';
import { ProviderPromptTextService } from './provider-prompt-text-service';
import { ProviderSummaryTextService } from './provider-summary-text-service';
import { ProviderDescriptorService } from './provider-descriptor-service';
import { ProviderFollowUpService } from './provider-follow-up-service';
import { ProviderContextSupportService } from './provider-context-support-service';
import { ProviderRuntimeToolService } from './provider-runtime-tool-service';
import { ProviderRunOutputService } from './provider-run-output-service';
import { ProviderRunEventService } from './provider-run-event-service';
import { ProviderRunFinalizationService } from './provider-run-finalization-service';
import { ProviderWorkspaceContextSupportService } from './provider-workspace-context-support-service';
import { VicodeGuidanceService } from './vicode-guidance';

function createBackgroundSubagentExecutionConstraints(
  profile: AutonomyDelegationProfile
): AgentExecutionConstraints {
  return {
    permissionMode: 'default',
    toolPolicy: {
      preset: 'default',
      allowedToolCallNames: [],
      disallowedToolCallNames: ['spawn_subagents']
    },
    maxTurns: profile === 'heartbeat' ? 8 : 24,
    maxReasoningTokens: null,
    taskBudgetTokens: null,
    costBudgetUsd: null,
    maxDelegationDepth: 0,
    maxAutomaticRetries: 0,
    maxUnchangedHandoffs: 1,
    maxSiblingDelegates: 0
  };
}

export class ProviderManager {
  private readonly adapters: Record<ProviderId, ProviderAdapter>;
  private readonly workspaceContext: WorkspaceContextService;
  private readonly skillContext: SkillContextService;
  private readonly running = new Map<string, ProviderRunHandle>();
  private readonly runningByThread = new Map<string, string>();
  private readonly plannerRunsByThread = new Map<string, string>();
  private readonly emitter = new EventEmitter();
  private readonly ollamaFinalAnswerFormatter: OllamaFinalAnswerFormatter;
  private readonly agentRuntime: AgentRuntimeService;
  private readonly executionService: ProviderExecutionService;
  private readonly toolApprovalService: ToolApprovalService;
  private readonly authService: ProviderAuthService;
  private readonly modelService: ProviderModelService;
  private readonly projectPolicy: ProjectPolicyService;
  private readonly threadProjection: ThreadProjectionService;
  private readonly plannerSessionService: ProviderPlannerSessionService;
  private readonly runProgress: ProviderRunProgressService;
  private readonly promptTextService: ProviderPromptTextService;
  private readonly summaryTextService: ProviderSummaryTextService;
  private readonly descriptorService: ProviderDescriptorService;
  private readonly followUpService: ProviderFollowUpService;
  private readonly contextSupport: ProviderContextSupportService;
  private readonly workspaceContextSupport: ProviderWorkspaceContextSupportService;
  private readonly vicodeGuidance: VicodeGuidanceService;
  private readonly runtimeToolService: ProviderRuntimeToolService;
  private readonly runOutput: ProviderRunOutputService;
  private readonly runEvents: ProviderRunEventService;
  private readonly runFinalization: ProviderRunFinalizationService;
  private disposed = false;

  private get runProgressByRun() {
    return this.runProgress.getProgressMap();
  }

  private get lastPersistedRunProgressByRun() {
    return this.runProgress.getPersistedProgressMap();
  }

  constructor(
    private readonly db: DatabaseService,
    adapters?: Record<ProviderId, ProviderAdapter>,
    workspaceContext?: WorkspaceContextService,
    ollamaRuntime = new OllamaRuntimeService(),
    agentRuntime = new AgentRuntimeService(),
    ollamaFinalAnswerFormatter = new OllamaFinalAnswerFormatter(ollamaRuntime)
  ) {
    this.agentRuntime = agentRuntime;
    this.ollamaFinalAnswerFormatter = ollamaFinalAnswerFormatter;
    this.adapters =
      adapters ?? {
        openai: new OpenAIAdapter(),
        gemini: new GeminiAdapter(),
        qwen: new QwenAdapter(),
        ollama: new OllamaAdapter(ollamaRuntime, agentRuntime),
        kimi: new KimiAdapter()
      };
    this.skillContext = new SkillContextService(db);
    this.workspaceContext =
      workspaceContext ??
      new WorkspaceContextService({
        memoryRetriever: new WorkspaceMemoryService(db),
        generatedMemoryRetriever: new GeneratedMemoryRetrievalService(db),
        skillResolver: this.skillContext
      });
    this.toolApprovalService = new ToolApprovalService({
      usesAppAuthoritativeToolApproval: (providerId) => this.runtimeToolService.usesAppAuthoritativeToolApproval(providerId),
      getCurrentRuntimeCommandPolicyForThread: (threadId, fallback) =>
        this.runtimeToolService.getCurrentRuntimeCommandPolicyForThread(threadId, fallback),
      emit: (event) => this.emit(event)
    });
    this.authService = new ProviderAuthService({
      db: this.db,
      adapters: this.adapters,
      emit: (event) => this.emit(event),
      getProvider: (providerId, options) => this.getProvider(providerId, options),
      resolveAvailableAuthMode: (auth, account) => this.descriptorService.resolveAvailableAuthMode(auth, account),
      syncProviderAccount: (providerId, account, auth) => this.descriptorService.syncProviderAccount(providerId, account, auth)
    });
    this.modelService = new ProviderModelService({
      db: this.db,
      decryptApiKey: (encrypted) => this.decryptApiKey(encrypted),
      getProvider: (providerId, options) => this.getProvider(providerId, options)
    });
    this.projectPolicy = new ProjectPolicyService(db, this.adapters);
    this.threadProjection = new ThreadProjectionService(db, (event) => this.emit(event));
    this.runtimeToolService = new ProviderRuntimeToolService({
      agentRuntime: this.agentRuntime,
      projectPolicy: this.projectPolicy,
      requestToolApproval: (input, runtimeCommandPolicy) =>
        this.toolApprovalService.requestToolApproval(input, runtimeCommandPolicy)
    });
    this.runEvents = new ProviderRunEventService({
      db: this.db,
      emit: (event) => this.emit(event)
    });
    this.runProgress = new ProviderRunProgressService({
      addProgressEvent: (threadId, runId, progress) =>
        this.db.addRunEvent(threadId, runId, 'info', {
          progressSnapshot: progress
        }),
      emitRawEvent: (event) => this.emit({ type: 'raw.event', event: event as never }),
      emit: (event) => this.emit(event)
    });
    this.promptTextService = new ProviderPromptTextService({
      adapters: this.adapters,
      db: this.db,
      threadProjection: this.threadProjection,
      resolveUsableModelId: (providerId, modelId) => this.modelService.resolveUsableModelId(providerId, modelId),
      decryptApiKey: (encrypted) => this.decryptApiKey(encrypted),
      resolveOllamaTransportMode: (providerId) => this.resolveOllamaTransportMode(providerId),
      assertProviderRunPermission: (providerId, executionPermission) =>
        this.assertProviderRunPermission(providerId, executionPermission)
    });
    this.summaryTextService = new ProviderSummaryTextService({
      adapters: this.adapters,
      db: this.db,
      getProviderDescriptor: async (providerId) => this.getProvider(providerId),
      resolveUsableModelId: (providerId, modelId) => this.modelService.resolveUsableModelId(providerId, modelId),
      decryptApiKey: (encryptedApiKey) => this.decryptApiKey(encryptedApiKey),
      resolveOllamaTransportMode: (providerId) => this.resolveOllamaTransportMode(providerId)
    });
    this.descriptorService = new ProviderDescriptorService({
      db: this.db,
      adapters: this.adapters,
      authService: {
        getPendingSince: (providerId) => this.authService.getPendingSince(providerId),
        clearPendingAuth: (providerId) => this.authService.clearPendingAuth(providerId)
      },
      modelService: this.modelService
    });
    this.followUpService = new ProviderFollowUpService({
      isDisposed: () => this.disposed,
      getRunningRunId: (threadId) => this.runningByThread.get(threadId) ?? null,
      db: this.db,
      threadProjection: this.threadProjection,
      emit: (event) => this.emit(event),
      startExecutionRun: (input, thread, project, executionContext) =>
        this.startExecutionRun(input, thread, project, executionContext),
      stopRun: (runId) => this.stopRun(runId),
      refreshDerivedRunProgress: (threadId, runId, providerId, modelId) =>
        this.refreshDerivedRunProgress(threadId, runId, providerId, modelId),
      readTurnSkillIds: (metadata) => this.readTurnSkillIds(metadata),
      readTurnImageAttachments: (metadata) => this.readTurnImageAttachments(metadata),
      readTurnTextAttachments: (metadata) => this.readTurnTextAttachments(metadata)
    });
    this.contextSupport = new ProviderContextSupportService();
    this.workspaceContextSupport = new ProviderWorkspaceContextSupportService(
      this.db,
      this.workspaceContext,
      this.contextSupport
    );
    this.vicodeGuidance = new VicodeGuidanceService();
    this.runOutput = new ProviderRunOutputService(db, ollamaFinalAnswerFormatter);
    this.runFinalization = new ProviderRunFinalizationService({
      db: this.db,
      runProgress: this.runProgress,
      runEvents: this.runEvents,
      threadProjection: this.threadProjection,
      emit: (event) => this.emit(event),
      clearPendingToolApprovals: (runId, decision) => this.clearPendingToolApprovals(runId, decision),
      maybeDispatchNextFollowUp: (threadId) => {
        void this.followUpService.maybeDispatchNextFollowUp(threadId);
      },
      generateThreadTitle: (threadId, titlePrompt) => {
        void this.promptTextService.generateThreadTitle(threadId, titlePrompt);
      }
    });
    this.plannerSessionService = new ProviderPlannerSessionService({
      db: this.db,
      adapters: this.adapters,
      threadProjection: this.threadProjection,
      isDisposed: () => this.disposed,
      emit: (event) => this.emit(event),
      assertProviderRunPermission: (providerId, executionPermission) =>
        this.assertProviderRunPermission(providerId, executionPermission),
      assertProviderProjectContext: (providerId, folderPath, trusted) =>
        this.assertProviderProjectContext(providerId, folderPath, trusted),
      assembleWorkspaceContext: (input, thread, folderPath, trusted, options) =>
        this.workspaceContextSupport.assembleWorkspaceContext(input, thread, folderPath, trusted, options),
      resolveVicodeGuidance: (input) => this.vicodeGuidance.resolveForPrompt(input),
      resolveExecutionModelId: (providerId, requestedModelId, imageAttachments) =>
        this.modelService.resolveExecutionModelId(providerId, requestedModelId, imageAttachments),
      decryptApiKey: (encrypted) => this.decryptApiKey(encrypted),
      resolveOllamaTransportMode: (providerId) => this.resolveOllamaTransportMode(providerId),
      executeProviderRuntimeToolCall: (input) => this.executeProviderRuntimeToolCall(input as never),
      collectRunDeltaText: (threadId, runId) => this.runOutput.collectRunDeltaText(threadId, runId),
      collectAssistantText: (threadId, runId) => this.runOutput.collectAssistantText(threadId, runId),
      recordInfoEvent: (threadId, runId, normalizedInfo) =>
        this.runEvents.recordInfoEvent(threadId, runId, normalizedInfo),
      recordNativePlannerCloseout: (threadId, runId, providerId, summary, text) =>
        this.runEvents.recordNativePlannerCloseout(threadId, runId, providerId, summary, text),
      setPlannerRunId: (threadId, runId) => {
        this.plannerRunsByThread.set(threadId, runId);
      },
      getPlannerRunId: (threadId) => this.plannerRunsByThread.get(threadId) ?? null,
      clearPlannerRunId: (threadId, runId) => {
        if (this.plannerRunsByThread.get(threadId) === runId) {
          this.plannerRunsByThread.delete(threadId);
        }
      },
      clearNativePlannerRunState: (threadId, runId) => this.clearNativePlannerRunState(threadId, runId),
      registerRunningHandle: (runId, handle) => {
        this.running.set(runId, handle);
      },
      updateNativePlannerRunProgress: (threadId, runId, providerId, phase) =>
        this.updateNativePlannerRunProgress(threadId, runId, providerId, phase),
      publishPlannerRunProgress: (runId, threadId, providerId, phase) =>
        this.runProgress.publish(this.runProgress.createNativePlannerRunProgress(runId, threadId, providerId, phase)),
      stopRun: (runId) => this.stopRun(runId),
      readTurnSkillIds: (metadata) => this.readTurnSkillIds(metadata)
    });
    this.executionService = new ProviderExecutionService({
      adapters: this.adapters,
      db: this.db,
      isDisposed: () => this.disposed,
      assertProviderRunPermission: (providerId, executionPermission) =>
        this.assertProviderRunPermission(providerId, executionPermission),
      assertProviderProjectContext: (providerId, folderPath, trusted) =>
        this.assertProviderProjectContext(providerId, folderPath, trusted),
      recordRuntimeTraceMark: (threadId, runId, stage, payload) =>
        this.runEvents.recordRuntimeTraceMark(threadId, runId, stage as RunRuntimeTraceStage, payload ?? null),
      assembleWorkspaceContext: (input, thread, folderPath, trusted, options) =>
        this.workspaceContextSupport.assembleWorkspaceContext(input, thread, folderPath, trusted, options),
      createMemoryRecallActivity: (memoryBlocks, generatedMemoryBlocks) =>
        this.workspaceContextSupport.createMemoryRecallActivity(
          memoryBlocks as WorkspaceContextResult['memoryBlocks'],
          generatedMemoryBlocks as WorkspaceContextResult['generatedMemoryBlocks']
        ),
      resolveVicodeGuidance: (input) => this.vicodeGuidance.resolveForPrompt(input),
      createGeneratedMemoryTraceDetail: (input) =>
        this.workspaceContextSupport.createGeneratedMemoryTraceDetail(input),
      countQueuedSteerFollowUps: (thread) => this.contextSupport.countQueuedSteerFollowUps(thread),
      resolveExecutionModelId: (providerId, requestedModelId, imageAttachments) =>
        this.modelService.resolveExecutionModelId(providerId, requestedModelId, imageAttachments),
      resolveImageAttachmentRouting: (providerId, executionModelId, imageAttachments) =>
        this.modelService.resolveImageAttachmentRouting(providerId, executionModelId, imageAttachments),
      decryptApiKey: (encrypted) => this.decryptApiKey(encrypted),
      resolveOllamaTransportMode: (providerId) => this.resolveOllamaTransportMode(providerId),
      createBackgroundDelegationRunProgress: (runId, threadId, providerId, delegation) =>
        this.runProgress.createBackgroundDelegationRunProgress(runId, threadId, providerId, delegation),
      recordInfoEvent: (threadId, runId, normalizedInfo) => this.runEvents.recordInfoEvent(threadId, runId, normalizedInfo),
      publishProviderRunProgress: (runId, progress) => this.runProgress.publishProvider(runId, progress as RunProgressState),
      advanceRunProgress: (runId) => this.runProgress.advance(runId),
      refreshDerivedRunProgress: (threadId, runId, providerId, modelId) =>
        this.refreshDerivedRunProgress(threadId, runId, providerId, modelId),
      usesAppAuthoritativeToolApproval: (providerId) => this.runtimeToolService.usesAppAuthoritativeToolApproval(providerId),
      requestToolApproval: (request, runtimeCommandPolicy) =>
        this.toolApprovalService.requestToolApproval(request, runtimeCommandPolicy),
      executeProviderRuntimeToolCall: (input) => this.runtimeToolService.executeProviderRuntimeToolCall(input as never),
      collectAssistantText: (threadId, runId) => this.runOutput.collectAssistantText(threadId, runId),
      collectRunDeltaText: (threadId, runId) => this.runOutput.collectRunDeltaText(threadId, runId),
      emit: (event) => this.emit(event),
      onRunRegistered: (runId, handle, threadId) => {
        this.running.set(runId, handle);
        this.runningByThread.set(threadId, runId);
        this.runFinalization.registerRun(runId);
      },
      finalizeSuccessfulExecutionRun: (input) => this.finalizeSuccessfulExecutionRun(input),
      finalizeExecutionRunFailure: (input) => this.finalizeExecutionRunFailure(input),
      shouldFinalizeWithProviderCleanup: (providerId, output) =>
        providerId === 'ollama' && this.ollamaFinalAnswerFormatter.shouldRewrite(output),
      finalizeSuccessfulExecutionRunWithProviderCleanup: (input) =>
        this.runOutput.finalizeSuccessfulExecutionRunWithProviderCleanup(
          input,
          (next) => this.finalizeSuccessfulExecutionRun(next),
          () => this.disposed
        )
    });
  }

  onEvent(listener: (event: AppEvent) => void) {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.authService.dispose();
    this.runEvents.dispose();
    this.runFinalization.dispose();
    this.runProgress.dispose();
    this.toolApprovalService.dispose();
    this.plannerRunsByThread.clear();
    this.runningByThread.clear();

    const handles = Array.from(this.running.values());
    this.running.clear();
    for (const handle of handles) {
      void handle.cancel().catch(() => {});
    }

    this.followUpService.dispose();
    this.emitter.removeAllListeners('event');
  }

  private resolveOllamaTransportMode(providerId: ProviderId) {
    if (providerId !== 'ollama') {
      return undefined;
    }
    return this.db.getPreferences().ollamaTransportMode;
  }

  async listProviders(): Promise<ProviderDescriptor[]> {
    return this.descriptorService.listProviders();
  }

  listPendingToolApprovals(): RunToolApprovalRequest[] {
    return this.toolApprovalService.listPendingToolApprovals();
  }

  async approveToolApproval(approvalId: string) {
    this.toolApprovalService.approveToolApproval(approvalId);
  }

  async rejectToolApproval(approvalId: string) {
    this.toolApprovalService.rejectToolApproval(approvalId);
  }

  async setThreadExecutionPermission(
    threadId: string,
    executionPermission: ThreadDetail['executionPermission']
  ) {
    const thread = this.db.getThread(threadId);
    if (thread.executionPermission === executionPermission) {
      return thread;
    }

    const nextThread = this.db.setThreadExecutionPermission(
      threadId,
      executionPermission
    );

    if (executionPermission !== 'full_access') {
      this.clearPendingToolApprovalsForThread(threadId, 'rejected');
    }

    return nextThread;
  }

  async getProvider(providerId: ProviderId, options: { forceRefresh?: boolean } = {}): Promise<ProviderDescriptor> {
    return this.descriptorService.getProvider(providerId, options);
  }

  async startAuth(providerId: ProviderId, mode?: 'cli' | 'api_key', options: { force?: boolean } = {}) {
    return this.authService.startAuth(providerId, mode, options);
  }

  async adoptAuth(providerId: ProviderId) {
    return this.authService.adoptAuth(providerId);
  }

  async clearAuth(providerId: ProviderId) {
    return this.authService.clearAuth(providerId);
  }

  async saveApiKey(providerId: ProviderId, apiKey: string) {
    return this.authService.saveApiKey(providerId, apiKey);
  }

  async submitComposer(input: ComposerSubmitInput): Promise<ComposerSubmitResult> {
    const project = this.db.getProject(input.projectId);
    this.assertPromptWorkspaceContext(input.prompt, input.runMode ?? 'default', project.folderPath);
    this.assertProviderProjectContext(input.providerId, project.folderPath, project.trusted);

    const thread = input.threadId
      ? this.db.getThread(input.threadId)
      : this.db.createThread({
          projectId: input.projectId,
          providerId: input.providerId,
          modelId: input.modelId,
          executionPermission: input.executionPermission
        });
    const nextThread =
      thread.providerId === input.providerId &&
      thread.modelId === input.modelId &&
      thread.executionPermission === input.executionPermission
        ? thread
        : this.db.syncThreadRunConfiguration(thread.id, {
            providerId: input.providerId,
            modelId: input.modelId,
            executionPermission: input.executionPermission
          });

    if (this.followUpService.isThreadActive(nextThread)) {
      const queued = await this.followUpService.queueForActiveThread({
        thread: nextThread,
        prompt: input.prompt,
        skillIds: input.skillIds,
        imageAttachments: input.imageAttachments,
        textAttachments: input.textAttachments
      });
      return {
        disposition: 'queued',
        thread: queued.thread,
        queuedFollowUp: queued.queuedFollowUp
      };
    }

    const shouldGenerateTitle = this.shouldSuggestThreadTitle(nextThread, input.prompt);
    const result = await this.startExecutionRun(input, nextThread, project, {
      approvedPlan: null,
      plannerAnswers: null
    }, null, shouldGenerateTitle);
    return {
      disposition: 'started',
      thread: result.thread,
      runId: result.runId
    };
  }

  async enhancePrompt(input: {
    prompt: string;
    projectId?: string | null;
    providerId: ProviderId;
    modelId: string;
    reasoningEffort?: ComposerSubmitInput['reasoningEffort'];
    thinkingEnabled?: boolean;
  }): Promise<{ prompt: string }> {
    return this.promptTextService.enhancePrompt(input);
  }

  async generateCollaborationThreadSummary(threadId: string): Promise<ThreadCollaborationSummary> {
    return this.summaryTextService.generateCollaborationThreadSummary(threadId);
  }

  async generateSubagentTerminalSummary(input: {
    threadId: string;
    providerId: ProviderId;
    modelId: string;
    status: 'completed' | 'failed' | 'cancelled';
    fallback?: string | null;
  }) {
    return this.summaryTextService.generateSubagentTerminalSummary(input);
  }

  async setPlannerMode(input: PlannerSetModeInput): Promise<ThreadDetail> {
    return this.plannerSessionService.setPlannerMode(input);
  }

  async submitPlanner(input: PlannerSubmitInput): Promise<{ thread: ThreadDetail; runId: string }> {
    return this.plannerSessionService.submitPlanner(input);
  }

  async answerPlannerQuestions(input: PlannerAnswerInput): Promise<{ thread: ThreadDetail; runId: string }> {
    return this.plannerSessionService.answerPlannerQuestions(input);
  }

  async approvePlannerPlan(input: PlannerApprovePlanInput): Promise<{ thread: ThreadDetail; runId: string }> {
    const thread = this.db.getThread(input.threadId);
    const plan = this.db.approvePlannerPlan(thread.id, input.planId);
    const latestAnswers = this.db.getLatestPlannerQuestionSet(thread.id)?.answers ?? null;
    const executionPrompt = 'Implement the approved plan.';

    const result = await this.startExecutionRun(
      {
        projectId: thread.projectId,
        threadId: thread.id,
        prompt: executionPrompt,
        providerId: thread.providerId,
        modelId: thread.modelId,
        executionPermission: thread.executionPermission,
        skillIds: this.extractThreadSkillIds(thread)
      },
      this.db.getThread(thread.id),
      this.db.getProject(thread.projectId),
      {
        approvedPlan: plan,
        plannerAnswers: latestAnswers
      },
      {
        approvedPlanId: plan.id,
        plannerHandoff: true
      }
    );

    this.emit({
      type: 'planner.planApproved',
      threadId: thread.id,
      planner: this.db.getThreadPlannerState(thread.id),
      plan: this.db.getPlannerPlan(plan.id),
      runId: result.runId
    });
    return result;
  }

  async cancelPlannerSession(input: PlannerCancelInput): Promise<ThreadDetail> {
    return this.plannerSessionService.cancelPlannerSession(input);
  }

  async retryThread(threadId: string): Promise<{ runId: string }> {
    const thread = this.db.getThread(threadId);
    const lastUserTurn = [...thread.turns].reverse().find((turn) => turn.role === 'user');
    if (!lastUserTurn) {
      throw new Error('No prior user turn found.');
    }
    const result = await this.submitComposer({
      projectId: thread.projectId,
      threadId,
      prompt: lastUserTurn.content,
      providerId: thread.providerId,
      modelId: thread.modelId,
      executionPermission: thread.executionPermission,
      skillIds: this.readTurnSkillIds(lastUserTurn.metadata ?? null),
      imageAttachments: this.readTurnImageAttachments(lastUserTurn.metadata ?? null),
      textAttachments: this.readTurnTextAttachments(lastUserTurn.metadata ?? null)
    });
    if (result.disposition !== 'started') {
      throw new Error('Retry unexpectedly queued instead of starting.');
    }
    return { runId: result.runId };
  }

  async stopRun(runId: string) {
    const threadId = this.db.findThreadIdByRunId(runId);
    if (threadId) {
      const thread = this.db.getThread(threadId);
      if (thread.status === 'queued' || thread.status === 'running') {
        this.db.updateThreadStatus(threadId, 'stopping');
        this.threadProjection.emitThread(threadId);
      }
    }

    const handle = this.running.get(runId);
    if (!handle) {
      this.clearPendingToolApprovals(runId, 'cancelled');
      if (threadId) {
        const thread = this.db.getThread(threadId);
        const isTerminal = thread.rawOutput.some(
          (event) => event.runId === runId && (event.eventType === 'completed' || event.eventType === 'failed' || event.eventType === 'aborted')
        );
        if (!isTerminal && (thread.status === 'queued' || thread.status === 'running' || thread.status === 'stopping')) {
          this.db.addRunEvent(threadId, runId, 'aborted', { message: 'Run stopped after the active process was lost.' });
          this.db.updateThreadStatus(threadId, 'aborted');
          this.threadProjection.emitThread(threadId);
          this.emit({ type: 'run.status', threadId, runId, status: 'aborted', message: 'Run stopped after the active process was lost.' });
          void this.followUpService.maybeDispatchNextFollowUp(threadId);
        }
      }
      return;
    }

    this.clearPendingToolApprovals(runId, 'cancelled');
    await handle.cancel('Run stopped by user.');
  }

  async updateQueuedFollowUp(followUpId: string, content: string): Promise<ThreadFollowUp> {
    const followUp = this.db.updateThreadFollowUp(followUpId, content);
    this.emit({ type: 'followup.updated', threadId: followUp.threadId, followUp });
    this.threadProjection.emitThreadDetail(followUp.threadId);
    const activeRunId = this.runningByThread.get(followUp.threadId);
    if (activeRunId) {
      const thread = this.db.getThread(followUp.threadId);
      this.refreshDerivedRunProgress(thread.id, activeRunId, thread.providerId, thread.modelId);
    }
    return followUp;
  }

  async removeQueuedFollowUp(followUpId: string): Promise<void> {
    const followUp = this.db.cancelThreadFollowUp(followUpId);
    this.emit({ type: 'followup.removed', threadId: followUp.threadId, followUpId });
    this.threadProjection.emitThreadDetail(followUp.threadId);
    const activeRunId = this.runningByThread.get(followUp.threadId);
    if (activeRunId) {
      const thread = this.db.getThread(followUp.threadId);
      this.refreshDerivedRunProgress(thread.id, activeRunId, thread.providerId, thread.modelId);
    }
  }

  async resumeQueuedFollowUps() {
    for (const threadId of this.db.listThreadIdsWithQueuedFollowUps()) {
    await this.followUpService.maybeDispatchNextFollowUp(threadId);
    }
  }

  async startDelegatedBackgroundRun(input: {
    projectId: string;
    threadId?: string | null;
    title: string;
    prompt: string;
    providerId: ProviderId;
    modelId: string;
    reasoningEffort?: ComposerSubmitInput['reasoningEffort'];
    executionPermission: ExecutionPermission;
    delegationProfile: AutonomyDelegationProfile;
  }): Promise<{ thread: ThreadDetail; runId: string }> {
    const project = this.db.getProject(input.projectId);
    const thread =
      input.threadId
        ? this.db.getThread(input.threadId)
        : this.db.createThread({
            projectId: input.projectId,
            title: input.title,
            providerId: input.providerId,
            modelId: input.modelId,
            executionPermission: input.executionPermission
          });

    return this.startExecutionRun(
      {
        projectId: input.projectId,
        threadId: thread.id,
        prompt: input.prompt,
        providerId: input.providerId,
        modelId: input.modelId,
        reasoningEffort: resolveSubagentReasoningEffort(
          input.delegationProfile,
          input.reasoningEffort ?? null
        ),
        executionPermission: input.executionPermission,
        executionConstraints: createBackgroundSubagentExecutionConstraints(
          input.delegationProfile
        ),
        skillIds: []
      },
      thread,
      project,
      {
        approvedPlan: null,
        plannerAnswers: null,
        contextProfile: 'delegated',
        includeMemory: false,
        includeGeneratedMemory: false,
        delegation: {
          mode: 'background',
          profile: input.delegationProfile,
          title: input.title
        }
      },
      {
        background: true,
        delegationMode: 'background',
        delegationProfile: input.delegationProfile
      },
      false
    );
  }

  private async startExecutionRun(
    input: ComposerSubmitInput,
    thread: ThreadDetail,
    project: ReturnType<DatabaseService['getProject']>,
    executionContext: ExecutionContext,
    userTurnMetadata: Record<string, unknown> | null = null,
    shouldGenerateTitle = false
  ): Promise<{ thread: ThreadDetail; runId: string }> {
    return this.executionService.startExecutionRun(
      input,
      thread,
      project,
      executionContext,
      userTurnMetadata,
      shouldGenerateTitle
    );
  }

  private extractThreadSkillIds(thread: ThreadDetail) {
    const lastUserTurn = [...thread.turns].reverse().find((turn) => turn.role === 'user');
    return this.readTurnSkillIds(lastUserTurn?.metadata ?? null);
  }

  private readTurnSkillIds(metadata: Record<string, unknown> | null) {
    const skillIds = metadata?.skillIds;
    return Array.isArray(skillIds) ? skillIds.filter((value): value is string => typeof value === 'string') : [];
  }

  private readTurnImageAttachments(metadata: Record<string, unknown> | null) {
    const imageAttachments = metadata?.imageAttachments;
    if (!Array.isArray(imageAttachments)) {
      return [];
    }

    return imageAttachments.filter((value): value is ImageAttachment => {
      if (!value || typeof value !== 'object') {
        return false;
      }

      const candidate = value as Partial<ImageAttachment>;
      return (
        typeof candidate.id === 'string' &&
        typeof candidate.name === 'string' &&
        typeof candidate.mimeType === 'string' &&
        typeof candidate.dataUrl === 'string'
      );
    });
  }

  private emit(event: AppEvent) {
    if (this.disposed) {
      return;
    }
    this.emitter.emit('event', event);
  }

  private clearNativePlannerRunState(threadId: string, runId: string) {
    this.running.delete(runId);
    this.runEvents.clearRunInfo(runId);
    this.runProgress.clear(runId);
    if (this.plannerRunsByThread.get(threadId) === runId) {
      this.plannerRunsByThread.delete(threadId);
    }
  }

  private updateNativePlannerRunProgress(
    threadId: string,
    runId: string,
    providerId: ProviderId,
    phase: NonNullable<RunProgressState['delegation']>['phase']
  ) {
    this.runProgress.updateNativePlannerRunProgress(threadId, runId, providerId, phase);
  }

  private readTurnTextAttachments(metadata: Record<string, unknown> | null) {
    const textAttachments = metadata?.textAttachments;
    if (!Array.isArray(textAttachments)) {
      return [];
    }

    return textAttachments.filter((value): value is TextAttachment => {
      if (!value || typeof value !== 'object') {
        return false;
      }

      const candidate = value as Partial<TextAttachment>;
      return (
        typeof candidate.id === 'string' &&
        typeof candidate.name === 'string' &&
        candidate.mimeType === 'text/plain' &&
        typeof candidate.relativePath === 'string' &&
        typeof candidate.absolutePath === 'string' &&
        typeof candidate.charCount === 'number'
      );
    });
  }

  private finalizeSuccessfulExecutionRun(input: {
    threadId: string;
    runId: string;
    output: string;
    workspaceSnapshot: ReturnType<typeof captureWorkspaceSnapshot>;
    projectFolderPath: string;
    approvedPlan: boolean;
    titlePrompt: string | null;
  }) {
    this.running.delete(input.runId);
    this.runningByThread.delete(input.threadId);
    this.runFinalization.finalizeSuccessfulExecutionRun(input);
  }

  private finalizeExecutionRunFailure(input: {
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
  }) {
    this.running.delete(input.runId);
    this.runningByThread.delete(input.threadId);
    this.runFinalization.finalizeExecutionRunFailure(input);
  }

  private decryptApiKey(value: string) {
    const buffer = Buffer.from(value, 'base64');
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buffer) : buffer.toString('utf8');
  }

  private shouldSuggestThreadTitle(thread: ThreadDetail, prompt: string) {
    return thread.title.trim() === 'New thread' && thread.turns.length === 0 && Boolean(prompt.trim());
  }

  private assertProviderRunPermission(providerId: ProviderId, executionPermission: ComposerSubmitInput['executionPermission']) {
    if (
      providerCapabilities(providerId).requiresFullAccessForAppRuns &&
      executionPermission !== 'full_access'
    ) {
      throw new Error(
        `${providerDisplayName(providerId)} runs in Vicode currently require Full access. The official ${providerCliLabel(providerId)} docs state that non-interactive print mode implicitly enables auto-approval. Switch permissions to Full access and retry.`
      );
    }
  }

  private assertProviderProjectContext(providerId: ProviderId, folderPath: string | null, trusted: boolean) {
    this.projectPolicy.assertProviderProjectContext(providerId, folderPath, trusted);
  }

  private assertPromptWorkspaceContext(
    prompt: string,
    runMode: ComposerMode,
    folderPath: string | null
  ) {
    if (folderPath || !promptRequiresAttachedWorkspace(prompt, runMode)) {
      return;
    }

    throw new Error(
      'This project does not have a workspace folder yet. Attach a folder before asking Vicode to inspect files, write files, run commands, or answer workspace path questions.'
    );
  }

  private clearPendingToolApprovals(runId?: string, decision: RunToolApprovalDecision = 'cancelled') {
    this.toolApprovalService.clearPendingToolApprovals(runId, decision);
  }

  private clearPendingToolApprovalsForThread(
    threadId: string,
    decision: RunToolApprovalDecision
  ) {
    this.toolApprovalService.clearPendingToolApprovalsForThread(threadId, decision);
  }
  private refreshDerivedRunProgress(threadId: string, runId: string, providerId: ProviderId, modelId: string) {
    const progress = this.runProgress.get(runId);
    if (!progress) {
      return;
    }

    const thread = this.db.getThread(threadId);
    const next = this.contextSupport.deriveProgressEnhancements(progress, thread, providerId, modelId);
    if (next) {
      this.runProgress.publish(next);
    }
  }
}
