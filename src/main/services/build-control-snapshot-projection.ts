import type {
  VicodeBuildControllerEvent,
  VicodeBuildControllerEventKind,
  VicodeBuildLaneId,
  VicodeBuildTeamId,
  VicodeBuildTeamSnapshot
} from '../../shared/domain';
import { DatabaseService } from '../../storage/database';

type ControllerEventRow = ReturnType<DatabaseService['listVicodeBuildEvents']>[number];
type LaneState = ReturnType<DatabaseService['getVicodeBuildLaneState']>;

export function laneKey(teamId: VicodeBuildTeamId, laneId: VicodeBuildLaneId) {
  return `${teamId}:${laneId}`;
}

export function toControllerEvent(
  event: ControllerEventRow
): VicodeBuildControllerEvent {
  return {
    id: event.id,
    projectId: event.projectId,
    teamId: event.teamId as VicodeBuildTeamId,
    laneId: event.laneId as VicodeBuildLaneId,
    kind: event.kind as VicodeBuildControllerEventKind,
    trigger: event.trigger as VicodeBuildControllerEvent['trigger'],
    summary: event.summary,
    detail: event.detail,
    sourceLaneId: (event.sourceLaneId as VicodeBuildLaneId | null) ?? null,
    targetLaneId: (event.targetLaneId as VicodeBuildLaneId | null) ?? null,
    threadId: event.threadId,
    runId: event.runId,
    createdAt: event.createdAt
  };
}

export function createLaneStateMap(
  db: DatabaseService,
  projectId: string
): Map<string, LaneState> {
  return new Map(
    db.listVicodeBuildLaneStates(projectId).map((state) => [
      laneKey(
        state.teamId as VicodeBuildTeamId,
        state.laneId as VicodeBuildLaneId
      ),
      state
    ])
  );
}

export function listProjectedControllerEvents(
  db: DatabaseService,
  input: {
    projectId: string;
    teamId?: VicodeBuildTeamId;
    limit?: number;
  }
): VicodeBuildControllerEvent[] {
  return db
    .listVicodeBuildEvents(input)
    .map((controllerEvent) => toControllerEvent(controllerEvent));
}

export function sortTeamSnapshotsByActivity(
  teams: VicodeBuildTeamSnapshot[]
): VicodeBuildTeamSnapshot[] {
  return [...teams].sort((left, right) => {
    const rightTime = right.lastActivityAt
      ? new Date(right.lastActivityAt).getTime()
      : 0;
    const leftTime = left.lastActivityAt
      ? new Date(left.lastActivityAt).getTime()
      : 0;
    return rightTime - leftTime;
  });
}
