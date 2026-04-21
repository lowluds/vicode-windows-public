import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceContextService } from './workspace-context';
import type { WorkspaceMemoryContextBlock } from './memory';
import type { GeneratedMemoryContextBlock } from './generated-memory-retrieval';

describe('WorkspaceContextService', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const current = tempDirs.pop();
      if (current) {
        rmSync(current, { recursive: true, force: true });
      }
    }
  });

  function createWorkspace(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-workspace-context-'));
    tempDirs.push(dir);

    for (const [fileName, content] of Object.entries(files)) {
      const target = join(dir, fileName);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }

    return dir;
  }

  it('loads shared files plus codex compatibility for trusted OpenAI workspaces in deterministic order', () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.',
      'SOUL.md': 'You are the workspace agent.',
      'USER.md': 'Be concise.',
      'codex.md': 'Use Codex-specific compatibility.',
      'gemini.md': 'Should not be loaded for OpenAI.'
    });
    const service = new WorkspaceContextService();

    const result = service.assemble({
      providerId: 'openai',
      folderPath: workspace,
      trusted: true
    });

    expect(result.blocks.map((block) => block.fileName)).toEqual(['AGENTS.md', 'SOUL.md', 'USER.md', 'codex.md']);
    expect(result.blocks.map((block) => block.kind)).toEqual(['agents', 'soul', 'user', 'provider_compat']);
  });

  it('loads shared files plus gemini compatibility for trusted Gemini workspaces', () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.',
      'SOUL.md': 'You are the workspace agent.',
      'USER.md': 'Be concise.',
      'codex.md': 'Should not be loaded for Gemini.',
      'gemini.md': 'Use Gemini-specific compatibility.'
    });
    const service = new WorkspaceContextService();

    const result = service.assemble({
      providerId: 'gemini',
      folderPath: workspace,
      trusted: true
    });

    expect(result.blocks.map((block) => block.fileName)).toEqual(['AGENTS.md', 'SOUL.md', 'USER.md', 'gemini.md']);
  });

  it('returns no blocks for untrusted workspaces', () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.',
      'SOUL.md': 'You are the workspace agent.',
      'USER.md': 'Be concise.',
      'codex.md': 'Use Codex-specific compatibility.'
    });
    const service = new WorkspaceContextService();

    const result = service.assemble({
      providerId: 'openai',
      folderPath: workspace,
      trusted: false
    });

    expect(result.blocks).toEqual([]);
    expect(result.selectedSkillIds).toEqual([]);
  });

  it('ignores missing and empty files', () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.',
      'SOUL.md': '   ',
      'USER.md': 'Be concise.'
    });
    const service = new WorkspaceContextService();

    const result = service.assemble({
      providerId: 'openai',
      folderPath: workspace,
      trusted: true
    });

    expect(result.blocks.map((block) => block.fileName)).toEqual(['AGENTS.md', 'USER.md']);
  });

  it('includes retrieved memory blocks when a memory retriever is configured', () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const service = new WorkspaceContextService({
      memoryRetriever: {
        retrieveRelevantMemory: () =>
        [
          {
            kind: 'memory',
            label: 'Workspace MEMORY.md',
            fileName: 'MEMORY.md',
            path: join(workspace, 'MEMORY.md'),
            content: 'The project uses React and Vite.',
            score: 2
          }
        ] satisfies WorkspaceMemoryContextBlock[]
      }
    });

    const result = service.assemble({
      projectId: 'project-1',
      providerId: 'openai',
      folderPath: workspace,
      trusted: true,
      query: 'What stack does this project use?'
    });

    expect(result.memoryBlocks).toHaveLength(1);
    expect(result.memoryBlocks[0]?.fileName).toBe('MEMORY.md');
    expect(result.diagnostics.memoryBlockCount).toBe(1);
    expect(result.diagnostics.memoryRetrievalMs).toBeGreaterThanOrEqual(0);
  });

  it('passes an explicit memory query and maxResults override to the memory retriever', () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const retrieveRelevantMemory = vi.fn(() => []);
    const service = new WorkspaceContextService({
      memoryRetriever: {
        retrieveRelevantMemory
      }
    });

    service.assemble({
      projectId: 'project-1',
      providerId: 'openai',
      folderPath: workspace,
      trusted: true,
      query: 'Short prompt',
      memoryQuery: 'Longer retrieval query with prior thread context',
      memoryMaxResults: 6
    });

    expect(retrieveRelevantMemory).toHaveBeenCalledWith({
      projectId: 'project-1',
      folderPath: workspace,
      trusted: true,
      query: 'Longer retrieval query with prior thread context',
      maxResults: 6
    });
  });

  it('uses a narrower delegated workspace profile for delegated runs', () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.',
      'SOUL.md': 'You are the workspace agent.',
      'USER.md': 'Be concise.',
      'codex.md': 'Use Codex compatibility.'
    });
    const service = new WorkspaceContextService();

    const result = service.assemble({
      providerId: 'openai',
      folderPath: workspace,
      trusted: true,
      contextProfile: 'delegated'
    });

    expect(result.blocks.map((block) => block.fileName)).toEqual(['AGENTS.md', 'codex.md']);
    expect(result.blocks.map((block) => block.kind)).toEqual(['agents', 'provider_compat']);
  });

  it('can retrieve memory even when workspace instruction loading is disabled', () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const service = new WorkspaceContextService({
      memoryRetriever: {
        retrieveRelevantMemory: () =>
          [
            {
              kind: 'memory',
              label: 'Workspace MEMORY.md',
              fileName: 'MEMORY.md',
              path: join(workspace, 'MEMORY.md'),
              content: 'Durable memory remains enabled.',
              score: 2
            }
          ] satisfies WorkspaceMemoryContextBlock[]
      }
    });

    const result = service.assemble({
      projectId: 'project-1',
      providerId: 'openai',
      folderPath: workspace,
      trusted: true,
      query: 'What durable memory do we have?',
      includeWorkspaceInstructions: false,
      includeMemory: true
    });

    expect(result.blocks).toEqual([]);
    expect(result.memoryBlocks).toHaveLength(1);
    expect(result.memoryBlocks[0]?.content).toBe('Durable memory remains enabled.');
  });

  it('returns generated memory in a separate derived lane when enabled', () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const service = new WorkspaceContextService({
      memoryRetriever: {
        retrieveRelevantMemory: () =>
          [
            {
              kind: 'memory',
              label: 'Workspace MEMORY.md',
              fileName: 'MEMORY.md',
              path: join(workspace, 'MEMORY.md'),
              content: 'Canonical workspace memory.',
              score: 2
            }
          ] satisfies WorkspaceMemoryContextBlock[]
      },
      generatedMemoryRetriever: {
        retrieveRelevantMemory: () =>
          [
            {
              itemId: 'generated-1',
              kind: 'known_pitfall',
              label: 'Generated Workspace Recall (Derived, Non-Canonical)',
              summary: 'Use npm run smoke from the workspace root.',
              detail: 'Recent trusted threads converged on the workspace-root smoke path.',
              authority: 'derived_noncanonical',
              sourceThreadIds: ['thread-1'],
              evidenceCount: 2,
              score: 3,
              retrievalReason: {
                kindGate: ['workflow_intent'],
                matchedTerms: ['remember'],
                rank: 1
              }
            }
          ] satisfies GeneratedMemoryContextBlock[]
      }
    });

    const result = service.assemble({
      projectId: 'project-1',
      providerId: 'openai',
      folderPath: workspace,
      trusted: true,
      query: 'What should I remember here?',
      includeGeneratedMemory: true
    });

    expect(result.memoryBlocks).toHaveLength(1);
    expect(result.generatedMemoryBlocks).toHaveLength(1);
    expect(result.generatedMemoryBlocks[0]?.summary).toBe('Use npm run smoke from the workspace root.');
    expect(result.diagnostics.memoryBlockCount).toBe(1);
    expect(result.diagnostics.generatedMemoryBlockCount).toBe(1);
    expect(result.diagnostics.generatedMemoryRetrievalMs).toBeGreaterThanOrEqual(0);
  });

  it('keeps generated memory disabled unless the separate flag is enabled', () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const retrieveRelevantMemory = vi.fn(() => []);
    const service = new WorkspaceContextService({
      generatedMemoryRetriever: {
        retrieveRelevantMemory
      }
    });

    const result = service.assemble({
      projectId: 'project-1',
      providerId: 'openai',
      folderPath: workspace,
      trusted: true,
      query: 'What should I remember here?'
    });

    expect(retrieveRelevantMemory).not.toHaveBeenCalled();
    expect(result.generatedMemoryBlocks).toEqual([]);
    expect(result.diagnostics.generatedMemoryBlockCount).toBe(0);
    expect(result.diagnostics.generatedMemoryRetrievalMs).toBe(0);
  });

  it('resolves skills through the context seam even without trusted workspace files', () => {
    const service = new WorkspaceContextService({
      skillResolver: {
        resolve: () => ({
          selectedSkillIds: ['skill-1', 'skill-2'],
          mentionedSkillIds: ['skill-2'],
          promptSkills: [
            {
              id: 'skill-1',
              name: 'Reviewer',
              description: 'Review patches.',
              instructions: 'Look for regressions.',
              origin: 'custom_local',
              scope: 'project',
              providerTargets: ['openai'],
              enabled: true,
              projectId: 'project-1',
              metadata: {},
              path: null,
              createdAt: '2026-03-17T00:00:00.000Z',
              updatedAt: '2026-03-17T00:00:00.000Z'
            }
          ],
          runtimeSkills: [
            {
              id: 'skill-2',
              name: 'Browser Helper',
              description: 'Use browser helper.',
              instructions: 'Use browser helper.',
              origin: 'provider_native',
              scope: 'project',
              providerTargets: ['openai'],
              enabled: true,
              projectId: 'project-1',
              metadata: {},
              path: 'C:/skills/browser-helper',
              createdAt: '2026-03-17T00:00:00.000Z',
              updatedAt: '2026-03-17T00:00:00.000Z'
            }
          ]
        }),
        formatPromptSkillSection: () => 'Attached skills:\n## Reviewer ($reviewer)\nLook for regressions.',
        formatRuntimeSkillSection: () =>
          'Codex provider-native helpers requested:\n- Browser Helper ($browser-helper) (extension): Use browser helper.',
        resolveRuntimeSkillResources: () => [{ kind: 'extension', path: 'C:/skills/browser-helper' }]
      }
    });

    const result = service.assemble({
      projectId: 'project-1',
      providerId: 'openai',
      folderPath: null,
      trusted: false,
      query: 'Use $reviewer and $browser-helper.',
      explicitSkillIds: []
    });

    expect(result.blocks).toEqual([]);
    expect(result.selectedSkillIds).toEqual(['skill-1', 'skill-2']);
    expect(result.mentionedSkillIds).toEqual(['skill-2']);
    expect(result.skillBlocks.map((block) => block.kind)).toEqual(['prompt_skill']);
    expect(result.runtimeSkillResources).toEqual([]);
  });

  it('includes runtime helper blocks only when attachable runtime resources are resolved', () => {
    const service = new WorkspaceContextService({
      skillResolver: {
        resolve: () => ({
          selectedSkillIds: ['skill-1', 'skill-2'],
          mentionedSkillIds: ['skill-2'],
          promptSkills: [
            {
              id: 'skill-1',
              name: 'Reviewer',
              description: 'Review patches.',
              instructions: 'Look for regressions.',
              origin: 'custom_local',
              scope: 'project',
              providerTargets: ['openai'],
              enabled: true,
              projectId: 'project-1',
              metadata: {},
              path: null,
              createdAt: '2026-03-17T00:00:00.000Z',
              updatedAt: '2026-03-17T00:00:00.000Z'
            }
          ],
          runtimeSkills: [
            {
              id: 'skill-2',
              name: 'Browser Helper',
              description: 'Use browser helper.',
              instructions: 'Use browser helper.',
              origin: 'provider_native',
              scope: 'project',
              providerTargets: ['openai'],
              enabled: true,
              projectId: 'project-1',
              metadata: {},
              path: 'C:/skills/browser-helper',
              createdAt: '2026-03-17T00:00:00.000Z',
              updatedAt: '2026-03-17T00:00:00.000Z'
            }
          ]
        }),
        formatPromptSkillSection: () => 'Attached skills:\n## Reviewer ($reviewer)\nLook for regressions.',
        formatRuntimeSkillSection: () =>
          'Codex provider-native helpers requested:\n- Browser Helper ($browser-helper) (extension): Use browser helper.',
        resolveRuntimeSkillResources: () => [{ kind: 'extension', path: 'C:/skills/browser-helper' }]
      }
    });

    const result = service.assemble({
      projectId: 'project-1',
      providerId: 'openai',
      folderPath: null,
      trusted: false,
      query: 'Use $reviewer and $browser-helper.',
      explicitSkillIds: [],
      includeRuntimeSkills: true
    });

    expect(result.skillBlocks.map((block) => block.kind)).toEqual(['prompt_skill', 'runtime_skill']);
    expect(result.runtimeSkillResources).toEqual([{ kind: 'extension', path: 'C:/skills/browser-helper' }]);
  });

  it('skips skill resolution when no explicit or mentioned skills are present', () => {
    const resolve = vi.fn(() => ({
      selectedSkillIds: ['skill-1'],
      mentionedSkillIds: ['skill-1'],
      promptSkills: [],
      runtimeSkills: []
    }));
    const service = new WorkspaceContextService({
      skillResolver: {
        resolve,
        formatPromptSkillSection: () => '',
        formatRuntimeSkillSection: () => '',
        resolveRuntimeSkillResources: () => []
      }
    });

    const result = service.assemble({
      projectId: 'project-1',
      providerId: 'openai',
      folderPath: null,
      trusted: false,
      query: 'Build the feature.',
      explicitSkillIds: []
    });

    expect(resolve).not.toHaveBeenCalled();
    expect(result.selectedSkillIds).toEqual([]);
    expect(result.skillBlocks).toEqual([]);
    expect(result.diagnostics.skillResolutionMs).toBe(0);
  });

  it('omits runtime helper blocks when no attachable runtime resources remain', () => {
    const service = new WorkspaceContextService({
      skillResolver: {
        resolve: () => ({
          selectedSkillIds: ['skill-2'],
          mentionedSkillIds: ['skill-2'],
          promptSkills: [],
          runtimeSkills: [
            {
              id: 'skill-2',
              name: 'Browser Helper',
              description: 'Use browser helper.',
              instructions: 'Use browser helper.',
              origin: 'provider_native',
              scope: 'project',
              providerTargets: ['openai'],
              enabled: true,
              projectId: 'project-1',
              metadata: {},
              path: null,
              createdAt: '2026-03-17T00:00:00.000Z',
              updatedAt: '2026-03-17T00:00:00.000Z'
            }
          ]
        }),
        formatPromptSkillSection: () => '',
        formatRuntimeSkillSection: () =>
          'Codex provider-native helpers requested:\n- Browser Helper ($browser-helper) (extension): Use browser helper.',
        resolveRuntimeSkillResources: () => []
      }
    });

    const result = service.assemble({
      projectId: 'project-1',
      providerId: 'openai',
      folderPath: null,
      trusted: false,
      query: 'Use $browser-helper.',
      explicitSkillIds: [],
      includeRuntimeSkills: true
    });

    expect(result.skillBlocks).toEqual([]);
    expect(result.runtimeSkillResources).toEqual([]);
  });
});
