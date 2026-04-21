import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../storage/database';
import { AutomationScheduler } from './automation-scheduler';

describe('AutomationScheduler', () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-17T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    while (tempDirs.length > 0) {
      const current = tempDirs.pop();
      if (current) {
        rmSync(current, { recursive: true, force: true });
      }
    }
  });

  function createDb() {
    const dir = mkdtempSync(join(tmpdir(), 'vicode-automation-scheduler-'));
    tempDirs.push(dir);
    const db = new DatabaseService(join(dir, 'vicode.sqlite'));
    db.migrate();
    return db;
  }

  it('queues run-now requests as manual jobs', async () => {
    const db = createDb();
    const project = db.listProjects()[0]!;
    const automation = db.saveAutomation({
      name: 'Manual automation',
      projectId: project.id,
      providerId: 'openai',
      modelId: 'gpt-5',
      promptTemplate: 'Check it',
      enabled: true,
      scheduleType: 'manual'
    });
    const jobs = {
      enqueueAutomationJob: vi.fn(async () => ({ job: null, reviewItem: null, alreadyPending: false }))
    };
    const scheduler = new AutomationScheduler(db, jobs as never);

    await scheduler.runNow(automation.id);

    expect(jobs.enqueueAutomationJob).toHaveBeenCalledWith(automation.id, 'manual');

    scheduler.dispose();
    db.close();
  });

  it('advances recurring nextRunAt and queues a scheduled job when the timer becomes due', async () => {
    const db = createDb();
    const project = db.listProjects()[0]!;
    const automation = db.saveAutomation({
      name: 'Recurring automation',
      projectId: project.id,
      providerId: 'openai',
      modelId: 'gpt-5',
      promptTemplate: 'Check it',
      enabled: true,
      scheduleType: 'interval_while_app_open',
      intervalMinutes: 10
    });
    const jobs = {
      enqueueAutomationJob: vi.fn(async () => ({ job: null, reviewItem: null, alreadyPending: false }))
    };
    const scheduler = new AutomationScheduler(db, jobs as never);

    expect(automation.nextRunAt).toBe('2026-03-17T12:10:00.000Z');

    scheduler.refresh();
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(jobs.enqueueAutomationJob).toHaveBeenCalledWith(automation.id, 'schedule');
    expect(db.getAutomation(automation.id).nextRunAt).toBe('2026-03-17T12:20:00.000Z');

    scheduler.dispose();
    db.close();
  });

  it('catches up overdue recurring automations immediately on refresh', async () => {
    const db = createDb();
    const project = db.listProjects()[0]!;
    const automation = db.saveAutomation({
      name: 'Overdue automation',
      projectId: project.id,
      providerId: 'openai',
      modelId: 'gpt-5',
      promptTemplate: 'Check it',
      enabled: true,
      scheduleType: 'interval_while_app_open',
      intervalMinutes: 5
    });
    db.setAutomationNextRunAt(automation.id, '2026-03-17T11:55:00.000Z');
    const jobs = {
      enqueueAutomationJob: vi.fn(async () => ({ job: null, reviewItem: null, alreadyPending: false }))
    };
    const scheduler = new AutomationScheduler(db, jobs as never);

    scheduler.refresh();
    await vi.runOnlyPendingTimersAsync();

    expect(jobs.enqueueAutomationJob).toHaveBeenCalledWith(automation.id, 'schedule');
    expect(db.getAutomation(automation.id).nextRunAt).toBe('2026-03-17T12:05:00.000Z');

    scheduler.dispose();
    db.close();
  });

  it('records a skipped automation run when a recurring wake is blocked by an active job', async () => {
    const db = createDb();
    const project = db.listProjects()[0]!;
    const automation = db.saveAutomation({
      name: 'Blocked automation',
      projectId: project.id,
      providerId: 'openai',
      modelId: 'gpt-5',
      promptTemplate: 'Check it',
      enabled: true,
      scheduleType: 'interval_while_app_open',
      intervalMinutes: 5
    });
    const jobs = {
      enqueueAutomationJob: vi.fn(async () => {
        throw new Error(`Automation "${automation.name}" already has an active job.`);
      })
    };
    const scheduler = new AutomationScheduler(db, jobs as never);
    const listener = vi.fn();
    const unsubscribe = scheduler.onEvent(listener);

    scheduler.refresh();
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(db.getAutomation(automation.id).status).toBe('skipped');
    expect(listener).toHaveBeenCalledWith({
      type: 'automation.updated',
      automation: db.getAutomation(automation.id)
    });

    unsubscribe();
    scheduler.dispose();
    db.close();
  });

  it('records a failed automation run when recurring queueing errors unexpectedly', async () => {
    const db = createDb();
    const project = db.listProjects()[0]!;
    const automation = db.saveAutomation({
      name: 'Failing recurring automation',
      projectId: project.id,
      providerId: 'openai',
      modelId: 'gpt-5',
      promptTemplate: 'Check it',
      enabled: true,
      scheduleType: 'interval_while_app_open',
      intervalMinutes: 5
    });
    const jobs = {
      enqueueAutomationJob: vi.fn(async () => {
        throw new Error('queue exploded');
      })
    };
    const scheduler = new AutomationScheduler(db, jobs as never);

    scheduler.refresh();
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(db.getAutomation(automation.id).status).toBe('failed');

    scheduler.dispose();
    db.close();
  });
});
