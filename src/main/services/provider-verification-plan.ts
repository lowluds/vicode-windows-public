import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ExecutionPermission,
  ProjectRuntimeNetworkPolicy
} from '../../shared/domain';
import {
  deriveVerificationPlan,
  type VerificationPackageJsonInput,
  type VerificationPlan
} from '../../shared/harness-verification';

function readPackageJson(folderPath: string | null): VerificationPackageJsonInput | null {
  if (!folderPath) {
    return null;
  }

  const packageJsonPath = join(folderPath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as VerificationPackageJsonInput;
  } catch {
    return null;
  }
}

function hasTypeScriptConfig(folderPath: string | null) {
  return Boolean(folderPath && existsSync(join(folderPath, 'tsconfig.json')));
}

export function deriveWorkspaceVerificationPlan(input: {
  workspaceRoot: string | null;
  executionPermission: ExecutionPermission;
  runtimeNetworkPolicy: ProjectRuntimeNetworkPolicy;
}): VerificationPlan {
  return deriveVerificationPlan({
    cwd: input.workspaceRoot,
    executionPermission: input.executionPermission,
    runtimeNetworkPolicy: input.runtimeNetworkPolicy,
    packageJson: readPackageJson(input.workspaceRoot),
    hasTypeScriptConfig: hasTypeScriptConfig(input.workspaceRoot)
  });
}
