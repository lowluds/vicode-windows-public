import type { ComposerSubmitInput, ThreadDetail } from '../../shared/domain';
import type { ResolvedConversationTaskPacket } from '../../shared/conversation-task-resolver';
import type { HarnessTaskContract } from '../../shared/harness-task-contract';
import type { VerificationPlan } from '../../shared/harness-verification';
import { providerCapabilities } from '../../shared/providers';

export interface ProviderExecutionWorkspaceContext {
  blocks: string[];
  memoryBlocks: Array<{ itemId?: string; fileName?: string }>;
  generatedMemoryBlocks?: Array<{ itemId: string; evidenceCount?: number }>;
  projectKnowledgeBlocks?: Array<{
    title: string;
    relativePath: string;
    heading: string | null;
    path: string;
    retrievalReason: { reason: string };
  }>;
  projectKnowledgeRouter?: { reason: string } | null;
  skillBlocks: string[];
  runtimeSkillResources: unknown[];
  selectedSkillIds: string[];
  autoSelectedSkillIds?: string[];
  mentionedSkillIds?: string[];
  diagnostics: Record<string, unknown>;
}

export interface ProviderExecutionContextHost {
  assembleWorkspaceContext(
    input: ComposerSubmitInput,
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
  ): ProviderExecutionWorkspaceContext;
  createGeneratedMemoryTraceDetail(input: {
    folderPath: string | null;
    trusted: boolean;
    generatedMemoryEnabled: boolean;
    generatedMemoryGenerationEnabled: boolean;
    memoryBlocks: Array<{ itemId?: string; fileName?: string }>;
    generatedMemoryBlocks: Array<{ itemId: string; evidenceCount?: number }>;
    repeatSteeringCount: number;
  }): Record<string, unknown>;
  countQueuedSteerFollowUps(thread: ThreadDetail): number;
}

export interface ProviderExecutionContextPreferences {
  generatedMemoryUseEnabled: boolean;
  generatedMemoryGenerationEnabled: boolean;
}

export interface ProviderExecutionContextOptions {
  contextProfile?: 'main' | 'delegated';
  includeMemory?: boolean;
  includeGeneratedMemory?: boolean;
}

export interface ProviderExecutionContextResult {
  generatedMemoryBlocks: Array<{ itemId: string; evidenceCount?: number }>;
  generatedMemoryTraceDetail: Record<string, unknown>;
  workspaceContext: ProviderExecutionWorkspaceContext;
}

export function createWorkspaceContextResolvedTaskPacket(
  resolvedTaskPacket: ResolvedConversationTaskPacket | null
) {
  return resolvedTaskPacket
    ? {
        objective: resolvedTaskPacket.objective,
        expectedToolGroups: resolvedTaskPacket.expectedToolGroups
      }
    : null;
}

export function assembleProviderExecutionContext(input: {
  composerInput: ComposerSubmitInput;
  thread: ThreadDetail;
  runtimeWorkspaceRoot: string | null;
  trusted: boolean;
  executionContext: ProviderExecutionContextOptions;
  preferences: ProviderExecutionContextPreferences;
  resolvedTaskPacket: ResolvedConversationTaskPacket | null;
  host: ProviderExecutionContextHost;
}): ProviderExecutionContextResult {
  const includeGeneratedMemory =
    input.executionContext.includeGeneratedMemory ?? input.preferences.generatedMemoryUseEnabled;
  const workspaceContext = input.host.assembleWorkspaceContext(
    input.composerInput,
    input.thread,
    input.runtimeWorkspaceRoot,
    input.trusted,
    {
      includeRuntimeSkills: providerCapabilities(input.composerInput.providerId).supportsRuntimeSkillResources,
      contextProfile: input.executionContext.contextProfile ?? 'main',
      includeMemory: input.executionContext.includeMemory ?? true,
      includeGeneratedMemory,
      resolvedTaskPacket: createWorkspaceContextResolvedTaskPacket(input.resolvedTaskPacket)
    }
  );
  const generatedMemoryBlocks = workspaceContext.generatedMemoryBlocks ?? [];
  const generatedMemoryTraceDetail = input.host.createGeneratedMemoryTraceDetail({
    folderPath: input.runtimeWorkspaceRoot,
    trusted: input.trusted,
    generatedMemoryEnabled: includeGeneratedMemory,
    generatedMemoryGenerationEnabled: input.preferences.generatedMemoryGenerationEnabled,
    memoryBlocks: workspaceContext.memoryBlocks,
    generatedMemoryBlocks,
    repeatSteeringCount: input.host.countQueuedSteerFollowUps(input.thread)
  });

  return {
    generatedMemoryBlocks,
    generatedMemoryTraceDetail,
    workspaceContext
  };
}

export function buildProviderExecutionWorkspaceContextTraceDetail(input: {
  workspaceContext: ProviderExecutionWorkspaceContext;
  generatedMemoryTraceDetail: Record<string, unknown>;
  harnessTaskContract: HarnessTaskContract;
  verificationPlan: VerificationPlan;
  resolvedTaskPacket: ResolvedConversationTaskPacket | null;
}) {
  return {
    ...input.workspaceContext.diagnostics,
    ...input.generatedMemoryTraceDetail,
    harnessTaskContract: input.harnessTaskContract,
    verificationPlan: input.verificationPlan,
    ...(input.resolvedTaskPacket
      ? {
          resolvedTaskPacket: {
            trigger: input.resolvedTaskPacket.trigger,
            phase: input.resolvedTaskPacket.phase,
            objective: input.resolvedTaskPacket.objective,
            sliceCount: input.resolvedTaskPacket.slices.length,
            sourceTurnCount: input.resolvedTaskPacket.sourceTurnIds.length
          }
        }
      : {})
  };
}
