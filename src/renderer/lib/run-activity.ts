import type {
  RunActivityInfo,
  RunChangeArtifact,
  RunEvent,
  RunProgressState,
  StagedWorkspaceHunkReviewDecision,
  StagedWorkspaceReviewDecision,
  StagedWorkspaceReviewInput,
  StagedWorkspaceReviewOperationKind,
  StagedWorkspaceReviewStatus,
  ThreadDetail,
  ThreadTurn,
  WorktreeCleanupDecision,
  WorktreeCleanupStatus,
  WorktreeHunkReviewDecision,
  WorktreeReviewDecision,
  WorktreeReviewInput,
  WorktreeReviewStatus
} from '../../shared/domain';
import {
  appendThinkingLine,
  deriveActiveHeading
} from './run-activity/reasoning';
import {
  appendIfMissing,
  appendLines,
  canMergeTerminalCommand,
  compactTerminalOutput,
  deriveTerminalCommandStatus,
  normalizeTerminalCommandLabel,
  sanitizeTerminalOutputLine,
  sanitizeTerminalOutputLines,
  terminalControlSequencePattern,
  terminalTimestampPattern
} from './run-activity/terminal-commands';
import type {
  RunActivityTimelineItem,
  RunActivityViewModel,
  RunReviewEvidenceViewModel,
  RunStagedWorkspaceReviewItem,
  RunTranscriptActivityItem,
  RunTranscriptAssistantItem,
  RunTranscriptChangeArtifactItem,
  RunTranscriptItem,
  RunTranscriptResolutionSummaryItem,
  RunWorktreeReviewItem,
  TerminalCommandViewModel,
  ThinkingLineViewModel
} from './run-activity/types';
import {
  formatElapsed,
  hasWorkedForEvidence
} from './run-activity/worked-summary';
import {
  compactAssistantDetailAfterResolutionSummary,
  compactAssistantFollowUps,
  compactOperationalAssistantNarration,
  deriveResolutionSummaryItem
} from './run-activity-resolution';
import {
  compactConcreteFollowupToolResults,
  compactRedundantToolCalls,
  deriveFriendlyToolCallDisplay,
  deriveToolResultDisplay
} from './run-activity/tool-calls';
import { formatVisibleRunErrorMessage } from './error-format';

export type {
  RunActivityTimelineItem,
  RunActivityTimelineTerminalItem,
  RunActivityTimelineThinkingItem,
  RunActivityViewModel,
  RunReviewEvidenceViewModel,
  RunStagedWorkspaceReviewItem,
  RunTranscriptActivityItem,
  RunTranscriptAssistantItem,
  RunTranscriptChangeArtifactItem,
  RunTranscriptItem,
  RunTranscriptResolutionSummaryItem,
  RunTranscriptStagedWorkspaceChangeItem,
  RunTranscriptWorkedForItem,
  RunTranscriptWorktreeWorkspaceChangeItem,
  RunWorktreeReviewItem,
  StagedWorkspaceProposalStatus,
  TerminalCommandViewModel,
  ThinkingLineViewModel,
  WorktreeCleanupUiStatus,
  WorktreeProposalStatus
} from './run-activity/types';

export function stagedWorkspaceReviewInput(change: RunStagedWorkspaceReviewItem): StagedWorkspaceReviewInput {
  return {
    threadId: change.threadId,
    runId: change.runId,
    stagedEventId: change.stagedEventId,
    stagedEventIndex: change.stagedEventIndex
  };
}

export function worktreeReviewInput(change: RunWorktreeReviewItem): WorktreeReviewInput {
  return {
    threadId: change.threadId,
    runId: change.runId
  };
}

export function stagedWorkspaceReviewKey(input: Pick<StagedWorkspaceReviewInput, 'threadId' | 'runId' | 'stagedEventId' | 'stagedEventIndex'>) {
  const selector = input.stagedEventId && input.stagedEventId.trim().length > 0
    ? `id:${input.stagedEventId}`
    : `index:${input.stagedEventIndex ?? 'unknown'}`;
  return `${input.threadId}:${input.runId}:${selector}`;
}

export function worktreeReviewKey(input: Pick<WorktreeReviewInput, 'threadId' | 'runId'>) {
  return `${input.threadId}:${input.runId}`;
}

function readDelta(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanMultiline(value: string) {
  return value
    .split(/\r?\n/u)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

const MCP_AUTH_FAILURE_MESSAGE = 'MCP tool unavailable: authentication required.';

function readString(value: unknown) {
  return typeof value === 'string' ? clean(value) : null;
}

function readRawString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const stagedWorkspaceToolNames = new Set(['mkdir', 'write_file', 'apply_patch']);
const stagedWorkspaceOperationKinds = new Set(['mkdir', 'write_file', 'apply_patch', 'delete']);
const stagedWorkspaceDecisionStatuses = new Set(['applied', 'rejected', 'reverted', 'failed']);
const worktreeReviewStatuses = new Set(['applied', 'rejected', 'reverted', 'failed']);
const worktreeCleanupStatuses = new Set(['cleaned', 'failed', 'refused']);

function readStagedWorkspaceToolName(value: unknown): RunStagedWorkspaceReviewItem['sourceToolName'] | null {
  return typeof value === 'string' && stagedWorkspaceToolNames.has(value)
    ? value as RunStagedWorkspaceReviewItem['sourceToolName']
    : null;
}

function readStagedWorkspaceOperationKind(value: unknown): StagedWorkspaceReviewOperationKind | null {
  return typeof value === 'string' && stagedWorkspaceOperationKinds.has(value)
    ? value as StagedWorkspaceReviewOperationKind
    : null;
}

function readStagedWorkspaceDecisionStatus(value: unknown): StagedWorkspaceReviewStatus | null {
  return typeof value === 'string' && stagedWorkspaceDecisionStatuses.has(value)
    ? value as StagedWorkspaceReviewStatus
    : null;
}

function readWorktreeReviewStatus(value: unknown): WorktreeReviewStatus | null {
  return typeof value === 'string' && worktreeReviewStatuses.has(value)
    ? value as WorktreeReviewStatus
    : null;
}

function readWorktreeCleanupStatus(value: unknown): WorktreeCleanupStatus | null {
  return typeof value === 'string' && worktreeCleanupStatuses.has(value)
    ? value as WorktreeCleanupStatus
    : null;
}

function readRunChangeArtifact(value: unknown): RunChangeArtifact | null {
  const record = recordValue(value);
  if (!record || !recordValue(record.summary) || !Array.isArray(record.files)) {
    return null;
  }

  return value as RunChangeArtifact;
}

function readOperationKindsFromOperations(value: unknown) {
  const kinds: StagedWorkspaceReviewOperationKind[] = [];
  if (!Array.isArray(value)) {
    return kinds;
  }

  for (const operation of value) {
    const record = recordValue(operation);
    const kind = record ? readStagedWorkspaceOperationKind(record.operation) : null;
    if (kind && !kinds.includes(kind)) {
      kinds.push(kind);
    }
  }

  return kinds;
}

function parseStagedWorkspaceReviewDecision(value: unknown): StagedWorkspaceReviewDecision | null {
  const record = recordValue(value);
  if (!record) {
    return null;
  }

  const action = record.action === 'applied' || record.action === 'rejected' || record.action === 'reverted' ? record.action : null;
  const status = readStagedWorkspaceDecisionStatus(record.status);
  const threadId = readRawString(record.threadId);
  const runId = readRawString(record.runId);
  const stagedEventId = readRawString(record.stagedEventId);
  const stagedEventIndex = readNumber(record.stagedEventIndex);
  const sourceToolName = readStagedWorkspaceToolName(record.sourceToolName);
  const isolationMode = record.isolationMode === 'patch_buffer' ? record.isolationMode : null;
  if (!action || !status || !threadId || !runId || !stagedEventId || stagedEventIndex === null || !sourceToolName || !isolationMode) {
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
    changedPaths: readStringArray(record.changedPaths),
    operationKinds: readStringArray(record.operationKinds)
      .map(readStagedWorkspaceOperationKind)
      .filter((kind): kind is StagedWorkspaceReviewOperationKind => Boolean(kind)),
    errorReason: readRawString(record.errorReason),
    createdAt: readRawString(record.createdAt) ?? ''
  };
}

function parseStagedWorkspaceHunkReviewDecision(value: unknown): StagedWorkspaceHunkReviewDecision | null {
  const record = recordValue(value);
  if (!record) {
    return null;
  }

  const action = record.action === 'applied' || record.action === 'rejected' || record.action === 'reverted'
    ? record.action
    : null;
  const status = readStagedWorkspaceDecisionStatus(record.status);
  const threadId = readRawString(record.threadId);
  const runId = readRawString(record.runId);
  const source = record.source === 'staged_workspace_preview' ? record.source : null;
  const isolationMode = record.isolationMode === 'patch_buffer' ? record.isolationMode : null;
  const stagedEventId = readRawString(record.stagedEventId);
  const stagedEventIndex = readNumber(record.stagedEventIndex);
  if (!action || !status || !threadId || !runId || !source || !isolationMode || !stagedEventId || stagedEventIndex === null) {
    return null;
  }

  return {
    action,
    status,
    threadId,
    runId,
    source,
    isolationMode,
    stagedEventId,
    stagedEventIndex,
    changedPaths: readStringArray(record.changedPaths),
    hunkIds: readStringArray(record.hunkIds),
    acceptedHunkIds: readStringArray(record.acceptedHunkIds),
    rejectedHunkIds: readStringArray(record.rejectedHunkIds),
    filesChanged: readNumber(record.filesChanged) ?? 0,
    insertions: readNumber(record.insertions) ?? 0,
    deletions: readNumber(record.deletions) ?? 0,
    errorReason: readRawString(record.errorReason),
    createdAt: readRawString(record.createdAt) ?? ''
  };
}

function parseWorktreeReviewDecision(value: unknown): WorktreeReviewDecision | null {
  const record = recordValue(value);
  if (!record) {
    return null;
  }

  const action = record.action === 'applied' || record.action === 'rejected' || record.action === 'reverted'
    ? record.action
    : null;
  const status = readWorktreeReviewStatus(record.status);
  const threadId = readRawString(record.threadId);
  const runId = readRawString(record.runId);
  const isolationMode = record.isolationMode === 'git_worktree' ? record.isolationMode : null;
  const branchName = readRawString(record.branchName);
  const baseSha = readRawString(record.baseSha);
  const sourceWorkspaceRelativePath = readRawString(record.sourceWorkspaceRelativePath);
  if (!action || !status || !threadId || !runId || !isolationMode || !branchName || !baseSha || !sourceWorkspaceRelativePath) {
    return null;
  }

  return {
    action,
    status,
    threadId,
    runId,
    isolationMode,
    branchName,
    baseSha,
    sourceWorkspaceRelativePath,
    changedPaths: readStringArray(record.changedPaths),
    filesChanged: readNumber(record.filesChanged) ?? 0,
    insertions: readNumber(record.insertions) ?? 0,
    deletions: readNumber(record.deletions) ?? 0,
    errorReason: readRawString(record.errorReason),
    createdAt: readRawString(record.createdAt) ?? ''
  };
}

function parseWorktreeHunkReviewDecision(value: unknown): WorktreeHunkReviewDecision | null {
  const record = recordValue(value);
  if (!record) {
    return null;
  }

  const action = record.action === 'applied' || record.action === 'rejected' || record.action === 'reverted'
    ? record.action
    : null;
  const status = readStagedWorkspaceDecisionStatus(record.status);
  const threadId = readRawString(record.threadId);
  const runId = readRawString(record.runId);
  const source = record.source === 'worktree_diff' ? record.source : null;
  const isolationMode = record.isolationMode === 'git_worktree' ? record.isolationMode : null;
  const branchName = readRawString(record.branchName);
  const baseSha = readRawString(record.baseSha);
  const sourceWorkspaceRelativePath = readRawString(record.sourceWorkspaceRelativePath);
  if (!action || !status || !threadId || !runId || !source || !isolationMode || !branchName || !baseSha || !sourceWorkspaceRelativePath) {
    return null;
  }

  return {
    action,
    status,
    threadId,
    runId,
    source,
    isolationMode,
    branchName,
    baseSha,
    sourceWorkspaceRelativePath,
    changedPaths: readStringArray(record.changedPaths),
    hunkIds: readStringArray(record.hunkIds),
    acceptedHunkIds: readStringArray(record.acceptedHunkIds),
    rejectedHunkIds: readStringArray(record.rejectedHunkIds),
    filesChanged: readNumber(record.filesChanged) ?? 0,
    insertions: readNumber(record.insertions) ?? 0,
    deletions: readNumber(record.deletions) ?? 0,
    errorReason: readRawString(record.errorReason),
    createdAt: readRawString(record.createdAt) ?? ''
  };
}

function parseWorktreeCleanupDecision(value: unknown): WorktreeCleanupDecision | null {
  const record = recordValue(value);
  if (!record) {
    return null;
  }

  const action = readWorktreeCleanupStatus(record.action);
  const status = readWorktreeCleanupStatus(record.status);
  const reviewStatus = record.reviewStatus === 'pending'
    ? record.reviewStatus
    : readWorktreeReviewStatus(record.reviewStatus);
  const threadId = readRawString(record.threadId);
  const runId = readRawString(record.runId);
  const isolationMode = record.isolationMode === 'git_worktree' ? record.isolationMode : null;
  const branchName = readRawString(record.branchName);
  const baseSha = readRawString(record.baseSha);
  const cleanupPolicy = readRawString(record.cleanupPolicy);
  if (!action || !status || !reviewStatus || !threadId || !runId || !isolationMode || !branchName || !baseSha || !cleanupPolicy) {
    return null;
  }

  return {
    action,
    status,
    threadId,
    runId,
    isolationMode,
    branchName,
    baseSha,
    cleanupPolicy,
    reviewStatus,
    errorReason: readRawString(record.errorReason),
    createdAt: readRawString(record.createdAt) ?? ''
  };
}

export function deriveStagedWorkspaceReviewItems(events: RunEvent[], runId: string) {
  const decisionsByStagedEventId = new Map<string, StagedWorkspaceReviewDecision>();
  const hunkDecisionsByStagedEventId = new Map<string, StagedWorkspaceHunkReviewDecision>();
  for (const event of events) {
    if (event.runId !== runId || event.eventType !== 'info') {
      continue;
    }

    const decision = parseStagedWorkspaceReviewDecision(event.payload.stagedWorkspaceReviewDecision);
    if (decision) {
      decisionsByStagedEventId.set(decision.stagedEventId, decision);
    }

    const hunkDecision = parseStagedWorkspaceHunkReviewDecision(event.payload.stagedWorkspaceHunkReviewDecision);
    if (hunkDecision) {
      hunkDecisionsByStagedEventId.set(hunkDecision.stagedEventId, hunkDecision);
    }
  }

  const items: RunStagedWorkspaceReviewItem[] = [];
  let stagedEventIndex = 0;
  for (const event of events) {
    if (event.runId !== runId || event.eventType !== 'info') {
      continue;
    }

    const changeSet = recordValue(event.payload.stagedWorkspaceChangeSet);
    if (!changeSet) {
      continue;
    }

    const sourceToolName = readStagedWorkspaceToolName(changeSet.sourceToolName);
    const isolationMode = changeSet.isolationMode === 'patch_buffer' ? changeSet.isolationMode : null;
    if (!sourceToolName || !isolationMode || changeSet.status !== 'proposed') {
      continue;
    }

    const summary = recordValue(changeSet.summary);
    const decision = decisionsByStagedEventId.get(event.id) ?? null;
    const hunkDecision = hunkDecisionsByStagedEventId.get(event.id) ?? null;
    const operationKinds = decision?.operationKinds.length
      ? decision.operationKinds
      : readOperationKindsFromOperations(changeSet.operations);

    items.push({
      id: `staged-workspace:${event.id}`,
      threadId: event.threadId,
      runId: event.runId,
      stagedEventId: event.id,
      stagedEventIndex,
      createdAt: event.createdAt,
      sourceToolName,
      isolationMode,
      status: decision?.status ?? 'pending',
      requestedPath: readRawString(changeSet.requestedPath),
      changedPaths: readStringArray(changeSet.changedPaths),
      operationCount: Array.isArray(changeSet.operations) ? changeSet.operations.length : 0,
      operationKinds,
      filesChanged: readNumber(summary?.filesChanged) ?? 0,
      insertions: readNumber(summary?.insertions) ?? 0,
      deletions: readNumber(summary?.deletions) ?? 0,
      decision,
      hunkDecision
    });
    stagedEventIndex += 1;
  }

  return items;
}

export function deriveWorktreeReviewItems(events: RunEvent[], runId: string) {
  let latestArtifactEvent: RunEvent | null = null;
  let latestArtifact: RunChangeArtifact | null = null;
  let latestEvidence: Record<string, unknown> | null = null;
  let latestDecision: WorktreeReviewDecision | null = null;
  let latestHunkDecision: WorktreeHunkReviewDecision | null = null;
  let latestCleanupDecision: WorktreeCleanupDecision | null = null;

  for (const event of events) {
    if (event.runId !== runId || event.eventType !== 'info') {
      continue;
    }

    const activity = readActivityInfo(event.payload.activity);
    const artifact = readRunChangeArtifact(activity?.changeArtifact);
    if (artifact?.source === 'worktree_diff') {
      latestArtifactEvent = event;
      latestArtifact = artifact;
    }

    const evidence = recordValue(event.payload.worktreeChangeEvidence);
    if (evidence?.isolationMode === 'git_worktree') {
      latestEvidence = evidence;
    }

    const decision = parseWorktreeReviewDecision(event.payload.worktreeReviewDecision);
    if (decision) {
      latestDecision = decision;
    }

    const hunkDecision = parseWorktreeHunkReviewDecision(event.payload.worktreeHunkReviewDecision);
    if (hunkDecision) {
      latestHunkDecision = hunkDecision;
    }

    const cleanupDecision = parseWorktreeCleanupDecision(event.payload.worktreeCleanupDecision);
    if (cleanupDecision) {
      latestCleanupDecision = cleanupDecision;
    }
  }

  if (!latestArtifactEvent || !latestArtifact) {
    return [];
  }

  const changedPaths = latestDecision?.changedPaths.length
    ? latestDecision.changedPaths
    : readStringArray(latestEvidence?.changedPaths).length
      ? readStringArray(latestEvidence?.changedPaths)
      : latestArtifact.files.map((file) => file.path);
  const branchName = latestDecision?.branchName ?? readRawString(latestEvidence?.branchName);
  const baseSha = latestDecision?.baseSha ?? readRawString(latestEvidence?.baseSha);
  const sourceWorkspaceRelativePath =
    latestDecision?.sourceWorkspaceRelativePath ?? readRawString(latestEvidence?.sourceWorkspaceRelativePath);
  const filesChanged = latestDecision?.filesChanged ?? readNumber(latestEvidence?.filesChanged) ?? latestArtifact.summary.filesChanged;
  const insertions = latestDecision?.insertions ?? readNumber(latestEvidence?.insertions) ?? latestArtifact.summary.insertions;
  const deletions = latestDecision?.deletions ?? readNumber(latestEvidence?.deletions) ?? latestArtifact.summary.deletions;

  return [
    {
      id: `worktree-review:${latestArtifactEvent.id}`,
      threadId: latestArtifactEvent.threadId,
      runId: latestArtifactEvent.runId,
      artifactEventId: latestArtifactEvent.id,
      createdAt: latestArtifactEvent.createdAt,
      isolationMode: 'git_worktree' as const,
      status: latestDecision?.status ?? 'pending',
      branchName,
      baseSha,
      sourceWorkspaceRelativePath,
      changedPaths,
      filesChanged,
      insertions,
      deletions,
      errorReason: latestDecision?.errorReason ?? null,
      decision: latestDecision,
      cleanupStatus: latestCleanupDecision?.status ?? 'pending',
      cleanupErrorReason: latestCleanupDecision?.errorReason ?? null,
      cleanupDecision: latestCleanupDecision,
      hunkDecision: latestHunkDecision,
      artifact: latestArtifact
    }
  ];
}

const noisyOperationalMessagePatterns = [
  /^<meta\b/iu,
  /^<\/?(?:html|body|main|div|noscript|script|style|svg|path)\b/iu,
  /^<[^>]+>$/u,
  /^[A-Za-z][A-Za-z0-9:_-]*="[^"]*"$/u,
  /^(?:d|fill|stroke|strokeWidth|viewBox|xmlns|class|role|width|height)=/u,
  /^>$/u,
  /^\/>$/u,
  /\bcodex_core::/u,
  /\bmcp::service::client\b/u,
  /\brmcp::\s*transport::\s*worker\b/u,
  /\bcodex_features\b/u,
  /\bReceived unknown status update\b/u,
  /\bstartup remote plugin sync failed\b/u,
  /\bWARN\b.*\b(?:codex_|mcp::)\b/u
];

function sanitizeOperationalTranscriptText(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(terminalControlSequencePattern, '')
    .replace(terminalTimestampPattern, ' ')
    .split(/\r?\n/u)
    .map((line) => line.replace(/[ \t\f\v]+/gu, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();

  if (!normalized) {
    return null;
  }

  if (
    /\b(?:mcp|rmcp)::/iu.test(normalized)
    && /\bAuthRequired\b|\binvalid_token\b|\bMissing or invalid access token\b|\bwww_authenticate_header\b/iu.test(normalized)
  ) {
    return MCP_AUTH_FAILURE_MESSAGE;
  }

  return normalized;
}

function shouldSuppressOperationalMessage(value: string | null) {
  if (!value) {
    return false;
  }

  const normalized = value
    .replace(terminalControlSequencePattern, '')
    .replace(terminalTimestampPattern, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  if (!normalized) {
    return true;
  }

  return noisyOperationalMessagePatterns.some((pattern) => pattern.test(normalized));
}

function sanitizeOperationalMessage(value: string | null) {
  const sanitized = sanitizeOperationalTranscriptText(value);
  return shouldSuppressOperationalMessage(sanitized) ? null : sanitized;
}

function normalizeWorkspaceCwd(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = clean(value);
  if (!normalized) {
    return null;
  }

  if (normalized === '.' || normalized === './' || normalized === '.\\') {
    return 'Workspace root';
  }

  return normalized;
}

function readCwd(value: unknown) {
  return typeof value === 'string' ? normalizeWorkspaceCwd(value) : null;
}

function readMultilineString(value: unknown) {
  return typeof value === 'string' ? cleanMultiline(value) : null;
}

function readActivityInfo(value: unknown): RunActivityInfo | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<RunActivityInfo>;
  if ((candidate.kind === 'thinking' || candidate.kind === 'guidance' || candidate.kind === 'skill' || candidate.kind === 'memory_recall' || candidate.kind === 'memory_checkpoint' || candidate.kind === 'context_compaction' || candidate.kind === 'web_search' || candidate.kind === 'delegation' || candidate.kind === 'tool_call' || candidate.kind === 'tool_result' || candidate.kind === 'file_edit' || candidate.kind === 'file_write' || candidate.kind === 'mkdir' || candidate.kind === 'terminal_command' || candidate.kind === 'terminal_output' || candidate.kind === 'file_open' || candidate.kind === 'file_read' || candidate.kind === 'file_search' || candidate.kind === 'change_summary') && typeof candidate.summary === 'string') {
    return {
      kind: candidate.kind,
      summary: clean(candidate.summary),
      phase: candidate.phase,
      providerEventType: readString(candidate.providerEventType),
      toolName: readString(candidate.toolName),
      status: readString(candidate.status),
      query: readString(candidate.query),
      command: readString(candidate.command),
      cwd: readCwd(candidate.cwd),
      isolationMode: readString(candidate.isolationMode),
      url: readString(candidate.url),
      path: readString(candidate.path),
      text: candidate.kind === 'terminal_command' || candidate.kind === 'terminal_output' ? (typeof candidate.text === 'string' ? sanitizeTerminalOutputLine(candidate.text) || null : null) : readMultilineString(candidate.text),
      outputLines:
        candidate.kind === 'terminal_command' || candidate.kind === 'terminal_output'
          ? sanitizeTerminalOutputLines(Array.isArray(candidate.outputLines) ? candidate.outputLines.filter((value): value is string => typeof value === 'string') : null)
          : Array.isArray(candidate.outputLines)
            ? candidate.outputLines
                .filter((value): value is string => typeof value === 'string')
                .map(clean)
                .filter(Boolean)
            : null,
      background: candidate.background === true,
      changeArtifact: candidate.changeArtifact ?? null
    };
  }

  return null;
}

function shouldSuppressTranscriptToolResult(activity: RunActivityInfo) {
  if (activity.kind !== 'tool_result') {
    return false;
  }

  const normalizedStatus = activity.status?.toLowerCase() ?? null;
  if (normalizedStatus === 'error' || normalizedStatus === 'failed' || normalizedStatus === 'stopped') {
    return false;
  }

  switch (activity.toolName) {
    case 'list_directory':
    case 'read_file':
    case 'write_file':
    case 'mkdir':
    case 'create_directory':
    case 'open_file':
    case 'search_files':
    case 'grep_search':
    case 'glob_search':
    case 'run_command':
    case 'exec_command':
      return true;
    default:
      break;
  }

  const normalizedSummary = clean(activity.summary);
  const normalizedText = activity.text ? cleanMultiline(activity.text) : null;
  const hasMeaningfulDetail = Boolean(normalizedText && normalizedText !== normalizedSummary);

  return !activity.url
    && !activity.path
    && !hasMeaningfulDetail
    && /^(Completed|Finished|Applied|Created|Opened|Read|Searched|Listed|Ran)\b/i.test(normalizedSummary);
}

function hasVisibleTranscriptText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isControlPlaneHiddenRunEvent(event: RunEvent) {
  if (event.payload.transcriptVisible === false) {
    return true;
  }

  return event.payload.eventKind === 'internal_runtime_reminder'
    || event.payload.eventKind === 'provider_diagnostic';
}

function isInternalRuntimeReminderText(value: string | null | undefined) {
  return typeof value === 'string' && /^Internal runtime reminder:/iu.test(value.trim());
}

function shouldSuppressTranscriptThinkingActivity(activity: Extract<RunActivityInfo, { kind: 'thinking' }>) {
  return activity.providerEventType === 'ollama_tool_loop_thinking'
    && isInternalRuntimeReminderText(activity.text ?? activity.summary);
}

function isInspectionActivityItem(item: RunTranscriptItem): item is RunTranscriptActivityItem {
  return item.kind === 'activity_line' && (item.activityKind === 'file_open' || item.activityKind === 'file_read' || item.activityKind === 'file_search');
}

function isWriteActivityItem(item: RunTranscriptItem): item is RunTranscriptActivityItem {
  return item.kind === 'activity_line' && (item.activityKind === 'file_write' || item.activityKind === 'mkdir');
}

function isToolCallActivityItem(item: RunTranscriptItem): item is RunTranscriptActivityItem {
  return item.kind === 'activity_line' && item.activityKind === 'tool_call';
}

function formatInspectionGroupLabel(items: RunTranscriptActivityItem[]) {
  const uniquePaths = Array.from(
    new Set(
      items
        .map((item) => item.path?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );

  if (uniquePaths.length > 0) {
    return `Inspected ${uniquePaths.length} ${uniquePaths.length === 1 ? 'file' : 'files'}`;
  }

  return `Inspected ${items.length} locations`;
}

function formatInspectionGroupText(items: RunTranscriptActivityItem[]) {
  return items
    .map((item) => item.path ?? item.label ?? item.text)
    .filter((value, index, values): value is string => Boolean(value?.trim()) && values.indexOf(value) === index)
    .join('\n');
}

function formatWriteGroupLabel(items: RunTranscriptActivityItem[]) {
  const fileWrites = items.filter((item) => item.activityKind === 'file_write').length;
  const directories = items.filter((item) => item.activityKind === 'mkdir').length;

  if (fileWrites > 0 && directories > 0) {
    return `Applied ${items.length} filesystem changes`;
  }

  if (fileWrites > 0) {
    return `Updated ${fileWrites} ${fileWrites === 1 ? 'file' : 'files'}`;
  }

  return `Created ${directories} ${directories === 1 ? 'folder' : 'folders'}`;
}

function formatWriteGroupText(items: RunTranscriptActivityItem[]) {
  return items
    .map((item) => item.path ?? item.label ?? item.text)
    .filter((value, index, values): value is string => Boolean(value?.trim()) && values.indexOf(value) === index)
    .join('\n');
}

function compactTranscriptActivityItems(items: RunTranscriptItem[]) {
  const results: RunTranscriptItem[] = [];
  let pendingInspectionItems: RunTranscriptActivityItem[] = [];
  let pendingWriteItems: RunTranscriptActivityItem[] = [];

  const flushInspectionItems = () => {
    if (pendingInspectionItems.length === 0) {
      return;
    }

    if (pendingInspectionItems.length === 1) {
      results.push(pendingInspectionItems[0]);
      pendingInspectionItems = [];
      return;
    }

    const text = formatInspectionGroupText(pendingInspectionItems);
    results.push({
      id: `${pendingInspectionItems[0].id}:inspection-group`,
      kind: 'activity_line',
      activityKind: 'inspection_group',
      providerEventType: null,
      toolName: null,
      label: formatInspectionGroupLabel(pendingInspectionItems),
      text,
      url: null,
      path: null,
      command: null,
      cwd: null,
      isolationMode: null,
      status: null,
      outputLines: []
    });
    pendingInspectionItems = [];
  };

  const flushWriteItems = () => {
    if (pendingWriteItems.length === 0) {
      return;
    }

    if (pendingWriteItems.length === 1) {
      results.push(pendingWriteItems[0]);
      pendingWriteItems = [];
      return;
    }

    results.push({
      id: `${pendingWriteItems[0].id}:write-group`,
      kind: 'activity_line',
      activityKind: 'write_group',
      providerEventType: null,
      toolName: null,
      label: formatWriteGroupLabel(pendingWriteItems),
      text: formatWriteGroupText(pendingWriteItems),
      url: null,
      path: null,
      command: null,
      cwd: null,
      isolationMode: null,
      status: null,
      outputLines: []
    });
    pendingWriteItems = [];
  };

  for (const item of items) {
    if (isInspectionActivityItem(item)) {
      flushWriteItems();
      pendingInspectionItems.push(item);
      continue;
    }

    if (isWriteActivityItem(item)) {
      flushInspectionItems();
      pendingWriteItems.push(item);
      continue;
    }

    flushInspectionItems();
    flushWriteItems();
    results.push(item);
  }

  flushInspectionItems();
  flushWriteItems();
  return results;
}

function compactGenericThinkingRows(items: RunTranscriptItem[]) {
  return items;
}

function compactOperationalMetaRows(items: RunTranscriptItem[]) {
  const hasResolvedAssistantContent = items.some((item) => item.kind === 'assistant_text' || item.kind === 'resolution_summary');
  if (!hasResolvedAssistantContent) {
    return items;
  }

  return items.filter((item) => {
    if (item.kind !== 'activity_line') {
      return true;
    }

    return item.activityKind !== 'memory_checkpoint' && item.activityKind !== 'delegation';
  });
}

const transcriptWordCharClass = `\\p{L}\\p{N}\\p{M}`;
const transcriptContinuationStartPattern = new RegExp(`^[\\p{Ll}\\p{Lm}\\p{Lo}\\p{Nd}\\p{Nl}\\p{Mn}\\p{Mc}]`, 'u');
const transcriptTrailingFragmentPattern = new RegExp(`(^|[^${transcriptWordCharClass}])([${transcriptWordCharClass}][${transcriptWordCharClass}'’_-]{0,23})$`, 'u');

function takeTrailingAssistantFragment(items: RunTranscriptItem[], incomingDelta: string) {
  if (!transcriptContinuationStartPattern.test(incomingDelta)) {
    return '';
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind !== 'assistant_text') {
      continue;
    }

    const match = item.text.match(transcriptTrailingFragmentPattern);
    if (!match) {
      return '';
    }

    const prefix = match[1] ?? '';
    const fragment = match[2] ?? '';
    if (!fragment) {
      return '';
    }

    item.text = item.text.slice(0, item.text.length - fragment.length);
    if (item.text.endsWith(' ') && prefix) {
      item.text = item.text.slice(0, -1);
    }
    if (!item.text.trim()) {
      items.splice(index, 1);
    }
    return fragment;
  }

  return '';
}

function deriveRunActivity(runId: string, events: RunEvent[]): RunActivityViewModel {
  let startedAt: string | null = null;
  let finishedAt: string | null = null;
  let state: RunActivityViewModel['state'] = 'completed';
  const thinkingLines: ThinkingLineViewModel[] = [];
  const terminalCommands: TerminalCommandViewModel[] = [];
  const timelineItems: RunActivityTimelineItem[] = [];
  let currentTerminalCommand: TerminalCommandViewModel | null = null;
  let changeArtifact: RunChangeArtifact | null = null;
  let outcomeMessage: string | null = null;

  for (const event of events) {
    if (event.eventType === 'started') {
      startedAt ??= event.createdAt;
      state = 'running';
      continue;
    }

    if (event.eventType === 'completed') {
      finishedAt = event.createdAt;
      state = 'completed';
      continue;
    }

    if (event.eventType === 'failed') {
      finishedAt = event.createdAt;
      state = 'failed';
      outcomeMessage = formatVisibleRunErrorMessage(readString(event.payload.message));
      continue;
    }

    if (event.eventType === 'aborted') {
      finishedAt = event.createdAt;
      state = 'aborted';
      const message = readString(event.payload.message);
      outcomeMessage = message ? formatVisibleRunErrorMessage(message) : null;
      continue;
    }

    if (event.eventType !== 'info') {
      continue;
    }

    if (isControlPlaneHiddenRunEvent(event)) {
      continue;
    }

    const message = sanitizeOperationalMessage(readString(event.payload.message));
    const activity = readActivityInfo(event.payload.activity);
    if (activity?.kind === 'change_summary' && activity.changeArtifact) {
      changeArtifact = activity.changeArtifact;
    }
    if (activity?.kind === 'memory_recall') {
      continue;
    }

    if (activity?.kind === 'thinking' || activity?.kind === 'guidance' || activity?.kind === 'skill' || activity?.kind === 'memory_checkpoint' || activity?.kind === 'context_compaction' || activity?.kind === 'web_search' || activity?.kind === 'delegation' || activity?.kind === 'tool_call' || activity?.kind === 'tool_result' || activity?.kind === 'file_edit' || activity?.kind === 'file_write' || activity?.kind === 'mkdir' || activity?.kind === 'file_open' || activity?.kind === 'file_read' || activity?.kind === 'file_search') {
      const toolCallDisplay = activity.kind === 'tool_call'
        ? deriveFriendlyToolCallDisplay(activity)
        : null;
      const toolResultDisplay = activity.kind === 'tool_result'
        ? deriveToolResultDisplay(activity)
        : null;
      const summary = activity.kind === 'thinking' ? sanitizeOperationalMessage(activity.summary) ?? '' : activity.summary;
      const text = activity.kind === 'thinking'
        ? sanitizeOperationalMessage(activity.text ?? activity.summary) ?? ''
        : (toolCallDisplay?.text ?? toolResultDisplay?.text ?? activity.text ?? activity.summary);
      const line: Omit<ThinkingLineViewModel, 'id'> = {
        kind: activity.kind,
        label: activity.kind === 'thinking' ? summary : (toolCallDisplay?.label ?? toolResultDisplay?.label ?? activity.summary),
        text,
        url: activity.url ?? null,
        path: activity.path ?? null
      };
      appendThinkingLine(thinkingLines, line, event.id);
      const appendedLine = thinkingLines[thinkingLines.length - 1];
      if (appendedLine && appendedLine.id === `${event.id}:${thinkingLines.length - 1}`) {
        timelineItems.push({
          id: `thinking:${appendedLine.id}`,
          kind: 'thinking',
          line: appendedLine
        });
      }
      continue;
    }

    if (activity?.kind === 'terminal_command') {
      const nextStatus = deriveTerminalCommandStatus(activity);

      if (canMergeTerminalCommand(currentTerminalCommand, activity)) {
        currentTerminalCommand.status = nextStatus;
        currentTerminalCommand.label = normalizeTerminalCommandLabel(activity.summary, activity.command ?? currentTerminalCommand.command, nextStatus);
        currentTerminalCommand.command = activity.command ?? currentTerminalCommand.command;
        currentTerminalCommand.cwd = activity.cwd ?? currentTerminalCommand.cwd;
        currentTerminalCommand.isolationMode = activity.isolationMode ?? currentTerminalCommand.isolationMode;
        currentTerminalCommand.finishedAt = nextStatus === 'running' ? null : event.createdAt;
        currentTerminalCommand.durationLabel = nextStatus === 'running'
          ? null
          : formatElapsed(currentTerminalCommand.startedAt, currentTerminalCommand.finishedAt);
        appendLines(currentTerminalCommand.outputLines, activity.outputLines);
        currentTerminalCommand.outputLines = compactTerminalOutput(currentTerminalCommand.command, currentTerminalCommand.outputLines);
        continue;
      }

      currentTerminalCommand = {
        id: event.id,
        label: normalizeTerminalCommandLabel(activity.summary, activity.command ?? null, nextStatus),
        command: activity.command ?? null,
        cwd: activity.cwd ?? null,
        isolationMode: activity.isolationMode ?? null,
        status: nextStatus,
        startedAt: event.createdAt,
        finishedAt: nextStatus === 'running' ? null : event.createdAt,
        durationLabel: null,
        outputLines: compactTerminalOutput(activity.command ?? null, activity.outputLines ? [...activity.outputLines] : [])
      };
      terminalCommands.push(currentTerminalCommand);
      timelineItems.push({
        id: `terminal:${currentTerminalCommand.id}`,
        kind: 'terminal_command',
        command: currentTerminalCommand
      });
      continue;
    }

      if (activity?.kind === 'terminal_output') {
      if (currentTerminalCommand) {
        appendLines(currentTerminalCommand.outputLines, activity.outputLines);
        if (!activity.outputLines?.length) {
          appendIfMissing(currentTerminalCommand.outputLines, activity.text ?? activity.summary);
        }
        currentTerminalCommand.outputLines = compactTerminalOutput(currentTerminalCommand.command, currentTerminalCommand.outputLines);
      }
      continue;
    }

    if (message) {
      const line: Omit<ThinkingLineViewModel, 'id'> = {
        kind: 'thinking',
        label: message,
        text: activity?.text ?? message,
        url: null,
        path: null
      };
      appendThinkingLine(thinkingLines, line, event.id);
      const appendedLine = thinkingLines[thinkingLines.length - 1];
      if (appendedLine && appendedLine.id === `${event.id}:${thinkingLines.length - 1}`) {
        timelineItems.push({
          id: `thinking:${appendedLine.id}`,
          kind: 'thinking',
          line: appendedLine
        });
      }
    }
  }

  return {
    runId,
    state,
    startedAt,
    finishedAt,
    outcomeMessage,
    thinkingLines,
    terminalCommands,
    timelineItems,
    activeHeading: deriveActiveHeading(thinkingLines, terminalCommands, state),
    workedForLabel: hasWorkedForEvidence({ thinkingLines, terminalCommands, changeArtifact })
      ? formatElapsed(startedAt, finishedAt)
      : null,
    changeArtifact
  };
}

export function deriveRunActivityMap(thread: ThreadDetail | null) {
  if (!thread) {
    return {} as Record<string, RunActivityViewModel>;
  }

  const grouped = new Map<string, RunEvent[]>();
  for (const event of thread.rawOutput) {
    const bucket = grouped.get(event.runId) ?? [];
    bucket.push(event);
    grouped.set(event.runId, bucket);
  }

  return Object.fromEntries(Array.from(grouped.entries()).map(([runId, events]) => [runId, deriveRunActivity(runId, events)])) as Record<string, RunActivityViewModel>;
}

function deriveRunTranscriptItems(events: RunEvent[], assistantTurn: ThreadTurn | null = null): RunTranscriptItem[] {
  let items: RunTranscriptItem[] = [];
  const changeArtifacts: RunTranscriptChangeArtifactItem[] = [];
  const stagedWorkspaceChanges = events[0]?.runId
    ? deriveStagedWorkspaceReviewItems(events, events[0].runId).map((change): RunTranscriptStagedWorkspaceChangeItem => ({
        id: change.id,
        kind: 'staged_workspace_change',
        label: 'Proposed workspace changes',
        change
      }))
    : [];
  const worktreeWorkspaceChanges = events[0]?.runId
    ? deriveWorktreeReviewItems(events, events[0].runId).map((change): RunTranscriptWorktreeWorkspaceChangeItem => ({
        id: change.id,
        kind: 'worktree_workspace_change',
        label: 'Worktree workspace changes',
        change
      }))
    : [];
  let assistantBuffer = '';
  let assistantSeed = '';
  let currentTerminalItem: RunTranscriptActivityItem | null = null;
  let startedAt: string | null = null;
  let finishedAt: string | null = null;
  let runState: 'completed' | 'failed' | 'aborted' | null = null;
  let failureMessage: string | null = null;

  const flushAssistant = () => {
    const text = assistantBuffer;
    if (!text) {
      return;
    }

    items.push({
      id: assistantSeed || `assistant:${items.length}`,
      kind: 'assistant_text',
      text,
      sources: assistantTurn?.sources ?? []
    });
    assistantBuffer = '';
    assistantSeed = '';
  };

  for (const event of events) {
    if (event.eventType === 'started') {
      startedAt ??= event.createdAt;
    } else if (event.eventType === 'completed' || event.eventType === 'failed' || event.eventType === 'aborted') {
      finishedAt = event.createdAt;
      runState = event.eventType;
      if (event.eventType === 'failed') {
        failureMessage = formatVisibleRunErrorMessage(readString(event.payload.message));
      }
    }

    if (event.eventType === 'delta') {
      const delta = readDelta(event.payload.delta);
      if (delta) {
        if (!assistantBuffer) {
          assistantBuffer = takeTrailingAssistantFragment(items, delta);
        }
        if (!assistantSeed) {
          assistantSeed = event.id;
        }
        assistantBuffer += delta;
      }
      continue;
    }

    if (event.eventType !== 'info') {
      if (event.eventType === 'completed' || event.eventType === 'failed' || event.eventType === 'aborted') {
        continue;
      }

      flushAssistant();
      continue;
    }

    if (isControlPlaneHiddenRunEvent(event)) {
      continue;
    }

    flushAssistant();

    const message = sanitizeOperationalMessage(readString(event.payload.message));
    const activity = readActivityInfo(event.payload.activity);
    if (activity?.kind === 'change_summary' && activity.changeArtifact) {
      if (activity.changeArtifact.source === 'worktree_diff') {
        continue;
      }

      changeArtifacts.push({
        id: `changes:${event.id}`,
        kind: 'change_artifact',
        label: activity.summary,
        artifact: activity.changeArtifact
      });
      continue;
    }
    if (activity?.kind === 'memory_recall') {
      continue;
    }
    const activityKind = activity?.kind === 'thinking' || activity?.kind === 'guidance' || activity?.kind === 'skill' || activity?.kind === 'memory_checkpoint' || activity?.kind === 'context_compaction' || activity?.kind === 'web_search' || activity?.kind === 'delegation' || activity?.kind === 'tool_call' || activity?.kind === 'file_edit' || activity?.kind === 'file_write' || activity?.kind === 'mkdir' || activity?.kind === 'file_open' || activity?.kind === 'file_read' || activity?.kind === 'file_search' ? activity.kind : null;
    const toolResultDisplay = activity?.kind === 'tool_result'
      ? deriveToolResultDisplay(activity)
      : null;

    if (activity?.kind === 'terminal_command') {
      const nextStatus = deriveTerminalCommandStatus(activity);

      if (canMergeTerminalCommand(currentTerminalItem, activity)) {
        currentTerminalItem.status = nextStatus;
        currentTerminalItem.label = normalizeTerminalCommandLabel(activity.summary, activity.command ?? currentTerminalItem.command, nextStatus);
        currentTerminalItem.text = normalizeTerminalCommandLabel(activity.summary, activity.command ?? currentTerminalItem.command, nextStatus);
        currentTerminalItem.command = activity.command ?? currentTerminalItem.command;
        currentTerminalItem.cwd = activity.cwd ?? currentTerminalItem.cwd;
        currentTerminalItem.isolationMode = activity.isolationMode ?? currentTerminalItem.isolationMode;
        currentTerminalItem.finishedAt = nextStatus === 'running' ? null : event.createdAt;
        currentTerminalItem.durationLabel = nextStatus === 'running'
          ? null
          : formatElapsed(currentTerminalItem.startedAt, currentTerminalItem.finishedAt);
        appendLines(currentTerminalItem.outputLines, activity.outputLines);
        currentTerminalItem.outputLines = compactTerminalOutput(currentTerminalItem.command, currentTerminalItem.outputLines);
        continue;
      }

      currentTerminalItem = {
        id: event.id,
        kind: 'activity_line',
        activityKind: 'terminal_command',
        providerEventType: activity.providerEventType ?? null,
        toolName: null,
        label: normalizeTerminalCommandLabel(activity.summary, activity.command ?? null, nextStatus),
        text: normalizeTerminalCommandLabel(activity.summary, activity.command ?? null, nextStatus),
        url: null,
        path: null,
        command: activity.command ?? null,
        cwd: activity.cwd ?? null,
        isolationMode: activity.isolationMode ?? null,
        status: nextStatus,
        startedAt: event.createdAt,
        finishedAt: nextStatus === 'running' ? null : event.createdAt,
        durationLabel: null,
        outputLines: compactTerminalOutput(activity.command ?? null, activity.outputLines ? [...activity.outputLines] : [])
      };
      if (
        !hasVisibleTranscriptText(currentTerminalItem.label)
        && !hasVisibleTranscriptText(currentTerminalItem.text)
        && !hasVisibleTranscriptText(currentTerminalItem.command)
        && !hasVisibleTranscriptText(currentTerminalItem.cwd)
        && currentTerminalItem.outputLines.length === 0
      ) {
        currentTerminalItem = null;
        continue;
      }
      items.push(currentTerminalItem);
      continue;
    }

    if (activity?.kind === 'terminal_output') {
      if (currentTerminalItem) {
        appendLines(currentTerminalItem.outputLines, activity.outputLines);
        if (!activity.outputLines?.length) {
          appendIfMissing(currentTerminalItem.outputLines, activity.text ?? activity.summary);
        }
        currentTerminalItem.outputLines = compactTerminalOutput(currentTerminalItem.command, currentTerminalItem.outputLines);
      }
      continue;
    }

    if (activityKind) {
      if (activity?.kind === 'thinking' && shouldSuppressTranscriptThinkingActivity(activity)) {
        continue;
      }

      const toolCallDisplay = activity?.kind === 'tool_call'
        ? deriveFriendlyToolCallDisplay(activity)
        : null;
      const label = activityKind === 'thinking'
        ? sanitizeOperationalMessage(activity?.summary ?? message ?? '') ?? ''
        : (toolCallDisplay?.label ?? activity?.summary ?? message ?? '');
      const text = activityKind === 'thinking'
        ? sanitizeOperationalMessage(activity?.text ?? activity?.summary ?? message ?? '') ?? ''
        : (toolCallDisplay?.text ?? activity?.text ?? activity?.summary ?? message ?? '');
      if (!hasVisibleTranscriptText(label) && !hasVisibleTranscriptText(text) && !activity?.url && !activity?.path) {
        continue;
      }

      items.push({
        id: event.id,
        kind: 'activity_line',
        activityKind,
        providerEventType: activity?.providerEventType ?? null,
        toolName: activity?.toolName ?? null,
        label,
        text,
        url: activity?.url ?? null,
        path: activity?.path ?? null,
        command: activity?.command ?? null,
        cwd: activity?.cwd ?? null,
        isolationMode: activity?.isolationMode ?? null,
        status: activityKind === 'terminal_command' ? (activity?.phase === 'completed' ? 'completed' : activity?.phase === 'stopped' ? 'stopped' : 'running') : null,
        startedAt: null,
        finishedAt: null,
        durationLabel: null,
        outputLines: activity?.outputLines ? [...activity.outputLines] : []
      });
      continue;
    }

    if (activity?.kind === 'tool_result') {
      if (shouldSuppressTranscriptToolResult(activity)) {
        continue;
      }

      const label = toolResultDisplay?.label ?? activity.summary;
      const text = toolResultDisplay?.text ?? activity.text ?? activity.summary;
      if (!hasVisibleTranscriptText(label) && !hasVisibleTranscriptText(text) && !activity.url && !activity.path) {
        continue;
      }

      items.push({
        id: event.id,
        kind: 'activity_line',
        activityKind: 'tool_result',
        providerEventType: activity.providerEventType ?? null,
        toolName: activity.toolName ?? null,
        label,
        text,
        url: activity.url ?? null,
        path: activity.path ?? null,
        command: null,
        cwd: null,
        isolationMode: null,
        status: null,
        outputLines: []
      });
      continue;
    }

    if (message) {
      items.push({
        id: event.id,
        kind: 'activity_line',
        activityKind: 'thinking',
        providerEventType: null,
        toolName: null,
        label: message,
        text: message,
        url: null,
        path: null,
        command: null,
        cwd: null,
        isolationMode: null,
        status: null,
        outputLines: []
      });
    }
  }

  items = compactRedundantToolCalls(items);
  items = compactTranscriptActivityItems(items);
  items = compactConcreteFollowupToolResults(items);

  const workedForLabel = hasWorkedForEvidence({ timelineItems: items, changeArtifact: changeArtifacts[0]?.artifact ?? null })
    ? formatElapsed(startedAt, finishedAt)
    : null;
  if (workedForLabel) {
    items.push({
      id: `worked-for:${items.length}`,
      kind: 'worked_for',
      label: `Worked for ${workedForLabel}`
    });
  }
  flushAssistant();
  const canonicalAssistantText = assistantTurn?.content.trim() ?? '';
  if (canonicalAssistantText) {
    const lastAssistantIndex = [...items].reverse().findIndex((item) => item.kind === 'assistant_text');
    if (lastAssistantIndex >= 0) {
      const normalizedIndex = items.length - 1 - lastAssistantIndex;
      const currentItem = items[normalizedIndex];
      if (currentItem?.kind === 'assistant_text') {
        items[normalizedIndex] = {
          ...currentItem,
          id: assistantTurn?.id ?? currentItem.id,
          text: canonicalAssistantText,
          sources: assistantTurn?.sources ?? currentItem.sources
        };
      }
    } else {
      items.push({
        id: assistantTurn?.id ?? `assistant:${items.length}`,
        kind: 'assistant_text',
        text: canonicalAssistantText,
        sources: assistantTurn?.sources ?? []
      });
    }
  }
  items = compactOperationalAssistantNarration(items);
  items = compactAssistantFollowUps(items);
  items = compactGenericThinkingRows(items);
  items = compactOperationalMetaRows(items);
  const resolutionSummary = deriveResolutionSummaryItem(items, changeArtifacts, runState, failureMessage);
  if (resolutionSummary) {
    if (runState === 'failed') {
      items.unshift(resolutionSummary);
    } else {
      items.push(resolutionSummary);
      items = compactAssistantDetailAfterResolutionSummary(items);
    }
  }
  items.push(...stagedWorkspaceChanges);
  items.push(...worktreeWorkspaceChanges);
  items.push(...changeArtifacts);
  return items;
}

export function deriveRunTranscriptItemsMap(thread: ThreadDetail | null) {
  if (!thread) {
    return {} as Record<string, RunTranscriptItem[]>;
  }

  const assistantTurnsByRunId = new Map<string, ThreadTurn>();
  for (const turn of thread.turns) {
    if (turn.role !== 'assistant' || typeof turn.runId !== 'string' || !turn.runId.trim()) {
      continue;
    }
    assistantTurnsByRunId.set(turn.runId, turn);
  }

  const grouped = new Map<string, RunEvent[]>();
  for (const event of thread.rawOutput) {
    const bucket = grouped.get(event.runId) ?? [];
    bucket.push(event);
    grouped.set(event.runId, bucket);
  }

  return Object.fromEntries(
    Array.from(grouped.entries()).map(([runId, events]) => [
      runId,
      deriveRunTranscriptItems(events, assistantTurnsByRunId.get(runId) ?? null)
    ])
  ) as Record<string, RunTranscriptItem[]>;
}

export function deriveRunReviewEvidence(
  activity: RunActivityViewModel | null,
  progress: RunProgressState | null
): RunReviewEvidenceViewModel | null {
  if (!activity) {
    return null;
  }

  const thoughtEvidence = activity.state === 'running'
    ? []
    : activity.thinkingLines.filter((line) =>
        line.kind === 'thinking' ||
        line.kind === 'guidance' ||
        line.kind === 'skill' ||
        line.kind === 'memory_recall' ||
        line.kind === 'memory_checkpoint' ||
        line.kind === 'web_search' ||
        line.kind === 'delegation' ||
        line.kind === 'tool_call' ||
        line.kind === 'tool_result'
      );
  const fileEvidence = activity.thinkingLines.filter((line) =>
    line.kind === 'file_edit' ||
    line.kind === 'file_write' ||
    line.kind === 'mkdir' ||
    line.kind === 'file_open' ||
    line.kind === 'file_read' ||
    line.kind === 'file_search'
  );
  const terminalCommands = activity.terminalCommands.filter((command) => command.label.trim().length > 0);
  const changeArtifact = progress?.changeArtifact ?? activity.changeArtifact ?? null;
  const reviewAvailable = progress?.reviewAvailable ?? Boolean(changeArtifact);

  if (
    !reviewAvailable &&
    !changeArtifact &&
    terminalCommands.length === 0 &&
    fileEvidence.length === 0 &&
    thoughtEvidence.length === 0
  ) {
    return null;
  }

  return {
    runId: activity.runId,
    state: activity.state,
    reviewAvailable,
    changeArtifact,
    thoughtEvidence,
    fileEvidence,
    terminalCommands,
    workedForLabel: activity.workedForLabel,
    activity: {
      ...activity,
      terminalCommands
    }
  };
}
