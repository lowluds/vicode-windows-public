import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Preferences, ProviderId } from '../shared/domain';
import { ensureDatabaseSchema } from '../storage/database-schema';
import {
  ProjectKnowledgeIndexRepository,
  type ProjectKnowledgeReplaceRootIndexInput
} from '../storage/project-knowledge-index-repository';
import { getPathMock, handleMock, openPathMock, resetIpcTestMocks } from './ipc-test-harness';

const providerIds: ProviderId[] = ['openai', 'gemini', 'qwen', 'ollama', 'kimi', 'openai_compatible'];

describe('registerIpc Project Knowledge handlers', () => {
  const tempDirs: string[] = [];
  const databases: Database.Database[] = [];

  beforeEach(resetIpcTestMocks);

  afterEach(() => {
    while (databases.length > 0) {
      databases.pop()?.close();
    }
    while (tempDirs.length > 0) {
      const directory = tempDirs.pop();
      if (directory) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  function createPreferences(rootPath: string | null): Preferences {
    return {
      selectedProjectId: null,
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
      llmWikiLibraryPath: rootPath
    };
  }

  function createServices(rootPath: string | null) {
    const db = new Database(':memory:');
    databases.push(db);
    db.pragma('foreign_keys = ON');
    ensureDatabaseSchema(db);
    const repository = new ProjectKnowledgeIndexRepository(db);
    const preferences = createPreferences(rootPath);

    return {
      db: {
        getPreferences: vi.fn(() => preferences),
        getProjectKnowledgeIndexSnapshotByRootPath: vi.fn((path: string) => repository.getSnapshotByRootPath(path)),
        isProjectKnowledgeFts5Available: vi.fn(() => false),
        replaceProjectKnowledgeRootIndex: vi.fn((input: ProjectKnowledgeReplaceRootIndexInput) => repository.replaceRootIndex(input))
      },
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
  }

  function createKnowledgeFolder() {
    const root = mkdtempSync(join(tmpdir(), 'vicode-ipc-project-knowledge-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'guides'), { recursive: true });
    const indexPath = join(root, 'guides', 'INDEX.md');
    writeFileSync(indexPath, ['# Runtime Routing', '', '## Evidence', 'Show selected title, path, heading, and reason.'].join('\n'), 'utf8');
    writeFileSync(join(root, 'notes.txt'), 'Plain text is not indexed.', 'utf8');
    return { root, indexPath };
  }

  function getHandler(channel: string) {
    const entry = handleMock.mock.calls.find(([registeredChannel]) => registeredChannel === channel);
    expect(entry).toBeTruthy();
    return entry![1];
  }

  it('refreshes the app-owned index and returns compact status over IPC', async () => {
    const { registerIpc } = await import('./ipc');
    const { root, indexPath } = createKnowledgeFolder();
    const beforeContent = readFileSync(indexPath, 'utf8');
    const services = createServices(root);
    const mainWindow = {
      webContents: {
        send: vi.fn()
      },
      on: vi.fn()
    };

    registerIpc(mainWindow as never, services as never);

    const getStatus = getHandler('projectKnowledge:getIndexStatus');
    const refreshIndex = getHandler('projectKnowledge:refreshIndex');
    const suggestIndex = getHandler('projectKnowledge:suggestIndex');
    const openSuggestedIndexDraft = getHandler('projectKnowledge:openSuggestedIndexDraft');

    expect(getStatus({})).toMatchObject({
      status: 'not_indexed',
      indexedFileCount: 0,
      sectionCount: 0
    });

    expect(refreshIndex({})).toMatchObject({
      status: 'ready',
      indexedFileCount: 1,
      sectionCount: 2,
      diagnosticCount: 1,
      diagnostics: [
        expect.objectContaining({
          severity: 'info',
          code: 'unsupported_extension',
          relativePath: 'notes.txt'
        })
      ],
      message: expect.stringContaining('1 indexed file, 2 sections')
    });
    const draft = suggestIndex({});
    expect(draft).toMatchObject({
      targetRelativePath: 'INDEX.md',
      sourceCount: 1,
      diagnosticCount: 1
    });
    expect(draft.content).toContain('# Project Knowledge Index');
    expect(draft.content).toContain('[[guides/INDEX]] - Runtime Routing');
    expect(draft.content).toContain('notes.txt');
    expect(draft.content).toContain('Draft generated from Vicode app-owned Project Knowledge index');
    const appStateRoot = mkdtempSync(join(tmpdir(), 'vicode-ipc-project-knowledge-state-'));
    tempDirs.push(appStateRoot);
    getPathMock.mockReturnValue(appStateRoot);
    openPathMock.mockResolvedValue('');
    const openedDraft = await openSuggestedIndexDraft({});
    expect(openedDraft).toMatchObject({
      targetRelativePath: 'INDEX.md',
      sourceCount: 1,
      diagnosticCount: 1
    });
    expect(openedDraft.path).toContain('project-knowledge-drafts');
    expect(openPathMock).toHaveBeenCalledWith(openedDraft.path);
    expect(readFileSync(openedDraft.path, 'utf8')).toContain('# Project Knowledge Index');
    expect(readFileSync(openedDraft.path, 'utf8')).toContain('[[guides/INDEX]] - Runtime Routing');
    expect(services.db.replaceProjectKnowledgeRootIndex).toHaveBeenCalledTimes(1);
    expect(readFileSync(indexPath, 'utf8')).toBe(beforeContent);

    writeFileSync(join(root, 'fresh.md'), '# Fresh Runtime\nFresh-only guidance after indexing.', 'utf8');
    expect(getStatus({})).toMatchObject({
      status: 'stale',
      message: 'Project Knowledge index needs refresh because the folder changed.'
    });
  });
});
