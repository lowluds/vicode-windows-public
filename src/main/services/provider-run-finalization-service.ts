import { collectThreadSourcesFromRunArtifacts } from '../../shared/thread-sources';
import type {
  RunChangeArtifact,
  RunToolApprovalDecision,
  RunWorktreeChangeEvidence
} from '../../shared/domain';
import type { AppEvent } from '../../shared/events';
import type { DatabaseService } from '../../storage/database';
import { deriveRunChangeArtifact, type WorkspaceSnapshot } from './workspace-changes';
import { ProviderRunEventService } from './provider-run-event-service';
import { ProviderRunProgressService } from './provider-run-progress-service';
import { ThreadProjectionService } from './thread-projection-service';
import type { HarnessWorktreeSession } from './harness-worktree-session';

function formatRunChangeSummary(filesChanged: number) {
  return filesChanged === 1 ? '1 file changed' : `${filesChanged} files changed`;
}

function serializeRunChangeArtifact(artifact: RunChangeArtifact | null) {
  return JSON.stringify(artifact ?? null);
}

function buildWorktreeChangeEvidence(input: {
  artifact: RunChangeArtifact | null;
  runId: string;
  session: HarnessWorktreeSession;
  threadId: string;
}): RunWorktreeChangeEvidence {
  const summary = input.artifact?.summary ?? {
    filesChanged: 0,
    insertions: 0,
    deletions: 0
  };

  return {
    threadId: input.threadId,
    runId: input.runId,
    isolationMode: 'git_worktree',
    status: input.session.status,
    reviewStatus: input.session.reviewStatus,
    cleanupPolicy: input.session.cleanupPolicy,
    sourceWorkspaceRelativePath: input.session.sourceWorkspaceRelativePath,
    branchName: input.session.branchName,
    baseRef: input.session.baseRef,
    baseSha: input.session.baseSha,
    filesChanged: summary.filesChanged,
    insertions: summary.insertions,
    deletions: summary.deletions,
    changedPaths: input.artifact?.files.map((file) => file.path) ?? []
  };
}

type FinalizationDb = Pick<
  DatabaseService,
  | 'addRunEvent'
  | 'getThread'
  | 'removeEmptyAssistantTurn'
  | 'setThreadPlannerTurnState'
  | 'updateAssistantTurn'
  | 'updateThreadStatus'
>;

type ProviderRunFinalizationServiceHost = {
  db: FinalizationDb;
  runProgress: ProviderRunProgressService;
  runEvents: ProviderRunEventService;
  threadProjection: ThreadProjectionService;
  emit(event: AppEvent): void;
  clearPendingToolApprovals(runId?: string, decision?: RunToolApprovalDecision): void;
  maybeDispatchNextFollowUp(threadId: string): void;
  generateThreadTitle(threadId: string, titlePrompt: string): void;
};

export class ProviderRunFinalizationService {
  private readonly lastChangeArtifactByRun = new Map<string, RunChangeArtifact | null>();

  constructor(private readonly host: ProviderRunFinalizationServiceHost) {}

  dispose() {
    this.lastChangeArtifactByRun.clear();
  }

  registerRun(runId: string) {
    this.lastChangeArtifactByRun.set(runId, null);
  }

  finalizeSuccessfulExecutionRun(input: {
    threadId: string;
    runId: string;
    output: string;
    workspaceSnapshot: WorkspaceSnapshot;
    projectFolderPath: string;
    approvedPlan: boolean;
    titlePrompt: string | null;
    changeArtifactSource?: RunChangeArtifact['source'];
    harnessWorktreeSession?: HarnessWorktreeSession | null;
  }) {
    this.host.clearPendingToolApprovals(input.runId, 'cancelled');
    this.host.runEvents.clearRunInfo(input.runId);
    this.host.runProgress.clearPersisted(input.runId);
    const previousChangeArtifact = this.lastChangeArtifactByRun.get(input.runId) ?? null;
    const changeArtifact = deriveRunChangeArtifact(input.workspaceSnapshot, input.projectFolderPath, {
      source: input.changeArtifactSource
    });
    if (changeArtifact) {
      if (serializeRunChangeArtifact(previousChangeArtifact) !== serializeRunChangeArtifact(changeArtifact)) {
        this.emitLiveFileEditEvents(input.threadId, input.runId, previousChangeArtifact, changeArtifact);
      }
      this.lastChangeArtifactByRun.set(input.runId, changeArtifact);
      const currentProgress = this.host.runProgress.get(input.runId);
      if (currentProgress) {
        this.host.runProgress.publish({
          ...currentProgress,
          updatedAt: new Date().toISOString(),
          diffStats: changeArtifact.summary,
          reviewAvailable: true,
          changeArtifact
        });
      }
      const changeEvent = this.host.db.addRunEvent(input.threadId, input.runId, 'info', {
        activity: {
          kind: 'change_summary',
          summary: formatRunChangeSummary(changeArtifact.summary.filesChanged),
          changeArtifact
        }
      });
      this.host.emit({ type: 'raw.event', event: changeEvent });
    }
    if (input.harnessWorktreeSession) {
      const worktreeChangeEvent = this.host.db.addRunEvent(input.threadId, input.runId, 'info', {
        worktreeChangeEvidence: buildWorktreeChangeEvidence({
          artifact: changeArtifact,
          runId: input.runId,
          session: input.harnessWorktreeSession,
          threadId: input.threadId
        }),
        eventKind: 'debug_detail',
        transcriptVisible: false
      });
      this.host.emit({ type: 'raw.event', event: worktreeChangeEvent });
    }
    this.host.runProgress.complete(input.runId);
    const thread = this.host.db.getThread(input.threadId);
    const sources = collectThreadSourcesFromRunArtifacts(
      thread.rawOutput.filter((event) => event.runId === input.runId),
      input.output
    );
    this.host.db.updateAssistantTurn(
      input.runId,
      input.threadId,
      input.output,
      sources.length > 0 ? { sources } : null
    );
    this.host.runEvents.recordRuntimeTraceMark(input.threadId, input.runId, 'completed', {
      outputLength: input.output.length
    });
    this.host.db.addRunEvent(input.threadId, input.runId, 'completed', { output: input.output });
    this.host.db.updateThreadStatus(input.threadId, 'completed');
    if (input.approvedPlan) {
      this.host.db.setThreadPlannerTurnState(input.threadId, 'idle');
    }
    this.host.threadProjection.emitThread(input.threadId);
    this.host.emit({ type: 'run.status', threadId: input.threadId, runId: input.runId, status: 'completed' });
    this.host.runProgress.clear(input.runId);
    this.lastChangeArtifactByRun.delete(input.runId);
    this.host.maybeDispatchNextFollowUp(input.threadId);
    if (input.titlePrompt) {
      this.host.generateThreadTitle(input.threadId, input.titlePrompt);
    }
  }

  finalizeExecutionRunFailure(input: {
    threadId: string;
    runId: string;
    message: string;
    traceStage: 'failed' | 'aborted';
    tracePayload?: Record<string, unknown> | null;
    eventType: 'failed' | 'aborted';
    threadStatus: 'failed' | 'aborted';
    runStatus: 'failed' | 'aborted';
    progressStatus: 'failed' | 'blocked';
    approvedPlan: boolean;
    titlePrompt: string | null;
  }) {
    this.host.clearPendingToolApprovals(input.runId, 'cancelled');
    this.lastChangeArtifactByRun.delete(input.runId);
    this.host.runEvents.clearRunInfo(input.runId);
    this.host.runProgress.clearPersisted(input.runId);
    this.host.runProgress.fail(input.runId, input.progressStatus);
    this.host.db.removeEmptyAssistantTurn(input.runId, input.threadId);
    this.host.runEvents.recordRuntimeTraceMark(input.threadId, input.runId, input.traceStage, input.tracePayload ?? null);
    this.host.db.addRunEvent(
      input.threadId,
      input.runId,
      input.eventType,
      input.message ? { message: input.message } : {}
    );
    this.host.db.updateThreadStatus(input.threadId, input.threadStatus);
    if (input.approvedPlan) {
      this.host.db.setThreadPlannerTurnState(input.threadId, 'idle');
    }
    this.host.threadProjection.emitThreadSummary(input.threadId);
    this.host.emit({
      type: 'run.status',
      threadId: input.threadId,
      runId: input.runId,
      status: input.runStatus,
      message: input.message
    });
    this.host.runProgress.clear(input.runId);
    this.host.maybeDispatchNextFollowUp(input.threadId);
    if (input.titlePrompt) {
      this.host.generateThreadTitle(input.threadId, input.titlePrompt);
    }
  }

  private emitLiveFileEditEvents(
    threadId: string,
    runId: string,
    previousArtifact: RunChangeArtifact | null,
    nextArtifact: RunChangeArtifact | null
  ) {
    const previousFiles = new Map(
      (previousArtifact?.files ?? []).map((file) => [file.path, JSON.stringify(file)] as const)
    );

    for (const file of nextArtifact?.files ?? []) {
      const serialized = JSON.stringify(file);
      if (previousFiles.get(file.path) === serialized) {
        continue;
      }

      const fileEvent = this.host.db.addRunEvent(threadId, runId, 'info', {
        activity: {
          kind: 'file_edit',
          summary: `Edited ${file.path.split('/').pop() ?? file.path}`,
          path: file.path,
          text: `+${file.insertions} -${file.deletions}`
        }
      });
      this.host.emit({ type: 'raw.event', event: fileEvent });
    }
  }
}
