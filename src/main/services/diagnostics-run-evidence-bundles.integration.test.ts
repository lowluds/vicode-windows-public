import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DiagnosticsService } from './diagnostics';
import { cleanupDiagnosticsTestDirs, createExportsDir, createSubagentSummary, createThreadDetail } from './diagnostics-test-fixtures';

describe('DiagnosticsService run evidence bundles', () => {
  afterEach(async () => {
    await cleanupDiagnosticsTestDirs();
  });
  it('includes support-safe run evidence bundles in thread reports', async () => {
    const exportsDir = await createExportsDir();
    const thread = createThreadDetail();
    const unsafePath = 'C:/Users/test-user/Desktop/vicode-project/private-root';
    const unsafeApiKey = 'api-key=eb3-evidence-fixture';
    const unsafeSecret = 'secret-eb3-token-12345678';
    const userTurn = thread.turns[0];
    const metadata = userTurn?.metadata as { harnessTaskContract?: Record<string, unknown> } | undefined;
    Object.assign(metadata?.harnessTaskContract ?? {}, {
      objective: `Implement support report bundles in ${unsafePath} using ${unsafeSecret}.`,
      workspaceRoot: unsafePath,
      allowedPaths: ['src/shared', `${unsafePath}/allowed.ts`],
      deniedPaths: [`${unsafePath}/.env`]
    });

    thread.rawOutput.push(
      {
        id: 'event-eb3-dispatch',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'provider_model_normalized_dispatch_started',
            at: '2026-03-17T00:00:06.700Z',
            detail: {
              providerId: 'openai',
              transportKind: 'responses',
              promptText: 'PRIVATE_EB3_FULL_ASSEMBLED_PROMPT',
              systemPrompt: 'PRIVATE_EB3_RAW_SYSTEM_PROMPT',
              providerRequestPayload: 'PRIVATE_EB3_PROVIDER_REQUEST_PAYLOAD',
              providerResponsePayload: 'PRIVATE_EB3_PROVIDER_RESPONSE_PAYLOAD',
              modelRouting: {
                providerId: 'openai',
                modelId: 'gpt-5',
                providerLabel: 'OpenAI',
                transportKind: 'responses',
                runtimeAuthority: 'app_harness',
                reason: `selected from ${unsafePath} with ${unsafeApiKey}`,
                promptText: 'PRIVATE_EB3_MODEL_ROUTING_PROMPT'
              }
            }
          }
        },
        createdAt: '2026-03-17T00:00:06.700Z'
      },
      {
        id: 'event-eb3-harness-evidence',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'provider_model_harness_evidence_captured',
            at: '2026-03-17T00:00:06.710Z',
            detail: {
              promptText: 'PRIVATE_EB3_HARNESS_PROMPT',
              userPrompt: 'PRIVATE_EB3_RAW_USER_PROMPT',
              systemPrompt: 'PRIVATE_EB3_RAW_SYSTEM_PROMPT',
              promptSections: [
                {
                  id: 'system-prompt',
                  title: `System prompt from ${unsafePath}`,
                  placement: 'system',
                  characterCount: 88,
                  reason: `assembled with ${unsafeSecret}`,
                  content: 'PRIVATE_EB3_CONTEXT_SECTION_CONTENT'
                }
              ],
              modelSelection: {
                modelId: 'gpt-5',
                reason: `model evidence from ${unsafePath} and ${unsafeApiKey}`,
                promptText: 'PRIVATE_EB3_MODEL_SELECTION_PROMPT'
              },
              toolRouting: [
                {
                  id: 'native:write_file',
                  callName: 'write_file',
                  name: 'Write file',
                  origin: 'native',
                  visibilityGroup: 'workspace_write',
                  included: true,
                  reason: `tool routing from ${unsafePath} with ${unsafeSecret}`,
                  mutatesWorkspace: true,
                  requiresApproval: false,
                  readsWorkspace: false,
                  usesNetwork: false,
                  rawToolPayload: 'PRIVATE_EB3_RAW_TOOL_PAYLOAD'
                }
              ],
              infrastructure: [
                {
                  id: 'workspace_write',
                  label: 'Workspace write tools',
                  available: true,
                  reason: `infrastructure evidence from ${unsafePath} with ${unsafeSecret}`,
                  toolCallNames: ['write_file'],
                  contextSectionContents: 'PRIVATE_EB3_INFRA_CONTEXT_CONTENT'
                }
              ]
            }
          }
        },
        createdAt: '2026-03-17T00:00:06.710Z'
      },
      {
        id: 'event-eb3-terminal',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'terminal_command',
            phase: 'completed',
            summary: `Ran verification in ${unsafePath} with ${unsafeSecret}`,
            command: `npm test -- ${unsafePath}/src/app.test.ts --api-key=${unsafeApiKey}`,
            cwd: unsafePath,
            isolationMode: 'host_job_object_temp_profile',
            outputLines: ['PRIVATE_EB3_STDOUT_TERMINAL_STREAM', 'PRIVATE_EB3_STDERR_TERMINAL_STREAM']
          }
        },
        createdAt: '2026-03-17T00:00:06.720Z'
      },
      {
        id: 'event-eb3-verification',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          verificationArtifact: {
            command: `npm test -- ${unsafePath}/src/app.test.ts --api-key=${unsafeApiKey}`,
            cwd: unsafePath,
            permissionProfile: 'default',
            networkPolicy: 'disabled',
            status: 'passed',
            exitCode: 0,
            stdout: 'PRIVATE_EB3_VERIFICATION_STDOUT_STREAM',
            stderr: 'PRIVATE_EB3_VERIFICATION_STDERR_STREAM',
            startedAt: '2026-03-17T00:00:06.720Z',
            finishedAt: '2026-03-17T00:00:06.730Z',
            durationMs: 10,
            reason: `verification reason from ${unsafePath} with ${unsafeSecret}`,
            skippedReason: null
          }
        },
        createdAt: '2026-03-17T00:00:06.730Z'
      },
      {
        id: 'event-eb3-change-artifact',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          activity: {
            kind: 'change_summary',
            summary: `Changed files under ${unsafePath}`,
            changeArtifact: {
              source: 'workspace_diff',
              summary: { filesChanged: 1, insertions: 2, deletions: 1 },
              files: [
                {
                  path: `${unsafePath}/src/private.ts`,
                  status: 'modified',
                  insertions: 2,
                  deletions: 1,
                  beforeContent: 'PRIVATE_EB3_BEFORE_CONTENT',
                  afterContent: 'PRIVATE_EB3_AFTER_CONTENT',
                  previewLines: [{ type: 'added', text: 'PRIVATE_EB3_PREVIEW_LINE_TEXT' }],
                  previewTruncated: false
                }
              ]
            }
          }
        },
        createdAt: '2026-03-17T00:00:06.740Z'
      },
      {
        id: 'event-eb3-staged-review',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          stagedWorkspaceReviewDecision: {
            action: 'applied',
            status: 'failed',
            threadId: 'thread-1',
            runId: 'run-1',
            stagedEventId: 'event-eb3-staged',
            stagedEventIndex: 2,
            sourceToolName: 'write_file',
            isolationMode: 'patch_buffer',
            changedPaths: [`${unsafePath}/src/private.ts`],
            operationKinds: ['write_file'],
            errorReason: `staged drift in ${unsafePath} with ${unsafeSecret}`,
            createdAt: '2026-03-17T00:00:06.750Z'
          }
        },
        createdAt: '2026-03-17T00:00:06.750Z'
      },
      {
        id: 'event-eb3-hook',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          harnessHookEvidence: {
            runId: 'run-1',
            stage: 'after_verification',
            sequence: 99,
            at: '2026-03-17T00:00:06.760Z',
            summary: `hook summary from ${unsafePath} with ${unsafeSecret}`,
            verificationCommand: `npm test -- ${unsafePath}/src/app.test.ts --api-key=${unsafeApiKey}`,
            verificationStatus: 'passed'
          }
        },
        createdAt: '2026-03-17T00:00:06.760Z'
      },
      {
        id: 'event-eb3-final-evidence',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'info',
        payload: {
          finalEvidenceSummary: {
            runId: 'run-1',
            usedMutatingTool: true,
            usedFileContentMutationTool: true,
            usedNativeWebResearchTool: false,
            postMutationVerificationRequired: true,
            postMutationVerificationPassed: true,
            verificationCommand: `npm test -- ${unsafePath}/src/app.test.ts --api-key=${unsafeApiKey}`,
            verificationStatus: 'passed',
            createdDirectoriesCount: 0,
            writtenFilesCount: 1,
            toolCallCount: 3,
            reminderCount: 0
          }
        },
        createdAt: '2026-03-17T00:00:06.770Z'
      },
      {
        id: 'event-eb3-failed-trace',
        threadId: 'thread-1',
        runId: 'run-2',
        eventType: 'info',
        payload: {
          runtimeTrace: {
            stage: 'failed',
            at: '2026-03-17T00:01:01.100Z',
            detail: {
              message: `Failed while reading ${unsafePath} with ${unsafeSecret}`,
              reason: `provider_error_${unsafeSecret}`
            }
          }
        },
        createdAt: '2026-03-17T00:01:01.100Z'
      }
    );

    const db = {
      getProject: () => ({
        id: 'project-1',
        name: 'Support project',
        folderPath: unsafePath,
        trusted: true,
        defaultProviderId: 'openai',
        defaultModelByProvider: { openai: 'gpt-5' },
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z'
      }),
      getThread: () => thread,
      listSubagentsByParentThread: () => [createSubagentSummary({
        outputSummary: `subagent output from ${unsafePath} with ${unsafeSecret}`,
        lastError: `subagent error from ${unsafePath} with ${unsafeApiKey}`
      })]
    } as unknown as Parameters<typeof DiagnosticsService>[0];
    const service = new DiagnosticsService(db, exportsDir);

    const reportDir = await service.exportThreadReport('thread-1', []);
    const reportText = await readFile(join(reportDir, 'report.json'), 'utf8');
    const report = JSON.parse(reportText) as {
      runProgressDiagnostics: {
        runEvidenceBundles: Array<{
          identity: { runId: string };
          taskContractSummary: { objective: string; workspaceRoot: string | null; allowedPaths: string[]; deniedPaths: string[] } | null;
          promptEvidence: { sectionCount: number; sections: Array<{ title: string | null; reason: string | null }> };
          modelRoutingEvidence: Array<{ reason: string | null; runtimeAuthority: string | null }>;
          toolRoutingEvidence: Array<{ toolId: string | null; reason: string | null; mutatesWorkspace: boolean | null }>;
          infrastructureEvidence: Array<{ infrastructureId: string | null; reason: string | null }>;
          runtimeTraceSummary: { failureMessage: string | null; failureReason: string | null };
          toolExecutionSummary: { terminalCommandCount: number; terminalCommands: Array<{ command: string | null; cwd: string | null }> };
          verificationEvidence: { artifactCount: number; artifacts: Array<{ command: string | null; cwd: string | null; reason: string | null }> };
          changeReviewEvidence: {
            changeArtifacts: Array<{ files: Array<{ path: string }> }>;
            latestStagedDecision: { errorReason: string | null } | null;
            worktreeHunkReviewDecisions?: Array<{ errorReason: string | null }>;
          };
          hookEvidence: { hooks: Array<{ summary: string | null; verificationCommand: string | null }> };
          finalEvidenceSummary: { verificationCommand: string | null } | null;
          handoffState: { workspace: { workspaceRoot: string | null }; recommendedNextPrompt: string } | null;
          redactionMetadata: { mode: string; omittedFields: string[]; redactedPatterns: string[] };
          limitations: string[];
        }>;
      };
    };

    expect(report.runProgressDiagnostics.runEvidenceBundles.length).toBeGreaterThan(0);
    const runOneBundle = report.runProgressDiagnostics.runEvidenceBundles.find((bundle) => bundle.identity.runId === 'run-1');
    const failedBundle = report.runProgressDiagnostics.runEvidenceBundles.find((bundle) => bundle.identity.runId === 'run-2');
    expect(runOneBundle).toBeDefined();
    expect(failedBundle).toBeDefined();
    expect(runOneBundle).toMatchObject({
      taskContractSummary: {
        workspaceRoot: '[local-path]',
        allowedPaths: ['src/shared', '[local-path]'],
        deniedPaths: ['[local-path]']
      },
      redactionMetadata: {
        mode: 'support_safe'
      }
    });
    expect(runOneBundle?.promptEvidence.sectionCount).toBeGreaterThan(0);
    expect(runOneBundle?.modelRoutingEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ runtimeAuthority: 'app_harness' })
    ]));
    expect(runOneBundle?.toolRoutingEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolId: 'native:write_file', mutatesWorkspace: true })
    ]));
    expect(runOneBundle?.infrastructureEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ infrastructureId: 'workspace_write' })
    ]));
    expect(runOneBundle?.toolExecutionSummary.terminalCommandCount).toBeGreaterThanOrEqual(1);
    expect(runOneBundle?.verificationEvidence.artifactCount).toBeGreaterThanOrEqual(1);
    expect(runOneBundle?.changeReviewEvidence.changeArtifacts.some((artifact) => (
      artifact.files.some((file) => file.path === '[local-path]')
    ))).toBe(true);
    expect(runOneBundle?.changeReviewEvidence.latestStagedDecision?.errorReason).toBe('staged drift in [redacted-path]');
    expect(runOneBundle?.changeReviewEvidence.worktreeHunkReviewDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ errorReason: null })
    ]));
    expect(runOneBundle?.redactionMetadata.omittedFields.length).toBeGreaterThan(0);
    expect(runOneBundle?.redactionMetadata.redactedPatterns.length).toBeGreaterThan(0);
    expect(runOneBundle?.limitations).toContain('RunEvidenceBundleV1 is not deterministic replay.');
    expect(failedBundle?.runtimeTraceSummary.failureMessage).toBe('Failed while reading [local-path]');
    expect(failedBundle?.runtimeTraceSummary.failureReason).toBe('provider_error_secret-eb3-[redacted-secret]');

    for (const unsafeValue of [
      unsafePath,
      unsafeApiKey,
      unsafeSecret,
      'PRIVATE_EB3_FULL_ASSEMBLED_PROMPT',
      'PRIVATE_EB3_RAW_SYSTEM_PROMPT',
      'PRIVATE_EB3_RAW_USER_PROMPT',
      'PRIVATE_EB3_CONTEXT_SECTION_CONTENT',
      'PRIVATE_EB3_PROVIDER_REQUEST_PAYLOAD',
      'PRIVATE_EB3_PROVIDER_RESPONSE_PAYLOAD',
      'PRIVATE_EB3_RAW_TOOL_PAYLOAD',
      'PRIVATE_EB3_STDOUT_TERMINAL_STREAM',
      'PRIVATE_EB3_STDERR_TERMINAL_STREAM',
      'PRIVATE_EB3_VERIFICATION_STDOUT_STREAM',
      'PRIVATE_EB3_VERIFICATION_STDERR_STREAM',
      'PRIVATE_EB3_BEFORE_CONTENT',
      'PRIVATE_EB3_AFTER_CONTENT',
      'PRIVATE_EB3_PREVIEW_LINE_TEXT',
      'beforeContent',
      'afterContent',
      'proposedAfterContent',
      'patchText',
      'previewLines'
    ]) {
      expect(reportText).not.toContain(unsafeValue);
    }
  });
});
