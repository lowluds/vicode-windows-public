import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SettingsViewProps } from './types';
import { GeneralSettingsSection } from './GeneralSettingsSection';

function createSettings(overrides: Partial<SettingsViewProps> = {}): SettingsViewProps {
  return {
    section: 'general',
    setSection: vi.fn(),
    onBack: vi.fn(),
    providers: [],
    preferences: {
      selectedProjectId: 'project-1',
      lastOpenedThreadId: null,
      themeMode: 'system',
      accentMode: 'system',
      accentColor: '#f59e0b',
      defaultExecutionPermission: 'default',
      followUpBehavior: 'queue'
    },
    savePreferences: vi.fn(),
    apiKeys: {},
    setApiKeys: vi.fn(),
    connectProvider: vi.fn(),
    adoptProviderAuth: vi.fn(),
    beginProviderInstall: vi.fn(),
    clearProviderAuth: vi.fn(),
    refreshProvider: vi.fn(),
    pullOllamaModel: vi.fn(),
    ollamaPullProgress: null,
    ollamaRuntimeStatus: null,
    stopOllamaRuntime: vi.fn(),
    deleteOllamaModel: vi.fn(),
    saveProviderApiKey: vi.fn(),
    exportDiagnostics: vi.fn(),
    exportActiveThreadReport: vi.fn(),
    clearAllProviderAuth: vi.fn(),
    appMeta: { version: '0.2.7', userDataPath: 'C:/Users/test/AppData/Vicode', exportsPath: 'C:/Users/test/AppData/Vicode/exports' },
    appUpdateState: null,
    checkForAppUpdates: vi.fn(),
    restartToUpdate: vi.fn(),
    storageDiagnostics: null,
    refreshStorageDiagnostics: vi.fn(),
    compactRunEvents: vi.fn(),
    maintainStorage: vi.fn(),
    selectedProject: {
      id: 'project-1',
      name: 'Visual review app',
      folderPath: 'C:/Users/test/AppData/Local/Temp/vicode-visual-workspace',
      trusted: true,
      runtimeCommandPolicy: 'default',
      runtimeNetworkPolicy: 'default',
      defaultProviderId: 'ollama',
      defaultModelByProvider: {
        openai: 'gpt-5',
        gemini: 'gemini-2.5-pro',
        qwen: 'qwen3-coder-plus',
        ollama: 'qwen3-coder:latest',
        kimi: 'kimi-k2'
      },
      createdAt: '2026-05-23T00:00:00.000Z',
      updatedAt: '2026-05-23T00:00:00.000Z'
    },
    saveProjectRuntimeCommandPolicy: vi.fn(),
    saveProjectRuntimeNetworkPolicy: vi.fn(),
    activeThreadTitle: null,
    archivedThreads: [],
    projects: [],
    restoreArchivedThread: vi.fn(),
    deleteArchivedThread: vi.fn(),
    ...overrides
  } as SettingsViewProps;
}

describe('GeneralSettingsSection', () => {
  it('keeps project context copy product-level instead of exposing the full workspace path', () => {
    const html = renderToStaticMarkup(
      React.createElement(GeneralSettingsSection, {
        settings: createSettings(),
        defaultAccentColor: '#f59e0b',
        currentAccentColor: '#f59e0b'
      })
    );

    expect(html).toContain('Project context');
    expect(html).toContain('Visual review app - vicode-visual-workspace');
    expect(html).not.toContain('C:/Users/test/AppData/Local/Temp');
    expect(html).not.toMatch(/SOUL\.md|USER\.md|MEMORY\.md|daily note|workspace setup/iu);
  });
});
