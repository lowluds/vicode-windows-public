import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  AgentExecutionConstraints,
  RunToolApprovalDecision,
  ExecutionPermission,
  ImageAttachment,
  PlannerQuestion,
  PlannerQuestionAnswer,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy,
  ProviderAccount,
  RunActivityInfo,
  RunProgressState,
  ProviderContextWindowUsage,
  ProviderAuthMode,
  ProviderAuthState,
  ProviderId,
  ProviderModel,
  ProviderQuotaStatus,
  ProviderPlannerPolicy,
  ProviderReasoningEffort,
  OllamaTransportMode,
  SkillAttachMode,
  SkillKind,
  TextAttachment
} from '../shared/domain';
import type { AgentToolCall, AgentToolExecutionResult } from './agent-runtime';

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

export interface ProviderRunContext {
  threadId: string;
  runId: string;
  prompt: string;
  sourcePrompt?: string;
  imageAttachments?: ImageAttachment[];
  textAttachments?: TextAttachment[];
  modelId: string;
  reasoningEffort?: ProviderReasoningEffort | null;
  thinkingEnabled?: boolean;
  executionConstraints?: AgentExecutionConstraints | null;
  resumeSessionId?: string | null;
  folderPath: string | null;
  trusted: boolean;
  apiKey: string | null;
  runMode: ProviderRunMode;
  executionPermission: ExecutionPermission;
  runtimeCommandPolicy?: ProjectRuntimeCommandPolicy;
  runtimeNetworkPolicy?: ProjectRuntimeNetworkPolicy;
  ollamaTransportMode?: OllamaTransportMode;
  runtimeSkillResources?: Array<{
    kind: SkillKind;
    path: string;
  }>;
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
      planner?: ProviderPlannerSignal | null;
      session?: ProviderExecutionSessionSignal | null;
      contextWindow?: ProviderContextWindowUsage | null;
      providerDiagnostics?: ProviderDiagnosticsPayload | null;
    };

export interface ProviderRunCallbacks {
  onStart: () => void;
  onDelta: (delta: string) => void;
  onAssistantSnapshot?: (snapshot: string) => void;
  onInfo: (payload: ProviderInfoPayload) => void;
  requestToolApproval?: (request: {
    toolName: string;
    command: string;
    cwd: string | null;
    workspaceRoot: string;
  }) => Promise<RunToolApprovalDecision>;
  invokeRuntimeTool?: (call: AgentToolCall) => Promise<AgentToolExecutionResult>;
  onComplete: (output: string) => void;
  onError: (message: string) => void;
  onAbort: (message?: string) => void;
}

export interface ProviderInstallStatus {
  installed: boolean;
  cliPath: string | null;
}

export interface DiscoveredNativeSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  path: string;
  providerTargets: ProviderId[];
  attachMode: SkillAttachMode;
  kind: SkillKind;
  metadata?: Record<string, unknown>;
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
  getQuotaStatus?(input: {
    account: ProviderAccount | null;
    authMode: ProviderAuthMode | null;
    cliPath: string | null;
    apiKey: string | null;
    modelId?: string | null;
  }): Promise<ProviderQuotaStatus | null>;
  startAuth(mode?: ProviderAuthMode, cliPath?: string | null): Promise<void>;
  clearAuth(): Promise<void>;
  discoverNativeSkills(): Promise<DiscoveredNativeSkill[]>;
  validateProjectContext(folderPath: string | null, trusted: boolean): { valid: boolean; message?: string };
  startRun(context: ProviderRunContext, callbacks: ProviderRunCallbacks): Promise<ProviderRunHandle>;
  replyPlannerQuestions?(context: ProviderPlannerAnswerContext): Promise<void>;
}
