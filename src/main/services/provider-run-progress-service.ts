import type { AutonomyDelegationProfile, ProviderId, RunProgressState } from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import { advanceRunProgress, completeRunProgress, failRunProgress } from '../../shared/run-progress';

function createPlannerDelegationItems(runId: string) {
  return [
    {
      id: `${runId}:planner:0`,
      label: 'Review the delegated workspace contract',
      order: 0,
      status: 'completed' as const
    },
    {
      id: `${runId}:planner:1`,
      label: 'Resolve clarifying questions',
      order: 1,
      status: 'in_progress' as const
    },
    {
      id: `${runId}:planner:2`,
      label: 'Draft the implementation plan',
      order: 2,
      status: 'pending' as const
    }
  ] satisfies RunProgressState['items'];
}

function createBackgroundDelegationItems(runId: string) {
  return [
    {
      id: `${runId}:background:0`,
      label: 'Review delegated heartbeat contract',
      order: 0,
      status: 'completed' as const
    },
    {
      id: `${runId}:background:1`,
      label: 'Execute the delegated task',
      order: 1,
      status: 'in_progress' as const
    },
    {
      id: `${runId}:background:2`,
      label: 'Summarize the result',
      order: 2,
      status: 'pending' as const
    }
  ] satisfies RunProgressState['items'];
}

export type BackgroundDelegationDescriptor = {
  profile: AutonomyDelegationProfile;
  title: string;
};

type ProviderRunProgressServiceOptions = {
  addProgressEvent: (threadId: string, runId: string, progress: RunProgressState) => unknown;
  emitRawEvent: (event: unknown) => void;
  emit: (event: AppEvent) => void;
};

export class ProviderRunProgressService {
  private readonly runProgressByRun = new Map<string, RunProgressState>();
  private readonly lastPersistedRunProgressByRun = new Map<string, string>();

  constructor(private readonly options: ProviderRunProgressServiceOptions) {}

  dispose() {
    this.runProgressByRun.clear();
    this.lastPersistedRunProgressByRun.clear();
  }

  getProgressMap() {
    return this.runProgressByRun;
  }

  getPersistedProgressMap() {
    return this.lastPersistedRunProgressByRun;
  }

  get(runId: string) {
    return this.runProgressByRun.get(runId) ?? null;
  }

  clear(runId: string) {
    this.runProgressByRun.delete(runId);
    this.lastPersistedRunProgressByRun.delete(runId);
  }

  clearPersisted(runId: string) {
    this.lastPersistedRunProgressByRun.delete(runId);
  }

  publish(progress: RunProgressState) {
    this.runProgressByRun.set(progress.runId, progress);
    const serialized = JSON.stringify(progress);
    if (this.lastPersistedRunProgressByRun.get(progress.runId) !== serialized) {
      this.lastPersistedRunProgressByRun.set(progress.runId, serialized);
      const event = this.options.addProgressEvent(progress.threadId, progress.runId, progress);
      this.options.emitRawEvent(event);
    }
    this.options.emit({
      type: 'run.progress',
      threadId: progress.threadId,
      runId: progress.runId,
      progress
    });
  }

  publishProvider(runId: string, nextProgress: RunProgressState) {
    const current = this.runProgressByRun.get(runId) ?? null;
    const merged: RunProgressState = {
      ...nextProgress,
      title: nextProgress.title ?? current?.title ?? null,
      diffStats: nextProgress.diffStats ?? current?.diffStats ?? null,
      reviewAvailable: nextProgress.reviewAvailable || current?.reviewAvailable || false,
      changeArtifact: nextProgress.changeArtifact ?? current?.changeArtifact ?? null,
      delegation: nextProgress.delegation ?? current?.delegation ?? null,
      contextPressure: nextProgress.contextPressure ?? current?.contextPressure ?? null,
      checkpointReminder: nextProgress.checkpointReminder ?? current?.checkpointReminder ?? null,
      queueSummary: nextProgress.queueSummary ?? current?.queueSummary ?? null
    };
    this.publish(merged);
  }

  advance(runId: string) {
    const progress = this.runProgressByRun.get(runId);
    if (!progress) {
      return;
    }
    this.publish(advanceRunProgress(progress));
  }

  complete(runId: string) {
    const progress = this.runProgressByRun.get(runId);
    if (!progress) {
      return;
    }
    this.publish(completeRunProgress(progress));
  }

  fail(runId: string, status: 'failed' | 'blocked') {
    const progress = this.runProgressByRun.get(runId);
    if (!progress) {
      return;
    }
    this.publish(failRunProgress(progress, status));
  }

  createNativePlannerRunProgress(
    runId: string,
    threadId: string,
    providerId: ProviderId,
    phase: NonNullable<RunProgressState['delegation']>['phase']
  ): RunProgressState {
    const items = createPlannerDelegationItems(runId).map((item) => ({ ...item }));

    if (phase === 'waiting_for_answers') {
      items[1] = { ...items[1], status: 'blocked' };
    }

    if (phase === 'resuming') {
      items[1] = { ...items[1], status: 'completed' };
      items[2] = { ...items[2], status: 'in_progress' };
    }

    return {
      runId,
      threadId,
      title: 'Native planner run',
      items,
      updatedAt: new Date().toISOString(),
      diffStats: null,
      reviewAvailable: false,
      changeArtifact: null,
      delegation: this.createPlannerDelegationState(providerId, phase),
      contextPressure: null,
      checkpointReminder: null,
      queueSummary: null
    };
  }

  updateNativePlannerRunProgress(
    threadId: string,
    runId: string,
    providerId: ProviderId,
    phase: NonNullable<RunProgressState['delegation']>['phase']
  ) {
    const current = this.runProgressByRun.get(runId);
    const next = this.createNativePlannerRunProgress(runId, threadId, providerId, phase);
    if (current && JSON.stringify(current) === JSON.stringify(next)) {
      return;
    }
    this.publish(next);
  }

  createBackgroundDelegationRunProgress(
    runId: string,
    threadId: string,
    providerId: ProviderId,
    delegation: BackgroundDelegationDescriptor
  ): RunProgressState {
    return {
      runId,
      threadId,
      title: 'Background delegated run',
      items: createBackgroundDelegationItems(runId).map((item) => ({ ...item })),
      updatedAt: new Date().toISOString(),
      diffStats: null,
      reviewAvailable: false,
      changeArtifact: null,
      delegation: this.createBackgroundDelegationState(providerId, delegation),
      contextPressure: null,
      checkpointReminder: null,
      queueSummary: null
    };
  }

  private createPlannerDelegationState(
    _providerId: ProviderId,
    phase: NonNullable<RunProgressState['delegation']>['phase']
  ): NonNullable<RunProgressState['delegation']> {
    const noteByPhase: Record<NonNullable<RunProgressState['delegation']>['phase'], string> = {
      active:
        'This planner run is using a thin delegated context. Full project memory and main-thread history stay with the composer run.',
      waiting_for_answers:
        'The delegated planner needs a clarifying answer before it should continue drafting the plan.',
      resuming:
        'Planner answers were supplied and the delegated run is continuing without reloading the full main-thread memory.'
    };

    return {
      mode: 'planner',
      profile: 'delegated',
      phase,
      title: 'Delegated planner context',
      note: noteByPhase[phase],
      includedContext: ['Project instructions', 'Provider compatibility notes'],
      excludedContext: ['Full project memory', 'Main-thread history']
    };
  }

  private createBackgroundDelegationState(
    _providerId: ProviderId,
    input: BackgroundDelegationDescriptor
  ): NonNullable<RunProgressState['delegation']> {
    const profileLabel =
      input.profile === 'heartbeat'
        ? 'heartbeat'
        : input.profile === 'research'
          ? 'research'
          : input.profile === 'implement'
            ? 'implementation'
            : 'verification';

    return {
      mode: 'background',
      profile: input.profile,
      phase: 'active',
      title: input.title,
      note: `This ${profileLabel} run is using a thin delegated context. Full project memory and main-thread history stay with the composer run.`,
      includedContext: ['Project instructions', 'Provider compatibility notes'],
      excludedContext: ['Full project memory', 'Main-thread history']
    };
  }
}
