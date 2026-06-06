import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMock, resetIpcTestMocks } from './ipc-test-harness';

describe('registerIpc MCP handlers', () => {
  beforeEach(resetIpcTestMocks);

  it('wires recommended MCP setup over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const configuredServer = {
      id: 'mcp-1',
      name: 'shadcn MCP',
      scope: 'global' as const,
      projectId: null,
      transportType: 'stdio' as const,
      command: 'npx',
      args: ['shadcn@latest', 'mcp'],
      cwd: null,
      enabled: true,
      toolInvocationMode: 'ask' as const,
      launchApproved: false,
      envKeys: [],
      createdAt: '2026-03-17T00:00:00.000Z',
      updatedAt: '2026-03-17T00:00:00.000Z',
      state: {
        serverId: 'mcp-1',
        status: 'approval_required' as const,
        capabilities: null,
        lastSeenAt: null,
        lastError: 'Launch approval required before starting this MCP server.',
        toolCount: 0,
        resourceCount: 0,
        promptCount: 0,
        updatedAt: '2026-03-17T00:00:00.000Z'
      }
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
        listCatalog: vi.fn(),
        setupRecommendedServer: vi.fn().mockResolvedValue(configuredServer)
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

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'mcp:setupRecommended');
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    const result = await handler({}, { entryId: 'shadcn' });

    expect(services.mcp.setupRecommendedServer).toHaveBeenCalledWith('shadcn', null);
    expect(result).toEqual(configuredServer);
  });

  it('wires MCP launch approval over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const approvedServer = {
      id: 'mcp-1',
      name: 'shadcn MCP',
      scope: 'global' as const,
      projectId: null,
      transportType: 'stdio' as const,
      command: 'npx',
      args: ['shadcn@latest', 'mcp'],
      cwd: null,
      enabled: true,
      toolInvocationMode: 'ask' as const,
      launchApproved: true,
      envKeys: [],
      createdAt: '2026-03-17T00:00:00.000Z',
      updatedAt: '2026-03-17T00:00:00.000Z',
      state: {
        serverId: 'mcp-1',
        status: 'connected' as const,
        capabilities: null,
        lastSeenAt: '2026-03-17T00:00:01.000Z',
        lastError: null,
        toolCount: 1,
        resourceCount: 0,
        promptCount: 0,
        updatedAt: '2026-03-17T00:00:01.000Z'
      }
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
        listCatalog: vi.fn(),
        setupRecommendedServer: vi.fn(),
        approveServerLaunch: vi.fn().mockResolvedValue(approvedServer)
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

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'mcp:approveLaunch');
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    const result = await handler({}, { serverId: 'mcp-1' });

    expect(services.mcp.approveServerLaunch).toHaveBeenCalledWith('mcp-1');
    expect(result).toEqual(approvedServer);
  });

  it('wires MCP refresh over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const refreshedServer = {
      id: 'mcp-1',
      name: 'Playwright MCP',
      scope: 'global' as const,
      projectId: null,
      transportType: 'stdio' as const,
      command: 'npx',
      args: ['@playwright/mcp@latest'],
      cwd: null,
      enabled: true,
      toolInvocationMode: 'ask' as const,
      launchApproved: true,
      envKeys: [],
      createdAt: '2026-03-17T00:00:00.000Z',
      updatedAt: '2026-03-17T00:00:00.000Z',
      state: {
        serverId: 'mcp-1',
        status: 'connected' as const,
        capabilities: null,
        lastSeenAt: '2026-03-17T00:00:01.000Z',
        lastError: null,
        toolCount: 2,
        resourceCount: 1,
        promptCount: 0,
        updatedAt: '2026-03-17T00:00:01.000Z'
      }
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
        listServerViews: vi.fn().mockReturnValue([refreshedServer]),
        listCatalog: vi.fn(),
        setupRecommendedServer: vi.fn(),
        approveServerLaunch: vi.fn(),
        refreshServer: vi.fn().mockResolvedValue({
          definition: {
            id: 'mcp-1'
          }
        })
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

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'mcp:refreshServer');
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    const result = await handler({}, { serverId: 'mcp-1' });

    expect(services.mcp.refreshServer).toHaveBeenCalledWith('mcp-1');
    expect(result).toEqual(refreshedServer);
  });
});
