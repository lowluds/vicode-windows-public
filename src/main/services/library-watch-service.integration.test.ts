import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectKnowledgeIndexStatus } from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import { LibraryWatchService } from './library-watch-service';

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

async function waitUntil(assertion: () => void, timeoutMs = 5000) {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError;
}

describe('LibraryWatchService real filesystem events', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('detects newly added skill and Project Knowledge files without restarting', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vicode-library-watch-'));
    tempDirs.push(root);
    const statePath = join(root, 'state');
    const stateSkillsRoot = join(statePath, 'skills', 'user');
    const skillsLibraryPath = join(root, 'skills');
    const llmWikiLibraryPath = join(root, 'knowledge');
    mkdirSync(stateSkillsRoot, { recursive: true });
    mkdirSync(skillsLibraryPath, { recursive: true });
    mkdirSync(llmWikiLibraryPath, { recursive: true });

    const events: AppEvent[] = [];
    const refreshSkillsFromDisk = vi.fn();
    const refreshProjectKnowledgeIndex = vi.fn(() => createProjectKnowledgeStatus());
    const service = new LibraryWatchService({
      statePath,
      getPreferences: () => ({
        skillsLibraryPath,
        llmWikiLibraryPath
      }),
      refreshSkillsFromDisk,
      refreshProjectKnowledgeIndex,
      debounceMs: 100
    });
    service.onEvent((event) => events.push(event));

    try {
      service.start();

      const newSkillRoot = join(skillsLibraryPath, 'reviewer');
      mkdirSync(newSkillRoot, { recursive: true });
      writeFileSync(
        join(newSkillRoot, 'SKILL.md'),
        ['# Reviewer', '', 'Use when reviewing code changes.'].join('\n'),
        'utf8'
      );

      writeFileSync(
        join(llmWikiLibraryPath, 'runtime.md'),
        ['# Runtime Routing', '', 'Use the app-owned watcher refresh path.'].join('\n'),
        'utf8'
      );

      await waitUntil(() => {
        expect(refreshSkillsFromDisk).toHaveBeenCalled();
        expect(refreshProjectKnowledgeIndex).toHaveBeenCalled();
        expect(events).toEqual(expect.arrayContaining([
          expect.objectContaining({ type: 'library.skillsChanged' }),
          expect.objectContaining({ type: 'library.projectKnowledgeChanged' })
        ]));
      });
    } finally {
      service.stop();
    }
  });
});
