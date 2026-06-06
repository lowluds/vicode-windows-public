import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./ui', async () => {
  const actual = await vi.importActual<typeof import('./ui')>('./ui');
  return {
    ...actual,
    TooltipProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    Tooltip: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    TooltipTrigger: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    TooltipContent: ({ children, ...props }: React.ComponentPropsWithoutRef<'div'>) => React.createElement('div', props, children)
  };
});

import { ExecutionPermissionBar } from './ExecutionPermissionBar';
import { TooltipProvider } from './ui';

describe('ExecutionPermissionBar', () => {
  it('keeps context-window usage out of the composer permission controls', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(ExecutionPermissionBar, {
          providerId: 'openai',
          executionPermission: 'default',
          onSelectPermission: vi.fn()
        })
      )
    );

    expect(html).not.toContain('composer-context-window-trigger');
    expect(html).not.toContain('tokens used');
    expect(html).not.toContain('Context window');
  });

  it('renders the selected workspace edit isolation mode', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(ExecutionPermissionBar, {
          providerId: 'openai',
          executionPermission: 'default',
          isolationMode: 'patch_buffer',
          onSelectPermission: vi.fn(),
          onSelectIsolationMode: vi.fn()
        })
      )
    );

    expect(html).toContain('Proposed changes');
    expect(html).toContain('Stages changes for review before applying them');
  });

  it('renders git worktree isolation with concise user-facing copy', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(ExecutionPermissionBar, {
          providerId: 'openai',
          executionPermission: 'full_access',
          runtimeCommandPolicy: 'auto_approve',
          isolationMode: 'git_worktree',
          onSelectPermission: vi.fn(),
          onSelectIsolationMode: vi.fn()
        })
      )
    );

    expect(html).toContain('Isolated worktree');
    expect(html).toContain('Uses an app-owned Git worktree for file edits');
    expect(html).not.toContain('Approved commands start in the workspace');
    expect(html).not.toContain('not sandboxed or contained');
  });

  it('keeps the full access tooltip short', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(ExecutionPermissionBar, {
          providerId: 'openai',
          executionPermission: 'full_access',
          runtimeCommandPolicy: 'auto_approve',
          onSelectPermission: vi.fn()
        })
      )
    );

    expect(html).toContain('Writes directly to this project. Commands follow project approval.');
    expect(html).not.toContain('Vicode owns approvals');
    expect(html).not.toContain('sandbox isolation');
  });

  it('does not render hover tooltips inside the workspace permission menu', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(ExecutionPermissionBar, {
          providerId: 'openai',
          executionPermission: 'full_access',
          runtimeCommandPolicy: 'auto_approve',
          isolationMode: 'direct_workspace',
          onSelectPermission: vi.fn(),
          onSelectIsolationMode: vi.fn()
        })
      )
    );

    expect(html).toContain('side="top"');
    expect(html).not.toContain('side="right"');
    expect(html).not.toContain('side="left"');
    expect(html).not.toContain('<div side="top" class="composer-status-tooltip max-w-[260px]"');
  });

  it('describes default permissions as blocking local shell commands', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(ExecutionPermissionBar, {
          providerId: 'openai',
          executionPermission: 'default',
          onSelectPermission: vi.fn()
        })
      )
    );

    expect(html).toContain('Writes directly to this project. Shell commands stay off.');
  });

  it('labels full command permission as Full access in the composer chip', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(ExecutionPermissionBar, {
          providerId: 'openai',
          executionPermission: 'full_access',
          onSelectPermission: vi.fn()
        })
      )
    );

    expect(html).toContain('Workspace mode: Full access');
    expect(html).not.toContain('Direct edits + shell access');
  });
});
