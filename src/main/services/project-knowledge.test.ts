import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  listProjectKnowledgeSources,
  ProjectKnowledgeService,
  readProjectKnowledgeSection
} from './project-knowledge';

describe('ProjectKnowledgeService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const current = tempDirs.pop();
      if (current) {
        rmSync(current, { recursive: true, force: true });
      }
    }
  });

  function createKnowledgeRoot(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-project-knowledge-'));
    tempDirs.push(dir);

    for (const [relativePath, content] of Object.entries(files)) {
      const target = join(dir, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }

    return dir;
  }

  it('retrieves bounded markdown sections from titles, aliases, headings, and body text', () => {
    const root = createKnowledgeRoot({
      'runtime.md': [
        '---',
        'title: Runtime Patterns',
        'aliases: [tool routing, provider loop]',
        'tags:',
        '- agents',
        '---',
        '# Runtime Patterns',
        '',
        '## Web Search',
        'Use web search tools when the user asks for current public documentation.',
        '',
        '## File Edits',
        'Prefer small patches and focused verification.'
      ].join('\n'),
      'node_modules/ignored.md': '# Web Search\nThis generated folder should not be indexed.'
    });
    const service = new ProjectKnowledgeService();

    const result = service.retrieveRelevantKnowledge({
      rootPath: root,
      query: 'Check the tool routing rule for web search and current docs.',
      maxResults: 2
    });

    expect(result[0]).toMatchObject({
      label: 'Project Knowledge',
      title: 'Runtime Patterns',
      relativePath: 'runtime.md',
      heading: 'Web Search'
    });
    expect(result[0]?.content).toContain('current public documentation');
    expect(result[0]?.retrievalReason.matchedFields).toEqual(
      expect.arrayContaining(['alias', 'heading', 'body'])
    );
    expect(result.map((block) => block.relativePath)).not.toContain('node_modules/ignored.md');
  });

  it('skips pure casual prompts', () => {
    const root = createKnowledgeRoot({
      'runtime.md': '# Runtime Patterns\nUse web search for current docs.'
    });
    const service = new ProjectKnowledgeService();

    expect(service.retrieveRelevantKnowledge({ rootPath: root, query: 'hey how are you?' })).toEqual([]);
  });

  it('resolves explicit Obsidian-style route mentions', () => {
    const root = createKnowledgeRoot({
      'docs/search.md': '# Search And Retrieval\nKeep lookup bounded and cite files.'
    });
    const service = new ProjectKnowledgeService();

    const result = service.retrieveRelevantKnowledge({
      rootPath: root,
      query: 'Use [[Search And Retrieval]] before expanding retrieval.',
      maxResults: 1
    });

    expect(result[0]?.title).toBe('Search And Retrieval');
    expect(result[0]?.retrievalReason.matchedFields).toContain('explicit route');
  });

  it('prioritizes orientation files without requiring a special bundle format', () => {
    const root = createKnowledgeRoot({
      'README.md': '# Product Playbook\nThe product is an Ollama-first coding assistant with Project Knowledge.',
      'notes/random.md': '# Random Notes\nMeeting notes with the word product repeated many times. product product product.'
    });
    const service = new ProjectKnowledgeService();

    const result = service.retrieveRelevantKnowledge({
      rootPath: root,
      query: 'What is the product playbook for Ollama Project Knowledge?',
      maxResults: 2
    });

    expect(result[0]?.relativePath).toBe('README.md');
    expect(result[0]?.retrievalReason.matchedFields).toContain('orientation file');
  });

  it('diversifies results across files before returning repeated chunks from one file', () => {
    const root = createKnowledgeRoot({
      'frontend/a.md': [
        '# React Routing Performance Accessibility',
        'React routing performance accessibility guidance.',
        '',
        '## React Routing Performance Accessibility Details',
        'React routing performance accessibility details.',
        '',
        '## React Routing Performance Accessibility Checklist',
        'React routing performance accessibility checklist.'
      ].join('\n'),
      'frontend/b.md': '# React Routing\nReact routing guidance.',
      'frontend/c.md': '# Frontend Accessibility\nAccessibility guidance.'
    });
    const service = new ProjectKnowledgeService();

    const result = service.retrieveRelevantKnowledge({
      rootPath: root,
      query: 'React routing frontend performance accessibility',
      maxResults: 3
    });

    expect(new Set(result.map((block) => block.relativePath)).size).toBeGreaterThan(1);
  });

  it('lists and reads Project Knowledge sources by relative path and heading', () => {
    const root = createKnowledgeRoot({
      'runtime.md': [
        '# Runtime Patterns',
        '',
        '## Web Search',
        'Use web research for current docs.',
        '',
        '## File Edits',
        'Keep edits small.'
      ].join('\n')
    });

    expect(listProjectKnowledgeSources(root, 10)).toEqual([
      {
        title: 'Runtime Patterns',
        relativePath: 'runtime.md',
        heading: 'Runtime Patterns'
      },
      {
        title: 'Runtime Patterns',
        relativePath: 'runtime.md',
        heading: 'Web Search'
      },
      {
        title: 'Runtime Patterns',
        relativePath: 'runtime.md',
        heading: 'File Edits'
      }
    ]);
    expect(readProjectKnowledgeSection(root, 'runtime.md', 'Web Search')).toEqual({
      title: 'Runtime Patterns',
      relativePath: 'runtime.md',
      heading: 'Web Search',
      content: 'Use web research for current docs.'
    });
    expect(readProjectKnowledgeSection(root, '../runtime.md')).toBeNull();
  });

  it('retrieves real packaged Vicode guidance as ordinary markdown knowledge', () => {
    const root = join(process.cwd(), 'resources', 'vicode-guidance', 'wiki');
    const service = new ProjectKnowledgeService();

    const result = service.retrieveRelevantKnowledge({
      rootPath: root,
      query: 'How should a local Ollama model use Project Knowledge retrieval and embeddings?',
      maxResults: 3
    });

    expect(result[0]).toMatchObject({
      label: 'Project Knowledge',
      title: 'Ollama And Local Models',
      relativePath: 'Ollama And Local Models.md'
    });
    expect(result[0]?.content).toContain('Ollama');
    expect(result.map((block) => block.title)).toContain('Retrieval For Coding Projects');
  });
});
