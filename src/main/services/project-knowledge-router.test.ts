import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectKnowledgeService } from './project-knowledge';
import { ProjectKnowledgeRouter } from './project-knowledge-router';

describe('ProjectKnowledgeRouter', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  function createKnowledgeRoot(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-knowledge-router-'));
    tempDirs.push(dir);
    for (const [relativePath, content] of Object.entries(files)) {
      const target = join(dir, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }
    return dir;
  }

  it('builds a pre-run query from prompt plus resolved task objective', () => {
    const root = createKnowledgeRoot({
      'frontend/performance.md': [
        '# Mobile Web Performance',
        '',
        'Use compact JavaScript, responsive images, and fast first render checks for mobile UI work.'
      ].join('\n'),
      'backend/storage.md': '# Storage Notes\nKeep SQLite migrations small.'
    });
    const router = new ProjectKnowledgeRouter(new ProjectKnowledgeService());

    const result = router.retrieve({
      rootPath: root,
      prompt: 'Make the product page better.',
      task: {
        objective: 'Improve the mobile frontend layout and performance of the product page.',
        expectedToolGroups: ['workspace_write', 'verification']
      },
      maxResults: 2
    });

    expect(result.blocks[0]).toMatchObject({
      title: 'Mobile Web Performance',
      relativePath: 'frontend/performance.md'
    });
    expect(result.query).toContain('Improve the mobile frontend layout');
    expect(result.evidence.reason).toContain('prompt and task objective');
  });

  it('keeps retrieval empty for generic prompts without useful task context', () => {
    const root = createKnowledgeRoot({
      'readme.md': '# Project Notes\nDetailed implementation guidance for React and SQLite.'
    });
    const router = new ProjectKnowledgeRouter(new ProjectKnowledgeService());

    const result = router.retrieve({
      rootPath: root,
      prompt: 'ok',
      maxResults: 3
    });

    expect(result.blocks).toEqual([]);
  });

  it('uses explicit route hints as a narrow retrieval constraint', () => {
    const root = createKnowledgeRoot({
      'routes/search-and-retrieval.md': '# Search And Retrieval\nUse titles, aliases, and headings before body keyword matches.',
      'noise/search-marketing.md': '# Search Marketing\nSearch search search landing page copy.',
      'noise/search-support.md': '# Search Support\nSearch search search ticket queue triage.'
    });
    const router = new ProjectKnowledgeRouter(new ProjectKnowledgeService());

    const result = router.retrieve({
      rootPath: root,
      prompt: 'Use [[Search And Retrieval]] for this context budget decision.',
      maxResults: 3
    });

    expect(result.blocks.map((block) => block.relativePath)).toEqual([
      'routes/search-and-retrieval.md'
    ]);
    expect(result.blocks[0]?.retrievalReason.matchedFields).toContain('explicit route');
  });
});
