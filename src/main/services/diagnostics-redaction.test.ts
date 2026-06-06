import { describe, expect, it } from 'vitest';
import {
  redactSupportValue,
  safeDiagnosticPathArray,
  safeDiagnosticStringOrNull,
  sanitizeDiagnosticsPayload
} from './diagnostics-redaction';
import { sanitizeRuntimeTraceDetail } from './diagnostics-runtime-trace';

describe('diagnostics redaction helpers', () => {
  it('redacts secret-like keys and values inside nested support payloads', () => {
    const redacted = redactSupportValue({
      apiKey: 'fixture-api-key-value',
      authorizationToken: 'token-sensitive-value',
      nested: {
        password: 'hunter2',
        message: 'token: private-session-token'
      },
      harmless: 'provider run completed'
    });

    expect(redacted).toEqual({
      apiKey: '[redacted]',
      authorizationToken: '[redacted]',
      nested: {
        password: '[redacted]',
        message: '[redacted]'
      },
      harmless: 'provider run completed'
    });
  });

  it('redacts embedded Windows paths from diagnostic strings and path arrays', () => {
    expect(safeDiagnosticStringOrNull('Wrote D:\\Projects\\secret-app\\src\\index.ts')).toBe(
      'Wrote [redacted-path]'
    );
    expect(safeDiagnosticPathArray(['src/index.ts', 'C:\\Users\\fixture-user\\secret.txt'])).toEqual([
      'src/index.ts',
      '[redacted-path]'
    ]);
  });

  it('removes unsafe worktree roots from runtime trace payloads while preserving safe review fields', () => {
    const sanitized = sanitizeDiagnosticsPayload({
      runtimeTrace: {
        stage: 'worktree_session_created',
        at: '2026-06-02T00:00:00.000Z',
        detail: {
          sourceWorkspaceRoot: 'D:\\Projects\\private',
          runtimeWorkspaceRoot: 'D:\\Projects\\private\\.vicode-worktree',
          harnessWorktreeSession: {
            sourceRepoRoot: 'D:\\Projects\\private',
            worktreeWorkspaceRoot: 'D:\\Projects\\private\\.vicode-worktree',
            branchName: 'vicode/worktree/project/run',
            sourceWorkspaceRelativePath: 'packages/app'
          }
        }
      }
    }, sanitizeRuntimeTraceDetail);

    expect(sanitized).toEqual({
      runtimeTrace: {
        stage: 'worktree_session_created',
        at: '2026-06-02T00:00:00.000Z',
        detail: {
          harnessWorktreeSession: {
            branchName: 'vicode/worktree/project/run',
            sourceWorkspaceRelativePath: 'packages/app'
          }
        }
      }
    });
  });

  it('strips raw staged patch content from diagnostics payloads', () => {
    const sanitized = sanitizeDiagnosticsPayload({
      stagedWorkspaceChangeSet: {
        operations: [
          {
            operation: 'write_file',
            path: 'src/app.ts',
            beforeContent: 'private old source',
            proposedAfterContent: 'private new source',
            patchText: '@@ private patch'
          }
        ]
      }
    }, sanitizeRuntimeTraceDetail);

    expect(sanitized).toEqual({
      stagedWorkspaceChangeSet: {
        operations: [
          {
            operation: 'write_file',
            path: 'src/app.ts'
          }
        ]
      }
    });
  });
});
