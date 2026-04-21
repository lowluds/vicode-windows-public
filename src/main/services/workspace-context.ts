import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderId, SkillKind } from '../../shared/domain';
import { providerCapabilities, providerDisplayName } from '../../shared/providers';
import type { GeneratedMemoryContextBlock } from './generated-memory-retrieval';
import type { WorkspaceMemoryContextBlock } from './memory';
import type { ResolvedSkillContext } from './skill-context';

export type WorkspaceContextBlockKind = 'agents' | 'soul' | 'user' | 'provider_compat';
export type WorkspaceSkillContextBlockKind = 'prompt_skill' | 'runtime_skill';
export type WorkspaceContextProfile = 'main' | 'delegated';

export interface WorkspaceContextBlock {
  kind: WorkspaceContextBlockKind;
  label: string;
  fileName: string;
  path: string;
  content: string;
}

export interface WorkspaceSkillContextBlock {
  kind: WorkspaceSkillContextBlockKind;
  label: string;
  content: string;
}

export interface WorkspaceRuntimeSkillResource {
  kind: SkillKind;
  path: string;
}

export interface WorkspaceContextDiagnostics {
  durationMs: number;
  workspaceInstructionReadMs: number;
  skillResolutionMs: number;
  runtimeSkillResolutionMs: number;
  memoryRetrievalMs: number;
  generatedMemoryRetrievalMs: number;
  blockCount: number;
  memoryBlockCount: number;
  generatedMemoryBlockCount: number;
  skillBlockCount: number;
  runtimeSkillResourceCount: number;
}

export interface WorkspaceContextResult {
  folderPath: string | null;
  trusted: boolean;
  providerId: ProviderId;
  blocks: WorkspaceContextBlock[];
  memoryBlocks: WorkspaceMemoryContextBlock[];
  generatedMemoryBlocks: GeneratedMemoryContextBlock[];
  skillBlocks: WorkspaceSkillContextBlock[];
  runtimeSkillResources: WorkspaceRuntimeSkillResource[];
  selectedSkillIds: string[];
  mentionedSkillIds: string[];
  diagnostics: WorkspaceContextDiagnostics;
}

export interface WorkspaceContextInput {
  projectId?: string;
  providerId: ProviderId;
  folderPath: string | null;
  trusted: boolean;
  contextProfile?: WorkspaceContextProfile;
  query?: string;
  memoryQuery?: string;
  memoryMaxResults?: number;
  generatedMemoryQuery?: string;
  generatedMemoryMaxResults?: number;
  explicitSkillIds?: string[];
  includeWorkspaceInstructions?: boolean;
  includeMemory?: boolean;
  includeGeneratedMemory?: boolean;
  includeRuntimeSkills?: boolean;
}

export interface WorkspaceMemoryRetriever {
  retrieveRelevantMemory(input: {
    projectId: string;
    folderPath: string | null;
    trusted: boolean;
    query: string;
    maxResults?: number;
  }): WorkspaceMemoryContextBlock[];
}

export interface WorkspaceSkillResolver {
  resolve(input: {
    projectId: string;
    providerId: ProviderId;
    prompt: string;
    explicitSkillIds: string[];
  }): ResolvedSkillContext;
  formatPromptSkillSection(skills: ResolvedSkillContext['promptSkills']): string;
  formatRuntimeSkillSection(providerId: ProviderId, skills: ResolvedSkillContext['runtimeSkills']): string;
  resolveRuntimeSkillResources(
    skills: ResolvedSkillContext['runtimeSkills'],
    providerId: ProviderId
  ): WorkspaceRuntimeSkillResource[];
}

export interface GeneratedMemoryRetriever {
  retrieveRelevantMemory(input: {
    projectId: string;
    folderPath: string | null;
    trusted: boolean;
    query: string;
    maxResults?: number;
  }): GeneratedMemoryContextBlock[];
}

interface WorkspaceContextCandidate {
  kind: WorkspaceContextBlockKind;
  label: string;
  fileName: string;
}

function shouldResolveSkills(query: string | undefined, explicitSkillIds: string[] | undefined) {
  if ((explicitSkillIds?.length ?? 0) > 0) {
    return true;
  }

  return typeof query === 'string' && query.includes('$');
}

export class WorkspaceContextService {
  constructor(
    private readonly options: {
      memoryRetriever?: WorkspaceMemoryRetriever;
      generatedMemoryRetriever?: GeneratedMemoryRetriever;
      skillResolver?: WorkspaceSkillResolver;
    } = {}
  ) {}

  assemble(input: WorkspaceContextInput): WorkspaceContextResult {
    const startedAt = Date.now();
    let workspaceInstructionReadMs = 0;
    let skillResolutionMs = 0;
    let runtimeSkillResolutionMs = 0;
    let memoryRetrievalMs = 0;
    let generatedMemoryRetrievalMs = 0;
    let memoryBlocks: WorkspaceMemoryContextBlock[] = [];
    let generatedMemoryBlocks: GeneratedMemoryContextBlock[] = [];
    const blocks =
      input.includeWorkspaceInstructions !== false && input.trusted && input.folderPath
        ? (() => {
            const sectionStartedAt = Date.now();
            const resolvedBlocks = this.getCandidates(input.providerId, input.contextProfile ?? 'main')
              .map((candidate) => {
                const path = join(input.folderPath as string, candidate.fileName);
                if (!existsSync(path)) {
                  return null;
                }

                const content = readFileSync(path, 'utf8').trim();
                if (!content) {
                  return null;
                }

                return {
                  kind: candidate.kind,
                  label: candidate.label,
                  fileName: candidate.fileName,
                  path,
                  content
                } satisfies WorkspaceContextBlock;
              })
              .filter((value): value is WorkspaceContextBlock => Boolean(value));
            workspaceInstructionReadMs = Date.now() - sectionStartedAt;
            return resolvedBlocks;
          })()
        : [];
    const resolvedSkills =
      this.options.skillResolver && input.projectId && shouldResolveSkills(input.query, input.explicitSkillIds)
        ? (() => {
            const sectionStartedAt = Date.now();
            const result = this.options.skillResolver?.resolve({
              projectId: input.projectId,
              providerId: input.providerId,
              prompt: input.query ?? '',
              explicitSkillIds: input.explicitSkillIds ?? []
            }) ?? null;
            skillResolutionMs = Date.now() - sectionStartedAt;
            return result;
          })()
        : null;
    const runtimeSkillResources =
      input.includeRuntimeSkills && resolvedSkills?.runtimeSkills && this.options.skillResolver
        ? (() => {
            const sectionStartedAt = Date.now();
            const result = this.options.skillResolver?.resolveRuntimeSkillResources(
              resolvedSkills.runtimeSkills,
              input.providerId
            ) ?? [];
            runtimeSkillResolutionMs = Date.now() - sectionStartedAt;
            return result;
          })()
        : [];
    const skillBlocks: WorkspaceSkillContextBlock[] = [];

    if (resolvedSkills?.promptSkills.length) {
      skillBlocks.push({
        kind: 'prompt_skill',
        label: 'Attached skills',
        content: this.options.skillResolver?.formatPromptSkillSection(resolvedSkills.promptSkills) ?? ''
      });
    }

    if (input.includeRuntimeSkills && resolvedSkills?.runtimeSkills.length && runtimeSkillResources.length > 0) {
      skillBlocks.push({
        kind: 'runtime_skill',
        label: `${providerDisplayName(input.providerId)} provider-native helpers requested`,
        content: this.options.skillResolver?.formatRuntimeSkillSection(input.providerId, resolvedSkills.runtimeSkills) ?? ''
      });
    }

    if (input.includeMemory !== false && this.options.memoryRetriever && input.projectId && input.query) {
      const sectionStartedAt = Date.now();
      memoryBlocks = this.options.memoryRetriever.retrieveRelevantMemory({
        projectId: input.projectId,
        folderPath: input.folderPath,
        trusted: input.trusted,
        query: input.memoryQuery ?? input.query ?? '',
        maxResults: input.memoryMaxResults
      });
      memoryRetrievalMs = Date.now() - sectionStartedAt;
    }

    if (
      input.includeGeneratedMemory &&
      this.options.generatedMemoryRetriever &&
      input.projectId &&
      input.query
    ) {
      const sectionStartedAt = Date.now();
      generatedMemoryBlocks = this.options.generatedMemoryRetriever.retrieveRelevantMemory({
        projectId: input.projectId,
        folderPath: input.folderPath,
        trusted: input.trusted,
        query: input.generatedMemoryQuery ?? input.memoryQuery ?? input.query ?? '',
        maxResults: input.generatedMemoryMaxResults
      });
      generatedMemoryRetrievalMs = Date.now() - sectionStartedAt;
    }

    return {
      folderPath: input.folderPath,
      trusted: input.trusted,
      providerId: input.providerId,
      blocks,
      memoryBlocks,
      generatedMemoryBlocks,
      skillBlocks,
      runtimeSkillResources,
      selectedSkillIds: resolvedSkills?.selectedSkillIds ?? [...new Set(input.explicitSkillIds ?? [])],
      mentionedSkillIds: resolvedSkills?.mentionedSkillIds ?? [],
      diagnostics: {
        durationMs: Date.now() - startedAt,
        workspaceInstructionReadMs,
        skillResolutionMs,
        runtimeSkillResolutionMs,
        memoryRetrievalMs,
        generatedMemoryRetrievalMs,
        blockCount: blocks.length,
        memoryBlockCount: memoryBlocks.length,
        generatedMemoryBlockCount: generatedMemoryBlocks.length,
        skillBlockCount: skillBlocks.length,
        runtimeSkillResourceCount: runtimeSkillResources.length
      }
    };
  }

  private getCandidates(providerId: ProviderId, profile: WorkspaceContextProfile): WorkspaceContextCandidate[] {
    if (profile === 'delegated') {
      return [
        {
          kind: 'agents',
          label: 'Workspace AGENTS.md',
          fileName: 'AGENTS.md'
        },
        {
          kind: 'provider_compat' as const,
          label: `Workspace ${providerCapabilities(providerId).workspaceInstructionFileName}`,
          fileName: providerCapabilities(providerId).workspaceInstructionFileName
        }
      ];
    }

    return [
      {
        kind: 'agents',
        label: 'Workspace AGENTS.md',
        fileName: 'AGENTS.md'
      },
      {
        kind: 'soul',
        label: 'Workspace SOUL.md',
        fileName: 'SOUL.md'
      },
      {
        kind: 'user',
        label: 'Workspace USER.md',
        fileName: 'USER.md'
      },
      {
        kind: 'provider_compat' as const,
        label: `Workspace ${providerCapabilities(providerId).workspaceInstructionFileName}`,
        fileName: providerCapabilities(providerId).workspaceInstructionFileName
      }
    ];
  }
}
