import type { ProviderReasoningEffort, ThreadDetail } from '../../shared/domain';

export interface BuildPlanThreadReadiness {
  enabled: boolean;
  reason: string | null;
}

const BUILD_PLAN_SETUP_PREFIX = 'Build plan setup / ';

export function deriveBuildPlanSetupTitle(goal: string) {
  const trimmed = goal.trim();
  const sentence = trimmed.split(/[.!?]/u)[0]?.trim() ?? trimmed;
  if (!sentence) {
    return 'Build plan setup';
  }
  const compact = sentence.length <= 56 ? sentence : `${sentence.slice(0, 53).trimEnd()}...`;
  return `${BUILD_PLAN_SETUP_PREFIX}${compact}`;
}

export function isBuildPlanSetupThread(thread: Pick<ThreadDetail, 'title'> | null) {
  return Boolean(thread?.title?.startsWith(BUILD_PLAN_SETUP_PREFIX));
}

export function buildPlanSetupPrompt(goal: string) {
  return [
    'You are setting up a new Vicode build plan.',
    '',
    `Goal: ${goal.trim()}`,
    '',
    'Work only inside this setup thread.',
    'First, restate the goal in one short paragraph.',
    'Then ask up to 3 concise clarifying questions only if the scope is genuinely ambiguous.',
    'If the goal is already clear enough, say that no clarification is needed and propose a minimal build plan.',
    '',
    'When proposing the plan, use this exact markdown shape:',
    '# <Short plan name>',
    '',
    '## Summary',
    '- Target outcome: <one sentence>',
    '',
    '## Key Changes',
    '- Planner lane: <what planner owns>',
    '- Builder lane: <what builder owns>',
    '- Finisher lane: <what finisher owns>',
    '- First bounded slice: <the first slice to run>',
    '',
    '## Test Plan',
    '- <how this should be verified>',
    '',
    '## Assumptions',
    '- <only if needed>',
    '',
    'Do not edit files yet. Stay in planning and setup mode until the user confirms the shape of the build plan.'
  ].join('\n');
}

export function getBuildPlanThreadReadiness(thread: ThreadDetail | null): BuildPlanThreadReadiness {
  if (!thread) {
    return {
      enabled: false,
      reason: 'Open the setup thread you want to turn into a build plan first.'
    };
  }
  if (thread.status === 'queued' || thread.status === 'running' || thread.status === 'stopping') {
    return {
      enabled: false,
      reason: 'Wait for the setup thread to finish its current planner run first.'
    };
  }
  if (thread.planner.pendingQuestionSet) {
    return {
      enabled: false,
      reason: 'Answer the planner follow-up questions in this setup thread before creating the build plan.'
    };
  }
  if (!thread.planner.activePlan) {
    return {
      enabled: false,
      reason: 'Use Plan mode in this thread to generate a planner draft before creating the build plan.'
    };
  }
  if (thread.planner.activePlan.status === 'superseded') {
    return {
      enabled: false,
      reason: 'The latest planner draft in this thread was replaced. Generate a fresh draft first.'
    };
  }
  if (!thread.planner.activePlan.structuredPlan) {
    return {
      enabled: false,
      reason: 'This thread needs a structured planner artifact before it can become a build plan.'
    };
  }
  if (thread.planner.turnState !== 'plan_ready' && thread.planner.activePlan.status !== 'approved') {
    return {
      enabled: false,
      reason: 'Wait for the planner draft to finish generating before creating the build plan.'
    };
  }
  return {
    enabled: true,
    reason: null
  };
}

export function buildPlanReasoningLabel(effort: ProviderReasoningEffort | null | undefined) {
  switch (effort) {
    case 'low':
    case 'minimal':
    case 'none':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'xhigh':
      return 'Extra high';
    case 'high':
      return 'High';
    default:
      return 'Default';
  }
}

export function modelBadgeClassName(recommendation: string | null) {
  if (recommendation === 'Default') {
    return 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100';
  }
  if (recommendation === 'Quick') {
    return 'border-sky-400/20 bg-sky-500/10 text-sky-100';
  }
  if (recommendation === 'Preview') {
    return 'border-amber-400/20 bg-amber-500/10 text-amber-100';
  }
  return 'border-white/10 bg-white/[0.04] text-zinc-300';
}
