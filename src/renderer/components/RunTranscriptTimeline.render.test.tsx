import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RunTranscriptItem } from '../lib/run-activity';
import { RunTranscriptTimeline } from './RunTranscriptTimeline';

describe('RunTranscriptTimeline streaming assistant rendering', () => {
  it('keeps in-progress assistant text on the lightweight plain-text path while streaming', () => {
    const html = renderToStaticMarkup(
      <RunTranscriptTimeline
        items={[
          {
            id: 'assistant',
            kind: 'assistant_text',
            text: 'Streaming **bold** output'
          } satisfies RunTranscriptItem
        ]}
        skills={[]}
        runState="running"
      />
    );

    expect(html).toContain('Streaming **bold** output');
    expect(html).not.toContain('<strong>');
  });
});
