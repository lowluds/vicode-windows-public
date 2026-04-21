import type { ProviderPlannerPolicy } from '../../shared/domain';

export interface PlannerSafetyCopy {
  badge: string;
  note: string;
}

export function getPlannerSafetyCopy(policy: ProviderPlannerPolicy | null | undefined): PlannerSafetyCopy | null {
  if (!policy?.supported || policy.enforcement !== 'best-effort') {
    return null;
  }

  if (policy.executionMode === 'full-access') {
    return {
      badge: 'Best effort',
      note: 'Gemini planner currently runs with full-access execution. It can still ask questions, but read-only planning is not enforced yet.'
    };
  }

  return {
    badge: 'Best effort',
    note: 'This planner run is best-effort. Read-only behavior is not hard-enforced.'
  };
}
