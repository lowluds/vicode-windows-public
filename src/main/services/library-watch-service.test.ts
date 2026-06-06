import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectKnowledgeIndexStatus } from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import {
  LibraryWatchService,
  type LibraryWatchNotification
} from './library-watch-service';

type WatchRecord = {
  rootPath: string;
  options: { recursive: boolean; persistent: boolean };
  listener: (eventType: string, filename: string | Buffer | null) => void;
  close: ReturnType<typeof vi.fn>;
  errorHandler: ((error: unknown) => void) | null;
};

function createProjectKnowledgeStatus(): ProjectKnowledgeIndexStatus {
  return {
    status: 'ready',
    path: 'C:/knowledge',
    indexedFileCount: 1,
    sectionCount: 1,
    diagnosticCount: 0,
    warningCount: 0,
    diagnostics: [],
    lastRefreshedAt: '2026-06-05T10:00:00.000Z',
    lastError: null,
    message: 'Project Knowledge index refreshed.'
  };
}

describe('LibraryWatchService', () => {
  let records: WatchRecord[] = [];
  let readableRoots = new Set<string>();
  let skillsLibraryPath: string | null = null;
  let llmWikiLibraryPath: string | null = null;
  let refreshSkillsFromDisk: ReturnType<typeof vi.fn>;
  let refreshProjectKnowledgeIndex: ReturnType<typeof vi.fn>;
  let notifications: LibraryWatchNotification[] = [];
  let events: AppEvent[] = [];
  let nowTick = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    records = [];
    readableRoots = new Set();
    skillsLibraryPath = null;
    llmWikiLibraryPath = null;
    refreshSkillsFromDisk = vi.fn();
    refreshProjectKnowledgeIndex = vi.fn(() => createProjectKnowledgeStatus());
    notifications = [];
    events = [];
    nowTick = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createService() {
    return new LibraryWatchService({
      statePath: 'C:/state',
      getPreferences: () => ({
        skillsLibraryPath,
        llmWikiLibraryPath
      }),
      refreshSkillsFromDisk,
      refreshProjectKnowledgeIndex,
      notify: (notification) => notifications.push(notification),
      debounceMs: 250,
      isReadableDirectory: (path) => readableRoots.has(resolve(path)),
      nowIso: () => `2026-06-05T10:00:0${nowTick++}.000Z`,
      watchFactory: (rootPath, options, listener) => {
        const record: WatchRecord = {
          rootPath,
          options,
          listener,
          close: vi.fn(),
          errorHandler: null
        };
        records.push(record);
        return {
          close: record.close,
          unref: vi.fn(),
          on: (eventName: string, handler: (error: unknown) => void) => {
            if (eventName === 'error') {
              record.errorHandler = handler;
            }
            return undefined as never;
          }
        };
      }
    });
  }

  it('watches app-owned skills, external skills, and Project Knowledge roots', () => {
    const stateSkillsRoot = resolve('C:/state/skills/user');
    const externalSkillsRoot = resolve('C:/skills');
    const knowledgeRoot = resolve('C:/knowledge');
    readableRoots = new Set([stateSkillsRoot, externalSkillsRoot, knowledgeRoot]);
    skillsLibraryPath = externalSkillsRoot;
    llmWikiLibraryPath = knowledgeRoot;

    const service = createService();
    service.start();

    expect(records.map((record) => record.rootPath)).toEqual([
      stateSkillsRoot,
      externalSkillsRoot,
      knowledgeRoot
    ]);
    expect(records.every((record) => record.options.recursive)).toBe(true);
    expect(records.every((record) => record.options.persistent === false)).toBe(true);
    expect(service.getDiagnostics().activeRoots).toEqual([
      { kind: 'skills', rootPath: stateSkillsRoot },
      { kind: 'skills', rootPath: externalSkillsRoot },
      { kind: 'projectKnowledge', rootPath: knowledgeRoot }
    ]);
  });

  it('debounces skills refreshes for relevant skill files', () => {
    const stateSkillsRoot = resolve('C:/state/skills/user');
    readableRoots = new Set([stateSkillsRoot]);
    const service = createService();
    service.onEvent((event) => events.push(event));
    service.start();

    records[0].listener('change', join('reviewer', 'SKILL.md'));
    records[0].listener('change', join('reviewer', '.vicode-skill.json'));

    expect(service.hasPendingSkillsRefresh()).toBe(true);
    expect(refreshSkillsFromDisk).not.toHaveBeenCalled();

    vi.advanceTimersByTime(249);
    expect(refreshSkillsFromDisk).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(refreshSkillsFromDisk).toHaveBeenCalledTimes(1);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      kind: 'skills',
      rootPath: stateSkillsRoot,
      changedPath: join(stateSkillsRoot, 'reviewer', '.vicode-skill.json')
    });
    expect(events).toEqual([
      { type: 'library.skillsChanged', refreshedAt: expect.any(String) }
    ]);
    expect(service.getDiagnostics().refreshCounts.skills).toBe(1);
  });

  it('ignores irrelevant skill file changes', () => {
    const stateSkillsRoot = resolve('C:/state/skills/user');
    readableRoots = new Set([stateSkillsRoot]);
    const service = createService();
    service.start();

    records[0].listener('change', join('reviewer', 'notes.md'));
    vi.advanceTimersByTime(500);

    expect(refreshSkillsFromDisk).not.toHaveBeenCalled();
    expect(notifications).toEqual([]);
  });

  it('refreshes Project Knowledge for markdown changes', () => {
    const knowledgeRoot = resolve('C:/knowledge');
    readableRoots = new Set([resolve('C:/state/skills/user'), knowledgeRoot]);
    llmWikiLibraryPath = knowledgeRoot;
    const service = createService();
    service.onEvent((event) => events.push(event));
    service.start();
    const knowledgeWatcher = records.find((record) => record.rootPath === knowledgeRoot);
    expect(knowledgeWatcher).toBeDefined();

    knowledgeWatcher?.listener('rename', 'runtime.md');
    vi.advanceTimersByTime(250);

    expect(refreshProjectKnowledgeIndex).toHaveBeenCalledTimes(1);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      kind: 'projectKnowledge',
      rootPath: knowledgeRoot,
      changedPath: join(knowledgeRoot, 'runtime.md'),
      projectKnowledgeStatus: createProjectKnowledgeStatus()
    });
    expect(events).toEqual([
      {
        type: 'library.projectKnowledgeChanged',
        refreshedAt: expect.any(String),
        status: createProjectKnowledgeStatus()
      }
    ]);
    expect(service.getDiagnostics().refreshCounts.projectKnowledge).toBe(1);
  });

  it('closes and recreates watchers when configured roots change', () => {
    const stateSkillsRoot = resolve('C:/state/skills/user');
    const firstSkillsRoot = resolve('C:/skills-one');
    const secondSkillsRoot = resolve('C:/skills-two');
    readableRoots = new Set([stateSkillsRoot, firstSkillsRoot, secondSkillsRoot]);
    skillsLibraryPath = firstSkillsRoot;
    const service = createService();
    service.start();
    const firstRecords = [...records];

    skillsLibraryPath = secondSkillsRoot;
    service.refreshWatchedRoots();

    expect(firstRecords.every((record) => record.close.mock.calls.length === 1)).toBe(true);
    expect(records.map((record) => record.rootPath)).toEqual([
      stateSkillsRoot,
      firstSkillsRoot,
      stateSkillsRoot,
      secondSkillsRoot
    ]);
    expect(service.getDiagnostics().activeRoots.map((root) => root.rootPath)).toEqual([
      stateSkillsRoot,
      secondSkillsRoot
    ]);
  });

  it('flushes pending skill refreshes before a run', () => {
    const stateSkillsRoot = resolve('C:/state/skills/user');
    readableRoots = new Set([stateSkillsRoot]);
    const service = createService();
    service.start();

    records[0].listener('change', join('reviewer', 'SKILL.md'));

    expect(service.refreshSkillsIfPending()).toBe(true);
    expect(refreshSkillsFromDisk).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    expect(refreshSkillsFromDisk).toHaveBeenCalledTimes(1);
    expect(service.hasPendingSkillsRefresh()).toBe(false);
  });
});
