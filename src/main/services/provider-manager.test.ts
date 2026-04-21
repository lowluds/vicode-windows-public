import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ProviderAdapter, ProviderRunCallbacks, ProviderRunHandle } from '../../providers/types';
import type {
  Project,
  ProviderAccount,
  ProviderDescriptor,
  ProviderId,
  ProviderModel,
  SkillDefinition,
  ThreadDetail,
  ThreadSummary
} from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import { ProviderManager } from './provider-manager';
import { AgentRuntimeService } from './agent-runtime';
import { getProviderFallbackModels } from '../../providers/catalog';
import type { WorkspaceContextResult } from './workspace-context';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}));

function createProviderModel(id: string, label = id): ProviderModel {
  return { id, label, description: '' };
}

function createThreadDetail(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'New thread',
    providerId: 'openai',
    modelId: 'gpt-5',
    executionPermission: 'default',
    status: 'draft',
    archived: false,
    lastMessageAt: '2026-03-14T00:00:00.000Z',
    createdAt: '2026-03-14T00:00:00.000Z',
    updatedAt: '2026-03-14T00:00:00.000Z',
    lastPreview: '',
    turns: [],
    rawOutput: [],
    followUps: [],
    planner: {
      threadId: 'thread-1',
      composerMode: 'default',
      turnState: 'idle',
      activePlanId: null,
      pendingQuestionCallId: null,
      updatedAt: '2026-03-14T00:00:00.000Z',
      activePlan: null,
      pendingQuestionSet: null
    },
    ...overrides
  };
}

function createProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    name: 'Project',
    folderPath: null,
    trusted: true,
      defaultProviderId: 'openai',
      defaultModelByProvider: {
        openai: 'gpt-5',
        gemini: 'gemini-2.5-pro',
        qwen: 'qwen3.5-plus',
        ollama: 'qwen3',
        kimi: 'kimi-k2-thinking'
      },
    createdAt: '2026-03-14T00:00:00.000Z',
    updatedAt: '2026-03-14T00:00:00.000Z',
    ...overrides
  };
}

function createAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  const providerId = (overrides.id ?? 'openai') as ProviderId;
  return {
    id: providerId,
    label: providerId === 'gemini' ? 'Gemini' : 'OpenAI',
    listStaticModels: () => getProviderFallbackModels(providerId),
    getPlannerCapability: () => ({
      supported: true,
      executionMode: 'read-only',
      enforcement: 'hard-enforced'
    }),
    discoverApiModels: async () => null,
    discoverRuntimeModels: async () => null,
    detectInstall: async () => ({ installed: true, cliPath: 'codex.cmd' }),
    getAuthState: async () => ({ authState: 'disconnected', authMode: null, message: 'Disconnected' }),
    startAuth: async () => {},
    clearAuth: async () => {},
    discoverNativeSkills: async () => [],
    validateProjectContext: () => ({ valid: true }),
    startRun: async () =>
      ({
        runId: 'run-1',
        cancel: async () => {}
      }) satisfies ProviderRunHandle,
    ...overrides
  };
}

function createDb(overrides: Record<string, unknown> = {}) {
  const thread = createThreadDetail();
  const followUps: Array<ThreadDetail['followUps'][number]> = [];
  let nextTurnId = 1;

  return {
    getProviderAccount: vi.fn(() => null),
    getPreferences: vi.fn(() => ({
      selectedProjectId: 'project-1',
      defaultProviderId: 'openai',
      defaultModelByProvider: { openai: 'gpt-5', gemini: 'gemini-2.5-pro', qwen: 'qwen3.5-plus', ollama: 'qwen3', kimi: 'kimi-k2-thinking' },
      defaultReasoningEffortByProvider: { openai: 'high', gemini: null, qwen: null, ollama: null, kimi: null },
      defaultThinkingByProvider: { openai: false, gemini: false, qwen: true, ollama: false, kimi: false },
      ollamaTransportMode: 'chat',
      defaultExecutionPermission: 'default',
      followUpBehavior: 'queue',
      generatedMemoryUseEnabled: false,
      generatedMemoryGenerationEnabled: true,
      appearanceMode: 'system',
      accentMode: 'system',
      accentColor: null,
      onboardingComplete: false,
      lastOpenedThreadId: null,
      microphoneAllowed: false
    })),
    saveProviderAccount: vi.fn((account: ProviderAccount) => account),
    getProviderModelCache: vi.fn(() => ({ models: [], updatedAt: null, source: null })),
    replaceProviderModels: vi.fn(),
    clearProviderModelCache: vi.fn(),
    getProject: vi.fn(() => createProject()),
    createThread: vi.fn(() => thread),
    getThread: vi.fn(() => thread),
    getThreadPlannerState: vi.fn(() => thread.planner),
    getThreadSummary: vi.fn(
      (): ThreadSummary => ({
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        providerId: thread.providerId,
        modelId: thread.modelId,
        executionPermission: thread.executionPermission,
        status: thread.status,
        archived: thread.archived,
        lastMessageAt: thread.lastMessageAt,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        lastPreview: thread.lastPreview
      })
    ),
    renameThread: vi.fn((threadId: string, title: string): ThreadSummary => {
      thread.id = threadId;
      thread.title = title;
      return {
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        providerId: thread.providerId,
        modelId: thread.modelId,
        executionPermission: thread.executionPermission,
        status: thread.status,
        archived: thread.archived,
        lastMessageAt: thread.lastMessageAt,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        lastPreview: thread.lastPreview
      };
    }),
    appendTurn: vi.fn((_threadId: string, role: 'user' | 'assistant' | 'tool' | 'status' | 'system', content: string, metadata?: Record<string, unknown> | null, runId?: string | null) => {
      const turn = {
        id: `turn-${nextTurnId++}`,
        threadId: thread.id,
        role,
        content,
        metadata: metadata ?? null,
        runId: runId ?? null,
        createdAt: '2026-03-14T00:00:00.000Z'
      };
      thread.turns.push(turn as never);
      return turn;
    }),
    createThreadFollowUp: vi.fn((input: {
      threadId: string;
      content: string;
      metadata?: Record<string, unknown> | null;
      kind: 'follow_up' | 'steer';
      priority?: number;
      targetRunId?: string | null;
    }) => {
      const followUp = {
        id: `followup-${followUps.length + 1}`,
        threadId: input.threadId,
        content: input.content,
        metadata: input.metadata ?? null,
        kind: input.kind,
        status: 'queued',
        priority: input.priority ?? 0,
        targetRunId: input.targetRunId ?? null,
        createdAt: '2026-03-14T00:00:00.000Z',
        updatedAt: '2026-03-14T00:00:00.000Z',
        dispatchedAt: null,
        cancelledAt: null
      };
      followUps.push(followUp as never);
      thread.followUps = [...followUps] as never;
      return followUp;
    }),
    updateThreadFollowUp: vi.fn((followUpId: string, content: string) => {
      const current = followUps.find((item) => item.id === followUpId);
      if (!current) {
        throw new Error(`Queued follow-up not found: ${followUpId}`);
      }
      current.content = content;
      current.updatedAt = '2026-03-14T00:00:01.000Z';
      thread.followUps = [...followUps] as never;
      return current;
    }),
    cancelThreadFollowUp: vi.fn((followUpId: string) => {
      const current = followUps.find((item) => item.id === followUpId);
      if (!current) {
        throw new Error(`Queued follow-up not found: ${followUpId}`);
      }
      current.status = 'cancelled';
      current.cancelledAt = '2026-03-14T00:00:01.000Z';
      current.updatedAt = '2026-03-14T00:00:01.000Z';
      thread.followUps = followUps.filter((item) => item.status === 'queued' || item.status === 'dispatching') as never;
      return current;
    }),
    getThreadFollowUp: vi.fn((followUpId: string) => {
      const current = followUps.find((item) => item.id === followUpId);
      if (!current) {
        throw new Error(`Queued follow-up not found: ${followUpId}`);
      }
      return current;
    }),
    listThreadFollowUps: vi.fn(() => followUps.filter((item) => item.status === 'queued' || item.status === 'dispatching')),
    updateThreadStatus: vi.fn((_threadId: string, status: ThreadDetail['status']) => {
      thread.status = status;
    }),
    syncThreadRunConfiguration: vi.fn((_threadId: string, input: { providerId: ProviderId; modelId: string; executionPermission: ThreadDetail['executionPermission'] }) => {
      thread.providerId = input.providerId;
      thread.modelId = input.modelId;
      thread.executionPermission = input.executionPermission;
      return thread;
    }),
    setThreadPlannerMode: vi.fn((_threadId: string, mode: ThreadDetail['planner']['composerMode']) => {
      thread.planner = { ...thread.planner, composerMode: mode };
      return thread.planner;
    }),
    clearPendingPlannerQuestions: vi.fn((_threadId: string) => {
      thread.planner = { ...thread.planner, pendingQuestionCallId: null, pendingQuestionSet: null };
      return thread.planner;
    }),
    setThreadPlannerTurnState: vi.fn((_threadId: string, turnState: ThreadDetail['planner']['turnState']) => {
      thread.planner = { ...thread.planner, turnState };
      return thread.planner;
    }),
    setThreadExecutionPermission: vi.fn((_threadId: string, executionPermission: ThreadDetail['executionPermission']) => {
      thread.executionPermission = executionPermission;
      return thread;
    }),
    addRunEvent: vi.fn((_threadId: string, runId: string, eventType: string, payload: Record<string, unknown>) => {
      const event = {
        id: `event-${thread.rawOutput.length + 1}`,
        threadId: thread.id,
        runId,
        eventType,
        payload,
        createdAt: '2026-03-14T00:00:00.000Z'
      };
      thread.rawOutput.push(event as never);
      return event;
    }),
    createPlannerQuestionSet: vi.fn((_threadId: string, promptTurnId: string, callId: string, questions: unknown) => {
      const questionSet = {
        id: 'question-set-1',
        threadId: thread.id,
        promptTurnId,
        callId,
        questions,
        answers: null,
        createdAt: '2026-03-14T00:00:00.000Z'
      };
      thread.planner = {
        ...thread.planner,
        pendingQuestionCallId: callId,
        pendingQuestionSet: questionSet as never
      };
      return questionSet;
    }),
    answerPlannerQuestionSet: vi.fn((_threadId: string, _callId: string, answers: unknown) => {
      if (thread.planner.pendingQuestionSet) {
        thread.planner.pendingQuestionSet = {
          ...thread.planner.pendingQuestionSet,
          answers: answers as never
        };
      }
      return thread.planner.pendingQuestionSet;
    }),
    getLatestPlannerQuestionSet: vi.fn(() => thread.planner.pendingQuestionSet),
    createPlannerPlan: vi.fn((_threadId: string, createdTurnId: string, proposedPlanMarkdown: string, structuredPlan: unknown) => {
      const plan = {
        id: 'plan-1',
        threadId: thread.id,
        createdTurnId,
        proposedPlanMarkdown,
        structuredPlan,
        status: 'draft',
        createdAt: '2026-03-14T00:00:00.000Z'
      };
      thread.planner = {
        ...thread.planner,
        activePlanId: plan.id,
        activePlan: plan as never,
        turnState: 'plan_ready'
      };
      return plan;
    }),
    clearThreadPlannerSession: vi.fn((_threadId: string) => {
      thread.planner = {
        ...thread.planner,
        composerMode: 'default',
        turnState: 'idle',
        activePlanId: null,
        activePlan: null,
        pendingQuestionCallId: null,
        pendingQuestionSet: null
      };
      return thread.planner;
    }),
    updateAssistantTurn: vi.fn((runId: string, _threadId: string, content: string) => {
      const existing = [...thread.turns].reverse().find((turn) => turn.runId === runId && turn.role === 'assistant');
      if (existing) {
        existing.content = content;
        return existing;
      }
      const turn = {
        id: `turn-${nextTurnId++}`,
        threadId: thread.id,
        role: 'assistant',
        content,
        metadata: null,
        runId,
        createdAt: '2026-03-14T00:00:00.000Z'
      };
      thread.turns.push(turn as never);
      return turn;
    }),
    removeEmptyAssistantTurn: vi.fn(),
    findThreadIdByRunId: vi.fn((runId: string) => {
      if (thread.rawOutput.some((event) => event.runId === runId) || thread.turns.some((turn) => turn.runId === runId)) {
        return thread.id;
      }
      return null;
    }),
    claimNextThreadFollowUp: vi.fn(() => {
      const current = followUps.find((item) => item.status === 'queued');
      if (!current) {
        return null;
      }
      current.status = 'dispatching';
      thread.followUps = followUps.filter((item) => item.status === 'queued' || item.status === 'dispatching') as never;
      return current;
    }),
    markThreadFollowUpDispatched: vi.fn((followUpId: string) => {
      const current = followUps.find((item) => item.id === followUpId);
      if (!current) {
        throw new Error(`Queued follow-up not found: ${followUpId}`);
      }
      current.status = 'dispatched';
      current.dispatchedAt = '2026-03-14T00:00:02.000Z';
      current.updatedAt = '2026-03-14T00:00:02.000Z';
      thread.followUps = followUps.filter((item) => item.status === 'queued' || item.status === 'dispatching') as never;
      return current;
    }),
    markThreadFollowUpQueued: vi.fn((followUpId: string) => {
      const current = followUps.find((item) => item.id === followUpId);
      if (!current) {
        throw new Error(`Queued follow-up not found: ${followUpId}`);
      }
      current.status = 'queued';
      current.updatedAt = '2026-03-14T00:00:02.000Z';
      thread.followUps = [...followUps] as never;
      return current;
    }),
    supersedeQueuedFollowUps: vi.fn((input: { threadId: string; kind?: 'follow_up' | 'steer'; targetRunId?: string | null; excludeId?: string | null }) => {
      let changes = 0;
      for (const item of followUps) {
        if (item.threadId !== input.threadId || item.status !== 'queued') {
          continue;
        }
        if (input.kind && item.kind !== input.kind) {
          continue;
        }
        if (input.targetRunId !== undefined && item.targetRunId !== input.targetRunId) {
          continue;
        }
        if (input.excludeId && item.id === input.excludeId) {
          continue;
        }
        item.status = 'superseded';
        changes += 1;
      }
      thread.followUps = followUps.filter((item) => item.status === 'queued' || item.status === 'dispatching') as never;
      return changes;
    }),
    listThreadIdsWithQueuedFollowUps: vi.fn(() => {
      const ids = new Set(followUps.filter((item) => item.status === 'queued').map((item) => item.threadId));
      return [...ids];
    }),
    getPersonalization: vi.fn(() => ({
      globalInstructions: '',
      providerInstructions: { openai: '', gemini: '', qwen: '' },
      useWorkspaceInstructions: true
    })),
    upsertWorkspaceMemoryFile: vi.fn(() => 'memory-file-1'),
    replaceWorkspaceMemoryChunks: vi.fn(),
    deleteWorkspaceMemoryFilesNotInPaths: vi.fn(),
    listWorkspaceMemoryChunks: vi.fn(() => []),
    listSkills: vi.fn(() => []),
    getSkillsByIds: vi.fn(() => []),
    ...overrides
  };
}

describe('ProviderManager', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    while (tempDirs.length > 0) {
      const current = tempDirs.pop();
      if (current) {
        rmSync(current, { recursive: true, force: true });
      }
    }
  });

  function createWorkspace(files: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-provider-manager-'));
    tempDirs.push(dir);

    for (const [fileName, content] of Object.entries(files)) {
      const filePath = join(dir, fileName);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, 'utf8');
    }

    return dir;
  }

  it('prefers OAuth/CLI auth over a stored API key and clears stale model cache when auth mode changes', async () => {
    const db = createDb({
      getProviderAccount: vi.fn(() => ({
        providerId: 'openai',
        authState: 'connected',
        authMode: 'api_key',
        encryptedApiKey: Buffer.from('secret', 'utf8').toString('base64'),
        updatedAt: '2026-03-14T00:00:00.000Z'
      }))
    });
    const adapter = createAdapter({
      getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with ChatGPT' })
    });
    const manager = new ProviderManager(db as never, { openai: adapter, gemini: createAdapter({ id: 'gemini', label: 'Gemini' }) });

    const provider = await manager.getProvider('openai');

    expect(provider.authMode).toBe('cli');
    expect(provider.modelSource).toBe('fallback');
    expect(db.clearProviderModelCache).toHaveBeenCalledWith('openai');
    expect(db.saveProviderAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai',
        authMode: 'cli',
        encryptedApiKey: Buffer.from('secret', 'utf8').toString('base64')
      })
    );
  });

  it('uses API discovery when API-key auth is active', async () => {
    const discovered = [createProviderModel('gpt-5.4', 'GPT-5.4')];
    const db = createDb({
      getProviderAccount: vi.fn(() => ({
        providerId: 'openai',
        authState: 'connected',
        authMode: 'api_key',
        encryptedApiKey: Buffer.from('secret', 'utf8').toString('base64'),
        updatedAt: '2026-03-14T00:00:00.000Z'
      }))
    });
    const adapter = createAdapter({
      getAuthState: async () => ({ authState: 'connected', authMode: 'api_key', message: 'Using API key fallback.' }),
      discoverApiModels: async () => discovered
    });
    const manager = new ProviderManager(db as never, { openai: adapter, gemini: createAdapter({ id: 'gemini', label: 'Gemini' }) });

    const provider = await manager.getProvider('openai', { forceRefresh: true });

    expect(provider.modelSource).toBe('api');
    expect(provider.canLiveDiscoverModels).toBe(true);
    expect(db.replaceProviderModels).toHaveBeenCalledWith('openai', discovered, 'api');
  });

  it('records runtime trace marks for canonical execution runs', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      callbacks.onInfo({
        activity: {
          kind: 'tool_call',
          toolName: 'read_file',
          phase: 'started',
          summary: 'Calling read_file'
        }
      });
      callbacks.onDelta('Done');
      callbacks.onComplete('Done');
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    const result = await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Inspect and answer.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    const runtimeTraceStages = (db.addRunEvent as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, , eventType, payload]) => eventType === 'info' && payload && typeof payload === 'object' && 'runtimeTrace' in payload)
      .map(([, , , payload]) => (payload as { runtimeTrace: { stage: string } }).runtimeTrace.stage);

    expect(runtimeTraceStages).toEqual(
      expect.arrayContaining([
        'submit_received',
        'workspace_context_started',
        'workspace_context_completed',
        'prompt_assembled',
        'provider_dispatch_started',
        'run_started',
        'first_tool_call',
        'first_delta',
        'completed'
      ])
    );
  });

  it('records generated-memory trace detail when derived recall is enabled', async () => {
    const workspace = createWorkspace({});
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      callbacks.onInfo({
        activity: {
          kind: 'tool_call',
          toolName: 'read_file',
          phase: 'started',
          summary: 'Calling read_file'
        }
      });
      callbacks.onComplete('Done');
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const workspaceContext = {
      assemble: vi.fn(() => ({
        folderPath: workspace,
        trusted: true,
        providerId: 'openai',
        blocks: [],
        memoryBlocks: [],
        generatedMemoryBlocks: [
          {
            itemId: 'generated-1',
            kind: 'known_pitfall',
            label: 'Generated Workspace Recall (Derived, Non-Canonical)',
            summary: 'Use npm run smoke from the workspace root.',
            detail: 'Trusted recent threads converged on the workspace-root smoke command.',
            authority: 'derived_noncanonical',
            sourceThreadIds: ['thread-memory-1'],
            evidenceCount: 2,
            score: 3,
            retrievalReason: {
              kindGate: ['workflow_intent'],
              matchedTerms: ['inspect'],
              rank: 1
            }
          }
        ],
        skillBlocks: [],
        runtimeSkillResources: [],
        selectedSkillIds: [],
        mentionedSkillIds: [],
        diagnostics: {
          durationMs: 0,
          workspaceInstructionReadMs: 0,
          skillResolutionMs: 0,
          runtimeSkillResolutionMs: 0,
          memoryRetrievalMs: 0,
          generatedMemoryRetrievalMs: 0,
          blockCount: 0,
          memoryBlockCount: 0,
          generatedMemoryBlockCount: 1,
          skillBlockCount: 0,
          runtimeSkillResourceCount: 0
        }
      }))
    };
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      ),
      getPreferences: vi.fn(() => ({
        selectedProjectId: 'project-1',
        defaultProviderId: 'openai',
        defaultModelByProvider: { openai: 'gpt-5', gemini: 'gemini-2.5-pro', qwen: 'qwen3.5-plus', ollama: 'qwen3', kimi: 'kimi-k2-thinking' },
        defaultReasoningEffortByProvider: { openai: 'high', gemini: null, qwen: null, ollama: null, kimi: null },
        defaultThinkingByProvider: { openai: false, gemini: false, qwen: true, ollama: false, kimi: false },
        ollamaTransportMode: 'chat',
        defaultExecutionPermission: 'default',
        followUpBehavior: 'queue',
        generatedMemoryUseEnabled: true,
        generatedMemoryGenerationEnabled: true,
        appearanceMode: 'system',
        accentMode: 'system',
        accentColor: null,
        onboardingComplete: false,
        lastOpenedThreadId: null,
        microphoneAllowed: false
      }))
    });
    const manager = new ProviderManager(
      db as never,
      {
        openai: createAdapter({ startRun }),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      },
      workspaceContext as never
    );

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Inspect and answer.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    const runtimeTraceDetails = (db.addRunEvent as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, , eventType, payload]) => eventType === 'info' && payload && typeof payload === 'object' && 'runtimeTrace' in payload)
      .map(([, , , payload]) => (payload as { runtimeTrace: { stage: string; detail?: Record<string, unknown> | null } }).runtimeTrace);
    const promptAssembled = runtimeTraceDetails.find((trace) => trace.stage === 'prompt_assembled');
    const firstToolCall = runtimeTraceDetails.find((trace) => trace.stage === 'first_tool_call');

    expect(promptAssembled?.detail).toEqual(
      expect.objectContaining({
        workspaceScopeKey: expect.any(String),
        generatedMemoryEnabled: true,
        generatedMemoryGenerationEnabled: true,
        generatedMemoryUsed: true,
        generatedMemoryItemIds: ['generated-1'],
        generatedMemoryItems: [
          {
            itemId: 'generated-1',
            kind: 'known_pitfall',
            summary: 'Use npm run smoke from the workspace root.',
            score: 3,
            rank: 1,
            kindGate: ['workflow_intent'],
            matchedTerms: ['inspect'],
            sourceThreadIds: ['thread-memory-1']
          }
        ],
        generatedMemorySourceThreadIds: ['thread-memory-1'],
        canonicalMemoryUsed: false,
        repeatSteeringCount: 0,
        firstSubstantiveAction: null
      })
    );
    expect(firstToolCall?.detail).toEqual(
      expect.objectContaining({
        firstSubstantiveAction: 'Calling read_file',
        generatedMemoryUsed: true
      })
    );
  });

  it('normalizes assistant deltas before persisting and completing execution runs', async () => {
    const events: AppEvent[] = [];
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      callbacks.onDelta('Yes,');
      callbacks.onDelta('“the 21st night of September”');
      callbacks.onDelta('is a poetic line.');
      callbacks.onComplete('Yes,“the 21st night of September”is a poetic line.');
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });
    manager.onEvent((event) => events.push(event));

    const result = await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Inspect and answer.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    const persistedDeltas = (db.addRunEvent as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, , eventType]) => eventType === 'delta')
      .map(([, , , payload]) => (payload as { delta: string }).delta);
    expect(persistedDeltas).toEqual([
      'Yes,',
      ' “the 21st night of September”',
      ' is a poetic line.'
    ]);

    const runDeltas = events
      .filter((event): event is Extract<AppEvent, { type: 'run.delta' }> => event.type === 'run.delta')
      .map((event) => event.delta);
    expect(runDeltas).toEqual(persistedDeltas);

    expect(db.updateAssistantTurn).toHaveBeenLastCalledWith(
      result.runId,
      'thread-1',
      'Yes, “the 21st night of September” is a poetic line.',
      null
    );
    expect(db.getThread().turns.find((turn) => turn.runId === result.runId && turn.role === 'assistant')?.content).toBe(
      'Yes, “the 21st night of September” is a poetic line.'
    );
  });

  it('reconciles raw assistant snapshots in the provider-manager seam before persisting execution runs', async () => {
    const events: AppEvent[] = [];
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      callbacks.onAssistantSnapshot?.('Yes,');
      callbacks.onAssistantSnapshot?.('Yes,“the 21st night of September”');
      callbacks.onComplete('Yes,“the 21st night of September”');
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ id: 'openai', label: 'OpenAI', startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    } as never);
    manager.onEvent((event) => events.push(event));

    const result = await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Respond with the lyric line.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const persistedDeltas = (db.addRunEvent as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, , eventType]) => eventType === 'delta')
      .map(([, , , payload]) => (payload as { delta: string }).delta);
    expect(persistedDeltas).toEqual([
      'Yes,',
      ' “the 21st night of September”'
    ]);

    const runDeltas = events
      .filter((event): event is Extract<AppEvent, { type: 'run.delta' }> => event.type === 'run.delta')
      .map((event) => event.delta);
    expect(runDeltas).toEqual(persistedDeltas);

    expect(db.updateAssistantTurn).toHaveBeenLastCalledWith(
      result.runId,
      'thread-1',
      'Yes, “the 21st night of September”',
      null
    );
  });

  it('reconstructs readable spacing from raw adjacent Gemini deltas before persisting execution runs', async () => {
    const events: AppEvent[] = [];
    const db = createDb();
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      callbacks.onDelta("Hey!I'm doing");
      callbacks.onDelta('well,thanks');
      callbacks.onDelta('for asking.How are');
      callbacks.onDelta('you?');
      callbacks.onComplete("Hey!I'm doingwell,thanksfor asking.How areyou?");
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ id: 'openai', label: 'OpenAI' }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini', startRun })
    } as never);
    manager.onEvent((event) => events.push(event));

    const result = await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Say hello.',
      providerId: 'gemini',
      modelId: 'gemini-3-flash-preview',
      executionPermission: 'default',
      skillIds: []
    });

    const persistedDeltas = (db.addRunEvent as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, , eventType]) => eventType === 'delta')
      .map(([, , , payload]) => (payload as { delta: string }).delta);
    expect(persistedDeltas).toEqual([
      "Hey! I'm doing",
      ' well, thanks',
      ' for asking. How are',
      ' you?'
    ]);

    const runDeltas = events
      .filter((event): event is Extract<AppEvent, { type: 'run.delta' }> => event.type === 'run.delta')
      .map((event) => event.delta);
    expect(runDeltas).toEqual(persistedDeltas);

    expect(db.updateAssistantTurn).toHaveBeenLastCalledWith(
      result.runId,
      'thread-1',
      "Hey! I'm doing well, thanks for asking. How are you?",
      null
    );
  });

  it('formats dense Ollama completion wrap-ups into a cleaner persisted summary', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      callbacks.onDelta(
        'Sure! Here are some fun facts about Mars:- 🌍 **The Red Planet:** Mars looks red due to iron oxide. - 🌙 **Moons:** Mars has Phobos and Deimos. - 🏔️ **Olympus Mons:** It is the tallest volcano in the solar system. Let me know if you want more.'
      );
      callbacks.onComplete(
        'Sure! Here are some fun facts about Mars:- 🌍 **The Red Planet:** Mars looks red due to iron oxide. - 🌙 **Moons:** Mars has Phobos and Deimos. - 🏔️ **Olympus Mons:** It is the tallest volcano in the solar system. Let me know if you want more.'
      );
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      ollama: createAdapter({ id: 'ollama', label: 'Ollama', startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    } as never);

    const result = await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'can you tell me fun facts about mars',
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      executionPermission: 'default',
      skillIds: []
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(db.updateAssistantTurn).toHaveBeenLastCalledWith(
      result.runId,
      'thread-1',
      'Sure! Here are some fun facts about Mars:\n\n- 🌍 **The Red Planet:** Mars looks red due to iron oxide.\n\n- 🌙 **Moons:** Mars has Phobos and Deimos.\n\n- 🏔️ **Olympus Mons:** It is the tallest volcano in the solar system.\n\nLet me know if you want more.',
      null
    );
    expect(db.getThread().turns.find((turn) => turn.runId === result.runId && turn.role === 'assistant')?.content).toBe(
      'Sure! Here are some fun facts about Mars:\n\n- 🌍 **The Red Planet:** Mars looks red due to iron oxide.\n\n- 🌙 **Moons:** Mars has Phobos and Deimos.\n\n- 🏔️ **Olympus Mons:** It is the tallest volcano in the solar system.\n\nLet me know if you want more.'
    );
  });

  it('runs a second-pass Ollama wrap-up rewrite for dense final answers', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      callbacks.onDelta(
        '- **Founded:** 2000 by Victor Goossens and Joy Hoogeveen. Official website launched in 2001 and moved to teamliquid.net in 2002. Expanded into multi-game esports in 2012, merged with Team Curse in 2015, sold controlling interest to Axiomatic Gaming in 2016, won major titles in Dota 2, League of Legends, and Counter-Strike, and now fields teams across many games.'
      );
      callbacks.onComplete(
        '- **Founded:** 2000 by Victor Goossens and Joy Hoogeveen. Official website launched in 2001 and moved to teamliquid.net in 2002. Expanded into multi-game esports in 2012, merged with Team Curse in 2015, sold controlling interest to Axiomatic Gaming in 2016, won major titles in Dota 2, League of Legends, and Counter-Strike, and now fields teams across many games.'
      );
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const rewrite = vi.fn(async () =>
      'Team Liquid started in 2000 and grew from a StarCraft community into a multi-title esports organization.\n\n**Milestones**\n- Founded in 2000 by Victor Goossens and Joy Hoogeveen.\n- Official website launched in 2001 and the organization moved to teamliquid.net in 2002.\n- Expanded into broader esports in 2012 and merged with Team Curse in 2015.\n\n**Later Growth**\n- Axiomatic Gaming acquired a controlling interest in 2016.\n- It won major titles in Dota 2, League of Legends, and Counter-Strike during the late 2010s.\n- It now fields teams across multiple competitive games and regions.'
    );
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(
      db as never,
      {
        ollama: createAdapter({ id: 'ollama', label: 'Ollama', startRun }),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      } as never,
      undefined,
      undefined,
      undefined,
      { rewrite, shouldRewrite: vi.fn(() => true) } as never
    );

    const result = await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'hey dude can you tell me the history of team liquid',
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      executionPermission: 'default',
      skillIds: []
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rewrite).toHaveBeenCalledWith(
      'qwen3-coder',
      '- **Founded:** 2000 by Victor Goossens and Joy Hoogeveen. Official website launched in 2001 and moved to teamliquid.net in 2002. Expanded into multi-game esports in 2012, merged with Team Curse in 2015, sold controlling interest to Axiomatic Gaming in 2016, won major titles in Dota 2, League of Legends, and Counter-Strike, and now fields teams across many games.'
    );
    expect(db.updateAssistantTurn).toHaveBeenLastCalledWith(
      result.runId,
      'thread-1',
      'Team Liquid started in 2000 and grew from a StarCraft community into a multi-title esports organization.\n\n**Milestones**\n- Founded in 2000 by Victor Goossens and Joy Hoogeveen.\n- Official website launched in 2001 and the organization moved to teamliquid.net in 2002.\n- Expanded into broader esports in 2012 and merged with Team Curse in 2015.\n\n**Later Growth**\n- Axiomatic Gaming acquired a controlling interest in 2016.\n- It won major titles in Dota 2, League of Legends, and Counter-Strike during the late 2010s.\n- It now fields teams across multiple competitive games and regions.',
      null
    );
    expect(db.getThread().turns.find((turn) => turn.runId === result.runId && turn.role === 'assistant')?.content).toBe(
      'Team Liquid started in 2000 and grew from a StarCraft community into a multi-title esports organization.\n\n**Milestones**\n- Founded in 2000 by Victor Goossens and Joy Hoogeveen.\n- Official website launched in 2001 and the organization moved to teamliquid.net in 2002.\n- Expanded into broader esports in 2012 and merged with Team Curse in 2015.\n\n**Later Growth**\n- Axiomatic Gaming acquired a controlling interest in 2016.\n- It won major titles in Dota 2, League of Legends, and Counter-Strike during the late 2010s.\n- It now fields teams across multiple competitive games and regions.'
    );
  });

  it('lets Codex read AGENTS.md natively and only inlines non-native workspace instruction files', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.',
      'SOUL.md': 'You are the workspace agent.',
      'USER.md': 'Be concise.',
      'codex.md': 'Use Codex compatibility.'
    });
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Build the feature.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining(`Active workspace:\n${workspace}`)
      }),
      expect.any(Object)
    );
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Default to this workspace for file reads, edits, and commands.')
      }),
      expect.any(Object)
    );
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('If the active workspace is empty or does not contain the expected files, report that instead of choosing another workspace on your own.')
      }),
      expect.any(Object)
    );
    const prompt = startRun.mock.calls[0]?.[0]?.prompt as string;
    expect(prompt).not.toContain('Workspace AGENTS.md');
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Workspace SOUL.md:\nYou are the workspace agent.')
      }),
      expect.any(Object)
    );
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Workspace USER.md:\nBe concise.')
      }),
      expect.any(Object)
    );
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Workspace codex.md:\nUse Codex compatibility.')
      }),
      expect.any(Object)
    );
  });

  it('rejects provider runs when the project workspace folder no longer exists', async () => {
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const missingWorkspace = join(tmpdir(), `vicode-missing-workspace-${Date.now()}`);
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: missingWorkspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await expect(
      manager.submitComposer({
        projectId: 'project-1',
        prompt: 'Build the feature.',
        providerId: 'openai',
        modelId: 'gpt-5',
        executionPermission: 'default',
        skillIds: []
      })
    ).rejects.toThrow(`Workspace folder is unavailable: ${missingWorkspace}.`);
    expect(startRun).not.toHaveBeenCalled();
  });

  it('lets Gemini read AGENTS.md and gemini.md natively and only inlines non-native workspace files', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.',
      'SOUL.md': 'You are the workspace agent.',
      'USER.md': 'Be concise.',
      'gemini.md': 'Use Gemini compatibility.'
    });
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini', startRun })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Build the feature.',
      providerId: 'gemini',
      modelId: 'gemini-2.5-pro',
      executionPermission: 'default',
      skillIds: []
    });

    const prompt = startRun.mock.calls[0]?.[0]?.prompt as string;
    expect(prompt).not.toContain('Workspace AGENTS.md');
    expect(prompt).not.toContain('Workspace gemini.md');
    expect(prompt).toContain('Workspace SOUL.md:\nYou are the workspace agent.');
    expect(prompt).toContain('Workspace USER.md:\nBe concise.');
  });

  it('prioritizes workspace instruction files ahead of retrieved memory when the inline prompt budget is tight', async () => {
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const hugeSoul = `Soul guidance.\n${'A'.repeat(4_200)}`;
    const hugeUser = `User preferences.\n${'B'.repeat(4_200)}`;
    const hugeCompat = `Provider compatibility.\n${'C'.repeat(4_200)}`;
    const hugeMemory = `Durable memory.\n${'D'.repeat(4_200)}`;
    const workspaceContext = {
      assemble: () =>
        ({
          folderPath: null,
          trusted: true,
          providerId: 'openai',
          blocks: [
            {
              kind: 'agents',
              label: 'Workspace AGENTS.md',
              fileName: 'AGENTS.md',
              path: 'C:/workspace/AGENTS.md',
              content: 'Use small diffs.'
            },
            {
              kind: 'soul',
              label: 'Workspace SOUL.md',
              fileName: 'SOUL.md',
              path: 'C:/workspace/SOUL.md',
              content: hugeSoul
            },
            {
              kind: 'user',
              label: 'Workspace USER.md',
              fileName: 'USER.md',
              path: 'C:/workspace/USER.md',
              content: hugeUser
            },
            {
              kind: 'provider_compat',
              label: 'Workspace codex.md',
              fileName: 'codex.md',
              path: 'C:/workspace/codex.md',
              content: hugeCompat
            }
          ],
          memoryBlocks: [
            {
              kind: 'memory',
              label: 'Workspace MEMORY.md',
              fileName: 'MEMORY.md',
              path: 'C:/workspace/MEMORY.md',
              content: hugeMemory,
              score: 4
            }
          ],
          generatedMemoryBlocks: [],
          skillBlocks: [],
          runtimeSkillResources: [],
          selectedSkillIds: [],
          mentionedSkillIds: [],
          diagnostics: {
            durationMs: 0,
            workspaceInstructionReadMs: 0,
            skillResolutionMs: 0,
            runtimeSkillResolutionMs: 0,
            memoryRetrievalMs: 0,
            generatedMemoryRetrievalMs: 0,
            blockCount: 4,
            memoryBlockCount: 1,
            generatedMemoryBlockCount: 0,
            skillBlockCount: 0,
            runtimeSkillResourceCount: 0
          }
        }) satisfies WorkspaceContextResult
    };
    const db = createDb();
    const manager = new ProviderManager(
      db as never,
      {
        openai: createAdapter({ startRun }),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      },
      workspaceContext as never
    );

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Build the feature.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    const prompt = startRun.mock.calls[0]?.[0]?.prompt as string;
    expect(prompt).toContain('Workspace SOUL.md:\nSoul guidance.');
    expect(prompt).toContain('Workspace USER.md:\nUser preferences.');
    expect(prompt).toContain('Workspace codex.md:\nProvider compatibility.');
    expect(prompt).toContain('[Truncated for prompt budget]');
    expect(prompt).not.toContain('Relevant workspace memory:');
  });

  it('normalizes stale Gemini preview model ids before starting a run', async () => {
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          defaultProviderId: 'gemini',
          defaultModelByProvider: {
            openai: 'gpt-5',
            gemini: 'gemini-3.1-flash-preview',
            qwen: 'qwen3.5-plus',
            ollama: 'qwen3',
            kimi: 'kimi-k2-thinking'
          }
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({
        id: 'gemini',
        label: 'Gemini',
        listStaticModels: () => [createProviderModel('gemini-3-flash-preview', 'Gemini 3 Flash Preview')],
        startRun
      })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Reply briefly.',
      providerId: 'gemini',
      modelId: 'gemini-3.1-flash-preview',
      executionPermission: 'default',
      skillIds: []
    });

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'gemini-3-flash-preview'
      }),
      expect.any(Object)
    );
  });

  it.each([
    ['openai', 'gpt-5'],
    ['gemini', 'gemini-2.5-pro']
  ] as const)('blocks %s execution for untrusted workspaces before provider start', async (providerId, modelId) => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: false
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ id: 'openai', label: 'OpenAI', startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini', startRun })
    });

    await expect(
      manager.submitComposer({
        projectId: 'project-1',
        prompt: 'Build the feature.',
        providerId,
        modelId,
        executionPermission: 'default',
        skillIds: []
      })
    ).rejects.toThrow(/cannot run against an untrusted workspace/u);

    expect(startRun).not.toHaveBeenCalled();
  });

  it.each([
    ['openai', 'gpt-5'],
    ['gemini', 'gemini-2.5-pro']
  ] as const)('blocks %s planner runs for untrusted workspaces before provider start', async (providerId, modelId) => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: false
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ id: 'openai', label: 'OpenAI', startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini', startRun })
    });

    await expect(
      manager.submitPlanner({
        projectId: 'project-1',
        prompt: 'Plan the feature.',
        providerId,
        modelId,
        executionPermission: 'default',
        skillIds: []
      })
    ).rejects.toThrow(/cannot run against an untrusted workspace/u);

    expect(startRun).not.toHaveBeenCalled();
  });

  it('marks the thread failed when provider startup rejects before a handle is returned', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const startRun = vi.fn(async () => {
      throw new Error('Failed to start Codex CLI: spawn failed');
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ id: 'openai', label: 'OpenAI', startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    const result = await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Build the feature.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    expect(result.disposition).toBe('started');
    expect(result.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
    );
    expect(db.addRunEvent).toHaveBeenCalledWith(
      'thread-1',
      result.runId,
      'failed',
      { message: 'Failed to start Codex CLI: spawn failed' }
    );
    expect(db.updateThreadStatus).toHaveBeenCalledWith('thread-1', 'failed');
  });

  it('grounds prompt enhancement in the active workspace without preserving stale paths', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onComplete('Refined prompt');
      return {
        runId: 'run-1',
        cancel: async () => {}
      };
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    const result = await manager.enhancePrompt({
      prompt: 'Update the hero section.',
      projectId: 'project-1',
      providerId: 'openai',
      modelId: 'gpt-5'
    });

    const prompt = startRun.mock.calls[0]?.[0]?.prompt as string;
    expect(result.prompt).toBe('Refined prompt');
    expect(prompt).toContain(`Active workspace folder: ${workspace}`);
    expect(prompt).toContain('If the draft includes an active workspace folder, keep the prompt grounded in that workspace by default.');
    expect(prompt).toContain('If that workspace appears empty or lacks the requested files, tell the user instead of selecting a different workspace on your own.');
    expect(prompt).toContain('Do not introduce or preserve stale absolute paths from earlier tasks unless the user explicitly confirmed them in the draft.');
  });

  it('includes relevant indexed workspace memory in the effective prompt', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.',
      'MEMORY.md': 'The app uses React, Vite, and TypeScript.'
    });
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      ),
      listWorkspaceMemoryChunks: vi.fn(() => [
        {
          id: 'chunk-1',
          kind: 'memory',
          path: join(workspace, 'MEMORY.md'),
          fileName: 'MEMORY.md',
          heading: null,
          content: 'The app uses React, Vite, and TypeScript.',
          updatedAt: '2026-03-17T00:00:00.000Z'
        }
      ])
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'What stack does the app use?',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Relevant workspace memory:')
      }),
      expect.any(Object)
    );
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('The app uses React, Vite, and TypeScript.')
      }),
      expect.any(Object)
    );
  });

  it('still includes memory retrieval when workspace instructions are disabled', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.',
      'MEMORY.md': 'The app uses React, Vite, and TypeScript.'
    });
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      ),
      getPersonalization: vi.fn(() => ({
        globalInstructions: '',
        providerInstructions: { openai: '', gemini: '' },
        useWorkspaceInstructions: false
      })),
      listWorkspaceMemoryChunks: vi.fn(() => [
        {
          id: 'chunk-1',
          kind: 'memory',
          path: join(workspace, 'MEMORY.md'),
          fileName: 'MEMORY.md',
          heading: null,
          content: 'The app uses React, Vite, and TypeScript.',
          updatedAt: '2026-03-17T00:00:00.000Z'
        }
      ])
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'What stack does the app use?',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    const prompt = startRun.mock.calls[0]?.[0]?.prompt as string;
    expect(prompt).toContain('Relevant workspace memory:');
    expect(prompt).not.toContain('Workspace AGENTS.md');
  });

  it('records a structured change summary when a run edits workspace files', async () => {
    const workspace = createWorkspace({
      'src/app.tsx': 'export const version = 1;\n'
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      writeFileSync(join(workspace, 'src/app.tsx'), 'export const version = 2;\nexport const ready = true;\n', 'utf8');
      callbacks.onComplete('Updated src/app.tsx');
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    const result = await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Make the app ready.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    expect(result.disposition).toBe('started');
    const changeEvent = (db.addRunEvent as ReturnType<typeof vi.fn>).mock.calls.find(
      ([, , eventType, payload]) =>
        eventType === 'info' &&
        payload &&
        typeof payload === 'object' &&
        (payload as { activity?: { kind?: string } }).activity?.kind === 'change_summary'
    );
    expect(changeEvent).toBeDefined();
    expect(changeEvent?.[3]).toMatchObject({
      activity: {
        kind: 'change_summary',
        summary: '1 file changed',
        changeArtifact: {
          source: 'workspace_diff',
          summary: {
            filesChanged: 1,
            insertions: 2,
            deletions: 1
          },
          files: [
            expect.objectContaining({
              path: 'src/app.tsx',
              status: 'modified',
              insertions: 2,
              deletions: 1
            })
          ]
        }
      }
    });
  });

  it('publishes the final change artifact on completion without live run-progress diff scans', async () => {
    const workspace = createWorkspace({
      'src/app.tsx': ['export function App() {', '  return "before";', '}'].join('\n')
    });
    const events: Array<Record<string, unknown>> = [];
    const startRun = vi.fn(async (context, callbacks) => {
      callbacks.onStart();
      writeFileSync(
        join(workspace, 'src/app.tsx'),
        ['export function App() {', '  return "after";', '}'].join('\n'),
        'utf8'
      );
      callbacks.onInfo({
        progress: {
          runId: context.runId,
          threadId: context.threadId,
          title: 'Current tasks',
          items: [
            {
              id: `${context.runId}:provider:0`,
              label: 'Edit the app component',
              order: 0,
              status: 'in_progress'
            }
          ],
          updatedAt: '2026-03-14T00:00:01.000Z',
          diffStats: null,
          reviewAvailable: false,
          changeArtifact: null
        },
        activity: {
          kind: 'terminal_command',
          summary: 'Updated src/app.tsx',
          command: 'apply_patch',
          phase: 'completed'
        }
      });
      callbacks.onComplete('Updated src/app.tsx');
      return {
        runId: context.runId,
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    manager.onEvent((event) => events.push(event as Record<string, unknown>));

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Update the app.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    const infoEventIndex = events.findIndex((event) => {
      if (event.type !== 'raw.event') {
        return false;
      }
      const payload = (event.event as { payload?: { activity?: { kind?: string; summary?: string } } } | undefined)?.payload;
      return payload?.activity?.kind === 'terminal_command' && payload.activity.summary === 'Updated src/app.tsx';
    });
    const persistedProgressEvents = events
      .filter((event) => event.type === 'raw.event')
      .filter((event) => {
        const payload = (event.event as { payload?: { progressSnapshot?: { changeArtifact?: { files?: Array<{ path?: string }> } } } } | undefined)?.payload;
        return payload?.progressSnapshot?.changeArtifact?.files?.[0]?.path === 'src/app.tsx';
      });
    const persistedProgressEvent = persistedProgressEvents.at(-1);
    const persistedProgressIndex = events.findIndex((event) => event === persistedProgressEvent);
    const liveProgressEvent = events
      .filter((event) => event.type === 'run.progress')
      .find((event) => {
        const progress = event.progress as { changeArtifact?: { files?: Array<{ path?: string }> } } | undefined;
        return progress?.changeArtifact?.files?.[0]?.path === 'src/app.tsx';
      });
    const liveProgressIndex = events.findIndex((event) => event === liveProgressEvent);
    const changeSummaryEvent = events
      .filter((event) => event.type === 'raw.event')
      .find((event) => {
        const payload = (event.event as { payload?: { activity?: { kind?: string; summary?: string; changeArtifact?: unknown } } } | undefined)?.payload;
        return payload?.activity?.kind === 'change_summary' && payload.activity.summary === '1 file changed';
      });
    const changeSummaryIndex = events.findIndex((event) => event === changeSummaryEvent);

    expect(infoEventIndex).toBeGreaterThanOrEqual(0);
    expect(persistedProgressEvent).toBeDefined();
    expect(
      ((persistedProgressEvent?.event as { payload?: { progressSnapshot?: unknown } } | undefined)?.payload?.progressSnapshot)
    ).toEqual(
      expect.objectContaining({
        runId: expect.any(String),
        threadId: 'thread-1',
        title: 'Current tasks',
        items: [
          expect.objectContaining({
            label: 'Edit the app component',
            status: 'completed'
          })
        ],
        reviewAvailable: true,
        changeArtifact: expect.objectContaining({
          source: 'workspace_diff',
          files: [expect.objectContaining({ path: 'src/app.tsx' })]
        })
      })
    );
    expect(liveProgressEvent).toBeDefined();
    expect(persistedProgressIndex).toBeGreaterThan(infoEventIndex);
    expect(liveProgressIndex).toBeGreaterThan(infoEventIndex);
    expect(changeSummaryEvent).toBeDefined();
    expect(changeSummaryIndex).toBeGreaterThan(liveProgressIndex);
    expect(
      ((changeSummaryEvent?.event as { payload?: { activity?: { changeArtifact?: unknown } } } | undefined)?.payload?.activity?.changeArtifact)
    ).toEqual(
      expect.objectContaining({
        source: 'workspace_diff',
        summary: expect.objectContaining({
          filesChanged: 1,
          insertions: 1,
          deletions: 1
        }),
        files: [
          expect.objectContaining({
            path: 'src/app.tsx',
            beforeContent: ['export function App() {', '  return "before";', '}'].join('\n'),
            afterContent: ['export function App() {', '  return "after";', '}'].join('\n')
          })
        ]
      })
    );
  });

  it('resolves mentioned skills in the main process for prompt sections and runtime resources', async () => {
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const reviewerSkill = {
      id: 'skill-1',
      name: 'Reviewer',
      description: 'Review the patch.',
      instructions: 'Look for regressions.',
      origin: 'custom_local',
      scope: 'project',
      providerTargets: ['openai'],
      enabled: true,
      projectId: 'project-1',
      metadata: { slug: 'reviewer', attachMode: 'prompt', kind: 'skill' },
      path: null,
      createdAt: '2026-03-17T00:00:00.000Z',
      updatedAt: '2026-03-17T00:00:00.000Z'
    };
    const browserHelperSkill = {
      id: 'skill-2',
      name: 'Browser Helper',
      description: 'Use browser helper.',
      instructions: 'Launch browser automation when relevant.',
      origin: 'provider_native',
      scope: 'project',
      providerTargets: ['openai'],
      enabled: true,
      projectId: 'project-1',
      metadata: {
        slug: 'browser-helper',
        attachMode: 'runtime',
        kind: 'extension',
        providerOrigin: 'openai'
      },
      path: 'C:/skills/browser-helper',
      createdAt: '2026-03-17T00:00:00.000Z',
      updatedAt: '2026-03-17T00:00:00.000Z'
    };
    const db = createDb({
      listSkills: vi.fn(() => [reviewerSkill, browserHelperSkill])
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Use $reviewer and $browser-helper for this change.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('## Reviewer ($reviewer)')
      }),
      expect.any(Object)
    );
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining(
          'These instructions are already attached to this run. Do not call provider CLIs, shell commands, or activation commands to enable them.'
        )
      }),
      expect.any(Object)
    );
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Browser Helper ($browser-helper)')
      }),
      expect.any(Object)
    );
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeSkillResources: [{ kind: 'extension', path: 'C:/skills/browser-helper' }]
      }),
      expect.any(Object)
    );
    expect(db.appendTurn).toHaveBeenCalledWith(
      'thread-1',
      'user',
      'Use $reviewer and $browser-helper for this change.',
      expect.objectContaining({
        skillIds: ['skill-1', 'skill-2']
      })
    );
  });

  it('forwards pasted image attachments into provider execution context', async () => {
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const db = createDb({
      getProviderAccount: vi.fn(() => ({
        providerId: 'openai',
        authState: 'connected',
        authMode: 'cli',
        encryptedApiKey: null,
        updatedAt: '2026-03-14T00:00:00.000Z'
      }))
    });
    const adapter = createAdapter({
      getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with ChatGPT' }),
      startRun
    });
    const manager = new ProviderManager(db as never, { openai: adapter, gemini: createAdapter({ id: 'gemini', label: 'Gemini' }) });
    const imageAttachments = [
      {
        id: 'image-1',
        name: 'mockup.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,QUJD'
      }
    ];

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Use this screenshot.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: [],
      imageAttachments
    });

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        imageAttachments
      }),
      expect.any(Object)
    );
  });

  it('uses runtime discovery when CLI auth is active and the provider exposes live models', async () => {
    const discovered = [createProviderModel('gpt-5.4', 'GPT-5.4')];
    const db = createDb({
      getProviderAccount: vi.fn(() => ({
        providerId: 'openai',
        authState: 'connected',
        authMode: 'cli',
        encryptedApiKey: null,
        updatedAt: '2026-03-14T00:00:00.000Z'
      }))
    });
    const adapter = createAdapter({
      getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with ChatGPT' }),
      discoverRuntimeModels: async () => discovered
    });
    const manager = new ProviderManager(db as never, { openai: adapter, gemini: createAdapter({ id: 'gemini', label: 'Gemini' }) });

    const provider = await manager.getProvider('openai');

    expect(provider.modelSource).toBe('runtime');
    expect(provider.canLiveDiscoverModels).toBe(true);
    expect(db.replaceProviderModels).toHaveBeenCalledWith('openai', discovered, 'runtime');
    expect(provider.models.map((model) => model.id)).toEqual(['gpt-5.4']);
  });

  it('uses runtime discovery for Ollama even without a CLI auth mode', async () => {
    const discovered = [createProviderModel('deepseek-r1:8b', 'Deepseek R1 8B')];
    const db = createDb();
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' }),
      qwen: createAdapter({ id: 'qwen', label: 'Qwen' }),
      ollama: createAdapter({
        id: 'ollama',
        label: 'Ollama',
        listStaticModels: () => [createProviderModel('qwen3', 'Qwen3')],
        detectInstall: async () => ({ installed: true, cliPath: 'ollama.exe' }),
        getAuthState: async () => ({ authState: 'connected', authMode: null, message: 'Ollama is ready.' }),
        discoverRuntimeModels: async () => discovered
      }),
      kimi: createAdapter({ id: 'kimi', label: 'Kimi' })
    });

    const provider = await manager.getProvider('ollama');

    expect(provider.modelSource).toBe('runtime');
    expect(provider.canLiveDiscoverModels).toBe(true);
    expect(db.replaceProviderModels).toHaveBeenCalledWith('ollama', discovered, 'runtime');
    expect(provider.models.map((model) => model.id)).toEqual(['deepseek-r1:8b']);
  });

  it('shows no visible Ollama models when the runtime is reachable but empty', async () => {
    const db = createDb({
      getProviderModelCache: vi.fn(() => ({
        models: [createProviderModel('stale-model', 'Stale Model')],
        updatedAt: '2026-03-14T00:00:00.000Z',
        source: 'runtime'
      }))
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' }),
      qwen: createAdapter({ id: 'qwen', label: 'Qwen' }),
      ollama: createAdapter({
        id: 'ollama',
        label: 'Ollama',
        listStaticModels: () => [createProviderModel('qwen3', 'Qwen3')],
        detectInstall: async () => ({ installed: true, cliPath: 'ollama.exe' }),
        getAuthState: async () => ({ authState: 'connected', authMode: null, message: 'No local models found.' }),
        discoverRuntimeModels: async () => []
      }),
      kimi: createAdapter({ id: 'kimi', label: 'Kimi' })
    });

    const provider = await manager.getProvider('ollama');

    expect(provider.modelSource).toBe('runtime');
    expect(provider.models).toEqual([]);
    expect(db.clearProviderModelCache).toHaveBeenCalledWith('ollama');
  });

  it('falls back to cached models for CLI auth when no official runtime discovery is available', async () => {
    const cachedModels = [createProviderModel('gemini-2.5-pro', 'Gemini 2.5 Pro')];
    const db = createDb({
      getProviderAccount: vi.fn(() => ({
        providerId: 'gemini',
        authState: 'connected',
        authMode: 'cli',
        encryptedApiKey: null,
        updatedAt: '2026-03-14T00:00:00.000Z'
      })),
      getProviderModelCache: vi.fn(() => ({
        models: cachedModels,
        updatedAt: '2026-03-14T00:00:00.000Z',
        source: 'api'
      }))
    });
    const adapter = createAdapter({
      id: 'gemini',
      label: 'Gemini',
      listStaticModels: () => [createProviderModel('gemini-2.5-flash', 'Gemini 2.5 Flash')],
      getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with Google' }),
      discoverRuntimeModels: async () => null
    });
    const manager = new ProviderManager(db as never, { openai: createAdapter(), gemini: adapter });

    const provider = await manager.getProvider('gemini');

    expect(provider.modelSource).toBe('cache');
    expect(provider.canLiveDiscoverModels).toBe(false);
    expect(provider.models.map((model) => model.id)).toEqual(['gemini-2.5-pro']);
  });

  it('merges Gemini quota bucket models into the visible composer model list', async () => {
    const cachedModels = [createProviderModel('gemini-2.5-pro', 'Gemini 2.5 Pro')];
    const db = createDb({
      getProviderAccount: vi.fn(() => ({
        providerId: 'gemini',
        authState: 'connected',
        authMode: 'cli',
        encryptedApiKey: null,
        updatedAt: '2026-03-14T00:00:00.000Z'
      })),
      getProviderModelCache: vi.fn(() => ({
        models: cachedModels,
        updatedAt: '2026-03-14T00:00:00.000Z',
        source: 'api'
      }))
    });
    const adapter = createAdapter({
      id: 'gemini',
      label: 'Gemini',
      listStaticModels: () => [createProviderModel('gemini-2.5-flash', 'Gemini 2.5 Flash')],
      getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with Google' }),
      discoverRuntimeModels: async () => null,
      getQuotaStatus: async () => ({
        source: 'provider_internal',
        fetchedAt: '2026-03-16T00:00:00.000Z',
        tierName: 'Gemini Code Assist',
        pooledRemaining: null,
        pooledLimit: null,
        pooledResetAt: '2026-03-17T00:00:00.000Z',
        buckets: [
          {
            modelId: 'gemini-3-pro-preview',
            tokenType: 'REQUESTS',
            remainingAmount: null,
            remainingFraction: 0,
            limit: null,
            resetAt: '2026-03-17T00:00:00.000Z'
          },
          {
            modelId: 'gemini-3.1-flash-lite-preview',
            tokenType: 'REQUESTS',
            remainingAmount: null,
            remainingFraction: 0.9,
            limit: null,
            resetAt: '2026-03-17T00:00:00.000Z'
          }
        ]
      })
    });
    const manager = new ProviderManager(db as never, { openai: createAdapter(), gemini: adapter });

    const provider = await manager.getProvider('gemini');

    expect(provider.models.map((model) => model.id)).toEqual([
      'gemini-2.5-pro',
      'gemini-3-pro-preview'
    ]);
  });

  it('probes Gemini quota with the preferred visible preview model when available', async () => {
    const getQuotaStatus = vi.fn(async () => null);
    const db = createDb({
      getProviderAccount: vi.fn(() => ({
        providerId: 'gemini',
        authState: 'connected',
        authMode: 'cli',
        encryptedApiKey: null,
        updatedAt: '2026-03-14T00:00:00.000Z'
      })),
      getProviderModelCache: vi.fn(() => ({
        models: [
          createProviderModel('gemini-2.5-pro', 'Gemini 2.5 Pro'),
          createProviderModel('gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview'),
          createProviderModel('gemini-3-flash-preview', 'Gemini 3 Flash Preview')
        ],
        updatedAt: '2026-03-14T00:00:00.000Z',
        source: 'runtime'
      }))
    });
    const adapter = createAdapter({
      id: 'gemini',
      label: 'Gemini',
      getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with Google' }),
      discoverRuntimeModels: async () => null,
      getQuotaStatus
    });
    const manager = new ProviderManager(db as never, { openai: createAdapter(), gemini: adapter });

    await manager.getProvider('gemini');

    expect(getQuotaStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'gemini-3.1-pro-preview'
      })
    );
  });

  it('keeps runtime-discovered Gemini models authoritative instead of re-adding fallback-only entries', async () => {
    const db = createDb({
      getProviderAccount: vi.fn(() => ({
        providerId: 'gemini',
        authState: 'connected',
        authMode: 'cli',
        encryptedApiKey: null,
        updatedAt: '2026-03-14T00:00:00.000Z'
      }))
    });
    const adapter = createAdapter({
      id: 'gemini',
      label: 'Gemini',
      getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with Google' }),
      discoverRuntimeModels: async () => [
        createProviderModel('gemini-2.5-pro', 'Gemini 2.5 Pro'),
        createProviderModel('gemini-3-flash-preview', 'Gemini 3 Flash Preview')
      ]
    });
    const manager = new ProviderManager(db as never, { openai: createAdapter(), gemini: adapter });

    const provider = await manager.getProvider('gemini');

    expect(provider.modelSource).toBe('runtime');
    expect(provider.models.map((model) => model.id)).toEqual(['gemini-2.5-pro', 'gemini-3-flash-preview']);
  });

  it('surfaces the full Gemini fallback model set when CLI auth is connected', async () => {
    const fallbackGeminiModels = getProviderFallbackModels('gemini');
    const db = createDb({
      getProviderAccount: vi.fn(() => ({
        providerId: 'gemini',
        authState: 'connected',
        authMode: 'cli',
        encryptedApiKey: null,
        updatedAt: '2026-03-14T00:00:00.000Z'
      })),
      getProviderModelCache: vi.fn(() => ({
        models: [],
        updatedAt: null,
        source: null
      }))
    });
    const adapter = createAdapter({
      id: 'gemini',
      label: 'Gemini',
      listStaticModels: () => fallbackGeminiModels,
      getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with Google' }),
      discoverRuntimeModels: async () => null
    });
    const manager = new ProviderManager(db as never, { openai: createAdapter(), gemini: adapter });

    const provider = await manager.getProvider('gemini');

    expect(provider.modelSource).toBe('fallback');
    expect(provider.models.map((model) => model.id)).toEqual(fallbackGeminiModels.map((model) => model.id));
  });

  it('reports auth-detected missing-cli state when sign-in exists but the CLI is not runnable', async () => {
    const adapter = createAdapter({
      id: 'gemini',
      label: 'Gemini',
      detectInstall: async () => ({ installed: false, cliPath: null }),
      getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Gemini CLI sign-in detected.' })
    });
    const manager = new ProviderManager(createDb() as never, { openai: createAdapter(), gemini: adapter });

    const provider = await manager.getProvider('gemini');

    expect(provider.installed).toBe(false);
    expect(provider.authState).toBe('missing_cli');
    expect(provider.authMode).toBe('cli');
    expect(provider.message).toContain('sign-in was detected');
  });

  it('inlines recent thread history for stateless follow-up providers', async () => {
    const startRun = vi.fn(async () => ({ runId: 'run-1', cancel: async () => {} }));
    const adapter = createAdapter({ id: 'ollama', label: 'Ollama', startRun, getPlannerCapability: () => ({ supported: false }) });
    const thread = createThreadDetail({
      providerId: 'ollama',
      modelId: 'kimi-k2:latest',
      turns: [
        {
          id: 'turn-1',
          threadId: 'thread-1',
          runId: null,
          role: 'user',
          content: 'Remember that this Hello World program should print twice.',
          metadata: null,
          createdAt: '2026-03-14T00:00:00.000Z'
        },
        {
          id: 'turn-2',
          threadId: 'thread-1',
          runId: 'run-0',
          role: 'assistant',
          content: 'Understood. I will keep the double-print requirement in mind.',
          metadata: null,
          createdAt: '2026-03-14T00:00:01.000Z'
        }
      ]
    });
    const db = createDb({
      getProject: vi.fn(() => createProject({ defaultProviderId: 'ollama', defaultModelByProvider: { openai: 'gpt-5', gemini: 'gemini-2.5-pro', qwen: 'qwen3.5-plus', ollama: 'kimi-k2:latest', kimi: 'kimi-k2-thinking' } })),
      getThread: vi.fn(() => thread)
    });
    const manager = new ProviderManager(db as never, { ollama: adapter } as never);

    await manager.submitComposer({
      projectId: 'project-1',
      threadId: 'thread-1',
      prompt: 'Now add the actual print statement.',
      providerId: 'ollama',
      modelId: 'kimi-k2:latest',
      executionPermission: 'default',
      skillIds: [],
      imageAttachments: []
    });

    expect(startRun).toHaveBeenCalledTimes(1);
    const [input] = startRun.mock.calls[0] as [Record<string, unknown>];
    expect(input.prompt).toContain('Recent thread context');
    expect(input.prompt).toContain('Remember that this Hello World program should print twice.');
    expect(input.prompt).toContain('User request:\nNow add the actual print statement.');
    expect(String(input.prompt)).not.toContain('User:\nNow add the actual print statement.');
  });

  it('falls back to inline thread history for OpenAI execution runs', async () => {
    const startRun = vi.fn(async () => ({ runId: 'run-1', cancel: async () => {} }));
    const adapter = createAdapter({ id: 'openai', label: 'OpenAI', startRun });
    const thread = createThreadDetail({
      providerId: 'openai',
      modelId: 'gpt-5',
      turns: [
        {
          id: 'turn-1',
          threadId: 'thread-1',
          runId: null,
          role: 'user',
          content: 'Keep this prior context out of the inline prompt.',
          metadata: null,
          createdAt: '2026-03-14T00:00:00.000Z'
        }
      ]
    });
    const db = createDb({
      getThread: vi.fn(() => thread)
    });
    const manager = new ProviderManager(db as never, { openai: adapter } as never);

    await manager.submitComposer({
      projectId: 'project-1',
      threadId: 'thread-1',
      prompt: 'Continue the task.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: [],
      imageAttachments: []
    });

    expect(startRun).toHaveBeenCalledTimes(1);
    const [input] = startRun.mock.calls[0] as [Record<string, unknown>];
    expect(input.prompt).toContain('Recent thread context');
    expect(input.prompt).toContain('Keep this prior context out of the inline prompt.');
    expect(input.resumeSessionId).toBeNull();
  });

  it('prefers Gemini native resume when an execution session was previously captured', async () => {
    const startRun = vi.fn(async () => ({ runId: 'run-1', cancel: async () => {} }));
    const adapter = createAdapter({ id: 'gemini', label: 'Gemini', startRun });
    const thread = createThreadDetail({
      providerId: 'gemini',
      modelId: 'gemini-2.5-pro',
      turns: [
        {
          id: 'turn-1',
          threadId: 'thread-1',
          runId: null,
          role: 'user',
          content: 'Keep this prior context in the resumed session.',
          metadata: null,
          createdAt: '2026-03-14T00:00:00.000Z'
        }
      ],
      rawOutput: [
        {
          id: 'event-1',
          threadId: 'thread-1',
          runId: 'run-0',
          eventType: 'info',
          payload: {
            session: {
              kind: 'execution',
              providerId: 'gemini',
              sessionId: 'gemini-session-1'
            }
          },
          createdAt: '2026-03-14T00:00:01.000Z'
        }
      ]
    });
    const db = createDb({
      getThread: vi.fn(() => thread)
    });
    const manager = new ProviderManager(db as never, { gemini: adapter } as never);

    await manager.submitComposer({
      projectId: 'project-1',
      threadId: 'thread-1',
      prompt: 'Continue the task.',
      providerId: 'gemini',
      modelId: 'gemini-2.5-pro',
      executionPermission: 'default',
      skillIds: [],
      imageAttachments: []
    });

    expect(startRun).toHaveBeenCalledTimes(1);
    const [input] = startRun.mock.calls[0] as [Record<string, unknown>];
    expect(input.resumeSessionId).toBe('gemini-session-1');
    expect(input.prompt).not.toContain('Recent thread context');
  });

  it.each([
    ['qwen', 'qwen3.5-plus', 'qwen-session-1'],
    ['kimi', 'kimi-k2-thinking', 'kimi-session-1']
  ] as const)('keeps %s on inline history fallback until native execution resume is verified', async (providerId, modelId, sessionId) => {
    const startRun = vi.fn(async () => ({ runId: 'run-1', cancel: async () => {} }));
    const adapter = createAdapter({ id: providerId, label: providerId === 'qwen' ? 'Qwen' : 'Kimi', startRun });
    const thread = createThreadDetail({
      providerId,
      modelId,
      executionPermission: providerId === 'kimi' ? 'full_access' : 'default',
      turns: [
        {
          id: 'turn-1',
          threadId: 'thread-1',
          runId: null,
          role: 'user',
          content: 'Continue with the saved session.',
          metadata: null,
          createdAt: '2026-03-14T00:00:00.000Z'
        }
      ],
      rawOutput: [
        {
          id: 'event-1',
          threadId: 'thread-1',
          runId: 'run-0',
          eventType: 'info',
          payload: {
            session: {
              kind: 'execution',
              providerId,
              sessionId
            }
          },
          createdAt: '2026-03-14T00:00:01.000Z'
        }
      ]
    });
    const db = createDb({
      getThread: vi.fn(() => thread)
    });
    const manager = new ProviderManager(db as never, { [providerId]: adapter } as never);

    await manager.submitComposer({
      projectId: 'project-1',
      threadId: 'thread-1',
      prompt: 'Continue the task.',
      providerId,
      modelId,
      executionPermission: providerId === 'kimi' ? 'full_access' : 'default',
      skillIds: [],
      imageAttachments: []
    });

    expect(startRun).toHaveBeenCalledTimes(1);
    const [input] = startRun.mock.calls[0] as [Record<string, unknown>];
    expect(input.resumeSessionId).toBeNull();
    expect(input.prompt).toContain('Recent thread context');
  });

  it('disables inline history fallback for build-controller lane threads', async () => {
    const startRun = vi.fn(async () => ({ runId: 'run-1', cancel: async () => {} }));
    const adapter = createAdapter({ id: 'ollama', label: 'Ollama', startRun });
    const thread = createThreadDetail({
      providerId: 'ollama',
      modelId: 'rnj-1:8b',
      executionPermission: 'full_access',
      turns: [
        {
          id: 'turn-1',
          threadId: 'thread-1',
          runId: null,
          role: 'user',
          content: 'Earlier setup-thread planner output with local markdown links.',
          metadata: {},
          createdAt: '2026-04-02T00:00:00.000Z'
        },
        {
          id: 'turn-2',
          threadId: 'thread-1',
          runId: null,
          role: 'status',
          content: 'Lane thread bound to team-1 / Planner at C:\\workspace.',
          metadata: {
            laneControlMarker: 'build-controller:team-1:planner'
          },
          createdAt: '2026-04-02T00:00:00.000Z'
        }
      ]
    });
    const db = createDb({
      getThread: vi.fn(() => thread)
    });
    const manager = new ProviderManager(db as never, { ollama: adapter } as never);

    await manager.submitComposer({
      projectId: 'project-1',
      threadId: 'thread-1',
      prompt: 'Continue the planner lane.',
      providerId: 'ollama',
      modelId: 'rnj-1:8b',
      executionPermission: 'full_access',
      skillIds: [],
      imageAttachments: []
    });

    expect(startRun).toHaveBeenCalledTimes(1);
    const [input] = startRun.mock.calls[0] as [Record<string, unknown>];
    expect(input.resumeSessionId).toBeNull();
    expect(String(input.prompt)).not.toContain('Recent thread context');
  });

  it('syncs the thread record when a follow-up switches provider and model', async () => {
    const startRun = vi.fn(async () => ({ runId: 'run-1', cancel: async () => {} }));
    const adapter = createAdapter({ id: 'gemini', label: 'Gemini', startRun });
    const thread = createThreadDetail({
      providerId: 'ollama',
      modelId: 'kimi-k2.5',
      executionPermission: 'full_access'
    });
    const db = createDb({
      getThread: vi.fn(() => thread)
    });
    const manager = new ProviderManager(db as never, { gemini: adapter } as never);

    await manager.submitComposer({
      projectId: 'project-1',
      threadId: 'thread-1',
      prompt: 'Switch this thread to Gemini for the next attempt.',
      providerId: 'gemini',
      modelId: 'gemini-3.1-pro-preview',
      executionPermission: 'full_access',
      skillIds: [],
      imageAttachments: []
    });

    expect(db.syncThreadRunConfiguration).toHaveBeenCalledWith('thread-1', {
      providerId: 'gemini',
      modelId: 'gemini-3.1-pro-preview',
      executionPermission: 'full_access'
    });
  });

  it('uses local-runtime messaging for Ollama when the runtime is not installed', async () => {
    const adapter = createAdapter({
      id: 'ollama',
      label: 'Ollama',
      detectInstall: async () => ({ installed: false, cliPath: null }),
      getAuthState: async () => ({ authState: 'disconnected', authMode: null, message: 'Install Ollama.' })
    });
    const manager = new ProviderManager(createDb() as never, { openai: createAdapter(), ollama: adapter });

    const provider = await manager.getProvider('ollama');

    expect(provider.installed).toBe(false);
    expect(provider.authState).toBe('disconnected');
    expect(provider.authMode).toBe(null);
    expect(provider.message).toBe('Ollama local runtime is not installed. Install it for local models, or save an Ollama API key in Vicode to use hosted models.');
  });

  it('uses local-runtime startup messaging for Ollama while the runtime is still starting', async () => {
    const startAuth = vi.fn(async () => {});
    const adapter = createAdapter({
      id: 'ollama',
      label: 'Ollama',
      detectInstall: async () => ({ installed: true, cliPath: null }),
      getAuthState: async () => ({ authState: 'detected', authMode: null, message: 'Runtime not reachable yet.' }),
      startAuth
    });
    const manager = new ProviderManager(createDb() as never, { openai: createAdapter(), ollama: adapter });

    const provider = await manager.startAuth('ollama', 'cli');

    expect(startAuth).toHaveBeenCalledWith('cli', null);
    expect(provider.authState).toBe('checking');
    expect(provider.message).toBe('Waiting for the Ollama local runtime to start...');
  });

  it('treats Ollama cloud API-key auth as usable without a local runtime install', async () => {
    const discovered = [createProviderModel('qwen3', 'Qwen3')];
    const db = createDb({
      getProviderAccount: vi.fn(() => ({
        providerId: 'ollama',
        authState: 'connected',
        authMode: 'api_key',
        encryptedApiKey: Buffer.from('ollama-cloud-key', 'utf8').toString('base64'),
        updatedAt: '2026-03-14T00:00:00.000Z'
      }))
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      ollama: createAdapter({
        id: 'ollama',
        label: 'Ollama',
        listStaticModels: () => [createProviderModel('qwen3', 'Qwen3')],
        detectInstall: async () => ({ installed: false, cliPath: null }),
        getAuthState: async () => ({
          authState: 'connected',
          authMode: 'api_key',
          message: 'Ollama cloud API key is ready.'
        }),
        discoverApiModels: async () => discovered
      })
    });

    const provider = await manager.getProvider('ollama', { forceRefresh: true });

    expect(provider.installed).toBe(true);
    expect(provider.authMode).toBe('api_key');
    expect(provider.authState).toBe('connected');
    expect(provider.modelSource).toBe('api');
    expect(provider.models.map((model) => model.id)).toEqual(['qwen3']);
    expect(provider.message).toBe('Ollama cloud API key is ready.');
    expect(db.replaceProviderModels).toHaveBeenCalledWith('ollama', discovered, 'api');
  });

  it('prefers the shared hosted Ollama certification model when a requested model is missing', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'vicode-provider-manager-ollama-model-'));
    tempDirs.push(workspace);
    const startRun = vi.fn(async (context) => {
      expect(context.modelId).toBe('qwen3-coder-next');
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      ),
      getProviderAccount: vi.fn(() => ({
        providerId: 'ollama',
        authState: 'connected',
        authMode: 'api_key',
        encryptedApiKey: Buffer.from('ollama-cloud-key', 'utf8').toString('base64'),
        updatedAt: '2026-03-14T00:00:00.000Z'
      }))
    });
    const discovered = [
      createProviderModel('llama3.1:8b', 'Llama 3.1'),
      createProviderModel('qwen3-coder-next', 'Qwen 3 Coder Next')
    ];
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      ollama: createAdapter({
        id: 'ollama',
        label: 'Ollama',
        listStaticModels: () => [createProviderModel('qwen3', 'Qwen3')],
        detectInstall: async () => ({ installed: false, cliPath: null }),
        getAuthState: async () => ({
          authState: 'connected',
          authMode: 'api_key',
          message: 'Ollama cloud API key is ready.'
        }),
        discoverApiModels: async () => discovered,
        startRun
      })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Build the feature.',
      providerId: 'ollama',
      modelId: 'missing-hosted-model',
      executionPermission: 'full_access',
      skillIds: []
    });

    expect(startRun).toHaveBeenCalledOnce();
  });

  it('temporarily switches Ollama image runs onto a vision-capable model and leaves the thread model unchanged', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'vicode-provider-manager-ollama-vision-'));
    tempDirs.push(workspace);
    const startRun = vi.fn(async (context) => {
      expect(context.modelId).toBe('qwen2.5vl:7b');
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      ),
      getProviderAccount: vi.fn(() => ({
        providerId: 'ollama',
        authState: 'connected',
        authMode: 'api_key',
        encryptedApiKey: Buffer.from('ollama-cloud-key', 'utf8').toString('base64'),
        updatedAt: '2026-03-14T00:00:00.000Z'
      }))
    });
    const discovered: ProviderModel[] = [
      { id: 'qwen3-coder:30b', label: 'Qwen 3 Coder 30b', description: '', supportsVision: false, recommendation: 'recommended' },
      { id: 'qwen2.5vl:7b', label: 'Qwen 2.5 VL 7b', description: '', supportsVision: true },
      { id: 'llava:13b', label: 'LLaVA 13b', description: '', supportsVision: true }
    ];
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      ollama: createAdapter({
        id: 'ollama',
        label: 'Ollama',
        listStaticModels: () => discovered,
        detectInstall: async () => ({ installed: false, cliPath: null }),
        getAuthState: async () => ({
          authState: 'connected',
          authMode: 'api_key',
          message: 'Ollama cloud API key is ready.'
        }),
        discoverApiModels: async () => discovered,
        startRun
      })
    });

    const result = await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Use this screenshot to diagnose the issue.',
      providerId: 'ollama',
      modelId: 'qwen3-coder:30b',
      executionPermission: 'default',
      skillIds: [],
      imageAttachments: [
        {
          id: 'image-1',
          name: 'screenshot.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,QUJD'
        }
      ]
    });

    expect(startRun).toHaveBeenCalledOnce();
    expect(result.thread.modelId).toBe('qwen3-coder:30b');
  });

  it('tracks and resolves pending tool approvals for active runs', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'vicode-provider-manager-approval-'));
    tempDirs.push(workspace);
    let callbacks: ProviderRunCallbacks | null = null;
    const startRun = vi.fn(async (_context, nextCallbacks) => {
      callbacks = nextCallbacks;
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      ollama: createAdapter({
        id: 'ollama',
        label: 'Ollama',
        getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Ollama is ready locally.' }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });
    const events: Array<Record<string, unknown>> = [];
    manager.onEvent((event) => events.push(event as Record<string, unknown>));

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Run the requested command.',
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      executionPermission: 'full_access',
      skillIds: []
    });

    const approvalPromise = callbacks!.requestToolApproval!({
      toolName: 'run_command',
      command: 'npm test',
      cwd: 'src',
      workspaceRoot: 'C:/workspace'
    });
    await Promise.resolve();

    const pending = manager.listPendingToolApprovals();

    expect(pending).toHaveLength(1);
    expect(pending[0]).toEqual(
      expect.objectContaining({
        threadId: 'thread-1',
        runId: expect.any(String),
        providerId: 'ollama',
        toolName: 'run_command',
        command: 'npm test',
        cwd: 'src',
        workspaceRoot: 'C:/workspace'
      })
    );
    expect(events).toContainEqual({
      type: 'run.approvalRequested',
      approval: expect.objectContaining({
        id: pending[0].id,
        toolName: 'run_command',
        command: 'npm test'
      })
    });

    await manager.approveToolApproval(pending[0].id);

    await expect(approvalPromise).resolves.toBe('approved');
    expect(manager.listPendingToolApprovals()).toEqual([]);
    expect(events).toContainEqual({
      type: 'run.approvalResolved',
      approvalId: pending[0].id,
      threadId: 'thread-1',
      runId: pending[0].runId,
      decision: 'approved'
    });
  });

  it('auto-approves tool requests when the workspace command policy is auto approve', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'vicode-provider-manager-auto-approve-'));
    tempDirs.push(workspace);
    let callbacks: ProviderRunCallbacks | null = null;
    const startRun = vi.fn(async (_context, nextCallbacks) => {
      callbacks = nextCallbacks;
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true,
          runtimeCommandPolicy: 'auto_approve'
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      ollama: createAdapter({
        id: 'ollama',
        label: 'Ollama',
        getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Ollama is ready locally.' }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });
    const events: Array<Record<string, unknown>> = [];
    manager.onEvent((event) => events.push(event as Record<string, unknown>));

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Run the requested command.',
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      executionPermission: 'full_access',
      skillIds: []
    });

    await expect(
      callbacks!.requestToolApproval!({
        toolName: 'run_command',
        command: 'npm --version',
        cwd: '.',
        workspaceRoot: workspace
      })
    ).resolves.toBe('approved');

    expect(manager.listPendingToolApprovals()).toEqual([]);
    expect(events.some((event) => event.type === 'run.approvalRequested')).toBe(false);
  });

  it('re-reads workspace auto-approve changes for live Ollama tool approvals', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'vicode-provider-manager-live-auto-approve-'));
    tempDirs.push(workspace);
    let callbacks: ProviderRunCallbacks | null = null;
    const startRun = vi.fn(async (_context, nextCallbacks) => {
      callbacks = nextCallbacks;
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const project = createProject({
      folderPath: workspace,
      trusted: true,
      runtimeCommandPolicy: 'approval_required'
    });
    const db = createDb({
      getProject: vi.fn(() => project)
    });
    const manager = new ProviderManager(db as never, {
      ollama: createAdapter({
        id: 'ollama',
        label: 'Ollama',
        getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Ollama is ready locally.' }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });
    const events: Array<Record<string, unknown>> = [];
    manager.onEvent((event) => events.push(event as Record<string, unknown>));

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Run the requested command.',
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      executionPermission: 'full_access',
      skillIds: []
    });

    project.runtimeCommandPolicy = 'auto_approve';

    await expect(
      callbacks!.requestToolApproval!({
        toolName: 'run_command',
        command: 'npm --version',
        cwd: '.',
        workspaceRoot: workspace
      })
    ).resolves.toBe('approved');

    expect(manager.listPendingToolApprovals()).toEqual([]);
    expect(events.some((event) => event.type === 'run.approvalRequested')).toBe(false);
  });

  it('auto-approves ask-mode MCP tool calls in trusted workspaces', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'vicode-provider-manager-mcp-trusted-'));
    tempDirs.push(workspace);
    let callbacks: ProviderRunCallbacks | null = null;
    const startRun = vi.fn(async (_context, nextCallbacks) => {
      callbacks = nextCallbacks;
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const callTool = vi.fn(async (_serverId: string, _toolName: string, args: Record<string, unknown>) => ({
      content: [
        {
          type: 'text',
          text: `echo:${String(args.value ?? '')}`
        }
      ]
    }));
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true,
          runtimeCommandPolicy: 'approval_required'
        })
      )
    });
    const agentRuntime = new AgentRuntimeService({
      listCatalog: async () => ({
        tools: [
          {
            serverId: 'fixture-mcp',
            serverName: 'Fixture MCP',
            name: 'echo',
            title: null,
            description: 'Echo values.',
            inputSchema: null,
            invocationMode: 'ask',
            requiresApproval: true
          }
        ],
        resources: [],
        prompts: [],
        refreshedAt: new Date().toISOString()
      }),
      callTool: callTool as never
    });
    const manager = new ProviderManager(
      db as never,
      {
        ollama: createAdapter({
          id: 'ollama',
          label: 'Ollama',
          getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Ollama is ready locally.' }),
          startRun
        }),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      },
      undefined,
      undefined,
      agentRuntime
    );
    const events: Array<Record<string, unknown>> = [];
    manager.onEvent((event) => events.push(event as Record<string, unknown>));

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Use the connected MCP tool.',
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      executionPermission: 'full_access',
      skillIds: []
    });

    const result = await callbacks!.invokeRuntimeTool!({
      name: 'use_mcp_tool',
      arguments: {
        server_id: 'fixture-mcp',
        tool_name: 'echo',
        arguments: {
          value: 'trusted'
        }
      }
    });

    expect(result).toEqual({
      toolName: 'use_mcp_tool',
      content: 'echo:trusted'
    });
    expect(callTool).toHaveBeenCalledWith('fixture-mcp', 'echo', { value: 'trusted' });
    expect(manager.listPendingToolApprovals()).toEqual([]);
    expect(events.some((event) => event.type === 'run.approvalRequested')).toBe(false);
  });

  it('re-reads workspace command disablement for live Ollama tool approvals', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'vicode-provider-manager-live-disabled-'));
    tempDirs.push(workspace);
    let callbacks: ProviderRunCallbacks | null = null;
    const startRun = vi.fn(async (_context, nextCallbacks) => {
      callbacks = nextCallbacks;
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const project = createProject({
      folderPath: workspace,
      trusted: true,
      runtimeCommandPolicy: 'approval_required'
    });
    const db = createDb({
      getProject: vi.fn(() => project)
    });
    const manager = new ProviderManager(db as never, {
      ollama: createAdapter({
        id: 'ollama',
        label: 'Ollama',
        getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Ollama is ready locally.' }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });
    const events: Array<Record<string, unknown>> = [];
    manager.onEvent((event) => events.push(event as Record<string, unknown>));

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Run the requested command.',
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      executionPermission: 'full_access',
      skillIds: []
    });

    project.runtimeCommandPolicy = 'disabled';

    await expect(
      callbacks!.requestToolApproval!({
        toolName: 'run_command',
        command: 'npm --version',
        cwd: '.',
        workspaceRoot: workspace
      })
    ).resolves.toBe('rejected');

    expect(manager.listPendingToolApprovals()).toEqual([]);
    expect(events.some((event) => event.type === 'run.approvalRequested')).toBe(false);
  });

  it('does not expose app tool approval callbacks for non-app-authoritative provider lanes', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'vicode-provider-manager-openai-approval-surface-'));
    tempDirs.push(workspace);
    let callbacks: ProviderRunCallbacks | null = null;
    const startRun = vi.fn(async (_context, nextCallbacks) => {
      callbacks = nextCallbacks;
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({
        getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with ChatGPT' }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Run the requested command.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'full_access',
      skillIds: []
    });

    expect(callbacks?.requestToolApproval).toBeUndefined();
    expect(manager.listPendingToolApprovals()).toEqual([]);
  });

  it('fails a run instead of persisting an empty assistant reply when a provider completes blank', async () => {
    const db = createDb();
    const startRun = vi.fn(async (_context, callbacks) => {
      callbacks.onStart();
      callbacks.onComplete('   ');
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const manager = new ProviderManager(db as never, {
      ollama: createAdapter({
        id: 'ollama',
        label: 'Ollama',
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });
    const events: AppEvent[] = [];
    manager.onEvent((event) => {
      events.push(event);
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Answer the question.',
      providerId: 'ollama',
      modelId: 'deepseek-v3.2',
      executionPermission: 'full_access',
      skillIds: []
    });

    expect(db.updateAssistantTurn).not.toHaveBeenCalled();
    expect(db.removeEmptyAssistantTurn).toHaveBeenCalledWith(expect.any(String), 'thread-1');
    expect(db.addRunEvent).toHaveBeenCalledWith(
      'thread-1',
      expect.any(String),
      'failed',
      {
        message: 'Ollama completed without producing assistant output.'
      }
    );
    expect(events).toContainEqual({
      type: 'run.status',
      threadId: 'thread-1',
      runId: expect.any(String),
      status: 'failed',
      message: 'Ollama completed without producing assistant output.'
    });
  });

  it('cancels pending tool approvals when a run is stopped', async () => {
    let callbacks: ProviderRunCallbacks | null = null;
    const cancel = vi.fn(async () => {});
    const startRun = vi.fn(async (_context, nextCallbacks) => {
      callbacks = nextCallbacks;
      return {
        runId: 'run-1',
        cancel
      } satisfies ProviderRunHandle;
    });
    const manager = new ProviderManager(createDb() as never, {
      ollama: createAdapter({
        id: 'ollama',
        label: 'Ollama',
        getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Ollama is ready locally.' }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Run the requested command.',
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      executionPermission: 'full_access',
      skillIds: []
    });

    const approvalPromise = callbacks!.requestToolApproval!({
      toolName: 'run_command',
      command: 'npm test',
      cwd: null,
      workspaceRoot: 'C:/workspace'
    });
    await Promise.resolve();
    const [pending] = manager.listPendingToolApprovals();

    await manager.stopRun(pending.runId);

    await expect(approvalPromise).resolves.toBe('cancelled');
    expect(cancel).toHaveBeenCalledWith('Run stopped by user.');
    expect(manager.listPendingToolApprovals()).toEqual([]);
    await expect(manager.rejectToolApproval(pending.id)).rejects.toThrow(
      `Run approval not found: ${pending.id}`
    );
  });

  it('rejects pending tool approvals when a thread is downgraded to default permissions', async () => {
    let callbacks: ProviderRunCallbacks | null = null;
    const events: AppEvent[] = [];
    const startRun = vi.fn(async (_context, nextCallbacks) => {
      callbacks = nextCallbacks;
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const manager = new ProviderManager(createDb() as never, {
      ollama: createAdapter({
        id: 'ollama',
        label: 'Ollama',
        getAuthState: async () => ({
          authState: 'connected',
          authMode: 'cli',
          message: 'Ollama is ready locally.'
        }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });
    manager.onEvent((event) => {
      events.push(event);
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Run the requested command.',
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      executionPermission: 'full_access',
      skillIds: []
    });

    const approvalPromise = callbacks!.requestToolApproval!({
      toolName: 'run_command',
      command: 'npm test',
      cwd: 'src',
      workspaceRoot: 'C:/workspace'
    });
    await Promise.resolve();

    const [pending] = manager.listPendingToolApprovals();
    const nextThread = await manager.setThreadExecutionPermission(
      'thread-1',
      'default'
    );

    expect(nextThread.executionPermission).toBe('default');
    await expect(approvalPromise).resolves.toBe('rejected');
    expect(manager.listPendingToolApprovals()).toEqual([]);
    expect(events).toContainEqual({
      type: 'run.approvalResolved',
      approvalId: pending.id,
      threadId: 'thread-1',
      runId: pending.runId,
      decision: 'rejected'
    });
  });

  it('does not pass the API key into runs when OAuth/CLI auth is the active path', async () => {
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const db = createDb({
      getProviderAccount: vi.fn(() => ({
        providerId: 'openai',
        authState: 'connected',
        authMode: 'cli',
        encryptedApiKey: Buffer.from('secret', 'utf8').toString('base64'),
        updatedAt: '2026-03-14T00:00:00.000Z'
      }))
    });
    const adapter = createAdapter({
      getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with ChatGPT' }),
      startRun
    });
    const manager = new ProviderManager(db as never, { openai: adapter, gemini: createAdapter({ id: 'gemini', label: 'Gemini' }) });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'hello',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: null
      }),
      expect.any(Object)
    );
  });

  it('auto-generates an intelligent title for untouched new threads after the first prompt', async () => {
    const startRun = vi.fn(async (context, callbacks) => {
      if (context.prompt.includes('Generate a concise coding thread title.')) {
        callbacks.onComplete('Polished Landing Page');
        return {
          runId: 'title-run-1',
          cancel: async () => {}
        };
      }

      callbacks.onComplete('Done');
      return {
        runId: 'run-1',
        cancel: async () => {}
      };
    });
    const db = createDb();
    const adapter = createAdapter({
      getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with ChatGPT' }),
      startRun
    });
    const manager = new ProviderManager(db as never, { openai: adapter, gemini: createAdapter({ id: 'gemini', label: 'Gemini' }) });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Build a polished landing page for a new product.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(db.renameThread).toHaveBeenCalledWith('thread-1', 'Polished Landing Page');

    expect(db.createThread).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        providerId: 'openai',
        modelId: 'gpt-5',
        executionPermission: 'default'
      })
    );
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        runMode: 'plan',
        prompt: expect.stringContaining('Generate a concise coding thread title.')
      }),
      expect.any(Object)
    );
  });

  it('repairs split spacing in generated thread titles before saving them', async () => {
    const startRun = vi.fn(async (context, callbacks) => {
      if (context.prompt.includes('Generate a concise coding thread title.')) {
        callbacks.onComplete('Premium React Landing Page with sh ad cn UI');
        return {
          runId: 'title-run-2',
          cancel: async () => {}
        };
      }

      callbacks.onComplete('Done');
      return {
        runId: 'run-2',
        cancel: async () => {}
      };
    });
    const db = createDb();
    const adapter = createAdapter({
      getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with ChatGPT' }),
      startRun
    });
    const manager = new ProviderManager(db as never, { openai: adapter, gemini: createAdapter({ id: 'gemini', label: 'Gemini' }) });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Build a premium React landing page with shadcn UI and hero rhythm.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(db.renameThread).toHaveBeenCalledWith('thread-1', 'Premium React Landing Page with shadcn UI');
  });

  it('does not auto-generate a title for threads that already have a custom name', async () => {
    const db = createDb({
      getThread: vi.fn(() => createThreadDetail({ title: 'Existing thread title' }))
    });
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const adapter = createAdapter({
      getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with ChatGPT' }),
      startRun
    });
    const manager = new ProviderManager(db as never, { openai: adapter, gemini: createAdapter({ id: 'gemini', label: 'Gemini' }) });

    await manager.submitComposer({
      projectId: 'project-1',
      threadId: 'thread-1',
      prompt: 'Continue refining the existing work.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    expect(startRun).toHaveBeenCalledTimes(1);
    expect(db.renameThread).not.toHaveBeenCalled();
  });

  it('disconnects only inside Vicode without calling provider-native logout', async () => {
    let account: ProviderAccount | null = {
      providerId: 'openai',
      authState: 'connected',
      authMode: 'cli',
      encryptedApiKey: Buffer.from('secret', 'utf8').toString('base64'),
      updatedAt: '2026-03-14T00:00:00.000Z'
    };
    const db = createDb({
      getProviderAccount: vi.fn(() => account),
      saveProviderAccount: vi.fn((next: ProviderAccount) => {
        account = next;
        return next;
      })
    });
    const clearAuth = vi.fn(async () => {});
    const adapter = createAdapter({
      getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with ChatGPT' }),
      clearAuth
    });
    const manager = new ProviderManager(db as never, { openai: adapter, gemini: createAdapter({ id: 'gemini', label: 'Gemini' }) });

    const provider = await manager.clearAuth('openai');

    expect(clearAuth).not.toHaveBeenCalled();
    expect(provider.authState).toBe('disconnected');
    expect(provider.authMode).toBe('cli');
    expect(provider.message).toContain('disconnected in Vicode');
    expect(db.clearProviderModelCache).toHaveBeenCalledWith('openai');
  });

  it('shows machine-local CLI auth as detected until the user adopts it in Vicode', async () => {
    const manager = new ProviderManager(createDb() as never, {
      openai: createAdapter({
        getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with ChatGPT' })
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    const provider = await manager.getProvider('openai');

    expect(provider.authState).toBe('detected');
    expect(provider.authMode).toBe('cli');
    expect(provider.message).toContain('Nothing is imported automatically');
  });

  it('adopts machine-local auth inside Vicode without launching a new login', async () => {
    let account: ProviderAccount | null = {
      providerId: 'openai',
      authState: 'disconnected',
      authMode: 'cli',
      encryptedApiKey: null,
      updatedAt: '2026-03-14T00:00:00.000Z'
    };
    const db = createDb({
      getProviderAccount: vi.fn(() => account),
      saveProviderAccount: vi.fn((next: ProviderAccount) => {
        account = next;
        return next;
      })
    });
    const startAuth = vi.fn(async () => {});
    const adapter = createAdapter({
      getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with ChatGPT' }),
      startAuth
    });
    const manager = new ProviderManager(db as never, { openai: adapter, gemini: createAdapter({ id: 'gemini', label: 'Gemini' }) });

    const provider = await manager.adoptAuth('openai');

    expect(startAuth).not.toHaveBeenCalled();
    expect(provider.authState).toBe('connected');
    expect(provider.authMode).toBe('cli');
  });

  it('opens the provider-native login flow instead of silently reconnecting when the user asks to sign in', async () => {
    let account: ProviderAccount | null = {
      providerId: 'openai',
      authState: 'disconnected',
      authMode: 'cli',
      encryptedApiKey: null,
      updatedAt: '2026-03-14T00:00:00.000Z'
    };
    const db = createDb({
      getProviderAccount: vi.fn(() => account),
      saveProviderAccount: vi.fn((next: ProviderAccount) => {
        account = next;
        return next;
      })
    });
    const startAuth = vi.fn(async () => {});
    const adapter = createAdapter({
      getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with ChatGPT' }),
      startAuth
    });
    const manager = new ProviderManager(db as never, { openai: adapter, gemini: createAdapter({ id: 'gemini', label: 'Gemini' }) });

    await manager.startAuth('openai', 'cli');

    expect(startAuth).toHaveBeenCalledOnce();
  });

  it('re-launches CLI auth even when the provider is stuck in a pending checking state if the user forces it', async () => {
    const startAuth = vi.fn(async () => {});
    const adapter = createAdapter({
      getAuthState: async () => ({ authState: 'disconnected', authMode: null, message: 'Disconnected' }),
      startAuth
    });
    const manager = new ProviderManager(createDb() as never, {
      openai: adapter,
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    (
      manager as unknown as {
        pendingAuth: Map<ProviderId, number>;
      }
    ).pendingAuth.set('openai', Date.now());

    await manager.startAuth('openai', 'cli', { force: true });

    expect(startAuth).toHaveBeenCalledOnce();
  });

  it('starts Gemini planner runs in native plan mode', async () => {
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const manager = new ProviderManager(createDb() as never, {
      openai: createAdapter({
        getPlannerCapability: () => ({
          supported: false,
          executionMode: 'read-only',
          enforcement: 'hard-enforced',
          message: 'Unsupported'
        })
      }),
      gemini: createAdapter({
        id: 'gemini',
        label: 'Gemini',
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'full-access',
          enforcement: 'best-effort',
          message: 'Gemini native plan mode'
        }),
        startRun
      })
    });

    await expect(
      manager.submitPlanner({
        projectId: 'project-1',
        prompt: 'Plan a hacker-themed hero section.',
        providerId: 'gemini',
        modelId: 'gemini-2.5-pro',
        executionPermission: 'default',
        skillIds: []
      })
    ).resolves.toEqual(
      expect.objectContaining({
        runId: expect.any(String)
      })
    );

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runMode: 'plan',
        prompt: 'Plan a hacker-themed hero section.',
        modelId: 'gemini-2.5-pro',
        resumeSessionId: null,
        runtimeSkillResources: []
      }),
      expect.any(Object)
    );
  });

  it('passes plan-mode composer runs through the normal execution loop', async () => {
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: null,
          trusted: false
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await expect(
      manager.submitComposer({
        projectId: 'project-1',
        threadId: 'thread-1',
        prompt: 'Shape the next bounded implementation slice.',
        providerId: 'openai',
        modelId: 'gpt-5',
        runMode: 'plan',
        executionPermission: 'default',
        executionConstraints: null,
        skillIds: []
      })
    ).resolves.toEqual(
      expect.objectContaining({
        disposition: 'started'
      })
    );

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runMode: 'plan',
        prompt: 'Shape the next bounded implementation slice.'
      }),
      expect.any(Object)
    );
  });

  it('includes shared workspace and prompt-skill guidance in native planner prompts', async () => {
    const workspace = createWorkspace({
      'SOUL.md': 'Stay sharp and practical.'
    });
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      ),
      listSkills: vi.fn(() => [
        {
          id: 'skill-1',
          name: 'Planner Helper',
          description: 'Shapes planning responses.',
          instructions: 'Always produce a short file-aware implementation plan first.',
          origin: 'user',
          scope: 'global',
          providerTargets: ['gemini'],
          enabled: true,
          projectId: null,
          metadata: {
            attachMode: 'prompt'
          },
          path: null,
          createdAt: '2026-03-14T00:00:00.000Z',
          updatedAt: '2026-03-14T00:00:00.000Z'
        }
      ] satisfies SkillDefinition[])
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({
        id: 'gemini',
        label: 'Gemini',
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'full-access',
          enforcement: 'best-effort',
          message: 'Gemini native plan mode'
        }),
        startRun
      })
    });

    await manager.submitPlanner({
      projectId: 'project-1',
      prompt: 'Plan a landing page refresh.',
      providerId: 'gemini',
      modelId: 'gemini-2.5-pro',
      executionPermission: 'default',
      skillIds: ['skill-1']
    });

    const prompt = startRun.mock.calls[0]?.[0]?.prompt as string;
    expect(prompt).not.toContain('Workspace SOUL.md:\nStay sharp and practical.');
    expect(prompt).toContain('Attached skills:\nThese instructions are already attached to this run.');
    expect(prompt).toContain('## Planner Helper ($planner-helper)');
    expect(prompt).toContain('User request:\nPlan a landing page refresh.');
  });

  it('uses the delegated workspace-context profile for native planner runs', async () => {
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const assemble = vi.fn(() => ({
      folderPath: null,
      trusted: true,
      providerId: 'openai',
      blocks: [],
      memoryBlocks: [],
      generatedMemoryBlocks: [],
      skillBlocks: [],
      runtimeSkillResources: [],
      selectedSkillIds: [],
      mentionedSkillIds: [],
      diagnostics: {
        durationMs: 0,
        workspaceInstructionReadMs: 0,
        skillResolutionMs: 0,
        runtimeSkillResolutionMs: 0,
        memoryRetrievalMs: 0,
        generatedMemoryRetrievalMs: 0,
        blockCount: 0,
        memoryBlockCount: 0,
        generatedMemoryBlockCount: 0,
        skillBlockCount: 0,
        runtimeSkillResourceCount: 0
      }
    }));
    const workspaceContext = { assemble };
    const manager = new ProviderManager(
      createDb() as never,
      {
        openai: createAdapter({
          getPlannerCapability: () => ({
            supported: true,
            executionMode: 'workspace-write',
            enforcement: 'hard-enforced',
            message: 'Codex planner runs through app-server.'
          }),
          startRun
        }),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      },
      workspaceContext as never
    );

    await manager.submitPlanner({
      projectId: 'project-1',
      prompt: 'Plan the implementation.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    expect(assemble).toHaveBeenCalledWith(
      expect.objectContaining({
        contextProfile: 'delegated',
        includeMemory: false,
        includeGeneratedMemory: false
      })
    );
  });

  it('uses the generated-memory preference to control recall for execution runs', async () => {
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const assemble = vi.fn(() => ({
      folderPath: 'C:/workspace',
      trusted: true,
      providerId: 'openai',
      blocks: [],
      memoryBlocks: [],
      generatedMemoryBlocks: [],
      skillBlocks: [],
      runtimeSkillResources: [],
      selectedSkillIds: [],
      mentionedSkillIds: [],
      diagnostics: {
        durationMs: 0,
        workspaceInstructionReadMs: 0,
        skillResolutionMs: 0,
        runtimeSkillResolutionMs: 0,
        memoryRetrievalMs: 0,
        generatedMemoryRetrievalMs: 0,
        blockCount: 0,
        memoryBlockCount: 0,
        generatedMemoryBlockCount: 0,
        skillBlockCount: 0,
        runtimeSkillResourceCount: 0
      }
    }));
    const workspaceContext = { assemble };
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: 'C:/workspace',
          trusted: true
        })
      ),
      getPreferences: vi.fn(() => ({
        selectedProjectId: 'project-1',
        defaultProviderId: 'openai',
        defaultModelByProvider: { openai: 'gpt-5', gemini: 'gemini-2.5-pro', qwen: 'qwen3.5-plus', ollama: 'qwen3', kimi: 'kimi-k2-thinking' },
        defaultReasoningEffortByProvider: { openai: 'high', gemini: null, qwen: null, ollama: null, kimi: null },
        defaultThinkingByProvider: { openai: false, gemini: false, qwen: true, ollama: false, kimi: false },
        ollamaTransportMode: 'chat',
        defaultExecutionPermission: 'default',
        followUpBehavior: 'queue',
        generatedMemoryUseEnabled: true,
        generatedMemoryGenerationEnabled: true,
        appearanceMode: 'system',
        accentMode: 'system',
        accentColor: null,
        onboardingComplete: false,
        lastOpenedThreadId: null,
        microphoneAllowed: false
      }))
    });
    const manager = new ProviderManager(
      db as never,
      {
        openai: createAdapter({ startRun }),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      },
      workspaceContext as never
    );

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Plan the implementation.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    expect(assemble).toHaveBeenCalledWith(
      expect.objectContaining({
        includeGeneratedMemory: true
      })
    );
  });

  it('publishes delegated planner lifecycle progress when native planner questions are requested', async () => {
    const db = createDb();
    const events: AppEvent[] = [];
    const startRun = vi.fn(async (_context, callbacks) => {
      callbacks.onStart();
      callbacks.onInfo({
        message: 'Need one planning decision before continuing.',
        planner: {
          kind: 'questions',
          callId: 'ask-1',
          questions: [
            {
              id: 'direction',
              header: 'Direction',
              question: 'Which direction should the hero take?',
              options: [
                { id: 'subtle', label: 'Subtle', description: 'Minimal cues.' },
                { id: 'bold', label: 'Bold', description: 'Louder treatment.' }
              ],
              recommendedOptionId: 'subtle',
              allowOther: true
            }
          ]
        }
      });
      return {
        runId: 'run-1',
        cancel: async () => {}
        };
      });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'workspace-write',
          enforcement: 'hard-enforced',
          message: 'Codex planner runs through app-server.'
        }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });
    const unsubscribe = manager.onEvent((event) => events.push(event));

    await manager.submitPlanner({
      projectId: 'project-1',
      prompt: 'Plan the implementation.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    unsubscribe();

    const progressEvents = events.filter((event): event is Extract<AppEvent, { type: 'run.progress' }> => event.type === 'run.progress');
    expect(progressEvents.at(-1)?.progress.delegation).toEqual(
      expect.objectContaining({
        mode: 'planner',
        profile: 'delegated',
        phase: 'waiting_for_answers',
        includedContext: ['AGENTS.md', 'codex.md'],
        excludedContext: ['SOUL.md', 'USER.md', 'auto memory']
      })
    );
    expect(progressEvents.at(-1)?.progress.items.map((item) => item.status)).toEqual(['completed', 'blocked', 'pending']);
    expect(
      db.getThread().rawOutput.some(
        (event) =>
          event.eventType === 'info'
          && (event.payload.activity as { kind?: string; summary?: string } | undefined)?.kind === 'delegation'
          && (event.payload.activity as { summary?: string } | undefined)?.summary === 'Delegated planner is waiting for your answers.'
      )
    ).toBe(true);
  });

  it('starts delegated background runs with thin context and visible progress', async () => {
    const db = createDb();
    const events: AppEvent[] = [];
    const startRun = vi.fn(async (_context, callbacks) => {
      callbacks.onStart();
      callbacks.onComplete('Finished the heartbeat task.');
      return {
        runId: 'run-1',
        cancel: async () => {}
      };
    });
    const assemble = vi.fn(() => ({
      folderPath: null,
      trusted: true,
      providerId: 'openai',
      blocks: [],
      memoryBlocks: [],
      skillBlocks: [],
      runtimeSkillResources: [],
      selectedSkillIds: [],
      mentionedSkillIds: [],
      diagnostics: {
        durationMs: 0,
        workspaceInstructionReadMs: 0,
        skillResolutionMs: 0,
        runtimeSkillResolutionMs: 0,
        memoryRetrievalMs: 0,
        blockCount: 0,
        memoryBlockCount: 0,
        skillBlockCount: 0,
        runtimeSkillResourceCount: 0
      }
    }));
    const manager = new ProviderManager(
      db as never,
      {
        openai: createAdapter({ startRun }),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      },
      { assemble } as never
    );
    const unsubscribe = manager.onEvent((event) => events.push(event));

    await manager.startDelegatedBackgroundRun({
      projectId: 'project-1',
      title: 'Autonomy: Verify onboarding copy',
      prompt: 'Work on the heartbeat task.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      delegationProfile: 'heartbeat'
    });

    unsubscribe();

    expect(assemble).toHaveBeenCalledWith(
      expect.objectContaining({
        contextProfile: 'delegated',
        includeMemory: false
      })
    );
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoningEffort: 'low',
        executionConstraints: expect.objectContaining({
          toolPolicy: expect.objectContaining({
            preset: 'subagent'
          }),
          maxDelegationDepth: 0,
          maxSiblingDelegates: 0
        })
      }),
      expect.anything()
    );

    const progressEvents = events.filter((event): event is Extract<AppEvent, { type: 'run.progress' }> => event.type === 'run.progress');
    expect(progressEvents.at(-1)?.progress.delegation).toEqual(
      expect.objectContaining({
        mode: 'background',
        profile: 'heartbeat',
        includedContext: ['AGENTS.md', 'codex.md'],
        excludedContext: ['SOUL.md', 'USER.md', 'auto memory', 'inline thread history']
      })
    );
    expect(progressEvents.at(-1)?.progress.items.map((item) => item.status)).toEqual(['completed', 'completed', 'completed']);
  });

  it('updates delegated planner lifecycle progress when answers resume the active planner run', async () => {
    const db = createDb();
    const events: AppEvent[] = [];
    const replyPlannerQuestions = vi.fn(async () => {});
    const startRun = vi.fn(async (_context, callbacks) => {
      callbacks.onStart();
      callbacks.onInfo({
        planner: {
          kind: 'session',
          sessionId: 'codex-thread-1'
        }
      });
      callbacks.onInfo({
        message: 'Codex planner asked a clarifying question.',
        planner: {
          kind: 'questions',
          sessionId: 'codex-thread-1',
          callId: '101',
          questions: [
            {
              id: 'scope',
              header: 'Scope',
              question: 'How wide should the hero be?',
              options: [
                { id: 'single', label: 'Single viewport', description: 'One strong first screen.' },
                { id: 'multi', label: 'Multiple sections', description: 'Start broader.' }
              ],
              recommendedOptionId: 'single',
              allowOther: true
            }
          ]
        }
      });
      return {
        runId: 'run-1',
        cancel: async () => {}
      };
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'workspace-write',
          enforcement: 'hard-enforced',
          message: 'Codex planner runs through app-server.'
        }),
        startRun,
        replyPlannerQuestions
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });
    const unsubscribe = manager.onEvent((event) => events.push(event));

    await manager.submitPlanner({
      projectId: 'project-1',
      prompt: 'Plan the implementation.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    await manager.answerPlannerQuestions({
      threadId: 'thread-1',
      callId: '101',
      answers: {
        scope: { answers: ['Single viewport'] }
      }
    });

    unsubscribe();

    const progressEvents = events.filter((event): event is Extract<AppEvent, { type: 'run.progress' }> => event.type === 'run.progress');
    expect(progressEvents.at(-1)?.progress.delegation).toEqual(
      expect.objectContaining({
        mode: 'planner',
        phase: 'resuming'
      })
    );
    expect(progressEvents.at(-1)?.progress.items.map((item) => item.status)).toEqual(['completed', 'completed', 'in_progress']);
    expect(replyPlannerQuestions).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        runId: expect.any(String),
        callId: '101'
      })
    );
  });

  it('records a delegated closeout summary and clears planner run state when a native planner proposes a plan', async () => {
    const db = createDb();
    const startRun = vi.fn(async (_context, callbacks) => {
      callbacks.onStart();
      callbacks.onComplete('# Example Plan\n\n## Summary\nPlan ready.');
      return {
        runId: 'run-1',
        cancel: async () => {}
      };
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'workspace-write',
          enforcement: 'hard-enforced',
          message: 'Codex planner runs through app-server.'
        }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitPlanner({
      projectId: 'project-1',
      prompt: 'Plan the implementation.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    const detail = db.getThread();
    expect(
      detail.rawOutput.some(
        (event) =>
          event.eventType === 'info'
          && (event.payload.activity as { kind?: string; summary?: string } | undefined)?.kind === 'delegation'
          && (event.payload.activity as { summary?: string } | undefined)?.summary === 'Delegated planner proposed a plan.'
      )
    ).toBe(true);

    const managerState = manager as unknown as {
      plannerRunsByThread: Map<string, string>;
      runProgressByRun: Map<string, unknown>;
    };
    expect(managerState.plannerRunsByThread.has(detail.id)).toBe(false);
    expect(managerState.runProgressByRun.has('run-1')).toBe(false);
  });

  it('clears an existing planner draft when the user cancels plan review', async () => {
    const db = createDb();
    const thread = db.getThread();
    thread.planner = {
      ...thread.planner,
      composerMode: 'plan',
      turnState: 'plan_ready',
      activePlanId: 'plan-1',
      activePlan: {
        id: 'plan-1',
        threadId: thread.id,
        createdTurnId: 'turn-1',
        proposedPlanMarkdown: '# Example Plan',
        structuredPlan: null,
        status: 'draft',
        createdAt: '2026-03-14T00:00:00.000Z'
      }
    };

    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    const detail = await manager.cancelPlannerSession({ threadId: thread.id });

    expect(db.clearThreadPlannerSession).toHaveBeenCalledWith(thread.id);
    expect(detail.planner.composerMode).toBe('default');
    expect(detail.planner.turnState).toBe('idle');
    expect(detail.planner.activePlanId).toBeNull();
    expect(detail.planner.activePlan).toBeNull();
  });

  it('stops the active planner run before cancelling the planner session', async () => {
    const db = createDb();
    const cancel = vi.fn(async () => {});
    const startRun = vi.fn(async (_context, callbacks) => {
      callbacks.onStart();
      callbacks.onInfo({
        planner: {
          kind: 'questions',
          sessionId: 'codex-thread-1',
          callId: '101',
          questions: [
            {
              id: 'scope',
              header: 'Scope',
              question: 'How wide should the hero be?',
              options: [
                { id: 'single', label: 'Single viewport', description: 'One strong first screen.' },
                { id: 'multi', label: 'Multiple sections', description: 'Start broader.' }
              ],
              recommendedOptionId: 'single',
              allowOther: true
            }
          ]
        }
      });
      return {
        runId: 'run-1',
        cancel
      };
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'workspace-write',
          enforcement: 'hard-enforced',
          message: 'Codex planner runs through app-server.'
        }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitPlanner({
      projectId: 'project-1',
      prompt: 'Plan the implementation.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    const detail = await manager.cancelPlannerSession({ threadId: 'thread-1' });
    const managerState = manager as unknown as {
      plannerRunsByThread: Map<string, string>;
    };

    expect(cancel).toHaveBeenCalledWith('Run stopped by user.');
    expect(db.clearThreadPlannerSession).toHaveBeenCalledWith('thread-1');
    expect(detail.planner.pendingQuestionSet).toBeNull();
    expect(detail.planner.composerMode).toBe('default');
    expect(managerState.plannerRunsByThread.has('thread-1')).toBe(false);
  });

  it('normalizes native planner deltas before persisting the final proposed plan', async () => {
    const db = createDb();
    const startRun = vi.fn(async (_context, callbacks) => {
      callbacks.onStart();
      callbacks.onDelta('# Example Plan\n\nSummary:');
      callbacks.onDelta('Next steps');
      callbacks.onComplete('# Example Plan\n\nSummary:Next steps');
      return {
        runId: 'run-1',
        cancel: async () => {}
      };
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'workspace-write',
          enforcement: 'hard-enforced',
          message: 'Codex planner runs through app-server.'
        }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitPlanner({
      projectId: 'project-1',
      prompt: 'Plan the implementation.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    const persistedDeltas = (db.addRunEvent as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, , eventType]) => eventType === 'delta')
      .map(([, , , payload]) => (payload as { delta: string }).delta);
    expect(persistedDeltas).toEqual([
      '# Example Plan\n\nSummary:',
      ' Next steps'
    ]);
    expect(db.createPlannerPlan).toHaveBeenCalledWith(
      'thread-1',
      expect.any(String),
      '# Example Plan\n\nSummary: Next steps',
      {
        title: 'Example Plan',
        summary: ['Summary: Next steps'],
        keyChanges: [],
        assumptions: [],
        testPlan: []
      }
    );
  });

  it('reconciles raw native planner snapshots in the provider-manager seam before persisting the proposed plan', async () => {
    const db = createDb();
    const startRun = vi.fn(async (_context, callbacks) => {
      callbacks.onStart();
      callbacks.onAssistantSnapshot?.('# Example Plan\n\nSummary:');
      callbacks.onAssistantSnapshot?.('# Example Plan\n\nSummary:Next steps');
      callbacks.onComplete('# Example Plan\n\nSummary:Next steps');
      return {
        runId: 'run-1',
        cancel: async () => {}
      };
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'workspace-write',
          enforcement: 'hard-enforced',
          message: 'Codex planner runs through app-server.'
        }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitPlanner({
      projectId: 'project-1',
      prompt: 'Plan the implementation.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    const persistedDeltas = (db.addRunEvent as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, , eventType]) => eventType === 'delta')
      .map(([, , , payload]) => (payload as { delta: string }).delta);
    expect(persistedDeltas).toEqual([
      '# Example Plan\n\nSummary:',
      ' Next steps'
    ]);
    expect(db.createPlannerPlan).toHaveBeenCalledWith(
      'thread-1',
      expect.any(String),
      '# Example Plan\n\nSummary: Next steps',
      {
        title: 'Example Plan',
        summary: ['Summary: Next steps'],
        keyChanges: [],
        assumptions: [],
        testPlan: []
      }
    );
  });

  it('clears stale planner questions and records a delegated closeout summary when a native planner fails', async () => {
    const db = createDb();
    const startRun = vi.fn(async (_context, callbacks) => {
      callbacks.onStart();
      callbacks.onInfo({
        message: 'Codex planner asked a clarifying question.',
        planner: {
          kind: 'questions',
          callId: 'ask-1',
          questions: [
            {
              id: 'scope',
              header: 'Scope',
              question: 'How wide should the hero be?',
              options: [
                { id: 'single', label: 'Single viewport', description: 'One strong first screen.' },
                { id: 'multi', label: 'Multiple sections', description: 'Start broader.' }
              ],
              recommendedOptionId: 'single',
              allowOther: true
            }
          ]
        }
      });
      callbacks.onError('Planner provider disconnected.');
      return {
        runId: 'run-1',
        cancel: async () => {}
      };
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'workspace-write',
          enforcement: 'hard-enforced',
          message: 'Codex planner runs through app-server.'
        }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitPlanner({
      projectId: 'project-1',
      prompt: 'Plan the implementation.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    const detail = db.getThread();
    expect(detail.planner.pendingQuestionSet).toBeNull();
    expect(detail.planner.pendingQuestionCallId).toBeNull();
    expect(detail.planner.turnState).toBe('idle');
    expect(
      detail.rawOutput.some(
        (event) =>
          event.eventType === 'info'
          && (event.payload.activity as { kind?: string; summary?: string } | undefined)?.kind === 'delegation'
          && (event.payload.activity as { summary?: string } | undefined)?.summary === 'Delegated planner failed.'
      )
    ).toBe(true);

    const managerState = manager as unknown as {
      plannerRunsByThread: Map<string, string>;
      runProgressByRun: Map<string, unknown>;
    };
    expect(managerState.plannerRunsByThread.has(detail.id)).toBe(false);
    expect(managerState.runProgressByRun.has('run-1')).toBe(false);
  });

  it('does not inject Gemini runtime helper hints into the prompt', async () => {
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const db = createDb({
      getSkillsByIds: vi.fn(() => [
        {
          id: 'skill-gemini-extension',
          name: 'Context7',
          description: 'Gemini extension.',
          instructions: 'Use runtime helper.',
          origin: 'provider_native',
          scope: 'global',
          providerTargets: ['gemini'],
          enabled: true,
          projectId: null,
          metadata: {
            providerOrigin: 'gemini',
            kind: 'extension',
            attachMode: 'runtime'
          },
          path: 'C:\\Users\\test-user\\.gemini\\extensions\\context7\\GEMINI.md',
          createdAt: '2026-03-14T00:00:00.000Z',
          updatedAt: '2026-03-14T00:00:00.000Z'
        },
        {
          id: 'skill-openai-runtime',
          name: 'Codex Helper',
          description: 'Other provider helper.',
          instructions: 'Use runtime helper.',
          origin: 'provider_native',
          scope: 'global',
          providerTargets: ['openai'],
          enabled: true,
          projectId: null,
          metadata: {
            providerOrigin: 'openai',
            kind: 'skill',
            attachMode: 'runtime'
          },
          path: 'C:\\Users\\test-user\\.codex\\skills\\helper\\SKILL.md',
          createdAt: '2026-03-14T00:00:00.000Z',
          updatedAt: '2026-03-14T00:00:00.000Z'
        }
      ] satisfies SkillDefinition[])
    });

    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({
        id: 'gemini',
        label: 'Gemini',
        getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with Google' }),
        startRun
      })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Use the helper',
      providerId: 'gemini',
      modelId: 'gemini-2.5-pro',
      executionPermission: 'default',
      skillIds: ['skill-gemini-extension', 'skill-openai-runtime']
    });

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Use the helper',
        runtimeSkillResources: []
      }),
      expect.any(Object)
    );
  });

  it('stores native Gemini planner questions when the CLI emits ask_user', async () => {
    const db = createDb();
    const startRun = vi.fn(async (_context, callbacks) => {
      callbacks.onStart();
      callbacks.onInfo({
        planner: {
          kind: 'session',
          sessionId: 'session-1'
        }
      });
      callbacks.onInfo({
        message: 'Gemini planner asked a clarifying question.',
        planner: {
          kind: 'questions',
          sessionId: 'session-1',
          callId: 'ask-1',
          questions: [
            {
              id: 'direction',
              header: 'Direction',
              question: 'Which direction should the hero take?',
              options: [
                { id: 'subtle', label: 'Subtle', description: 'Minimal cues.' },
                { id: 'bold', label: 'Bold', description: 'Louder treatment.' }
              ],
              recommendedOptionId: 'subtle',
              allowOther: true
            }
          ]
        }
      });
      callbacks.onComplete('');
      return {
        runId: 'run-1',
        cancel: async () => {}
      };
    });

    const manager = new ProviderManager(db as never, {
      openai: createAdapter({
        getPlannerCapability: () => ({
          supported: false,
          executionMode: 'read-only',
          enforcement: 'hard-enforced',
          message: 'Unsupported'
        })
      }),
      gemini: createAdapter({
        id: 'gemini',
        label: 'Gemini',
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'full-access',
          enforcement: 'best-effort'
        }),
        startRun
      })
    });

    await manager.submitPlanner({
      projectId: 'project-1',
      prompt: 'Plan a hacker-themed hero section.',
      providerId: 'gemini',
      modelId: 'gemini-2.5-pro',
      executionPermission: 'default',
      skillIds: []
    });

    expect(db.createPlannerQuestionSet).toHaveBeenCalledWith(
      'thread-1',
      expect.any(String),
      'ask-1',
      expect.any(Array)
    );
    expect(db.getThread().rawOutput.some((event) => (event.payload.planner as { sessionId?: string } | undefined)?.sessionId === 'session-1')).toBe(true);
  });

  it('resumes the Gemini planner session with answered choices', async () => {
    const db = createDb();
    const startRun = vi.fn(async (_context, callbacks) => {
      callbacks.onStart();
      callbacks.onComplete('# Hacker Hero Plan\n\n## Summary\n- Add the section');
      return {
        runId: `run-${startRun.mock.calls.length}`,
        cancel: async () => {}
      };
    });

    const manager = new ProviderManager(db as never, {
      openai: createAdapter({
        getPlannerCapability: () => ({
          supported: false,
          executionMode: 'read-only',
          enforcement: 'hard-enforced',
          message: 'Unsupported'
        })
      }),
      gemini: createAdapter({
        id: 'gemini',
        label: 'Gemini',
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'full-access',
          enforcement: 'best-effort'
        }),
        startRun
      })
    });

    db.getThread().providerId = 'gemini';
    db.getThread().modelId = 'gemini-2.5-pro';
    db.getThread().rawOutput.push({
      id: 'event-session',
      threadId: 'thread-1',
      runId: 'run-session',
      eventType: 'info',
      payload: {
        planner: {
          kind: 'session',
          sessionId: 'session-1'
        }
      },
      createdAt: '2026-03-14T00:00:00.000Z'
    } as never);
    db.getThread().planner.pendingQuestionSet = {
      id: 'question-set-1',
      threadId: 'thread-1',
      promptTurnId: 'turn-1',
      callId: 'ask-1',
      questions: [
        {
          id: 'direction',
          header: 'Direction',
          question: 'Which direction should the hero take?',
          options: [
            { id: 'subtle', label: 'Subtle', description: 'Minimal cues.' },
            { id: 'bold', label: 'Bold', description: 'Louder treatment.' }
          ],
          recommendedOptionId: 'subtle',
          allowOther: true
        }
      ],
      answers: null,
      createdAt: '2026-03-14T00:00:00.000Z'
    } as never;
    db.getThread().planner.pendingQuestionCallId = 'ask-1';
    db.getThread().planner.composerMode = 'plan';
    db.getThread().turns.push({
      id: 'turn-1',
      threadId: 'thread-1',
      runId: null,
      role: 'user',
      content: 'Plan a hacker-themed hero section.',
      metadata: null,
      createdAt: '2026-03-14T00:00:00.000Z'
    } as never);

    await manager.answerPlannerQuestions({
      threadId: 'thread-1',
      callId: 'ask-1',
      answers: {
        direction: { answers: ['Subtle'] }
      }
    });

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runMode: 'plan',
        resumeSessionId: 'session-1',
        prompt: expect.stringContaining('Please continue the native planner using these answers:')
      }),
      expect.any(Object)
    );
    expect(startRun.mock.calls[0]?.[0]?.prompt).toContain('Return the full structured plan now as markdown with:');
    expect(db.createPlannerPlan).toHaveBeenCalledWith(
      'thread-1',
      expect.any(String),
      expect.stringContaining('# Hacker Hero Plan'),
      expect.objectContaining({
        title: 'Hacker Hero Plan'
      })
    );
  });

  it('does not resume persisted Codex planner sessions when starting a fresh native planner run', async () => {
    const db = createDb();
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    db.getThread().rawOutput.push({
      id: 'event-session',
      threadId: 'thread-1',
      runId: 'run-session',
      eventType: 'info',
      payload: {
        planner: {
          kind: 'session',
          sessionId: 'codex-thread-1'
        }
      },
      createdAt: '2026-03-14T00:00:00.000Z'
    } as never);

    const manager = new ProviderManager(db as never, {
      openai: createAdapter({
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'workspace-write',
          enforcement: 'hard-enforced',
          message: 'Codex planner runs through app-server.'
        }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitPlanner({
      projectId: 'project-1',
      threadId: 'thread-1',
      prompt: 'Plan the implementation.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runMode: 'plan',
        resumeSessionId: null
      }),
      expect.any(Object)
    );
  });

  it('starts Codex planner runs in native app-server plan mode', async () => {
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const manager = new ProviderManager(createDb() as never, {
      openai: createAdapter({
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'workspace-write',
          enforcement: 'hard-enforced',
          message: 'Codex planner runs through app-server.'
        }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await expect(
      manager.submitPlanner({
        projectId: 'project-1',
        prompt: 'Plan the implementation.',
        providerId: 'openai',
        modelId: 'gpt-5',
        executionPermission: 'default',
        skillIds: []
      })
    ).resolves.toEqual(
      expect.objectContaining({
        runId: expect.any(String)
      })
    );

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runMode: 'plan',
        prompt: 'Plan the implementation.',
        modelId: 'gpt-5',
        resumeSessionId: null
      }),
      expect.any(Object)
    );
  });

  it('starts Ollama planner runs through the app-owned plan mode', async () => {
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const manager = new ProviderManager(createDb() as never, {
      ollama: createAdapter({
        id: 'ollama',
        label: 'Ollama',
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'workspace-write',
          enforcement: 'best-effort',
          message: 'Ollama planner runs through the app-owned planning mode.'
        }),
        startRun
      })
    } as never);

    await expect(
      manager.submitPlanner({
        projectId: 'project-1',
        prompt: 'Plan the implementation.',
        providerId: 'ollama',
        modelId: 'qwen3-coder',
        executionPermission: 'default',
        skillIds: []
      })
    ).resolves.toEqual(
      expect.objectContaining({
        runId: expect.any(String)
      })
    );

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runMode: 'plan',
        prompt: 'Plan the implementation.',
        modelId: 'qwen3-coder'
      }),
      expect.any(Object)
    );
  });

  it('answers Codex native planner questions in-band on the active planner run', async () => {
    const db = createDb();
    let plannerCallbacks: ProviderRunCallbacks | null = null;
    const replyPlannerQuestions = vi.fn(async () => {});
    const startRun = vi.fn(async (_context, callbacks) => {
      plannerCallbacks = callbacks;
      callbacks.onStart();
      callbacks.onInfo({
        planner: {
          kind: 'session',
          sessionId: 'codex-thread-1'
        }
      });
      callbacks.onInfo({
        message: 'Codex planner asked a clarifying question.',
        planner: {
          kind: 'questions',
          sessionId: 'codex-thread-1',
          callId: '101',
          questions: [
            {
              id: 'scope',
              header: 'Scope',
              question: 'How wide should the hero be?',
              options: [
                { id: 'single', label: 'Single viewport', description: 'One strong first screen.' },
                { id: 'multi', label: 'Multiple sections', description: 'Start broader.' }
              ],
              recommendedOptionId: 'single',
              allowOther: true
            }
          ]
        }
      });
      return {
        runId: 'run-1',
        cancel: async () => {}
      };
    });

    const manager = new ProviderManager(db as never, {
      openai: createAdapter({
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'workspace-write',
          enforcement: 'hard-enforced',
          message: 'Codex planner runs through app-server.'
        }),
        startRun,
        replyPlannerQuestions
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitPlanner({
      projectId: 'project-1',
      prompt: 'Plan the implementation.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    vi.mocked(db.appendTurn).mockClear();

    await manager.answerPlannerQuestions({
      threadId: 'thread-1',
      callId: '101',
      answers: {
        scope: { answers: ['Single viewport'] }
      }
    });

    expect(replyPlannerQuestions).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        runId: expect.any(String),
        callId: '101',
        sessionId: 'codex-thread-1',
        answers: {
          scope: { answers: ['Single viewport'] }
        }
      })
    );
    expect(db.appendTurn).not.toHaveBeenCalled();

    plannerCallbacks?.onComplete('# Example Plan\n\n## Summary\nPlan ready.');

    expect(db.createPlannerPlan).toHaveBeenCalledWith(
      'thread-1',
      expect.any(String),
      '# Example Plan\n\n## Summary\nPlan ready.',
      expect.anything()
    );
  });

  it('restarts Codex planner question answers without reusing persisted Codex session ids', async () => {
    const db = createDb();
    const startRun = vi.fn(async (_context, callbacks) => {
      callbacks.onStart();
      callbacks.onComplete('# Hacker Hero Plan\n\n## Summary\n- Add the section');
      return {
        runId: `run-${startRun.mock.calls.length}`,
        cancel: async () => {}
      };
    });
    db.getThread().rawOutput.push({
      id: 'event-session',
      threadId: 'thread-1',
      runId: 'run-session',
      eventType: 'info',
      payload: {
        planner: {
          kind: 'session',
          sessionId: 'codex-thread-1'
        }
      },
      createdAt: '2026-03-14T00:00:00.000Z'
    } as never);
    db.getThread().planner.pendingQuestionSet = {
      id: 'question-set-1',
      threadId: 'thread-1',
      promptTurnId: 'turn-1',
      callId: 'ask-1',
      questions: [
        {
          id: 'direction',
          header: 'Direction',
          question: 'Which direction should the hero take?',
          options: [
            { id: 'subtle', label: 'Subtle', description: 'Minimal cues.' },
            { id: 'bold', label: 'Bold', description: 'Louder treatment.' }
          ],
          recommendedOptionId: 'subtle',
          allowOther: true
        }
      ],
      answers: null,
      createdAt: '2026-03-14T00:00:00.000Z'
    } as never;
    db.getThread().planner.pendingQuestionCallId = 'ask-1';
    db.getThread().planner.composerMode = 'plan';
    db.getThread().turns.push({
      id: 'turn-1',
      threadId: 'thread-1',
      runId: null,
      role: 'user',
      content: 'Plan a hacker-themed hero section.',
      metadata: null,
      createdAt: '2026-03-14T00:00:00.000Z'
    } as never);

    const manager = new ProviderManager(db as never, {
      openai: createAdapter({
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'workspace-write',
          enforcement: 'hard-enforced',
          message: 'Codex planner runs through app-server.'
        }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.answerPlannerQuestions({
      threadId: 'thread-1',
      callId: 'ask-1',
      answers: {
        direction: { answers: ['Subtle'] }
      }
    });

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runMode: 'plan',
        resumeSessionId: null,
        prompt: expect.stringContaining('Please continue the native planner using these answers:')
      }),
      expect.any(Object)
    );
  });

  it('ignores late provider info callbacks after dispose', async () => {
    const db = createDb();
    let callbacks: ProviderRunCallbacks | null = null;
    const adapter = createAdapter({
      startRun: async (_context, nextCallbacks) => {
        callbacks = nextCallbacks;
        return {
          runId: 'run-1',
          cancel: async () => {}
        };
      }
    });
    const manager = new ProviderManager(db as never, {
      openai: adapter,
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'hello',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: [],
      imageAttachments: []
    });

    expect(callbacks).not.toBeNull();
    vi.mocked(db.addRunEvent).mockClear();

    manager.dispose();
    callbacks?.onInfo('Running npm test');

    expect(db.addRunEvent).not.toHaveBeenCalled();
  });

  it('marks a thread as stopping before provider cancellation resolves', async () => {
    const db = createDb();
    let resolveCancel: (() => void) | null = null;
    const cancel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCancel = resolve;
        })
    );
    const adapter = createAdapter({
      startRun: async (_context, callbacks) => {
        callbacks.onStart();
        return {
          runId: 'run-1',
          cancel
        };
      }
    });
    const manager = new ProviderManager(db as never, {
      openai: adapter,
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    const result = await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'hello',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    const stopPromise = manager.stopRun(result.runId);

    expect(db.updateThreadStatus).toHaveBeenCalledWith('thread-1', 'stopping');
    expect(cancel).toHaveBeenCalledWith('Run stopped by user.');

    resolveCancel?.();
    await stopPromise;
  });

  it('aborts a stale persisted run when stop is requested after the handle is gone', async () => {
    const thread = createThreadDetail({
      status: 'running',
      rawOutput: [
        {
          id: 'event-1',
          threadId: 'thread-1',
          runId: 'run-1',
          eventType: 'started',
          payload: {},
          createdAt: '2026-03-14T00:00:00.000Z'
        }
      ]
    });
    const db = createDb({
      getThread: vi.fn(() => thread),
      getThreadSummary: vi.fn(
        (): ThreadSummary => ({
          id: thread.id,
          projectId: thread.projectId,
          title: thread.title,
          providerId: thread.providerId,
          modelId: thread.modelId,
          executionPermission: thread.executionPermission,
          status: thread.status,
          archived: thread.archived,
          lastMessageAt: thread.lastMessageAt,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          lastPreview: thread.lastPreview
        })
      ),
      findThreadIdByRunId: vi.fn((runId: string) => (runId === 'run-1' ? thread.id : null)),
      addRunEvent: vi.fn((_threadId: string, runId: string, eventType: string, payload: Record<string, unknown>) => {
        const event = {
          id: `event-${thread.rawOutput.length + 1}`,
          threadId: thread.id,
          runId,
          eventType,
          payload,
          createdAt: '2026-03-14T00:00:01.000Z'
        };
        thread.rawOutput.push(event as never);
        return event;
      })
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.stopRun('run-1');

    expect(db.addRunEvent).toHaveBeenCalledWith('thread-1', 'run-1', 'aborted', {
      message: 'Run stopped after the active process was lost.'
    });
    expect(db.updateThreadStatus).toHaveBeenCalledWith('thread-1', 'aborted');
  });

  it('queues a follow-up instead of starting a second run while the thread is active', async () => {
    const thread = createThreadDetail({
      status: 'running',
      rawOutput: [
        {
          id: 'event-1',
          threadId: 'thread-1',
          runId: 'run-1',
          eventType: 'started',
          payload: {},
          createdAt: '2026-03-14T00:00:00.000Z'
        }
      ]
    });
    const startRun = vi.fn(async () => ({
      runId: 'run-2',
      cancel: async () => {}
    }));
    const db = createDb({
      getThread: vi.fn(() => thread)
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    const result = await manager.submitComposer({
      projectId: 'project-1',
      threadId: 'thread-1',
      prompt: 'Queue this next.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    expect(result.disposition).toBe('queued');
    expect(db.createThreadFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        content: 'Queue this next.',
        metadata: expect.objectContaining({
          skillIds: [],
          imageAttachments: [],
          textAttachments: []
        }),
        kind: 'follow_up',
        targetRunId: 'run-1'
      })
    );
    expect(startRun).not.toHaveBeenCalled();
  });

  it('queues a steer, supersedes older steer items, and stops the active run when steering is enabled', async () => {
    const cancel = vi.fn(async () => {});
    const thread = createThreadDetail({
      status: 'running',
      rawOutput: [
        {
          id: 'event-1',
          threadId: 'thread-1',
          runId: 'run-1',
          eventType: 'started',
          payload: {},
          createdAt: '2026-03-14T00:00:00.000Z'
        }
      ]
    });
    const db = createDb({
      getThread: vi.fn(() => thread),
      getThreadSummary: vi.fn(() => ({
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        providerId: thread.providerId,
        modelId: thread.modelId,
        executionPermission: thread.executionPermission,
        status: thread.status,
        archived: thread.archived,
        lastMessageAt: thread.lastMessageAt,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        lastPreview: thread.lastPreview
      })),
      updateThreadStatus: vi.fn((_threadId: string, status: ThreadDetail['status']) => {
        thread.status = status;
      }),
      findThreadIdByRunId: vi.fn(() => 'thread-1')
      ,
      getPreferences: vi.fn(() => ({
        selectedProjectId: 'project-1',
        defaultProviderId: 'openai',
        defaultModelByProvider: { openai: 'gpt-5', gemini: 'gemini-2.5-pro', qwen: 'qwen3.5-plus' },
        defaultReasoningEffortByProvider: { openai: 'high', gemini: null, qwen: null },
        defaultThinkingByProvider: { openai: false, gemini: false, qwen: true },
        ollamaTransportMode: 'chat',
        defaultExecutionPermission: 'default',
        followUpBehavior: 'steer',
        generatedMemoryUseEnabled: false,
        generatedMemoryGenerationEnabled: true,
        appearanceMode: 'system',
        accentMode: 'system',
        accentColor: null,
        onboardingComplete: false,
        lastOpenedThreadId: null,
        microphoneAllowed: false
      }))
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun: async (_context, callbacks) => {
        callbacks.onStart();
        return { runId: 'run-1', cancel };
      } }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' }),
      qwen: createAdapter({ id: 'qwen', label: 'Qwen' })
    });

    (manager as unknown as { runningByThread: Map<string, string>; running: Map<string, ProviderRunHandle> }).runningByThread.set('thread-1', 'run-1');
    (manager as unknown as { running: Map<string, ProviderRunHandle> }).running.set('run-1', { runId: 'run-1', cancel });
    db.createThreadFollowUp({
      threadId: 'thread-1',
      content: 'Older steer',
      kind: 'steer',
      priority: 1,
      targetRunId: 'run-1'
    });

    const result = await manager.submitComposer({
      projectId: 'project-1',
      threadId: 'thread-1',
      prompt: 'Steer toward fixing tests.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    expect(result.disposition).toBe('queued');
    expect(result.queuedFollowUp.kind).toBe('steer');
    expect(result.queuedFollowUp.metadata).toMatchObject({
      condensedQueuedCount: 1
    });
    expect(db.supersedeQueuedFollowUps).toHaveBeenCalledWith({
      threadId: 'thread-1',
      kind: 'steer',
      targetRunId: 'run-1',
      excludeId: result.queuedFollowUp.id
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(db.updateThreadStatus).toHaveBeenCalledWith('thread-1', 'stopping');
    expect(cancel).toHaveBeenCalledWith('Run stopped by user.');
  });

  it('dispatches the next queued follow-up after the active run completes', async () => {
    const queuedSkill: SkillDefinition = {
      id: 'skill-1',
      name: 'Queued Skill',
      description: 'Carries through queued follow-ups.',
      instructions: 'Keep applying the queued skill instructions.',
      origin: 'user',
      scope: 'global',
      providerTargets: ['openai'],
      enabled: true,
      projectId: null,
      metadata: {
        attachMode: 'prompt'
      },
      path: null,
      createdAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z'
    };
    const db = createDb({
      listSkills: vi.fn(() => [queuedSkill]),
      getSkillsByIds: vi.fn(() => [queuedSkill])
    });
    let callbacks: ProviderRunCallbacks | null = null;
    const startRun = vi
      .fn(async (_context, nextCallbacks) => {
        callbacks = nextCallbacks;
        return {
          runId: 'adapter-run',
          cancel: async () => {}
        };
      });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    const started = await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Initial prompt',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: ['skill-1']
    });

    expect(started.disposition).toBe('started');

    const queued = await manager.submitComposer({
      projectId: 'project-1',
      threadId: 'thread-1',
      prompt: 'Run this after completion.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: ['skill-1']
    });

    expect(queued.disposition).toBe('queued');

    callbacks?.onComplete('done');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(db.claimNextThreadFollowUp).toHaveBeenCalledWith('thread-1');
    expect(db.markThreadFollowUpDispatched).toHaveBeenCalledWith(
      expect.stringMatching(/^followup-/u)
    );
    expect(
      startRun.mock.calls.some((call) => String(call[0]?.prompt ?? '').includes('User request:\nRun this after completion.'))
    ).toBe(true);
    expect(
      startRun.mock.calls.find((call) => String(call[0]?.prompt ?? '').includes('User request:\nRun this after completion.'))?.[0]
    ).toEqual(
      expect.objectContaining({
        threadId: 'thread-1',
        prompt: expect.stringContaining('User request:\nRun this after completion.')
      })
    );
    expect(
      db
        .getThread('thread-1')
        .turns.find((turn) => turn.role === 'user' && turn.content === 'Run this after completion.')?.metadata
    ).toEqual(
      expect.objectContaining({
        skillIds: ['skill-1']
      })
    );
  });

  it('dispatches queued follow-ups after a stale persisted stop aborts the lost run', async () => {
    const thread = createThreadDetail({
      status: 'running',
      rawOutput: [
        {
          id: 'event-1',
          threadId: 'thread-1',
          runId: 'run-1',
          eventType: 'started',
          payload: {},
          createdAt: '2026-03-14T00:00:00.000Z'
        }
      ]
    });
    const db = createDb({
      getThread: vi.fn(() => thread),
      getThreadSummary: vi.fn(() => ({
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        providerId: thread.providerId,
        modelId: thread.modelId,
        executionPermission: thread.executionPermission,
        status: thread.status,
        archived: thread.archived,
        lastMessageAt: thread.lastMessageAt,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        lastPreview: thread.lastPreview
      })),
      updateThreadStatus: vi.fn((_threadId: string, status: ThreadDetail['status']) => {
        thread.status = status;
      }),
      findThreadIdByRunId: vi.fn(() => 'thread-1')
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' }),
      qwen: createAdapter({ id: 'qwen', label: 'Qwen' })
    });

    db.createThreadFollowUp({
      threadId: 'thread-1',
      content: 'Resume after stale stop.',
      kind: 'follow_up',
      targetRunId: 'run-1'
    });

    await manager.stopRun('run-1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(db.addRunEvent).toHaveBeenCalledWith('thread-1', 'run-1', 'aborted', {
      message: 'Run stopped after the active process was lost.'
    });
    expect(db.claimNextThreadFollowUp).toHaveBeenCalledWith('thread-1');
  });

  it('renames a new thread with a fallback title when the provider requires full access for app runs', async () => {
    const thread = createThreadDetail({
      providerId: 'kimi',
      modelId: 'kimi-k2-thinking',
      title: 'New thread'
    });
    const db = createDb({
      getThread: vi.fn(() => thread),
      getThreadSummary: vi.fn(() => ({
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        providerId: thread.providerId,
        modelId: thread.modelId,
        executionPermission: thread.executionPermission,
        status: thread.status,
        archived: thread.archived,
        lastMessageAt: thread.lastMessageAt,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        lastPreview: thread.lastPreview
      })),
      createThread: vi.fn(() => thread)
    });
    const startRun = vi.fn(async (_context, callbacks) => {
      callbacks.onStart();
      callbacks.onComplete('done');
      return {
        runId: 'run-1',
        cancel: async () => {}
      };
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' }),
      qwen: createAdapter({ id: 'qwen', label: 'Qwen' }),
      kimi: createAdapter({
        id: 'kimi',
        label: 'Kimi',
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'full-access',
          enforcement: 'best-effort'
        }),
        startRun
      })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Test the app thread rename flow.',
      providerId: 'kimi',
      modelId: 'kimi-k2-thinking',
      executionPermission: 'full_access',
      skillIds: []
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(db.renameThread).toHaveBeenCalledWith('thread-1', 'Test the app thread rename flow.');
  });

  it('records recalled workspace memory as run activity when the run starts', async () => {
    const events: AppEvent[] = [];
    const workspace = createWorkspace({});
    const startRun = vi.fn(async (_context, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const workspaceContext = {
      assemble: () =>
        ({
          folderPath: workspace,
          trusted: true,
          providerId: 'openai',
          blocks: [],
          memoryBlocks: [
            {
              kind: 'memory',
              label: 'Workspace MEMORY.md',
              fileName: 'MEMORY.md',
              path: `${workspace}/MEMORY.md`,
              content: 'Keep dashboard handoffs concise.',
              score: 4
            },
            {
              kind: 'daily_note',
              label: 'Workspace daily note (2026-03-27.md)',
              fileName: '2026-03-27.md',
              path: `${workspace}/memory/2026-03-27.md`,
              content: 'The latest run used shadcn-ready scaffolding.',
              score: 3
            }
          ],
          generatedMemoryBlocks: [],
          skillBlocks: [],
          runtimeSkillResources: [],
          selectedSkillIds: [],
          mentionedSkillIds: [],
          diagnostics: {
            durationMs: 0,
            workspaceInstructionReadMs: 0,
            skillResolutionMs: 0,
            runtimeSkillResolutionMs: 0,
            memoryRetrievalMs: 0,
            generatedMemoryRetrievalMs: 0,
            blockCount: 0,
            memoryBlockCount: 2,
            generatedMemoryBlockCount: 0,
            skillBlockCount: 0,
            runtimeSkillResourceCount: 0
          }
        }) satisfies WorkspaceContextResult
    };
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(
      db as never,
      {
        openai: createAdapter({ startRun }),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      },
      workspaceContext as never
    );

    manager.onEvent((event) => events.push(event));

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Refine the landing page.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    const memoryRecallEvent = events.find((event) => {
      if (event.type !== 'raw.event') {
        return false;
      }
      const payload = (event.event as { payload?: { activity?: { kind?: string; summary?: string; text?: string } } }).payload;
      return payload?.activity?.kind === 'memory_recall';
    });

    expect(memoryRecallEvent).toBeDefined();
    expect((memoryRecallEvent as { event: { payload: { activity: { summary: string; text: string } } } }).event.payload.activity)
      .toEqual(
        expect.objectContaining({
          summary: 'Recalled 2 workspace memory entries',
          text: 'Included MEMORY.md, 2026-03-27.md in the active prompt context.'
        })
      );
  });

  it('keeps generated workspace recall separate in the prompt and activity text', async () => {
    const events: AppEvent[] = [];
    const workspace = createWorkspace({});
    const startRun = vi.fn(async (_context, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const workspaceContext = {
      assemble: () =>
        ({
          folderPath: workspace,
          trusted: true,
          providerId: 'openai',
          blocks: [],
          memoryBlocks: [
            {
              kind: 'memory',
              label: 'Workspace MEMORY.md',
              fileName: 'MEMORY.md',
              path: `${workspace}/MEMORY.md`,
              content: 'Keep dashboard handoffs concise.',
              score: 4
            }
          ],
          generatedMemoryBlocks: [
            {
              itemId: 'generated-1',
              kind: 'known_pitfall',
              label: 'Generated Workspace Recall (Derived, Non-Canonical)',
              summary: 'Use npm run smoke from the workspace root.',
              detail: 'Trusted recent threads converged on the workspace-root smoke command.',
              authority: 'derived_noncanonical',
              sourceThreadIds: ['thread-1'],
              evidenceCount: 2,
              score: 3,
              retrievalReason: {
                kindGate: ['workflow_intent'],
                matchedTerms: ['smoke'],
                rank: 1
              }
            }
          ],
          skillBlocks: [],
          runtimeSkillResources: [],
          selectedSkillIds: [],
          mentionedSkillIds: [],
          diagnostics: {
            durationMs: 0,
            workspaceInstructionReadMs: 0,
            skillResolutionMs: 0,
            runtimeSkillResolutionMs: 0,
            memoryRetrievalMs: 0,
            generatedMemoryRetrievalMs: 0,
            blockCount: 0,
            memoryBlockCount: 1,
            generatedMemoryBlockCount: 1,
            skillBlockCount: 0,
            runtimeSkillResourceCount: 0
          }
        }) satisfies WorkspaceContextResult
    };
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(
      db as never,
      {
        openai: createAdapter({ startRun }),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      },
      workspaceContext as never
    );

    manager.onEvent((event) => events.push(event));

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Refine the landing page.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    const startContext = startRun.mock.calls[0]?.[0] as { prompt?: string } | undefined;
    expect(startContext?.prompt).toContain('Relevant workspace memory:');
    expect(startContext?.prompt).toContain('### MEMORY.md');
    expect(startContext?.prompt).toContain('Generated Workspace Recall (Derived, Non-Canonical):');
    expect(startContext?.prompt).toContain('Summary: Use npm run smoke from the workspace root.');
    expect(startContext?.prompt).not.toContain('Relevant workspace memory:\n### Use npm run smoke from the workspace root.');

    const memoryRecallEvent = events.find((event) => {
      if (event.type !== 'raw.event') {
        return false;
      }
      const payload = (event.event as { payload?: { activity?: { kind?: string; summary?: string; text?: string } } }).payload;
      return payload?.activity?.kind === 'memory_recall';
    });

    expect((memoryRecallEvent as { event: { payload: { activity: { summary: string; text: string } } } }).event.payload.activity)
      .toEqual(
        expect.objectContaining({
          summary: 'Recalled workspace memory from MEMORY.md and Recalled 1 generated workspace recall entry',
          text: 'Included MEMORY.md and included 1 derived non-canonical workspace recall entry in the active prompt context.'
        })
      );
  });

  it('lists provider descriptors with provider-specific planner policy without leaking adapter internals', async () => {
    const manager = new ProviderManager(createDb() as never, {
      openai: createAdapter({
        getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected' }),
        discoverRuntimeModels: async () => [createProviderModel('gpt-5.4', 'GPT-5.4')],
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'workspace-write',
          enforcement: 'hard-enforced',
          message: 'Codex planner runs through app-server.'
        })
      }),
      gemini: createAdapter({
        id: 'gemini',
        label: 'Gemini',
        listStaticModels: () => [createProviderModel('gemini-2.5-pro', 'Gemini 2.5 Pro')],
        getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected' }),
        discoverRuntimeModels: async () => [createProviderModel('gemini-2.5-pro', 'Gemini 2.5 Pro')],
        getPlannerCapability: () => ({
          supported: true,
          executionMode: 'full-access',
          enforcement: 'best-effort',
          message: 'Gemini planner runs through the native plan mode.'
        })
      })
    });

    const providers = await manager.listProviders();
    const openai = providers.find((provider) => provider.id === 'openai');
    const gemini = providers.find((provider) => provider.id === 'gemini');

    expect(openai).toMatchObject({
      plannerPolicy: {
        supported: true,
        executionMode: 'workspace-write',
        enforcement: 'hard-enforced',
        message: 'Codex planner runs through app-server.'
      }
    });
    expect(gemini).toMatchObject({
      plannerPolicy: {
        supported: true,
        executionMode: 'full-access',
        enforcement: 'best-effort',
        message: 'Gemini planner runs through the native plan mode.'
      }
    });
    expect(openai?.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'gpt-5.4', label: 'GPT-5.4' })
      ])
    );
    expect(gemini?.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' })
      ])
    );
    expect(openai).not.toHaveProperty('startRun');
    expect(gemini).not.toHaveProperty('startRun');
  });
});
