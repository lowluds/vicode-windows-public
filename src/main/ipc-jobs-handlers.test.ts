import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMock, resetIpcTestMocks } from './ipc-test-harness';

describe('registerIpc jobs handlers', () => {
  beforeEach(resetIpcTestMocks);

  it('routes manual review draft updates over IPC', async () => {
    const { registerIpc } = await import('./ipc');

    const updatedReview = {
      id: 'review-1',
      jobId: 'job-1',
      jobRunId: null,
      kind: 'manual_review' as const,
      status: 'pending' as const,
      summary: 'Review project checkpoint',
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
        updateManualReviewDraft: vi.fn().mockReturnValue(updatedReview),
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

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'jobs:updateReviewDraft');
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    const result = await handler({}, { reviewItemId: 'review-1', content: '# Daily Workspace Note\n\n## Edited manually' });

    expect(services.jobs.updateManualReviewDraft).toHaveBeenCalledWith('review-1', '# Daily Workspace Note\n\n## Edited manually');
    expect(result).toEqual(updatedReview);
  });
});
