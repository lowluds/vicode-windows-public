import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleMock = vi.fn();

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:/Users/test/AppData/Roaming/Vicode'),
    getVersion: vi.fn(() => '0.2.0')
  },
  dialog: {
    showOpenDialog: vi.fn()
  },
  ipcMain: {
    handle: handleMock
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
    showItemInFolder: vi.fn()
  }
}));

describe('app:getBootstrap IPC', () => {
  beforeEach(() => {
    handleMock.mockReset();
  });

  it('hydrates provider state into the bootstrap payload in main', async () => {
    const { registerIpc } = await import('./ipc');

    const bootstrap = {
      projects: [],
      threadsByProject: {},
      preferences: {
        selectedProjectId: null,
        defaultProviderId: 'openai' as const,
        defaultModelByProvider: {
          openai: 'gpt-5',
          gemini: 'auto-gemini-2.5',
          qwen: 'qwen3.5-plus',
          ollama: 'qwen3',
          kimi: 'kimi-k2-thinking'
        },
        defaultReasoningEffortByProvider: {
          openai: 'high' as const,
          gemini: null,
          qwen: null,
          ollama: null,
          kimi: null
        },
        defaultThinkingByProvider: {
          openai: false,
          gemini: false,
          qwen: true,
          ollama: false,
          kimi: false
        },
        defaultExecutionPermission: 'default' as const,
        followUpBehavior: 'queue' as const,
        generatedMemoryUseEnabled: false,
        generatedMemoryGenerationEnabled: true,
        appearanceMode: 'system' as const,
        onboardingComplete: false,
        lastOpenedThreadId: null,
        microphoneAllowed: false
      }
    };
    const providers = [
      {
        id: 'openai' as const,
        label: 'OpenAI',
        authState: 'connected' as const,
        authMode: 'cli' as const,
        installed: true,
        models: [{ id: 'gpt-5', label: 'GPT-5', description: '' }],
        modelSource: 'runtime' as const,
        modelsUpdatedAt: '2026-03-19T00:00:00.000Z',
        canLiveDiscoverModels: true,
        cliPath: 'codex.cmd',
        capabilities: {
          supportsThinkingToggle: true,
          supportsRuntimeSkillResources: true,
          supportsNativeRunProgress: true,
          executionAuthority: 'provider_cli',
          approvalAuthority: 'none',
          sandboxAuthority: 'provider_cli',
          requiresTrustedWorkspace: true,
          requiresFullAccessForAppRuns: false,
          workspaceInstructionFileName: 'AGENTS.md'
        },
        plannerPolicy: {
          supported: true,
          executionMode: 'workspace-write' as const,
          enforcement: 'hard-enforced' as const
        }
      }
    ];

    const services = {
      db: {
        getBootstrapData: vi.fn().mockResolvedValue(bootstrap)
      },
      providers: {
        onEvent: vi.fn(() => vi.fn()),
        listProviders: vi.fn().mockResolvedValue(providers),
        listPendingToolApprovals: vi.fn(() => [])
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

    const entry = handleMock.mock.calls.find(([channel]) => channel === 'app:getBootstrap');
    expect(entry).toBeTruthy();

    const [, handler] = entry!;
    const result = await handler({});

    expect(services.db.getBootstrapData).toHaveBeenCalledTimes(1);
    expect(services.providers.listProviders).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ...bootstrap,
      providers,
      pendingRunToolApprovals: []
    });
  });
});
