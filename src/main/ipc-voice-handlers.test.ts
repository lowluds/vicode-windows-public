import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMock, resetIpcTestMocks } from './ipc-test-harness';

describe('registerIpc voice handlers', () => {
  beforeEach(resetIpcTestMocks);

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
});
