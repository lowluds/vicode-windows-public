import type { ProviderDescriptor, ProviderId, ProviderReasoningEffort, OllamaTransportMode } from './domain-provider';
import type { HarnessIsolationMode, RunEvent, RunToolApprovalRequest } from './domain-run-review';

export type SkillAttachMode = 'prompt' | 'runtime';

export type SkillKind = 'skill' | 'extension';

export type SkillCategory = 'frontend' | 'backend' | 'engineering' | 'documents' | 'design' | 'testing' | 'automation' | 'mcp' | 'templates' | 'provider';

export type ComposerMode = 'default' | 'plan';

export type ExecutionPermission = 'default' | 'full_access';

export type SubagentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type AutonomousTaskKind = 'subagent' | 'job';

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
  | 'subagent';

export type AppearanceMode = 'system' | 'dark' | 'light';

export type AccentMode = 'system' | 'custom';

export type AppUpdateStatus = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up_to_date' | 'error';

export type PlanTurnState = 'idle' | 'generating_questions' | 'waiting_for_answers' | 'generating_plan' | 'plan_ready' | 'executing_from_plan';

export type PlannerPlanStatus = 'draft' | 'approved' | 'superseded';

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

export type JobSourceType = 'automation' | 'manual' | 'review_retry' | 'future_system';

export type JobStatus = 'queued' | 'running' | 'waiting_for_review' | 'paused' | 'resumed' | 'completed' | 'failed' | 'cancelled';

export type ReviewItemKind = 'tool_approval' | 'dangerous_action' | 'resume_confirmation' | 'manual_review';

export type ReviewItemStatus = 'pending' | 'approved' | 'rejected' | 'superseded';

export type AutonomyTaskSource = 'heartbeat_file';

export type AutonomyDelegationProfile = 'heartbeat' | 'research' | 'implement' | 'verify';

export type SettingsSection = 'general' | 'providers' | 'library' | 'diagnostics' | 'storage' | 'archived_threads';

export type LibrarySourceStatus = 'not_configured' | 'missing' | 'empty' | 'ready';

export type LibrarySourceEntryKind = 'folder' | 'skill' | 'markdown' | 'wiki';

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
  userLibraryPath: string | null;
  skillsLibraryPath: string | null;
  llmWikiLibraryPath: string | null;
}

export interface LibrarySourceEntry {
  id: string;
  name: string;
  kind: LibrarySourceEntryKind;
  path: string;
}

export interface LibrarySourceSummary {
  kind: 'user_library' | 'skills' | 'llm_wiki';
  label: string;
  path: string | null;
  status: LibrarySourceStatus;
  message: string;
  entries: LibrarySourceEntry[];
}

export interface LibrarySourcesSnapshot {
  userLibrary: LibrarySourceSummary;
  skills: LibrarySourceSummary;
  llmWiki: LibrarySourceSummary;
}

export type ProjectKnowledgeIndexStatusKind = 'not_configured' | 'missing' | 'not_indexed' | 'stale' | 'ready' | 'failed';

export interface ProjectKnowledgeIndexDiagnosticSummary {
  severity: 'info' | 'warning' | 'error';
  code: string;
  relativePath: string | null;
  message: string;
  suggestedAction: string | null;
}

export interface ProjectKnowledgeIndexStatus {
  status: ProjectKnowledgeIndexStatusKind;
  path: string | null;
  indexedFileCount: number;
  sectionCount: number;
  diagnosticCount: number;
  warningCount: number;
  diagnostics: ProjectKnowledgeIndexDiagnosticSummary[];
  lastRefreshedAt: string | null;
  lastError: string | null;
  message: string;
}

export interface ProjectKnowledgeSuggestedIndexDraft {
  targetRelativePath: 'INDEX.md';
  generatedAt: string;
  sourceCount: number;
  diagnosticCount: number;
  content: string;
}

export interface ProjectKnowledgeSuggestedIndexDraftFile {
  targetRelativePath: 'INDEX.md';
  generatedAt: string;
  sourceCount: number;
  diagnosticCount: number;
  path: string;
}

export type McpServerTransportType = 'stdio' | 'streamable_http' | 'sse';

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
  url: string | null;
  headers: Record<string, string>;
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
  url: string | null;
  headerKeys: string[];
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
  isolationMode?: HarnessIsolationMode;
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
  command?: string;
  args?: string[];
  cwd?: string | null;
  env?: Record<string, string>;
  url?: string | null;
  headers?: Record<string, string>;
  enabled: boolean;
  toolInvocationMode?: McpPermissionMode;
  launchApproved?: boolean;
}

export interface McpRecommendedSetupInput {
  entryId: string;
  projectId?: string | null;
}

export interface ShellBootstrapData {
  projects: Project[];
  threadsByProject: Record<string, ThreadSummary[]>;
  preferences: Preferences;
}

export interface BootstrapData extends ShellBootstrapData {
  pendingRunToolApprovals: RunToolApprovalRequest[];
  providers: ProviderDescriptor[];
}
