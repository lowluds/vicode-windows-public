import type { StagedWorkspaceReviewDecision } from '../../shared/domain';
import {
  finiteNumberOrNull,
  recordOrNull,
  safeDiagnosticPathArray,
  safeDiagnosticPathStringOrNull,
  safeDiagnosticStringArray,
  safeDiagnosticStringOrNull,
  stringArray,
  stringOrNull
} from './diagnostics-redaction';

export function parseVerificationArtifact(payload: Record<string, unknown>) {
  return 'verificationArtifact' in payload
    && payload.verificationArtifact
    && typeof payload.verificationArtifact === 'object'
    ? (payload.verificationArtifact as Record<string, unknown>)
    : null;
}

export function parseStagedWorkspaceChangeSet(payload: Record<string, unknown>) {
  return 'stagedWorkspaceChangeSet' in payload
    && payload.stagedWorkspaceChangeSet
    && typeof payload.stagedWorkspaceChangeSet === 'object'
    ? (payload.stagedWorkspaceChangeSet as Record<string, unknown>)
    : null;
}

export function parseStagedWorkspaceHunkReviewDecision(payload: Record<string, unknown>) {
  if (
    !('stagedWorkspaceHunkReviewDecision' in payload)
    || !payload.stagedWorkspaceHunkReviewDecision
    || typeof payload.stagedWorkspaceHunkReviewDecision !== 'object'
    || Array.isArray(payload.stagedWorkspaceHunkReviewDecision)
  ) {
    return null;
  }

  const decision = payload.stagedWorkspaceHunkReviewDecision as Record<string, unknown>;
  const action = stagedWorkspaceReviewActionOrNull(decision.action);
  const status = stagedWorkspaceReviewStatusOrNull(decision.status);
  const source = decision.source === 'staged_workspace_preview' ? 'staged_workspace_preview' : null;
  const isolationMode = decision.isolationMode === 'patch_buffer' ? 'patch_buffer' : null;
  const stagedEventId = safeDiagnosticStringOrNull(decision.stagedEventId);
  const stagedEventIndex = finiteNumberOrNull(decision.stagedEventIndex);
  if (!action || !status || !source || !isolationMode || !stagedEventId || stagedEventIndex === null) {
    return null;
  }

  const hunkIds = safeDiagnosticStringArray(decision.hunkIds);
  const acceptedHunkIds = safeDiagnosticStringArray(decision.acceptedHunkIds);
  const rejectedHunkIds = safeDiagnosticStringArray(decision.rejectedHunkIds);
  return {
    action,
    status,
    source,
    isolationMode,
    stagedEventId,
    stagedEventIndex,
    changedPaths: safeDiagnosticPathArray(decision.changedPaths),
    hunkIds,
    acceptedHunkIds,
    rejectedHunkIds,
    hunkCount: hunkIds.length,
    acceptedHunkCount: acceptedHunkIds.length,
    rejectedHunkCount: rejectedHunkIds.length,
    filesChanged: finiteNumberOrNull(decision.filesChanged),
    insertions: finiteNumberOrNull(decision.insertions),
    deletions: finiteNumberOrNull(decision.deletions),
    errorReason: safeDiagnosticStringOrNull(decision.errorReason)
  };
}

export function parseWorktreeChangeEvidence(payload: Record<string, unknown>) {
  return 'worktreeChangeEvidence' in payload
    && payload.worktreeChangeEvidence
    && typeof payload.worktreeChangeEvidence === 'object'
    ? (payload.worktreeChangeEvidence as Record<string, unknown>)
    : null;
}

export function parseWorktreeReviewDecision(payload: Record<string, unknown>) {
  if (
    !('worktreeReviewDecision' in payload)
    || !payload.worktreeReviewDecision
    || typeof payload.worktreeReviewDecision !== 'object'
    || Array.isArray(payload.worktreeReviewDecision)
  ) {
    return null;
  }

  const decision = payload.worktreeReviewDecision as Record<string, unknown>;
  const action = worktreeReviewActionOrNull(decision.action);
  const status = worktreeReviewStatusOrNull(decision.status);
  const isolationMode = decision.isolationMode === 'git_worktree' ? 'git_worktree' : null;
  if (!action || !status || !isolationMode) {
    return null;
  }

  return {
    action,
    status,
    isolationMode,
    branchName: safeDiagnosticStringOrNull(decision.branchName),
    baseSha: safeDiagnosticStringOrNull(decision.baseSha),
    sourceWorkspaceRelativePath: safeDiagnosticPathStringOrNull(decision.sourceWorkspaceRelativePath),
    changedPaths: safeDiagnosticPathArray(decision.changedPaths),
    filesChanged: finiteNumberOrNull(decision.filesChanged),
    insertions: finiteNumberOrNull(decision.insertions),
    deletions: finiteNumberOrNull(decision.deletions),
    errorReason: safeDiagnosticStringOrNull(decision.errorReason)
  };
}

export function parseWorktreeHunkReviewDecision(payload: Record<string, unknown>) {
  if (
    !('worktreeHunkReviewDecision' in payload)
    || !payload.worktreeHunkReviewDecision
    || typeof payload.worktreeHunkReviewDecision !== 'object'
    || Array.isArray(payload.worktreeHunkReviewDecision)
  ) {
    return null;
  }

  const decision = payload.worktreeHunkReviewDecision as Record<string, unknown>;
  const action = stagedWorkspaceReviewActionOrNull(decision.action);
  const status = stagedWorkspaceReviewStatusOrNull(decision.status);
  const source = decision.source === 'worktree_diff' ? 'worktree_diff' : null;
  const isolationMode = decision.isolationMode === 'git_worktree' ? 'git_worktree' : null;
  if (!action || !status || !source || !isolationMode) {
    return null;
  }

  const hunkIds = safeDiagnosticStringArray(decision.hunkIds);
  const acceptedHunkIds = safeDiagnosticStringArray(decision.acceptedHunkIds);
  const rejectedHunkIds = safeDiagnosticStringArray(decision.rejectedHunkIds);
  return {
    action,
    status,
    source,
    isolationMode,
    branchName: safeDiagnosticStringOrNull(decision.branchName),
    baseSha: safeDiagnosticStringOrNull(decision.baseSha),
    sourceWorkspaceRelativePath: safeDiagnosticPathStringOrNull(decision.sourceWorkspaceRelativePath),
    changedPaths: safeDiagnosticPathArray(decision.changedPaths),
    hunkIds,
    acceptedHunkIds,
    rejectedHunkIds,
    hunkCount: hunkIds.length,
    acceptedHunkCount: acceptedHunkIds.length,
    rejectedHunkCount: rejectedHunkIds.length,
    filesChanged: finiteNumberOrNull(decision.filesChanged),
    insertions: finiteNumberOrNull(decision.insertions),
    deletions: finiteNumberOrNull(decision.deletions),
    errorReason: safeDiagnosticStringOrNull(decision.errorReason)
  };
}

export function parseWorktreeCleanupDecision(payload: Record<string, unknown>) {
  if (
    !('worktreeCleanupDecision' in payload)
    || !payload.worktreeCleanupDecision
    || typeof payload.worktreeCleanupDecision !== 'object'
    || Array.isArray(payload.worktreeCleanupDecision)
  ) {
    return null;
  }

  const decision = payload.worktreeCleanupDecision as Record<string, unknown>;
  const action = worktreeCleanupStatusOrNull(decision.action);
  const status = worktreeCleanupStatusOrNull(decision.status);
  const isolationMode = decision.isolationMode === 'git_worktree' ? 'git_worktree' : null;
  const reviewStatus = decision.reviewStatus === 'pending'
    ? 'pending'
    : worktreeReviewStatusOrNull(decision.reviewStatus);
  if (!action || !status || !isolationMode || !reviewStatus) {
    return null;
  }

  return {
    action,
    status,
    isolationMode,
    branchName: safeDiagnosticStringOrNull(decision.branchName),
    baseSha: safeDiagnosticStringOrNull(decision.baseSha),
    cleanupPolicy: safeDiagnosticStringOrNull(decision.cleanupPolicy),
    reviewStatus,
    errorReason: safeDiagnosticStringOrNull(decision.errorReason)
  };
}

export function worktreeReviewActionOrNull(value: unknown) {
  return value === 'applied' || value === 'rejected' || value === 'reverted'
    ? value
    : null;
}

export function worktreeReviewStatusOrNull(value: unknown) {
  return value === 'applied'
    || value === 'rejected'
    || value === 'reverted'
    || value === 'failed'
    ? value
    : null;
}

export function worktreeCleanupStatusOrNull(value: unknown) {
  return value === 'cleaned' || value === 'failed' || value === 'refused'
    ? value
    : null;
}

export function parseHarnessHookEvidence(payload: Record<string, unknown>) {
  return 'harnessHookEvidence' in payload
    && payload.harnessHookEvidence
    && typeof payload.harnessHookEvidence === 'object'
    ? (payload.harnessHookEvidence as Record<string, unknown>)
    : null;
}

export function parseFinalEvidenceSummary(payload: Record<string, unknown>) {
  return 'finalEvidenceSummary' in payload
    && payload.finalEvidenceSummary
    && typeof payload.finalEvidenceSummary === 'object'
    ? (payload.finalEvidenceSummary as Record<string, unknown>)
    : null;
}

export function stagedWorkspaceReviewActionOrNull(value: unknown) {
  return value === 'applied' || value === 'rejected' || value === 'reverted'
    ? value
    : null;
}

export function stagedWorkspaceReviewStatusOrNull(value: unknown) {
  return value === 'applied'
    || value === 'rejected'
    || value === 'reverted'
    || value === 'failed'
    ? value
    : null;
}

export function stagedWorkspaceSourceToolOrNull(value: unknown) {
  return value === 'mkdir' || value === 'write_file' || value === 'apply_patch'
    ? value
    : null;
}

export function stagedWorkspaceOperationKindOrNull(value: unknown) {
  return value === 'mkdir' || value === 'write_file' || value === 'apply_patch' || value === 'delete'
    ? value
    : null;
}

export function parseStagedWorkspaceReviewDecisionForBundle(value: unknown): StagedWorkspaceReviewDecision | null {
  const decision = recordOrNull(value);
  if (!decision) {
    return null;
  }

  const action = stagedWorkspaceReviewActionOrNull(decision.action);
  const status = stagedWorkspaceReviewStatusOrNull(decision.status);
  const sourceToolName = stagedWorkspaceSourceToolOrNull(decision.sourceToolName);
  const isolationMode = decision.isolationMode === 'patch_buffer' ? 'patch_buffer' : null;
  const threadId = stringOrNull(decision.threadId);
  const runId = stringOrNull(decision.runId);
  const stagedEventId = stringOrNull(decision.stagedEventId);
  const stagedEventIndex = finiteNumberOrNull(decision.stagedEventIndex);
  const createdAt = stringOrNull(decision.createdAt);
  if (
    !action
    || !status
    || !sourceToolName
    || !isolationMode
    || !threadId
    || !runId
    || !stagedEventId
    || stagedEventIndex === null
    || !createdAt
  ) {
    return null;
  }

  return {
    action,
    status,
    threadId,
    runId,
    stagedEventId,
    stagedEventIndex,
    sourceToolName,
    isolationMode,
    changedPaths: safeDiagnosticPathArray(decision.changedPaths),
    operationKinds: stringArray(decision.operationKinds)
      .map(stagedWorkspaceOperationKindOrNull)
      .filter((kind): kind is StagedWorkspaceReviewDecision['operationKinds'][number] => Boolean(kind)),
    errorReason: safeDiagnosticStringOrNull(decision.errorReason),
    createdAt
  };
}
