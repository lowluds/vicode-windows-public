import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { safeStorage } from 'electron';
import { OllamaAdapter } from '../../providers/ollama/adapter';
import { fetchOllamaWithRetry } from '../../providers/ollama/transport';
import { AppRuntimeProviderAdapter } from '../../providers/app-runtime-adapter';
import { RetiredProviderAdapter } from '../../providers/retired-adapter';
import type {
  AutonomyDelegationProfile,
  ProviderRunContext,
  ProviderRunHandle
} from '../../providers/types';
import type {
  AgentExecutionConstraints,
  ComposerMode,
  ComposerSubmitInput,
  ComposerSubmitResult,
  CustomProviderDefinition,
  CustomProviderSettings,
  CustomProviderSettingsSaveInput,
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
  RunChangeArtifact,
  RunActivityInfo,
  RunRuntimeTraceMark,
  RunRuntimeTraceStage,
  RunToolApprovalDecision,
  RunToolApprovalRequest,
  StagedWorkspaceHunkApplyInput,
  StagedWorkspaceHunkRejectInput,
  StagedWorkspaceHunkRevertInput,
  StagedWorkspaceHunkReviewResult,
  StagedWorkspaceReviewInput,
  StagedWorkspaceReviewResult,
  TextAttachment,
  ThreadFollowUp,
  ThreadDetail,
  RunProgressState,
  WorktreeReviewInput,
  WorktreeReviewResult,
  WorktreeCleanupInput,
  WorktreeCleanupResult,
  WorktreeHunkApplyInput,
  WorktreeHunkRejectInput,
  WorktreeHunkRevertInput,
  WorktreeHunkReviewResult
} from '../../shared/domain';
import type { ThreadCollaborationSummary } from '../../shared/ipc';
import type { AppEvent } from '../../shared/events';
import { resolveSubagentReasoningEffort } from '../../shared/subagents';
import { cleanFinalAssistantDisplayText } from '../../shared/assistant-text/final-display-cleanup';
import { DatabaseService } from '../../storage/database';
import {
  providerAuthBrand,
  providerCapabilities,
  providerCliLabel,
  providerDisplayName,
  providerRetiredMessage,
  isRetiredProviderId
} from '../../shared/providers';
import { promptRequiresAttachedWorkspace } from '../../shared/workspace-run-guard';
import { WorkspaceContextService, type WorkspaceContextResult } from './workspace-context';
import { WorkspaceMemoryService } from './memory';
import { GeneratedMemoryRetrievalService } from './generated-memory-retrieval';
import { SkillContextService } from './skill-context';
import { ProjectKnowledgeRouter } from './project-knowledge-router';
import { captureWorkspaceSnapshot } from './workspace-changes';
import { OllamaRuntimeService } from './ollama-runtime';
import type { OllamaFinalAnswerFormatter } from './ollama-final-answer-formatter';
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
import { ProviderModelExecutionService } from './provider-model-execution-service';
import {
  resolveCustomProviderModelTransport,
  resolveProviderModelTransport
} from './provider-model-transport-registry';
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
import { ThreadContextCompactionService } from './thread-context-compaction-service';
import { ThreadContextCompactionTriggerService } from './thread-context-compaction-trigger';
import { StagedWorkspaceReviewService } from './staged-workspace-review';
import { HarnessWorktreeReviewService } from './harness-worktree-review';
import { HarnessWorktreeCleanupService } from './harness-worktree-cleanup';
import { evaluateHarnessWorktreeCleanupAutomation } from './harness-worktree-cleanup-policy';
import type {
  HarnessWorktreeCreateResult,
  HarnessWorktreeCleanupInput,
  HarnessWorktreeCleanupResult,
  PrepareHarnessWorktreeSessionInput
} from './harness-worktree-session';
import { VicodeGuidanceService } from './vicode-guidance';
import { ProjectKnowledgeService } from './project-knowledge';
import { createAgentRuntimeProjectKnowledgeBridge } from './agent-runtime-project-knowledge';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeStagedWorkspaceChangeSetForRenderer(value: unknown) {
  if (!isRecord(value)) {
    return value;
  }

  const operations = Array.isArray(value.operations)
    ? value.operations.map((operation) => {
        if (!isRecord(operation)) {
          return operation;
        }
        const { beforeContent: _beforeContent, proposedAfterContent: _proposedAfterContent, patchText: _patchText, ...safeOperation } = operation;
        return safeOperation;
      })
    : value.operations;

  return {
    ...value,
    operations
  };
}

const UNSAFE_WORKTREE_RENDERER_KEYS = new Set([
  'sourceRepoRoot',
  'sourceWorkspaceRoot',
  'runtimeWorkspaceRoot',
  'worktreeRepoRoot',
  'worktreeWorkspaceRoot'
]);

function sanitizeWorktreeRendererValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeWorktreeRendererValue(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !UNSAFE_WORKTREE_RENDERER_KEYS.has(key))
      .map(([key, entryValue]) => [key, sanitizeWorktreeRendererValue(entryValue)])
  );
}

function sanitizeWorktreeChangeArtifactForRenderer(value: unknown): unknown {
  if (!isRecord(value) || value.source !== 'worktree_diff') {
    return value;
  }

  const files = Array.isArray(value.files)
    ? value.files.map((file) => {
        if (!isRecord(file)) {
          return file;
        }
        const {
          beforeContent: _beforeContent,
          afterContent: _afterContent,
          patchText: _patchText,
          previewLines: _previewLines,
          ...safeFile
        } = file;
        return safeFile;
      })
    : value.files;

  return {
    ...value,
    files
  };
}

function sanitizeReviewThread(thread: ThreadDetail): ThreadDetail {
  return {
    ...thread,
    rawOutput: thread.rawOutput.map((event) => {
      if (!isRecord(event.payload)) {
        return event;
      }

      let payload = event.payload;
      if ('stagedWorkspaceChangeSet' in payload) {
        payload = {
          ...payload,
          stagedWorkspaceChangeSet: sanitizeStagedWorkspaceChangeSetForRenderer(payload.stagedWorkspaceChangeSet)
        };
      }

      const runtimeTrace = isRecord(payload.runtimeTrace) ? payload.runtimeTrace : null;
      if (runtimeTrace && 'detail' in runtimeTrace) {
        payload = {
          ...payload,
          runtimeTrace: {
            ...runtimeTrace,
            detail: sanitizeWorktreeRendererValue(runtimeTrace.detail)
          }
        };
      }

      const activity = isRecord(payload.activity) ? payload.activity : null;
      if (activity && 'changeArtifact' in activity) {
        payload = {
          ...payload,
          activity: {
            ...activity,
            changeArtifact: sanitizeWorktreeChangeArtifactForRenderer(activity.changeArtifact)
          }
        };
      }

      const progressSnapshot = isRecord(payload.progressSnapshot) ? payload.progressSnapshot : null;
      if (progressSnapshot && 'changeArtifact' in progressSnapshot) {
        payload = {
          ...payload,
          progressSnapshot: {
            ...progressSnapshot,
            changeArtifact: sanitizeWorktreeChangeArtifactForRenderer(progressSnapshot.changeArtifact)
          }
        };
      }

      return {
        ...event,
        payload
      };
    })
  };
}

interface ProviderWorktreeSessionHost {
  create(input: PrepareHarnessWorktreeSessionInput): Promise<HarnessWorktreeCreateResult>;
  cleanup(input: HarnessWorktreeCleanupInput): Promise<HarnessWorktreeCleanupResult>;
}

export class ProviderManager {
  private readonly adapters: Record<ProviderId, ProviderAdapter>;
  private readonly workspaceContext: WorkspaceContextService;
  private readonly skillContext: SkillContextService;
  private readonly running = new Map<string, ProviderRunHandle>();
  private readonly runningByThread = new Map<string, string>();
  private readonly plannerRunsByThread = new Map<string, string>();
  private readonly emitter = new EventEmitter();
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
  private readonly threadContextCompaction: ThreadContextCompactionService;
  private readonly threadContextCompactionTrigger: ThreadContextCompactionTriggerService;
  private readonly descriptorService: ProviderDescriptorService;
  private readonly followUpService: ProviderFollowUpService;
  private readonly contextSupport: ProviderContextSupportService;
  private readonly workspaceContextSupport: ProviderWorkspaceContextSupportService;
  private readonly vicodeGuidance: VicodeGuidanceService;
  private readonly runtimeToolService: ProviderRuntimeToolService;
  private readonly runOutput: ProviderRunOutputService;
  private readonly runEvents: ProviderRunEventService;
  private readonly runFinalization: ProviderRunFinalizationService;
  private readonly stagedWorkspaceReview: StagedWorkspaceReviewService;
  private readonly worktreeReview: HarnessWorktreeReviewService;
  private readonly worktreeCleanup: HarnessWorktreeCleanupService | null;
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
    agentRuntime?: AgentRuntimeService,
    _ollamaFinalAnswerFormatter?: OllamaFinalAnswerFormatter,
    private readonly harnessWorktreeSessions?: ProviderWorktreeSessionHost
  ) {
    const projectKnowledgeService = new ProjectKnowledgeService({ indexReader: db });
    this.agentRuntime = agentRuntime ?? new AgentRuntimeService(
      undefined,
      undefined,
      undefined,
      createAgentRuntimeProjectKnowledgeBridge(db, projectKnowledgeService)
    );
    this.adapters =
      adapters ?? {
        openai: new RetiredProviderAdapter('openai'),
        gemini: new RetiredProviderAdapter('gemini'),
        qwen: new RetiredProviderAdapter('qwen'),
        ollama: new OllamaAdapter(ollamaRuntime, this.agentRuntime),
        kimi: new RetiredProviderAdapter('kimi'),
        openai_compatible: new AppRuntimeProviderAdapter('openai_compatible')
      };
    this.skillContext = new SkillContextService(db);
    this.workspaceContext =
      workspaceContext ??
      new WorkspaceContextService({
        memoryRetriever: new WorkspaceMemoryService(db),
        generatedMemoryRetriever: new GeneratedMemoryRetrievalService(db),
        projectKnowledgeRetriever: new ProjectKnowledgeRouter(projectKnowledgeService),
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
      resolveAvailableAuthMode: (providerId, auth, account) => this.descriptorService.resolveAvailableAuthMode(providerId, auth, account),
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
      requestToolApproval: (input, runtimeCommandPolicy, options) =>
        this.toolApprovalService.requestToolApproval(input, runtimeCommandPolicy, options)
    });
    this.runEvents = new ProviderRunEventService({
      db: this.db,
      emit: (event) => this.emit(event)
    });
    this.stagedWorkspaceReview = new StagedWorkspaceReviewService(this.db);
    this.worktreeReview = new HarnessWorktreeReviewService(this.db);
    this.worktreeCleanup = this.harnessWorktreeSessions
      ? new HarnessWorktreeCleanupService(this.db, this.harnessWorktreeSessions)
      : null;
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
    this.threadContextCompaction = new ThreadContextCompactionService({
      db: this.db,
      summarize: ({ thread, prompt }) =>
        this.summaryTextService.generateThreadContextCompactionSummary(thread, prompt)
    });
    this.threadContextCompactionTrigger = new ThreadContextCompactionTriggerService({
      compactionService: this.threadContextCompaction,
      onCompacted: ({ threadId, runId, compaction }) => {
        const event = this.db.addRunEvent(threadId, runId, 'info', {
          message: 'Context automatically compacted',
          eventKind: 'tool_activity',
          transcriptVisible: true,
          activity: {
            kind: 'context_compaction',
            summary: 'Context automatically compacted',
            text: 'Older thread context was summarized so the run can continue within the model context window.',
            providerEventType: 'vicode_thread_context_compaction'
          } satisfies RunActivityInfo,
          threadCompaction: {
            id: compaction.id,
            sourceStartEventId: compaction.sourceStartEventId,
            sourceEndEventId: compaction.sourceEndEventId,
            inputTokenEstimate: compaction.inputTokenEstimate,
            outputTokenEstimate: compaction.outputTokenEstimate
          }
        });
        if (event) {
          this.emit({ type: 'raw.event', event });
        }
      }
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
    this.runOutput = new ProviderRunOutputService(db);
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
      executeProviderRuntimeToolCall: (input) => this.runtimeToolService.executeProviderRuntimeToolCall(input as never),
      collectRunDeltaText: (threadId, runId) => this.runOutput.collectRunDeltaText(threadId, runId),
      collectAssistantText: (threadId, runId) => this.runOutput.collectAssistantText(threadId, runId),
      recordInfoEvent: (threadId, runId, normalizedInfo) =>
        this.runEvents.recordInfoEvent(threadId, runId, normalizedInfo),
      recordRuntimeTraceMark: (threadId, runId, stage, payload) =>
        this.runEvents.recordRuntimeTraceMark(threadId, runId, stage as RunRuntimeTraceStage, payload ?? null),
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
    const providerModelExecutionService = new ProviderModelExecutionService({
      agentRuntime: this.agentRuntime,
      resolveTransport: (input) =>
        input.providerId === 'openai_compatible'
          ? this.resolveCustomProviderTransport(input.customProviderId)
          : resolveProviderModelTransport({
              ...input,
              ollamaRuntimeBaseUrl: ollamaRuntime.baseUrl,
              fetchOllamaWithRetry: (baseUrl, path, options, apiKey, timeoutMs) =>
                fetchOllamaWithRetry({
                  runtime: ollamaRuntime,
                  fetchImpl: globalThis.fetch,
                  baseUrl,
                  path,
                  options,
                  apiKey,
                  timeoutMs
                })
            })
    });
    this.executionService = new ProviderExecutionService({
      adapters: this.adapters,
      db: this.db,
      providerModelExecutionService,
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
      createProjectKnowledgeActivity: (projectKnowledgeBlocks, routerEvidence) =>
        this.workspaceContextSupport.createProjectKnowledgeActivity(
          projectKnowledgeBlocks as WorkspaceContextResult['projectKnowledgeBlocks'],
          routerEvidence as WorkspaceContextResult['projectKnowledgeRouter']
        ),
      createSkillActivity: (workspaceContext) =>
        this.workspaceContextSupport.createSkillActivity({
          selectedSkillIds: workspaceContext.selectedSkillIds,
          autoSelectedSkillIds: workspaceContext.autoSelectedSkillIds ?? [],
          mentionedSkillIds: workspaceContext.mentionedSkillIds ?? []
        }),
      resolveVicodeGuidance: (input) => this.vicodeGuidance.resolveForPrompt(input),
      createGeneratedMemoryTraceDetail: (input) =>
        this.workspaceContextSupport.createGeneratedMemoryTraceDetail(input),
      countQueuedSteerFollowUps: (thread) => this.contextSupport.countQueuedSteerFollowUps(thread),
      createHarnessWorktreeSession: this.harnessWorktreeSessions
        ? (input) => this.harnessWorktreeSessions!.create(input)
        : undefined,
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
      maybeCreateThreadContextCompactionFromContextUsage: (input) => {
        void this.threadContextCompactionTrigger.maybeCreateFromContextUsage(input);
      },
      usesAppAuthoritativeToolApproval: (providerId) => this.runtimeToolService.usesAppAuthoritativeToolApproval(providerId),
      requestToolApproval: (request, runtimeCommandPolicy, options) =>
        this.toolApprovalService.requestToolApproval(request, runtimeCommandPolicy, options),
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
      shouldFinalizeWithProviderCleanup: () => false,
      finalizeSuccessfulExecutionRunWithProviderCleanup: (input) =>
        this.runOutput.finalizeSuccessfulExecutionRunWithProviderCleanup(
          input,
          (next) => this.finalizeSuccessfulExecutionRun(next),
          () => this.disposed
        ),
      finalizeProviderModelAssistantOutput: (context, output) =>
        this.finalizeProviderModelAssistantOutput(context, output)
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

  hasActiveRuns() {
    return this.running.size > 0;
  }

  async approveToolApproval(approvalId: string) {
    this.toolApprovalService.approveToolApproval(approvalId);
  }

  async rejectToolApproval(approvalId: string) {
    this.toolApprovalService.rejectToolApproval(approvalId);
  }

  async applyStagedWorkspaceChange(input: StagedWorkspaceReviewInput): Promise<StagedWorkspaceReviewResult> {
    const workspaceRoot = this.resolveStagedWorkspaceReviewWorkspace(input.threadId);
    const decision = await this.stagedWorkspaceReview.apply({
      ...input,
      workspaceRoot
    });
    return this.createStagedWorkspaceReviewResult(input.threadId, decision);
  }

  async rejectStagedWorkspaceChange(input: StagedWorkspaceReviewInput): Promise<StagedWorkspaceReviewResult> {
    const decision = await this.stagedWorkspaceReview.reject(input);
    return this.createStagedWorkspaceReviewResult(input.threadId, decision);
  }

  async revertStagedWorkspaceChange(input: StagedWorkspaceReviewInput): Promise<StagedWorkspaceReviewResult> {
    const workspaceRoot = this.resolveStagedWorkspaceReviewWorkspace(input.threadId);
    const decision = await this.stagedWorkspaceReview.revert({
      ...input,
      workspaceRoot
    });
    return this.createStagedWorkspaceReviewResult(input.threadId, decision);
  }

  async previewStagedWorkspaceChange(input: StagedWorkspaceReviewInput): Promise<RunChangeArtifact> {
    return this.stagedWorkspaceReview.preview(input);
  }

  async applyStagedWorkspaceHunks(input: StagedWorkspaceHunkApplyInput): Promise<StagedWorkspaceHunkReviewResult> {
    const workspaceRoot = this.resolveStagedWorkspaceReviewWorkspace(input.threadId);
    const decision = await this.stagedWorkspaceReview.applyHunks({
      ...input,
      workspaceRoot
    });
    return this.createStagedWorkspaceHunkReviewResult(input.threadId, decision);
  }

  async rejectStagedWorkspaceHunks(input: StagedWorkspaceHunkRejectInput): Promise<StagedWorkspaceHunkReviewResult> {
    const decision = await this.stagedWorkspaceReview.rejectHunks(input);
    return this.createStagedWorkspaceHunkReviewResult(input.threadId, decision);
  }

  async revertStagedWorkspaceHunks(input: StagedWorkspaceHunkRevertInput): Promise<StagedWorkspaceHunkReviewResult> {
    const workspaceRoot = this.resolveStagedWorkspaceReviewWorkspace(input.threadId);
    const decision = await this.stagedWorkspaceReview.revertHunks({
      ...input,
      workspaceRoot
    });
    return this.createStagedWorkspaceHunkReviewResult(input.threadId, decision);
  }

  async applyWorktreeReview(input: WorktreeReviewInput): Promise<WorktreeReviewResult> {
    const decision = await this.worktreeReview.apply(input);
    return this.createWorktreeReviewResult(input.threadId, decision);
  }

  async rejectWorktreeReview(input: WorktreeReviewInput): Promise<WorktreeReviewResult> {
    const decision = await this.worktreeReview.reject(input);
    await this.maybeAutoCleanupWorktreeAfterReview(decision);
    return this.createWorktreeReviewResult(input.threadId, decision);
  }

  async revertWorktreeReview(input: WorktreeReviewInput): Promise<WorktreeReviewResult> {
    const decision = await this.worktreeReview.revert(input);
    await this.maybeAutoCleanupWorktreeAfterReview(decision);
    return this.createWorktreeReviewResult(input.threadId, decision);
  }

  async applyWorktreeHunks(input: WorktreeHunkApplyInput): Promise<WorktreeHunkReviewResult> {
    const decision = await this.worktreeReview.applyHunks(input);
    return this.createWorktreeHunkReviewResult(input.threadId, decision);
  }

  async rejectWorktreeHunks(input: WorktreeHunkRejectInput): Promise<WorktreeHunkReviewResult> {
    const decision = await this.worktreeReview.rejectHunks(input);
    return this.createWorktreeHunkReviewResult(input.threadId, decision);
  }

  async revertWorktreeHunks(input: WorktreeHunkRevertInput): Promise<WorktreeHunkReviewResult> {
    const decision = await this.worktreeReview.revertHunks(input);
    return this.createWorktreeHunkReviewResult(input.threadId, decision);
  }

  async cleanupWorktreeReview(input: WorktreeCleanupInput): Promise<WorktreeCleanupResult> {
    if (!this.worktreeCleanup) {
      throw new Error('Worktree cleanup service is unavailable.');
    }

    const decision = await this.worktreeCleanup.cleanup(input);
    return this.createWorktreeCleanupResult(input.threadId, decision);
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

  listCustomProviderSettings(): CustomProviderSettings[] {
    return this.db.listCustomProviders().map((provider) => this.mapCustomProviderSettings(provider));
  }

  saveCustomProviderSettings(input: CustomProviderSettingsSaveInput): CustomProviderSettings {
    const { apiKey, ...settings } = input;
    return this.mapCustomProviderSettings(
      this.db.saveCustomProvider({
        ...settings,
        encryptedApiKey: this.encryptApiKey(apiKey)
      })
    );
  }

  deleteCustomProviderSettings(providerId: string) {
    this.db.deleteCustomProvider(providerId);
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
    const executionPrompt = 'Implement the approved plan to completion.';

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

  private async finalizeProviderModelAssistantOutput(_context: ProviderRunContext, output: string) {
    const trimmed = output.trim();
    if (!trimmed) {
      return trimmed;
    }
    return cleanFinalAssistantDisplayText(trimmed);
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

  private encryptApiKey(value: string) {
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(value).toString('base64')
      : Buffer.from(value, 'utf8').toString('base64');
  }

  private resolveCustomProviderTransport(customProviderId: string | null | undefined) {
    if (!customProviderId?.trim()) {
      return null;
    }

    let provider: CustomProviderDefinition;
    try {
      provider = this.db.getCustomProvider(customProviderId);
    } catch {
      return null;
    }

    return resolveCustomProviderModelTransport({
      provider,
      decryptApiKey: (encryptedApiKey) => this.decryptApiKey(encryptedApiKey)
    });
  }

  private mapCustomProviderSettings(provider: CustomProviderDefinition): CustomProviderSettings {
    return {
      id: provider.id,
      name: provider.name,
      transportKind: provider.transportKind,
      baseUrl: provider.baseUrl,
      defaultModelId: provider.defaultModelId,
      enabled: provider.enabled,
      hasApiKey: provider.encryptedApiKey.length > 0,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt
    };
  }

  private shouldSuggestThreadTitle(thread: ThreadDetail, prompt: string) {
    return thread.title.trim() === 'New thread' && thread.turns.length === 0 && Boolean(prompt.trim());
  }

  private assertProviderRunPermission(providerId: ProviderId, executionPermission: ComposerSubmitInput['executionPermission']) {
    if (
      providerId === 'qwen' ||
      providerId === 'kimi' ||
      (isRetiredProviderId(providerId) && this.adapters[providerId] instanceof RetiredProviderAdapter)
    ) {
      throw new Error(providerRetiredMessage(providerId));
    }

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

  private resolveStagedWorkspaceReviewWorkspace(threadId: string) {
    const thread = this.db.getThread(threadId);
    const project = this.db.getProject(thread.projectId);
    if (!project.folderPath) {
      throw new Error(
        'This project does not have a workspace folder yet. Attach a folder before applying staged workspace changes.'
      );
    }

    if (!existsSync(project.folderPath)) {
      throw new Error(`Workspace folder is unavailable: ${project.folderPath}.`);
    }

    return project.folderPath;
  }

  private createStagedWorkspaceReviewResult(
    threadId: string,
    decision: StagedWorkspaceReviewResult['decision']
  ): StagedWorkspaceReviewResult {
    const thread = sanitizeReviewThread(this.db.getThread(threadId));
    this.emit({ type: 'thread.detail', thread });
    this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(threadId) });
    return {
      thread,
      decision
    };
  }

  private createStagedWorkspaceHunkReviewResult(
    threadId: string,
    decision: StagedWorkspaceHunkReviewResult['decision']
  ): StagedWorkspaceHunkReviewResult {
    const thread = sanitizeReviewThread(this.db.getThread(threadId));
    this.emit({ type: 'thread.detail', thread });
    this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(threadId) });
    return {
      thread,
      decision
    };
  }

  private createWorktreeReviewResult(
    threadId: string,
    decision: WorktreeReviewResult['decision']
  ): WorktreeReviewResult {
    const thread = sanitizeReviewThread(this.db.getThread(threadId));
    this.emit({ type: 'thread.detail', thread });
    this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(threadId) });
    return {
      thread,
      decision
    };
  }

  private createWorktreeHunkReviewResult(
    threadId: string,
    decision: WorktreeHunkReviewResult['decision']
  ): WorktreeHunkReviewResult {
    const thread = sanitizeReviewThread(this.db.getThread(threadId));
    this.emit({ type: 'thread.detail', thread });
    this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(threadId) });
    return {
      thread,
      decision
    };
  }

  private async maybeAutoCleanupWorktreeAfterReview(
    decision: WorktreeReviewResult['decision']
  ): Promise<void> {
    if (!this.worktreeCleanup) {
      return;
    }

    const thread = this.db.getThread(decision.threadId);
    const automation = evaluateHarnessWorktreeCleanupAutomation({
      runEvents: thread.rawOutput,
      reviewDecision: decision
    });

    if (automation.action !== 'attempt_cleanup') {
      return;
    }

    try {
      await this.worktreeCleanup.cleanup({
        threadId: decision.threadId,
        runId: decision.runId
      });
    } catch {
      // Cleanup is a follow-up lifecycle action; a cleanup resolution problem
      // must not turn a successful review decision into a failed review.
    }
  }

  private createWorktreeCleanupResult(
    threadId: string,
    decision: WorktreeCleanupResult['decision']
  ): WorktreeCleanupResult {
    const thread = sanitizeReviewThread(this.db.getThread(threadId));
    this.emit({ type: 'thread.detail', thread });
    this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(threadId) });
    return {
      thread,
      decision
    };
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
