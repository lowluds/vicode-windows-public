import { describe, expect, it } from 'vitest';
import { collectThreadSourcesFromRunArtifacts, extractThreadSourcesFromText, normalizeThreadSources } from './thread-sources';

describe('thread-sources helpers', () => {
  it('parses structured research packets into typed sources', () => {
    const sources = extractThreadSourcesFromText(
      [
        'Research packet for "react hooks":',
        'Sources reviewed: 1',
        '',
        '1. React Hooks',
        'URL: https://react.dev/reference/react',
        'Search snippet: Hooks let you use state and other React features.',
        'Extracted excerpt: useState and useEffect are the most common hooks.'
      ].join('\n')
    );

    expect(sources).toEqual([
      {
        url: 'https://react.dev/reference/react',
        title: 'React Hooks',
        snippet: 'Hooks let you use state and other React features.',
        excerpt: 'useState and useEffect are the most common hooks.'
      }
    ]);
  });

  it('drops extracted-page prefixes from structured source titles', () => {
    const sources = extractThreadSourcesFromText(
      [
        'Extracted page: Claude Code docs',
        'URL: https://docs.example.com/claude-code',
        '',
        'Body'
      ].join('\n')
    );

    expect(sources).toEqual([
      {
        url: 'https://docs.example.com/claude-code',
        title: 'Claude Code docs',
        snippet: null,
        excerpt: null
      }
    ]);
  });

  it('normalizes stored metadata arrays and ignores invalid entries', () => {
    expect(
      normalizeThreadSources([
        {
          href: 'https://example.com/source',
          title: 'Example source',
          snippet: 'A useful snippet.'
        },
        {
          href: 'notaurl',
          title: 'Ignored'
        }
      ])
    ).toEqual([
      {
        url: 'https://example.com/source',
        title: 'Example source',
        snippet: 'A useful snippet.',
        excerpt: null
      }
    ]);
  });

  it('merges structured activity sources with assistant footer fallbacks', () => {
    const sources = collectThreadSourcesFromRunArtifacts(
      [
        {
          id: 'event-1',
          threadId: 'thread-1',
          runId: 'run-1',
          eventType: 'info',
          payload: {
            activity: {
              kind: 'tool_result',
              sources: [
                {
                  url: 'https://react.dev/reference/react/useState',
                  title: 'React useState',
                  snippet: 'useState adds local component state.',
                  excerpt: null
                }
              ]
            }
          },
          createdAt: '2026-04-17T12:00:00.000Z'
        }
      ],
      'Sources:\n- https://react.dev/reference/react/useState\n- https://react.dev/reference/react/useEffect'
    );

    expect(sources).toEqual([
      {
        url: 'https://react.dev/reference/react/useState',
        title: 'React useState',
        snippet: 'useState adds local component state.',
        excerpt: null
      },
      {
        url: 'https://react.dev/reference/react/useEffect',
        title: 'react.dev',
        snippet: null,
        excerpt: null
      }
    ]);
  });
});
