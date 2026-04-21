import { describe, expect, it } from 'vitest';
import type { SubagentSummary } from '../../shared/domain';
import {
  describeDelegationRole,
  describeSubagentActivityStatus,
  summarizeSubagentActivityDetail,
  summarizeSubagentActivityHeader
} from './ThreadSubagentActivityCard';

function createSubagent(overrides: Partial<SubagentSummary> = {}): SubagentSummary {
  return {
    id: 'subagent-1',
    parentThreadId: 'thread-1',
    parentRunId: 'run-1',
    childThreadId: 'thread-child-1',
    childRunId: null,
    name: 'Locke',
    title: 'Inspect summary flow',
    prompt: 'Inspect the local summary path and report back.',
    providerId: 'openai',
    modelId: 'gpt-5.4',
    executionPermission: 'default',
    delegationProfile: 'research',
    status: 'queued',
    outputSummary: null,
    lastError: null,
    createdAt: '2026-04-18T12:00:00.000Z',
    updatedAt: '2026-04-18T12:00:00.000Z',
    startedAt: null,
    completedAt: null,
    ...overrides
  };
}

describe('ThreadSubagentActivityCard helpers', () => {
  it('maps delegation profiles to Claude-style agent roles', () => {
    expect(describeDelegationRole('research')).toBe('explorer');
    expect(describeDelegationRole('implement')).toBe('worker');
    expect(describeDelegationRole('verify')).toBe('verifier');
  });

  it('summarizes live spawning state separately from finished agents', () => {
    const subagents = [
      createSubagent({ status: 'running' }),
      createSubagent({ id: 'subagent-2', name: 'Bohr', status: 'queued', createdAt: '2026-04-18T12:01:00.000Z' }),
      createSubagent({ id: 'subagent-3', name: 'Tesla', status: 'completed', outputSummary: 'Checked the final handoff.' })
    ];

    expect(summarizeSubagentActivityHeader(subagents)).toBe('Spawning 2 agents');
    expect(summarizeSubagentActivityDetail(subagents)).toBe('1 running · 1 waiting · 1 ready');
  });

  it('uses delegated-agent copy once all subagents have settled', () => {
    const subagents = [
      createSubagent({ status: 'completed', outputSummary: 'Checked the 2026 roadmap handoff.' }),
      createSubagent({ id: 'subagent-2', name: 'Bohr', status: 'failed', lastError: 'Auth blocked the follow-up.' })
    ];

    expect(summarizeSubagentActivityHeader(subagents)).toBe('2 delegated agents');
    expect(describeSubagentActivityStatus(createSubagent({ status: 'running' }), 'Summary thread')).toBe(
      'Working on the delegated task.'
    );
  });

  it('prefers provider output summaries for completed agents and blocker text for failures', () => {
    expect(
      describeSubagentActivityStatus(
        createSubagent({
          status: 'completed',
          outputSummary: 'Checked the 2026 roadmap handoff.'
        }),
        'Summary thread'
      )
    ).toBe('Checked the 2026 roadmap handoff.');

    expect(
      describeSubagentActivityStatus(
        createSubagent({
          status: 'failed',
          lastError: 'Gemini auth stalled before follow-up execution.'
        }),
        'Summary thread'
      )
    ).toBe('Gemini auth stalled before follow-up execution.');
  });
});
