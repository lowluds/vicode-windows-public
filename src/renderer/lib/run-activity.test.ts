import { describe, expect, it } from 'vitest';
import type { RunEvent, RunProgressState, ThreadDetail } from '../../shared/domain';
import {
  deriveRunActivityMap,
  deriveRunReviewEvidence,
  deriveRunTranscriptItemsMap,
  deriveStagedWorkspaceReviewItems,
  deriveWorktreeReviewItems
} from './run-activity';

function createThreadDetail(rawOutput: ThreadDetail['rawOutput'], overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Test thread',
    providerId: 'gemini',
    modelId: 'gemini-2.5-pro',
    status: 'running',
    executionPermission: 'default',
    createdAt: '2026-03-16T00:00:00.000Z',
    updatedAt: '2026-03-16T00:00:10.000Z',
    archived: false,
    lastMessageAt: '2026-03-16T00:00:10.000Z',
    lastPreview: '',
    turns: [],
    rawOutput,
    followUps: [],
    planner: {
      threadId: 'thread-1',
      composerMode: 'default',
      turnState: 'idle',
      pendingQuestionCallId: null,
      pendingQuestionSet: null,
      activePlanId: null,
      activePlan: null,
      updatedAt: '2026-03-16T00:00:10.000Z'
    },
    ...overrides
  };
}

describe('deriveRunActivityMap', () => {
  it('shows user-facing model capability failures without raw JSON envelopes', () => {
    const rawError = '{"error":"this model does not support image input (ref: e1e07aae-e61d-45ad-b4a2-f680e2481657)"}';
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'tool-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            status: 'error',
            summary: rawError,
            text: rawError
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'failed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'failed',
        payload: {
          message: rawError
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    const transcript = deriveRunTranscriptItemsMap(thread)['run-1'];

    expect(activity.outcomeMessage).toBe(
      'This model does not support image input. Choose a model with image support and try again.'
    );
    expect(JSON.stringify(transcript)).toContain(
      'This model does not support image input. Choose a model with image support and try again.'
    );
    expect(JSON.stringify(transcript)).not.toContain('{"error"');
    expect(JSON.stringify(transcript)).not.toContain('e1e07aae');
  });

  it('keeps an active terminal command in place when later output arrives', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'cmd-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          message: 'Running npm install',
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm install',
            command: 'npm install',
            isolationMode: 'host_job_object_temp_profile'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'thinking',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          message: 'Reviewing the current app shell before editing.',
          activity: {
            kind: 'thinking',
            summary: 'Reviewing the current app shell before editing.',
            text: 'Reviewing the current app shell before editing.'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'cmd-output',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          message: 'installed packages',
          activity: {
            kind: 'terminal_output',
            summary: 'installed packages',
            text: 'installed packages',
            outputLines: ['installed packages']
          }
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];

    expect(activity.timelineItems.map((item) => item.kind)).toEqual(['terminal_command', 'thinking']);
    expect(activity.terminalCommands[0]?.outputLines).toContain('installed packages');
    expect(activity.terminalCommands[0]?.isolationMode).toBe('host_job_object_temp_profile');
    expect(activity.activeHeading).toBe('Working');
  });

  it('keeps an active run in thinking until a concrete action arrives', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'thinking',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          message: 'Reviewing the current app shell before editing.',
          activity: {
            kind: 'thinking',
            summary: 'Reviewing the current app shell before editing.',
            text: 'Reviewing the current app shell before editing.'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'file-read',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          message: 'Read src/renderer/app.tsx',
          activity: {
            kind: 'file_read',
            summary: 'Read src/renderer/app.tsx',
            path: 'src/renderer/app.tsx'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];

    expect(activity.thinkingLines[0]?.kind).toBe('thinking');
    expect(activity.thinkingLines[1]?.kind).toBe('file_read');
    expect(activity.activeHeading).toBe('Working');
  });

  it('keeps web-search activity visible and counts it as active work', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'web-search',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'web_search',
            summary: 'Searching web for Ollama command UI patterns',
            text: 'Searching web for Ollama command UI patterns',
            url: 'https://example.com/search'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.thinkingLines).toEqual([
      expect.objectContaining({
        kind: 'web_search',
        label: 'Searching web for Ollama command UI patterns'
      })
    ]);
    expect(activity.activeHeading).toBe('Working');

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'web_search',
        label: 'Searching web for Ollama command UI patterns'
      })
    ]);
  });

  it('compacts redundant web-search tool results before concrete web-search evidence', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'web-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Completed web_search',
            toolName: 'web_search',
            status: 'completed',
            text: 'query: Ollama Windows app tooling'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'web-search',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'web_search',
            phase: 'completed',
            summary: 'Searched web for Ollama Windows app tooling',
            query: 'Ollama Windows app tooling',
            status: 'completed'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      }
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'web_search',
        label: 'Searched web for Ollama Windows app tooling'
      })
    ]);
  });

  it('surfaces Vicode guidance context when explicitly marked visible', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'guidance',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'guidance',
            summary: 'Context: Source-Backed Workflow',
            text: 'Context: Source-Backed Workflow',
            providerEventType: 'vicode_guidance_context'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.thinkingLines).toEqual([
      expect.objectContaining({
        kind: 'guidance',
        label: 'Context: Source-Backed Workflow'
      })
    ]);
    expect(activity.activeHeading).toBe('Working');

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'guidance',
        label: 'Context: Source-Backed Workflow'
      })
    ]);
  });

  it('hides Vicode guidance context when it is marked as control-plane detail', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'guidance',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          transcriptVisible: false,
          activity: {
            kind: 'guidance',
            summary: 'Context: Source-Backed Workflow',
            text: 'Context: Source-Backed Workflow',
            providerEventType: 'vicode_guidance_context'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:02.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.thinkingLines).toEqual([]);
    expect(activity.activeHeading).toBeNull();

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([]);
  });

  it('normalizes raw research tool names into friendly transcript copy', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'tool-call',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_call',
            summary: 'Calling web_search',
            toolName: 'web_search',
            text: 'query: Toronto weather\nmax results: 3'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'tool-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Completed extract_web_page',
            toolName: 'extract_web_page',
            status: 'completed',
            text: 'url: https://example.com/weather\nquery: snowfall'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.thinkingLines).toEqual([
      expect.objectContaining({
        kind: 'tool_call',
        label: 'Searching the web',
        text: 'Search query: Toronto weather\nResults limit: 3'
      }),
      expect.objectContaining({
        kind: 'tool_result',
        label: 'Read the web page',
        text: 'Page URL: https://example.com/weather\nFocus: snowfall'
      })
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'tool_call',
        label: 'Searching the web',
        text: 'Search query: Toronto weather\nResults limit: 3'
      }),
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'tool_result',
        label: 'Read the web page',
        text: 'Page URL: https://example.com/weather\nFocus: snowfall'
      })
    ]);
  });

  it('normalizes browser preview tool telemetry into concise transcript copy', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'preview-call',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_call',
            summary: 'Calling browser_preview_check',
            toolName: 'browser_preview_check',
            text: 'url: http://localhost:4173/\nexpected text: launch ready'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'preview-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Completed browser_preview_check',
            toolName: 'browser_preview_check',
            status: 'completed',
            url: 'http://localhost:4173/',
            text: 'Status: passed\nURL: http://localhost:4173/\nConsole errors: 0\nLoad errors: 0'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:02.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.thinkingLines).toEqual([
      expect.objectContaining({
        kind: 'tool_call',
        label: 'Checking preview',
        text: 'Preview URL: http://localhost:4173/\nExpected text: launch ready'
      }),
      expect.objectContaining({
        kind: 'tool_result',
        label: 'Checked preview',
        text: 'Status: passed\nPreview URL: http://localhost:4173/\nConsole errors: 0\nLoad errors: 0'
      })
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'tool_call',
        label: 'Checking preview',
        text: 'Preview URL: http://localhost:4173/\nExpected text: launch ready'
      }),
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'tool_result',
        label: 'Checked preview',
        text: 'Status: passed\nPreview URL: http://localhost:4173/\nConsole errors: 0\nLoad errors: 0'
      }),
      expect.objectContaining({
        kind: 'worked_for',
        label: 'Worked for 2s'
      })
    ]);
  });

  it('renders additive tool telemetry as timeline activity without breaking assistant output', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'tool-call',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_call',
            summary: 'Calling read_file',
            toolName: 'read_file',
            text: 'path: src/example.ts'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'file-read',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_read',
            summary: 'Read src/example.ts',
            path: 'src/example.ts'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'tool-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Completed read_file',
            toolName: 'read_file',
            status: 'completed'
          }
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'I found the config issue.'
        },
        createdAt: '2026-03-16T00:00:04.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:05.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.thinkingLines.map((line) => line.kind)).toEqual(['tool_call', 'file_read', 'tool_result']);
    expect(activity.timelineItems.map((item) => item.kind)).toEqual(['thinking', 'thinking', 'thinking']);
    expect(activity.activeHeading).toBeNull();

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'file_read',
        label: 'Read src/example.ts'
      }),
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'I found the config issue.'
      })
    ]);
  });

  it('uses the persisted assistant turn content and sources as the canonical transcript response', () => {
    const sources = [
      {
        url: 'https://react.dev/reference/react/useState',
        title: 'React useState',
        snippet: 'useState lets you add state to your component.',
        excerpt: null
      }
    ];
    const thread = createThreadDetail(
      [
        {
          id: 'started',
          threadId: 'thread-1',
          runId: 'run-1',
          eventType: 'started',
          payload: {},
          createdAt: '2026-03-16T00:00:00.000Z'
        },
        {
          id: 'completed',
          threadId: 'thread-1',
          runId: 'run-1',
          eventType: 'completed',
          payload: {},
          createdAt: '2026-03-16T00:00:02.000Z'
        }
      ],
      {
        status: 'completed',
        turns: [
          {
            id: 'assistant-turn',
            threadId: 'thread-1',
            runId: 'run-1',
            role: 'assistant',
            content: 'I replaced the stale hook example and attached the source.',
            sources,
            metadata: { sources },
            createdAt: '2026-03-16T00:00:02.000Z'
          }
        ]
      }
    );

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'I replaced the stale hook example and attached the source.',
        sources
      })
    ]);
  });

  it('suppresses generic tool-call rows when a concrete command row immediately follows', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'tool-call',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_call',
            summary: 'Calling run_command',
            toolName: 'run_command',
            text: 'command: npm test'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'terminal-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm test',
            command: 'npm test',
            cwd: '.'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'terminal_command',
        label: 'Running npm test',
        cwd: 'Workspace root'
      }),
      expect.objectContaining({
        kind: 'worked_for',
        label: 'Worked for 3s'
      })
    ]);
  });

  it('suppresses generic list-directory tool-call rows when a concrete inspection row immediately follows', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'tool-call',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_call',
            summary: 'Calling list_directory',
            toolName: 'list_directory',
            text: 'path: .'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'file-open',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_open',
            summary: 'Opened Workspace root',
            path: 'Workspace root'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      }
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'file_open',
        label: 'Opened Workspace root'
      })
    ]);
  });

  it('compacts adjacent file inspection activity into a single grouped transcript row', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'file-open',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_open',
            summary: 'Opened src/renderer/app.tsx',
            path: 'src/renderer/app.tsx'
          }
        },
        createdAt: '2026-03-16T00:00:00.500Z'
      },
      {
        id: 'file-read',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_read',
            summary: 'Read src/renderer/lib/run-activity.ts',
            path: 'src/renderer/lib/run-activity.ts'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'file-search',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_search',
            summary: 'Searched src/providers for run-activity',
            path: 'src/providers'
          }
        },
        createdAt: '2026-03-16T00:00:01.500Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'The transcript path is split across providers and renderer helpers.'
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems[0]).toEqual(
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'inspection_group',
        label: 'Inspected 3 files',
        text: 'src/renderer/app.tsx\nsrc/renderer/lib/run-activity.ts\nsrc/providers'
      })
    );
    expect(transcriptItems[1]).toEqual(
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'The transcript path is split across providers and renderer helpers.'
      })
    );
  });

  it('does not show worked time for a simple reply with no substantive task evidence', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'delta-1',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'Yes, that makes sense.'
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:05.000Z'
      }
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'Yes, that makes sense.'
      })
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.workedForLabel).toBeNull();
  });

  it('keeps failed tool results visible while suppressing successful duplicates', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'terminal-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm --version · Workspace root',
            command: 'npm --version',
            cwd: '.',
            status: 'started'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'terminal-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Completed run command',
            toolName: 'run_command',
            status: 'completed'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'terminal-error',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Failed run command',
            toolName: 'run_command',
            status: 'error',
            text: 'run_command was not approved by the user.'
          }
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'terminal_command',
        label: 'Running npm --version',
        cwd: 'Workspace root'
      }),
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'tool_result',
        label: 'Command denied',
        text: 'Command was not approved by the user.'
      })
    ]);
  });

  it('suppresses generic successful tool results when they add no detail beyond the richer action row', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'file-open',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_open',
            summary: 'Opened package.json',
            path: 'package.json'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'tool-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Opened package.json',
            toolName: 'open_file',
            status: 'completed'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'meaningful-tool-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Completed analyze_config',
            toolName: 'analyze_config',
            status: 'completed',
            text: 'Found 2 stale config references.'
          }
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'file_open',
        label: 'Opened package.json'
      }),
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'tool_result',
        label: 'Completed analyze_config',
        text: 'Found 2 stale config references.'
      })
    ]);
  });

  it('compacts adjacent mkdir and file-write activity into one filesystem change row', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'mkdir',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'mkdir',
            summary: 'Created src/generated',
            path: 'src/generated'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'file-write',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_write',
            summary: 'Patched src/example.ts',
            path: 'src/example.ts'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.thinkingLines.map((line) => line.kind)).toEqual(['mkdir', 'file_write']);
    expect(activity.activeHeading).toBe('Working');

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'write_group',
        label: 'Applied 2 filesystem changes',
        text: 'src/generated\nsrc/example.ts'
      })
    ]);
  });

  it('keeps internal Ollama runtime reminders in top reasoning but suppresses duplicate transcript rows', () => {
    const reminder = [
      'Internal runtime reminder:',
      'The user asked for actual workspace changes.',
      'Do not stop at inspection or explanation while the requested files are still unchanged.'
    ].join('\n');

    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'ollama-reminder',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          message: 'Prompting Ollama to continue until the requested workspace changes are complete.',
          activity: {
            kind: 'thinking',
            summary: 'Prompting Ollama to continue until the requested workspace changes are complete.',
            text: reminder,
            providerEventType: 'ollama_tool_loop_thinking'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.thinkingLines).toEqual([
      expect.objectContaining({
        kind: 'thinking',
        label: 'Prompting Ollama to continue until the requested workspace changes are complete.',
        text: reminder
      })
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([]);
  });

  it('does not render hidden control-plane events in activity or transcript projections', () => {
    const reminder = [
      'Internal runtime reminder:',
      'The user asked for actual workspace changes.',
      'If the required edits are not complete yet, call the next relevant write-capable tool now.'
    ].join('\n');

    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'hidden-reminder',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          eventKind: 'internal_runtime_reminder',
          transcriptVisible: false,
          message: 'Prompting model to continue writing files.',
          activity: {
            kind: 'thinking',
            summary: 'Prompting model to continue writing files.',
            text: reminder,
            providerEventType: 'ollama_tool_loop_thinking'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'hidden-diagnostic',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          eventKind: 'provider_diagnostic',
          transcriptVisible: false,
          providerDiagnostics: {
            providerEventType: 'item/completed',
            itemKeys: ['raw_json'],
            classification: 'unclassified'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'failed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'failed',
        payload: {
          message: 'No page files were written. Created only roofing-landing before the provider stopped.'
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.thinkingLines).toEqual([]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    const transcriptText = JSON.stringify(transcriptItems);
    expect(transcriptText).toContain('No page files were written');
    expect(transcriptText).not.toContain('Internal runtime reminder');
    expect(transcriptText).not.toContain('write-capable tool');
    expect(transcriptText).not.toContain('item/completed');
    expect(transcriptText).not.toContain('raw_json');
  });

  it('renders mkdir results with a folder label instead of raw tool phrasing', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'mkdir-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Completed mkdir',
            toolName: 'mkdir',
            status: 'success',
            text: 'path: portfolite\nresult: created directory'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.thinkingLines).toEqual([
      expect.objectContaining({
        kind: 'tool_result',
        label: 'Created folder',
        text: 'Folder: portfolite\nresult: created directory'
      })
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(Array.isArray(transcriptItems)).toBe(true);
  });

  it('normalizes core workspace tool telemetry into concise transcript copy', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'read-call',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_call',
            summary: 'Calling read_file',
            toolName: 'read_file',
            text: 'path: src/app.tsx'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'search-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Completed search_text',
            toolName: 'search_text',
            status: 'completed',
            text: 'query: browser_preview_check\npath: src\nmax_results: 5'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'write-call',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_call',
            summary: 'Calling write_file',
            toolName: 'write_file',
            text: 'path: README.md\ncontent: # Long generated content'
          }
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'patch-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Completed apply_patch',
            toolName: 'apply_patch',
            status: 'completed',
            text: 'patch: *** Begin Patch ...'
          }
        },
        createdAt: '2026-03-16T00:00:04.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.thinkingLines).toEqual([
      expect.objectContaining({
        kind: 'tool_call',
        label: 'Reading file',
        text: 'File: src/app.tsx'
      }),
      expect.objectContaining({
        kind: 'tool_result',
        label: 'Searched workspace',
        text: 'Search query: browser_preview_check\nPath: src\nResults limit: 5'
      }),
      expect.objectContaining({
        kind: 'tool_call',
        label: 'Writing file',
        text: 'File: README.md\nContent: provided'
      }),
      expect.objectContaining({
        kind: 'tool_result',
        label: 'Applied patch',
        text: 'Patch: provided'
      })
    ]);
  });

  it('normalizes advanced skill and helper tool telemetry into concise transcript copy', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'skill-call',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_call',
            summary: 'Calling create_skill_bundle',
            toolName: 'create_skill_bundle',
            text: 'folder_name: ux-review\nscope: project\nfiles: [{ "path": "SKILL.md" }]'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'skill-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Completed create_skill_bundle',
            toolName: 'create_skill_bundle',
            status: 'completed',
            text: 'folder_name: ux-review'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'plugin-call',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_call',
            summary: 'Calling create_plugin_bundle',
            toolName: 'create_plugin_bundle',
            text: 'folder_name: project-tools\nscope: global\nfiles: [{ "path": ".mcp.json" }]'
          }
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'delegate-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Completed spawn_subagents',
            toolName: 'spawn_subagents',
            status: 'completed',
            text: 'tasks: [{ "title": "Verify settings copy" }]'
          }
        },
        createdAt: '2026-03-16T00:00:04.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];

    expect(activity.thinkingLines).toEqual([
      expect.objectContaining({
        kind: 'tool_call',
        label: 'Creating skill',
        text: 'Skill folder: ux-review\nScope: project\nFiles: provided'
      }),
      expect.objectContaining({
        kind: 'tool_result',
        label: 'Created skill',
        text: 'Skill folder: ux-review'
      }),
      expect.objectContaining({
        kind: 'tool_call',
        label: 'Creating plugin',
        text: 'Plugin folder: project-tools\nScope: global\nFiles: provided'
      }),
      expect.objectContaining({
        kind: 'tool_result',
        label: 'Started helper agents',
        text: 'Helpers: provided'
      })
    ]);
    expect(activity.thinkingLines.map((line) => line.label).join('\n')).not.toMatch(
      /create_skill_bundle|create_plugin_bundle|spawn_subagents/u
    );
  });

  it('trims multi-paragraph operational assistant narration when concrete work rows already explain the steps', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'file-read',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_read',
            summary: 'Read index.html',
            path: 'index.html'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'delta-1',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: "I will start by reading `index.html`.\n\nI will now update `app.js`.\n\nThe release planning app refinement is complete."
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'file_read',
        label: 'Read index.html'
      }),
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'The release planning app refinement is complete.'
      })
    ]);
  });

  it('adds a resolution summary for terse successful closeouts using real file and verification signals', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'file-write',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_write',
            summary: 'Patched app.js',
            path: 'app.js'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'cmd-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm run build',
            command: 'npm run build',
            cwd: '.'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'cmd-complete',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'completed',
            summary: 'Ran npm run build',
            command: 'npm run build',
            cwd: '.'
          }
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'Repair complete.'
        },
        createdAt: '2026-03-16T00:00:04.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:05.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'file_write',
        path: 'app.js'
      }),
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'terminal_command',
        command: 'npm run build',
        status: 'completed'
      }),
      expect.objectContaining({
        kind: 'worked_for',
        label: 'Worked for 5s'
      }),
      expect.objectContaining({
        kind: 'resolution_summary',
        outcome: 'Repair complete.',
        filesChanged: ['app.js'],
        toolsUsed: [],
        verificationCommands: ['npm run build'],
        remainingRisk: null
      })
    ]);
  });

  it('puts missing file-write failure evidence before compact tool details', () => {
    const failureMessage = 'No page files were written. Created only roofing-landing before the provider stopped. Ollama stopped before writing the required file contents.';
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'thinking',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'thinking',
            summary: 'Let me create the landing page.',
            text: 'Let me create the landing page.'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'mkdir',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'mkdir',
            summary: 'Created folder',
            text: 'Folder: roofing-landing',
            path: 'roofing-landing'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'failed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'failed',
        payload: {
          message: failureMessage
        },
        createdAt: '2026-03-16T00:00:05.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];

    expect(items[0]).toEqual(
      expect.objectContaining({
        kind: 'resolution_summary',
        outcome: failureMessage,
        filesChanged: ['roofing-landing'],
        remainingRisk: 'No file-content writes were recorded before failure.'
      })
    );
    expect(items).not.toContainEqual(
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'file_write'
      })
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'worked_for',
        label: 'Worked for 5s'
      })
    );
  });

  it('includes MCP tools used in the resolved summary when a successful run relied on them', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'mcp-call',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_call',
            summary: 'Calling MCP tool dashboard_snapshot',
            toolName: 'use_mcp_tool'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'mcp-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Completed MCP tool dashboard_snapshot',
            toolName: 'use_mcp_tool',
            status: 'completed',
            text: 'Returned dashboard data.'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'Dashboard built.'
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:04.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'tool_call',
        toolName: 'use_mcp_tool',
        label: 'Using MCP tool',
        text: 'Tool: dashboard_snapshot'
      }),
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'tool_result',
        toolName: 'use_mcp_tool',
        label: 'Used MCP tool',
        text: 'Returned dashboard data.'
      }),
      expect.objectContaining({
        kind: 'worked_for',
        label: 'Worked for 4s'
      }),
      expect.objectContaining({
        kind: 'resolution_summary',
        outcome: 'Dashboard built.',
        toolsUsed: ['dashboard_snapshot']
      })
    ]);
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'resolution_summary',
        outcome: 'Dashboard built.',
        toolsUsed: ['dashboard_snapshot']
      })
    );
  });

  it('uses a generic first paragraph as the resolved outcome even when the assistant adds a noisier follow-up paragraph', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'file-write',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_write',
            summary: 'Patched app.js',
            path: 'app.js'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: "Repair complete.\n\nFixed typo in search input ID binding and ensured all behaviors work as required."
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'resolution_summary',
        outcome: 'Repair complete.',
        filesChanged: ['app.js']
      })
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'Fixed typo in search input ID binding and ensured all behaviors work as required.'
      })
    );
  });

  it('promotes a concise substantive success closeout into the resolved summary when real file and verification evidence exist', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'file-write',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_write',
            summary: 'Patched app.js',
            path: 'app.js'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'cmd-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm run build',
            command: 'npm run build',
            cwd: '.'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'cmd-complete',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'completed',
            summary: 'Ran npm run build',
            command: 'npm run build',
            cwd: '.'
          }
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'Built the Northstar Studio landing page and verified the primary CTA.'
        },
        createdAt: '2026-03-16T00:00:04.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:05.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'file_write',
        path: 'app.js'
      }),
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'terminal_command',
        command: 'npm run build',
        status: 'completed'
      }),
      expect.objectContaining({
        kind: 'worked_for',
        label: 'Worked for 5s'
      }),
      expect.objectContaining({
        kind: 'resolution_summary',
        outcome: 'Built the Northstar Studio landing page and verified the primary CTA.',
        filesChanged: ['app.js'],
        verificationCommands: ['npm run build'],
        remainingRisk: null
      })
    ]);
  });

  it('captures remaining risk from a later assistant paragraph when the first paragraph is only a generic closeout', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'file-write',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_write',
            summary: 'Patched app.js',
            path: 'app.js'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'Repair complete.\n\nManual verification still needs a browser pass for the filter state.'
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'resolution_summary',
        outcome: 'Repair complete.',
        remainingRisk: 'Manual verification still needs a browser pass for the filter state.'
      })
    );
  });

  it('captures explicit remaining-risk wording from later detail sentences in a terse closeout', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'file-write',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_write',
            summary: 'Patched app.js',
            path: 'app.js'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'Refinement complete.\n\nRemaining risk: no verification commands were run for the mobile layout.'
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'resolution_summary',
        outcome: 'Refinement complete.',
        remainingRisk: 'Remaining risk: no verification commands were run for the mobile layout.'
      })
    );
  });

  it('captures provider-stated next-step wording as remaining risk when the closeout explicitly leaves follow-up work', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'file-write',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_write',
            summary: 'Patched app.js',
            path: 'app.js'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: "Repair complete.\n\nNext step: verify the drag-and-drop behavior in a real browser session."
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'resolution_summary',
        outcome: 'Repair complete.',
        remainingRisk: 'Next step: verify the drag-and-drop behavior in a real browser session.'
      })
    );
  });

  it('strips duplicated remaining-risk text from assistant detail once the resolution summary carries it', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'file-write',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_write',
            summary: 'Patched app.js',
            path: 'app.js'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta:
            'Repair complete.\n\nUpdated the keyboard flow and empty states. Next step: verify the drag-and-drop behavior in a real browser session.'
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'resolution_summary',
        remainingRisk: 'Next step: verify the drag-and-drop behavior in a real browser session.'
      })
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'Updated the keyboard flow and empty states.'
      })
    );
  });

  it('keeps a full provider-stated risk paragraph when the warning spans more than one sentence', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'file-write',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_write',
            summary: 'Patched app.js',
            path: 'app.js'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta:
            "Refinement complete.\n\nI didn't run the full app here, so you'll still want to run npm run e2e before shipping. That is the only remaining release risk from this pass."
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'resolution_summary',
        outcome: 'Refinement complete.',
        remainingRisk:
          "I didn't run the full app here, so you'll still want to run npm run e2e before shipping. That is the only remaining release risk from this pass."
      })
    );
  });

  it('removes a later assistant risk paragraph when the resolved summary already carries the same remaining risk', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'file-write',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_write',
            summary: 'Patched app.js',
            path: 'app.js'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'Refinement complete.\n\nRemaining risk: no verification commands were run for the mobile layout.'
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'resolution_summary',
        remainingRisk: 'Remaining risk: no verification commands were run for the mobile layout.'
      })
    );
    expect(items.some((item) => item.kind === 'assistant_text')).toBe(false);
  });

  it('keeps substantive non-risk detail while removing a duplicate risk paragraph from the assistant closeout', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'file-write',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_write',
            summary: 'Patched app.js',
            path: 'app.js'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'Repair complete.\n\nUpdated the filter state and selected-card wiring to match the seeded task detail.\n\nManual verification still needs a browser pass for the filter state.'
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'resolution_summary',
        remainingRisk: 'Manual verification still needs a browser pass for the filter state.'
      })
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'Updated the filter state and selected-card wiring to match the seeded task detail.'
      })
    );
  });

  it('does not add a duplicate resolution summary when the final assistant closeout is already rich', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'Repaired the release board in place in `app.js` and left verification to the next manual pass.'
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:02.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(items.some((item) => item.kind === 'resolution_summary')).toBe(false);
  });

  it('removes a generic assistant closeout when the resolved summary already covers it and no substantive detail remains', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'file-write',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_write',
            summary: 'Patched app.js',
            path: 'app.js'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'Feature slice implemented.'
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(items.some((item) => item.kind === 'assistant_text')).toBe(false);
    expect(items).toContainEqual(
      expect.objectContaining({
        kind: 'resolution_summary',
        outcome: 'Feature slice implemented.',
        filesChanged: ['app.js']
      })
    );
  });

  it('surfaces blocked command policy failures with clearer transcript labels', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'tool-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Failed run_command',
            toolName: 'run_command',
            status: 'error',
            text: 'run_command is blocked by this workspace network policy. The requested command looks network-oriented (curl), and approved host network access is disabled here.'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.thinkingLines).toEqual([
      expect.objectContaining({
        kind: 'tool_result',
        label: 'Blocked command: workspace network blocked'
      })
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems[0]).toEqual(
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'tool_result',
        label: 'Blocked command: workspace network blocked',
        text: 'Command is blocked by this workspace network policy. The requested command looks network-oriented (curl), and approved host network access is disabled here.'
      })
    );
  });

  it('surfaces blocked runtime path-policy failures with clearer transcript labels', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'tool-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Failed run_command',
            toolName: 'run_command',
            status: 'error',
            text: 'run_command is blocked by runtime path policy. The command references a relative path that resolves outside the workspace (..\\..\\outside.txt).'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.thinkingLines).toEqual([
      expect.objectContaining({
        kind: 'tool_result',
        label: 'Blocked command: path escape'
      })
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems[0]).toEqual(
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'tool_result',
        label: 'Blocked command: path escape',
        text: 'Command is blocked by runtime path policy. The command references a relative path that resolves outside the workspace (..\\..\\outside.txt).'
      })
    );
  });

  it('surfaces blocked verification-command failures with verification-specific labels', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'tool-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Failed run_command',
            toolName: 'run_command',
            command: 'npm run build',
            status: 'error',
            text: 'run_command requires Full access. Switch permissions to Full access and retry.'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.thinkingLines).toEqual([
      expect.objectContaining({
        kind: 'tool_result',
        label: 'Blocked verification command: Full access required'
      })
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems[0]).toEqual(
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'tool_result',
        label: 'Blocked verification command: Full access required',
        text: 'Command requires Full access. Switch permissions to Full access and retry.'
      })
    );
  });

  it('suppresses duplicate failed command rows when a terminal transcript item already captures the run', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'terminal-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm run build',
            command: 'npm run build',
            cwd: '.'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'terminal-stop',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'stopped',
            summary: 'Stopped npm run build',
            command: 'npm run build',
            cwd: '.',
            outputLines: ['Build failed.']
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'tool-result',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_result',
            summary: 'Failed run_command',
            toolName: 'run_command',
            status: 'error',
            text: 'Command exited with status 1.'
          }
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toHaveLength(1);
    expect(transcriptItems[0]).toEqual(
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'terminal_command',
        label: 'Stopped npm run build'
      })
    );
  });

  it('shows thinking for active runs that only have reasoning so far', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'thinking',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          message: 'Reviewing the current app shell before editing.',
          activity: {
            kind: 'thinking',
            summary: 'Reviewing the current app shell before editing.',
            text: 'Reviewing the current app shell before editing.'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];

    expect(activity.activeHeading).toBe('Thinking');
  });

  it('emits a dedicated transcript item for structured change artifacts', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'changes',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          message: '2 files changed',
          activity: {
            kind: 'change_summary',
            summary: '2 files changed',
            changeArtifact: {
              summary: {
                filesChanged: 2,
                insertions: 8,
                deletions: 3
              },
              files: [
                {
                  path: 'src/renderer/components/ComposerPanel.tsx',
                  status: 'modified',
                  insertions: 5,
                  deletions: 2,
                  previewTruncated: false,
                  previewLines: [
                    {
                      type: 'added',
                      oldLineNumber: null,
                      newLineNumber: 220,
                      text: 'async function installEnhancePromptStub(window: Page, delayMs = 0) {'
                    }
                  ]
                },
                {
                  path: 'src/renderer/styles/thread.css',
                  status: 'modified',
                  insertions: 3,
                  deletions: 1,
                  previewTruncated: false,
                  previewLines: [
                    {
                      type: 'added',
                      oldLineNumber: null,
                      newLineNumber: 2966,
                      text: '.composer-send-button.is-enhancing {'
                    }
                  ]
                }
              ]
            }
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];

    expect(items).toEqual([
      expect.objectContaining({
        kind: 'change_artifact',
        label: '2 files changed',
        artifact: expect.objectContaining({
          summary: {
            filesChanged: 2,
            insertions: 8,
            deletions: 3
          }
        })
      })
    ]);
  });

  it('derives final review evidence from change artifacts and terminal commands', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'file-read',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_read',
            summary: 'Read src/example.ts',
            path: 'src/example.ts'
          }
        },
        createdAt: '2026-03-16T00:00:00.500Z'
      },
      {
        id: 'cmd-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm test',
            command: 'npm test',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'cmd-output',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_output',
            summary: '> vitest run',
            outputLines: ['> vitest run', '1 passed']
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'cmd-complete',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'completed',
            summary: 'Ran npm test',
            command: 'npm test',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:04.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    const progress: RunProgressState = {
      runId: 'run-1',
      threadId: 'thread-1',
      title: 'Current tasks',
      updatedAt: '2026-03-16T00:00:04.000Z',
      items: [],
      diffStats: {
        filesChanged: 1,
        insertions: 3,
        deletions: 1
      },
      reviewAvailable: true,
      changeArtifact: {
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
            beforeContent: 'const before = true;\n',
            afterContent: 'const after = true;\n',
            previewLines: [
              {
                type: 'added',
                oldLineNumber: null,
                newLineNumber: 1,
                text: 'const after = true;'
              }
            ],
            previewTruncated: false
          }
        ]
      }
    };

    const evidence = deriveRunReviewEvidence(activity, progress);

    expect(evidence).toEqual(
      expect.objectContaining({
        runId: 'run-1',
        state: 'completed',
        reviewAvailable: true,
        workedForLabel: '4s',
        thoughtEvidence: [],
        changeArtifact: expect.objectContaining({
          summary: {
            filesChanged: 1,
            insertions: 3,
            deletions: 1
          }
        }),
        fileEvidence: [
          expect.objectContaining({
            label: 'Read src/example.ts',
            path: 'src/example.ts',
            kind: 'file_read'
          })
        ],
        terminalCommands: [
          expect.objectContaining({
            label: 'Ran npm test',
            command: 'npm test',
            status: 'completed',
            durationLabel: '2s',
            outputLines: ['> vitest run', '1 passed']
          })
        ]
      })
    );
  });

  it('creates review evidence for completed runs with file activity even without diffs or terminal output', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'file-search',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_search',
            summary: 'Searched src for provider state',
            text: 'provider state',
            path: 'src'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    const evidence = deriveRunReviewEvidence(activity, null);

    expect(evidence).toEqual(
      expect.objectContaining({
        runId: 'run-1',
        reviewAvailable: false,
        changeArtifact: null,
        thoughtEvidence: [],
        terminalCommands: [],
        fileEvidence: [
          expect.objectContaining({
            label: 'Searched src for provider state',
            path: 'src',
            kind: 'file_search'
          })
        ]
      })
    );
  });

  it('uses a change-summary activity artifact for review evidence when no progress snapshot artifact exists', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'change-summary',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'change_summary',
            summary: 'Provider reported changes for src/example.ts',
            text: 'Provider reported changes for src/example.ts',
            changeArtifact: {
              summary: {
                filesChanged: 1,
                insertions: 0,
                deletions: 0
              },
              files: [
                {
                  path: 'src/example.ts',
                  status: 'modified',
                  insertions: 0,
                  deletions: 0,
                  beforeContent: null,
                  afterContent: null,
                  previewLines: [],
                  previewTruncated: true
                }
              ]
            }
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    const evidence = deriveRunReviewEvidence(activity, null);

    expect(evidence).toEqual(
      expect.objectContaining({
        runId: 'run-1',
        reviewAvailable: true,
        changeArtifact: expect.objectContaining({
          summary: {
            filesChanged: 1,
            insertions: 0,
            deletions: 0
          }
        }),
        thoughtEvidence: [],
        fileEvidence: [],
        terminalCommands: []
      })
    );
  });

  it('does not create review evidence for runs without changes or terminal proof', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'thinking',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'thinking',
            summary: 'Reviewing the codebase',
            text: 'Reviewing the codebase'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(deriveRunReviewEvidence(activity, null)).toBeNull();
  });

  it('creates review evidence for completed runs with thought process rows even without files or commands', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'thinking',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'thinking',
            summary: 'Reviewing the codebase',
            text: 'Reviewing the codebase'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'tool-call',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_call',
            summary: 'Calling read_file',
            toolName: 'read_file',
            text: 'path: src/example.ts'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];

    expect(deriveRunReviewEvidence(activity, null)).toEqual(
      expect.objectContaining({
        runId: 'run-1',
        reviewAvailable: false,
        changeArtifact: null,
        fileEvidence: [],
        terminalCommands: [],
        thoughtEvidence: [
          expect.objectContaining({
            label: 'Reviewing the codebase',
            kind: 'thinking'
          }),
          expect.objectContaining({
            label: 'Reading file',
            kind: 'tool_call'
          })
        ]
      })
    );
  });

  it('coalesces terminal lifecycle events into one canonical transcript command row', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'cmd-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm test',
            command: 'npm test',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'thinking',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'thinking',
            summary: 'Reviewing results',
            text: 'Reviewing results'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'cmd-output',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_output',
            summary: '> vitest run',
            text: '> vitest run',
            outputLines: ['> vitest run', '1 passed']
          }
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'cmd-complete',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'completed',
            summary: 'Ran npm test',
            command: 'npm test',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:04.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];

    expect(items).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'terminal_command',
        label: 'Ran npm test',
        command: 'npm test',
        cwd: 'C:/repo',
        status: 'completed',
        outputLines: ['> vitest run', '1 passed']
      }),
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'thinking',
        text: 'Reviewing results'
      })
    ]);
  });

  it('keeps substantive thinking rows even after successful concrete work', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'file-read',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_read',
            summary: 'Read vite.config.ts',
            path: 'vite.config.ts'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'thinking',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'thinking',
            summary: 'The config mismatch comes from the missing base path override.',
            text: 'The config mismatch comes from the missing base path override.'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'The base path is the real issue here.'
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:04.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'file_read'
      }),
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'thinking',
        text: 'The config mismatch comes from the missing base path override.'
      }),
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'The base path is the real issue here.'
      })
    ]);
  });

  it('keeps generic thinking rows visible in completed transcripts so the thought process remains inspectable', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'cmd-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm test',
            command: 'npm test',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'thinking',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'thinking',
            summary: 'Reviewing results',
            text: 'Reviewing results'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'The tests passed and the config is stable.'
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:04.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'terminal_command'
      }),
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'thinking',
        text: 'Reviewing results'
      }),
      expect.objectContaining({
        kind: 'worked_for'
      }),
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'The tests passed and the config is stable.'
      })
    ]);
  });

  it('keeps generic thinking rows visible during active runs even after interim assistant text arrives', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'cmd-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm test',
            command: 'npm test',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'thinking',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'thinking',
            summary: 'Reviewing results',
            text: 'Reviewing results'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'The tests passed so far.'
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(items).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'terminal_command'
      }),
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'thinking',
        text: 'Reviewing results'
      }),
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'The tests passed so far.'
      })
    ]);
  });

  it('normalizes terminal labels from command state and workspace-root cwd', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'cmd-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm run dev · Workspace root',
            command: 'npm run dev',
            cwd: '.'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'cmd-complete',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'completed',
            summary: 'Completed run shell command',
            command: 'npm run dev',
            cwd: '.'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.terminalCommands).toEqual([
      expect.objectContaining({
        label: 'Ran npm run dev',
        cwd: 'Workspace root',
        status: 'completed'
      })
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'terminal_command',
        label: 'Ran npm run dev',
        cwd: 'Workspace root'
      })
    ]);
  });

  it('filters internal Node stack frames from terminal output while keeping useful error lines', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'cmd-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm run dev',
            command: 'npm run dev',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'cmd-output',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_output',
            summary: 'Runtime error',
            text: 'Error: Room session not available locally. Join the room again.\n' + 'at Module._compile (node:internal/modules/cjs/loader:1761:14)\n' + 'at TracingChannel.traceSync (node:diagnostics_channel:328:14)\n' + 'at file:///C:/repo/out/main/index.js:11002:13',
            outputLines: ['Error: Room session not available locally. Join the room again.', 'at Module._compile (node:internal/modules/cjs/loader:1761:14)', 'at TracingChannel.traceSync (node:diagnostics_channel:328:14)', 'at file:///C:/repo/out/main/index.js:11002:13']
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];

    expect(items[0]).toMatchObject({
      kind: 'activity_line',
      activityKind: 'terminal_command',
      outputLines: ['Error: Room session not available locally. Join the room again.', 'at file:///C:/repo/out/main/index.js:11002:13']
    });
  });

  it('strips a leading shell echo from terminal output while keeping real command output', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'cmd-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm test',
            command: 'npm test',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'cmd-output',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_output',
            summary: 'npm test',
            outputLines: ['npm test', '> vitest run', '1 passed']
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'cmd-complete',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'completed',
            summary: 'Ran npm test',
            command: 'npm test',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.terminalCommands[0]?.outputLines).toEqual(['> vitest run', '1 passed']);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems[0]).toEqual(
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'terminal_command',
        outputLines: ['> vitest run', '1 passed']
      })
    );
  });

  it('preserves narrative background-terminal labels in renderer activity', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'cmd-finished',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'completed',
            summary: 'Background terminal finished with .\\.venv\\Scripts\\python.exe -m ruff check leads\\services\\browser.py',
            command: '.\\.venv\\Scripts\\python.exe -m ruff check leads\\services\\browser.py',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.terminalCommands[0]?.label).toBe('Background terminal finished with .\\.venv\\Scripts\\python.exe -m ruff check leads\\services\\browser.py');

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems[0]).toEqual(
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'terminal_command',
        label: 'Background terminal finished with .\\.venv\\Scripts\\python.exe -m ruff check leads\\services\\browser.py'
      })
    );
  });

  it('normalizes started background-terminal labels into running transcript rows', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'cmd-started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Started background terminal with Get-Content -Path src/renderer/lib/run-activity.ts',
            command: 'Get-Content -Path src/renderer/lib/run-activity.ts',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.terminalCommands[0]?.label).toBe('Background terminal running with Get-Content -Path src/renderer/lib/run-activity.ts');

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems[0]).toEqual(
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'terminal_command',
        label: 'Background terminal running with Get-Content -Path src/renderer/lib/run-activity.ts'
      })
    );
  });

  it('preserves terminal indentation for structured lint output', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'cmd-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running lint check',
            command: 'ruff check leads/services/browser.py',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'cmd-output',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_output',
            summary: 'ruff output',
            outputLines: [
              'I001 [*] Import block is un-sorted or un-formatted',
              '  --> leads\\\\services\\\\browser.py:1:1',
              '   |',
              ' 1 | / from __future__ import annotations'
            ]
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.terminalCommands[0]?.outputLines).toEqual([
      'I001 [*] Import block is un-sorted or un-formatted',
      '  --> leads\\\\services\\\\browser.py:1:1',
      '   |',
      ' 1 | / from __future__ import annotations'
    ]);
  });

  it('tracks terminal command duration labels for completed commands', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'cmd-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm run build',
            command: 'npm run build',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'cmd-complete',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'completed',
            summary: 'Ran npm run build',
            command: 'npm run build',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:29.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.terminalCommands[0]).toEqual(
      expect.objectContaining({
        label: 'Ran npm run build',
        durationLabel: '28s',
        startedAt: '2026-03-16T00:00:01.000Z',
        finishedAt: '2026-03-16T00:00:29.000Z'
      })
    );

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems[0]).toEqual(
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'terminal_command',
        durationLabel: '28s'
      })
    );
  });

  it('emits the final assistant summary as a separate block after tool activity', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'delta-1',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'I will inspect the repo first.\n'
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'cmd-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm test',
            command: 'npm test',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'cmd-output',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_output',
            summary: '1 passed',
            outputLines: ['1 passed']
          }
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'delta-2',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'Tests passed. I am done.'
        },
        createdAt: '2026-03-16T00:00:04.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:05.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];

    expect(items).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'terminal_command',
        label: 'Running npm test',
        outputLines: ['1 passed']
      }),
      expect.objectContaining({
        kind: 'worked_for',
        label: 'Worked for 5s'
      }),
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'Tests passed. I am done.'
      })
    ]);
  });

  it('suppresses a short operational assistant preamble when the same run ends with a substantive final answer', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'delta-1',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'I will inspect the config first.'
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'tool-call',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'tool_call',
            summary: 'Calling read_file',
            toolName: 'read_file',
            text: 'path: package.json'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'delta-2',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'The config is valid and only needs one script update.'
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:04.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];
    const assistantItems = items.filter((item) => item.kind === 'assistant_text');

    expect(assistantItems).toEqual([
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'The config is valid and only needs one script update.'
      })
    ]);
    expect(items.map((item) => item.kind)).toEqual(['activity_line', 'worked_for', 'assistant_text']);
  });

  it('stages worked time ahead of changed files at the end of the transcript', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'delta-1',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'Scanning the workspace before making changes.'
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'changes',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'change_summary',
            summary: '1 file changed',
            changeArtifact: {
              summary: {
                filesChanged: 1,
                insertions: 4,
                deletions: 2
              },
              files: [
                {
                  path: 'src/renderer/app.tsx',
                  status: 'modified',
                  insertions: 4,
                  deletions: 2,
                  previewTruncated: false,
                  previewLines: [
                    {
                      type: 'added',
                      oldLineNumber: null,
                      newLineNumber: 3900,
                      text: '<RunTranscriptTimeline />'
                    }
                  ]
                }
              ]
            }
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'delta-2',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'Completed the transcript ordering fix.'
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:31.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];

    expect(items.map((item) => item.kind)).toEqual(['assistant_text', 'worked_for', 'resolution_summary', 'change_artifact']);
    expect(items[1]).toEqual(
      expect.objectContaining({
        kind: 'worked_for',
        label: 'Worked for 31s'
      })
    );
    expect(items[2]).toEqual(
      expect.objectContaining({
        kind: 'resolution_summary',
        outcome: 'Completed the transcript ordering fix.',
        filesChanged: ['src/renderer/app.tsx'],
        verificationCommands: [],
        remainingRisk: null
      })
    );
  });

  it('keeps inline file edits in transcript event order ahead of the final footer card', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'thought',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          message: 'Reviewing the transcript layout before patching.'
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'file-edit',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_edit',
            summary: 'Edited thread.css',
            path: 'src/renderer/styles/thread.css',
            text: '+43 -0'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'delta',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'The layout now matches the shared transcript shell.'
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'change-summary',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'change_summary',
            summary: '1 file changed',
            changeArtifact: {
              summary: {
                filesChanged: 1,
                insertions: 43,
                deletions: 0
              },
              files: [
                {
                  path: 'src/renderer/styles/thread.css',
                  status: 'modified',
                  insertions: 43,
                  deletions: 0,
                  beforeContent: 'body { color: white; }',
                  afterContent: 'body { color: var(--foreground); }',
                  previewTruncated: false,
                  previewLines: [
                    {
                      type: 'added',
                      oldLineNumber: null,
                      newLineNumber: 1,
                      text: 'body { color: var(--foreground); }'
                    }
                  ]
                }
              ]
            }
          }
        },
        createdAt: '2026-03-16T00:00:04.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:05.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];

    expect(items.map((item) => item.kind)).toEqual(['activity_line', 'activity_line', 'assistant_text', 'worked_for', 'change_artifact']);
    expect(items[1]).toEqual(
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'file_edit',
        label: 'Edited thread.css',
        text: '+43 -0'
      })
    );
  });

  it('keeps follow-up reasoning text out of the active terminal output buffer', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'cmd-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          message: 'Running npm test',
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm test',
            command: 'npm test'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'thinking',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          message: 'I will inspect the failure and patch the config.',
          activity: {
            kind: 'thinking',
            summary: 'I will inspect the failure and patch the config.',
            text: 'I will inspect the failure and patch the config.'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      }
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    const transcriptTerminalItem = transcriptItems.find((item) => item.kind === 'activity_line' && item.activityKind === 'terminal_command');
    const transcriptThinkingItem = transcriptItems.find((item) => item.kind === 'activity_line' && item.activityKind === 'thinking' && item.text.includes('inspect the failure'));

    expect(transcriptTerminalItem).toBeDefined();
    expect(transcriptTerminalItem?.kind).toBe('activity_line');
    if (transcriptTerminalItem?.kind === 'activity_line') {
      expect(transcriptTerminalItem.outputLines).toEqual([]);
    }
    expect(transcriptThinkingItem).toBeDefined();

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.terminalCommands[0]?.outputLines).toEqual([]);
    expect(activity.thinkingLines.some((line) => line.text.includes('inspect the failure'))).toBe(true);
  });

  it('merges assistant delta text across interleaved command activity rows', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'delta-1',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'I’m going to inspect the repo structure and start the app locally so I can review the current UI behavior '
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'cmd-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm run dev',
            command: 'npm run dev',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'cmd-complete',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'completed',
            summary: 'Ran npm run dev',
            command: 'npm run dev',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'delta-2',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'without changing anything.'
        },
        createdAt: '2026-03-16T00:00:04.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:05.000Z'
      }
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    const assistantItems = transcriptItems.filter((item) => item.kind === 'assistant_text');
    const terminalItem = transcriptItems.find((item) => item.kind === 'activity_line' && item.activityKind === 'terminal_command');

    expect(assistantItems).toHaveLength(2);
    expect(assistantItems[0]).toEqual(
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'I’m going to inspect the repo structure and start the app locally so I can review the current UI behavior '
      })
    );
    expect(assistantItems[1]).toEqual(
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'without changing anything.'
      })
    );
    expect(terminalItem).toEqual(
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'terminal_command',
        label: 'Ran npm run dev'
      })
    );
    expect(transcriptItems.map((item) => item.kind)).toEqual(['assistant_text', 'activity_line', 'worked_for', 'assistant_text']);
  });

  it('rejoins a truncated leading word when a post-activity assistant delta starts mid-word', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'delta-1',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'Wo'
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'cmd-start',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'started',
            summary: 'Running npm run dev',
            command: 'npm run dev',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'cmd-complete',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'completed',
            summary: 'Ran npm run dev',
            command: 'npm run dev',
            cwd: 'C:/repo'
          }
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'delta-2',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'rkspace:\n\nUse a different workspace path.'
        },
        createdAt: '2026-03-16T00:00:04.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:05.000Z'
      }
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    const assistantItems = transcriptItems.filter((item) => item.kind === 'assistant_text');

    expect(assistantItems).toHaveLength(1);
    expect(assistantItems[0]).toEqual(
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'Workspace:\n\nUse a different workspace path.'
      })
    );
    expect(transcriptItems.map((item) => item.kind)).toEqual(['activity_line', 'worked_for', 'assistant_text']);
  });

  it('rejoins a longer truncated fragment after activity rows', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'delta-1',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'Workspa'
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'tool-info',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'thinking',
            summary: 'Checking workspace structure',
            text: 'Checking workspace structure'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'delta-2',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'ce setup complete.'
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:04.000Z'
      }
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    const assistantItems = transcriptItems.filter((item) => item.kind === 'assistant_text');

    expect(assistantItems).toHaveLength(1);
    expect(assistantItems[0]).toEqual(
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'Workspace setup complete.'
      })
    );
  });

  it('rejoins non-ascii word continuations after activity rows', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'delta-1',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'caf'
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'tool-info',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'thinking',
            summary: 'Checking menu copy',
            text: 'Checking menu copy'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'delta-2',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'é details ready.'
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:04.000Z'
      }
    ]);

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    const assistantItems = transcriptItems.filter((item) => item.kind === 'assistant_text');

    expect(assistantItems).toHaveLength(1);
    expect(assistantItems[0]).toEqual(
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'café details ready.'
      })
    );
  });

  it('surfaces memory recall activity as quiet transcript evidence', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'memory-recall',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'memory_recall',
            summary: 'Recalled 2 workspace memory entries',
            text: 'Included MEMORY.md, 2026-03-27.md in the active prompt context.'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.thinkingLines).toEqual([]);
    expect(activity.activeHeading).toBe('Thinking');

    const transcriptItems = deriveRunTranscriptItemsMap(thread)['run-1'];
    expect(transcriptItems).toEqual([]);
  });

  it('drops memory recall and delegation rows after a real assistant answer lands', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'memory-recall',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'memory_recall',
            summary: 'Recalled 2 workspace memory entries',
            text: 'Included MEMORY.md, 2026-03-27.md in the active prompt context.'
          }
        },
        createdAt: '2026-03-16T00:00:01.000Z'
      },
      {
        id: 'delegation',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'delegation',
            summary: 'Delegated planner proposed a plan.',
            text: 'Planner context is ready.'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'delta-1',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'I updated the memory flow and kept the thread calm.'
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:04.000Z'
      }
    ]);

    expect(deriveRunTranscriptItemsMap(thread)['run-1']).toEqual([
      expect.objectContaining({
        kind: 'assistant_text',
        text: 'I updated the memory flow and kept the thread calm.'
      })
    ]);
  });

  it('treats a silent memory checkpoint as quiet housekeeping, not coded work', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'checkpoint',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'memory_checkpoint',
            summary: 'Checkpoint saved',
            path: 'C:\\workspace\\memory\\2026-03-16.md',
            text: 'Saved a durable note to 2026-03-16.md before compaction risk increased.'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:05.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.workedForLabel).toBeNull();
    expect(activity.thinkingLines).toEqual([
      expect.objectContaining({
        kind: 'memory_checkpoint',
        label: 'Checkpoint saved'
      })
    ]);

    expect(deriveRunTranscriptItemsMap(thread)['run-1']).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'memory_checkpoint',
        label: 'Checkpoint saved'
      })
    ]);
  });

  it('surfaces automatic context compaction as a quiet transcript boundary', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-06-01T10:00:00.000Z'
      },
      {
        id: 'context-compaction',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          eventKind: 'tool_activity',
          transcriptVisible: true,
          activity: {
            kind: 'context_compaction',
            summary: 'Context automatically compacted',
            text: 'Older thread context was summarized so the run can continue within the model context window.',
            providerEventType: 'vicode_thread_context_compaction'
          }
        },
        createdAt: '2026-06-01T10:00:01.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-06-01T10:00:02.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.workedForLabel).toBeNull();
    expect(activity.thinkingLines).toEqual([
      expect.objectContaining({
        kind: 'context_compaction',
        label: 'Context automatically compacted'
      })
    ]);

    expect(deriveRunTranscriptItemsMap(thread)['run-1']).toEqual([
      expect.objectContaining({
        kind: 'activity_line',
        activityKind: 'context_compaction',
        label: 'Context automatically compacted'
      })
    ]);
  });

  it('does not show worked time for read-only inspection activity', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-16T00:00:00.000Z'
      },
      {
        id: 'search',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'file_search',
            summary: 'Searched project files',
            text: 'Found config references in src and docs.'
          }
        },
        createdAt: '2026-03-16T00:00:02.000Z'
      },
      {
        id: 'delta-1',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: 'I found the references you asked about.'
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:05.000Z'
      }
    ]);

    const activity = deriveRunActivityMap(thread)['run-1'];
    expect(activity.workedForLabel).toBeNull();
    expect(deriveRunTranscriptItemsMap(thread)['run-1'].map((item) => item.kind)).toEqual(['activity_line', 'assistant_text']);
  });

  it('suppresses shell snapshot html and low-value codex warning lines from the transcript', () => {
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-03-28T07:39:18.000Z'
      },
      {
        id: 'noise-html',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          message: '<div class="data"><div class="main-wrapper" role="main">'
        },
        createdAt: '2026-03-28T07:39:18.100Z'
      },
      {
        id: 'noise-shell',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          message: '[2026-03-28T07:39:18.421944Z][WARN ][codex_core::shell_snapshot] failed to capture shell snapshot'
        },
        createdAt: '2026-03-28T07:39:18.200Z'
      },
      {
        id: 'noise-thinking',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'thinking',
            summary: '<path',
            text: 'd="M37.5324 16.8707..."'
          }
        },
        createdAt: '2026-03-28T07:39:18.250Z'
      },
      {
        id: 'noise-mcp',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          message: '[2026-03-28T07:39:19.734097Z][WARN ][mcp::service::client] Received unknown status update'
        },
        createdAt: '2026-03-28T07:39:19.300Z'
      },
      {
        id: 'delta-1',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: "I'll keep the tone calm, premium, restrained, and direct."
        },
        createdAt: '2026-03-28T07:39:20.000Z'
      },
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-28T07:39:21.000Z'
      }
    ]);

    expect(deriveRunActivityMap(thread)['run-1'].thinkingLines).toEqual([]);
    expect(deriveRunTranscriptItemsMap(thread)['run-1']).toEqual([
      expect.objectContaining({
        kind: 'assistant_text',
        text: "I'll keep the tone calm, premium, restrained, and direct."
      })
    ]);
  });

  it('sanitizes ANSI-colored MCP auth failures before rendering reasoning activity', () => {
    const rawAuthFailure =
      '\u001b[2m2026-05-25T20:22:45.473189Z\u001b[0m \u001b[31mERROR\u001b[0m \u001b[2mrmcp:: transport:: worker\u001b[0m\u001b[2m:\u001b[0m worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer realm=\\"OA uth\\", resource_metadata="https://mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="Missing or invalid access token" }) [blocked]';
    const thread = createThreadDetail([
      {
        id: 'started',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'started',
        payload: {},
        createdAt: '2026-05-25T20:22:45.000Z'
      },
      {
        id: 'auth-failure',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'thinking',
            summary: rawAuthFailure,
            text: rawAuthFailure
          }
        },
        createdAt: '2026-05-25T20:22:45.500Z'
      }
    ]);

    const activityLine = deriveRunActivityMap(thread)['run-1'].thinkingLines[0];
    expect(activityLine).toEqual(
      expect.objectContaining({
        kind: 'thinking',
        label: 'MCP tool unavailable: authentication required.',
        text: 'MCP tool unavailable: authentication required.'
      })
    );
    expect(activityLine?.text).not.toMatch(/\u001b|\binvalid_token\b|Missing or invalid access token|Bearer realm/u);

    const transcriptLine = deriveRunTranscriptItemsMap(thread)['run-1'].find(
      (item) => item.kind === 'activity_line' && item.activityKind === 'thinking'
    );
    expect(transcriptLine).toEqual(
      expect.objectContaining({
        label: 'MCP tool unavailable: authentication required.',
        text: 'MCP tool unavailable: authentication required.'
      })
    );
  });
});

describe('deriveStagedWorkspaceReviewItems', () => {
  function createStagedEvent(id: string, overrides: Partial<RunEvent['payload']> = {}): RunEvent {
    return {
      id,
      threadId: 'thread-1',
      runId: 'run-1',
      eventType: 'info',
      payload: {
        eventKind: 'debug_detail',
        transcriptVisible: false,
        stagedWorkspaceChangeSet: {
          threadId: 'thread-1',
          runId: 'run-1',
          sourceToolName: 'write_file',
          isolationMode: 'patch_buffer',
          status: 'proposed',
          requestedPath: 'src/example.ts',
          changedPaths: ['src/example.ts'],
          operations: [
            {
              operation: 'write_file',
              path: 'src/example.ts',
              beforeContent: 'before-secret-token',
              proposedAfterContent: 'after-secret-token',
              patchText: 'patch-secret-token'
            }
          ],
          summary: {
            filesChanged: 1,
            insertions: 2,
            deletions: 1
          }
        },
        ...overrides
      },
      createdAt: '2026-03-16T00:00:02.000Z'
    };
  }

  it('pairs staged workspace proposals with later decisions without exposing staged file contents', () => {
    const events: RunEvent[] = [
      createStagedEvent('staged-1'),
      {
        id: 'decision-1',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          eventKind: 'debug_detail',
          transcriptVisible: false,
          stagedWorkspaceReviewDecision: {
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
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ];

    const [item] = deriveStagedWorkspaceReviewItems(events, 'run-1');

    expect(item).toEqual(expect.objectContaining({
      id: 'staged-workspace:staged-1',
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'staged-1',
      stagedEventIndex: 0,
      sourceToolName: 'write_file',
      isolationMode: 'patch_buffer',
      status: 'applied',
      changedPaths: ['src/example.ts'],
      operationCount: 1,
      operationKinds: ['write_file'],
      filesChanged: 1,
      insertions: 2,
      deletions: 1
    }));
    expect(JSON.stringify(item)).not.toContain('before-secret-token');
    expect(JSON.stringify(item)).not.toContain('after-secret-token');
    expect(JSON.stringify(item)).not.toContain('patch-secret-token');
  });

  it('uses the latest reverted staged workspace review decision without exposing staged file contents', () => {
    const events: RunEvent[] = [
      createStagedEvent('staged-1'),
      {
        id: 'decision-applied',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          eventKind: 'debug_detail',
          transcriptVisible: false,
          stagedWorkspaceReviewDecision: {
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
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      },
      {
        id: 'decision-reverted',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          eventKind: 'debug_detail',
          transcriptVisible: false,
          stagedWorkspaceReviewDecision: {
            action: 'reverted',
            status: 'reverted',
            threadId: 'thread-1',
            runId: 'run-1',
            stagedEventId: 'staged-1',
            stagedEventIndex: 0,
            sourceToolName: 'write_file',
            isolationMode: 'patch_buffer',
            changedPaths: ['src/example.ts'],
            operationKinds: ['write_file'],
            errorReason: null,
            createdAt: '2026-03-16T00:00:04.000Z'
          }
        },
        createdAt: '2026-03-16T00:00:04.000Z'
      }
    ];

    const [item] = deriveStagedWorkspaceReviewItems(events, 'run-1');

    expect(item).toEqual(expect.objectContaining({
      status: 'reverted',
      decision: expect.objectContaining({
        action: 'reverted',
        status: 'reverted'
      })
    }));
    expect(JSON.stringify(item)).not.toContain('before-secret-token');
    expect(JSON.stringify(item)).not.toContain('after-secret-token');
    expect(JSON.stringify(item)).not.toContain('patch-secret-token');
  });

  it('pairs staged workspace proposals with later hunk decisions without exposing staged file contents', () => {
    const events: RunEvent[] = [
      createStagedEvent('staged-1'),
      {
        id: 'hunk-decision-1',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          eventKind: 'debug_detail',
          transcriptVisible: false,
          stagedWorkspaceHunkReviewDecision: {
            action: 'applied',
            status: 'applied',
            threadId: 'thread-1',
            runId: 'run-1',
            source: 'staged_workspace_preview',
            isolationMode: 'patch_buffer',
            stagedEventId: 'staged-1',
            stagedEventIndex: 0,
            changedPaths: ['src/example.ts'],
            hunkIds: ['hunk-1', 'hunk-2'],
            acceptedHunkIds: ['hunk-1'],
            rejectedHunkIds: ['hunk-2'],
            filesChanged: 1,
            insertions: 1,
            deletions: 1,
            errorReason: null,
            createdAt: '2026-03-16T00:00:03.000Z',
            beforeContent: 'before-secret-token',
            proposedAfterContent: 'after-secret-token',
            patchText: 'patch-secret-token'
          }
        },
        createdAt: '2026-03-16T00:00:03.000Z'
      }
    ];

    const [item] = deriveStagedWorkspaceReviewItems(events, 'run-1');

    expect(item?.hunkDecision).toEqual(expect.objectContaining({
      action: 'applied',
      status: 'applied',
      stagedEventId: 'staged-1',
      hunkIds: ['hunk-1', 'hunk-2'],
      acceptedHunkIds: ['hunk-1'],
      rejectedHunkIds: ['hunk-2']
    }));
    expect(JSON.stringify(item)).not.toContain('before-secret-token');
    expect(JSON.stringify(item)).not.toContain('after-secret-token');
    expect(JSON.stringify(item)).not.toContain('patch-secret-token');
  });

  it('adds pending staged workspace proposals to transcript items', () => {
    const thread = createThreadDetail([
      createStagedEvent('staged-1'),
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:04.000Z'
      }
    ]);

    expect(deriveRunTranscriptItemsMap(thread)['run-1']).toContainEqual(expect.objectContaining({
      kind: 'staged_workspace_change',
      change: expect.objectContaining({
        status: 'pending',
        changedPaths: ['src/example.ts']
      })
    }));
  });
});

describe('deriveWorktreeReviewItems', () => {
  function createWorktreeChangeEvent(id: string, overrides: Partial<RunEvent['payload']> = {}): RunEvent {
    return {
      id,
      threadId: 'thread-1',
      runId: 'run-1',
      eventType: 'info',
      payload: {
        activity: {
          kind: 'change_summary',
          summary: '1 file changed',
          changeArtifact: {
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
                previewLines: [
                  {
                    type: 'added',
                    oldLineNumber: null,
                    newLineNumber: 1,
                    text: 'after-secret-token'
                  }
                ],
                previewTruncated: false
              }
            ]
          }
        },
        worktreeChangeEvidence: {
          threadId: 'thread-1',
          runId: 'run-1',
          isolationMode: 'git_worktree',
          status: 'ready',
          reviewStatus: 'pending',
          cleanupPolicy: 'manual',
          sourceWorkspaceRelativePath: 'packages/app',
          branchName: 'vicode/worktree/project-1/run-1',
          baseRef: 'HEAD',
          baseSha: 'abcdef1234567890',
          filesChanged: 1,
          insertions: 3,
          deletions: 1,
          changedPaths: ['src/example.ts']
        },
        ...overrides
      },
      createdAt: '2026-03-16T00:00:02.000Z'
    };
  }

  function createWorktreeDecisionEvent(
    id: string,
    decision: {
      action: 'applied' | 'rejected' | 'reverted';
      status: 'applied' | 'rejected' | 'reverted' | 'failed';
      errorReason?: string | null;
      createdAt?: string;
    }
  ): RunEvent {
    return {
      id,
      threadId: 'thread-1',
      runId: 'run-1',
      eventType: 'info',
      payload: {
        eventKind: 'debug_detail',
        transcriptVisible: false,
        worktreeReviewDecision: {
          action: decision.action,
          status: decision.status,
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
          errorReason: decision.errorReason ?? null,
          createdAt: decision.createdAt ?? '2026-03-16T00:00:03.000Z'
        }
      },
      createdAt: decision.createdAt ?? '2026-03-16T00:00:03.000Z'
    };
  }

  function createWorktreeCleanupDecisionEvent(
    id: string,
    decision: {
      status: 'cleaned' | 'failed' | 'refused';
      reviewStatus: 'applied' | 'rejected' | 'reverted' | 'failed' | 'pending';
      errorReason?: string | null;
      createdAt?: string;
    }
  ): RunEvent {
    return {
      id,
      threadId: 'thread-1',
      runId: 'run-1',
      eventType: 'info',
      payload: {
        eventKind: 'debug_detail',
        transcriptVisible: false,
        worktreeCleanupDecision: {
          action: decision.status,
          status: decision.status,
          threadId: 'thread-1',
          runId: 'run-1',
          isolationMode: 'git_worktree',
          branchName: 'vicode/worktree/project-1/run-1',
          baseSha: 'abcdef1234567890',
          cleanupPolicy: 'preserve_until_review',
          reviewStatus: decision.reviewStatus,
          errorReason: decision.errorReason ?? null,
          createdAt: decision.createdAt ?? '2026-03-16T00:00:05.000Z'
        }
      },
      createdAt: decision.createdAt ?? '2026-03-16T00:00:05.000Z'
    };
  }

  function createWorktreeHunkDecisionEvent(
    id: string,
    decision: {
      action: 'applied' | 'rejected' | 'reverted';
      status: 'applied' | 'rejected' | 'reverted' | 'failed';
      errorReason?: string | null;
      createdAt?: string;
    }
  ): RunEvent {
    return {
      id,
      threadId: 'thread-1',
      runId: 'run-1',
      eventType: 'info',
      payload: {
        eventKind: 'debug_detail',
        transcriptVisible: false,
        worktreeHunkReviewDecision: {
          action: decision.action,
          status: decision.status,
          threadId: 'thread-1',
          runId: 'run-1',
          source: 'worktree_diff',
          isolationMode: 'git_worktree',
          branchName: 'vicode/worktree/project-1/run-1',
          baseSha: 'abcdef1234567890',
          sourceWorkspaceRelativePath: 'packages/app',
          changedPaths: ['src/example.ts'],
          hunkIds: ['hunk-1', 'hunk-2'],
          acceptedHunkIds: ['hunk-1'],
          rejectedHunkIds: ['hunk-2'],
          filesChanged: 1,
          insertions: 1,
          deletions: 1,
          errorReason: decision.errorReason ?? null,
          createdAt: decision.createdAt ?? '2026-03-16T00:00:04.000Z',
          sourceWorkspaceRoot: 'C:/must-not-leak/source',
          worktreeWorkspaceRoot: 'C:/must-not-leak/worktree',
          beforeContent: 'before-secret-token',
          afterContent: 'after-secret-token',
          patchText: 'patch-secret-token'
        }
      },
      createdAt: decision.createdAt ?? '2026-03-16T00:00:04.000Z'
    };
  }

  it('derives a pending worktree review item from the latest worktree_diff artifact', () => {
    const [item] = deriveWorktreeReviewItems([
      createWorktreeChangeEvent('worktree-change-1')
    ], 'run-1');

    expect(item).toEqual(expect.objectContaining({
      id: 'worktree-review:worktree-change-1',
      threadId: 'thread-1',
      runId: 'run-1',
      artifactEventId: 'worktree-change-1',
      isolationMode: 'git_worktree',
      status: 'pending',
      branchName: 'vicode/worktree/project-1/run-1',
      baseSha: 'abcdef1234567890',
      sourceWorkspaceRelativePath: 'packages/app',
      changedPaths: ['src/example.ts'],
      filesChanged: 1,
      insertions: 3,
      deletions: 1,
      decision: null
    }));
    expect(item?.artifact.source).toBe('worktree_diff');
  });

  it('pairs the latest worktree review decision with the worktree item', () => {
    const [item] = deriveWorktreeReviewItems([
      createWorktreeChangeEvent('worktree-change-1'),
      createWorktreeDecisionEvent('decision-failed', {
        action: 'applied',
        status: 'failed',
        errorReason: 'Source workspace changed.',
        createdAt: '2026-03-16T00:00:03.000Z'
      }),
      createWorktreeDecisionEvent('decision-rejected', {
        action: 'rejected',
        status: 'rejected',
        createdAt: '2026-03-16T00:00:04.000Z'
      })
    ], 'run-1');

    expect(item).toEqual(expect.objectContaining({
      status: 'rejected',
      errorReason: null,
      decision: expect.objectContaining({
        action: 'rejected',
        status: 'rejected'
      })
    }));
  });

  it('derives reverted worktree review status from worktree review decisions', () => {
    const [item] = deriveWorktreeReviewItems([
      createWorktreeChangeEvent('worktree-change-1'),
      createWorktreeDecisionEvent('decision-applied', {
        action: 'applied',
        status: 'applied',
        createdAt: '2026-03-16T00:00:03.000Z'
      }),
      createWorktreeDecisionEvent('decision-reverted', {
        action: 'reverted',
        status: 'reverted',
        createdAt: '2026-03-16T00:00:04.000Z'
      })
    ], 'run-1');

    expect(item).toEqual(expect.objectContaining({
      status: 'reverted',
      errorReason: null,
      decision: expect.objectContaining({
        action: 'reverted',
        status: 'reverted'
      })
    }));
    expect(JSON.stringify(item?.decision)).not.toContain('sourceWorkspaceRoot');
    expect(JSON.stringify(item?.decision)).not.toContain('worktreeWorkspaceRoot');
    expect(JSON.stringify(item?.decision)).not.toContain('before-secret-token');
    expect(JSON.stringify(item?.decision)).not.toContain('after-secret-token');
  });

  it('pairs the latest worktree hunk decision without exposing roots or file contents', () => {
    const [item] = deriveWorktreeReviewItems([
      createWorktreeChangeEvent('worktree-change-1'),
      createWorktreeHunkDecisionEvent('hunk-failed', {
        action: 'applied',
        status: 'failed',
        errorReason: 'Source workspace changed.',
        createdAt: '2026-03-16T00:00:03.000Z'
      }),
      createWorktreeHunkDecisionEvent('hunk-applied', {
        action: 'applied',
        status: 'applied',
        createdAt: '2026-03-16T00:00:04.000Z'
      })
    ], 'run-1');

    expect(item?.hunkDecision).toEqual(expect.objectContaining({
      action: 'applied',
      status: 'applied',
      source: 'worktree_diff',
      hunkIds: ['hunk-1', 'hunk-2'],
      acceptedHunkIds: ['hunk-1'],
      rejectedHunkIds: ['hunk-2']
    }));
    expect(JSON.stringify(item?.hunkDecision)).not.toContain('sourceWorkspaceRoot');
    expect(JSON.stringify(item?.hunkDecision)).not.toContain('worktreeWorkspaceRoot');
    expect(JSON.stringify(item?.hunkDecision)).not.toContain('before-secret-token');
    expect(JSON.stringify(item?.hunkDecision)).not.toContain('after-secret-token');
    expect(JSON.stringify(item?.hunkDecision)).not.toContain('patch-secret-token');
  });

  it('pairs the latest cleanup decision without changing the worktree review status', () => {
    const [item] = deriveWorktreeReviewItems([
      createWorktreeChangeEvent('worktree-change-1'),
      createWorktreeDecisionEvent('decision-rejected', {
        action: 'rejected',
        status: 'rejected',
        createdAt: '2026-03-16T00:00:03.000Z'
      }),
      createWorktreeCleanupDecisionEvent('cleanup-failed', {
        status: 'failed',
        reviewStatus: 'rejected',
        errorReason: 'Git failed at C:/Users/test-user/worktrees/run-1.',
        createdAt: '2026-03-16T00:00:04.000Z'
      }),
      createWorktreeCleanupDecisionEvent('cleanup-cleaned', {
        status: 'cleaned',
        reviewStatus: 'rejected',
        createdAt: '2026-03-16T00:00:05.000Z'
      })
    ], 'run-1');

    expect(item).toEqual(expect.objectContaining({
      status: 'rejected',
      cleanupStatus: 'cleaned',
      cleanupErrorReason: null,
      cleanupDecision: expect.objectContaining({
        action: 'cleaned',
        status: 'cleaned',
        reviewStatus: 'rejected'
      })
    }));
    expect(JSON.stringify(item?.cleanupDecision)).not.toContain('sourceWorkspaceRoot');
    expect(JSON.stringify(item?.cleanupDecision)).not.toContain('worktreeWorkspaceRoot');
    expect(JSON.stringify(item?.cleanupDecision)).not.toContain('before-secret-token');
    expect(JSON.stringify(item?.cleanupDecision)).not.toContain('after-secret-token');
  });

  it('adds pending worktree review items to transcript items without local roots', () => {
    const thread = createThreadDetail([
      createWorktreeChangeEvent('worktree-change-1'),
      {
        id: 'completed',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-03-16T00:00:04.000Z'
      }
    ]);

    const items = deriveRunTranscriptItemsMap(thread)['run-1'];

    expect(items).toContainEqual(expect.objectContaining({
      kind: 'worktree_workspace_change',
      change: expect.objectContaining({
        status: 'pending',
        changedPaths: ['src/example.ts']
      })
    }));
    expect(JSON.stringify(items)).not.toContain('C:\\');
    expect(JSON.stringify(items)).not.toContain('worktreeRepoRoot');
    expect(JSON.stringify(items)).not.toContain('sourceWorkspaceRoot');
  });
});
