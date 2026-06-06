import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunChangeArtifact, SkillDefinition } from '../../shared/domain';
import { parseRunChangeHunks } from '../../shared/hunk-review';
import type { RunTranscriptItem } from '../lib/run-activity';
import { RunTranscriptTimeline } from './RunTranscriptTimeline';
import {
  compactActivityGroupDetailItems,
  compactCompletedTranscriptActivityGroups,
  compactWorkSummaryDetailItems,
  shouldNestAssistantSourcesWithWorkedGroup,
  summarizeActivityGroupKinds
} from './RunTranscriptTimeline.model';
import {
  formatTerminalSummaryLabel,
  getTerminalPreviewLines,
  sanitizeAssistantContent,
  stripRedundantActivityDetailLine
} from './RunTranscriptTimeline.format';

const previousDomGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  HTMLElement: globalThis.HTMLElement,
  MouseEvent: globalThis.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT: (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
};

afterEach(() => {
  globalThis.window = previousDomGlobals.window;
  globalThis.document = previousDomGlobals.document;
  globalThis.HTMLElement = previousDomGlobals.HTMLElement;
  globalThis.MouseEvent = previousDomGlobals.MouseEvent;
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    previousDomGlobals.IS_REACT_ACT_ENVIRONMENT;
});

function createActivityItem(
  id: string,
  activityKind: Extract<RunTranscriptItem, { kind: 'activity_line' }>['activityKind'],
  overrides: Partial<Extract<RunTranscriptItem, { kind: 'activity_line' }>> = {}
): Extract<RunTranscriptItem, { kind: 'activity_line' }> {
  return {
    id,
    kind: 'activity_line',
    activityKind,
    providerEventType: overrides.providerEventType ?? null,
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

function createSkill(id: string, name: string): SkillDefinition {
  return {
    id,
    name,
    description: `${name} skill.`,
    instructions: `Use ${name}.`,
    origin: 'custom_local',
    scope: 'global',
    providerTargets: ['openai'],
    enabled: true,
    projectId: null,
    metadata: {
      manifestVersion: 1,
      slug: name.toLowerCase().replace(/\s+/gu, '-'),
      folderName: name.toLowerCase().replace(/\s+/gu, '-'),
      syncState: {},
      providerOrigin: null,
      kind: 'skill',
      attachMode: 'prompt',
      iconPath: null,
      examplePrompt: null,
      browseUrl: null,
      detailMarkdown: null,
      category: null
    },
    path: null,
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z'
  };
}

describe('RunTranscriptTimeline streaming assistant rendering', () => {
  it('cleans streaming disclosure lines and keeps Using scoped to real skills', () => {
    const html = renderToStaticMarkup(
      createElement(RunTranscriptTimeline, {
        items: [
          {
            id: 'assistant',
            kind: 'assistant_text',
            text: 'Using: [[Task Routing]], [[Research Paper Summary]], [[Presentation Style Summarization]]\n\nCertainly! Here is a class-friendly summary of **the paper**.'
          } satisfies RunTranscriptItem
        ],
        skills: [
          createSkill('research-paper-summary', 'Research Paper Summary'),
          createSkill('presentation-style-summarization', 'Presentation Style Summarization')
        ],
        runState: 'running'
      })
    );

    expect(html).toContain('turn-reference-disclosure');
    expect(html).toContain('data-disclosure-kind="using"');
    expect(html).toContain('Using:');
    expect(html).toContain('Research Paper Summary');
    expect(html).toContain('Presentation Style Summarization');
    expect(html).toContain('Certainly! Here is a class-friendly summary of **the paper**.');
    expect(html).not.toContain('Task Routing');
    expect(html).not.toContain('[[Research Paper Summary]]');
    expect(html).not.toContain('<strong>');
  });

  it('removes streaming Using disclosures when none of the listed items are real skills', () => {
    const html = renderToStaticMarkup(
      createElement(RunTranscriptTimeline, {
        items: [
          {
            id: 'assistant',
            kind: 'assistant_text',
            text: 'Using: [[Task Routing]], [[Research Paper Summary]]\n\nHere is the summary.'
          } satisfies RunTranscriptItem
        ],
        skills: [createSkill('reviewer', 'Reviewer')],
        runState: 'running'
      })
    );

    expect(html).toContain('Here is the summary.');
    expect(html).not.toContain('Using:');
    expect(html).not.toContain('Task Routing');
    expect(html).not.toContain('Research Paper Summary');
  });
});

describe('RunTranscriptTimeline model helpers', () => {
  it('filters terminal preview output down to meaningful visible lines', () => {
    expect(getTerminalPreviewLines(['first line  ', '   ', 'second line', 'third line'], 2)).toEqual([
      'first line',
      'second line'
    ]);
  });

  it('formats terminal summary labels without exposing implementation-only labels', () => {
    expect(
      formatTerminalSummaryLabel({
        label: 'terminal_command',
        command: 'npm test',
        status: 'completed',
        durationLabel: '8s'
      })
    ).toBe('Ran npm test for 8s');
    expect(
      formatTerminalSummaryLabel({
        label: 'background terminal completed',
        command: 'npm test',
        status: 'stopped',
        durationLabel: '12s'
      })
    ).toBe('background terminal completed after 12s');
  });

  it('sanitizes assistant transcript content while preserving structured-source answers', () => {
    expect(
      sanitizeAssistantContent('Thinking\nChunk ID: abc\nHere is the answer.\n\n\nSources:\n- https://example.com', true)
    ).toBe('Here is the answer.');
  });
});

describe('compactCompletedTranscriptActivityGroups', () => {
  it('keeps live terminal commands visible while collapsing adjacent live non-command activity rows', () => {
    const command = createActivityItem('command', 'terminal_command', { command: 'npm test', status: 'running' });
    const read = createActivityItem('read', 'file_read', { path: 'src/example.ts' });

    expect(compactCompletedTranscriptActivityGroups([command, read], 'running')).toEqual([
      command,
      {
        id: 'activity-group:read',
        kind: 'activity_group',
        label: '1 inspection step',
        workedForLabel: null,
        items: [read]
      }
    ]);
  });

  it('keeps running reasoning interleaved with compact tool and terminal evidence', () => {
    const toolCall = createActivityItem('tool-call', 'tool_call', { label: 'Calling run command' });
    const firstThinking = createActivityItem('thinking-1', 'thinking', {
      label: 'Inspecting the run event shape.',
      text: 'Inspecting the run event shape.'
    });
    const duplicateThinking = createActivityItem('thinking-duplicate', 'thinking', {
      label: 'Inspecting the run event shape.',
      text: 'Inspecting the run event shape.'
    });
    const toolResult = createActivityItem('tool-result', 'tool_result', { label: 'Completed run command' });
    const command = createActivityItem('command', 'terminal_command', {
      command: 'npm test',
      status: 'running'
    });
    const latestThinking = createActivityItem('thinking-2', 'thinking', {
      label: 'Comparing the tool result before replying.',
      text: 'Comparing the tool result before replying.'
    });

    expect(
      compactCompletedTranscriptActivityGroups(
        [toolCall, firstThinking, duplicateThinking, toolResult, command, latestThinking],
        'running',
        'Working for 12s'
      )
    ).toEqual([
      {
        id: 'running-reasoning:thinking-1',
        kind: 'running_reasoning_group',
        label: 'Reasoning',
        latestText: 'Inspecting the run event shape.',
        items: [firstThinking]
      },
      command,
      {
        id: 'running-reasoning:thinking-2',
        kind: 'running_reasoning_group',
        label: 'Reasoning',
        latestText: 'Comparing the tool result before replying.',
        items: [latestThinking]
      }
    ]);
  });

  it('keeps running activity compact when no reasoning summary exists yet', () => {
    const command = createActivityItem('command', 'terminal_command', {
      command: 'npm test',
      status: 'running'
    });
    const read = createActivityItem('read', 'file_read', { path: 'src/example.ts' });

    expect(compactCompletedTranscriptActivityGroups([read, command], 'running', 'Working for 12s')).toEqual([
      {
        id: 'activity-group:read',
        kind: 'activity_group',
        label: '1 inspection step',
        workedForLabel: null,
        items: [read]
      },
      command
    ]);
  });

  it('compacts failed and aborted timelines instead of keeping review details expanded', () => {
    const toolCall = createActivityItem('tool-call', 'tool_call', { label: 'Calling run command' });
    const thinking = createActivityItem('thinking', 'thinking', {
      label: 'Checking the failure before summarizing.',
      text: 'Checking the failure before summarizing.'
    });
    const command = createActivityItem('command', 'terminal_command', {
      command: 'npm test',
      status: 'running'
    });

    for (const runState of ['failed', 'aborted'] as const) {
      expect(compactCompletedTranscriptActivityGroups([toolCall, thinking, command], runState)).toEqual([
        thinking,
        command
      ]);
    }
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

  it('collapses even single completed tool steps so raw details stay quiet by default', () => {
    const toolResult = createActivityItem('tool-result', 'tool_result', {
      label: 'Failed run command',
      text: 'exit_code: 1'
    });

    expect(compactCompletedTranscriptActivityGroups([toolResult], 'completed')).toEqual([
      {
        id: 'activity-group:tool-result',
        kind: 'activity_group',
        label: '1 tool step',
        workedForLabel: null,
        items: [toolResult]
      }
    ]);
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
      text: 'Context: Source-Backed Workflow and UX Writing Standards.'
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

  it('formats mixed completed activity summaries with a clean text separator', () => {
    expect(
      summarizeActivityGroupKinds([
        createActivityItem('read', 'file_read'),
        createActivityItem('write', 'file_write'),
        createActivityItem('command', 'terminal_command')
      ])
    ).toBe('1 inspection - 1 edit - 1 command');
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

  it('hides redundant command tool bookends when terminal command evidence is available', () => {
    const toolCall = createActivityItem('tool-call', 'tool_call', {
      toolName: 'run_command',
      label: 'Calling run command',
      text: 'command: npm test'
    });
    const read = createActivityItem('read', 'file_read', {
      path: 'README.md',
      label: 'Read README.md'
    });
    const toolResult = createActivityItem('tool-result', 'tool_result', {
      toolName: null,
      label: 'Completed run command',
      text: 'exit_code: 0'
    });
    const command = createActivityItem('command', 'terminal_command', {
      command: 'npm test',
      status: 'completed'
    });

    expect(summarizeActivityGroupKinds([toolCall, read, toolResult, command])).toBe('1 inspection - 1 command');
    expect(compactActivityGroupDetailItems([toolCall, read, toolResult, command])).toEqual([
      {
        id: 'detail-group:read',
        kind: 'detail_group',
        label: '1 inspection step',
        items: [read]
      },
      {
        id: 'command-group:command',
        kind: 'command_group',
        label: 'Ran 1 command',
        items: [command]
      }
    ]);
  });

  it('keeps failed tool details even when concrete evidence exists nearby', () => {
    const read = createActivityItem('read', 'file_read', {
      path: 'README.md',
      label: 'Read README.md'
    });
    const failedRead = createActivityItem('failed-read', 'tool_result', {
      toolName: 'read_file',
      label: 'Could not read file',
      text: 'ENOENT: missing.md'
    });

    expect(compactActivityGroupDetailItems([read, failedRead])).toEqual([
      {
        id: 'detail-group:read',
        kind: 'detail_group',
        label: '1 inspection step',
        items: [read]
      },
      {
        id: 'detail-group:failed-read',
        kind: 'detail_group',
        label: '1 tool detail',
        items: [failedRead]
      }
    ]);
  });
});

describe('compactWorkSummaryDetailItems', () => {
  it('keeps readable progress notes and groups adjacent commands inside worked summaries', () => {
    const usingNote: RunTranscriptItem = {
      id: 'using-note',
      kind: 'assistant_text',
      text: 'Context: Source-Backed Workflow and UX Writing Standards.'
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
        text: 'Context: Source-Backed Workflow and UX Writing Standards.'
      },
      {
        id: 'command-group:command-1',
        kind: 'command_group',
        label: 'Ran 2 commands',
        items: [firstCommand, secondCommand]
      }
    ]);
  });

  it('keeps noisy tool activity behind grouped disclosures inside worked summaries', () => {
    const webSearch = createActivityItem('web-search', 'tool_call', {
      toolName: 'web_search',
      label: 'Searching the web',
      text: 'Search query: roofing business hero image unsplash'
    });
    const webFailure = createActivityItem('web-failure', 'tool_result', {
      toolName: 'extract_web_page',
      label: 'Could not read the web page',
      text: 'Page URL: https://unsplash.com/s/photos/roofing\nHTTP 401'
    });
    const mkdir = createActivityItem('mkdir', 'mkdir', {
      label: 'Created folder',
      text: 'Folder: roofing-landing-page',
      path: 'roofing-landing-page'
    });
    const command = createActivityItem('command', 'terminal_command', {
      command: 'Get-ChildItem',
      status: 'completed',
      outputLines: ['memory', 'roofing-landing-page']
    });

    expect(compactWorkSummaryDetailItems([webSearch, webFailure, mkdir, command])).toEqual([
      {
        id: 'detail-group:web-search',
        kind: 'detail_group',
        label: '2 research steps',
        items: [webSearch, webFailure]
      },
      {
        id: 'detail-group:mkdir',
        kind: 'detail_group',
        label: '1 file change',
        items: [mkdir]
      },
      {
        id: 'command-group:command',
        kind: 'command_group',
        label: 'Ran 1 command',
        items: [command]
      }
    ]);
  });
});

describe('RunTranscriptTimeline compact tool rendering', () => {
  it('renders running reasoning copy once while keeping the label compact', () => {
    const reasoningText = 'I will inspect README.md, run one safe command, and then summarize the result.';
    const html = renderToStaticMarkup(
      createElement(RunTranscriptTimeline, {
        items: [
          createActivityItem('thinking', 'thinking', {
            label: reasoningText,
            text: reasoningText
          })
        ],
        skills: [],
        runState: 'running'
      })
    );

    expect(html).toContain('Reasoning');
    expect(html).not.toContain('Thinking');
    expect(html.split(reasoningText).length - 1).toBe(1);
  });

  function createWorktreeReviewTranscriptItem(overrides: Record<string, unknown> = {}): RunTranscriptItem {
    return {
      id: 'worktree-review:worktree-change-1',
      kind: 'worktree_workspace_change',
      label: 'Worktree workspace changes',
      change: {
        id: 'worktree-review:worktree-change-1',
        threadId: 'thread-1',
        runId: 'run-1',
        artifactEventId: 'worktree-change-1',
        createdAt: '2026-03-16T00:00:02.000Z',
        isolationMode: 'git_worktree',
        status: 'pending',
        branchName: 'vicode/worktree/project-1/run-1',
        baseSha: 'abcdef1234567890',
        sourceWorkspaceRelativePath: 'packages/app',
        changedPaths: ['src/example.ts'],
        filesChanged: 1,
        insertions: 3,
        deletions: 1,
        errorReason: null,
        decision: null,
        artifact: {
          source: 'worktree_diff',
          summary: {
            filesChanged: 1,
            insertions: 3,
            deletions: 1
          },
          files: [
            {
              path: 'src/example.ts',
              status: 'modified',
              insertions: 3,
              deletions: 1,
              beforeContent: 'before-secret-token',
              afterContent: 'after-secret-token',
              previewLines: [],
              previewTruncated: false
            }
          ]
        },
        ...overrides
      }
    } as unknown as RunTranscriptItem;
  }

  it('renders pending worktree review changes with apply and reject actions only while actionable', () => {
    const pendingHtml = renderToStaticMarkup(
      createElement(RunTranscriptTimeline, {
        items: [createWorktreeReviewTranscriptItem()],
        skills: [],
        runState: 'completed',
        onApplyWorktreeReview: async () => {},
        onRejectWorktreeReview: async () => {},
        onRevertWorktreeReview: async () => {},
        onCleanupWorktreeReview: async () => {}
      })
    );

    expect(pendingHtml).toContain('Worktree workspace changes');
    expect(pendingHtml).toContain('git_worktree');
    expect(pendingHtml).toContain('vicode/worktree/project-1/run-1');
    expect(pendingHtml).toContain('abcdef1');
    expect(pendingHtml).toContain('packages/app');
    expect(pendingHtml).toContain('src/example.ts');
    expect(pendingHtml).toContain('Apply');
    expect(pendingHtml).toContain('Reject');
    expect(pendingHtml).not.toContain('C:\\');
    expect(pendingHtml).not.toContain('sourceWorkspaceRoot');
    expect(pendingHtml).not.toContain('worktreeWorkspaceRoot');

    const appliedHtml = renderToStaticMarkup(
      createElement(RunTranscriptTimeline, {
        items: [
          createWorktreeReviewTranscriptItem({
            status: 'applied',
            decision: {
              action: 'applied',
              status: 'applied',
              threadId: 'thread-1',
              runId: 'run-1',
              isolationMode: 'git_worktree',
              branchName: 'vicode/worktree/project-1/run-1',
              baseSha: 'abcdef1234567890',
              sourceWorkspaceRelativePath: 'packages/app',
              changedPaths: ['src/example.ts'],
              filesChanged: 1,
              insertions: 3,
              deletions: 1,
              errorReason: null,
              createdAt: '2026-03-16T00:00:03.000Z'
            }
          })
        ],
        skills: [],
        runState: 'completed',
        onApplyWorktreeReview: async () => {},
        onRejectWorktreeReview: async () => {},
        onRevertWorktreeReview: async () => {},
        onCleanupWorktreeReview: async () => {}
      })
    );

    expect(appliedHtml).toContain('Applied');
    expect(appliedHtml).toContain('Revert');
    expect(appliedHtml).toContain('Clean up');
    expect(appliedHtml).not.toContain('Apply</span>');
    expect(appliedHtml).not.toContain('Reject</span>');

    const failedHtml = renderToStaticMarkup(
      createElement(RunTranscriptTimeline, {
        items: [
          createWorktreeReviewTranscriptItem({
            status: 'failed',
            errorReason: 'Source workspace changed.',
            decision: {
              action: 'applied',
              status: 'failed',
              threadId: 'thread-1',
              runId: 'run-1',
              isolationMode: 'git_worktree',
              branchName: 'vicode/worktree/project-1/run-1',
              baseSha: 'abcdef1234567890',
              sourceWorkspaceRelativePath: 'packages/app',
              changedPaths: ['src/example.ts'],
              filesChanged: 1,
              insertions: 3,
              deletions: 1,
              errorReason: 'Source workspace changed.',
              createdAt: '2026-03-16T00:00:03.000Z'
            }
          })
        ],
        skills: [],
        runState: 'completed',
        onApplyWorktreeReview: async () => {},
        onRejectWorktreeReview: async () => {},
        onCleanupWorktreeReview: async () => {}
      })
    );

    expect(failedHtml).toContain('Failed');
    expect(failedHtml).toContain('Source workspace changed.');
    expect(failedHtml).toContain('Apply');
    expect(failedHtml).toContain('Reject');
    expect(failedHtml).not.toContain('Revert');
    expect(failedHtml).not.toContain('Clean up');

    const revertedHtml = renderToStaticMarkup(
      createElement(RunTranscriptTimeline, {
        items: [
          createWorktreeReviewTranscriptItem({
            status: 'reverted',
            decision: {
              action: 'reverted',
              status: 'reverted',
              threadId: 'thread-1',
              runId: 'run-1',
              isolationMode: 'git_worktree',
              branchName: 'vicode/worktree/project-1/run-1',
              baseSha: 'abcdef1234567890',
              sourceWorkspaceRelativePath: 'packages/app',
              changedPaths: ['src/example.ts'],
              filesChanged: 1,
              insertions: 3,
              deletions: 1,
              errorReason: null,
              createdAt: '2026-03-16T00:00:04.000Z'
            }
          })
        ],
        skills: [],
        runState: 'completed',
        onApplyWorktreeReview: async () => {},
        onRejectWorktreeReview: async () => {},
        onRevertWorktreeReview: async () => {},
        onCleanupWorktreeReview: async () => {}
      })
    );

    expect(revertedHtml).toContain('Reverted');
    expect(revertedHtml).toContain('Clean up');
    expect(revertedHtml).not.toContain('Apply');
    expect(revertedHtml).not.toContain('Reject');
    expect(revertedHtml).not.toContain('Revert</span>');

    const cleanedHtml = renderToStaticMarkup(
      createElement(RunTranscriptTimeline, {
        items: [
          createWorktreeReviewTranscriptItem({
            status: 'rejected',
            cleanupStatus: 'cleaned',
            cleanupDecision: {
              action: 'cleaned',
              status: 'cleaned',
              threadId: 'thread-1',
              runId: 'run-1',
              isolationMode: 'git_worktree',
              branchName: 'vicode/worktree/project-1/run-1',
              baseSha: 'abcdef1234567890',
              cleanupPolicy: 'preserve_until_review',
              reviewStatus: 'rejected',
              errorReason: null,
              createdAt: '2026-03-16T00:00:05.000Z'
            }
          })
        ],
        skills: [],
        runState: 'completed',
        onCleanupWorktreeReview: async () => {}
      })
    );

    expect(cleanedHtml).toContain('Cleanup');
    expect(cleanedHtml).toContain('Cleaned');
    expect(cleanedHtml).not.toContain('Clean up');
  });

  it('calls worktree review actions with only threadId and runId', async () => {
    const { document, window } = parseHTML('<html><body><div id="root"></div></body></html>');
    globalThis.window = window as unknown as typeof globalThis.window;
    globalThis.document = document as unknown as typeof globalThis.document;
    globalThis.HTMLElement = window.HTMLElement as unknown as typeof globalThis.HTMLElement;
    globalThis.MouseEvent = window.MouseEvent as unknown as typeof globalThis.MouseEvent;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    const onApplyWorktreeReview = vi.fn();
    const onRejectWorktreeReview = vi.fn();
    const onRevertWorktreeReview = vi.fn();
    const onCleanupWorktreeReview = vi.fn();
    const container = document.getElementById('root');
    expect(container).toBeTruthy();
    const root = createRoot(container!);

    await act(async () => {
      root.render(createElement(RunTranscriptTimeline, {
        items: [createWorktreeReviewTranscriptItem()],
        skills: [],
        runState: 'completed',
        onApplyWorktreeReview,
        onRejectWorktreeReview,
        onRevertWorktreeReview,
        onCleanupWorktreeReview
      }));
    });

    const buttons = Array.from(container!.querySelectorAll('button'));
    const applyButton = buttons.find((button) => button.textContent?.includes('Apply'));
    const rejectButton = buttons.find((button) => button.textContent?.includes('Reject'));
    expect(applyButton).toBeTruthy();
    expect(rejectButton).toBeTruthy();

    await act(async () => {
      applyButton!.click();
      rejectButton!.click();
    });

    expect(onApplyWorktreeReview).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1'
    });
    expect(onRejectWorktreeReview).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    await act(async () => {
      root.render(createElement(RunTranscriptTimeline, {
        items: [
          createWorktreeReviewTranscriptItem({
            status: 'applied',
            decision: {
              action: 'applied',
              status: 'applied',
              threadId: 'thread-1',
              runId: 'run-1',
              isolationMode: 'git_worktree',
              branchName: 'vicode/worktree/project-1/run-1',
              baseSha: 'abcdef1234567890',
              sourceWorkspaceRelativePath: 'packages/app',
              changedPaths: ['src/example.ts'],
              filesChanged: 1,
              insertions: 3,
              deletions: 1,
              errorReason: null,
              createdAt: '2026-03-16T00:00:03.000Z'
            }
          })
        ],
        skills: [],
        runState: 'completed',
        onApplyWorktreeReview,
        onRejectWorktreeReview,
        onRevertWorktreeReview,
        onCleanupWorktreeReview
      }));
    });

    const nextButtons = Array.from(container!.querySelectorAll('button'));
    const revertButton = nextButtons.find((button) => button.textContent?.includes('Revert'));
    const cleanupButton = nextButtons.find((button) => button.textContent?.includes('Clean up'));
    expect(revertButton).toBeTruthy();
    expect(cleanupButton).toBeTruthy();

    await act(async () => {
      revertButton!.click();
      cleanupButton!.click();
    });

    expect(onRevertWorktreeReview).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1'
    });
    expect(onCleanupWorktreeReview).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    await act(async () => {
      root.unmount();
    });
  });

  it('renders pending staged workspace changes with apply and reject actions only while pending', () => {
    const pendingHtml = renderToStaticMarkup(
      createElement(RunTranscriptTimeline, {
        items: [
          {
            id: 'staged-workspace:staged-1',
            kind: 'staged_workspace_change',
            label: 'Proposed workspace changes',
            change: {
              id: 'staged-workspace:staged-1',
              threadId: 'thread-1',
              runId: 'run-1',
              stagedEventId: 'staged-1',
              stagedEventIndex: 0,
              createdAt: '2026-03-16T00:00:02.000Z',
              sourceToolName: 'write_file',
              isolationMode: 'patch_buffer',
              status: 'pending',
              requestedPath: 'src/example.ts',
              changedPaths: ['src/example.ts'],
              operationCount: 1,
              operationKinds: ['write_file'],
              filesChanged: 1,
              insertions: 2,
              deletions: 1,
              decision: null
            }
          } satisfies RunTranscriptItem
        ],
        skills: [],
        runState: 'completed',
        onApplyStagedWorkspaceChange: async () => {},
        onRejectStagedWorkspaceChange: async () => {}
      })
    );

    expect(pendingHtml).toContain('Proposed workspace changes');
    expect(pendingHtml).toContain('write_file');
    expect(pendingHtml).toContain('src/example.ts');
    expect(pendingHtml).toContain('+2');
    expect(pendingHtml).toContain('-1');
    expect(pendingHtml).toContain('Apply');
    expect(pendingHtml).toContain('Reject');
    expect(pendingHtml).not.toContain('before-secret-token');
    expect(pendingHtml).not.toContain('after-secret-token');
    expect(pendingHtml).not.toContain('patch-secret-token');

    const appliedHtml = renderToStaticMarkup(
      createElement(RunTranscriptTimeline, {
        items: [
          {
            id: 'staged-workspace:staged-1',
            kind: 'staged_workspace_change',
            label: 'Proposed workspace changes',
            change: {
              id: 'staged-workspace:staged-1',
              threadId: 'thread-1',
              runId: 'run-1',
              stagedEventId: 'staged-1',
              stagedEventIndex: 0,
              createdAt: '2026-03-16T00:00:02.000Z',
              sourceToolName: 'write_file',
              isolationMode: 'patch_buffer',
              status: 'applied',
              requestedPath: 'src/example.ts',
              changedPaths: ['src/example.ts'],
              operationCount: 1,
              operationKinds: ['write_file'],
              filesChanged: 1,
              insertions: 2,
              deletions: 1,
              decision: {
                action: 'applied',
                status: 'applied',
                threadId: 'thread-1',
                runId: 'run-1',
                stagedEventId: 'staged-1',
                stagedEventIndex: 0,
                sourceToolName: 'write_file',
                isolationMode: 'patch_buffer',
                changedPaths: ['src/example.ts'],
                operationKinds: ['write_file'],
                errorReason: null,
                createdAt: '2026-03-16T00:00:03.000Z'
              }
            }
          } satisfies RunTranscriptItem
        ],
        skills: [],
        runState: 'completed',
        onApplyStagedWorkspaceChange: async () => {},
        onRejectStagedWorkspaceChange: async () => {},
        onRevertStagedWorkspaceChange: async () => {}
      })
    );

    expect(appliedHtml).toContain('Applied');
    expect(appliedHtml).toContain('Revert');
    expect(appliedHtml).not.toContain('Apply</span>');
    expect(appliedHtml).not.toContain('Reject</span>');

    const rejectedHtml = renderToStaticMarkup(
      createElement(RunTranscriptTimeline, {
        items: [
          {
            id: 'staged-workspace:staged-1',
            kind: 'staged_workspace_change',
            label: 'Proposed workspace changes',
            change: {
              id: 'staged-workspace:staged-1',
              threadId: 'thread-1',
              runId: 'run-1',
              stagedEventId: 'staged-1',
              stagedEventIndex: 0,
              createdAt: '2026-03-16T00:00:02.000Z',
              sourceToolName: 'write_file',
              isolationMode: 'patch_buffer',
              status: 'rejected',
              requestedPath: 'src/example.ts',
              changedPaths: ['src/example.ts'],
              operationCount: 1,
              operationKinds: ['write_file'],
              filesChanged: 1,
              insertions: 2,
              deletions: 1,
              decision: {
                action: 'rejected',
                status: 'rejected',
                threadId: 'thread-1',
                runId: 'run-1',
                stagedEventId: 'staged-1',
                stagedEventIndex: 0,
                sourceToolName: 'write_file',
                isolationMode: 'patch_buffer',
                changedPaths: ['src/example.ts'],
                operationKinds: ['write_file'],
                errorReason: null,
                createdAt: '2026-03-16T00:00:03.000Z'
              }
            }
          } satisfies RunTranscriptItem
        ],
        skills: [],
        runState: 'completed',
        onApplyStagedWorkspaceChange: async () => {},
        onRejectStagedWorkspaceChange: async () => {},
        onRevertStagedWorkspaceChange: async () => {}
      })
    );

    expect(rejectedHtml).toContain('Rejected');
    expect(rejectedHtml).not.toContain('Revert');
  });

  it('loads and renders a staged diff preview only after the user asks for it', async () => {
    const { document, window } = parseHTML('<html><body><div id="root"></div></body></html>');
    globalThis.window = window as unknown as typeof globalThis.window;
    globalThis.document = document as unknown as typeof globalThis.document;
    globalThis.HTMLElement = window.HTMLElement as unknown as typeof globalThis.HTMLElement;
    globalThis.MouseEvent = window.MouseEvent as unknown as typeof globalThis.MouseEvent;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    const stagedPreviewArtifact: RunChangeArtifact = {
      source: 'staged_workspace_preview' as const,
      summary: {
        filesChanged: 1,
        insertions: 2,
        deletions: 2
      },
      files: [
        {
          path: 'src/example.ts',
          status: 'modified' as const,
          insertions: 2,
          deletions: 2,
          beforeContent: [
            'line 1',
            'line 2 before-secret-token',
            'line 3',
            'line 4',
            'line 5',
            'line 6',
            'line 7',
            'line 8',
            'line 9',
            'line 10 before-secret-token',
            'line 11'
          ].join('\n'),
          afterContent: [
            'line 1',
            'line 2 after-secret-token',
            'line 3',
            'line 4',
            'line 5',
            'line 6',
            'line 7',
            'line 8',
            'line 9',
            'line 10 after-secret-token',
            'line 11'
          ].join('\n'),
          previewLines: [
            { type: 'context' as const, oldLineNumber: 1, newLineNumber: 1, text: 'line 1' },
            { type: 'removed' as const, oldLineNumber: 2, newLineNumber: null, text: 'line 2 before-secret-token' },
            { type: 'added' as const, oldLineNumber: null, newLineNumber: 2, text: 'line 2 after-secret-token' },
            { type: 'context' as const, oldLineNumber: 3, newLineNumber: 3, text: 'line 3' },
            { type: 'context' as const, oldLineNumber: 4, newLineNumber: 4, text: 'line 4' },
            { type: 'context' as const, oldLineNumber: 5, newLineNumber: 5, text: 'line 5' },
            { type: 'context' as const, oldLineNumber: 6, newLineNumber: 6, text: 'line 6' },
            { type: 'context' as const, oldLineNumber: 7, newLineNumber: 7, text: 'line 7' },
            { type: 'context' as const, oldLineNumber: 8, newLineNumber: 8, text: 'line 8' },
            { type: 'context' as const, oldLineNumber: 9, newLineNumber: 9, text: 'line 9' },
            { type: 'removed' as const, oldLineNumber: 10, newLineNumber: null, text: 'line 10 before-secret-token' },
            { type: 'added' as const, oldLineNumber: null, newLineNumber: 10, text: 'line 10 after-secret-token' },
            { type: 'context' as const, oldLineNumber: 11, newLineNumber: 11, text: 'line 11' }
          ],
          previewTruncated: false
        }
      ]
    };
    const [firstHunk, secondHunk] = parseRunChangeHunks(stagedPreviewArtifact).hunks;
    expect(firstHunk).toBeTruthy();
    expect(secondHunk).toBeTruthy();
    const loadStagedWorkspacePreview = vi.fn(async () => stagedPreviewArtifact);
    const onApplyStagedWorkspaceHunks = vi.fn();
    const onRejectStagedWorkspaceHunks = vi.fn();
    const onRevertStagedWorkspaceHunks = vi.fn();

    const container = document.getElementById('root');
    expect(container).toBeTruthy();
    const root = createRoot(container!);

    await act(async () => {
      root.render(createElement(RunTranscriptTimeline, {
        items: [
          {
            id: 'staged-workspace:staged-1',
            kind: 'staged_workspace_change',
            label: 'Proposed workspace changes',
            change: {
              id: 'staged-workspace:staged-1',
              threadId: 'thread-1',
              runId: 'run-1',
              stagedEventId: 'staged-1',
              stagedEventIndex: 0,
              createdAt: '2026-03-16T00:00:02.000Z',
              sourceToolName: 'write_file',
              isolationMode: 'patch_buffer',
              status: 'pending',
              requestedPath: 'src/example.ts',
              changedPaths: ['src/example.ts'],
              operationCount: 1,
              operationKinds: ['write_file'],
              filesChanged: 1,
              insertions: 1,
              deletions: 1,
              decision: null
            }
          } satisfies RunTranscriptItem
        ],
        skills: [],
        runState: 'completed',
        loadStagedWorkspacePreview,
        onApplyStagedWorkspaceChange: async () => {},
        onRejectStagedWorkspaceChange: async () => {},
        onApplyStagedWorkspaceHunks,
        onRejectStagedWorkspaceHunks
      }));
    });

    expect(container!.textContent).toContain('View diff');
    expect(container!.textContent).not.toContain('before-secret-token');
    expect(container!.textContent).not.toContain('after-secret-token');

    const viewDiffButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('View diff')
    );
    expect(viewDiffButton).toBeTruthy();

    await act(async () => {
      viewDiffButton!.click();
    });

    expect(loadStagedWorkspacePreview).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'staged-1',
      stagedEventIndex: 0
    });
    expect(container!.textContent).toContain('Staged diff preview');
    expect(container!.textContent).toContain('src/example.ts');

    const fileDiffButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('src/example.ts')
    );
    expect(fileDiffButton).toBeTruthy();

    await act(async () => {
      fileDiffButton!.click();
    });

    expect(container!.textContent).toContain('Hunk review');
    expect(container!.textContent).toContain('Apply hunk');
    expect(container!.textContent).toContain('Reject hunk');
    expect(container!.textContent).not.toContain('patch-secret-token');

    const applyHunkButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Apply hunk')
    );
    const rejectHunkButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Reject hunk')
    );
    expect(applyHunkButton).toBeTruthy();
    expect(rejectHunkButton).toBeTruthy();

    await act(async () => {
      applyHunkButton!.click();
      rejectHunkButton!.click();
    });

    expect(onApplyStagedWorkspaceHunks).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'staged-1',
      stagedEventIndex: 0,
      acceptedHunkIds: [firstHunk!.id],
      rejectedHunkIds: []
    });
    expect(onRejectStagedWorkspaceHunks).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'staged-1',
      stagedEventIndex: 0,
      hunkIds: [firstHunk!.id]
    });

    await act(async () => {
      root.render(createElement(RunTranscriptTimeline, {
        items: [
          {
            id: 'staged-workspace:staged-1',
            kind: 'staged_workspace_change',
            label: 'Proposed workspace changes',
            change: {
              id: 'staged-workspace:staged-1',
              threadId: 'thread-1',
              runId: 'run-1',
              stagedEventId: 'staged-1',
              stagedEventIndex: 0,
              createdAt: '2026-03-16T00:00:02.000Z',
              sourceToolName: 'write_file',
              isolationMode: 'patch_buffer',
              status: 'pending',
              requestedPath: 'src/example.ts',
              changedPaths: ['src/example.ts'],
              operationCount: 1,
              operationKinds: ['write_file'],
              filesChanged: 1,
              insertions: 2,
              deletions: 2,
              decision: null,
              hunkDecision: {
                action: 'applied',
                status: 'applied',
                threadId: 'thread-1',
                runId: 'run-1',
                source: 'staged_workspace_preview',
                isolationMode: 'patch_buffer',
                stagedEventId: 'staged-1',
                stagedEventIndex: 0,
                changedPaths: ['src/example.ts'],
                hunkIds: [firstHunk!.id, secondHunk!.id],
                acceptedHunkIds: [firstHunk!.id],
                rejectedHunkIds: [secondHunk!.id],
                filesChanged: 1,
                insertions: 1,
                deletions: 1,
                errorReason: null,
                createdAt: '2026-03-16T00:00:04.000Z'
              }
            }
          } satisfies RunTranscriptItem
        ],
        skills: [],
        runState: 'completed',
        loadStagedWorkspacePreview,
        onApplyStagedWorkspaceChange: async () => {},
        onRejectStagedWorkspaceChange: async () => {},
        onApplyStagedWorkspaceHunks,
        onRejectStagedWorkspaceHunks,
        onRevertStagedWorkspaceHunks
      }));
    });

    expect(container!.textContent).toContain('Applied');
    expect(container!.textContent).toContain('Rejected');
    expect(container!.textContent).toContain('Revert hunks');
    expect(Array.from(container!.querySelectorAll('button')).some((button) =>
      button.textContent?.includes('Apply hunk')
    )).toBe(false);
    expect(Array.from(container!.querySelectorAll('button')).some((button) =>
      button.textContent?.includes('Reject hunk')
    )).toBe(false);

    const revertHunksButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Revert hunks')
    );
    expect(revertHunksButton).toBeTruthy();

    await act(async () => {
      revertHunksButton!.click();
    });

    expect(onRevertStagedWorkspaceHunks).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'staged-1',
      stagedEventIndex: 0
    });

    await act(async () => {
      root.unmount();
    });
  });

  it('renders worktree hunk controls inside the existing worktree diff card', async () => {
    const { document, window } = parseHTML('<html><body><div id="root"></div></body></html>');
    globalThis.window = window as unknown as typeof globalThis.window;
    globalThis.document = document as unknown as typeof globalThis.document;
    globalThis.HTMLElement = window.HTMLElement as unknown as typeof globalThis.HTMLElement;
    globalThis.MouseEvent = window.MouseEvent as unknown as typeof globalThis.MouseEvent;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    const worktreeArtifact: RunChangeArtifact = {
      source: 'worktree_diff' as const,
      summary: {
        filesChanged: 1,
        insertions: 2,
        deletions: 2
      },
      files: [
        {
          path: 'src/example.ts',
          status: 'modified' as const,
          insertions: 2,
          deletions: 2,
          beforeContent: [
            'line 1',
            'line 2 before-secret-token',
            'line 3',
            'line 4',
            'line 5',
            'line 6',
            'line 7',
            'line 8',
            'line 9',
            'line 10 before-secret-token',
            'line 11'
          ].join('\n'),
          afterContent: [
            'line 1',
            'line 2 after-secret-token',
            'line 3',
            'line 4',
            'line 5',
            'line 6',
            'line 7',
            'line 8',
            'line 9',
            'line 10 after-secret-token',
            'line 11'
          ].join('\n'),
          previewLines: [
            { type: 'context' as const, oldLineNumber: 1, newLineNumber: 1, text: 'line 1' },
            { type: 'removed' as const, oldLineNumber: 2, newLineNumber: null, text: 'line 2 before-secret-token' },
            { type: 'added' as const, oldLineNumber: null, newLineNumber: 2, text: 'line 2 after-secret-token' },
            { type: 'context' as const, oldLineNumber: 3, newLineNumber: 3, text: 'line 3' },
            { type: 'context' as const, oldLineNumber: 4, newLineNumber: 4, text: 'line 4' },
            { type: 'context' as const, oldLineNumber: 5, newLineNumber: 5, text: 'line 5' },
            { type: 'context' as const, oldLineNumber: 6, newLineNumber: 6, text: 'line 6' },
            { type: 'context' as const, oldLineNumber: 7, newLineNumber: 7, text: 'line 7' },
            { type: 'context' as const, oldLineNumber: 8, newLineNumber: 8, text: 'line 8' },
            { type: 'context' as const, oldLineNumber: 9, newLineNumber: 9, text: 'line 9' },
            { type: 'removed' as const, oldLineNumber: 10, newLineNumber: null, text: 'line 10 before-secret-token' },
            { type: 'added' as const, oldLineNumber: null, newLineNumber: 10, text: 'line 10 after-secret-token' },
            { type: 'context' as const, oldLineNumber: 11, newLineNumber: 11, text: 'line 11' }
          ],
          previewTruncated: false
        }
      ]
    };
    const [firstHunk, secondHunk] = parseRunChangeHunks(worktreeArtifact).hunks;
    expect(firstHunk).toBeTruthy();
    expect(secondHunk).toBeTruthy();
    const onApplyWorktreeHunks = vi.fn();
    const onRejectWorktreeHunks = vi.fn();
    const onRevertWorktreeHunks = vi.fn();

    const container = document.getElementById('root');
    expect(container).toBeTruthy();
    const root = createRoot(container!);

    await act(async () => {
      root.render(createElement(RunTranscriptTimeline, {
        items: [
          createWorktreeReviewTranscriptItem({
            artifact: worktreeArtifact,
            changedPaths: ['src/example.ts'],
            insertions: 2,
            deletions: 2
          })
        ],
        skills: [],
        runState: 'completed',
        onApplyWorktreeReview: async () => {},
        onRejectWorktreeReview: async () => {},
        onRevertWorktreeReview: async () => {},
        onCleanupWorktreeReview: async () => {},
        onApplyWorktreeHunks,
        onRejectWorktreeHunks
      }));
    });

    expect(container!.textContent).toContain('Worktree diff');

    const fileDiffButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('src/example.ts')
    );
    expect(fileDiffButton).toBeTruthy();

    await act(async () => {
      fileDiffButton!.click();
    });

    expect(container!.textContent).toContain('Hunk review');
    expect(container!.textContent).toContain('Apply hunk');
    expect(container!.textContent).toContain('Reject hunk');

    const applyHunkButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Apply hunk')
    );
    const rejectHunkButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Reject hunk')
    );
    expect(applyHunkButton).toBeTruthy();
    expect(rejectHunkButton).toBeTruthy();

    await act(async () => {
      applyHunkButton!.click();
      rejectHunkButton!.click();
    });

    expect(onApplyWorktreeHunks).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1',
      acceptedHunkIds: [firstHunk!.id],
      rejectedHunkIds: []
    });
    expect(onRejectWorktreeHunks).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1',
      hunkIds: [firstHunk!.id]
    });

    await act(async () => {
      root.render(createElement(RunTranscriptTimeline, {
        items: [
          createWorktreeReviewTranscriptItem({
            artifact: worktreeArtifact,
            changedPaths: ['src/example.ts'],
            insertions: 2,
            deletions: 2,
            hunkDecision: {
              action: 'applied',
              status: 'applied',
              threadId: 'thread-1',
              runId: 'run-1',
              source: 'worktree_diff',
              isolationMode: 'git_worktree',
              branchName: 'vicode/worktree/project-1/run-1',
              baseSha: 'abcdef1234567890',
              sourceWorkspaceRelativePath: 'packages/app',
              changedPaths: ['src/example.ts'],
              hunkIds: [firstHunk!.id, secondHunk!.id],
              acceptedHunkIds: [firstHunk!.id],
              rejectedHunkIds: [secondHunk!.id],
              filesChanged: 1,
              insertions: 1,
              deletions: 1,
              errorReason: null,
              createdAt: '2026-03-16T00:00:04.000Z'
            }
          })
        ],
        skills: [],
        runState: 'completed',
        onApplyWorktreeReview: async () => {},
        onRejectWorktreeReview: async () => {},
        onRevertWorktreeReview: async () => {},
        onCleanupWorktreeReview: async () => {},
        onApplyWorktreeHunks,
        onRejectWorktreeHunks,
        onRevertWorktreeHunks
      }));
    });

    expect(container!.textContent).toContain('Applied');
    expect(container!.textContent).toContain('Rejected');
    expect(container!.textContent).toContain('Revert hunks');
    expect(Array.from(container!.querySelectorAll('button')).some((button) =>
      button.textContent?.includes('Apply hunk')
    )).toBe(false);
    expect(Array.from(container!.querySelectorAll('button')).some((button) =>
      button.textContent?.includes('Reject hunk')
    )).toBe(false);

    const revertHunksButton = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Revert hunks')
    );
    expect(revertHunksButton).toBeTruthy();

    await act(async () => {
      revertHunksButton!.click();
    });

    expect(onRevertWorktreeHunks).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    await act(async () => {
      root.unmount();
    });
  });

  it('hides noisy tool details by default while keeping the worked summary and final answer visible', () => {
    const html = renderToStaticMarkup(
      createElement(RunTranscriptTimeline, {
        items: [
          createActivityItem('web-search', 'tool_call', {
            toolName: 'web_search',
            label: 'Searching the web',
            text: 'Search query: roofing business hero image unsplash'
          }),
          createActivityItem('web-failure', 'tool_result', {
            toolName: 'extract_web_page',
            label: 'Could not read the web page',
            text: 'Page URL: https://unsplash.com/s/photos/roofing\nHTTP 401'
          }),
          createActivityItem('mkdir', 'mkdir', {
            label: 'Created folder',
            text: 'Folder: roofing-landing-page',
            path: 'roofing-landing-page'
          }),
          createActivityItem('command', 'terminal_command', {
            command: 'Get-ChildItem',
            status: 'completed',
            outputLines: ['memory', 'roofing-landing-page']
          }),
          {
            id: 'worked-for',
            kind: 'worked_for',
            label: 'Worked for 15s'
          },
          {
            id: 'assistant-final',
            kind: 'assistant_text',
            text: 'I found that the request stopped after creating folders.'
          }
        ] satisfies RunTranscriptItem[],
        skills: [],
        runState: 'completed'
      })
    );

    expect(html).toContain('Worked for 15s');
    expect(html).toContain('4 previous steps');
    expect(html).toContain('I found that the request stopped after creating folders.');
    expect(html).not.toContain('2 research steps');
    expect(html).not.toContain('1 file change');
    expect(html).not.toContain('Ran 1 command');
    expect(html).not.toContain('Search query: roofing business hero image unsplash');
    expect(html).not.toContain('Page URL: https://unsplash.com/s/photos/roofing');
    expect(html).not.toContain('Created folder');
    expect(html).not.toContain('$ Get-ChildItem');
  });

  it('renders automatic context compaction as a transcript divider without backend detail', () => {
    const html = renderToStaticMarkup(
      createElement(RunTranscriptTimeline, {
        items: [
          {
            id: 'context-compaction',
            kind: 'activity_line',
            activityKind: 'context_compaction',
            toolName: null,
            label: 'Context automatically compacted',
            text: 'Older thread context was summarized so the run can continue within the model context window.',
            url: null,
            path: 'thread_compactions.compaction-1',
            command: null,
            cwd: null,
            isolationMode: null,
            status: null,
            startedAt: null,
            finishedAt: null,
            durationLabel: null,
            outputLines: []
          } satisfies RunTranscriptItem
        ],
        skills: [],
        runState: 'completed',
        compactActivity: false
      })
    );

    expect(html).toContain('run-transcript-context-divider');
    expect(html).toContain('Context automatically compacted');
    expect(html).not.toContain('Older thread context');
    expect(html).not.toContain('thread_compactions.compaction-1');
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
        runState: 'completed',
        workspaceRoot: 'D:\\Projects\\demo-app'
      })
    );

    expect(html).toContain('Summary');
    expect(html).toContain('Implemented the sidebar thread connector polish.');
    expect(html).toContain('Changed');
    expect(html).toContain('Verified');
    expect(html).toContain('turn-reference-link');
    expect(html).toContain('data-reference-kind="file"');
    expect(html).toContain('data-icon-slug="css"');
    expect(html).toContain('title="D:\\Projects\\demo-app\\src\\renderer\\styles\\sidebar.css"');
    expect(html).not.toContain('Resolved');
    expect(html).not.toContain('Outcome');
  });

  it('renders failed missing-write summaries under the compact worked summary', () => {
    const html = renderToStaticMarkup(
      createElement(RunTranscriptTimeline, {
        items: [
          {
            id: 'summary',
            kind: 'resolution_summary',
            outcome: 'No page files were written. Created only roofing-landing before the provider stopped.',
            filesChanged: ['roofing-landing'],
            toolsUsed: [],
            verificationCommands: [],
            remainingRisk: 'No file-content writes were recorded before failure.'
          },
          createActivityItem('thinking', 'thinking', {
            label: 'Let me create the landing page.',
            text: 'Let me create the landing page.'
          }),
          createActivityItem('mkdir', 'mkdir', {
            label: 'Created folder',
            text: 'Folder: roofing-landing',
            path: 'roofing-landing'
          }),
          {
            id: 'worked-for',
            kind: 'worked_for',
            label: 'Worked for 5s'
          }
        ] satisfies RunTranscriptItem[],
        skills: [],
        runState: 'failed'
      })
    );

    expect(html).toContain('Worked for 5s');
    expect(html).toContain('2 previous steps');
    expect(html).toContain('No page files were written. Created only roofing-landing before the provider stopped.');
    expect(html).toContain('No file-content writes were recorded before failure.');
    expect(html).not.toContain('Reasoning');
    expect(html).not.toContain('Let me create the landing page.');
    expect(html).not.toContain('Folder: roofing-landing');
  });
});
