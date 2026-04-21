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
  it('renders the auto-compact stat when the active context lane exposes one', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(ExecutionPermissionBar, {
          providerId: 'openai',
          executionPermission: 'default',
          contextWindow: {
            maxTokens: 1_000_000,
            autoCompactTokenLimit: 750_000,
            usedTokens: 760_000,
            usagePercent: 76,
            title: 'Context window',
            pressureLabel: 'Context pressure building',
            note: 'Codex compacts automatically, but this thread is nearing the point where long follow-ups can lose detail.',
            sourceLabel: 'Provider-reported usage from Codex',
            source: 'provider',
            severity: 'warning'
          },
          onSelectPermission: vi.fn()
        })
      )
    );

    expect(html).toContain('composer-context-window-trigger');
    expect(html).toContain('Auto-compact at');
    expect(html).toContain('750k');
    expect(html).toContain('760k / 1M tokens used');
  });

  it('omits the auto-compact stat when the current model has no explicit threshold', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(ExecutionPermissionBar, {
          providerId: 'openai',
          executionPermission: 'default',
          contextWindow: {
            maxTokens: 400_000,
            autoCompactTokenLimit: null,
            usedTokens: 240_000,
            usagePercent: 60,
            title: 'Context window',
            pressureLabel: 'Healthy headroom',
            note: 'Codex usage is flowing back into the app, and the current thread still has comfortable room.',
            sourceLabel: 'Provider-reported usage from Codex',
            source: 'provider',
            severity: 'normal'
          },
          onSelectPermission: vi.fn()
        })
      )
    );

    expect(html).toContain('composer-context-window-trigger');
    expect(html).not.toContain('Auto-compact at');
    expect(html).toContain('240k / 400k tokens used');
  });
});
