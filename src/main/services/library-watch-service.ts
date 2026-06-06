import { EventEmitter } from 'node:events';
import { existsSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Preferences, ProjectKnowledgeIndexStatus } from '../../shared/domain';
import type { AppEvent } from '../../shared/events';

export type LibraryWatchKind = 'skills' | 'projectKnowledge';

export interface LibraryWatchNotification {
  kind: LibraryWatchKind;
  rootPath: string;
  changedPath: string | null;
  eventType: string;
  refreshedAt: string;
  projectKnowledgeStatus?: ProjectKnowledgeIndexStatus;
}

export interface LibraryWatchDiagnostics {
  activeRoots: Array<{
    kind: LibraryWatchKind;
    rootPath: string;
  }>;
  pendingSkillsRefresh: boolean;
  pendingProjectKnowledgeRefresh: boolean;
  refreshCounts: Record<LibraryWatchKind, number>;
  lastEventAt: string | null;
  lastError: string | null;
}

type Watcher = Pick<FSWatcher, 'close' | 'on' | 'unref'>;

type WatchFactory = (
  rootPath: string,
  options: { recursive: boolean; persistent: boolean },
  listener: (eventType: string, filename: string | Buffer | null) => void
) => Watcher;

type PreferencesReader = Pick<Preferences, 'skillsLibraryPath' | 'llmWikiLibraryPath'>;

export interface LibraryWatchServiceOptions {
  statePath: string;
  getPreferences: () => PreferencesReader;
  refreshSkillsFromDisk: () => void;
  refreshProjectKnowledgeIndex: () => ProjectKnowledgeIndexStatus | null;
  notify?: (notification: LibraryWatchNotification) => void;
  debounceMs?: number;
  watchFactory?: WatchFactory;
  isReadableDirectory?: (path: string) => boolean;
  nowIso?: () => string;
}

interface ActiveWatcher {
  kind: LibraryWatchKind;
  rootPath: string;
  watcher: Watcher;
}

interface PendingWatchEvent {
  rootPath: string;
  changedPath: string | null;
  eventType: string;
}

const DEFAULT_DEBOUNCE_MS = 750;

export class LibraryWatchService {
  private readonly emitter = new EventEmitter();
  private readonly debounceMs: number;
  private readonly watchFactory: WatchFactory;
  private readonly isReadableDirectory: (path: string) => boolean;
  private readonly nowIso: () => string;
  private activeWatchers: ActiveWatcher[] = [];
  private skillsTimer: ReturnType<typeof setTimeout> | null = null;
  private projectKnowledgeTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSkillsRefresh = false;
  private pendingProjectKnowledgeRefresh = false;
  private pendingSkillsEvent: PendingWatchEvent | null = null;
  private pendingProjectKnowledgeEvent: PendingWatchEvent | null = null;
  private refreshCounts: Record<LibraryWatchKind, number> = {
    skills: 0,
    projectKnowledge: 0
  };
  private lastEventAt: string | null = null;
  private lastError: string | null = null;

  constructor(private readonly options: LibraryWatchServiceOptions) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.watchFactory = options.watchFactory ?? watch;
    this.isReadableDirectory = options.isReadableDirectory ?? isReadableDirectory;
    this.nowIso = options.nowIso ?? (() => new Date().toISOString());
  }

  start() {
    this.refreshWatchedRoots();
  }

  onEvent(listener: (event: AppEvent) => void) {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  stop() {
    this.clearTimers();
    this.pendingSkillsRefresh = false;
    this.pendingProjectKnowledgeRefresh = false;
    this.pendingSkillsEvent = null;
    this.pendingProjectKnowledgeEvent = null;
    for (const active of this.activeWatchers) {
      try {
        active.watcher.close();
      } catch (error) {
        this.lastError = formatWatchError(error);
      }
    }
    this.activeWatchers = [];
  }

  refreshWatchedRoots() {
    const nextRoots = this.resolveWatchRoots();
    const currentKey = this.activeWatchers.map(watchKey).sort().join('\n');
    const nextKey = nextRoots.map(watchKey).sort().join('\n');
    if (currentKey === nextKey) {
      return;
    }

    this.stop();
    for (const root of nextRoots) {
      try {
        const watcher = this.watchFactory(
          root.rootPath,
          { recursive: true, persistent: false },
          (eventType, filename) => this.handleWatchEvent(root.kind, root.rootPath, eventType, filename)
        );
        watcher.on?.('error', (error: unknown) => {
          this.lastError = formatWatchError(error);
        });
        watcher.unref?.();
        this.activeWatchers.push({ ...root, watcher });
      } catch (error) {
        this.lastError = formatWatchError(error);
      }
    }
  }

  hasPendingSkillsRefresh() {
    return this.pendingSkillsRefresh;
  }

  refreshSkillsIfPending() {
    if (!this.pendingSkillsRefresh) {
      return false;
    }
    const pendingEvent = this.pendingSkillsEvent;
    this.clearSkillsTimer();
    this.runSkillsRefresh(
      pendingEvent?.changedPath ?? null,
      pendingEvent?.eventType ?? 'flush',
      pendingEvent?.rootPath ?? ''
    );
    return true;
  }

  getDiagnostics(): LibraryWatchDiagnostics {
    return {
      activeRoots: this.activeWatchers.map(({ kind, rootPath }) => ({ kind, rootPath })),
      pendingSkillsRefresh: this.pendingSkillsRefresh,
      pendingProjectKnowledgeRefresh: this.pendingProjectKnowledgeRefresh,
      refreshCounts: { ...this.refreshCounts },
      lastEventAt: this.lastEventAt,
      lastError: this.lastError
    };
  }

  private handleWatchEvent(
    kind: LibraryWatchKind,
    rootPath: string,
    eventType: string,
    filename: string | Buffer | null
  ) {
    const changedPath = filename ? join(rootPath, filename.toString()) : null;
    if (!isRelevantWatchEvent(kind, filename)) {
      return;
    }

    this.lastEventAt = this.nowIso();
    if (kind === 'skills') {
      this.scheduleSkillsRefresh(rootPath, changedPath, eventType);
    } else {
      this.scheduleProjectKnowledgeRefresh(rootPath, changedPath, eventType);
    }
  }

  private scheduleSkillsRefresh(rootPath: string, changedPath: string | null, eventType: string) {
    this.pendingSkillsRefresh = true;
    this.pendingSkillsEvent = { rootPath, changedPath, eventType };
    this.clearSkillsTimer();
    this.skillsTimer = setTimeout(() => this.runSkillsRefresh(changedPath, eventType, rootPath), this.debounceMs);
  }

  private scheduleProjectKnowledgeRefresh(rootPath: string, changedPath: string | null, eventType: string) {
    this.pendingProjectKnowledgeRefresh = true;
    this.pendingProjectKnowledgeEvent = { rootPath, changedPath, eventType };
    this.clearProjectKnowledgeTimer();
    this.projectKnowledgeTimer = setTimeout(
      () => this.runProjectKnowledgeRefresh(changedPath, eventType, rootPath),
      this.debounceMs
    );
  }

  private runSkillsRefresh(changedPath: string | null, eventType: string, rootPath = '') {
    this.pendingSkillsRefresh = false;
    this.pendingSkillsEvent = null;
    this.skillsTimer = null;
    try {
      this.options.refreshSkillsFromDisk();
      this.refreshCounts.skills += 1;
      const refreshedAt = this.nowIso();
      this.options.notify?.({
        kind: 'skills',
        rootPath,
        changedPath,
        eventType,
        refreshedAt
      });
      this.emit({ type: 'library.skillsChanged', refreshedAt });
    } catch (error) {
      this.lastError = formatWatchError(error);
    }
  }

  private runProjectKnowledgeRefresh(changedPath: string | null, eventType: string, rootPath: string) {
    this.pendingProjectKnowledgeRefresh = false;
    this.pendingProjectKnowledgeEvent = null;
    this.projectKnowledgeTimer = null;
    try {
      const projectKnowledgeStatus = this.options.refreshProjectKnowledgeIndex();
      this.refreshCounts.projectKnowledge += 1;
      const refreshedAt = this.nowIso();
      this.options.notify?.({
        kind: 'projectKnowledge',
        rootPath,
        changedPath,
        eventType,
        refreshedAt,
        projectKnowledgeStatus: projectKnowledgeStatus ?? undefined
      });
      this.emit({
        type: 'library.projectKnowledgeChanged',
        refreshedAt,
        status: projectKnowledgeStatus
      });
    } catch (error) {
      this.lastError = formatWatchError(error);
    }
  }

  private emit(event: AppEvent) {
    this.emitter.emit('event', event);
  }

  private resolveWatchRoots() {
    const preferences = this.options.getPreferences();
    const candidates: Array<{ kind: LibraryWatchKind; rootPath: string | null | undefined }> = [
      { kind: 'skills', rootPath: join(this.options.statePath, 'skills', 'user') },
      { kind: 'skills', rootPath: preferences.skillsLibraryPath },
      { kind: 'projectKnowledge', rootPath: preferences.llmWikiLibraryPath }
    ];
    const seen = new Set<string>();
    const roots: Array<{ kind: LibraryWatchKind; rootPath: string }> = [];
    for (const candidate of candidates) {
      const rootPath = candidate.rootPath?.trim();
      if (!rootPath) {
        continue;
      }
      const resolved = resolve(rootPath);
      const key = `${candidate.kind}:${resolved.toLowerCase()}`;
      if (seen.has(key) || !this.isReadableDirectory(resolved)) {
        continue;
      }
      seen.add(key);
      roots.push({ kind: candidate.kind, rootPath: resolved });
    }
    return roots;
  }

  private clearTimers() {
    this.clearSkillsTimer();
    this.clearProjectKnowledgeTimer();
  }

  private clearSkillsTimer() {
    if (this.skillsTimer) {
      clearTimeout(this.skillsTimer);
      this.skillsTimer = null;
    }
  }

  private clearProjectKnowledgeTimer() {
    if (this.projectKnowledgeTimer) {
      clearTimeout(this.projectKnowledgeTimer);
      this.projectKnowledgeTimer = null;
    }
  }
}

function isReadableDirectory(path: string) {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isRelevantWatchEvent(kind: LibraryWatchKind, filename: string | Buffer | null) {
  if (!filename) {
    return true;
  }
  const normalized = filename.toString().replace(/\\/gu, '/').toLowerCase();
  if (normalized.includes('/node_modules/') || normalized.startsWith('node_modules/')) {
    return false;
  }

  if (kind === 'skills') {
    return normalized.endsWith('/skill.md') || normalized === 'skill.md' || normalized.endsWith('/.vicode-skill.json') || normalized === '.vicode-skill.json';
  }

  return normalized.endsWith('.md') || normalized.endsWith('.markdown');
}

function watchKey(root: { kind: LibraryWatchKind; rootPath: string }) {
  return `${root.kind}:${root.rootPath.toLowerCase()}`;
}

function formatWatchError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
