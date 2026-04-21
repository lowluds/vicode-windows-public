import { describe, expect, it } from 'vitest';
import type { ThreadDetail } from '../../shared/domain';
import {
  buildPlanReasoningLabel,
  buildPlanSetupPrompt,
  deriveBuildPlanSetupTitle,
  getBuildPlanThreadReadiness,
  isBuildPlanSetupThread,
  modelBadgeClassName
} from './build-plan';

function createThread(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Build plan setup',
    providerId: 'openai',
    modelId: 'gpt-5',
    executionPermission: 'default',
    status: 'completed',
    turns: [],
    rawOutput: [],
    planner: {
      composerMode: 'plan',
      turnState: 'plan_ready',
      activePlan: {
        planId: 'plan-1',
        threadId: 'thread-1',
        createdTurnId: 'turn-1',
        proposedPlanMarkdown: '# Plan',
        structuredPlan: {
          summary: 'Summary',
          steps: [],
          acceptanceCriteria: [],
          risks: []
        },
        status: 'pending',
        createdAt: '2026-04-01T00:00:00.000Z'
      },
      pendingQuestionSet: null
    },
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides
  };
}

describe('build-plan helpers', () => {
  it('derives a compact build plan setup title', () => {
    expect(deriveBuildPlanSetupTitle('Refactor the provider manager so responsibilities are smaller and easier to test.')).toBe(
      'Build plan setup / Refactor the provider manager so responsibilities are...'
    );
  });

  it('keeps the setup prompt planning-only', () => {
    const prompt = buildPlanSetupPrompt('Split the oversized app shell into maintainable modules.');

    expect(prompt).toContain('Goal: Split the oversized app shell into maintainable modules.');
    expect(prompt).toContain('Do not edit files yet.');
    expect(prompt).toContain('## Key Changes');
  });

  it('blocks build-plan creation when the planner state is not ready', () => {
    expect(
      getBuildPlanThreadReadiness(
        createThread({
          planner: {
            composerMode: 'plan',
            turnState: 'awaiting_answers',
            activePlan: null,
            pendingQuestionSet: null
          }
        })
      )
    ).toEqual({
      enabled: false,
      reason: 'Use Plan mode in this thread to generate a planner draft before creating the build plan.'
    });
  });

  it('allows build-plan creation when the planner draft is structured and ready', () => {
    expect(getBuildPlanThreadReadiness(createThread())).toEqual({
      enabled: true,
      reason: null
    });
  });

  it('maps build-plan labels to stable display text and badge classes', () => {
    expect(buildPlanReasoningLabel('xhigh')).toBe('Extra high');
    expect(buildPlanReasoningLabel(null)).toBe('Default');
    expect(modelBadgeClassName('Preview')).toContain('amber');
    expect(modelBadgeClassName(null)).toContain('border-white/10');
  });

  it('detects setup threads by their dedicated title prefix', () => {
    expect(isBuildPlanSetupThread(createThread({ title: 'Build plan setup / Repair the Vitest 3 pipeline' }))).toBe(true);
    expect(isBuildPlanSetupThread(createThread({ title: 'General thread' }))).toBe(false);
    expect(isBuildPlanSetupThread(null)).toBe(false);
  });
});
