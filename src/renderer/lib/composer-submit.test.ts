import { describe, expect, it } from 'vitest';
import type { ImageAttachment, ThreadDetail } from '../../shared/domain';
import { applyOptimisticComposerTurn, buildComposerSubmitInput } from './composer-submit';

function createThread(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Improve composer',
    providerId: 'openai',
    modelId: 'gpt-5',
    executionPermission: 'default',
    status: 'completed',
    archived: false,
    lastMessageAt: '2026-03-21T10:00:00.000Z',
    createdAt: '2026-03-21T09:00:00.000Z',
    updatedAt: '2026-03-21T10:00:00.000Z',
    lastPreview: 'Existing message',
    turns: [
      {
        id: 'turn-1',
        threadId: 'thread-1',
        runId: null,
        role: 'assistant',
        content: 'Existing response',
        metadata: null,
        createdAt: '2026-03-21T10:00:00.000Z'
      }
    ],
    rawOutput: [],
    planner: {
      threadId: 'thread-1',
      composerMode: 'default',
      turnState: 'idle',
      activePlanId: null,
      pendingQuestionCallId: null,
      updatedAt: '2026-03-21T10:00:00.000Z',
      activePlan: null,
      pendingQuestionSet: null
    },
    followUps: [],
    ...overrides
  };
}

describe('applyOptimisticComposerTurn', () => {
  it('appends a local user turn immediately for idle-thread sends', () => {
    const image: ImageAttachment = {
      id: 'image-1',
      name: 'mockup.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AAAA'
    };
    const createdAt = '2026-03-21T10:15:00.000Z';

    const result = applyOptimisticComposerTurn(
      createThread(),
      {
        prompt: 'Use $frontend-polish on the composer.',
        executionPermission: 'full_access',
        skillIds: ['skill-1'],
        imageAttachments: [image]
      },
      createdAt
    );

    expect(result.thread.status).toBe('queued');
    expect(result.thread.executionPermission).toBe('full_access');
    expect(result.thread.lastPreview).toBe('Use $frontend-polish on the composer.');
    expect(result.thread.lastMessageAt).toBe(createdAt);
    expect(result.thread.turns).toHaveLength(2);
    expect(result.thread.turns.at(-1)).toEqual(
      expect.objectContaining({
        id: result.turnId,
        role: 'user',
        content: 'Use $frontend-polish on the composer.',
        runId: null,
        createdAt,
        metadata: expect.objectContaining({
          executionPermission: 'full_access',
          imageAttachments: [image],
          optimistic: true,
          skillIds: ['skill-1']
        })
      })
    );
  });

  it('clears planner artifacts from the optimistic snapshot for normal prompt sends', () => {
    const createdAt = '2026-03-21T10:15:00.000Z';

    const result = applyOptimisticComposerTurn(
      createThread({
        planner: {
          threadId: 'thread-1',
          composerMode: 'plan',
          turnState: 'plan_ready',
          activePlanId: 'plan-1',
          pendingQuestionCallId: 'call-1',
          updatedAt: '2026-03-21T10:00:00.000Z',
          activePlan: {
            id: 'plan-1',
            threadId: 'thread-1',
            createdTurnId: 'turn-1',
            proposedPlanMarkdown: '# Example plan',
            structuredPlan: null,
            status: 'draft',
            createdAt: '2026-03-21T10:00:00.000Z'
          },
          pendingQuestionSet: {
            id: 'question-set-1',
            threadId: 'thread-1',
            promptTurnId: 'turn-1',
            callId: 'call-1',
            questions: [],
            answers: null,
            createdAt: '2026-03-21T10:00:00.000Z'
          }
        }
      }),
      {
        prompt: 'Continue with the normal run.',
        executionPermission: 'default',
        skillIds: [],
        imageAttachments: [],
        textAttachments: []
      },
      createdAt
    );

    expect(result.thread.planner).toEqual(
      expect.objectContaining({
        composerMode: 'default',
        turnState: 'idle',
        activePlanId: null,
        pendingQuestionCallId: null,
        activePlan: null,
        pendingQuestionSet: null
      })
    );
  });

  it('builds composer submit input with the selected isolation mode', () => {
    const input = buildComposerSubmitInput({
      projectId: 'project-1',
      threadId: 'thread-1',
      prompt: '  Update the helper.  ',
      providerId: 'openai',
      modelId: 'gpt-5',
      reasoningEffort: 'high',
      thinkingEnabled: true,
      executionPermission: 'default',
      isolationMode: 'patch_buffer',
      skillIds: ['skill-1'],
      imageAttachments: [],
      textAttachments: []
    });

    expect(input).toMatchObject({
      projectId: 'project-1',
      threadId: 'thread-1',
      prompt: 'Update the helper.',
      providerId: 'openai',
      modelId: 'gpt-5',
      reasoningEffort: 'high',
      thinkingEnabled: true,
      executionPermission: 'default',
      isolationMode: 'patch_buffer',
      skillIds: ['skill-1']
    });
  });

  it('preserves explicit git worktree isolation when building composer submit input', () => {
    const input = buildComposerSubmitInput({
      projectId: 'project-1',
      threadId: 'thread-1',
      prompt: '  Update the helper in isolation.  ',
      providerId: 'openai',
      modelId: 'gpt-5',
      reasoningEffort: null,
      thinkingEnabled: false,
      executionPermission: 'full_access',
      isolationMode: 'git_worktree',
      skillIds: [],
      imageAttachments: [],
      textAttachments: []
    });

    expect(input.prompt).toBe('Update the helper in isolation.');
    expect(input.isolationMode).toBe('git_worktree');
  });
});
