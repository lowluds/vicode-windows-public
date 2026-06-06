import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ProviderAdapter, ProviderRunCallbacks, ProviderRunContext, ProviderRunHandle } from '../../providers/types';
import type { StagedWorkspaceChangeSet, StagedWorkspaceOperation } from '../../providers/agent-runtime';
import { createRuntime as createOllamaRuntime, createStreamResponse } from '../../providers/ollama/adapter-test-helpers';
import type {
  Project,
  CustomProviderSettings,
  ProviderAccount,
  ProviderDescriptor,
  ProviderId,
  RunChangeArtifact,
  ProviderModel,
  SkillDefinition,
  ThreadDetail,
  ThreadSummary
} from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import { parseRunChangeHunks } from '../../shared/hunk-review';
import { ProviderManager } from './provider-manager';
import { AgentRuntimeService } from './agent-runtime';
import { OllamaRuntimeService } from './ollama-runtime';
import type { HarnessWorktreeSession } from './harness-worktree-session';
import { getProviderFallbackModels } from '../../providers/catalog';
import { encodeCustomProviderModelId } from '../../shared/custom-provider-routing';
import type { WorkspaceContextResult } from './workspace-context';
import { promptRequiresAttachedWorkspace } from '../../shared/workspace-run-guard';

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
        kimi: 'kimi-k2-thinking',
        openai_compatible: 'openai-compatible'
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
    validateProjectContext: () => ({ valid: true }),
    startRun: async () =>
      ({
        runId: 'run-1',
        cancel: async () => {}
      }) satisfies ProviderRunHandle,
    ...overrides
  };
}

function createPreferences(overrides: Record<string, unknown> = {}) {
  return {
    selectedProjectId: 'project-1',
    defaultProviderId: 'openai',
    defaultModelByProvider: { openai: 'gpt-5', gemini: 'gemini-2.5-pro', qwen: 'qwen3.5-plus', ollama: 'qwen3', kimi: 'kimi-k2-thinking', openai_compatible: 'openai-compatible' },
    defaultReasoningEffortByProvider: { openai: 'high', gemini: null, qwen: null, ollama: null, kimi: null, openai_compatible: null },
    defaultThinkingByProvider: { openai: false, gemini: false, qwen: true, ollama: false, kimi: false, openai_compatible: false },
    ollamaTransportMode: 'legacy',
    defaultExecutionPermission: 'default',
    followUpBehavior: 'queue',
    generatedMemoryUseEnabled: false,
    generatedMemoryGenerationEnabled: true,
    appearanceMode: 'system',
    accentMode: 'system',
    accentColor: null,
    onboardingComplete: false,
    lastOpenedThreadId: null,
    microphoneAllowed: false,
    userLibraryPath: null,
    skillsLibraryPath: null,
    llmWikiLibraryPath: null,
    ...overrides
  };
}

function createDb(overrides: Record<string, unknown> = {}) {
  const thread = createThreadDetail();
  const followUps: Array<ThreadDetail['followUps'][number]> = [];
  let nextTurnId = 1;

  return {
    getProviderAccount: vi.fn(() => null),
    getPreferences: vi.fn(() => createPreferences()),
    saveProviderAccount: vi.fn((account: ProviderAccount) => account),
    getProviderModelCache: vi.fn(() => ({ models: [], updatedAt: null, source: null })),
    listCustomProviders: vi.fn(() => []),
    getCustomProvider: vi.fn((providerId: string) => {
      throw new Error(`Custom provider not found: ${providerId}`);
    }),
    replaceProviderModels: vi.fn(),
    clearProviderModelCache: vi.fn(),
    getProject: vi.fn(() => createProject()),
    createThread: vi.fn(() => thread),
    getThread: vi.fn(() => thread),
    getLatestThreadCompaction: vi.fn(() => null),
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
    approvePlannerPlan: vi.fn((_threadId: string, planId: string) => {
      const currentPlan = thread.planner.activePlan ?? {
        id: planId,
        threadId: thread.id,
        createdTurnId: 'turn-plan',
        proposedPlanMarkdown: '# Approved Plan',
        structuredPlan: null,
        status: 'draft',
        createdAt: '2026-03-14T00:00:00.000Z'
      };
      const approvedPlan = {
        ...currentPlan,
        id: planId,
        status: 'approved'
      };
      thread.planner = {
        ...thread.planner,
        composerMode: 'default',
        turnState: 'executing_from_plan',
        activePlanId: planId,
        activePlan: approvedPlan as never,
        pendingQuestionCallId: null
      };
      return approvedPlan;
    }),
    getPlannerPlan: vi.fn((planId: string) => {
      if (thread.planner.activePlan?.id === planId) {
        return thread.planner.activePlan;
      }
      throw new Error(`Planner plan not found: ${planId}`);
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

  function createStagedWorkspaceChangeSet(operations: StagedWorkspaceOperation[]): StagedWorkspaceChangeSet {
    return {
      threadId: 'thread-1',
      runId: 'run-1',
      sourceToolName: operations.length === 1 && operations[0]?.operation === 'write_file' ? 'write_file' : 'apply_patch',
      isolationMode: 'patch_buffer',
      status: 'proposed',
      requestedPath: null,
      changedPaths: operations.map((operation) => operation.path),
      operations,
      summary: {
        filesChanged: operations.filter((operation) => operation.operation !== 'mkdir').length,
        insertions: 1,
        deletions: 1
      }
    };
  }

  function createHarnessWorktreeSession(overrides: Partial<HarnessWorktreeSession> = {}): HarnessWorktreeSession {
    const sourceWorkspaceRoot = overrides.sourceWorkspaceRoot ?? 'C:\\workspace';
    const worktreeWorkspaceRoot = overrides.worktreeWorkspaceRoot ?? 'C:\\vicode-worktrees\\project-1\\run-1';

    return {
      threadId: 'thread-1',
      runId: 'run-1',
      projectId: 'project-1',
      sourceRepoRoot: sourceWorkspaceRoot,
      sourceWorkspaceRoot,
      sourceWorkspaceRelativePath: '.',
      worktreeRepoRoot: worktreeWorkspaceRoot,
      worktreeWorkspaceRoot,
      branchName: 'vicode/worktree/project-1/run-1',
      baseRef: 'HEAD',
      baseSha: 'abc123',
      status: 'ready',
      cleanupPolicy: 'preserve_until_review',
      reviewStatus: 'pending',
      createdAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
      errorReason: null,
      ...overrides
    };
  }

  function addStagedWorkspaceChangeEvent(thread: ThreadDetail, changeSet: StagedWorkspaceChangeSet, id = 'event-staged') {
    thread.rawOutput.push({
      id,
      threadId: thread.id,
      runId: changeSet.runId ?? 'run-1',
      eventType: 'info',
      payload: {
        eventKind: 'debug_detail',
        transcriptVisible: false,
        stagedWorkspaceChangeSet: changeSet
      },
      createdAt: '2026-03-14T00:00:00.000Z'
    });
  }

  function addStagedWorkspaceReviewDecisionEvent(
    thread: ThreadDetail,
    stagedEventId: string,
    action: 'applied' | 'rejected',
    status: 'applied' | 'rejected' | 'failed'
  ) {
    thread.rawOutput.push({
      id: `decision-${action}-${status}`,
      threadId: thread.id,
      runId: 'run-1',
      eventType: 'info',
      payload: {
        eventKind: 'debug_detail',
        transcriptVisible: false,
        stagedWorkspaceReviewDecision: {
          action,
          status,
          threadId: thread.id,
          runId: 'run-1',
          stagedEventId,
          stagedEventIndex: 0,
          sourceToolName: 'write_file',
          isolationMode: 'patch_buffer',
          changedPaths: ['src/example.txt'],
          operationKinds: ['write_file'],
          errorReason: status === 'failed' ? 'Prior review action failed.' : null,
          createdAt: '2026-03-14T00:00:01.000Z'
        }
      },
      createdAt: '2026-03-14T00:00:01.000Z'
    });
  }

  function addStagedWorkspaceHunkReviewDecisionEvent(
    thread: ThreadDetail,
    stagedEventId: string,
    hunkIds: string[],
    acceptedHunkIds: string[],
    rejectedHunkIds: string[],
    action: 'applied' | 'rejected' | 'reverted' = 'applied',
    status: 'applied' | 'rejected' | 'reverted' | 'failed' = 'applied'
  ) {
    thread.rawOutput.push({
      id: `hunk-decision-${action}-${status}`,
      threadId: thread.id,
      runId: 'run-1',
      eventType: 'info',
      payload: {
        eventKind: 'debug_detail',
        transcriptVisible: false,
        stagedWorkspaceHunkReviewDecision: {
          action,
          status,
          threadId: thread.id,
          runId: 'run-1',
          source: 'staged_workspace_preview',
          isolationMode: 'patch_buffer',
          stagedEventId,
          stagedEventIndex: 0,
          changedPaths: ['src/example.txt'],
          hunkIds,
          acceptedHunkIds,
          rejectedHunkIds,
          filesChanged: 1,
          insertions: 1,
          deletions: 1,
          errorReason: status === 'failed' ? 'Prior staged hunk action failed.' : null,
          createdAt: '2026-03-14T00:00:01.000Z'
        }
      },
      createdAt: '2026-03-14T00:00:01.000Z'
    });
  }

  function addWorktreeSessionEvent(thread: ThreadDetail, session: HarnessWorktreeSession) {
    thread.rawOutput.push({
      id: 'event-worktree-session',
      threadId: thread.id,
      runId: session.runId,
      eventType: 'info',
      payload: {
        runtimeTrace: {
          stage: 'worktree_session_created',
          at: '2026-03-14T00:00:00.000Z',
          detail: {
            sourceWorkspaceRoot: session.sourceWorkspaceRoot,
            runtimeWorkspaceRoot: session.worktreeWorkspaceRoot,
            harnessWorktreeSession: session
          }
        }
      },
      createdAt: '2026-03-14T00:00:00.000Z'
    });
  }

  function addWorktreeChangeArtifactEvent(thread: ThreadDetail, artifact: RunChangeArtifact) {
    thread.rawOutput.push({
      id: 'event-worktree-change',
      threadId: thread.id,
      runId: 'run-1',
      eventType: 'info',
      payload: {
        activity: {
          kind: 'change_summary',
          summary: `${artifact.summary.filesChanged} files changed`,
          changeArtifact: artifact
        }
      },
      createdAt: '2026-03-14T00:00:01.000Z'
    });
  }

  function addWorktreeReviewDecisionEvent(thread: ThreadDetail, action: 'applied' | 'rejected' | 'reverted', status: 'applied' | 'rejected' | 'reverted' | 'failed') {
    thread.rawOutput.push({
      id: `event-worktree-review-${action}-${status}`,
      threadId: thread.id,
      runId: 'run-1',
      eventType: 'info',
      payload: {
        eventKind: 'debug_detail',
        transcriptVisible: false,
        worktreeReviewDecision: {
          action,
          status,
          threadId: thread.id,
          runId: 'run-1',
          isolationMode: 'git_worktree',
          branchName: 'vicode/worktree/project-1/run-1',
          baseSha: 'abc123',
          sourceWorkspaceRelativePath: '.',
          changedPaths: ['src/example.txt'],
          filesChanged: 1,
          insertions: 1,
          deletions: 1,
          errorReason: status === 'failed' ? 'Prior worktree review action failed.' : null,
          createdAt: '2026-03-14T00:00:02.000Z'
        }
      },
      createdAt: '2026-03-14T00:00:02.000Z'
    });
  }

  it('reports active runs while a provider handle is registered', async () => {
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }) satisfies ProviderRunHandle);
    const db = createDb();
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({
        getAuthState: async () => ({ authState: 'connected', authMode: 'api_key', message: 'OpenAI is ready.' }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    expect(manager.hasActiveRuns()).toBe(false);

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Keep this run open.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    expect(startRun).toHaveBeenCalledOnce();
    expect(manager.hasActiveRuns()).toBe(true);
  });

  it('applies staged workspace changes through the project workspace and returns sanitized review evidence', async () => {
    const workspaceRoot = createWorkspace({
      'src/example.txt': 'before-secret-token\n'
    });
    const db = createDb({
      getProject: vi.fn(() => createProject({ folderPath: workspaceRoot }))
    });
    const thread = db.getThread('thread-1') as ThreadDetail;
    addStagedWorkspaceChangeEvent(thread, createStagedWorkspaceChangeSet([
      {
        operation: 'write_file',
        path: 'src/example.txt',
        beforeContent: 'before-secret-token\n',
        proposedAfterContent: 'after-secret-token\n',
        patchText: 'patch-secret-token'
      }
    ]));
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    const result = await manager.applyStagedWorkspaceChange({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });

    expect(readFileSync(join(workspaceRoot, 'src/example.txt'), 'utf8')).toBe('after-secret-token\n');
    expect(result.decision).toMatchObject({
      action: 'applied',
      status: 'applied',
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      changedPaths: ['src/example.txt'],
      operationKinds: ['write_file'],
      errorReason: null
    });
    expect(result.thread.rawOutput.at(-1)?.payload).toMatchObject({
      stagedWorkspaceReviewDecision: expect.objectContaining({
        action: 'applied',
        status: 'applied'
      })
    });
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain('before-secret-token');
    expect(resultJson).not.toContain('after-secret-token');
    expect(resultJson).not.toContain('patch-secret-token');
  });

  it('reverts applied staged workspace changes through the project workspace and returns sanitized review evidence', async () => {
    const workspaceRoot = createWorkspace({
      'src/example.txt': 'after-secret-token\n'
    });
    const db = createDb({
      getProject: vi.fn(() => createProject({ folderPath: workspaceRoot }))
    });
    const thread = db.getThread('thread-1') as ThreadDetail;
    addStagedWorkspaceChangeEvent(thread, createStagedWorkspaceChangeSet([
      {
        operation: 'write_file',
        path: 'src/example.txt',
        beforeContent: 'before-secret-token\n',
        proposedAfterContent: 'after-secret-token\n',
        patchText: 'patch-secret-token'
      }
    ]));
    addStagedWorkspaceReviewDecisionEvent(thread, 'event-staged', 'applied', 'applied');
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    const result = await manager.revertStagedWorkspaceChange({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });

    expect(readFileSync(join(workspaceRoot, 'src/example.txt'), 'utf8')).toBe('before-secret-token\n');
    expect(result.decision).toMatchObject({
      action: 'reverted',
      status: 'reverted',
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      changedPaths: ['src/example.txt'],
      operationKinds: ['write_file'],
      errorReason: null
    });
    expect(result.thread.rawOutput.at(-1)?.payload).toMatchObject({
      stagedWorkspaceReviewDecision: expect.objectContaining({
        action: 'reverted',
        status: 'reverted'
      })
    });
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain('before-secret-token');
    expect(resultJson).not.toContain('after-secret-token');
    expect(resultJson).not.toContain('patch-secret-token');
  });

  it('rejects staged workspace changes without mutating the project workspace', async () => {
    const workspaceRoot = createWorkspace({
      'src/example.txt': 'keep me\n'
    });
    const db = createDb({
      getProject: vi.fn(() => createProject({ folderPath: workspaceRoot }))
    });
    const thread = db.getThread('thread-1') as ThreadDetail;
    addStagedWorkspaceChangeEvent(thread, createStagedWorkspaceChangeSet([
      {
        operation: 'write_file',
        path: 'src/example.txt',
        beforeContent: 'keep me\n',
        proposedAfterContent: 'changed\n',
        patchText: null
      }
    ]));
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    const result = await manager.rejectStagedWorkspaceChange({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventIndex: 0
    });

    expect(readFileSync(join(workspaceRoot, 'src/example.txt'), 'utf8')).toBe('keep me\n');
    expect(result.decision).toMatchObject({
      action: 'rejected',
      status: 'rejected',
      stagedEventId: 'event-staged',
      stagedEventIndex: 0,
      changedPaths: ['src/example.txt']
    });
    expect(JSON.stringify(result)).not.toContain('changed\n');
  });

  it('returns a staged workspace preview artifact without exposing patch text', async () => {
    const workspaceRoot = createWorkspace({
      'src/example.txt': 'before-secret-token\n'
    });
    const db = createDb({
      getProject: vi.fn(() => createProject({ folderPath: workspaceRoot }))
    });
    const thread = db.getThread('thread-1') as ThreadDetail;
    addStagedWorkspaceChangeEvent(thread, createStagedWorkspaceChangeSet([
      {
        operation: 'write_file',
        path: 'src/example.txt',
        beforeContent: 'before-secret-token\n',
        proposedAfterContent: 'after-secret-token\n',
        patchText: 'patch-secret-token'
      }
    ]));
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    const artifact = await manager.previewStagedWorkspaceChange({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });

    expect(readFileSync(join(workspaceRoot, 'src/example.txt'), 'utf8')).toBe('before-secret-token\n');
    expect(artifact).toMatchObject({
      source: 'staged_workspace_preview',
      summary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 1
      },
      files: [
        expect.objectContaining({
          path: 'src/example.txt',
          status: 'modified',
          beforeContent: 'before-secret-token\n',
          afterContent: 'after-secret-token\n'
        })
      ]
    });
    expect(JSON.stringify(artifact)).not.toContain('patch-secret-token');
  });

  it('applies selected staged workspace hunks through the project workspace and returns sanitized evidence', async () => {
    const beforeContent = [
      'line 1',
      'line 2 before-secret-token',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      'line 9',
      'line 10 before-secret-token',
      'line 11'
    ].join('\n') + '\n';
    const afterContent = beforeContent
      .replace('line 2 before-secret-token', 'line 2 after-secret-token')
      .replace('line 10 before-secret-token', 'line 10 after-secret-token');
    const workspaceRoot = createWorkspace({
      'src/example.txt': beforeContent
    });
    const db = createDb({
      getProject: vi.fn(() => createProject({ folderPath: workspaceRoot }))
    });
    const thread = db.getThread('thread-1') as ThreadDetail;
    addStagedWorkspaceChangeEvent(thread, createStagedWorkspaceChangeSet([
      {
        operation: 'apply_patch',
        path: 'src/example.txt',
        beforeContent,
        proposedAfterContent: afterContent,
        patchText: 'patch-secret-token'
      }
    ]));
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });
    const preview = await manager.previewStagedWorkspaceChange({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });
    const [acceptedHunk, rejectedHunk] = parseRunChangeHunks(preview).hunks;

    const result = await manager.applyStagedWorkspaceHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      acceptedHunkIds: [acceptedHunk!.id],
      rejectedHunkIds: [rejectedHunk!.id]
    });

    expect(readFileSync(join(workspaceRoot, 'src/example.txt'), 'utf8')).toBe(
      beforeContent.replace('line 2 before-secret-token', 'line 2 after-secret-token')
    );
    expect(result.decision).toMatchObject({
      action: 'applied',
      status: 'applied',
      source: 'staged_workspace_preview',
      isolationMode: 'patch_buffer',
      stagedEventId: 'event-staged',
      hunkIds: [acceptedHunk!.id, rejectedHunk!.id],
      acceptedHunkIds: [acceptedHunk!.id],
      rejectedHunkIds: [rejectedHunk!.id],
      changedPaths: ['src/example.txt'],
      errorReason: null
    });
    expect(result.thread.rawOutput.at(-1)?.payload).toMatchObject({
      stagedWorkspaceHunkReviewDecision: expect.objectContaining({
        action: 'applied',
        status: 'applied',
        acceptedHunkIds: [acceptedHunk!.id],
        rejectedHunkIds: [rejectedHunk!.id]
      })
    });
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain('before-secret-token');
    expect(resultJson).not.toContain('after-secret-token');
    expect(resultJson).not.toContain('patch-secret-token');
  });

  it('rejects selected staged workspace hunks without mutating the project workspace', async () => {
    const workspaceRoot = createWorkspace({
      'src/example.txt': 'before\n'
    });
    const db = createDb({
      getProject: vi.fn(() => createProject({ folderPath: workspaceRoot }))
    });
    const thread = db.getThread('thread-1') as ThreadDetail;
    addStagedWorkspaceChangeEvent(thread, createStagedWorkspaceChangeSet([
      {
        operation: 'write_file',
        path: 'src/example.txt',
        beforeContent: 'before\n',
        proposedAfterContent: 'after\n',
        patchText: null
      }
    ]));
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });
    const preview = await manager.previewStagedWorkspaceChange({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });
    const hunkIds = parseRunChangeHunks(preview).hunks.map((hunk) => hunk.id);

    const result = await manager.rejectStagedWorkspaceHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged',
      hunkIds
    });

    expect(readFileSync(join(workspaceRoot, 'src/example.txt'), 'utf8')).toBe('before\n');
    expect(result.decision).toMatchObject({
      action: 'rejected',
      status: 'rejected',
      hunkIds,
      acceptedHunkIds: [],
      rejectedHunkIds: hunkIds,
      changedPaths: ['src/example.txt']
    });
    expect(JSON.stringify(result)).not.toContain('after\n');
  });

  it('reverts applied staged workspace hunks through the project workspace', async () => {
    const beforeContent = [
      'line 1',
      'line 2 before-secret-token',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      'line 9',
      'line 10 before-secret-token',
      'line 11'
    ].join('\n') + '\n';
    const partialContent = beforeContent.replace('line 2 before-secret-token', 'line 2 after-secret-token');
    const afterContent = partialContent.replace('line 10 before-secret-token', 'line 10 after-secret-token');
    const workspaceRoot = createWorkspace({
      'src/example.txt': partialContent
    });
    const db = createDb({
      getProject: vi.fn(() => createProject({ folderPath: workspaceRoot }))
    });
    const thread = db.getThread('thread-1') as ThreadDetail;
    addStagedWorkspaceChangeEvent(thread, createStagedWorkspaceChangeSet([
      {
        operation: 'apply_patch',
        path: 'src/example.txt',
        beforeContent,
        proposedAfterContent: afterContent,
        patchText: 'patch-secret-token'
      }
    ]));
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });
    const preview = await manager.previewStagedWorkspaceChange({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });
    const [acceptedHunk, rejectedHunk] = parseRunChangeHunks(preview).hunks;
    addStagedWorkspaceHunkReviewDecisionEvent(
      thread,
      'event-staged',
      [acceptedHunk!.id, rejectedHunk!.id],
      [acceptedHunk!.id],
      [rejectedHunk!.id]
    );

    const result = await manager.revertStagedWorkspaceHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    });

    expect(readFileSync(join(workspaceRoot, 'src/example.txt'), 'utf8')).toBe(beforeContent);
    expect(result.decision).toMatchObject({
      action: 'reverted',
      status: 'reverted',
      acceptedHunkIds: [acceptedHunk!.id],
      rejectedHunkIds: [rejectedHunk!.id],
      changedPaths: ['src/example.txt']
    });
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain('before-secret-token');
    expect(resultJson).not.toContain('after-secret-token');
    expect(resultJson).not.toContain('patch-secret-token');
  });

  it('fails staged workspace apply when the project workspace folder is unavailable', async () => {
    const missingWorkspaceRoot = join(createWorkspace({}), 'missing');
    const db = createDb({
      getProject: vi.fn(() => createProject({ folderPath: missingWorkspaceRoot }))
    });
    const thread = db.getThread('thread-1') as ThreadDetail;
    addStagedWorkspaceChangeEvent(thread, createStagedWorkspaceChangeSet([
      {
        operation: 'write_file',
        path: 'src/example.txt',
        beforeContent: null,
        proposedAfterContent: 'new file\n',
        patchText: null
      }
    ]));
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await expect(manager.applyStagedWorkspaceChange({
      threadId: 'thread-1',
      runId: 'run-1',
      stagedEventId: 'event-staged'
    })).rejects.toThrow(`Workspace folder is unavailable: ${missingWorkspaceRoot}.`);
    expect(existsSync(join(missingWorkspaceRoot, 'src/example.txt'))).toBe(false);
  });

  it('applies worktree changes through the provider manager and returns sanitized review evidence', async () => {
    const sourceWorkspaceRoot = createWorkspace({
      'src/example.txt': 'before-secret-token\n'
    });
    const db = createDb();
    const thread = db.getThread('thread-1') as ThreadDetail;
    const session = createHarnessWorktreeSession({
      sourceRepoRoot: sourceWorkspaceRoot,
      sourceWorkspaceRoot,
      worktreeRepoRoot: join(sourceWorkspaceRoot, '..', 'app-owned-worktree'),
      worktreeWorkspaceRoot: join(sourceWorkspaceRoot, '..', 'app-owned-worktree'),
      sourceWorkspaceRelativePath: '.'
    });
    addWorktreeSessionEvent(thread, session);
    addWorktreeChangeArtifactEvent(thread, {
      source: 'worktree_diff',
      summary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 1
      },
      files: [
        {
          path: 'src/example.txt',
          status: 'modified',
          insertions: 1,
          deletions: 1,
          beforeContent: 'before-secret-token\n',
          afterContent: 'after-secret-token\n',
          previewLines: ['-before-secret-token', '+after-secret-token'],
          previewTruncated: false
        }
      ]
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });
    const events: AppEvent[] = [];
    manager.onEvent((event) => events.push(event));

    const result = await manager.applyWorktreeReview({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(readFileSync(join(sourceWorkspaceRoot, 'src/example.txt'), 'utf8')).toBe('after-secret-token\n');
    expect(result.decision).toMatchObject({
      action: 'applied',
      status: 'applied',
      threadId: 'thread-1',
      runId: 'run-1',
      isolationMode: 'git_worktree',
      branchName: 'vicode/worktree/project-1/run-1',
      baseSha: 'abc123',
      sourceWorkspaceRelativePath: '.',
      changedPaths: ['src/example.txt'],
      filesChanged: 1,
      insertions: 1,
      deletions: 1,
      errorReason: null
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'thread.detail' }),
      expect.objectContaining({ type: 'thread.updated' })
    ]));
    expect(result.thread.rawOutput.at(-1)?.payload).toMatchObject({
      worktreeReviewDecision: expect.objectContaining({
        action: 'applied',
        status: 'applied'
      })
    });
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain(sourceWorkspaceRoot);
    expect(resultJson).not.toContain(session.worktreeWorkspaceRoot);
    expect(resultJson).not.toContain('before-secret-token');
    expect(resultJson).not.toContain('after-secret-token');
  });

  it('rejects worktree changes through the provider manager without mutating source files', async () => {
    const sourceWorkspaceRoot = createWorkspace({
      'src/example.txt': 'keep me\n'
    });
    const db = createDb();
    const thread = db.getThread('thread-1') as ThreadDetail;
    const session = createHarnessWorktreeSession({
      sourceRepoRoot: sourceWorkspaceRoot,
      sourceWorkspaceRoot
    });
    addWorktreeSessionEvent(thread, session);
    addWorktreeChangeArtifactEvent(thread, {
      source: 'worktree_diff',
      summary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 1
      },
      files: [
        {
          path: 'src/example.txt',
          status: 'modified',
          insertions: 1,
          deletions: 1,
          beforeContent: 'keep me\n',
          afterContent: 'changed\n',
          previewLines: [],
          previewTruncated: false
        }
      ]
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    const result = await manager.rejectWorktreeReview({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(readFileSync(join(sourceWorkspaceRoot, 'src/example.txt'), 'utf8')).toBe('keep me\n');
    expect(result.decision).toMatchObject({
      action: 'rejected',
      status: 'rejected',
      changedPaths: ['src/example.txt']
    });
    expect(JSON.stringify(result)).not.toContain('changed\n');
  });

  it('reverts worktree changes through the provider manager and returns sanitized review evidence', async () => {
    const sourceWorkspaceRoot = createWorkspace({
      'src/example.txt': 'after-secret-token\n'
    });
    const db = createDb();
    const thread = db.getThread('thread-1') as ThreadDetail;
    const session = createHarnessWorktreeSession({
      sourceRepoRoot: sourceWorkspaceRoot,
      sourceWorkspaceRoot,
      worktreeRepoRoot: join(sourceWorkspaceRoot, '..', 'app-owned-worktree'),
      worktreeWorkspaceRoot: join(sourceWorkspaceRoot, '..', 'app-owned-worktree'),
      sourceWorkspaceRelativePath: '.'
    });
    addWorktreeSessionEvent(thread, session);
    addWorktreeChangeArtifactEvent(thread, {
      source: 'worktree_diff',
      summary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 1
      },
      files: [
        {
          path: 'src/example.txt',
          status: 'modified',
          insertions: 1,
          deletions: 1,
          beforeContent: 'before-secret-token\n',
          afterContent: 'after-secret-token\n',
          previewLines: ['-before-secret-token', '+after-secret-token'],
          previewTruncated: false
        }
      ]
    });
    addWorktreeReviewDecisionEvent(thread, 'applied', 'applied');
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });
    const events: AppEvent[] = [];
    manager.onEvent((event) => events.push(event));

    const result = await manager.revertWorktreeReview({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(readFileSync(join(sourceWorkspaceRoot, 'src/example.txt'), 'utf8')).toBe('before-secret-token\n');
    expect(result.decision).toMatchObject({
      action: 'reverted',
      status: 'reverted',
      threadId: 'thread-1',
      runId: 'run-1',
      isolationMode: 'git_worktree',
      changedPaths: ['src/example.txt'],
      filesChanged: 1,
      insertions: 1,
      deletions: 1,
      errorReason: null
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'thread.detail' }),
      expect.objectContaining({ type: 'thread.updated' })
    ]));
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain(sourceWorkspaceRoot);
    expect(resultJson).not.toContain(session.worktreeWorkspaceRoot);
    expect(resultJson).not.toContain('before-secret-token');
    expect(resultJson).not.toContain('after-secret-token');
  });

  it('applies selected worktree hunks through the provider manager and returns sanitized review evidence', async () => {
    const beforeContent = [
      'line 1',
      'line 2 before-secret-token',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      'line 9',
      'line 10 before-secret-token',
      'line 11'
    ].join('\n') + '\n';
    const afterContent = beforeContent
      .replace('line 2 before-secret-token', 'line 2 after-secret-token')
      .replace('line 10 before-secret-token', 'line 10 after-secret-token');
    const sourceWorkspaceRoot = createWorkspace({
      'src/example.txt': beforeContent
    });
    const db = createDb();
    const thread = db.getThread('thread-1') as ThreadDetail;
    const session = createHarnessWorktreeSession({
      sourceRepoRoot: sourceWorkspaceRoot,
      sourceWorkspaceRoot,
      worktreeRepoRoot: join(sourceWorkspaceRoot, '..', 'app-owned-worktree'),
      worktreeWorkspaceRoot: join(sourceWorkspaceRoot, '..', 'app-owned-worktree'),
      sourceWorkspaceRelativePath: '.'
    });
    const artifact: RunChangeArtifact = {
      source: 'worktree_diff',
      summary: {
        filesChanged: 1,
        insertions: 2,
        deletions: 2
      },
      files: [
        {
          path: 'src/example.txt',
          status: 'modified',
          insertions: 2,
          deletions: 2,
          beforeContent,
          afterContent,
          previewLines: [
            { type: 'context', oldLineNumber: 1, newLineNumber: 1, text: 'line 1' },
            { type: 'removed', oldLineNumber: 2, newLineNumber: null, text: 'line 2 before-secret-token' },
            { type: 'added', oldLineNumber: null, newLineNumber: 2, text: 'line 2 after-secret-token' },
            { type: 'context', oldLineNumber: 3, newLineNumber: 3, text: 'line 3' },
            { type: 'context', oldLineNumber: 4, newLineNumber: 4, text: 'line 4' },
            { type: 'context', oldLineNumber: 5, newLineNumber: 5, text: 'line 5' },
            { type: 'context', oldLineNumber: 6, newLineNumber: 6, text: 'line 6' },
            { type: 'context', oldLineNumber: 7, newLineNumber: 7, text: 'line 7' },
            { type: 'context', oldLineNumber: 8, newLineNumber: 8, text: 'line 8' },
            { type: 'context', oldLineNumber: 9, newLineNumber: 9, text: 'line 9' },
            { type: 'removed', oldLineNumber: 10, newLineNumber: null, text: 'line 10 before-secret-token' },
            { type: 'added', oldLineNumber: null, newLineNumber: 10, text: 'line 10 after-secret-token' },
            { type: 'context', oldLineNumber: 11, newLineNumber: 11, text: 'line 11' }
          ],
          previewTruncated: false
        }
      ]
    };
    addWorktreeSessionEvent(thread, session);
    addWorktreeChangeArtifactEvent(thread, artifact);
    const [acceptedHunk, rejectedHunk] = parseRunChangeHunks(artifact).hunks;
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });
    const events: AppEvent[] = [];
    manager.onEvent((event) => events.push(event));

    const result = await manager.applyWorktreeHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      acceptedHunkIds: [acceptedHunk!.id],
      rejectedHunkIds: [rejectedHunk!.id]
    });

    expect(readFileSync(join(sourceWorkspaceRoot, 'src/example.txt'), 'utf8')).toBe(
      beforeContent.replace('line 2 before-secret-token', 'line 2 after-secret-token')
    );
    expect(result.decision).toMatchObject({
      action: 'applied',
      status: 'applied',
      source: 'worktree_diff',
      isolationMode: 'git_worktree',
      hunkIds: [acceptedHunk!.id, rejectedHunk!.id],
      acceptedHunkIds: [acceptedHunk!.id],
      rejectedHunkIds: [rejectedHunk!.id],
      changedPaths: ['src/example.txt'],
      errorReason: null
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'thread.detail' }),
      expect.objectContaining({ type: 'thread.updated' })
    ]));
    expect(result.thread.rawOutput.at(-1)?.payload).toMatchObject({
      worktreeHunkReviewDecision: expect.objectContaining({
        action: 'applied',
        status: 'applied',
        acceptedHunkIds: [acceptedHunk!.id],
        rejectedHunkIds: [rejectedHunk!.id]
      })
    });
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain(sourceWorkspaceRoot);
    expect(resultJson).not.toContain(session.worktreeWorkspaceRoot);
    expect(resultJson).not.toContain('before-secret-token');
    expect(resultJson).not.toContain('after-secret-token');
  });

  it('rejects selected worktree hunks through the provider manager without mutating source files', async () => {
    const sourceWorkspaceRoot = createWorkspace({
      'src/example.txt': 'before\n'
    });
    const db = createDb();
    const thread = db.getThread('thread-1') as ThreadDetail;
    const session = createHarnessWorktreeSession({
      sourceRepoRoot: sourceWorkspaceRoot,
      sourceWorkspaceRoot
    });
    const artifact: RunChangeArtifact = {
      source: 'worktree_diff',
      summary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 1
      },
      files: [
        {
          path: 'src/example.txt',
          status: 'modified',
          insertions: 1,
          deletions: 1,
          beforeContent: 'before\n',
          afterContent: 'after\n',
          previewLines: [
            { type: 'removed', oldLineNumber: 1, newLineNumber: null, text: 'before' },
            { type: 'added', oldLineNumber: null, newLineNumber: 1, text: 'after' }
          ],
          previewTruncated: false
        }
      ]
    };
    addWorktreeSessionEvent(thread, session);
    addWorktreeChangeArtifactEvent(thread, artifact);
    const hunkIds = parseRunChangeHunks(artifact).hunks.map((hunk) => hunk.id);
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    const result = await manager.rejectWorktreeHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      hunkIds
    });

    expect(readFileSync(join(sourceWorkspaceRoot, 'src/example.txt'), 'utf8')).toBe('before\n');
    expect(result.decision).toMatchObject({
      action: 'rejected',
      status: 'rejected',
      source: 'worktree_diff',
      hunkIds,
      acceptedHunkIds: [],
      rejectedHunkIds: hunkIds,
      changedPaths: ['src/example.txt']
    });
    expect(JSON.stringify(result)).not.toContain('after\n');
  });

  it('reverts applied worktree hunks through the provider manager', async () => {
    const beforeContent = [
      'line 1',
      'line 2 before-secret-token',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      'line 9',
      'line 10 before-secret-token',
      'line 11'
    ].join('\n') + '\n';
    const afterContent = beforeContent
      .replace('line 2 before-secret-token', 'line 2 after-secret-token')
      .replace('line 10 before-secret-token', 'line 10 after-secret-token');
    const sourceWorkspaceRoot = createWorkspace({
      'src/example.txt': beforeContent
    });
    const db = createDb();
    const thread = db.getThread('thread-1') as ThreadDetail;
    const session = createHarnessWorktreeSession({
      sourceRepoRoot: sourceWorkspaceRoot,
      sourceWorkspaceRoot
    });
    const artifact: RunChangeArtifact = {
      source: 'worktree_diff',
      summary: {
        filesChanged: 1,
        insertions: 2,
        deletions: 2
      },
      files: [
        {
          path: 'src/example.txt',
          status: 'modified',
          insertions: 2,
          deletions: 2,
          beforeContent,
          afterContent,
          previewLines: [
            { type: 'context', oldLineNumber: 1, newLineNumber: 1, text: 'line 1' },
            { type: 'removed', oldLineNumber: 2, newLineNumber: null, text: 'line 2 before-secret-token' },
            { type: 'added', oldLineNumber: null, newLineNumber: 2, text: 'line 2 after-secret-token' },
            { type: 'context', oldLineNumber: 3, newLineNumber: 3, text: 'line 3' },
            { type: 'context', oldLineNumber: 4, newLineNumber: 4, text: 'line 4' },
            { type: 'context', oldLineNumber: 5, newLineNumber: 5, text: 'line 5' },
            { type: 'context', oldLineNumber: 6, newLineNumber: 6, text: 'line 6' },
            { type: 'context', oldLineNumber: 7, newLineNumber: 7, text: 'line 7' },
            { type: 'context', oldLineNumber: 8, newLineNumber: 8, text: 'line 8' },
            { type: 'context', oldLineNumber: 9, newLineNumber: 9, text: 'line 9' },
            { type: 'removed', oldLineNumber: 10, newLineNumber: null, text: 'line 10 before-secret-token' },
            { type: 'added', oldLineNumber: null, newLineNumber: 10, text: 'line 10 after-secret-token' },
            { type: 'context', oldLineNumber: 11, newLineNumber: 11, text: 'line 11' }
          ],
          previewTruncated: false
        }
      ]
    };
    addWorktreeSessionEvent(thread, session);
    addWorktreeChangeArtifactEvent(thread, artifact);
    const [acceptedHunk, rejectedHunk] = parseRunChangeHunks(artifact).hunks;
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.applyWorktreeHunks({
      threadId: 'thread-1',
      runId: 'run-1',
      acceptedHunkIds: [acceptedHunk!.id],
      rejectedHunkIds: [rejectedHunk!.id]
    });

    const result = await manager.revertWorktreeHunks({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(readFileSync(join(sourceWorkspaceRoot, 'src/example.txt'), 'utf8')).toBe(beforeContent);
    expect(result.decision).toMatchObject({
      action: 'reverted',
      status: 'reverted',
      source: 'worktree_diff',
      hunkIds: [acceptedHunk!.id, rejectedHunk!.id],
      acceptedHunkIds: [acceptedHunk!.id],
      rejectedHunkIds: [rejectedHunk!.id],
      changedPaths: ['src/example.txt'],
      errorReason: null
    });
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain(sourceWorkspaceRoot);
    expect(resultJson).not.toContain('before-secret-token');
    expect(resultJson).not.toContain('after-secret-token');
  });

  it('cleans worktree sessions through the provider manager and returns sanitized cleanup evidence', async () => {
    const sourceWorkspaceRoot = createWorkspace({
      'src/example.txt': 'after-secret-token\n'
    });
    const db = createDb();
    const thread = db.getThread('thread-1') as ThreadDetail;
    const session = createHarnessWorktreeSession({
      sourceRepoRoot: sourceWorkspaceRoot,
      sourceWorkspaceRoot,
      worktreeRepoRoot: join(sourceWorkspaceRoot, '..', 'app-owned-worktree'),
      worktreeWorkspaceRoot: join(sourceWorkspaceRoot, '..', 'app-owned-worktree'),
      sourceWorkspaceRelativePath: '.'
    });
    addWorktreeSessionEvent(thread, session);
    addWorktreeReviewDecisionEvent(thread, 'rejected', 'rejected');
    const harnessWorktreeSessions = {
      create: vi.fn(),
      cleanup: vi.fn(async () => ({
        ok: true,
        status: 'cleaned',
        worktreeRepoRoot: session.worktreeRepoRoot,
        errorReason: null
      }))
    };
    const manager = new ProviderManager(
      db as never,
      {
        openai: createAdapter(),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      },
      undefined,
      undefined,
      undefined,
      undefined,
      harnessWorktreeSessions as never
    );
    const events: AppEvent[] = [];
    manager.onEvent((event) => events.push(event));

    const result = await manager.cleanupWorktreeReview({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(harnessWorktreeSessions.cleanup).toHaveBeenCalledWith({
      sourceRepoRoot: session.sourceRepoRoot,
      worktreeRepoRoot: session.worktreeRepoRoot
    });
    expect(result.decision).toMatchObject({
      action: 'cleaned',
      status: 'cleaned',
      threadId: 'thread-1',
      runId: 'run-1',
      isolationMode: 'git_worktree',
      branchName: 'vicode/worktree/project-1/run-1',
      baseSha: 'abc123',
      cleanupPolicy: 'preserve_until_review',
      reviewStatus: 'rejected',
      errorReason: null
    });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'thread.detail' }),
      expect.objectContaining({ type: 'thread.updated' })
    ]));
    expect(result.thread.rawOutput.at(-1)?.payload).toMatchObject({
      worktreeCleanupDecision: expect.objectContaining({
        action: 'cleaned',
        status: 'cleaned'
      })
    });
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain(sourceWorkspaceRoot);
    expect(resultJson).not.toContain(session.worktreeWorkspaceRoot);
    expect(resultJson).not.toContain('after-secret-token');
  });

  it('automatically cleans a worktree after a rejected review when cleanup policy allows it', async () => {
    const sourceWorkspaceRoot = createWorkspace({
      'src/example.txt': 'keep me\n'
    });
    const db = createDb();
    const thread = db.getThread('thread-1') as ThreadDetail;
    const session = createHarnessWorktreeSession({
      cleanupPolicy: 'delete_after_reject',
      sourceRepoRoot: sourceWorkspaceRoot,
      sourceWorkspaceRoot,
      worktreeRepoRoot: join(sourceWorkspaceRoot, '..', 'app-owned-worktree'),
      worktreeWorkspaceRoot: join(sourceWorkspaceRoot, '..', 'app-owned-worktree'),
      sourceWorkspaceRelativePath: '.'
    });
    addWorktreeSessionEvent(thread, session);
    addWorktreeChangeArtifactEvent(thread, {
      source: 'worktree_diff',
      summary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 1
      },
      files: [
        {
          path: 'src/example.txt',
          status: 'modified',
          insertions: 1,
          deletions: 1,
          beforeContent: 'keep me\n',
          afterContent: 'changed\n',
          previewLines: [],
          previewTruncated: false
        }
      ]
    });
    const harnessWorktreeSessions = {
      create: vi.fn(),
      cleanup: vi.fn(async () => ({
        ok: true,
        status: 'cleaned',
        worktreeRepoRoot: session.worktreeRepoRoot,
        errorReason: null
      }))
    };
    const manager = new ProviderManager(
      db as never,
      {
        openai: createAdapter(),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      },
      undefined,
      undefined,
      undefined,
      undefined,
      harnessWorktreeSessions as never
    );

    const result = await manager.rejectWorktreeReview({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(harnessWorktreeSessions.cleanup).toHaveBeenCalledWith({
      sourceRepoRoot: session.sourceRepoRoot,
      worktreeRepoRoot: session.worktreeRepoRoot
    });
    expect(result.decision).toMatchObject({
      action: 'rejected',
      status: 'rejected'
    });
    expect(result.thread.rawOutput.at(-1)?.payload).toMatchObject({
      worktreeCleanupDecision: expect.objectContaining({
        action: 'cleaned',
        status: 'cleaned',
        cleanupPolicy: 'delete_after_reject',
        reviewStatus: 'rejected'
      })
    });
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain(sourceWorkspaceRoot);
    expect(resultJson).not.toContain(session.worktreeWorkspaceRoot);
    expect(resultJson).not.toContain('changed\n');
  });

  it('automatically cleans a worktree after a reverted review when cleanup policy allows it', async () => {
    const sourceWorkspaceRoot = createWorkspace({
      'src/example.txt': 'after-secret-token\n'
    });
    const db = createDb();
    const thread = db.getThread('thread-1') as ThreadDetail;
    const session = createHarnessWorktreeSession({
      cleanupPolicy: 'delete_after_revert',
      sourceRepoRoot: sourceWorkspaceRoot,
      sourceWorkspaceRoot,
      worktreeRepoRoot: join(sourceWorkspaceRoot, '..', 'app-owned-worktree'),
      worktreeWorkspaceRoot: join(sourceWorkspaceRoot, '..', 'app-owned-worktree'),
      sourceWorkspaceRelativePath: '.'
    });
    addWorktreeSessionEvent(thread, session);
    addWorktreeChangeArtifactEvent(thread, {
      source: 'worktree_diff',
      summary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 1
      },
      files: [
        {
          path: 'src/example.txt',
          status: 'modified',
          insertions: 1,
          deletions: 1,
          beforeContent: 'before-secret-token\n',
          afterContent: 'after-secret-token\n',
          previewLines: [],
          previewTruncated: false
        }
      ]
    });
    addWorktreeReviewDecisionEvent(thread, 'applied', 'applied');
    const harnessWorktreeSessions = {
      create: vi.fn(),
      cleanup: vi.fn(async () => ({
        ok: true,
        status: 'cleaned',
        worktreeRepoRoot: session.worktreeRepoRoot,
        errorReason: null
      }))
    };
    const manager = new ProviderManager(
      db as never,
      {
        openai: createAdapter(),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      },
      undefined,
      undefined,
      undefined,
      undefined,
      harnessWorktreeSessions as never
    );

    const result = await manager.revertWorktreeReview({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(readFileSync(join(sourceWorkspaceRoot, 'src/example.txt'), 'utf8')).toBe('before-secret-token\n');
    expect(harnessWorktreeSessions.cleanup).toHaveBeenCalledWith({
      sourceRepoRoot: session.sourceRepoRoot,
      worktreeRepoRoot: session.worktreeRepoRoot
    });
    expect(result.decision).toMatchObject({
      action: 'reverted',
      status: 'reverted'
    });
    expect(result.thread.rawOutput.at(-1)?.payload).toMatchObject({
      worktreeCleanupDecision: expect.objectContaining({
        action: 'cleaned',
        status: 'cleaned',
        cleanupPolicy: 'delete_after_revert',
        reviewStatus: 'reverted'
      })
    });
  });

  it('keeps applied worktrees manual-cleanup for the first automation policy', async () => {
    const sourceWorkspaceRoot = createWorkspace({
      'src/example.txt': 'before-secret-token\n'
    });
    const db = createDb();
    const thread = db.getThread('thread-1') as ThreadDetail;
    const session = createHarnessWorktreeSession({
      cleanupPolicy: 'delete_after_apply',
      sourceRepoRoot: sourceWorkspaceRoot,
      sourceWorkspaceRoot
    });
    addWorktreeSessionEvent(thread, session);
    addWorktreeChangeArtifactEvent(thread, {
      source: 'worktree_diff',
      summary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 1
      },
      files: [
        {
          path: 'src/example.txt',
          status: 'modified',
          insertions: 1,
          deletions: 1,
          beforeContent: 'before-secret-token\n',
          afterContent: 'after-secret-token\n',
          previewLines: [],
          previewTruncated: false
        }
      ]
    });
    const harnessWorktreeSessions = {
      create: vi.fn(),
      cleanup: vi.fn(async () => ({
        ok: true,
        status: 'cleaned',
        worktreeRepoRoot: session.worktreeRepoRoot,
        errorReason: null
      }))
    };
    const manager = new ProviderManager(
      db as never,
      {
        openai: createAdapter(),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      },
      undefined,
      undefined,
      undefined,
      undefined,
      harnessWorktreeSessions as never
    );

    const result = await manager.applyWorktreeReview({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(harnessWorktreeSessions.cleanup).not.toHaveBeenCalled();
    expect(result.decision).toMatchObject({
      action: 'applied',
      status: 'applied'
    });
    expect(result.thread.rawOutput.at(-1)?.payload).toMatchObject({
      worktreeReviewDecision: expect.objectContaining({
        action: 'applied',
        status: 'applied'
      })
    });
  });

  it('records automatic cleanup failure separately without changing a successful rejected review decision', async () => {
    const sourceWorkspaceRoot = createWorkspace({
      'src/example.txt': 'keep me\n'
    });
    const db = createDb();
    const thread = db.getThread('thread-1') as ThreadDetail;
    const session = createHarnessWorktreeSession({
      cleanupPolicy: 'delete_after_reject',
      sourceRepoRoot: sourceWorkspaceRoot,
      sourceWorkspaceRoot,
      worktreeRepoRoot: join(sourceWorkspaceRoot, '..', 'app-owned-worktree'),
      worktreeWorkspaceRoot: join(sourceWorkspaceRoot, '..', 'app-owned-worktree'),
      sourceWorkspaceRelativePath: '.'
    });
    addWorktreeSessionEvent(thread, session);
    addWorktreeChangeArtifactEvent(thread, {
      source: 'worktree_diff',
      summary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 1
      },
      files: [
        {
          path: 'src/example.txt',
          status: 'modified',
          insertions: 1,
          deletions: 1,
          beforeContent: 'keep me\n',
          afterContent: 'changed\n',
          previewLines: [],
          previewTruncated: false
        }
      ]
    });
    const harnessWorktreeSessions = {
      create: vi.fn(),
      cleanup: vi.fn(async () => ({
        ok: false,
        status: 'failed',
        worktreeRepoRoot: session.worktreeRepoRoot,
        errorReason: 'Git failed to remove the worktree.'
      }))
    };
    const manager = new ProviderManager(
      db as never,
      {
        openai: createAdapter(),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      },
      undefined,
      undefined,
      undefined,
      undefined,
      harnessWorktreeSessions as never
    );

    const result = await manager.rejectWorktreeReview({
      threadId: 'thread-1',
      runId: 'run-1'
    });

    expect(result.decision).toMatchObject({
      action: 'rejected',
      status: 'rejected'
    });
    expect(result.thread.rawOutput.at(-1)?.payload).toMatchObject({
      worktreeCleanupDecision: expect.objectContaining({
        action: 'failed',
        status: 'failed',
        cleanupPolicy: 'delete_after_reject',
        reviewStatus: 'rejected',
        errorReason: 'Git failed to remove the worktree.'
      })
    });
  });

  it('blocks folder-dependent default runs when the project has no workspace folder', async () => {
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
        prompt: 'give me full path',
        providerId: 'openai',
        modelId: 'gpt-5',
        executionPermission: 'default',
        skillIds: []
      })
    ).rejects.toThrow(
      'This project does not have a workspace folder yet. Attach a folder before asking Vicode to inspect files, write files, run commands, or answer workspace path questions.'
    );

    expect(startRun).not.toHaveBeenCalled();
    expect(promptRequiresAttachedWorkspace('give me full path')).toBe(true);
  });

  it('keeps explicitly selected OpenAI API-key auth when a legacy OpenAI adapter auth state is also detected', async () => {
    const discovered = [createProviderModel('gpt-5.4-nano', 'gpt-5.4-nano')];
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
      getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Connected with ChatGPT' }),
      discoverApiModels: async () => discovered
    });
    const manager = new ProviderManager(db as never, { openai: adapter, gemini: createAdapter({ id: 'gemini', label: 'Gemini' }) });

    const provider = await manager.getProvider('openai', { forceRefresh: true });

    expect(provider.authMode).toBe('api_key');
    expect(provider.modelSource).toBe('api');
    expect(db.replaceProviderModels).toHaveBeenCalledWith('openai', discovered, 'api');
    expect(db.saveProviderAccount).not.toHaveBeenCalled();
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
        'provider_model_compatibility_dispatch_started',
        'run_started',
        'first_tool_call',
        'first_delta',
        'completed'
      ])
    );

    const compatibilityTrace = (db.addRunEvent as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, , eventType, payload]) => eventType === 'info' && payload && typeof payload === 'object' && 'runtimeTrace' in payload)
      .map(([, , , payload]) => (payload as { runtimeTrace: { stage: string; detail?: Record<string, unknown> | null } }).runtimeTrace)
      .find((trace) => trace.stage === 'provider_model_compatibility_dispatch_started');

    expect(compatibilityTrace?.detail).toEqual({
      providerId: 'openai',
      runMode: 'default',
      compatibilityAuthority: 'provider_adapter',
      normalizedTransport: null,
      executionAuthority: 'provider_cli',
      approvalAuthority: 'none',
      sandboxAuthority: 'provider_cli'
    });
  });

  it('persists the harness task contract on the user turn and diagnostics trace', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.',
      'package.json': JSON.stringify({
        scripts: {
          build: 'tsc --noEmit',
          test: 'vitest run'
        }
      })
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
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
          trusted: true,
          runtimeCommandPolicy: 'auto_approve',
          runtimeNetworkPolicy: 'enabled'
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Update the helper and run npm test.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'full_access',
      skillIds: []
    });

    const contract = db.getThread().turns.find((turn) => turn.role === 'user')
      ?.metadata?.harnessTaskContract;
    expect(contract).toMatchObject({
      taskKind: 'edit',
      objective: 'Update the helper and run npm test.',
      workspaceRoot: workspace,
      expectedMutations: 'workspace_write',
      verificationPolicy: 'required',
      isolationMode: 'direct_workspace',
      executionPermission: 'full_access',
      trustedWorkspace: true,
      runtimeCommandPolicy: 'auto_approve',
      runtimeNetworkPolicy: 'enabled',
      commandAccess: 'auto_approve',
      networkAccess: 'host_local',
      riskLevel: 'high'
    });
    const verificationPlan = db.getThread().turns.find((turn) => turn.role === 'user')
      ?.metadata?.verificationPlan;
    expect(verificationPlan).toMatchObject({
      command: 'npm test',
      commandSource: 'package_json_test_script',
      cwd: workspace,
      permissionProfile: 'full_access',
      networkPolicy: 'enabled',
      status: 'planned',
      skippedReason: null,
      resultShape: {
        status: 'not_run',
        exitCode: null
      }
    });

    const workspaceContextCompleted = (db.addRunEvent as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, , eventType, payload]) => eventType === 'info' && payload && typeof payload === 'object' && 'runtimeTrace' in payload)
      .map(([, , , payload]) => (payload as { runtimeTrace: { stage: string; detail?: Record<string, unknown> | null } }).runtimeTrace)
      .find((trace) => trace.stage === 'workspace_context_completed');

    expect(workspaceContextCompleted?.detail?.harnessTaskContract).toMatchObject({
      taskKind: 'edit',
      expectedMutations: 'workspace_write',
      verificationPolicy: 'required',
      commandAccess: 'auto_approve',
      networkAccess: 'host_local'
    });
    expect(workspaceContextCompleted?.detail?.verificationPlan).toMatchObject({
      command: 'npm test',
      commandSource: 'package_json_test_script',
      status: 'planned'
    });
  });

  it('persists and dispatches a resolved conversation task packet for proceed prompts', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.',
      'package.json': JSON.stringify({
        scripts: {
          test: 'vitest run'
        }
      })
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
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
    db.appendTurn(
      'thread-1',
      'user',
      'I want a small calculator app. It should use React, TypeScript, and Tailwind.',
      null,
      'run-prior-1'
    );
    db.appendTurn(
      'thread-1',
      'assistant',
      'A good plan is: create the app shell, add calculator state, style the keypad, then verify with tests.',
      null,
      'run-prior-1'
    );
    db.appendTurn(
      'thread-1',
      'user',
      'Keep it simple and make sure keyboard input works.',
      null,
      'run-prior-2'
    );
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Ok, go ahead and implement this plan.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    const userTurns = db.getThread().turns.filter((turn) => turn.role === 'user');
    const latestUserTurn = userTurns[userTurns.length - 1];
    expect(latestUserTurn?.metadata?.resolvedTaskPacket).toMatchObject({
      trigger: 'inferred_proceed',
      phase: 'ready_to_task',
      executionPolicy: 'auto_execute',
      confidence: 'high',
      objective: expect.stringContaining('calculator app'),
      sourceTurnIds: ['turn-1', 'turn-2', 'turn-3'],
      expectedToolGroups: expect.arrayContaining([
        'workspace_read',
        'workspace_write',
        'verification'
      ]),
      acceptanceCriteria: expect.arrayContaining([expect.stringMatching(/keyboard input/i)])
    });

    const providerContext = startRun.mock.calls[0]?.[0] as ProviderRunContext | undefined;
    expect(providerContext?.resolvedTaskPacket).toMatchObject({
      trigger: 'inferred_proceed',
      objective: expect.stringContaining('calculator app')
    });
    expect(providerContext?.prompt).toContain('Resolved task packet:');
    expect(providerContext?.prompt).toContain('Implementation slices:');

    const workspaceContextCompleted = (db.addRunEvent as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, , eventType, payload]) => eventType === 'info' && payload && typeof payload === 'object' && 'runtimeTrace' in payload)
      .map(([, , , payload]) => (payload as { runtimeTrace: { stage: string; detail?: Record<string, unknown> | null } }).runtimeTrace)
      .find((trace) => trace.stage === 'workspace_context_completed');

    expect(workspaceContextCompleted?.detail?.resolvedTaskPacket).toMatchObject({
      trigger: 'inferred_proceed',
      phase: 'ready_to_task',
      sliceCount: 4,
      sourceTurnCount: 3
    });
  });

  it('answers one clarification and does not dispatch provider work for ambiguous proceed packets', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
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
      prompt: 'Ok, go ahead.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    expect(result.disposition).toBe('started');
    expect(startRun).not.toHaveBeenCalled();
    const userTurn = db.getThread().turns.find((turn) => turn.role === 'user');
    expect(userTurn?.metadata?.resolvedTaskPacket).toMatchObject({
      executionPolicy: 'ask_clarifying_question',
      confidence: 'low',
      clarificationQuestion: expect.stringMatching(/what should i implement/i)
    });
    const assistantTurn = db.getThread().turns.find((turn) => turn.role === 'assistant');
    expect(assistantTurn?.content).toMatch(/what should i implement/i);
    expect(db.getThread().status).toBe('completed');
  });

  it('continues through the planner lane for Plan mode wait packets', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      callbacks.onComplete('Plan ready');
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
    db.appendTurn('thread-1', 'user', 'I want a small calculator app with React and TypeScript.', null, 'run-prior-1');
    db.appendTurn('thread-1', 'assistant', 'Plan: create the shell, wire state, style it, and verify.', null, 'run-prior-1');
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Ok, go ahead and implement this plan.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      runMode: 'plan',
      skillIds: []
    });

    expect(startRun).toHaveBeenCalledTimes(1);
    const providerContext = startRun.mock.calls[0]?.[0] as ProviderRunContext | undefined;
    expect(providerContext).toMatchObject({
      runMode: 'plan',
      resolvedTaskPacket: {
        executionPolicy: 'plan_mode_wait',
        phase: 'task_plan'
      }
    });
  });

  it('pauses approval-required packets before provider dispatch', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
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
    db.appendTurn('thread-1', 'user', 'The project has old database migration files we may not need.', null, 'run-prior-1');
    db.appendTurn('thread-1', 'assistant', 'Deleting migrations is risky because it can affect data history.', null, 'run-prior-1');
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Go ahead and delete the old database migration files.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    expect(startRun).not.toHaveBeenCalled();
    const latestUserTurn = [...db.getThread().turns].reverse().find((turn) => turn.role === 'user');
    expect(latestUserTurn?.metadata?.resolvedTaskPacket).toMatchObject({
      executionPolicy: 'approval_required',
      riskReason: expect.stringMatching(/risk/i)
    });
    const assistantTurn = [...db.getThread().turns].reverse().find((turn) => turn.role === 'assistant');
    expect(assistantTurn?.content).toMatch(/confirm/i);
    expect(assistantTurn?.content).toMatch(/risky|risk/i);
    expect(db.getThread().status).toBe('completed');
  });

  it('pauses scope-replan packets before provider dispatch', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
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
    db.appendTurn('thread-1', 'user', 'I want a small calculator app with React and TypeScript.', null, 'run-prior-1');
    db.appendTurn('thread-1', 'assistant', 'Plan: create the shell, wire state, style it, and verify.', null, 'run-prior-1');
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Go ahead and change direction: build a CRM dashboard instead.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    expect(startRun).not.toHaveBeenCalled();
    const latestUserTurn = [...db.getThread().turns].reverse().find((turn) => turn.role === 'user');
    expect(latestUserTurn?.metadata?.resolvedTaskPacket).toMatchObject({
      executionPolicy: 'scope_replan',
      objective: expect.stringContaining('CRM dashboard')
    });
    const assistantTurn = [...db.getThread().turns].reverse().find((turn) => turn.role === 'assistant');
    expect(assistantTurn?.content).toMatch(/re-plan/i);
    expect(assistantTurn?.content).toMatch(/keep or change/i);
    expect(db.getThread().status).toBe('completed');
  });

  it('persists explicit patch-buffer isolation as a patch proposal contract', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.',
      'package.json': JSON.stringify({
        scripts: {
          test: 'vitest run'
        }
      })
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
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

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Update the helper and run npm test.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      isolationMode: 'patch_buffer',
      skillIds: []
    });

    const contract = db.getThread().turns.find((turn) => turn.role === 'user')
      ?.metadata?.harnessTaskContract;
    expect(contract).toMatchObject({
      taskKind: 'edit',
      expectedMutations: 'patch_proposal',
      verificationPolicy: 'required',
      isolationMode: 'patch_buffer'
    });

    const providerContext = startRun.mock.calls[0]?.[0] as { harnessTaskContract?: Record<string, unknown> } | undefined;
    expect(providerContext?.harnessTaskContract).toMatchObject({
      expectedMutations: 'patch_proposal',
      isolationMode: 'patch_buffer'
    });
  });

  it('creates a backend worktree session and routes provider execution through the worktree root', async () => {
    const sourceWorkspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.',
      'package.json': JSON.stringify({
        scripts: {
          test: 'vitest run'
        }
      })
    });
    const worktreeWorkspace = createWorkspace({
      'package.json': JSON.stringify({
        scripts: {
          test: 'vitest run'
        }
      })
    });
    const createWorktree = vi.fn(async (input: {
      threadId: string;
      runId: string;
      projectId: string;
      sourceWorkspaceRoot: string;
    }) => ({
      ok: true as const,
      session: createHarnessWorktreeSession({
        threadId: input.threadId,
        runId: input.runId,
        projectId: input.projectId,
        sourceRepoRoot: sourceWorkspace,
        sourceWorkspaceRoot: sourceWorkspace,
        worktreeRepoRoot: worktreeWorkspace,
        worktreeWorkspaceRoot: worktreeWorkspace
      })
    }));
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      callbacks.onComplete('Done');
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: sourceWorkspace,
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
      undefined,
      undefined,
      undefined,
      undefined,
      {
        create: createWorktree
      }
    );

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Update the helper and run npm test.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      isolationMode: 'git_worktree',
      skillIds: []
    });

    expect(createWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        projectId: 'project-1',
        sourceWorkspaceRoot: sourceWorkspace
      })
    );
    const providerContext = startRun.mock.calls[0]?.[0] as ProviderRunContext | undefined;
    expect(providerContext).toMatchObject({
      folderPath: worktreeWorkspace,
      sourceWorkspaceRoot: sourceWorkspace,
      runtimeWorkspaceRoot: worktreeWorkspace,
      harnessTaskContract: {
        workspaceRoot: worktreeWorkspace,
        isolationMode: 'git_worktree',
        expectedMutations: 'workspace_write'
      },
      verificationPlan: {
        cwd: worktreeWorkspace
      },
      harnessWorktreeSession: {
        sourceWorkspaceRoot: sourceWorkspace,
        worktreeWorkspaceRoot: worktreeWorkspace,
        status: 'ready'
      }
    });

    const contract = db.getThread().turns.find((turn) => turn.role === 'user')
      ?.metadata?.harnessTaskContract;
    expect(contract).toMatchObject({
      workspaceRoot: worktreeWorkspace,
      isolationMode: 'git_worktree'
    });
    const worktreeTrace = db.getThread().rawOutput
      .map((event) => event.payload)
      .filter((payload): payload is { runtimeTrace: { stage: string; detail?: Record<string, unknown> | null } } =>
        Boolean(payload) && typeof payload === 'object' && 'runtimeTrace' in payload
      )
      .map((payload) => payload.runtimeTrace)
      .find((trace) => trace.stage === 'worktree_session_created');
    expect(worktreeTrace?.detail).toMatchObject({
      sourceWorkspaceRoot: sourceWorkspace,
      runtimeWorkspaceRoot: worktreeWorkspace,
      harnessWorktreeSession: {
        worktreeWorkspaceRoot: worktreeWorkspace
      }
    });
    const worktreeEvidence = db.getThread().rawOutput
      .map((event) => event.payload)
      .find((payload): payload is { worktreeChangeEvidence: Record<string, unknown> } =>
        Boolean(payload) && typeof payload === 'object' && 'worktreeChangeEvidence' in payload
      );
    expect(worktreeEvidence?.worktreeChangeEvidence).toMatchObject({
      threadId: 'thread-1',
      isolationMode: 'git_worktree',
      status: 'ready',
      reviewStatus: 'pending',
      cleanupPolicy: 'preserve_until_review',
      sourceWorkspaceRelativePath: '.',
      branchName: 'vicode/worktree/project-1/run-1',
      baseRef: 'HEAD',
      baseSha: 'abc123',
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      changedPaths: []
    });
    expect(JSON.stringify(worktreeEvidence)).not.toContain(worktreeWorkspace);
    expect(JSON.stringify(worktreeEvidence)).not.toContain(sourceWorkspace);
  });

  it('fails git worktree runs before provider dispatch when worktree creation fails', async () => {
    const sourceWorkspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const createWorktree = vi.fn(async () => ({
      ok: false as const,
      reason: 'dirty_workspace' as const,
      message: 'git_worktree isolation requires a clean source workspace.',
      paths: ['src/dirty.ts']
    }));
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      callbacks.onComplete('Done');
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: sourceWorkspace,
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
      undefined,
      undefined,
      undefined,
      undefined,
      {
        create: createWorktree
      }
    );

    await expect(manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Update the helper.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      isolationMode: 'git_worktree',
      skillIds: []
    })).rejects.toThrow('git_worktree setup failed: git_worktree isolation requires a clean source workspace.');

    expect(startRun).not.toHaveBeenCalled();
  });

  it('routes trusted Ollama responses runs through normalized execution before the adapter fallback', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const fetch = vi.fn(async (path: string) => {
      expect(path).toBe('/v1/responses');
      return new Response(JSON.stringify({ output_text: 'Normalized Ollama complete.' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      callbacks.onComplete('Legacy Ollama complete.');
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          defaultProviderId: 'ollama',
          folderPath: workspace,
          trusted: true
        })
      ),
      getPreferences: vi.fn(() =>
        createPreferences({
          defaultProviderId: 'ollama',
          ollamaTransportMode: 'responses'
        })
      )
    });
    const manager = new ProviderManager(
      db as never,
      {
        openai: createAdapter(),
        ollama: createAdapter({ id: 'ollama', label: 'Ollama', startRun }),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      },
      undefined,
      new OllamaRuntimeService(createOllamaRuntime({ fetch }))
    );

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Inspect and answer.',
      providerId: 'ollama',
      modelId: 'qwen3',
      executionPermission: 'default',
      skillIds: []
    });

    await vi.waitFor(() => {
      expect(db.updateAssistantTurn).toHaveBeenLastCalledWith(
        expect.any(String),
        'thread-1',
        'Normalized Ollama complete.',
        null
      );
    });
    expect(
      startRun.mock.calls.some(([context]) =>
        (context as { sourcePrompt?: string }).sourcePrompt === 'Inspect and answer.'
      )
    ).toBe(false);

    const runtimeTraceStages = (db.addRunEvent as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, , eventType, payload]) => eventType === 'info' && payload && typeof payload === 'object' && 'runtimeTrace' in payload)
      .map(([, , , payload]) => (payload as { runtimeTrace: { stage: string } }).runtimeTrace.stage);

    expect(runtimeTraceStages).toEqual(
      expect.arrayContaining([
        'provider_dispatch_started',
        'provider_model_normalized_dispatch_started',
        'run_started',
        'completed'
      ])
    );
    expect(runtimeTraceStages).not.toContain('provider_model_compatibility_dispatch_started');
  });

  it('routes trusted Ollama chat runs through normalized execution before the adapter fallback', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const fetch = vi.fn(async (path: string) => {
      expect(path).toBe('/api/chat');
      return createStreamResponse([
        {
          message: {
            role: 'assistant',
            content: 'Local chat complete.'
          },
          done: true
        }
      ]);
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      callbacks.onComplete('Legacy chat complete.');
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          defaultProviderId: 'ollama',
          folderPath: workspace,
          trusted: true
        })
      ),
      getPreferences: vi.fn(() =>
        createPreferences({
          defaultProviderId: 'ollama',
          ollamaTransportMode: 'chat'
        })
      )
    });
    const manager = new ProviderManager(
      db as never,
      {
        openai: createAdapter(),
        ollama: createAdapter({ id: 'ollama', label: 'Ollama', startRun }),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      },
      undefined,
      new OllamaRuntimeService(createOllamaRuntime({ fetch }))
    );

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Inspect and answer.',
      providerId: 'ollama',
      modelId: 'qwen3',
      executionPermission: 'default',
      skillIds: []
    });

    await vi.waitFor(() => {
      expect(db.updateAssistantTurn).toHaveBeenLastCalledWith(
        expect.any(String),
        'thread-1',
        'Local chat complete.',
        null
      );
    });
    expect(
      startRun.mock.calls.some(([context]) =>
        (context as { sourcePrompt?: string }).sourcePrompt === 'Inspect and answer.'
      )
    ).toBe(false);
  });

  it.each([
    ['openai', 'gpt-5.1', 'OpenAI CLI has been retired in Vicode.'],
    ['gemini', 'gemini-2.5-pro', 'Gemini CLI has been retired in Vicode.'],
    ['qwen', 'qwen3.5-plus', 'Qwen CLI has been retired in Vicode.'],
    ['kimi', 'kimi-k2-thinking', 'Kimi CLI has been retired in Vicode.']
  ] as const)('blocks %s composer runs through the retired provider boundary', async (providerId, modelId, message) => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          defaultProviderId: providerId,
          folderPath: workspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(db as never);

    await expect(
      manager.submitComposer({
        projectId: 'project-1',
        prompt: 'Inspect and answer.',
        providerId,
        modelId,
        executionPermission: 'default',
        skillIds: []
      })
    ).rejects.toThrow(message);
  });

  it.each([
    ['openai', 'gpt-5.1', 'OpenAI CLI has been retired in Vicode.'],
    ['gemini', 'gemini-2.5-pro', 'Gemini CLI has been retired in Vicode.'],
    ['qwen', 'qwen3.5-plus', 'Qwen CLI has been retired in Vicode.'],
    ['kimi', 'kimi-k2-thinking', 'Kimi CLI has been retired in Vicode.']
  ] as const)('blocks %s planner runs through the retired provider boundary', async (providerId, modelId, message) => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          defaultProviderId: providerId,
          folderPath: workspace,
          trusted: true
        })
      )
    });
    const manager = new ProviderManager(db as never);

    await expect(
      manager.submitPlanner({
        projectId: 'project-1',
        prompt: 'Plan the next step.',
        providerId,
        modelId,
        executionPermission: 'default',
        skillIds: []
      })
    ).rejects.toThrow(message);
  });

  it('fails trusted Ollama coding runs visibly when a normalized transport cannot be resolved', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      callbacks.onComplete('Legacy Ollama fallback should not run.');
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          defaultProviderId: 'ollama',
          folderPath: workspace,
          trusted: true
        })
      ),
      getPreferences: vi.fn(() =>
        createPreferences({
          defaultProviderId: 'ollama',
          ollamaTransportMode: 'unsupported-normalized-mode'
        })
      )
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter(),
      ollama: createAdapter({ id: 'ollama', label: 'Ollama', startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    const result = await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Inspect the project files and report findings.',
      providerId: 'ollama',
      modelId: 'qwen3',
      executionPermission: 'default',
      skillIds: []
    });

    expect(result.disposition).toBe('started');
    expect(startRun).not.toHaveBeenCalled();
    expect(db.addRunEvent).toHaveBeenCalledWith(
      'thread-1',
      result.runId,
      'failed',
      {
        message: 'Ollama requires an app-owned normalized transport for trusted workspace runs, but no normalized transport was available.'
      }
    );

    const runtimeTraceStages = (db.addRunEvent as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, , eventType, payload]) => eventType === 'info' && payload && typeof payload === 'object' && 'runtimeTrace' in payload)
      .map(([, , , payload]) => (payload as { runtimeTrace: { stage: string } }).runtimeTrace.stage);

    expect(runtimeTraceStages).toContain('provider_model_normalized_transport_missing');
    expect(runtimeTraceStages).not.toContain('provider_model_compatibility_dispatch_started');
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
        projectKnowledgeBlocks: [],
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
          projectKnowledgeRetrievalMs: 0,
          blockCount: 0,
          memoryBlockCount: 0,
          generatedMemoryBlockCount: 1,
          projectKnowledgeBlockCount: 0,
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

  it('keeps provider delta boundaries during streaming and normalizes final execution output', async () => {
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
      '“the 21st night of September”',
      'is a poetic line.'
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

  it('keeps provider snapshot boundaries during streaming and normalizes final execution output', async () => {
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
      '“the 21st night of September”'
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

  it('keeps raw adjacent Gemini delta boundaries during streaming and applies safe final punctuation spacing', async () => {
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
      "Hey!I'm doing",
      'well,thanks',
      'for asking.How are',
      'you?'
    ]);

    const runDeltas = events
      .filter((event): event is Extract<AppEvent, { type: 'run.delta' }> => event.type === 'run.delta')
      .map((event) => event.delta);
    expect(runDeltas).toEqual(persistedDeltas);

    expect(db.updateAssistantTurn).toHaveBeenLastCalledWith(
      result.runId,
      'thread-1',
      "Hey! I'm doingwell, thanksfor asking. How areyou?",
      null
    );
  });

  it('persists dense Ollama completion text without model-powered restructuring', async () => {
    const output =
      'Sure! Here are some fun facts about Mars:- 🌍 **The Red Planet:** Mars looks red due to iron oxide. - 🌙 **Moons:** Mars has Phobos and Deimos. - 🏔️ **Olympus Mons:** It is the tallest volcano in the solar system. Let me know if you want more.';
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      callbacks.onDelta(output);
      callbacks.onComplete(output);
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
      output,
      null
    );
    expect(db.getThread().turns.find((turn) => turn.runId === result.runId && turn.role === 'assistant')?.content).toBe(
      output
    );
  });

  it('does not run a second-pass Ollama wrap-up rewrite for dense final answers', async () => {
    const output =
      '- **Founded:** 2000 by Victor Goossens and Joy Hoogeveen. Official website launched in 2001 and moved to teamliquid.net in 2002. Expanded into multi-game esports in 2012, merged with Team Curse in 2015, sold controlling interest to Axiomatic Gaming in 2016, won major titles in Dota 2, League of Legends, and Counter-Strike, and now fields teams across many games.';
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      callbacks.onDelta(output);
      callbacks.onComplete(output);
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

    expect(rewrite).not.toHaveBeenCalled();
    expect(db.updateAssistantTurn).toHaveBeenLastCalledWith(
      result.runId,
      'thread-1',
      output,
      null
    );
    expect(db.getThread().turns.find((turn) => turn.runId === result.runId && turn.role === 'assistant')?.content).toBe(
      output
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
    expect(prompt).not.toContain('Workspace SOUL.md');
    expect(prompt).toContain('Vicode internal guidance:');
    expect(prompt).not.toContain('Context: Source-Backed Workflow, Execution Discipline, Verification Standards');
    expect(prompt).not.toContain('Using: Vicode Guidance');
    expect(prompt).not.toContain('Using: Task Routing');
    expect(prompt).toContain('### Vicode Guidance (VICODE.md):');
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
    expect(prompt).not.toContain('Workspace SOUL.md');
    expect(prompt).toContain('Workspace USER.md:\nBe concise.');
  });

  it('keeps supported workspace instruction files ahead of retrieved memory when the inline prompt budget is tight', async () => {
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
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
          projectKnowledgeBlocks: [],
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
            projectKnowledgeRetrievalMs: 0,
            blockCount: 3,
            memoryBlockCount: 1,
            generatedMemoryBlockCount: 0,
            projectKnowledgeBlockCount: 0,
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
    expect(prompt).not.toContain('Workspace SOUL.md');
    expect(prompt).toContain('Workspace USER.md:\nUser preferences.');
    expect(prompt).toContain('Workspace codex.md:\nProvider compatibility.');
    expect(prompt.indexOf('Workspace USER.md')).toBeLessThan(prompt.indexOf('Relevant workspace memory:'));
    expect(prompt.indexOf('Workspace codex.md')).toBeLessThan(prompt.indexOf('Relevant workspace memory:'));
    expect(prompt).toContain('[Truncated for prompt budget]');
    expect(prompt).toContain('Relevant workspace memory:');
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
  ] as const)('blocks %s execution when project trust is false', async (providerId, modelId) => {
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
    ).rejects.toThrow(
      providerId === 'openai'
        ? 'OpenAI cannot run against an untrusted workspace. Trust the project and retry.'
        : 'Gemini cannot run against an untrusted workspace. Trust the project and retry.'
    );

    expect(startRun).not.toHaveBeenCalled();
  });

  it.each([
    ['openai', 'gpt-5'],
    ['gemini', 'gemini-2.5-pro']
  ] as const)('blocks %s planner runs when project trust is false', async (providerId, modelId) => {
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
    ).rejects.toThrow(
      providerId === 'openai'
        ? 'OpenAI cannot run against an untrusted workspace. Trust the project and retry.'
        : 'Gemini cannot run against an untrusted workspace. Trust the project and retry.'
    );

    expect(startRun).not.toHaveBeenCalled();
  });

  it('marks the thread failed when provider startup rejects before a handle is returned', async () => {
    const workspace = createWorkspace({
      'AGENTS.md': 'Use small diffs.'
    });
    const startRun = vi.fn(async () => {
      throw new Error('Failed to start OpenAI provider: spawn failed');
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
      { message: 'Failed to start OpenAI provider: spawn failed' }
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

  it('still includes memory retrieval alongside workspace context', async () => {
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

    const prompt = startRun.mock.calls[0]?.[0]?.prompt as string;
    expect(prompt).toContain('Relevant workspace memory:');
    expect(prompt).not.toContain('Global instructions:');
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

  it('auto-selects strongly matched skills and shows referenced skill activity', async () => {
    let capturedCallbacks: ProviderRunCallbacks | null = null;
    const startRun = vi.fn(async (_context: ProviderRunContext, callbacks?: ProviderRunCallbacks) => {
      capturedCallbacks = callbacks ?? null;
      callbacks?.onStart?.();
      return {
        runId: 'run-1',
        cancel: async () => {}
      };
    });
    const reviewerSkill: SkillDefinition = {
      id: 'skill-1',
      name: 'Reviewer',
      description: 'Performs engineering review when the task is to find bugs, regressions, weak assumptions, or missing validation.',
      instructions: 'Look for regressions before suggesting rewrites.',
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
    const db = createDb({
      listSkills: vi.fn(() => [reviewerSkill])
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Please review this patch for bugs and missing validation.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    expect(capturedCallbacks).not.toBeNull();
    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('## Reviewer ($reviewer)')
      }),
      expect.any(Object)
    );
    expect(db.appendTurn).toHaveBeenCalledWith(
      'thread-1',
      'user',
      'Please review this patch for bugs and missing validation.',
      expect.objectContaining({
        skillIds: ['skill-1']
      })
    );
    expect(db.addRunEvent).toHaveBeenCalledWith(
      'thread-1',
      expect.any(String),
      'info',
      {
        activity: expect.objectContaining({
          kind: 'skill',
          summary: 'Using: Reviewer',
          text: 'Using: Reviewer\n- Reviewer: auto-selected from prompt',
          providerEventType: 'skills_using'
        })
      }
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

  it('uses runtime discovery when CLI auth is active and orders merged Codex models newest-first', async () => {
    const discovered = [
      { ...createProviderModel('gpt-5.4', 'GPT-5.4'), recommendation: 'recommended' as const },
      { ...createProviderModel('gpt-5.4-mini', 'GPT-5.4-Mini'), recommendation: 'fast' as const },
      createProviderModel('gpt-5.3-codex', 'GPT-5.3-Codex'),
      createProviderModel('gpt-5.3-codex-spark', 'GPT-5.3-Codex-Spark'),
      createProviderModel('gpt-5.2', 'GPT-5.2')
    ];
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
    expect(provider.models.map((model) => model.id).slice(0, 6)).toEqual([
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.3-codex-spark',
      'gpt-5.2'
    ]);
    expect(provider.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'gpt-5.5', label: 'GPT-5.5' }),
        expect.objectContaining({ id: 'gpt-5.4', label: 'GPT-5.4', recommendation: undefined })
      ])
    );
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
    ['qwen', 'qwen3.5-plus'],
    ['kimi', 'kimi-k2-thinking']
  ] as const)('rejects retired %s runs with a clear provider retirement message', async (providerId, modelId) => {
    const startRun = vi.fn(async () => ({ runId: 'run-1', cancel: async () => {} }));
    const adapter = createAdapter({ id: providerId, label: providerId === 'qwen' ? 'Qwen' : 'Kimi', startRun });
    const thread = createThreadDetail({
      providerId,
      modelId,
      executionPermission: 'default',
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
              sessionId: `${providerId}-session-1`
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

    await expect(
      manager.submitComposer({
        projectId: 'project-1',
        threadId: 'thread-1',
        prompt: 'Continue the task.',
        providerId,
        modelId,
        executionPermission: 'default',
        skillIds: [],
        imageAttachments: []
      })
    ).rejects.toThrow(`${providerId === 'qwen' ? 'Qwen' : 'Kimi'} CLI has been retired`);

    expect(startRun).not.toHaveBeenCalled();
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
    expect(provider.message).toBe('Ollama local runtime is not installed. Install it for local models.');
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

  it('ignores legacy Ollama API-key auth when the local runtime is not installed', async () => {
    const discoverApiModels = vi.fn(async () => [createProviderModel('qwen3', 'Qwen3')]);
    const db = createDb({
      getProviderAccount: vi.fn(() => ({
        providerId: 'ollama',
        authState: 'connected',
        authMode: null,
        encryptedApiKey: null,
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
          authState: 'detected',
          authMode: null,
          message: 'Ollama is not reachable.'
        }),
        discoverApiModels
      })
    });

    const provider = await manager.getProvider('ollama', { forceRefresh: true });

    expect(provider.installed).toBe(false);
    expect(provider.authMode).toBe(null);
    expect(provider.authState).toBe('disconnected');
    expect(provider.modelSource).toBe('fallback');
    expect(provider.models.map((model) => model.id)).toEqual(['qwen3']);
    expect(provider.message).toBe('Ollama local runtime is not installed. Install it for local models.');
    expect(discoverApiModels).not.toHaveBeenCalled();
    expect(db.replaceProviderModels).not.toHaveBeenCalled();
  });

  it('prefers the shared local Ollama certification model when a requested model is missing', async () => {
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
          authMode: null,
          encryptedApiKey: null,
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
        detectInstall: async () => ({ installed: true, cliPath: null }),
        getAuthState: async () => ({
          authState: 'connected',
          authMode: null,
          message: 'Ollama local runtime is ready.'
        }),
        discoverRuntimeModels: async () => discovered,
        startRun
      })
    });

    await manager.submitComposer({
      projectId: 'project-1',
      prompt: 'Build the feature.',
      providerId: 'ollama',
        modelId: 'missing-local-model',
      executionPermission: 'full_access',
      skillIds: []
    });

    expect(startRun).toHaveBeenCalledOnce();
  });

  it('reviews Ollama image attachments with a vision model while keeping the selected coding model in charge', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'vicode-provider-manager-ollama-vision-'));
    tempDirs.push(workspace);
    const startRun = vi.fn(async (context, callbacks: ProviderRunCallbacks) => {
      if (String(context.runId).endsWith(':image-review')) {
        expect(context.modelId).toBe('qwen2.5vl:7b');
        expect(context.folderPath).toBeNull();
        expect(context.trusted).toBe(false);
        expect(context.skipFinalAnswerRewrite).toBe(true);
        expect(context.imageAttachments).toHaveLength(1);
        callbacks.onComplete('The screenshot shows a dark SaaS pricing page with four pricing cards.');
      }
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
        detectInstall: async () => ({ installed: true, cliPath: null }),
        getAuthState: async () => ({
          authState: 'connected',
          authMode: null,
          message: 'Ollama local runtime is ready.'
        }),
        discoverRuntimeModels: async () => discovered,
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

    expect(startRun).toHaveBeenCalledTimes(2);
    const mainContext = startRun.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(mainContext.modelId).toBe('qwen3-coder:30b');
    expect(mainContext.imageAttachments).toEqual([]);
    expect(String(mainContext.prompt)).toContain('Attached image review:');
    expect(String(mainContext.prompt)).toContain('dark SaaS pricing page with four pricing cards');
    expect(db.addRunEvent).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'info',
      expect.objectContaining({
        activity: expect.objectContaining({
          providerEventType: 'ollama_image_model_route'
        })
      })
    );
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
    const workspace = createWorkspace({});
    let callbacks: ProviderRunCallbacks | null = null;
    const cancel = vi.fn(async () => {});
    const startRun = vi.fn(async (_context, nextCallbacks) => {
      callbacks = nextCallbacks;
      return {
        runId: 'run-1',
        cancel
      } satisfies ProviderRunHandle;
    });
    const manager = new ProviderManager(
      createDb({
        getProject: vi.fn(() =>
          createProject({
            folderPath: workspace,
            trusted: true
          })
        )
      }) as never,
      {
      ollama: createAdapter({
        id: 'ollama',
        label: 'Ollama',
        getAuthState: async () => ({ authState: 'connected', authMode: 'cli', message: 'Ollama is ready locally.' }),
        startRun
      }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      }
    );

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
    const workspace = createWorkspace({});
    let callbacks: ProviderRunCallbacks | null = null;
    const events: AppEvent[] = [];
    const startRun = vi.fn(async (_context, nextCallbacks) => {
      callbacks = nextCallbacks;
      return {
        runId: 'run-1',
        cancel: async () => {}
      } satisfies ProviderRunHandle;
    });
    const manager = new ProviderManager(
      createDb({
        getProject: vi.fn(() =>
          createProject({
            folderPath: workspace,
            trusted: true
          })
        )
      }) as never,
      {
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
      }
    );
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
    expect(provider.message).toContain('Choose Connect');
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

    await manager.startAuth('openai', 'cli');

    await manager.startAuth('openai', 'cli', { force: true });

    expect(startAuth).toHaveBeenCalledTimes(2);
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
        prompt: expect.stringContaining('User request:\nPlan a hacker-themed hero section.'),
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
        prompt: expect.stringContaining(
          'User request:\nShape the next bounded implementation slice.'
        )
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
    expect(prompt).toContain('Vicode internal guidance:');
    expect(prompt).toMatch(/Using capabilities: .*Planner Helper/u);
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
      projectKnowledgeBlocks: [],
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
        projectKnowledgeRetrievalMs: 0,
        blockCount: 0,
        memoryBlockCount: 0,
        generatedMemoryBlockCount: 0,
        projectKnowledgeBlockCount: 0,
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
    const workspace = createWorkspace({});
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const assemble = vi.fn(() => ({
      folderPath: workspace,
      trusted: true,
      providerId: 'openai',
      blocks: [],
      memoryBlocks: [],
      generatedMemoryBlocks: [],
      projectKnowledgeBlocks: [],
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
        projectKnowledgeRetrievalMs: 0,
        blockCount: 0,
        memoryBlockCount: 0,
        generatedMemoryBlockCount: 0,
        projectKnowledgeBlockCount: 0,
        skillBlockCount: 0,
        runtimeSkillResourceCount: 0
      }
    }));
    const workspaceContext = { assemble };
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
        includedContext: ['Project instructions', 'Provider compatibility notes'],
        excludedContext: ['Full project memory', 'Main-thread history']
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
            preset: 'default',
            disallowedToolCallNames: ['spawn_subagents']
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
        includedContext: ['Project instructions', 'Provider compatibility notes'],
        excludedContext: ['Full project memory', 'Main-thread history']
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

  it('hands approved plans to execution as a durable completion contract', async () => {
    const db = createDb();
    const thread = db.getThread() as ThreadDetail;
    thread.planner = {
      ...thread.planner,
      composerMode: 'plan',
      turnState: 'plan_ready',
      activePlanId: 'plan-1',
      activePlan: {
        id: 'plan-1',
        threadId: thread.id,
        createdTurnId: 'turn-plan',
        proposedPlanMarkdown: [
          '# Plan Mode Continuation',
          '',
          '## Key Changes',
          '- Create `index.html` for the landing page structure',
          '- Create `styles.css` for custom styling',
          '- Create `script.js` for interactions',
          '',
          '## Test Plan',
          '- Run focused planner tests'
        ].join('\n'),
        structuredPlan: {
          title: 'Plan Mode Continuation',
          summary: ['Keep execution moving.'],
          keyChanges: [
            'Create `index.html` for the landing page structure',
            'Create `styles.css` for custom styling',
            'Create `script.js` for interactions'
          ],
          testPlan: ['Run focused planner tests'],
          assumptions: []
        },
        status: 'draft',
        createdAt: '2026-03-14T00:00:00.000Z'
      },
      pendingQuestionSet: {
        id: 'question-set-1',
        threadId: thread.id,
        promptTurnId: 'turn-plan',
        callId: 'call-1',
        questions: [],
        answers: {
          scope: { answers: ['Keep it focused'] }
        },
        createdAt: '2026-03-14T00:00:00.000Z'
      }
    };
    const startRun = vi.fn(async (_context: ProviderRunContext) => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.approvePlannerPlan({ threadId: thread.id, planId: 'plan-1' });

    const providerContext = startRun.mock.calls[0]?.[0];
    expect(providerContext?.harnessTaskContract?.taskKind).toBe('edit');
    expect(providerContext?.harnessTaskContract?.expectedMutations).toBe('workspace_write');
    expect(providerContext?.resolvedTaskPacket?.expectedToolGroups).toEqual([
      'workspace_read',
      'workspace_write',
      'command',
      'verification'
    ]);
    expect(providerContext?.sourcePrompt).toContain('Implement the approved plan to completion.');
    expect(providerContext?.sourcePrompt).toContain('Approved plan execution contract:');
    expect(providerContext?.sourcePrompt).toContain('Create `styles.css` for custom styling');
    expect(providerContext?.prompt).toContain('Approved plan execution contract:');
    expect(providerContext?.prompt).toContain('Treat this approved plan as the current run contract, not optional background context.');
    expect(providerContext?.prompt).toContain('When one item is complete, continue to the next item in the same run without waiting for the user.');
    expect(providerContext?.prompt).toContain('Implementation items:\n1. Create `index.html` for the landing page structure\n2. Create `styles.css` for custom styling');
    expect(providerContext?.prompt).toContain('Verification items:\n1. Run focused planner tests');
    expect(providerContext?.prompt).toContain('Clarifying answers:\n- scope: Keep it focused');
  });

  it('treats an approved plan as the explicit confirmation for risky execution', async () => {
    const db = createDb();
    const thread = db.getThread() as ThreadDetail;
    thread.planner = {
      ...thread.planner,
      composerMode: 'plan',
      turnState: 'plan_ready',
      activePlanId: 'plan-1',
      activePlan: {
        id: 'plan-1',
        threadId: thread.id,
        createdTurnId: 'turn-plan',
        proposedPlanMarkdown: [
          '# Risky Approved Plan',
          '',
          '## Key Changes',
          '- Delete obsolete generated files after reading the workspace state.',
          '- Create `index.html`, `styles.css`, and `main.js` for the approved page.',
          '',
          '## Test Plan',
          '- Run npm test after the files are written.'
        ].join('\n'),
        structuredPlan: {
          title: 'Risky Approved Plan',
          summary: ['Execute the approved plan without asking for a second confirmation.'],
          keyChanges: [
            'Delete obsolete generated files after reading the workspace state.',
            'Create `index.html`, `styles.css`, and `main.js` for the approved page.'
          ],
          testPlan: ['Run npm test after the files are written.'],
          assumptions: []
        },
        status: 'draft',
        createdAt: '2026-03-14T00:00:00.000Z'
      }
    };
    const startRun = vi.fn(async (_context: ProviderRunContext) => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.approvePlannerPlan({ threadId: thread.id, planId: 'plan-1' });

    expect(startRun).toHaveBeenCalledOnce();
    expect(startRun.mock.calls[0]?.[0].resolvedTaskPacket?.executionPolicy).toBe('auto_execute');
    expect(db.getThread().turns.some((turn) => /Reply with explicit confirmation/i.test(turn.content))).toBe(false);
  });

  it('derives approved-plan execution tools and continuity from the concrete plan contract', async () => {
    const db = createDb({
      getLatestThreadCompaction: vi.fn(() => ({
        id: 'compaction-1',
        threadId: 'thread-1',
        sourceStartEventId: 'event-old-1',
        sourceEndEventId: 'event-old-9',
        summary:
          'Compacted plan context: build the landing page from the approved plan and finish every file plus verification.',
        inputTokenEstimate: 1200,
        outputTokenEstimate: 120,
        createdAt: '2026-03-14T00:00:00.000Z'
      }))
    });
    const thread = db.getThread() as ThreadDetail;
    thread.rawOutput.push({
      id: 'event-old-9',
      threadId: thread.id,
      runId: 'run-old',
      eventType: 'info',
      payload: {},
      createdAt: '2026-03-14T00:00:00.000Z'
    } as never);
    thread.planner = {
      ...thread.planner,
      composerMode: 'plan',
      turnState: 'plan_ready',
      activePlanId: 'plan-1',
      activePlan: {
        id: 'plan-1',
        threadId: thread.id,
        createdTurnId: 'turn-plan',
        proposedPlanMarkdown: [
          '# Full Plan Execution',
          '',
          '## Summary',
          '- Build a static landing page and keep executing after each slice.',
          '',
          '## Key Changes',
          '- Search the web for a current Unsplash hero image source.',
          '- Read the current workspace files before writing.',
          '- Create `index.html` for the landing page structure.',
          '- Create `styles.css` for responsive styling.',
          '- Create `main.js` for the interactive status update.',
          '',
          '## Test Plan',
          '- Run npm test after writing the files.',
          '',
          '## Assumptions',
          '- If compacted, resume from this approved plan contract.'
        ].join('\n'),
        structuredPlan: {
          title: 'Full Plan Execution',
          summary: ['Build a static landing page and keep executing after each slice.'],
          keyChanges: [
            'Search the web for a current Unsplash hero image source.',
            'Read the current workspace files before writing.',
            'Create `index.html` for the landing page structure.',
            'Create `styles.css` for responsive styling.',
            'Create `main.js` for the interactive status update.'
          ],
          testPlan: ['Run npm test after writing the files.'],
          assumptions: ['If compacted, resume from this approved plan contract.']
        },
        status: 'draft',
        createdAt: '2026-03-14T00:00:00.000Z'
      },
      pendingQuestionSet: {
        id: 'question-set-1',
        threadId: thread.id,
        promptTurnId: 'turn-plan-request',
        callId: 'ask-1',
        questions: [],
        answers: {
          scope: {
            answers: ['Finish all slices before final response'],
            otherText: null
          }
        },
        createdAt: '2026-03-14T00:00:00.000Z'
      } as never
    };
    const startRun = vi.fn(async () => ({
      runId: 'run-1',
      cancel: async () => {}
    }));
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ startRun }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    await manager.approvePlannerPlan({ threadId: thread.id, planId: 'plan-1' });

    const providerContext = startRun.mock.calls[0]?.[0] as ProviderRunContext | undefined;
    expect(providerContext?.harnessTaskContract?.objective).toContain('Search the web for a current Unsplash hero image source.');
    expect(providerContext?.resolvedTaskPacket).toMatchObject({
      trigger: 'direct_task',
      executionPolicy: 'auto_execute',
      expectedToolGroups: [
        'workspace_read',
        'workspace_write',
        'web_research',
        'command',
        'verification'
      ]
    });
    expect(providerContext?.prompt).toContain('Compacted thread state:');
    expect(providerContext?.prompt).toContain('Compacted plan context: build the landing page');
    expect(providerContext?.prompt).toContain('Expected tool groups: workspace_read, workspace_write, web_research, command, verification');
    expect(providerContext?.prompt).toContain('When one item is complete, continue to the next item in the same run without waiting for the user.');
    expect(providerContext?.prompt).toContain('If thread history has been compacted or truncated, resume from this contract and the current workspace state.');
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

  it('keeps native planner delta boundaries during streaming and normalizes the final proposed plan', async () => {
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
      'Next steps'
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

  it('keeps native planner snapshot boundaries during streaming and normalizes the proposed plan', async () => {
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
      'Next steps'
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
        prompt: expect.stringContaining('User request:\nUse the helper'),
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
        prompt: expect.stringContaining('User request:\nPlan the implementation.'),
        modelId: 'gpt-5',
        resumeSessionId: null
      }),
      expect.any(Object)
    );
  });

  it('records Codex planner runs as provider-adapter compatibility authority', async () => {
    const startRun = vi.fn(async (_context: unknown, callbacks: ProviderRunCallbacks) => {
      callbacks.onStart();
      return {
        runId: 'run-1',
        cancel: async () => {}
      };
    });
    const db = createDb();
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

    const compatibilityTrace = (db.addRunEvent as ReturnType<typeof vi.fn>).mock.calls
      .filter(([, , eventType, payload]) => eventType === 'info' && payload && typeof payload === 'object' && 'runtimeTrace' in payload)
      .map(([, , , payload]) => (payload as { runtimeTrace: { stage: string; detail?: Record<string, unknown> | null } }).runtimeTrace)
      .find((trace) => trace.stage === 'provider_model_compatibility_dispatch_started');

    expect(compatibilityTrace?.detail).toEqual({
      providerId: 'openai',
      runMode: 'plan',
      compatibilityAuthority: 'provider_adapter',
      normalizedTransport: null,
      executionAuthority: 'provider_cli',
      approvalAuthority: 'none',
      sandboxAuthority: 'provider_cli'
    });
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
        prompt: expect.stringContaining('User request:\nPlan the implementation.'),
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

  it('ignores late provider callbacks after abort', async () => {
    const db = createDb();
    let callbacks: ProviderRunCallbacks | null = null;
    const cancel = vi.fn(async () => {
      callbacks?.onAbort('Run stopped by user.');
    });
    const adapter = createAdapter({
      startRun: async (_context, nextCallbacks) => {
        callbacks = nextCallbacks;
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
      skillIds: [],
      imageAttachments: []
    });

    await manager.stopRun(result.runId);
    expect(cancel).toHaveBeenCalledWith('Run stopped by user.');

    vi.mocked(db.addRunEvent).mockClear();
    vi.mocked(db.updateAssistantTurn).mockClear();
    vi.mocked(db.updateThreadStatus).mockClear();

    callbacks?.onInfo('late info');
    callbacks?.onDelta('late delta');
    callbacks?.onAssistantSnapshot('late snapshot');
    callbacks?.onComplete('late complete');
    callbacks?.onError('late error');

    expect(db.addRunEvent).not.toHaveBeenCalled();
    expect(db.updateAssistantTurn).not.toHaveBeenCalled();
    expect(db.updateThreadStatus).not.toHaveBeenCalled();
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
          projectKnowledgeBlocks: [],
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
            projectKnowledgeRetrievalMs: 0,
            blockCount: 0,
            memoryBlockCount: 2,
            generatedMemoryBlockCount: 0,
            projectKnowledgeBlockCount: 0,
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

  it('records Project Knowledge sources as visible run activity when the run starts', async () => {
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
          memoryBlocks: [],
          generatedMemoryBlocks: [],
          projectKnowledgeBlocks: [
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
            projectKnowledgeRetrievalMs: 0,
            blockCount: 0,
            memoryBlockCount: 0,
            generatedMemoryBlockCount: 0,
            projectKnowledgeBlockCount: 1,
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
      prompt: 'Research the current docs.',
      providerId: 'openai',
      modelId: 'gpt-5',
      executionPermission: 'default',
      skillIds: []
    });

    const startContext = startRun.mock.calls[0]?.[0] as { prompt?: string } | undefined;
    expect(startContext?.prompt).toContain('Project Knowledge:');
    expect(startContext?.prompt).toContain('Source: runtime.md > Web Search');

    const knowledgeEvent = events.find((event) => {
      if (event.type !== 'raw.event') {
        return false;
      }
      const payload = (event.event as { payload?: { activity?: { providerEventType?: string } } }).payload;
      return payload?.activity?.providerEventType === 'project_knowledge_context';
    });

    expect((knowledgeEvent as { event: { payload: { activity: { summary: string; text: string; path: string | null } } } }).event.payload.activity)
      .toEqual(
        expect.objectContaining({
          summary: 'Context: Runtime Patterns',
          text: 'Context: Runtime Patterns\n- Runtime Patterns (runtime.md > Web Search): matched heading, body: web, research',
          path: null
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
          projectKnowledgeBlocks: [],
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
            projectKnowledgeRetrievalMs: 0,
            blockCount: 0,
            memoryBlockCount: 1,
            generatedMemoryBlockCount: 1,
            projectKnowledgeBlockCount: 0,
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

  it('lists only surfaced provider descriptors without leaking adapter internals', async () => {
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
      }),
      ollama: createAdapter({
        id: 'ollama',
        label: 'Ollama',
        listStaticModels: () => [createProviderModel('qwen3', 'Qwen3')],
        getAuthState: async () => ({ authState: 'connected', authMode: null, message: 'Ollama is ready.' }),
        discoverRuntimeModels: async () => [createProviderModel('qwen3', 'Qwen3')]
      })
    });

    const providers = await manager.listProviders();
    const openai = providers.find((provider) => provider.id === 'openai');
    const gemini = providers.find((provider) => provider.id === 'gemini');
    const ollama = providers.find((provider) => provider.id === 'ollama');

    expect(providers.map((provider) => provider.id)).toEqual(['ollama']);
    expect(ollama).toMatchObject({
      plannerPolicy: {
        supported: true,
        executionMode: 'read-only',
        enforcement: 'hard-enforced',
      }
    });
    expect(ollama?.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'qwen3', label: 'Qwen3' })
      ])
    );
    expect(openai).toBeUndefined();
    expect(gemini).toBeUndefined();
    expect(ollama).not.toHaveProperty('startRun');
  });

  it('surfaces enabled key-backed custom OpenAI-compatible providers as picker models', async () => {
    const db = createDb({
      listCustomProviders: vi.fn(() => [
        {
          id: 'custom-provider-1',
          name: 'Gateway',
          transportKind: 'openai_compatible_chat',
          baseUrl: 'https://gateway.example/v1',
          encryptedApiKey: Buffer.from('gateway-secret', 'utf8').toString('base64'),
          defaultModelId: 'gateway-coder',
          enabled: true,
          createdAt: '2026-05-25T00:00:00.000Z',
          updatedAt: '2026-05-25T00:00:00.000Z'
        },
        {
          id: 'custom-provider-disabled',
          name: 'Disabled Gateway',
          transportKind: 'openai_compatible_chat',
          baseUrl: 'https://disabled.example/v1',
          encryptedApiKey: Buffer.from('disabled-secret', 'utf8').toString('base64'),
          defaultModelId: 'disabled-coder',
          enabled: false,
          createdAt: '2026-05-25T00:00:00.000Z',
          updatedAt: '2026-05-25T00:00:00.000Z'
        }
      ])
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ detectInstall: async () => ({ installed: false, cliPath: null }) }),
      ollama: createAdapter({ id: 'ollama', label: 'Ollama', detectInstall: async () => ({ installed: false, cliPath: null }) }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' }),
      openai_compatible: createAdapter({ id: 'openai_compatible', label: 'Custom API' })
    } as never);

    const providers = await manager.listProviders();
    const custom = providers.find((provider) => provider.id === 'openai_compatible');

    expect(custom).toMatchObject({
      id: 'openai_compatible',
      label: 'Custom API',
      installed: true,
      authState: 'connected',
      authMode: 'api_key'
    });
    expect(custom?.models).toEqual([
      expect.objectContaining({
        id: encodeCustomProviderModelId({
          customProviderId: 'custom-provider-1',
          modelId: 'gateway-coder'
        }),
        label: 'Gateway · gateway-coder'
      })
    ]);
    expect(custom?.models.some((model) => model.label.includes('Disabled'))).toBe(false);
  });

  it('hides the custom API picker lane until an enabled key-backed provider exists', async () => {
    const manager = new ProviderManager(createDb() as never, {
      openai: createAdapter({ detectInstall: async () => ({ installed: false, cliPath: null }) }),
      ollama: createAdapter({ id: 'ollama', label: 'Ollama', detectInstall: async () => ({ installed: false, cliPath: null }) }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' }),
      openai_compatible: createAdapter({ id: 'openai_compatible', label: 'Custom API' })
    } as never);

    const providers = await manager.listProviders();

    expect(providers.some((provider) => provider.id === 'openai_compatible')).toBe(false);
  });

  it('keeps incomplete custom providers out of the picker lane', async () => {
    const db = createDb({
      listCustomProviders: vi.fn(() => [
        {
          id: 'missing-key',
          name: 'Missing Key',
          transportKind: 'openai_compatible_chat',
          baseUrl: 'https://gateway.example/v1',
          encryptedApiKey: '',
          defaultModelId: 'gateway-coder',
          enabled: true,
          createdAt: '2026-05-25T00:00:00.000Z',
          updatedAt: '2026-05-25T00:00:00.000Z'
        },
        {
          id: 'missing-model',
          name: 'Missing Model',
          transportKind: 'openai_compatible_chat',
          baseUrl: 'https://gateway.example/v1',
          encryptedApiKey: Buffer.from('secret', 'utf8').toString('base64'),
          defaultModelId: '   ',
          enabled: true,
          createdAt: '2026-05-25T00:00:00.000Z',
          updatedAt: '2026-05-25T00:00:00.000Z'
        },
        {
          id: 'missing-url',
          name: 'Missing URL',
          transportKind: 'openai_compatible_chat',
          baseUrl: '   ',
          encryptedApiKey: Buffer.from('secret', 'utf8').toString('base64'),
          defaultModelId: 'gateway-coder',
          enabled: true,
          createdAt: '2026-05-25T00:00:00.000Z',
          updatedAt: '2026-05-25T00:00:00.000Z'
        }
      ])
    });
    const manager = new ProviderManager(db as never, {
      openai: createAdapter({ detectInstall: async () => ({ installed: false, cliPath: null }) }),
      ollama: createAdapter({ id: 'ollama', label: 'Ollama', detectInstall: async () => ({ installed: false, cliPath: null }) }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' }),
      openai_compatible: createAdapter({ id: 'openai_compatible', label: 'Custom API' })
    } as never);

    const custom = await manager.getProvider('openai_compatible');

    expect(custom.installed).toBe(false);
    expect(custom.authState).toBe('disconnected');
    expect(custom.models).toEqual([]);
    expect((await manager.listProviders()).some((provider) => provider.id === 'openai_compatible')).toBe(false);
  });

  it('stops in-flight Custom API normalized runs through the app-owned harness', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'vicode-provider-manager-custom-cancel-'));
    const encodedModelId = encodeCustomProviderModelId({
      customProviderId: 'custom-provider-1',
      modelId: 'gateway-coder'
    });
    let abortSignal: AbortSignal | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((_url: string, init?: RequestInit) => {
      abortSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        abortSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }) as never;
    const db = createDb({
      getProject: vi.fn(() => createProject({ folderPath: workspace, trusted: true })),
      listCustomProviders: vi.fn(() => [
        {
          id: 'custom-provider-1',
          name: 'Gateway',
          transportKind: 'openai_compatible_chat',
          baseUrl: 'https://gateway.example/v1',
          encryptedApiKey: Buffer.from('gateway-secret', 'utf8').toString('base64'),
          defaultModelId: 'gateway-coder',
          enabled: true,
          createdAt: '2026-05-25T00:00:00.000Z',
          updatedAt: '2026-05-25T00:00:00.000Z'
        }
      ]),
      getCustomProvider: vi.fn(() => ({
        id: 'custom-provider-1',
        name: 'Gateway',
        transportKind: 'openai_compatible_chat',
        baseUrl: 'https://gateway.example/v1',
        encryptedApiKey: Buffer.from('gateway-secret', 'utf8').toString('base64'),
        defaultModelId: 'gateway-coder',
        enabled: true,
        createdAt: '2026-05-25T00:00:00.000Z',
        updatedAt: '2026-05-25T00:00:00.000Z'
      }))
    });
    const manager = new ProviderManager(db as never, {
      openai_compatible: createAdapter({ id: 'openai_compatible', label: 'Custom API' })
    } as never);

    try {
      const result = await manager.submitComposer({
        projectId: 'project-1',
        prompt: 'Inspect the workspace.',
        providerId: 'openai_compatible',
        modelId: encodedModelId,
        executionPermission: 'default'
      });
      expect(result.disposition).toBe('started');

      await vi.waitFor(() => {
        expect(abortSignal).not.toBeNull();
      });

      await manager.stopRun((result as { runId: string }).runId);

      expect(abortSignal?.aborted).toBe(true);
      expect(db.addRunEvent).toHaveBeenCalledWith(
        'thread-1',
        (result as { runId: string }).runId,
        'aborted',
        expect.objectContaining({
          message: 'Run stopped by user.'
        })
      );
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('runs the Custom API picker model through the app-owned tool approval and persistence loop', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'vicode-provider-manager-custom-loop-'));
    tempDirs.push(workspace);
    const apiKey = 'gateway-secret';
    const customProvider = {
      id: 'custom-provider-1',
      name: 'Gateway',
      transportKind: 'openai_compatible_chat' as const,
      baseUrl: 'https://gateway.example/v1',
      encryptedApiKey: Buffer.from(apiKey, 'utf8').toString('base64'),
      defaultModelId: 'gateway-coder',
      enabled: true,
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:00:00.000Z'
    };
    const encodedModelId = encodeCustomProviderModelId({
      customProviderId: customProvider.id,
      modelId: customProvider.defaultModelId
    });
    const fetchRequests: Array<{ url: string; authorization: string | null; body: Record<string, unknown> }> = [];
    const fetchResponses = [
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'I need to run the approved command.',
              tool_calls: [
                {
                  id: 'call-run-command',
                  type: 'function',
                  function: {
                    name: 'run_command',
                    arguments: JSON.stringify({
                      command: 'npm test -- --runInBand',
                      cwd: '.'
                    })
                  }
                }
              ]
            }
          }
        ]
      },
      {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'The app-owned command approval loop completed.',
              tool_calls: []
            }
          }
        ]
      }
    ];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      fetchRequests.push({
        url,
        authorization: init?.headers instanceof Headers
          ? init.headers.get('authorization')
          : (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      });
      const payload = fetchResponses.shift();
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }) as never;
    const db = createDb({
      getProject: vi.fn(() =>
        createProject({
          folderPath: workspace,
          trusted: true,
          runtimeCommandPolicy: 'approval_required',
          runtimeNetworkPolicy: 'disabled'
        })
      ),
      listCustomProviders: vi.fn(() => [customProvider]),
      getCustomProvider: vi.fn(() => customProvider)
    });
    const agentRuntime = new AgentRuntimeService();
    const executeToolCall = vi.spyOn(agentRuntime, 'executeToolCall').mockImplementation(async (call, context) => {
      const decision = await context.requestApproval?.({
        toolName: call.name,
        command: String(call.arguments.command ?? ''),
        cwd: typeof call.arguments.cwd === 'string' ? call.arguments.cwd : null,
        workspaceRoot: context.workspaceRoot
      });
      return {
        toolName: call.name,
        content: `approval:${decision ?? 'missing'}`,
        isError: decision !== 'approved'
      };
    });
    const manager = new ProviderManager(
      db as never,
      {
        openai_compatible: createAdapter({ id: 'openai_compatible', label: 'Custom API' })
      } as never,
      undefined,
      undefined,
      agentRuntime
    );

    try {
      const providers = await manager.listProviders();
      const custom = providers.find((provider) => provider.id === 'openai_compatible');
      expect(custom?.models[0]).toEqual(
        expect.objectContaining({
          id: encodedModelId,
          label: 'Gateway · gateway-coder'
        })
      );

      const result = await manager.submitComposer({
        projectId: 'project-1',
        prompt: 'Run the test command through the Custom API tool loop.',
        providerId: 'openai_compatible',
        modelId: encodedModelId,
        executionPermission: 'full_access',
        skillIds: []
      });
      expect(result.disposition).toBe('started');

      await vi.waitFor(() => {
        expect(manager.listPendingToolApprovals()).toEqual([
          expect.objectContaining({
            providerId: 'openai_compatible',
            toolName: 'run_command',
            command: 'npm test -- --runInBand',
            workspaceRoot: workspace
          })
        ]);
      });
      const approvalId = manager.listPendingToolApprovals()[0]!.id;
      manager.approveToolApproval(approvalId);

      await vi.waitFor(() => {
        expect(db.updateThreadStatus).toHaveBeenCalledWith('thread-1', 'completed');
      });

      const rawOutput = db.getThread().rawOutput;
      const traceStages = rawOutput
        .map((event) => event.payload.runtimeTrace)
        .filter(Boolean)
        .map((trace) => trace.stage);
      expect(traceStages).toEqual(
        expect.arrayContaining([
          'provider_model_normalized_dispatch_started',
          'first_tool_call',
          'first_tool_result',
          'completed'
        ])
      );
      expect(traceStages).not.toContain('provider_model_compatibility_dispatch_started');
      expect(rawOutput).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: 'started',
            payload: expect.objectContaining({
              providerId: 'openai_compatible',
              modelId: customProvider.defaultModelId
            })
          }),
          expect.objectContaining({
            eventType: 'completed',
            payload: {
              output: 'The app-owned command approval loop completed.'
            }
          })
        ])
      );
      expect(executeToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'run_command',
          arguments: expect.objectContaining({
            command: 'npm test -- --runInBand'
          })
        }),
        expect.objectContaining({
          workspaceRoot: workspace,
          threadId: 'thread-1',
          executionPermission: 'full_access',
          runtimeCommandPolicy: 'approval_required',
          runtimeNetworkPolicy: 'disabled'
        })
      );
      expect(fetchRequests).toHaveLength(2);
      expect(fetchRequests[0]?.url).toBe('https://gateway.example/v1/chat/completions');
      expect(fetchRequests[0]?.authorization).toBe(`Bearer ${apiKey}`);
      expect(JSON.stringify(fetchRequests[0]?.body)).toContain('"run_command"');
      expect(JSON.stringify(fetchRequests[1]?.body)).toContain('"role":"tool"');
      expect(JSON.stringify(fetchRequests[1]?.body)).toContain('approval:approved');
      expect(manager.listPendingToolApprovals()).toEqual([]);
      expect(JSON.stringify(rawOutput)).not.toContain(apiKey);
      expect(JSON.stringify(manager.listCustomProviderSettings())).not.toContain(apiKey);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('saves custom OpenAI-compatible provider settings with encrypted API keys and returns redacted settings', async () => {
    const storedProvider = {
      id: 'custom-provider-1',
      name: 'Gateway',
      transportKind: 'openai_compatible_chat' as const,
      baseUrl: 'https://gateway.example/v1',
      encryptedApiKey: Buffer.from('gateway-secret', 'utf8').toString('base64'),
      defaultModelId: 'gateway-coder',
      enabled: true,
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:00:00.000Z'
    };
    const db = createDb({
      saveCustomProvider: vi.fn((input) => ({
        ...input,
        id: input.id ?? storedProvider.id,
        createdAt: storedProvider.createdAt,
        updatedAt: storedProvider.updatedAt
      })),
      listCustomProviders: vi.fn(() => [storedProvider])
    });
    const savingManager = new ProviderManager(db as never, {
      openai: createAdapter(),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    });

    const saved = await savingManager.saveCustomProviderSettings({
      name: 'Gateway',
      transportKind: 'openai_compatible_chat',
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'gateway-secret',
      defaultModelId: 'gateway-coder',
      enabled: true
    });
    const listed = savingManager.listCustomProviderSettings();

    expect(db.saveCustomProvider).toHaveBeenCalledWith({
      name: 'Gateway',
      transportKind: 'openai_compatible_chat',
      baseUrl: 'https://gateway.example/v1',
      encryptedApiKey: Buffer.from('gateway-secret', 'utf8').toString('base64'),
      defaultModelId: 'gateway-coder',
      enabled: true
    });
    expect(saved).toEqual({
      id: 'custom-provider-1',
      name: 'Gateway',
      transportKind: 'openai_compatible_chat',
      baseUrl: 'https://gateway.example/v1',
      defaultModelId: 'gateway-coder',
      enabled: true,
      hasApiKey: true,
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:00:00.000Z'
    } satisfies CustomProviderSettings);
    expect(saved).not.toHaveProperty('encryptedApiKey');
    expect(listed).toEqual([saved]);
  });
});
