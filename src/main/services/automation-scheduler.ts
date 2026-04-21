import { EventEmitter } from 'node:events';
import type { AutomationDefinition } from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import { DatabaseService } from '../../storage/database';
import { JobsService } from './jobs';

export class AutomationScheduler {
  private timers = new Map<string, NodeJS.Timeout>();
  private readonly emitter = new EventEmitter();

  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobsService
  ) {}

  refresh() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    for (const automation of this.db.listAutomations()) {
      if (!this.shouldScheduleRecurringAutomation(automation)) {
        continue;
      }
      this.scheduleRecurringAutomation(this.ensureRecurringAutomationTiming(automation));
    }
  }

  async runNow(automationId: string) {
    return this.jobs.enqueueAutomationJob(automationId, 'manual');
  }

  onEvent(listener: (event: AppEvent) => void) {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  dispose() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.emitter.removeAllListeners('event');
  }

  private shouldScheduleRecurringAutomation(automation: AutomationDefinition) {
    return automation.enabled && automation.scheduleType === 'interval_while_app_open' && Boolean(automation.intervalMinutes);
  }

  private ensureRecurringAutomationTiming(automation: AutomationDefinition) {
    if (!this.shouldScheduleRecurringAutomation(automation)) {
      return automation;
    }
    if (automation.nextRunAt) {
      return automation;
    }
    return this.db.setAutomationNextRunAt(automation.id, this.computeNextRunAt(automation.intervalMinutes!));
  }

  private scheduleRecurringAutomation(automation: AutomationDefinition) {
    if (!this.shouldScheduleRecurringAutomation(automation)) {
      return;
    }
    const targetTime = automation.nextRunAt ? new Date(automation.nextRunAt).getTime() : Date.now();
    const delay = Math.max(0, targetTime - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(automation.id);
      void this.handleRecurringWake(automation.id);
    }, delay);
    this.timers.set(automation.id, timer);
  }

  private async handleRecurringWake(automationId: string) {
    const automation = this.db.getAutomation(automationId);
    if (!this.shouldScheduleRecurringAutomation(automation)) {
      return;
    }

    const scheduledAutomation = this.db.setAutomationNextRunAt(
      automation.id,
      this.computeNextRunAt(automation.intervalMinutes!)
    );
    this.scheduleRecurringAutomation(scheduledAutomation);

    try {
      await this.jobs.enqueueAutomationJob(automation.id, 'schedule');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const status =
        error instanceof Error && /already has an active job\./u.test(error.message)
          ? 'skipped'
          : 'failed';
      this.db.addAutomationRun(
        automation.id,
        null,
        status,
        status === 'skipped'
          ? `Recurring automation skipped: ${message}`
          : `Recurring automation failed to queue: ${message}`
      );
      this.emit({
        type: 'automation.updated',
        automation: this.db.getAutomation(automation.id)
      });
    }
  }

  private computeNextRunAt(intervalMinutes: number) {
    return new Date(Date.now() + intervalMinutes * 60_000).toISOString();
  }

  private emit(event: AppEvent) {
    this.emitter.emit('event', event);
  }
}
