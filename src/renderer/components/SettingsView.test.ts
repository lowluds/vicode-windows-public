import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  LibrarySourcesSnapshot,
  Preferences,
  Project,
  ProjectKnowledgeIndexStatus,
  ProviderDescriptor,
  ProviderId
} from '../../shared/domain';
import type { OllamaRuntimeSnapshot } from '../../shared/ipc';
import { SettingsView } from './SettingsView';

const providerIds: ProviderId[] = ['openai', 'gemini', 'qwen', 'ollama', 'kimi', 'openai_compatible'];

afterEach(() => {
  vi.unstubAllGlobals();
});

function createProvider(overrides: Partial<ProviderDescriptor> = {}): ProviderDescriptor {
  const provider: ProviderDescriptor = {
    id: 'ollama',
    label: 'Ollama',
    authState: 'connected',
    authMode: 'cli',
    installed: true,
    models: [
      {
        id: 'llama3.2',
        label: 'Llama 3.2',
        description: 'Local model',
        recommendation: 'fast'
      },
      {
        id: 'qwen2.5-coder:14b-instruct-q6_K',
        label: 'Qwen 2.5 Coder 14B',
        description: 'Local model',
        recommendation: 'recommended'
      }
    ],
    modelSource: 'runtime',
    modelsUpdatedAt: null,
    canLiveDiscoverModels: true,
    cliPath: 'ollama',
    capabilities: {
      supportsThinkingToggle: false,
      supportsRuntimeSkillResources: true,
      supportsNativeRunProgress: true,
      executionAuthority: 'app_runtime',
      approvalAuthority: 'app',
      sandboxAuthority: 'app_runtime',
      requiresTrustedWorkspace: true,
      requiresFullAccessForAppRuns: false,
      workspaceInstructionFileName: 'AGENTS.md'
    },
    plannerPolicy: {
      supported: true,
      executionMode: 'workspace-write',
      enforcement: 'best-effort'
    }
  };
  return { ...provider, ...overrides };
}

function createProject(): Project {
  return {
    id: 'project-1',
    name: 'Project One',
    folderPath: 'D:\\Projects\\example',
    trusted: true,
    runtimeCommandPolicy: 'auto_approve',
    runtimeNetworkPolicy: 'enabled',
    defaultProviderId: 'ollama',
    defaultModelByProvider: Object.fromEntries(providerIds.map((id) => [id, ''])) as Record<ProviderId, string>,
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: '2026-05-28T00:00:00.000Z'
  };
}

function createSettingsProps(input: {
  provider?: Partial<ProviderDescriptor>;
  ollamaRuntimeStatus?: OllamaRuntimeSnapshot | null;
} = {}): React.ComponentProps<typeof SettingsView> {
  const selectedProject = createProject();
  return {
    section: 'providers',
    setSection: vi.fn(),
    onBack: vi.fn(),
    providers: [createProvider(input.provider)],
    customProviders: [],
    preferences: null,
    librarySources: null,
    projectKnowledgeIndexStatus: null,
    refreshProjectKnowledgeIndex: vi.fn(async () => undefined),
    openProjectKnowledgeSuggestedIndexDraft: vi.fn(async () => undefined),
    savePreferences: vi.fn(async () => undefined),
    refreshLibrarySources: vi.fn(async () => undefined),
    rescanSkillLibrary: vi.fn(async () => undefined),
    apiKeys: Object.fromEntries(providerIds.map((id) => [id, ''])) as Record<ProviderId, string>,
    setApiKeys: vi.fn(),
    connectProvider: vi.fn(async () => undefined),
    adoptProviderAuth: vi.fn(async () => undefined),
    beginProviderInstall: vi.fn(),
    clearProviderAuth: vi.fn(async () => undefined),
    refreshProvider: vi.fn(async () => undefined),
    saveCustomProvider: vi.fn(async (input) => ({
      id: 'custom-provider',
      name: input.name,
      transportKind: input.transportKind,
      baseUrl: input.baseUrl,
      defaultModelId: input.defaultModelId,
      enabled: input.enabled,
      hasApiKey: Boolean(input.apiKey),
      createdAt: '2026-05-28T00:00:00.000Z',
      updatedAt: '2026-05-28T00:00:00.000Z'
    })),
    deleteCustomProvider: vi.fn(async () => undefined),
    pullOllamaModel: vi.fn(async () => undefined),
    ollamaPullProgress: null,
    ollamaRuntimeStatus: input.ollamaRuntimeStatus ?? null,
    stopOllamaRuntime: vi.fn(async () => undefined),
    deleteOllamaModel: vi.fn(async () => undefined),
    saveProviderApiKey: vi.fn(async () => undefined),
    exportDiagnostics: vi.fn(async () => undefined),
    exportActiveThreadReport: vi.fn(async () => undefined),
    clearAllProviderAuth: vi.fn(async () => undefined),
    appMeta: null,
    appUpdateState: null,
    checkForAppUpdates: vi.fn(async () => undefined),
    restartToUpdate: vi.fn(async () => undefined),
    storageDiagnostics: null,
    refreshStorageDiagnostics: vi.fn(async () => undefined),
    compactRunEvents: vi.fn(async () => undefined),
    maintainStorage: vi.fn(async () => undefined),
    selectedProject,
    saveProjectRuntimeCommandPolicy: vi.fn(async () => undefined),
    saveProjectRuntimeNetworkPolicy: vi.fn(async () => undefined),
    activeThreadTitle: null,
    archivedThreads: [],
    projects: [selectedProject],
    restoreArchivedThread: vi.fn(async () => undefined),
    deleteArchivedThread: vi.fn(async () => undefined)
  };
}

function stubSettingsDom() {
  vi.stubGlobal('document', { documentElement: {} });
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: () => '#3f3f3f'
  }));
}

function renderSettings(input?: Parameters<typeof createSettingsProps>[0]) {
  stubSettingsDom();
  return renderToStaticMarkup(React.createElement(SettingsView, createSettingsProps(input)));
}

function createPreferences(overrides: Partial<Preferences> = {}): Preferences {
  return {
    selectedProjectId: 'project-1',
    defaultProviderId: 'ollama',
    defaultModelByProvider: Object.fromEntries(providerIds.map((id) => [id, ''])) as Record<ProviderId, string>,
    defaultReasoningEffortByProvider: Object.fromEntries(
      providerIds.map((id) => [id, id === 'openai' ? 'high' : null])
    ) as Preferences['defaultReasoningEffortByProvider'],
    defaultThinkingByProvider: Object.fromEntries(providerIds.map((id) => [id, id === 'qwen'])) as Record<ProviderId, boolean>,
    ollamaTransportMode: 'chat',
    defaultExecutionPermission: 'default',
    followUpBehavior: 'queue',
    generatedMemoryUseEnabled: false,
    generatedMemoryGenerationEnabled: true,
    appearanceMode: 'system',
    accentMode: 'system',
    accentColor: null,
    onboardingComplete: true,
    lastOpenedThreadId: null,
    microphoneAllowed: false,
    userLibraryPath: null,
    skillsLibraryPath: null,
    llmWikiLibraryPath: 'D:\\Knowledge',
    ...overrides
  };
}

function createLibrarySources(): LibrarySourcesSnapshot {
  return {
    userLibrary: {
      kind: 'user_library',
      label: 'User Library',
      path: null,
      status: 'not_configured',
      message: 'User Library is not configured.',
      entries: []
    },
    skills: {
      kind: 'skills',
      label: 'Skills Folder',
      path: null,
      status: 'not_configured',
      message: 'Skills Folder is not configured.',
      entries: []
    },
    llmWiki: {
      kind: 'llm_wiki',
      label: 'Project Knowledge Folder',
      path: 'D:\\Knowledge',
      status: 'ready',
      message: '2 items found.',
      entries: []
    }
  };
}

function createProjectKnowledgeStatus(): ProjectKnowledgeIndexStatus {
  return {
    status: 'ready',
    path: 'D:\\Knowledge',
    indexedFileCount: 2,
    sectionCount: 5,
    diagnosticCount: 1,
    warningCount: 1,
    diagnostics: [
      {
        severity: 'warning',
        code: 'skipped_oversized_file',
        relativePath: 'large.md',
        message: 'Markdown file is larger than the Project Knowledge index limit.',
        suggestedAction: 'Split this page into smaller topic pages with clear headings.'
      }
    ],
    lastRefreshedAt: '2026-06-04T12:00:00.000Z',
    lastError: null,
    message: '2 indexed files, 5 sections. 1 diagnostic, 1 warning.'
  };
}

describe('SettingsView', () => {
  it('describes Full access as host-local command authority instead of contained sandboxing', () => {
    const html = renderSettings();

    expect(html).toContain('Full access enables host-local command access');
    expect(html).toContain('not contained sandbox execution');
    expect(html).toContain('Auto-approve starts host-local commands immediately');
  });

  it('surfaces explicit default model controls without quick or default recommendation pills', () => {
    const html = renderSettings();

    expect(html).toContain('Used for new threads unless you choose another model in the composer.');
    expect(html).toContain('Ollama default model');
    expect(html).toContain('Current default');
    expect(html).not.toContain('Quick');
    expect(html).not.toContain('>Default<');
  });

  it('uses simpler custom provider key copy', () => {
    const html = renderSettings();

    expect(html).toContain('API keys stay on this device after you save.');
    expect(html).not.toContain('echoed back');
  });

  it('shows Project Knowledge index status and a refresh-index action', () => {
    stubSettingsDom();
    const html = renderToStaticMarkup(
      React.createElement(SettingsView, {
        ...createSettingsProps(),
        section: 'library',
        preferences: createPreferences(),
        librarySources: createLibrarySources(),
        projectKnowledgeIndexStatus: createProjectKnowledgeStatus()
      })
    );

    expect(html).toContain('Refresh Index');
    expect(html).toContain('Open Draft');
    expect(html).not.toContain('Suggest Index');
    expect(html).toContain('2 indexed files, 5 sections. 1 diagnostic, 1 warning.');
    expect(html).toContain('Diagnostics');
    expect(html).toContain('large.md: Markdown file is larger than the Project Knowledge index limit.');
    expect(html).not.toContain('Suggested INDEX.md');
    expect(html).not.toContain('Write INDEX.md');
  });

  it('renders local Ollama models without surfacing a hosted API-key lane', () => {
    const html = renderSettings({
      provider: {
        installed: true,
        authState: 'connected',
        authMode: null,
        models: [
          {
            id: 'llama3.2',
            label: 'Llama 3.2',
            description: 'Local model'
          },
          {
            id: 'local:qwen3-local:14b',
            label: 'Qwen 3 Local 14B',
            description: 'Local model'
          }
        ],
        modelSource: 'runtime'
      }
    });

    expect(html).toContain('Ollama is available');
    expect(html).toContain('2 local models available');
    expect(html).not.toContain('Cloud models');
    expect(html).not.toContain('Paste Ollama API key');
    expect(html).toContain('Llama 3.2');
    expect(html).toContain('Qwen 3 Local 14B');
    expect(html).toContain('qwen3-local:14b');
  });

  it('renders local Ollama recovery copy when the runtime is installed but not reachable', () => {
    const html = renderSettings({
      provider: {
        installed: true,
        authState: 'detected',
        authMode: null,
        models: [],
        message: 'Ollama local runtime is installed, but not reachable yet.'
      },
      ollamaRuntimeStatus: {
        installed: true,
        reachable: false,
        cliPath: 'C:\\Program Files\\Ollama\\ollama.exe',
        baseUrl: 'http://127.0.0.1:11434',
        models: [],
        managedByApp: false,
        canManageProcess: false,
        canStop: false,
        starting: false
      }
    });

    expect(html).toContain('Local Ollama is installed');
    expect(html).toContain('Local Ollama is installed, but not running yet');
    expect(html).toContain('Start local runtime');
    expect(html).toContain('Not managed by Vicode');
    expect(html).toContain('Process control unavailable');
    expect(html).toContain('Pull a model here, or run');
  });

  it('renders local setup copy when local Ollama is not installed', () => {
    const html = renderSettings({
      provider: {
        installed: false,
        authState: 'disconnected',
        authMode: null,
        models: []
      },
      ollamaRuntimeStatus: {
        installed: false,
        reachable: false,
        cliPath: null,
        baseUrl: 'http://127.0.0.1:11434',
        models: [],
        managedByApp: false,
        canManageProcess: false,
        canStop: false,
        starting: false
      }
    });

    expect(html).toContain('Install local Ollama');
    expect(html).toContain('Install Ollama to use local models from this PC.');
    expect(html).toContain('Local install optional');
    expect(html).toContain('Install Ollama');
    expect(html).not.toContain('Paste Ollama API key');
  });

  it('renders no-model recovery copy when the local runtime is reachable', () => {
    const html = renderSettings({
      provider: {
        installed: true,
        authState: 'connected',
        authMode: null,
        models: []
      },
      ollamaRuntimeStatus: {
        installed: true,
        reachable: true,
        cliPath: 'C:\\Program Files\\Ollama\\ollama.exe',
        baseUrl: 'http://127.0.0.1:11434',
        models: [],
        managedByApp: false,
        canManageProcess: true,
        canStop: false,
        starting: false
      }
    });

    expect(html).toContain('Ollama is available');
    expect(html).toContain('No local models found. Pull a local model first.');
    expect(html).toContain('External runtime currently active');
    expect(html).toContain('Pull a model here, or run');
  });

  it('does not render hosted key recovery copy when legacy Ollama API-key auth is disconnected', () => {
    const html = renderSettings({
      provider: {
        installed: false,
        authState: 'disconnected',
        authMode: 'api_key',
        models: []
      }
    });

    expect(html).toContain('Install local Ollama');
    expect(html).toContain('Install Ollama and pull a local model before running Ollama threads.');
    expect(html).toContain('Local install optional');
    expect(html).not.toContain('No cloud models');
    expect(html).not.toContain('Save your API key, then refresh Ollama.');
  });
});
