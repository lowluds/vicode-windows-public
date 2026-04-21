import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillInstallResult } from '../shared/domain';

const handleMock = vi.fn();
const showOpenDialogMock = vi.fn();
const openExternalMock = vi.fn();
const showItemInFolderMock = vi.fn();
const getPathMock = vi.fn(() => 'C:/Users/test/AppData/Roaming/Vicode');
const getVersionMock = vi.fn(() => '0.1.0');

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock,
    getVersion: getVersionMock
  },
  dialog: {
    showOpenDialog: showOpenDialogMock
  },
  ipcMain: {
    handle: handleMock
  },
  shell: {
    openExternal: openExternalMock,
    showItemInFolder: showItemInFolderMock
  }
}));

describe('registerIpc', () => {
  beforeEach(() => {
    handleMock.mockClear();
    showOpenDialogMock.mockReset();
    openExternalMock.mockReset();
    showItemInFolderMock.mockReset();
  });

  it('forwards Ollama runtime events to the renderer event bus', async () => {
    const { registerIpc } = await import('./ipc');

    const unsubscribeOllamaRuntime = vi.fn();
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
        onEvent: vi.fn((listener: (event: unknown) => void) => {
          listener({
            type: 'ollama.pullProgress',
            progress: {
              model: 'qwen3-coder:30b',
              status: 'downloading',
              completed: 5,
              total: 10,
              digest: 'sha256:test',
              state: 'running'
            }
          });
          return unsubscribeOllamaRuntime;
        })
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
      workspaceBootstrap: {},
      voice: {}
    };

    const unregister = registerIpc(mainWindow as never, services as never);

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('vicode:event', {
      type: 'ollama.pullProgress',
      progress: {
        model: 'qwen3-coder:30b',
        status: 'downloading',
        completed: 5,
        total: 10,
        digest: 'sha256:test',
        state: 'running'
      }
    });

    unregister();
    expect(unsubscribeOllamaRuntime).toHaveBeenCalledOnce();
  });

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
      workspaceBootstrap: {},
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
      workspaceBootstrap: {},
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

  it('returns the suggested skill install result over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const installedResult: SkillInstallResult = {
      status: 'completed',
      providerId: null,
      installPath: 'C:/Users/test/.gemini/extensions/context7',
      message: 'Installed Gemini extension.'
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
        savePreferences: vi.fn(),
        getPersonalization: vi.fn(),
        savePersonalization: vi.fn()
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
        syncSkill: vi.fn(),
        installSuggestedSkill: vi.fn().mockResolvedValue(installedResult),
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
      workspaceBootstrap: {
        getStatus: vi.fn(),
        getQuestionnaire: vi.fn(),
        dismissSuggestion: vi.fn(),
        createDrafts: vi.fn(),
        writeDrafts: vi.fn()
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

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'skills:installSuggested');
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    const result = await handler(
      {},
      {
        installKind: 'github_folder',
        providerId: null,
        providerTargets: ['openai', 'gemini'],
        token: 'context7',
        owner: 'anthropics',
        repo: 'skills',
        path: 'skills/docx',
        name: 'Docx',
        description: 'Create, edit, and analyze Word documents.',
        browseUrl: 'https://github.com/anthropics/skills/tree/main/skills/docx',
        category: 'documents'
      }
    );

    expect(services.skills.installSuggestedSkill).toHaveBeenCalledWith({
      installKind: 'github_folder',
      providerId: null,
      providerTargets: ['openai', 'gemini'],
      token: 'context7',
      owner: 'anthropics',
      repo: 'skills',
      path: 'skills/docx',
      name: 'Docx',
      description: 'Create, edit, and analyze Word documents.',
      browseUrl: 'https://github.com/anthropics/skills/tree/main/skills/docx',
      category: 'documents'
    });
    expect(result).toEqual(installedResult);
  });

  it('hydrates pending run approvals in bootstrap and wires approval IPC handlers', async () => {
    const { registerIpc } = await import('./ipc');

    const pendingApproval = {
      id: 'approval-1',
      threadId: 'thread-1',
      runId: 'run-1',
      providerId: 'ollama',
      toolName: 'run_command',
      command: 'npm test',
      cwd: 'src',
      workspaceRoot: 'C:/workspace',
      requestedAt: '2026-03-23T10:00:00.000Z'
    };

    const services = {
      db: {
        getBootstrapData: vi.fn(async () => ({
          projects: [],
          threadsByProject: {},
          skills: [],
          automations: [],
          jobs: [],
          reviewItems: [],
          providers: [],
          preferences: {},
          personalization: {},
          appMeta: null,
          collaboration: {},
          archivedThreads: [],
          pendingRunToolApprovals: []
        }))
      },
      providers: {
        onEvent: vi.fn(() => vi.fn()),
        listProviders: vi.fn(async () => []),
        listPendingToolApprovals: vi.fn(() => [pendingApproval]),
        approveToolApproval: vi.fn(async () => {}),
        rejectToolApproval: vi.fn(async () => {})
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
      workspaceBootstrap: {},
      voice: {}
    };

    const mainWindow = {
      webContents: {
        send: vi.fn()
      },
      on: vi.fn()
    };

    registerIpc(mainWindow as never, services as never);

    const bootstrapEntry = handleMock.mock.calls.find(([channel]) => channel === 'app:getBootstrap');
    expect(bootstrapEntry).toBeTruthy();
    const approveEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:approveToolApproval');
    const rejectEntry = handleMock.mock.calls.find(([channel]) => channel === 'runs:rejectToolApproval');
    expect(approveEntry).toBeTruthy();
    expect(rejectEntry).toBeTruthy();

    const [, bootstrapHandler] = bootstrapEntry!;
    const [, approveHandler] = approveEntry!;
    const [, rejectHandler] = rejectEntry!;

    const bootstrap = await bootstrapHandler({});
    expect(bootstrap.pendingRunToolApprovals).toEqual([pendingApproval]);

    await approveHandler({}, { approvalId: pendingApproval.id });
    expect(services.providers.approveToolApproval).toHaveBeenCalledWith('approval-1');

    await rejectHandler({}, { approvalId: pendingApproval.id });
    expect(services.providers.rejectToolApproval).toHaveBeenCalledWith('approval-1');
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
      workspaceBootstrap: {},
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
      workspaceBootstrap: {},
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

  it('wires the Ollama runtime stop handler over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const stopAndGetSnapshot = vi.fn(async () => ({
      installed: true,
      reachable: false,
      cliPath: 'C:/Program Files/Ollama/ollama.exe',
      baseUrl: 'http://127.0.0.1:11434',
      models: [],
      managedByApp: false,
      canManageProcess: true,
      canStop: false,
      starting: false
    }));

    const services = {
      db: {},
      providers: {
        onEvent: vi.fn(() => vi.fn())
      },
      ollamaRuntime: {
        onEvent: vi.fn(() => vi.fn()),
        stopAndGetSnapshot
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
      workspaceBootstrap: {},
      voice: {}
    };

    const mainWindow = {
      webContents: {
        send: vi.fn()
      },
      on: vi.fn()
    };

    registerIpc(mainWindow as never, services as never);

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'ollamaRuntime:stop');
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    await expect(handler({})).resolves.toEqual({
      installed: true,
      reachable: false,
      cliPath: 'C:/Program Files/Ollama/ollama.exe',
      baseUrl: 'http://127.0.0.1:11434',
      models: [],
      managedByApp: false,
      canManageProcess: true,
      canStop: false,
      starting: false
    });
    expect(stopAndGetSnapshot).toHaveBeenCalledOnce();
  });

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
        savePreferences: vi.fn(),
        getPersonalization: vi.fn(),
        savePersonalization: vi.fn()
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
        syncSkill: vi.fn(),
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
      workspaceBootstrap: {
        getStatus: vi.fn(),
        getQuestionnaire: vi.fn(),
        dismissSuggestion: vi.fn(),
        createDrafts: vi.fn(),
        writeDrafts: vi.fn()
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
        savePreferences: vi.fn(),
        getPersonalization: vi.fn(),
        savePersonalization: vi.fn()
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
        syncSkill: vi.fn(),
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
      workspaceBootstrap: {
        getStatus: vi.fn(),
        getQuestionnaire: vi.fn(),
        dismissSuggestion: vi.fn(),
        createDrafts: vi.fn(),
        writeDrafts: vi.fn()
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
        savePreferences: vi.fn(),
        getPersonalization: vi.fn(),
        savePersonalization: vi.fn()
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
        syncSkill: vi.fn(),
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
      workspaceBootstrap: {
        getStatus: vi.fn(),
        getQuestionnaire: vi.fn(),
        dismissSuggestion: vi.fn(),
        createDrafts: vi.fn(),
        writeDrafts: vi.fn()
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
      workspaceBootstrap: {},
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
      workspaceBootstrap: {},
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
        savePreferences: vi.fn(),
        getPersonalization: vi.fn(),
        savePersonalization: vi.fn()
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
        syncSkill: vi.fn(),
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
      workspaceBootstrap: {
        getStatus: vi.fn(),
        getQuestionnaire: vi.fn(),
        dismissSuggestion: vi.fn(),
        createDrafts: vi.fn(),
        writeDrafts: vi.fn()
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
        savePreferences: vi.fn(),
        getPersonalization: vi.fn(),
        savePersonalization: vi.fn()
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
        syncSkill: vi.fn(),
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
      workspaceBootstrap: {
        getStatus: vi.fn(),
        getQuestionnaire: vi.fn(),
        dismissSuggestion: vi.fn(),
        createDrafts: vi.fn(),
        writeDrafts: vi.fn()
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

  it('wires workspace bootstrap handlers over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const workspaceStatus = {
      eligible: true,
      reason: null,
      folderPath: 'C:/workspace/project',
      existingFiles: ['AGENTS.md'],
      missingFiles: ['USER.md', 'MEMORY.md'],
      needsBootstrap: true
    };
    const workspaceDrafts = {
      status: workspaceStatus,
      inspection: {
        folderPath: 'C:/workspace/project',
        repoName: 'project',
        repoPurpose: 'Build a durable workspace.',
        repoStack: 'Electron, React, TypeScript',
        packageManager: 'npm',
        installCommand: 'npm install',
        buildCommand: 'npm run build',
        testCommand: 'npm run test',
        lintCommand: null,
        platformFocus: 'Windows-first',
        architectureFacts: ['Main, preload, renderer boundaries.'],
        constraints: ['Use small diffs.'],
        frameworks: ['Electron', 'React'],
        languages: ['TypeScript']
      },
      drafts: [
        {
          kind: 'agents',
          fileName: 'AGENTS.md',
          relativePath: 'AGENTS.md',
          content: '# Workspace Operating Guide'
        }
      ]
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
        getThreadDraft: vi.fn(),
        saveThreadDraft: vi.fn(),
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
        savePreferences: vi.fn(),
        getPersonalization: vi.fn(),
        savePersonalization: vi.fn(),
        getProject: vi.fn().mockReturnValue({ id: 'project-1', folderPath: 'C:/workspace/project', trusted: true })
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
        syncSkill: vi.fn(),
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
      workspaceBootstrap: {
        getStatus: vi.fn().mockReturnValue(workspaceStatus),
        getQuestionnaire: vi.fn().mockReturnValue([{ id: 'projectIntent', prompt: 'What are you building here?', targetFiles: ['MEMORY.md'] }]),
        dismissSuggestion: vi.fn(),
        createDrafts: vi.fn().mockReturnValue(workspaceDrafts),
        writeDrafts: vi.fn().mockReturnValue(['C:/workspace/project/AGENTS.md'])
      },
      diagnostics: {
        export: vi.fn()
      }
    };

    const mainWindow = {
      webContents: {
        send: vi.fn()
      },
      on: vi.fn()
    };

    registerIpc(mainWindow as never, services as never);

    const getStatusEntry = handleMock.mock.calls.find(([channel]) => channel === 'workspaceBootstrap:getStatus');
    const dismissEntry = handleMock.mock.calls.find(([channel]) => channel === 'workspaceBootstrap:dismissSuggestion');
    const createDraftsEntry = handleMock.mock.calls.find(([channel]) => channel === 'workspaceBootstrap:createDrafts');
    const writeDraftsEntry = handleMock.mock.calls.find(([channel]) => channel === 'workspaceBootstrap:writeDrafts');

    expect(getStatusEntry).toBeTruthy();
    expect(dismissEntry).toBeTruthy();
    expect(createDraftsEntry).toBeTruthy();
    expect(writeDraftsEntry).toBeTruthy();

    const [, getStatusHandler] = getStatusEntry!;
    const [, dismissHandler] = dismissEntry!;
    const [, createDraftsHandler] = createDraftsEntry!;
    const [, writeDraftsHandler] = writeDraftsEntry!;

    expect(await getStatusHandler({}, { projectId: 'project-1' })).toEqual(workspaceStatus);
    expect(await dismissHandler({}, { projectId: 'project-1' })).toEqual(workspaceStatus);
    expect(
      await createDraftsHandler({}, { projectId: 'project-1', answers: { projectIntent: 'Build a durable workspace.' }, includeSoul: true })
    ).toEqual(workspaceDrafts);
    expect(
      await writeDraftsHandler({}, { projectId: 'project-1', drafts: workspaceDrafts.drafts })
    ).toEqual(['C:/workspace/project/AGENTS.md']);

    expect(services.db.getProject).toHaveBeenCalledWith('project-1');
    expect(services.workspaceBootstrap.dismissSuggestion).toHaveBeenCalled();
    expect(services.workspaceBootstrap.createDrafts).toHaveBeenCalled();
    expect(services.workspaceBootstrap.writeDrafts).toHaveBeenCalled();
  });

  it('wires voice transcription over IPC', async () => {
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
        getThreadDraft: vi.fn(),
        saveThreadDraft: vi.fn(),
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
        savePreferences: vi.fn(),
        getPersonalization: vi.fn(),
        savePersonalization: vi.fn()
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
        syncSkill: vi.fn(),
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
      workspaceBootstrap: {
        getStatus: vi.fn(),
        getQuestionnaire: vi.fn(),
        createDrafts: vi.fn(),
        writeDrafts: vi.fn()
      },
      diagnostics: {
        export: vi.fn()
      },
      voice: {
        transcribeAudio: vi.fn().mockResolvedValue({ text: 'hello from voice' })
      }
    };

    const mainWindow = {
      webContents: {
        send: vi.fn()
      },
      on: vi.fn()
    };

    registerIpc(mainWindow as never, services as never);

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'voice:transcribe');
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    const result = await handler({}, { audioBase64: 'YQ==', mimeType: 'audio/webm', fileName: 'dictation.webm' });

    expect(services.voice.transcribeAudio).toHaveBeenCalledWith({
      audioBase64: 'YQ==',
      mimeType: 'audio/webm',
      fileName: 'dictation.webm'
    });
    expect(result).toEqual({ text: 'hello from voice' });
  });

  it('wires daily note capture over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const reviewResult = {
      job: {
        id: 'job-1',
        projectId: 'project-1',
        sourceType: 'manual' as const,
        sourceId: 'daily-note:thread-1',
        title: 'Capture daily note',
        status: 'completed' as const,
        threadId: 'thread-1',
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z'
      },
      reviewItem: {
        id: 'review-1',
        jobId: 'job-1',
        jobRunId: null,
        kind: 'manual_review' as const,
        status: 'approved' as const,
        summary: 'Review daily note update',
        details: {
          actionType: 'daily_note_capture',
          threadId: 'thread-1',
          relativePath: 'memory/2026-03-17.md'
        },
        decision: {
          action: 'approved',
          autoApplied: true,
          writtenPath: 'C:/workspace/memory/2026-03-17.md'
        },
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z'
      },
      alreadyPending: false
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
        getThreadDraft: vi.fn(),
        saveThreadDraft: vi.fn(),
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
        savePreferences: vi.fn(),
        getPersonalization: vi.fn(),
        savePersonalization: vi.fn()
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
        syncSkill: vi.fn(),
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
        createDailyNoteReview: vi.fn().mockReturnValue(reviewResult),
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
      workspaceBootstrap: {
        getStatus: vi.fn(),
        getQuestionnaire: vi.fn(),
        dismissSuggestion: vi.fn(),
        createDrafts: vi.fn(),
        writeDrafts: vi.fn()
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

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'memoryWrites:createDailyNoteReview');
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    const result = await handler({}, { threadId: 'thread-1' });

    expect(services.jobs.createDailyNoteReview).toHaveBeenCalledWith('thread-1');
    expect(result).toEqual(reviewResult);
  });

  it('wires durable memory promotion over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const reviewResult = {
      job: {
        id: 'job-2',
        projectId: 'project-1',
        sourceType: 'manual' as const,
        sourceId: 'memory-promotion:thread-1',
        title: 'Promote durable memory',
        status: 'completed' as const,
        threadId: 'thread-1',
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z'
      },
      reviewItem: {
        id: 'review-2',
        jobId: 'job-2',
        jobRunId: null,
        kind: 'manual_review' as const,
        status: 'approved' as const,
        summary: 'Review durable memory promotion',
        details: {
          actionType: 'memory_promotion',
          threadId: 'thread-1',
          relativePath: 'MEMORY.md'
        },
        decision: {
          action: 'approved',
          autoApplied: true,
          writtenPath: 'C:/workspace/MEMORY.md'
        },
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z'
      },
      alreadyPending: false
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
        getThreadDraft: vi.fn(),
        saveThreadDraft: vi.fn(),
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
        savePreferences: vi.fn(),
        getPersonalization: vi.fn(),
        savePersonalization: vi.fn()
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
        syncSkill: vi.fn(),
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
        createMemoryPromotionReview: vi.fn().mockReturnValue(reviewResult),
        createUserPreferenceReview: vi.fn(),
        approveReview: vi.fn(),
        rejectReview: vi.fn()
      },
      mcp: {
        onEvent: vi.fn(() => vi.fn()),
        listServerViews: vi.fn(),
        listCatalog: vi.fn()
      },
      workspaceBootstrap: {
        getStatus: vi.fn(),
        getQuestionnaire: vi.fn(),
        dismissSuggestion: vi.fn(),
        createDrafts: vi.fn(),
        writeDrafts: vi.fn()
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

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'memoryWrites:createMemoryPromotionReview');
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    const result = await handler({}, { threadId: 'thread-1' });

    expect(services.jobs.createMemoryPromotionReview).toHaveBeenCalledWith('thread-1');
    expect(result).toEqual(reviewResult);
  });

  it('wires USER.md update over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const reviewResult = {
      job: {
        id: 'job-3',
        projectId: 'project-1',
        sourceType: 'manual' as const,
        sourceId: 'user-preference:thread-1',
        title: 'Suggest USER.md update',
        status: 'completed' as const,
        threadId: 'thread-1',
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z'
      },
      reviewItem: {
        id: 'review-3',
        jobId: 'job-3',
        jobRunId: null,
        kind: 'manual_review' as const,
        status: 'approved' as const,
        summary: 'Review USER.md update',
        details: {
          actionType: 'user_preference',
          threadId: 'thread-1',
          relativePath: 'USER.md'
        },
        decision: {
          action: 'approved',
          autoApplied: true,
          writtenPath: 'C:/workspace/USER.md'
        },
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z'
      },
      alreadyPending: false
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
        getThreadDraft: vi.fn(),
        saveThreadDraft: vi.fn(),
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
        savePreferences: vi.fn(),
        getPersonalization: vi.fn(),
        savePersonalization: vi.fn()
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
        syncSkill: vi.fn(),
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
        createUserPreferenceReview: vi.fn().mockReturnValue(reviewResult),
        approveReview: vi.fn(),
        rejectReview: vi.fn()
      },
      mcp: {
        onEvent: vi.fn(() => vi.fn()),
        listServerViews: vi.fn(),
        listCatalog: vi.fn()
      },
      workspaceBootstrap: {
        getStatus: vi.fn(),
        getQuestionnaire: vi.fn(),
        dismissSuggestion: vi.fn(),
        createDrafts: vi.fn(),
        writeDrafts: vi.fn()
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

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'memoryWrites:createUserPreferenceReview');
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    const result = await handler({}, { threadId: 'thread-1' });

    expect(services.jobs.createUserPreferenceReview).toHaveBeenCalledWith('thread-1');
    expect(result).toEqual(reviewResult);
  });

  it('routes manual review draft updates over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const updatedReview = {
      id: 'review-1',
      jobId: 'job-1',
      jobRunId: null,
      kind: 'manual_review' as const,
      status: 'pending' as const,
      summary: 'Review daily note update',
      details: {
        actionType: 'daily_note_capture',
        content: '# Daily Workspace Note\n\n## Edited manually'
      },
      decision: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:01:00.000Z'
    };

    const services = {
      db: {
        getBootstrapData: vi.fn(),
        createProject: vi.fn(),
        updateProject: vi.fn(),
        deleteProject: vi.fn(),
        getProject: vi.fn(),
        listThreads: vi.fn(),
        listArchivedThreads: vi.fn(),
        getThread: vi.fn(),
        getThreadDraft: vi.fn(),
        saveThreadDraft: vi.fn(),
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
        savePreferences: vi.fn(),
        getPersonalization: vi.fn(),
        savePersonalization: vi.fn()
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
        syncSkill: vi.fn(),
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
        updateManualReviewDraft: vi.fn().mockReturnValue(updatedReview),
        approveReview: vi.fn(),
        rejectReview: vi.fn()
      },
      mcp: {
        onEvent: vi.fn(() => vi.fn()),
        listServerViews: vi.fn(),
        listCatalog: vi.fn()
      },
      workspaceBootstrap: {
        getStatus: vi.fn(),
        getQuestionnaire: vi.fn(),
        dismissSuggestion: vi.fn(),
        createDrafts: vi.fn(),
        writeDrafts: vi.fn()
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

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'jobs:updateReviewDraft');
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    const result = await handler({}, { reviewItemId: 'review-1', content: '# Daily Workspace Note\n\n## Edited manually' });

    expect(services.jobs.updateManualReviewDraft).toHaveBeenCalledWith('review-1', '# Daily Workspace Note\n\n## Edited manually');
    expect(result).toEqual(updatedReview);
  });
});
