import { describe, expect, it } from 'vitest';
import type { PlannerPlan, ThreadDetail } from '../../shared/domain';
import type { ResolvedConversationTaskPacket } from '../../shared/conversation-task-resolver';
import { buildEffectivePrompt } from './provider-manager-prompt-builder';
import type { WorkspaceContextResult } from './workspace-context';

function createWorkspaceContextResult(): WorkspaceContextResult {
  return {
    folderPath: null,
    trusted: false,
    providerId: 'openai',
    blocks: [],
    memoryBlocks: [],
    generatedMemoryBlocks: [],
    projectKnowledgeBlocks: [],
    projectKnowledgeRouter: null,
    skillBlocks: [],
    runtimeSkillResources: [],
    selectedSkillIds: [],
    autoSelectedSkillIds: [],
    mentionedSkillIds: [],
    diagnostics: {
      durationMs: 0,
      workspaceInstructionReadMs: 0,
      skillResolutionMs: 0,
      runtimeSkillResolutionMs: 0,
      memoryRetrievalMs: 0,
      generatedMemoryRetrievalMs: 0,
      projectKnowledgeRetrievalMs: 0,
      blockCount: 0,
      memoryBlockCount: 0,
      generatedMemoryBlockCount: 0,
      projectKnowledgeBlockCount: 0,
      skillBlockCount: 0,
      runtimeSkillResourceCount: 0
    }
  };
}

function createThreadDetail(): ThreadDetail {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Compacted thread',
    providerId: 'ollama',
    modelId: 'qwen3-coder',
    executionPermission: 'default',
    status: 'completed',
    archived: false,
    createdAt: '2026-06-01T09:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
    lastMessageAt: '2026-06-01T10:00:00.000Z',
    lastPreview: '',
    turns: [
      {
        id: 'turn-old-user',
        threadId: 'thread-1',
        runId: 'run-old',
        role: 'user',
        content: 'Old user request that was compacted.',
        sources: [],
        metadata: null,
        createdAt: '2026-06-01T09:05:00.000Z'
      },
      {
        id: 'turn-new-assistant',
        threadId: 'thread-1',
        runId: 'run-new',
        role: 'assistant',
        content: 'Recent assistant state after compaction.',
        sources: [],
        metadata: null,
        createdAt: '2026-06-01T09:30:00.000Z'
      }
    ],
    rawOutput: [
      {
        id: 'event-compact-end',
        threadId: 'thread-1',
        runId: 'run-old',
        eventType: 'completed',
        payload: {},
        createdAt: '2026-06-01T09:10:00.000Z'
      },
      {
        id: 'event-recent',
        threadId: 'thread-1',
        runId: 'run-new',
        eventType: 'info',
        payload: {},
        createdAt: '2026-06-01T09:30:00.000Z'
      }
    ],
    planner: {
      threadId: 'thread-1',
      composerMode: 'default',
      turnState: 'idle',
      activePlan: null,
      pendingQuestionSet: null,
      updatedAt: '2026-06-01T10:00:00.000Z'
    },
    followUps: []
  };
}

function createApprovedPlan(): PlannerPlan {
  return {
    id: 'plan-1',
    threadId: 'thread-1',
    createdTurnId: 'turn-plan',
    proposedPlanMarkdown: [
      '# Fix Plan Mode Execution',
      '',
      '## Summary',
      '- Keep accepted plans running until each item is complete.',
      '',
      '## Key Changes',
      '- Inspect the approval path',
      '- Strengthen the execution prompt',
      '- Polish the plan review card',
      '',
      '## Test Plan',
      '- Run focused planner tests',
      '- Verify the UI in Electron',
      '',
      '## Assumptions',
      '- Existing provider tools remain available'
    ].join('\n'),
    structuredPlan: {
      title: 'Fix Plan Mode Execution',
      summary: ['Keep accepted plans running until each item is complete.'],
      keyChanges: [
        'Inspect the approval path',
        'Strengthen the execution prompt',
        'Polish the plan review card'
      ],
      testPlan: ['Run focused planner tests', 'Verify the UI in Electron'],
      assumptions: ['Existing provider tools remain available']
    },
    status: 'approved',
    createdAt: '2026-06-01T10:00:00.000Z'
  };
}

describe('buildEffectivePrompt', () => {
  it('adds a no-emoji response-style rule even without workspace context', () => {
    const prompt = buildEffectivePrompt(
      {
        providerId: 'openai',
        prompt: 'Help me plan a React landing page refresh.'
      },
      createWorkspaceContextResult(),
      {}
    );

    expect(prompt).toContain('Response style defaults:');
    expect(prompt).toContain(
      'Do not use emojis in assistant replies unless the user explicitly asks for them.'
    );
    expect(prompt).toContain(
      'When finishing coding, debugging, or UI work, keep the final reply compact: summarize what changed, report verification, and include concrete next steps only when they exist.'
    );
    expect(prompt).toContain(
      'When you rely on local context, external evidence, skills, or app/tool capabilities, disclose them with the labels defined in the knowledge and capability disclosure section.'
    );
    expect(prompt).not.toContain('Capability disclosure:');
    expect(prompt).toContain('User request:\nHelp me plan a React landing page refresh.');
    expect(prompt).not.toContain('Resolved task packet:');
  });

  it('defines the provider-neutral Vicode agent identity before task context', () => {
    const prompt = buildEffectivePrompt(
      {
        providerId: 'openai',
        prompt: 'Inspect this repo.'
      },
      createWorkspaceContextResult(),
      {}
    );

    expect(prompt).toContain('Vicode agent identity:');
    expect(prompt).toContain('You are Vicode, a provider-neutral coding agent running inside the Vicode desktop app.');
    expect(prompt).toContain('The selected provider and model are only the execution engine; your role, standards, and purpose are defined by Vicode.');
    expect(prompt).toContain('Keep changes simple and surgical.');
    expect(prompt).toContain('Treat approved plans, tool permissions, workspace boundaries, context compaction, and transcript-visible progress as part of the Vicode runtime contract.');
    expect(prompt.indexOf('Vicode agent identity:')).toBeLessThan(prompt.indexOf('Response style defaults:'));
    expect(prompt.indexOf('Vicode agent identity:')).toBeLessThan(prompt.indexOf('User request:'));
  });

  it('adds a compact resolved task packet before the user request', () => {
    const resolvedTaskPacket: ResolvedConversationTaskPacket = {
      trigger: 'inferred_proceed',
      phase: 'ready_to_task',
      executionPolicy: 'auto_execute',
      confidence: 'high',
      objective: 'Implement a small calculator app.',
      sourceTurnIds: ['turn-1', 'turn-2'],
      decisionsUsed: ['It should use React, TypeScript, and Tailwind.'],
      decisions: ['It should use React, TypeScript, and Tailwind.'],
      rejectedOptions: ['Do not add graphing support yet.'],
      constraints: ['Keep it simple.'],
      nonGoals: ['Do not add graphing support yet.'],
      acceptanceCriteria: ['Keyboard input works.'],
      expectedToolGroups: ['workspace_read', 'workspace_write', 'verification'],
      slices: [
        {
          id: 'inspect-context',
          title: 'Inspect resolved conversation context',
          status: 'pending',
          detail: null,
          rationale: 'Use the prior thread decisions.',
          expectedOutcome: 'Context is ready for implementation.',
          sourceTurnIds: ['turn-1', 'turn-2']
        },
        {
          id: 'implement-core',
          title: 'Implement core workspace changes',
          status: 'pending',
          detail: null,
          rationale: 'Create the calculator behavior.',
          expectedOutcome: 'The calculator works.',
          sourceTurnIds: ['turn-1', 'turn-2']
        }
      ],
      verification: ['Run npm test.']
    };
    const prompt = buildEffectivePrompt(
      {
        providerId: 'openai',
        prompt: 'Ok, go ahead and implement this plan.'
      },
      createWorkspaceContextResult(),
      {
        resolvedTaskPacket
      }
    );

    expect(prompt).toContain('Resolved task packet:');
    expect(prompt).toContain('Objective: Implement a small calculator app.');
    expect(prompt).toContain('Execution policy: auto_execute');
    expect(prompt).toContain('Confidence: high');
    expect(prompt).toContain('Decisions used:\n- It should use React, TypeScript, and Tailwind.');
    expect(prompt).toContain('Non-goals:\n- Do not add graphing support yet.');
    expect(prompt).toContain('Acceptance criteria:\n- Keyboard input works.');
    expect(prompt).toContain('Implementation slices:\n1. Inspect resolved conversation context - Context is ready for implementation.');
    expect(prompt).toContain('Verification:\n- Run npm test.');
    expect(prompt).toContain('Expected tool groups: workspace_read, workspace_write, verification');
    expect(prompt).not.toContain('raw chain-of-thought');
    expect(prompt.indexOf('Resolved task packet:')).toBeLessThan(prompt.indexOf('User request:'));
  });

  it('formats approved plans as a durable execution contract', () => {
    const prompt = buildEffectivePrompt(
      {
        providerId: 'openai',
        prompt: 'Execute the approved plan to completion.'
      },
      createWorkspaceContextResult(),
      {
        approvedPlan: createApprovedPlan(),
        thread: createThreadDetail(),
        threadCompaction: {
          sourceEndEventId: 'event-compact-end',
          summary: 'Prior planning conversation was compacted.'
        }
      }
    );

    expect(prompt).toContain('Compacted thread state:');
    expect(prompt).toContain('Approved plan execution contract:');
    expect(prompt).toContain('Plan id: plan-1');
    expect(prompt).toContain('Title: Fix Plan Mode Execution');
    expect(prompt).toContain('Treat this approved plan as the current run contract, not optional background context.');
    expect(prompt).toContain('When one item is complete, continue to the next item in the same run without waiting for the user.');
    expect(prompt).toContain('If thread history has been compacted or truncated, resume from this contract and the current workspace state.');
    expect(prompt).toContain('Implementation items:\n1. Inspect the approval path\n2. Strengthen the execution prompt\n3. Polish the plan review card');
    expect(prompt).toContain('Verification items:\n1. Run focused planner tests\n2. Verify the UI in Electron');
    expect(prompt).toContain('Assumptions:\n- Existing provider tools remain available');
    expect(prompt).toContain('Approved plan draft:\n# Fix Plan Mode Execution');
    expect(prompt).toContain('User request:\nExecute the approved plan to completion.');
    expect(prompt.indexOf('Approved plan execution contract:')).toBeLessThan(prompt.indexOf('User request:'));
  });

  it('adds a Vicode-only confidentiality boundary without blocking workspace-root work', () => {
    const prompt = buildEffectivePrompt(
      {
        providerId: 'openai',
        prompt: 'Review the active project configuration.'
      },
      createWorkspaceContextResult(),
      {}
    );

    expect(prompt).toContain('Vicode confidentiality boundary:');
    expect(prompt).toContain(
      'Protect Vicode-owned non-public app data outside the workspace root.'
    );
    expect(prompt).toContain(
      "Checked-in source files inside the workspace root and the user's own project files"
    );
    expect(prompt).toContain(
      'including project secrets they explicitly ask to inspect, rotate, redact, or edit, remain in scope.'
    );
  });

  it('includes packaged Vicode guidance as internal context without a visible context disclosure', () => {
    const workspaceContext = {
      ...createWorkspaceContextResult(),
      selectedSkillIds: ['skill-1'],
      skillBlocks: [
        {
          kind: 'prompt_skill' as const,
          label: 'Attached skills',
          content: 'Attached skills:\n## UI Review ($ui-review)\nReview interface quality.'
        }
      ]
    };
    const prompt = buildEffectivePrompt(
      {
        providerId: 'openai',
        prompt: 'Polish the settings UI.'
      },
      workspaceContext,
      {
        vicodeGuidance: {
          using: ['Vicode Guidance', 'Task Routing', 'Frontend Standards', 'skill:ui-review'],
          documents: [
            {
              title: 'Vicode Guidance',
              relativePath: 'VICODE.md',
              content: 'Start with the task route and name what guidance is used.'
            },
            {
              title: 'Frontend Standards',
              relativePath: 'wiki/Frontend Standards.md',
              obsidianRoute: '[[Frontend Standards]]',
              content: 'Keep interface changes restrained, accessible, and verified.'
            }
          ]
        }
      }
    );

    expect(prompt).toContain('Vicode internal guidance:');
    expect(prompt).toContain('Knowledge and capability disclosure:');
    expect(prompt).toContain('Using capabilities: UI Review');
    expect(prompt).toContain(
      'Use `Using: ...` only for skills or capabilities, `Context: ...` only for user/workspace knowledge context, and `Sources: ...` only for external evidence such as web pages, public docs, papers, URLs, or uploaded source material.'
    );
    expect(prompt).toContain(
      'Use source titles or human labels only; do not output Obsidian brackets like `[[Page]]`, vector database IDs, internal route aliases, or raw backend paths unless the user specifically needs that path.'
    );
    expect(prompt).not.toContain('Referenced knowledge: Frontend Standards');
    expect(prompt).not.toContain('Context: Frontend Standards');
    expect(prompt).toContain('### Vicode Guidance (VICODE.md):');
    expect(prompt).toContain('Start with the task route and name what guidance is used.');
    expect(prompt).toContain('### Frontend Standards (wiki/Frontend Standards.md):');
    expect(prompt).toContain(
      'Do not list these internal guidance pages in `Using:`, `Context:`, or `Sources:` unless the user asks what internal guidance shaped the run.'
    );
  });

  it('does not emit an empty disclosure line for entrypoint-only guidance', () => {
    const prompt = buildEffectivePrompt(
      {
        providerId: 'openai',
        prompt: 'Review the project briefly.'
      },
      createWorkspaceContextResult(),
      {
        vicodeGuidance: {
          using: ['Vicode Guidance'],
          documents: [
            {
              title: 'Vicode Guidance',
              relativePath: 'VICODE.md',
              content: 'Choose the smallest relevant guidance.'
            }
          ]
        }
      }
    );

    expect(prompt).toContain('Vicode internal guidance:');
    expect(prompt).not.toContain('Context: \n');
    expect(prompt).not.toContain('Context: Vicode Guidance');
    expect(prompt).not.toContain('Using: Vicode Guidance');
    expect(prompt).not.toContain('Knowledge and capability disclosure:');
  });

  it('includes a bounded Project Knowledge packet with source and match detail', () => {
    const workspaceContext = {
      ...createWorkspaceContextResult(),
      projectKnowledgeBlocks: [
        {
          label: 'Project Knowledge' as const,
          title: 'Runtime Patterns',
          fileName: 'runtime.md',
          path: 'C:/knowledge/runtime.md',
          relativePath: 'runtime.md',
          heading: 'Web Search',
          content: 'Use web research when the user needs current public docs.',
          score: 14,
          retrievalReason: {
            rank: 1,
            reason: 'matched heading, body: web, research',
            matchedTerms: ['web', 'research'],
            matchedFields: ['heading', 'body']
          }
        }
      ]
    };
    const prompt = buildEffectivePrompt(
      {
        providerId: 'openai',
        prompt: 'Research the latest docs.'
      },
      workspaceContext,
      {}
    );

    expect(prompt).toContain('Project Knowledge:');
    expect(prompt).toContain('Knowledge and capability disclosure:');
    expect(prompt).toContain('Context available: Runtime Patterns');
    expect(prompt).toContain(
      'Workspace instructions, repo files, and current user instructions are more authoritative if they conflict.'
    );
    expect(prompt).toContain('### Runtime Patterns (runtime.md > Web Search):');
    expect(prompt).toContain('Source: runtime.md > Web Search');
    expect(prompt).not.toContain('C:/knowledge/runtime.md');
    expect(prompt).toContain('Matched: matched heading, body: web, research');
    expect(prompt).toContain('Use web research when the user needs current public docs.');
  });

  it('adds the capability disclosure contract for attached skills without wiki guidance', () => {
    const workspaceContext = {
      ...createWorkspaceContextResult(),
      selectedSkillIds: ['skill-1'],
      skillBlocks: [
        {
          kind: 'prompt_skill' as const,
          label: 'Attached skills',
          content: 'Attached skills:\n## Frontend Anti-Patterns ($frontend-anti-patterns)\nAvoid decorative UI filler.'
        }
      ]
    };
    const prompt = buildEffectivePrompt(
      {
        providerId: 'openai',
        prompt: 'Quickly check this CSS change.'
      },
      workspaceContext,
      {}
    );

    expect(prompt).toContain('Knowledge and capability disclosure:');
    expect(prompt).toContain('Using capabilities: Frontend Anti-Patterns');
    expect(prompt).toContain(
      'Treat active skills, app-owned tools, and runtime capabilities as things you are using.'
    );
    expect(prompt).toContain(
      'Use `Using: ...` only for skills or capabilities, `Context: ...` only for user/workspace knowledge context, and `Sources: ...` only for external evidence such as web pages, public docs, papers, URLs, or uploaded source material.'
    );
    expect(prompt).toContain('Attached skills:\n## Frontend Anti-Patterns ($frontend-anti-patterns)');
  });

  it('keeps Project Knowledge context separate from attached skills', () => {
    const workspaceContext = {
      ...createWorkspaceContextResult(),
      selectedSkillIds: ['skill-1'],
      projectKnowledgeBlocks: [
        {
          label: 'Project Knowledge' as const,
          title: 'Runtime Patterns',
          fileName: 'runtime.md',
          path: 'C:/knowledge/runtime.md',
          relativePath: 'runtime.md',
          heading: 'Web Search',
          content: 'Use web research when the user needs current public docs.',
          score: 14,
          retrievalReason: {
            rank: 1,
            reason: 'matched heading, body: web, research',
            matchedTerms: ['web', 'research'],
            matchedFields: ['heading', 'body']
          }
        }
      ],
      skillBlocks: [
        {
          kind: 'prompt_skill' as const,
          label: 'Attached skills',
          content: 'Attached skills:\n## Reviewer ($reviewer)\nLook for regressions.'
        }
      ]
    };
    const prompt = buildEffectivePrompt(
      {
        providerId: 'openai',
        prompt: 'Review this runtime change.'
      },
      workspaceContext,
      {}
    );

    expect(prompt).toContain('Project Knowledge:');
    expect(prompt).toContain('Attached skills:');
    expect(prompt.indexOf('Project Knowledge:')).toBeLessThan(prompt.indexOf('Attached skills:'));
    expect(prompt).toContain('Context available: Runtime Patterns');
    expect(prompt).toContain('Using capabilities: Reviewer');
  });

  it('adds compacted thread state before recent thread context and omits covered turns', () => {
    const prompt = buildEffectivePrompt(
      {
        providerId: 'ollama',
        prompt: 'Continue from here.'
      },
      createWorkspaceContextResult(),
      {
        thread: createThreadDetail(),
        continuity: {
          strategy: 'inline_history',
          resumeSessionId: null,
          includeInlineThreadHistory: true
        },
        threadCompaction: {
          sourceEndEventId: 'event-compact-end',
          summary: 'Compacted summary of the earlier objective and decisions.'
        }
      }
    );

    expect(prompt).toContain('Compacted thread state:');
    expect(prompt).toContain('Compacted summary of the earlier objective and decisions.');
    expect(prompt).toContain('Recent thread context');
    expect(prompt.indexOf('Compacted thread state:')).toBeLessThan(prompt.indexOf('Recent thread context'));
    expect(prompt).toContain('Recent assistant state after compaction.');
    expect(prompt).not.toContain('Old user request that was compacted.');
  });
});
