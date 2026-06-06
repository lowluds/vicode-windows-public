import { randomUUID } from 'node:crypto';
import type {
  AgentToolCall,
  AgentToolExecutionResult
} from '../../providers/agent-runtime';
import type {
  ProviderAdapter,
  ProviderInfoPayload,
  ProviderPlannerAnswerContext,
  ProviderPlannerSignal,
  ProviderRunHandle
} from '../../providers/types';
import {
  buildEffectivePrompt
} from './provider-manager-prompt-builder';
import {
  findLatestPlannerSessionId,
  resolvePlannerResumeSessionId
} from './provider-manager-continuity';
import { createProviderReplyAssembly } from './provider-reply-assembly';
import {
  resolveProviderCompletionOutput
} from './provider-completion-output';
import {
  normalizeProviderInfoEvent,
  type NormalizedProviderInfoEvent
} from './provider-run-event-normalizer';
import { buildProviderCompatibilityDispatchTraceDetail } from './provider-compatibility-dispatch-policy';
import { deriveStructuredPlannerPlan } from './planner-parser';
import {
  decodeOllamaModelId,
  providerCapabilities,
  providerDisplayName,
  resolveOllamaApiKeyForModel
} from '../../shared/providers';
import type {
  ComposerMode,
  ComposerSubmitInput,
  ExecutionPermission,
  PlannerAnswerInput,
  PlannerCancelInput,
  PlannerQuestionAnswer,
  PlannerQuestionSet,
  PlannerSetModeInput,
  PlannerSubmitInput,
  ProviderId,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy,
  RunProgressState,
  ThreadDetail
} from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import { DatabaseService } from '../../storage/database';
import { ThreadProjectionService } from './thread-projection-service';
import type { WorkspaceContextResult } from './workspace-context';
import type { VicodeGuidanceContext } from './vicode-guidance';

type DelegationPhase = NonNullable<RunProgressState['delegation']>['phase'];

type PlannerRuntimeToolInput = {
  call: AgentToolCall;
  workspaceRoot: string;
  trustedWorkspace: boolean;
  threadId: string;
  runId: string;
  providerId: ProviderId;
  executionPermission: ExecutionPermission;
  executionConstraints: PlannerSubmitInput['executionConstraints'];
  runtimeCommandPolicy: ProjectRuntimeCommandPolicy;
  runtimeNetworkPolicy: ProjectRuntimeNetworkPolicy;
  onInfo: (payload: {
    message?: string | null;
    activity?: import('../../shared/domain').RunActivityInfo | null;
  }) => void;
};

type PlannerSessionServiceOptions = {
  db: DatabaseService;
  adapters: Record<ProviderId, ProviderAdapter>;
  threadProjection: ThreadProjectionService;
  isDisposed: () => boolean;
  emit: (event: AppEvent) => void;
  assertProviderRunPermission: (providerId: ProviderId, executionPermission: PlannerSubmitInput['executionPermission']) => void;
  assertProviderProjectContext: (providerId: ProviderId, folderPath: string | null, trusted: boolean) => void;
  assembleWorkspaceContext: (
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
  ) => WorkspaceContextResult;
  resolveVicodeGuidance: (input: {
    prompt: string;
    selectedSkillIds: string[];
  }) => VicodeGuidanceContext | null;
  resolveExecutionModelId: (
    providerId: ProviderId,
    requestedModelId: string,
    imageAttachments: readonly PlannerSubmitInput['imageAttachments']
  ) => Promise<string>;
  decryptApiKey: (encrypted: string) => string;
  resolveOllamaTransportMode: (providerId: ProviderId) => 'local' | 'cloud';
  executeProviderRuntimeToolCall: (input: PlannerRuntimeToolInput) => Promise<AgentToolExecutionResult>;
  collectRunDeltaText: (threadId: string, runId: string) => string;
  collectAssistantText: (threadId: string, runId: string) => string;
  recordInfoEvent: (
    threadId: string,
    runId: string,
    normalizedInfo: NormalizedProviderInfoEvent
  ) => ReturnType<DatabaseService['addRunEvent']> | null;
  recordRuntimeTraceMark: (
    threadId: string,
    runId: string,
    stage: string,
    payload?: Record<string, unknown> | null
  ) => void;
  recordNativePlannerCloseout: (
    threadId: string,
    runId: string,
    providerId: ProviderId,
    summary: string,
    text?: string | null
  ) => void;
  setPlannerRunId: (threadId: string, runId: string) => void;
  getPlannerRunId: (threadId: string) => string | null;
  clearPlannerRunId: (threadId: string, runId: string) => void;
  clearNativePlannerRunState: (threadId: string, runId: string) => void;
  registerRunningHandle: (runId: string, handle: ProviderRunHandle) => void;
  updateNativePlannerRunProgress: (
    threadId: string,
    runId: string,
    providerId: ProviderId,
    phase: DelegationPhase
  ) => void;
  publishPlannerRunProgress: (
    runId: string,
    threadId: string,
    providerId: ProviderId,
    phase: DelegationPhase
  ) => void;
  stopRun: (runId: string) => Promise<void>;
  readTurnSkillIds: (metadata: Record<string, unknown> | null) => string[];
};

export class ProviderPlannerSessionService {
  constructor(private readonly options: PlannerSessionServiceOptions) {}

  async setPlannerMode(input: PlannerSetModeInput): Promise<ThreadDetail> {
    this.options.db.getThread(input.threadId);
    const planner = this.updatePlannerMode(input.threadId, input.mode);
    const thread = this.options.threadProjection.getThreadDetail(input.threadId);
    this.options.threadProjection.emitThreadDetail(input.threadId);
    this.options.emit({ type: 'planner.modeChanged', threadId: input.threadId, planner });
    return thread;
  }

  async submitPlanner(input: PlannerSubmitInput): Promise<{ thread: ThreadDetail; runId: string }> {
    const project = this.options.db.getProject(input.projectId);
    const adapter = this.options.adapters[input.providerId];
    this.options.assertProviderProjectContext(input.providerId, project.folderPath, project.trusted);

    const capability = adapter.getPlannerCapability();
    if (!capability.supported) {
      throw new Error(capability.message ?? `${adapter.label} does not support planner runs yet.`);
    }

    const thread = input.threadId
      ? this.options.db.getThread(input.threadId)
      : this.options.db.createThread({
          projectId: input.projectId,
          providerId: input.providerId,
          modelId: input.modelId,
          executionPermission: input.executionPermission
        });
    const nextThread =
      thread.executionPermission === input.executionPermission
        ? thread
        : this.options.db.setThreadExecutionPermission(thread.id, input.executionPermission);

    this.updatePlannerMode(nextThread.id, 'plan');
    const plannerContext = this.options.assembleWorkspaceContext(
      input,
      nextThread,
      project.folderPath,
      project.trusted,
      {
        includeRuntimeSkills: providerCapabilities(input.providerId).supportsRuntimeSkillResources
      }
    );
    const promptTurn = this.options.db.appendTurn(nextThread.id, 'user', input.prompt, {
      skillIds: plannerContext.selectedSkillIds,
      imageAttachments: input.imageAttachments ?? [],
      textAttachments: input.textAttachments ?? [],
      composerMode: 'plan',
      plannerPhase: 'request',
      executionPermission: input.executionPermission
    });
    this.options.db.clearPendingPlannerQuestions(nextThread.id);
    this.options.db.setThreadPlannerTurnState(nextThread.id, 'generating_plan');
    this.options.db.updateThreadStatus(nextThread.id, 'queued');
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
    const thread = this.options.db.getThread(input.threadId);
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

    this.options.db.answerPlannerQuestionSet(thread.id, input.callId, input.answers);
    this.options.db.clearPendingPlannerQuestions(thread.id);
    this.options.db.setThreadPlannerTurnState(thread.id, 'generating_plan');

    const adapter = this.options.adapters[thread.providerId];
    const plannerRunId = this.options.getPlannerRunId(thread.id);
    const sessionId = findLatestPlannerSessionId(thread);
    if (adapter.replyPlannerQuestions && plannerRunId) {
      this.options.db.updateThreadStatus(thread.id, 'running');
      this.options.updateNativePlannerRunProgress(thread.id, plannerRunId, thread.providerId, 'resuming');
      const context: ProviderPlannerAnswerContext = {
        threadId: thread.id,
        runId: plannerRunId,
        callId: input.callId,
        sessionId,
        answers: input.answers
      };
      await adapter.replyPlannerQuestions(context);
      const detail = this.options.threadProjection.getThreadDetail(thread.id);
      this.options.threadProjection.emitThread(thread.id);
      return { thread: detail, runId: plannerRunId };
    }

    const answerPrompt = this.formatNativePlannerAnswers(questionSet, input.answers);
    const answerTurn = this.options.db.appendTurn(thread.id, 'user', answerPrompt, {
      composerMode: 'plan',
      plannerPhase: 'answer',
      plannerCallId: input.callId,
      plannerAnswers: input.answers
    });

    this.options.db.updateThreadStatus(thread.id, 'queued');

    return this.startNativePlannerRun({
      input: {
        projectId: thread.projectId,
        threadId: thread.id,
        prompt: answerPrompt,
        providerId: thread.providerId,
        modelId: thread.modelId,
        executionPermission: thread.executionPermission,
        skillIds: this.options.readTurnSkillIds(promptTurn.metadata)
      },
      threadId: thread.id,
      promptTurnId: answerTurn.id,
      project: this.options.db.getProject(thread.projectId),
      prompt: answerPrompt,
      resumeSessionId: resolvePlannerResumeSessionId(thread.providerId, thread)
    });
  }

  async cancelPlannerSession(input: PlannerCancelInput): Promise<ThreadDetail> {
    const thread = this.options.db.getThread(input.threadId);
    const plannerRunId = this.options.getPlannerRunId(thread.id);

    if (plannerRunId) {
      await this.options.stopRun(plannerRunId);
      this.options.clearPlannerRunId(thread.id, plannerRunId);
    }

    const planner = this.options.db.clearThreadPlannerSession(thread.id);
    const detail = this.options.threadProjection.getThreadDetail(thread.id);
    this.options.threadProjection.emitThread(thread.id);
    this.options.emit({ type: 'planner.modeChanged', threadId: thread.id, planner });
    return detail;
  }

  private async startNativePlannerRun(input: {
    input: PlannerSubmitInput;
    threadId: string;
    promptTurnId: string;
    project: ReturnType<DatabaseService['getProject']>;
    prompt: string;
    resumeSessionId?: string | null;
  }): Promise<{ thread: ThreadDetail; runId: string }> {
    const adapter = this.options.adapters[input.input.providerId];
    const runId = randomUUID();
    const account = this.options.db.getProviderAccount(input.input.providerId);
    const auth = await adapter.getAuthState(account);
    const providerApiKey =
      auth.authMode === 'api_key' && account?.encryptedApiKey
        ? this.options.decryptApiKey(account.encryptedApiKey)
        : null;
    const resolvedModelId = await this.options.resolveExecutionModelId(
      input.input.providerId,
      input.input.modelId,
      input.input.imageAttachments ?? []
    );
    const modelId = input.input.providerId === 'ollama' ? decodeOllamaModelId(resolvedModelId) : resolvedModelId;
    const apiKey =
      input.input.providerId === 'ollama'
        ? resolveOllamaApiKeyForModel(resolvedModelId, providerApiKey)
        : providerApiKey;
    let questionCallId: string | null = null;
    const workspaceContext = this.options.assembleWorkspaceContext(
      input.input,
      this.options.db.getThread(input.threadId),
      input.project.folderPath,
      input.project.trusted,
      {
        includeRuntimeSkills: providerCapabilities(input.input.providerId).supportsRuntimeSkillResources,
        contextProfile: 'delegated',
        includeMemory: false,
        includeGeneratedMemory: false
      }
    );
    const effectivePrompt = buildEffectivePrompt(
      {
        providerId: input.input.providerId,
        prompt: input.prompt
      },
      workspaceContext,
      {
        vicodeGuidance: this.options.resolveVicodeGuidance({
          prompt: input.prompt,
          selectedSkillIds: workspaceContext.selectedSkillIds
        })
      }
    );
    this.options.assertProviderRunPermission(input.input.providerId, input.input.executionPermission);
    this.options.assertProviderProjectContext(input.input.providerId, input.project.folderPath, input.project.trusted);

    let run: ProviderRunHandle;
    try {
      const handleProviderInfo = (payload: ProviderInfoPayload) => {
        if (this.options.isDisposed()) {
          return;
        }

        const normalizedInfo = normalizeProviderInfoEvent(input.input.providerId, payload);
        const event = this.options.recordInfoEvent(input.threadId, runId, normalizedInfo);
        if (event) {
          this.options.emit({ type: 'raw.event', event });
        }

        if (normalizedInfo.message) {
          this.options.emit({
            type: 'run.status',
            threadId: input.threadId,
            runId,
            status: 'info',
            message: normalizedInfo.message
          });
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
        readCurrentText: () => this.options.collectRunDeltaText(input.threadId, runId),
        persistDelta: (delta) => {
          this.options.db.addRunEvent(input.threadId, runId, 'delta', { delta });
        }
      });
      this.options.recordRuntimeTraceMark(
        input.threadId,
        runId,
        'provider_model_compatibility_dispatch_started',
        buildProviderCompatibilityDispatchTraceDetail({
          providerId: input.input.providerId,
          runMode: 'plan'
        })
      );
      run = await adapter.startRun(
        {
          threadId: input.threadId,
          runId,
          prompt: effectivePrompt,
          imageAttachments: input.input.imageAttachments ?? [],
          textAttachments: input.input.textAttachments ?? [],
          modelId,
          reasoningEffort: input.input.reasoningEffort ?? null,
          thinkingEnabled: providerCapabilities(input.input.providerId).supportsThinkingToggle
            ? input.input.thinkingEnabled ?? false
            : undefined,
          executionConstraints: input.input.executionConstraints ?? null,
          resumeSessionId: input.resumeSessionId ?? null,
          folderPath: input.project.folderPath,
          trusted: input.project.trusted,
          apiKey,
          runMode: 'plan',
          executionPermission: input.input.executionPermission,
          runtimeCommandPolicy: input.project.runtimeCommandPolicy,
          runtimeNetworkPolicy: input.project.runtimeNetworkPolicy,
          ollamaTransportMode: this.options.resolveOllamaTransportMode(input.input.providerId),
          runtimeSkillResources: workspaceContext.runtimeSkillResources
        },
        {
          onStart: () => {
            if (this.options.isDisposed()) {
              return;
            }
            this.options.setPlannerRunId(input.threadId, runId);
            this.options.db.updateThreadStatus(input.threadId, 'running');
            this.options.db.addRunEvent(input.threadId, runId, 'started', {
              providerId: input.input.providerId,
              modelId,
              planner: true,
              nativePlanner: true,
              resumeSessionId: input.resumeSessionId ?? null
            });
            this.options.publishPlannerRunProgress(
              runId,
              input.threadId,
              input.input.providerId,
              input.resumeSessionId ? 'resuming' : 'active'
            );
            this.options.emit({ type: 'run.started', threadId: input.threadId, runId });
          },
          onDelta: (delta) => {
            if (this.options.isDisposed()) {
              return;
            }
            replyAssembly.handleDelta(delta);
          },
          onAssistantSnapshot: (snapshot) => {
            if (this.options.isDisposed()) {
              return;
            }
            replyAssembly.handleSnapshot(snapshot);
          },
          onInfo: handleProviderInfo,
          invokeRuntimeTool: input.project.folderPath?.trim()
            ? (call) =>
                this.options.executeProviderRuntimeToolCall({
                  call,
                  workspaceRoot: input.project.folderPath!,
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
            if (this.options.isDisposed()) {
              return;
            }

            this.options.clearNativePlannerRunState(input.threadId, runId);
            const markdown = resolveProviderCompletionOutput({
              providerId: input.input.providerId,
              output,
              streamedDeltaOutput: this.options.collectRunDeltaText(input.threadId, runId),
              assistantTurnOutput: this.options.collectAssistantText(input.threadId, runId)
            });
            this.options.db.addRunEvent(input.threadId, runId, 'completed', { output: markdown });

            if (questionCallId && !markdown) {
              this.options.db.updateThreadStatus(input.threadId, 'completed');
              this.options.recordNativePlannerCloseout(
                input.threadId,
                runId,
                input.input.providerId,
                'Delegated planner is waiting for your answers.',
                'Delegated planner paused after asking follow-up questions. Answer the planner questions to continue.'
              );
              this.options.threadProjection.emitThread(input.threadId);
              this.options.emit({ type: 'run.status', threadId: input.threadId, runId, status: 'completed' });
              return;
            }

            this.options.db.setThreadPlannerTurnState(input.threadId, 'idle');

            if (!markdown) {
              const message = 'Native planner run completed without producing planner questions or a plan.';
              this.options.db.updateThreadStatus(input.threadId, 'failed');
              this.options.db.setThreadPlannerTurnState(input.threadId, 'idle');
              this.options.recordNativePlannerCloseout(
                input.threadId,
                runId,
                input.input.providerId,
                'Delegated planner stopped without returning a plan.',
                message
              );
              this.options.emit({ type: 'planner.parseError', threadId: input.threadId, message, runId });
              this.options.emit({ type: 'run.status', threadId: input.threadId, runId, status: 'failed', message });
              return;
            }

            const assistantTurn = this.options.db.appendTurn(
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
            const plan = this.options.db.createPlannerPlan(
              input.threadId,
              assistantTurn.id,
              markdown,
              deriveStructuredPlannerPlan(markdown)
            );
            this.options.db.updateThreadStatus(input.threadId, 'completed');
            const detail = this.options.threadProjection.getThreadDetail(input.threadId);
            this.options.threadProjection.emitThread(input.threadId);
            this.options.emit({
              type: 'planner.planProposed',
              threadId: input.threadId,
              planner: detail.planner,
              plan
            });
            this.options.recordNativePlannerCloseout(
              input.threadId,
              runId,
              input.input.providerId,
              'Delegated planner proposed a plan.',
              'Delegated planner finished and returned a plan for review.'
            );
            this.options.emit({ type: 'run.status', threadId: input.threadId, runId, status: 'completed' });
          },
          onError: (message) => {
            if (this.options.isDisposed()) {
              return;
            }
            this.options.clearNativePlannerRunState(input.threadId, runId);
            this.options.db.addRunEvent(input.threadId, runId, 'failed', { message });
            this.options.db.clearPendingPlannerQuestions(input.threadId);
            this.options.db.setThreadPlannerTurnState(input.threadId, 'idle');
            this.options.db.updateThreadStatus(input.threadId, 'failed');
            this.options.recordNativePlannerCloseout(
              input.threadId,
              runId,
              input.input.providerId,
              'Delegated planner failed.',
              message
            );
            this.options.threadProjection.emitThreadSummary(input.threadId);
            this.options.emit({ type: 'run.status', threadId: input.threadId, runId, status: 'failed', message });
          },
          onAbort: (message) => {
            if (this.options.isDisposed()) {
              return;
            }
            this.options.clearNativePlannerRunState(input.threadId, runId);
            this.options.db.addRunEvent(input.threadId, runId, 'aborted', message ? { message } : {});
            this.options.db.clearPendingPlannerQuestions(input.threadId);
            this.options.db.setThreadPlannerTurnState(input.threadId, 'idle');
            this.options.db.updateThreadStatus(input.threadId, 'aborted');
            this.options.recordNativePlannerCloseout(
              input.threadId,
              runId,
              input.input.providerId,
              'Delegated planner stopped.',
              message ?? 'Delegated planner stopped before proposing a plan.'
            );
            this.options.threadProjection.emitThreadSummary(input.threadId);
            this.options.emit({ type: 'run.status', threadId: input.threadId, runId, status: 'aborted', message });
          }
        }
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : `Failed to start ${providerDisplayName(input.input.providerId)} planner run.`;
      this.options.clearNativePlannerRunState(input.threadId, runId);
      this.options.db.addRunEvent(input.threadId, runId, 'failed', { message });
      this.options.db.clearPendingPlannerQuestions(input.threadId);
      this.options.db.setThreadPlannerTurnState(input.threadId, 'idle');
      this.options.db.updateThreadStatus(input.threadId, 'failed');
      this.options.recordNativePlannerCloseout(
        input.threadId,
        runId,
        input.input.providerId,
        'Delegated planner failed to start.',
        message
      );
      this.options.threadProjection.emitThreadSummary(input.threadId);
      this.options.emit({ type: 'run.status', threadId: input.threadId, runId, status: 'failed', message });
      return { thread: this.options.db.getThread(input.threadId), runId };
    }

    this.options.registerRunningHandle(runId, run);
    const detail = this.options.threadProjection.getThreadDetail(input.threadId);
    this.options.threadProjection.emitThread(input.threadId);
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

    const thread = this.options.db.getThread(threadId);
    const currentPlanner = this.options.db.getThreadPlannerState(threadId);
    if (currentPlanner.pendingQuestionCallId === signal.callId) {
      this.options.updateNativePlannerRunProgress(threadId, runId, thread.providerId, 'waiting_for_answers');
      return;
    }

    this.options.db.setThreadPlannerTurnState(threadId, 'waiting_for_answers');
    const questionSet = this.options.db.createPlannerQuestionSet(
      threadId,
      promptTurnId,
      signal.callId,
      signal.questions
    );
    this.options.recordNativePlannerCloseout(
      threadId,
      runId,
      thread.providerId,
      'Delegated planner is waiting for your answers.',
      'Delegated planner paused after asking follow-up questions. Answer the planner questions to continue.'
    );
    const detail = this.options.db.getThread(threadId);
    this.options.updateNativePlannerRunProgress(threadId, runId, detail.providerId, 'waiting_for_answers');
    this.options.threadProjection.emitThread(threadId);
    this.options.emit({
      type: 'planner.questionsRequested',
      threadId,
      planner: detail.planner,
      questionSet
    });
  }

  private updatePlannerMode(threadId: string, mode: ComposerMode) {
    this.options.db.setThreadPlannerMode(threadId, mode);
    if (mode === 'default') {
      this.options.db.clearPendingPlannerQuestions(threadId);
      this.options.db.setThreadPlannerTurnState(threadId, 'idle');
    } else if (this.options.db.getThreadPlannerState(threadId).turnState === 'executing_from_plan') {
      this.options.db.setThreadPlannerTurnState(threadId, 'idle');
    }
    return this.options.db.getThreadPlannerState(threadId);
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
}
