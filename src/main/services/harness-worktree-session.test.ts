import { dirname, relative, isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HarnessWorktreeSessionService,
  type HarnessWorktreeGitCommand,
  type HarnessWorktreeGitResult
} from './harness-worktree-session';

const NOW = '2026-05-28T12:00:00.000Z';
const SOURCE_REPO_ROOT = 'D:\\repo';
const SOURCE_WORKSPACE_ROOT = 'D:\\repo\\packages\\app';
const APP_WORKTREE_ROOT = 'D:\\vicode-state\\worktrees';

function gitResult(stdout = '', stderr = '', exitCode = 0): HarnessWorktreeGitResult {
  return { stdout, stderr, exitCode };
}

function commandKey(command: HarnessWorktreeGitCommand) {
  return `${command.cwd ?? '<none>'}::${command.args.join(' ')}`;
}

function createFakeGitRunner(
  responses: Record<string, HarnessWorktreeGitResult | Error>
) {
  const calls: HarnessWorktreeGitCommand[] = [];
  return {
    calls,
    runner: async (command: HarnessWorktreeGitCommand) => {
      calls.push(command);
      const response = responses[commandKey(command)];
      if (response instanceof Error) {
        throw response;
      }
      if (!response) {
        throw new Error(`Unexpected git command: ${commandKey(command)}`);
      }
      return response;
    }
  };
}

function expectedWorktreeRepoRoot(projectId = 'project-1', runId = 'run-1') {
  return join(APP_WORKTREE_ROOT, projectId, runId);
}

function worktreeAddKey(projectId = 'project-1', runId = 'run-1') {
  return `${SOURCE_REPO_ROOT}::worktree add --detach ${expectedWorktreeRepoRoot(projectId, runId)} abc123def456`;
}

function createCleanResponses(overrides: Record<string, HarnessWorktreeGitResult | Error> = {}) {
  return {
    '<none>::--version': gitResult('git version 2.45.0\n'),
    [`${SOURCE_WORKSPACE_ROOT}::rev-parse --show-toplevel`]: gitResult(`${SOURCE_REPO_ROOT}\n`),
    [`${SOURCE_REPO_ROOT}::rev-parse HEAD`]: gitResult('abc123def456\n'),
    [`${SOURCE_REPO_ROOT}::status --porcelain=v1 --untracked-files=no -- packages/app`]: gitResult(''),
    [`${SOURCE_REPO_ROOT}::status --porcelain=v1 --untracked-files=all -- packages/app`]: gitResult(''),
    ...overrides
  };
}

function createService(responses: Record<string, HarnessWorktreeGitResult | Error>) {
  const fake = createFakeGitRunner(responses);
  const directoryCalls: string[] = [];
  const service = new HarnessWorktreeSessionService({
    appWorktreeRoot: APP_WORKTREE_ROOT,
    gitRunner: fake.runner,
    now: () => new Date(NOW),
    ensureDirectory: async (path) => {
      directoryCalls.push(path);
    }
  });
  return { service, fake, directoryCalls };
}

function baseInput(overrides: Partial<Parameters<HarnessWorktreeSessionService['prepare']>[0]> = {}) {
  return {
    threadId: 'thread-1',
    runId: 'run-1',
    projectId: 'project-1',
    sourceWorkspaceRoot: SOURCE_WORKSPACE_ROOT,
    ...overrides
  };
}

describe('HarnessWorktreeSessionService', () => {
  it('returns a clear preflight failure when Git is unavailable', async () => {
    const missingGit = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
    const { service } = createService({
      '<none>::--version': missingGit
    });

    const result = await service.prepare(baseInput());

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.reason).toBe('missing_git');
    expect(result.ok ? null : result.message).toContain('Git executable');
  });

  it('returns a clear preflight failure when the workspace is not inside a Git repo', async () => {
    const { service } = createService({
      '<none>::--version': gitResult('git version 2.45.0\n'),
      [`${SOURCE_WORKSPACE_ROOT}::rev-parse --show-toplevel`]: gitResult('', 'fatal: not a git repository\n', 128)
    });

    const result = await service.prepare(baseInput());

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.reason).toBe('no_git_repo');
    expect(result.ok ? null : result.message).toContain('Git repository');
  });

  it('blocks preparation when tracked files are dirty under the source workspace', async () => {
    const { service } = createService(createCleanResponses({
      [`${SOURCE_REPO_ROOT}::status --porcelain=v1 --untracked-files=no -- packages/app`]: gitResult(' M packages/app/src/app.ts\n')
    }));

    const result = await service.prepare(baseInput());

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.reason).toBe('dirty_workspace');
    expect(result.ok ? [] : result.paths).toEqual(['packages/app/src/app.ts']);
  });

  it('blocks preparation when untracked files exist under the source workspace', async () => {
    const { service } = createService(createCleanResponses({
      [`${SOURCE_REPO_ROOT}::status --porcelain=v1 --untracked-files=all -- packages/app`]: gitResult('?? packages/app/src/new-file.ts\n')
    }));

    const result = await service.prepare(baseInput());

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.reason).toBe('untracked_files');
    expect(result.ok ? [] : result.paths).toEqual(['packages/app/src/new-file.ts']);
  });

  it('allows ignored files because normal status output excludes them', async () => {
    const { service } = createService(createCleanResponses());

    const result = await service.prepare(baseInput());

    expect(result.ok).toBe(true);
    expect(result.ok ? result.session.status : null).toBe('ready');
  });

  it('returns a ready serializable session with deterministic worktree path and branch name', async () => {
    const { service } = createService(createCleanResponses());

    const result = await service.prepare(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.session).toEqual({
      threadId: 'thread-1',
      runId: 'run-1',
      projectId: 'project-1',
      sourceRepoRoot: SOURCE_REPO_ROOT,
      sourceWorkspaceRoot: SOURCE_WORKSPACE_ROOT,
      sourceWorkspaceRelativePath: 'packages/app',
      worktreeRepoRoot: join(APP_WORKTREE_ROOT, 'project-1', 'run-1'),
      worktreeWorkspaceRoot: join(APP_WORKTREE_ROOT, 'project-1', 'run-1', 'packages', 'app'),
      branchName: 'vicode/worktree/project-1/run-1',
      baseRef: 'HEAD',
      baseSha: 'abc123def456',
      status: 'ready',
      cleanupPolicy: 'preserve_until_review',
      reviewStatus: 'pending',
      createdAt: NOW,
      updatedAt: NOW,
      errorReason: null
    });
  });

  it('maps a repo-root project to the worktree repo root', async () => {
    const { service } = createService({
      '<none>::--version': gitResult('git version 2.45.0\n'),
      [`${SOURCE_REPO_ROOT}::rev-parse --show-toplevel`]: gitResult(`${SOURCE_REPO_ROOT}\n`),
      [`${SOURCE_REPO_ROOT}::rev-parse HEAD`]: gitResult('abc123def456\n'),
      [`${SOURCE_REPO_ROOT}::status --porcelain=v1 --untracked-files=no -- .`]: gitResult(''),
      [`${SOURCE_REPO_ROOT}::status --porcelain=v1 --untracked-files=all -- .`]: gitResult('')
    });

    const result = await service.prepare(baseInput({
      sourceWorkspaceRoot: SOURCE_REPO_ROOT
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.session.sourceWorkspaceRelativePath).toBe('.');
    expect(result.session.worktreeWorkspaceRoot).toBe(result.session.worktreeRepoRoot);
  });

  it('contains computed worktree paths under the injected app-owned worktree root', async () => {
    const { service } = createService(createCleanResponses());

    const result = await service.prepare(baseInput({
      projectId: '../project 1',
      runId: 'run/../../evil'
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    const relativeWorktreePath = relative(APP_WORKTREE_ROOT, result.session.worktreeRepoRoot);
    expect(relativeWorktreePath.startsWith('..')).toBe(false);
    expect(isAbsolute(relativeWorktreePath)).toBe(false);
    expect(result.session.branchName).not.toContain('..');
  });

  it('does not issue git branch or worktree mutation commands during preparation', async () => {
    const { service, fake } = createService(createCleanResponses());

    const result = await service.prepare(baseInput());

    expect(result.ok).toBe(true);
    expect(fake.calls.some((call) => call.args.includes('worktree'))).toBe(false);
    expect(fake.calls.some((call) => call.args.includes('branch'))).toBe(false);
    expect(fake.calls.some((call) => call.args.includes('checkout'))).toBe(false);
  });

  it('creates a worktree after prepare passes and returns a ready session', async () => {
    const { service } = createService(createCleanResponses({
      [worktreeAddKey()]: gitResult('')
    }));

    const result = await service.create(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.session.status).toBe('ready');
    expect(result.session.worktreeRepoRoot).toBe(expectedWorktreeRepoRoot());
  });

  it('runs only the expected git worktree mutation command during create', async () => {
    const { service, fake } = createService(createCleanResponses({
      [worktreeAddKey()]: gitResult('')
    }));

    const result = await service.create(baseInput());

    expect(result.ok).toBe(true);
    const mutationCalls = fake.calls.filter((call) => call.args.includes('worktree'));
    expect(mutationCalls).toEqual([
      {
        cwd: SOURCE_REPO_ROOT,
        args: [
          'worktree',
          'add',
          '--detach',
          expectedWorktreeRepoRoot(),
          'abc123def456'
        ]
      }
    ]);
  });

  it('creates only the app-owned parent directory before create', async () => {
    const { service, directoryCalls } = createService(createCleanResponses({
      [worktreeAddKey()]: gitResult('')
    }));

    const result = await service.create(baseInput());

    expect(result.ok).toBe(true);
    expect(directoryCalls).toEqual([dirname(expectedWorktreeRepoRoot())]);
    expect(directoryCalls).not.toContain(SOURCE_WORKSPACE_ROOT);
    expect(directoryCalls).not.toContain(SOURCE_REPO_ROOT);
  });

  it('does not create a worktree when prepare fails for missing Git', async () => {
    const missingGit = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
    const { service, fake, directoryCalls } = createService({
      '<none>::--version': missingGit
    });

    const result = await service.create(baseInput());

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.reason).toBe('missing_git');
    expect(fake.calls.some((call) => call.args.includes('worktree'))).toBe(false);
    expect(directoryCalls).toEqual([]);
  });

  it('does not create a worktree when prepare fails for dirty tracked files', async () => {
    const { service, fake, directoryCalls } = createService(createCleanResponses({
      [`${SOURCE_REPO_ROOT}::status --porcelain=v1 --untracked-files=no -- packages/app`]: gitResult(' M packages/app/src/app.ts\n')
    }));

    const result = await service.create(baseInput());

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.reason).toBe('dirty_workspace');
    expect(fake.calls.some((call) => call.args.includes('worktree'))).toBe(false);
    expect(directoryCalls).toEqual([]);
  });

  it('does not create a worktree when prepare fails for untracked files', async () => {
    const { service, fake, directoryCalls } = createService(createCleanResponses({
      [`${SOURCE_REPO_ROOT}::status --porcelain=v1 --untracked-files=all -- packages/app`]: gitResult('?? packages/app/src/new-file.ts\n')
    }));

    const result = await service.create(baseInput());

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.reason).toBe('untracked_files');
    expect(fake.calls.some((call) => call.args.includes('worktree'))).toBe(false);
    expect(directoryCalls).toEqual([]);
  });

  it('refuses cleanup for a path outside the injected app-owned worktree root', async () => {
    const { service, fake } = createService(createCleanResponses());

    const result = await service.cleanup({
      sourceRepoRoot: SOURCE_REPO_ROOT,
      worktreeRepoRoot: 'D:\\outside\\run-1'
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('refused');
    expect(result.errorReason).toContain('app-owned worktree root');
    expect(fake.calls.some((call) => call.args.includes('worktree'))).toBe(false);
  });

  it('removes an owned worktree through git worktree remove', async () => {
    const worktreeRepoRoot = expectedWorktreeRepoRoot();
    const { service, fake } = createService(createCleanResponses({
      [`${SOURCE_REPO_ROOT}::worktree remove --force ${worktreeRepoRoot}`]: gitResult('')
    }));

    const result = await service.cleanup({
      sourceRepoRoot: SOURCE_REPO_ROOT,
      worktreeRepoRoot
    });

    expect(result).toEqual({
      ok: true,
      status: 'cleaned',
      worktreeRepoRoot,
      errorReason: null
    });
    expect(fake.calls.at(-1)).toEqual({
      cwd: SOURCE_REPO_ROOT,
      args: ['worktree', 'remove', '--force', worktreeRepoRoot]
    });
  });

  it('returns a clear failed cleanup result when git remove fails', async () => {
    const worktreeRepoRoot = expectedWorktreeRepoRoot();
    const { service } = createService(createCleanResponses({
      [`${SOURCE_REPO_ROOT}::worktree remove --force ${worktreeRepoRoot}`]: gitResult('', 'fatal: worktree is locked\n', 128)
    }));

    const result = await service.cleanup({
      sourceRepoRoot: SOURCE_REPO_ROOT,
      worktreeRepoRoot
    });

    expect(result).toEqual({
      ok: false,
      status: 'failed',
      worktreeRepoRoot,
      errorReason: 'Git failed to remove the worktree.'
    });
  });
});
