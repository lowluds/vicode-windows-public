import type {
  RunChangeArtifact,
  RunDiffStats,
  RunEvent,
  SubagentStatus,
  SubagentSummary,
  ThreadFollowUp,
  ThreadTurn
} from './domain';
import type {
  HarnessExpectedMutations,
  HarnessIsolationMode,
  HarnessRiskLevel,
  HarnessTaskContract,
  HarnessTaskKind,
  HarnessVerificationPolicy
} from './harness-task-contract';
import type { VerificationArtifactStatus } from './harness-verification';

export interface HarnessHandoffTaskContractSummary {
  objective: string;
  taskKind: HarnessTaskKind;
  expectedMutations: HarnessExpectedMutations;
  verificationPolicy: HarnessVerificationPolicy;
  isolationMode: HarnessIsolationMode;
  riskLevel: HarnessRiskLevel;
}

export interface HarnessHandoffWorkspaceSummary {
  trustedWorkspace: boolean | null;
  workspaceRoot: string | null;
  allowedPaths: string[];
  deniedPaths: string[];
}

export interface HarnessHandoffChangeSummary {
  changedFiles: string[];
  diffStats: RunDiffStats | null;
  changedFileCount: number;
}

export interface HarnessHandoffVerificationSummary {
  command: string | null;
  status: VerificationArtifactStatus | 'planned' | null;
  skippedReason: string | null;
  reason: string | null;
}

export interface HarnessHandoffFinalEvidenceSummary {
  runId: string;
  usedMutatingTool: boolean;
  usedFileContentMutationTool: boolean;
  usedNativeWebResearchTool: boolean;
  postMutationVerificationRequired: boolean;
  postMutationVerificationPassed: boolean;
  verificationCommand: string | null;
  verificationStatus: VerificationArtifactStatus | null;
  createdDirectoriesCount: number;
  writtenFilesCount: number;
  toolCallCount: number;
  reminderCount: number;
}

export interface HarnessHandoffHookSummary {
  stagesSeen: string[];
  continuationReasons: string[];
  contextPressureSeverity: string | null;
  contextPressureCheckpointRecommended: boolean | null;
  contextPressureCompactionLikely: boolean | null;
}

export interface HarnessHandoffSubagentSummary {
  id: string;
  parentRunId: string | null;
  childThreadId: string | null;
  childRunId: string | null;
  status: SubagentStatus;
  outputSummary: string | null;
  lastError: string | null;
}

export interface HarnessHandoffState {
  threadId: string;
  runId: string;
  createdAt: string;
  taskContract: HarnessHandoffTaskContractSummary | null;
  workspace: HarnessHandoffWorkspaceSummary;
  change: HarnessHandoffChangeSummary;
  verification: HarnessHandoffVerificationSummary;
  finalEvidenceSummary: HarnessHandoffFinalEvidenceSummary | null;
  hooks: HarnessHandoffHookSummary;
  subagents: HarnessHandoffSubagentSummary[];
  outstandingTasks: string[];
  recommendedNextAction:
    | 'fix_failed_verification'
    | 'continue_required_work'
    | 'continue_outstanding_tasks'
    | 'choose_verification_or_review'
    | 'review_verified_changes'
    | 'review_changes'
    | 'review_run_evidence';
  recommendedNextPrompt: string;
}

export interface DeriveHarnessHandoffStateInput {
  threadId: string;
  runId: string;
  createdAt?: string | null;
  turns: ThreadTurn[];
  rawOutput: RunEvent[];
  followUps?: ThreadFollowUp[];
  subagents?: SubagentSummary[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function booleanOrNull(value: unknown) {
  return typeof value === 'boolean' ? value : null;
}

function finiteNumberOrNull(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function shortLine(value: string) {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function readHarnessTaskContract(value: unknown): HarnessTaskContract | null {
  if (!isRecord(value)) {
    return null;
  }

  const objective = stringOrNull(value.objective);
  const taskKind = stringOrNull(value.taskKind);
  const expectedMutations = stringOrNull(value.expectedMutations);
  const verificationPolicy = stringOrNull(value.verificationPolicy);
  const isolationMode = stringOrNull(value.isolationMode);
  const riskLevel = stringOrNull(value.riskLevel);
  if (!objective || !taskKind || !expectedMutations || !verificationPolicy || !isolationMode || !riskLevel) {
    return null;
  }

  return value as unknown as HarnessTaskContract;
}

function summarizeTaskContract(contract: HarnessTaskContract | null): HarnessHandoffTaskContractSummary | null {
  if (!contract) {
    return null;
  }

  return {
    objective: shortLine(contract.objective),
    taskKind: contract.taskKind,
    expectedMutations: contract.expectedMutations,
    verificationPolicy: contract.verificationPolicy,
    isolationMode: contract.isolationMode,
    riskLevel: contract.riskLevel
  };
}

function readPayloadObject(event: RunEvent) {
  return isRecord(event.payload) ? event.payload : null;
}

function readNestedRecord(record: Record<string, unknown>, key: string) {
  return isRecord(record[key]) ? record[key] : null;
}

function findTaskContract(input: DeriveHarnessHandoffStateInput) {
  for (const turn of [...input.turns].reverse()) {
    if (turn.runId && turn.runId !== input.runId) {
      continue;
    }
    const contract = readHarnessTaskContract(turn.metadata?.harnessTaskContract);
    if (contract) {
      return contract;
    }
  }

  for (const event of [...input.rawOutput].reverse()) {
    if (event.runId !== input.runId) {
      continue;
    }
    const payload = readPayloadObject(event);
    const runtimeTrace = payload ? readNestedRecord(payload, 'runtimeTrace') : null;
    const detail = runtimeTrace ? readNestedRecord(runtimeTrace, 'detail') : null;
    const contract = detail ? readHarnessTaskContract(detail.harnessTaskContract) : null;
    if (contract) {
      return contract;
    }
  }

  return null;
}

function readDiffStats(value: unknown): RunDiffStats | null {
  if (!isRecord(value)) {
    return null;
  }
  const filesChanged = finiteNumberOrNull(value.filesChanged);
  const insertions = finiteNumberOrNull(value.insertions);
  const deletions = finiteNumberOrNull(value.deletions);
  return filesChanged !== null && insertions !== null && deletions !== null
    ? { filesChanged, insertions, deletions }
    : null;
}

function readChangeArtifact(value: unknown): RunChangeArtifact | null {
  if (!isRecord(value)) {
    return null;
  }
  const summary = readDiffStats(value.summary);
  const files = Array.isArray(value.files) ? value.files : [];
  if (!summary || files.length === 0) {
    return null;
  }
  return value as unknown as RunChangeArtifact;
}

function findChangeSummary(events: RunEvent[]): HarnessHandoffChangeSummary {
  let diffStats: RunDiffStats | null = null;
  let changeArtifact: RunChangeArtifact | null = null;

  for (const event of events) {
    const payload = readPayloadObject(event);
    if (!payload) {
      continue;
    }
    const progress = readNestedRecord(payload, 'progressSnapshot') ?? readNestedRecord(payload, 'progress');
    if (progress) {
      diffStats = readDiffStats(progress.diffStats) ?? diffStats;
      changeArtifact = readChangeArtifact(progress.changeArtifact) ?? changeArtifact;
    }

    const activity = readNestedRecord(payload, 'activity');
    if (activity) {
      changeArtifact = readChangeArtifact(activity.changeArtifact) ?? changeArtifact;
    }
  }

  const changedFiles = unique((changeArtifact?.files ?? []).map((file) => file.path));
  const resolvedDiffStats = changeArtifact?.summary ?? diffStats;
  return {
    changedFiles,
    diffStats: resolvedDiffStats,
    changedFileCount: resolvedDiffStats?.filesChanged ?? changedFiles.length
  };
}

function readVerificationSummary(record: Record<string, unknown>): HarnessHandoffVerificationSummary | null {
  const command = stringOrNull(record.command);
  const status = stringOrNull(record.status);
  const reason = stringOrNull(record.reason);
  const skippedReason = stringOrNull(record.skippedReason);
  if (!command && !status && !reason && !skippedReason) {
    return null;
  }

  return {
    command,
    status: status as HarnessHandoffVerificationSummary['status'],
    skippedReason,
    reason
  };
}

function findVerificationSummary(input: DeriveHarnessHandoffStateInput): HarnessHandoffVerificationSummary {
  for (const event of [...input.rawOutput].reverse()) {
    if (event.runId !== input.runId) {
      continue;
    }
    const payload = readPayloadObject(event);
    const artifact = payload ? readNestedRecord(payload, 'verificationArtifact') : null;
    const summary = artifact ? readVerificationSummary(artifact) : null;
    if (summary) {
      return summary;
    }
  }

  for (const turn of [...input.turns].reverse()) {
    if (turn.runId && turn.runId !== input.runId) {
      continue;
    }
    const plan = isRecord(turn.metadata?.verificationPlan) ? turn.metadata.verificationPlan : null;
    const summary = plan ? readVerificationSummary(plan) : null;
    if (summary) {
      return summary;
    }
  }

  for (const event of [...input.rawOutput].reverse()) {
    if (event.runId !== input.runId) {
      continue;
    }
    const payload = readPayloadObject(event);
    const runtimeTrace = payload ? readNestedRecord(payload, 'runtimeTrace') : null;
    const detail = runtimeTrace ? readNestedRecord(runtimeTrace, 'detail') : null;
    const plan = detail ? readNestedRecord(detail, 'verificationPlan') : null;
    const summary = plan ? readVerificationSummary(plan) : null;
    if (summary) {
      return summary;
    }
  }

  return {
    command: null,
    status: null,
    skippedReason: null,
    reason: null
  };
}

function readFinalEvidenceSummary(value: unknown): HarnessHandoffFinalEvidenceSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const runId = stringOrNull(value.runId);
  if (!runId) {
    return null;
  }

  return {
    runId,
    usedMutatingTool: booleanOrNull(value.usedMutatingTool) ?? false,
    usedFileContentMutationTool: booleanOrNull(value.usedFileContentMutationTool) ?? false,
    usedNativeWebResearchTool: booleanOrNull(value.usedNativeWebResearchTool) ?? false,
    postMutationVerificationRequired: booleanOrNull(value.postMutationVerificationRequired) ?? false,
    postMutationVerificationPassed: booleanOrNull(value.postMutationVerificationPassed) ?? false,
    verificationCommand: stringOrNull(value.verificationCommand),
    verificationStatus: stringOrNull(value.verificationStatus) as VerificationArtifactStatus | null,
    createdDirectoriesCount: finiteNumberOrNull(value.createdDirectoriesCount) ?? 0,
    writtenFilesCount: finiteNumberOrNull(value.writtenFilesCount) ?? 0,
    toolCallCount: finiteNumberOrNull(value.toolCallCount) ?? 0,
    reminderCount: finiteNumberOrNull(value.reminderCount) ?? 0
  };
}

function findFinalEvidenceSummary(events: RunEvent[]) {
  for (const event of [...events].reverse()) {
    const payload = readPayloadObject(event);
    const summary = payload ? readFinalEvidenceSummary(payload.finalEvidenceSummary) : null;
    if (summary) {
      return summary;
    }
  }
  return null;
}

function summarizeHooks(events: RunEvent[]): HarnessHandoffHookSummary {
  const stagesSeen: string[] = [];
  const continuationReasons: string[] = [];
  let contextPressureSeverity: string | null = null;
  let contextPressureCheckpointRecommended: boolean | null = null;
  let contextPressureCompactionLikely: boolean | null = null;

  for (const event of events) {
    const payload = readPayloadObject(event);
    const hook = payload ? readNestedRecord(payload, 'harnessHookEvidence') : null;
    if (!hook) {
      continue;
    }
    const stage = stringOrNull(hook.stage);
    if (stage) {
      stagesSeen.push(stage);
    }
    const continuationReason = stringOrNull(hook.continuationReason);
    if (continuationReason) {
      continuationReasons.push(continuationReason);
    }
    contextPressureSeverity = stringOrNull(hook.contextPressureSeverity) ?? contextPressureSeverity;
    contextPressureCheckpointRecommended =
      booleanOrNull(hook.contextPressureCheckpointRecommended) ?? contextPressureCheckpointRecommended;
    contextPressureCompactionLikely =
      booleanOrNull(hook.contextPressureCompactionLikely) ?? contextPressureCompactionLikely;
  }

  return {
    stagesSeen: unique(stagesSeen),
    continuationReasons: unique(continuationReasons),
    contextPressureSeverity,
    contextPressureCheckpointRecommended,
    contextPressureCompactionLikely
  };
}

function summarizeSubagents(input: DeriveHarnessHandoffStateInput): HarnessHandoffSubagentSummary[] {
  return (input.subagents ?? [])
    .filter((subagent) => subagent.parentRunId === input.runId || subagent.parentRunId === null)
    .map((subagent) => ({
      id: subagent.id,
      parentRunId: subagent.parentRunId,
      childThreadId: subagent.childThreadId,
      childRunId: subagent.childRunId,
      status: subagent.status,
      outputSummary: subagent.outputSummary,
      lastError: subagent.lastError
    }));
}

function summarizeOutstandingTasks(input: DeriveHarnessHandoffStateInput, events: RunEvent[]) {
  const tasks: string[] = [];

  for (const event of events) {
    const payload = readPayloadObject(event);
    const progress = payload
      ? readNestedRecord(payload, 'progressSnapshot') ?? readNestedRecord(payload, 'progress')
      : null;
    const items = Array.isArray(progress?.items) ? progress.items : [];
    for (const item of items) {
      if (!isRecord(item)) {
        continue;
      }
      const label = stringOrNull(item.label);
      const status = stringOrNull(item.status);
      if (label && status !== 'completed') {
        tasks.push(shortLine(label));
      }
    }
  }

  for (const followUp of input.followUps ?? []) {
    if (
      (followUp.status === 'queued' || followUp.status === 'dispatching')
      && (!followUp.targetRunId || followUp.targetRunId === input.runId)
    ) {
      tasks.push(shortLine(followUp.content));
    }
  }

  return unique(tasks).slice(0, 12);
}

function resolveRecommendedAction(input: {
  change: HarnessHandoffChangeSummary;
  hooks: HarnessHandoffHookSummary;
  outstandingTasks: string[];
  verification: HarnessHandoffVerificationSummary;
}) {
  if (input.verification.status === 'failed' || input.verification.status === 'timed_out') {
    return 'fix_failed_verification' as const;
  }
  if (input.hooks.continuationReasons.length > 0) {
    return 'continue_required_work' as const;
  }
  if (input.outstandingTasks.length > 0) {
    return 'continue_outstanding_tasks' as const;
  }
  if (input.verification.status === 'skipped') {
    return 'choose_verification_or_review' as const;
  }
  if (input.change.changedFileCount > 0 && input.verification.status === 'passed') {
    return 'review_verified_changes' as const;
  }
  if (input.change.changedFileCount > 0) {
    return 'review_changes' as const;
  }
  return 'review_run_evidence' as const;
}

function buildRecommendedPrompt(input: {
  action: HarnessHandoffState['recommendedNextAction'];
  runId: string;
  hooks: HarnessHandoffHookSummary;
  outstandingTasks: string[];
  verification: HarnessHandoffVerificationSummary;
}) {
  switch (input.action) {
    case 'fix_failed_verification':
      return `Continue run ${input.runId} by fixing failed verification for: ${input.verification.command ?? 'the planned verification command'}.`;
    case 'continue_required_work':
      return `Continue run ${input.runId} from handoff evidence and address: ${input.hooks.continuationReasons.join(', ')}.`;
    case 'continue_outstanding_tasks':
      return `Continue run ${input.runId} from handoff evidence and address: ${input.outstandingTasks.join('; ')}.`;
    case 'choose_verification_or_review':
      return `Review run ${input.runId}, choose an appropriate verification command, and record the result.`;
    case 'review_verified_changes':
      return `Review the verified changes from run ${input.runId} and decide whether to accept, revert, or continue.`;
    case 'review_changes':
      return `Review the changes from run ${input.runId} and decide what verification or follow-up is needed.`;
    case 'review_run_evidence':
    default:
      return `Review the evidence from run ${input.runId} and decide the next action.`;
  }
}

export function deriveHarnessHandoffState(input: DeriveHarnessHandoffStateInput): HarnessHandoffState {
  const runEvents = input.rawOutput.filter((event) => event.runId === input.runId);
  const taskContract = findTaskContract(input);
  const change = findChangeSummary(runEvents);
  const verification = findVerificationSummary(input);
  const finalEvidenceSummary = findFinalEvidenceSummary(runEvents);
  const hooks = summarizeHooks(runEvents);
  const subagents = summarizeSubagents(input);
  const outstandingTasks = summarizeOutstandingTasks(input, runEvents);
  const recommendedNextAction = resolveRecommendedAction({
    change,
    hooks,
    outstandingTasks,
    verification
  });

  return {
    threadId: input.threadId,
    runId: input.runId,
    createdAt: input.createdAt ?? runEvents.at(-1)?.createdAt ?? new Date().toISOString(),
    taskContract: summarizeTaskContract(taskContract),
    workspace: {
      trustedWorkspace: taskContract?.trustedWorkspace ?? null,
      workspaceRoot: taskContract?.workspaceRoot ?? null,
      allowedPaths: stringArray(taskContract?.allowedPaths),
      deniedPaths: stringArray(taskContract?.deniedPaths)
    },
    change,
    verification,
    finalEvidenceSummary,
    hooks,
    subagents,
    outstandingTasks,
    recommendedNextAction,
    recommendedNextPrompt: buildRecommendedPrompt({
      action: recommendedNextAction,
      runId: input.runId,
      hooks,
      outstandingTasks,
      verification
    })
  };
}
