import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { safeStorage } from 'electron';
import { GeminiAdapter } from '../../providers/gemini/adapter';
import { OllamaAdapter } from '../../providers/ollama/adapter';
import { OpenAIAdapter } from '../../providers/openai/adapter';
import { KimiAdapter } from '../../providers/kimi/adapter';
import { QwenAdapter } from '../../providers/qwen/adapter';
import type { AgentToolCall, AgentToolExecutionResult } from '../../providers/agent-runtime';
import type {
  AutonomyDelegationProfile,
  ProviderAdapter,
  ProviderInfoPayload,
  ProviderPlannerAnswerContext,
  ProviderPlannerSignal,
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
  ProviderAccount,
  ProviderAuthMode,
  ProviderDescriptor,
  ProviderId,
  RunChangeArtifact,
  ProviderModel,
  ProviderQuotaStatus,
  ProviderModelSource,
  ProviderContextWindowUsage,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy,
  RunActivityInfo,
  RunRuntimeTraceMark,
  RunRuntimeTraceStage,
  RunContextPressureState,
  RunToolApprovalDecision,
  RunToolApprovalRequest,
  TextAttachment,
  ThreadFollowUp,
  ThreadDetail,
  RunProgressState
} from '../../shared/domain';
import type { ThreadCollaborationSummary } from '../../shared/ipc';
import type { AppEvent } from '../../shared/events';
import {
  deriveContextWindowCompactionLikely,
  deriveContextWindowNote,
  deriveContextWindowPressureLabel,
  deriveContextWindowSeverity,
  deriveContextWindowUsagePercent,
  deriveProviderContextSourceLabel,
  resolveContextWindowLimit
} from '../../shared/context-window';
import { resolveSubagentReasoningEffort } from '../../shared/subagents';
import { collectThreadSourcesFromRunArtifacts } from '../../shared/thread-sources';
import {
  advanceRunProgress,
  completeRunProgress,
  deriveRunProgressFromPlanner,
  failRunProgress,
  shouldAdvanceRunProgressFromActivity
} from '../../shared/run-progress';
import { DatabaseService } from '../../storage/database';
import { deriveStructuredPlannerPlan } from './planner-parser';
import {
  createProviderModelFromId,
  filterUnsupportedProviderModels,
  resolveProviderModelAlias,
  sanitizeDiscoveredModels
} from '../../providers/catalog';
import { formatOllamaFinalAnswerFallback } from './ollama-final-answer-formatter';
import { normalizeDisplayText } from '../../shared/display-text';
import {
  providerAuthBrand,
  providerCapabilities,
  providerCliLabel,
  providerDisplayName,
  selectPreferredOllamaModel,
  selectPreferredOllamaVisionModel,
  selectPreferredSubagentModel
} from '../../shared/providers';
import { WorkspaceContextService, type WorkspaceContextResult } from './workspace-context';
import { WorkspaceMemoryService } from './memory';
import { GeneratedMemoryRetrievalService } from './generated-memory-retrieval';
import { normalizeGeneratedMemoryWorkspaceScopeKey } from './generated-memory';
import { SkillContextService } from './skill-context';
import { captureWorkspaceSnapshot, deriveRunChangeArtifact } from './workspace-changes';
import { OllamaRuntimeService } from './ollama-runtime';
import { OllamaFinalAnswerFormatter } from './ollama-final-answer-formatter';
import { AgentRuntimeService } from './agent-runtime';
import {
  buildCollaborationSummaryPrompt,
  buildSubagentTerminalSummaryPrompt,
  deriveCollaborationThreadSummary,
  deriveSubagentTerminalSummaryFallback,
  normalizeSubagentTerminalSummary,
  parseCollaborationSummaryOutput
} from './thread-summary';
import {
  normalizeProviderInfoEvent,
  preferProviderVisibleText,
  normalizeProviderVisibleText,
  type NormalizedProviderInfoEvent
} from './provider-run-event-normalizer';
import { createProviderReplyAssembly } from './provider-reply-assembly';
import {
  findLatestPlannerSessionId,
  resolveExecutionContinuity,
  resolvePlannerResumeSessionId,
  type ExecutionContinuityPlan
} from './provider-manager-continuity';
import { buildEffectivePrompt } from './provider-manager-prompt-builder';

const MODEL_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const AUTH_POLLING_WINDOW_MS = 90_000;
interface ResolvedProviderModels {
  models: ProviderModel[];
  source: ProviderModelSource;
  updatedAt: string | null;
  canLiveDiscoverModels: boolean;
}

interface ResolvedProviderQuota {
  quota: ProviderQuotaStatus | null;
}

const GEMINI_QUOTA_PROBE_ORDER = [
  'gemini-3.1-pro-preview',
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
] as const;

interface ExecutionContext {
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

interface PendingRunToolApproval {
  request: RunToolApprovalRequest;
  resolve: (decision: RunToolApprovalDecision) => void;
}

function formatRunChangeSummary(filesChanged: number) {
  return filesChanged === 1 ? '1 file changed' : `${filesChanged} files changed`;
}

function serializeRunChangeArtifact(artifact: RunChangeArtifact | null) {
  return JSON.stringify(artifact ?? null);
}

function createPlannerDelegationItems(runId: string) {
  return [
    {
      id: `${runId}:planner:0`,
      label: 'Review the delegated workspace contract',
      order: 0,
      status: 'completed'
    },
    {
      id: `${runId}:planner:1`,
      label: 'Resolve clarifying questions',
      order: 1,
      status: 'in_progress'
    },
    {
      id: `${runId}:planner:2`,
      label: 'Draft the implementation plan',
      order: 2,
      status: 'pending'
    }
  ] satisfies RunProgressState['items'];
}

function createBackgroundDelegationItems(runId: string) {
  return [
    {
      id: `${runId}:background:0`,
      label: 'Review delegated heartbeat contract',
      order: 0,
      status: 'completed'
    },
    {
      id: `${runId}:background:1`,
      label: 'Execute the delegated task',
      order: 1,
      status: 'in_progress'
    },
    {
      id: `${runId}:background:2`,
      label: 'Summarize the result',
      order: 2,
      status: 'pending'
    }
  ] satisfies RunProgressState['items'];
}

function createBackgroundSubagentExecutionConstraints(
  profile: AutonomyDelegationProfile
): AgentExecutionConstraints {
  return {
    permissionMode: 'default',
    toolPolicy: {
      preset: 'subagent',
      allowedToolCallNames: [],
      disallowedToolCallNames: []
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

function createMemoryRecallActivity(
  memoryBlocks: WorkspaceContextResult['memoryBlocks'],
  generatedMemoryBlocks: WorkspaceContextResult['generatedMemoryBlocks']
): RunActivityInfo | null {
  if (memoryBlocks.length === 0 && generatedMemoryBlocks.length === 0) {
    return null;
  }

  const fileNames = [...new Set(memoryBlocks.map((block) => block.fileName.trim()).filter(Boolean))];
  const summaryParts: string[] = [];
  const textParts: string[] = [];

  if (fileNames.length > 0) {
    summaryParts.push(
      fileNames.length === 1
        ? `Recalled workspace memory from ${fileNames[0]}`
        : `Recalled ${fileNames.length} workspace memory entries`
    );
    textParts.push(`Included ${fileNames.join(', ')}`);
  }

  if (generatedMemoryBlocks.length > 0) {
    summaryParts.push(
      generatedMemoryBlocks.length === 1
        ? 'Recalled 1 generated workspace recall entry'
        : `Recalled ${generatedMemoryBlocks.length} generated workspace recall entries`
    );
    textParts.push(
      `included ${generatedMemoryBlocks.length} derived non-canonical workspace recall ${
        generatedMemoryBlocks.length === 1 ? 'entry' : 'entries'
      }`
    );
  }

  if (summaryParts.length === 0 || textParts.length === 0) {
    return null;
  }

  return {
    kind: 'memory_recall',
    summary: summaryParts.join(' and '),
    text: `${textParts.join(' and ')} in the active prompt context.`
  };
}

function createGeneratedMemoryTraceDetail(input: {
  folderPath: string | null;
  trusted: boolean;
  generatedMemoryEnabled: boolean;
  generatedMemoryGenerationEnabled: boolean;
  memoryBlocks: WorkspaceContextResult['memoryBlocks'];
  generatedMemoryBlocks: WorkspaceContextResult['generatedMemoryBlocks'];
  repeatSteeringCount: number;
  firstSubstantiveAction?: string | null;
}) {
  return {
    workspaceScopeKey:
      input.trusted && input.folderPath
        ? normalizeGeneratedMemoryWorkspaceScopeKey(input.folderPath)
        : null,
    generatedMemoryEnabled: input.generatedMemoryEnabled,
    generatedMemoryGenerationEnabled: input.generatedMemoryGenerationEnabled,
    generatedMemoryUsed: input.generatedMemoryEnabled && input.generatedMemoryBlocks.length > 0,
    generatedMemoryItemIds: input.generatedMemoryBlocks.map((block) => block.itemId),
    generatedMemoryItems: input.generatedMemoryBlocks.map((block) => ({
      itemId: block.itemId,
      kind: block.kind,
      summary: block.summary,
      score: block.score,
      rank: block.retrievalReason.rank,
      kindGate: block.retrievalReason.kindGate,
      matchedTerms: block.retrievalReason.matchedTerms,
      sourceThreadIds: block.sourceThreadIds
    })),
    generatedMemorySourceThreadIds: [
      ...new Set(input.generatedMemoryBlocks.flatMap((block) => block.sourceThreadIds))
    ],
    canonicalMemoryUsed: input.memoryBlocks.length > 0,
    repeatSteeringCount: input.repeatSteeringCount,
    firstSubstantiveAction: input.firstSubstantiveAction ?? null
  } satisfies Record<string, unknown>;
}

function deriveFirstSubstantiveAction(activity: RunActivityInfo | null | undefined) {
  if (!activity) {
    return null;
  }

  if (activity.command?.trim()) {
    const command = activity.command.trim();
    const cwd = activity.cwd?.trim();
    return cwd ? `${command} (cwd: ${cwd})` : command;
  }

  if (activity.path?.trim()) {
    return activity.path.trim();
  }

  return activity.summary?.trim() || activity.toolName?.trim() || null;
}

export class ProviderManager {
  private readonly adapters: Record<ProviderId, ProviderAdapter>;
  private readonly workspaceContext: WorkspaceContextService;
  private readonly skillContext: SkillContextService;
  private readonly running = new Map<string, ProviderRunHandle>();
  private readonly runningByThread = new Map<string, string>();
  private readonly followUpDispatching = new Set<string>();
  private readonly plannerRunsByThread = new Map<string, string>();
  private readonly emitter = new EventEmitter();
  private readonly pendingAuth = new Map<ProviderId, number>();
  private readonly authPolling = new Map<ProviderId, NodeJS.Timeout>();
  private readonly lastInfoByRun = new Map<string, string>();
  private readonly runProgressByRun = new Map<string, RunProgressState>();
  private readonly lastPersistedRunProgressByRun = new Map<string, string>();
  private readonly lastChangeArtifactByRun = new Map<string, RunChangeArtifact | null>();
  private readonly pendingRunToolApprovals = new Map<string, PendingRunToolApproval>();
  private readonly ollamaFinalAnswerFormatter: OllamaFinalAnswerFormatter;
  private readonly agentRuntime: AgentRuntimeService;
  private disposed = false;

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
    for (const timer of this.authPolling.values()) {
      clearInterval(timer);
    }
    this.authPolling.clear();
    this.pendingAuth.clear();
    this.lastInfoByRun.clear();
    this.runProgressByRun.clear();
    this.lastPersistedRunProgressByRun.clear();
    this.clearPendingToolApprovals(undefined, 'cancelled');
    this.plannerRunsByThread.clear();
    this.runningByThread.clear();
    this.followUpDispatching.clear();

    const handles = Array.from(this.running.values());
    this.running.clear();
    for (const handle of handles) {
      void handle.cancel().catch(() => {});
    }

    this.emitter.removeAllListeners('event');
  }

  private resolveOllamaTransportMode(providerId: ProviderId) {
    if (providerId !== 'ollama') {
      return undefined;
    }
    return this.db.getPreferences().ollamaTransportMode;
  }

  async listProviders(): Promise<ProviderDescriptor[]> {
    return Promise.all((Object.keys(this.adapters) as ProviderId[]).map((providerId) => this.getProvider(providerId)));
  }

  listPendingToolApprovals(): RunToolApprovalRequest[] {
    return Array.from(this.pendingRunToolApprovals.values())
      .map((entry) => entry.request)
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
  }

  async approveToolApproval(approvalId: string) {
    this.resolvePendingToolApproval(approvalId, 'approved');
  }

  async rejectToolApproval(approvalId: string) {
    this.resolvePendingToolApproval(approvalId, 'rejected');
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
    const adapter = this.adapters[providerId];
    const install = await adapter.detectInstall();
    const storedAccount = this.db.getProviderAccount(providerId);
    const machineAuth = await adapter.getAuthState(storedAccount);
    const availableAuthMode = this.resolveAvailableAuthMode(machineAuth, storedAccount);
    const ollamaCloudConfigured = providerId === 'ollama' && availableAuthMode === 'api_key';

    if (!install.installed && !ollamaCloudConfigured) {
      this.clearPendingAuth(providerId);
      return {
        id: providerId,
        label: adapter.label,
        installed: false,
        cliPath: install.cliPath,
        authState: providerId === 'ollama' ? 'disconnected' : 'missing_cli',
        authMode: availableAuthMode,
        models: adapter.listStaticModels(),
        modelSource: 'fallback',
        modelsUpdatedAt: null,
        canLiveDiscoverModels: false,
        capabilities: providerCapabilities(providerId),
        plannerPolicy: adapter.getPlannerCapability(),
        quota: null,
        message: this.getMissingCliMessage(providerId, availableAuthMode)
      };
    }

    const localDisconnect = this.isLocallyDisconnected(storedAccount);
    const preserveLocalDisconnect = localDisconnect && availableAuthMode !== null;
    const auth = preserveLocalDisconnect
      ? {
          authState: 'disconnected' as const,
          authMode: availableAuthMode,
          message: this.getLocalDisconnectMessage(providerId, availableAuthMode)
        }
      : this.resolveVisibleProviderAuth(providerId, storedAccount, machineAuth);
    const account = this.syncProviderAccount(providerId, storedAccount, auth);
    const pendingSince = this.pendingAuth.get(providerId);
    const pendingFresh = pendingSince !== undefined && Date.now() - pendingSince < AUTH_POLLING_WINDOW_MS;

    if (machineAuth.authState === 'connected' && auth.authState === 'connected') {
      this.clearPendingAuth(providerId);
    } else if (pendingSince !== undefined && !pendingFresh) {
      this.clearPendingAuth(providerId);
    }

    const isChecking = pendingFresh && auth.authState !== 'connected';
    const resolvedModels = await this.getResolvedModels(providerId, adapter, {
      account,
      authMode: preserveLocalDisconnect ? null : auth.authMode,
      cliPath: install.cliPath,
      forceRefresh: options.forceRefresh ?? false
    });
    const resolvedQuota = await this.getResolvedQuota(providerId, adapter, {
      account,
      authMode: preserveLocalDisconnect ? null : auth.authMode,
      cliPath: install.cliPath,
      modelId: this.resolveQuotaProbeModelId(providerId, resolvedModels.models)
    });
    const visibleModels = this.mergeQuotaModels(providerId, resolvedModels.models, resolvedQuota.quota);

    return {
      id: providerId,
      label: adapter.label,
      installed: install.installed || ollamaCloudConfigured,
      cliPath: install.cliPath,
      authState: preserveLocalDisconnect ? 'disconnected' : isChecking ? 'checking' : auth.authState,
      authMode: preserveLocalDisconnect ? availableAuthMode : auth.authMode,
      models: visibleModels,
      modelSource: resolvedModels.source,
      modelsUpdatedAt: resolvedModels.updatedAt,
      canLiveDiscoverModels: resolvedModels.canLiveDiscoverModels,
      capabilities: providerCapabilities(providerId),
      plannerPolicy: adapter.getPlannerCapability(),
      quota: resolvedQuota.quota,
      message: isChecking
        ? providerId === 'ollama'
          ? 'Waiting for the Ollama local runtime to start...'
          : providerId === 'gemini'
            ? 'Waiting for Gemini browser sign-in to complete...'
          : `Waiting for ${adapter.label} sign-in to complete...`
        : auth.message
    };
  }

  async startAuth(providerId: ProviderId, mode?: 'cli' | 'api_key', options: { force?: boolean } = {}) {
    const current = await this.getProvider(providerId);

    if (!current.installed) {
      this.emit({ type: 'provider.updated', provider: current });
      return current;
    }

    if (mode === 'api_key') {
      this.emit({ type: 'provider.updated', provider: current });
      return current;
    }

    if (mode === 'cli' && current.authMode === 'cli' && current.authState === 'connected') {
      const provider = {
        ...current,
        message: `${providerCliLabel(providerId)} is already connected to ${providerAuthBrand(providerId)}.`
      };
      this.emit({ type: 'provider.updated', provider });
      return provider;
    }

    if (current.authState === 'checking' && !options.force) {
      this.emit({ type: 'provider.updated', provider: current });
      return current;
    }

    await this.adapters[providerId].startAuth(mode, current.cliPath);
    this.pendingAuth.set(providerId, Date.now());
    this.scheduleAuthPolling(providerId);

    const provider = await this.getProvider(providerId);
    this.emit({ type: 'provider.updated', provider });
    return provider;
  }

  async adoptAuth(providerId: ProviderId) {
    const current = await this.getProvider(providerId);
    if (!current.installed) {
      this.emit({ type: 'provider.updated', provider: current });
      return current;
    }

    if (current.id === 'ollama') {
      this.emit({ type: 'provider.updated', provider: current });
      return current;
    }

    const storedAccount = this.db.getProviderAccount(providerId);
    const machineAuth = await this.adapters[providerId].getAuthState(storedAccount);

    if (machineAuth.authMode !== 'cli' || machineAuth.authState !== 'connected') {
      const provider = await this.getProvider(providerId, {
        forceRefresh: storedAccount?.authMode === 'api_key'
      });
      this.emit({ type: 'provider.updated', provider });
      return provider;
    }

    this.syncProviderAccount(providerId, storedAccount, {
      authState: 'connected',
      authMode: 'cli',
      message: `${providerDisplayName(providerId)} is ready in Vicode.`
    });
    const provider = await this.getProvider(providerId);
    this.emit({ type: 'provider.updated', provider });
    return provider;
  }

  async clearAuth(providerId: ProviderId) {
    this.clearPendingAuth(providerId);
    const account = this.db.getProviderAccount(providerId);
    const auth = await this.adapters[providerId].getAuthState(account);
    const nextAuthMode = this.resolveAvailableAuthMode(auth, account);
    const encryptedApiKey = account?.encryptedApiKey ?? null;

    if (nextAuthMode !== null || encryptedApiKey) {
      this.db.clearProviderModelCache(providerId);
    }

    const next: ProviderAccount = {
      providerId,
      authState: 'disconnected',
      authMode: nextAuthMode,
      encryptedApiKey,
      updatedAt: new Date().toISOString()
    };

    if (next.authMode !== null || next.encryptedApiKey) {
      this.db.saveProviderAccount(account ? { ...account, ...next } : next);
    }

    const provider = await this.getProvider(providerId);
    this.emit({ type: 'provider.updated', provider });
    return provider;
  }

  async saveApiKey(providerId: ProviderId, apiKey: string) {
    this.clearPendingAuth(providerId);
    const adapter = this.adapters[providerId];
    const previous = this.db.getProviderAccount(providerId);
    const encrypted = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(apiKey).toString('base64')
      : Buffer.from(apiKey, 'utf8').toString('base64');
    const provisionalAccount: ProviderAccount = {
      providerId,
      encryptedApiKey: encrypted,
      updatedAt: new Date().toISOString()
    } as ProviderAccount;
    const resolvedAuth = await adapter.getAuthState({
      providerId,
      authState: previous?.authState ?? 'disconnected',
      authMode: previous?.authMode ?? null,
      encryptedApiKey: encrypted,
      updatedAt: provisionalAccount.updatedAt
    });
    const nextAccount: ProviderAccount = {
      providerId,
      authState: resolvedAuth.authState,
      authMode: resolvedAuth.authMode,
      encryptedApiKey: encrypted,
      updatedAt: provisionalAccount.updatedAt
    };
    if (previous?.authMode !== nextAccount.authMode) {
      this.db.clearProviderModelCache(providerId);
    }
    this.db.saveProviderAccount(nextAccount);
    const provider = await this.getProvider(providerId, { forceRefresh: nextAccount.authMode === 'api_key' });
    this.emit({ type: 'provider.updated', provider });
    return provider;
  }

  async submitComposer(input: ComposerSubmitInput): Promise<ComposerSubmitResult> {
    const project = this.db.getProject(input.projectId);
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

    if (this.isThreadActive(nextThread)) {
      const followUpBehavior = this.db.getPreferences().followUpBehavior;
      const kind = followUpBehavior === 'steer' ? 'steer' : 'follow_up';
      const targetRunId = this.runningByThread.get(nextThread.id) ?? this.findLatestRunId(nextThread);
      const queuedFollowUps = this.db.listThreadFollowUps(nextThread.id);
      const condensedQueuedCount =
        kind === 'steer'
          ? queuedFollowUps.filter(
              (followUp) =>
                followUp.kind === 'steer' &&
                followUp.targetRunId === targetRunId
            ).length
          : 0;
      const queuedFollowUp = this.db.createThreadFollowUp({
        threadId: nextThread.id,
        content: input.prompt,
        metadata: {
          skillIds: input.skillIds ?? [],
          imageAttachments: input.imageAttachments ?? [],
          textAttachments: input.textAttachments ?? [],
          condensedQueuedCount: condensedQueuedCount > 0 ? condensedQueuedCount : undefined
        },
        kind,
        priority: kind === 'steer' ? 1 : 0,
        targetRunId
      });
      if (kind === 'steer') {
        this.db.supersedeQueuedFollowUps({
          threadId: nextThread.id,
          kind: 'steer',
          targetRunId,
          excludeId: queuedFollowUp.id
        });
      }
      const detail = this.db.getThread(nextThread.id);
      this.emit({ type: 'followup.queued', threadId: nextThread.id, followUp: queuedFollowUp });
      this.emit({ type: 'thread.detail', thread: detail });
      if (targetRunId) {
        this.refreshDerivedRunProgress(nextThread.id, targetRunId, nextThread.providerId, nextThread.modelId);
      }
      if (kind === 'steer' && targetRunId && nextThread.status !== 'stopping') {
        void this.stopRun(targetRunId).catch(() => {});
      }
      return {
        disposition: 'queued',
        thread: this.db.getThread(nextThread.id),
        queuedFollowUp: this.db.getThreadFollowUp(queuedFollowUp.id)
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
    const trimmedPrompt = input.prompt.trim();
    if (!trimmedPrompt) {
      throw new Error('Prompt is required.');
    }

    const adapter = this.adapters[input.providerId];
    const account = this.db.getProviderAccount(input.providerId);
    const auth = await adapter.getAuthState(account);
    const apiKey = auth.authMode === 'api_key' && account?.encryptedApiKey ? this.decryptApiKey(account.encryptedApiKey) : null;
    const modelId = await this.resolveUsableModelId(input.providerId, input.modelId);
    const runId = randomUUID();
    this.assertProviderRunPermission(input.providerId, 'default');
    const contextPrompt = input.projectId
      ? this.buildPromptRefinementInput(input.projectId, input.providerId, trimmedPrompt)
      : trimmedPrompt;

    const refinedPrompt = await new Promise<string>((resolve, reject) => {
      let output = '';
      let settled = false;
      const finish = (value: string) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };
      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      };

      void adapter
        .startRun(
          {
            threadId: `prompt-refiner-${runId}`,
            runId,
            prompt: this.buildPromptRefinementPrompt(contextPrompt),
            modelId,
            reasoningEffort: input.reasoningEffort ?? null,
            thinkingEnabled: providerCapabilities(input.providerId).supportsThinkingToggle ? input.thinkingEnabled ?? false : undefined,
            folderPath: null,
            trusted: false,
            apiKey,
            runMode: 'plan',
            executionPermission: 'default',
            ollamaTransportMode: this.resolveOllamaTransportMode(input.providerId)
          },
          {
            onStart: () => {},
            onDelta: (delta) => {
              output += delta;
            },
            onInfo: () => {},
            onComplete: (value) => finish(this.normalizeEnhancedPrompt(value || output, trimmedPrompt)),
            onError: (message) => fail(new Error(message || 'Unable to enhance prompt.')),
            onAbort: () => finish(trimmedPrompt)
          }
        )
        .catch((error) => fail(error instanceof Error ? error : new Error('Unable to enhance prompt.')));
    });

    return { prompt: refinedPrompt };
  }

  async generateCollaborationThreadSummary(threadId: string): Promise<ThreadCollaborationSummary> {
    const thread = this.db.getThread(threadId);
    const fallback = deriveCollaborationThreadSummary(thread);
    const output = await this.runUtilityTextGeneration({
      providerId: thread.providerId,
      modelId: thread.modelId,
      prompt: buildCollaborationSummaryPrompt(thread),
      fallback: null,
      timeoutMs: 5_000
    });

    if (!output) {
      return fallback;
    }

    return parseCollaborationSummaryOutput(output, fallback);
  }

  async generateSubagentTerminalSummary(input: {
    threadId: string;
    providerId: ProviderId;
    modelId: string;
    status: 'completed' | 'failed' | 'cancelled';
    fallback?: string | null;
  }) {
    const thread = this.db.getThread(input.threadId);
    const fallback = input.fallback ?? deriveSubagentTerminalSummaryFallback(thread);
    const output = await this.runUtilityTextGeneration({
      providerId: input.providerId,
      modelId: input.modelId,
      prompt: buildSubagentTerminalSummaryPrompt(thread, input.status),
      fallback,
      timeoutMs: 4_000
    });

    return normalizeSubagentTerminalSummary(output ?? '', fallback);
  }

  async setPlannerMode(input: PlannerSetModeInput): Promise<ThreadDetail> {
    this.db.getThread(input.threadId);
    const planner = this.updatePlannerMode(input.threadId, input.mode);
    const thread = this.db.getThread(input.threadId);
    this.emit({ type: 'thread.detail', thread });
    this.emit({ type: 'planner.modeChanged', threadId: input.threadId, planner });
    return thread;
  }

  async submitPlanner(input: PlannerSubmitInput): Promise<{ thread: ThreadDetail; runId: string }> {
    const project = this.db.getProject(input.projectId);
    const adapter = this.adapters[input.providerId];
    this.assertProviderProjectContext(input.providerId, project.folderPath, project.trusted);

    const capability = adapter.getPlannerCapability();
    if (!capability.supported) {
      throw new Error(capability.message ?? `${adapter.label} does not support planner runs yet.`);
    }

    const thread = input.threadId
      ? this.db.getThread(input.threadId)
      : this.db.createThread({
          projectId: input.projectId,
          providerId: input.providerId,
          modelId: input.modelId,
          executionPermission: input.executionPermission
        });
    const nextThread =
      thread.executionPermission === input.executionPermission
        ? thread
        : this.db.setThreadExecutionPermission(thread.id, input.executionPermission);

    this.updatePlannerMode(nextThread.id, 'plan');
    const plannerContext = this.assembleWorkspaceContext(input, nextThread, project.folderPath, project.trusted, {
      includeRuntimeSkills: providerCapabilities(input.providerId).supportsRuntimeSkillResources
    });
    const promptTurn = this.db.appendTurn(nextThread.id, 'user', input.prompt, {
      skillIds: plannerContext.selectedSkillIds,
      imageAttachments: input.imageAttachments ?? [],
      textAttachments: input.textAttachments ?? [],
      composerMode: 'plan',
      plannerPhase: 'request',
      executionPermission: input.executionPermission
    });
    this.db.clearPendingPlannerQuestions(nextThread.id);
    this.db.setThreadPlannerTurnState(nextThread.id, 'generating_plan');
    this.db.updateThreadStatus(nextThread.id, 'queued');
    return this.startNativePlannerRun({
      input,
      threadId: nextThread.id,
      promptTurnId: promptTurn.id,
      project,
      prompt: input.prompt,
      resumeSessionId: resolvePlannerResumeSessionId(input.providerId, nextThread)
    });
  }

  async answerPlannerQuestions(input: PlannerAnswerInput): Promise<{ thread: ThreadDetail; runId: string }> {
    const thread = this.db.getThread(input.threadId);
    if (thread.planner.composerMode !== 'plan') {
      throw new Error('Planner questions can only be answered while the thread is in Plan mode.');
    }

    const questionSet = thread.planner.pendingQuestionSet;
    if (!questionSet || questionSet.callId !== input.callId) {
      throw new Error('No pending planner question set matched the provided call id.');
    }

    const promptTurn = thread.turns.find((turn) => turn.id === questionSet.promptTurnId && turn.role === 'user');
    if (!promptTurn) {
      throw new Error('The original planner request could not be found for this question set.');
    }

    this.db.answerPlannerQuestionSet(thread.id, input.callId, input.answers);
    this.db.clearPendingPlannerQuestions(thread.id);
    this.db.setThreadPlannerTurnState(thread.id, 'generating_plan');

    const adapter = this.adapters[thread.providerId];
    const plannerRunId = this.plannerRunsByThread.get(thread.id) ?? null;
    const sessionId = findLatestPlannerSessionId(thread);
    if (adapter.replyPlannerQuestions && plannerRunId) {
      this.db.updateThreadStatus(thread.id, 'running');
      this.updateNativePlannerRunProgress(thread.id, plannerRunId, thread.providerId, 'resuming');
      const context: ProviderPlannerAnswerContext = {
        threadId: thread.id,
        runId: plannerRunId,
        callId: input.callId,
        sessionId,
        answers: input.answers
      };
      await adapter.replyPlannerQuestions(context);
      const detail = this.db.getThread(thread.id);
      this.emit({ type: 'thread.detail', thread: detail });
      this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(thread.id) });
      return { thread: detail, runId: plannerRunId };
    }

    const answerPrompt = this.formatNativePlannerAnswers(questionSet, input.answers);
    const answerTurn = this.db.appendTurn(thread.id, 'user', answerPrompt, {
      composerMode: 'plan',
      plannerPhase: 'answer',
      plannerCallId: input.callId,
      plannerAnswers: input.answers
    });

    this.db.updateThreadStatus(thread.id, 'queued');

    return this.startNativePlannerRun({
      input: {
        projectId: thread.projectId,
        threadId: thread.id,
        prompt: answerPrompt,
        providerId: thread.providerId,
        modelId: thread.modelId,
        executionPermission: thread.executionPermission,
        skillIds: this.readTurnSkillIds(promptTurn.metadata)
      },
      threadId: thread.id,
      promptTurnId: answerTurn.id,
      project: this.db.getProject(thread.projectId),
      prompt: answerPrompt,
      resumeSessionId: resolvePlannerResumeSessionId(thread.providerId, thread)
    });
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
    const thread = this.db.getThread(input.threadId);
    const plannerRunId = this.plannerRunsByThread.get(thread.id) ?? null;

    if (plannerRunId) {
      await this.stopRun(plannerRunId);
      if (this.plannerRunsByThread.get(thread.id) === plannerRunId) {
        this.plannerRunsByThread.delete(thread.id);
      }
    }

    const planner = this.db.clearThreadPlannerSession(thread.id);
    const detail = this.db.getThread(thread.id);
    this.emit({ type: 'thread.detail', thread: detail });
    this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(thread.id) });
    this.emit({ type: 'planner.modeChanged', threadId: thread.id, planner });
    return detail;
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
        this.emit({ type: 'thread.detail', thread: this.db.getThread(threadId) });
        this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(threadId) });
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
          this.emit({ type: 'thread.detail', thread: this.db.getThread(threadId) });
          this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(threadId) });
          this.emit({ type: 'run.status', threadId, runId, status: 'aborted', message: 'Run stopped after the active process was lost.' });
          void this.maybeDispatchNextFollowUp(threadId);
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
    this.emit({ type: 'thread.detail', thread: this.db.getThread(followUp.threadId) });
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
    this.emit({ type: 'thread.detail', thread: this.db.getThread(followUp.threadId) });
    const activeRunId = this.runningByThread.get(followUp.threadId);
    if (activeRunId) {
      const thread = this.db.getThread(followUp.threadId);
      this.refreshDerivedRunProgress(thread.id, activeRunId, thread.providerId, thread.modelId);
    }
  }

  async resumeQueuedFollowUps() {
    for (const threadId of this.db.listThreadIdsWithQueuedFollowUps()) {
      await this.maybeDispatchNextFollowUp(threadId);
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
    const adapter = this.adapters[input.providerId];
    const preferences = this.db.getPreferences();
    this.assertProviderRunPermission(input.providerId, input.executionPermission);
    this.assertProviderProjectContext(input.providerId, project.folderPath, project.trusted);
    const runId = randomUUID();
    this.recordRuntimeTraceMark(thread.id, runId, 'submit_received', {
      providerId: input.providerId,
      threadId: thread.id,
      hasTrustedWorkspace: project.trusted,
      hasFolderPath: Boolean(project.folderPath)
    });
    this.recordRuntimeTraceMark(thread.id, runId, 'workspace_context_started', {
      includeRuntimeSkills: providerCapabilities(input.providerId).supportsRuntimeSkillResources,
      contextProfile: executionContext.contextProfile ?? 'main'
    });
    const workspaceContext = this.assembleWorkspaceContext(input, thread, project.folderPath, project.trusted, {
      includeRuntimeSkills: providerCapabilities(input.providerId).supportsRuntimeSkillResources,
      contextProfile: executionContext.contextProfile ?? 'main',
      includeMemory: executionContext.includeMemory ?? true,
      includeGeneratedMemory: executionContext.includeGeneratedMemory ?? preferences.generatedMemoryUseEnabled
    });
    const generatedMemoryBlocks = workspaceContext.generatedMemoryBlocks ?? [];
    const generatedMemoryTraceDetail = createGeneratedMemoryTraceDetail({
      folderPath: project.folderPath,
      trusted: project.trusted,
      generatedMemoryEnabled: executionContext.includeGeneratedMemory ?? preferences.generatedMemoryUseEnabled,
      generatedMemoryGenerationEnabled: preferences.generatedMemoryGenerationEnabled,
      memoryBlocks: workspaceContext.memoryBlocks,
      generatedMemoryBlocks,
      repeatSteeringCount: this.countQueuedSteerFollowUps(thread)
    });
    this.recordRuntimeTraceMark(thread.id, runId, 'workspace_context_completed', {
      ...workspaceContext.diagnostics,
      ...generatedMemoryTraceDetail
    });
    this.db.appendTurn(thread.id, 'user', input.prompt, {
      skillIds: workspaceContext.selectedSkillIds,
      imageAttachments: input.imageAttachments ?? [],
      textAttachments: input.textAttachments ?? [],
      executionPermission: input.executionPermission,
      ...(userTurnMetadata ?? {})
    });
    this.db.updateThreadStatus(thread.id, 'queued');

    const account = this.db.getProviderAccount(input.providerId);
    const auth = await adapter.getAuthState(account);
    const apiKey = auth.authMode === 'api_key' && account?.encryptedApiKey ? this.decryptApiKey(account.encryptedApiKey) : null;
    const modelId = await this.resolveExecutionModelId(
      input.providerId,
      input.modelId,
      input.imageAttachments ?? []
    );
    const continuity =
      executionContext.contextProfile === 'delegated' && executionContext.delegation?.mode === 'background'
        ? {
            strategy: 'none' as const,
            resumeSessionId: null,
            includeInlineThreadHistory: false
          }
        : resolveExecutionContinuity(input.providerId, thread);
    const effectivePrompt = buildEffectivePrompt(input, workspaceContext, {
      personalization: this.db.getPersonalization(),
      approvedPlanMarkdown: executionContext.approvedPlan?.proposedPlanMarkdown ?? null,
      plannerAnswers: executionContext.plannerAnswers ?? null,
      thread,
      continuity
    });
    this.recordRuntimeTraceMark(thread.id, runId, 'prompt_assembled', {
      promptLength: effectivePrompt.length,
      workspaceBlockCount: workspaceContext.blocks.length,
      memoryBlockCount: workspaceContext.memoryBlocks.length,
      generatedMemoryBlockCount: generatedMemoryBlocks.length,
      skillBlockCount: workspaceContext.skillBlocks.length,
      runtimeSkillResourceCount: workspaceContext.runtimeSkillResources.length,
      ...generatedMemoryTraceDetail
    });
    const workspaceSnapshot = captureWorkspaceSnapshot(project.folderPath);
    const initialRunProgress =
      executionContext.approvedPlan
        ? deriveRunProgressFromPlanner(executionContext.approvedPlan, 'executing_from_plan', runId, thread.id)
        : executionContext.delegation?.mode === 'background'
          ? this.createBackgroundDelegationRunProgress(runId, thread.id, input.providerId, executionContext.delegation)
          : null;
    let sawFirstDelta = false;
    let sawFirstToolCall = false;
    let sawFirstToolResult = false;
    let run: ProviderRunHandle;
    try {
      const runMode = input.runMode ?? 'default';
      this.recordRuntimeTraceMark(thread.id, runId, 'provider_dispatch_started', {
        modelId,
        authMode: auth.authMode,
        runMode
      });
      const handleProviderInfo = (payload: ProviderInfoPayload) => {
        if (this.disposed) {
          return;
        }
        const normalizedInfo = normalizeProviderInfoEvent(input.providerId, payload);
        const event = this.recordInfoEvent(thread.id, runId, normalizedInfo);
        if (normalizedInfo.providerProgress) {
          this.publishProviderRunProgress(runId, normalizedInfo.providerProgress);
        } else if (shouldAdvanceRunProgressFromActivity(normalizedInfo.activity)) {
          this.advanceRunProgress(runId);
        }
        this.refreshDerivedRunProgress(thread.id, runId, input.providerId, modelId);
        if (normalizedInfo.activity?.kind === 'tool_call' && !sawFirstToolCall) {
          sawFirstToolCall = true;
          this.recordRuntimeTraceMark(thread.id, runId, 'first_tool_call', {
            toolName: normalizedInfo.activity.toolName ?? null,
            summary: normalizedInfo.activity.summary,
            command: normalizedInfo.activity.command ?? null,
            cwd: normalizedInfo.activity.cwd ?? null,
            ...generatedMemoryTraceDetail,
            firstSubstantiveAction: deriveFirstSubstantiveAction(normalizedInfo.activity)
          });
        }
        if (normalizedInfo.activity?.kind === 'tool_result' && !sawFirstToolResult) {
          sawFirstToolResult = true;
          this.recordRuntimeTraceMark(thread.id, runId, 'first_tool_result', {
            toolName: normalizedInfo.activity.toolName ?? null,
            summary: normalizedInfo.activity.summary,
            status: normalizedInfo.activity.status ?? null,
            command: normalizedInfo.activity.command ?? null,
            cwd: normalizedInfo.activity.cwd ?? null,
            ...generatedMemoryTraceDetail,
            firstSubstantiveAction: deriveFirstSubstantiveAction(normalizedInfo.activity)
          });
        }
        if (!event) {
          return;
        }
        this.emit({ type: 'raw.event', event });
        if (normalizedInfo.message) {
          this.emit({ type: 'run.status', threadId: thread.id, runId, status: 'info', message: normalizedInfo.message });
        }
      };
      const requestProviderToolApproval =
        this.usesAppAuthoritativeToolApproval(input.providerId)
          ? (request: {
              toolName: string;
              command: string;
              cwd: string | null;
              workspaceRoot: string;
            }) =>
              this.requestToolApproval({
                threadId: thread.id,
                runId,
                providerId: input.providerId,
                ...request
              }, project.runtimeCommandPolicy)
          : undefined;
      const replyAssembly = createProviderReplyAssembly({
        providerId: input.providerId,
        readCurrentText: () => this.collectAssistantText(thread.id, runId),
        onFirstDelta: ({ deltaLength, textLength }) => {
          this.recordRuntimeTraceMark(thread.id, runId, 'first_delta', {
            deltaLength: deltaLength || textLength
          });
        },
        persistDelta: (delta) => {
          this.db.addRunEvent(thread.id, runId, 'delta', { delta });
        },
        persistText: (text) => {
          this.db.updateAssistantTurn(runId, thread.id, text);
        },
        emitDelta: (delta) => {
          this.emit({ type: 'run.delta', threadId: thread.id, runId, delta });
        },
        emitReplace: (text) => {
          this.emit({ type: 'run.replace', threadId: thread.id, runId, text });
        }
      });
      run = await adapter.startRun(
        {
          threadId: thread.id,
          runId,
          prompt: effectivePrompt,
          sourcePrompt: input.prompt,
          imageAttachments: input.imageAttachments ?? [],
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
          ollamaTransportMode: this.resolveOllamaTransportMode(input.providerId),
          runtimeSkillResources: workspaceContext.runtimeSkillResources
        },
        {
          onStart: () => {
            if (this.disposed) {
              return;
            }
            this.runningByThread.set(thread.id, runId);
            this.lastChangeArtifactByRun.set(runId, null);
            this.db.updateThreadStatus(thread.id, 'running');
            this.db.addRunEvent(thread.id, runId, 'started', {
              providerId: input.providerId,
              modelId,
          continuityStrategy: continuity.strategy,
          resumeSessionId: continuity.resumeSessionId
        });
            this.recordRuntimeTraceMark(thread.id, runId, 'run_started', { providerId: input.providerId, modelId });
            if (initialRunProgress) {
              const derivedInitialProgress =
                this.deriveProgressEnhancements(initialRunProgress, this.db.getThread(thread.id), input.providerId, modelId) ??
                initialRunProgress;
              this.publishRunProgress(derivedInitialProgress);
            }
            const memoryRecallActivity = createMemoryRecallActivity(
              workspaceContext.memoryBlocks,
              generatedMemoryBlocks
            );
            if (memoryRecallActivity) {
              const event = this.recordInfoEvent(thread.id, runId, normalizeProviderInfoEvent(input.providerId, {
                activity: memoryRecallActivity
              }));
              if (event) {
                this.emit({ type: 'raw.event', event });
              }
            }
            this.emit({ type: 'run.started', threadId: thread.id, runId });
          },
          onDelta: (delta) => {
            if (this.disposed) {
              return;
            }
            if (!sawFirstDelta) {
              sawFirstDelta = true;
            }
            replyAssembly.handleDelta(delta);
          },
          onAssistantSnapshot: (snapshot) => {
            if (this.disposed) {
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
                  this.executeProviderRuntimeToolCall({
                    call,
                    workspaceRoot: project.folderPath,
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
              : undefined,
          onComplete: (output) => {
            if (this.disposed) {
              return;
            }
            const resolvedOutput = this.resolveProviderCompletionOutput(input.providerId, thread.id, runId, output);
            const completionOutput = this.formatProviderCompletionOutput(input.providerId, resolvedOutput);
            if (!completionOutput) {
              const message = `${providerDisplayName(input.providerId)} completed without producing assistant output.`;
              this.finalizeExecutionRunFailure({
                threadId: thread.id,
                runId,
                message,
                traceStage: 'failed',
                tracePayload: { reason: 'empty_output' },
                eventType: 'failed',
                threadStatus: 'failed',
                runStatus: 'failed',
                progressStatus: 'failed',
                approvedPlan: executionContext.approvedPlan,
                titlePrompt: shouldGenerateTitle ? input.prompt : null
              });
              return;
            }
            if (input.providerId === 'ollama' && completionOutput !== resolvedOutput) {
              this.finalizeSuccessfulExecutionRun({
                threadId: thread.id,
                runId,
                output: completionOutput,
                workspaceSnapshot,
                projectFolderPath: project.folderPath,
                approvedPlan: executionContext.approvedPlan,
                titlePrompt: shouldGenerateTitle ? input.prompt : null
              });
              return;
            }
            if (input.providerId === 'ollama' && this.ollamaFinalAnswerFormatter.shouldRewrite(completionOutput)) {
              void this.finalizeSuccessfulExecutionRunWithProviderCleanup({
                providerId: input.providerId,
                modelId,
                threadId: thread.id,
                runId,
                output: completionOutput,
                workspaceSnapshot,
                projectFolderPath: project.folderPath,
                approvedPlan: executionContext.approvedPlan,
                titlePrompt: shouldGenerateTitle ? input.prompt : null
              });
              return;
            }
            this.finalizeSuccessfulExecutionRun({
              threadId: thread.id,
              runId,
              output: completionOutput,
              workspaceSnapshot,
              projectFolderPath: project.folderPath,
              approvedPlan: executionContext.approvedPlan,
              titlePrompt: shouldGenerateTitle ? input.prompt : null
            });
          },
          onError: (message) => {
            if (this.disposed) {
              return;
            }
            this.finalizeExecutionRunFailure({
              threadId: thread.id,
              runId,
              message,
              traceStage: 'failed',
              tracePayload: { message },
              eventType: 'failed',
              threadStatus: 'failed',
              runStatus: 'failed',
              progressStatus: 'failed',
              approvedPlan: executionContext.approvedPlan,
              titlePrompt: shouldGenerateTitle ? input.prompt : null
            });
          },
          onAbort: (message) => {
            if (this.disposed) {
              return;
            }
            this.finalizeExecutionRunFailure({
              threadId: thread.id,
              runId,
              message,
              traceStage: 'aborted',
              tracePayload: message ? { message } : null,
              eventType: 'aborted',
              threadStatus: 'aborted',
              runStatus: 'aborted',
              progressStatus: 'blocked',
              approvedPlan: executionContext.approvedPlan,
              titlePrompt: null
            });
          }
        }
      );
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message.trim() : `Failed to start ${providerDisplayName(input.providerId)}.`;
      this.recordRuntimeTraceMark(thread.id, runId, 'provider_dispatch_failed', { message });
      this.finalizeExecutionRunFailure({
        threadId: thread.id,
        runId,
        message,
        traceStage: 'failed',
        tracePayload: { message },
        eventType: 'failed',
        threadStatus: 'failed',
        runStatus: 'failed',
        progressStatus: 'failed',
        approvedPlan: executionContext.approvedPlan,
        titlePrompt: shouldGenerateTitle ? input.prompt : null
      });
      return { thread: this.db.getThread(thread.id), runId };
    }

    this.running.set(runId, run);
    const detail = this.db.getThread(thread.id);
    this.emit({ type: 'thread.detail', thread: detail });
    this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(thread.id) });
    return { thread: detail, runId };
  }

  private async startNativePlannerRun(input: {
    input: PlannerSubmitInput;
    threadId: string;
    promptTurnId: string;
    project: ReturnType<DatabaseService['getProject']>;
    prompt: string;
    resumeSessionId?: string | null;
  }): Promise<{ thread: ThreadDetail; runId: string }> {
    const adapter = this.adapters[input.input.providerId];
    const runId = randomUUID();
    const account = this.db.getProviderAccount(input.input.providerId);
    const auth = await adapter.getAuthState(account);
    const apiKey = auth.authMode === 'api_key' && account?.encryptedApiKey ? this.decryptApiKey(account.encryptedApiKey) : null;
    const modelId = await this.resolveExecutionModelId(
      input.input.providerId,
      input.input.modelId,
      input.input.imageAttachments ?? []
    );
    let questionCallId: string | null = null;
    const workspaceContext = this.assembleWorkspaceContext(input.input, this.db.getThread(input.threadId), input.project.folderPath, input.project.trusted, {
      includeRuntimeSkills: providerCapabilities(input.input.providerId).supportsRuntimeSkillResources,
      contextProfile: 'delegated',
      includeMemory: false,
      includeGeneratedMemory: false
    });
    const effectivePrompt = buildEffectivePrompt(
      {
        providerId: input.input.providerId,
        prompt: input.prompt
      },
      workspaceContext,
      {
        personalization: this.db.getPersonalization()
      }
    );
    this.assertProviderRunPermission(input.input.providerId, input.input.executionPermission);
    this.assertProviderProjectContext(input.input.providerId, input.project.folderPath, input.project.trusted);

    let run: ProviderRunHandle;
    try {
      const handleProviderInfo = (payload: ProviderInfoPayload) => {
        if (this.disposed) {
          return;
        }

        const normalizedInfo = normalizeProviderInfoEvent(input.input.providerId, payload);
        const event = this.recordInfoEvent(input.threadId, runId, normalizedInfo);
        if (event) {
          this.emit({ type: 'raw.event', event });
        }

        if (normalizedInfo.message) {
          this.emit({ type: 'run.status', threadId: input.threadId, runId, status: 'info', message: normalizedInfo.message });
        }

        const plannerSignal = normalizedInfo.planner;
        if (!plannerSignal) {
          return;
        }

        this.handleNativePlannerSignal(input.threadId, runId, input.promptTurnId, plannerSignal);
        if (plannerSignal.kind === 'questions') {
          questionCallId = plannerSignal.callId;
        }
      };
      const replyAssembly = createProviderReplyAssembly({
        providerId: input.input.providerId,
        readCurrentText: () => this.collectRunDeltaText(input.threadId, runId),
        persistDelta: (delta) => {
          this.db.addRunEvent(input.threadId, runId, 'delta', { delta });
        }
      });
      run = await adapter.startRun(
        {
          threadId: input.threadId,
          runId,
          prompt: effectivePrompt,
          imageAttachments: input.input.imageAttachments ?? [],
            textAttachments: input.input.textAttachments ?? [],
            modelId,
            reasoningEffort: input.input.reasoningEffort ?? null,
            thinkingEnabled: providerCapabilities(input.input.providerId).supportsThinkingToggle ? input.input.thinkingEnabled ?? false : undefined,
            executionConstraints: input.input.executionConstraints ?? null,
            resumeSessionId: input.resumeSessionId ?? null,
            folderPath: input.project.folderPath,
          trusted: input.project.trusted,
          apiKey,
          runMode: 'plan',
          executionPermission: input.input.executionPermission,
          runtimeCommandPolicy: input.project.runtimeCommandPolicy,
          runtimeNetworkPolicy: input.project.runtimeNetworkPolicy,
          ollamaTransportMode: this.resolveOllamaTransportMode(input.input.providerId),
          runtimeSkillResources: workspaceContext.runtimeSkillResources
        },
        {
        onStart: () => {
          if (this.disposed) {
            return;
          }
          this.plannerRunsByThread.set(input.threadId, runId);
          this.db.updateThreadStatus(input.threadId, 'running');
          this.db.addRunEvent(input.threadId, runId, 'started', {
            providerId: input.input.providerId,
            modelId,
            planner: true,
            nativePlanner: true,
            resumeSessionId: input.resumeSessionId ?? null
          });
          this.publishRunProgress(
            this.createNativePlannerRunProgress(
              runId,
              input.threadId,
              input.input.providerId,
              input.resumeSessionId ? 'resuming' : 'active'
            )
          );
          this.emit({ type: 'run.started', threadId: input.threadId, runId });
        },
        onDelta: (delta) => {
          if (this.disposed) {
            return;
          }
          replyAssembly.handleDelta(delta);
        },
        onAssistantSnapshot: (snapshot) => {
          if (this.disposed) {
            return;
          }
          replyAssembly.handleSnapshot(snapshot);
        },
        onInfo: handleProviderInfo,
        invokeRuntimeTool:
          input.project.folderPath?.trim()
            ? (call) =>
                this.executeProviderRuntimeToolCall({
                  call,
                  workspaceRoot: input.project.folderPath,
                  trustedWorkspace: input.project.trusted,
                  threadId: input.threadId,
                  runId,
                  providerId: input.input.providerId,
                  executionPermission: input.input.executionPermission,
                  executionConstraints: input.input.executionConstraints ?? null,
                  runtimeCommandPolicy: input.project.runtimeCommandPolicy,
                  runtimeNetworkPolicy: input.project.runtimeNetworkPolicy,
                  onInfo: handleProviderInfo
                })
            : undefined,
        onComplete: (output) => {
          if (this.disposed) {
            return;
          }

          this.clearNativePlannerRunState(input.threadId, runId);
          const markdown = this.resolveProviderCompletionOutput(input.input.providerId, input.threadId, runId, output);
          this.db.addRunEvent(input.threadId, runId, 'completed', { output: markdown });

          if (questionCallId && !markdown) {
            this.db.updateThreadStatus(input.threadId, 'completed');
            this.recordNativePlannerCloseout(
              input.threadId,
              runId,
              input.input.providerId,
              'Delegated planner is waiting for your answers.',
              'Delegated planner paused after asking follow-up questions. Answer the planner questions to continue.'
            );
            this.emit({ type: 'thread.detail', thread: this.db.getThread(input.threadId) });
            this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(input.threadId) });
            this.emit({ type: 'run.status', threadId: input.threadId, runId, status: 'completed' });
            return;
          }

          if (!markdown) {
            const message = 'Native planner run completed without producing planner questions or a plan.';
            this.db.updateThreadStatus(input.threadId, 'failed');
            this.db.setThreadPlannerTurnState(input.threadId, 'idle');
            this.recordNativePlannerCloseout(
              input.threadId,
              runId,
              input.input.providerId,
              'Delegated planner stopped without returning a plan.',
              message
            );
            this.emit({ type: 'planner.parseError', threadId: input.threadId, message, runId });
            this.emit({ type: 'run.status', threadId: input.threadId, runId, status: 'failed', message });
            return;
          }

          const assistantTurn = this.db.appendTurn(
            input.threadId,
            'assistant',
            markdown,
            {
              plannerArtifactType: 'plan',
              plannerNative: true,
              plannerProvider: input.input.providerId
            },
            runId
          );
          const plan = this.db.createPlannerPlan(
            input.threadId,
            assistantTurn.id,
            markdown,
            deriveStructuredPlannerPlan(markdown)
          );
          this.db.updateThreadStatus(input.threadId, 'completed');
          const detail = this.db.getThread(input.threadId);
          this.emit({ type: 'thread.detail', thread: detail });
          this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(input.threadId) });
          this.emit({
            type: 'planner.planProposed',
            threadId: input.threadId,
            planner: detail.planner,
            plan
          });
          this.recordNativePlannerCloseout(
            input.threadId,
            runId,
            input.input.providerId,
            'Delegated planner proposed a plan.',
            'Delegated planner finished and returned a plan for review.'
          );
          this.emit({ type: 'run.status', threadId: input.threadId, runId, status: 'completed' });
        },
        onError: (message) => {
          if (this.disposed) {
            return;
          }
          this.clearNativePlannerRunState(input.threadId, runId);
          this.db.addRunEvent(input.threadId, runId, 'failed', { message });
          this.db.clearPendingPlannerQuestions(input.threadId);
          this.db.setThreadPlannerTurnState(input.threadId, 'idle');
          this.db.updateThreadStatus(input.threadId, 'failed');
          this.recordNativePlannerCloseout(input.threadId, runId, input.input.providerId, 'Delegated planner failed.', message);
          this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(input.threadId) });
          this.emit({ type: 'run.status', threadId: input.threadId, runId, status: 'failed', message });
        },
        onAbort: (message) => {
          if (this.disposed) {
            return;
          }
          this.clearNativePlannerRunState(input.threadId, runId);
          this.db.addRunEvent(input.threadId, runId, 'aborted', message ? { message } : {});
          this.db.clearPendingPlannerQuestions(input.threadId);
          this.db.setThreadPlannerTurnState(input.threadId, 'idle');
          this.db.updateThreadStatus(input.threadId, 'aborted');
          this.recordNativePlannerCloseout(
            input.threadId,
            runId,
            input.input.providerId,
            'Delegated planner stopped.',
            message ?? 'Delegated planner stopped before proposing a plan.'
          );
          this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(input.threadId) });
          this.emit({ type: 'run.status', threadId: input.threadId, runId, status: 'aborted', message });
        }
      }
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : `Failed to start ${providerDisplayName(input.input.providerId)} planner run.`;
      this.clearNativePlannerRunState(input.threadId, runId);
      this.db.addRunEvent(input.threadId, runId, 'failed', { message });
      this.db.clearPendingPlannerQuestions(input.threadId);
      this.db.setThreadPlannerTurnState(input.threadId, 'idle');
      this.db.updateThreadStatus(input.threadId, 'failed');
      this.recordNativePlannerCloseout(input.threadId, runId, input.input.providerId, 'Delegated planner failed to start.', message);
      this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(input.threadId) });
      this.emit({ type: 'run.status', threadId: input.threadId, runId, status: 'failed', message });
      return { thread: this.db.getThread(input.threadId), runId };
    }

    this.running.set(runId, run);
    const detail = this.db.getThread(input.threadId);
    this.emit({ type: 'thread.detail', thread: detail });
    this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(input.threadId) });
    return { thread: detail, runId };
  }

  private handleNativePlannerSignal(
    threadId: string,
    runId: string,
    promptTurnId: string,
    signal: ProviderPlannerSignal
  ) {
    if (signal.kind !== 'questions') {
      return;
    }

    const thread = this.db.getThread(threadId);
    const currentPlanner = this.db.getThreadPlannerState(threadId);
    if (currentPlanner.pendingQuestionCallId === signal.callId) {
      this.updateNativePlannerRunProgress(threadId, runId, thread.providerId, 'waiting_for_answers');
      return;
    }

    this.db.setThreadPlannerTurnState(threadId, 'waiting_for_answers');
    const questionSet = this.db.createPlannerQuestionSet(threadId, promptTurnId, signal.callId, signal.questions);
    this.recordNativePlannerCloseout(
      threadId,
      runId,
      thread.providerId,
      'Delegated planner is waiting for your answers.',
      'Delegated planner paused after asking follow-up questions. Answer the planner questions to continue.'
    );
    const detail = this.db.getThread(threadId);
    this.updateNativePlannerRunProgress(threadId, runId, detail.providerId, 'waiting_for_answers');
    this.emit({ type: 'thread.detail', thread: detail });
    this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(threadId) });
    this.emit({
      type: 'planner.questionsRequested',
      threadId,
      planner: detail.planner,
      questionSet
    });
  }

  private updatePlannerMode(threadId: string, mode: ComposerMode) {
    this.db.setThreadPlannerMode(threadId, mode);
    if (mode === 'default') {
      this.db.clearPendingPlannerQuestions(threadId);
      this.db.setThreadPlannerTurnState(threadId, 'idle');
    } else if (this.db.getThreadPlannerState(threadId).turnState === 'executing_from_plan') {
      this.db.setThreadPlannerTurnState(threadId, 'idle');
    }
    return this.db.getThreadPlannerState(threadId);
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

  private async getResolvedModels(
    providerId: ProviderId,
    adapter: ProviderAdapter,
    input: {
      account: ProviderAccount | null;
      authMode: ProviderDescriptor['authMode'];
      cliPath: string | null;
      forceRefresh: boolean;
    }
  ): Promise<ResolvedProviderModels> {
    const fallbackModels = adapter.listStaticModels();
    const cached = this.db.getProviderModelCache(providerId);
    const apiKey = input.account?.encryptedApiKey ? this.decryptApiKey(input.account.encryptedApiKey) : null;
    const runtimeDiscoveryAllowed = input.authMode === 'cli' || (providerId === 'ollama' && input.authMode !== 'api_key');

    if (runtimeDiscoveryAllowed) {
      const discovered = await adapter.discoverRuntimeModels({
        account: input.account,
        authMode: input.authMode,
        cliPath: input.cliPath
      });

      if (discovered !== null) {
        if (discovered.length > 0) {
          this.db.replaceProviderModels(providerId, discovered, 'runtime');
        } else {
          this.db.clearProviderModelCache(providerId);
        }

        return {
          models: this.resolveProviderModels(providerId, fallbackModels, discovered),
          source: 'runtime',
          updatedAt: new Date().toISOString(),
          canLiveDiscoverModels: true
        };
      }

      if (cached.models.length > 0) {
        return {
          models: this.resolveProviderModels(providerId, fallbackModels, cached.models),
          source: 'cache',
          updatedAt: cached.updatedAt,
          canLiveDiscoverModels: false
        };
      }

      return {
        models: fallbackModels,
        source: 'fallback',
        updatedAt: null,
        canLiveDiscoverModels: false
      };
    }

    if (input.authMode === 'api_key') {
      const shouldRefresh = input.forceRefresh || cached.models.length === 0 || this.isModelCacheStale(cached.updatedAt);

      if (shouldRefresh) {
        const discovered = await adapter.discoverApiModels({
          account: input.account,
          authMode: input.authMode,
          apiKey,
          cliPath: input.cliPath
        });

        if (discovered && discovered.length > 0) {
          this.db.replaceProviderModels(providerId, discovered, 'api');
          return {
            models: this.resolveProviderModels(providerId, fallbackModels, discovered),
            source: 'api',
            updatedAt: new Date().toISOString(),
            canLiveDiscoverModels: true
          };
        }
      }

      if (cached.models.length > 0) {
        return {
          models: this.resolveProviderModels(providerId, fallbackModels, cached.models),
          source: 'cache',
          updatedAt: cached.updatedAt,
          canLiveDiscoverModels: true
        };
      }
    } else if (cached.models.length > 0) {
      return {
        models: this.resolveProviderModels(providerId, fallbackModels, cached.models),
        source: 'cache',
        updatedAt: cached.updatedAt,
        canLiveDiscoverModels: false
      };
    }

    return {
      models: fallbackModels,
      source: 'fallback',
      updatedAt: null,
      canLiveDiscoverModels: input.authMode === 'api_key'
    };
  }

  private async getResolvedQuota(
    providerId: ProviderId,
    adapter: ProviderAdapter,
    input: {
      account: ProviderAccount | null;
      authMode: ProviderDescriptor['authMode'];
      cliPath: string | null;
      modelId: string | null;
    }
  ): Promise<ResolvedProviderQuota> {
    if (!adapter.getQuotaStatus || !input.authMode) {
      return { quota: null };
    }

    const apiKey = input.account?.encryptedApiKey ? this.decryptApiKey(input.account.encryptedApiKey) : null;

    try {
      const quota = await adapter.getQuotaStatus({
        account: input.account,
        authMode: input.authMode,
        cliPath: input.cliPath,
        apiKey,
        modelId: input.modelId
      });
      return { quota };
    } catch {
      return { quota: null };
    }
  }

  private resolveQuotaProbeModelId(providerId: ProviderId, models: ProviderModel[]) {
    if (models.length === 0) {
      return null;
    }

    if (providerId === 'gemini') {
      for (const modelId of GEMINI_QUOTA_PROBE_ORDER) {
        if (models.some((model) => model.id === modelId)) {
          return modelId;
        }
      }
    }

    return providerId === 'ollama' ? selectPreferredOllamaModel(models)?.id ?? null : models[0]?.id ?? null;
  }

  private mergeQuotaModels(providerId: ProviderId, models: ProviderModel[], quota: ProviderQuotaStatus | null) {
    if (!quota?.buckets.length) {
      return models;
    }

    const extras = quota.buckets
      .map((bucket) => createProviderModelFromId(providerId, bucket.modelId))
      .filter((value): value is ProviderModel => Boolean(value));

    if (extras.length === 0) {
      return models;
    }

    return filterUnsupportedProviderModels(providerId, sanitizeDiscoveredModels(providerId, [...models, ...extras]));
  }

  private resolveProviderModels(providerId: ProviderId, fallbackModels: ProviderModel[], cachedModels: ProviderModel[]) {
    if (providerId === 'ollama' && cachedModels.length === 0) {
      return [];
    }

    if (cachedModels.length > 0) {
      return filterUnsupportedProviderModels(providerId, sanitizeDiscoveredModels(providerId, cachedModels));
    }

    return filterUnsupportedProviderModels(providerId, fallbackModels);
  }

  private async resolveUsableModelId(providerId: ProviderId, requestedModelId: string) {
    const normalizedModelId = resolveProviderModelAlias(providerId, requestedModelId);
    const provider = await this.getProvider(providerId);
    if (provider.models.some((model) => model.id === normalizedModelId)) {
      return normalizedModelId;
    }

    if (providerId === 'ollama') {
      return selectPreferredOllamaModel(provider.models)?.id ?? normalizedModelId;
    }

    return provider.models[0]?.id ?? normalizedModelId;
  }

  private async resolveExecutionModelId(
    providerId: ProviderId,
    requestedModelId: string,
    imageAttachments: readonly ImageAttachment[]
  ) {
    const normalizedModelId = resolveProviderModelAlias(providerId, requestedModelId);
    const provider = await this.getProvider(providerId);

    if (providerId === 'ollama' && imageAttachments.length > 0) {
      const requestedModel = provider.models.find((model) => model.id === normalizedModelId) ?? null;
      if (requestedModel?.supportsVision) {
        return requestedModel.id;
      }

      const visionModel = selectPreferredOllamaVisionModel(provider.models);
      if (visionModel) {
        return visionModel.id;
      }

      throw new Error(
        'Ollama needs a vision-capable model for image input. Install a local vision model such as qwen2.5vl, gemma3, or llava, then retry.'
      );
    }

    if (provider.models.some((model) => model.id === normalizedModelId)) {
      return normalizedModelId;
    }

    if (providerId === 'ollama') {
      return selectPreferredOllamaModel(provider.models)?.id ?? normalizedModelId;
    }

    return provider.models[0]?.id ?? normalizedModelId;
  }

  private syncProviderAccount(
    providerId: ProviderId,
    account: ProviderAccount | null,
    auth: { authState: ProviderAccount['authState']; authMode: ProviderAuthMode | null }
  ) {
    const nextEncryptedApiKey = account?.encryptedApiKey ?? null;
    const nextAuthMode = auth.authMode;
    const nextAuthState = auth.authState;

    if (!account && nextAuthMode === null && !nextEncryptedApiKey) {
      return null;
    }

    if (!account && nextAuthMode === 'cli' && nextAuthState === 'detected' && !nextEncryptedApiKey) {
      return null;
    }

    const next: ProviderAccount = {
      providerId,
      authState: nextAuthState,
      authMode: nextAuthMode,
      encryptedApiKey: nextEncryptedApiKey,
      updatedAt: new Date().toISOString()
    };

    if (account?.authMode !== next.authMode) {
      this.db.clearProviderModelCache(providerId);
    }

    if (
      !account ||
      account.authState !== next.authState ||
      account.authMode !== next.authMode ||
      account.encryptedApiKey !== next.encryptedApiKey
    ) {
      this.db.saveProviderAccount(next);
    }

    return next;
  }

  private isLocallyDisconnected(account: ProviderAccount | null) {
    return Boolean(account && account.authState === 'disconnected' && (account.authMode !== null || account.encryptedApiKey));
  }

  private resolveAvailableAuthMode(
    auth: { authState: ProviderAccount['authState']; authMode: ProviderAuthMode | null },
    account: ProviderAccount | null
  ) {
    if (auth.authMode) {
      return auth.authMode;
    }
    if (account?.encryptedApiKey) {
      return 'api_key' as const;
    }
    return null;
  }

  private resolveVisibleProviderAuth(
    providerId: ProviderId,
    account: ProviderAccount | null,
    machineAuth: { authState: ProviderAccount['authState']; authMode: ProviderAuthMode | null; message?: string }
  ) {
    if (machineAuth.authMode === 'api_key') {
      return machineAuth;
    }

    if (machineAuth.authMode !== 'cli') {
      return {
        authState: machineAuth.authState,
        authMode: account?.encryptedApiKey ? 'api_key' : null,
        message: machineAuth.message
      };
    }

    const explicitlyConnected = account?.authMode === 'cli' && account.authState === 'connected';

    if (machineAuth.authState === 'connected') {
      if (explicitlyConnected) {
        return machineAuth;
      }

      return {
        authState: 'detected' as const,
        authMode: 'cli' as const,
        message: this.getDetectedCliMessage(providerId)
      };
    }

    if (machineAuth.authState === 'detected') {
      return {
        authState: 'detected' as const,
        authMode: 'cli' as const,
        message: machineAuth.message ?? this.getDetectedCliMessage(providerId)
      };
    }

    return {
      authState: 'disconnected' as const,
      authMode: null,
      message: machineAuth.message
    };
  }

  private getLocalDisconnectMessage(providerId: ProviderId, authMode: ProviderAuthMode | null) {
    if (authMode === 'cli') {
      return `${providerDisplayName(providerId)} sign-in is still available on this machine, but disconnected in Vicode. Reconnect it here or open the official CLI sign-in flow again.`;
    }

    if (authMode === 'api_key') {
      return `A local ${providerDisplayName(providerId)} API key is still stored for this app, but ${providerDisplayName(providerId)} is disconnected in Vicode. Reconnect in Vicode to use it here.`;
    }

    return `${providerDisplayName(providerId)} is disconnected in Vicode.`;
  }

  private getDetectedCliMessage(providerId: ProviderId) {
    return `Vicode found an existing ${providerCliLabel(providerId)} sign-in on this machine. Nothing is imported automatically. Use it explicitly in Vicode or open the official sign-in flow again.`;
  }

  private getMissingCliMessage(providerId: ProviderId, authMode: ProviderAuthMode | null) {
    if (providerId === 'ollama') {
      if (authMode === 'api_key') {
        return 'An Ollama cloud API key is stored locally. You can use hosted Ollama models without installing the local runtime.';
      }

      if (authMode === 'cli') {
        return 'Ollama state was detected on this machine, but the local runtime is not runnable from Vicode. Install or repair the Ollama runtime and refresh.';
      }

      return 'Ollama local runtime is not installed. Install it for local models, or save an Ollama API key in Vicode to use hosted models.';
    }

    if (authMode === 'cli') {
      return `${providerDisplayName(providerId)} sign-in was detected on this machine, but the ${providerCliLabel(providerId)} is not runnable from Vicode. Install or repair the CLI and refresh.`;
    }

    if (authMode === 'api_key') {
      return `A ${providerDisplayName(providerId)} API key is stored locally, but ${providerCliLabel(providerId)} is still required to run ${providerDisplayName(providerId)} in Vicode.`;
    }

    return `${providerCliLabel(providerId)} is not installed. Install it before signing in.`;
  }

  private emit(event: AppEvent) {
    if (this.disposed) {
      return;
    }
    this.emitter.emit('event', event);
  }

  private publishRunProgress(progress: RunProgressState) {
    this.runProgressByRun.set(progress.runId, progress);
    const serialized = JSON.stringify(progress);
    if (this.lastPersistedRunProgressByRun.get(progress.runId) !== serialized) {
      this.lastPersistedRunProgressByRun.set(progress.runId, serialized);
      const event = this.db.addRunEvent(progress.threadId, progress.runId, 'info', {
        progressSnapshot: progress
      });
      this.emit({ type: 'raw.event', event });
    }
    this.emit({
      type: 'run.progress',
      threadId: progress.threadId,
      runId: progress.runId,
      progress
    });
  }

  private publishProviderRunProgress(runId: string, nextProgress: RunProgressState) {
    const current = this.runProgressByRun.get(runId) ?? null;
    const merged: RunProgressState = {
      ...nextProgress,
      title: nextProgress.title ?? current?.title ?? null,
      diffStats: nextProgress.diffStats ?? current?.diffStats ?? null,
      reviewAvailable: nextProgress.reviewAvailable || current?.reviewAvailable || false,
      changeArtifact: nextProgress.changeArtifact ?? current?.changeArtifact ?? null,
      delegation: nextProgress.delegation ?? current?.delegation ?? null,
      contextPressure: nextProgress.contextPressure ?? current?.contextPressure ?? null,
      checkpointReminder: nextProgress.checkpointReminder ?? current?.checkpointReminder ?? null,
      queueSummary: nextProgress.queueSummary ?? current?.queueSummary ?? null
    };
    this.publishRunProgress(merged);
  }

  private clearRunProgress(runId: string) {
    this.runProgressByRun.delete(runId);
    this.lastPersistedRunProgressByRun.delete(runId);
  }

  private clearNativePlannerRunState(threadId: string, runId: string) {
    this.running.delete(runId);
    this.lastInfoByRun.delete(runId);
    this.clearRunProgress(runId);
    if (this.plannerRunsByThread.get(threadId) === runId) {
      this.plannerRunsByThread.delete(threadId);
    }
  }

  private recordNativePlannerCloseout(
    threadId: string,
    runId: string,
    providerId: ProviderId,
    summary: string,
    text: string | null = null
  ) {
    const event = this.recordInfoEvent(threadId, runId, normalizeProviderInfoEvent(providerId, {
      message: summary,
      activity: {
        kind: 'delegation',
        summary,
        text: text?.trim() || summary
      }
    }));
    if (event) {
      this.emit({ type: 'raw.event', event });
    }
  }

  private createPlannerDelegationState(
    providerId: ProviderId,
    phase: NonNullable<RunProgressState['delegation']>['phase']
  ): NonNullable<RunProgressState['delegation']> {
    const compatFileName = providerCapabilities(providerId).workspaceInstructionFileName;
    const noteByPhase: Record<NonNullable<RunProgressState['delegation']>['phase'], string> = {
      active: `This planner run is using delegated context only: AGENTS.md and ${compatFileName} when present. SOUL.md, USER.md, and auto memory stay with the main thread.`,
      waiting_for_answers:
        'The delegated planner needs a clarifying answer before it should continue drafting the plan.',
      resuming:
        'Planner answers were supplied and the delegated run is continuing without reloading the full main-thread memory.'
    };

    return {
      mode: 'planner',
      profile: 'delegated',
      phase,
      title: 'Delegated planner context',
      note: noteByPhase[phase],
      includedContext: ['AGENTS.md', compatFileName],
      excludedContext: ['SOUL.md', 'USER.md', 'auto memory']
    };
  }

  private createBackgroundDelegationState(
    providerId: ProviderId,
    input: { profile: AutonomyDelegationProfile; title: string }
  ): NonNullable<RunProgressState['delegation']> {
    const compatFileName = providerCapabilities(providerId).workspaceInstructionFileName;
    const profileLabel =
      input.profile === 'heartbeat'
        ? 'heartbeat'
        : input.profile === 'research'
          ? 'research'
          : input.profile === 'implement'
            ? 'implementation'
            : 'verification';

    return {
      mode: 'background',
      profile: input.profile,
      phase: 'active',
      title: input.title,
      note: `This ${profileLabel} run is using delegated context only: AGENTS.md and ${compatFileName} when present. SOUL.md, USER.md, auto memory, and inline thread history stay with the main thread.`,
      includedContext: ['AGENTS.md', compatFileName],
      excludedContext: ['SOUL.md', 'USER.md', 'auto memory', 'inline thread history']
    };
  }

  private createNativePlannerRunProgress(
    runId: string,
    threadId: string,
    providerId: ProviderId,
    phase: NonNullable<RunProgressState['delegation']>['phase']
  ): RunProgressState {
    const items = createPlannerDelegationItems(runId).map((item) => ({ ...item }));

    if (phase === 'waiting_for_answers') {
      items[1] = { ...items[1], status: 'blocked' };
    }

    if (phase === 'resuming') {
      items[1] = { ...items[1], status: 'completed' };
      items[2] = { ...items[2], status: 'in_progress' };
    }

    return {
      runId,
      threadId,
      title: 'Native planner run',
      items,
      updatedAt: new Date().toISOString(),
      diffStats: null,
      reviewAvailable: false,
      changeArtifact: null,
      delegation: this.createPlannerDelegationState(providerId, phase),
      contextPressure: null,
      checkpointReminder: null,
      queueSummary: null
    };
  }

  private createBackgroundDelegationRunProgress(
    runId: string,
    threadId: string,
    providerId: ProviderId,
    delegation: NonNullable<ExecutionContext['delegation']>
  ): RunProgressState {
    return {
      runId,
      threadId,
      title: 'Background delegated run',
      items: createBackgroundDelegationItems(runId).map((item) => ({ ...item })),
      updatedAt: new Date().toISOString(),
      diffStats: null,
      reviewAvailable: false,
      changeArtifact: null,
      delegation: this.createBackgroundDelegationState(providerId, {
        profile: delegation.profile,
        title: delegation.title
      }),
      contextPressure: null,
      checkpointReminder: null,
      queueSummary: null
    };
  }

  private updateNativePlannerRunProgress(
    threadId: string,
    runId: string,
    providerId: ProviderId,
    phase: NonNullable<RunProgressState['delegation']>['phase']
  ) {
    const current = this.runProgressByRun.get(runId);
    const next = this.createNativePlannerRunProgress(runId, threadId, providerId, phase);
    if (current && JSON.stringify(current) === JSON.stringify(next)) {
      return;
    }
    this.publishRunProgress(next);
  }

  private advanceRunProgress(runId: string) {
    const progress = this.runProgressByRun.get(runId);
    if (!progress) {
      return;
    }

    this.publishRunProgress(advanceRunProgress(progress));
  }

  private completeRunProgress(runId: string) {
    const progress = this.runProgressByRun.get(runId);
    if (!progress) {
      return;
    }

    this.publishRunProgress(completeRunProgress(progress));
  }

  private failRunProgress(runId: string, status: 'failed' | 'blocked') {
    const progress = this.runProgressByRun.get(runId);
    if (!progress) {
      return;
    }

    this.publishRunProgress(failRunProgress(progress, status));
  }

  private recordInfoEvent(threadId: string, runId: string, normalizedInfo: NormalizedProviderInfoEvent) {
    if (this.disposed) {
      return null;
    }

    if (!normalizedInfo.shouldPersist) {
      return null;
    }

    if (normalizedInfo.dedupeKey && this.lastInfoByRun.get(runId) === normalizedInfo.dedupeKey) {
      return null;
    }

    if (normalizedInfo.dedupeKey) {
      this.lastInfoByRun.set(runId, normalizedInfo.dedupeKey);
    }
    return this.db.addRunEvent(threadId, runId, 'info', normalizedInfo.eventPayload);
  }

  private recordRuntimeTraceMark(
    threadId: string,
    runId: string,
    stage: RunRuntimeTraceStage,
    detail: Record<string, unknown> | null = null
  ) {
    if (this.disposed) {
      return null;
    }

    const mark: RunRuntimeTraceMark = {
      stage,
      at: new Date().toISOString(),
      detail
    };
    return this.db.addRunEvent(threadId, runId, 'info', {
      runtimeTrace: mark
    });
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
    workspaceSnapshot: WorkspaceSnapshot;
    projectFolderPath: string;
    approvedPlan: boolean;
    titlePrompt: string | null;
  }) {
    this.clearPendingToolApprovals(input.runId, 'cancelled');
    this.running.delete(input.runId);
    this.runningByThread.delete(input.threadId);
    this.lastInfoByRun.delete(input.runId);
    this.lastPersistedRunProgressByRun.delete(input.runId);
    const previousChangeArtifact = this.lastChangeArtifactByRun.get(input.runId) ?? null;
    const changeArtifact = deriveRunChangeArtifact(input.workspaceSnapshot, input.projectFolderPath);
    if (changeArtifact) {
      if (serializeRunChangeArtifact(previousChangeArtifact) !== serializeRunChangeArtifact(changeArtifact)) {
        this.emitLiveFileEditEvents(input.threadId, input.runId, previousChangeArtifact, changeArtifact);
      }
      this.lastChangeArtifactByRun.set(input.runId, changeArtifact);
      const currentProgress = this.runProgressByRun.get(input.runId);
      if (currentProgress) {
        this.publishRunProgress({
          ...currentProgress,
          updatedAt: new Date().toISOString(),
          diffStats: changeArtifact.summary,
          reviewAvailable: true,
          changeArtifact
        });
      }
      const changeEvent = this.db.addRunEvent(input.threadId, input.runId, 'info', {
        activity: {
          kind: 'change_summary',
          summary: formatRunChangeSummary(changeArtifact.summary.filesChanged),
          changeArtifact
        }
      });
      this.emit({ type: 'raw.event', event: changeEvent });
    }
    this.completeRunProgress(input.runId);
    const thread = this.db.getThread(input.threadId);
    const sources = collectThreadSourcesFromRunArtifacts(
      thread.rawOutput.filter((event) => event.runId === input.runId),
      input.output
    );
    this.db.updateAssistantTurn(
      input.runId,
      input.threadId,
      input.output,
      sources.length > 0 ? { sources } : null
    );
    this.recordRuntimeTraceMark(input.threadId, input.runId, 'completed', {
      outputLength: input.output.length
    });
    this.db.addRunEvent(input.threadId, input.runId, 'completed', { output: input.output });
    this.db.updateThreadStatus(input.threadId, 'completed');
    if (input.approvedPlan) {
      this.db.setThreadPlannerTurnState(input.threadId, 'idle');
    }
    this.emit({ type: 'thread.detail', thread: this.db.getThread(input.threadId) });
    this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(input.threadId) });
    this.emit({ type: 'run.status', threadId: input.threadId, runId: input.runId, status: 'completed' });
    this.runProgressByRun.delete(input.runId);
    this.lastChangeArtifactByRun.delete(input.runId);
    void this.maybeDispatchNextFollowUp(input.threadId);
    if (input.titlePrompt) {
      void this.generateThreadTitle(input.threadId, input.titlePrompt);
    }
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
    this.clearPendingToolApprovals(input.runId, 'cancelled');
    this.running.delete(input.runId);
    this.runningByThread.delete(input.threadId);
    this.lastChangeArtifactByRun.delete(input.runId);
    this.lastInfoByRun.delete(input.runId);
    this.lastPersistedRunProgressByRun.delete(input.runId);
    this.failRunProgress(input.runId, input.progressStatus);
    this.db.removeEmptyAssistantTurn(input.runId, input.threadId);
    this.recordRuntimeTraceMark(input.threadId, input.runId, input.traceStage, input.tracePayload ?? null);
    this.db.addRunEvent(
      input.threadId,
      input.runId,
      input.eventType,
      input.message ? { message: input.message } : {}
    );
    this.db.updateThreadStatus(input.threadId, input.threadStatus);
    if (input.approvedPlan) {
      this.db.setThreadPlannerTurnState(input.threadId, 'idle');
    }
    this.emit({ type: 'thread.updated', thread: this.db.getThreadSummary(input.threadId) });
    this.emit({
      type: 'run.status',
      threadId: input.threadId,
      runId: input.runId,
      status: input.runStatus,
      message: input.message
    });
    this.runProgressByRun.delete(input.runId);
    void this.maybeDispatchNextFollowUp(input.threadId);
    if (input.titlePrompt) {
      void this.generateThreadTitle(input.threadId, input.titlePrompt);
    }
  }

  private scheduleAuthPolling(providerId: ProviderId) {
    this.clearAuthPolling(providerId);
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      void this.getProvider(providerId)
        .then((provider) => {
          this.emit({ type: 'provider.updated', provider });
          if (provider.authState !== 'checking' || attempts >= 30) {
            this.clearPendingAuth(providerId);
          }
        })
        .catch(() => {
          if (attempts >= 30) {
            this.clearPendingAuth(providerId);
          }
        });
    }, 2_500);
    this.authPolling.set(providerId, timer);
  }

  private clearAuthPolling(providerId: ProviderId) {
    const timer = this.authPolling.get(providerId);
    if (!timer) {
      return;
    }
    clearInterval(timer);
    this.authPolling.delete(providerId);
  }

  private clearPendingAuth(providerId: ProviderId) {
    this.pendingAuth.delete(providerId);
    this.clearAuthPolling(providerId);
  }

  private decryptApiKey(value: string) {
    const buffer = Buffer.from(value, 'base64');
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buffer) : buffer.toString('utf8');
  }

  private isModelCacheStale(updatedAt: string | null) {
    if (!updatedAt) {
      return true;
    }

    return Date.now() - new Date(updatedAt).getTime() > MODEL_CACHE_TTL_MS;
  }

  private collectAssistantText(threadId: string, runId: string) {
    const thread = this.db.getThread(threadId);
    return [...thread.turns].reverse().find((turn) => turn.runId === runId && turn.role === 'assistant')?.content ?? '';
  }

  private collectRunDeltaText(threadId: string, runId: string) {
    const thread = this.db.getThread(threadId);
    return thread.rawOutput
      .filter((event) => event.runId === runId && event.eventType === 'delta')
      .map((event) => (typeof event.payload?.delta === 'string' ? event.payload.delta : ''))
      .join('');
  }

  private resolveProviderCompletionOutput(providerId: ProviderId, threadId: string, runId: string, output: string) {
    const normalizedOutput = normalizeProviderVisibleText(providerId, output).trim();
    const streamedDeltaOutput = this.collectRunDeltaText(threadId, runId).trim();
    const assistantTurnOutput = this.collectAssistantText(threadId, runId).trim();
    const streamedOutput = assistantTurnOutput
      ? preferProviderVisibleText(providerId, streamedDeltaOutput, assistantTurnOutput).trim()
      : streamedDeltaOutput;
    const formatFinalOutput = (value: string) => this.formatProviderCompletionOutput(providerId, value);
    if (!normalizedOutput) {
      return formatFinalOutput(streamedOutput);
    }
    if (!streamedOutput) {
      return formatFinalOutput(normalizedOutput);
    }

    const comparableNormalized = normalizedOutput.replace(/\s+/gu, '');
    const comparableStreamed = streamedOutput.replace(/\s+/gu, '');
    if (comparableNormalized === comparableStreamed) {
      return formatFinalOutput(preferProviderVisibleText(providerId, streamedOutput, output).trim());
    }
    if (normalizedOutput.startsWith(streamedOutput)) {
      return formatFinalOutput(normalizedOutput);
    }

    return formatFinalOutput(normalizedOutput);
  }

  private formatProviderCompletionOutput(providerId: ProviderId, value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    if (providerId === 'ollama') {
      return formatOllamaFinalAnswerFallback(trimmed);
    }

    return trimmed;
  }

  private async finalizeSuccessfulExecutionRunWithProviderCleanup(input: {
    providerId: ProviderId;
    modelId: string;
    threadId: string;
    runId: string;
    output: string;
    workspaceSnapshot: WorkspaceSnapshot | null;
    projectFolderPath: string | null;
    approvedPlan: boolean;
    titlePrompt: string | null;
  }) {
    const fallbackOutput = this.formatProviderCompletionOutput(input.providerId, input.output);
    let nextOutput = fallbackOutput;
    if (!nextOutput || this.disposed) {
      return;
    }

    if (input.providerId === 'ollama') {
      try {
        const rewritten = await this.ollamaFinalAnswerFormatter.rewrite(input.modelId, input.output);
        if (rewritten?.trim()) {
          nextOutput = rewritten.trim();
        }
      } catch {
        nextOutput = fallbackOutput;
      }
    }

    if (this.disposed || !nextOutput) {
      return;
    }

    this.finalizeSuccessfulExecutionRun({
      threadId: input.threadId,
      runId: input.runId,
      output: nextOutput,
      workspaceSnapshot: input.workspaceSnapshot,
      projectFolderPath: input.projectFolderPath,
      approvedPlan: input.approvedPlan,
      titlePrompt: input.titlePrompt
    });
  }

  private formatNativePlannerAnswers(
    questionSet: PlannerQuestionSet,
    answers: Record<string, PlannerQuestionAnswer>
  ) {
    const lines = [
      'Please continue the native planner using these answers:',
      'Return the full structured plan now as markdown with:',
      '- a single # title line',
      '- ## Summary',
      '- ## Key Changes',
      '- ## Test Plan',
      '- ## Assumptions',
      'Do not stop at a partial note or a brief acknowledgement.',
      'Do not ask more follow-up questions unless the answers still leave a safety-critical ambiguity.'
    ];

    for (const question of questionSet.questions) {
      const answer = answers[question.id];
      if (!answer || answer.answers.length === 0) {
        continue;
      }
      lines.push(`${question.question}`);
      lines.push(`- ${answer.answers.join(' | ')}`);
    }

    return lines.join('\n');
  }

  private emitLiveFileEditEvents(threadId: string, runId: string, previousArtifact: RunChangeArtifact | null, nextArtifact: RunChangeArtifact | null) {
    const previousFiles = new Map(
      (previousArtifact?.files ?? []).map((file) => [file.path, JSON.stringify(file)] as const)
    );

    for (const file of nextArtifact?.files ?? []) {
      const serialized = JSON.stringify(file);
      if (previousFiles.get(file.path) === serialized) {
        continue;
      }

      const fileEvent = this.db.addRunEvent(threadId, runId, 'info', {
        activity: {
          kind: 'file_edit',
          summary: `Edited ${file.path.split('/').pop() ?? file.path}`,
          path: file.path,
          text: `+${file.insertions} -${file.deletions}`
        }
      });
      this.emit({ type: 'raw.event', event: fileEvent });
    }
  }

  private assembleWorkspaceContext(
    input: Pick<ComposerSubmitInput, 'providerId' | 'skillIds' | 'projectId' | 'prompt'>,
    thread: ThreadDetail,
    folderPath: string | null,
    trusted: boolean,
    options: {
      includeRuntimeSkills: boolean;
      contextProfile?: 'main' | 'delegated';
      includeMemory?: boolean;
      includeGeneratedMemory?: boolean;
    }
  ) {
    const personalization = this.db.getPersonalization();
    const preferences = this.db.getPreferences();
    const priorContextUsage = this.deriveLatestContextWindowUsage(thread.rawOutput, null);
    return this.workspaceContext.assemble({
      projectId: input.projectId,
      providerId: input.providerId,
      folderPath,
      trusted,
      contextProfile: options.contextProfile ?? 'main',
      query: input.prompt,
      memoryQuery: this.buildMemoryRetrievalQuery(thread, input.prompt),
      memoryMaxResults: priorContextUsage
        ? this.deriveMemoryMaxResults(input.providerId, thread.modelId, priorContextUsage.usedTokens)
        : undefined,
      generatedMemoryQuery: this.buildMemoryRetrievalQuery(thread, input.prompt),
      generatedMemoryMaxResults: priorContextUsage
        ? Math.min(3, this.deriveMemoryMaxResults(input.providerId, thread.modelId, priorContextUsage.usedTokens))
        : 3,
      explicitSkillIds: input.skillIds,
      includeWorkspaceInstructions: personalization.useWorkspaceInstructions,
      includeMemory: options.includeMemory ?? true,
      includeGeneratedMemory: options.includeGeneratedMemory ?? preferences.generatedMemoryUseEnabled,
      includeRuntimeSkills: options.includeRuntimeSkills
    });
  }

  private shouldSuggestThreadTitle(thread: ThreadDetail, prompt: string) {
    return thread.title.trim() === 'New thread' && thread.turns.length === 0 && Boolean(prompt.trim());
  }

  private async generateThreadTitle(threadId: string, prompt: string) {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return;
    }
    const fallbackTitle = this.deriveFallbackThreadTitle(trimmedPrompt);

    const thread = this.db.getThread(threadId);
    if (thread.title.trim() !== 'New thread') {
      return;
    }

    const adapter = this.adapters[thread.providerId];
    const account = this.db.getProviderAccount(thread.providerId);
    const auth = await adapter.getAuthState(account);
    const apiKey = auth.authMode === 'api_key' && account?.encryptedApiKey ? this.decryptApiKey(account.encryptedApiKey) : null;
    const runId = randomUUID();

    if (providerCapabilities(thread.providerId).requiresFullAccessForAppRuns) {
      if (!fallbackTitle) {
        return;
      }
      const summary = this.db.renameThread(thread.id, fallbackTitle);
      this.emit({ type: 'thread.updated', thread: summary });
      this.emit({ type: 'thread.detail', thread: this.db.getThread(thread.id) });
      return;
    }

    const resolvedTitle = await new Promise<string | null>((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        finish(fallbackTitle);
      }, 5_000);

      const finish = (value: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };

      void adapter
        .startRun(
          {
            threadId: thread.id,
            runId,
            prompt: this.buildThreadTitlePrompt(trimmedPrompt),
            modelId: thread.modelId,
            folderPath: null,
            trusted: false,
            apiKey,
            runMode: 'plan',
            executionPermission: 'default',
            ollamaTransportMode: this.resolveOllamaTransportMode(thread.providerId)
          },
          {
            onStart: () => {},
            onDelta: () => {},
            onInfo: () => {},
            onComplete: (output) => finish(this.normalizeSuggestedThreadTitle(output, trimmedPrompt)),
            onError: () => finish(this.deriveFallbackThreadTitle(trimmedPrompt)),
            onAbort: () => finish(null)
          }
        )
        .catch(() => finish(fallbackTitle));
    });

    if (!resolvedTitle) {
      return;
    }

    const current = this.db.getThreadSummary(thread.id);
    if (current.title.trim() !== 'New thread') {
      return;
    }

    const summary = this.db.renameThread(thread.id, resolvedTitle);
    this.emit({ type: 'thread.updated', thread: summary });
    this.emit({ type: 'thread.detail', thread: this.db.getThread(thread.id) });
  }

  private async runUtilityTextGeneration(input: {
    providerId: ProviderId;
    modelId: string;
    prompt: string;
    fallback: string | null;
    timeoutMs: number;
  }) {
    if (providerCapabilities(input.providerId).requiresFullAccessForAppRuns) {
      return input.fallback;
    }

    const adapter = this.adapters[input.providerId];
    const account = this.db.getProviderAccount(input.providerId);
    const auth = await adapter.getAuthState(account);
    const apiKey = auth.authMode === 'api_key' && account?.encryptedApiKey ? this.decryptApiKey(account.encryptedApiKey) : null;
    const modelId = await this.resolveUtilityModelId(input.providerId, input.modelId);
    const runId = randomUUID();

    return new Promise<string | null>((resolve) => {
      let output = '';
      let settled = false;
      const timeout = setTimeout(() => {
        finish(input.fallback);
      }, input.timeoutMs);

      const finish = (value: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(value?.trim() ? value.trim() : input.fallback);
      };

      void adapter
        .startRun(
          {
            threadId: `utility-summary-${runId}`,
            runId,
            prompt: input.prompt,
            modelId,
            reasoningEffort: null,
            thinkingEnabled: providerCapabilities(input.providerId).supportsThinkingToggle ? false : undefined,
            folderPath: null,
            trusted: false,
            apiKey,
            runMode: 'plan',
            executionPermission: 'default',
            ollamaTransportMode: this.resolveOllamaTransportMode(input.providerId)
          },
          {
            onStart: () => {},
            onDelta: (delta) => {
              output += delta;
            },
            onInfo: () => {},
            onComplete: (value) => finish(value || output),
            onError: () => finish(input.fallback),
            onAbort: () => finish(input.fallback)
          }
        )
        .catch(() => finish(input.fallback));
    });
  }

  private async resolveUtilityModelId(providerId: ProviderId, modelId: string) {
    let candidate = modelId;

    try {
      const provider = await this.getProvider(providerId);
      candidate = selectPreferredSubagentModel(providerId, provider.models)?.id ?? candidate;
    } catch {
      // Fall back to the caller-supplied model when provider metadata is unavailable.
    }

    try {
      return await this.resolveUsableModelId(providerId, candidate);
    } catch {
      return candidate;
    }
  }

  private buildThreadTitlePrompt(prompt: string) {
    return [
      'Generate a concise coding thread title.',
      'Return only the title text.',
      'Use 2 to 6 words.',
      'Do not use quotes, markdown, punctuation suffixes, or prefixes like "Title:".',
      'Focus on the main task or deliverable.',
      '',
      `Request: ${prompt}`
    ].join('\n');
  }

  private buildPromptRefinementInput(projectId: string, providerId: ProviderId, prompt: string) {
    const project = this.db.getProject(projectId);
    const personalization = this.db.getPersonalization();
    const sections = [
      `Project: ${project.name}`,
      project.folderPath ? `Active workspace folder: ${project.folderPath}` : null,
      personalization.globalInstructions.trim() ? `Global instructions:\n${personalization.globalInstructions.trim()}` : null,
      personalization.providerInstructions[providerId]?.trim()
        ? `${providerDisplayName(providerId)} instructions:\n${personalization.providerInstructions[providerId]!.trim()}`
        : null,
      `User draft:\n${prompt}`
    ].filter((value): value is string => Boolean(value));

    return sections.join('\n\n');
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
    if (folderPath && providerCapabilities(providerId).requiresTrustedWorkspace && !trusted) {
      throw new Error(`${providerDisplayName(providerId)} cannot run against an untrusted workspace. Trust the project and retry.`);
    }

    if (folderPath && !existsSync(folderPath)) {
      throw new Error(
        `Workspace folder is unavailable: ${folderPath}. Re-open or repair the project path before running ${providerDisplayName(providerId)}.`
      );
    }

    const validation = this.adapters[providerId].validateProjectContext(folderPath, trusted);
    if (!validation.valid) {
      throw new Error(validation.message ?? `${providerDisplayName(providerId)} cannot run against this project.`);
    }
  }

  private buildPromptRefinementPrompt(prompt: string) {
    return [
      'Rewrite the user draft into a clear, efficient prompt for a coding agent.',
      'Preserve the original intent.',
      'If the draft includes an active workspace folder, keep the prompt grounded in that workspace by default.',
      'Default to that workspace for file operations unless the user explicitly asks for another location.',
      'If that workspace appears empty or lacks the requested files, tell the user instead of selecting a different workspace on your own.',
      'Do not invent product requirements, file paths, or technologies unless the user already implied them.',
      'Do not introduce or preserve stale absolute paths from earlier tasks unless the user explicitly confirmed them in the draft.',
      'Add structure only when it improves execution clarity.',
      'Prefer a compact but capable prompt over a bloated one.',
      'If assumptions are necessary, include them briefly inside the prompt as explicit assumptions.',
      'Return only the rewritten prompt text.',
      '',
      prompt
    ].join('\n');
  }

  private normalizeSuggestedThreadTitle(output: string, fallbackPrompt: string) {
    const line = output
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .find(Boolean);

    const cleaned = line
      ?.replace(/^title:\s*/iu, '')
      .replace(/^["'`]+|["'`]+$/gu, '')
      .replace(/^[-*•]\s*/u, '')
      .replace(/\s+/gu, ' ')
      .trim();

    if (!cleaned || cleaned.length < 3 || cleaned.length > 72) {
      return this.deriveFallbackThreadTitle(fallbackPrompt);
    }

    if (/responding to:/iu.test(cleaned) || cleaned.toLowerCase().includes('generate a concise coding thread title')) {
      return this.deriveFallbackThreadTitle(fallbackPrompt);
    }

    return normalizeDisplayText(cleaned);
  }

  private deriveFallbackThreadTitle(prompt: string) {
    const cleaned = normalizeDisplayText(prompt)
      .replace(/\s+/gu, ' ')
      .replace(/^[^\p{L}\p{N}]+/gu, '')
      .trim();

    if (!cleaned) {
      return null;
    }

    return cleaned.slice(0, 56).trim();
  }

  private normalizeEnhancedPrompt(output: string, fallbackPrompt: string) {
    const cleaned = output
      .replace(/^```[a-z0-9_-]*\s*/iu, '')
      .replace(/```$/u, '')
      .replace(/^refined prompt:\s*/iu, '')
      .replace(/^improved prompt:\s*/iu, '')
      .trim();

    if (!cleaned) {
      return fallbackPrompt;
    }

    return cleaned;
  }

  private isThreadActive(thread: ThreadDetail) {
    return thread.status === 'queued' || thread.status === 'running' || thread.status === 'stopping';
  }

  private findLatestRunId(thread: ThreadDetail) {
    return [...thread.rawOutput].reverse().find((event) => event.runId)?.runId ?? null;
  }

  private requestToolApproval(
    input: Omit<RunToolApprovalRequest, 'id' | 'requestedAt'>,
    runtimeCommandPolicy: ProjectRuntimeCommandPolicy = 'approval_required'
  ) {
    if (!this.usesAppAuthoritativeToolApproval(input.providerId)) {
      return Promise.resolve<RunToolApprovalDecision>('approved');
    }

    const effectiveRuntimeCommandPolicy = this.getCurrentRuntimeCommandPolicyForThread(
      input.threadId,
      runtimeCommandPolicy
    );

    if (effectiveRuntimeCommandPolicy === 'auto_approve') {
      return Promise.resolve<RunToolApprovalDecision>('approved');
    }

    if (effectiveRuntimeCommandPolicy === 'disabled') {
      return Promise.resolve<RunToolApprovalDecision>('rejected');
    }

    const approval: RunToolApprovalRequest = {
      ...input,
      id: randomUUID(),
      requestedAt: new Date().toISOString()
    };

    return new Promise<RunToolApprovalDecision>((resolve) => {
      this.pendingRunToolApprovals.set(approval.id, {
        request: approval,
        resolve
      });
      this.emit({ type: 'run.approvalRequested', approval });
    });
  }

  private async executeProviderRuntimeToolCall(input: {
    call: AgentToolCall;
    workspaceRoot: string;
    trustedWorkspace: boolean;
    threadId: string;
    runId: string;
    providerId: ProviderId;
    executionPermission: ExecutionPermission;
    executionConstraints?: AgentExecutionConstraints | null;
    runtimeCommandPolicy: ProjectRuntimeCommandPolicy;
    runtimeNetworkPolicy: ProjectRuntimeNetworkPolicy;
    onInfo: (payload: {
      message?: string | null;
      activity?: RunActivityInfo | null;
    }) => void;
  }): Promise<AgentToolExecutionResult> {
    return this.agentRuntime.executeToolCall(input.call, {
      workspaceRoot: input.workspaceRoot,
      trustedWorkspace: input.trustedWorkspace,
      threadId: input.threadId,
      runId: input.runId,
      executionPermission: input.executionPermission,
      executionConstraints: input.executionConstraints ?? null,
      runtimeCommandPolicy: input.runtimeCommandPolicy,
      runtimeNetworkPolicy: input.runtimeNetworkPolicy,
      onInfo: input.onInfo,
      requestApproval: this.usesAppAuthoritativeToolApproval(input.providerId)
        ? (request) =>
            this.requestToolApproval({
              threadId: input.threadId,
              runId: input.runId,
              providerId: input.providerId,
              ...request
            }, input.runtimeCommandPolicy)
        : undefined
    });
  }

  private getCurrentRuntimeCommandPolicyForThread(
    threadId: string,
    fallback: ProjectRuntimeCommandPolicy
  ) {
    try {
      const thread = this.db.getThread(threadId);
      const project = this.db.getProject(thread.projectId);
      return project.runtimeCommandPolicy;
    } catch {
      return fallback;
    }
  }

  private resolvePendingToolApproval(approvalId: string, decision: RunToolApprovalDecision) {
    const pending = this.pendingRunToolApprovals.get(approvalId);
    if (!pending) {
      throw new Error(`Run approval not found: ${approvalId}`);
    }

    this.pendingRunToolApprovals.delete(approvalId);
    pending.resolve(decision);
    this.emit({
      type: 'run.approvalResolved',
      approvalId,
      threadId: pending.request.threadId,
      runId: pending.request.runId,
      decision
    });
  }

  private clearPendingToolApprovals(runId?: string, decision: RunToolApprovalDecision = 'cancelled') {
    const approvalIds = Array.from(this.pendingRunToolApprovals.entries())
      .filter(([, pending]) => !runId || pending.request.runId === runId)
      .map(([approvalId]) => approvalId);

    for (const approvalId of approvalIds) {
      const pending = this.pendingRunToolApprovals.get(approvalId);
      if (!pending) {
        continue;
      }
      this.pendingRunToolApprovals.delete(approvalId);
      pending.resolve(decision);
      this.emit({
        type: 'run.approvalResolved',
        approvalId,
        threadId: pending.request.threadId,
        runId: pending.request.runId,
        decision
      });
    }
  }

  private clearPendingToolApprovalsForThread(
    threadId: string,
    decision: RunToolApprovalDecision
  ) {
    const approvalIds = Array.from(this.pendingRunToolApprovals.entries())
      .filter(([, pending]) => pending.request.threadId === threadId)
      .map(([approvalId]) => approvalId);

    for (const approvalId of approvalIds) {
      const pending = this.pendingRunToolApprovals.get(approvalId);
      if (!pending) {
        continue;
      }

      this.pendingRunToolApprovals.delete(approvalId);
      pending.resolve(decision);
      this.emit({
        type: 'run.approvalResolved',
        approvalId,
        threadId: pending.request.threadId,
        runId: pending.request.runId,
        decision
      });
    }
  }

  private async maybeDispatchNextFollowUp(threadId: string) {
    if (this.disposed || this.followUpDispatching.has(threadId) || this.runningByThread.has(threadId)) {
      return;
    }

    const thread = this.db.getThread(threadId);
    if (this.isThreadActive(thread)) {
      return;
    }

    const followUp = this.db.claimNextThreadFollowUp(threadId);
    if (!followUp) {
      return;
    }

    this.followUpDispatching.add(threadId);

    try {
      const currentThread = this.db.getThread(threadId);
      const project = this.db.getProject(currentThread.projectId);
      const result = await this.startExecutionRun(
        {
          projectId: currentThread.projectId,
          threadId,
          prompt: followUp.content,
          providerId: currentThread.providerId,
          modelId: currentThread.modelId,
          executionPermission: currentThread.executionPermission,
          skillIds: this.readTurnSkillIds(followUp.metadata ?? null),
          imageAttachments: this.readTurnImageAttachments(followUp.metadata ?? null),
          textAttachments: this.readTurnTextAttachments(followUp.metadata ?? null)
        },
        currentThread,
        project,
        {
          approvedPlan: null,
          plannerAnswers: null
        }
      );
      const dispatched = this.db.markThreadFollowUpDispatched(followUp.id);
      this.emit({ type: 'followup.dispatched', threadId, followUp: dispatched, runId: result.runId });
      this.emit({ type: 'thread.detail', thread: this.db.getThread(threadId) });
      this.refreshDerivedRunProgress(threadId, result.runId, currentThread.providerId, currentThread.modelId);
    } catch (error) {
      this.db.markThreadFollowUpQueued(followUp.id);
      this.emit({
        type: 'app.notification',
        level: 'warning',
        message: error instanceof Error ? error.message : 'Queued follow-up could not start yet.'
      });
    } finally {
      this.followUpDispatching.delete(threadId);
    }
  }

  private usesAppAuthoritativeToolApproval(providerId: ProviderId) {
    return providerCapabilities(providerId).approvalAuthority === 'app';
  }

  private buildMemoryRetrievalQuery(thread: ThreadDetail, prompt: string) {
    const recentTurns = [...thread.turns]
      .reverse()
      .filter((turn) => turn.role === 'user' || turn.role === 'assistant')
      .slice(0, 4)
      .reverse()
      .map((turn) => turn.content.trim())
      .filter(Boolean);
    const parts = [
      prompt.trim(),
      thread.title.trim() !== 'New thread' ? thread.title.trim() : null,
      ...recentTurns
    ].filter((value): value is string => Boolean(value));
    return parts.join('\n').slice(0, 1_600);
  }

  private deriveMemoryMaxResults(providerId: ProviderId, modelId: string, usedTokens: number) {
    const usagePercent = deriveContextWindowUsagePercent(providerId, modelId, usedTokens);
    return deriveContextWindowSeverity(usagePercent) === 'normal' ? 4 : 6;
  }

  private deriveLatestContextWindowUsage(
    events: ThreadDetail['rawOutput'],
    runId: string | null
  ): ProviderContextWindowUsage | null {
    for (const event of [...events].reverse()) {
      if (runId && event.runId !== runId) {
        continue;
      }

      const candidate = event.payload?.contextWindow;
      if (!candidate || typeof candidate !== 'object') {
        continue;
      }

      const usage = candidate as Partial<ProviderContextWindowUsage>;
      if (typeof usage.usedTokens === 'number' && Number.isFinite(usage.usedTokens)) {
        return {
          usedTokens: usage.usedTokens,
          inputTokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : null,
          outputTokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : null,
          providerEventType: typeof usage.providerEventType === 'string' ? usage.providerEventType : null
        };
      }
    }

    return null;
  }

  private deriveQueueSummary(thread: ThreadDetail): RunProgressState['queueSummary'] {
    const queuedFollowUps = thread.followUps.filter((followUp) => followUp.status === 'queued' || followUp.status === 'dispatching');
    const condensedQueuedCount = queuedFollowUps.reduce(
      (total, followUp) => total + this.readCondensedQueuedCount(followUp.metadata ?? null),
      0
    );

    if (queuedFollowUps.length === 0 && condensedQueuedCount === 0) {
      return null;
    }

    return {
      queuedCount: queuedFollowUps.length,
      steerCount: queuedFollowUps.filter((followUp) => followUp.kind === 'steer').length,
      followUpCount: queuedFollowUps.filter((followUp) => followUp.kind === 'follow_up').length,
      condensedQueuedCount
    };
  }

  private countQueuedSteerFollowUps(thread: ThreadDetail) {
    return thread.followUps.filter(
      (followUp) => (followUp.status === 'queued' || followUp.status === 'dispatching') && followUp.kind === 'steer'
    ).length;
  }

  private readCondensedQueuedCount(metadata: Record<string, unknown> | null) {
    const value = metadata?.condensedQueuedCount;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  }

  private deriveContextPressureState(
    thread: ThreadDetail,
    runId: string,
    providerId: ProviderId,
    modelId: string
  ): RunContextPressureState | null {
    const usage = this.deriveLatestContextWindowUsage(thread.rawOutput, runId) ?? this.deriveLatestContextWindowUsage(thread.rawOutput, null);
    if (!usage) {
      return null;
    }

    const usagePercent = deriveContextWindowUsagePercent(providerId, modelId, usage.usedTokens);
    const severity = deriveContextWindowSeverity(usagePercent);

    return {
      severity,
      pressureLabel: deriveContextWindowPressureLabel(severity),
      note: deriveContextWindowNote(providerId, severity, true),
      source: 'provider',
      sourceLabel: deriveProviderContextSourceLabel(providerId),
      usagePercent,
      usedTokens: usage.usedTokens,
      maxTokens: resolveContextWindowLimit(providerId, modelId),
      checkpointRecommended: severity !== 'normal',
      compactionLikely: deriveContextWindowCompactionLikely(providerId, modelId, usage.usedTokens)
    };
  }

  private deriveCheckpointReminder(
    contextPressure: RunContextPressureState | null,
    queueSummary: RunProgressState['queueSummary']
  ): RunProgressState['checkpointReminder'] {
    if (!contextPressure || !contextPressure.checkpointRecommended) {
      return null;
    }

    const queueHint =
      queueSummary && queueSummary.queuedCount > 0
        ? ` There ${queueSummary.queuedCount === 1 ? 'is' : 'are'} already ${queueSummary.queuedCount} queued ${queueSummary.queuedCount === 1 ? 'message' : 'messages'} behind this run.`
        : '';

    if (contextPressure.severity === 'danger') {
      return {
        kind: 'context_pressure',
        title: 'Checkpoint strongly recommended',
        message: `This thread is close to compaction or continuity loss. Capture the working contract in a durable note before another heavy turn.${queueHint}`
      };
    }

    return {
      kind: 'context_pressure',
      title: 'Checkpoint recommended',
      message: `Context pressure is building. Preserve the durable memory or queue a steer before another long follow-up.${queueHint}`
    };
  }

  private deriveProgressEnhancements(
    progress: RunProgressState,
    thread: ThreadDetail,
    providerId: ProviderId,
    modelId: string
  ): RunProgressState | null {
    const contextPressure = this.deriveContextPressureState(thread, progress.runId, providerId, modelId);
    const queueSummary = this.deriveQueueSummary(thread);
    const checkpointReminder = this.deriveCheckpointReminder(contextPressure, queueSummary);
    const next: RunProgressState = {
      ...progress,
      contextPressure,
      checkpointReminder,
      queueSummary
    };

    return JSON.stringify(next) === JSON.stringify(progress)
      ? null
      : {
          ...next,
          updatedAt: new Date().toISOString()
        };
  }

  private refreshDerivedRunProgress(threadId: string, runId: string, providerId: ProviderId, modelId: string) {
    const progress = this.runProgressByRun.get(runId);
    if (!progress) {
      return;
    }

    const thread = this.db.getThread(threadId);
    const next = this.deriveProgressEnhancements(progress, thread, providerId, modelId);
    if (next) {
      this.publishRunProgress(next);
    }
  }
}
