import { describe, expect, it } from 'vitest';
import { deriveStructuredPlannerPlan } from './planner-parser';

describe('deriveStructuredPlannerPlan', () => {
  it('extracts structured sections from markdown plans', () => {
    expect(
      deriveStructuredPlannerPlan(`# Hacker Hero Plan

## Summary
- Define the hero direction

## Key Changes
- Add the section

## Test Plan
- Review the layout

## Assumptions
- Single hero only`)
    ).toEqual({
      title: 'Hacker Hero Plan',
      summary: ['Define the hero direction'],
      keyChanges: ['Add the section'],
      testPlan: ['Review the layout'],
      assumptions: ['Single hero only']
    });
  });

  it('returns null for markdown without a top-level title', () => {
    expect(deriveStructuredPlannerPlan('## Summary\n- Missing title')).toBeNull();
  });

  it('normalizes collapsed headings so the title stays clean', () => {
    expect(
      deriveStructuredPlannerPlan(
        '# Queue Reconciliation And Build Control Clarity## SummaryTarget outcome: fix stale queue state\n## Key ChangesReconcile stale pending items\n## Test PlanVerify queue labels\n## AssumptionsExplicit approvals remain manual'
      )
    ).toEqual({
      title: 'Queue Reconciliation And Build Control Clarity',
      summary: ['Target outcome: fix stale queue state'],
      keyChanges: ['Reconcile stale pending items'],
      testPlan: ['Verify queue labels'],
      assumptions: ['Explicit approvals remain manual']
    });
  });

  it('drops leaked prompt labels from the title line', () => {
    expect(
      deriveStructuredPlannerPlan(
        '# **Title:** Silent Build Queue Autonomy Target outcome: Remove stale review noise\n\n## Summary\n- Remove stale review noise while keeping explicit automation approvals visible.'
      )
    ).toEqual({
      title: 'Silent Build Queue Autonomy',
      summary: ['Remove stale review noise while keeping explicit automation approvals visible.'],
      keyChanges: [],
      testPlan: [],
      assumptions: []
    });
  });

  it('strips trailing list content from the title line', () => {
    expect(
      deriveStructuredPlannerPlan(
        '# Queue Health Cleanup - reconcile stale review items\n\n## Summary\n- Keep startup noise out of the visible queue.'
      )
    ).toEqual({
      title: 'Queue Health Cleanup',
      summary: ['Keep startup noise out of the visible queue.'],
      keyChanges: [],
      testPlan: [],
      assumptions: []
    });
  });
});
