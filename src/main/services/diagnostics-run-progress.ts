import type {
  RunRuntimeTraceMark,
  RunRuntimeTraceStage,
  SubagentSummary,
  ThreadDetail
} from '../../shared/domain';
import {
  deriveHarnessHandoffState,
  type HarnessHandoffState
} from '../../shared/harness-handoff-state';
import {
  booleanOrNull,
  finiteNumberOrNull,
  objectArray,
  stringArray,
  stringOrNull,
  uniqueStrings
} from './diagnostics-redaction';
import {
  parseFinalEvidenceSummary,
  parseHarnessHookEvidence,
  parseStagedWorkspaceChangeSet,
  parseStagedWorkspaceHunkReviewDecision,
  parseVerificationArtifact,
  parseWorktreeChangeEvidence,
  parseWorktreeCleanupDecision,
  parseWorktreeHunkReviewDecision,
  parseWorktreeReviewDecision
} from './diagnostics-evidence-parsers';
import {
  parseProviderModelHarnessEvidence,
  parseProviderModelRoutingEvidence,
  parseRuntimeTraceMark,
  sanitizeInfrastructureEvidence,
  sanitizeModelRoutingEvidence,
  sanitizePromptSectionEvidence,
  sanitizeToolRoutingEvidence
} from './diagnostics-runtime-trace';
import { buildRunEvidenceBundles } from './diagnostics-run-evidence-bundles';
import type {
  CollectRunProgressDiagnosticsInput,
  ExportedFailedRunDiagnostic,
  ExportedFinalEvidenceSummaryDiagnostic,
  ExportedHarnessHookEvidenceDiagnostic,
  ExportedInfrastructureEvidenceDiagnostic,
  ExportedModelRoutingEvidenceDiagnostic,
  ExportedNativeProgressSnapshot,
  ExportedPromptSectionEvidenceDiagnostic,
  ExportedProviderEventDiagnostic,
  ExportedRuntimeTraceDiagnostic,
  ExportedStagedWorkspaceChangeDiagnostic,
  ExportedStagedWorkspaceHunkReviewDecisionDiagnostic,
  ExportedTerminalCommandDiagnostic,
  ExportedToolRoutingEvidenceDiagnostic,
  ExportedToolRuntimeDiagnostic,
  ExportedVerificationArtifactDiagnostic,
  ExportedWorktreeChangeDiagnostic,
  ExportedWorktreeCleanupDecisionDiagnostic,
  ExportedWorktreeHunkReviewDecisionDiagnostic,
  ExportedWorktreeReviewDecisionDiagnostic,
  RunProgressDiagnostics,
  RunProgressDiagnosticsDb
} from './diagnostics-run-progress-types';

interface RuntimeTraceAccumulator {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  marks: RunRuntimeTraceMark[];
}

interface FailedRunAccumulator extends ExportedFailedRunDiagnostic {}

function toEpochMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function diffMs(start: string | null | undefined, end: string | null | undefined) {
  const startMs = toEpochMs(start);
  const endMs = toEpochMs(end);
  if (startMs === null || endMs === null) {
    return null;
  }
  return Math.max(0, endMs - startMs);
}

function getTraceStageAt(marks: RunRuntimeTraceMark[], stage: RunRuntimeTraceStage) {
  return marks.find((mark) => mark.stage === stage)?.at ?? null;
}

function listSubagentsForThread(db: RunProgressDiagnosticsDb, threadId: string): SubagentSummary[] {
  return typeof db.listSubagentsByParentThread === 'function'
    ? db.listSubagentsByParentThread(threadId)
    : [];
}

function resolveThreadIds(db: RunProgressDiagnosticsDb, threadIds: Iterable<string> | null) {
  const resolvedThreadIds = new Set<string>();
  if (threadIds) {
    for (const threadId of threadIds) {
      resolvedThreadIds.add(threadId);
    }
    return resolvedThreadIds;
  }

  for (const project of db.listProjects()) {
    for (const thread of db.listThreads(project.id)) {
      resolvedThreadIds.add(thread.id);
    }
    for (const thread of db.listArchivedThreads(project.id)) {
      resolvedThreadIds.add(thread.id);
    }
  }
  return resolvedThreadIds;
}

export function collectRunProgressDiagnostics(input: CollectRunProgressDiagnosticsInput): RunProgressDiagnostics {
  const { db, threadIds = null } = input;
  const providerEventDiagnostics: ExportedProviderEventDiagnostic[] = [];
  const nativeProgressSnapshots: ExportedNativeProgressSnapshot[] = [];
  const toolRuntimeDiagnostics: ExportedToolRuntimeDiagnostic[] = [];
  const terminalCommandDiagnostics: ExportedTerminalCommandDiagnostic[] = [];
  const verificationArtifactDiagnostics: ExportedVerificationArtifactDiagnostic[] = [];
  const promptSectionEvidenceDiagnostics: ExportedPromptSectionEvidenceDiagnostic[] = [];
  const modelRoutingEvidenceDiagnostics: ExportedModelRoutingEvidenceDiagnostic[] = [];
  const toolRoutingEvidenceDiagnostics: ExportedToolRoutingEvidenceDiagnostic[] = [];
  const infrastructureEvidenceDiagnostics: ExportedInfrastructureEvidenceDiagnostic[] = [];
  const stagedWorkspaceChangeDiagnostics: ExportedStagedWorkspaceChangeDiagnostic[] = [];
  const stagedWorkspaceHunkReviewDecisionDiagnostics: ExportedStagedWorkspaceHunkReviewDecisionDiagnostic[] = [];
  const worktreeChangeDiagnostics: ExportedWorktreeChangeDiagnostic[] = [];
  const worktreeReviewDecisionDiagnostics: ExportedWorktreeReviewDecisionDiagnostic[] = [];
  const worktreeHunkReviewDecisionDiagnostics: ExportedWorktreeHunkReviewDecisionDiagnostic[] = [];
  const worktreeCleanupDecisionDiagnostics: ExportedWorktreeCleanupDecisionDiagnostic[] = [];
  const harnessHookEvidenceDiagnostics: ExportedHarnessHookEvidenceDiagnostic[] = [];
  const finalEvidenceSummaryDiagnostics: ExportedFinalEvidenceSummaryDiagnostic[] = [];
  const harnessHandoffStateDiagnostics: HarnessHandoffState[] = [];
  const runtimeTraceByRun = new Map<string, RuntimeTraceAccumulator>();
  const failedRunByKey = new Map<string, FailedRunAccumulator>();
  const threadById = new Map<string, ThreadDetail>();
  const runIdsByThread = new Map<string, Set<string>>();

  for (const threadId of resolveThreadIds(db, threadIds)) {
    const thread = db.getThread(threadId);
    threadById.set(thread.id, thread);
    const runIds = new Set<string>();
    runIdsByThread.set(thread.id, runIds);
    const getFailedRunAccumulator = (runId: string): FailedRunAccumulator => {
      const key = `${thread.id}:${runId}`;
      const existing = failedRunByKey.get(key);
      if (existing) {
        return existing;
      }

      const created: FailedRunAccumulator = {
        threadId: thread.id,
        threadTitle: thread.title,
        providerId: thread.providerId,
        runId,
        failedAt: '',
        failureStage: 'failed',
        failureMessage: null,
        failureReason: null,
        hadAssistantOutput: false,
        lastThinkingSummary: null,
        lastProviderEventType: null,
        lastProviderPaths: [],
        toolCallCount: 0,
        toolResultCount: 0,
        terminalCommandCount: 0,
        lastToolName: null,
        lastToolCallSummary: null,
        lastToolResultSummary: null,
        lastTerminalCommand: null
      };
      failedRunByKey.set(key, created);
      return created;
    };

    for (const event of thread.rawOutput) {
      runIds.add(event.runId);
      const failedRun = getFailedRunAccumulator(event.runId);
      if (event.eventType === 'delta') {
        failedRun.hadAssistantOutput = true;
      }
      if (
        event.eventType === 'completed'
        && event.payload
        && typeof event.payload === 'object'
        && 'output' in event.payload
        && typeof event.payload.output === 'string'
        && event.payload.output.trim()
      ) {
        failedRun.hadAssistantOutput = true;
      }

      if (event.eventType !== 'info' || !event.payload || typeof event.payload !== 'object') {
        if (
          (event.eventType === 'failed' || event.eventType === 'aborted')
          && event.payload
          && typeof event.payload === 'object'
          && 'message' in event.payload
          && typeof event.payload.message === 'string'
        ) {
          failedRun.failedAt = event.createdAt;
          failedRun.failureStage = event.eventType;
          failedRun.failureMessage = event.payload.message;
        }
        continue;
      }

      const runtimeTrace = parseRuntimeTraceMark(event.payload);
      if (runtimeTrace) {
        const key = `${thread.id}:${event.runId}`;
        const current = runtimeTraceByRun.get(key) ?? {
          threadId: thread.id,
          threadTitle: thread.title,
          providerId: thread.providerId,
          runId: event.runId,
          marks: []
        };
        current.marks.push(runtimeTrace);
        runtimeTraceByRun.set(key, current);

        if (runtimeTrace.stage === 'failed' || runtimeTrace.stage === 'aborted') {
          failedRun.failedAt = runtimeTrace.at;
          failedRun.failureStage = runtimeTrace.stage;
          failedRun.failureMessage =
            runtimeTrace.detail && typeof runtimeTrace.detail.message === 'string'
              ? runtimeTrace.detail.message
              : failedRun.failureMessage;
          failedRun.failureReason =
            runtimeTrace.detail && typeof runtimeTrace.detail.reason === 'string'
              ? runtimeTrace.detail.reason
              : failedRun.failureReason;
        }
      }

      const harnessEvidence = parseProviderModelHarnessEvidence(event.payload);
      if (harnessEvidence) {
        for (const section of objectArray(harnessEvidence.promptSections).map(sanitizePromptSectionEvidence)) {
          promptSectionEvidenceDiagnostics.push({
            threadId: thread.id,
            threadTitle: thread.title,
            providerId: thread.providerId,
            runId: event.runId,
            createdAt: event.createdAt,
            sectionId: section.id,
            title: section.title,
            placement: section.placement,
            characterCount: section.characterCount,
            reason: section.reason
          });
        }

        const modelSelection = sanitizeModelRoutingEvidence(harnessEvidence.modelSelection);
        modelRoutingEvidenceDiagnostics.push({
          threadId: thread.id,
          threadTitle: thread.title,
          providerId: thread.providerId,
          runId: event.runId,
          createdAt: event.createdAt,
          modelId: modelSelection.modelId,
          customProviderId: modelSelection.customProviderId,
          ollamaTransportMode: modelSelection.ollamaTransportMode,
          runMode: modelSelection.runMode,
          providerLabel: modelSelection.providerLabel,
          transportKind: modelSelection.transportKind,
          runtimeAuthority: modelSelection.runtimeAuthority,
          reason: modelSelection.reason
        });

        for (const tool of objectArray(harnessEvidence.toolRouting).map(sanitizeToolRoutingEvidence)) {
          toolRoutingEvidenceDiagnostics.push({
            threadId: thread.id,
            threadTitle: thread.title,
            providerId: thread.providerId,
            runId: event.runId,
            createdAt: event.createdAt,
            toolId: tool.id,
            callName: tool.callName,
            name: tool.name,
            origin: tool.origin,
            visibilityGroup: tool.visibilityGroup,
            included: tool.included,
            reason: tool.reason,
            mutatesWorkspace: tool.mutatesWorkspace,
            requiresApproval: tool.requiresApproval,
            readsWorkspace: tool.readsWorkspace,
            usesNetwork: tool.usesNetwork
          });
        }

        for (const infrastructure of objectArray(harnessEvidence.infrastructure).map(sanitizeInfrastructureEvidence)) {
          infrastructureEvidenceDiagnostics.push({
            threadId: thread.id,
            threadTitle: thread.title,
            providerId: thread.providerId,
            runId: event.runId,
            createdAt: event.createdAt,
            infrastructureId: infrastructure.id,
            label: infrastructure.label,
            available: infrastructure.available,
            reason: infrastructure.reason,
            toolCallNames: infrastructure.toolCallNames
          });
        }
      }

      const modelRoutingEvidence = parseProviderModelRoutingEvidence(event.payload);
      if (modelRoutingEvidence) {
        modelRoutingEvidenceDiagnostics.push({
          threadId: thread.id,
          threadTitle: thread.title,
          providerId: thread.providerId,
          runId: event.runId,
          createdAt: event.createdAt,
          modelId: modelRoutingEvidence.modelId,
          customProviderId: modelRoutingEvidence.customProviderId,
          ollamaTransportMode: modelRoutingEvidence.ollamaTransportMode,
          runMode: modelRoutingEvidence.runMode,
          providerLabel: modelRoutingEvidence.providerLabel,
          transportKind: modelRoutingEvidence.transportKind,
          runtimeAuthority: modelRoutingEvidence.runtimeAuthority,
          reason: modelRoutingEvidence.reason
        });
      }

      const verificationArtifact = parseVerificationArtifact(event.payload);
      if (verificationArtifact) {
        verificationArtifactDiagnostics.push({
          threadId: thread.id,
          threadTitle: thread.title,
          providerId: thread.providerId,
          runId: event.runId,
          createdAt: event.createdAt,
          command: stringOrNull(verificationArtifact.command),
          cwd: stringOrNull(verificationArtifact.cwd),
          status: stringOrNull(verificationArtifact.status) ?? 'unknown',
          exitCode: finiteNumberOrNull(verificationArtifact.exitCode),
          durationMs: finiteNumberOrNull(verificationArtifact.durationMs),
          reason: stringOrNull(verificationArtifact.reason),
          skippedReason: stringOrNull(verificationArtifact.skippedReason),
          permissionProfile: stringOrNull(verificationArtifact.permissionProfile),
          networkPolicy: stringOrNull(verificationArtifact.networkPolicy)
        });
      }

      const stagedWorkspaceChangeSet = parseStagedWorkspaceChangeSet(event.payload);
      if (stagedWorkspaceChangeSet) {
        const operations = objectArray(stagedWorkspaceChangeSet.operations);
        const summary =
          stagedWorkspaceChangeSet.summary && typeof stagedWorkspaceChangeSet.summary === 'object'
            ? stagedWorkspaceChangeSet.summary as Record<string, unknown>
            : null;
        stagedWorkspaceChangeDiagnostics.push({
          threadId: thread.id,
          threadTitle: thread.title,
          providerId: thread.providerId,
          runId: event.runId,
          createdAt: event.createdAt,
          sourceToolName: stringOrNull(stagedWorkspaceChangeSet.sourceToolName),
          isolationMode: stringOrNull(stagedWorkspaceChangeSet.isolationMode),
          status: stringOrNull(stagedWorkspaceChangeSet.status),
          requestedPath: stringOrNull(stagedWorkspaceChangeSet.requestedPath),
          changedPaths: stringArray(stagedWorkspaceChangeSet.changedPaths),
          operationCount: operations.length,
          operationKinds: uniqueStrings(
            operations
              .map((operation) => stringOrNull(operation.operation))
              .filter((operation): operation is string => Boolean(operation))
          ),
          filesChanged: summary ? finiteNumberOrNull(summary.filesChanged) : null,
          insertions: summary ? finiteNumberOrNull(summary.insertions) : null,
          deletions: summary ? finiteNumberOrNull(summary.deletions) : null
        });
      }

      const worktreeChangeEvidence = parseWorktreeChangeEvidence(event.payload);
      if (worktreeChangeEvidence) {
        worktreeChangeDiagnostics.push({
          threadId: thread.id,
          threadTitle: thread.title,
          providerId: thread.providerId,
          runId: event.runId,
          createdAt: event.createdAt,
          isolationMode: stringOrNull(worktreeChangeEvidence.isolationMode),
          status: stringOrNull(worktreeChangeEvidence.status),
          reviewStatus: stringOrNull(worktreeChangeEvidence.reviewStatus),
          cleanupPolicy: stringOrNull(worktreeChangeEvidence.cleanupPolicy),
          sourceWorkspaceRelativePath: stringOrNull(worktreeChangeEvidence.sourceWorkspaceRelativePath),
          branchName: stringOrNull(worktreeChangeEvidence.branchName),
          baseRef: stringOrNull(worktreeChangeEvidence.baseRef),
          baseSha: stringOrNull(worktreeChangeEvidence.baseSha),
          filesChanged: finiteNumberOrNull(worktreeChangeEvidence.filesChanged),
          insertions: finiteNumberOrNull(worktreeChangeEvidence.insertions),
          deletions: finiteNumberOrNull(worktreeChangeEvidence.deletions),
          changedPaths: stringArray(worktreeChangeEvidence.changedPaths)
        });
      }

      const stagedWorkspaceHunkReviewDecision = parseStagedWorkspaceHunkReviewDecision(event.payload);
      if (stagedWorkspaceHunkReviewDecision) {
        stagedWorkspaceHunkReviewDecisionDiagnostics.push({
          threadId: thread.id,
          threadTitle: thread.title,
          providerId: thread.providerId,
          runId: event.runId,
          createdAt: event.createdAt,
          action: stagedWorkspaceHunkReviewDecision.action,
          status: stagedWorkspaceHunkReviewDecision.status,
          source: stagedWorkspaceHunkReviewDecision.source,
          isolationMode: stagedWorkspaceHunkReviewDecision.isolationMode,
          stagedEventId: stagedWorkspaceHunkReviewDecision.stagedEventId,
          stagedEventIndex: stagedWorkspaceHunkReviewDecision.stagedEventIndex,
          changedPaths: stagedWorkspaceHunkReviewDecision.changedPaths,
          hunkIds: stagedWorkspaceHunkReviewDecision.hunkIds,
          acceptedHunkIds: stagedWorkspaceHunkReviewDecision.acceptedHunkIds,
          rejectedHunkIds: stagedWorkspaceHunkReviewDecision.rejectedHunkIds,
          hunkCount: stagedWorkspaceHunkReviewDecision.hunkCount,
          acceptedHunkCount: stagedWorkspaceHunkReviewDecision.acceptedHunkCount,
          rejectedHunkCount: stagedWorkspaceHunkReviewDecision.rejectedHunkCount,
          filesChanged: stagedWorkspaceHunkReviewDecision.filesChanged,
          insertions: stagedWorkspaceHunkReviewDecision.insertions,
          deletions: stagedWorkspaceHunkReviewDecision.deletions,
          errorReason: stagedWorkspaceHunkReviewDecision.errorReason
        });
      }

      const worktreeReviewDecision = parseWorktreeReviewDecision(event.payload);
      if (worktreeReviewDecision) {
        worktreeReviewDecisionDiagnostics.push({
          threadId: thread.id,
          threadTitle: thread.title,
          providerId: thread.providerId,
          runId: event.runId,
          createdAt: event.createdAt,
          action: worktreeReviewDecision.action,
          status: worktreeReviewDecision.status,
          isolationMode: worktreeReviewDecision.isolationMode,
          branchName: worktreeReviewDecision.branchName,
          baseSha: worktreeReviewDecision.baseSha,
          sourceWorkspaceRelativePath: worktreeReviewDecision.sourceWorkspaceRelativePath,
          changedPaths: worktreeReviewDecision.changedPaths,
          filesChanged: worktreeReviewDecision.filesChanged,
          insertions: worktreeReviewDecision.insertions,
          deletions: worktreeReviewDecision.deletions,
          errorReason: worktreeReviewDecision.errorReason
        });
      }

      const worktreeHunkReviewDecision = parseWorktreeHunkReviewDecision(event.payload);
      if (worktreeHunkReviewDecision) {
        worktreeHunkReviewDecisionDiagnostics.push({
          threadId: thread.id,
          threadTitle: thread.title,
          providerId: thread.providerId,
          runId: event.runId,
          createdAt: event.createdAt,
          action: worktreeHunkReviewDecision.action,
          status: worktreeHunkReviewDecision.status,
          source: worktreeHunkReviewDecision.source,
          isolationMode: worktreeHunkReviewDecision.isolationMode,
          branchName: worktreeHunkReviewDecision.branchName,
          baseSha: worktreeHunkReviewDecision.baseSha,
          sourceWorkspaceRelativePath: worktreeHunkReviewDecision.sourceWorkspaceRelativePath,
          changedPaths: worktreeHunkReviewDecision.changedPaths,
          hunkIds: worktreeHunkReviewDecision.hunkIds,
          acceptedHunkIds: worktreeHunkReviewDecision.acceptedHunkIds,
          rejectedHunkIds: worktreeHunkReviewDecision.rejectedHunkIds,
          hunkCount: worktreeHunkReviewDecision.hunkCount,
          acceptedHunkCount: worktreeHunkReviewDecision.acceptedHunkCount,
          rejectedHunkCount: worktreeHunkReviewDecision.rejectedHunkCount,
          filesChanged: worktreeHunkReviewDecision.filesChanged,
          insertions: worktreeHunkReviewDecision.insertions,
          deletions: worktreeHunkReviewDecision.deletions,
          errorReason: worktreeHunkReviewDecision.errorReason
        });
      }

      const worktreeCleanupDecision = parseWorktreeCleanupDecision(event.payload);
      if (worktreeCleanupDecision) {
        worktreeCleanupDecisionDiagnostics.push({
          threadId: thread.id,
          threadTitle: thread.title,
          providerId: thread.providerId,
          runId: event.runId,
          createdAt: event.createdAt,
          action: worktreeCleanupDecision.action,
          status: worktreeCleanupDecision.status,
          isolationMode: worktreeCleanupDecision.isolationMode,
          branchName: worktreeCleanupDecision.branchName,
          baseSha: worktreeCleanupDecision.baseSha,
          cleanupPolicy: worktreeCleanupDecision.cleanupPolicy,
          reviewStatus: worktreeCleanupDecision.reviewStatus,
          errorReason: worktreeCleanupDecision.errorReason
        });
      }

      const harnessHookEvidence = parseHarnessHookEvidence(event.payload);
      if (harnessHookEvidence) {
        harnessHookEvidenceDiagnostics.push({
          threadId: thread.id,
          threadTitle: thread.title,
          providerId: thread.providerId,
          runId: event.runId,
          createdAt: event.createdAt,
          stage: stringOrNull(harnessHookEvidence.stage) ?? 'unknown',
          sequence: finiteNumberOrNull(harnessHookEvidence.sequence),
          turnIndex: finiteNumberOrNull(harnessHookEvidence.turnIndex),
          toolName: stringOrNull(harnessHookEvidence.toolName),
          summary: stringOrNull(harnessHookEvidence.summary),
          isError: booleanOrNull(harnessHookEvidence.isError),
          mutatesWorkspace: booleanOrNull(harnessHookEvidence.mutatesWorkspace),
          verificationCommand: stringOrNull(harnessHookEvidence.verificationCommand),
          verificationStatus: stringOrNull(harnessHookEvidence.verificationStatus),
          contextPressureSeverity: stringOrNull(harnessHookEvidence.contextPressureSeverity),
          contextPressureUsagePercent: finiteNumberOrNull(harnessHookEvidence.contextPressureUsagePercent),
          contextPressureUsedTokens: finiteNumberOrNull(harnessHookEvidence.contextPressureUsedTokens),
          contextPressureMaxTokens: finiteNumberOrNull(harnessHookEvidence.contextPressureMaxTokens),
          contextPressureSource: stringOrNull(harnessHookEvidence.contextPressureSource),
          contextPressureSourceLabel: stringOrNull(harnessHookEvidence.contextPressureSourceLabel),
          contextPressureCheckpointRecommended: booleanOrNull(harnessHookEvidence.contextPressureCheckpointRecommended),
          contextPressureCompactionLikely: booleanOrNull(harnessHookEvidence.contextPressureCompactionLikely),
          checkpointReminderKind: stringOrNull(harnessHookEvidence.checkpointReminderKind),
          checkpointReminderTitle: stringOrNull(harnessHookEvidence.checkpointReminderTitle),
          checkpointReminderSummary: stringOrNull(harnessHookEvidence.checkpointReminderSummary),
          continuationReason: stringOrNull(harnessHookEvidence.continuationReason),
          continuationReminderCount: finiteNumberOrNull(harnessHookEvidence.continuationReminderCount),
          continuationMaxReminderCount: finiteNumberOrNull(harnessHookEvidence.continuationMaxReminderCount)
        });
      }

      const finalEvidenceSummary = parseFinalEvidenceSummary(event.payload);
      if (finalEvidenceSummary) {
        finalEvidenceSummaryDiagnostics.push({
          threadId: thread.id,
          threadTitle: thread.title,
          providerId: thread.providerId,
          runId: event.runId,
          createdAt: event.createdAt,
          usedMutatingTool: booleanOrNull(finalEvidenceSummary.usedMutatingTool),
          usedFileContentMutationTool: booleanOrNull(finalEvidenceSummary.usedFileContentMutationTool),
          usedNativeWebResearchTool: booleanOrNull(finalEvidenceSummary.usedNativeWebResearchTool),
          postMutationVerificationRequired: booleanOrNull(finalEvidenceSummary.postMutationVerificationRequired),
          postMutationVerificationPassed: booleanOrNull(finalEvidenceSummary.postMutationVerificationPassed),
          verificationCommand: stringOrNull(finalEvidenceSummary.verificationCommand),
          verificationStatus: stringOrNull(finalEvidenceSummary.verificationStatus),
          createdDirectoriesCount: finiteNumberOrNull(finalEvidenceSummary.createdDirectoriesCount),
          writtenFilesCount: finiteNumberOrNull(finalEvidenceSummary.writtenFilesCount),
          toolCallCount: finiteNumberOrNull(finalEvidenceSummary.toolCallCount),
          reminderCount: finiteNumberOrNull(finalEvidenceSummary.reminderCount)
        });
      }

      const providerDiagnostics =
        'providerDiagnostics' in event.payload &&
        event.payload.providerDiagnostics &&
        typeof event.payload.providerDiagnostics === 'object'
          ? (event.payload.providerDiagnostics as Record<string, unknown>)
          : null;
      if (providerDiagnostics) {
        failedRun.lastProviderEventType =
          typeof providerDiagnostics.providerEventType === 'string' ? providerDiagnostics.providerEventType : failedRun.lastProviderEventType;
        failedRun.lastProviderPaths = Array.isArray(providerDiagnostics.paths)
          ? providerDiagnostics.paths.filter((value): value is string => typeof value === 'string')
          : failedRun.lastProviderPaths;
        providerEventDiagnostics.push({
          threadId: thread.id,
          threadTitle: thread.title,
          providerId: thread.providerId,
          runId: event.runId,
          createdAt: event.createdAt,
          source: typeof providerDiagnostics.source === 'string' ? providerDiagnostics.source : 'unknown',
          providerEventType:
            typeof providerDiagnostics.providerEventType === 'string' ? providerDiagnostics.providerEventType : 'unknown',
          itemType: typeof providerDiagnostics.itemType === 'string' ? providerDiagnostics.itemType : null,
          itemKeys: Array.isArray(providerDiagnostics.itemKeys)
            ? providerDiagnostics.itemKeys.filter((value): value is string => typeof value === 'string')
            : [],
          paths: Array.isArray(providerDiagnostics.paths)
            ? providerDiagnostics.paths.filter((value): value is string => typeof value === 'string')
            : [],
          decision: typeof providerDiagnostics.decision === 'string' ? providerDiagnostics.decision : null,
          status: typeof providerDiagnostics.status === 'string' ? providerDiagnostics.status : null,
          taskLike: providerDiagnostics.taskLike === true,
          classification:
            typeof providerDiagnostics.classification === 'string'
              ? providerDiagnostics.classification
              : 'unknown'
        });
      }

      const progressSource =
        'progressSnapshot' in event.payload && event.payload.progressSnapshot && typeof event.payload.progressSnapshot === 'object'
          ? event.payload.progressSnapshot
          : 'progress' in event.payload && event.payload.progress && typeof event.payload.progress === 'object'
            ? event.payload.progress
            : null;
      const progress = progressSource as Record<string, unknown> | null;
      if (progress) {
        const items = Array.isArray(progress.items) ? progress.items : [];
        nativeProgressSnapshots.push({
          threadId: thread.id,
          threadTitle: thread.title,
          providerId: thread.providerId,
          runId: event.runId,
          createdAt: event.createdAt,
          title: typeof progress.title === 'string' ? progress.title : null,
          itemCount: items.length,
          statuses: items
            .map((item) => (item && typeof item === 'object' && 'status' in item ? (item as { status?: unknown }).status : null))
            .filter((status): status is string => typeof status === 'string')
        });
      }

      const activity =
        'activity' in event.payload && event.payload.activity && typeof event.payload.activity === 'object'
          ? (event.payload.activity as Record<string, unknown>)
          : null;
      if (activity && activity.kind === 'thinking') {
        failedRun.lastThinkingSummary = typeof activity.summary === 'string' ? activity.summary : failedRun.lastThinkingSummary;
      }
      if (activity && (activity.kind === 'tool_call' || activity.kind === 'tool_result')) {
        if (activity.kind === 'tool_call') {
          failedRun.toolCallCount += 1;
          failedRun.lastToolName = typeof activity.toolName === 'string' ? activity.toolName : failedRun.lastToolName;
          failedRun.lastToolCallSummary = typeof activity.summary === 'string' ? activity.summary : failedRun.lastToolCallSummary;
        } else {
          failedRun.toolResultCount += 1;
          failedRun.lastToolName = typeof activity.toolName === 'string' ? activity.toolName : failedRun.lastToolName;
          failedRun.lastToolResultSummary = typeof activity.summary === 'string' ? activity.summary : failedRun.lastToolResultSummary;
        }
        toolRuntimeDiagnostics.push({
          threadId: thread.id,
          threadTitle: thread.title,
          providerId: thread.providerId,
          runId: event.runId,
          createdAt: event.createdAt,
          kind: activity.kind,
          toolName: typeof activity.toolName === 'string' ? activity.toolName : null,
          phase: typeof activity.phase === 'string' ? activity.phase : null,
          status: typeof activity.status === 'string' ? activity.status : null,
          summary: typeof activity.summary === 'string' ? activity.summary : 'Unknown tool activity'
        });
      }

      if (activity && activity.kind === 'terminal_command') {
        failedRun.terminalCommandCount += 1;
        failedRun.lastTerminalCommand = typeof activity.command === 'string' ? activity.command : failedRun.lastTerminalCommand;
        terminalCommandDiagnostics.push({
          threadId: thread.id,
          threadTitle: thread.title,
          providerId: thread.providerId,
          runId: event.runId,
          createdAt: event.createdAt,
          phase: typeof activity.phase === 'string' ? activity.phase : null,
          summary: typeof activity.summary === 'string' ? activity.summary : 'Unknown terminal activity',
          command: typeof activity.command === 'string' ? activity.command : null,
          cwd: typeof activity.cwd === 'string' ? activity.cwd : null,
          isolationMode:
            typeof activity.isolationMode === 'string'
              ? activity.isolationMode
              : null
        });
      }
    }

    const subagents = listSubagentsForThread(db, thread.id);
    for (const runId of runIds) {
      harnessHandoffStateDiagnostics.push(deriveHarnessHandoffState({
        threadId: thread.id,
        runId,
        turns: thread.turns,
        rawOutput: thread.rawOutput,
        followUps: thread.followUps,
        subagents
      }));
    }
  }

  const runtimeTraceDiagnostics: ExportedRuntimeTraceDiagnostic[] = [...runtimeTraceByRun.values()]
    .map((entry) => {
      const marks = [...entry.marks].sort((left, right) => left.at.localeCompare(right.at));
      const terminalStage =
        [...marks]
          .reverse()
          .find((mark) => mark.stage === 'completed' || mark.stage === 'failed' || mark.stage === 'aborted')?.stage ?? null;
      const submitAt = getTraceStageAt(marks, 'submit_received');
      return {
        threadId: entry.threadId,
        threadTitle: entry.threadTitle,
        providerId: entry.providerId,
        runId: entry.runId,
        firstRecordedAt: marks[0]?.at ?? '',
        stageCount: marks.length,
        terminalStage,
        marks,
        submitToContextCompleteMs: diffMs(submitAt, getTraceStageAt(marks, 'workspace_context_completed')),
        contextAssemblyMs: diffMs(getTraceStageAt(marks, 'workspace_context_started'), getTraceStageAt(marks, 'workspace_context_completed')),
        submitToPromptAssembledMs: diffMs(submitAt, getTraceStageAt(marks, 'prompt_assembled')),
        submitToRunStartedMs: diffMs(submitAt, getTraceStageAt(marks, 'run_started')),
        submitToFirstDeltaMs: diffMs(submitAt, getTraceStageAt(marks, 'first_delta')),
        submitToFirstToolCallMs: diffMs(submitAt, getTraceStageAt(marks, 'first_tool_call')),
        submitToFirstToolResultMs: diffMs(submitAt, getTraceStageAt(marks, 'first_tool_result')),
        submitToTerminalMs: diffMs(
          submitAt,
          terminalStage ? getTraceStageAt(marks, terminalStage) : null
        )
      } satisfies ExportedRuntimeTraceDiagnostic;
    })
    .sort((left, right) => left.firstRecordedAt.localeCompare(right.firstRecordedAt));

  const failedRunDiagnostics: ExportedFailedRunDiagnostic[] = [...failedRunByKey.values()]
    .filter((entry) => Boolean(entry.failedAt))
    .sort((left, right) => left.failedAt.localeCompare(right.failedAt));

  const runEvidenceBundles = buildRunEvidenceBundles({
    threadById,
    runIdsByThread,
    promptSectionEvidenceDiagnostics,
    modelRoutingEvidenceDiagnostics,
    toolRoutingEvidenceDiagnostics,
    infrastructureEvidenceDiagnostics,
    toolRuntimeDiagnostics,
    terminalCommandDiagnostics,
    verificationArtifactDiagnostics,
    stagedWorkspaceHunkReviewDecisionDiagnostics,
    worktreeReviewDecisionDiagnostics,
    worktreeHunkReviewDecisionDiagnostics,
    worktreeCleanupDecisionDiagnostics,
    harnessHookEvidenceDiagnostics,
    finalEvidenceSummaryDiagnostics,
    harnessHandoffStateDiagnostics,
    runtimeTraceDiagnostics,
    failedRunDiagnostics
  });

  return {
    providerEventDiagnostics,
    nativeProgressSnapshots,
    toolRuntimeDiagnostics,
    terminalCommandDiagnostics,
    verificationArtifactDiagnostics,
    promptSectionEvidenceDiagnostics,
    modelRoutingEvidenceDiagnostics,
    toolRoutingEvidenceDiagnostics,
    infrastructureEvidenceDiagnostics,
    stagedWorkspaceChangeDiagnostics,
    stagedWorkspaceHunkReviewDecisionDiagnostics,
    worktreeChangeDiagnostics,
    worktreeReviewDecisionDiagnostics,
    worktreeHunkReviewDecisionDiagnostics,
    worktreeCleanupDecisionDiagnostics,
    harnessHookEvidenceDiagnostics,
    finalEvidenceSummaryDiagnostics,
    harnessHandoffStateDiagnostics,
    runtimeTraceDiagnostics,
    failedRunDiagnostics,
    runEvidenceBundles
  };
}
