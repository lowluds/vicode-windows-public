import type { ProviderId } from './domain-provider';
import type { AutonomyDelegationProfile, AutonomyTaskSource, ThreadDetail, ThreadSource } from './domain-thread';

export type HarnessIsolationMode = 'direct_workspace' | 'patch_buffer' | 'git_worktree';

export type RunToolApprovalDecision = 'approved' | 'rejected' | 'cancelled';

export type RuntimeCommandIsolationMode = 'host_isolated_temp_profile' | 'host_job_object_temp_profile';

export type RunTaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'failed';

export type RunToolApprovalKind = 'command' | 'workspace_change';

export interface RunToolApprovalWorkspaceChange {
  sourceToolName: 'apply_patch';
  changedPaths: string[];
  operationKinds: StagedWorkspaceReviewOperationKind[];
  summary: RunDiffStats;
  preview: RunChangeArtifact;
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
  approvalKind?: RunToolApprovalKind;
  workspaceChange?: RunToolApprovalWorkspaceChange | null;
  requestedAt: string;
}

export type RunToolApprovalRequestInput = Omit<RunToolApprovalRequest, 'id' | 'requestedAt'>;

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
  source?: 'workspace_diff' | 'provider_reported' | 'staged_workspace_preview' | 'worktree_diff';
  summary: RunDiffStats;
  files: RunChangedFileArtifact[];
}

export interface RunWorktreeChangeEvidence {
  threadId: string;
  runId: string;
  isolationMode: 'git_worktree';
  status: string;
  reviewStatus: string;
  cleanupPolicy: string;
  sourceWorkspaceRelativePath: string;
  branchName: string;
  baseRef: string;
  baseSha: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  changedPaths: string[];
}

export type WorktreeReviewAction = 'applied' | 'rejected' | 'reverted';

export type WorktreeReviewStatus = 'applied' | 'rejected' | 'reverted' | 'failed';

export interface WorktreeReviewDecision {
  action: WorktreeReviewAction;
  status: WorktreeReviewStatus;
  threadId: string;
  runId: string;
  isolationMode: 'git_worktree';
  branchName: string;
  baseSha: string;
  sourceWorkspaceRelativePath: string;
  changedPaths: string[];
  filesChanged: number;
  insertions: number;
  deletions: number;
  errorReason: string | null;
  createdAt: string;
}

export interface WorktreeReviewInput {
  threadId: string;
  runId: string;
}

export interface WorktreeReviewResult {
  thread: ThreadDetail;
  decision: WorktreeReviewDecision;
}

export interface WorktreeHunkReviewDecision {
  action: HunkReviewDecisionAction;
  status: HunkReviewDecisionStatus;
  threadId: string;
  runId: string;
  source: 'worktree_diff';
  isolationMode: 'git_worktree';
  branchName: string;
  baseSha: string;
  sourceWorkspaceRelativePath: string;
  changedPaths: string[];
  hunkIds: string[];
  acceptedHunkIds: string[];
  rejectedHunkIds: string[];
  filesChanged: number;
  insertions: number;
  deletions: number;
  errorReason: string | null;
  createdAt: string;
}

export interface WorktreeHunkApplyInput extends WorktreeReviewInput {
  acceptedHunkIds: string[];
  rejectedHunkIds?: string[];
}

export interface WorktreeHunkRejectInput extends WorktreeReviewInput {
  hunkIds: string[];
}

export type WorktreeHunkRevertInput = WorktreeReviewInput;

export interface WorktreeHunkReviewResult {
  thread: ThreadDetail;
  decision: WorktreeHunkReviewDecision;
}

export type WorktreeCleanupAction = 'cleaned' | 'failed' | 'refused';

export type WorktreeCleanupStatus = 'cleaned' | 'failed' | 'refused';

export type WorktreeCleanupReviewStatus = 'pending' | WorktreeReviewStatus;

export interface WorktreeCleanupDecision {
  action: WorktreeCleanupAction;
  status: WorktreeCleanupStatus;
  threadId: string;
  runId: string;
  isolationMode: 'git_worktree';
  branchName: string;
  baseSha: string;
  cleanupPolicy: string;
  reviewStatus: WorktreeCleanupReviewStatus;
  errorReason: string | null;
  createdAt: string;
}

export interface WorktreeCleanupInput {
  threadId: string;
  runId: string;
}

export interface WorktreeCleanupResult {
  thread: ThreadDetail;
  decision: WorktreeCleanupDecision;
}

export type RunRuntimeTraceStage =
  | 'submit_received'
  | 'workspace_context_started'
  | 'workspace_context_completed'
  | 'worktree_session_created'
  | 'worktree_session_failed'
  | 'image_review_started'
  | 'image_review_completed'
  | 'image_review_failed'
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

export type RunEventPayloadKind =
  | 'assistant_visible_text'
  | 'tool_activity'
  | 'internal_runtime_reminder'
  | 'provider_diagnostic'
  | 'failure_summary'
  | 'debug_detail';

export interface RunEvent {
  id: string;
  threadId: string;
  runId: string;
  eventType: 'started' | 'delta' | 'completed' | 'failed' | 'aborted' | 'info';
  payload: Record<string, unknown>;
  createdAt: string;
}

export type StagedWorkspaceReviewOperationKind = 'mkdir' | 'write_file' | 'apply_patch' | 'delete';

export type StagedWorkspaceReviewAction = 'applied' | 'rejected' | 'reverted';

export type StagedWorkspaceReviewStatus = 'applied' | 'rejected' | 'reverted' | 'failed';

export interface StagedWorkspaceReviewInput {
  threadId: string;
  runId: string;
  stagedEventId?: string | null;
  stagedEventIndex?: number | null;
}

export interface StagedWorkspaceReviewDecision {
  action: StagedWorkspaceReviewAction;
  status: StagedWorkspaceReviewStatus;
  threadId: string;
  runId: string;
  stagedEventId: string;
  stagedEventIndex: number;
  sourceToolName: 'mkdir' | 'write_file' | 'apply_patch';
  isolationMode: 'patch_buffer';
  changedPaths: string[];
  operationKinds: StagedWorkspaceReviewOperationKind[];
  errorReason: string | null;
  createdAt: string;
}

export interface StagedWorkspaceReviewResult {
  thread: ThreadDetail;
  decision: StagedWorkspaceReviewDecision;
}

export type HunkReviewDecisionAction = 'applied' | 'rejected' | 'reverted';

export type HunkReviewDecisionStatus = 'applied' | 'rejected' | 'reverted' | 'failed';

export interface StagedWorkspaceHunkReviewDecision {
  action: HunkReviewDecisionAction;
  status: HunkReviewDecisionStatus;
  threadId: string;
  runId: string;
  source: 'staged_workspace_preview';
  isolationMode: 'patch_buffer';
  stagedEventId: string;
  stagedEventIndex: number;
  changedPaths: string[];
  hunkIds: string[];
  acceptedHunkIds: string[];
  rejectedHunkIds: string[];
  filesChanged: number;
  insertions: number;
  deletions: number;
  errorReason: string | null;
  createdAt: string;
}

export interface StagedWorkspaceHunkApplyInput extends StagedWorkspaceReviewInput {
  acceptedHunkIds: string[];
  rejectedHunkIds?: string[];
}

export interface StagedWorkspaceHunkRejectInput extends StagedWorkspaceReviewInput {
  hunkIds: string[];
}

export type StagedWorkspaceHunkRevertInput = StagedWorkspaceReviewInput;

export interface StagedWorkspaceHunkReviewResult {
  thread: ThreadDetail;
  decision: StagedWorkspaceHunkReviewDecision;
}

export interface RunActivityInfo {
  kind: 'thinking' | 'guidance' | 'skill' | 'memory_recall' | 'memory_checkpoint' | 'context_compaction' | 'web_search' | 'delegation' | 'tool_call' | 'tool_result' | 'file_edit' | 'file_write' | 'mkdir' | 'terminal_command' | 'terminal_output' | 'file_open' | 'file_read' | 'file_search' | 'change_summary';
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
