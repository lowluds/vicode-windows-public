import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VicodeGuidanceService } from './vicode-guidance';

describe('VicodeGuidanceService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const current = tempDirs.pop();
      if (current) {
        rmSync(current, { recursive: true, force: true });
      }
    }
  });

  function createGuidanceRoot(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-guidance-'));
    tempDirs.push(dir);

    for (const [relativePath, content] of Object.entries(files)) {
      const target = join(dir, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }

    return dir;
  }

  function createManifest(paths: string[]) {
    return JSON.stringify(
      {
        routing: { kind: 'obsidian-wikilinks' },
        vaultRoot: 'wiki',
        pages: paths.map((relativePath) => {
          const title = relativePath.replace(/^wiki\//u, '').replace(/\.md$/u, '');
          return {
            title,
            path: relativePath,
            obsidianRoute: `[[${title}]]`,
            aliases: title === 'Search And Retrieval' ? ['retrieval lookup'] : [],
            aliasRoutes: title === 'Search And Retrieval' ? ['[[retrieval lookup]]'] : []
          };
        })
      },
      null,
      2
    );
  }

  it('selects entrypoint guidance, matching route pages, and active skill references for task-shaped prompts', () => {
    const guidanceRoot = createGuidanceRoot({
      'VICODE.md': '# Vicode Guidance\nUse the router.',
      'wiki/Task Routing.md': '# Task Routing\nRoute the task.',
      'wiki/Source-Backed Workflow.md': '# Source-Backed Workflow\nUse repo truth.',
      'wiki/Frontend Standards.md': '# Frontend Standards\nKeep UI polished.',
      'wiki/Design Taste Translation.md': '# Design Taste Translation\nTranslate references carefully.',
      'wiki/Frontend Quality Gate.md': '# Frontend Quality Gate\nVerify interface quality.',
      'wiki/Agent Runtime Patterns.md': '# Agent Runtime Patterns\nKeep runtime events intentional.',
      'wiki/Code Organization Standard.md': '# Code Organization Standard\nKeep modules focused.',
      'manifest.json': createManifest([
        'wiki/Task Routing.md',
        'wiki/Source-Backed Workflow.md',
        'wiki/Frontend Standards.md',
        'wiki/Design Taste Translation.md',
        'wiki/Frontend Quality Gate.md',
        'wiki/Agent Runtime Patterns.md',
        'wiki/Code Organization Standard.md'
      ])
    });
    const service = new VicodeGuidanceService({ guidanceRoot });

    const result = service.resolveForPrompt({
      prompt: 'Polish the React UI and improve backend module boundaries.',
      selectedSkillIds: ['ui-review']
    });

    expect(result?.documents.map((document) => document.title)).toEqual([
      'Vicode Guidance',
      'Frontend Standards',
      'Design Taste Translation',
      'Frontend Quality Gate',
      'Agent Runtime Patterns',
      'Code Organization Standard'
    ]);
    expect(result?.documents.find((document) => document.title === 'Frontend Standards')?.obsidianRoute).toBe(
      '[[Frontend Standards]]'
    );
    expect(result?.using).toContain('skill:ui-review');
  });

  it('skips packaged wiki guidance for casual prompts', () => {
    const guidanceRoot = createGuidanceRoot({
      'VICODE.md': '# Vicode Guidance\nUse the router.',
      'wiki/Task Routing.md': '# Task Routing\nRoute the task.',
      'wiki/Source-Backed Workflow.md': '# Source-Backed Workflow\nUse repo truth.',
      'manifest.json': createManifest([
        'wiki/Task Routing.md',
        'wiki/Source-Backed Workflow.md'
      ])
    });
    const service = new VicodeGuidanceService({ guidanceRoot });

    expect(service.resolveForPrompt({ prompt: 'hows it going' })).toBeNull();
    expect(service.resolveForPrompt({ prompt: 'hey, how are you?' })).toBeNull();
  });

  it('resolves explicit Obsidian route and alias mentions from the prompt', () => {
    const guidanceRoot = createGuidanceRoot({
      'VICODE.md': '# Vicode Guidance\nUse the router.',
      'wiki/Task Routing.md': '# Task Routing\nRoute the task.',
      'wiki/Source-Backed Workflow.md': '# Source-Backed Workflow\nUse repo truth.',
      'wiki/Search And Retrieval.md': '# Search And Retrieval\nUse narrow lookup.',
      'manifest.json': createManifest([
        'wiki/Task Routing.md',
        'wiki/Source-Backed Workflow.md',
        'wiki/Search And Retrieval.md'
      ])
    });
    const service = new VicodeGuidanceService({ guidanceRoot });

    const result = service.resolveForPrompt({
      prompt: 'Use [[retrieval lookup]] before adding more wiki context.'
    });

    expect(result?.documents.map((document) => document.title)).toContain('Search And Retrieval');
    expect(
      result?.documents.find((document) => document.title === 'Search And Retrieval')?.obsidianRoute
    ).toBe('[[Search And Retrieval]]');
  });

  it('returns null when no curated guidance files are available', () => {
    const guidanceRoot = createGuidanceRoot({});
    const service = new VicodeGuidanceService({ guidanceRoot });

    expect(service.resolveForPrompt({ prompt: 'Build the feature.' })).toBeNull();
  });
});
