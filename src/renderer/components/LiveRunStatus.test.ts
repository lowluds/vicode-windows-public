import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RunActivityViewModel } from '../lib/run-activity';
import { deriveLiveRunStatusSnapshot, LiveRunStatus, shouldShowLiveRunAction } from './LiveRunStatus';

function createActivity(overrides: Partial<RunActivityViewModel> = {}): RunActivityViewModel {
  return {
    runId: 'run-live-status',
    state: 'running',
    startedAt: '2026-04-17T12:00:00.000Z',
    finishedAt: null,
    outcomeMessage: null,
    thinkingLines: [],
    terminalCommands: [],
    timelineItems: [],
    activeHeading: 'Working',
    workedForLabel: null,
    changeArtifact: null,
    ...overrides
  };
}

describe('deriveLiveRunStatusSnapshot', () => {
  it('surfaces the latest action label and latest reasoning text separately', () => {
    const snapshot = deriveLiveRunStatusSnapshot(
      createActivity({
        activeHeading: 'Thinking',
        thinkingLines: [
          {
            id: 'action',
            kind: 'web_search',
            label: 'Completed research topic',
            text: 'query: best open source LLM models',
            url: null,
            path: null
          },
          {
            id: 'reasoning',
            kind: 'thinking',
            label: 'Thinking',
            text: 'Comparing open-source finetuning options before replying.',
            url: null,
            path: null
          }
        ]
      })
    );

    expect(snapshot.actionLabel).toBe('Searching the web');
    expect(snapshot.reasoningText).toBe('Comparing open-source finetuning options before replying.');
  });

  it('prefers the live terminal command summary when a command is still running', () => {
    const snapshot = deriveLiveRunStatusSnapshot(
      createActivity({
        terminalCommands: [
          {
            id: 'terminal',
            label: 'Background terminal finished with npm test',
            command: 'npm test',
            cwd: 'D:/Workspace/vicode-windows',
            isolationMode: null,
            status: 'running',
            startedAt: '2026-04-17T12:00:00.000Z',
            finishedAt: null,
            durationLabel: null,
            outputLines: []
          }
        ]
      })
    );

    expect(snapshot.actionLabel).toBe('Running command');
    expect(snapshot.reasoningText).toBeNull();
  });

  it('falls back to the active heading when no detailed line is available', () => {
    const snapshot = deriveLiveRunStatusSnapshot(
      createActivity({
        activeHeading: 'Working',
        thinkingLines: []
      })
    );

    expect(snapshot.actionLabel).toBe('Working');
    expect(snapshot.reasoningText).toBeNull();
  });

  it('keeps the generic Thinking shimmer visible when no detailed reasoning text exists yet', () => {
    const activity = createActivity({
      activeHeading: 'Thinking',
      thinkingLines: []
    });

    const snapshot = deriveLiveRunStatusSnapshot(activity);
    const html = renderToStaticMarkup(React.createElement(LiveRunStatus, { activity }));

    expect(snapshot.actionLabel).toBe('Thinking');
    expect(snapshot.reasoningText).toBeNull();
    expect(shouldShowLiveRunAction(snapshot)).toBe(true);
    expect(html).toContain('Thinking');
  });

  it('summarizes detailed reasoning as a generic Thinking status above the composer', () => {
    const activity = createActivity({
      thinkingLines: [
        {
          id: 'reasoning',
          kind: 'thinking',
          label: 'Thinking',
          text: 'Inspecting the existing page before editing.',
          url: null,
          path: null
        }
      ]
    });

    const snapshot = deriveLiveRunStatusSnapshot(activity);
    const html = renderToStaticMarkup(React.createElement(LiveRunStatus, { activity }));

    expect(snapshot.actionLabel).toBe('Thinking');
    expect(snapshot.reasoningText).toBe('Inspecting the existing page before editing.');
    expect(shouldShowLiveRunAction(snapshot)).toBe(true);
    expect(html).toContain('Thinking');
    expect(html).not.toContain('Inspecting the existing page before editing.');
  });

  it('keeps the concrete action visible without rendering reasoning details above the composer', () => {
    const activity = createActivity({
      thinkingLines: [
        {
          id: 'action',
          kind: 'web_search',
          label: 'Searching the web',
          text: 'query: latest vicode release',
          url: null,
          path: null
        },
        {
          id: 'reasoning',
          kind: 'thinking',
          label: 'Searching the web',
          text: 'Comparing sources before drafting the response.',
          url: null,
          path: null
        }
      ]
    });

    const snapshot = deriveLiveRunStatusSnapshot(activity);
    const html = renderToStaticMarkup(React.createElement(LiveRunStatus, { activity }));

    expect(snapshot.actionLabel).toBe('Searching the web');
    expect(snapshot.reasoningText).toBe('Comparing sources before drafting the response.');
    expect(shouldShowLiveRunAction(snapshot)).toBe(true);
    expect(html).toContain('Searching the web');
    expect(html).not.toContain('Comparing sources before drafting the response.');
  });
});
