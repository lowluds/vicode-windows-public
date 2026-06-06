import type {
  ComposerMode,
  ExecutionPermission,
  HarnessIsolationMode,
  ProjectRuntimeCommandPolicy,
  ProjectRuntimeNetworkPolicy
} from './domain';
import { deriveRuntimePolicy } from './runtime-policy';
import type { RuntimePolicy } from './runtime-policy';

export type { HarnessIsolationMode } from './domain';

export type HarnessTaskKind = 'ask' | 'plan' | 'edit' | 'review' | 'verify';
export type HarnessExpectedMutations = 'none' | 'patch_proposal' | 'workspace_write';
export type HarnessVerificationPolicy = 'none' | 'suggested' | 'required';
export type HarnessRiskLevel = 'low' | 'medium' | 'high';
export type HarnessConversationPhase = 'chat' | 'ready_to_task' | 'task_plan';
export type HarnessTaskIntentSource = 'prompt' | 'composer_plan_mode';

export interface HarnessTaskContract {
  taskKind: HarnessTaskKind;
  conversationPhase?: HarnessConversationPhase;
  taskIntentSource?: HarnessTaskIntentSource;
  objective: string;
  workspaceRoot: string | null;
  allowedPaths: string[];
  deniedPaths: string[];
  expectedMutations: HarnessExpectedMutations;
  verificationPolicy: HarnessVerificationPolicy;
  isolationMode: HarnessIsolationMode;
  riskLevel: HarnessRiskLevel;
  executionPermission: ExecutionPermission;
  trustedWorkspace: boolean;
  runtimeCommandPolicy: ProjectRuntimeCommandPolicy;
  runtimeNetworkPolicy: ProjectRuntimeNetworkPolicy;
  commandAccess: RuntimePolicy['commandAccess'];
  networkAccess: RuntimePolicy['networkAccess'];
}

export interface DeriveHarnessTaskContractInput {
  prompt: string;
  mode?: ComposerMode;
  workspaceRoot?: string | null;
  allowedPaths?: string[];
  deniedPaths?: string[];
  executionPermission?: ExecutionPermission;
  isolationMode?: HarnessIsolationMode;
  trustedWorkspace?: boolean;
  runtimeCommandPolicy?: ProjectRuntimeCommandPolicy;
  runtimeNetworkPolicy?: ProjectRuntimeNetworkPolicy;
}

const MUTATION_PATTERN =
  /\b(?:add|apply|change|create|delete|edit|fix|implement|make|modify|patch|remove|replace|rewrite|save|update|write)\b/iu;
const VERIFY_PATTERN =
  /\b(?:audit|build|check|lint|smoke|test|typecheck|verify|vitest)\b/iu;
const REVIEW_PATTERN = /\b(?:audit|inspect|review)\b/iu;
const HIGH_RISK_PATTERN =
  /\b(?:delete|migration|provider rewrite|remove|schema change|security|worktree)\b/iu;
const CONVERSATION_PATTERN =
  /\b(?:brainstorm|chat|convers(?:ation|e)|discuss|explore|help me decide|idea|ideas|reply|talk through|think through|what do you think)\b/iu;
const EXPLICIT_ACTION_PATTERN =
  /\b(?:apply|create|delete|edit|go ahead|implement|make the change|modify|patch|remove|replace|rewrite|run|save|start(?: the)? task|test|update|verify|write)\b/iu;
const NON_MUTATING_DIRECTIVE_PATTERN =
  /\b(?:(?:keep\s+)?(?:this\s+)?(?:as\s+)?(?:still\s+)?(?:chat|conversation|discussion|brainstorming)[-\s]+only|still\s+(?:chat|conversation|discussion|brainstorming)[-\s]+only|do\s+not\s+(?:edit|write|create|change|modify|patch|save|update|delete|remove|run|use\s+tools?|touch)\b[^.!?;]*|don['’]?t\s+(?:edit|write|create|change|modify|patch|save|update|delete|remove|run|use\s+tools?|touch)\b[^.!?;]*|without\s+(?:editing|writing|creating|changing|modifying|patching|saving|updating|deleting|removing|running|using\s+tools?|touching)\b[^.!?;]*|no\s+(?:file\s+changes?|workspace\s+changes?|edits?|writes?|tool\s+use|tools?|commands?|implementation)\b)/giu;

function normalizeObjective(prompt: string) {
  return prompt.trim().replace(/\s+/gu, ' ');
}

function normalizePaths(paths: string[] | undefined) {
  return Array.from(
    new Set((paths ?? []).map((path) => path.trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
}

export function stripNonMutatingTaskDirectives(prompt: string) {
  return prompt.replace(NON_MUTATING_DIRECTIVE_PATTERN, ' ');
}

function deriveTaskKind(prompt: string, mode: ComposerMode): HarnessTaskKind {
  if (mode === 'plan') {
    return 'plan';
  }

  const actionablePrompt = stripNonMutatingTaskDirectives(prompt);

  if (CONVERSATION_PATTERN.test(prompt) && !EXPLICIT_ACTION_PATTERN.test(actionablePrompt)) {
    return 'ask';
  }

  if (MUTATION_PATTERN.test(actionablePrompt)) {
    return 'edit';
  }

  if (VERIFY_PATTERN.test(actionablePrompt)) {
    return 'verify';
  }

  if (REVIEW_PATTERN.test(actionablePrompt)) {
    return 'review';
  }

  return 'ask';
}

function deriveConversationPhase(taskKind: HarnessTaskKind): HarnessConversationPhase {
  if (taskKind === 'ask') {
    return 'chat';
  }

  return taskKind === 'plan' ? 'task_plan' : 'ready_to_task';
}

function deriveRiskLevel(input: {
  objective: string;
  expectedMutations: HarnessExpectedMutations;
  trustedWorkspace: boolean;
  commandAccess: RuntimePolicy['commandAccess'];
  networkAccess: RuntimePolicy['networkAccess'];
}): HarnessRiskLevel {
  if (
    HIGH_RISK_PATTERN.test(input.objective)
    || !input.trustedWorkspace
    || input.commandAccess === 'auto_approve'
    || input.networkAccess === 'host_local'
  ) {
    return 'high';
  }

  return input.expectedMutations === 'workspace_write' ? 'medium' : 'low';
}

export function deriveHarnessTaskContract({
  prompt,
  mode = 'default',
  workspaceRoot = null,
  allowedPaths,
  deniedPaths,
  executionPermission = 'default',
  isolationMode = 'direct_workspace',
  trustedWorkspace = true,
  runtimeCommandPolicy = 'approval_required',
  runtimeNetworkPolicy = 'disabled'
}: DeriveHarnessTaskContractInput): HarnessTaskContract {
  const objective = normalizeObjective(prompt);
  const taskKind = deriveTaskKind(objective, mode);
  const expectedMutations: HarnessExpectedMutations =
    taskKind === 'edit'
      ? isolationMode === 'patch_buffer'
        ? 'patch_proposal'
        : 'workspace_write'
      : 'none';
  const verificationPolicy: HarnessVerificationPolicy =
    taskKind === 'edit' || taskKind === 'verify' ? 'required' : 'none';
  const runtimePolicy = deriveRuntimePolicy(
    executionPermission,
    runtimeCommandPolicy,
    runtimeNetworkPolicy
  );
  const riskLevel = deriveRiskLevel({
    objective,
    expectedMutations,
    trustedWorkspace,
    commandAccess: runtimePolicy.commandAccess,
    networkAccess: runtimePolicy.networkAccess
  });

  return {
    taskKind,
    conversationPhase: deriveConversationPhase(taskKind),
    taskIntentSource: mode === 'plan' ? 'composer_plan_mode' : 'prompt',
    objective,
    workspaceRoot,
    allowedPaths: normalizePaths(allowedPaths),
    deniedPaths: normalizePaths(deniedPaths),
    expectedMutations,
    verificationPolicy,
    isolationMode,
    riskLevel,
    executionPermission,
    trustedWorkspace,
    runtimeCommandPolicy,
    runtimeNetworkPolicy,
    commandAccess: runtimePolicy.commandAccess,
    networkAccess: runtimePolicy.networkAccess
  };
}
