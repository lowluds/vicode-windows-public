import type {
  AutonomousTaskSummary,
  ComposerSubmitInput,
  ComposerSubmitResult,
  ExecutionPermission,
  PlannerAnswerInput,
  PlannerApprovePlanInput,
  PlannerCancelInput,
  PlannerSetModeInput,
  PlannerSubmitInput,
  ProviderId,
  RunChangeArtifact,
  StagedWorkspaceHunkApplyInput,
  StagedWorkspaceHunkRejectInput,
  StagedWorkspaceHunkRevertInput,
  StagedWorkspaceHunkReviewResult,
  StagedWorkspaceReviewInput,
  StagedWorkspaceReviewResult,
  WorktreeCleanupInput,
  WorktreeCleanupResult,
  WorktreeHunkApplyInput,
  WorktreeHunkRejectInput,
  WorktreeHunkRevertInput,
  WorktreeHunkReviewResult,
  WorktreeReviewInput,
  WorktreeReviewResult,
  TextAttachment,
  ThreadDetail,
  ThreadFollowUp,
  ThreadSummary,
  SubagentSpawnInput,
  SubagentSummary
} from './domain';
import type { ThreadCollaborationSummary } from './ipc-bootstrap-types';

export interface ThreadDomainApi {
  threads: {
    list(projectId: string): Promise<ThreadSummary[]>;
    open(threadId: string): Promise<ThreadDetail>;
    summarizeForCollaboration(threadId: string): Promise<ThreadCollaborationSummary>;
    listAutonomousTasks(threadId: string): Promise<AutonomousTaskSummary[]>;
    createFollowUp(input: { threadId: string; content: string; kind?: 'follow_up' | 'steer' }): Promise<ThreadFollowUp>;
    updateFollowUp(followUpId: string, content: string): Promise<ThreadFollowUp>;
    removeFollowUp(followUpId: string): Promise<void>;
    getDraft(threadId: string): Promise<string>;
    saveDraft(threadId: string, prompt: string): Promise<string>;
    clearDraft(threadId: string): Promise<void>;
    create(input: {
      projectId: string;
      title?: string;
      providerId: ProviderId;
      modelId: string;
      executionPermission?: ExecutionPermission;
    }): Promise<ThreadDetail>;
    rename(threadId: string, title: string): Promise<ThreadSummary>;
    setExecutionPermission(threadId: string, executionPermission: ExecutionPermission): Promise<ThreadDetail>;
    archive(threadId: string): Promise<void>;
    listArchived(projectId?: string | null): Promise<ThreadSummary[]>;
    restore(threadId: string): Promise<ThreadSummary>;
    remove(threadId: string): Promise<void>;
    duplicate(threadId: string, fromTurnId?: string | null): Promise<ThreadDetail>;
    retry(threadId: string): Promise<{ runId: string }>;
  };
  composer: {
    submit(input: ComposerSubmitInput): Promise<ComposerSubmitResult>;
    createTextAttachment(input: {
      projectId: string;
      content: string;
      fileName?: string | null;
    }): Promise<TextAttachment>;
    deleteTextAttachment(input: {
      projectId: string;
      attachment: TextAttachment;
    }): Promise<void>;
    enhancePrompt(input: {
      prompt: string;
      projectId?: string | null;
      providerId: ProviderId;
      modelId: string;
      reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'none' | null;
      thinkingEnabled?: boolean;
    }): Promise<{ prompt: string }>;
    stop(runId: string): Promise<void>;
  };
  runs: {
    approveToolApproval(approvalId: string): Promise<void>;
    rejectToolApproval(approvalId: string): Promise<void>;
    previewStagedWorkspaceChange(input: StagedWorkspaceReviewInput): Promise<RunChangeArtifact>;
    applyStagedWorkspaceChange(input: StagedWorkspaceReviewInput): Promise<StagedWorkspaceReviewResult>;
    rejectStagedWorkspaceChange(input: StagedWorkspaceReviewInput): Promise<StagedWorkspaceReviewResult>;
    revertStagedWorkspaceChange(input: StagedWorkspaceReviewInput): Promise<StagedWorkspaceReviewResult>;
    applyStagedWorkspaceHunks(input: StagedWorkspaceHunkApplyInput): Promise<StagedWorkspaceHunkReviewResult>;
    rejectStagedWorkspaceHunks(input: StagedWorkspaceHunkRejectInput): Promise<StagedWorkspaceHunkReviewResult>;
    revertStagedWorkspaceHunks(input: StagedWorkspaceHunkRevertInput): Promise<StagedWorkspaceHunkReviewResult>;
    applyWorktreeReview(input: WorktreeReviewInput): Promise<WorktreeReviewResult>;
    rejectWorktreeReview(input: WorktreeReviewInput): Promise<WorktreeReviewResult>;
    revertWorktreeReview(input: WorktreeReviewInput): Promise<WorktreeReviewResult>;
    applyWorktreeHunks(input: WorktreeHunkApplyInput): Promise<WorktreeHunkReviewResult>;
    rejectWorktreeHunks(input: WorktreeHunkRejectInput): Promise<WorktreeHunkReviewResult>;
    revertWorktreeHunks(input: WorktreeHunkRevertInput): Promise<WorktreeHunkReviewResult>;
    cleanupWorktreeReview(input: WorktreeCleanupInput): Promise<WorktreeCleanupResult>;
  };
  subagents: {
    list(threadId: string): Promise<SubagentSummary[]>;
    spawn(input: SubagentSpawnInput): Promise<SubagentSummary>;
    cancel(subagentId: string): Promise<SubagentSummary>;
    getDetail(subagentId: string): Promise<SubagentSummary>;
  };
  planner: {
    setMode(input: PlannerSetModeInput): Promise<ThreadDetail>;
    submit(input: PlannerSubmitInput): Promise<{ thread: ThreadDetail; runId: string }>;
    answer(input: PlannerAnswerInput): Promise<{ thread: ThreadDetail; runId: string }>;
    approvePlan(input: PlannerApprovePlanInput): Promise<{ thread: ThreadDetail; runId: string }>;
    cancel(input: PlannerCancelInput): Promise<ThreadDetail>;
  };
}
