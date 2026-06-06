import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RunActivityViewModel } from '../lib/run-activity';
import { RunActivityPanel } from './RunActivityPanel';

describe('RunActivityPanel', () => {
  it('renders memory checkpoints without exposing backend file paths', () => {
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
          id: 'checkpoint',
          kind: 'memory_checkpoint',
          label: 'Project checkpoint saved',
          text: 'Project checkpoint saved',
          url: null,
          path: 'C:\\workspace\\memory\\2026-05-23.md'
        }
      ],
      timelineItems: [
        {
          id: 'timeline:checkpoint',
          kind: 'thinking',
          line: {
            id: 'checkpoint',
            kind: 'memory_checkpoint',
            label: 'Project checkpoint saved',
            text: 'Project checkpoint saved',
            url: null,
            path: 'C:\\workspace\\memory\\2026-05-23.md'
          }
        }
      ]
    };

    const html = renderToStaticMarkup(<RunActivityPanel activity={activity} />);

    expect(html).toContain('Project checkpoint saved');
    expect(html).not.toContain('C:\\workspace');
    expect(html).not.toContain('2026-05-23.md');
  });
});
