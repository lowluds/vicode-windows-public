import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import type {
  RunChangeArtifact,
  RunChangedFileArtifact,
  RunEvent,
  ThreadDetail,
  WorktreeHunkReviewDecision,
  WorktreeReviewAction,
  WorktreeReviewDecision,
  WorktreeReviewStatus
} from '../../shared/domain';
import {
  parseRunChangeHunks,
  synthesizeAcceptedHunkContent,
  type RunChangeHunkArtifact
} from '../../shared/hunk-review';
import type { HarnessWorktreeSession } from './harness-worktree-session';
import { normalizeWorkspacePath, type WorkspacePathResolution } from './agent-runtime-workspace-paths';

export interface HarnessWorktreeReviewTarget {
  threadId: string;
  runId: string;
}

export interface ApplyWorktreeHunkReviewInput extends HarnessWorktreeReviewTarget {
  acceptedHunkIds: string[];
  rejectedHunkIds?: string[];
}

export interface RejectWorktreeHunkReviewInput extends HarnessWorktreeReviewTarget {
  hunkIds: string[];
}

export type RevertWorktreeHunkReviewInput = HarnessWorktreeReviewTarget;

interface HarnessWorktreeReviewDb {
  getThread(threadId: string): ThreadDetail;
  addRunEvent(
    threadId: string,
    runId: string,
    eventType: RunEvent['eventType'],
    payload: Record<string, unknown>
  ): RunEvent;
}

interface ResolvedWorktreeReview {
  artifact: RunChangeArtifact;
  session: HarnessWorktreeSession;
}

interface PreparedWorktreeFile {
  file: RunChangedFileArtifact;
  resolved: WorkspacePathResolution;
}

interface ResolvedHunkSelection {
  hunkIds: string[];
  acceptedHunks: RunChangeHunkArtifact[];
  rejectedHunks: RunChangeHunkArtifact[];
}

interface PreparedWorktreeHunkFile {
  file: RunChangedFileArtifact;
  resolved: WorkspacePathResolution;
  acceptedHunks: RunChangeHunkArtifact[];
  synthesizedAfterContent: string;
}

class HarnessWorktreeReviewError extends Error {
  constructor(message: string, readonly safeReason = message) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
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

function parseRunChangeArtifact(value: unknown): RunChangeArtifact | null {
  if (!isRecord(value) || value.source !== 'worktree_diff' || !Array.isArray(value.files)) {
    return null;
  }

  return value as unknown as RunChangeArtifact;
}

function parseWorktreeReviewDecision(value: unknown): WorktreeReviewDecision | null {
  if (!isRecord(value)) {
    return null;
  }

  const action =
    value.action === 'applied' || value.action === 'rejected' || value.action === 'reverted'
      ? value.action
      : null;
  const status =
    value.status === 'applied'
    || value.status === 'rejected'
    || value.status === 'reverted'
    || value.status === 'failed'
      ? value.status
      : null;

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

  return {
    action,
    status,
    threadId: value.threadId,
    runId: value.runId,
    isolationMode: 'git_worktree',
    branchName: value.branchName,
    baseSha: value.baseSha,
    sourceWorkspaceRelativePath: value.sourceWorkspaceRelativePath,
    changedPaths: readStringArray(value.changedPaths),
    filesChanged: typeof value.filesChanged === 'number' && Number.isFinite(value.filesChanged) ? value.filesChanged : 0,
    insertions: typeof value.insertions === 'number' && Number.isFinite(value.insertions) ? value.insertions : 0,
    deletions: typeof value.deletions === 'number' && Number.isFinite(value.deletions) ? value.deletions : 0,
    errorReason: typeof value.errorReason === 'string' ? value.errorReason : null,
    createdAt: value.createdAt
  };
}

function parseWorktreeHunkReviewDecision(value: unknown): WorktreeHunkReviewDecision | null {
  if (!isRecord(value)) {
    return null;
  }

  const action =
    value.action === 'applied' || value.action === 'rejected' || value.action === 'reverted'
      ? value.action
      : null;
  const status =
    value.status === 'applied'
    || value.status === 'rejected'
    || value.status === 'reverted'
    || value.status === 'failed'
      ? value.status
      : null;

  if (
    !action ||
    !status ||
    value.source !== 'worktree_diff' ||
    value.isolationMode !== 'git_worktree' ||
    typeof value.threadId !== 'string' ||
    typeof value.runId !== 'string' ||
    typeof value.branchName !== 'string' ||
    typeof value.baseSha !== 'string' ||
    typeof value.sourceWorkspaceRelativePath !== 'string' ||
    typeof value.filesChanged !== 'number' ||
    typeof value.insertions !== 'number' ||
    typeof value.deletions !== 'number' ||
    typeof value.createdAt !== 'string'
  ) {
    return null;
  }

  return {
    action,
    status,
    threadId: value.threadId,
    runId: value.runId,
    source: 'worktree_diff',
    isolationMode: 'git_worktree',
    branchName: value.branchName,
    baseSha: value.baseSha,
    sourceWorkspaceRelativePath: value.sourceWorkspaceRelativePath,
    changedPaths: readStringArray(value.changedPaths),
    hunkIds: readStringArray(value.hunkIds),
    acceptedHunkIds: readStringArray(value.acceptedHunkIds),
    rejectedHunkIds: readStringArray(value.rejectedHunkIds),
    filesChanged: Number.isFinite(value.filesChanged) ? value.filesChanged : 0,
    insertions: Number.isFinite(value.insertions) ? value.insertions : 0,
    deletions: Number.isFinite(value.deletions) ? value.deletions : 0,
    errorReason: typeof value.errorReason === 'string' ? value.errorReason : null,
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

function getWorktreeArtifactFromEvent(event: RunEvent): RunChangeArtifact | null {
  const activity = isRecord(event.payload.activity) ? event.payload.activity : null;
  return parseRunChangeArtifact(activity?.changeArtifact);
}

function getWorktreeReviewDecisionFromEvent(event: RunEvent): WorktreeReviewDecision | null {
  return parseWorktreeReviewDecision(event.payload.worktreeReviewDecision);
}

function getWorktreeHunkReviewDecisionFromEvent(event: RunEvent): WorktreeHunkReviewDecision | null {
  return parseWorktreeHunkReviewDecision(event.payload.worktreeHunkReviewDecision);
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

function findLatestWorktreeArtifact(thread: ThreadDetail, runId: string) {
  let artifact: RunChangeArtifact | null = null;

  for (const event of thread.rawOutput) {
    if (event.runId !== runId) {
      continue;
    }

    artifact = getWorktreeArtifactFromEvent(event) ?? artifact;
  }

  return artifact;
}

function findLatestSuccessfulReviewDecision(thread: ThreadDetail, runId: string) {
  let latest: WorktreeReviewDecision | null = null;

  for (const event of thread.rawOutput) {
    if (event.runId !== runId) {
      continue;
    }

    const decision = getWorktreeReviewDecisionFromEvent(event);
    if (
      decision?.status === 'applied'
      || decision?.status === 'rejected'
      || decision?.status === 'reverted'
    ) {
      latest = decision;
    }
  }

  return latest;
}

function findLatestSuccessfulHunkReviewDecision(thread: ThreadDetail, runId: string) {
  let latest: WorktreeHunkReviewDecision | null = null;

  for (const event of thread.rawOutput) {
    if (event.runId !== runId) {
      continue;
    }

    const decision = getWorktreeHunkReviewDecisionFromEvent(event);
    if (
      decision?.status === 'applied'
      || decision?.status === 'rejected'
      || decision?.status === 'reverted'
    ) {
      latest = decision;
    }
  }

  return latest;
}

function assertNoSuccessfulReviewDecision(thread: ThreadDetail, runId: string) {
  const decision = findLatestSuccessfulReviewDecision(thread, runId);
  if (decision) {
    throw new HarnessWorktreeReviewError(
      `Run ${runId} already has a successful worktree review decision: ${decision.status}.`
    );
  }

  const hunkDecision = findLatestSuccessfulHunkReviewDecision(thread, runId);
  if (hunkDecision) {
    throw new HarnessWorktreeReviewError(
      `Run ${runId} already has a successful worktree hunk review decision: ${hunkDecision.status}.`
    );
  }
}

function validateArtifactFileContent(file: RunChangedFileArtifact, relativePath: string) {
  if (file.status === 'added') {
    if (typeof file.afterContent !== 'string') {
      throw new HarnessWorktreeReviewError(`Worktree added file ${relativePath} is missing afterContent.`);
    }
    return;
  }

  if (file.status === 'modified') {
    if (typeof file.beforeContent !== 'string') {
      throw new HarnessWorktreeReviewError(`Worktree modified file ${relativePath} is missing beforeContent.`);
    }
    if (typeof file.afterContent !== 'string') {
      throw new HarnessWorktreeReviewError(`Worktree modified file ${relativePath} is missing afterContent.`);
    }
    return;
  }

  if (file.status === 'deleted') {
    if (typeof file.beforeContent !== 'string') {
      throw new HarnessWorktreeReviewError(`Worktree deleted file ${relativePath} is missing beforeContent.`);
    }
    return;
  }

  throw new HarnessWorktreeReviewError(`Unsupported worktree file status for ${relativePath}.`);
}

function resolveArtifactFilePath(sourceWorkspaceRoot: string, file: RunChangedFileArtifact) {
  if (typeof file.path !== 'string' || !file.path.trim() || isAbsolute(file.path)) {
    throw new HarnessWorktreeReviewError('Worktree artifact file paths must be relative workspace paths.');
  }

  try {
    const resolved = normalizeWorkspacePath(sourceWorkspaceRoot, file.path);
    if (resolved.relativePath === '.') {
      throw new HarnessWorktreeReviewError('Worktree artifact file paths must point inside the source workspace.');
    }
    return resolved;
  } catch (error) {
    if (error instanceof HarnessWorktreeReviewError) {
      throw error;
    }
    throw new HarnessWorktreeReviewError('Worktree artifact file paths must stay inside the source workspace.');
  }
}

function prepareArtifactFiles(artifact: RunChangeArtifact, session: HarnessWorktreeSession): PreparedWorktreeFile[] {
  if (artifact.files.length === 0) {
    throw new HarnessWorktreeReviewError('No changed files are available in the worktree_diff artifact.');
  }

  return artifact.files.map((file) => {
    const resolved = resolveArtifactFilePath(session.sourceWorkspaceRoot, file);
    validateArtifactFileContent(file, resolved.relativePath);
    return {
      file,
      resolved
    };
  });
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || value.trim().length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function assertDisjointHunkIds(acceptedHunkIds: string[], rejectedHunkIds: string[]) {
  const rejected = new Set(rejectedHunkIds);
  const overlap = acceptedHunkIds.find((hunkId) => rejected.has(hunkId));
  if (overlap) {
    throw new HarnessWorktreeReviewError(`Hunk ${overlap} cannot be both accepted and rejected.`);
  }
}

function resolveHunkSelection(
  artifact: RunChangeArtifact,
  acceptedHunkIds: string[],
  rejectedHunkIds: string[]
): ResolvedHunkSelection {
  const acceptedIds = uniqueStrings(acceptedHunkIds);
  const rejectedIds = uniqueStrings(rejectedHunkIds);
  assertDisjointHunkIds(acceptedIds, rejectedIds);

  const parsed = parseRunChangeHunks(artifact);
  if (!parsed.artifactSupported) {
    throw new HarnessWorktreeReviewError(parsed.unsupportedReason ?? 'Worktree hunks are not supported.');
  }

  const hunkById = new Map<string, RunChangeHunkArtifact>();
  for (const hunk of parsed.hunks) {
    if (hunkById.has(hunk.id)) {
      throw new HarnessWorktreeReviewError(`Duplicate hunk id detected: ${hunk.id}.`);
    }
    hunkById.set(hunk.id, hunk);
  }

  const selectedIds = [...acceptedIds, ...rejectedIds];
  if (selectedIds.length === 0) {
    throw new HarnessWorktreeReviewError('At least one hunk id is required.');
  }

  const unknownId = selectedIds.find((hunkId) => !hunkById.has(hunkId));
  if (unknownId) {
    throw new HarnessWorktreeReviewError(`Unknown worktree hunk id: ${unknownId}.`);
  }

  return {
    hunkIds: selectedIds,
    acceptedHunks: parsed.hunks.filter((hunk) => acceptedIds.includes(hunk.id)),
    rejectedHunks: parsed.hunks.filter((hunk) => rejectedIds.includes(hunk.id))
  };
}

function findArtifactFileForHunk(artifact: RunChangeArtifact, hunk: RunChangeHunkArtifact) {
  return artifact.files.find((file) => file.path.replace(/\\/gu, '/') === hunk.filePath) ?? null;
}

function groupHunksByFile(hunks: RunChangeHunkArtifact[]) {
  const grouped = new Map<string, RunChangeHunkArtifact[]>();
  for (const hunk of hunks) {
    const current = grouped.get(hunk.filePath) ?? [];
    current.push(hunk);
    grouped.set(hunk.filePath, current);
  }
  return grouped;
}

function prepareHunkFiles(
  resolved: ResolvedWorktreeReview,
  selection: ResolvedHunkSelection
): PreparedWorktreeHunkFile[] {
  if (selection.acceptedHunks.length === 0) {
    throw new HarnessWorktreeReviewError('At least one accepted hunk id is required to apply worktree hunks.');
  }

  const grouped = groupHunksByFile(selection.acceptedHunks);
  const prepared: PreparedWorktreeHunkFile[] = [];
  for (const [filePath, acceptedHunks] of grouped.entries()) {
    const firstHunk = acceptedHunks[0];
    if (!firstHunk) {
      continue;
    }

    for (const hunk of acceptedHunks) {
      if (!hunk.partialApplySupported || hunk.supportKind !== 'partial') {
        throw new HarnessWorktreeReviewError(
          hunk.unsupportedReason ?? `Hunk ${hunk.id} is not supported for partial apply.`
        );
      }
    }

    const file = findArtifactFileForHunk(resolved.artifact, firstHunk);
    if (!file) {
      throw new HarnessWorktreeReviewError(`No worktree file artifact found for hunk path ${filePath}.`);
    }

    if (file.status !== 'modified') {
      throw new HarnessWorktreeReviewError(`${file.status} files do not support partial worktree hunk apply.`);
    }

    const resolvedPath = resolveArtifactFilePath(resolved.session.sourceWorkspaceRoot, file);
    validateArtifactFileContent(file, resolvedPath.relativePath);

    prepared.push({
      file,
      resolved: resolvedPath,
      acceptedHunks,
      synthesizedAfterContent: synthesizeAcceptedHunkContent(file, acceptedHunks)
    });
  }

  return prepared;
}

async function readCurrentText(path: string) {
  return readFile(path, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  });
}

async function assertNoHunkSourceWorkspaceDrift(preparedFiles: PreparedWorktreeHunkFile[]) {
  for (const item of preparedFiles) {
    const currentContent = await readCurrentText(item.resolved.absolutePath);
    if (currentContent !== item.file.beforeContent) {
      throw new HarnessWorktreeReviewError(
        `Workspace drift for ${item.resolved.relativePath}: current source content no longer matches the worktree beforeContent.`
      );
    }
  }
}

async function applyPreparedHunkFiles(preparedFiles: PreparedWorktreeHunkFile[]) {
  for (const item of preparedFiles) {
    await mkdir(dirname(item.resolved.absolutePath), { recursive: true });
    await writeFile(item.resolved.absolutePath, item.synthesizedAfterContent, 'utf8');
  }
}

async function assertNoHunkRevertSourceWorkspaceDrift(preparedFiles: PreparedWorktreeHunkFile[]) {
  for (const item of preparedFiles) {
    const currentContent = await readCurrentText(item.resolved.absolutePath);
    if (currentContent !== item.synthesizedAfterContent) {
      throw new HarnessWorktreeReviewError(
        `Workspace drift for ${item.resolved.relativePath}: current source content no longer matches the applied worktree hunk output.`
      );
    }
  }
}

async function revertPreparedHunkFiles(preparedFiles: PreparedWorktreeHunkFile[]) {
  for (const item of preparedFiles) {
    await mkdir(dirname(item.resolved.absolutePath), { recursive: true });
    await writeFile(item.resolved.absolutePath, item.file.beforeContent ?? '', 'utf8');
  }
}

async function assertNoSourceWorkspaceDrift(preparedFiles: PreparedWorktreeFile[]) {
  for (const item of preparedFiles) {
    const currentContent = await readCurrentText(item.resolved.absolutePath);
    if (item.file.status === 'added') {
      if (currentContent !== null) {
        throw new HarnessWorktreeReviewError(
          `Workspace drift for ${item.resolved.relativePath}: expected source file to be missing before applying worktree changes.`
        );
      }
      continue;
    }

    if (currentContent !== item.file.beforeContent) {
      throw new HarnessWorktreeReviewError(
        `Workspace drift for ${item.resolved.relativePath}: current source content no longer matches the worktree beforeContent.`
      );
    }
  }
}

async function applyPreparedFiles(preparedFiles: PreparedWorktreeFile[]) {
  for (const item of preparedFiles) {
    if (item.file.status === 'deleted') {
      await rm(item.resolved.absolutePath, { force: true });
      continue;
    }

    await mkdir(dirname(item.resolved.absolutePath), { recursive: true });
    await writeFile(item.resolved.absolutePath, item.file.afterContent ?? '', 'utf8');
  }
}

async function assertNoRevertSourceWorkspaceDrift(preparedFiles: PreparedWorktreeFile[]) {
  for (const item of preparedFiles) {
    const currentContent = await readCurrentText(item.resolved.absolutePath);
    if (item.file.status === 'deleted') {
      if (currentContent !== null) {
        throw new HarnessWorktreeReviewError(
          `Workspace drift for ${item.resolved.relativePath}: expected source file to still be missing before reverting worktree changes.`
        );
      }
      continue;
    }

    if (currentContent !== item.file.afterContent) {
      throw new HarnessWorktreeReviewError(
        `Workspace drift for ${item.resolved.relativePath}: current source content no longer matches the applied worktree output.`
      );
    }
  }
}

async function revertPreparedFiles(preparedFiles: PreparedWorktreeFile[]) {
  for (const item of [...preparedFiles].reverse()) {
    if (item.file.status === 'added') {
      await rm(item.resolved.absolutePath, { force: true });
      continue;
    }

    if (item.file.status === 'deleted') {
      await mkdir(dirname(item.resolved.absolutePath), { recursive: true });
      await writeFile(item.resolved.absolutePath, item.file.beforeContent ?? '', 'utf8');
      continue;
    }

    await mkdir(dirname(item.resolved.absolutePath), { recursive: true });
    await writeFile(item.resolved.absolutePath, item.file.beforeContent ?? '', 'utf8');
  }
}

function assertCanRevert(thread: ThreadDetail, runId: string) {
  const latestDecision = findLatestSuccessfulReviewDecision(thread, runId);
  if (latestDecision?.action === 'applied' && latestDecision.status === 'applied') {
    return;
  }

  throw new HarnessWorktreeReviewError('Only applied worktree changes can be reverted.');
}

function assertCanRevertHunks(thread: ThreadDetail, runId: string) {
  const latestDecision = findLatestSuccessfulHunkReviewDecision(thread, runId);
  if (latestDecision?.action === 'applied' && latestDecision.status === 'applied') {
    return latestDecision;
  }

  throw new HarnessWorktreeReviewError('Only applied worktree hunk changes can be reverted.');
}

function safeReasonFromError(error: unknown, fallback = 'Failed to apply worktree changes.') {
  if (error instanceof HarnessWorktreeReviewError) {
    return error.safeReason;
  }

  return fallback;
}

function changedPathsFromHunks(selection: ResolvedHunkSelection) {
  return uniqueStrings([...selection.acceptedHunks, ...selection.rejectedHunks].map((hunk) => hunk.filePath));
}

function hunkLineStats(hunks: RunChangeHunkArtifact[]) {
  return hunks.reduce(
    (stats, hunk) => {
      for (const line of hunk.previewLines) {
        if (line.type === 'added') {
          stats.insertions += 1;
        } else if (line.type === 'removed') {
          stats.deletions += 1;
        }
      }
      return stats;
    },
    {
      insertions: 0,
      deletions: 0
    }
  );
}

function safeChangedPaths(artifact: RunChangeArtifact) {
  return artifact.files.map((file) => {
    if (typeof file.path !== 'string' || !file.path.trim() || isAbsolute(file.path)) {
      return '[invalid-path]';
    }
    return file.path.replace(/\\/gu, '/');
  });
}

export class HarnessWorktreeReviewService {
  constructor(private readonly db: HarnessWorktreeReviewDb) {}

  async apply(input: HarnessWorktreeReviewTarget): Promise<WorktreeReviewDecision> {
    const thread = this.db.getThread(input.threadId);
    const resolved = this.resolve(thread, input.runId);

    try {
      const preparedFiles = prepareArtifactFiles(resolved.artifact, resolved.session);
      await assertNoSourceWorkspaceDrift(preparedFiles);
      await applyPreparedFiles(preparedFiles);
      return this.recordDecision(resolved, 'applied', 'applied', null);
    } catch (error) {
      const errorReason = safeReasonFromError(error);
      this.recordDecision(resolved, 'applied', 'failed', errorReason);
      throw new Error(errorReason);
    }
  }

  async applyHunks(input: ApplyWorktreeHunkReviewInput): Promise<WorktreeHunkReviewDecision> {
    const thread = this.db.getThread(input.threadId);
    const resolved = this.resolve(thread, input.runId);
    let selection: ResolvedHunkSelection | null = null;

    try {
      selection = resolveHunkSelection(
        resolved.artifact,
        input.acceptedHunkIds,
        input.rejectedHunkIds ?? []
      );
      const preparedFiles = prepareHunkFiles(resolved, selection);
      await assertNoHunkSourceWorkspaceDrift(preparedFiles);
      await applyPreparedHunkFiles(preparedFiles);
      return this.recordHunkDecision(resolved, 'applied', 'applied', selection, null);
    } catch (error) {
      const errorReason = safeReasonFromError(error, 'Failed to apply worktree hunks.');
      const fallbackSelection = selection ?? {
        hunkIds: uniqueStrings([...(input.acceptedHunkIds ?? []), ...(input.rejectedHunkIds ?? [])]),
        acceptedHunks: [],
        rejectedHunks: []
      };
      this.recordHunkDecision(resolved, 'applied', 'failed', fallbackSelection, errorReason);
      throw new Error(errorReason);
    }
  }

  async reject(input: HarnessWorktreeReviewTarget): Promise<WorktreeReviewDecision> {
    const thread = this.db.getThread(input.threadId);
    const resolved = this.resolve(thread, input.runId);
    return this.recordDecision(resolved, 'rejected', 'rejected', null);
  }

  async rejectHunks(input: RejectWorktreeHunkReviewInput): Promise<WorktreeHunkReviewDecision> {
    const thread = this.db.getThread(input.threadId);
    const resolved = this.resolve(thread, input.runId);
    const selection = resolveHunkSelection(resolved.artifact, [], input.hunkIds);
    return this.recordHunkDecision(resolved, 'rejected', 'rejected', selection, null);
  }

  async revert(input: HarnessWorktreeReviewTarget): Promise<WorktreeReviewDecision> {
    const thread = this.db.getThread(input.threadId);
    const resolved = this.resolveWithoutDecisionCheck(thread, input.runId);

    try {
      assertCanRevert(thread, input.runId);
      const preparedFiles = prepareArtifactFiles(resolved.artifact, resolved.session);
      await assertNoRevertSourceWorkspaceDrift(preparedFiles);
      await revertPreparedFiles(preparedFiles);
      return this.recordDecision(resolved, 'reverted', 'reverted', null);
    } catch (error) {
      const errorReason = safeReasonFromError(error, 'Failed to revert worktree changes.');
      this.recordDecision(resolved, 'reverted', 'failed', errorReason);
      throw new Error(errorReason);
    }
  }

  async revertHunks(input: RevertWorktreeHunkReviewInput): Promise<WorktreeHunkReviewDecision> {
    const thread = this.db.getThread(input.threadId);
    const resolved = this.resolveWithoutDecisionCheck(thread, input.runId);
    let selection: ResolvedHunkSelection | null = null;

    try {
      const latestDecision = assertCanRevertHunks(thread, input.runId);
      selection = resolveHunkSelection(
        resolved.artifact,
        latestDecision.acceptedHunkIds,
        latestDecision.rejectedHunkIds
      );
      const preparedFiles = prepareHunkFiles(resolved, selection);
      await assertNoHunkRevertSourceWorkspaceDrift(preparedFiles);
      await revertPreparedHunkFiles(preparedFiles);
      return this.recordHunkDecision(resolved, 'reverted', 'reverted', selection, null);
    } catch (error) {
      const errorReason = safeReasonFromError(error, 'Failed to revert worktree hunks.');
      const fallbackSelection = selection ?? {
        hunkIds: [],
        acceptedHunks: [],
        rejectedHunks: []
      };
      this.recordHunkDecision(resolved, 'reverted', 'failed', fallbackSelection, errorReason);
      throw new Error(errorReason);
    }
  }

  private resolve(thread: ThreadDetail, runId: string): ResolvedWorktreeReview {
    const resolved = this.resolveWithoutDecisionCheck(thread, runId);
    assertNoSuccessfulReviewDecision(thread, runId);
    return resolved;
  }

  private resolveWithoutDecisionCheck(thread: ThreadDetail, runId: string): ResolvedWorktreeReview {
    const session = findWorktreeSession(thread, runId);
    if (!session) {
      throw new Error(`No git_worktree session found for run ${runId}.`);
    }

    const artifact = findLatestWorktreeArtifact(thread, runId);
    if (!artifact) {
      throw new Error(`No worktree_diff artifact found for run ${runId}.`);
    }

    return {
      artifact,
      session
    };
  }

  private recordDecision(
    resolved: ResolvedWorktreeReview,
    action: WorktreeReviewAction,
    status: WorktreeReviewStatus,
    errorReason: string | null
  ): WorktreeReviewDecision {
    const decision: WorktreeReviewDecision = {
      action,
      status,
      threadId: resolved.session.threadId,
      runId: resolved.session.runId,
      isolationMode: 'git_worktree',
      branchName: resolved.session.branchName,
      baseSha: resolved.session.baseSha,
      sourceWorkspaceRelativePath: resolved.session.sourceWorkspaceRelativePath,
      changedPaths: safeChangedPaths(resolved.artifact),
      filesChanged: resolved.artifact.summary.filesChanged,
      insertions: resolved.artifact.summary.insertions,
      deletions: resolved.artifact.summary.deletions,
      errorReason,
      createdAt: new Date().toISOString()
    };

    this.db.addRunEvent(decision.threadId, decision.runId, 'info', {
      worktreeReviewDecision: decision,
      eventKind: 'debug_detail',
      transcriptVisible: false
    });

    return decision;
  }

  private recordHunkDecision(
    resolved: ResolvedWorktreeReview,
    action: WorktreeHunkReviewDecision['action'],
    status: WorktreeHunkReviewDecision['status'],
    selection: ResolvedHunkSelection,
    errorReason: string | null
  ): WorktreeHunkReviewDecision {
    const selectedHunks = [...selection.acceptedHunks, ...selection.rejectedHunks];
    const changedPaths = changedPathsFromHunks(selection);
    const stats = hunkLineStats(selectedHunks);
    const decision: WorktreeHunkReviewDecision = {
      action,
      status,
      threadId: resolved.session.threadId,
      runId: resolved.session.runId,
      source: 'worktree_diff',
      isolationMode: 'git_worktree',
      branchName: resolved.session.branchName,
      baseSha: resolved.session.baseSha,
      sourceWorkspaceRelativePath: resolved.session.sourceWorkspaceRelativePath,
      changedPaths,
      hunkIds: selection.hunkIds,
      acceptedHunkIds: selection.acceptedHunks.map((hunk) => hunk.id),
      rejectedHunkIds: selection.rejectedHunks.map((hunk) => hunk.id),
      filesChanged: changedPaths.length,
      insertions: stats.insertions,
      deletions: stats.deletions,
      errorReason,
      createdAt: new Date().toISOString()
    };

    this.db.addRunEvent(decision.threadId, decision.runId, 'info', {
      worktreeHunkReviewDecision: decision,
      eventKind: 'debug_detail',
      transcriptVisible: false
    });

    return decision;
  }
}
