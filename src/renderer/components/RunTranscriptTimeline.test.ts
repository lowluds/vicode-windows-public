import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RunTranscriptItem } from '../lib/run-activity';
import {
  compactActivityGroupDetailItems,
  compactCompletedTranscriptActivityGroups,
  compactWorkSummaryDetailItems,
  RunTranscriptTimeline,
  shouldNestAssistantSourcesWithWorkedGroup,
  stripRedundantActivityDetailLine
} from './RunTranscriptTimeline';

function createActivityItem(
  id: string,
  activityKind: Extract<RunTranscriptItem, { kind: 'activity_line' }>['activityKind'],
  overrides: Partial<Extract<RunTranscriptItem, { kind: 'activity_line' }>> = {}
): Extract<RunTranscriptItem, { kind: 'activity_line' }> {
  return {
    id,
    kind: 'activity_line',
    activityKind,
    toolName: overrides.toolName ?? null,
    label: overrides.label ?? id,
    text: overrides.text ?? id,
    url: overrides.url ?? null,
    path: overrides.path ?? null,
    command: overrides.command ?? null,
    cwd: overrides.cwd ?? null,
    isolationMode: overrides.isolationMode ?? null,
    status: overrides.status ?? null,
    startedAt: overrides.startedAt ?? null,
    finishedAt: overrides.finishedAt ?? null,
    durationLabel: overrides.durationLabel ?? null,
    outputLines: overrides.outputLines ?? []
  };
}

describe('compactCompletedTranscriptActivityGroups', () => {
  it('keeps live terminal commands visible while collapsing adjacent live non-command activity rows', () => {
    const items: RunTranscriptItem[] = [
      createActivityItem('command', 'terminal_command', { command: 'npm test', status: 'running' }),
      createActivityItem('read', 'file_read', { path: 'src/example.ts' })
    ];

    expect(compactCompletedTranscriptActivityGroups(items, 'running')).toEqual(items);
  });

  it('keeps running activity as a visible trail when a live duration label is available', () => {
    const command = createActivityItem('command', 'terminal_command', {
      command: 'npm test',
      status: 'running'
    });
    const thinking = createActivityItem('thinking', 'thinking', {
      label: 'Checking the transcript display.',
      text: 'Checking the transcript display.'
    });

    expect(compactCompletedTranscriptActivityGroups([thinking, command], 'running', 'Working for 12s')).toEqual([
      thinking,
      command
    ]);
  });

  it('collapses adjacent completed activity rows into a disclosure group', () => {
    const items: RunTranscriptItem[] = [
      createActivityItem('read', 'file_read', { path: 'src/example.ts' }),
      createActivityItem('search', 'file_search', { path: 'src' }),
      {
        id: 'assistant',
        kind: 'assistant_text',
        text: 'I found the relevant files.'
      }
    ];

    expect(compactCompletedTranscriptActivityGroups(items, 'completed')).toEqual([
      {
        id: 'activity-group:read',
        kind: 'activity_group',
        label: '2 inspection steps',
        workedForLabel: null,
        items: [items[0], items[1]]
      },
      items[2]
    ]);
  });

  it('collapses even a single completed terminal command into a compact details row', () => {
    const items: RunTranscriptItem[] = [
      createActivityItem('command', 'terminal_command', {
        command: 'npm run build',
        status: 'completed'
      })
    ];

    expect(compactCompletedTranscriptActivityGroups(items, 'failed')).toEqual(items);
  });

  it('leaves single completed tool steps ungrouped so nested details do not require a second disclosure', () => {
    const toolResult = createActivityItem('tool-result', 'tool_result', {
      label: 'Failed run command',
      text: 'exit_code: 1'
    });

    expect(compactCompletedTranscriptActivityGroups([toolResult], 'completed')).toEqual([toolResult]);
  });

  it('keeps completed terminal commands visible between collapsed non-command activity groups', () => {
    const inspection = createActivityItem('read', 'file_read', { path: 'src/example.ts' });
    const command = createActivityItem('command', 'terminal_command', {
      command: 'Get-ChildItem -Path src/renderer',
      status: 'completed'
    });
    const search = createActivityItem('search', 'file_search', { path: 'src/renderer' });
    const items: RunTranscriptItem[] = [inspection, command, search];

    expect(compactCompletedTranscriptActivityGroups(items, 'completed')).toEqual([
      {
        id: 'activity-group:read',
        kind: 'activity_group',
        label: '3 previous steps',
        workedForLabel: null,
        items
      }
    ]);
  });

  it('collapses adjacent completed terminal commands into a single disclosure group', () => {
    const firstCommand = createActivityItem('command-1', 'terminal_command', {
      command: 'npm run build',
      status: 'completed'
    });
    const secondCommand = createActivityItem('command-2', 'terminal_command', {
      command: 'npm test',
      status: 'completed'
    });
    const items: RunTranscriptItem[] = [firstCommand, secondCommand];

    expect(compactCompletedTranscriptActivityGroups(items, 'completed')).toEqual([
      {
        id: 'activity-group:command-1',
        kind: 'activity_group',
        label: '2 commands',
        workedForLabel: null,
        items
      }
    ]);
  });

  it('groups completed thinking rows with adjacent activity so the finished thought process stays together', () => {
    const inspection = createActivityItem('read', 'file_read', { path: 'src/example.ts' });
    const thinking = createActivityItem('thinking', 'thinking', {
      label: 'Reviewing the transcript path before patching.',
      text: 'Reviewing the transcript path before patching.'
    });
    const search = createActivityItem('search', 'file_search', { path: 'src/renderer' });
    const items: RunTranscriptItem[] = [inspection, thinking, search];

    expect(compactCompletedTranscriptActivityGroups(items, 'completed')).toEqual([
      {
        id: 'activity-group:read',
        kind: 'activity_group',
        label: '3 previous steps',
        workedForLabel: null,
        items
      }
    ]);
  });

  it('uses the worked-for label as the disclosure summary for a completed thought-process block', () => {
    const command = createActivityItem('command', 'terminal_command', {
      command: 'npm test',
      status: 'completed'
    });
    const thinking = createActivityItem('thinking', 'thinking', {
      label: 'Reviewing results',
      text: 'Reviewing results'
    });
    const items: RunTranscriptItem[] = [
      command,
      thinking,
      {
        id: 'worked-for',
        kind: 'worked_for',
        label: 'Worked for 3m 36s'
      }
    ];

    expect(compactCompletedTranscriptActivityGroups(items, 'completed')).toEqual([
      {
        id: 'work-summary:worked-for',
        kind: 'work_summary_group',
        workedForLabel: 'Worked for 3m 36s',
        stepLabel: '2 previous steps',
        items: [command, thinking]
      }
    ]);
  });

  it('moves a trailing worked-for footer onto the first grouped activity row when assistant text already flushed the group', () => {
    const command = createActivityItem('command', 'terminal_command', {
      command: 'npm test',
      status: 'completed'
    });
    const thinking = createActivityItem('thinking', 'thinking', {
      label: 'Reviewing results',
      text: 'Reviewing results'
    });
    const assistant: RunTranscriptItem = {
      id: 'assistant',
      kind: 'assistant_text',
      text: 'Here is the answer.'
    };
    const workedFor: RunTranscriptItem = {
      id: 'worked-for',
      kind: 'worked_for',
      label: 'Worked for 18s'
    };

    expect(compactCompletedTranscriptActivityGroups([command, thinking, assistant, workedFor], 'completed')).toEqual([
      {
        id: 'work-summary:worked-for',
        kind: 'work_summary_group',
        workedForLabel: 'Worked for 18s',
        stepLabel: '2 previous steps',
        items: [command, thinking]
      },
      assistant
    ]);
  });

  it('keeps progress notes inside the completed worked-for summary when a final answer follows', () => {
    const usingNote: RunTranscriptItem = {
      id: 'using-note',
      kind: 'assistant_text',
      text: 'Using: Source-Backed Workflow and UX Writing Standards.'
    };
    const command = createActivityItem('command', 'terminal_command', {
      command: 'npm test',
      status: 'completed'
    });
    const workedFor: RunTranscriptItem = {
      id: 'worked-for',
      kind: 'worked_for',
      label: 'Worked for 42s'
    };
    const finalAnswer: RunTranscriptItem = {
      id: 'assistant-final',
      kind: 'assistant_text',
      text: 'Implemented the transcript polish.'
    };

    expect(compactCompletedTranscriptActivityGroups([usingNote, command, workedFor, finalAnswer], 'completed')).toEqual([
      {
        id: 'work-summary:worked-for',
        kind: 'work_summary_group',
        workedForLabel: 'Worked for 42s',
        stepLabel: '2 previous steps',
        items: [usingNote, command]
      },
      finalAnswer
    ]);
  });

  it('summarizes grouped tool activity with tool-step language', () => {
    const toolCall = createActivityItem('tool-call', 'tool_call', { label: 'Calling run command' });
    const toolResult = createActivityItem('tool-result', 'tool_result', { label: 'Completed run command' });
    const items: RunTranscriptItem[] = [toolCall, toolResult];

    expect(compactCompletedTranscriptActivityGroups(items, 'completed')).toEqual([
      {
        id: 'activity-group:tool-call',
        kind: 'activity_group',
        label: '2 tool steps',
        workedForLabel: null,
        items
      }
    ]);
  });
});

describe('stripRedundantActivityDetailLine', () => {
  it('removes a duplicated first tool-detail line when it matches the visible label', () => {
    expect(
      stripRedundantActivityDetailLine('Calling web search', 'Calling web_search\nquery: latest benchmarks')
    ).toBe('query: latest benchmarks');
  });

  it('keeps detail text when the first line carries different information', () => {
    expect(
      stripRedundantActivityDetailLine('Calling extract web page', 'url: https://example.com/article')
    ).toBe('url: https://example.com/article');
  });
});

describe('compactActivityGroupDetailItems', () => {
  it('groups adjacent completed commands behind a command-count disclosure item', () => {
    const firstCommand = createActivityItem('command-1', 'terminal_command', {
      command: 'npm run build',
      status: 'completed'
    });
    const secondCommand = createActivityItem('command-2', 'terminal_command', {
      command: 'npm test',
      status: 'completed'
    });
    const thinking = createActivityItem('thinking', 'thinking', {
      label: 'Reviewing results',
      text: 'Reviewing results'
    });

    expect(compactActivityGroupDetailItems([thinking, firstCommand, secondCommand])).toEqual([
      {
        id: 'activity:thinking',
        kind: 'activity_item',
        item: thinking
      },
      {
        id: 'command-group:command-1',
        kind: 'command_group',
        label: 'Ran 2 commands',
        items: [firstCommand, secondCommand]
      }
    ]);
  });
});

describe('compactWorkSummaryDetailItems', () => {
  it('keeps readable progress notes and groups adjacent commands inside worked summaries', () => {
    const usingNote: RunTranscriptItem = {
      id: 'using-note',
      kind: 'assistant_text',
      text: 'Using: Source-Backed Workflow and UX Writing Standards.'
    };
    const firstCommand = createActivityItem('command-1', 'terminal_command', {
      command: 'npm run build',
      status: 'completed'
    });
    const secondCommand = createActivityItem('command-2', 'terminal_command', {
      command: 'npm test',
      status: 'completed'
    });

    expect(compactWorkSummaryDetailItems([usingNote, firstCommand, secondCommand])).toEqual([
      {
        id: 'assistant-note:using-note',
        kind: 'assistant_note',
        item: usingNote,
        text: 'Using: Source-Backed Workflow and UX Writing Standards.'
      },
      {
        id: 'command-group:command-1',
        kind: 'command_group',
        label: 'Ran 2 commands',
        items: [firstCommand, secondCommand]
      }
    ]);
  });
});

describe('shouldNestAssistantSourcesWithWorkedGroup', () => {
  it('moves structured assistant sources into the preceding worked-for activity disclosure', () => {
    const items = compactCompletedTranscriptActivityGroups(
      [
        createActivityItem('command', 'terminal_command', {
          label: 'Background terminal finished with npm test',
          command: 'npm test',
          status: 'completed'
        }),
        {
          id: 'worked-for',
          kind: 'worked_for',
          label: 'Worked for 27s'
        },
        {
          id: 'assistant',
          kind: 'assistant_text',
          text: 'The terminal step completed cleanly.',
          sources: [
            {
              url: 'https://example.com/docs',
              title: 'Example docs',
              snippet: 'A source snippet',
              excerpt: null
            }
          ]
        }
      ] satisfies RunTranscriptItem[],
      'completed'
    );

    expect(shouldNestAssistantSourcesWithWorkedGroup(items, 1)).toBe(true);
  });
});

describe('RunTranscriptTimeline resolution summary rendering', () => {
  it('renders completed resolution summaries as summary copy instead of a resolved status card', () => {
    const html = renderToStaticMarkup(
      createElement(RunTranscriptTimeline, {
        items: [
          {
            id: 'summary',
            kind: 'resolution_summary',
            outcome: 'Implemented the sidebar thread connector polish.',
            filesChanged: ['src/renderer/styles/sidebar.css'],
            toolsUsed: [],
            verificationCommands: ['npx playwright test e2e/sidebar-thread-indicator.spec.ts'],
            remainingRisk: null
          } satisfies RunTranscriptItem
        ],
        skills: [],
        runState: 'completed'
      })
    );

    expect(html).toContain('Summary');
    expect(html).toContain('Implemented the sidebar thread connector polish.');
    expect(html).toContain('Changed');
    expect(html).toContain('Verified');
    expect(html).not.toContain('Resolved');
    expect(html).not.toContain('Outcome');
  });
});
