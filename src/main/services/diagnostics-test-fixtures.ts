import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SubagentSummary, ThreadDetail } from '../../shared/domain';
import { createDiagnosticsFailedRunEvents } from './diagnostics-test-failed-run-events';
import { createDiagnosticsRunOneEvents } from './diagnostics-test-run-one-events';
import { createDiagnosticsWorktreeEvents } from './diagnostics-test-worktree-events';

const createdDirs: string[] = [];

export async function createExportsDir() {
  const dir = await mkdtemp(join(tmpdir(), 'vicode-diagnostics-test-'));
  createdDirs.push(dir);
  return dir;
}

export function createSubagentSummary(overrides: Partial<SubagentSummary> = {}): SubagentSummary {
  return {
    id: 'subagent-1',
    parentThreadId: 'thread-1',
    parentRunId: 'run-1',
    childThreadId: 'thread-child',
    childRunId: 'run-child',
    name: 'researcher',
    title: 'Inspect current harness state',
    prompt: 'Inspect current harness state.',
    providerId: 'openai',
    modelId: 'gpt-5',
    executionPermission: 'default',
    delegationProfile: 'research',
    status: 'completed',
    outputSummary: 'Found existing hook evidence and verification artifacts.',
    lastError: null,
    createdAt: '2026-03-17T00:00:01.000Z',
    updatedAt: '2026-03-17T00:00:02.000Z',
    startedAt: '2026-03-17T00:00:01.100Z',
    completedAt: '2026-03-17T00:00:02.000Z',
    ...overrides
  };
}

export function createThreadDetail(): ThreadDetail {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Codex planning thread',
    providerId: 'openai',
    modelId: 'gpt-5',
    executionPermission: 'default',
    status: 'completed',
    archived: false,
    lastMessageAt: '2026-03-17T00:00:00.000Z',
    createdAt: '2026-03-17T00:00:00.000Z',
    updatedAt: '2026-03-17T00:00:00.000Z',
    lastPreview: '',
    turns: [
      {
        id: 'turn-1',
        threadId: 'thread-1',
        runId: 'run-1',
        role: 'user',
        content: 'Implement the harness handoff state.',
        metadata: {
          harnessTaskContract: {
            taskKind: 'edit',
            objective: 'Implement the harness handoff state.',
            workspaceRoot: 'C:/Users/test-user/Desktop/vicode-project',
            allowedPaths: ['src/shared', 'src/main/services'],
            deniedPaths: ['release'],
            expectedMutations: 'workspace_write',
            verificationPolicy: 'required',
            isolationMode: 'direct_workspace',
            riskLevel: 'medium',
            executionPermission: 'default',
            trustedWorkspace: true,
            runtimeCommandPolicy: 'approval_required',
            runtimeNetworkPolicy: 'disabled',
            commandAccess: 'approval_required',
            networkAccess: 'disabled'
          }
        },
        createdAt: '2026-03-17T00:00:00.000Z'
      }
    ],
    rawOutput: [
      ...createDiagnosticsRunOneEvents(),
      ...createDiagnosticsWorktreeEvents(),
      ...createDiagnosticsFailedRunEvents()
    ],
    planner: {
      threadId: 'thread-1',
      composerMode: 'default',
      turnState: 'idle',
      activePlanId: null,
      pendingQuestionCallId: null,
      updatedAt: '2026-03-17T00:00:00.000Z',
      activePlan: null,
      pendingQuestionSet: null
    },
    followUps: []
  };
}

export async function cleanupDiagnosticsTestDirs() {
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}
