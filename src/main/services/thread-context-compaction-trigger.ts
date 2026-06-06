import type { ProviderContextWindowUsage, ProviderId } from '../../shared/domain';
import {
  deriveContextWindowCompactionLikely,
  deriveContextWindowSeverity,
  deriveContextWindowUsagePercent
} from '../../shared/context-window';
import type {
  ThreadContextCompactionResult,
  ThreadContextCompactionService
} from './thread-context-compaction-service';

export type ThreadContextCompactionTriggerResult =
  | ThreadContextCompactionResult
  | {
      status: 'skipped';
      reason: 'below_threshold' | 'invalid_usage' | 'in_flight' | 'failed';
    };

export interface ThreadContextCompactionTriggerInput {
  threadId: string;
  runId: string;
  providerId: ProviderId;
  modelId: string;
  contextWindow: ProviderContextWindowUsage;
}

export interface ThreadContextCompactionTriggerServiceOptions {
  compactionService: Pick<ThreadContextCompactionService, 'createThreadCompaction'>;
  onCompacted?(input: {
    threadId: string;
    runId: string;
    providerId: ProviderId;
    modelId: string;
    contextWindow: ProviderContextWindowUsage;
    compaction: Extract<ThreadContextCompactionResult, { status: 'compacted' }>['compaction'];
  }): void | Promise<void>;
}

const DANGER_CONTEXT_PRESSURE_PERCENT = 90;

export function shouldTriggerThreadContextCompaction(
  providerId: ProviderId,
  modelId: string,
  usedTokens: number
) {
  if (!Number.isFinite(usedTokens) || usedTokens <= 0) {
    return false;
  }

  if (deriveContextWindowCompactionLikely(providerId, modelId, usedTokens)) {
    return true;
  }

  const usagePercent = deriveContextWindowUsagePercent(providerId, modelId, usedTokens);
  return usagePercent >= DANGER_CONTEXT_PRESSURE_PERCENT
    && deriveContextWindowSeverity(usagePercent) === 'danger';
}

export class ThreadContextCompactionTriggerService {
  private readonly inFlightThreads = new Set<string>();

  constructor(private readonly options: ThreadContextCompactionTriggerServiceOptions) {}

  async maybeCreateFromContextUsage(
    input: ThreadContextCompactionTriggerInput
  ): Promise<ThreadContextCompactionTriggerResult> {
    const usedTokens = input.contextWindow.usedTokens;
    if (!Number.isFinite(usedTokens) || usedTokens <= 0) {
      return {
        status: 'skipped',
        reason: 'invalid_usage'
      };
    }

    if (!shouldTriggerThreadContextCompaction(input.providerId, input.modelId, usedTokens)) {
      return {
        status: 'skipped',
        reason: 'below_threshold'
      };
    }

    if (this.inFlightThreads.has(input.threadId)) {
      return {
        status: 'skipped',
        reason: 'in_flight'
      };
    }

    this.inFlightThreads.add(input.threadId);
    let result: ThreadContextCompactionResult;
    try {
      result = await this.options.compactionService.createThreadCompaction({
        threadId: input.threadId,
        inputTokenEstimate: input.contextWindow.inputTokens ?? usedTokens,
        outputTokenEstimate: input.contextWindow.outputTokens ?? null
      });
    } catch {
      return {
        status: 'skipped',
        reason: 'failed'
      };
    } finally {
      this.inFlightThreads.delete(input.threadId);
    }

    if (result.status === 'compacted') {
      try {
        await this.options.onCompacted?.({
          threadId: input.threadId,
          runId: input.runId,
          providerId: input.providerId,
          modelId: input.modelId,
          contextWindow: input.contextWindow,
          compaction: result.compaction
        });
      } catch {
        // The compaction record is already persisted; the transcript marker is best-effort.
      }
    }

    return result;
  }
}
