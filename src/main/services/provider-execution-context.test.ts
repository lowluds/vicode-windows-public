import { describe, expect, it, vi } from 'vitest';
import type { ComposerSubmitInput, ThreadDetail } from '../../shared/domain';
import type { ResolvedConversationTaskPacket } from '../../shared/conversation-task-resolver';
import type { HarnessTaskContract } from '../../shared/harness-task-contract';
import type { VerificationPlan } from '../../shared/harness-verification';
import {
  assembleProviderExecutionContext,
  buildProviderExecutionWorkspaceContextTraceDetail,
  createWorkspaceContextResolvedTaskPacket,
  type ProviderExecutionContextHost,
  type ProviderExecutionWorkspaceContext
} from './provider-execution-context';

function createComposerInput(overrides: Partial<ComposerSubmitInput> = {}): ComposerSubmitInput {
  return {
    projectId: 'project-1',
    prompt: 'Update the helper.',
    providerId: 'openai',
    modelId: 'gpt-5',
    executionPermission: 'default',
    skillIds: [],
    ...overrides
  };
}

function createThreadDetail(): ThreadDetail {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Thread',
    providerId: 'openai',
    modelId: 'gpt-5',
    executionPermission: 'default',
    status: 'completed',
    archived: false,
    createdAt: '2026-03-14T00:00:00.000Z',
    updatedAt: '2026-03-14T00:00:00.000Z',
    lastMessageAt: '2026-03-14T00:00:00.000Z',
    lastPreview: '',
    turns: [],
    rawOutput: [],
    planner: {
      threadId: 'thread-1',
      composerMode: 'default',
      turnState: 'idle',
      activePlan: null,
      pendingQuestionSet: null,
      updatedAt: '2026-03-14T00:00:00.000Z'
    },
    followUps: []
  };
}

function createWorkspaceContext(
  overrides: Partial<ProviderExecutionWorkspaceContext> = {}
): ProviderExecutionWorkspaceContext {
  return {
    blocks: [],
    memoryBlocks: [{ itemId: 'memory-1', fileName: 'MEMORY.md' }],
    generatedMemoryBlocks: [{ itemId: 'generated-1', evidenceCount: 2 }],
    projectKnowledgeBlocks: [],
    projectKnowledgeRouter: null,
    skillBlocks: [],
    runtimeSkillResources: [],
    selectedSkillIds: [],
    autoSelectedSkillIds: [],
    mentionedSkillIds: [],
    diagnostics: {
      durationMs: 12,
      memoryBlockCount: 1,
      generatedMemoryBlockCount: 1
    },
    ...overrides
  };
}

function createResolvedTaskPacket(
  overrides: Partial<ResolvedConversationTaskPacket> = {}
): ResolvedConversationTaskPacket {
  return {
    trigger: 'inferred_proceed',
    phase: 'ready_to_task',
    executionPolicy: 'auto_execute',
    confidence: 'high',
    objective: 'Implement a small helper.',
    sourceTurnIds: ['turn-1', 'turn-2'],
    decisionsUsed: [],
    decisions: [],
    rejectedOptions: [],
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: [],
    expectedToolGroups: ['workspace_read', 'workspace_write'],
    slices: [
      {
        id: 'inspect',
        title: 'Inspect',
        status: 'pending',
        detail: null,
        rationale: 'Understand current code.',
        expectedOutcome: 'Context is ready.',
        sourceTurnIds: ['turn-1']
      }
    ],
    verification: [],
    ...overrides
  };
}

function createHost(workspaceContext = createWorkspaceContext()): ProviderExecutionContextHost {
  return {
    assembleWorkspaceContext: vi.fn(() => workspaceContext),
    createGeneratedMemoryTraceDetail: vi.fn(() => ({
      generatedMemoryUsed: true,
      generatedMemoryItemIds: ['generated-1'],
      repeatSteeringCount: 2
    })),
    countQueuedSteerFollowUps: vi.fn(() => 2)
  };
}

describe('provider execution context helpers', () => {
  it('passes focused workspace context options and generated-memory trace inputs through the host', () => {
    const thread = createThreadDetail();
    const resolvedTaskPacket = createResolvedTaskPacket();
    const host = createHost();

    const result = assembleProviderExecutionContext({
      composerInput: createComposerInput(),
      thread,
      runtimeWorkspaceRoot: 'C:/worktree',
      trusted: true,
      executionContext: {
        contextProfile: 'delegated',
        includeMemory: false
      },
      preferences: {
        generatedMemoryUseEnabled: false,
        generatedMemoryGenerationEnabled: true
      },
      resolvedTaskPacket,
      host
    });

    expect(host.assembleWorkspaceContext).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai',
        prompt: 'Update the helper.'
      }),
      thread,
      'C:/worktree',
      true,
      {
        includeRuntimeSkills: true,
        contextProfile: 'delegated',
        includeMemory: false,
        includeGeneratedMemory: false,
        resolvedTaskPacket: {
          objective: 'Implement a small helper.',
          expectedToolGroups: ['workspace_read', 'workspace_write']
        }
      }
    );
    expect(host.createGeneratedMemoryTraceDetail).toHaveBeenCalledWith({
      folderPath: 'C:/worktree',
      trusted: true,
      generatedMemoryEnabled: false,
      generatedMemoryGenerationEnabled: true,
      memoryBlocks: [{ itemId: 'memory-1', fileName: 'MEMORY.md' }],
      generatedMemoryBlocks: [{ itemId: 'generated-1', evidenceCount: 2 }],
      repeatSteeringCount: 2
    });
    expect(result.generatedMemoryBlocks).toEqual([{ itemId: 'generated-1', evidenceCount: 2 }]);
    expect(result.generatedMemoryTraceDetail).toMatchObject({
      generatedMemoryUsed: true,
      repeatSteeringCount: 2
    });
  });

  it('defaults generated-memory blocks and preference-controlled generated-memory usage', () => {
    const workspaceContext = createWorkspaceContext({
      generatedMemoryBlocks: undefined
    });
    const host = createHost(workspaceContext);

    const result = assembleProviderExecutionContext({
      composerInput: createComposerInput({ providerId: 'ollama' }),
      thread: createThreadDetail(),
      runtimeWorkspaceRoot: null,
      trusted: false,
      executionContext: {},
      preferences: {
        generatedMemoryUseEnabled: true,
        generatedMemoryGenerationEnabled: false
      },
      resolvedTaskPacket: null,
      host
    });

    expect(host.assembleWorkspaceContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      null,
      false,
      expect.objectContaining({
        includeRuntimeSkills: true,
        contextProfile: 'main',
        includeMemory: true,
        includeGeneratedMemory: true,
        resolvedTaskPacket: null
      })
    );
    expect(host.createGeneratedMemoryTraceDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        folderPath: null,
        trusted: false,
        generatedMemoryEnabled: true,
        generatedMemoryGenerationEnabled: false,
        generatedMemoryBlocks: []
      })
    );
    expect(result.generatedMemoryBlocks).toEqual([]);
  });

  it('reduces resolved task packets to workspace context routing input', () => {
    expect(createWorkspaceContextResolvedTaskPacket(createResolvedTaskPacket())).toEqual({
      objective: 'Implement a small helper.',
      expectedToolGroups: ['workspace_read', 'workspace_write']
    });
    expect(createWorkspaceContextResolvedTaskPacket(null)).toBeNull();
  });

  it('builds completed workspace-context trace details without leaking full resolved task packets', () => {
    const resolvedTaskPacket = createResolvedTaskPacket({
      slices: [
        {
          id: 'inspect',
          title: 'Inspect',
          status: 'pending',
          detail: null,
          rationale: 'Understand current code.',
          expectedOutcome: 'Context is ready.',
          sourceTurnIds: ['turn-1']
        },
        {
          id: 'edit',
          title: 'Edit',
          status: 'pending',
          detail: null,
          rationale: 'Make the change.',
          expectedOutcome: 'Change is ready.',
          sourceTurnIds: ['turn-2']
        }
      ]
    });
    const harnessTaskContract = {
      taskKind: 'edit',
      workspaceRoot: 'C:/worktree'
    } as HarnessTaskContract;
    const verificationPlan = {
      command: 'npm test',
      cwd: 'C:/worktree'
    } as VerificationPlan;

    expect(
      buildProviderExecutionWorkspaceContextTraceDetail({
        workspaceContext: createWorkspaceContext(),
        generatedMemoryTraceDetail: {
          generatedMemoryUsed: true
        },
        harnessTaskContract,
        verificationPlan,
        resolvedTaskPacket
      })
    ).toEqual({
      durationMs: 12,
      memoryBlockCount: 1,
      generatedMemoryBlockCount: 1,
      generatedMemoryUsed: true,
      harnessTaskContract,
      verificationPlan,
      resolvedTaskPacket: {
        trigger: 'inferred_proceed',
        phase: 'ready_to_task',
        objective: 'Implement a small helper.',
        sliceCount: 2,
        sourceTurnCount: 2
      }
    });
  });
});
