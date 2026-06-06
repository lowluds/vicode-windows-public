import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMock, resetIpcTestMocks } from './ipc-test-harness';

describe('registerIpc thread handlers', () => {
  beforeEach(resetIpcTestMocks);

  it('returns an empty autonomous task list when the service is unavailable', async () => {
    const { registerIpc } = await import('./ipc');

    const mainWindow = {
      webContents: {
        send: vi.fn()
      },
      on: vi.fn()
    };

    const services = {
      db: {},
      providers: {
        onEvent: vi.fn(() => vi.fn())
      },
      ollamaRuntime: {
        onEvent: vi.fn(() => vi.fn())
      },
      skills: {},
      automations: {
        onEvent: vi.fn(() => vi.fn())
      },
      diagnostics: {},
      mcp: {
        onEvent: vi.fn(() => vi.fn())
      },
      jobs: {
        onEvent: vi.fn(() => vi.fn())
      },
      voice: {}
    };

    registerIpc(mainWindow as never, services as never);

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'threads:listAutonomousTasks');
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    expect(handler({}, { threadId: 'thread-123' })).toEqual([]);
  });

  it('wires planner cancel over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const cancelledThread = { id: 'thread-1' };
    const mainWindow = {
      webContents: {
        send: vi.fn()
      },
      on: vi.fn()
    };

    const services = {
      db: {},
      providers: {
        onEvent: vi.fn(() => vi.fn()),
        cancelPlannerSession: vi.fn().mockResolvedValue(cancelledThread)
      },
      ollamaRuntime: {
        onEvent: vi.fn(() => vi.fn())
      },
      skills: {},
      automations: {
        onEvent: vi.fn(() => vi.fn())
      },
      diagnostics: {},
      mcp: {
        onEvent: vi.fn(() => vi.fn())
      },
      jobs: {
        onEvent: vi.fn(() => vi.fn())
      },
      voice: {}
    };

    registerIpc(mainWindow as never, services as never);

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'planner:cancel');
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    const result = await handler({}, { threadId: 'thread-1' });

    expect(services.providers.cancelPlannerSession).toHaveBeenCalledWith({ threadId: 'thread-1' });
    expect(result).toBe(cancelledThread);
  });

  it('routes thread execution-permission changes through the provider manager when available', async () => {
    const { registerIpc } = await import('./ipc');

    const setThreadExecutionPermission = vi.fn(async () => ({
      id: 'thread-1',
      executionPermission: 'default'
    }));

    const services = {
      db: {
        setThreadExecutionPermission: vi.fn(async () => ({
          id: 'thread-1',
          executionPermission: 'default'
        }))
      },
      providers: {
        onEvent: vi.fn(() => vi.fn()),
        setThreadExecutionPermission
      },
      ollamaRuntime: {
        onEvent: vi.fn(() => vi.fn())
      },
      skills: {},
      automations: {
        onEvent: vi.fn(() => vi.fn())
      },
      diagnostics: {},
      mcp: {
        onEvent: vi.fn(() => vi.fn())
      },
      jobs: {
        onEvent: vi.fn(() => vi.fn())
      },
      voice: {}
    };

    const mainWindow = {
      webContents: {
        send: vi.fn()
      },
      on: vi.fn()
    };

    registerIpc(mainWindow as never, services as never);

    const entry = handleMock.mock.calls.find(
      ([channel]) => channel === 'threads:setExecutionPermission'
    );
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    await handler({}, { threadId: 'thread-1', executionPermission: 'default' });

    expect(setThreadExecutionPermission).toHaveBeenCalledWith(
      'thread-1',
      'default'
    );
    expect(services.db.setThreadExecutionPermission).not.toHaveBeenCalled();
  });

  it('wires collaboration thread summarization over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const summary = {
      lastPromptSummary: 'Investigate repeated MCP approval prompts.',
      latestAssistantSummary: 'Re-read runtime policy before approvals.',
      handoffSummary: 'The thread fixes repeated MCP approval prompts. The runtime now checks the latest workspace policy before each approval.',
      recommendedNextPrompt: 'Investigate repeated MCP approval prompts.'
    };

    const services = {
      db: {},
      providers: {
        onEvent: vi.fn(() => vi.fn()),
        generateCollaborationThreadSummary: vi.fn(async () => summary)
      },
      ollamaRuntime: {
        onEvent: vi.fn(() => vi.fn())
      },
      skills: {},
      automations: {
        onEvent: vi.fn(() => vi.fn())
      },
      diagnostics: {},
      mcp: {
        onEvent: vi.fn(() => vi.fn())
      },
      jobs: {
        onEvent: vi.fn(() => vi.fn())
      },
      voice: {}
    };

    registerIpc({ webContents: { send: vi.fn() } } as never, services as never);

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'threads:summarizeForCollaboration');
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    const result = await handler({}, { threadId: 'thread-1' });

    expect(services.providers.generateCollaborationThreadSummary).toHaveBeenCalledWith('thread-1');
    expect(result).toEqual(summary);
  });

  it('wires subagent spawn over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const subagent = {
      id: 'subagent-1',
      parentThreadId: 'thread-1',
      parentRunId: 'run-parent',
      childThreadId: 'thread-2',
      childRunId: 'run-child',
      name: 'Chandrasekhar',
      title: 'Implement helper',
      prompt: 'Do the work',
      providerId: 'openai' as const,
      modelId: 'gpt-5',
      executionPermission: 'default' as const,
      delegationProfile: 'implement' as const,
      status: 'running' as const,
      outputSummary: null,
      lastError: null,
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
      startedAt: '2026-04-01T00:00:00.000Z',
      completedAt: null
    };

    const services = {
      db: {},
      providers: {
        onEvent: vi.fn(() => vi.fn())
      },
      ollamaRuntime: {
        onEvent: vi.fn(() => vi.fn())
      },
      skills: {},
      automations: {
        onEvent: vi.fn(() => vi.fn())
      },
      diagnostics: {},
      mcp: {
        onEvent: vi.fn(() => vi.fn())
      },
      jobs: {
        onEvent: vi.fn(() => vi.fn())
      },
      subagents: {
        onEvent: vi.fn(() => vi.fn()),
        spawn: vi.fn().mockResolvedValue(subagent)
      },
      voice: {}
    };

    registerIpc({ webContents: { send: vi.fn() } } as never, services as never);

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'subagents:spawn');
    expect(entry).toBeDefined();

    const [, handler] = entry!;
    const result = await handler({}, {
      parentThreadId: 'thread-1',
      parentRunId: 'run-parent',
      title: 'Implement helper',
      prompt: 'Do the work',
      delegationProfile: 'implement'
    });

    expect(services.subagents.spawn).toHaveBeenCalledWith({
      parentThreadId: 'thread-1',
      parentRunId: 'run-parent',
      title: 'Implement helper',
      prompt: 'Do the work',
      delegationProfile: 'implement'
    });
    expect(result).toEqual(subagent);
  });

  it('re-attaches child-thread runs when composer submission starts inside a subagent thread', async () => {
    const { registerIpc } = await import('./ipc');

    const submitResult = {
      disposition: 'started' as const,
      thread: {
        id: 'thread-child',
        projectId: 'project-1',
        title: 'Child thread',
        providerId: 'openai' as const,
        modelId: 'gpt-5.4-mini',
        executionPermission: 'default' as const,
        status: 'active' as const,
        archived: false,
        lastMessageAt: '2026-04-01T00:00:00.000Z',
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
        lastPreview: '',
        turns: [],
        followUps: [],
        planner: null
      },
      runId: 'run-child-2'
    };

    const services = {
      db: {},
      providers: {
        onEvent: vi.fn(() => vi.fn()),
        submitComposer: vi.fn().mockResolvedValue(submitResult)
      },
      ollamaRuntime: {
        onEvent: vi.fn(() => vi.fn())
      },
      skills: {},
      automations: {
        onEvent: vi.fn(() => vi.fn())
      },
      diagnostics: {},
      mcp: {
        onEvent: vi.fn(() => vi.fn())
      },
      jobs: {
        onEvent: vi.fn(() => vi.fn())
      },
      subagents: {
        onEvent: vi.fn(() => vi.fn()),
        attachRunToChildThread: vi.fn()
      },
      voice: {}
    };

    registerIpc({ webContents: { send: vi.fn() } } as never, services as never);

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'composer:submit');
    expect(entry).toBeDefined();

    const [, handler] = entry!;
    const result = await handler({}, {
      projectId: 'project-1',
      threadId: 'thread-child',
      prompt: 'Follow up',
      providerId: 'openai',
      modelId: 'gpt-5.4-mini',
      executionPermission: 'default',
      skillIds: []
    });

    expect(services.providers.submitComposer).toHaveBeenCalled();
    expect(services.subagents.attachRunToChildThread).toHaveBeenCalledWith('thread-child', 'run-child-2');
    expect(result).toEqual(submitResult);
  });

  it('wires thread draft handlers over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const services = {
      db: {
        getBootstrapData: vi.fn(),
        createProject: vi.fn(),
        updateProject: vi.fn(),
        deleteProject: vi.fn(),
        listThreads: vi.fn(),
        listArchivedThreads: vi.fn(),
        getThread: vi.fn(),
        getThreadDraft: vi.fn().mockReturnValue('draft prompt'),
        saveThreadDraft: vi.fn().mockReturnValue('draft prompt'),
        clearThreadDraft: vi.fn(),
        createThread: vi.fn(),
        setThreadExecutionPermission: vi.fn(),
        renameThread: vi.fn(),
        archiveThread: vi.fn(),
        restoreThread: vi.fn(),
        deleteThread: vi.fn(),
        duplicateThread: vi.fn(),
        listAutomations: vi.fn(),
        saveAutomation: vi.fn(),
        toggleAutomation: vi.fn(),
        deleteAutomation: vi.fn(),
        getPreferences: vi.fn(),
        savePreferences: vi.fn()
      },
      providers: {
        onEvent: vi.fn(() => vi.fn()),
        submitComposer: vi.fn(),
        stopRun: vi.fn(),
        setPlannerMode: vi.fn(),
        submitPlanner: vi.fn(),
        answerPlannerQuestions: vi.fn(),
        approvePlannerPlan: vi.fn(),
        listProviders: vi.fn(),
        startAuth: vi.fn(),
        clearAuth: vi.fn(),
        saveApiKey: vi.fn(),
        getProvider: vi.fn(),
        retryThread: vi.fn()
      },
      skills: {
        listSkills: vi.fn(),
        getSkillDetail: vi.fn(),
        saveSkill: vi.fn(),
        toggleSkill: vi.fn(),
        installSuggestedSkill: vi.fn(),
        removeSkill: vi.fn()
      },
      automations: {
        onEvent: vi.fn(() => vi.fn()),
        refresh: vi.fn(),
        runNow: vi.fn()
      },
      jobs: {
        onEvent: vi.fn(() => vi.fn()),
        listJobs: vi.fn(),
        listPendingReviews: vi.fn(),
        createDailyNoteReview: vi.fn(),
        createMemoryPromotionReview: vi.fn(),
        createUserPreferenceReview: vi.fn(),
        approveReview: vi.fn(),
        rejectReview: vi.fn()
      },
      mcp: {
        onEvent: vi.fn(() => vi.fn()),
        listServerViews: vi.fn(),
        listCatalog: vi.fn()
      },
      diagnostics: {
        export: vi.fn()
      },
      voice: {
        transcribeAudio: vi.fn()
      }
    };

    const mainWindow = {
      webContents: {
        send: vi.fn()
      },
      on: vi.fn()
    };

    registerIpc(mainWindow as never, services as never);

    const getDraftEntry = handleMock.mock.calls.find(([channel]) => channel === 'threads:getDraft');
    const saveDraftEntry = handleMock.mock.calls.find(([channel]) => channel === 'threads:saveDraft');
    const clearDraftEntry = handleMock.mock.calls.find(([channel]) => channel === 'threads:clearDraft');

    expect(getDraftEntry).toBeTruthy();
    expect(saveDraftEntry).toBeTruthy();
    expect(clearDraftEntry).toBeTruthy();

    const [, getDraftHandler] = getDraftEntry!;
    const [, saveDraftHandler] = saveDraftEntry!;
    const [, clearDraftHandler] = clearDraftEntry!;

    expect(await getDraftHandler({}, { threadId: 'thread-1' })).toBe('draft prompt');
    expect(await saveDraftHandler({}, { threadId: 'thread-1', prompt: 'draft prompt' })).toBe('draft prompt');
    await clearDraftHandler({}, { threadId: 'thread-1' });

    expect(services.db.getThreadDraft).toHaveBeenCalledWith('thread-1');
    expect(services.db.saveThreadDraft).toHaveBeenCalledWith('thread-1', 'draft prompt');
    expect(services.db.clearThreadDraft).toHaveBeenCalledWith('thread-1');
  });

  it('wires queued follow-up handlers over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const createdFollowUp = {
      id: 'follow-up-1',
      threadId: 'thread-1',
      content: 'Queue this next.',
      kind: 'follow_up' as const,
      status: 'queued' as const,
      priority: 0,
      targetRunId: 'run-1',
      createdAt: '2026-03-17T00:00:00.000Z',
      updatedAt: '2026-03-17T00:00:00.000Z',
      dispatchedAt: null,
      cancelledAt: null
    };

    const updatedFollowUp = {
      ...createdFollowUp,
      content: 'Queue this after tests.',
      updatedAt: '2026-03-17T00:01:00.000Z'
    };

    const removedFollowUp = {
      ...updatedFollowUp,
      status: 'cancelled' as const,
      cancelledAt: '2026-03-17T00:02:00.000Z',
      updatedAt: '2026-03-17T00:02:00.000Z'
    };

    const services = {
      db: {
        getBootstrapData: vi.fn(),
        createProject: vi.fn(),
        updateProject: vi.fn(),
        deleteProject: vi.fn(),
        listThreads: vi.fn(),
        listArchivedThreads: vi.fn(),
        getThread: vi.fn(),
        getThreadDraft: vi.fn().mockReturnValue('draft prompt'),
        saveThreadDraft: vi.fn().mockReturnValue('draft prompt'),
        clearThreadDraft: vi.fn(),
        createThread: vi.fn(),
        createThreadFollowUp: vi.fn().mockReturnValue(createdFollowUp),
        setThreadExecutionPermission: vi.fn(),
        renameThread: vi.fn(),
        archiveThread: vi.fn(),
        restoreThread: vi.fn(),
        deleteThread: vi.fn(),
        duplicateThread: vi.fn(),
        listAutomations: vi.fn(),
        saveAutomation: vi.fn(),
        toggleAutomation: vi.fn(),
        deleteAutomation: vi.fn(),
        getPreferences: vi.fn(),
        savePreferences: vi.fn()
      },
      providers: {
        onEvent: vi.fn(() => vi.fn()),
        submitComposer: vi.fn(),
        stopRun: vi.fn(),
        setPlannerMode: vi.fn(),
        submitPlanner: vi.fn(),
        answerPlannerQuestions: vi.fn(),
        approvePlannerPlan: vi.fn(),
        listProviders: vi.fn(),
        startAuth: vi.fn(),
        clearAuth: vi.fn(),
        saveApiKey: vi.fn(),
        getProvider: vi.fn(),
        retryThread: vi.fn(),
        updateQueuedFollowUp: vi.fn().mockResolvedValue(updatedFollowUp),
        removeQueuedFollowUp: vi.fn().mockResolvedValue(removedFollowUp)
      },
      skills: {
        listSkills: vi.fn(),
        getSkillDetail: vi.fn(),
        saveSkill: vi.fn(),
        toggleSkill: vi.fn(),
        installSuggestedSkill: vi.fn(),
        removeSkill: vi.fn()
      },
      automations: {
        onEvent: vi.fn(() => vi.fn()),
        refresh: vi.fn(),
        runNow: vi.fn()
      },
      jobs: {
        onEvent: vi.fn(() => vi.fn()),
        listJobs: vi.fn(),
        listPendingReviews: vi.fn(),
        createDailyNoteReview: vi.fn(),
        createMemoryPromotionReview: vi.fn(),
        createUserPreferenceReview: vi.fn(),
        approveReview: vi.fn(),
        rejectReview: vi.fn()
      },
      mcp: {
        onEvent: vi.fn(() => vi.fn()),
        listServerViews: vi.fn(),
        listCatalog: vi.fn()
      },
      diagnostics: {
        export: vi.fn()
      },
      voice: {
        transcribeAudio: vi.fn()
      }
    };

    const mainWindow = {
      webContents: {
        send: vi.fn()
      },
      on: vi.fn()
    };

    registerIpc(mainWindow as never, services as never);

    const createEntry = handleMock.mock.calls.find(([channel]) => channel === 'threads:createFollowUp');
    const updateEntry = handleMock.mock.calls.find(([channel]) => channel === 'threads:updateFollowUp');
    const removeEntry = handleMock.mock.calls.find(([channel]) => channel === 'threads:removeFollowUp');

    expect(createEntry).toBeTruthy();
    expect(updateEntry).toBeTruthy();
    expect(removeEntry).toBeTruthy();

    const [, createHandler] = createEntry!;
    const [, updateHandler] = updateEntry!;
    const [, removeHandler] = removeEntry!;

    expect(
      await createHandler({}, { threadId: 'thread-1', content: 'Queue this next.', kind: 'follow_up' })
    ).toEqual(createdFollowUp);
    expect(
      await updateHandler({}, { followUpId: 'follow-up-1', content: 'Queue this after tests.' })
    ).toEqual(updatedFollowUp);
    expect(await removeHandler({}, { followUpId: 'follow-up-1' })).toEqual(removedFollowUp);

    expect(services.db.createThreadFollowUp).toHaveBeenCalledWith({
      threadId: 'thread-1',
      content: 'Queue this next.',
      kind: 'follow_up'
    });
    expect(services.providers.updateQueuedFollowUp).toHaveBeenCalledWith(
      'follow-up-1',
      'Queue this after tests.'
    );
    expect(services.providers.removeQueuedFollowUp).toHaveBeenCalledWith('follow-up-1');
  });
});
