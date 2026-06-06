import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RunActivityViewModel } from '../lib/run-activity';
import { RunActivityPanel } from './RunActivityPanel';

describe('RunActivityPanel context compaction rendering', () => {
  it('renders automatic context compaction without exposing backend detail', () => {
    const activity: RunActivityViewModel = {
      runId: 'run-1',
      state: 'running',
      startedAt: null,
      finishedAt: null,
      outcomeMessage: null,
      activeHeading: 'Thinking',
      workedForLabel: null,
      changeArtifact: null,
      terminalCommands: [],
      thinkingLines: [
        {
          id: 'context-compaction',
          kind: 'context_compaction',
          label: 'Context automatically compacted',
          text: 'Older thread context was summarized so the run can continue within the model context window.',
          url: null,
          path: 'thread_compactions.compaction-1'
        }
      ],
      timelineItems: [
        {
          id: 'timeline:context-compaction',
          kind: 'thinking',
          line: {
            id: 'context-compaction',
            kind: 'context_compaction',
            label: 'Context automatically compacted',
            text: 'Older thread context was summarized so the run can continue within the model context window.',
            url: null,
            path: 'thread_compactions.compaction-1'
          }
        }
      ]
    };

    const html = renderToStaticMarkup(React.createElement(RunActivityPanel, { activity }));

    expect(html).toContain('Context automatically compacted');
    expect(html).not.toContain('Older thread context');
    expect(html).not.toContain('thread_compactions.compaction-1');
  });
});
