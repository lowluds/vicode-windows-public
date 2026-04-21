import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RunProgressState } from '../../shared/domain';
import { RunProgressPanel } from './RunProgressPanel';

describe('RunProgressPanel', () => {
  it('renders delegated background autonomy context with native panel copy', () => {
    const progress: RunProgressState = {
      runId: 'run-1',
      threadId: 'thread-1',
      title: 'Background delegated run',
      items: [
        { id: 'a', label: 'Review delegated heartbeat contract', status: 'completed', order: 0 },
        { id: 'b', label: 'Execute the delegated task', status: 'in_progress', order: 1 },
        { id: 'c', label: 'Summarize the result', status: 'pending', order: 2 }
      ],
      updatedAt: '2026-03-28T12:00:00.000Z',
      diffStats: null,
      reviewAvailable: false,
      changeArtifact: null,
      delegation: {
        mode: 'background',
        profile: 'heartbeat',
        phase: 'active',
        title: 'Autonomy: Verify onboarding copy',
        note: 'This heartbeat run is using delegated context only: AGENTS.md and codex.md when present. SOUL.md, USER.md, auto memory, and inline thread history stay with the main thread.',
        includedContext: ['AGENTS.md', 'codex.md'],
        excludedContext: ['SOUL.md', 'USER.md', 'auto memory', 'inline thread history']
      },
      contextPressure: null,
      checkpointReminder: null,
      queueSummary: null
    };

    const html = renderToStaticMarkup(React.createElement(RunProgressPanel, { progress }));

    expect(html).toContain('Background task active');
    expect(html).toContain('Delegated context');
    expect(html).toContain('1 of 3 tasks completed');
  });
});
