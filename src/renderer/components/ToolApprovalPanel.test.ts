import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RunToolApprovalRequest } from '../../shared/domain';
import { ToolApprovalPanel } from './ToolApprovalPanel';
import { TooltipProvider } from './ui';

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

const workspaceChangeApproval: RunToolApprovalRequest = {
  id: 'approval-2',
  threadId: 'thread-1',
  runId: 'run-1',
  providerId: 'ollama',
  toolName: 'apply_patch',
  command: 'apply_patch src/example.ts',
  cwd: null,
  workspaceRoot: 'D:\\Projects\\vicode-project\\main\\vicode-windows',
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
      files: [
        {
          path: 'src/example.ts',
          status: 'modified',
          insertions: 1,
          deletions: 1,
          beforeContent: 'export const value = 1;\n',
          afterContent: 'export const value = 2;\n',
          previewLines: [
            {
              type: 'removed',
              oldLineNumber: 1,
              newLineNumber: null,
              text: 'export const value = 1;'
            },
            {
              type: 'added',
              oldLineNumber: null,
              newLineNumber: 1,
              text: 'export const value = 2;'
            }
          ],
          previewTruncated: false
        }
      ]
    }
  },
  requestedAt: '2026-04-17T18:01:00.000Z'
};

describe('ToolApprovalPanel', () => {
  it('renders the confirmation request with tool details and actions', () => {
    const markup = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
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
      )
    );

    expect(markup).toContain('Vicode paused a command');
    expect(markup).toContain('Approve command');
    expect(markup).toContain('Deny');
    expect(markup).toContain('Awaiting approval');
    expect(markup).toContain('npm run build');
    expect(markup).toContain('Shell command');
    expect(markup).toContain('Workspace root');
    expect(markup).toContain('More approval actions');
    expect(markup).not.toContain('exec_command');
    expect(markup).not.toContain('run_command');
  });

  it('hides the extra approval menu when the workspace already auto-approves', () => {
    const markup = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
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
      )
    );

    expect(markup).not.toContain('More approval actions');
  });

  it('renders file change approval with diff summary and no auto-approve menu', () => {
    const markup = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(ToolApprovalPanel, {
          approval: workspaceChangeApproval,
          providerLabel: 'Ollama',
          runtimeCommandPolicy: 'auto_approve',
          runtimeNetworkPolicy: 'disabled',
          resolving: false,
          onApprove: vi.fn(),
          onAutoApprove: vi.fn(),
          onReject: vi.fn()
        })
      )
    );

    expect(markup).toContain('File change approval');
    expect(markup).toContain('Vicode paused a file change');
    expect(markup).toContain('Review the diff before continuing');
    expect(markup).toContain('Approve change');
    expect(markup).toContain('src/example.ts');
    expect(markup).toContain('1 files, +1 -1');
    expect(markup).toContain('+export const value = 2;');
    expect(markup).toContain('-export const value = 1;');
    expect(markup).not.toContain('More approval actions');
  });
});
