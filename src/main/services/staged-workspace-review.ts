import { mkdir, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  StagedWorkspaceChangeSet,
  StagedWorkspaceOperation,
  StagedWorkspaceOperationKind
} from '../../providers/agent-runtime';
import type {
  RunChangeArtifact,
  RunChangedFileArtifact,
  RunEvent,
  StagedWorkspaceReviewAction,
  StagedWorkspaceReviewDecision,
  StagedWorkspaceReviewStatus,
  ThreadDetail
} from '../../shared/domain';
import {
  parseRunChangeHunks,
  synthesizeAcceptedHunkContent,
  type RunChangeHunkArtifact,
  type StagedWorkspaceHunkReviewDecision
} from '../../shared/hunk-review';
import {
  normalizeWorkspacePath,
  type WorkspacePathResolution
} from './agent-runtime-workspace-paths';
import { deriveRunChangedFileArtifact } from './workspace-changes';

export interface StagedWorkspaceReviewTarget {
  threadId: string;
  runId: string;
  stagedEventId?: string | null;
  stagedEventIndex?: number | null;
}

export interface ApplyStagedWorkspaceReviewInput extends StagedWorkspaceReviewTarget {
  workspaceRoot: string;
}

export interface RevertStagedWorkspaceReviewInput extends StagedWorkspaceReviewTarget {
  workspaceRoot: string;
}

export interface ApplyStagedWorkspaceHunkReviewInput extends StagedWorkspaceReviewTarget {
  workspaceRoot: string;
  acceptedHunkIds: string[];
  rejectedHunkIds?: string[];
}

export interface RejectStagedWorkspaceHunkReviewInput extends StagedWorkspaceReviewTarget {
  hunkIds: string[];
}

export interface RevertStagedWorkspaceHunkReviewInput extends StagedWorkspaceReviewTarget {
  workspaceRoot: string;
}

interface StagedWorkspaceReviewDb {
  getThread(threadId: string): ThreadDetail;
  addRunEvent(
    threadId: string,
    runId: string,
    eventType: RunEvent['eventType'],
    payload: Record<string, unknown>
  ): RunEvent;
}

interface ResolvedStagedWorkspaceChangeSet {
  thread: ThreadDetail;
  event: RunEvent;
  changeSet: StagedWorkspaceChangeSet;
  stagedEventIndex: number;
}

interface PreparedStagedWorkspaceOperation {
  operation: StagedWorkspaceOperation;
  resolved: WorkspacePathResolution;
}

interface ResolvedHunkSelection {
  hunkIds: string[];
  acceptedHunks: RunChangeHunkArtifact[];
  rejectedHunks: RunChangeHunkArtifact[];
}

interface PreparedStagedWorkspaceHunkFile {
  operation: StagedWorkspaceOperation;
  resolved: WorkspacePathResolution;
  file: RunChangedFileArtifact;
  acceptedHunks: RunChangeHunkArtifact[];
  synthesizedAfterContent: string;
}

class StagedWorkspaceReviewError extends Error {
  constructor(message: string, readonly safeReason = message) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseStagedWorkspaceChangeSet(value: unknown): StagedWorkspaceChangeSet | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.isolationMode !== 'patch_buffer' || value.status !== 'proposed') {
    return null;
  }

  if (!Array.isArray(value.operations)) {
    return null;
  }

  return value as unknown as StagedWorkspaceChangeSet;
}

function getEventChangeSet(event: RunEvent) {
  return parseStagedWorkspaceChangeSet(event.payload.stagedWorkspaceChangeSet);
}

function getStagedEvents(thread: ThreadDetail, runId: string): ResolvedStagedWorkspaceChangeSet[] {
  const stagedEvents: ResolvedStagedWorkspaceChangeSet[] = [];

  for (const event of thread.rawOutput) {
    if (event.runId !== runId) {
      continue;
    }

    const changeSet = getEventChangeSet(event);
    if (!changeSet) {
      continue;
    }

    stagedEvents.push({
      thread,
      event,
      changeSet,
      stagedEventIndex: stagedEvents.length
    });
  }

  return stagedEvents;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function readStagedWorkspaceSourceToolName(
  value: unknown
): StagedWorkspaceReviewDecision['sourceToolName'] | null {
  return value === 'mkdir' || value === 'write_file' || value === 'apply_patch' ? value : null;
}

function parseStagedWorkspaceReviewDecision(value: unknown): StagedWorkspaceReviewDecision | null {
  if (!isRecord(value)) {
    return null;
  }

  const action =
    value.action === 'applied' || value.action === 'rejected' || value.action === 'reverted'
      ? value.action
      : null;
  const status =
    value.status === 'applied' || value.status === 'rejected' || value.status === 'reverted' || value.status === 'failed'
      ? value.status
      : null;

  if (
    !action ||
    !status ||
    typeof value.threadId !== 'string' ||
    typeof value.runId !== 'string' ||
    typeof value.stagedEventId !== 'string' ||
    typeof value.stagedEventIndex !== 'number' ||
    value.isolationMode !== 'patch_buffer' ||
    typeof value.createdAt !== 'string'
  ) {
    return null;
  }

  const sourceToolName = readStagedWorkspaceSourceToolName(value.sourceToolName);
  if (!sourceToolName) {
    return null;
  }

  return {
    action,
    status,
    threadId: value.threadId,
    runId: value.runId,
    stagedEventId: value.stagedEventId,
    stagedEventIndex: value.stagedEventIndex,
    sourceToolName,
    isolationMode: 'patch_buffer',
    changedPaths: readStringArray(value.changedPaths),
    operationKinds: readStringArray(value.operationKinds)
      .filter((kind): kind is StagedWorkspaceOperationKind =>
        kind === 'mkdir' || kind === 'write_file' || kind === 'apply_patch' || kind === 'delete'
      ),
    errorReason: typeof value.errorReason === 'string' ? value.errorReason : null,
    createdAt: value.createdAt
  };
}

function parseStagedWorkspaceHunkReviewDecision(value: unknown): StagedWorkspaceHunkReviewDecision | null {
  if (!isRecord(value)) {
    return null;
  }

  const action =
    value.action === 'applied' || value.action === 'rejected' || value.action === 'reverted'
      ? value.action
      : null;
  const status =
    value.status === 'applied' || value.status === 'rejected' || value.status === 'reverted' || value.status === 'failed'
      ? value.status
      : null;

  if (
    !action ||
    !status ||
    value.source !== 'staged_workspace_preview' ||
    value.isolationMode !== 'patch_buffer' ||
    typeof value.threadId !== 'string' ||
    typeof value.runId !== 'string' ||
    typeof value.stagedEventId !== 'string' ||
    typeof value.stagedEventIndex !== 'number' ||
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
    source: 'staged_workspace_preview',
    isolationMode: 'patch_buffer',
    stagedEventId: value.stagedEventId,
    stagedEventIndex: value.stagedEventIndex,
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

function getLatestReviewDecision(resolved: ResolvedStagedWorkspaceChangeSet) {
  let latest: StagedWorkspaceReviewDecision | null = null;
  for (const event of resolved.thread.rawOutput) {
    if (event.runId !== resolved.event.runId || event.eventType !== 'info') {
      continue;
    }

    const decision = parseStagedWorkspaceReviewDecision(event.payload.stagedWorkspaceReviewDecision);
    if (!decision || decision.stagedEventId !== resolved.event.id) {
      continue;
    }

    latest = decision;
  }
  return latest;
}

function getLatestHunkReviewDecision(resolved: ResolvedStagedWorkspaceChangeSet) {
  let latest: StagedWorkspaceHunkReviewDecision | null = null;
  for (const event of resolved.thread.rawOutput) {
    if (event.runId !== resolved.event.runId || event.eventType !== 'info') {
      continue;
    }

    const decision = parseStagedWorkspaceHunkReviewDecision(event.payload.stagedWorkspaceHunkReviewDecision);
    if (!decision || decision.stagedEventId !== resolved.event.id) {
      continue;
    }

    latest = decision;
  }
  return latest;
}

function uniqueOperationKinds(operations: StagedWorkspaceOperation[]) {
  const seen = new Set<StagedWorkspaceOperationKind>();
  const kinds: StagedWorkspaceOperationKind[] = [];

  for (const operation of operations) {
    if (seen.has(operation.operation)) {
      continue;
    }
    seen.add(operation.operation);
    kinds.push(operation.operation);
  }

  return kinds;
}

function uniqueChangedPaths(changeSet: StagedWorkspaceChangeSet) {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const path of [...changeSet.changedPaths, ...changeSet.operations.map((operation) => operation.path)]) {
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    paths.push(path);
  }

  return paths;
}

function stagedOperationFileStatus(operation: StagedWorkspaceOperation): RunChangedFileArtifact['status'] | null {
  if (operation.operation === 'mkdir') {
    return null;
  }

  if (operation.operation === 'delete') {
    return 'deleted';
  }

  if (operation.operation === 'write_file' || operation.operation === 'apply_patch') {
    if (typeof operation.proposedAfterContent === 'string') {
      return operation.beforeContent === null ? 'added' : 'modified';
    }

    if (operation.operation === 'apply_patch' && operation.proposedAfterContent === null) {
      return 'deleted';
    }
  }

  throw new StagedWorkspaceReviewError(
    `Unsupported staged ${operation.operation} operation for diff preview.`
  );
}

export function createStagedWorkspacePreviewArtifact(changeSet: StagedWorkspaceChangeSet): RunChangeArtifact {
  const files: RunChangedFileArtifact[] = [];
  let insertions = 0;
  let deletions = 0;

  for (const operation of changeSet.operations) {
    const status = stagedOperationFileStatus(operation);
    if (!status) {
      continue;
    }

    if (!operation.path || typeof operation.path !== 'string') {
      throw new StagedWorkspaceReviewError('Staged workspace operation is missing a path.');
    }

    const fileArtifact = deriveRunChangedFileArtifact(
      operation.path,
      status,
      operation.beforeContent,
      operation.proposedAfterContent
    );
    files.push(fileArtifact);
    insertions += fileArtifact.insertions;
    deletions += fileArtifact.deletions;
  }

  if (files.length === 0) {
    throw new StagedWorkspaceReviewError('No file diff preview is available for this staged workspace change.');
  }

  return {
    source: 'staged_workspace_preview',
    summary: {
      filesChanged: files.length,
      insertions,
      deletions
    },
    files
  };
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
    throw new StagedWorkspaceReviewError(`Hunk ${overlap} cannot be both accepted and rejected.`);
  }
}

function resolveHunkSelection(
  resolved: ResolvedStagedWorkspaceChangeSet,
  acceptedHunkIds: string[],
  rejectedHunkIds: string[]
): ResolvedHunkSelection {
  const acceptedIds = uniqueStrings(acceptedHunkIds);
  const rejectedIds = uniqueStrings(rejectedHunkIds);
  assertDisjointHunkIds(acceptedIds, rejectedIds);

  const artifact = createStagedWorkspacePreviewArtifact(resolved.changeSet);
  const parsed = parseRunChangeHunks(artifact);
  if (!parsed.artifactSupported) {
    throw new StagedWorkspaceReviewError(parsed.unsupportedReason ?? 'Staged workspace hunks are not supported.');
  }

  const hunkById = new Map<string, RunChangeHunkArtifact>();
  for (const hunk of parsed.hunks) {
    if (hunkById.has(hunk.id)) {
      throw new StagedWorkspaceReviewError(`Duplicate hunk id detected: ${hunk.id}.`);
    }
    hunkById.set(hunk.id, hunk);
  }

  const selectedIds = [...acceptedIds, ...rejectedIds];
  if (selectedIds.length === 0) {
    throw new StagedWorkspaceReviewError('At least one hunk id is required.');
  }

  const unknownId = selectedIds.find((hunkId) => !hunkById.has(hunkId));
  if (unknownId) {
    throw new StagedWorkspaceReviewError(`Unknown staged workspace hunk id: ${unknownId}.`);
  }

  return {
    hunkIds: selectedIds,
    acceptedHunks: parsed.hunks.filter((hunk) => acceptedIds.includes(hunk.id)),
    rejectedHunks: parsed.hunks.filter((hunk) => rejectedIds.includes(hunk.id))
  };
}

function findPreviewFileForHunk(changeSet: StagedWorkspaceChangeSet, hunk: RunChangeHunkArtifact) {
  const artifact = createStagedWorkspacePreviewArtifact(changeSet);
  return artifact.files.find((file) => file.path.replace(/\\/gu, '/') === hunk.filePath) ?? null;
}

function findOperationForHunk(changeSet: StagedWorkspaceChangeSet, hunk: RunChangeHunkArtifact) {
  return changeSet.operations.find((operation) => operation.path.replace(/\\/gu, '/') === hunk.filePath) ?? null;
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
  resolved: ResolvedStagedWorkspaceChangeSet,
  selection: ResolvedHunkSelection,
  workspaceRoot: string
): PreparedStagedWorkspaceHunkFile[] {
  if (selection.acceptedHunks.length === 0) {
    throw new StagedWorkspaceReviewError('At least one accepted hunk id is required to apply hunks.');
  }

  const grouped = groupHunksByFile(selection.acceptedHunks);
  const prepared: PreparedStagedWorkspaceHunkFile[] = [];
  for (const [filePath, acceptedHunks] of grouped.entries()) {
    const firstHunk = acceptedHunks[0];
    if (!firstHunk) {
      continue;
    }

    for (const hunk of acceptedHunks) {
      if (!hunk.partialApplySupported || hunk.supportKind !== 'partial') {
        throw new StagedWorkspaceReviewError(
          hunk.unsupportedReason ?? `Hunk ${hunk.id} is not supported for partial apply.`
        );
      }
    }

    const file = findPreviewFileForHunk(resolved.changeSet, firstHunk);
    if (!file) {
      throw new StagedWorkspaceReviewError(`No preview file found for staged hunk path ${filePath}.`);
    }

    const operation = findOperationForHunk(resolved.changeSet, firstHunk);
    if (!operation) {
      throw new StagedWorkspaceReviewError(`No staged operation found for hunk path ${filePath}.`);
    }

    if (operation.operation !== 'write_file' && operation.operation !== 'apply_patch') {
      throw new StagedWorkspaceReviewError(`Staged ${operation.operation} operation does not support partial hunk apply.`);
    }

    if (operation.beforeContent !== file.beforeContent) {
      throw new StagedWorkspaceReviewError(`Staged operation content does not match preview content for ${filePath}.`);
    }

    const resolvedPath = normalizeWorkspacePath(workspaceRoot, operation.path);
    if (resolvedPath.relativePath === '.') {
      throw new StagedWorkspaceReviewError('Staged hunk operation requires a path inside the workspace.');
    }

    prepared.push({
      operation,
      resolved: resolvedPath,
      file,
      acceptedHunks,
      synthesizedAfterContent: synthesizeAcceptedHunkContent(file, acceptedHunks)
    });
  }

  return prepared;
}

async function assertNoHunkWorkspaceDrift(prepared: PreparedStagedWorkspaceHunkFile[]) {
  for (const item of prepared) {
    const currentContent = await readCurrentText(item.resolved.absolutePath);
    if (currentContent !== item.operation.beforeContent) {
      throw new StagedWorkspaceReviewError(
        `Workspace drift for ${item.resolved.relativePath}: current file content no longer matches the staged beforeContent.`
      );
    }
  }
}

async function applyPreparedHunkFiles(prepared: PreparedStagedWorkspaceHunkFile[]) {
  for (const item of prepared) {
    await mkdir(dirname(item.resolved.absolutePath), { recursive: true });
    await writeFile(item.resolved.absolutePath, item.synthesizedAfterContent, 'utf8');
  }
}

async function assertNoHunkRevertWorkspaceDrift(prepared: PreparedStagedWorkspaceHunkFile[]) {
  for (const item of prepared) {
    const currentContent = await readCurrentText(item.resolved.absolutePath);
    if (currentContent !== item.synthesizedAfterContent) {
      throw new StagedWorkspaceReviewError(
        `Workspace drift for ${item.resolved.relativePath}: current file content no longer matches the applied staged hunk output.`
      );
    }
  }
}

async function revertPreparedHunkFiles(prepared: PreparedStagedWorkspaceHunkFile[]) {
  for (const item of prepared) {
    await mkdir(dirname(item.resolved.absolutePath), { recursive: true });
    await writeFile(item.resolved.absolutePath, item.operation.beforeContent ?? '', 'utf8');
  }
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

function assertCanRevertHunks(resolved: ResolvedStagedWorkspaceChangeSet) {
  const latestDecision = getLatestHunkReviewDecision(resolved);
  if (latestDecision?.action === 'applied' && latestDecision.status === 'applied') {
    return latestDecision;
  }

  throw new StagedWorkspaceReviewError('Only applied staged workspace hunk changes can be reverted.');
}

async function readCurrentText(path: string) {
  return readFile(path, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  });
}

function assertFileOperationContent(operation: StagedWorkspaceOperation) {
  if ((operation.operation === 'write_file' || operation.operation === 'apply_patch') && typeof operation.proposedAfterContent !== 'string') {
    throw new StagedWorkspaceReviewError(
      `Staged ${operation.operation} operation for ${operation.path} is missing proposed content.`
    );
  }
}

async function assertNoWorkspaceDrift(prepared: PreparedStagedWorkspaceOperation[]) {
  for (const item of prepared) {
    const operation = item.operation;
    if (operation.operation === 'mkdir') {
      continue;
    }

    const currentContent = await readCurrentText(item.resolved.absolutePath);
    if (currentContent !== operation.beforeContent) {
      throw new StagedWorkspaceReviewError(
        `Workspace drift for ${item.resolved.relativePath}: current file content no longer matches the staged beforeContent.`
      );
    }
  }
}

function prepareOperations(
  changeSet: StagedWorkspaceChangeSet,
  workspaceRoot: string
): PreparedStagedWorkspaceOperation[] {
  return changeSet.operations.map((operation) => {
    if (!operation.path || typeof operation.path !== 'string') {
      throw new StagedWorkspaceReviewError('Staged workspace operation is missing a path.');
    }

    assertFileOperationContent(operation);

    const resolved = normalizeWorkspacePath(workspaceRoot, operation.path);
    if (resolved.relativePath === '.') {
      throw new StagedWorkspaceReviewError(
        `Staged ${operation.operation} operation requires a path inside the workspace.`
      );
    }

    return {
      operation,
      resolved
    };
  });
}

async function applyPreparedOperations(prepared: PreparedStagedWorkspaceOperation[]) {
  for (const item of prepared) {
    const operation = item.operation;
    if (operation.operation === 'mkdir') {
      await mkdir(item.resolved.absolutePath, { recursive: true });
      continue;
    }

    if (operation.operation === 'delete') {
      await rm(item.resolved.absolutePath, { force: true });
      continue;
    }

    await mkdir(dirname(item.resolved.absolutePath), { recursive: true });
    await writeFile(item.resolved.absolutePath, operation.proposedAfterContent ?? '', 'utf8');
  }
}

async function assertNoRevertWorkspaceDrift(prepared: PreparedStagedWorkspaceOperation[]) {
  for (const item of prepared) {
    const operation = item.operation;
    if (operation.operation === 'mkdir') {
      const entries = await readdir(item.resolved.absolutePath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null;
        }
        throw error;
      });
      if (entries && entries.length > 0) {
        throw new StagedWorkspaceReviewError(
          `Staged mkdir operation for ${item.resolved.relativePath} is not safely revertible because the directory is not empty.`
        );
      }
      continue;
    }

    const currentContent = await readCurrentText(item.resolved.absolutePath);
    if (operation.operation === 'delete') {
      if (currentContent !== null) {
        throw new StagedWorkspaceReviewError(
          `Workspace drift for ${item.resolved.relativePath}: expected file to still be missing before revert.`
        );
      }
      continue;
    }

    if (currentContent !== operation.proposedAfterContent) {
      throw new StagedWorkspaceReviewError(
        `Workspace drift for ${item.resolved.relativePath}: current file content no longer matches the applied staged output.`
      );
    }
  }
}

async function removeEmptyDirectoryIfPresent(path: string, relativePath: string) {
  const entries = await readdir(path).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  if (entries === null) {
    return;
  }
  if (entries.length > 0) {
    throw new StagedWorkspaceReviewError(
      `Staged mkdir operation for ${relativePath} is not safely revertible because the directory is not empty.`
    );
  }
  await rmdir(path);
}

async function revertPreparedOperations(prepared: PreparedStagedWorkspaceOperation[]) {
  for (const item of [...prepared].reverse()) {
    const operation = item.operation;
    if (operation.operation === 'mkdir') {
      await removeEmptyDirectoryIfPresent(item.resolved.absolutePath, item.resolved.relativePath);
      continue;
    }

    if (operation.operation === 'delete') {
      if (typeof operation.beforeContent !== 'string') {
        throw new StagedWorkspaceReviewError(
          `Staged delete operation for ${operation.path} is missing beforeContent.`
        );
      }
      await mkdir(dirname(item.resolved.absolutePath), { recursive: true });
      await writeFile(item.resolved.absolutePath, operation.beforeContent, 'utf8');
      continue;
    }

    if (operation.beforeContent === null) {
      await rm(item.resolved.absolutePath, { force: true });
      continue;
    }

    await mkdir(dirname(item.resolved.absolutePath), { recursive: true });
    await writeFile(item.resolved.absolutePath, operation.beforeContent, 'utf8');
  }
}

function assertCanRevert(resolved: ResolvedStagedWorkspaceChangeSet) {
  const latestDecision = getLatestReviewDecision(resolved);
  if (latestDecision?.action === 'applied' && latestDecision.status === 'applied') {
    return;
  }

  throw new StagedWorkspaceReviewError('Only applied staged workspace changes can be reverted.');
}

function safeReasonFromError(error: unknown, fallback = 'Failed to apply staged workspace changes.') {
  if (error instanceof StagedWorkspaceReviewError) {
    return error.safeReason;
  }

  return fallback;
}

export class StagedWorkspaceReviewService {
  constructor(private readonly db: StagedWorkspaceReviewDb) {}

  async apply(input: ApplyStagedWorkspaceReviewInput): Promise<StagedWorkspaceReviewDecision> {
    const resolved = this.resolve(input);

    try {
      const prepared = prepareOperations(resolved.changeSet, input.workspaceRoot);
      await assertNoWorkspaceDrift(prepared);
      await applyPreparedOperations(prepared);
      return this.recordDecision(resolved, 'applied', 'applied', null);
    } catch (error) {
      const errorReason = safeReasonFromError(error);
      this.recordDecision(resolved, 'applied', 'failed', errorReason);
      throw new Error(errorReason);
    }
  }

  async applyHunks(input: ApplyStagedWorkspaceHunkReviewInput): Promise<StagedWorkspaceHunkReviewDecision> {
    const resolved = this.resolve(input);
    let selection: ResolvedHunkSelection | null = null;

    try {
      selection = resolveHunkSelection(
        resolved,
        input.acceptedHunkIds,
        input.rejectedHunkIds ?? []
      );
      const prepared = prepareHunkFiles(resolved, selection, input.workspaceRoot);
      await assertNoHunkWorkspaceDrift(prepared);
      await applyPreparedHunkFiles(prepared);
      return this.recordHunkDecision(resolved, 'applied', 'applied', selection, null);
    } catch (error) {
      const errorReason = safeReasonFromError(error, 'Failed to apply staged workspace hunks.');
      const fallbackSelection = selection ?? {
        hunkIds: uniqueStrings([...(input.acceptedHunkIds ?? []), ...(input.rejectedHunkIds ?? [])]),
        acceptedHunks: [],
        rejectedHunks: []
      };
      this.recordHunkDecision(resolved, 'applied', 'failed', fallbackSelection, errorReason);
      throw new Error(errorReason);
    }
  }

  async revert(input: RevertStagedWorkspaceReviewInput): Promise<StagedWorkspaceReviewDecision> {
    const resolved = this.resolve(input);

    try {
      assertCanRevert(resolved);
      const prepared = prepareOperations(resolved.changeSet, input.workspaceRoot);
      await assertNoRevertWorkspaceDrift(prepared);
      await revertPreparedOperations(prepared);
      return this.recordDecision(resolved, 'reverted', 'reverted', null);
    } catch (error) {
      const errorReason = safeReasonFromError(error, 'Failed to revert staged workspace changes.');
      this.recordDecision(resolved, 'reverted', 'failed', errorReason);
      throw new Error(errorReason);
    }
  }

  async revertHunks(input: RevertStagedWorkspaceHunkReviewInput): Promise<StagedWorkspaceHunkReviewDecision> {
    const resolved = this.resolve(input);
    let selection: ResolvedHunkSelection | null = null;

    try {
      const latestDecision = assertCanRevertHunks(resolved);
      selection = resolveHunkSelection(
        resolved,
        latestDecision.acceptedHunkIds,
        latestDecision.rejectedHunkIds
      );
      const prepared = prepareHunkFiles(resolved, selection, input.workspaceRoot);
      await assertNoHunkRevertWorkspaceDrift(prepared);
      await revertPreparedHunkFiles(prepared);
      return this.recordHunkDecision(resolved, 'reverted', 'reverted', selection, null);
    } catch (error) {
      const errorReason = safeReasonFromError(error, 'Failed to revert staged workspace hunks.');
      const fallbackSelection = selection ?? {
        hunkIds: [],
        acceptedHunks: [],
        rejectedHunks: []
      };
      this.recordHunkDecision(resolved, 'reverted', 'failed', fallbackSelection, errorReason);
      throw new Error(errorReason);
    }
  }

  async reject(input: StagedWorkspaceReviewTarget): Promise<StagedWorkspaceReviewDecision> {
    const resolved = this.resolve(input);
    return this.recordDecision(resolved, 'rejected', 'rejected', null);
  }

  async rejectHunks(input: RejectStagedWorkspaceHunkReviewInput): Promise<StagedWorkspaceHunkReviewDecision> {
    const resolved = this.resolve(input);
    const selection = resolveHunkSelection(resolved, [], input.hunkIds);
    return this.recordHunkDecision(resolved, 'rejected', 'rejected', selection, null);
  }

  preview(input: StagedWorkspaceReviewTarget): RunChangeArtifact {
    const resolved = this.resolve(input);
    return createStagedWorkspacePreviewArtifact(resolved.changeSet);
  }

  private resolve(input: StagedWorkspaceReviewTarget): ResolvedStagedWorkspaceChangeSet {
    const thread = this.db.getThread(input.threadId);
    const stagedEvents = getStagedEvents(thread, input.runId);
    if (stagedEvents.length === 0) {
      throw new Error(`No staged workspace changes found for run ${input.runId}.`);
    }

    if (input.stagedEventId) {
      const match = stagedEvents.find((candidate) => candidate.event.id === input.stagedEventId);
      if (!match) {
        throw new Error(`Staged workspace change event not found: ${input.stagedEventId}.`);
      }
      return match;
    }

    if (typeof input.stagedEventIndex === 'number') {
      if (!Number.isInteger(input.stagedEventIndex) || input.stagedEventIndex < 0 || input.stagedEventIndex >= stagedEvents.length) {
        throw new Error(`Staged workspace change index out of range: ${input.stagedEventIndex}.`);
      }
      return stagedEvents[input.stagedEventIndex] as ResolvedStagedWorkspaceChangeSet;
    }

    if (stagedEvents.length === 1) {
      return stagedEvents[0] as ResolvedStagedWorkspaceChangeSet;
    }

    throw new Error('stagedEventId or stagedEventIndex is required when a run has multiple staged workspace change events.');
  }

  private recordDecision(
    resolved: ResolvedStagedWorkspaceChangeSet,
    action: StagedWorkspaceReviewAction,
    status: StagedWorkspaceReviewStatus,
    errorReason: string | null
  ): StagedWorkspaceReviewDecision {
    const decision: StagedWorkspaceReviewDecision = {
      action,
      status,
      threadId: resolved.event.threadId,
      runId: resolved.event.runId,
      stagedEventId: resolved.event.id,
      stagedEventIndex: resolved.stagedEventIndex,
      sourceToolName: resolved.changeSet.sourceToolName,
      isolationMode: resolved.changeSet.isolationMode,
      changedPaths: uniqueChangedPaths(resolved.changeSet),
      operationKinds: uniqueOperationKinds(resolved.changeSet.operations),
      errorReason,
      createdAt: new Date().toISOString()
    };

    this.db.addRunEvent(decision.threadId, decision.runId, 'info', {
      stagedWorkspaceReviewDecision: decision,
      eventKind: 'debug_detail',
      transcriptVisible: false
    });

    return decision;
  }

  private recordHunkDecision(
    resolved: ResolvedStagedWorkspaceChangeSet,
    action: StagedWorkspaceHunkReviewDecision['action'],
    status: StagedWorkspaceHunkReviewDecision['status'],
    selection: ResolvedHunkSelection,
    errorReason: string | null
  ): StagedWorkspaceHunkReviewDecision {
    const selectedHunks = [...selection.acceptedHunks, ...selection.rejectedHunks];
    const stats = hunkLineStats(selectedHunks);
    const changedPaths = changedPathsFromHunks(selection);
    const decision: StagedWorkspaceHunkReviewDecision = {
      action,
      status,
      threadId: resolved.event.threadId,
      runId: resolved.event.runId,
      source: 'staged_workspace_preview',
      isolationMode: 'patch_buffer',
      stagedEventId: resolved.event.id,
      stagedEventIndex: resolved.stagedEventIndex,
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
      stagedWorkspaceHunkReviewDecision: decision,
      eventKind: 'debug_detail',
      transcriptVisible: false
    });

    return decision;
  }
}
