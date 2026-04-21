import { describe, expect, it } from 'vitest';
import {
  buildCollaborationSummaryPrompt,
  buildSubagentTerminalSummaryPrompt,
  deriveCollaborationThreadSummary,
  deriveSubagentTerminalSummaryFallback,
  normalizeSubagentTerminalSummary,
  parseCollaborationSummaryOutput
} from './thread-summary';
import type { ThreadDetail } from '../../shared/domain';

function createThread(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Fix MCP approvals',
    providerId: 'ollama',
    modelId: 'qwen3-coder',
    executionPermission: 'default',
    status: 'completed',
    archived: false,
    lastMessageAt: '2026-04-01T00:00:00.000Z',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    lastPreview: 'Fixed approval policy bug and verified the new flow.',
    turns: [
      {
        id: 'turn-user',
        threadId: 'thread-1',
        runId: null,
        role: 'user',
        content: 'Investigate why the MCP command approval keeps prompting after I already allowed it.',
        metadata: null,
        createdAt: '2026-04-01T00:00:00.000Z'
      },
      {
        id: 'turn-assistant',
        threadId: 'thread-1',
        runId: 'run-1',
        role: 'assistant',
        content: 'I fixed the provider manager so it re-reads the current project runtime policy before each approval request.',
        metadata: null,
        createdAt: '2026-04-01T00:01:00.000Z'
      }
    ],
    rawOutput: [],
    followUps: [],
    planner: {
      threadId: 'thread-1',
      composerMode: 'default',
      turnState: 'idle',
      activePlanId: null,
      pendingQuestionCallId: null,
      updatedAt: '2026-04-01T00:00:00.000Z',
      activePlan: null,
      pendingQuestionSet: null
    },
    ...overrides
  };
}

describe('thread-summary helpers', () => {
  it('parses collaboration summary bundles and preserves the fallback next prompt', () => {
    const thread = createThread();
    const fallback = deriveCollaborationThreadSummary(thread);

    const summary = parseCollaborationSummaryOutput(
      [
        'USER: Debug the repeated MCP approval prompts.',
        'ASSISTANT: Re-read runtime policy before approvals.',
        'HANDOFF: The thread fixes repeated MCP approval prompts. The runtime now checks the latest workspace policy before each approval. Re-test the allow flow with Ollama.'
      ].join('\n'),
      fallback
    );

    expect(summary.lastPromptSummary).toBe('Debug the repeated MCP approval prompts.');
    expect(summary.latestAssistantSummary).toBe('Re-read runtime policy before approvals.');
    expect(summary.handoffSummary).toContain('latest workspace policy');
    expect(summary.recommendedNextPrompt).toBe(fallback.recommendedNextPrompt);
  });

  it('derives deterministic fallbacks from the latest user and assistant turns', () => {
    const summary = deriveCollaborationThreadSummary(createThread());
    expect(summary.lastPromptSummary).toContain('Investigate why the MCP command approval');
    expect(summary.latestAssistantSummary).toContain('I fixed the provider manager');
    expect(summary.handoffSummary).toContain('Investigate why the MCP command approval');
  });

  it('uses latest run artifacts when the assistant closeout is too generic', () => {
    const summary = deriveCollaborationThreadSummary(
      createThread({
        lastPreview: 'Complete.',
        turns: [
          {
            id: 'turn-user',
            threadId: 'thread-1',
            runId: null,
            role: 'user',
            content: 'Tighten the approval flow.',
            metadata: null,
            createdAt: '2026-04-01T00:00:00.000Z'
          },
          {
            id: 'turn-assistant',
            threadId: 'thread-1',
            runId: 'run-1',
            role: 'assistant',
            content: 'Complete.',
            metadata: null,
            createdAt: '2026-04-01T00:01:00.000Z'
          }
        ],
        rawOutput: [
          {
            id: 'event-1',
            threadId: 'thread-1',
            runId: 'run-1',
            eventType: 'info',
            payload: {
              activity: {
                kind: 'change_summary',
                changeArtifact: {
                  files: [{ path: 'src/main/ipc.ts' }]
                }
              }
            },
            createdAt: '2026-04-01T00:01:00.000Z'
          },
          {
            id: 'event-2',
            threadId: 'thread-1',
            runId: 'run-1',
            eventType: 'info',
            payload: {
              activity: {
                kind: 'terminal_command',
                status: 'completed',
                command: 'npm test'
              }
            },
            createdAt: '2026-04-01T00:01:10.000Z'
          },
          {
            id: 'event-3',
            threadId: 'thread-1',
            runId: 'run-1',
            eventType: 'completed',
            payload: {},
            createdAt: '2026-04-01T00:01:20.000Z'
          }
        ]
      })
    );

    expect(summary.latestAssistantSummary).toContain('Updated src/main/ipc.ts.');
    expect(summary.handoffSummary).toContain('Verified with npm test.');
  });

  it('repairs numeric spacing in collaboration summaries without using general assistant cleanup rules', () => {
    const fallback = deriveCollaborationThreadSummary(createThread());

    const summary = parseCollaborationSummaryOutput(
      [
        'USER: Ship the 2 026 roadmap refresh.',
        'ASSISTANT: Updated the 21 stcentury design references.',
        'HANDOFF: Refined the 1980 sdesign treatment and the 3 rdparty handoff notes for the next pass.'
      ].join('\n'),
      fallback
    );

    expect(summary.lastPromptSummary).toBe('Ship the 2026 roadmap refresh.');
    expect(summary.latestAssistantSummary).toBe('Updated the 21st century design references.');
    expect(summary.handoffSummary).toBe(
      'Refined the 1980s design treatment and the 3rd party handoff notes for the next pass.'
    );
  });

  it('normalizes subagent labels down to one short line', () => {
    expect(normalizeSubagentTerminalSummary('  "Fixed approval policy bug."\nMore text', 'fallback')).toBe(
      'Fixed approval policy bug.'
    );
  });

  it('repairs ordinal and decade joins in subagent terminal summaries', () => {
    expect(normalizeSubagentTerminalSummary('Updated the 21 stcentury audit', 'fallback')).toBe(
      'Updated the 21st century audit'
    );
    expect(normalizeSubagentTerminalSummary('Refined the 1980 sdesign system', 'fallback')).toBe(
      'Refined the 1980s design system'
    );
  });

  it('builds prompts with recent transcript context', () => {
    const thread = createThread();
    expect(buildCollaborationSummaryPrompt(thread)).toContain('Recent transcript:');
    expect(buildCollaborationSummaryPrompt(thread)).toContain('USER:\nInvestigate why the MCP command approval');
    expect(buildSubagentTerminalSummaryPrompt(thread, 'completed')).toContain('The delegated agent finished its task.');
    expect(deriveSubagentTerminalSummaryFallback(thread)).toContain('I fixed the provider manager');
  });

  it('preserves structured transcript blocks for collaboration summary prompts', () => {
    const thread = createThread({
      turns: [
        {
          id: 'turn-user',
          threadId: 'thread-1',
          runId: null,
          role: 'user',
          content: 'Explain quantization in plain terms.',
          metadata: null,
          createdAt: '2026-04-01T00:00:00.000Z'
        },
        {
          id: 'turn-assistant',
          threadId: 'thread-1',
          runId: 'run-1',
          role: 'assistant',
          content: [
            'What is Quantization in AI?',
            '',
            '### How It Works',
            '- Full precision (FP32): Each weight uses 32 bits',
            '- Quantized: Weights use fewer bits'
          ].join('\n'),
          metadata: null,
          createdAt: '2026-04-01T00:01:00.000Z'
        }
      ]
    });

    expect(buildCollaborationSummaryPrompt(thread)).toContain(
      ['ASSISTANT:', 'What is Quantization in AI?', '', '### How It Works', '- Full precision (FP32): Each weight uses 32 bits'].join('\n')
    );
  });
});
