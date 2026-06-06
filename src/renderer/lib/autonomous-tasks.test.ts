import { describe, expect, it } from 'vitest';
import { filterComposerAutonomousTasks, summarizeAutonomousTasks } from './autonomous-tasks';

describe('autonomous task summaries', () => {
  it('summarizes task states for the composer shelf header', () => {
    const summary = summarizeAutonomousTasks([
      { id: 'a', kind: 'subagent', title: 'Scout', summary: '', ownerLabel: 'research', status: 'running', statusLabel: 'running', threadId: null, updatedAt: null, attention: false },
      { id: 'b', kind: 'subagent', title: 'Scout', summary: '', ownerLabel: 'research', status: 'waiting', statusLabel: 'waiting', threadId: null, updatedAt: null, attention: false },
      { id: 'c', kind: 'job', title: 'Autonomy', summary: '', ownerLabel: 'autonomy', status: 'blocked', statusLabel: 'blocked', threadId: null, updatedAt: null, attention: true }
    ]);

    expect(summary).toBe('1 blocked · 1 running · 1 waiting');
  });

  it('keeps only live or attention-worthy tasks in the composer shelf', () => {
    const visible = filterComposerAutonomousTasks([
      { id: 'a', kind: 'subagent', title: 'Scout', summary: '', ownerLabel: 'research', status: 'running', statusLabel: 'running', threadId: null, updatedAt: null, attention: false },
      { id: 'b', kind: 'subagent', title: 'Scout', summary: '', ownerLabel: 'research', status: 'waiting', statusLabel: 'waiting', threadId: null, updatedAt: null, attention: false },
      { id: 'c', kind: 'job', title: 'Autonomy', summary: '', ownerLabel: 'autonomy', status: 'completed', statusLabel: 'completed', threadId: null, updatedAt: null, attention: false },
      { id: 'd', kind: 'job', title: 'Idle review', summary: '', ownerLabel: 'review', status: 'idle', statusLabel: 'idle', threadId: null, updatedAt: null, attention: false },
      { id: 'e', kind: 'job', title: 'Blocked', summary: '', ownerLabel: 'queue', status: 'blocked', statusLabel: 'blocked', threadId: null, updatedAt: null, attention: true }
    ]);

    expect(visible.map((task) => task.id)).toEqual(['a', 'b', 'e']);
  });
});
