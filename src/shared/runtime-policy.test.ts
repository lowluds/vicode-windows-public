import { describe, expect, it } from 'vitest';
import {
  classifyRuntimeCommandPathAccess,
  classifyRuntimeCommandLaunch,
  classifyRuntimeCommandNetworkAccess,
  deriveRuntimePolicy,
  evaluateRuntimeCommandAccess,
  evaluateRuntimeCommandExecution,
  evaluateRuntimeNetworkAccess
} from './runtime-policy';

describe('runtime policy', () => {
  it('keeps default permissions on workspace file tools plus native web research', () => {
    const policy = deriveRuntimePolicy('default');

    expect(policy.commandAccess).toBe('blocked');
    expect(policy.networkAccess).toBe('web_tools');
    expect(policy.defaultToolLabels).toEqual([
      'List directories',
      'Read files',
      'Search text',
      'Create folders',
      'Write files',
      'Apply patches'
    ]);
    expect(policy.elevatedToolLabels).toEqual(['Run shell commands']);
    expect(policy.modelInstruction).toContain(
      'Shell commands are unavailable in this run.'
    );
    expect(policy.modelInstruction).toContain('use app-owned web research tools');
    expect(policy.commandDeniedMessage).toContain('requires Full access');
  });

  it('allows app-owned web research under default permissions when workspace network access is enabled', () => {
    const policy = deriveRuntimePolicy('default', 'approval_required', 'enabled');

    expect(policy.commandAccess).toBe('blocked');
    expect(policy.networkAccess).toBe('web_tools');
    expect(policy.networkSummary).toContain('web research tools can reach the public web');
    expect(policy.modelInstruction).toContain('use app-owned web research tools');
  });

  it('describes full access as approval-gated host-local shell execution', () => {
    const policy = deriveRuntimePolicy('full_access', 'approval_required', 'enabled');

    expect(policy.commandAccess).toBe('approval_required');
    expect(policy.networkAccess).toBe('host_local');
    expect(policy.commandSummary).toContain('isolated temp home/appdata directories');
    expect(policy.commandSummary).toContain('not sandboxed');
    expect(policy.networkSummary).toContain('does not isolate that network activity');
    expect(policy.modelInstruction).toContain('requires user approval every time');
    expect(policy.commandDeniedMessage).toBeNull();
  });

  it('can auto-approve local shell execution under full access', () => {
    const policy = deriveRuntimePolicy('full_access', 'auto_approve', 'enabled');

    expect(policy.commandAccess).toBe('auto_approve');
    expect(policy.networkAccess).toBe('host_local');
    expect(policy.commandSummary).toContain('isolated temp home/appdata directories');
    expect(policy.modelInstruction).toContain('without asking for approval');
    expect(policy.commandDeniedMessage).toBeNull();
  });

  it('blocks host network by default even when full access is enabled', () => {
    const policy = deriveRuntimePolicy('full_access');

    expect(policy.commandAccess).toBe('approval_required');
    expect(policy.networkAccess).toBe('web_tools');
    expect(policy.networkSummary).toContain('network-oriented shell commands stay blocked');
  });

  it('can disable shell commands at the workspace policy layer', () => {
    const policy = deriveRuntimePolicy('full_access', 'disabled');

    expect(policy.commandAccess).toBe('blocked');
    expect(policy.networkAccess).toBe('web_tools');
    expect(policy.commandSummary).toContain('workspace runtime policy');
    expect(policy.commandDeniedMessage).toContain(
      'disabled for this workspace'
    );
  });

  it('exposes a typed runtime command access evaluation', () => {
    const blocked = evaluateRuntimeCommandAccess('default');
    expect(blocked).toEqual(
      expect.objectContaining({
        access: 'blocked',
        requiresApproval: false,
        deniedReason: expect.stringContaining('requires Full access'),
        networkAccess: 'web_tools'
      })
    );

    const approvalRequired = evaluateRuntimeCommandAccess('full_access');
    expect(approvalRequired).toEqual(
      expect.objectContaining({
        access: 'approval_required',
        requiresApproval: true,
        deniedReason: null,
        networkAccess: 'web_tools'
      })
    );

    const autoApprove = evaluateRuntimeCommandAccess(
      'full_access',
      'auto_approve',
      'enabled'
    );
    expect(autoApprove).toEqual(
      expect.objectContaining({
        access: 'auto_approve',
        requiresApproval: false,
        deniedReason: null,
        networkAccess: 'host_local'
      })
    );
  });

  it('exposes a typed runtime network access evaluation', () => {
    expect(evaluateRuntimeNetworkAccess('full_access')).toEqual(
      expect.objectContaining({
        access: 'web_tools',
        deniedReason: null
      })
    );
    expect(
      evaluateRuntimeNetworkAccess(
        'default',
        'approval_required',
        'enabled'
      )
    ).toEqual(
      expect.objectContaining({
        access: 'web_tools',
        deniedReason: null
      })
    );
    expect(
      evaluateRuntimeNetworkAccess(
        'full_access',
        'approval_required',
        'enabled'
      )
    ).toEqual(
      expect.objectContaining({
        access: 'host_local',
        deniedReason: null
      })
    );
  });

  it('classifies clearly network-oriented commands conservatively', () => {
    expect(
      classifyRuntimeCommandNetworkAccess('curl https://example.com')
    ).toEqual({
      requiresHostNetwork: true,
      matchedPattern: 'curl'
    });
    expect(
      classifyRuntimeCommandNetworkAccess('git status')
    ).toEqual({
      requiresHostNetwork: false,
      matchedPattern: null
    });
  });

  it('classifies nested shells and inline interpreters before spawn', () => {
    expect(
      classifyRuntimeCommandLaunch('powershell -NoProfile -Command "dir"')
    ).toEqual({
      executable: 'powershell',
      family: 'nested_shell',
      matchedToken: 'powershell'
    });
    expect(
      classifyRuntimeCommandLaunch('node -e "console.log(1)"')
    ).toEqual({
      executable: 'node',
      family: 'inline_interpreter',
      matchedToken: 'node -e'
    });
    expect(classifyRuntimeCommandLaunch('git status')).toEqual({
      executable: 'git',
      family: 'standard',
      matchedToken: 'git'
    });
  });

  it('blocks obvious path references that resolve outside the workspace', () => {
    const workspaceRoot = 'C:\\repo';

    expect(
      classifyRuntimeCommandPathAccess(
        'type C:\\Users\\test-user\\secret.txt',
        workspaceRoot,
        workspaceRoot
      )
    ).toEqual({
      access: 'blocked_outside_workspace_absolute_path',
      matchedToken: 'C:\\Users\\test-user\\secret.txt',
      resolvedPath: 'C:\\Users\\test-user\\secret.txt'
    });

    expect(
      classifyRuntimeCommandPathAccess(
        'copy .\\file.txt ..\\..\\outside.txt',
        'C:\\repo\\nested',
        workspaceRoot
      )
    ).toEqual({
      access: 'blocked_outside_workspace_relative_path',
      matchedToken: '..\\..\\outside.txt',
      resolvedPath: 'C:\\outside.txt'
    });
  });

  it('allows workspace-relative and URL-bearing commands through the path classifier', () => {
    const workspaceRoot = 'C:\\repo';

    expect(
      classifyRuntimeCommandPathAccess(
        'type .\\src\\app.ts',
        workspaceRoot,
        workspaceRoot
      )
    ).toEqual({
      access: 'allowed',
      matchedToken: null,
      resolvedPath: null
    });

    expect(
      classifyRuntimeCommandPathAccess(
        'curl https://example.com',
        workspaceRoot,
        workspaceRoot
      )
    ).toEqual({
      access: 'allowed',
      matchedToken: null,
      resolvedPath: null
    });

    expect(
      classifyRuntimeCommandPathAccess(
        'copy /y .\\src\\app.ts .\\backup\\app.ts',
        workspaceRoot,
        workspaceRoot
      )
    ).toEqual({
      access: 'allowed',
      matchedToken: null,
      resolvedPath: null
    });

    expect(
      classifyRuntimeCommandPathAccess(
        'findstr /s /i needle src\\*.ts',
        workspaceRoot,
        workspaceRoot
      )
    ).toEqual({
      access: 'allowed',
      matchedToken: null,
      resolvedPath: null
    });
  });

  it('treats file URLs and redirection targets as filesystem-relevant path tokens', () => {
    const workspaceRoot = 'C:\\repo';

    expect(
      classifyRuntimeCommandPathAccess(
        'type file:///C:/Users/test-user/secret.txt',
        workspaceRoot,
        workspaceRoot
      )
    ).toEqual({
      access: 'blocked_outside_workspace_absolute_path',
      matchedToken: 'file:///C:/Users/test-user/secret.txt',
      resolvedPath: 'C:\\Users\\test-user\\secret.txt'
    });

    expect(
      classifyRuntimeCommandPathAccess(
        'echo hi > ..\\..\\out.txt',
        'C:\\repo\\nested',
        workspaceRoot
      )
    ).toEqual({
      access: 'blocked_outside_workspace_relative_path',
      matchedToken: '..\\..\\out.txt',
      resolvedPath: 'C:\\out.txt'
    });

    expect(
      classifyRuntimeCommandPathAccess(
        'echo hi>..\\..\\attached.txt',
        'C:\\repo\\nested',
        workspaceRoot
      )
    ).toEqual({
      access: 'blocked_outside_workspace_relative_path',
      matchedToken: 'hi>..\\..\\attached.txt',
      resolvedPath: 'C:\\attached.txt'
    });
  });

  it('evaluates blocked launcher families before command execution', () => {
    expect(
      evaluateRuntimeCommandExecution(
        'full_access',
        'powershell -NoProfile -Command "dir"'
      )
    ).toEqual(
      expect.objectContaining({
        deniedReason: expect.stringContaining('Nested shell launchers'),
        launchDeniedReason: expect.stringContaining('Nested shell launchers')
      })
    );

    expect(
      evaluateRuntimeCommandExecution(
        'full_access',
        'python -c "print(1)"',
        'approval_required',
        'enabled'
      )
    ).toEqual(
      expect.objectContaining({
        deniedReason: expect.stringContaining('Inline interpreter commands'),
        launchDeniedReason: expect.stringContaining('Inline interpreter commands')
      })
    );
  });

  it('evaluates path access before command execution when workspace context is available', () => {
    expect(
      evaluateRuntimeCommandExecution(
        'full_access',
        'type C:\\Users\\test-user\\secret.txt',
        'approval_required',
        'enabled',
        {
          workspaceRoot: 'C:\\repo',
          cwdPath: 'C:\\repo'
        }
      )
    ).toEqual(
      expect.objectContaining({
        deniedReason: expect.stringContaining('absolute path outside the workspace'),
        pathDeniedReason: expect.stringContaining('absolute path outside the workspace')
      })
    );
  });
});
