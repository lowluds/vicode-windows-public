import type { ProviderId, RunRuntimeTraceMark, RunRuntimeTraceStage } from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import type { DatabaseService } from '../../storage/database';
import {
  normalizeProviderInfoEvent,
  type NormalizedProviderInfoEvent
} from './provider-run-event-normalizer';

type ProviderRunEventServiceHost = {
  db: Pick<DatabaseService, 'addRunEvent'>;
  emit(event: AppEvent): void;
};

export class ProviderRunEventService {
  private readonly lastInfoByRun = new Map<string, string>();

  constructor(private readonly host: ProviderRunEventServiceHost) {}

  dispose() {
    this.lastInfoByRun.clear();
  }

  clearRunInfo(runId: string) {
    this.lastInfoByRun.delete(runId);
  }

  recordNativePlannerCloseout(
    threadId: string,
    runId: string,
    providerId: ProviderId,
    summary: string,
    text: string | null = null
  ) {
    const event = this.recordInfoEvent(threadId, runId, normalizeProviderInfoEvent(providerId, {
      message: summary,
      activity: {
        kind: 'delegation',
        summary,
        text: text?.trim() || summary
      }
    }));
    if (event) {
      this.host.emit({ type: 'raw.event', event });
    }
  }

  recordInfoEvent(threadId: string, runId: string, normalizedInfo: NormalizedProviderInfoEvent) {
    if (!normalizedInfo.shouldPersist) {
      return null;
    }

    if (normalizedInfo.dedupeKey && this.lastInfoByRun.get(runId) === normalizedInfo.dedupeKey) {
      return null;
    }

    if (normalizedInfo.dedupeKey) {
      this.lastInfoByRun.set(runId, normalizedInfo.dedupeKey);
    }
    return this.host.db.addRunEvent(threadId, runId, 'info', normalizedInfo.eventPayload);
  }

  recordRuntimeTraceMark(
    threadId: string,
    runId: string,
    stage: RunRuntimeTraceStage,
    detail: Record<string, unknown> | null = null
  ) {
    const mark: RunRuntimeTraceMark = {
      stage,
      at: new Date().toISOString(),
      detail
    };
    return this.host.db.addRunEvent(threadId, runId, 'info', {
      runtimeTrace: mark
    });
  }
}
