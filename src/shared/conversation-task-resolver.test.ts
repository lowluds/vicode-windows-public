import { describe, expect, it } from 'vitest';
import type { ThreadTurn } from './domain';
import { resolveConversationTaskPacket } from './conversation-task-resolver';
import { deriveHarnessTaskContract } from './harness-task-contract';

function turn(role: 'user' | 'assistant', content: string, index: number): ThreadTurn {
  return {
    id: `turn-${index}`,
    threadId: 'thread-1',
    runId: index === 0 ? null : `run-${index}`,
    role,
    content,
    metadata: null,
    createdAt: `2026-05-31T12:00:0${index}.000Z`
  };
}

describe('resolveConversationTaskPacket', () => {
  it('does not create a packet for plain brainstorming', () => {
    const prompt = 'Can we discuss whether React or Svelte fits this landing page?';
    const contract = deriveHarnessTaskContract({ prompt });

    expect(
      resolveConversationTaskPacket({
        prompt,
        turns: [],
        taskContract: contract
      })
    ).toBeNull();
  });

  it('does not create a packet for direct setup questions without proceed intent', () => {
    const prompt = 'Can you look at this reference and tell me what kind of page we should build?';
    const contract = deriveHarnessTaskContract({ prompt });

    expect(
      resolveConversationTaskPacket({
        prompt,
        turns: [],
        taskContract: contract
      })
    ).toBeNull();
  });

  it('resolves a proceed prompt into slices from prior discussion', () => {
    const prompt = 'Ok, go ahead and implement this plan.';
    const contract = deriveHarnessTaskContract({ prompt });
    const packet = resolveConversationTaskPacket({
      prompt,
      taskContract: contract,
      turns: [
        turn('user', 'I want a small calculator app. It should use React, TypeScript, and Tailwind.', 1),
        turn(
          'assistant',
          'A good plan is: create the app shell, add calculator state, style the keypad, then verify with tests.',
          2
        ),
        turn('user', 'Keep it simple and make sure keyboard input works.', 3)
      ]
    });

    expect(packet).toMatchObject({
      trigger: 'inferred_proceed',
      phase: 'ready_to_task',
      executionPolicy: 'auto_execute',
      confidence: 'high',
      objective: expect.stringContaining('calculator app'),
      sourceTurnIds: ['turn-1', 'turn-2', 'turn-3'],
      decisionsUsed: expect.arrayContaining([expect.stringMatching(/React/i)]),
      expectedToolGroups: expect.arrayContaining([
        'workspace_read',
        'workspace_write',
        'verification'
      ]),
      acceptanceCriteria: expect.arrayContaining([expect.stringMatching(/keyboard input/i)])
    });
    expect(packet?.slices.map((slice) => slice.status)).toEqual([
      'pending',
      'pending',
      'pending',
      'pending'
    ]);
  });

  it('does not turn stale chat-only context into required research or command tools', () => {
    const prompt =
      'Ok, go ahead and implement this plan by creating CALCULATOR_PLAN.md in the workspace root. Use the choices we discussed, include the manual verification checklist, and keep the file concise.';
    const contract = deriveHarnessTaskContract({ prompt });
    const packet = resolveConversationTaskPacket({
      prompt,
      taskContract: contract,
      turns: [
        turn(
          'user',
          'Let us plan a tiny calculator app. The first slice should be plain HTML, CSS, and JavaScript rather than React. Keep this chat-only.',
          1
        ),
        turn(
          'assistant',
          'We can keep this as discussion only. No web research or shell command is needed for the first slice.',
          2
        ),
        turn(
          'user',
          'The first features should be a display, number buttons, add, subtract, multiply, divide, and clear. Do not edit files yet.',
          3
        ),
        turn(
          'user',
          'The verification checklist should use manual arithmetic checks, including division by zero and decimal input. Still discussion only.',
          4
        )
      ]
    });

    expect(packet).toMatchObject({
      trigger: 'inferred_proceed',
      executionPolicy: 'auto_execute',
      confidence: 'high',
      expectedToolGroups: ['workspace_read', 'workspace_write', 'verification']
    });
    expect(packet?.constraints).toEqual(
      expect.not.arrayContaining([expect.stringMatching(/chat-only|discussion only|do not edit/i)])
    );
    expect(packet?.nonGoals).toEqual(
      expect.not.arrayContaining([expect.stringMatching(/chat-only|discussion only|do not edit/i)])
    );
  });

  it('auto-executes a clear direct bounded task without prior discussion', () => {
    const prompt = 'Create a responsive landing page in index.html for a local bakery.';
    const contract = deriveHarnessTaskContract({ prompt });
    const packet = resolveConversationTaskPacket({
      prompt,
      turns: [],
      taskContract: contract
    });

    expect(packet).toMatchObject({
      trigger: 'direct_task',
      phase: 'ready_to_task',
      executionPolicy: 'auto_execute',
      confidence: 'high',
      objective: expect.stringContaining('responsive landing page'),
      sourceTurnIds: []
    });
    expect(packet?.expectedToolGroups).toEqual(
      expect.arrayContaining(['workspace_read', 'workspace_write', 'verification'])
    );
  });

  it('waits when explicit Plan mode resolves a task', () => {
    const prompt = 'Ok, go ahead and implement this plan.';
    const contract = deriveHarnessTaskContract({ prompt, mode: 'plan' });
    const packet = resolveConversationTaskPacket({
      prompt,
      taskContract: contract,
      turns: [
        turn('user', 'I want a small calculator app with React and TypeScript.', 1),
        turn('assistant', 'Plan: create the shell, wire state, style it, and verify.', 2)
      ]
    });

    expect(packet).toMatchObject({
      trigger: 'inferred_proceed',
      phase: 'task_plan',
      executionPolicy: 'plan_mode_wait',
      confidence: 'high'
    });
  });

  it('asks one clarification when proceed intent has no usable context', () => {
    const prompt = 'Ok, go ahead.';
    const contract = deriveHarnessTaskContract({ prompt });
    const packet = resolveConversationTaskPacket({
      prompt,
      turns: [],
      taskContract: contract
    });

    expect(packet).toMatchObject({
      trigger: 'inferred_proceed',
      phase: 'ready_to_task',
      executionPolicy: 'ask_clarifying_question',
      confidence: 'low',
      clarificationQuestion: expect.stringMatching(/what should i implement/i)
    });
    expect(packet?.expectedToolGroups).toEqual(['workspace_read']);
  });

  it('requires approval for risky destructive task packets', () => {
    const prompt = 'Go ahead and delete the old database migration files.';
    const contract = deriveHarnessTaskContract({ prompt });
    const packet = resolveConversationTaskPacket({
      prompt,
      taskContract: contract,
      turns: [
        turn('user', 'The project has old database migration files we may not need.', 1),
        turn('assistant', 'Deleting migrations is risky because it can affect data history.', 2)
      ]
    });

    expect(packet).toMatchObject({
      trigger: 'inferred_proceed',
      executionPolicy: 'approval_required',
      confidence: 'high',
      riskReason: expect.stringMatching(/risk/i)
    });
  });

  it('asks for a replan when the latest task pivots away from prior context', () => {
    const prompt = 'Go ahead and change direction: build a CRM dashboard instead.';
    const contract = deriveHarnessTaskContract({ prompt });
    const packet = resolveConversationTaskPacket({
      prompt,
      taskContract: contract,
      turns: [
        turn('user', 'I want a small calculator app with React and TypeScript.', 1),
        turn('assistant', 'Plan: create the shell, wire state, style it, and verify.', 2)
      ]
    });

    expect(packet).toMatchObject({
      trigger: 'inferred_proceed',
      executionPolicy: 'scope_replan',
      confidence: 'high',
      objective: expect.stringContaining('CRM dashboard'),
      sourceTurnIds: ['turn-1', 'turn-2']
    });
    expect(packet?.expectedToolGroups).toEqual(
      expect.arrayContaining(['workspace_read', 'workspace_write', 'verification'])
    );
  });
});
