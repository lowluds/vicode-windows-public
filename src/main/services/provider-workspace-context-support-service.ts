import { resolve } from 'node:path';
import type {
  ComposerSubmitInput,
  ProviderId,
  RunActivityInfo,
  ThreadDetail
} from '../../shared/domain';
import { providerCapabilities } from '../../shared/providers';
import { WorkspaceContextService, type WorkspaceContextResult } from './workspace-context';
import { normalizeGeneratedMemoryWorkspaceScopeKey } from './generated-memory';
import { ProviderContextSupportService } from './provider-context-support-service';
import { DatabaseService } from '../../storage/database';

export class ProviderWorkspaceContextSupportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly contextSupport: ProviderContextSupportService
  ) {}

  assembleWorkspaceContext(
    input: Pick<ComposerSubmitInput, 'providerId' | 'skillIds' | 'projectId' | 'prompt'>,
    thread: ThreadDetail,
    folderPath: string | null,
    trusted: boolean,
    options: {
      includeRuntimeSkills: boolean;
      contextProfile?: 'main' | 'delegated';
      includeMemory?: boolean;
      includeGeneratedMemory?: boolean;
      resolvedTaskPacket?: {
        objective: string | null;
        expectedToolGroups: string[];
      } | null;
    }
  ) {
    const preferences = this.db.getPreferences();
    const priorContextUsage = this.contextSupport.deriveLatestContextWindowUsage(
      thread.rawOutput,
      null
    );
    return this.workspaceContext.assemble({
      projectId: input.projectId,
      providerId: input.providerId,
      folderPath,
      trusted,
      contextProfile: options.contextProfile ?? 'main',
      query: input.prompt,
      memoryQuery: this.contextSupport.buildMemoryRetrievalQuery(thread, input.prompt),
      memoryMaxResults: priorContextUsage
        ? this.contextSupport.deriveMemoryMaxResults(
            input.providerId,
            thread.modelId,
            priorContextUsage.usedTokens
          )
        : undefined,
      generatedMemoryQuery: this.contextSupport.buildMemoryRetrievalQuery(
        thread,
        input.prompt
      ),
      generatedMemoryMaxResults: priorContextUsage
        ? Math.min(
            3,
            this.contextSupport.deriveMemoryMaxResults(
              input.providerId,
              thread.modelId,
              priorContextUsage.usedTokens
            )
          )
        : 3,
      projectKnowledgePath: preferences.llmWikiLibraryPath ? resolve(preferences.llmWikiLibraryPath) : null,
      projectKnowledgeMaxResults: 3,
      projectKnowledgeTask: options.resolvedTaskPacket
        ? {
            objective: options.resolvedTaskPacket.objective,
            expectedToolGroups: options.resolvedTaskPacket.expectedToolGroups
          }
        : null,
      explicitSkillIds: input.skillIds,
      includeWorkspaceInstructions: true,
      includeMemory: options.includeMemory ?? true,
      includeGeneratedMemory:
        options.includeGeneratedMemory ?? preferences.generatedMemoryUseEnabled,
      includeProjectKnowledge: true,
      includeRuntimeSkills: options.includeRuntimeSkills
    });
  }

  createProjectKnowledgeActivity(
    projectKnowledgeBlocks: WorkspaceContextResult['projectKnowledgeBlocks'],
    routerEvidence?: WorkspaceContextResult['projectKnowledgeRouter'] | null
  ): RunActivityInfo | null {
    if (projectKnowledgeBlocks.length === 0) {
      return null;
    }

    const titles = [
      ...new Set(projectKnowledgeBlocks.map((block) => block.title.trim()).filter(Boolean))
    ];
    const visibleTitles = titles.slice(0, 3);
    const remainingCount = titles.length - visibleTitles.length;
    const titleText = remainingCount > 0
      ? `${visibleTitles.join(', ')}, and ${remainingCount} more`
      : visibleTitles.join(', ');
    const summary = `Context: ${
      titleText || `${projectKnowledgeBlocks.length} source${projectKnowledgeBlocks.length === 1 ? '' : 's'}`
    }`;
    const detailLines = projectKnowledgeBlocks.map((block) => {
      const location = block.heading
        ? `${block.relativePath} > ${block.heading}`
        : block.relativePath;
      return `- ${block.title} (${location}): ${block.retrievalReason.reason}`;
    });
    const routerLine = routerEvidence
      ? `- Router: ${routerEvidence.reason}`
      : null;

    return {
      kind: 'guidance',
      summary,
      text: `${summary}\n${[routerLine, ...detailLines].filter(Boolean).join('\n')}`,
      path: null,
      providerEventType: 'project_knowledge_context'
    };
  }

  createSkillActivity(
    workspaceContext: Pick<WorkspaceContextResult, 'selectedSkillIds' | 'autoSelectedSkillIds' | 'mentionedSkillIds'>
  ): RunActivityInfo | null {
    if (workspaceContext.selectedSkillIds.length === 0) {
      return null;
    }

    const skillsById = new Map(this.db.listSkills().map((skill) => [skill.id, skill]));
    const selectedSkills = workspaceContext.selectedSkillIds
      .map((skillId) => skillsById.get(skillId) ?? null)
      .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));

    if (selectedSkills.length === 0) {
      return null;
    }

    const visibleNames = selectedSkills.map((skill) => skill.name.trim()).filter(Boolean).slice(0, 3);
    const remainingCount = selectedSkills.length - visibleNames.length;
    const summary = `Using: ${
      remainingCount > 0 ? `${visibleNames.join(', ')}, and ${remainingCount} more` : visibleNames.join(', ')
    }`;
    const autoSelected = new Set(workspaceContext.autoSelectedSkillIds);
    const mentioned = new Set(workspaceContext.mentionedSkillIds);
    const detailLines = selectedSkills.map((skill) => {
      const reason = autoSelected.has(skill.id)
        ? 'auto-selected from prompt'
        : mentioned.has(skill.id)
          ? 'mentioned in prompt'
          : 'selected by user';
      return `- ${skill.name}: ${reason}`;
    });

    return {
      kind: 'skill',
      summary,
      text: `${summary}\n${detailLines.join('\n')}`,
      providerEventType: 'skills_using'
    };
  }

  createMemoryRecallActivity(
    memoryBlocks: WorkspaceContextResult['memoryBlocks'],
    generatedMemoryBlocks: WorkspaceContextResult['generatedMemoryBlocks']
  ): RunActivityInfo | null {
    if (memoryBlocks.length === 0 && generatedMemoryBlocks.length === 0) {
      return null;
    }

    const fileNames = [
      ...new Set(memoryBlocks.map((block) => block.fileName.trim()).filter(Boolean))
    ];
    const summaryParts: string[] = [];
    const textParts: string[] = [];

    if (fileNames.length > 0) {
      summaryParts.push(
        fileNames.length === 1
          ? `Recalled workspace memory from ${fileNames[0]}`
          : `Recalled ${fileNames.length} workspace memory entries`
      );
      textParts.push(`Included ${fileNames.join(', ')}`);
    }

    if (generatedMemoryBlocks.length > 0) {
      summaryParts.push(
        generatedMemoryBlocks.length === 1
          ? 'Recalled 1 generated workspace recall entry'
          : `Recalled ${generatedMemoryBlocks.length} generated workspace recall entries`
      );
      textParts.push(
        `included ${generatedMemoryBlocks.length} derived non-canonical workspace recall ${
          generatedMemoryBlocks.length === 1 ? 'entry' : 'entries'
        }`
      );
    }

    if (summaryParts.length === 0 || textParts.length === 0) {
      return null;
    }

    return {
      kind: 'memory_recall',
      summary: summaryParts.join(' and '),
      text: `${textParts.join(' and ')} in the active prompt context.`
    };
  }

  createGeneratedMemoryTraceDetail(input: {
    folderPath: string | null;
    trusted: boolean;
    generatedMemoryEnabled: boolean;
    generatedMemoryGenerationEnabled: boolean;
    memoryBlocks: WorkspaceContextResult['memoryBlocks'];
    generatedMemoryBlocks: WorkspaceContextResult['generatedMemoryBlocks'];
    repeatSteeringCount: number;
    firstSubstantiveAction?: string | null;
  }) {
    return {
      workspaceScopeKey:
        input.trusted && input.folderPath
          ? normalizeGeneratedMemoryWorkspaceScopeKey(input.folderPath)
          : null,
      generatedMemoryEnabled: input.generatedMemoryEnabled,
      generatedMemoryGenerationEnabled: input.generatedMemoryGenerationEnabled,
      generatedMemoryUsed:
        input.generatedMemoryEnabled && input.generatedMemoryBlocks.length > 0,
      generatedMemoryItemIds: input.generatedMemoryBlocks.map((block) => block.itemId),
      generatedMemoryItems: input.generatedMemoryBlocks.map((block) => ({
        itemId: block.itemId,
        kind: block.kind,
        summary: block.summary,
        score: block.score,
        rank: block.retrievalReason.rank,
        kindGate: block.retrievalReason.kindGate,
        matchedTerms: block.retrievalReason.matchedTerms,
        sourceThreadIds: block.sourceThreadIds
      })),
      generatedMemorySourceThreadIds: [
        ...new Set(input.generatedMemoryBlocks.flatMap((block) => block.sourceThreadIds))
      ],
      canonicalMemoryUsed: input.memoryBlocks.length > 0,
      repeatSteeringCount: input.repeatSteeringCount,
      firstSubstantiveAction: input.firstSubstantiveAction ?? null
    } satisfies Record<string, unknown>;
  }

  deriveFirstSubstantiveAction(activity: RunActivityInfo | null | undefined) {
    if (!activity) {
      return null;
    }

    if (activity.command?.trim()) {
      const command = activity.command.trim();
      const cwd = activity.cwd?.trim();
      return cwd ? `${command} (cwd: ${cwd})` : command;
    }

    if (activity.path?.trim()) {
      return activity.path.trim();
    }

    return activity.summary?.trim() || activity.toolName?.trim() || null;
  }
}
