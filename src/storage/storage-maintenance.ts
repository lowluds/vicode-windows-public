import { existsSync, statSync } from 'node:fs';
import type Database from 'better-sqlite3';
import type {
  StorageCompactionResult,
  StorageDiagnostics,
  StorageMaintenanceResult
} from '../shared/ipc';

const RUN_EVENT_COMPACTION_CUTOFF_DAYS = 30;

type Row = Record<string, unknown>;

export function getStorageDiagnostics(
  db: Database.Database,
  databasePath: string
): StorageDiagnostics {
  const readSize = (path: string) => (existsSync(path) ? statSync(path).size : 0);
  const count = (table: string, where?: string) =>
    (
      db
        .prepare(
          `SELECT COUNT(*) as total FROM ${table}${where ? ` WHERE ${where}` : ''}`
        )
        .get() as { total: number }
    ).total;
  const databaseSizeBytes = readSize(databasePath);
  const walSizeBytes = readSize(`${databasePath}-wal`);
  const shmSizeBytes = readSize(`${databasePath}-shm`);
  const threadCount = count('threads');
  const archivedThreadCount = count('threads', 'archived = 1');
  const compactableRuns = listCompactableRunEvents(
    db,
    getRunEventCompactionCutoffIso()
  );

  return {
    databasePath,
    databaseSizeBytes,
    walSizeBytes,
    shmSizeBytes,
    totalStorageBytes: databaseSizeBytes + walSizeBytes + shmSizeBytes,
    projectCount: count('projects'),
    threadCount,
    archivedThreadCount,
    activeThreadCount: threadCount - archivedThreadCount,
    turnCount: count('thread_turns'),
    runEventCount: count('run_events'),
    compactableRunCount: compactableRuns.length,
    compactableDeltaEventCount: compactableRuns.reduce(
      (total, run) => total + run.deltaCount,
      0
    ),
    compactionCutoffDays: RUN_EVENT_COMPACTION_CUTOFF_DAYS,
  };
}

export function compactOldTerminalRunEvents(
  db: Database.Database,
  _input?: Record<string, never>
): StorageCompactionResult {
  const cutoffIso = getRunEventCompactionCutoffIso();
  const candidates = listCompactableRunEvents(db, cutoffIso);
  if (candidates.length === 0) {
    return {
      cutoffIso,
      cutoffDays: RUN_EVENT_COMPACTION_CUTOFF_DAYS,
      runsCompacted: 0,
      deltaEventsDeleted: 0,
    };
  }

  const deleteDeltaEvents = db.prepare(
    `DELETE FROM run_events
     WHERE thread_id = ?
       AND run_id = ?
       AND event_type = 'delta'`
  );

  const deltaEventsDeleted = db.transaction(() => {
    let deleted = 0;
    for (const candidate of candidates) {
      deleted += deleteDeltaEvents.run(
        candidate.threadId,
        candidate.runId
      ).changes;
    }
    return deleted;
  })();

  return {
    cutoffIso,
    cutoffDays: RUN_EVENT_COMPACTION_CUTOFF_DAYS,
    runsCompacted: candidates.length,
    deltaEventsDeleted,
  };
}

export function maintainStorage(
  db: Database.Database,
  databasePath: string,
  input?: { vacuum?: boolean }
): StorageMaintenanceResult {
  const before = getStorageDiagnostics(db, databasePath);
  const compaction = compactOldTerminalRunEvents(db);
  db.pragma('wal_checkpoint(TRUNCATE)');

  if (input?.vacuum) {
    db.exec('VACUUM');
  }

  const after = getStorageDiagnostics(db, databasePath);
  return {
    ...compaction,
    vacuumApplied: input?.vacuum === true,
    sizeBeforeBytes: before.totalStorageBytes,
    sizeAfterBytes: after.totalStorageBytes,
    reclaimedBytes: Math.max(
      0,
      before.totalStorageBytes - after.totalStorageBytes
    ),
  };
}

function getRunEventCompactionCutoffIso() {
  return new Date(
    Date.now() - RUN_EVENT_COMPACTION_CUTOFF_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}

function listCompactableRunEvents(db: Database.Database, cutoffIso: string) {
  return db
    .prepare(
      `SELECT
        events.thread_id AS thread_id,
        events.run_id AS run_id,
        SUM(CASE WHEN events.event_type = 'delta' THEN 1 ELSE 0 END) AS delta_count
       FROM run_events events
       INNER JOIN threads thread ON thread.id = events.thread_id
       LEFT JOIN thread_planner_state planner ON planner.thread_id = thread.id
       WHERE thread.archived = 1
         AND COALESCE(planner.turn_state, 'idle') = 'idle'
         AND NOT EXISTS (
           SELECT 1
           FROM jobs job
           INNER JOIN review_items review ON review.job_id = job.id
           WHERE job.thread_id = events.thread_id
             AND review.status = 'pending'
         )
       GROUP BY events.thread_id, events.run_id
       HAVING SUM(CASE WHEN events.event_type = 'delta' THEN 1 ELSE 0 END) > 0
          AND SUM(CASE WHEN events.event_type IN ('completed', 'failed', 'aborted') THEN 1 ELSE 0 END) > 0
          AND MAX(events.created_at) < @cutoffIso`
    )
    .all({ cutoffIso })
    .map((row) => ({
      threadId: String((row as Row).thread_id),
      runId: String((row as Row).run_id),
      deltaCount: Number((row as Row).delta_count ?? 0),
    }));
}
