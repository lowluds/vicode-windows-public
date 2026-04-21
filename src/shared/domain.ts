export const PROVIDER_IDS = ['openai', 'gemini', 'qwen', 'ollama', 'kimi'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ProviderAuthMode = 'cli' | 'api_key';
export type ProviderAuthState = 'connected' | 'disconnected' | 'detected' | 'checking' | 'missing_cli';
export type ProviderModelSource = 'runtime' | 'api' | 'cache' | 'fallback';
export type ProviderModelRecommendation = 'recommended' | 'fast' | 'preview';
export type ContextWindowSource = 'configured' | 'official' | 'runtime' | 'heuristic';
export type ProviderExecutionMode = 'read-only' | 'workspace-write' | 'full-access';
export type PlannerEnforcement = 'hard-enforced' | 'best-effort';
export type ProviderExecutionAuthority = 'provider_cli' | 'app_runtime';
export type ProviderApprovalAuthority = 'app' | 'provider_cli' | 'none';
export type ProviderSandboxAuthority = 'provider_cli' | 'app_runtime' | 'none';
export type SkillAttachMode = 'prompt' | 'runtime';
export type SkillKind = 'skill' | 'extension';
export type SkillCategory = 'frontend' | 'backend' | 'engineering' | 'documents' | 'design' | 'testing' | 'automation' | 'mcp' | 'templates' | 'provider';
export type ComposerMode = 'default' | 'plan';
export type ExecutionPermission = 'default' | 'full_access';
export type SubagentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type AutonomousTaskKind = 'build_lane' | 'build_ticket' | 'subagent' | 'job';
export type AutonomousTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'idle';
export type ProjectRuntimeCommandPolicy =
  | 'approval_required'
  | 'auto_approve'
  | 'disabled';
export type ProjectRuntimeNetworkPolicy = 'disabled' | 'enabled';
export type AgentPermissionMode = 'default' | 'plan' | 'bypassPermissions';
export type AgentToolPreset =
  | 'default'
  | 'planner'
  | 'build_planner'
  | 'builder'
  | 'finisher'
  | 'subagent';
export type RunToolApprovalDecision = 'approved' | 'rejected' | 'cancelled';
export type RuntimeCommandIsolationMode = 'host_isolated_temp_profile' | 'host_job_object_temp_profile';
export type AppearanceMode = 'system' | 'dark' | 'light';
export type AccentMode = 'system' | 'custom';
export type OllamaTransportMode = 'chat' | 'responses';
export type ProviderReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type AppUpdateStatus = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up_to_date' | 'error';
export type PlanTurnState = 'idle' | 'generating_questions' | 'waiting_for_answers' | 'generating_plan' | 'plan_ready' | 'executing_from_plan';
export type PlannerPlanStatus = 'draft' | 'approved' | 'superseded';
export type RunTaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'failed';
export type ThreadStatus = 'draft' | 'queued' | 'auth_required' | 'running' | 'stopping' | 'completed' | 'failed' | 'aborted' | 'archived';
export const MAX_COMPOSER_PROMPT_CHARS = 1_000_000;
export const COMPOSER_PROMPT_WARNING_CHARS = 750_000;
export const COMPOSER_TEXT_ATTACHMENT_PROMOTION_CHARS = 100_000;
export const MAX_COMPOSER_TEXT_ATTACHMENT_CHARS = 2_000_000;
export type ThreadFollowUpKind = 'follow_up' | 'steer';
export type ThreadFollowUpStatus = 'queued' | 'dispatching' | 'dispatched' | 'cancelled' | 'superseded' | 'failed';
export type FollowUpBehavior = 'queue' | 'steer';
export type ThreadTurnRole = 'system' | 'user' | 'assistant' | 'tool' | 'status';
export type SkillOrigin = 'built_in_style' | 'custom_local' | 'provider_native';
export type SkillScope = 'global' | 'project';
export type AutomationScheduleType = 'manual' | 'interval_while_app_open';
export type AutomationRunStatus = 'idle' | 'queued' | 'waiting_for_review' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
export type VicodeBuildTeamId = string;
export type VicodeBuildLaneId = 'planner' | 'builder' | 'finisher';
export type VicodeBuildTicketStatus = 'todo' | 'in_progress' | 'done' | 'blocked';
export type VicodeBuildLaneStatus =
  | 'paused'
  | 'idle'
  | 'waiting_for_review'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'unknown';
export type JobSourceType = 'automation' | 'manual' | 'review_retry' | 'future_system';
export type JobStatus = 'queued' | 'running' | 'waiting_for_review' | 'paused' | 'resumed' | 'completed' | 'failed' | 'cancelled';
export type ReviewItemKind = 'tool_approval' | 'dangerous_action' | 'resume_confirmation' | 'manual_review';
export type ReviewItemStatus = 'pending' | 'approved' | 'rejected' | 'superseded';
export type AutonomyTaskSource = 'heartbeat_file';
export type AutonomyDelegationProfile = 'heartbeat' | 'research' | 'implement' | 'verify';
export type CollabConnectionState = 'unconfigured' | 'identity_required' | 'connecting' | 'connected' | 'error';
export type CollabRoomType = 'project' | 'dm';
export type CollabRoomMemberRole = 'owner' | 'admin' | 'member';
export type CollabPresenceStatus = 'online' | 'away' | 'busy' | 'offline';
export type CollabThreadStatus = 'idle' | 'active' | 'completed' | 'failed';
export type CollabRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type CollabRequestedRole = 'contributor' | 'driver';
export type CollabRoleRequestStatus = 'pending' | 'approved' | 'declined';
export type CollabTerminalMode = 'off' | 'announce_only';
export type SettingsSection = 'general' | 'providers' | 'personalization' | 'diagnostics' | 'storage' | 'archived_threads';

export interface ProviderPlannerPolicy {
  supported: boolean;
  executionMode: ProviderExecutionMode;
  enforcement: PlannerEnforcement;
  message?: string;
}

export interface ProviderCapabilities {
  supportsThinkingToggle: boolean;
  supportsRuntimeSkillResources: boolean;
  supportsNativeRunProgress: boolean;
  executionAuthority: ProviderExecutionAuthority;
  approvalAuthority: ProviderApprovalAuthority;
  sandboxAuthority: ProviderSandboxAuthority;
  requiresTrustedWorkspace: boolean;
  requiresFullAccessForAppRuns: boolean;
  workspaceInstructionFileName: string;
}

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  authState: ProviderAuthState;
  authMode: ProviderAuthMode | null;
  installed: boolean;
  models: ProviderModel[];
  modelSource: ProviderModelSource;
  modelsUpdatedAt: string | null;
  canLiveDiscoverModels: boolean;
  cliPath: string | null;
  capabilities: ProviderCapabilities;
  plannerPolicy: ProviderPlannerPolicy;
  quota: ProviderQuotaStatus | null;
  message?: string;
}

export interface ProviderQuotaBucket {
  modelId: string;
  tokenType: string | null;
  remainingAmount: number | null;
  remainingFraction: number | null;
  limit: number | null;
  resetAt: string | null;
}

export interface ProviderQuotaStatus {
  source: 'cli' | 'provider_internal';
  fetchedAt: string;
  tierName: string | null;
  pooledRemaining: number | null;
  pooledLimit: number | null;
  pooledResetAt: string | null;
  buckets: ProviderQuotaBucket[];
  note?: string;
}

export interface ProviderModel {
  id: string;
  label: string;
  description: string;
  supportsVision?: boolean;
  recommendation?: ProviderModelRecommendation;
  contextWindowTokens?: number | null;
  autoCompactTokenLimit?: number | null;
  contextWindowSource?: ContextWindowSource;
}

export interface Project {
  id: string;
  name: string;
  folderPath: string | null;
  trusted: boolean;
  runtimeCommandPolicy: ProjectRuntimeCommandPolicy;
  runtimeNetworkPolicy: ProjectRuntimeNetworkPolicy;
  defaultProviderId: ProviderId;
  defaultModelByProvider: Record<ProviderId, string>;
  createdAt: string;
  updatedAt: string;
}

export type GeneratedMemoryCandidateKind =
  | 'workspace_convention'
  | 'workflow_preference'
  | 'known_pitfall'
  | 'environment_fact'
  | 'architecture_fact'
  | 'user_preference_workspace_scoped';

export type GeneratedMemoryCandidateStatus = 'proposed' | 'rejected' | 'consolidated' | 'expired';

export type GeneratedMemoryItemAuthority = 'derived_noncanonical';

export interface GeneratedMemoryCandidate {
  id: string;
  workspaceScopeKey: string;
  projectId: string | null;
  sourceThreadId: string;
  sourceRunId: string | null;
  sourceTurnIds: string[];
  kind: GeneratedMemoryCandidateKind;
  summary: string;
  detail: string;
  evidenceExcerpt: string;
  dedupeKey: string;
  status: GeneratedMemoryCandidateStatus;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedMemoryItem {
  id: string;
  workspaceScopeKey: string;
  projectId: string | null;
  kind: GeneratedMemoryCandidateKind;
  summary: string;
  detail: string;
  authority: GeneratedMemoryItemAuthority;
  evidenceCount: number;
  sourceCandidateIds: string[];
  sourceThreadIds: string[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  useCount: number;
  disabledAt: string | null;
}

export interface GeneratedMemoryEvidence {
  id: string;
  workspaceScopeKey: string;
  projectId: string | null;
  candidateId: string | null;
  itemId: string | null;
  sourceThreadId: string;
  sourceTurnIds: string[];
  role: ThreadTurnRole;
  excerpt: string;
  capturedAt: string;
}

export interface ThreadSummary {
  id: string;
  projectId: string;
  title: string;
  providerId: ProviderId;
  modelId: string;
  executionPermission: ExecutionPermission;
  status: ThreadStatus;
  archived: boolean;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  lastPreview: string;
}

export interface SubagentSummary {
  id: string;
  parentThreadId: string;
  parentRunId: string | null;
  childThreadId: string | null;
  childRunId: string | null;
  name: string;
  title: string;
  prompt: string;
  providerId: ProviderId;
  modelId: string;
  executionPermission: ExecutionPermission;
  delegationProfile: AutonomyDelegationProfile;
  status: SubagentStatus;
  outputSummary: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AutonomousTaskSummary {
  id: string;
  kind: AutonomousTaskKind;
  title: string;
  summary: string;
  ownerLabel: string;
  provenanceLabel: string;
  trustLabel: string | null;
  approvalLabel: string | null;
  status: AutonomousTaskStatus;
  statusLabel: string;
  threadId: string | null;
  updatedAt: string | null;
  attention: boolean;
}

export interface AutonomousTaskRecord {
  id: string;
  kind: AutonomousTaskKind;
  projectId: string;
  threadId: string | null;
  runId: string | null;
  sourceId: string;
  title: string;
  summary: string;
  ownerLabel: string;
  provenanceLabel: string;
  trustLabel: string | null;
  approvalLabel: string | null;
  status: AutonomousTaskStatus;
  statusLabel: string;
  blockedBy: string | null;
  blocking: string | null;
  lastError: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ToolConstraintPolicy {
  preset: AgentToolPreset;
  allowedToolCallNames: string[];
  disallowedToolCallNames: string[];
}

export interface AgentExecutionConstraints {
  permissionMode: AgentPermissionMode;
  toolPolicy: ToolConstraintPolicy;
  maxTurns: number | null;
  maxReasoningTokens: number | null;
  taskBudgetTokens: number | null;
  costBudgetUsd: number | null;
  maxDelegationDepth: number | null;
  maxAutomaticRetries: number | null;
  maxUnchangedHandoffs: number | null;
  maxSiblingDelegates: number | null;
}

export interface SubagentSpawnInput {
  parentThreadId: string;
  parentRunId?: string | null;
  name?: string;
  title: string;
  prompt: string;
  providerId?: ProviderId;
  modelId?: string;
  reasoningEffort?: ProviderReasoningEffort | null;
  executionPermission?: ExecutionPermission;
  delegationProfile?: AutonomyDelegationProfile;
}

export interface ThreadTurn {
  id: string;
  threadId: string;
  runId: string | null;
  role: ThreadTurnRole;
  content: string;
  sources?: ThreadSource[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ThreadSource {
  url: string;
  title: string;
  snippet: string | null;
  excerpt: string | null;
}

export interface ThreadFollowUp {
  id: string;
  threadId: string;
  content: string;
  metadata: Record<string, unknown> | null;
  kind: ThreadFollowUpKind;
  status: ThreadFollowUpStatus;
  priority: number;
  targetRunId: string | null;
  createdAt: string;
  updatedAt: string;
  dispatchedAt: string | null;
  cancelledAt: string | null;
}

export interface RunToolApprovalRequest {
  id: string;
  threadId: string;
  runId: string;
  providerId: ProviderId;
  toolName: string;
  command: string;
  cwd: string | null;
  workspaceRoot: string;
  requestedAt: string;
}

export interface ImageAttachment {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
}

export interface TextAttachment {
  id: string;
  name: string;
  mimeType: 'text/plain';
  relativePath: string;
  absolutePath: string;
  charCount: number;
}

export interface PlannerQuestionOption {
  id: string;
  label: string;
  description: string;
}

export interface PlannerQuestion {
  id: string;
  header: string;
  question: string;
  options: PlannerQuestionOption[];
  recommendedOptionId: string;
  allowOther: boolean;
}

export interface PlannerQuestionAnswer {
  answers: string[];
}

export interface PlannerQuestionSet {
  id: string;
  threadId: string;
  promptTurnId: string;
  callId: string;
  questions: PlannerQuestion[];
  answers: Record<string, PlannerQuestionAnswer> | null;
  createdAt: string;
}

export interface StructuredPlannerPlan {
  title: string;
  summary: string[];
  keyChanges: string[];
  testPlan: string[];
  assumptions: string[];
}

export interface PlannerPlan {
  id: string;
  threadId: string;
  createdTurnId: string;
  proposedPlanMarkdown: string;
  structuredPlan: StructuredPlannerPlan | null;
  status: PlannerPlanStatus;
  createdAt: string;
}

export interface ThreadPlannerState {
  threadId: string;
  composerMode: ComposerMode;
  turnState: PlanTurnState;
  activePlanId: string | null;
  pendingQuestionCallId: string | null;
  updatedAt: string;
  activePlan: PlannerPlan | null;
  pendingQuestionSet: PlannerQuestionSet | null;
}

export interface RunTaskItem {
  id: string;
  label: string;
  status: RunTaskStatus;
  order: number;
}

export interface RunDiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface RunChangePreviewLine {
  type: 'context' | 'added' | 'removed';
  oldLineNumber: number | null;
  newLineNumber: number | null;
  text: string;
}

export interface RunChangedFileArtifact {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  insertions: number;
  deletions: number;
  beforeContent: string | null;
  afterContent: string | null;
  previewLines: RunChangePreviewLine[];
  previewTruncated: boolean;
}

export interface RunChangeArtifact {
  source?: 'workspace_diff' | 'provider_reported';
  summary: RunDiffStats;
  files: RunChangedFileArtifact[];
}

export type RunRuntimeTraceStage =
  | 'submit_received'
  | 'workspace_context_started'
  | 'workspace_context_completed'
  | 'prompt_assembled'
  | 'provider_dispatch_started'
  | 'run_started'
  | 'first_delta'
  | 'first_tool_call'
  | 'first_tool_result'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'provider_dispatch_failed';

export interface RunRuntimeTraceMark {
  stage: RunRuntimeTraceStage;
  at: string;
  detail?: Record<string, unknown> | null;
}

export interface RunProgressState {
  runId: string;
  threadId: string;
  title: string | null;
  items: RunTaskItem[];
  updatedAt: string;
  diffStats: RunDiffStats | null;
  reviewAvailable: boolean;
  changeArtifact: RunChangeArtifact | null;
  delegation: RunDelegationState | null;
  contextPressure: RunContextPressureState | null;
  checkpointReminder: RunCheckpointReminder | null;
  queueSummary: RunQueueSummary | null;
}

export interface RunDelegationState {
  mode: 'planner' | 'background';
  profile: 'delegated' | AutonomyDelegationProfile;
  phase: 'active' | 'waiting_for_answers' | 'resuming';
  title: string;
  note: string;
  includedContext: string[];
  excludedContext: string[];
}

export interface AutonomyInboxItem {
  key: string;
  projectId: string;
  threadId: string | null;
  title: string;
  prompt: string;
  source: AutonomyTaskSource;
  delegationProfile: AutonomyDelegationProfile;
  sourcePath: string | null;
}

export interface RunContextPressureState {
  severity: 'normal' | 'warning' | 'danger';
  pressureLabel: string;
  note: string;
  source: 'provider' | 'estimate';
  sourceLabel: string;
  usagePercent: number;
  usedTokens: number;
  maxTokens: number;
  checkpointRecommended: boolean;
  compactionLikely: boolean;
}

export interface RunCheckpointReminder {
  kind: 'context_pressure';
  title: string;
  message: string;
}

export interface RunQueueSummary {
  queuedCount: number;
  steerCount: number;
  followUpCount: number;
  condensedQueuedCount: number;
}

export interface OllamaPullProgress {
  model: string;
  status: string;
  completed: number | null;
  total: number | null;
  digest: string | null;
  state: 'running' | 'completed' | 'failed';
}

export interface ThreadDetail extends ThreadSummary {
  turns: ThreadTurn[];
  rawOutput: RunEvent[];
  planner: ThreadPlannerState;
  followUps: ThreadFollowUp[];
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  instructions: string;
  origin: SkillOrigin;
  scope: SkillScope;
  providerTargets: ProviderId[];
  enabled: boolean;
  projectId: string | null;
  metadata: Record<string, unknown>;
  path: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillDetail {
  skillId: string;
  markdown: string;
  examplePrompt: string | null;
  iconPath: string | null;
  folderPath: string | null;
  browseUrl: string | null;
  attachMode: SkillAttachMode;
  kind: SkillKind;
}

export interface SkillInstallResult {
  status: 'completed' | 'launched';
  providerId: ProviderId | null;
  installPath: string;
  message: string;
}

export interface AutomationDefinition {
  id: string;
  name: string;
  projectId: string;
  providerId: ProviderId;
  modelId: string;
  promptTemplate: string;
  skillId: string | null;
  enabled: boolean;
  scheduleType: AutomationScheduleType;
  intervalMinutes: number | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  status: AutomationRunStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  threadId: string | null;
  status: AutomationRunStatus;
  message: string;
  createdAt: string;
}

export type VicodeBuildControllerEventKind =
  | 'manual_wake'
  | 'auto_handoff'
  | 'auto_handoff_skipped'
  | 'config_mismatch'
  | 'queue_stalled'
  | 'run_stalled'
  | 'run_completed'
  | 'run_failed'
  | 'team_paused'
  | 'team_resumed';

export interface VicodeBuildControllerEvent {
  id: string;
  projectId: string;
  teamId: VicodeBuildTeamId;
  laneId: VicodeBuildLaneId;
  kind: VicodeBuildControllerEventKind;
  trigger: 'manual' | 'automatic' | 'system';
  summary: string;
  detail: string | null;
  sourceLaneId: VicodeBuildLaneId | null;
  targetLaneId: VicodeBuildLaneId | null;
  threadId: string | null;
  runId: string | null;
  createdAt: string;
}

export interface VicodeBuildLaneSnapshot {
  laneId: VicodeBuildLaneId;
  label: string;
  automationId: string;
  status: VicodeBuildLaneStatus;
  paused: boolean;
  worktreeRoot: string;
  skillIds: string[];
  skillNames: string[];
  lastRunAt: string | null;
  nextRunAt: string | null;
  threadId: string | null;
  threadTitle: string | null;
  threadStatus: ThreadStatus | null;
  lastPreview: string | null;
  blockedReason: string | null;
  recommendedAction: string | null;
  lastWakeAt: string | null;
  lastWakeReason: string | null;
  lastHandoffAt: string | null;
  lastHandoffSummary: string | null;
  executionConstraints: AgentExecutionConstraints | null;
  recentEvents: VicodeBuildControllerEvent[];
}

export interface VicodeBuildTeamSnapshot {
  teamId: VicodeBuildTeamId;
  label: string;
  goal: string;
  worktreeRoot: string;
  lastActivityAt: string | null;
  ticketQueuePath: string | null;
  activeTicketTitle: string | null;
  activeTicketOwnerLane: VicodeBuildLaneId | null;
  ownedSliceSummary: string | null;
  openTicketCount: number;
  blockedTicketCount: number;
  ticketSummary: string | null;
  tickets: VicodeBuildTicketSnapshot[];
  heartbeatPath: string | null;
  heartbeatStatus: string | null;
  heartbeatSummary: string | null;
  heartbeatUpdatedAt: string | null;
  heartbeatOpenItems: string[];
  status: 'paused' | 'idle' | 'active' | 'attention' | 'waiting';
  lanes: VicodeBuildLaneSnapshot[];
}

export interface VicodeBuildTicketSnapshot {
  id: string;
  title: string;
  status: VicodeBuildTicketStatus;
  ownerLane: VicodeBuildLaneId;
  summary: string | null;
  dependencies: string[];
  blockedByTicketIds: string[];
  readyToClaim: boolean;
  active: boolean;
  targetPaths: string[];
  acceptanceCriteria: string[];
  verificationSteps: string[];
  refs: string[];
  stopWhen: string | null;
  ownerThreadId: string | null;
  updatedAt: string | null;
}

export interface VicodeBuildSnapshot {
  available: boolean;
  checkedAt: string;
  projectId: string | null;
  projectRoot: string | null;
  configPath: string | null;
  teams: VicodeBuildTeamSnapshot[];
  recentEvents: VicodeBuildControllerEvent[];
  note: string | null;
}

export interface VicodeBuildPlanDraft {
  controlId: string;
  name: string;
  goal: string;
  worktreePath: string;
  heartbeatPath: string;
  providerId: ProviderId;
  modelId: string;
  reasoningEffort: ProviderReasoningEffort | null;
  executionPermission: ExecutionPermission;
  lanePrompts: Record<VicodeBuildLaneId, string>;
  laneSummaries: Record<VicodeBuildLaneId, string>;
  laneSkillIds: Record<VicodeBuildLaneId, string[]>;
  laneSkillNames: Record<VicodeBuildLaneId, string[]>;
}

export interface VicodeBuildVerificationStep {
  id: string;
  teamId: VicodeBuildTeamId;
  teamLabel: string;
  label: string;
  ok: boolean;
  summary: string;
  detail: string | null;
}

export interface VicodeBuildVerificationResult {
  ok: boolean;
  checkedAt: string;
  steps: VicodeBuildVerificationStep[];
}

export interface JobDefinition {
  id: string;
  projectId: string;
  sourceType: JobSourceType;
  sourceId: string | null;
  title: string;
  status: JobStatus;
  threadId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobRun {
  id: string;
  jobId: string;
  providerId: ProviderId | null;
  modelId: string | null;
  status: JobStatus;
  runId: string | null;
  checkpoint: Record<string, unknown> | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ReviewItem {
  id: string;
  jobId: string;
  jobRunId: string | null;
  kind: ReviewItemKind;
  status: ReviewItemStatus;
  summary: string;
  details: Record<string, unknown>;
  decision: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Preferences {
  selectedProjectId: string | null;
  defaultProviderId: ProviderId;
  defaultModelByProvider: Record<ProviderId, string>;
  defaultReasoningEffortByProvider: Record<ProviderId, ProviderReasoningEffort | null>;
  defaultThinkingByProvider: Record<ProviderId, boolean>;
  ollamaTransportMode: OllamaTransportMode;
  defaultExecutionPermission: ExecutionPermission;
  followUpBehavior: FollowUpBehavior;
  generatedMemoryUseEnabled: boolean;
  generatedMemoryGenerationEnabled: boolean;
  appearanceMode: AppearanceMode;
  accentMode: AccentMode;
  accentColor: string | null;
  onboardingComplete: boolean;
  lastOpenedThreadId: string | null;
  microphoneAllowed: boolean;
}

export interface PersonalizationSettings {
  globalInstructions: string;
  providerInstructions: Record<ProviderId, string>;
  useWorkspaceInstructions: boolean;
}

export interface CollabAccount {
  email: string | null;
  userId: string | null;
  expiresAt: string | null;
}

export interface CollabRoomSession {
  roomId: string;
  userId: string;
  sessionToken: string;
  updatedAt: string;
  expiresAt: string | null;
}

export interface CollabConfig {
  supabaseUrl: string | null;
  hasAnonKey: boolean;
  connectionState: CollabConnectionState;
  lastError: string | null;
}

export interface CollabProfile {
  id: string;
  email: string | null;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  status: CollabPresenceStatus;
  bio: string | null;
  timezone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollabRoom {
  id: string;
  type: CollabRoomType;
  name: string;
  joinCode: string | null;
  slug: string | null;
  topic: string | null;
  projectLabel: string | null;
  directUserId: string | null;
  unreadCount: number;
  memberCount: number;
  lastActivityAt: string;
  lastMessagePreview: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollabRoomMember {
  roomId: string;
  userId: string;
  role: CollabRoomMemberRole;
  membershipState: 'active' | 'invited' | 'left';
  joinedAt: string | null;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  status: CollabPresenceStatus;
}

export interface CollabMessage {
  id: string;
  roomId: string;
  authorId: string;
  authorDisplayName: string;
  authorHandle: string | null;
  body: string;
  createdAt: string;
}

export interface CollabPresence {
  roomId: string;
  userId: string;
  status: CollabPresenceStatus;
  currentThreadId: string | null;
  currentThreadTitle: string | null;
  branchName: string | null;
  worktreeName: string | null;
  activeRunId: string | null;
  activeRunTitle: string | null;
  dirtyFileCount: number;
  stagedFileCount: number;
  updatedAt: string;
}

export interface CollabSharedThread {
  id: string;
  roomId: string;
  threadId: string;
  projectId: string | null;
  projectLabel: string | null;
  title: string;
  status: CollabThreadStatus;
  driverUserId: string;
  driverDisplayName: string;
  providerId: ProviderId;
  modelId: string;
  lastPromptSummary: string | null;
  latestAssistantSummary: string | null;
  runId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollabSharedRun {
  id: string;
  roomId: string;
  threadId: string;
  threadTitle: string;
  runId: string;
  driverUserId: string;
  driverDisplayName: string;
  providerId: ProviderId;
  modelId: string;
  executionPermission: ExecutionPermission;
  status: CollabRunStatus;
  taskTitle: string | null;
  summary: string | null;
  changedFiles: string[];
  diffStats: RunDiffStats | null;
  testsSummary: string | null;
  resultLabel: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CollabHandoff {
  id: string;
  roomId: string;
  threadId: string;
  runId: string | null;
  authorUserId: string;
  authorDisplayName: string;
  title: string;
  summary: string;
  branchName: string | null;
  dirtyFileCount: number;
  stagedFileCount: number;
  changedFiles: string[];
  outstandingTasks: string[];
  recommendedNextPrompt: string | null;
  createdAt: string;
}

export interface CollabRoomFollower {
  roomId: string;
  userId: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  status: CollabPresenceStatus;
  createdAt: string;
}

export interface CollabRoleRequest {
  id: string;
  roomId: string;
  requesterUserId: string;
  requesterDisplayName: string;
  requesterHandle: string | null;
  requestedRole: CollabRequestedRole;
  status: CollabRoleRequestStatus;
  resolvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollabRoomTerminalState {
  roomId: string;
  mode: CollabTerminalMode;
  enabledByUserId: string | null;
  enabledByDisplayName: string | null;
  note: string | null;
  updatedAt: string;
}

export interface CollabContact {
  userId: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  status: CollabPresenceStatus;
  lastRoomId: string | null;
  lastRoomName: string | null;
}

export interface CollabRoomDetail {
  room: CollabRoom;
  members: CollabRoomMember[];
  messages: CollabMessage[];
  presence: CollabPresence[];
  sharedThreads: CollabSharedThread[];
  sharedRuns: CollabSharedRun[];
  handoffs: CollabHandoff[];
  followers: CollabRoomFollower[];
  roleRequests: CollabRoleRequest[];
  terminalState: CollabRoomTerminalState | null;
}

export interface CollabBootstrap {
  config: CollabConfig;
  account: CollabAccount;
  profile: CollabProfile | null;
  rooms: CollabRoom[];
  roomMembersByRoom: Record<string, CollabRoomMember[]>;
  messagesByRoom: Record<string, CollabMessage[]>;
  presenceByRoom: Record<string, CollabPresence[]>;
  sharedThreadsByRoom: Record<string, CollabSharedThread[]>;
  sharedRunsByRoom: Record<string, CollabSharedRun[]>;
  handoffsByRoom: Record<string, CollabHandoff[]>;
  followersByRoom: Record<string, CollabRoomFollower[]>;
  roleRequestsByRoom: Record<string, CollabRoleRequest[]>;
  terminalStateByRoom: Record<string, CollabRoomTerminalState | null>;
  contacts: CollabContact[];
}

export type McpServerTransportType = 'stdio';
export type McpPermissionMode = 'ask' | 'allow' | 'deny';
export type McpServerConnectionStatus = 'disabled' | 'approval_required' | 'connecting' | 'connected' | 'error';
export type McpServerScope = 'global' | 'project';

export interface McpServerDefinition {
  id: string;
  name: string;
  scope: McpServerScope;
  projectId: string | null;
  transportType: McpServerTransportType;
  command: string;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
  enabled: boolean;
  toolInvocationMode: McpPermissionMode;
  launchApproved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerState {
  serverId: string;
  status: McpServerConnectionStatus;
  capabilities: Record<string, unknown> | null;
  lastSeenAt: string | null;
  lastError: string | null;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  updatedAt: string;
}

export interface McpServerRecord {
  definition: McpServerDefinition;
  state: McpServerState | null;
}

export interface McpServerView {
  id: string;
  name: string;
  scope: McpServerScope;
  projectId: string | null;
  transportType: McpServerTransportType;
  command: string;
  args: string[];
  cwd: string | null;
  enabled: boolean;
  toolInvocationMode: McpPermissionMode;
  launchApproved: boolean;
  envKeys: string[];
  createdAt: string;
  updatedAt: string;
  state: McpServerState | null;
}

export interface McpToolDescriptor {
  serverId: string;
  serverName: string;
  name: string;
  title: string | null;
  description: string | null;
  inputSchema: Record<string, unknown> | null;
  invocationMode: McpPermissionMode;
  requiresApproval: boolean;
}

export interface McpResourceDescriptor {
  serverId: string;
  serverName: string;
  uri: string;
  name: string;
  description: string | null;
  mimeType: string | null;
}

export interface McpPromptArgumentDescriptor {
  name: string;
  description: string | null;
  required: boolean;
}

export interface McpPromptDescriptor {
  serverId: string;
  serverName: string;
  name: string;
  description: string | null;
  arguments: McpPromptArgumentDescriptor[];
}

export interface McpCatalogSnapshot {
  tools: McpToolDescriptor[];
  resources: McpResourceDescriptor[];
  prompts: McpPromptDescriptor[];
  refreshedAt: string;
}

export interface AppMeta {
  version: string;
  userDataPath: string;
  statePath: string;
  exportsPath: string;
}

export interface AppUpdateState {
  enabled: boolean;
  status: AppUpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  downloadPercent: number | null;
  bytesPerSecond: number | null;
  transferredBytes: number | null;
  totalBytes: number | null;
  lastCheckedAt: string | null;
  message: string | null;
}

export interface ProviderAccount {
  providerId: ProviderId;
  authState: ProviderAuthState;
  authMode: ProviderAuthMode | null;
  encryptedApiKey: string | null;
  updatedAt: string;
}

export interface RunEvent {
  id: string;
  threadId: string;
  runId: string;
  eventType: 'started' | 'delta' | 'completed' | 'failed' | 'aborted' | 'info';
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface RunActivityInfo {
  kind: 'thinking' | 'skill' | 'memory_recall' | 'memory_checkpoint' | 'web_search' | 'delegation' | 'tool_call' | 'tool_result' | 'file_edit' | 'file_write' | 'mkdir' | 'terminal_command' | 'terminal_output' | 'file_open' | 'file_read' | 'file_search' | 'change_summary';
  phase?: 'started' | 'completed' | 'stopped';
  summary: string;
  providerEventType?: string | null;
  toolName?: string | null;
  status?: string | null;
  query?: string | null;
  command?: string | null;
  cwd?: string | null;
  isolationMode?: RuntimeCommandIsolationMode | null;
  url?: string | null;
  path?: string | null;
  text?: string | null;
  outputLines?: string[] | null;
  background?: boolean;
  changeArtifact?: RunChangeArtifact | null;
  sources?: ThreadSource[] | null;
}

export interface ProviderContextWindowUsage {
  usedTokens: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  providerEventType?: string | null;
}

export interface ComposerSubmitInput {
  projectId: string;
  threadId?: string | null;
  prompt: string;
  providerId: ProviderId;
  modelId: string;
  runMode?: 'default' | 'plan';
  reasoningEffort?: ProviderReasoningEffort | null;
  thinkingEnabled?: boolean;
  executionPermission: ExecutionPermission;
  executionConstraints?: AgentExecutionConstraints | null;
  skillIds: string[];
  imageAttachments?: ImageAttachment[];
  textAttachments?: TextAttachment[];
}

export type ComposerSubmitResult =
  | {
      disposition: 'started';
      thread: ThreadDetail;
      runId: string;
    }
  | {
      disposition: 'queued';
      thread: ThreadDetail;
      queuedFollowUp: ThreadFollowUp;
    };

export interface PlannerSubmitInput {
  projectId: string;
  threadId?: string | null;
  prompt: string;
  providerId: ProviderId;
  modelId: string;
  reasoningEffort?: ProviderReasoningEffort | null;
  thinkingEnabled?: boolean;
  executionPermission: ExecutionPermission;
  skillIds: string[];
  imageAttachments?: ImageAttachment[];
  textAttachments?: TextAttachment[];
}

export interface PlannerSetModeInput {
  threadId: string;
  mode: ComposerMode;
}

export interface PlannerAnswerInput {
  threadId: string;
  callId: string;
  answers: Record<string, PlannerQuestionAnswer>;
}

export interface PlannerApprovePlanInput {
  threadId: string;
  planId: string;
}

export interface PlannerCancelInput {
  threadId: string;
}

export interface ThreadCreateInput {
  projectId: string;
  title?: string;
  providerId: ProviderId;
  modelId: string;
  executionPermission?: ExecutionPermission;
}

export interface ThreadSetExecutionPermissionInput {
  threadId: string;
  executionPermission: ExecutionPermission;
}

export interface SkillSaveInput {
  id?: string;
  name: string;
  description: string;
  instructions: string;
  scope: SkillScope;
  providerTargets: ProviderId[];
  syncTargets?: ProviderId[];
  enabled: boolean;
  projectId?: string | null;
}

export interface AutomationSaveInput {
  id?: string;
  name: string;
  projectId: string;
  providerId: ProviderId;
  modelId: string;
  promptTemplate: string;
  skillId?: string | null;
  enabled: boolean;
  scheduleType: AutomationScheduleType;
  intervalMinutes?: number | null;
}

export interface McpServerSaveInput {
  id?: string;
  name: string;
  scope?: McpServerScope;
  projectId?: string | null;
  transportType?: McpServerTransportType;
  command: string;
  args?: string[];
  cwd?: string | null;
  env?: Record<string, string>;
  enabled: boolean;
  toolInvocationMode?: McpPermissionMode;
  launchApproved?: boolean;
}

export interface McpRecommendedSetupInput {
  entryId: string;
  projectId?: string | null;
}

export interface BootstrapData {
  projects: Project[];
  threadsByProject: Record<string, ThreadSummary[]>;
  skills: SkillDefinition[];
  automations: AutomationDefinition[];
  jobs: JobDefinition[];
  reviewItems: ReviewItem[];
  pendingRunToolApprovals: RunToolApprovalRequest[];
  providers: ProviderDescriptor[];
  preferences: Preferences;
  personalization: PersonalizationSettings;
  collaboration: CollabBootstrap;
}
