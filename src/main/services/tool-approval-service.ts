import { randomUUID } from 'node:crypto';
import type {
  ProjectRuntimeCommandPolicy,
  ProviderId,
  RunToolApprovalDecision,
  RunToolApprovalRequest,
  RunToolApprovalRequestInput
} from '../../shared/domain';
import type { AppEvent } from '../../shared/events';

interface PendingRunToolApproval {
  request: RunToolApprovalRequest;
  resolve: (decision: RunToolApprovalDecision) => void;
}

export interface ToolApprovalServiceHost {
  usesAppAuthoritativeToolApproval(providerId: ProviderId): boolean;
  getCurrentRuntimeCommandPolicyForThread(threadId: string, fallback: ProjectRuntimeCommandPolicy): ProjectRuntimeCommandPolicy;
  emit(event: AppEvent): void;
}

export interface ToolApprovalRequestOptions {
  appAuthoritative?: boolean;
}

export class ToolApprovalService {
  private readonly pending = new Map<string, PendingRunToolApproval>();

  constructor(private readonly host: ToolApprovalServiceHost) {}

  listPendingToolApprovals(): RunToolApprovalRequest[] {
    return Array.from(this.pending.values())
      .map((entry) => entry.request)
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
  }

  approveToolApproval(approvalId: string) {
    this.resolvePendingToolApproval(approvalId, 'approved');
  }

  rejectToolApproval(approvalId: string) {
    this.resolvePendingToolApproval(approvalId, 'rejected');
  }

  requestToolApproval(
    input: RunToolApprovalRequestInput,
    runtimeCommandPolicy: ProjectRuntimeCommandPolicy = 'approval_required',
    options: ToolApprovalRequestOptions = {}
  ) {
    const appAuthoritative =
      options.appAuthoritative ?? this.host.usesAppAuthoritativeToolApproval(input.providerId);
    if (!appAuthoritative) {
      return Promise.resolve<RunToolApprovalDecision>('approved');
    }

    const effectiveRuntimeCommandPolicy = this.host.getCurrentRuntimeCommandPolicyForThread(
      input.threadId,
      runtimeCommandPolicy
    );

    const requiresManualWorkspaceChangeApproval = input.approvalKind === 'workspace_change';

    if (!requiresManualWorkspaceChangeApproval && effectiveRuntimeCommandPolicy === 'auto_approve') {
      return Promise.resolve<RunToolApprovalDecision>('approved');
    }

    if (!requiresManualWorkspaceChangeApproval && effectiveRuntimeCommandPolicy === 'disabled') {
      return Promise.resolve<RunToolApprovalDecision>('rejected');
    }

    const approval: RunToolApprovalRequest = {
      ...input,
      id: randomUUID(),
      requestedAt: new Date().toISOString()
    };

    return new Promise<RunToolApprovalDecision>((resolve) => {
      this.pending.set(approval.id, {
        request: approval,
        resolve
      });
      this.host.emit({ type: 'run.approvalRequested', approval });
    });
  }

  clearPendingToolApprovals(runId?: string, decision: RunToolApprovalDecision = 'cancelled') {
    const approvalIds = Array.from(this.pending.entries())
      .filter(([, pending]) => !runId || pending.request.runId === runId)
      .map(([approvalId]) => approvalId);

    for (const approvalId of approvalIds) {
      const pending = this.pending.get(approvalId);
      if (!pending) {
        continue;
      }
      this.pending.delete(approvalId);
      pending.resolve(decision);
      this.host.emit({
        type: 'run.approvalResolved',
        approvalId,
        threadId: pending.request.threadId,
        runId: pending.request.runId,
        decision
      });
    }
  }

  clearPendingToolApprovalsForThread(threadId: string, decision: RunToolApprovalDecision) {
    const approvalIds = Array.from(this.pending.entries())
      .filter(([, pending]) => pending.request.threadId === threadId)
      .map(([approvalId]) => approvalId);

    for (const approvalId of approvalIds) {
      const pending = this.pending.get(approvalId);
      if (!pending) {
        continue;
      }
      this.pending.delete(approvalId);
      pending.resolve(decision);
      this.host.emit({
        type: 'run.approvalResolved',
        approvalId,
        threadId: pending.request.threadId,
        runId: pending.request.runId,
        decision
      });
    }
  }

  dispose() {
    this.clearPendingToolApprovals(undefined, 'cancelled');
  }

  private resolvePendingToolApproval(approvalId: string, decision: RunToolApprovalDecision) {
    const pending = this.pending.get(approvalId);
    if (!pending) {
      throw new Error(`Run approval not found: ${approvalId}`);
    }

    this.pending.delete(approvalId);
    pending.resolve(decision);
    this.host.emit({
      type: 'run.approvalResolved',
      approvalId,
      threadId: pending.request.threadId,
      runId: pending.request.runId,
      decision
    });
  }
}
