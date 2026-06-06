import { describe, expect, it } from 'vitest';
import type { ImageAttachment, ProviderDescriptor, ProviderId, RunEvent, TextAttachment, ThreadDetail, ThreadSummary } from '../../shared/domain';
import {
  appendRunEvent,
  deriveRecentThreads,
  extractThreadSkillIds,
  extractTurnImageAttachments,
  extractTurnTextAttachments,
  hasAssistantTurnForRun,
  isVisiblePlannerPlanTurn,
  isVisibleTranscriptTurn,
  surfaceProviders,
  upsertRecentThread
} from './thread-presentation';

function createThreadSummary(overrides: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Thread',
    providerId: 'openai',
    modelId: 'gpt-5',
    executionPermission: 'default',
    status: 'completed',
    archived: false,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    lastMessageAt: '2026-04-01T00:00:00.000Z',
    lastPreview: 'Preview',
    ...overrides
  };
}

function createThreadDetail(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Thread',
    providerId: 'openai',
    modelId: 'gpt-5',
    executionPermission: 'default',
    status: 'completed',
    turns: [],
    rawOutput: [],
    planner: {
      composerMode: 'default',
      turnState: 'idle',
      activePlan: null,
      pendingQuestionSet: null
    },
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides
  };
}

function createProviderDescriptor(id: ProviderId): ProviderDescriptor {
  return {
    id,
    label: id,
    authState: 'connected',
    authMode: null,
    installed: true,
    models: [],
    modelSource: 'runtime',
    modelsUpdatedAt: null,
    canLiveDiscoverModels: true,
    cliPath: `${id}.cmd`,
    capabilities: {
      supportsThinkingToggle: false,
      supportsRuntimeSkillResources: false,
      supportsNativeRunProgress: false,
      executionAuthority: 'provider_cli',
      approvalAuthority: 'provider_cli',
      sandboxAuthority: 'provider_cli',
      requiresTrustedWorkspace: true,
      requiresFullAccessForAppRuns: false,
      workspaceInstructionFileName: `${id}.md`
    },
    plannerPolicy: {
      supported: true,
      executionMode: 'workspace-write',
      enforcement: 'hard-enforced'
    }
  };
}

describe('thread-presentation helpers', () => {
  it('surfaces the release-facing providers while keeping discontinued providers out of primary chrome', () => {
    expect(
      surfaceProviders([
        createProviderDescriptor('openai'),
        createProviderDescriptor('gemini'),
        createProviderDescriptor('qwen'),
        createProviderDescriptor('ollama'),
        createProviderDescriptor('kimi')
      ]).map((provider) => provider.id)
    ).toEqual(['ollama']);
  });

  it('keeps recent threads sorted by latest activity across projects', () => {
    const recent = deriveRecentThreads({
      a: [
        createThreadSummary({
          id: 'older',
          updatedAt: '2026-04-01T00:00:01.000Z',
          lastMessageAt: '2026-04-01T00:00:01.000Z'
        })
      ],
      b: [
        createThreadSummary({
          id: 'newer',
          updatedAt: '2026-04-01T00:00:03.000Z',
          lastMessageAt: '2026-04-01T00:00:02.000Z'
        })
      ]
    });

    expect(recent.map((thread) => thread.id)).toEqual(['newer', 'older']);
  });

  it('upserts recent threads and removes archived ones', () => {
    const existing = [
      createThreadSummary({ id: 'keep', updatedAt: '2026-04-01T00:00:01.000Z' }),
      createThreadSummary({ id: 'replace', updatedAt: '2026-04-01T00:00:02.000Z' })
    ];

    expect(
      upsertRecentThread(existing, createThreadSummary({ id: 'replace', updatedAt: '2026-04-01T00:00:03.000Z' })).map(
        (thread) => thread.id
      )
    ).toEqual(['replace', 'keep']);

    expect(
      upsertRecentThread(existing, createThreadSummary({ id: 'keep', archived: true, status: 'archived' })).map(
        (thread) => thread.id
      )
    ).toEqual(['replace']);
  });

  it('parses valid image attachments and ignores malformed entries', () => {
    const validAttachment: ImageAttachment = {
      id: 'image-1',
      name: 'screenshot.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,abc'
    };

    expect(
      extractTurnImageAttachments({
        imageAttachments: [validAttachment, { invalid: true }]
      })
    ).toEqual([validAttachment]);
  });

  it('parses valid text attachments and ignores malformed entries', () => {
    const validAttachment: TextAttachment = {
      id: 'text-1',
      name: 'pasted-context.txt',
      mimeType: 'text/plain',
      relativePath: '.vicode/composer-attachments/pasted-context.txt',
      absolutePath: 'C:/workspace/.vicode/composer-attachments/pasted-context.txt',
      charCount: 2048
    };

    expect(
      extractTurnTextAttachments({
        textAttachments: [validAttachment, { invalid: true }]
      })
    ).toEqual([validAttachment]);
  });

  it('filters transcript turns and planner plan turns correctly', () => {
    const assistantPlanTurn = {
      id: 'turn-plan',
      runId: 'run-1',
      role: 'assistant',
      content: '',
      metadata: { plannerArtifactType: 'plan' },
      createdAt: '2026-04-01T00:00:00.000Z'
    } as ThreadDetail['turns'][number];
    const userAnswerTurn = {
      id: 'turn-answer',
      runId: null,
      role: 'user',
      content: 'answer',
      metadata: { plannerPhase: 'answer' },
      createdAt: '2026-04-01T00:00:00.000Z'
    } as ThreadDetail['turns'][number];

    expect(isVisibleTranscriptTurn(assistantPlanTurn)).toBe(false);
    expect(isVisibleTranscriptTurn(userAnswerTurn)).toBe(false);
    expect(
      isVisiblePlannerPlanTurn(assistantPlanTurn, {
        planId: 'plan-1',
        threadId: 'thread-1',
        createdTurnId: 'turn-plan',
        proposedPlanMarkdown: '# Plan',
        structuredPlan: null,
        status: 'pending',
        createdAt: '2026-04-01T00:00:00.000Z'
      })
    ).toBe(true);
  });

  it('deduplicates run events and finds assistant turns for a run', () => {
    const event: RunEvent = {
      id: 'event-1',
      threadId: 'thread-1',
      runId: 'run-1',
      eventType: 'info',
      payload: {},
      createdAt: '2026-04-01T00:00:00.000Z'
    };
    const thread = createThreadDetail({
      turns: [
        {
          id: 'turn-1',
          runId: 'run-1',
          role: 'assistant',
          content: 'Done',
          metadata: null,
          createdAt: '2026-04-01T00:00:00.000Z'
        }
      ]
    });

    expect(appendRunEvent([event], event)).toEqual([event]);
    expect(hasAssistantTurnForRun(thread, 'run-1')).toBe(true);
    expect(extractThreadSkillIds(createThreadDetail({
      turns: [
        {
          id: 'turn-2',
          runId: null,
          role: 'user',
          content: 'Prompt',
          metadata: { skillIds: ['skill-a', 'skill-b', 4] },
          createdAt: '2026-04-01T00:00:00.000Z'
        } as ThreadDetail['turns'][number]
      ]
    }))).toEqual(['skill-a', 'skill-b']);
  });
});
