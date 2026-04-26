import { describe, expect, it } from 'vitest';
import {
  normalizeProviderVisibleText,
  normalizeProviderInfoEvent,
  preferProviderVisibleText
} from './provider-run-event-normalizer';

describe('provider-run-event-normalizer', () => {
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
});
