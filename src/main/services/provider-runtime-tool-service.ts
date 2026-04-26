import type { AgentToolCall, AgentToolExecutionResult } from '../../providers/agent-runtime';
import type {
  AgentExecutionConstraints,
  ExecutionPermission,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy,
  ProviderId,
  RunActivityInfo
} from '../../shared/domain';
import { providerCapabilities } from '../../shared/providers';
import type { AgentRuntimeService } from './agent-runtime';
import type { ProjectPolicyService } from './project-policy-service';

export interface ProviderRuntimeToolServiceHost {
  agentRuntime: AgentRuntimeService;
  projectPolicy: ProjectPolicyService;
  requestToolApproval(
    input: {
      threadId: string;
      runId: string;
      providerId: ProviderId;
      toolName: string;
      command: string;
      cwd: string | null;
      workspaceRoot: string;
    },
    runtimeCommandPolicy: ProjectRuntimeCommandPolicy
  ): Promise<'approved' | 'rejected' | 'cancelled'>;
}

export class ProviderRuntimeToolService {
  constructor(private readonly host: ProviderRuntimeToolServiceHost) {}

  usesAppAuthoritativeToolApproval(providerId: ProviderId) {
    return providerCapabilities(providerId).approvalAuthority === 'app';
  }

  getCurrentRuntimeCommandPolicyForThread(
    threadId: string,
    fallback: ProjectRuntimeCommandPolicy
  ) {
    return this.host.projectPolicy.getRuntimeCommandPolicyForThread(threadId, fallback);
  }

  async executeProviderRuntimeToolCall(input: {
    call: AgentToolCall;
    workspaceRoot: string;
    trustedWorkspace: boolean;
    threadId: string;
    runId: string;
    providerId: ProviderId;
    executionPermission: ExecutionPermission;
    executionConstraints?: AgentExecutionConstraints | null;
    runtimeCommandPolicy: ProjectRuntimeCommandPolicy;
    runtimeNetworkPolicy: ProjectRuntimeNetworkPolicy;
    onInfo: (payload: {
      message?: string | null;
      activity?: RunActivityInfo | null;
    }) => void;
  }): Promise<AgentToolExecutionResult> {
    return this.host.agentRuntime.executeToolCall(input.call, {
      workspaceRoot: input.workspaceRoot,
      trustedWorkspace: input.trustedWorkspace,
      threadId: input.threadId,
      runId: input.runId,
      executionPermission: input.executionPermission,
      executionConstraints: input.executionConstraints ?? null,
      runtimeCommandPolicy: input.runtimeCommandPolicy,
      runtimeNetworkPolicy: input.runtimeNetworkPolicy,
      onInfo: input.onInfo,
      requestApproval: this.usesAppAuthoritativeToolApproval(input.providerId)
        ? (request) =>
            this.host.requestToolApproval(
              {
                threadId: input.threadId,
                runId: input.runId,
                providerId: input.providerId,
                ...request
              },
              input.runtimeCommandPolicy
            )
        : undefined
    });
  }
}
