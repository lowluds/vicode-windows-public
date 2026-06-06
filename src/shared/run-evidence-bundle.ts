import type {
  RunChangeArtifact,
  RunDiffStats,
  RunRuntimeTraceMark,
  RunRuntimeTraceStage,
  StagedWorkspaceReviewDecision,
  WorktreeCleanupDecision,
  WorktreeHunkReviewDecision,
  WorktreeReviewDecision
} from './domain';
import type { HarnessHandoffState } from './harness-handoff-state';
import type { HarnessTaskContract } from './harness-task-contract';
import type { VerificationArtifact } from './harness-verification';
import type { StagedWorkspaceHunkReviewDecision } from './hunk-review';

export interface RunEvidenceIdentity {
  threadId: string;
  threadTitle: string | null;
  projectId: string | null;
  providerId: string | null;
  modelId: string | null;
  runId: string;
  status: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  terminalStage: string | null;
}

export interface RunEvidenceTaskContractSummary {
  taskKind: HarnessTaskContract['taskKind'];
  objective: string;
  workspaceRoot: string | null;
  allowedPaths: string[];
  deniedPaths: string[];
  expectedMutations: HarnessTaskContract['expectedMutations'];
  verificationPolicy: HarnessTaskContract['verificationPolicy'];
  isolationMode: HarnessTaskContract['isolationMode'];
  riskLevel: HarnessTaskContract['riskLevel'];
  executionPermission: HarnessTaskContract['executionPermission'];
  trustedWorkspace: boolean;
  runtimeCommandPolicy: HarnessTaskContract['runtimeCommandPolicy'];
  runtimeNetworkPolicy: HarnessTaskContract['runtimeNetworkPolicy'];
  commandAccess: HarnessTaskContract['commandAccess'];
  networkAccess: HarnessTaskContract['networkAccess'];
}

export interface RunEvidencePromptSectionSummary {
  sectionId: string | null;
  title: string | null;
  placement: string | null;
  characterCount: number | null;
  reason: string | null;
  createdAt?: string | null;
}

export interface RunEvidencePromptSummary {
  sections: RunEvidencePromptSectionSummary[];
  sectionCount: number;
}

export interface RunEvidenceModelRoutingSummary {
  modelId: string | null;
  customProviderId: string | null;
  ollamaTransportMode: string | null;
  runMode: string | null;
  providerLabel: string | null;
  transportKind: string | null;
  runtimeAuthority: string | null;
  reason: string | null;
  createdAt?: string | null;
}

export interface RunEvidenceToolRoutingSummary {
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
  createdAt?: string | null;
}

export interface RunEvidenceInfrastructureSummary {
  infrastructureId: string | null;
  label: string | null;
  available: boolean | null;
  reason: string | null;
  toolCallNames: string[];
  createdAt?: string | null;
}

export interface RunEvidenceRuntimeTraceInput {
  marks?: RunRuntimeTraceMark[];
}

export interface RunEvidenceRuntimeTraceSummary {
  firstRecordedAt: string | null;
  lastRecordedAt: string | null;
  stageCount: number;
  terminalStage: RunRuntimeTraceStage | string | null;
  stagesSeen: string[];
  stageCounts: Record<string, number>;
  failureStage: string | null;
  failureMessage: string | null;
  failureReason: string | null;
}

export interface RunEvidenceToolExecutionToolSummary {
  toolName: string;
  callCount: number;
  resultCount: number;
  mutatesWorkspace: boolean | null;
  errorCount: number;
}

export interface RunEvidenceTerminalCommandSummary {
  command: string | null;
  cwd: string | null;
  status: string | null;
  exitCode: number | null;
  durationMs: number | null;
}

export interface RunEvidenceToolExecutionInput {
  toolCallCount?: number | null;
  toolResultCount?: number | null;
  terminalCommandCount?: number | null;
  mutatingToolCallCount?: number | null;
  tools?: RunEvidenceToolExecutionToolSummary[];
  terminalCommands?: RunEvidenceTerminalCommandSummary[];
}

export interface RunEvidenceToolExecutionSummary {
  toolCallCount: number;
  toolResultCount: number;
  terminalCommandCount: number;
  mutatingToolCallCount: number;
  tools: RunEvidenceToolExecutionToolSummary[];
  terminalCommands: RunEvidenceTerminalCommandSummary[];
}

export interface RunEvidenceVerificationArtifactSummary {
  command: string | null;
  cwd: string | null;
  permissionProfile: string | null;
  networkPolicy: string | null;
  status: VerificationArtifact['status'];
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  reason: string | null;
  skippedReason: string | null;
}

export interface RunEvidenceVerificationSummary {
  artifacts: RunEvidenceVerificationArtifactSummary[];
  artifactCount: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  latestStatus: VerificationArtifact['status'] | null;
}

export interface RunEvidenceChangedFileSummary {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  insertions: number;
  deletions: number;
  previewTruncated: boolean;
}

export interface RunEvidenceChangeArtifactSummary {
  source: NonNullable<RunChangeArtifact['source']> | 'unknown';
  summary: RunDiffStats;
  files: RunEvidenceChangedFileSummary[];
}

export interface RunEvidenceChangeReviewSummary {
  changeArtifacts: RunEvidenceChangeArtifactSummary[];
  stagedReviewDecisions: StagedWorkspaceReviewDecision[];
  stagedHunkReviewDecisions: StagedWorkspaceHunkReviewDecision[];
  worktreeReviewDecisions: WorktreeReviewDecision[];
  worktreeHunkReviewDecisions: WorktreeHunkReviewDecision[];
  latestStagedDecision: StagedWorkspaceReviewDecision | null;
  latestStagedHunkDecision: StagedWorkspaceHunkReviewDecision | null;
  latestWorktreeDecision: WorktreeReviewDecision | null;
  latestWorktreeHunkDecision: WorktreeHunkReviewDecision | null;
}

export interface RunEvidenceWorktreeCleanupSummary {
  decisions: WorktreeCleanupDecision[];
  latestDecision: WorktreeCleanupDecision | null;
}

export interface RunEvidenceHookSummaryInput {
  stage: string;
  sequence: number | null;
  at: string | null;
  turnIndex?: number | null;
  toolName?: string | null;
  summary?: string | null;
  isError?: boolean | null;
  mutatesWorkspace?: boolean | null;
  verificationCommand?: string | null;
  verificationStatus?: string | null;
  contextPressureSeverity?: string | null;
  contextPressureCheckpointRecommended?: boolean | null;
  contextPressureCompactionLikely?: boolean | null;
  continuationReason?: string | null;
}

export interface RunEvidenceHookSummary {
  hooks: RunEvidenceHookSummaryInput[];
  stagesSeen: string[];
  continuationReasons: string[];
  contextPressureSeverity: string | null;
  contextPressureCheckpointRecommended: boolean | null;
  contextPressureCompactionLikely: boolean | null;
}

export interface RunEvidenceFinalSummary {
  runId: string;
  usedMutatingTool: boolean;
  usedFileContentMutationTool: boolean;
  usedNativeWebResearchTool: boolean;
  postMutationVerificationRequired: boolean;
  postMutationVerificationPassed: boolean;
  verificationCommand: string | null;
  verificationStatus: string | null;
  createdDirectoriesCount: number;
  writtenFilesCount: number;
  toolCallCount: number;
  reminderCount: number;
}

export interface RunEvidenceHandoffSummary {
  threadId: string;
  runId: string;
  createdAt: string;
  taskContract: HarnessHandoffState['taskContract'];
  workspace: HarnessHandoffState['workspace'];
  change: HarnessHandoffState['change'];
  verification: HarnessHandoffState['verification'];
  finalEvidenceSummary: HarnessHandoffState['finalEvidenceSummary'];
  hooks: HarnessHandoffState['hooks'];
  subagents: HarnessHandoffState['subagents'];
  outstandingTasks: string[];
  recommendedNextAction: HarnessHandoffState['recommendedNextAction'];
  recommendedNextPrompt: string;
}

export interface RunEvidenceRedactionMetadata {
  mode: 'support_safe';
  omittedFields: string[];
  redactedPatterns: string[];
}

export interface RunEvidenceBundleV1 {
  schemaVersion: 1;
  identity: RunEvidenceIdentity;
  taskContractSummary: RunEvidenceTaskContractSummary | null;
  promptEvidence: RunEvidencePromptSummary;
  modelRoutingEvidence: RunEvidenceModelRoutingSummary[];
  toolRoutingEvidence: RunEvidenceToolRoutingSummary[];
  infrastructureEvidence: RunEvidenceInfrastructureSummary[];
  runtimeTraceSummary: RunEvidenceRuntimeTraceSummary;
  toolExecutionSummary: RunEvidenceToolExecutionSummary;
  verificationEvidence: RunEvidenceVerificationSummary;
  changeReviewEvidence: RunEvidenceChangeReviewSummary;
  worktreeCleanupEvidence: RunEvidenceWorktreeCleanupSummary | null;
  hookEvidence: RunEvidenceHookSummary;
  finalEvidenceSummary: RunEvidenceFinalSummary | null;
  handoffState: RunEvidenceHandoffSummary | null;
  redactionMetadata: RunEvidenceRedactionMetadata;
  limitations: string[];
}

export interface BuildRunEvidenceBundleInput {
  identity: {
    threadId: string;
    threadTitle?: string | null;
    projectId?: string | null;
    providerId?: string | null;
    modelId?: string | null;
    runId: string;
    status?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    failedAt?: string | null;
    terminalStage?: string | null;
  };
  taskContract?: HarnessTaskContract | null;
  promptEvidence?: RunEvidencePromptSectionSummary[];
  modelRoutingEvidence?: RunEvidenceModelRoutingSummary[];
  toolRoutingEvidence?: RunEvidenceToolRoutingSummary[];
  infrastructureEvidence?: RunEvidenceInfrastructureSummary[];
  runtimeTrace?: RunEvidenceRuntimeTraceInput | null;
  toolExecution?: RunEvidenceToolExecutionInput | null;
  verificationArtifacts?: VerificationArtifact[];
  changeArtifacts?: RunChangeArtifact[];
  stagedReviewDecisions?: StagedWorkspaceReviewDecision[];
  stagedHunkReviewDecisions?: StagedWorkspaceHunkReviewDecision[];
  worktreeReviewDecisions?: WorktreeReviewDecision[];
  worktreeHunkReviewDecisions?: WorktreeHunkReviewDecision[];
  worktreeCleanupDecisions?: WorktreeCleanupDecision[];
  hookEvidence?: RunEvidenceHookSummaryInput[];
  finalEvidenceSummary?: RunEvidenceFinalSummary | null;
  handoffState?: HarnessHandoffState | null;
  failedRun?: {
    failureStage?: string | null;
    failureMessage?: string | null;
    failureReason?: string | null;
  } | null;
}

const REQUIRED_LIMITATIONS = [
  'RunEvidenceBundleV1 is not deterministic replay.',
  'Raw provider request and response payloads are omitted.',
  'Raw prompt text and context contents are omitted.',
  'Full file contents and patch text are omitted.',
  'Raw hunk preview line content is omitted.',
  'OS/container sandboxing is out of scope.',
  'Some historical runs may not have all evidence sections.'
];

const OMITTED_FIELDS = [
  'raw system prompt',
  'raw user prompt',
  'raw context contents',
  'full assembled prompt',
  'raw provider request payload',
  'raw provider response payload',
  'raw tool payload',
  'terminal output streams',
  'source file content fields',
  'proposed file content fields',
  'patch text fields',
  'diff preview line content',
  'secrets',
  'tokens',
  'full local roots'
];

function sanitizeString(value: string): string {
  return value
    .replace(/[A-Za-z]:[\\/][^\r\n"',}]+/gu, '[local-path]')
    .replace(/\\\\[^\r\n"',}]+/gu, '[local-path]')
    .replace(/\/(?:Users|home|var|tmp|mnt|Volumes)\/[^\r\n"',}]+/gu, '[local-path]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9_]{8,}|(?:secret|token)[-_][A-Za-z0-9_-]+)\b/giu, '[redacted-secret]')
    .replace(/\b(?:api[_-]?key|token|secret|password|credential|session)\b\s*[:=]\s*[^\s,;)]+/giu, '[redacted-secret]');
}

function sanitizeStringOrNull(value: string | null | undefined) {
  return typeof value === 'string' ? sanitizeString(value) : null;
}

function sanitizeStringArray(values: string[] | undefined) {
  return (values ?? []).map((value) => sanitizeString(value));
}

function finiteNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function latest<T>(items: T[]) {
  return items.length > 0 ? items[items.length - 1] : null;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function sanitizeIdentity(input: BuildRunEvidenceBundleInput['identity']): RunEvidenceIdentity {
  return {
    threadId: sanitizeString(input.threadId),
    threadTitle: sanitizeStringOrNull(input.threadTitle),
    projectId: sanitizeStringOrNull(input.projectId),
    providerId: sanitizeStringOrNull(input.providerId),
    modelId: sanitizeStringOrNull(input.modelId),
    runId: sanitizeString(input.runId),
    status: sanitizeStringOrNull(input.status),
    startedAt: sanitizeStringOrNull(input.startedAt),
    completedAt: sanitizeStringOrNull(input.completedAt),
    failedAt: sanitizeStringOrNull(input.failedAt),
    terminalStage: sanitizeStringOrNull(input.terminalStage)
  };
}

function summarizeTaskContract(contract: HarnessTaskContract | null | undefined): RunEvidenceTaskContractSummary | null {
  if (!contract) {
    return null;
  }

  return {
    taskKind: contract.taskKind,
    objective: sanitizeString(contract.objective),
    workspaceRoot: sanitizeStringOrNull(contract.workspaceRoot),
    allowedPaths: sanitizeStringArray(contract.allowedPaths),
    deniedPaths: sanitizeStringArray(contract.deniedPaths),
    expectedMutations: contract.expectedMutations,
    verificationPolicy: contract.verificationPolicy,
    isolationMode: contract.isolationMode,
    riskLevel: contract.riskLevel,
    executionPermission: contract.executionPermission,
    trustedWorkspace: contract.trustedWorkspace,
    runtimeCommandPolicy: contract.runtimeCommandPolicy,
    runtimeNetworkPolicy: contract.runtimeNetworkPolicy,
    commandAccess: contract.commandAccess,
    networkAccess: contract.networkAccess
  };
}

function summarizePromptEvidence(
  sections: RunEvidencePromptSectionSummary[] | undefined
): RunEvidencePromptSummary {
  const safeSections = (sections ?? []).map((section) => ({
    sectionId: sanitizeStringOrNull(section.sectionId),
    title: sanitizeStringOrNull(section.title),
    placement: sanitizeStringOrNull(section.placement),
    characterCount: typeof section.characterCount === 'number' ? section.characterCount : null,
    reason: sanitizeStringOrNull(section.reason),
    createdAt: sanitizeStringOrNull(section.createdAt)
  }));

  return {
    sections: safeSections,
    sectionCount: safeSections.length
  };
}

function sanitizeModelRoutingEvidence(
  evidence: RunEvidenceModelRoutingSummary[] | undefined
): RunEvidenceModelRoutingSummary[] {
  return (evidence ?? []).map((item) => ({
    modelId: sanitizeStringOrNull(item.modelId),
    customProviderId: sanitizeStringOrNull(item.customProviderId),
    ollamaTransportMode: sanitizeStringOrNull(item.ollamaTransportMode),
    runMode: sanitizeStringOrNull(item.runMode),
    providerLabel: sanitizeStringOrNull(item.providerLabel),
    transportKind: sanitizeStringOrNull(item.transportKind),
    runtimeAuthority: sanitizeStringOrNull(item.runtimeAuthority),
    reason: sanitizeStringOrNull(item.reason),
    createdAt: sanitizeStringOrNull(item.createdAt)
  }));
}

function sanitizeToolRoutingEvidence(
  evidence: RunEvidenceToolRoutingSummary[] | undefined
): RunEvidenceToolRoutingSummary[] {
  return (evidence ?? []).map((item) => ({
    toolId: sanitizeStringOrNull(item.toolId),
    callName: sanitizeStringOrNull(item.callName),
    name: sanitizeStringOrNull(item.name),
    origin: sanitizeStringOrNull(item.origin),
    visibilityGroup: sanitizeStringOrNull(item.visibilityGroup),
    included: typeof item.included === 'boolean' ? item.included : null,
    reason: sanitizeStringOrNull(item.reason),
    mutatesWorkspace: typeof item.mutatesWorkspace === 'boolean' ? item.mutatesWorkspace : null,
    requiresApproval: typeof item.requiresApproval === 'boolean' ? item.requiresApproval : null,
    readsWorkspace: typeof item.readsWorkspace === 'boolean' ? item.readsWorkspace : null,
    usesNetwork: typeof item.usesNetwork === 'boolean' ? item.usesNetwork : null,
    createdAt: sanitizeStringOrNull(item.createdAt)
  }));
}

function sanitizeInfrastructureEvidence(
  evidence: RunEvidenceInfrastructureSummary[] | undefined
): RunEvidenceInfrastructureSummary[] {
  return (evidence ?? []).map((item) => ({
    infrastructureId: sanitizeStringOrNull(item.infrastructureId),
    label: sanitizeStringOrNull(item.label),
    available: typeof item.available === 'boolean' ? item.available : null,
    reason: sanitizeStringOrNull(item.reason),
    toolCallNames: sanitizeStringArray(item.toolCallNames),
    createdAt: sanitizeStringOrNull(item.createdAt)
  }));
}

function stageFromMark(mark: RunRuntimeTraceMark): string {
  return sanitizeString(mark.stage);
}

function summarizeRuntimeTrace(
  runtimeTrace: RunEvidenceRuntimeTraceInput | null | undefined,
  failedRun: BuildRunEvidenceBundleInput['failedRun']
): RunEvidenceRuntimeTraceSummary {
  const marks = runtimeTrace?.marks ?? [];
  const stageCounts: Record<string, number> = {};
  for (const mark of marks) {
    const stage = stageFromMark(mark);
    stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
  }

  const failedMark = [...marks].reverse().find((mark) => mark.stage === 'failed' || mark.stage === 'aborted');
  const failedDetail = failedMark?.detail;
  const failedMessage =
    failedRun?.failureMessage
    ?? (failedDetail && typeof failedDetail.message === 'string' ? failedDetail.message : null);
  const failedReason =
    failedRun?.failureReason
    ?? (failedDetail && typeof failedDetail.reason === 'string' ? failedDetail.reason : null);
  const terminalStage = marks.at(-1)?.stage ?? failedRun?.failureStage ?? null;

  return {
    firstRecordedAt: sanitizeStringOrNull(marks[0]?.at),
    lastRecordedAt: sanitizeStringOrNull(marks.at(-1)?.at),
    stageCount: marks.length,
    terminalStage: sanitizeStringOrNull(terminalStage),
    stagesSeen: unique(marks.map(stageFromMark)),
    stageCounts,
    failureStage: sanitizeStringOrNull(failedRun?.failureStage ?? failedMark?.stage ?? null),
    failureMessage: sanitizeStringOrNull(failedMessage),
    failureReason: sanitizeStringOrNull(failedReason)
  };
}

function summarizeToolExecution(
  toolExecution: RunEvidenceToolExecutionInput | null | undefined
): RunEvidenceToolExecutionSummary {
  return {
    toolCallCount: finiteNumber(toolExecution?.toolCallCount),
    toolResultCount: finiteNumber(toolExecution?.toolResultCount),
    terminalCommandCount: finiteNumber(toolExecution?.terminalCommandCount),
    mutatingToolCallCount: finiteNumber(toolExecution?.mutatingToolCallCount),
    tools: (toolExecution?.tools ?? []).map((tool) => ({
      toolName: sanitizeString(tool.toolName),
      callCount: finiteNumber(tool.callCount),
      resultCount: finiteNumber(tool.resultCount),
      mutatesWorkspace: typeof tool.mutatesWorkspace === 'boolean' ? tool.mutatesWorkspace : null,
      errorCount: finiteNumber(tool.errorCount)
    })),
    terminalCommands: (toolExecution?.terminalCommands ?? []).map((command) => ({
      command: sanitizeStringOrNull(command.command),
      cwd: sanitizeStringOrNull(command.cwd),
      status: sanitizeStringOrNull(command.status),
      exitCode: typeof command.exitCode === 'number' ? command.exitCode : null,
      durationMs: typeof command.durationMs === 'number' ? command.durationMs : null
    }))
  };
}

function summarizeVerification(
  artifacts: VerificationArtifact[] | undefined
): RunEvidenceVerificationSummary {
  const safeArtifacts = (artifacts ?? []).map((artifact) => ({
    command: sanitizeStringOrNull(artifact.command),
    cwd: sanitizeStringOrNull(artifact.cwd),
    permissionProfile: sanitizeStringOrNull(artifact.permissionProfile),
    networkPolicy: sanitizeStringOrNull(artifact.networkPolicy),
    status: artifact.status,
    exitCode: artifact.exitCode,
    startedAt: sanitizeStringOrNull(artifact.startedAt),
    finishedAt: sanitizeStringOrNull(artifact.finishedAt),
    durationMs: artifact.durationMs,
    reason: sanitizeStringOrNull(artifact.reason),
    skippedReason: sanitizeStringOrNull(artifact.skippedReason)
  }));

  return {
    artifacts: safeArtifacts,
    artifactCount: safeArtifacts.length,
    passedCount: safeArtifacts.filter((artifact) => artifact.status === 'passed').length,
    failedCount: safeArtifacts.filter((artifact) => artifact.status === 'failed' || artifact.status === 'timed_out').length,
    skippedCount: safeArtifacts.filter((artifact) => artifact.status === 'skipped').length,
    latestStatus: safeArtifacts.at(-1)?.status ?? null
  };
}

function summarizeChangeArtifact(artifact: RunChangeArtifact): RunEvidenceChangeArtifactSummary {
  return {
    source: artifact.source ?? 'unknown',
    summary: {
      filesChanged: finiteNumber(artifact.summary.filesChanged),
      insertions: finiteNumber(artifact.summary.insertions),
      deletions: finiteNumber(artifact.summary.deletions)
    },
    files: artifact.files.map((file) => ({
      path: sanitizeString(file.path),
      status: file.status,
      insertions: finiteNumber(file.insertions),
      deletions: finiteNumber(file.deletions),
      previewTruncated: file.previewTruncated
    }))
  };
}

function sanitizeStagedDecision(decision: StagedWorkspaceReviewDecision): StagedWorkspaceReviewDecision {
  return {
    ...decision,
    threadId: sanitizeString(decision.threadId),
    runId: sanitizeString(decision.runId),
    stagedEventId: sanitizeString(decision.stagedEventId),
    changedPaths: sanitizeStringArray(decision.changedPaths),
    errorReason: sanitizeStringOrNull(decision.errorReason),
    createdAt: sanitizeString(decision.createdAt)
  };
}

function sanitizeStagedHunkDecision(
  decision: StagedWorkspaceHunkReviewDecision
): StagedWorkspaceHunkReviewDecision {
  return {
    ...decision,
    threadId: sanitizeString(decision.threadId),
    runId: sanitizeString(decision.runId),
    stagedEventId: sanitizeString(decision.stagedEventId),
    changedPaths: sanitizeStringArray(decision.changedPaths),
    hunkIds: sanitizeStringArray(decision.hunkIds),
    acceptedHunkIds: sanitizeStringArray(decision.acceptedHunkIds),
    rejectedHunkIds: sanitizeStringArray(decision.rejectedHunkIds),
    errorReason: sanitizeStringOrNull(decision.errorReason),
    createdAt: sanitizeString(decision.createdAt)
  };
}

function sanitizeWorktreeReviewDecision(decision: WorktreeReviewDecision): WorktreeReviewDecision {
  return {
    ...decision,
    threadId: sanitizeString(decision.threadId),
    runId: sanitizeString(decision.runId),
    branchName: sanitizeString(decision.branchName),
    baseSha: sanitizeString(decision.baseSha),
    sourceWorkspaceRelativePath: sanitizeString(decision.sourceWorkspaceRelativePath),
    changedPaths: sanitizeStringArray(decision.changedPaths),
    errorReason: sanitizeStringOrNull(decision.errorReason),
    createdAt: sanitizeString(decision.createdAt)
  };
}

function sanitizeWorktreeHunkDecision(decision: WorktreeHunkReviewDecision): WorktreeHunkReviewDecision {
  return {
    ...decision,
    threadId: sanitizeString(decision.threadId),
    runId: sanitizeString(decision.runId),
    branchName: sanitizeString(decision.branchName),
    baseSha: sanitizeString(decision.baseSha),
    sourceWorkspaceRelativePath: sanitizeString(decision.sourceWorkspaceRelativePath),
    changedPaths: sanitizeStringArray(decision.changedPaths),
    hunkIds: sanitizeStringArray(decision.hunkIds),
    acceptedHunkIds: sanitizeStringArray(decision.acceptedHunkIds),
    rejectedHunkIds: sanitizeStringArray(decision.rejectedHunkIds),
    errorReason: sanitizeStringOrNull(decision.errorReason),
    createdAt: sanitizeString(decision.createdAt)
  };
}

function summarizeChangeReviewEvidence(input: BuildRunEvidenceBundleInput): RunEvidenceChangeReviewSummary {
  const stagedReviewDecisions = (input.stagedReviewDecisions ?? []).map(sanitizeStagedDecision);
  const stagedHunkReviewDecisions = (input.stagedHunkReviewDecisions ?? []).map(sanitizeStagedHunkDecision);
  const worktreeReviewDecisions = (input.worktreeReviewDecisions ?? []).map(sanitizeWorktreeReviewDecision);
  const worktreeHunkReviewDecisions = (input.worktreeHunkReviewDecisions ?? []).map(sanitizeWorktreeHunkDecision);

  return {
    changeArtifacts: (input.changeArtifacts ?? []).map(summarizeChangeArtifact),
    stagedReviewDecisions,
    stagedHunkReviewDecisions,
    worktreeReviewDecisions,
    worktreeHunkReviewDecisions,
    latestStagedDecision: latest(stagedReviewDecisions),
    latestStagedHunkDecision: latest(stagedHunkReviewDecisions),
    latestWorktreeDecision: latest(worktreeReviewDecisions),
    latestWorktreeHunkDecision: latest(worktreeHunkReviewDecisions)
  };
}

function sanitizeWorktreeCleanupDecision(decision: WorktreeCleanupDecision): WorktreeCleanupDecision {
  return {
    ...decision,
    threadId: sanitizeString(decision.threadId),
    runId: sanitizeString(decision.runId),
    branchName: sanitizeString(decision.branchName),
    baseSha: sanitizeString(decision.baseSha),
    cleanupPolicy: sanitizeString(decision.cleanupPolicy),
    errorReason: sanitizeStringOrNull(decision.errorReason),
    createdAt: sanitizeString(decision.createdAt)
  };
}

function summarizeWorktreeCleanupEvidence(
  decisions: WorktreeCleanupDecision[] | undefined
): RunEvidenceWorktreeCleanupSummary | null {
  const safeDecisions = (decisions ?? []).map(sanitizeWorktreeCleanupDecision);
  if (safeDecisions.length === 0) {
    return null;
  }

  return {
    decisions: safeDecisions,
    latestDecision: latest(safeDecisions)
  };
}

function summarizeHooks(hooks: RunEvidenceHookSummaryInput[] | undefined): RunEvidenceHookSummary {
  const safeHooks = (hooks ?? []).map((hook) => ({
    stage: sanitizeString(hook.stage),
    sequence: typeof hook.sequence === 'number' ? hook.sequence : null,
    at: sanitizeStringOrNull(hook.at),
    turnIndex: typeof hook.turnIndex === 'number' ? hook.turnIndex : null,
    toolName: sanitizeStringOrNull(hook.toolName),
    summary: sanitizeStringOrNull(hook.summary),
    isError: typeof hook.isError === 'boolean' ? hook.isError : null,
    mutatesWorkspace: typeof hook.mutatesWorkspace === 'boolean' ? hook.mutatesWorkspace : null,
    verificationCommand: sanitizeStringOrNull(hook.verificationCommand),
    verificationStatus: sanitizeStringOrNull(hook.verificationStatus),
    contextPressureSeverity: sanitizeStringOrNull(hook.contextPressureSeverity),
    contextPressureCheckpointRecommended:
      typeof hook.contextPressureCheckpointRecommended === 'boolean'
        ? hook.contextPressureCheckpointRecommended
        : null,
    contextPressureCompactionLikely:
      typeof hook.contextPressureCompactionLikely === 'boolean'
        ? hook.contextPressureCompactionLikely
        : null,
    continuationReason: sanitizeStringOrNull(hook.continuationReason)
  }));

  return {
    hooks: safeHooks,
    stagesSeen: unique(safeHooks.map((hook) => hook.stage)),
    continuationReasons: unique(
      safeHooks
        .map((hook) => hook.continuationReason)
        .filter((reason): reason is string => Boolean(reason))
    ),
    contextPressureSeverity: [...safeHooks].reverse().find((hook) => hook.contextPressureSeverity)?.contextPressureSeverity ?? null,
    contextPressureCheckpointRecommended:
      [...safeHooks].reverse().find((hook) => hook.contextPressureCheckpointRecommended !== null)
        ?.contextPressureCheckpointRecommended ?? null,
    contextPressureCompactionLikely:
      [...safeHooks].reverse().find((hook) => hook.contextPressureCompactionLikely !== null)
        ?.contextPressureCompactionLikely ?? null
  };
}

function summarizeFinalEvidence(summary: RunEvidenceFinalSummary | null | undefined): RunEvidenceFinalSummary | null {
  if (!summary) {
    return null;
  }

  return {
    runId: sanitizeString(summary.runId),
    usedMutatingTool: summary.usedMutatingTool,
    usedFileContentMutationTool: summary.usedFileContentMutationTool,
    usedNativeWebResearchTool: summary.usedNativeWebResearchTool,
    postMutationVerificationRequired: summary.postMutationVerificationRequired,
    postMutationVerificationPassed: summary.postMutationVerificationPassed,
    verificationCommand: sanitizeStringOrNull(summary.verificationCommand),
    verificationStatus: sanitizeStringOrNull(summary.verificationStatus),
    createdDirectoriesCount: finiteNumber(summary.createdDirectoriesCount),
    writtenFilesCount: finiteNumber(summary.writtenFilesCount),
    toolCallCount: finiteNumber(summary.toolCallCount),
    reminderCount: finiteNumber(summary.reminderCount)
  };
}

function summarizeHandoffState(state: HarnessHandoffState | null | undefined): RunEvidenceHandoffSummary | null {
  if (!state) {
    return null;
  }

  return {
    threadId: sanitizeString(state.threadId),
    runId: sanitizeString(state.runId),
    createdAt: sanitizeString(state.createdAt),
    taskContract: state.taskContract
      ? {
          ...state.taskContract,
          objective: sanitizeString(state.taskContract.objective)
        }
      : null,
    workspace: {
      trustedWorkspace: state.workspace.trustedWorkspace,
      workspaceRoot: sanitizeStringOrNull(state.workspace.workspaceRoot),
      allowedPaths: sanitizeStringArray(state.workspace.allowedPaths),
      deniedPaths: sanitizeStringArray(state.workspace.deniedPaths)
    },
    change: {
      ...state.change,
      changedFiles: sanitizeStringArray(state.change.changedFiles)
    },
    verification: {
      command: sanitizeStringOrNull(state.verification.command),
      status: state.verification.status,
      skippedReason: sanitizeStringOrNull(state.verification.skippedReason),
      reason: sanitizeStringOrNull(state.verification.reason)
    },
    finalEvidenceSummary: state.finalEvidenceSummary
      ? {
          ...state.finalEvidenceSummary,
          runId: sanitizeString(state.finalEvidenceSummary.runId),
          verificationCommand: sanitizeStringOrNull(state.finalEvidenceSummary.verificationCommand)
        }
      : null,
    hooks: {
      ...state.hooks,
      stagesSeen: sanitizeStringArray(state.hooks.stagesSeen),
      continuationReasons: sanitizeStringArray(state.hooks.continuationReasons)
    },
    subagents: state.subagents.map((subagent) => ({
      ...subagent,
      id: sanitizeString(subagent.id),
      parentRunId: sanitizeStringOrNull(subagent.parentRunId),
      childThreadId: sanitizeStringOrNull(subagent.childThreadId),
      childRunId: sanitizeStringOrNull(subagent.childRunId),
      outputSummary: sanitizeStringOrNull(subagent.outputSummary),
      lastError: sanitizeStringOrNull(subagent.lastError)
    })),
    outstandingTasks: sanitizeStringArray(state.outstandingTasks),
    recommendedNextAction: state.recommendedNextAction,
    recommendedNextPrompt: sanitizeString(state.recommendedNextPrompt)
  };
}

function buildLimitations(input: BuildRunEvidenceBundleInput) {
  const limitations = [...REQUIRED_LIMITATIONS];
  if (!input.taskContract) {
    limitations.push('Task contract evidence is missing for this run.');
  }
  if (!input.promptEvidence?.length) {
    limitations.push('Prompt section evidence is missing for this run.');
  }
  if (!input.modelRoutingEvidence?.length) {
    limitations.push('Model routing evidence is missing for this run.');
  }
  if (!input.toolRoutingEvidence?.length) {
    limitations.push('Tool routing evidence is missing for this run.');
  }
  if (!input.infrastructureEvidence?.length) {
    limitations.push('Infrastructure evidence is missing for this run.');
  }
  if (!input.verificationArtifacts?.length) {
    limitations.push('Verification evidence is missing for this run.');
  }
  if (
    !input.changeArtifacts?.length
    && !input.stagedReviewDecisions?.length
    && !input.stagedHunkReviewDecisions?.length
    && !input.worktreeReviewDecisions?.length
    && !input.worktreeHunkReviewDecisions?.length
  ) {
    limitations.push('Change or review evidence is missing for this run.');
  }
  if (!input.finalEvidenceSummary) {
    limitations.push('Final evidence summary is missing for this run.');
  }
  if (!input.handoffState) {
    limitations.push('Harness handoff state is missing for this run.');
  }
  return limitations;
}

export function buildRunEvidenceBundleV1(input: BuildRunEvidenceBundleInput): RunEvidenceBundleV1 {
  return {
    schemaVersion: 1,
    identity: sanitizeIdentity(input.identity),
    taskContractSummary: summarizeTaskContract(input.taskContract),
    promptEvidence: summarizePromptEvidence(input.promptEvidence),
    modelRoutingEvidence: sanitizeModelRoutingEvidence(input.modelRoutingEvidence),
    toolRoutingEvidence: sanitizeToolRoutingEvidence(input.toolRoutingEvidence),
    infrastructureEvidence: sanitizeInfrastructureEvidence(input.infrastructureEvidence),
    runtimeTraceSummary: summarizeRuntimeTrace(input.runtimeTrace, input.failedRun),
    toolExecutionSummary: summarizeToolExecution(input.toolExecution),
    verificationEvidence: summarizeVerification(input.verificationArtifacts),
    changeReviewEvidence: summarizeChangeReviewEvidence(input),
    worktreeCleanupEvidence: summarizeWorktreeCleanupEvidence(input.worktreeCleanupDecisions),
    hookEvidence: summarizeHooks(input.hookEvidence),
    finalEvidenceSummary: summarizeFinalEvidence(input.finalEvidenceSummary),
    handoffState: summarizeHandoffState(input.handoffState),
    redactionMetadata: {
      mode: 'support_safe',
      omittedFields: OMITTED_FIELDS,
      redactedPatterns: ['absolute local filesystem paths', 'common secret and token values']
    },
    limitations: buildLimitations(input)
  };
}
