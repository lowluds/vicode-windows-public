import { describe, expect, it, vi } from 'vitest';
import { ProviderRuntimeToolService } from './provider-runtime-tool-service';

describe('ProviderRuntimeToolService', () => {
  it('passes app approval into runtime tool execution when the normalized lane requires it', async () => {
    const requestToolApproval = vi.fn(async () => 'approved' as const);
    const executeToolCall = vi.fn(async (_call, context) => {
      const decision = await context.requestApproval?.({
        toolName: 'run_command',
        command: 'npm test',
        cwd: null,
        workspaceRoot: 'C:\\workspace'
      });
      return {
        toolName: 'run_command',
        content: `decision:${decision}`
      };
    });
    const service = new ProviderRuntimeToolService({
      agentRuntime: {
        executeToolCall
      } as never,
      projectPolicy: {
        getRuntimeCommandPolicyForThread: (_threadId: string, fallback: string) => fallback
      } as never,
      requestToolApproval
    });

    const result = await service.executeProviderRuntimeToolCall({
      call: {
        name: 'run_command',
        arguments: {
          command: 'npm test'
        }
      },
      workspaceRoot: 'C:\\workspace',
      trustedWorkspace: true,
      threadId: 'thread-1',
      runId: 'run-1',
      providerId: 'openai',
      appAuthoritativeToolApproval: true,
      executionPermission: 'full_access',
      runtimeCommandPolicy: 'approval_required',
      runtimeNetworkPolicy: 'enabled',
      onInfo: vi.fn()
    });

    expect(result.content).toBe('decision:approved');
    expect(requestToolApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai',
        toolName: 'run_command'
      }),
      'approval_required',
      {
        appAuthoritative: true
      }
    );
  });
});
