import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMock, resetIpcTestMocks } from './ipc-test-harness';

describe('registerIpc library watch handlers', () => {
  beforeEach(resetIpcTestMocks);

  function getHandler(channel: string) {
    const entry = handleMock.mock.calls.find(([registeredChannel]) => registeredChannel === channel);
    expect(entry).toBeTruthy();
    return entry![1];
  }

  function createMainWindow() {
    return {
      webContents: {
        send: vi.fn()
      },
      on: vi.fn()
    };
  }

  function createServices() {
    const callOrder: string[] = [];
    const submitResult = {
      disposition: 'started',
      thread: { id: 'thread-1' },
      runId: 'run-1'
    };
    return {
      callOrder,
      submitResult,
      db: {
        savePreferences: vi.fn((preferences: unknown) => preferences)
      },
      providers: {
        onEvent: vi.fn(() => vi.fn()),
        submitComposer: vi.fn(async (input: unknown) => {
          callOrder.push('submitComposer');
          return submitResult;
        })
      },
      ollamaRuntime: {
        onEvent: vi.fn(() => vi.fn())
      },
      libraryWatch: {
        onEvent: vi.fn(() => vi.fn()),
        refreshSkillsIfPending: vi.fn(() => {
          callOrder.push('refreshSkillsIfPending');
        }),
        refreshWatchedRoots: vi.fn()
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
      voice: {},
      composerTextAttachments: {}
    };
  }

  it('flushes pending skill refreshes before submitting a composer run', async () => {
    const { registerIpc } = await import('./ipc');
    const services = createServices();
    registerIpc(createMainWindow() as never, services as never);

    const submitComposer = getHandler('composer:submit');
    const result = await submitComposer({}, {
      projectId: 'project-1',
      threadId: null,
      prompt: 'Use the latest local skill instructions.',
      providerId: 'openai',
      modelId: 'gpt-5.1-codex',
      skillIds: ['skill-1']
    });

    expect(result).toBe(services.submitResult);
    expect(services.callOrder).toEqual(['refreshSkillsIfPending', 'submitComposer']);
    expect(services.providers.submitComposer).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      prompt: 'Use the latest local skill instructions.',
      skillIds: ['skill-1']
    }));
    expect(services.subagents.attachRunToChildThread).toHaveBeenCalledWith('thread-1', 'run-1');
  });

  it('reconfigures watched library roots after saving preferences', async () => {
    const { registerIpc } = await import('./ipc');
    const services = createServices();
    registerIpc(createMainWindow() as never, services as never);

    const saveSettings = getHandler('settings:save');
    const result = saveSettings({}, {
      skillsLibraryPath: 'C:/skills',
      llmWikiLibraryPath: 'C:/knowledge'
    });

    expect(result).toEqual({
      skillsLibraryPath: 'C:/skills',
      llmWikiLibraryPath: 'C:/knowledge'
    });
    expect(services.db.savePreferences).toHaveBeenCalledWith({
      skillsLibraryPath: 'C:/skills',
      llmWikiLibraryPath: 'C:/knowledge'
    });
    expect(services.libraryWatch.refreshWatchedRoots).toHaveBeenCalledOnce();
  });
});
