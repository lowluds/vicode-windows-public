import type {
  ProviderContextWindowUsage,
  ProviderId,
  RunContextPressureState,
  RunProgressState,
  ThreadDetail
} from '../../shared/domain';
import {
  deriveContextWindowCompactionLikely,
  deriveContextWindowNote,
  deriveContextWindowPressureLabel,
  deriveContextWindowSeverity,
  deriveContextWindowUsagePercent,
  deriveProviderContextSourceLabel,
  resolveContextWindowLimit
} from '../../shared/context-window';

export class ProviderContextSupportService {
  buildMemoryRetrievalQuery(thread: ThreadDetail, prompt: string) {
    const recentTurns = [...thread.turns]
      .reverse()
      .filter((turn) => turn.role === 'user' || turn.role === 'assistant')
      .slice(0, 4)
      .reverse()
      .map((turn) => turn.content.trim())
      .filter(Boolean);
    const parts = [
      prompt.trim(),
      thread.title.trim() !== 'New thread' ? thread.title.trim() : null,
      ...recentTurns
    ].filter((value): value is string => Boolean(value));
    return parts.join('\n').slice(0, 1_600);
  }

  deriveMemoryMaxResults(providerId: ProviderId, modelId: string, usedTokens: number) {
    const usagePercent = deriveContextWindowUsagePercent(providerId, modelId, usedTokens);
    return deriveContextWindowSeverity(usagePercent) === 'normal' ? 4 : 6;
  }

  deriveLatestContextWindowUsage(
    events: ThreadDetail['rawOutput'],
    runId: string | null
  ): ProviderContextWindowUsage | null {
    for (const event of [...events].reverse()) {
      if (runId && event.runId !== runId) {
        continue;
      }

      const candidate = event.payload?.contextWindow;
      if (!candidate || typeof candidate !== 'object') {
        continue;
      }

      const usage = candidate as Partial<ProviderContextWindowUsage>;
      if (typeof usage.usedTokens === 'number' && Number.isFinite(usage.usedTokens)) {
        return {
          usedTokens: usage.usedTokens,
          inputTokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : null,
          outputTokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : null,
          providerEventType: typeof usage.providerEventType === 'string' ? usage.providerEventType : null
        };
      }
    }

    return null;
  }

  deriveQueueSummary(thread: ThreadDetail): RunProgressState['queueSummary'] {
    const queuedFollowUps = thread.followUps.filter((followUp) => followUp.status === 'queued' || followUp.status === 'dispatching');
    const condensedQueuedCount = queuedFollowUps.reduce(
      (total, followUp) => total + this.readCondensedQueuedCount(followUp.metadata ?? null),
      0
    );

    if (queuedFollowUps.length === 0 && condensedQueuedCount === 0) {
      return null;
    }

    return {
      queuedCount: queuedFollowUps.length,
      steerCount: queuedFollowUps.filter((followUp) => followUp.kind === 'steer').length,
      followUpCount: queuedFollowUps.filter((followUp) => followUp.kind === 'follow_up').length,
      condensedQueuedCount
    };
  }

  countQueuedSteerFollowUps(thread: ThreadDetail) {
    return thread.followUps.filter(
      (followUp) => (followUp.status === 'queued' || followUp.status === 'dispatching') && followUp.kind === 'steer'
    ).length;
  }

  deriveContextPressureState(
    thread: ThreadDetail,
    runId: string,
    providerId: ProviderId,
    modelId: string
  ): RunContextPressureState | null {
    const usage =
      this.deriveLatestContextWindowUsage(thread.rawOutput, runId) ??
      this.deriveLatestContextWindowUsage(thread.rawOutput, null);
    if (!usage) {
      return null;
    }

    const usagePercent = deriveContextWindowUsagePercent(providerId, modelId, usage.usedTokens);
    const severity = deriveContextWindowSeverity(usagePercent);

    return {
      severity,
      pressureLabel: deriveContextWindowPressureLabel(severity),
      note: deriveContextWindowNote(providerId, severity, true),
      source: 'provider',
      sourceLabel: deriveProviderContextSourceLabel(providerId),
      usagePercent,
      usedTokens: usage.usedTokens,
      maxTokens: resolveContextWindowLimit(providerId, modelId),
      checkpointRecommended: severity !== 'normal',
      compactionLikely: deriveContextWindowCompactionLikely(providerId, modelId, usage.usedTokens)
    };
  }

  deriveCheckpointReminder(
    contextPressure: RunContextPressureState | null,
    queueSummary: RunProgressState['queueSummary']
  ): RunProgressState['checkpointReminder'] {
    if (!contextPressure || !contextPressure.checkpointRecommended) {
      return null;
    }

    const queueHint =
      queueSummary && queueSummary.queuedCount > 0
        ? ` There ${queueSummary.queuedCount === 1 ? 'is' : 'are'} already ${queueSummary.queuedCount} queued ${queueSummary.queuedCount === 1 ? 'message' : 'messages'} behind this run.`
        : '';

    if (contextPressure.severity === 'danger') {
      return {
        kind: 'context_pressure',
        title: 'Checkpoint strongly recommended',
        message: `This thread is close to compaction or continuity loss. Capture the working contract in a durable note before another heavy turn.${queueHint}`
      };
    }

    return {
      kind: 'context_pressure',
      title: 'Checkpoint recommended',
      message: `Context pressure is building. Preserve the durable memory or queue a steer before another long follow-up.${queueHint}`
    };
  }

  deriveProgressEnhancements(
    progress: RunProgressState,
    thread: ThreadDetail,
    providerId: ProviderId,
    modelId: string
  ): RunProgressState | null {
    const contextPressure = this.deriveContextPressureState(thread, progress.runId, providerId, modelId);
    const queueSummary = this.deriveQueueSummary(thread);
    const checkpointReminder = this.deriveCheckpointReminder(contextPressure, queueSummary);
    const next: RunProgressState = {
      ...progress,
      contextPressure,
      checkpointReminder,
      queueSummary
    };

    return JSON.stringify(next) === JSON.stringify(progress)
      ? null
      : {
          ...next,
          updatedAt: new Date().toISOString()
        };
  }

  private readCondensedQueuedCount(metadata: Record<string, unknown> | null) {
    const value = metadata?.condensedQueuedCount;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  }
}
