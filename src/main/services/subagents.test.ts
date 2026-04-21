import { describe, expect, it, vi } from 'vitest';
import { SubagentOrchestratorService } from './subagents';
import type { SubagentSummary } from '../../shared/domain';
import type { AppEvent } from '../../shared/events';

function createSubagent(overrides: Partial<SubagentSummary> = {}): SubagentSummary {
  return {
    id: 'subagent-1',
    parentThreadId: 'thread-parent',
    parentRunId: null,
    childThreadId: null,
    childRunId: null,
    name: 'Chandrasekhar',
    title: 'Implement task',
    prompt: 'Do the work',
    providerId: 'openai',
    modelId: 'gpt-5',
    executionPermission: 'default',
    delegationProfile: 'research',
    status: 'queued',
    outputSummary: null,
    lastError: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    ...overrides
  };
}

describe('SubagentOrchestratorService', () => {
  it('spawns delegated background runs and persists child thread/run ownership', async () => {
    const created = createSubagent({ modelId: 'gpt-5.4-mini' });
    const running = createSubagent({
      childThreadId: 'thread-child',
      childRunId: 'run-child',
      status: 'running',
      startedAt: '2026-04-01T00:01:00.000Z'
    });
    const db = {
      getThread: vi.fn(() => ({
        id: 'thread-parent',
        projectId: 'project-1',
        providerId: 'openai',
        modelId: 'gpt-5',
        executionPermission: 'default'
      })),
      countActiveSubagentsByProvider: vi.fn(() => 0),
      createSubagent: vi.fn(() => created),
      updateSubagent: vi.fn(() => running),
      listSubagentsByParentThread: vi.fn(() => [running]),
      getSubagent: vi.fn(() => running)
    };
    const providers = {
      getProvider: vi.fn(async () => ({
        id: 'openai',
        models: [
          { id: 'gpt-5.4', recommendation: 'recommended' },
          { id: 'gpt-5.4-mini', recommendation: 'fast' }
        ]
      })),
      startDelegatedBackgroundRun: vi.fn(async () => ({
        thread: { id: 'thread-child' },
        runId: 'run-child'
      })),
      stopRun: vi.fn()
    };
    const service = new SubagentOrchestratorService(db as never, providers as never);

    const result = await service.spawn({
      parentThreadId: 'thread-parent',
      title: 'Implement task',
      prompt: 'Do the work'
    });

    expect(providers.startDelegatedBackgroundRun).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        title: 'Implement task',
        prompt: 'Do the work',
        providerId: 'openai',
        modelId: 'gpt-5.4-mini',
        delegationProfile: 'research',
        reasoningEffort: 'high'
      })
    );
    expect(result.childThreadId).toBe('thread-child');
    expect(result.childRunId).toBe('run-child');
    expect(db.createSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: undefined
      })
    );
  });

  it('updates persisted status when child runs complete', async () => {
    const running = createSubagent({
      childThreadId: 'thread-child',
      childRunId: 'run-child',
      status: 'running'
    });
    const completed = createSubagent({
      childThreadId: 'thread-child',
      childRunId: 'run-child',
      status: 'completed',
      outputSummary: 'Finished task'
    });
    const db = {
      getThread: vi.fn(() => ({
        turns: [{ role: 'assistant', content: 'Finished task' }],
        lastPreview: 'Finished task'
      })),
      countActiveSubagentsByProvider: vi.fn(() => 0),
      getSubagent: vi.fn(() => running),
      updateSubagent: vi.fn(() => completed),
      createSubagent: vi.fn(),
      listSubagentsByParentThread: vi.fn(() => [])
    };
    const providers = {
      getProvider: vi.fn(),
      generateSubagentTerminalSummary: vi.fn(async () => 'Finished task'),
      startDelegatedBackgroundRun: vi.fn(),
      stopRun: vi.fn()
    };
    const service = new SubagentOrchestratorService(db as never, providers as never);
    const events: AppEvent[] = [];
    service.onEvent((event) => events.push(event));
    (service as unknown as { subagentIdByRunId: Map<string, string> }).subagentIdByRunId.set('run-child', 'subagent-1');

    await service.handleProviderEvent({
      type: 'run.status',
      threadId: 'thread-child',
      runId: 'run-child',
      status: 'completed'
    });

    expect(db.updateSubagent).toHaveBeenCalledWith(
      'subagent-1',
      expect.objectContaining({
        status: 'completed',
        outputSummary: 'Finished task'
      })
    );
    expect(events).toContainEqual({ type: 'subagent.completed', subagent: completed });
  });

  it('re-attaches follow-up runs started in an existing child thread', () => {
    const finished = createSubagent({
      childThreadId: 'thread-child',
      childRunId: 'run-old',
      status: 'completed',
      outputSummary: 'Old result',
      startedAt: '2026-04-01T00:01:00.000Z',
      completedAt: '2026-04-01T00:03:00.000Z'
    });
    const running = createSubagent({
      childThreadId: 'thread-child',
      childRunId: 'run-new',
      status: 'running',
      outputSummary: null,
      startedAt: '2026-04-01T00:04:00.000Z',
      completedAt: null
    });
    const completed = createSubagent({
      childThreadId: 'thread-child',
      childRunId: 'run-new',
      status: 'completed',
      outputSummary: 'Fresh result',
      startedAt: '2026-04-01T00:04:00.000Z',
      completedAt: '2026-04-01T00:05:00.000Z'
    });
    const db = {
      getSubagentByChildThreadId: vi.fn(() => finished),
      getSubagent: vi
        .fn()
        .mockReturnValueOnce(running)
        .mockReturnValueOnce(running),
      updateSubagent: vi
        .fn()
        .mockReturnValueOnce(running)
        .mockReturnValueOnce(completed),
      countActiveSubagentsByProvider: vi.fn(() => 0),
      getThread: vi.fn(() => ({
        turns: [{ role: 'assistant', content: 'Fresh result' }],
        lastPreview: 'Fresh result'
      })),
      createSubagent: vi.fn(),
      listSubagentsByParentThread: vi.fn(() => [])
    };
    const providers = {
      getProvider: vi.fn(),
      generateSubagentTerminalSummary: vi.fn(async () => 'Fresh result'),
      startDelegatedBackgroundRun: vi.fn(),
      stopRun: vi.fn()
    };
    const service = new SubagentOrchestratorService(db as never, providers as never);
    const events: AppEvent[] = [];
    service.onEvent((event) => events.push(event));
    (service as unknown as { subagentIdByRunId: Map<string, string> }).subagentIdByRunId.set('run-old', 'subagent-1');

    const adopted = service.attachRunToChildThread('thread-child', 'run-new');

    expect(db.getSubagentByChildThreadId).toHaveBeenCalledWith('thread-child');
    expect(db.updateSubagent).toHaveBeenNthCalledWith(
      1,
      'subagent-1',
      expect.objectContaining({
        childRunId: 'run-new',
        status: 'running',
        outputSummary: null,
        completedAt: null
      })
    );
    expect(adopted).toBe(running);
    expect((service as unknown as { subagentIdByRunId: Map<string, string> }).subagentIdByRunId.has('run-old')).toBe(false);
    expect((service as unknown as { subagentIdByRunId: Map<string, string> }).subagentIdByRunId.get('run-new')).toBe('subagent-1');
    expect(events).toContainEqual({ type: 'subagent.updated', subagent: running });

    return service.handleProviderEvent({
      type: 'run.status',
      threadId: 'thread-child',
      runId: 'run-new',
      status: 'completed'
    }).then(() => {
      expect(db.updateSubagent).toHaveBeenNthCalledWith(
        2,
        'subagent-1',
        expect.objectContaining({
          status: 'completed',
          outputSummary: 'Fresh result'
        })
      );
      expect(events).toContainEqual({ type: 'subagent.completed', subagent: completed });
    });
  });

  it('cancels queued subagents immediately without calling the provider', async () => {
    const queued = createSubagent();
    const cancelled = createSubagent({
      status: 'cancelled',
      completedAt: '2026-04-01T00:02:00.000Z'
    });
    const db = {
      getSubagent: vi.fn(() => queued),
      countActiveSubagentsByProvider: vi.fn(() => 0),
      updateSubagent: vi.fn(() => cancelled),
      getThread: vi.fn(),
      createSubagent: vi.fn(),
      listSubagentsByParentThread: vi.fn(() => [])
    };
    const providers = {
      getProvider: vi.fn(),
      startDelegatedBackgroundRun: vi.fn(),
      stopRun: vi.fn()
    };
    const service = new SubagentOrchestratorService(db as never, providers as never);
    const events: AppEvent[] = [];
    service.onEvent((event) => events.push(event));

    const result = await service.cancel('subagent-1');

    expect(providers.stopRun).not.toHaveBeenCalled();
    expect(db.updateSubagent).toHaveBeenCalledWith(
      'subagent-1',
      expect.objectContaining({
        status: 'cancelled',
        lastError: null
      })
    );
    expect(result).toBe(cancelled);
    expect(events).toContainEqual({ type: 'subagent.cancelled', subagent: cancelled });
  });

  it('waits for the provider terminal event before finalizing a running cancellation', async () => {
    const running = createSubagent({
      childThreadId: 'thread-child',
      childRunId: 'run-child',
      status: 'running',
      startedAt: '2026-04-01T00:01:00.000Z'
    });
    const cancelled = createSubagent({
      childThreadId: 'thread-child',
      childRunId: 'run-child',
      status: 'cancelled',
      outputSummary: 'Stopped after partial work',
      completedAt: '2026-04-01T00:03:00.000Z'
    });
    const db = {
      getSubagent: vi
        .fn()
        .mockReturnValueOnce(running)
        .mockReturnValueOnce(running)
        .mockReturnValueOnce(running)
        .mockReturnValueOnce(running),
      countActiveSubagentsByProvider: vi.fn(() => 0),
      updateSubagent: vi.fn(() => cancelled),
      getThread: vi.fn(() => ({
        turns: [{ role: 'assistant', content: 'Stopped after partial work' }],
        lastPreview: 'Stopped after partial work'
      })),
      createSubagent: vi.fn(),
      listSubagentsByParentThread: vi.fn(() => [])
    };
    const providers = {
      getProvider: vi.fn(),
      generateSubagentTerminalSummary: vi.fn(async () => 'Stopped after partial work'),
      startDelegatedBackgroundRun: vi.fn(),
      stopRun: vi.fn(async () => undefined)
    };
    const service = new SubagentOrchestratorService(db as never, providers as never);
    const events: AppEvent[] = [];
    service.onEvent((event) => events.push(event));
    (service as unknown as { subagentIdByRunId: Map<string, string> }).subagentIdByRunId.set('run-child', 'subagent-1');

    const result = await service.cancel('subagent-1');

    expect(providers.stopRun).toHaveBeenCalledWith('run-child');
    expect(db.updateSubagent).not.toHaveBeenCalled();
    expect(result).toBe(running);

    await service.handleProviderEvent({
      type: 'run.status',
      threadId: 'thread-child',
      runId: 'run-child',
      status: 'aborted'
    });

    expect(db.updateSubagent).toHaveBeenCalledWith(
      'subagent-1',
      expect.objectContaining({
        status: 'cancelled',
        outputSummary: 'Stopped after partial work'
      })
    );
    expect(events).toContainEqual({ type: 'subagent.cancelled', subagent: cancelled });
    expect((service as unknown as { subagentIdByRunId: Map<string, string> }).subagentIdByRunId.has('run-child')).toBe(false);
  });

  it('ignores duplicate terminal provider events after a subagent is already finalized', () => {
    const completed = createSubagent({
      childThreadId: 'thread-child',
      childRunId: 'run-child',
      status: 'completed',
      completedAt: '2026-04-01T00:03:00.000Z'
    });
    const db = {
      getSubagent: vi.fn(() => completed),
      countActiveSubagentsByProvider: vi.fn(() => 0),
      updateSubagent: vi.fn(),
      getThread: vi.fn(),
      createSubagent: vi.fn(),
      listSubagentsByParentThread: vi.fn(() => [])
    };
    const providers = {
      getProvider: vi.fn(),
      generateSubagentTerminalSummary: vi.fn(async () => 'Late failure'),
      startDelegatedBackgroundRun: vi.fn(),
      stopRun: vi.fn()
    };
    const service = new SubagentOrchestratorService(db as never, providers as never);
    const events: AppEvent[] = [];
    service.onEvent((event) => events.push(event));
    (service as unknown as { subagentIdByRunId: Map<string, string> }).subagentIdByRunId.set('run-child', 'subagent-1');

    return service.handleProviderEvent({
      type: 'run.status',
      threadId: 'thread-child',
      runId: 'run-child',
      status: 'failed',
      message: 'late failure'
    }).then(() => {
      expect(db.updateSubagent).not.toHaveBeenCalled();
      expect(events).toHaveLength(0);
      expect((service as unknown as { subagentIdByRunId: Map<string, string> }).subagentIdByRunId.has('run-child')).toBe(false);
    });
  });

  it('blocks new subagents when a provider lane is already at its active cap', async () => {
    const db = {
      getThread: vi.fn(() => ({
        id: 'thread-parent',
        projectId: 'project-1',
        providerId: 'ollama',
        modelId: 'qwen3-coder',
        executionPermission: 'default'
      })),
      countActiveSubagentsByProvider: vi.fn(() => 2),
      createSubagent: vi.fn(),
      updateSubagent: vi.fn(),
      listSubagentsByParentThread: vi.fn(() => []),
      getSubagent: vi.fn()
    };
    const providers = {
      getProvider: vi.fn(),
      startDelegatedBackgroundRun: vi.fn(),
      stopRun: vi.fn()
    };
    const service = new SubagentOrchestratorService(db as never, providers as never);

    await expect(
      service.spawn({
        parentThreadId: 'thread-parent',
        title: 'Investigate local model issue',
        prompt: 'Look into the regression'
      })
    ).rejects.toThrow(/already has 2 active subagents/i);
    expect(db.createSubagent).not.toHaveBeenCalled();
    expect(providers.startDelegatedBackgroundRun).not.toHaveBeenCalled();
  });
});
