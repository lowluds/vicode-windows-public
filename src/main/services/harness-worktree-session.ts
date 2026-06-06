import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export type HarnessWorktreeSessionStatus =
  | 'creating'
  | 'ready'
  | 'failed'
  | 'review_pending'
  | 'applied'
  | 'rejected'
  | 'reverted'
  | 'cleanup_pending'
  | 'cleaned';

export type HarnessWorktreeCleanupPolicy =
  | 'preserve_until_review'
  | 'delete_after_apply'
  | 'delete_after_reject'
  | 'delete_after_revert';

export type HarnessWorktreeReviewStatus =
  | 'pending'
  | 'applied'
  | 'rejected'
  | 'reverted'
  | 'failed';

export interface HarnessWorktreeSession {
  threadId: string;
  runId: string;
  projectId: string;
  sourceRepoRoot: string;
  sourceWorkspaceRoot: string;
  sourceWorkspaceRelativePath: string;
  worktreeRepoRoot: string;
  worktreeWorkspaceRoot: string;
  branchName: string;
  baseRef: 'HEAD';
  baseSha: string;
  status: HarnessWorktreeSessionStatus;
  cleanupPolicy: HarnessWorktreeCleanupPolicy;
  reviewStatus: HarnessWorktreeReviewStatus;
  createdAt: string;
  updatedAt: string;
  errorReason: string | null;
}

export type HarnessWorktreePreflightFailureReason =
  | 'missing_git'
  | 'no_git_repo'
  | 'base_ref_unavailable'
  | 'dirty_workspace'
  | 'untracked_files'
  | 'workspace_outside_repo'
  | 'dirty_check_failed'
  | 'worktree_create_failed'
  | 'invalid_input';

export interface HarnessWorktreePreflightFailure {
  ok: false;
  reason: HarnessWorktreePreflightFailureReason;
  message: string;
  paths: string[];
}

export interface HarnessWorktreePreflightSuccess {
  ok: true;
  session: HarnessWorktreeSession;
}

export type HarnessWorktreePreflightResult =
  | HarnessWorktreePreflightSuccess
  | HarnessWorktreePreflightFailure;

export type HarnessWorktreeCreateResult = HarnessWorktreePreflightResult;

export type HarnessWorktreeCleanupStatus =
  | 'cleaned'
  | 'failed'
  | 'refused';

export interface HarnessWorktreeCleanupInput {
  sourceRepoRoot: string;
  worktreeRepoRoot: string;
}

export interface HarnessWorktreeCleanupResult {
  ok: boolean;
  status: HarnessWorktreeCleanupStatus;
  worktreeRepoRoot: string;
  errorReason: string | null;
}

export interface HarnessWorktreeGitCommand {
  args: string[];
  cwd?: string | null;
}

export interface HarnessWorktreeGitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type HarnessWorktreeGitRunner = (
  command: HarnessWorktreeGitCommand
) => Promise<HarnessWorktreeGitResult>;

export interface HarnessWorktreeSessionServiceOptions {
  appWorktreeRoot: string;
  gitRunner?: HarnessWorktreeGitRunner;
  ensureDirectory?: (path: string) => Promise<void>;
  now?: () => Date;
}

export interface PrepareHarnessWorktreeSessionInput {
  threadId: string;
  runId: string;
  projectId: string;
  sourceWorkspaceRoot: string;
}

interface ExecFileFailure extends Error {
  code?: string | number | null;
}

const MAX_GIT_OUTPUT_BYTES = 1024 * 1024 * 8;

export const nodeGitRunner: HarnessWorktreeGitRunner = (command) =>
  new Promise((resolvePromise, rejectPromise) => {
    execFile(
      'git',
      command.args,
      {
        cwd: command.cwd ?? undefined,
        windowsHide: true,
        maxBuffer: MAX_GIT_OUTPUT_BYTES
      },
      (error, stdout, stderr) => {
        const result = {
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          exitCode: 0
        };

        if (!error) {
          resolvePromise(result);
          return;
        }

        const failure = error as ExecFileFailure;
        if (failure.code === 'ENOENT') {
          rejectPromise(error);
          return;
        }

        resolvePromise({
          ...result,
          exitCode: typeof failure.code === 'number' ? failure.code : 1
        });
      }
    );
  });

function failure(
  reason: HarnessWorktreePreflightFailureReason,
  message: string,
  paths: string[] = []
): HarnessWorktreePreflightFailure {
  return {
    ok: false,
    reason,
    message,
    paths
  };
}

function firstStdoutLine(result: HarnessWorktreeGitResult) {
  return result.stdout.split(/\r?\n/).find((line) => line.trim()).trim();
}

function toPortablePath(path: string) {
  return path.replace(/\\/g, '/');
}

function workspacePathspec(sourceRepoRoot: string, sourceWorkspaceRoot: string) {
  const relativePath = relative(sourceRepoRoot, sourceWorkspaceRoot);
  if (!relativePath) {
    return '.';
  }
  return toPortablePath(relativePath);
}

function isPathContained(root: string, target: string) {
  const relativePath = relative(root, target);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function parsePorcelainPath(line: string) {
  const rawPath = line.slice(3).trim();
  const renameMarker = ' -> ';
  const path = rawPath.includes(renameMarker)
    ? rawPath.slice(rawPath.lastIndexOf(renameMarker) + renameMarker.length)
    : rawPath;
  return path.replace(/^"|"$/g, '');
}

function parseTrackedStatusPaths(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !line.startsWith('?? '))
    .map(parsePorcelainPath);
}

function parseUntrackedStatusPaths(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith('?? '))
    .map(parsePorcelainPath);
}

function sanitizeIdentifierSegment(value: string) {
  const segment = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return segment || 'item';
}

export class HarnessWorktreeSessionService {
  private readonly appWorktreeRoot: string;
  private readonly gitRunner: HarnessWorktreeGitRunner;
  private readonly ensureDirectory: (path: string) => Promise<void>;
  private readonly now: () => Date;

  constructor(options: HarnessWorktreeSessionServiceOptions) {
    this.appWorktreeRoot = resolve(options.appWorktreeRoot);
    this.gitRunner = options.gitRunner ?? nodeGitRunner;
    this.ensureDirectory = options.ensureDirectory ?? ((path) => mkdir(path, { recursive: true }).then(() => undefined));
    this.now = options.now ?? (() => new Date());
  }

  async create(input: PrepareHarnessWorktreeSessionInput): Promise<HarnessWorktreeCreateResult> {
    const prepared = await this.prepare(input);
    if (!prepared.ok) {
      return prepared;
    }

    const session = prepared.session;
    await this.ensureDirectory(dirname(session.worktreeRepoRoot));
    const createResult = await this.runGit(
      [
        'worktree',
        'add',
        '--detach',
        session.worktreeRepoRoot,
        session.baseSha
      ],
      session.sourceRepoRoot
    ).catch(() => null);

    if (!createResult || createResult.exitCode !== 0) {
      return failure(
        'worktree_create_failed',
        'Git failed to create the app-owned worktree.'
      );
    }

    return {
      ok: true,
      session
    };
  }

  async cleanup(input: HarnessWorktreeCleanupInput): Promise<HarnessWorktreeCleanupResult> {
    const worktreeRepoRoot = resolve(input.worktreeRepoRoot);
    if (!isPathContained(this.appWorktreeRoot, worktreeRepoRoot)) {
      return {
        ok: false,
        status: 'refused',
        worktreeRepoRoot,
        errorReason: 'Refusing to remove a worktree outside the app-owned worktree root.'
      };
    }

    const result = await this.runGit(
      ['worktree', 'remove', '--force', worktreeRepoRoot],
      resolve(input.sourceRepoRoot)
    ).catch(() => null);

    if (!result || result.exitCode !== 0) {
      return {
        ok: false,
        status: 'failed',
        worktreeRepoRoot,
        errorReason: 'Git failed to remove the worktree.'
      };
    }

    return {
      ok: true,
      status: 'cleaned',
      worktreeRepoRoot,
      errorReason: null
    };
  }

  async prepare(input: PrepareHarnessWorktreeSessionInput): Promise<HarnessWorktreePreflightResult> {
    const sourceWorkspaceRoot = input.sourceWorkspaceRoot?.trim()
      ? resolve(input.sourceWorkspaceRoot)
      : '';
    if (!sourceWorkspaceRoot) {
      return failure(
        'invalid_input',
        'A source workspace root is required before preparing a Git worktree session.'
      );
    }

    const gitAvailable = await this.runGit(['--version'], null).catch(() => null);
    if (!gitAvailable || gitAvailable.exitCode !== 0) {
      return failure(
        'missing_git',
        'Git executable is unavailable. Install Git or ensure git is on PATH before using git_worktree isolation.'
      );
    }

    const repoRootResult = await this.runGit(['rev-parse', '--show-toplevel'], sourceWorkspaceRoot);
    if (repoRootResult.exitCode !== 0) {
      return failure(
        'no_git_repo',
        `Source workspace is not inside a Git repository: ${repoRootResult.stderr.trim() || sourceWorkspaceRoot}`
      );
    }

    const sourceRepoRoot = resolve(firstStdoutLine(repoRootResult));
    if (!isPathContained(sourceRepoRoot, sourceWorkspaceRoot)) {
      return failure(
        'workspace_outside_repo',
        'Resolved source workspace root is outside the resolved Git repository root.'
      );
    }

    const baseShaResult = await this.runGit(['rev-parse', 'HEAD'], sourceRepoRoot);
    if (baseShaResult.exitCode !== 0) {
      return failure(
        'base_ref_unavailable',
        `Could not resolve HEAD before preparing a worktree session: ${baseShaResult.stderr.trim() || 'unknown Git error'}`
      );
    }

    const baseSha = firstStdoutLine(baseShaResult);
    const pathspec = workspacePathspec(sourceRepoRoot, sourceWorkspaceRoot);
    const trackedStatus = await this.runGit(
      ['status', '--porcelain=v1', '--untracked-files=no', '--', pathspec],
      sourceRepoRoot
    );
    if (trackedStatus.exitCode !== 0) {
      return failure(
        'dirty_check_failed',
        `Could not inspect tracked workspace changes before preparing a worktree session: ${trackedStatus.stderr.trim() || 'unknown Git error'}`
      );
    }

    const trackedPaths = parseTrackedStatusPaths(trackedStatus.stdout);
    if (trackedPaths.length > 0) {
      return failure(
        'dirty_workspace',
        'git_worktree isolation requires a clean source workspace. Commit, stash, or revert tracked changes under the workspace first.',
        trackedPaths
      );
    }

    const untrackedStatus = await this.runGit(
      ['status', '--porcelain=v1', '--untracked-files=all', '--', pathspec],
      sourceRepoRoot
    );
    if (untrackedStatus.exitCode !== 0) {
      return failure(
        'dirty_check_failed',
        `Could not inspect untracked workspace files before preparing a worktree session: ${untrackedStatus.stderr.trim() || 'unknown Git error'}`
      );
    }

    const untrackedPaths = parseUntrackedStatusPaths(untrackedStatus.stdout);
    if (untrackedPaths.length > 0) {
      return failure(
        'untracked_files',
        'git_worktree isolation requires a clean source workspace. Add, ignore, or remove untracked files under the workspace first.',
        untrackedPaths
      );
    }

    const projectSegment = sanitizeIdentifierSegment(input.projectId);
    const runSegment = sanitizeIdentifierSegment(input.runId);
    const worktreeRepoRoot = resolve(this.appWorktreeRoot, projectSegment, runSegment);
    if (!isPathContained(this.appWorktreeRoot, worktreeRepoRoot)) {
      return failure(
        'invalid_input',
        'Computed worktree path escaped the app-owned worktree root.'
      );
    }

    const sourceWorkspaceRelativePath = pathspec;
    const worktreeWorkspaceRoot =
      sourceWorkspaceRelativePath === '.'
        ? worktreeRepoRoot
        : join(worktreeRepoRoot, ...sourceWorkspaceRelativePath.split('/'));
    const timestamp = this.now().toISOString();

    return {
      ok: true,
      session: {
        threadId: input.threadId,
        runId: input.runId,
        projectId: input.projectId,
        sourceRepoRoot,
        sourceWorkspaceRoot,
        sourceWorkspaceRelativePath,
        worktreeRepoRoot,
        worktreeWorkspaceRoot,
        branchName: `vicode/worktree/${projectSegment}/${runSegment}`,
        baseRef: 'HEAD',
        baseSha,
        status: 'ready',
        cleanupPolicy: 'preserve_until_review',
        reviewStatus: 'pending',
        createdAt: timestamp,
        updatedAt: timestamp,
        errorReason: null
      }
    };
  }

  private runGit(args: string[], cwd: string | null) {
    return this.gitRunner({
      args,
      cwd
    });
  }
}
