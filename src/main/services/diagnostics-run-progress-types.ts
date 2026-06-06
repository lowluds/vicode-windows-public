import type {
  RunRuntimeTraceMark,
  RunRuntimeTraceStage,
  SubagentSummary,
  ThreadDetail
} from '../../shared/domain';
import type { HarnessHandoffState } from '../../shared/harness-handoff-state';
import type { RunEvidenceBundleV1 } from '../../shared/run-evidence-bundle';

export interface ExportedProviderEventDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  source: string;
  providerEventType: string;
  itemType: string | null;
  itemKeys: string[];
  paths: string[];
  decision: string | null;
  status: string | null;
  taskLike: boolean;
  classification: string;
}

export interface ExportedNativeProgressSnapshot {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  title: string | null;
  itemCount: number;
  statuses: string[];
}

export interface ExportedToolRuntimeDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  kind: 'tool_call' | 'tool_result';
  toolName: string | null;
  phase: string | null;
  status: string | null;
  summary: string;
}

export interface ExportedTerminalCommandDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  phase: string | null;
  summary: string;
  command: string | null;
  cwd: string | null;
  isolationMode: string | null;
}

export interface ExportedVerificationArtifactDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  command: string | null;
  cwd: string | null;
  status: string;
  exitCode: number | null;
  durationMs: number | null;
  reason: string | null;
  skippedReason: string | null;
  permissionProfile: string | null;
  networkPolicy: string | null;
}

export interface ExportedPromptSectionEvidenceDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  sectionId: string | null;
  title: string | null;
  placement: string | null;
  characterCount: number | null;
  reason: string | null;
}

export interface ExportedModelRoutingEvidenceDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  modelId: string | null;
  customProviderId: string | null;
  ollamaTransportMode: string | null;
  runMode: string | null;
  providerLabel: string | null;
  transportKind: string | null;
  runtimeAuthority: string | null;
  reason: string | null;
}

export interface ExportedToolRoutingEvidenceDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  toolId: string | null;
  callName: string | null;
  name: string | null;
  origin: string | null;
  visibilityGroup: string | null;
  included: boolean | null;
  reason: string | null;
  mutatesWorkspace: boolean | null;
  requiresApproval: boolean | null;
  readsWorkspace: boolean | null;
  usesNetwork: boolean | null;
}

export interface ExportedInfrastructureEvidenceDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  infrastructureId: string | null;
  label: string | null;
  available: boolean | null;
  reason: string | null;
  toolCallNames: string[];
}

export interface ExportedStagedWorkspaceChangeDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  sourceToolName: string | null;
  isolationMode: string | null;
  status: string | null;
  requestedPath: string | null;
  changedPaths: string[];
  operationCount: number;
  operationKinds: string[];
  filesChanged: number | null;
  insertions: number | null;
  deletions: number | null;
}

export interface ExportedStagedWorkspaceHunkReviewDecisionDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  action: string;
  status: string;
  source: 'staged_workspace_preview';
  isolationMode: 'patch_buffer';
  stagedEventId: string;
  stagedEventIndex: number;
  changedPaths: string[];
  hunkIds: string[];
  acceptedHunkIds: string[];
  rejectedHunkIds: string[];
  hunkCount: number;
  acceptedHunkCount: number;
  rejectedHunkCount: number;
  filesChanged: number | null;
  insertions: number | null;
  deletions: number | null;
  errorReason: string | null;
}

export interface ExportedWorktreeChangeDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  isolationMode: string | null;
  status: string | null;
  reviewStatus: string | null;
  cleanupPolicy: string | null;
  sourceWorkspaceRelativePath: string | null;
  branchName: string | null;
  baseRef: string | null;
  baseSha: string | null;
  filesChanged: number | null;
  insertions: number | null;
  deletions: number | null;
  changedPaths: string[];
}

export interface ExportedWorktreeReviewDecisionDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  action: string;
  status: string;
  isolationMode: string;
  branchName: string | null;
  baseSha: string | null;
  sourceWorkspaceRelativePath: string | null;
  changedPaths: string[];
  filesChanged: number | null;
  insertions: number | null;
  deletions: number | null;
  errorReason: string | null;
}

export interface ExportedWorktreeHunkReviewDecisionDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  action: string;
  status: string;
  source: 'worktree_diff';
  isolationMode: 'git_worktree';
  branchName: string | null;
  baseSha: string | null;
  sourceWorkspaceRelativePath: string | null;
  changedPaths: string[];
  hunkIds: string[];
  acceptedHunkIds: string[];
  rejectedHunkIds: string[];
  hunkCount: number;
  acceptedHunkCount: number;
  rejectedHunkCount: number;
  filesChanged: number | null;
  insertions: number | null;
  deletions: number | null;
  errorReason: string | null;
}

export interface ExportedWorktreeCleanupDecisionDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  action: string;
  status: string;
  isolationMode: string;
  branchName: string | null;
  baseSha: string | null;
  cleanupPolicy: string | null;
  reviewStatus: string | null;
  errorReason: string | null;
}

export interface ExportedHarnessHookEvidenceDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  stage: string;
  sequence: number | null;
  turnIndex: number | null;
  toolName: string | null;
  summary: string | null;
  isError: boolean | null;
  mutatesWorkspace: boolean | null;
  verificationCommand: string | null;
  verificationStatus: string | null;
  contextPressureSeverity: string | null;
  contextPressureUsagePercent: number | null;
  contextPressureUsedTokens: number | null;
  contextPressureMaxTokens: number | null;
  contextPressureSource: string | null;
  contextPressureSourceLabel: string | null;
  contextPressureCheckpointRecommended: boolean | null;
  contextPressureCompactionLikely: boolean | null;
  checkpointReminderKind: string | null;
  checkpointReminderTitle: string | null;
  checkpointReminderSummary: string | null;
  continuationReason: string | null;
  continuationReminderCount: number | null;
  continuationMaxReminderCount: number | null;
}

export interface ExportedFinalEvidenceSummaryDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  usedMutatingTool: boolean | null;
  usedFileContentMutationTool: boolean | null;
  usedNativeWebResearchTool: boolean | null;
  postMutationVerificationRequired: boolean | null;
  postMutationVerificationPassed: boolean | null;
  verificationCommand: string | null;
  verificationStatus: string | null;
  createdDirectoriesCount: number | null;
  writtenFilesCount: number | null;
  toolCallCount: number | null;
  reminderCount: number | null;
}

export interface ExportedRuntimeTraceDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  firstRecordedAt: string;
  stageCount: number;
  terminalStage: RunRuntimeTraceStage | null;
  marks: RunRuntimeTraceMark[];
  submitToContextCompleteMs: number | null;
  contextAssemblyMs: number | null;
  submitToPromptAssembledMs: number | null;
  submitToRunStartedMs: number | null;
  submitToFirstDeltaMs: number | null;
  submitToFirstToolCallMs: number | null;
  submitToFirstToolResultMs: number | null;
  submitToTerminalMs: number | null;
}

export interface ExportedFailedRunDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  failedAt: string;
  failureStage: 'failed' | 'aborted';
  failureMessage: string | null;
  failureReason: string | null;
  hadAssistantOutput: boolean;
  lastThinkingSummary: string | null;
  lastProviderEventType: string | null;
  lastProviderPaths: string[];
  toolCallCount: number;
  toolResultCount: number;
  terminalCommandCount: number;
  lastToolName: string | null;
  lastToolCallSummary: string | null;
  lastToolResultSummary: string | null;
  lastTerminalCommand: string | null;
}

export interface RunProgressDiagnostics {
  providerEventDiagnostics: ExportedProviderEventDiagnostic[];
  nativeProgressSnapshots: ExportedNativeProgressSnapshot[];
  toolRuntimeDiagnostics: ExportedToolRuntimeDiagnostic[];
  terminalCommandDiagnostics: ExportedTerminalCommandDiagnostic[];
  verificationArtifactDiagnostics: ExportedVerificationArtifactDiagnostic[];
  promptSectionEvidenceDiagnostics: ExportedPromptSectionEvidenceDiagnostic[];
  modelRoutingEvidenceDiagnostics: ExportedModelRoutingEvidenceDiagnostic[];
  toolRoutingEvidenceDiagnostics: ExportedToolRoutingEvidenceDiagnostic[];
  infrastructureEvidenceDiagnostics: ExportedInfrastructureEvidenceDiagnostic[];
  stagedWorkspaceChangeDiagnostics: ExportedStagedWorkspaceChangeDiagnostic[];
  stagedWorkspaceHunkReviewDecisionDiagnostics: ExportedStagedWorkspaceHunkReviewDecisionDiagnostic[];
  worktreeChangeDiagnostics: ExportedWorktreeChangeDiagnostic[];
  worktreeReviewDecisionDiagnostics: ExportedWorktreeReviewDecisionDiagnostic[];
  worktreeHunkReviewDecisionDiagnostics: ExportedWorktreeHunkReviewDecisionDiagnostic[];
  worktreeCleanupDecisionDiagnostics: ExportedWorktreeCleanupDecisionDiagnostic[];
  harnessHookEvidenceDiagnostics: ExportedHarnessHookEvidenceDiagnostic[];
  finalEvidenceSummaryDiagnostics: ExportedFinalEvidenceSummaryDiagnostic[];
  harnessHandoffStateDiagnostics: HarnessHandoffState[];
  runtimeTraceDiagnostics: ExportedRuntimeTraceDiagnostic[];
  failedRunDiagnostics: ExportedFailedRunDiagnostic[];
  runEvidenceBundles: RunEvidenceBundleV1[];
}

export interface RunProgressDiagnosticsDb {
  listProjects(): Array<{ id: string }>;
  listThreads(projectId: string): Array<{ id: string }>;
  listArchivedThreads(projectId?: string | null): Array<{ id: string }>;
  getThread(threadId: string): ThreadDetail;
  listSubagentsByParentThread?: (threadId: string) => SubagentSummary[];
}

export interface CollectRunProgressDiagnosticsInput {
  db: RunProgressDiagnosticsDb;
  threadIds?: Iterable<string> | null;
}

