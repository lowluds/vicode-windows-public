import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlannerPlan, PlannerQuestionSet, RunProgressState } from '../../shared/domain';
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

function createRunProgress(items: RunProgressState['items']): RunProgressState {
  return {
    runId: 'run-1',
    threadId: 'thread-1',
    title: 'Approved plan',
    items,
    updatedAt: '2026-03-30T10:01:00.000Z',
    diffStats: null,
    reviewAvailable: false,
    changeArtifact: null,
    delegation: null,
    contextPressure: null,
    checkpointReminder: null,
    queueSummary: null
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

  it('supports custom approval copy for focused planner handoffs', () => {
    const plan = createPlan('Focused Vitest 3 Repair');

    const cardHtml = renderToStaticMarkup(
      React.createElement(PlannerPlanCard, {
        plan,
        plannerPolicy: null,
        renderedMarkdown: '',
        approving: false,
        submitting: false,
        approveLabel: 'Accept plan',
        approvedCardText: 'This plan was approved and queued for the next step.',
        onApprove: async () => undefined,
        onRequestChanges: async () => undefined,
        onCancelPlan: async () => undefined
      })
    );
    const statusHtml = renderToStaticMarkup(
      React.createElement(PlannerPlanStatusRow, {
        plan: { ...plan, status: 'approved' },
        approvedStatusText: 'Approved. Next step queued from this setup thread.'
      })
    );

    expect(cardHtml).toContain('Accept plan');
    expect(statusHtml).toContain('Approved. Next step queued from this setup thread.');
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

    expect(cardHtml).toContain('Execution checklist');
    expect(cardHtml).toContain('4 planned items');
    expect(cardHtml).toContain('1. Tighten planner card spacing');
    expect(cardHtml).toContain('2. Keep the composer visible on short windows');
    expect(cardHtml).toContain('planner-primary-action');
    expect(cardHtml).toContain('Cancel plan');
    expect(cardHtml).toContain('The agent will work through each item and run verification before the final response.');
    expect(cardHtml).not.toContain('Key changes');
    expect(cardHtml).not.toContain('ui-surface-card');
    expect(cardHtml).not.toContain('ui-status-pill');
    expect(cardHtml).not.toContain('bg-[image:var(--ui-panel-gradient)]');
    expect(cardHtml).toContain('Assumptions: The active window height can be smaller than the full plan');
  });

  it('shows approved plan steps with live completion state in the status row', () => {
    const plan = createPlan('Landing Page Execution', {
      status: 'approved',
      structuredPlan: {
        title: 'Landing Page Execution',
        summary: ['Confirm the approved plan finished'],
        keyChanges: ['Search the web for a hero image', 'Create index.html', 'Create styles.css'],
        testPlan: ['Run npm test'],
        assumptions: []
      }
    });
    const progress = createRunProgress([
      { id: 'run-1:0', label: 'Search the web for a hero image', status: 'completed', order: 0 },
      { id: 'run-1:1', label: 'Create index.html', status: 'completed', order: 1 },
      { id: 'run-1:2', label: 'Create styles.css', status: 'in_progress', order: 2 },
      { id: 'run-1:3', label: 'Run npm test', status: 'pending', order: 3 },
      { id: 'run-1:4', label: 'Confirm the approved plan finished', status: 'pending', order: 4 }
    ]);

    const statusHtml = renderToStaticMarkup(
      React.createElement(PlannerPlanStatusRow, {
        plan,
        runProgress: progress
      })
    );

    expect(statusHtml).toContain('2/5 complete');
    expect(statusHtml).toContain('planner-plan-preview-list');
    expect(statusHtml).toContain('data-task-status="completed"');
    expect(statusHtml).toContain('data-task-status="in_progress"');
    expect(statusHtml).toContain('1. Search the web for a hero image');
    expect(statusHtml).toContain('3. Create styles.css');
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
