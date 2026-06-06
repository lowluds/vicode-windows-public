import type { ProviderRunContext } from '../../providers/types';
import type {
  ProviderId
} from '../../shared/domain';
import { providerDisplayName } from '../../shared/providers';
import type { WorkspaceSnapshot } from './workspace-changes';
import type { HarnessWorktreeSession } from './harness-worktree-session';

export interface ProviderExecutionSuccessFinalizationInput {
  threadId: string;
  runId: string;
  output: string;
  workspaceSnapshot: WorkspaceSnapshot | null;
  projectFolderPath: string;
  approvedPlan: boolean;
  titlePrompt: string | null;
  changeArtifactSource?: 'workspace_diff' | 'provider_reported' | 'staged_workspace_preview' | 'worktree_diff';
  harnessWorktreeSession?: HarnessWorktreeSession | null;
}

export interface ProviderExecutionCleanupSuccessFinalizationInput extends ProviderExecutionSuccessFinalizationInput {
  providerId: ProviderId;
  modelId: string;
}

export interface ProviderExecutionFailureFinalizationInput {
  threadId: string;
  runId: string;
  message: string;
  traceStage: 'failed' | 'aborted';
  tracePayload?: Record<string, unknown> | null;
  eventType: 'failed' | 'aborted';
  threadStatus: 'failed' | 'aborted';
  runStatus: 'failed' | 'aborted';
  progressStatus: 'failed' | 'blocked';
  approvedPlan: boolean;
  titlePrompt: string | null;
}

export interface ProviderExecutionFinalizationHost {
  finalizeSuccessfulExecutionRun(input: ProviderExecutionSuccessFinalizationInput): void;
  finalizeExecutionRunFailure(input: ProviderExecutionFailureFinalizationInput): void;
  shouldFinalizeWithProviderCleanup(providerId: ProviderId, output: string): boolean;
  finalizeSuccessfulExecutionRunWithProviderCleanup(input: ProviderExecutionCleanupSuccessFinalizationInput): Promise<void>;
  finalizeProviderModelAssistantOutput(context: ProviderRunContext, output: string): Promise<string>;
}

export function buildProviderExecutionSuccessFinalization(input: {
  threadId: string;
  runId: string;
  output: string;
  workspaceSnapshot: WorkspaceSnapshot | null;
  projectFolderPath: string;
  approvedPlan: boolean;
  titlePrompt: string | null;
  harnessWorktreeSession?: HarnessWorktreeSession | null;
}): ProviderExecutionSuccessFinalizationInput {
  return {
    threadId: input.threadId,
    runId: input.runId,
    output: input.output,
    workspaceSnapshot: input.workspaceSnapshot,
    projectFolderPath: input.projectFolderPath,
    approvedPlan: input.approvedPlan,
    titlePrompt: input.titlePrompt,
    changeArtifactSource: input.harnessWorktreeSession ? 'worktree_diff' : undefined,
    harnessWorktreeSession: input.harnessWorktreeSession
  };
}

export function buildProviderExecutionCleanupSuccessFinalization(input: {
  providerId: ProviderId;
  modelId: string;
  threadId: string;
  runId: string;
  output: string;
  workspaceSnapshot: WorkspaceSnapshot | null;
  projectFolderPath: string;
  approvedPlan: boolean;
  titlePrompt: string | null;
  harnessWorktreeSession?: HarnessWorktreeSession | null;
}): ProviderExecutionCleanupSuccessFinalizationInput {
  return {
    providerId: input.providerId,
    modelId: input.modelId,
    ...buildProviderExecutionSuccessFinalization(input)
  };
}

export function buildProviderExecutionFailedFinalization(input: {
  threadId: string;
  runId: string;
  message: string;
  tracePayload?: Record<string, unknown> | null;
  approvedPlan: boolean;
  titlePrompt: string | null;
}): ProviderExecutionFailureFinalizationInput {
  return {
    threadId: input.threadId,
    runId: input.runId,
    message: input.message,
    traceStage: 'failed',
    tracePayload: input.tracePayload,
    eventType: 'failed',
    threadStatus: 'failed',
    runStatus: 'failed',
    progressStatus: 'failed',
    approvedPlan: input.approvedPlan,
    titlePrompt: input.titlePrompt
  };
}

export function buildProviderExecutionAbortedFinalization(input: {
  threadId: string;
  runId: string;
  message: string;
  approvedPlan: boolean;
}): ProviderExecutionFailureFinalizationInput {
  return {
    threadId: input.threadId,
    runId: input.runId,
    message: input.message,
    traceStage: 'aborted',
    tracePayload: input.message ? { message: input.message } : null,
    eventType: 'aborted',
    threadStatus: 'aborted',
    runStatus: 'aborted',
    progressStatus: 'blocked',
    approvedPlan: input.approvedPlan,
    titlePrompt: null
  };
}

export function buildProviderExecutionEmptyOutputFailure(input: {
  providerId: ProviderId;
  threadId: string;
  runId: string;
  approvedPlan: boolean;
  titlePrompt: string | null;
}): ProviderExecutionFailureFinalizationInput {
  return buildProviderExecutionFailedFinalization({
    threadId: input.threadId,
    runId: input.runId,
    message: `${providerDisplayName(input.providerId)} completed without producing assistant output.`,
    tracePayload: { reason: 'empty_output' },
    approvedPlan: input.approvedPlan,
    titlePrompt: input.titlePrompt
  });
}

export function resolveProviderExecutionTitlePrompt(input: {
  shouldGenerateTitle: boolean;
  prompt: string;
}) {
  return input.shouldGenerateTitle ? input.prompt : null;
}

export function resolveProviderExecutionApprovedPlan(input: {
  approvedPlan?: unknown | null;
}) {
  return Boolean(input.approvedPlan);
}
