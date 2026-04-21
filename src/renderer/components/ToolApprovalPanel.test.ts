import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RunToolApprovalRequest } from '../../shared/domain';
import { ToolApprovalPanel } from './ToolApprovalPanel';

const approval: RunToolApprovalRequest = {
  id: 'approval-1',
  threadId: 'thread-1',
  runId: 'run-1',
  providerId: 'openai',
  toolName: 'exec_command',
  command: 'npm run build',
  cwd: '.',
  workspaceRoot: 'D:\\Projects\\vicode-project\\main\\vicode-windows',
  requestedAt: '2026-04-17T18:00:00.000Z'
};

describe('ToolApprovalPanel', () => {
  it('renders the confirmation request with tool details and actions', () => {
    const markup = renderToStaticMarkup(
      createElement(ToolApprovalPanel, {
        approval,
        providerLabel: 'OpenAI',
        runtimeCommandPolicy: 'approval_required',
        runtimeNetworkPolicy: 'disabled',
        resolving: false,
        onApprove: vi.fn(),
        onAutoApprove: vi.fn(),
        onReject: vi.fn()
      })
    );

    expect(markup).toContain('Vicode paused a command');
    expect(markup).toContain('Approve command');
    expect(markup).toContain('Deny');
    expect(markup).toContain('Awaiting Approval');
    expect(markup).toContain('npm run build');
    expect(markup).toContain('Workspace root');
    expect(markup).toContain('More');
  });

  it('hides the extra approval menu when the workspace already auto-approves', () => {
    const markup = renderToStaticMarkup(
      createElement(ToolApprovalPanel, {
        approval,
        providerLabel: 'OpenAI',
        runtimeCommandPolicy: 'auto_approve',
        runtimeNetworkPolicy: 'disabled',
        resolving: false,
        onApprove: vi.fn(),
        onAutoApprove: vi.fn(),
        onReject: vi.fn()
      })
    );

    expect(markup).not.toContain('More');
  });
});
