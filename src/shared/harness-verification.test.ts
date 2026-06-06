import { describe, expect, it } from 'vitest';
import { deriveVerificationPlan } from './harness-verification';

describe('deriveVerificationPlan', () => {
  it('prefers npm test when package.json defines a test script', () => {
    expect(
      deriveVerificationPlan({
        cwd: 'C:\\workspace',
        executionPermission: 'workspace_write',
        runtimeNetworkPolicy: 'disabled',
        packageJson: {
          scripts: {
            build: 'tsc --noEmit',
            test: 'vitest run'
          }
        },
        hasTypeScriptConfig: true
      })
    ).toMatchObject({
      command: 'npm test',
      commandSource: 'package_json_test_script',
      cwd: 'C:\\workspace',
      permissionProfile: 'workspace_write',
      networkPolicy: 'disabled',
      status: 'planned',
      skippedReason: null,
      resultShape: {
        status: 'not_run',
        exitCode: null
      }
    });
  });

  it('uses npm run build when no test script exists and a build script exists', () => {
    expect(
      deriveVerificationPlan({
        cwd: 'C:\\workspace',
        executionPermission: 'default',
        runtimeNetworkPolicy: 'enabled',
        packageJson: {
          scripts: {
            build: 'electron-vite build'
          }
        },
        hasTypeScriptConfig: true
      })
    ).toMatchObject({
      command: 'npm run build',
      commandSource: 'package_json_build_script',
      networkPolicy: 'enabled',
      status: 'planned'
    });
  });

  it('uses tsc --noEmit when TypeScript config exists and no better package script is available', () => {
    expect(
      deriveVerificationPlan({
        cwd: 'C:\\workspace',
        executionPermission: 'default',
        runtimeNetworkPolicy: 'disabled',
        packageJson: {
          scripts: {
            dev: 'vite dev'
          }
        },
        hasTypeScriptConfig: true
      })
    ).toMatchObject({
      command: 'tsc --noEmit',
      commandSource: 'typescript_config',
      status: 'planned'
    });
  });

  it('records a skipped plan when no useful verification signal is available', () => {
    expect(
      deriveVerificationPlan({
        cwd: 'C:\\workspace',
        executionPermission: 'default',
        runtimeNetworkPolicy: 'disabled',
        packageJson: {
          scripts: {
            dev: 'vite dev'
          }
        },
        hasTypeScriptConfig: false
      })
    ).toMatchObject({
      command: null,
      commandSource: 'unavailable',
      status: 'skipped',
      skippedReason: 'No package.json test/build script or TypeScript config was detected.',
      resultShape: {
        status: 'skipped',
        exitCode: null
      }
    });
  });
});
