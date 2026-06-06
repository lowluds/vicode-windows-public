import { describe, expect, it } from 'vitest';
import {
  normalizeProviderAssistantDelta,
  normalizeProviderVisibleText,
  normalizeProviderInfoEvent,
  preferProviderVisibleText
} from './provider-run-event-normalizer';

describe('provider-run-event-normalizer', () => {
  it.each([
    ['ollama_responses', 'ollama'],
    ['ollama_chat', 'ollama'],
    ['openai_compatible_chat', 'openai_compatible']
  ] as const)('keeps transcript text boundaries provider-owned for %s', (_lane, providerId) => {
    const first = normalizeProviderAssistantDelta(
      providerId,
      '',
      'Using: workspace tone guidance; I’m keeping the reply to exactly two'
    );
    const second = normalizeProviderAssistantDelta(providerId, first.text, 'short sentences.');

    expect(second.text).toBe('Using: workspace tone guidance; I’m keeping the reply to exactly twoshort sentences.');
    expect(second.delta).toBe('short sentences.');
  });

  it('builds one normalized packet for persistence and live progress handling', () => {
    const progress = {
      runId: 'run-1',
      threadId: 'thread-1',
      title: 'Current tasks',
      items: [
        {
          id: 'step-1',
          label: 'Edit file',
          order: 0,
          status: 'in_progress'
        }
      ],
      updatedAt: '2026-04-01T00:00:00.000Z',
      diffStats: null,
      reviewAvailable: false,
      changeArtifact: null
    } as const;

    const normalized = normalizeProviderInfoEvent('openai', {
      message: '  Updated src/app.tsx  ',
      progress,
      activity: {
        kind: 'terminal_command',
        summary: '  Updated src/app.tsx  ',
        command: 'apply_patch',
        phase: 'completed'
      },
      planner: {
        kind: 'session',
        sessionId: 'session-1'
      },
      providerDiagnostics: {
        kind: 'provider_event_classification',
        source: 'codex_cli_json',
        providerEventType: 'message',
        itemType: null,
        itemKeys: ['type'],
        taskLike: false,
        classification: 'unclassified'
      }
    });

    expect(normalized.message).toBe('Updated src/app.tsx');
    expect(normalized.activity).toEqual(
      expect.objectContaining({
        kind: 'terminal_command',
        summary: 'Updated src/app.tsx',
        command: 'apply_patch'
      })
    );
    expect(normalized.providerProgress).toEqual(progress);
    expect(normalized.planner).toEqual({
      kind: 'session',
      sessionId: 'session-1'
    });
    expect(normalized.eventPayload).toEqual({
      eventKind: 'tool_activity',
      transcriptVisible: true,
      message: 'Updated src/app.tsx',
      activity: expect.objectContaining({
        kind: 'terminal_command',
        summary: 'Updated src/app.tsx'
      }),
      planner: {
        kind: 'session',
        sessionId: 'session-1'
      },
      providerDiagnostics: expect.objectContaining({
        kind: 'provider_event_classification',
        source: 'codex_cli_json'
      })
    });
    expect(normalized.shouldPersist).toBe(true);
    expect(normalized.eventPayload).not.toHaveProperty('progress');
  });

  it('persists activity-only payloads and skips progress-only payloads', () => {
    const activityOnly = normalizeProviderInfoEvent('openai', {
      activity: {
        kind: 'memory_recall',
        summary: 'Recalled 2 workspace memory entries',
        text: 'Included MEMORY.md, USER.md in the active prompt context.'
      }
    });
    const progressOnly = normalizeProviderInfoEvent('openai', {
      progress: {
        runId: 'run-1',
        threadId: 'thread-1',
        title: 'Current tasks',
        items: [],
        updatedAt: '2026-04-01T00:00:00.000Z',
        diffStats: null,
        reviewAvailable: false,
        changeArtifact: null
      }
    });

    expect(activityOnly.shouldPersist).toBe(true);
    expect(activityOnly.eventPayload).toEqual({
      eventKind: 'tool_activity',
      transcriptVisible: true,
      message: 'Recalled 2 workspace memory entries',
      activity: expect.objectContaining({
        kind: 'memory_recall',
        summary: 'Recalled 2 workspace memory entries'
      })
    });
    expect(progressOnly.shouldPersist).toBe(false);
    expect(progressOnly.eventPayload).toEqual({});
    expect(progressOnly.providerProgress).toEqual(
      expect.objectContaining({
        runId: 'run-1',
        threadId: 'thread-1'
      })
    );
  });

  it('classifies internal runtime reminders as hidden control-plane events', () => {
    const normalized = normalizeProviderInfoEvent('ollama', {
      message: 'Preparing model reminder.',
      activity: {
        kind: 'thinking',
        summary: 'Preparing model reminder.',
        text: [
          'Internal runtime reminder:',
          'The user asked for actual workspace changes.',
          'If the required edits are not complete yet, call the next relevant write-capable tool now.'
        ].join('\n'),
        providerEventType: 'ollama_tool_loop_thinking'
      }
    });

    expect(normalized.eventKind).toBe('internal_runtime_reminder');
    expect(normalized.transcriptVisible).toBe(false);
    expect(normalized.eventPayload).toEqual({
      eventKind: 'internal_runtime_reminder',
      transcriptVisible: false,
      message: 'Preparing model reminder.',
      activity: expect.objectContaining({
        kind: 'thinking',
        text: expect.stringContaining('Internal runtime reminder:')
      })
    });
  });

  it('classifies provider diagnostics as hidden diagnostic events', () => {
    const normalized = normalizeProviderInfoEvent('openai', {
      providerDiagnostics: {
        kind: 'provider_event_classification',
        source: 'codex_cli_json',
        providerEventType: 'item/completed',
        itemType: 'reasoning',
        itemKeys: ['type', 'payload'],
        taskLike: false,
        classification: 'unclassified'
      }
    });

    expect(normalized.eventKind).toBe('provider_diagnostic');
    expect(normalized.transcriptVisible).toBe(false);
    expect(normalized.eventPayload).toEqual({
      eventKind: 'provider_diagnostic',
      transcriptVisible: false,
      providerDiagnostics: expect.objectContaining({
        providerEventType: 'item/completed'
      })
    });
  });

  it('persists verification artifacts as hidden run evidence', () => {
    const verificationArtifact = {
      command: 'npm test',
      cwd: 'C:\\workspace',
      permissionProfile: 'default',
      networkPolicy: 'disabled',
      status: 'passed',
      exitCode: 0,
      stdout: '2 passed',
      stderr: '',
      startedAt: '2026-05-27T10:00:00.000Z',
      finishedAt: '2026-05-27T10:00:01.000Z',
      durationMs: 1000,
      reason: 'package.json defines a test script.',
      skippedReason: null
    };

    const normalized = normalizeProviderInfoEvent('openai', {
      verificationArtifact,
      eventKind: 'debug_detail',
      transcriptVisible: false
    } as never);

    expect(normalized.shouldPersist).toBe(true);
    expect(normalized.eventPayload).toEqual({
      eventKind: 'debug_detail',
      transcriptVisible: false,
      verificationArtifact
    });
  });

  it('persists harness hook evidence and final evidence summaries as hidden run evidence', () => {
    const harnessHookEvidence = {
      runId: 'run-1',
      stage: 'before_tool',
      sequence: 3,
      at: '2026-05-27T10:00:00.000Z',
      turnIndex: 0,
      toolName: 'read_file',
      summary: 'Calling read_file',
      isError: null,
      mutatesWorkspace: false,
      verificationCommand: null,
      verificationStatus: null
    };
    const finalEvidenceSummary = {
      runId: 'run-1',
      usedMutatingTool: true,
      usedFileContentMutationTool: true,
      usedNativeWebResearchTool: false,
      postMutationVerificationRequired: true,
      postMutationVerificationPassed: true,
      verificationCommand: 'npm test',
      verificationStatus: 'passed',
      createdDirectoriesCount: 0,
      writtenFilesCount: 1,
      toolCallCount: 2,
      reminderCount: 0
    };

    const normalized = normalizeProviderInfoEvent('openai', {
      harnessHookEvidence,
      finalEvidenceSummary,
      eventKind: 'debug_detail',
      transcriptVisible: false
    } as never);

    expect(normalized.shouldPersist).toBe(true);
    expect(normalized.eventPayload).toEqual({
      eventKind: 'debug_detail',
      transcriptVisible: false,
      harnessHookEvidence,
      finalEvidenceSummary
    });
  });

  it('persists staged workspace change sets as hidden run evidence', () => {
    const stagedWorkspaceChangeSet = {
      threadId: 'thread-1',
      runId: 'run-1',
      sourceToolName: 'write_file',
      isolationMode: 'patch_buffer',
      status: 'proposed',
      requestedPath: 'src/example.ts',
      changedPaths: ['src/example.ts'],
      operations: [
        {
          operation: 'write_file',
          path: 'src/example.ts',
          beforeContent: null,
          proposedAfterContent: 'export const value = 1;\n',
          patchText: null
        }
      ],
      summary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 0
      }
    };

    const normalized = normalizeProviderInfoEvent('openai', {
      stagedWorkspaceChangeSet,
      eventKind: 'debug_detail',
      transcriptVisible: false
    } as never);

    expect(normalized.shouldPersist).toBe(true);
    expect(normalized.eventPayload).toEqual({
      eventKind: 'debug_detail',
      transcriptVisible: false,
      stagedWorkspaceChangeSet
    });
  });

  it('prefers cleaner normalized completion text when compact text matches the streamed output', () => {
    expect(
      preferProviderVisibleText(
        'openai',
        'The site uses Tail wind CSS key frames for mim icking the look.',
        'The site uses Tailwind CSS keyframes for mimicking the look.'
      )
    ).toBe('The site uses Tailwind CSS keyframes for mimicking the look.');
  });

  it('uses the shared provider text policy when normalizing ollama-visible text', () => {
    expect(
      normalizeProviderVisibleText(
        'ollama',
        '<function_calls></function_calls>\nThinking: hidden\nFinal answer'
      )
    ).toBe('Final answer');
  });

  it('does not apply ollama-only cleanup to other provider visible text', () => {
    const raw = '<function_calls></function_calls>\nThinking: hidden\nFinal answer';

    expect(normalizeProviderVisibleText('openai', raw)).toBe(raw);
  });
});
