import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureDatabaseSchema } from './database-schema';
import { ProjectKnowledgeIndexRepository } from './project-knowledge-index-repository';

const cleanupDatabases: Database.Database[] = [];

afterEach(() => {
  while (cleanupDatabases.length > 0) {
    cleanupDatabases.pop()?.close();
  }
});

function createRepository() {
  const db = new Database(':memory:');
  cleanupDatabases.push(db);
  db.pragma('foreign_keys = ON');
  ensureDatabaseSchema(db);
  return new ProjectKnowledgeIndexRepository(db);
}

describe('ProjectKnowledgeIndexRepository', () => {
  it('replaces derived Project Knowledge records transactionally', () => {
    const repository = createRepository();
    const first = repository.replaceRootIndex({
      rootPath: 'C:\\knowledge',
      displayName: 'knowledge',
      startedAt: '2026-06-04T10:00:00.000Z',
      finishedAt: '2026-06-04T10:00:01.000Z',
      durationMs: 1000,
      fts5Available: true,
      sources: [
        {
          path: 'C:\\knowledge\\runtime.md',
          relativePath: 'runtime.md',
          fileName: 'runtime.md',
          fileSize: 42,
          modifiedTimeMs: 100,
          contentHash: 'hash-runtime',
          title: 'Runtime Patterns',
          aliases: ['tools'],
          tags: ['agents'],
          headingCount: 1,
          skippedReason: null
        },
        {
          path: 'C:\\knowledge\\large.md',
          relativePath: 'large.md',
          fileName: 'large.md',
          fileSize: 999999,
          modifiedTimeMs: 101,
          contentHash: null,
          title: 'large',
          aliases: [],
          tags: [],
          headingCount: 0,
          skippedReason: 'oversized_file'
        }
      ],
      sections: [
        {
          sourceRelativePath: 'runtime.md',
          ordinal: 1,
          heading: 'Runtime Patterns',
          headingDepth: 1,
          startLine: 1,
          endLine: 3,
          previewText: 'Use bounded tools.',
          content: 'Use bounded tools.',
          contentHash: 'hash-section'
        }
      ],
      diagnostics: [
        {
          severity: 'warning',
          code: 'skipped_oversized_file',
          relativePath: 'large.md',
          message: 'Markdown file is larger than the Project Knowledge index limit.',
          suggestedAction: 'Split this page.'
        }
      ]
    });

    expect(first.root).toMatchObject({
      status: 'ready',
      fileCount: 1,
      sectionCount: 1,
      diagnosticCount: 1,
      warningCount: 1
    });
    expect(first.latestRefresh).toMatchObject({
      status: 'completed',
      fileCount: 1,
      skippedFileCount: 1,
      sectionCount: 1,
      fts5Available: true
    });
    expect(first.sources.map((source) => source.relativePath)).toEqual(['large.md', 'runtime.md']);
    expect(first.sections[0]?.indexedText).toBe('Use bounded tools.');
    expect(first.diagnostics[0]).toMatchObject({
      sourceId: first.sources.find((source) => source.relativePath === 'large.md')?.id,
      code: 'skipped_oversized_file'
    });

    const second = repository.replaceRootIndex({
      rootPath: 'C:\\knowledge',
      displayName: 'knowledge',
      startedAt: '2026-06-04T10:01:00.000Z',
      finishedAt: '2026-06-04T10:01:00.500Z',
      durationMs: 500,
      fts5Available: false,
      sources: [
        {
          path: 'C:\\knowledge\\runtime.md',
          relativePath: 'runtime.md',
          fileName: 'runtime.md',
          fileSize: 43,
          modifiedTimeMs: 200,
          contentHash: 'hash-runtime-2',
          title: 'Runtime Patterns',
          aliases: [],
          tags: [],
          headingCount: 1,
          skippedReason: null
        }
      ],
      sections: [],
      diagnostics: []
    });

    expect(second.root.id).toBe(first.root.id);
    expect(second.sources.map((source) => source.relativePath)).toEqual(['runtime.md']);
    expect(second.sections).toEqual([]);
    expect(second.diagnostics).toEqual([]);
    expect(second.latestRefresh).toMatchObject({
      fileCount: 1,
      skippedFileCount: 0,
      fts5Available: false
    });
  });

  it('probes FTS5 availability without requiring an index table', () => {
    const repository = createRepository();

    expect(typeof repository.isFts5Available()).toBe('boolean');
  });
});
