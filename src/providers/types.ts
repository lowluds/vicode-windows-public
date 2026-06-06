import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  AgentExecutionConstraints,
  RunToolApprovalDecision,
  RunToolApprovalRequestInput,
  ExecutionPermission,
  ImageAttachment,
  PlannerQuestion,
  PlannerQuestionAnswer,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy,
  ProviderAccount,
  RunActivityInfo,
  RunEventPayloadKind,
  RunProgressState,
  ProviderContextWindowUsage,
  ProviderAuthMode,
  ProviderAuthState,
  ProviderId,
  ProviderModel,
  ProviderPlannerPolicy,
  ProviderReasoningEffort,
  RunCheckpointReminder,
  RunContextPressureState,
  OllamaTransportMode,
  SkillKind,
  TextAttachment
} from '../shared/domain';
import type { HarnessTaskContract } from '../shared/harness-task-contract';
import type { ResolvedConversationTaskPacket } from '../shared/conversation-task-resolver';
import type { VerificationArtifact, VerificationPlan } from '../shared/harness-verification';
import type {
  AgentToolCall,
  AgentToolExecutionResult,
  StagedWorkspaceChangeSet
} from './agent-runtime';
import type { ModelSamplingProfile } from './model-sampling-profile';

export type ProviderRunMode = 'default' | 'plan';

export type ProviderPlannerSignal =
  | {
      kind: 'session';
      sessionId: string;
    }
  | {
      kind: 'questions';
      sessionId?: string | null;
      callId: string;
      questions: PlannerQuestion[];
    };

export interface ProviderExecutionSessionSignal {
  kind: 'execution';
  providerId: ProviderId;
  sessionId: string;
}

export type HarnessHookStage =
  | 'before_model'
  | 'after_model'
  | 'before_tool'
  | 'after_tool'
  | 'on_tool_error'
  | 'after_mutation'
  | 'before_verification'
  | 'after_verification'
  | 'before_finalize'
  | 'context_pressure'
  | 'continuation';

export interface HarnessHookEvidence {
  runId: string;
  stage: HarnessHookStage;
  sequence: number;
  at: string;
  turnIndex: number | null;
  toolName: string | null;
  summary: string | null;
  isError: boolean | null;
  mutatesWorkspace: boolean | null;
  verificationCommand: string | null;
  verificationStatus: VerificationArtifact['status'] | null;
  contextPressureSeverity: RunContextPressureState['severity'] | null;
  contextPressureUsagePercent: number | null;
  contextPressureUsedTokens: number | null;
  contextPressureMaxTokens: number | null;
  contextPressureSource: RunContextPressureState['source'] | null;
  contextPressureSourceLabel: string | null;
  contextPressureCheckpointRecommended: boolean | null;
  contextPressureCompactionLikely: boolean | null;
  checkpointReminderKind: RunCheckpointReminder['kind'] | null;
  checkpointReminderTitle: string | null;
  checkpointReminderSummary: string | null;
  continuationReason:
    | 'required_web_research'
    | 'required_mutation'
    | 'required_post_mutation_verification'
    | 'missing_static_web_page_files'
    | 'missing_web_image_artifact'
    | null;
  continuationReminderCount: number | null;
  continuationMaxReminderCount: number | null;
}

export interface HarnessFinalEvidenceSummary {
  runId: string;
  usedMutatingTool: boolean;
  usedFileContentMutationTool: boolean;
  usedNativeWebResearchTool: boolean;
  postMutationVerificationRequired: boolean;
  postMutationVerificationPassed: boolean;
  verificationCommand: string | null;
  verificationStatus: VerificationArtifact['status'] | null;
  createdDirectoriesCount: number;
  writtenFilesCount: number;
  toolCallCount: number;
  reminderCount: number;
}

export interface ProviderDiagnosticsPayload {
  kind: 'provider_event_classification';
  source: 'codex_app_server' | 'codex_cli_json' | 'gemini_cli_json' | 'ollama_chat_json';
  providerEventType: string;
  itemType: string | null;
  itemKeys: string[];
  paths?: string[] | null;
  decision?: string | null;
  status?: string | null;
  taskLike: boolean;
  classification:
    | 'task_candidate_unparsed'
    | 'evidence_candidate_unparsed'
    | 'approval_candidate_unparsed'
    | 'unclassified';
}

export interface NormalizedModelToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ProviderModelToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string | null;
    parameters?: Record<string, unknown> | null;
  };
}

export type ProviderModelTurnRole = 'user' | 'assistant' | 'tool' | 'system';

export interface ProviderModelTurnMessage {
  role: ProviderModelTurnRole;
  content: string;
  toolName?: string | null;
}

export interface ProviderModelTurnAttachments {
  imageAttachments?: ImageAttachment[];
  textAttachments?: TextAttachment[];
}

export interface ProviderModelPromptMessage extends ProviderModelTurnMessage {}

export interface ProviderModelContextSection {
  id: string;
  title: string;
  content: string;
  placement: 'system' | 'user';
}

export interface ProviderModelToolPayload {
  definitions: ProviderModelToolDefinition[];
}

export interface ProviderModelPromptPayload {
  systemInstructions: string;
  input: ProviderModelPromptMessage[];
  contextSections?: ProviderModelContextSection[];
  tools: ProviderModelToolPayload;
  attachments?: ProviderModelTurnAttachments;
}

export interface ProviderModelTurnPreparedInput {
  modelId: string;
  prompt: ProviderModelPromptPayload;
  signal: AbortSignal;
  samplingProfile?: ModelSamplingProfile | null;
  thinkingEnabled?: boolean;
}

export interface ProviderModelTurnRequest {
  modelId: string;
  systemInstructions: string;
  input: ProviderModelTurnMessage[];
  tools: ProviderModelToolDefinition[];
  attachments?: ProviderModelTurnAttachments;
  signal: AbortSignal;
  samplingProfile?: ModelSamplingProfile | null;
  thinkingEnabled?: boolean;
}

export interface ProviderModelToolCallContractViolation {
  providerId?: string;
  reason: string;
  candidateToolName: string | null;
  recoverable: boolean;
}

export interface ProviderModelTurnResult {
  text: string;
  toolCalls: NormalizedModelToolCall[];
  toolCallContractViolation?: ProviderModelToolCallContractViolation | null;
  contextWindowUsage?: ProviderContextWindowUsage | null;
  providerDiagnostics?: ProviderDiagnosticsPayload | null;
  infoMessages?: ProviderInfoPayload[];
  terminalState?: 'completed' | 'error';
  errorMessage?: string | null;
  rawPayload?: unknown;
}

export interface ProviderModelTransport {
  sendTurn(request: ProviderModelTurnRequest): Promise<ProviderModelTurnResult>;
}

export function buildProviderModelTurnRequest(input: ProviderModelTurnPreparedInput): ProviderModelTurnRequest {
  return {
    modelId: input.modelId,
    systemInstructions: input.prompt.systemInstructions,
    input: input.prompt.input.map((message) => ({
      ...message
    })),
    tools: input.prompt.tools.definitions.map((definition) => ({
      ...definition,
      function: {
        ...definition.function
      }
    })),
    attachments: input.prompt.attachments,
    signal: input.signal,
    samplingProfile: input.samplingProfile ?? null,
    thinkingEnabled: input.thinkingEnabled
  };
}

export interface ProviderRunContext {
  threadId: string;
  runId: string;
  prompt: string;
  sourcePrompt?: string;
  imageAttachments?: ImageAttachment[];
  textAttachments?: TextAttachment[];
  modelId: string;
  customProviderId?: string | null;
  reasoningEffort?: ProviderReasoningEffort | null;
  thinkingEnabled?: boolean;
  executionConstraints?: AgentExecutionConstraints | null;
  resumeSessionId?: string | null;
  folderPath: string | null;
  sourceWorkspaceRoot?: string | null;
  runtimeWorkspaceRoot?: string | null;
  trusted: boolean;
  apiKey: string | null;
  runMode: ProviderRunMode;
  executionPermission: ExecutionPermission;
  runtimeCommandPolicy?: ProjectRuntimeCommandPolicy;
  runtimeNetworkPolicy?: ProjectRuntimeNetworkPolicy;
  harnessTaskContract?: HarnessTaskContract | null;
  resolvedTaskPacket?: ResolvedConversationTaskPacket | null;
  verificationPlan?: VerificationPlan | null;
  harnessWorktreeSession?: ProviderHarnessWorktreeSession | null;
  contextPressure?: RunContextPressureState | null;
  checkpointReminder?: RunCheckpointReminder | null;
  ollamaTransportMode?: OllamaTransportMode;
  runtimeSkillResources?: Array<{
    kind: SkillKind;
    path: string;
  }>;
  skipFinalAnswerRewrite?: boolean;
}

export interface ProviderHarnessWorktreeSession {
  threadId: string;
  runId: string;
  projectId: string;
  sourceRepoRoot: string;
  sourceWorkspaceRoot: string;
  sourceWorkspaceRelativePath: string;
  worktreeRepoRoot: string;
  worktreeWorkspaceRoot: string;
  branchName: string;
  baseRef: 'HEAD';
  baseSha: string;
  status: string;
  cleanupPolicy: string;
  reviewStatus: string;
  createdAt: string;
  updatedAt: string;
  errorReason: string | null;
}

export interface ProviderPlannerAnswerContext {
  threadId: string;
  runId: string;
  callId: string;
  sessionId?: string | null;
  answers: Record<string, PlannerQuestionAnswer>;
}

export interface ProviderRunHandle {
  runId: string;
  child?: ChildProcessWithoutNullStreams;
  cancel: (reason?: string) => Promise<void>;
}

export type ProviderInfoPayload =
  | string
  | {
      message?: string | null;
      activity?: RunActivityInfo | null;
      progress?: RunProgressState | null;
      stagedWorkspaceChangeSet?: StagedWorkspaceChangeSet | null;
      verificationArtifact?: VerificationArtifact | null;
      harnessHookEvidence?: HarnessHookEvidence | null;
      finalEvidenceSummary?: HarnessFinalEvidenceSummary | null;
      planner?: ProviderPlannerSignal | null;
      session?: ProviderExecutionSessionSignal | null;
      contextWindow?: ProviderContextWindowUsage | null;
      providerDiagnostics?: ProviderDiagnosticsPayload | null;
      eventKind?: RunEventPayloadKind | null;
      transcriptVisible?: boolean | null;
    };

export interface ProviderRunCallbacks {
  onStart: () => void;
  onDelta: (delta: string) => void;
  onAssistantSnapshot?: (snapshot: string) => void;
  onInfo: (payload: ProviderInfoPayload) => void;
  requestToolApproval?: (
    request: Omit<RunToolApprovalRequestInput, 'threadId' | 'runId' | 'providerId'>
  ) => Promise<RunToolApprovalDecision>;
  invokeRuntimeTool?: (call: AgentToolCall) => Promise<AgentToolExecutionResult>;
  onComplete: (output: string) => void;
  onError: (message: string) => void;
  onAbort: (message?: string) => void;
}

export interface ProviderInstallStatus {
  installed: boolean;
  cliPath: string | null;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly label: string;
  listStaticModels(): ProviderModel[];
  getPlannerCapability(): ProviderPlannerPolicy;
  discoverApiModels(input: {
    account: ProviderAccount | null;
    authMode: ProviderAuthMode | null;
    apiKey: string | null;
    cliPath: string | null;
  }): Promise<ProviderModel[] | null>;
  discoverRuntimeModels(input: {
    account: ProviderAccount | null;
    authMode: ProviderAuthMode | null;
    cliPath: string | null;
  }): Promise<ProviderModel[] | null>;
  detectInstall(): Promise<ProviderInstallStatus>;
  getAuthState(account: ProviderAccount | null): Promise<{ authState: ProviderAuthState; authMode: ProviderAuthMode | null; message?: string }>;
  startAuth(mode?: ProviderAuthMode, cliPath?: string | null): Promise<void>;
  clearAuth(): Promise<void>;
  validateProjectContext(folderPath: string | null, trusted: boolean): { valid: boolean; message?: string };
  startRun(context: ProviderRunContext, callbacks: ProviderRunCallbacks): Promise<ProviderRunHandle>;
  replyPlannerQuestions?(context: ProviderPlannerAnswerContext): Promise<void>;
}
