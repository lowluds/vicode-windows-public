import type {
  RunChangeArtifact,
  RunProgressState,
  StagedWorkspaceHunkReviewDecision,
  StagedWorkspaceReviewDecision,
  StagedWorkspaceReviewInput,
  StagedWorkspaceReviewOperationKind,
  StagedWorkspaceReviewStatus,
  ThreadSource,
  WorktreeCleanupDecision,
  WorktreeCleanupStatus,
  WorktreeHunkReviewDecision,
  WorktreeReviewDecision,
  WorktreeReviewInput,
  WorktreeReviewStatus
} from '../../../shared/domain';

export interface TerminalCommandViewModel {
  id: string;
  label: string;
  command: string | null;
  cwd: string | null;
  isolationMode: string | null;
  status: 'running' | 'completed' | 'stopped';
  startedAt: string | null;
  finishedAt: string | null;
  durationLabel: string | null;
  outputLines: string[];
}

export interface ThinkingLineViewModel {
  id: string;
  label: string;
  text: string;
  url: string | null;
  path: string | null;
  kind: 'thinking' | 'guidance' | 'skill' | 'memory_recall' | 'memory_checkpoint' | 'context_compaction' | 'web_search' | 'delegation' | 'tool_call' | 'tool_result' | 'file_edit' | 'file_write' | 'mkdir' | 'file_open' | 'file_read' | 'file_search';
}

export interface RunActivityTimelineThinkingItem {
  id: string;
  kind: 'thinking';
  line: ThinkingLineViewModel;
}

export interface RunActivityTimelineTerminalItem {
  id: string;
  kind: 'terminal_command';
  command: TerminalCommandViewModel;
}

export type RunActivityTimelineItem = RunActivityTimelineThinkingItem | RunActivityTimelineTerminalItem;

export interface RunTranscriptAssistantItem {
  id: string;
  kind: 'assistant_text';
  text: string;
  sources?: ThreadSource[];
}

export interface RunTranscriptActivityItem {
  id: string;
  kind: 'activity_line';
  activityKind: 'thinking' | 'guidance' | 'skill' | 'memory_recall' | 'memory_checkpoint' | 'context_compaction' | 'web_search' | 'delegation' | 'tool_call' | 'tool_result' | 'file_edit' | 'file_write' | 'mkdir' | 'terminal_command' | 'file_open' | 'file_read' | 'file_search' | 'inspection_group' | 'write_group';
  providerEventType: string | null;
  toolName: string | null;
  label: string;
  text: string;
  url: string | null;
  path: string | null;
  command: string | null;
  cwd: string | null;
  isolationMode: string | null;
  status: 'running' | 'completed' | 'stopped' | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationLabel: string | null;
  outputLines: string[];
}

export interface RunTranscriptChangeArtifactItem {
  id: string;
  kind: 'change_artifact';
  label: string;
  artifact: RunChangeArtifact;
}

export type StagedWorkspaceProposalStatus = 'pending' | StagedWorkspaceReviewStatus;

export interface RunStagedWorkspaceReviewItem {
  id: string;
  threadId: string;
  runId: string;
  stagedEventId: string;
  stagedEventIndex: number;
  createdAt: string;
  sourceToolName: 'mkdir' | 'write_file' | 'apply_patch';
  isolationMode: 'patch_buffer';
  status: StagedWorkspaceProposalStatus;
  requestedPath: string | null;
  changedPaths: string[];
  operationCount: number;
  operationKinds: StagedWorkspaceReviewOperationKind[];
  filesChanged: number;
  insertions: number;
  deletions: number;
  decision: StagedWorkspaceReviewDecision | null;
  hunkDecision?: StagedWorkspaceHunkReviewDecision | null;
}

export interface RunTranscriptStagedWorkspaceChangeItem {
  id: string;
  kind: 'staged_workspace_change';
  label: string;
  change: RunStagedWorkspaceReviewItem;
}

export type WorktreeProposalStatus = 'pending' | WorktreeReviewStatus;
export type WorktreeCleanupUiStatus = 'pending' | WorktreeCleanupStatus;

export interface RunWorktreeReviewItem {
  id: string;
  threadId: string;
  runId: string;
  artifactEventId: string;
  createdAt: string;
  isolationMode: 'git_worktree';
  status: WorktreeProposalStatus;
  branchName: string | null;
  baseSha: string | null;
  sourceWorkspaceRelativePath: string | null;
  changedPaths: string[];
  filesChanged: number;
  insertions: number;
  deletions: number;
  errorReason: string | null;
  decision: WorktreeReviewDecision | null;
  cleanupStatus: WorktreeCleanupUiStatus;
  cleanupErrorReason: string | null;
  cleanupDecision: WorktreeCleanupDecision | null;
  hunkDecision?: WorktreeHunkReviewDecision | null;
  artifact: RunChangeArtifact;
}

export interface RunTranscriptWorktreeWorkspaceChangeItem {
  id: string;
  kind: 'worktree_workspace_change';
  label: string;
  change: RunWorktreeReviewItem;
}

export interface RunTranscriptWorkedForItem {
  id: string;
  kind: 'worked_for';
  label: string;
}

export interface RunTranscriptResolutionSummaryItem {
  id: string;
  kind: 'resolution_summary';
  outcome: string;
  filesChanged: string[];
  toolsUsed: string[];
  verificationCommands: string[];
  remainingRisk: string | null;
}

export type RunTranscriptItem =
  | RunTranscriptAssistantItem
  | RunTranscriptActivityItem
  | RunTranscriptChangeArtifactItem
  | RunTranscriptStagedWorkspaceChangeItem
  | RunTranscriptWorktreeWorkspaceChangeItem
  | RunTranscriptWorkedForItem
  | RunTranscriptResolutionSummaryItem;

export interface RunActivityViewModel {
  runId: string;
  state: 'running' | 'completed' | 'failed' | 'aborted';
  startedAt: string | null;
  finishedAt: string | null;
  outcomeMessage: string | null;
  thinkingLines: ThinkingLineViewModel[];
  terminalCommands: TerminalCommandViewModel[];
  timelineItems: RunActivityTimelineItem[];
  activeHeading: 'Thinking' | 'Working' | null;
  workedForLabel: string | null;
  changeArtifact: RunChangeArtifact | null;
}

export interface RunReviewEvidenceViewModel {
  runId: string;
  state: RunActivityViewModel['state'];
  reviewAvailable: boolean;
  changeArtifact: RunChangeArtifact | null;
  thoughtEvidence: ThinkingLineViewModel[];
  fileEvidence: ThinkingLineViewModel[];
  terminalCommands: TerminalCommandViewModel[];
  workedForLabel: string | null;
  activity: RunActivityViewModel;
}

export type {
  RunProgressState,
  StagedWorkspaceReviewInput,
  WorktreeReviewInput
};
