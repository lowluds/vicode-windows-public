import { describe, expect, it } from 'vitest';
import { parseHarnessTaskPlan } from './harness-task-plan';

describe('parseHarnessTaskPlan', () => {
  it('accepts a compact provider-neutral task plan', () => {
    expect(
      parseHarnessTaskPlan({
        phase: 'task_plan',
        objective: 'Make the composer distinguish chat from task execution.',
        acceptanceCriteria: ['Brainstorming remains non-mutating.'],
        steps: [
          {
            id: 'inspect-boundary',
            title: 'Inspect current prompt-to-task contract',
            status: 'completed',
            detail: 'Read the shared harness contract and provider execution handoff.'
          },
          {
            id: 'add-guard',
            title: 'Add deterministic task-boundary coverage'
          }
        ]
      })
    ).toEqual({
      phase: 'task_plan',
      objective: 'Make the composer distinguish chat from task execution.',
      acceptanceCriteria: ['Brainstorming remains non-mutating.'],
      steps: [
        {
          id: 'inspect-boundary',
          title: 'Inspect current prompt-to-task contract',
          status: 'completed',
          detail: 'Read the shared harness contract and provider execution handoff.'
        },
        {
          id: 'add-guard',
          title: 'Add deterministic task-boundary coverage',
          status: 'pending',
          detail: null
        }
      ]
    });
  });

  it('rejects plans without concrete steps', () => {
    expect(
      parseHarnessTaskPlan({
        phase: 'task_plan',
        objective: 'Do work.',
        steps: []
      })
    ).toBeNull();
  });
});
