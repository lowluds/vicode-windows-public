import type {
  RunChangeArtifact,
  StagedWorkspaceReviewDecision,
  ThreadDetail,
  WorktreeCleanupDecision,
  WorktreeHunkReviewDecision,
  WorktreeReviewDecision
} from '../../shared/domain';
import type { HarnessHandoffState } from '../../shared/harness-handoff-state';
import type { HarnessTaskContract } from '../../shared/harness-task-contract';
import type { VerificationArtifact } from '../../shared/harness-verification';
import type { StagedWorkspaceHunkReviewDecision } from '../../shared/hunk-review';
import {
  buildRunEvidenceBundleV1,
  type BuildRunEvidenceBundleInput,
  type RunEvidenceBundleV1,
  type RunEvidenceFinalSummary,
  type RunEvidenceHookSummaryInput,
  type RunEvidenceToolExecutionInput
} from '../../shared/run-evidence-bundle';
import { finiteNumberOrNull, recordOrNull } from './diagnostics-redaction';
import { parseStagedWorkspaceReviewDecisionForBundle } from './diagnostics-evidence-parsers';
import type {
  ExportedFailedRunDiagnostic,
  ExportedFinalEvidenceSummaryDiagnostic,
  ExportedHarnessHookEvidenceDiagnostic,
  ExportedInfrastructureEvidenceDiagnostic,
  ExportedModelRoutingEvidenceDiagnostic,
  ExportedPromptSectionEvidenceDiagnostic,
  ExportedRuntimeTraceDiagnostic,
  ExportedStagedWorkspaceHunkReviewDecisionDiagnostic,
  ExportedTerminalCommandDiagnostic,
  ExportedToolRoutingEvidenceDiagnostic,
  ExportedToolRuntimeDiagnostic,
  ExportedVerificationArtifactDiagnostic,
  ExportedWorktreeCleanupDecisionDiagnostic,
  ExportedWorktreeHunkReviewDecisionDiagnostic,
  ExportedWorktreeReviewDecisionDiagnostic
} from './diagnostics-run-progress-types';

function matchesRun(
  item: { threadId: string; runId: string },
  threadId: string,
  runId: string
) {
  return item.threadId === threadId && item.runId === runId;
}

function isHarnessTaskContract(value: unknown): value is HarnessTaskContract {
  const contract = recordOrNull(value);
  return Boolean(
    contract
    && typeof contract.objective === 'string'
    && typeof contract.taskKind === 'string'
    && typeof contract.expectedMutations === 'string'
    && typeof contract.verificationPolicy === 'string'
    && typeof contract.isolationMode === 'string'
    && typeof contract.riskLevel === 'string'
  );
}

function findHarnessTaskContract(thread: ThreadDetail, runId: string): HarnessTaskContract | null {
  for (const turn of [...thread.turns].reverse()) {
    if (turn.runId && turn.runId !== runId) {
      continue;
    }
    const metadata = recordOrNull(turn.metadata);
    if (isHarnessTaskContract(metadata?.harnessTaskContract)) {
      return metadata.harnessTaskContract;
    }
  }

  for (const event of [...thread.rawOutput].reverse()) {
    if (event.runId !== runId) {
      continue;
    }
    const payload = recordOrNull(event.payload);
    const runtimeTrace = recordOrNull(payload?.runtimeTrace);
    const detail = recordOrNull(runtimeTrace?.detail);
    if (isHarnessTaskContract(detail?.harnessTaskContract)) {
      return detail.harnessTaskContract;
    }
  }

  return null;
}

function readRunDiffStats(value: unknown) {
  const summary = recordOrNull(value);
  const filesChanged = finiteNumberOrNull(summary?.filesChanged);
  const insertions = finiteNumberOrNull(summary?.insertions);
  const deletions = finiteNumberOrNull(summary?.deletions);
  return filesChanged !== null && insertions !== null && deletions !== null
    ? { filesChanged, insertions, deletions }
    : null;
}

function readRunChangeArtifact(value: unknown): RunChangeArtifact | null {
  const artifact = recordOrNull(value);
  if (!artifact) {
    return null;
  }
  const summary = readRunDiffStats(artifact.summary);
  const files = Array.isArray(artifact.files) ? artifact.files : null;
  if (!summary || !files) {
    return null;
  }

  return artifact as unknown as RunChangeArtifact;
}

function findRunChangeArtifacts(thread: ThreadDetail, runId: string) {
  const artifacts: RunChangeArtifact[] = [];
  for (const event of thread.rawOutput) {
    if (event.runId !== runId) {
      continue;
    }
    const payload = recordOrNull(event.payload);
    if (!payload) {
      continue;
    }
    for (const key of ['progressSnapshot', 'progress', 'activity'] as const) {
      const source = recordOrNull(payload[key]);
      const artifact = source ? readRunChangeArtifact(source.changeArtifact) : null;
      if (artifact) {
        artifacts.push(artifact);
      }
    }
  }
  return artifacts;
}

function findStagedWorkspaceReviewDecisions(thread: ThreadDetail, runId: string) {
  const decisions: StagedWorkspaceReviewDecision[] = [];
  for (const event of thread.rawOutput) {
    if (event.runId !== runId) {
      continue;
    }
    const payload = recordOrNull(event.payload);
    const decision = parseStagedWorkspaceReviewDecisionForBundle(payload?.stagedWorkspaceReviewDecision);
    if (decision) {
      decisions.push(decision);
    }
  }
  return decisions;
}

function verificationArtifactFromDiagnostic(
  diagnostic: ExportedVerificationArtifactDiagnostic
): VerificationArtifact {
  return {
    command: diagnostic.command,
    cwd: diagnostic.cwd,
    permissionProfile: diagnostic.permissionProfile as VerificationArtifact['permissionProfile'],
    networkPolicy: diagnostic.networkPolicy as VerificationArtifact['networkPolicy'],
    status: diagnostic.status as VerificationArtifact['status'],
    exitCode: diagnostic.exitCode,
    stdout: '',
    stderr: '',
    startedAt: null,
    finishedAt: diagnostic.createdAt,
    durationMs: diagnostic.durationMs,
    reason: diagnostic.reason ?? '',
    skippedReason: diagnostic.skippedReason
  };
}

function worktreeReviewDecisionFromDiagnostic(
  diagnostic: ExportedWorktreeReviewDecisionDiagnostic
): WorktreeReviewDecision {
  return {
    action: diagnostic.action as WorktreeReviewDecision['action'],
    status: diagnostic.status as WorktreeReviewDecision['status'],
    threadId: diagnostic.threadId,
    runId: diagnostic.runId,
    isolationMode: 'git_worktree',
    branchName: diagnostic.branchName ?? '',
    baseSha: diagnostic.baseSha ?? '',
    sourceWorkspaceRelativePath: diagnostic.sourceWorkspaceRelativePath ?? '',
    changedPaths: diagnostic.changedPaths,
    filesChanged: diagnostic.filesChanged ?? 0,
    insertions: diagnostic.insertions ?? 0,
    deletions: diagnostic.deletions ?? 0,
    errorReason: diagnostic.errorReason,
    createdAt: diagnostic.createdAt
  };
}

function worktreeCleanupDecisionFromDiagnostic(
  diagnostic: ExportedWorktreeCleanupDecisionDiagnostic
): WorktreeCleanupDecision {
  return {
    action: diagnostic.action as WorktreeCleanupDecision['action'],
    status: diagnostic.status as WorktreeCleanupDecision['status'],
    threadId: diagnostic.threadId,
    runId: diagnostic.runId,
    isolationMode: 'git_worktree',
    branchName: diagnostic.branchName ?? '',
    baseSha: diagnostic.baseSha ?? '',
    cleanupPolicy: diagnostic.cleanupPolicy ?? '',
    reviewStatus: diagnostic.reviewStatus as WorktreeCleanupDecision['reviewStatus'],
    errorReason: diagnostic.errorReason,
    createdAt: diagnostic.createdAt
  };
}

function stagedWorkspaceHunkReviewDecisionFromDiagnostic(
  diagnostic: ExportedStagedWorkspaceHunkReviewDecisionDiagnostic
): StagedWorkspaceHunkReviewDecision {
  return {
    action: diagnostic.action as StagedWorkspaceHunkReviewDecision['action'],
    status: diagnostic.status as StagedWorkspaceHunkReviewDecision['status'],
    threadId: diagnostic.threadId,
    runId: diagnostic.runId,
    source: 'staged_workspace_preview',
    isolationMode: 'patch_buffer',
    stagedEventId: diagnostic.stagedEventId,
    stagedEventIndex: diagnostic.stagedEventIndex,
    changedPaths: diagnostic.changedPaths,
    hunkIds: diagnostic.hunkIds,
    acceptedHunkIds: diagnostic.acceptedHunkIds,
    rejectedHunkIds: diagnostic.rejectedHunkIds,
    filesChanged: diagnostic.filesChanged ?? 0,
    insertions: diagnostic.insertions ?? 0,
    deletions: diagnostic.deletions ?? 0,
    errorReason: diagnostic.errorReason,
    createdAt: diagnostic.createdAt
  };
}

function worktreeHunkReviewDecisionFromDiagnostic(
  diagnostic: ExportedWorktreeHunkReviewDecisionDiagnostic
): WorktreeHunkReviewDecision {
  return {
    action: diagnostic.action as WorktreeHunkReviewDecision['action'],
    status: diagnostic.status as WorktreeHunkReviewDecision['status'],
    threadId: diagnostic.threadId,
    runId: diagnostic.runId,
    source: 'worktree_diff',
    isolationMode: 'git_worktree',
    branchName: diagnostic.branchName ?? '',
    baseSha: diagnostic.baseSha ?? '',
    sourceWorkspaceRelativePath: diagnostic.sourceWorkspaceRelativePath ?? '',
    changedPaths: diagnostic.changedPaths,
    hunkIds: diagnostic.hunkIds,
    acceptedHunkIds: diagnostic.acceptedHunkIds,
    rejectedHunkIds: diagnostic.rejectedHunkIds,
    filesChanged: diagnostic.filesChanged ?? 0,
    insertions: diagnostic.insertions ?? 0,
    deletions: diagnostic.deletions ?? 0,
    errorReason: diagnostic.errorReason,
    createdAt: diagnostic.createdAt
  };
}

function finalEvidenceFromDiagnostic(
  diagnostic: ExportedFinalEvidenceSummaryDiagnostic | undefined
): RunEvidenceFinalSummary | null {
  if (!diagnostic) {
    return null;
  }

  return {
    runId: diagnostic.runId,
    usedMutatingTool: diagnostic.usedMutatingTool ?? false,
    usedFileContentMutationTool: diagnostic.usedFileContentMutationTool ?? false,
    usedNativeWebResearchTool: diagnostic.usedNativeWebResearchTool ?? false,
    postMutationVerificationRequired: diagnostic.postMutationVerificationRequired ?? false,
    postMutationVerificationPassed: diagnostic.postMutationVerificationPassed ?? false,
    verificationCommand: diagnostic.verificationCommand,
    verificationStatus: diagnostic.verificationStatus,
    createdDirectoriesCount: diagnostic.createdDirectoriesCount ?? 0,
    writtenFilesCount: diagnostic.writtenFilesCount ?? 0,
    toolCallCount: diagnostic.toolCallCount ?? 0,
    reminderCount: diagnostic.reminderCount ?? 0
  };
}

function hookEvidenceFromDiagnostic(
  diagnostic: ExportedHarnessHookEvidenceDiagnostic
): RunEvidenceHookSummaryInput {
  return {
    stage: diagnostic.stage,
    sequence: diagnostic.sequence,
    at: diagnostic.createdAt,
    turnIndex: diagnostic.turnIndex,
    toolName: diagnostic.toolName,
    summary: diagnostic.summary,
    isError: diagnostic.isError,
    mutatesWorkspace: diagnostic.mutatesWorkspace,
    verificationCommand: diagnostic.verificationCommand,
    verificationStatus: diagnostic.verificationStatus,
    contextPressureSeverity: diagnostic.contextPressureSeverity,
    contextPressureCheckpointRecommended: diagnostic.contextPressureCheckpointRecommended,
    contextPressureCompactionLikely: diagnostic.contextPressureCompactionLikely,
    continuationReason: diagnostic.continuationReason
  };
}

function toolExecutionFromDiagnostics(
  toolRuntimeDiagnostics: ExportedToolRuntimeDiagnostic[],
  terminalCommandDiagnostics: ExportedTerminalCommandDiagnostic[]
): RunEvidenceToolExecutionInput {
  const toolByName = new Map<string, {
    toolName: string;
    callCount: number;
    resultCount: number;
    mutatesWorkspace: null;
    errorCount: number;
  }>();
  for (const diagnostic of toolRuntimeDiagnostics) {
    const toolName = diagnostic.toolName ?? 'unknown';
    const current = toolByName.get(toolName) ?? {
      toolName,
      callCount: 0,
      resultCount: 0,
      mutatesWorkspace: null,
      errorCount: 0
    };
    if (diagnostic.kind === 'tool_call') {
      current.callCount += 1;
    } else {
      current.resultCount += 1;
    }
    if (diagnostic.status === 'failed' || diagnostic.status === 'error') {
      current.errorCount += 1;
    }
    toolByName.set(toolName, current);
  }

  return {
    toolCallCount: toolRuntimeDiagnostics.filter((diagnostic) => diagnostic.kind === 'tool_call').length,
    toolResultCount: toolRuntimeDiagnostics.filter((diagnostic) => diagnostic.kind === 'tool_result').length,
    terminalCommandCount: terminalCommandDiagnostics.length,
    mutatingToolCallCount: 0,
    tools: [...toolByName.values()],
    terminalCommands: terminalCommandDiagnostics.map((diagnostic) => ({
      command: diagnostic.command,
      cwd: diagnostic.cwd,
      status: diagnostic.phase,
      exitCode: null,
      durationMs: null
    }))
  };
}

export function buildRunEvidenceBundles(input: {
  threadById: Map<string, ThreadDetail>;
  runIdsByThread: Map<string, Set<string>>;
  promptSectionEvidenceDiagnostics: ExportedPromptSectionEvidenceDiagnostic[];
  modelRoutingEvidenceDiagnostics: ExportedModelRoutingEvidenceDiagnostic[];
  toolRoutingEvidenceDiagnostics: ExportedToolRoutingEvidenceDiagnostic[];
  infrastructureEvidenceDiagnostics: ExportedInfrastructureEvidenceDiagnostic[];
  toolRuntimeDiagnostics: ExportedToolRuntimeDiagnostic[];
  terminalCommandDiagnostics: ExportedTerminalCommandDiagnostic[];
  verificationArtifactDiagnostics: ExportedVerificationArtifactDiagnostic[];
  worktreeReviewDecisionDiagnostics: ExportedWorktreeReviewDecisionDiagnostic[];
  stagedWorkspaceHunkReviewDecisionDiagnostics: ExportedStagedWorkspaceHunkReviewDecisionDiagnostic[];
  worktreeHunkReviewDecisionDiagnostics: ExportedWorktreeHunkReviewDecisionDiagnostic[];
  worktreeCleanupDecisionDiagnostics: ExportedWorktreeCleanupDecisionDiagnostic[];
  harnessHookEvidenceDiagnostics: ExportedHarnessHookEvidenceDiagnostic[];
  finalEvidenceSummaryDiagnostics: ExportedFinalEvidenceSummaryDiagnostic[];
  harnessHandoffStateDiagnostics: HarnessHandoffState[];
  runtimeTraceDiagnostics: ExportedRuntimeTraceDiagnostic[];
  failedRunDiagnostics: ExportedFailedRunDiagnostic[];
}): RunEvidenceBundleV1[] {
  const bundles: RunEvidenceBundleV1[] = [];

  for (const [threadId, runIds] of input.runIdsByThread) {
    const thread = input.threadById.get(threadId);
    if (!thread) {
      continue;
    }

    for (const runId of runIds) {
      const runtimeTrace = input.runtimeTraceDiagnostics.find((diagnostic) => matchesRun(diagnostic, threadId, runId));
      const failedRun = input.failedRunDiagnostics.find((diagnostic) => matchesRun(diagnostic, threadId, runId)) ?? null;
      const terminalStage = runtimeTrace?.terminalStage ?? failedRun?.failureStage ?? null;
      const terminalAt = terminalStage
        ? runtimeTrace?.marks.find((mark) => mark.stage === terminalStage)?.at ?? null
        : null;
      const toolRuntimeDiagnostics = input.toolRuntimeDiagnostics.filter((diagnostic) => matchesRun(diagnostic, threadId, runId));
      const terminalCommandDiagnostics = input.terminalCommandDiagnostics.filter((diagnostic) => matchesRun(diagnostic, threadId, runId));
      const finalEvidenceDiagnostics = input.finalEvidenceSummaryDiagnostics
        .filter((diagnostic) => matchesRun(diagnostic, threadId, runId));
      const bundleInput: BuildRunEvidenceBundleInput = {
        identity: {
          threadId,
          threadTitle: thread.title,
          projectId: thread.projectId,
          providerId: thread.providerId,
          modelId: thread.modelId,
          runId,
          status: failedRun ? 'failed' : terminalStage ?? thread.status,
          startedAt: runtimeTrace?.firstRecordedAt ?? thread.rawOutput.find((event) => event.runId === runId)?.createdAt ?? null,
          completedAt: terminalStage === 'completed' ? terminalAt : null,
          failedAt: failedRun?.failedAt ?? (terminalStage && terminalStage !== 'completed' ? terminalAt : null),
          terminalStage
        },
        taskContract: findHarnessTaskContract(thread, runId),
        promptEvidence: input.promptSectionEvidenceDiagnostics.filter((diagnostic) => matchesRun(diagnostic, threadId, runId)),
        modelRoutingEvidence: input.modelRoutingEvidenceDiagnostics.filter((diagnostic) => matchesRun(diagnostic, threadId, runId)),
        toolRoutingEvidence: input.toolRoutingEvidenceDiagnostics.filter((diagnostic) => matchesRun(diagnostic, threadId, runId)),
        infrastructureEvidence: input.infrastructureEvidenceDiagnostics.filter((diagnostic) => matchesRun(diagnostic, threadId, runId)),
        runtimeTrace: runtimeTrace ? { marks: runtimeTrace.marks } : null,
        toolExecution: toolExecutionFromDiagnostics(toolRuntimeDiagnostics, terminalCommandDiagnostics),
        verificationArtifacts: input.verificationArtifactDiagnostics
          .filter((diagnostic) => matchesRun(diagnostic, threadId, runId))
          .map(verificationArtifactFromDiagnostic),
        changeArtifacts: findRunChangeArtifacts(thread, runId),
        stagedReviewDecisions: findStagedWorkspaceReviewDecisions(thread, runId),
        stagedHunkReviewDecisions: input.stagedWorkspaceHunkReviewDecisionDiagnostics
          .filter((diagnostic) => matchesRun(diagnostic, threadId, runId))
          .map(stagedWorkspaceHunkReviewDecisionFromDiagnostic),
        worktreeReviewDecisions: input.worktreeReviewDecisionDiagnostics
          .filter((diagnostic) => matchesRun(diagnostic, threadId, runId))
          .map(worktreeReviewDecisionFromDiagnostic),
        worktreeHunkReviewDecisions: input.worktreeHunkReviewDecisionDiagnostics
          .filter((diagnostic) => matchesRun(diagnostic, threadId, runId))
          .map(worktreeHunkReviewDecisionFromDiagnostic),
        worktreeCleanupDecisions: input.worktreeCleanupDecisionDiagnostics
          .filter((diagnostic) => matchesRun(diagnostic, threadId, runId))
          .map(worktreeCleanupDecisionFromDiagnostic),
        hookEvidence: input.harnessHookEvidenceDiagnostics
          .filter((diagnostic) => matchesRun(diagnostic, threadId, runId))
          .map(hookEvidenceFromDiagnostic),
        finalEvidenceSummary: finalEvidenceFromDiagnostic(finalEvidenceDiagnostics.at(-1)),
        handoffState: input.harnessHandoffStateDiagnostics.find((state) => state.threadId === threadId && state.runId === runId) ?? null,
        failedRun: failedRun
          ? {
              failureStage: failedRun.failureStage,
              failureMessage: failedRun.failureMessage,
              failureReason: failedRun.failureReason
            }
          : null
      };

      bundles.push(buildRunEvidenceBundleV1(bundleInput));
    }
  }

  return bundles;
}
