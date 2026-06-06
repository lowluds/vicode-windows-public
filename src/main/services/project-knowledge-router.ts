import type {
  ProjectKnowledgeContextBlock,
  ProjectKnowledgeService
} from './project-knowledge';

export interface ProjectKnowledgeTaskContext {
  objective: string | null;
  expectedToolGroups: string[];
}

export interface ProjectKnowledgeRouterInput {
  rootPath: string | null | undefined;
  prompt: string;
  memoryQuery?: string | null;
  task?: ProjectKnowledgeTaskContext | null;
  maxResults?: number;
}

export interface ProjectKnowledgeRouterResult {
  blocks: ProjectKnowledgeContextBlock[];
  query: string;
  evidence: {
    reason: string;
    promptIncluded: boolean;
    memoryQueryIncluded: boolean;
    taskObjectiveIncluded: boolean;
    expectedToolGroups: string[];
  };
}

function compactQueryParts(parts: Array<string | null | undefined>) {
  return [
    ...new Set(
      parts
        .map((part) => part?.trim() ?? '')
        .filter(Boolean)
    )
  ].join('\n');
}

export class ProjectKnowledgeRouter {
  constructor(private readonly service: ProjectKnowledgeService) {}

  retrieve(input: ProjectKnowledgeRouterInput): ProjectKnowledgeRouterResult {
    const prompt = input.prompt.trim();
    const memoryQuery = input.memoryQuery?.trim() ?? '';
    const taskObjective = input.task?.objective?.trim() ?? '';
    const expectedToolGroups = input.task?.expectedToolGroups ?? [];
    const query = compactQueryParts([
      prompt,
      memoryQuery && memoryQuery !== prompt ? memoryQuery : null,
      taskObjective,
      expectedToolGroups.length > 0 ? `Expected work: ${expectedToolGroups.join(', ')}` : null
    ]);
    const blocks = this.service.retrieveRelevantKnowledge({
      rootPath: input.rootPath,
      query,
      maxResults: input.maxResults
    });

    return {
      blocks,
      query,
      evidence: {
        reason: taskObjective
          ? 'built from prompt and task objective'
          : memoryQuery
            ? 'built from prompt and thread context'
            : 'built from prompt',
        promptIncluded: Boolean(prompt),
        memoryQueryIncluded: Boolean(memoryQuery),
        taskObjectiveIncluded: Boolean(taskObjective),
        expectedToolGroups
      }
    };
  }
}
