export function stringOrNull(value: unknown) {
  return typeof value === 'string' ? value : null;
}

export function booleanOrNull(value: unknown) {
  return typeof value === 'boolean' ? value : null;
}

export function finiteNumberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function safeDiagnosticStringOrNull(value: unknown) {
  const text = stringOrNull(value);
  return text === null ? null : redactEmbeddedLocalPaths(text);
}

export function safeDiagnosticPathStringOrNull(value: unknown) {
  const text = stringOrNull(value);
  if (text === null) {
    return null;
  }
  return isAbsoluteLocalPath(text) ? '[redacted-path]' : redactEmbeddedLocalPaths(text);
}

export function safeDiagnosticPathArray(value: unknown) {
  return stringArray(value).map((path) => (
    isAbsoluteLocalPath(path) ? '[redacted-path]' : redactEmbeddedLocalPaths(path)
  ));
}

export function safeDiagnosticStringArray(value: unknown) {
  return stringArray(value)
    .map((item) => safeDiagnosticStringOrNull(item))
    .filter((item): item is string => Boolean(item));
}

export function objectArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

export function redactSupportString(key: string, value: string) {
  const normalizedKey = key.toLowerCase();
  if (/(token|secret|apikey|api_key|encrypted|credential|password)/u.test(normalizedKey)) {
    return '[redacted]';
  }
  if (/(path|cwd|folder)/u.test(normalizedKey) && isAbsoluteLocalPath(value)) {
    return value ? '[redacted-path]' : value;
  }
  return redactEmbeddedLocalPaths(redactSecretLikeValues(value));
}

export function isAbsoluteLocalPath(value: string) {
  return /^\s*(?:[a-zA-Z]:[\\/]|\\\\|\/\/)/u.test(value);
}

export function redactEmbeddedLocalPaths(value: string) {
  return value
    .replace(/[a-zA-Z]:[\\/][^\r\n"',}]*/gu, '[redacted-path]')
    .replace(/\\\\[^\r\n"',}]*/gu, '[redacted-path]');
}

export function redactSecretLikeValues(value: string) {
  return value
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9_]{8,}|(?:secret|token)[-_][A-Za-z0-9_-]+)\b/giu, '[redacted]')
    .replace(/\b(?:api[_-]?key|token|secret|password|credential|session)\b\s*[:=]\s*[^\s,;)]+/giu, '[redacted]');
}

export function redactSupportValue(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    return redactSupportString(key, value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSupportValue(item, key));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactSupportValue(entryValue, entryKey)
    ])
  );
}

function sanitizeStagedWorkspaceChangeSet(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const changeSet = value as Record<string, unknown>;
  const operations = objectArray(changeSet.operations).map((operation) => {
    const {
      beforeContent: _beforeContent,
      proposedAfterContent: _proposedAfterContent,
      patchText: _patchText,
      ...safeOperation
    } = operation;
    return safeOperation;
  });

  return {
    ...changeSet,
    operations
  };
}

function sanitizeWorktreeChangeArtifact(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const artifact = value as Record<string, unknown>;
  if (artifact.source !== 'worktree_diff') {
    return value;
  }

  const files = objectArray(artifact.files).map((file) => {
    const {
      beforeContent: _beforeContent,
      afterContent: _afterContent,
      patchText: _patchText,
      ...safeFile
    } = file;
    return safeFile;
  });

  return {
    ...artifact,
    files
  };
}

function worktreeReviewActionOrNull(value: unknown) {
  return value === 'applied' || value === 'rejected' || value === 'reverted'
    ? value
    : null;
}

function worktreeReviewStatusOrNull(value: unknown) {
  return value === 'applied'
    || value === 'rejected'
    || value === 'reverted'
    || value === 'failed'
    ? value
    : null;
}

function worktreeCleanupStatusOrNull(value: unknown) {
  return value === 'cleaned' || value === 'failed' || value === 'refused'
    ? value
    : null;
}

function stagedWorkspaceReviewActionOrNull(value: unknown) {
  return value === 'applied' || value === 'rejected' || value === 'reverted'
    ? value
    : null;
}

function stagedWorkspaceReviewStatusOrNull(value: unknown) {
  return value === 'applied'
    || value === 'rejected'
    || value === 'reverted'
    || value === 'failed'
    ? value
    : null;
}

function sanitizeWorktreeReviewDecision(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const decision = value as Record<string, unknown>;
  return {
    action: worktreeReviewActionOrNull(decision.action),
    status: worktreeReviewStatusOrNull(decision.status),
    threadId: safeDiagnosticStringOrNull(decision.threadId),
    runId: safeDiagnosticStringOrNull(decision.runId),
    isolationMode: decision.isolationMode === 'git_worktree' ? 'git_worktree' : safeDiagnosticStringOrNull(decision.isolationMode),
    branchName: safeDiagnosticStringOrNull(decision.branchName),
    baseSha: safeDiagnosticStringOrNull(decision.baseSha),
    sourceWorkspaceRelativePath: safeDiagnosticPathStringOrNull(decision.sourceWorkspaceRelativePath),
    changedPaths: safeDiagnosticPathArray(decision.changedPaths),
    filesChanged: finiteNumberOrNull(decision.filesChanged),
    insertions: finiteNumberOrNull(decision.insertions),
    deletions: finiteNumberOrNull(decision.deletions),
    errorReason: safeDiagnosticStringOrNull(decision.errorReason),
    createdAt: safeDiagnosticStringOrNull(decision.createdAt)
  };
}

function sanitizeWorktreeCleanupDecision(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const decision = value as Record<string, unknown>;
  return {
    action: worktreeCleanupStatusOrNull(decision.action),
    status: worktreeCleanupStatusOrNull(decision.status),
    threadId: safeDiagnosticStringOrNull(decision.threadId),
    runId: safeDiagnosticStringOrNull(decision.runId),
    isolationMode: decision.isolationMode === 'git_worktree' ? 'git_worktree' : safeDiagnosticStringOrNull(decision.isolationMode),
    branchName: safeDiagnosticStringOrNull(decision.branchName),
    baseSha: safeDiagnosticStringOrNull(decision.baseSha),
    cleanupPolicy: safeDiagnosticStringOrNull(decision.cleanupPolicy),
    reviewStatus:
      decision.reviewStatus === 'pending'
        ? 'pending'
        : worktreeReviewStatusOrNull(decision.reviewStatus),
    errorReason: safeDiagnosticStringOrNull(decision.errorReason),
    createdAt: safeDiagnosticStringOrNull(decision.createdAt)
  };
}

function sanitizeStagedWorkspaceHunkReviewDecision(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const decision = value as Record<string, unknown>;
  const hunkIds = safeDiagnosticStringArray(decision.hunkIds);
  const acceptedHunkIds = safeDiagnosticStringArray(decision.acceptedHunkIds);
  const rejectedHunkIds = safeDiagnosticStringArray(decision.rejectedHunkIds);
  return {
    action: stagedWorkspaceReviewActionOrNull(decision.action),
    status: stagedWorkspaceReviewStatusOrNull(decision.status),
    threadId: safeDiagnosticStringOrNull(decision.threadId),
    runId: safeDiagnosticStringOrNull(decision.runId),
    source: decision.source === 'staged_workspace_preview' ? 'staged_workspace_preview' : safeDiagnosticStringOrNull(decision.source),
    isolationMode: decision.isolationMode === 'patch_buffer' ? 'patch_buffer' : safeDiagnosticStringOrNull(decision.isolationMode),
    stagedEventId: safeDiagnosticStringOrNull(decision.stagedEventId),
    stagedEventIndex: finiteNumberOrNull(decision.stagedEventIndex),
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
    errorReason: safeDiagnosticStringOrNull(decision.errorReason),
    createdAt: safeDiagnosticStringOrNull(decision.createdAt)
  };
}

function sanitizeWorktreeHunkReviewDecision(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const decision = value as Record<string, unknown>;
  const hunkIds = safeDiagnosticStringArray(decision.hunkIds);
  const acceptedHunkIds = safeDiagnosticStringArray(decision.acceptedHunkIds);
  const rejectedHunkIds = safeDiagnosticStringArray(decision.rejectedHunkIds);
  return {
    action: stagedWorkspaceReviewActionOrNull(decision.action),
    status: stagedWorkspaceReviewStatusOrNull(decision.status),
    threadId: safeDiagnosticStringOrNull(decision.threadId),
    runId: safeDiagnosticStringOrNull(decision.runId),
    source: decision.source === 'worktree_diff' ? 'worktree_diff' : safeDiagnosticStringOrNull(decision.source),
    isolationMode: decision.isolationMode === 'git_worktree' ? 'git_worktree' : safeDiagnosticStringOrNull(decision.isolationMode),
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
    errorReason: safeDiagnosticStringOrNull(decision.errorReason),
    createdAt: safeDiagnosticStringOrNull(decision.createdAt)
  };
}

export function sanitizeDiagnosticsPayload(
  payload: unknown,
  sanitizeRuntimeTraceDetail: (stage: string, detail: Record<string, unknown>) => unknown
): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  let nextPayload = payload as Record<string, unknown>;
  const stagedWorkspaceChangeSet =
    'stagedWorkspaceChangeSet' in nextPayload
      && nextPayload.stagedWorkspaceChangeSet
      && typeof nextPayload.stagedWorkspaceChangeSet === 'object'
      ? nextPayload.stagedWorkspaceChangeSet as Record<string, unknown>
      : null;
  if (stagedWorkspaceChangeSet) {
    nextPayload = {
      ...nextPayload,
      stagedWorkspaceChangeSet: sanitizeStagedWorkspaceChangeSet(stagedWorkspaceChangeSet)
    };
  }

  if (
    'worktreeReviewDecision' in nextPayload
    && nextPayload.worktreeReviewDecision
    && typeof nextPayload.worktreeReviewDecision === 'object'
  ) {
    nextPayload = {
      ...nextPayload,
      worktreeReviewDecision: sanitizeWorktreeReviewDecision(nextPayload.worktreeReviewDecision)
    };
  }

  if (
    'stagedWorkspaceHunkReviewDecision' in nextPayload
    && nextPayload.stagedWorkspaceHunkReviewDecision
    && typeof nextPayload.stagedWorkspaceHunkReviewDecision === 'object'
  ) {
    nextPayload = {
      ...nextPayload,
      stagedWorkspaceHunkReviewDecision: sanitizeStagedWorkspaceHunkReviewDecision(
        nextPayload.stagedWorkspaceHunkReviewDecision
      )
    };
  }

  if (
    'worktreeHunkReviewDecision' in nextPayload
    && nextPayload.worktreeHunkReviewDecision
    && typeof nextPayload.worktreeHunkReviewDecision === 'object'
  ) {
    nextPayload = {
      ...nextPayload,
      worktreeHunkReviewDecision: sanitizeWorktreeHunkReviewDecision(
        nextPayload.worktreeHunkReviewDecision
      )
    };
  }

  if (
    'worktreeCleanupDecision' in nextPayload
    && nextPayload.worktreeCleanupDecision
    && typeof nextPayload.worktreeCleanupDecision === 'object'
  ) {
    nextPayload = {
      ...nextPayload,
      worktreeCleanupDecision: sanitizeWorktreeCleanupDecision(nextPayload.worktreeCleanupDecision)
    };
  }

  const runtimeTrace =
    'runtimeTrace' in nextPayload && nextPayload.runtimeTrace && typeof nextPayload.runtimeTrace === 'object'
      ? (nextPayload.runtimeTrace as Record<string, unknown>)
      : null;
  if (runtimeTrace && typeof runtimeTrace.stage === 'string' && 'detail' in runtimeTrace) {
    nextPayload = {
      ...nextPayload,
      runtimeTrace: {
        ...runtimeTrace,
        detail:
          runtimeTrace.detail && typeof runtimeTrace.detail === 'object'
            ? sanitizeRuntimeTraceDetail(runtimeTrace.stage, runtimeTrace.detail as Record<string, unknown>)
            : runtimeTrace.detail
      }
    };
  }

  const activity =
    'activity' in nextPayload && nextPayload.activity && typeof nextPayload.activity === 'object'
      ? (nextPayload.activity as Record<string, unknown>)
      : null;
  if (activity && 'changeArtifact' in activity) {
    nextPayload = {
      ...nextPayload,
      activity: {
        ...activity,
        changeArtifact: sanitizeWorktreeChangeArtifact(activity.changeArtifact)
      }
    };
  }

  const progressSnapshot =
    'progressSnapshot' in nextPayload && nextPayload.progressSnapshot && typeof nextPayload.progressSnapshot === 'object'
      ? (nextPayload.progressSnapshot as Record<string, unknown>)
      : null;
  if (progressSnapshot && 'changeArtifact' in progressSnapshot) {
    nextPayload = {
      ...nextPayload,
      progressSnapshot: {
        ...progressSnapshot,
        changeArtifact: sanitizeWorktreeChangeArtifact(progressSnapshot.changeArtifact)
      }
    };
  }

  return nextPayload;
}
