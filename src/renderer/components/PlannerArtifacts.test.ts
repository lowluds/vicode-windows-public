import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlannerPlan, PlannerQuestionSet } from '../../shared/domain';
import { PlannerPlanCard, PlannerPlanStatusRow, PlannerQuestionCard } from './PlannerArtifacts';

function createPlan(title: string, overrides: Partial<PlannerPlan> = {}): PlannerPlan {
  return {
    id: 'plan-1',
    threadId: 'thread-1',
    createdTurnId: 'turn-1',
    proposedPlanMarkdown: `# ${title}`,
    structuredPlan: {
      title,
      summary: ['Remove stale queue noise.'],
      keyChanges: [],
      testPlan: [],
      assumptions: []
    },
    status: 'draft',
    createdAt: '2026-03-30T10:00:00.000Z',
    ...overrides
  };
}

function createQuestionSet(overrides: Partial<PlannerQuestionSet> = {}): PlannerQuestionSet {
  return {
    id: 'question-set-1',
    threadId: 'thread-1',
    promptTurnId: 'turn-1',
    callId: 'call-1',
    questions: [
      {
        id: 'path',
        header: 'Path',
        question: 'For v1, which path are you actually aiming for?',
        options: [
          { id: 'self-host', label: 'Self-host open model', description: 'Best when you want local control and zero hosted dependency.' },
          { id: 'fine-tune', label: 'Fine-tune open model', description: 'Best when you want a tuned workflow on top of an existing base.' },
          { id: 'scratch', label: 'Train from scratch', description: 'Best when you need full ownership and have serious compute budget.' }
        ],
        recommendedOptionId: 'self-host',
        allowOther: true
      }
    ],
    answers: null,
    createdAt: '2026-04-19T10:00:00.000Z',
    ...overrides
  };
}

describe('PlannerArtifacts', () => {
  it('sanitizes leaked prompt text in the visible plan title', () => {
    const plan = createPlan('**Title:** Silent Build Queue Autonomy Target outcome: Remove stale review noise');

    const cardHtml = renderToStaticMarkup(
      React.createElement(PlannerPlanCard, {
        plan,
        plannerPolicy: null,
        renderedMarkdown: '',
        approving: false,
        submitting: false,
        onApprove: async () => undefined,
        onRequestChanges: async () => undefined,
        onCancelPlan: async () => undefined
      })
    );
    const statusHtml = renderToStaticMarkup(React.createElement(PlannerPlanStatusRow, { plan }));

    expect(cardHtml).toContain('Silent Build Queue Autonomy');
    expect(cardHtml).not.toContain('Target outcome: Remove stale review noise');
    expect(statusHtml).toContain('Silent Build Queue Autonomy');
    expect(statusHtml).not.toContain('Target outcome: Remove stale review noise');
  });

  it('supports build-control specific approval copy', () => {
    const plan = createPlan('Autonomous Vitest 3 Repair');

    const cardHtml = renderToStaticMarkup(
      React.createElement(PlannerPlanCard, {
        plan,
        plannerPolicy: null,
        renderedMarkdown: '',
        approving: false,
        submitting: false,
        approveLabel: 'Accept and start Build Control',
        approvedCardText: 'This plan was approved and handed off into Build Control.',
        onApprove: async () => undefined,
        onRequestChanges: async () => undefined,
        onCancelPlan: async () => undefined
      })
    );
    const statusHtml = renderToStaticMarkup(
      React.createElement(PlannerPlanStatusRow, {
        plan: { ...plan, status: 'approved' },
        approvedStatusText: 'Approved. Build Control handoff started from this setup thread.'
      })
    );

    expect(cardHtml).toContain('Accept and start Build Control');
    expect(statusHtml).toContain('Approved. Build Control handoff started from this setup thread.');
  });

  it('renders a compact task preview instead of the old sectioned artifact layout', () => {
    const plan = createPlan('Autonomous Vitest 3 Repair', {
      structuredPlan: {
        title: 'Autonomous Vitest 3 Repair',
        summary: ['Audit the failing Vitest setup'],
        keyChanges: ['Tighten planner card spacing', 'Keep the composer visible on short windows'],
        testPlan: ['Run renderer tests'],
        assumptions: ['The active window height can be smaller than the full plan']
      }
    });

    const cardHtml = renderToStaticMarkup(
      React.createElement(PlannerPlanCard, {
        plan,
        plannerPolicy: null,
        renderedMarkdown: '',
        approving: false,
        submitting: false,
        onApprove: async () => undefined,
        onRequestChanges: async () => undefined,
        onCancelPlan: async () => undefined
      })
    );

    expect(cardHtml).toContain('0 out of 4 tasks completed');
    expect(cardHtml).toContain('1. Tighten planner card spacing');
    expect(cardHtml).toContain('2. Keep the composer visible on short windows');
    expect(cardHtml).toContain('planner-primary-action');
    expect(cardHtml).toContain('Cancel plan');
    expect(cardHtml).not.toContain('Key changes');
    expect(cardHtml).toContain('Assumptions: The active window height can be smaller than the full plan');
  });

  it('renders planner questions as three paths plus a custom fourth lane', () => {
    const questionHtml = renderToStaticMarkup(
      React.createElement(PlannerQuestionCard, {
        questionSet: createQuestionSet(),
        plannerPolicy: null,
        submitting: false,
        onSubmit: async () => undefined,
        onCancelPlan: async () => undefined
      })
    );

    expect(questionHtml).toContain('For v1, which path are you actually aiming for?');
    expect(questionHtml).toContain('1 of 1');
    expect(questionHtml).toContain('Self-host open model');
    expect(questionHtml).toContain('Recommended');
    expect(questionHtml).toContain('No, and tell Vicode what to do differently');
    expect(questionHtml).toContain('Cancel plan');
    expect(questionHtml).toContain('Create plan');
  });
});
