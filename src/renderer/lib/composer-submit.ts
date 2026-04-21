import type { ComposerSubmitInput, ThreadDetail } from '../../shared/domain';

type OptimisticComposerInput = Pick<
  ComposerSubmitInput,
  'prompt' | 'executionPermission' | 'skillIds' | 'imageAttachments' | 'textAttachments'
>;

export interface OptimisticComposerThreadUpdate {
  thread: ThreadDetail;
  turnId: string;
}

export function applyOptimisticComposerTurn(
  thread: ThreadDetail,
  input: OptimisticComposerInput,
  createdAt: string
): OptimisticComposerThreadUpdate {
  const turnId = `optimistic-user:${thread.id}:${createdAt}`;
  return {
    turnId,
    thread: {
      ...thread,
      executionPermission: input.executionPermission,
      status: 'queued',
      lastMessageAt: createdAt,
      updatedAt: createdAt,
      lastPreview: input.prompt,
      planner: {
        ...thread.planner,
        composerMode: 'default',
        turnState: 'idle',
        activePlanId: null,
        pendingQuestionCallId: null,
        activePlan: null,
        pendingQuestionSet: null
      },
      turns: [
        ...thread.turns,
        {
          id: turnId,
          threadId: thread.id,
          runId: null,
          role: 'user',
          content: input.prompt,
          metadata: {
            executionPermission: input.executionPermission,
            imageAttachments: input.imageAttachments ?? [],
            textAttachments: input.textAttachments ?? [],
            skillIds: input.skillIds,
            optimistic: true
          },
          createdAt
        }
      ]
    }
  };
}
