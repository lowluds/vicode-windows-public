import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type {
  ComposerMode,
  PlannerPlan,
  PlannerQuestionAnswer,
  PlannerQuestionSet,
  PlanTurnState,
  StructuredPlannerPlan,
  ThreadPlannerState
} from '../shared/domain';

type Row = Record<string, unknown>;

export class PlannerStateRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly mapThreadPlannerState: (row: Row) => ThreadPlannerState,
    private readonly mapPlannerQuestionSet: (row: Row) => PlannerQuestionSet,
    private readonly mapPlannerPlan: (row: Row) => PlannerPlan
  ) {}

  ensureThreadPlannerState(threadId: string) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO thread_planner_state (
          thread_id, composer_mode, turn_state, active_plan_id, pending_question_call_id, updated_at
        ) VALUES (
          @threadId, 'default', 'idle', NULL, NULL, @updatedAt
        )`
      )
      .run({
        threadId,
        updatedAt: now
      });
  }

  getThreadPlannerState(threadId: string): ThreadPlannerState {
    this.ensureThreadPlannerState(threadId);
    const row = this.db.prepare('SELECT * FROM thread_planner_state WHERE thread_id = ?').get(threadId) as Row;
    return this.mapThreadPlannerState(row);
  }

  setThreadPlannerMode(threadId: string, mode: ComposerMode): ThreadPlannerState {
    return this.updateThreadPlannerState(threadId, { composerMode: mode });
  }

  setThreadPlannerTurnState(threadId: string, turnState: PlanTurnState): ThreadPlannerState {
    return this.updateThreadPlannerState(threadId, { turnState });
  }

  createPlannerQuestionSet(threadId: string, promptTurnId: string, callId: string, questions: PlannerQuestionSet['questions']) {
    this.ensureThreadPlannerState(threadId);
    const now = new Date().toISOString();
    const record: PlannerQuestionSet = {
      id: randomUUID(),
      threadId,
      promptTurnId,
      callId,
      questions,
      answers: null,
      createdAt: now
    };
    this.db
      .prepare(
        `INSERT INTO planner_question_sets (
          question_set_id, thread_id, prompt_turn_id, call_id, questions_json, answers_json, created_at
        ) VALUES (
          @id, @threadId, @promptTurnId, @callId, @questionsJson, NULL, @createdAt
        )`
      )
      .run({
        id: record.id,
        threadId,
        promptTurnId,
        callId,
        questionsJson: JSON.stringify(record.questions),
        createdAt: now
      });

    this.updateThreadPlannerState(threadId, {
      turnState: 'waiting_for_answers',
      pendingQuestionCallId: callId
    });

    return record;
  }

  answerPlannerQuestionSet(threadId: string, callId: string, answers: Record<string, PlannerQuestionAnswer>) {
    this.ensureThreadPlannerState(threadId);
    this.db
      .prepare('UPDATE planner_question_sets SET answers_json = ? WHERE thread_id = ? AND call_id = ?')
      .run(JSON.stringify(answers), threadId, callId);
    return this.getPlannerQuestionSetByThreadAndCallId(threadId, callId);
  }

  createPlannerPlan(
    threadId: string,
    createdTurnId: string,
    proposedPlanMarkdown: string,
    structuredPlan: StructuredPlannerPlan | null
  ) {
    this.ensureThreadPlannerState(threadId);
    const current = this.getThreadPlannerState(threadId);
    const now = new Date().toISOString();
    const plan: PlannerPlan = {
      id: randomUUID(),
      threadId,
      createdTurnId,
      proposedPlanMarkdown,
      structuredPlan,
      status: 'draft',
      createdAt: now
    };

    const transaction = this.db.transaction(() => {
      if (current.activePlanId) {
        this.db
          .prepare(`UPDATE planner_plans SET status = 'superseded' WHERE plan_id = ? AND status != 'approved'`)
          .run(current.activePlanId);
      }

      this.db
        .prepare(
          `INSERT INTO planner_plans (
            plan_id, thread_id, created_turn_id, proposed_plan_markdown, structured_plan_json, status, created_at
          ) VALUES (
            @id, @threadId, @createdTurnId, @proposedPlanMarkdown, @structuredPlanJson, @status, @createdAt
          )`
        )
        .run({
          id: plan.id,
          threadId,
          createdTurnId,
          proposedPlanMarkdown,
          structuredPlanJson: structuredPlan ? JSON.stringify(structuredPlan) : null,
          status: plan.status,
          createdAt: now
        });

      this.db
        .prepare(
          `UPDATE thread_planner_state
           SET active_plan_id = @activePlanId,
               pending_question_call_id = NULL,
               turn_state = 'plan_ready',
               updated_at = @updatedAt
           WHERE thread_id = @threadId`
        )
        .run({
          activePlanId: plan.id,
          updatedAt: now,
          threadId
        });
    });

    transaction();
    return this.getPlannerPlan(plan.id);
  }

  approvePlannerPlan(threadId: string, planId: string) {
    this.ensureThreadPlannerState(threadId);
    const now = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE planner_plans SET status = 'superseded' WHERE thread_id = ? AND plan_id != ? AND status != 'approved'`)
        .run(threadId, planId);
      this.db
        .prepare(`UPDATE planner_plans SET status = 'approved' WHERE plan_id = ? AND thread_id = ?`)
        .run(planId, threadId);
      this.db
        .prepare(
          `UPDATE thread_planner_state
           SET composer_mode = 'default',
               turn_state = 'executing_from_plan',
               active_plan_id = @activePlanId,
               pending_question_call_id = NULL,
               updated_at = @updatedAt
           WHERE thread_id = @threadId`
        )
        .run({
          activePlanId: planId,
          updatedAt: now,
          threadId
        });
    });

    transaction();
    return this.getPlannerPlan(planId);
  }

  clearPendingPlannerQuestions(threadId: string) {
    return this.updateThreadPlannerState(threadId, { pendingQuestionCallId: null });
  }

  clearThreadPlannerSession(threadId: string) {
    this.ensureThreadPlannerState(threadId);
    const current = this.getThreadPlannerState(threadId);
    const now = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      if (current.activePlanId) {
        this.db
          .prepare(`UPDATE planner_plans SET status = 'superseded' WHERE plan_id = ? AND status != 'approved'`)
          .run(current.activePlanId);
      }
      this.db
        .prepare(
          `UPDATE thread_planner_state
           SET composer_mode = 'default',
               turn_state = 'idle',
               active_plan_id = NULL,
               pending_question_call_id = NULL,
               updated_at = @updatedAt
           WHERE thread_id = @threadId`
        )
        .run({
          threadId,
          updatedAt: now
        });
    });
    transaction();
    return this.getThreadPlannerState(threadId);
  }

  getPlannerQuestionSetByCallId(callId: string): PlannerQuestionSet {
    const row = this.db.prepare('SELECT * FROM planner_question_sets WHERE call_id = ?').get(callId) as Row | undefined;
    if (!row) {
      throw new Error(`Planner question set not found for call ${callId}.`);
    }
    return this.mapPlannerQuestionSet(row);
  }

  getPlannerQuestionSetByThreadAndCallId(threadId: string, callId: string): PlannerQuestionSet {
    const row = this.db
      .prepare('SELECT * FROM planner_question_sets WHERE thread_id = ? AND call_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(threadId, callId) as Row | undefined;
    if (!row) {
      throw new Error(`Planner question set not found for thread ${threadId} and call ${callId}.`);
    }
    return this.mapPlannerQuestionSet(row);
  }

  getLatestPlannerQuestionSet(threadId: string): PlannerQuestionSet | null {
    const row = this.db
      .prepare('SELECT * FROM planner_question_sets WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(threadId) as Row | undefined;
    return row ? this.mapPlannerQuestionSet(row) : null;
  }

  getPlannerPlan(planId: string): PlannerPlan {
    const row = this.db.prepare('SELECT * FROM planner_plans WHERE plan_id = ?').get(planId) as Row | undefined;
    if (!row) {
      throw new Error(`Planner plan not found: ${planId}`);
    }
    return this.mapPlannerPlan(row);
  }

  private updateThreadPlannerState(
    threadId: string,
    input: Partial<Pick<ThreadPlannerState, 'composerMode' | 'turnState' | 'activePlanId' | 'pendingQuestionCallId'>>
  ) {
    this.ensureThreadPlannerState(threadId);
    const current = this.getThreadPlannerState(threadId);
    const next: ThreadPlannerState = {
      ...current,
      ...input,
      updatedAt: new Date().toISOString()
    };
    this.db
      .prepare(
        `UPDATE thread_planner_state
         SET composer_mode = @composerMode,
             turn_state = @turnState,
             active_plan_id = @activePlanId,
             pending_question_call_id = @pendingQuestionCallId,
             updated_at = @updatedAt
         WHERE thread_id = @threadId`
      )
      .run({
        threadId,
        composerMode: next.composerMode,
        turnState: next.turnState,
        activePlanId: next.activePlanId,
        pendingQuestionCallId: next.pendingQuestionCallId,
        updatedAt: next.updatedAt
      });
    return this.getThreadPlannerState(threadId);
  }
}
