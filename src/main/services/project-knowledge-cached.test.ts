import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureDatabaseSchema } from '../../storage/database-schema';
import { ProjectKnowledgeIndexRepository, type ProjectKnowledgeIndexSnapshot } from '../../storage/project-knowledge-index-repository';
import { ProjectKnowledgeIndexService } from './project-knowledge-index';
import { ProjectKnowledgeService, type ProjectKnowledgeIndexReader } from './project-knowledge';

describe('ProjectKnowledgeService cached retrieval', () => {
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
    const dir = mkdtempSync(join(tmpdir(), 'vicode-project-knowledge-cache-'));
    tempDirs.push(dir);

    for (const [relativePath, content] of Object.entries(files)) {
      const target = join(dir, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }

    return dir;
  }

  function createRepository() {
    const db = new Database(':memory:');
    cleanupDatabases.push(db);
    db.pragma('foreign_keys = ON');
    ensureDatabaseSchema(db);
    return new ProjectKnowledgeIndexRepository(db);
  }

  it('uses a fresh derived index before scanning the markdown folder live', () => {
    const root = createKnowledgeRoot({
      'runtime.md': '# Runtime Patterns\nLive file does not include the cached route phrase.'
    });
    const stat = statSync(join(root, 'runtime.md'));
    const snapshot: ProjectKnowledgeIndexSnapshot = {
      root: {
        id: 'root',
        rootPath: resolve(root),
        rootPathHash: 'hash',
        displayName: 'knowledge',
        status: 'ready',
        lastRefreshId: 'refresh',
        lastRefreshedAt: '2026-06-04T10:00:00.000Z',
        lastError: null,
        fileCount: 1,
        sectionCount: 1,
        diagnosticCount: 0,
        warningCount: 0,
        createdAt: '2026-06-04T10:00:00.000Z',
        updatedAt: '2026-06-04T10:00:00.000Z'
      },
      latestRefresh: null,
      sources: [{
        id: 'source',
        rootId: 'root',
        relativePath: 'runtime.md',
        fileName: 'runtime.md',
        fileSize: stat.size,
        modifiedTimeMs: Math.round(stat.mtimeMs),
        contentHash: 'hash',
        title: 'Cached Runtime',
        aliases: ['cached route'],
        tags: [],
        headingCount: 1,
        skippedReason: null,
        indexedAt: '2026-06-04T10:00:00.000Z',
        updatedAt: '2026-06-04T10:00:00.000Z'
      }],
      sections: [{
        id: 'section',
        rootId: 'root',
        sourceId: 'source',
        ordinal: 1,
        heading: 'Cached Evidence',
        headingDepth: 1,
        startLine: 1,
        endLine: 2,
        previewText: 'Cached retrieval evidence should be selected.',
        indexedText: 'Cached retrieval evidence should be selected.',
        contentHash: 'section-hash',
        updatedAt: '2026-06-04T10:00:00.000Z'
      }],
      diagnostics: []
    };
    const reader: ProjectKnowledgeIndexReader = {
      getProjectKnowledgeIndexSnapshotByRootPath: () => snapshot
    };
    const service = new ProjectKnowledgeService({ indexReader: reader });

    const result = service.retrieveRelevantKnowledge({
      rootPath: root,
      query: 'Find the cached route evidence.',
      maxResults: 1
    });

    expect(result[0]).toMatchObject({
      title: 'Cached Runtime',
      heading: 'Cached Evidence',
      content: 'Cached retrieval evidence should be selected.'
    });
    expect(result[0]?.retrievalReason.matchedFields).toEqual(expect.arrayContaining(['alias', 'heading', 'body']));
  });

  it('falls back to live markdown scanning when the derived index is stale', () => {
    const root = createKnowledgeRoot({
      'runtime.md': '# Cached Runtime\nCached-only content.'
    });
    const repository = createRepository();
    new ProjectKnowledgeIndexService(repository).refreshIndex({ rootPath: root });
    writeFileSync(join(root, 'runtime.md'), '# Live Runtime\nLive-only evidence after refresh.', 'utf8');
    const service = new ProjectKnowledgeService({ indexReader: repository });

    const result = service.retrieveRelevantKnowledge({
      rootPath: root,
      query: 'Find live-only evidence after refresh.',
      maxResults: 1
    });

    expect(result[0]).toMatchObject({
      title: 'Live Runtime',
      relativePath: 'runtime.md'
    });
    expect(result[0]?.content).toContain('Live-only evidence');
  });

  it('falls back to live markdown scanning when a new markdown file is added after indexing', () => {
    const root = createKnowledgeRoot({
      'runtime.md': '# Cached Runtime\nCached-only content.'
    });
    const repository = createRepository();
    new ProjectKnowledgeIndexService(repository).refreshIndex({ rootPath: root });
    writeFileSync(join(root, 'fresh.md'), '# Fresh Runtime\nFresh-only evidence after indexing.', 'utf8');
    const service = new ProjectKnowledgeService({ indexReader: repository });

    const result = service.retrieveRelevantKnowledge({
      rootPath: root,
      query: 'Find fresh-only evidence after indexing.',
      maxResults: 1
    });

    expect(result[0]).toMatchObject({
      title: 'Fresh Runtime',
      relativePath: 'fresh.md'
    });
    expect(result[0]?.content).toContain('Fresh-only evidence');
  });
});
