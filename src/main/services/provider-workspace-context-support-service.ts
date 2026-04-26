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
    }
  ) {
    const personalization = this.db.getPersonalization();
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
      explicitSkillIds: input.skillIds,
      includeWorkspaceInstructions: personalization.useWorkspaceInstructions,
      includeMemory: options.includeMemory ?? true,
      includeGeneratedMemory:
        options.includeGeneratedMemory ?? preferences.generatedMemoryUseEnabled,
      includeRuntimeSkills: options.includeRuntimeSkills
    });
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
