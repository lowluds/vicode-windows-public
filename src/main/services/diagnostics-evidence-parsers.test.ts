import { describe, expect, it } from 'vitest';
import {
  parseStagedWorkspaceHunkReviewDecision,
  parseStagedWorkspaceReviewDecisionForBundle,
  parseVerificationArtifact,
  parseWorktreeReviewDecision
} from './diagnostics-evidence-parsers';

describe('diagnostics evidence parsers', () => {
  it('extracts verification artifacts from event payloads', () => {
    expect(parseVerificationArtifact({
      verificationArtifact: {
        command: 'npm test',
        status: 'passed'
      }
    })).toEqual({
      command: 'npm test',
      status: 'passed'
    });
    expect(parseVerificationArtifact({ verificationArtifact: null })).toBeNull();
  });

  it('parses staged workspace hunk review decisions with computed counts', () => {
    expect(parseStagedWorkspaceHunkReviewDecision({
      stagedWorkspaceHunkReviewDecision: {
        action: 'applied',
        status: 'applied',
        source: 'staged_workspace_preview',
        isolationMode: 'patch_buffer',
        stagedEventId: 'event-1',
        stagedEventIndex: 2,
        changedPaths: ['src/app.ts', 'D:\\Projects\\private\\secret.ts'],
        hunkIds: ['h1', 'h2'],
        acceptedHunkIds: ['h1'],
        rejectedHunkIds: ['h2'],
        filesChanged: 1,
        insertions: 3,
        deletions: 1
      }
    })).toEqual({
      action: 'applied',
      status: 'applied',
      source: 'staged_workspace_preview',
      isolationMode: 'patch_buffer',
      stagedEventId: 'event-1',
      stagedEventIndex: 2,
      changedPaths: ['src/app.ts', '[redacted-path]'],
      hunkIds: ['h1', 'h2'],
      acceptedHunkIds: ['h1'],
      rejectedHunkIds: ['h2'],
      hunkCount: 2,
      acceptedHunkCount: 1,
      rejectedHunkCount: 1,
      filesChanged: 1,
      insertions: 3,
      deletions: 1,
      errorReason: null
    });
  });

  it('rejects malformed worktree review decisions', () => {
    expect(parseWorktreeReviewDecision({
      worktreeReviewDecision: {
        action: 'applied',
        status: 'applied',
        isolationMode: 'direct_workspace'
      }
    })).toBeNull();
  });

  it('parses staged review decisions for evidence bundles', () => {
    expect(parseStagedWorkspaceReviewDecisionForBundle({
      action: 'rejected',
      status: 'failed',
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-1',
      stagedEventIndex: 0,
      sourceToolName: 'write_file',
      isolationMode: 'patch_buffer',
      changedPaths: ['src/app.ts'],
      operationKinds: ['write_file', 'delete', 'unknown'],
      errorReason: 'patch failed at D:\\Projects\\private\\src\\app.ts',
      createdAt: '2026-06-02T00:00:00.000Z'
    })).toEqual({
      action: 'rejected',
      status: 'failed',
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-1',
      stagedEventIndex: 0,
      sourceToolName: 'write_file',
      isolationMode: 'patch_buffer',
      changedPaths: ['src/app.ts'],
      operationKinds: ['write_file', 'delete'],
      errorReason: 'patch failed at [redacted-path]',
      createdAt: '2026-06-02T00:00:00.000Z'
    });
  });
});
