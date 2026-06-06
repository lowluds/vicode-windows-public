import { describe, expect, it, vi } from 'vitest';
import type { ThreadContextCompactionService } from './thread-context-compaction-service';
import {
  shouldTriggerThreadContextCompaction,
  ThreadContextCompactionTriggerService
} from './thread-context-compaction-trigger';

describe('shouldTriggerThreadContextCompaction', () => {
  it('uses explicit auto-compaction thresholds when a model exposes one', () => {
    expect(shouldTriggerThreadContextCompaction('openai', 'gpt-5.4', 749_999)).toBe(false);
    expect(shouldTriggerThreadContextCompaction('openai', 'gpt-5.4', 750_000)).toBe(true);
  });

  it('uses the danger pressure threshold for providers without an explicit auto-compaction threshold', () => {
    expect(shouldTriggerThreadContextCompaction('ollama', 'qwen3-coder', 29_490)).toBe(false);
    expect(shouldTriggerThreadContextCompaction('ollama', 'qwen3-coder', 29_492)).toBe(true);
  });
});

describe('ThreadContextCompactionTriggerService', () => {
  it('creates a compaction from provider-reported usage once the trigger threshold is crossed', async () => {
    const compaction = {
      id: 'compaction-1',
      threadId: 'thread-1',
      sourceStartEventId: 'event-1',
      sourceEndEventId: 'event-10',
      summary: 'Summary',
      inputTokenEstimate: 30_000,
      outputTokenEstimate: 200,
      providerId: 'ollama' as const,
      modelId: 'qwen3-coder',
      createdAt: '2026-06-01T10:00:00.000Z'
    };
    const createThreadCompaction = vi.fn(async () => ({
      status: 'compacted' as const,
      sourceEventCount: 10,
      protectedEventCount: 8,
      compaction
    }));
    const onCompacted = vi.fn();
    const trigger = new ThreadContextCompactionTriggerService({
      compactionService: {
        createThreadCompaction
      } as unknown as ThreadContextCompactionService,
      onCompacted
    });

    await expect(
      trigger.maybeCreateFromContextUsage({
        threadId: 'thread-1',
        runId: 'run-1',
        providerId: 'ollama',
        modelId: 'qwen3-coder',
        contextWindow: {
          usedTokens: 30_200,
          inputTokens: 30_000,
          outputTokens: 200,
          providerEventType: 'ollama_chat_context_window_usage'
        }
      })
    ).resolves.toMatchObject({
      status: 'compacted'
    });
    expect(createThreadCompaction).toHaveBeenCalledWith({
      threadId: 'thread-1',
      inputTokenEstimate: 30_000,
      outputTokenEstimate: 200
    });
    expect(onCompacted).toHaveBeenCalledWith({
      threadId: 'thread-1',
      runId: 'run-1',
      providerId: 'ollama',
      modelId: 'qwen3-coder',
      compaction,
      contextWindow: {
        usedTokens: 30_200,
        inputTokens: 30_000,
        outputTokens: 200,
        providerEventType: 'ollama_chat_context_window_usage'
      }
    });
  });

  it('skips usage below the trigger threshold', async () => {
    const createThreadCompaction = vi.fn();
    const trigger = new ThreadContextCompactionTriggerService({
      compactionService: {
        createThreadCompaction
      } as unknown as ThreadContextCompactionService
    });

    await expect(
      trigger.maybeCreateFromContextUsage({
        threadId: 'thread-1',
        runId: 'run-1',
        providerId: 'ollama',
        modelId: 'qwen3-coder',
        contextWindow: {
          usedTokens: 12_000
        }
      })
    ).resolves.toEqual({
      status: 'skipped',
      reason: 'below_threshold'
    });
    expect(createThreadCompaction).not.toHaveBeenCalled();
  });
});
