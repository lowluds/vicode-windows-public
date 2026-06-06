import { describe, expect, it } from 'vitest';
import { ToolApprovalService } from './tool-approval-service';

function createService() {
  const events: unknown[] = [];
  const service = new ToolApprovalService({
    usesAppAuthoritativeToolApproval: (providerId) => providerId === 'ollama',
    getCurrentRuntimeCommandPolicyForThread: (threadId, fallback) =>
      threadId === 'auto-approve-thread' ? 'auto_approve' : fallback,
    emit: (event) => events.push(event)
  });
  return { service, events };
}

describe('ToolApprovalService', () => {
  it('auto-approves non-app-authoritative legacy provider requests by default', async () => {
    const { service, events } = createService();

    await expect(
      service.requestToolApproval({
        threadId: 'thread-1',
        runId: 'run-1',
        providerId: 'openai',
        toolName: 'run_command',
        command: 'npm test',
        cwd: null,
        workspaceRoot: 'C:\\workspace'
      })
    ).resolves.toBe('approved');

    expect(events).toEqual([]);
  });

  it('can force app-authoritative approval for a normalized API-key provider lane', async () => {
    const { service, events } = createService();

    const approvalPromise = service.requestToolApproval(
      {
        threadId: 'thread-1',
        runId: 'run-1',
        providerId: 'openai',
        toolName: 'run_command',
        command: 'npm test',
        cwd: null,
        workspaceRoot: 'C:\\workspace'
      },
      'approval_required',
      {
        appAuthoritative: true
      }
    );

    expect(service.listPendingToolApprovals()).toHaveLength(1);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'run.approvalRequested'
      })
    ]);

    const approvalId = service.listPendingToolApprovals()[0]!.id;
    service.approveToolApproval(approvalId);
    await expect(approvalPromise).resolves.toBe('approved');
  });

  it('keeps workspace change approvals manual even when command policy auto-approves commands', async () => {
    const { service, events } = createService();

    const approvalPromise = service.requestToolApproval({
      threadId: 'auto-approve-thread',
      runId: 'run-1',
      providerId: 'ollama',
      toolName: 'apply_patch',
      command: 'apply_patch src/example.ts',
      cwd: null,
      workspaceRoot: 'C:\\workspace',
      approvalKind: 'workspace_change',
      workspaceChange: {
        sourceToolName: 'apply_patch',
        changedPaths: ['src/example.ts'],
        operationKinds: ['apply_patch'],
        summary: {
          filesChanged: 1,
          insertions: 1,
          deletions: 1
        },
        preview: {
          source: 'staged_workspace_preview',
          summary: {
            filesChanged: 1,
            insertions: 1,
            deletions: 1
          },
          files: []
        }
      }
    });

    expect(service.listPendingToolApprovals()).toHaveLength(1);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'run.approvalRequested',
        approval: expect.objectContaining({
          toolName: 'apply_patch',
          approvalKind: 'workspace_change'
        })
      })
    ]);

    const approvalId = service.listPendingToolApprovals()[0]!.id;
    service.rejectToolApproval(approvalId);
    await expect(approvalPromise).resolves.toBe('rejected');
  });
});
