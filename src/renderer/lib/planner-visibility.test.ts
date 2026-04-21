import { describe, expect, it } from 'vitest';
import type { ThreadPlannerState } from '../../shared/domain';
import { deriveVisiblePlannerArtifacts } from './planner-visibility';

function createPlannerState(overrides: Partial<ThreadPlannerState> = {}): ThreadPlannerState {
  return {
    threadId: 'thread-1',
    composerMode: 'plan',
    turnState: 'plan_ready',
    activePlanId: 'plan-1',
    pendingQuestionCallId: null,
    updatedAt: '2026-04-20T00:00:00.000Z',
    activePlan: {
      id: 'plan-1',
      threadId: 'thread-1',
      createdTurnId: 'turn-1',
      proposedPlanMarkdown: '# Example plan',
      structuredPlan: null,
      status: 'draft',
      createdAt: '2026-04-20T00:00:00.000Z'
    },
    pendingQuestionSet: null,
    ...overrides
  };
}

describe('deriveVisiblePlannerArtifacts', () => {
  it('shows planner questions only while plan mode is active', () => {
    const questionSet = {
      id: 'question-set-1',
      threadId: 'thread-1',
      promptTurnId: 'turn-1',
      callId: 'call-1',
      questions: [],
      answers: null,
      createdAt: '2026-04-20T00:00:00.000Z'
    };

    expect(
      deriveVisiblePlannerArtifacts(
        createPlannerState({
          activePlanId: null,
          activePlan: null,
          pendingQuestionCallId: 'call-1',
          pendingQuestionSet: questionSet
        })
      )
    ).toEqual({
      questionSet,
      plan: null
    });
  });

  it('hides a stale draft after the planner session has been cancelled', () => {
    expect(
      deriveVisiblePlannerArtifacts(
        createPlannerState({
          composerMode: 'default',
          turnState: 'idle'
        })
      )
    ).toEqual({
      questionSet: null,
      plan: null
    });
  });

  it('keeps the approved plan visible while execution is running from that plan', () => {
    const planner = createPlannerState({
      composerMode: 'default',
      turnState: 'executing_from_plan',
      activePlan: {
        id: 'plan-1',
        threadId: 'thread-1',
        createdTurnId: 'turn-1',
        proposedPlanMarkdown: '# Example plan',
        structuredPlan: null,
        status: 'approved',
        createdAt: '2026-04-20T00:00:00.000Z'
      }
    });

    expect(deriveVisiblePlannerArtifacts(planner)).toEqual({
      questionSet: null,
      plan: planner.activePlan
    });
  });
});
