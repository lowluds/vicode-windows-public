import type { PlannerPlan, PlannerQuestionSet, ThreadPlannerState } from '../../shared/domain';

export interface VisiblePlannerArtifacts {
  questionSet: PlannerQuestionSet | null;
  plan: PlannerPlan | null;
}

export function deriveVisiblePlannerArtifacts(
  planner: ThreadPlannerState | null | undefined
): VisiblePlannerArtifacts {
  if (!planner) {
    return {
      questionSet: null,
      plan: null
    };
  }

  const questionSet =
    planner.composerMode === 'plan'
      ? planner.pendingQuestionSet ?? null
      : null;

  if (!planner.activePlan) {
    return {
      questionSet,
      plan: null
    };
  }

  const plan =
    planner.activePlan.status === 'approved'
      ? (planner.turnState === 'executing_from_plan' ? planner.activePlan : null)
      : (planner.composerMode === 'plan' && planner.turnState !== 'idle' ? planner.activePlan : null);

  return {
    questionSet,
    plan
  };
}
