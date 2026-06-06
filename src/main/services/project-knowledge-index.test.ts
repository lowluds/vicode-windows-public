import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureDatabaseSchema } from '../../storage/database-schema';
import { ProjectKnowledgeIndexRepository } from '../../storage/project-knowledge-index-repository';
import { ProjectKnowledgeIndexService } from './project-knowledge-index';
import { PROJECT_KNOWLEDGE_LIMITS } from './project-knowledge-scanner';

describe('ProjectKnowledgeIndexService', () => {
  const tempDirs: string[] = [];
  const cleanupDatabases: Database.Database[] = [];

  afterEach(() => {
    while (cleanupDatabases.length > 0) {
      cleanupDatabases.pop()?.close();
    }
    while (tempDirs.length > 0) {
      const current = tempDirs.pop();
      if (current) {
        rmSync(current, { recursive: true, force: true });
      }
    }
  });

  function createKnowledgeRoot(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-project-knowledge-index-'));
    tempDirs.push(dir);

    for (const [relativePath, content] of Object.entries(files)) {
      const target = join(dir, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }

    return dir;
  }

  function createService() {
    const db = new Database(':memory:');
    cleanupDatabases.push(db);
    db.pragma('foreign_keys = ON');
    ensureDatabaseSchema(db);
    const repository = new ProjectKnowledgeIndexRepository(db);
    let tick = 0;
    return {
      repository,
      service: new ProjectKnowledgeIndexService(repository, {
        nowIso: () => `2026-06-04T10:00:0${tick++}.000Z`,
        nowMs: () => tick * 100
      })
    };
  }

  function snapshotFolder(root: string) {
    const entries: Record<string, { content: string; modifiedTimeMs: number }> = {};
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(absolutePath);
          continue;
        }
        const relativePath = relative(root, absolutePath).replace(/\\/gu, '/');
        entries[relativePath] = {
          content: readFileSync(absolutePath, 'utf8'),
          modifiedTimeMs: Math.round(statSync(absolutePath).mtimeMs)
        };
      }
    };
    visit(root);
    return entries;
  }

  it('refreshes an app-owned index without mutating the user knowledge folder', () => {
    const oversizedContent = 'A'.repeat(PROJECT_KNOWLEDGE_LIMITS.maxFileChars * 4 + 1);
    const root = createKnowledgeRoot({
      'INDEX.md': [
        '---',
        'title: Runtime Index',
        'aliases: [tool routing, provider loop]',
        'tags: [agents, runtime]',
        '---',
        '# Runtime Index',
        '',
        '## Tool Use',
        'Use app-owned tools with bounded evidence.'
      ].join('\n'),
      'runtime.md': [
        '# Runtime Patterns',
        '',
        '## Retrieval Evidence',
        'Show title, relative path, heading, and reason for selected knowledge.'
      ].join('\n'),
      'duplicate.md': [
        '---',
        'title: Runtime Patterns',
        'aliases: [tool routing]',
        '---',
        '# Runtime Patterns',
        'Duplicate title and alias should be diagnostic evidence.'
      ].join('\n'),
      'untitled.md': 'This page has no heading, title, aliases, or tags.',
      'oversized.md': oversizedContent,
      'notes.txt': 'Unsupported extension should not be indexed.',
      'node_modules/generated.md': '# Generated\nThis should stay ignored.'
    });
    const before = snapshotFolder(root);
    const { service } = createService();

    const snapshot = service.refreshIndex({ rootPath: root });
    const after = snapshotFolder(root);

    expect(after).toEqual(before);
    expect(snapshot.root).toMatchObject({
      status: 'ready',
      fileCount: 4,
      sectionCount: 6,
      diagnosticCount: expect.any(Number),
      warningCount: expect.any(Number)
    });
    expect(snapshot.latestRefresh).toMatchObject({
      status: 'completed',
      fileCount: 4,
      skippedFileCount: 1,
      fts5Available: expect.any(Boolean)
    });
    expect(snapshot.sources.map((source) => source.relativePath)).toEqual([
      'INDEX.md',
      'duplicate.md',
      'oversized.md',
      'runtime.md',
      'untitled.md'
    ]);
    expect(snapshot.sources.find((source) => source.relativePath === 'oversized.md')).toMatchObject({
      skippedReason: 'oversized_file'
    });
    expect(snapshot.sections.map((section) => section.heading)).toEqual(expect.arrayContaining([
      'Runtime Index',
      'Tool Use',
      'Retrieval Evidence'
    ]));
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      'skipped_oversized_file',
      'ignored_directory',
      'unsupported_extension',
      'duplicate_title',
      'duplicate_alias',
      'missing_title_or_h1',
      'weak_metadata'
    ]));
    expect(snapshot.diagnostics.every((diagnostic) => !diagnostic.relativePath || !diagnostic.relativePath.includes(root))).toBe(true);
  });
});
