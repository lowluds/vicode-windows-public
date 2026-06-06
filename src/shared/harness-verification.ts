import type {
  ExecutionPermission,
  ProjectRuntimeNetworkPolicy
} from './domain';

export type VerificationPlanStatus = 'planned' | 'skipped';
export type VerificationArtifactStatus = 'passed' | 'failed' | 'timed_out' | 'skipped';
export type VerificationCommandSource =
  | 'package_json_test_script'
  | 'package_json_build_script'
  | 'typescript_config'
  | 'unavailable';

export interface VerificationResultShape {
  status: 'not_run' | 'skipped';
  exitCode: null;
}

export interface VerificationPlan {
  command: string | null;
  commandSource: VerificationCommandSource;
  cwd: string | null;
  permissionProfile: ExecutionPermission;
  networkPolicy: ProjectRuntimeNetworkPolicy;
  status: VerificationPlanStatus;
  reason: string;
  skippedReason: string | null;
  resultShape: VerificationResultShape;
}

export interface VerificationArtifact {
  command: string | null;
  cwd: string | null;
  permissionProfile: ExecutionPermission;
  networkPolicy: ProjectRuntimeNetworkPolicy;
  status: VerificationArtifactStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  reason: string;
  skippedReason: string | null;
}

export interface VerificationPackageJsonInput {
  scripts?: Record<string, string | undefined> | null;
}

export interface DeriveVerificationPlanInput {
  cwd: string | null;
  executionPermission: ExecutionPermission;
  runtimeNetworkPolicy: ProjectRuntimeNetworkPolicy;
  packageJson?: VerificationPackageJsonInput | null;
  hasTypeScriptConfig?: boolean;
}

function hasScript(
  packageJson: VerificationPackageJsonInput | null | undefined,
  name: string
) {
  return Boolean(packageJson?.scripts?.[name]?.trim());
}

function planned(input: {
  command: string;
  commandSource: VerificationCommandSource;
  cwd: string | null;
  executionPermission: ExecutionPermission;
  runtimeNetworkPolicy: ProjectRuntimeNetworkPolicy;
  reason: string;
}): VerificationPlan {
  return {
    command: input.command,
    commandSource: input.commandSource,
    cwd: input.cwd,
    permissionProfile: input.executionPermission,
    networkPolicy: input.runtimeNetworkPolicy,
    status: 'planned',
    reason: input.reason,
    skippedReason: null,
    resultShape: {
      status: 'not_run',
      exitCode: null
    }
  };
}

export function deriveVerificationPlan(input: DeriveVerificationPlanInput): VerificationPlan {
  if (hasScript(input.packageJson, 'test')) {
    return planned({
      command: 'npm test',
      commandSource: 'package_json_test_script',
      cwd: input.cwd,
      executionPermission: input.executionPermission,
      runtimeNetworkPolicy: input.runtimeNetworkPolicy,
      reason: 'package.json defines a test script.'
    });
  }

  if (hasScript(input.packageJson, 'build')) {
    return planned({
      command: 'npm run build',
      commandSource: 'package_json_build_script',
      cwd: input.cwd,
      executionPermission: input.executionPermission,
      runtimeNetworkPolicy: input.runtimeNetworkPolicy,
      reason: 'package.json defines a build script and no test script was available.'
    });
  }

  if (input.hasTypeScriptConfig === true) {
    return planned({
      command: 'tsc --noEmit',
      commandSource: 'typescript_config',
      cwd: input.cwd,
      executionPermission: input.executionPermission,
      runtimeNetworkPolicy: input.runtimeNetworkPolicy,
      reason: 'TypeScript config exists and no package test/build script was available.'
    });
  }

  return {
    command: null,
    commandSource: 'unavailable',
    cwd: input.cwd,
    permissionProfile: input.executionPermission,
    networkPolicy: input.runtimeNetworkPolicy,
    status: 'skipped',
    reason: 'No automatic verification command could be selected.',
    skippedReason: 'No package.json test/build script or TypeScript config was detected.',
    resultShape: {
      status: 'skipped',
      exitCode: null
    }
  };
}

export function createSkippedVerificationArtifact(
  plan: VerificationPlan,
  skippedReason = plan.skippedReason ?? 'Verification was not executed in this slice.'
): VerificationArtifact {
  return {
    command: plan.command,
    cwd: plan.cwd,
    permissionProfile: plan.permissionProfile,
    networkPolicy: plan.networkPolicy,
    status: 'skipped',
    exitCode: null,
    stdout: '',
    stderr: '',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    reason: plan.reason,
    skippedReason
  };
}
