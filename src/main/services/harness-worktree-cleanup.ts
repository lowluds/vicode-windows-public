import type {
  RunEvent,
  ThreadDetail,
  WorktreeCleanupDecision,
  WorktreeCleanupInput,
  WorktreeCleanupReviewStatus,
  WorktreeCleanupStatus,
  WorktreeReviewDecision
} from '../../shared/domain';
import type {
  HarnessWorktreeCleanupInput,
  HarnessWorktreeCleanupResult,
  HarnessWorktreeSession
} from './harness-worktree-session';

interface HarnessWorktreeCleanupDb {
  getThread(threadId: string): ThreadDetail;
  addRunEvent(
    threadId: string,
    runId: string,
    eventType: RunEvent['eventType'],
    payload: Record<string, unknown>
  ): RunEvent;
}

interface HarnessWorktreeCleanupHost {
  cleanup(input: HarnessWorktreeCleanupInput): Promise<HarnessWorktreeCleanupResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseHarnessWorktreeSession(value: unknown): HarnessWorktreeSession | null {
  if (!isRecord(value)) {
    return null;
  }

  const requiredStrings = [
    'threadId',
    'runId',
    'projectId',
    'sourceRepoRoot',
    'sourceWorkspaceRoot',
    'sourceWorkspaceRelativePath',
    'worktreeRepoRoot',
    'worktreeWorkspaceRoot',
    'branchName',
    'baseSha',
    'status',
    'cleanupPolicy',
    'reviewStatus',
    'createdAt',
    'updatedAt'
  ];

  if (
    requiredStrings.some((key) => typeof value[key] !== 'string')
    || value.baseRef !== 'HEAD'
    || (value.errorReason !== null && typeof value.errorReason !== 'string')
  ) {
    return null;
  }

  return value as unknown as HarnessWorktreeSession;
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

function worktreeCleanupActionOrNull(value: unknown) {
  return value === 'cleaned'
    || value === 'failed'
    || value === 'refused'
    ? value
    : null;
}

function worktreeCleanupStatusOrNull(value: unknown) {
  return value === 'cleaned' || value === 'failed' || value === 'refused'
    ? value
    : null;
}

function parseWorktreeReviewDecision(value: unknown): WorktreeReviewDecision | null {
  if (!isRecord(value)) {
    return null;
  }

  const action = worktreeReviewActionOrNull(value.action);
  const status = worktreeReviewStatusOrNull(value.status);
  if (
    !action ||
    !status ||
    value.isolationMode !== 'git_worktree' ||
    typeof value.threadId !== 'string' ||
    typeof value.runId !== 'string' ||
    typeof value.branchName !== 'string' ||
    typeof value.baseSha !== 'string' ||
    typeof value.sourceWorkspaceRelativePath !== 'string' ||
    typeof value.createdAt !== 'string'
  ) {
    return null;
  }

  return value as unknown as WorktreeReviewDecision;
}

function parseWorktreeCleanupDecision(value: unknown): WorktreeCleanupDecision | null {
  if (!isRecord(value)) {
    return null;
  }

  const action = worktreeCleanupActionOrNull(value.action);
  const status = worktreeCleanupStatusOrNull(value.status);
  const reviewStatus =
    value.reviewStatus === 'pending'
      ? 'pending'
      : worktreeReviewStatusOrNull(value.reviewStatus);
  if (
    !action ||
    !status ||
    !reviewStatus ||
    value.isolationMode !== 'git_worktree' ||
    typeof value.threadId !== 'string' ||
    typeof value.runId !== 'string' ||
    typeof value.branchName !== 'string' ||
    typeof value.baseSha !== 'string' ||
    typeof value.cleanupPolicy !== 'string' ||
    typeof value.createdAt !== 'string' ||
    (value.errorReason !== null && typeof value.errorReason !== 'string')
  ) {
    return null;
  }

  return {
    action,
    status,
    threadId: value.threadId,
    runId: value.runId,
    isolationMode: 'git_worktree',
    branchName: value.branchName,
    baseSha: value.baseSha,
    cleanupPolicy: value.cleanupPolicy,
    reviewStatus,
    errorReason: value.errorReason,
    createdAt: value.createdAt
  };
}

function getWorktreeSessionFromEvent(event: RunEvent): HarnessWorktreeSession | null {
  const runtimeTrace = isRecord(event.payload.runtimeTrace) ? event.payload.runtimeTrace : null;
  if (!runtimeTrace || runtimeTrace.stage !== 'worktree_session_created') {
    return null;
  }

  const detail = isRecord(runtimeTrace.detail) ? runtimeTrace.detail : null;
  return parseHarnessWorktreeSession(detail?.harnessWorktreeSession);
}

function getWorktreeReviewDecisionFromEvent(event: RunEvent): WorktreeReviewDecision | null {
  return parseWorktreeReviewDecision(event.payload.worktreeReviewDecision);
}

function getWorktreeCleanupDecisionFromEvent(event: RunEvent): WorktreeCleanupDecision | null {
  return parseWorktreeCleanupDecision(event.payload.worktreeCleanupDecision);
}

function findWorktreeSession(thread: ThreadDetail, runId: string) {
  for (const event of thread.rawOutput) {
    if (event.runId !== runId) {
      continue;
    }

    const session = getWorktreeSessionFromEvent(event);
    if (session && session.threadId === event.threadId && session.runId === event.runId) {
      return session;
    }
  }

  return null;
}

function findLatestWorktreeReviewDecision(thread: ThreadDetail, runId: string) {
  let latest: WorktreeReviewDecision | null = null;

  for (const event of thread.rawOutput) {
    if (event.runId !== runId) {
      continue;
    }

    const decision = getWorktreeReviewDecisionFromEvent(event);
    if (decision) {
      latest = decision;
    }
  }

  return latest;
}

function findLatestCleanedDecision(thread: ThreadDetail, runId: string) {
  let latest: WorktreeCleanupDecision | null = null;

  for (const event of thread.rawOutput) {
    if (event.runId !== runId) {
      continue;
    }

    const decision = getWorktreeCleanupDecisionFromEvent(event);
    if (decision?.status === 'cleaned') {
      latest = decision;
    }
  }

  return latest;
}

function redactsEmbeddedLocalPaths(value: string) {
  return value
    .replace(/[a-zA-Z]:[\\/][^\r\n"',}]*/gu, '[redacted-path]')
    .replace(/\\\\[^\r\n"',}]*/gu, '[redacted-path]');
}

function safeErrorReason(value: string | null | undefined) {
  return value ? redactsEmbeddedLocalPaths(value) : null;
}

function reviewStatusForCleanup(decision: WorktreeReviewDecision | null): WorktreeCleanupReviewStatus {
  return decision?.status ?? 'pending';
}

function canCleanupAfterReview(decision: WorktreeReviewDecision | null) {
  return decision?.status === 'applied'
    || decision?.status === 'rejected'
    || decision?.status === 'reverted';
}

export class HarnessWorktreeCleanupService {
  constructor(
    private readonly db: HarnessWorktreeCleanupDb,
    private readonly cleanupHost: HarnessWorktreeCleanupHost,
    private readonly now: () => Date = () => new Date()
  ) {}

  async cleanup(input: WorktreeCleanupInput): Promise<WorktreeCleanupDecision> {
    const thread = this.db.getThread(input.threadId);
    const session = findWorktreeSession(thread, input.runId);
    if (!session) {
      throw new Error(`No git_worktree session found for run ${input.runId}.`);
    }

    const existingCleaned = findLatestCleanedDecision(thread, input.runId);
    if (existingCleaned) {
      return existingCleaned;
    }

    const latestReview = findLatestWorktreeReviewDecision(thread, input.runId);
    if (!latestReview) {
      return this.recordDecision(
        session,
        'pending',
        'refused',
        'Worktree cleanup is available only after an applied, rejected, or reverted worktree review decision.'
      );
    }

    if (latestReview.status === 'failed') {
      return this.recordDecision(
        session,
        'failed',
        'refused',
        'Worktree cleanup is refused after a failed review decision. Resolve or retry the review decision first.'
      );
    }

    if (!canCleanupAfterReview(latestReview)) {
      return this.recordDecision(
        session,
        reviewStatusForCleanup(latestReview),
        'refused',
        'Worktree cleanup is available only after an applied, rejected, or reverted worktree review decision.'
      );
    }

    const result = await this.cleanupHost.cleanup({
      sourceRepoRoot: session.sourceRepoRoot,
      worktreeRepoRoot: session.worktreeRepoRoot
    }).catch((error: unknown): HarnessWorktreeCleanupResult => ({
      ok: false,
      status: 'failed',
      worktreeRepoRoot: session.worktreeRepoRoot,
      errorReason: error instanceof Error ? error.message : 'Failed to remove the worktree.'
    }));

    return this.recordDecision(
      session,
      latestReview.status,
      result.status,
      result.errorReason
    );
  }

  private recordDecision(
    session: HarnessWorktreeSession,
    reviewStatus: WorktreeCleanupReviewStatus,
    status: WorktreeCleanupStatus,
    errorReason: string | null
  ): WorktreeCleanupDecision {
    const decision: WorktreeCleanupDecision = {
      action: status,
      status,
      threadId: session.threadId,
      runId: session.runId,
      isolationMode: 'git_worktree',
      branchName: session.branchName,
      baseSha: session.baseSha,
      cleanupPolicy: session.cleanupPolicy,
      reviewStatus,
      errorReason: safeErrorReason(errorReason),
      createdAt: this.now().toISOString()
    };

    this.db.addRunEvent(decision.threadId, decision.runId, 'info', {
      worktreeCleanupDecision: decision,
      eventKind: 'debug_detail',
      transcriptVisible: false
    });

    return decision;
  }
}
