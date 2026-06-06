import { describe, expect, it, vi } from 'vitest';
import { ProviderWorkspaceContextSupportService } from './provider-workspace-context-support-service';
import type { WorkspaceContextResult } from './workspace-context';

describe('ProviderWorkspaceContextSupportService', () => {
  function createWorkspaceContextResult(): WorkspaceContextResult {
    return {
      folderPath: 'C:/workspace',
      trusted: true,
      providerId: 'ollama',
      blocks: [],
      memoryBlocks: [],
      generatedMemoryBlocks: [],
      projectKnowledgeBlocks: [],
      projectKnowledgeRouter: null,
      skillBlocks: [],
      runtimeSkillResources: [],
      selectedSkillIds: [],
      autoSelectedSkillIds: [],
      mentionedSkillIds: [],
      diagnostics: {
        durationMs: 0,
        workspaceInstructionReadMs: 0,
        skillResolutionMs: 0,
        runtimeSkillResolutionMs: 0,
        memoryRetrievalMs: 0,
        generatedMemoryRetrievalMs: 0,
        projectKnowledgeRetrievalMs: 0,
        blockCount: 0,
        memoryBlockCount: 0,
        generatedMemoryBlockCount: 0,
        projectKnowledgeBlockCount: 0,
        skillBlockCount: 0,
        runtimeSkillResourceCount: 0
      }
    };
  }

  function createDbStub(input?: { preferences?: Record<string, unknown> }) {
    return {
      getPreferences: () => ({
        llmWikiLibraryPath: null,
        generatedMemoryUseEnabled: false,
        ...(input?.preferences ?? {})
      })
    };
  }

  function createContextSupportStub() {
    return {
      deriveLatestContextWindowUsage: () => null,
      buildMemoryRetrievalQuery: (_thread: unknown, prompt: string) => prompt,
      deriveMemoryMaxResults: () => 3
    };
  }

  function createThreadDetail() {
    return {
      rawOutput: '',
      modelId: null
    };
  }

  it('passes resolved task context into Project Knowledge routing', () => {
    const db = createDbStub({
      preferences: {
        llmWikiLibraryPath: 'C:/knowledge'
      }
    });
    const assemble = vi.fn(() => createWorkspaceContextResult());
    const service = new ProviderWorkspaceContextSupportService(
      db as never,
      { assemble } as never,
      createContextSupportStub() as never
    );

    service.assembleWorkspaceContext(
      {
        projectId: 'project-1',
        providerId: 'ollama',
        skillIds: [],
        prompt: 'Make the page better.'
      },
      createThreadDetail() as never,
      'C:/workspace',
      true,
      {
        includeRuntimeSkills: false,
        resolvedTaskPacket: {
          objective: 'Improve the product page mobile layout.',
          expectedToolGroups: ['workspace_write', 'verification']
        }
      }
    );

    expect(assemble).toHaveBeenCalledWith(expect.objectContaining({
      projectKnowledgeTask: {
        objective: 'Improve the product page mobile layout.',
        expectedToolGroups: ['workspace_write', 'verification']
      }
    }));
  });

  it('creates a visible Project Knowledge activity with matched file details', () => {
    const service = new ProviderWorkspaceContextSupportService({} as never, {} as never, {} as never);

    const activity = service.createProjectKnowledgeActivity(
      [
        {
          label: 'Project Knowledge',
          title: 'Runtime Patterns',
          fileName: 'runtime.md',
          path: 'C:/knowledge/runtime.md',
          relativePath: 'runtime.md',
          heading: 'Web Search',
          content: 'Use web research for current docs.',
          score: 10,
          retrievalReason: {
            rank: 1,
            reason: 'matched heading, body: web, research',
            matchedTerms: ['web', 'research'],
            matchedFields: ['heading', 'body']
          }
        }
      ] satisfies WorkspaceContextResult['projectKnowledgeBlocks'],
      {
        reason: 'built from prompt and task objective',
        promptIncluded: true,
        memoryQueryIncluded: true,
        taskObjectiveIncluded: true,
        expectedToolGroups: ['workspace_write']
      }
    );

    expect(activity).toMatchObject({
      kind: 'guidance',
      summary: 'Context: Runtime Patterns',
      text: [
        'Context: Runtime Patterns',
        '- Router: built from prompt and task objective',
        '- Runtime Patterns (runtime.md > Web Search): matched heading, body: web, research'
      ].join('\n'),
      path: null,
      providerEventType: 'project_knowledge_context'
    });
  });

  it('creates a visible skills activity with selection reasons', () => {
    const service = new ProviderWorkspaceContextSupportService({
      listSkills: () => [
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
        },
        {
          id: 'skill-2',
          name: 'UX Writing',
          description: 'Improve labels.',
          instructions: 'Write clear UI copy.',
          origin: 'custom_local',
          scope: 'global',
          providerTargets: ['openai'],
          enabled: true,
          projectId: null,
          metadata: {},
          path: null,
          createdAt: '2026-03-17T00:00:00.000Z',
          updatedAt: '2026-03-17T00:00:00.000Z'
        }
      ]
    } as never, {} as never, {} as never);

    const activity = service.createSkillActivity({
      selectedSkillIds: ['skill-1', 'skill-2'],
      autoSelectedSkillIds: ['skill-1'],
      mentionedSkillIds: ['skill-2']
    });

    expect(activity).toMatchObject({
      kind: 'skill',
      summary: 'Using: Reviewer, UX Writing',
      text: 'Using: Reviewer, UX Writing\n- Reviewer: auto-selected from prompt\n- UX Writing: mentioned in prompt',
      providerEventType: 'skills_using'
    });
  });
});
