import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type {
  AutomationDefinition,
  AutomationRun,
  AutomationSaveInput
} from '../shared/domain';

type Row = Record<string, unknown>;

export class AutomationRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly mapAutomation: (row: Row) => AutomationDefinition,
    private readonly computeAutomationNextRunAt: (intervalMinutes: number, from?: string | number | Date) => string,
    private readonly resolveAutomationNextRunAt: (
      input: AutomationSaveInput,
      current: AutomationDefinition | null,
      now: string
    ) => string | null
  ) {}

  listAutomations(): AutomationDefinition[] {
    return this.db.prepare('SELECT * FROM automations ORDER BY updated_at DESC').all().map((row) => this.mapAutomation(row as Row));
  }

  saveAutomation(input: AutomationSaveInput): AutomationDefinition {
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const exists = input.id ? this.db.prepare('SELECT id FROM automations WHERE id = ?').get(input.id) : undefined;
    const current = exists ? this.getAutomation(id) : null;
    const nextRunAt = this.resolveAutomationNextRunAt(input, current, now);
    if (exists) {
      this.db
        .prepare(
          `UPDATE automations
           SET name = @name,
               project_id = @projectId,
               provider_id = @providerId,
               model_id = @modelId,
               prompt_template = @promptTemplate,
               skill_id = @skillId,
               enabled = @enabled,
               schedule_type = @scheduleType,
               interval_minutes = @intervalMinutes,
               next_run_at = @nextRunAt,
               updated_at = @updatedAt
           WHERE id = @id`
        )
        .run({
          id,
          name: input.name,
          projectId: input.projectId,
          providerId: input.providerId,
          modelId: input.modelId,
          promptTemplate: input.promptTemplate,
          skillId: input.skillId ?? null,
          enabled: input.enabled ? 1 : 0,
          scheduleType: input.scheduleType,
          intervalMinutes: input.intervalMinutes ?? null,
          nextRunAt,
          updatedAt: now
        });
    } else {
      this.db
        .prepare(
          `INSERT INTO automations (
             id, name, project_id, provider_id, model_id, prompt_template, skill_id, enabled, schedule_type, interval_minutes, last_run_at, next_run_at, status, created_at, updated_at
           ) VALUES (@id, @name, @projectId, @providerId, @modelId, @promptTemplate, @skillId, @enabled, @scheduleType, @intervalMinutes, NULL, @nextRunAt, 'idle', @createdAt, @updatedAt)`
        )
        .run({
          id,
          name: input.name,
          projectId: input.projectId,
          providerId: input.providerId,
          modelId: input.modelId,
          promptTemplate: input.promptTemplate,
          skillId: input.skillId ?? null,
          enabled: input.enabled ? 1 : 0,
          scheduleType: input.scheduleType,
          intervalMinutes: input.intervalMinutes ?? null,
          nextRunAt,
          createdAt: now,
          updatedAt: now
        });
    }
    return this.getAutomation(id);
  }

  getAutomation(id: string): AutomationDefinition {
    const row = this.db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as Row | undefined;
    if (!row) {
      throw new Error(`Automation not found: ${id}`);
    }
    return this.mapAutomation(row);
  }

  toggleAutomation(automationId: string, enabled: boolean): AutomationDefinition {
    const automation = this.getAutomation(automationId);
    const now = new Date().toISOString();
    const nextRunAt =
      enabled && automation.scheduleType === 'interval_while_app_open' && automation.intervalMinutes
        ? this.computeAutomationNextRunAt(automation.intervalMinutes, now)
        : null;
    this.db
      .prepare('UPDATE automations SET enabled = ?, next_run_at = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, nextRunAt, now, automationId);
    return this.getAutomation(automationId);
  }

  setAutomationNextRunAt(automationId: string, nextRunAt: string | null): AutomationDefinition {
    this.db
      .prepare('UPDATE automations SET next_run_at = ?, updated_at = ? WHERE id = ?')
      .run(nextRunAt, new Date().toISOString(), automationId);
    return this.getAutomation(automationId);
  }

  deleteAutomation(automationId: string) {
    this.db.prepare('DELETE FROM automations WHERE id = ?').run(automationId);
  }

  listAutomationRuns(automationId: string): AutomationRun[] {
    return this.db
      .prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY created_at DESC')
      .all(automationId)
      .map((row) => {
        const typed = row as Row;
        return {
          id: String(typed.id),
          automationId: String(typed.automation_id),
          threadId: typed.thread_id ? String(typed.thread_id) : null,
          status: typed.status as AutomationRun['status'],
          message: String(typed.message),
          createdAt: String(typed.created_at)
        };
      });
  }

  addAutomationRun(automationId: string, threadId: string | null, status: AutomationRun['status'], message: string): AutomationRun {
    const run: AutomationRun = {
      id: randomUUID(),
      automationId,
      threadId,
      status,
      message,
      createdAt: new Date().toISOString()
    };
    this.db
      .prepare(
        `INSERT INTO automation_runs (id, automation_id, thread_id, status, message, created_at)
         VALUES (@id, @automationId, @threadId, @status, @message, @createdAt)`
      )
      .run(run);
    this.db
      .prepare('UPDATE automations SET status = ?, last_run_at = ?, updated_at = ? WHERE id = ?')
      .run(status, run.createdAt, run.createdAt, automationId);
    return run;
  }
}
