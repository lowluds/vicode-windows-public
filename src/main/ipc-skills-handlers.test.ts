import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillInstallResult } from '../shared/domain';
import { handleMock, resetIpcTestMocks } from './ipc-test-harness';

describe('registerIpc skills handlers', () => {
  beforeEach(resetIpcTestMocks);

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
        installTarget: 'https://github.com/anthropics/skills/tree/main/skills/docx',
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
});
