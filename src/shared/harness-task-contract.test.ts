import { describe, expect, it } from 'vitest';
import { deriveHarnessTaskContract } from './harness-task-contract';

describe('deriveHarnessTaskContract', () => {
  it('classifies direct coding prompts as workspace-write edit tasks requiring verification', () => {
    expect(
      deriveHarnessTaskContract({
        prompt: 'Add a typed helper in src/shared and run the focused unit test.',
        mode: 'default',
        workspaceRoot: 'D:\\Projects\\vicode-windows',
        allowedPaths: ['src/shared'],
        deniedPaths: ['release']
      })
    ).toMatchObject({
      taskKind: 'edit',
      conversationPhase: 'ready_to_task',
      taskIntentSource: 'prompt',
      objective: 'Add a typed helper in src/shared and run the focused unit test.',
      workspaceRoot: 'D:\\Projects\\vicode-windows',
      allowedPaths: ['src/shared'],
      deniedPaths: ['release'],
      expectedMutations: 'workspace_write',
      verificationPolicy: 'required',
      isolationMode: 'direct_workspace',
      riskLevel: 'medium'
    });
  });

  it('keeps plan-mode prompts non-mutating even when they mention files', () => {
    expect(
      deriveHarnessTaskContract({
        prompt: 'Plan the next slice for editing provider files.',
        mode: 'plan',
        workspaceRoot: null
      })
    ).toMatchObject({
      taskKind: 'plan',
      conversationPhase: 'task_plan',
      taskIntentSource: 'composer_plan_mode',
      expectedMutations: 'none',
      verificationPolicy: 'none',
      riskLevel: 'low'
    });
  });

  it('deduplicates and sorts path constraints for stable contracts', () => {
    const contract = deriveHarnessTaskContract({
      prompt: 'Review the harness.',
      mode: 'default',
      workspaceRoot: null,
      allowedPaths: ['src/main', 'src/shared', 'src/main'],
      deniedPaths: ['release', 'out', 'release']
    });

    expect(contract.allowedPaths).toEqual(['src/main', 'src/shared']);
    expect(contract.deniedPaths).toEqual(['out', 'release']);
  });

  it('keeps brainstorming and open-ended discussion in the chat phase', () => {
    expect(
      deriveHarnessTaskContract({
        prompt: 'Let us brainstorm the right architecture for addon generation before deciding what to build.'
      })
    ).toMatchObject({
      taskKind: 'ask',
      conversationPhase: 'chat',
      taskIntentSource: 'prompt',
      expectedMutations: 'none',
      verificationPolicy: 'none',
      riskLevel: 'low'
    });
  });

  it('does not treat non-mutating chat constraints as edit intent', () => {
    expect(
      deriveHarnessTaskContract({
        prompt: 'Let us brainstorm a tiny calculator app. Reply in two short sentences and keep this as discussion only; do not edit files.'
      })
    ).toMatchObject({
      taskKind: 'ask',
      conversationPhase: 'chat',
      expectedMutations: 'none',
      verificationPolicy: 'none',
      riskLevel: 'low'
    });

    expect(
      deriveHarnessTaskContract({
        prompt: 'What should the first version include? Keep this as chat only with no file changes.'
      })
    ).toMatchObject({
      taskKind: 'ask',
      conversationPhase: 'chat',
      expectedMutations: 'none',
      verificationPolicy: 'none'
    });

    expect(
      deriveHarnessTaskContract({
        prompt: 'Let us plan a tiny calculator app. Keep this chat-only.'
      })
    ).toMatchObject({
      taskKind: 'ask',
      conversationPhase: 'chat',
      expectedMutations: 'none',
      verificationPolicy: 'none'
    });
  });

  it('captures runtime permission and policy inputs without enforcing them', () => {
    expect(
      deriveHarnessTaskContract({
        prompt: 'Run the focused test for the harness contract.',
        executionPermission: 'full_access',
        runtimeCommandPolicy: 'auto_approve',
        runtimeNetworkPolicy: 'enabled',
        trustedWorkspace: true
      })
    ).toMatchObject({
      taskKind: 'verify',
      expectedMutations: 'none',
      verificationPolicy: 'required',
      executionPermission: 'full_access',
      runtimeCommandPolicy: 'auto_approve',
      runtimeNetworkPolicy: 'enabled',
      trustedWorkspace: true,
      commandAccess: 'auto_approve',
      networkAccess: 'host_local',
      riskLevel: 'high'
    });
  });

  it('marks untrusted edit tasks as high risk while preserving the requested mutation shape', () => {
    expect(
      deriveHarnessTaskContract({
        prompt: 'Edit src/shared/harness-task-contract.ts.',
        executionPermission: 'default',
        trustedWorkspace: false
      })
    ).toMatchObject({
      taskKind: 'edit',
      expectedMutations: 'workspace_write',
      verificationPolicy: 'required',
      trustedWorkspace: false,
      commandAccess: 'blocked',
      networkAccess: 'web_tools',
      riskLevel: 'high'
    });
  });

  it('records restricted command policy for edit tasks without changing task intent', () => {
    expect(
      deriveHarnessTaskContract({
        prompt: 'Update the helper and run npm test.',
        executionPermission: 'full_access',
        runtimeCommandPolicy: 'disabled',
        runtimeNetworkPolicy: 'disabled',
        trustedWorkspace: true
      })
    ).toMatchObject({
      taskKind: 'edit',
      expectedMutations: 'workspace_write',
      verificationPolicy: 'required',
      executionPermission: 'full_access',
      runtimeCommandPolicy: 'disabled',
      runtimeNetworkPolicy: 'disabled',
      commandAccess: 'blocked',
      networkAccess: 'web_tools',
      riskLevel: 'medium'
    });
  });

  it('keeps direct workspace as the default isolation mode', () => {
    const contract = deriveHarnessTaskContract({
      prompt: 'Update the helper.',
      mode: 'default'
    });

    expect(contract).toMatchObject({
      taskKind: 'edit',
      expectedMutations: 'workspace_write',
      isolationMode: 'direct_workspace'
    });
  });

  it('derives explicit patch-buffer edit tasks as patch proposals', () => {
    const contract = deriveHarnessTaskContract({
      prompt: 'Update the helper.',
      mode: 'default',
      isolationMode: 'patch_buffer'
    });

    expect(contract).toMatchObject({
      taskKind: 'edit',
      expectedMutations: 'patch_proposal',
      verificationPolicy: 'required',
      isolationMode: 'patch_buffer'
    });
  });

  it('derives explicit git worktree edit tasks as workspace writes inside the worktree', () => {
    const contract = deriveHarnessTaskContract({
      prompt: 'Update the helper.',
      mode: 'default',
      isolationMode: 'git_worktree',
      workspaceRoot: 'C:\\Vicode\\worktrees\\project-1\\run-1'
    });

    expect(contract).toMatchObject({
      taskKind: 'edit',
      expectedMutations: 'workspace_write',
      verificationPolicy: 'required',
      isolationMode: 'git_worktree',
      workspaceRoot: 'C:\\Vicode\\worktrees\\project-1\\run-1'
    });
  });
});
