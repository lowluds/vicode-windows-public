import type { ProviderId } from './domain';

export const RELEASE_WORKFLOW_LADDER = [
  {
    tier: 1,
    title: 'Basic execution',
    checks: ['plain_chat', 'follow_up_chat', 'thread_persistence', 'truthful_failures']
  },
  {
    tier: 2,
    title: 'Guided coding',
    checks: ['prompt_skill_attach', 'slash_commands', 'planner_or_plan_fallback', 'simple_file_create_edit']
  },
  {
    tier: 3,
    title: 'Small build',
    checks: ['small_app_scaffold', 'multi_file_write', 'workspace_correctness', 'useful_final_response']
  },
  {
    tier: 4,
    title: 'Iterative development',
    checks: ['iterative_refine', 'coordinated_multi_file_change', 'follow_up_reliability', 'low_narration_noise']
  },
  {
    tier: 5,
    title: 'Complex project slice',
    checks: ['feature_slice_completion', 'debug_or_repair', 'skill_and_command_clarity', 'multi_turn_quality']
  }
] as const;

export type ReleaseWorkflowTier = (typeof RELEASE_WORKFLOW_LADDER)[number]['tier'];

export interface ProviderGraduationTarget {
  providerId: ProviderId;
  releaseBlocking: boolean;
  targetTier: ReleaseWorkflowTier;
  stretchTier: ReleaseWorkflowTier | null;
  summary: string;
}

export const PROVIDER_GRADUATION_TARGETS: Record<ProviderId, ProviderGraduationTarget> = {
  openai: {
    providerId: 'openai',
    releaseBlocking: true,
    targetTier: 5,
    stretchTier: null,
    summary: 'Highest-fidelity benchmark provider. Must pass the full complex-project ladder.'
  },
  gemini: {
    providerId: 'gemini',
    releaseBlocking: true,
    targetTier: 5,
    stretchTier: null,
    summary: 'Second release-blocking provider. Must pass the full complex-project ladder on stable Gemini 2.5 routes.'
  },
  ollama: {
    providerId: 'ollama',
    releaseBlocking: false,
    targetTier: 4,
    stretchTier: 5,
    summary: 'Graduate hosted and local Ollama to serious iterative app-building quality on preferred model sets.'
  },
  qwen: {
    providerId: 'qwen',
    releaseBlocking: false,
    targetTier: 1,
    stretchTier: null,
    summary: 'Compatibility lane only. Keep basic run sanity truthful, but do not spend active production-hardening effort here.'
  },
  kimi: {
    providerId: 'kimi',
    releaseBlocking: false,
    targetTier: 1,
    stretchTier: null,
    summary: 'Compatibility lane only. Keep basic run sanity truthful, but do not spend active production-hardening effort here.'
  }
};

export const APP_BUILDER_BENCHMARKS = [
  {
    id: 'marketing-site',
    title: 'Marketing site',
    targetTier: 4,
    summary: 'Build and iteratively refine a polished multi-section landing page.'
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    targetTier: 4,
    summary: 'Build a multi-file product dashboard with reusable layout and iterative follow-up edits.'
  },
  {
    id: 'crud-app',
    title: 'CRUD app',
    targetTier: 5,
    summary: 'Build a realistic CRUD surface with forms, list/detail views, validation, and state flow.'
  },
  {
    id: 'docs-site',
    title: 'Docs/content site',
    targetTier: 4,
    summary: 'Build a reusable docs or content site with structured pages and shared navigation.'
  },
  {
    id: 'auth-app',
    title: 'Auth-based app',
    targetTier: 5,
    summary: 'Build an auth-aware shell with guarded views and truthful backend/auth limits.'
  },
  {
    id: 'existing-project-refinement',
    title: 'Existing-project refinement',
    targetTier: 4,
    summary: 'Take an existing small app and redesign, refactor, and extend it without losing structure.'
  },
  {
    id: 'bugfix-slice',
    title: 'Bugfix/debug slice',
    targetTier: 5,
    summary: 'Diagnose a broken app slice, fix it, and explain the resolution cleanly.'
  },
  {
    id: 'same-thread-complex-project',
    title: 'Same-thread complex project',
    targetTier: 5,
    summary: 'Build, refine, and repair a larger multi-file feature slice across multiple turns in the same thread.'
  }
] as const;

export type AppBuilderBenchmarkId = (typeof APP_BUILDER_BENCHMARKS)[number]['id'];

export const PROVIDER_BENCHMARK_REQUIREMENTS: Record<ProviderId, readonly AppBuilderBenchmarkId[]> = {
  openai: APP_BUILDER_BENCHMARKS.map((benchmark) => benchmark.id),
  gemini: APP_BUILDER_BENCHMARKS.map((benchmark) => benchmark.id),
  ollama: ['marketing-site', 'dashboard', 'docs-site', 'existing-project-refinement', 'bugfix-slice'],
  qwen: [],
  kimi: []
};

export function getProviderGraduationTarget(providerId: ProviderId) {
  return PROVIDER_GRADUATION_TARGETS[providerId];
}

export function getProviderBenchmarkRequirements(providerId: ProviderId) {
  return PROVIDER_BENCHMARK_REQUIREMENTS[providerId];
}
