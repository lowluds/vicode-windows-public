import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderDescriptor, RunRuntimeTraceMark, RunRuntimeTraceStage } from '../../shared/domain';
import { DatabaseService } from '../../storage/database';

interface ExportedProviderEventDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  source: string;
  providerEventType: string;
  itemType: string | null;
  itemKeys: string[];
  paths: string[];
  decision: string | null;
  status: string | null;
  taskLike: boolean;
  classification: string;
}

interface ExportedNativeProgressSnapshot {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  title: string | null;
  itemCount: number;
  statuses: string[];
}

interface ExportedToolRuntimeDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  kind: 'tool_call' | 'tool_result';
  toolName: string | null;
  phase: string | null;
  status: string | null;
  summary: string;
}

interface ExportedTerminalCommandDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  createdAt: string;
  phase: string | null;
  summary: string;
  command: string | null;
  cwd: string | null;
  isolationMode: string | null;
}

interface ExportedRuntimeTraceDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  firstRecordedAt: string;
  stageCount: number;
  terminalStage: RunRuntimeTraceStage | null;
  marks: RunRuntimeTraceMark[];
  submitToContextCompleteMs: number | null;
  contextAssemblyMs: number | null;
  submitToPromptAssembledMs: number | null;
  submitToRunStartedMs: number | null;
  submitToFirstDeltaMs: number | null;
  submitToFirstToolCallMs: number | null;
  submitToFirstToolResultMs: number | null;
  submitToTerminalMs: number | null;
}

interface ExportedFailedRunDiagnostic {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  failedAt: string;
  failureStage: 'failed' | 'aborted';
  failureMessage: string | null;
  failureReason: string | null;
  hadAssistantOutput: boolean;
  lastThinkingSummary: string | null;
  lastProviderEventType: string | null;
  lastProviderPaths: string[];
  toolCallCount: number;
  toolResultCount: number;
  terminalCommandCount: number;
  lastToolName: string | null;
  lastToolCallSummary: string | null;
  lastToolResultSummary: string | null;
  lastTerminalCommand: string | null;
}

interface RuntimeTraceAccumulator {
  threadId: string;
  threadTitle: string;
  providerId: string;
  runId: string;
  marks: RunRuntimeTraceMark[];
}

interface FailedRunAccumulator extends ExportedFailedRunDiagnostic {}

function parseRuntimeTraceMark(payload: Record<string, unknown>) {
  const runtimeTrace =
    'runtimeTrace' in payload && payload.runtimeTrace && typeof payload.runtimeTrace === 'object'
      ? (payload.runtimeTrace as Record<string, unknown>)
      : null;
  if (!runtimeTrace) {
    return null;
  }

  const stage = typeof runtimeTrace.stage === 'string' ? (runtimeTrace.stage as RunRuntimeTraceStage) : null;
  const at = typeof runtimeTrace.at === 'string' ? runtimeTrace.at : null;
  if (!stage || !at) {
    return null;
  }

  return {
    stage,
    at,
    detail:
      'detail' in runtimeTrace && runtimeTrace.detail && typeof runtimeTrace.detail === 'object'
        ? (runtimeTrace.detail as Record<string, unknown>)
        : null
  } satisfies RunRuntimeTraceMark;
}

function toEpochMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function diffMs(start: string | null | undefined, end: string | null | undefined) {
  const startMs = toEpochMs(start);
  const endMs = toEpochMs(end);
  if (startMs === null || endMs === null) {
    return null;
  }
  return Math.max(0, endMs - startMs);
}

function getTraceStageAt(marks: RunRuntimeTraceMark[], stage: RunRuntimeTraceStage) {
  return marks.find((mark) => mark.stage === stage)?.at ?? null;
}

export class DiagnosticsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly exportsDir: string,
    private readonly getCollaborationDiagnostics: (() => Record<string, unknown>) | null = null
  ) {}

  async export(providers: ProviderDescriptor[]) {
    await mkdir(this.exportsDir, { recursive: true });
    const filePath = join(this.exportsDir, `diagnostics-${Date.now()}.json`);
    const data = {
      exportedAt: new Date().toISOString(),
      projects: this.db.listProjects(),
      preferences: this.db.getPreferences(),
      skills: this.db.listSkills(),
      automations: this.db.listAutomations(),
      providers,
      runProgressDiagnostics: this.collectRunProgressDiagnostics(),
      collaborationDiagnostics: this.collectCollaborationDiagnostics()
    };
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return filePath;
  }

  async exportThread(threadId: string, providers: ProviderDescriptor[]) {
    await mkdir(this.exportsDir, { recursive: true });
    const thread = this.db.getThread(threadId);
    const project = this.db.getProject(thread.projectId);
    const filePath = join(this.exportsDir, `thread-diagnostics-${threadId}-${Date.now()}.json`);
    const data = {
      exportedAt: new Date().toISOString(),
      project,
      thread,
      providers,
      runProgressDiagnostics: this.collectRunProgressDiagnostics([threadId]),
      collaborationDiagnostics: this.collectCollaborationDiagnostics()
    };
    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return filePath;
  }

  private collectRunProgressDiagnostics(threadIds: Iterable<string> | null = null) {
    const providerEventDiagnostics: ExportedProviderEventDiagnostic[] = [];
    const nativeProgressSnapshots: ExportedNativeProgressSnapshot[] = [];
    const toolRuntimeDiagnostics: ExportedToolRuntimeDiagnostic[] = [];
    const terminalCommandDiagnostics: ExportedTerminalCommandDiagnostic[] = [];
    const runtimeTraceByRun = new Map<string, RuntimeTraceAccumulator>();
    const failedRunByKey = new Map<string, FailedRunAccumulator>();
    const resolvedThreadIds = new Set<string>();

    if (threadIds) {
      for (const threadId of threadIds) {
        resolvedThreadIds.add(threadId);
      }
    } else {
      for (const project of this.db.listProjects()) {
        for (const thread of this.db.listThreads(project.id)) {
          resolvedThreadIds.add(thread.id);
        }
        for (const thread of this.db.listArchivedThreads(project.id)) {
          resolvedThreadIds.add(thread.id);
        }
      }
    }

    for (const threadId of resolvedThreadIds) {
      const thread = this.db.getThread(threadId);
      const getFailedRunAccumulator = (runId: string): FailedRunAccumulator => {
        const key = `${thread.id}:${runId}`;
        const existing = failedRunByKey.get(key);
        if (existing) {
          return existing;
        }

        const created: FailedRunAccumulator = {
          threadId: thread.id,
          threadTitle: thread.title,
          providerId: thread.providerId,
          runId,
          failedAt: '',
          failureStage: 'failed',
          failureMessage: null,
          failureReason: null,
          hadAssistantOutput: false,
          lastThinkingSummary: null,
          lastProviderEventType: null,
          lastProviderPaths: [],
          toolCallCount: 0,
          toolResultCount: 0,
          terminalCommandCount: 0,
          lastToolName: null,
          lastToolCallSummary: null,
          lastToolResultSummary: null,
          lastTerminalCommand: null
        };
        failedRunByKey.set(key, created);
        return created;
      };

      for (const event of thread.rawOutput) {
        const failedRun = getFailedRunAccumulator(event.runId);
        if (event.eventType === 'delta') {
          failedRun.hadAssistantOutput = true;
        }
        if (
          event.eventType === 'completed'
          && event.payload
          && typeof event.payload === 'object'
          && 'output' in event.payload
          && typeof event.payload.output === 'string'
          && event.payload.output.trim()
        ) {
          failedRun.hadAssistantOutput = true;
        }

        if (event.eventType !== 'info' || !event.payload || typeof event.payload !== 'object') {
          if (
            (event.eventType === 'failed' || event.eventType === 'aborted')
            && event.payload
            && typeof event.payload === 'object'
            && 'message' in event.payload
            && typeof event.payload.message === 'string'
          ) {
            failedRun.failedAt = event.createdAt;
            failedRun.failureStage = event.eventType;
            failedRun.failureMessage = event.payload.message;
          }
          continue;
        }

        const runtimeTrace = parseRuntimeTraceMark(event.payload);
        if (runtimeTrace) {
          const key = `${thread.id}:${event.runId}`;
          const current = runtimeTraceByRun.get(key) ?? {
            threadId: thread.id,
            threadTitle: thread.title,
            providerId: thread.providerId,
            runId: event.runId,
            marks: []
          };
          current.marks.push(runtimeTrace);
          runtimeTraceByRun.set(key, current);

          if (runtimeTrace.stage === 'failed' || runtimeTrace.stage === 'aborted') {
            failedRun.failedAt = runtimeTrace.at;
            failedRun.failureStage = runtimeTrace.stage;
            failedRun.failureMessage =
              runtimeTrace.detail && typeof runtimeTrace.detail.message === 'string'
                ? runtimeTrace.detail.message
                : failedRun.failureMessage;
            failedRun.failureReason =
              runtimeTrace.detail && typeof runtimeTrace.detail.reason === 'string'
                ? runtimeTrace.detail.reason
                : failedRun.failureReason;
          }
        }

        const providerDiagnostics =
          'providerDiagnostics' in event.payload &&
          event.payload.providerDiagnostics &&
          typeof event.payload.providerDiagnostics === 'object'
            ? (event.payload.providerDiagnostics as Record<string, unknown>)
            : null;
        if (providerDiagnostics) {
          failedRun.lastProviderEventType =
            typeof providerDiagnostics.providerEventType === 'string' ? providerDiagnostics.providerEventType : failedRun.lastProviderEventType;
          failedRun.lastProviderPaths = Array.isArray(providerDiagnostics.paths)
            ? providerDiagnostics.paths.filter((value): value is string => typeof value === 'string')
            : failedRun.lastProviderPaths;
          providerEventDiagnostics.push({
            threadId: thread.id,
            threadTitle: thread.title,
            providerId: thread.providerId,
            runId: event.runId,
            createdAt: event.createdAt,
            source: typeof providerDiagnostics.source === 'string' ? providerDiagnostics.source : 'unknown',
            providerEventType:
              typeof providerDiagnostics.providerEventType === 'string' ? providerDiagnostics.providerEventType : 'unknown',
            itemType: typeof providerDiagnostics.itemType === 'string' ? providerDiagnostics.itemType : null,
            itemKeys: Array.isArray(providerDiagnostics.itemKeys)
              ? providerDiagnostics.itemKeys.filter((value): value is string => typeof value === 'string')
              : [],
            paths: Array.isArray(providerDiagnostics.paths)
              ? providerDiagnostics.paths.filter((value): value is string => typeof value === 'string')
              : [],
            decision: typeof providerDiagnostics.decision === 'string' ? providerDiagnostics.decision : null,
            status: typeof providerDiagnostics.status === 'string' ? providerDiagnostics.status : null,
            taskLike: providerDiagnostics.taskLike === true,
            classification:
              typeof providerDiagnostics.classification === 'string'
                ? providerDiagnostics.classification
                : 'unknown'
          });
        }

        const progressSource =
          'progressSnapshot' in event.payload && event.payload.progressSnapshot && typeof event.payload.progressSnapshot === 'object'
            ? event.payload.progressSnapshot
            : 'progress' in event.payload && event.payload.progress && typeof event.payload.progress === 'object'
              ? event.payload.progress
              : null;
        const progress = progressSource as Record<string, unknown> | null;
        if (progress) {
          const items = Array.isArray(progress.items) ? progress.items : [];
          nativeProgressSnapshots.push({
            threadId: thread.id,
            threadTitle: thread.title,
            providerId: thread.providerId,
            runId: event.runId,
            createdAt: event.createdAt,
            title: typeof progress.title === 'string' ? progress.title : null,
            itemCount: items.length,
            statuses: items
              .map((item) => (item && typeof item === 'object' && 'status' in item ? (item as { status?: unknown }).status : null))
              .filter((status): status is string => typeof status === 'string')
          });
        }

        const activity =
          'activity' in event.payload && event.payload.activity && typeof event.payload.activity === 'object'
            ? (event.payload.activity as Record<string, unknown>)
            : null;
        if (activity && activity.kind === 'thinking') {
          failedRun.lastThinkingSummary = typeof activity.summary === 'string' ? activity.summary : failedRun.lastThinkingSummary;
        }
        if (activity && (activity.kind === 'tool_call' || activity.kind === 'tool_result')) {
          if (activity.kind === 'tool_call') {
            failedRun.toolCallCount += 1;
            failedRun.lastToolName = typeof activity.toolName === 'string' ? activity.toolName : failedRun.lastToolName;
            failedRun.lastToolCallSummary = typeof activity.summary === 'string' ? activity.summary : failedRun.lastToolCallSummary;
          } else {
            failedRun.toolResultCount += 1;
            failedRun.lastToolName = typeof activity.toolName === 'string' ? activity.toolName : failedRun.lastToolName;
            failedRun.lastToolResultSummary = typeof activity.summary === 'string' ? activity.summary : failedRun.lastToolResultSummary;
          }
          toolRuntimeDiagnostics.push({
            threadId: thread.id,
            threadTitle: thread.title,
            providerId: thread.providerId,
            runId: event.runId,
            createdAt: event.createdAt,
            kind: activity.kind,
            toolName: typeof activity.toolName === 'string' ? activity.toolName : null,
            phase: typeof activity.phase === 'string' ? activity.phase : null,
            status: typeof activity.status === 'string' ? activity.status : null,
            summary: typeof activity.summary === 'string' ? activity.summary : 'Unknown tool activity'
          });
        }

        if (activity && activity.kind === 'terminal_command') {
          failedRun.terminalCommandCount += 1;
          failedRun.lastTerminalCommand = typeof activity.command === 'string' ? activity.command : failedRun.lastTerminalCommand;
          terminalCommandDiagnostics.push({
            threadId: thread.id,
            threadTitle: thread.title,
            providerId: thread.providerId,
            runId: event.runId,
            createdAt: event.createdAt,
            phase: typeof activity.phase === 'string' ? activity.phase : null,
            summary: typeof activity.summary === 'string' ? activity.summary : 'Unknown terminal activity',
            command: typeof activity.command === 'string' ? activity.command : null,
            cwd: typeof activity.cwd === 'string' ? activity.cwd : null,
            isolationMode:
              typeof activity.isolationMode === 'string'
                ? activity.isolationMode
                : null
          });
        }
      }
    }

    const runtimeTraceDiagnostics: ExportedRuntimeTraceDiagnostic[] = [...runtimeTraceByRun.values()]
      .map((entry) => {
        const marks = [...entry.marks].sort((left, right) => left.at.localeCompare(right.at));
        const terminalStage =
          [...marks]
            .reverse()
            .find((mark) => mark.stage === 'completed' || mark.stage === 'failed' || mark.stage === 'aborted')?.stage ?? null;
        const submitAt = getTraceStageAt(marks, 'submit_received');
        return {
          threadId: entry.threadId,
          threadTitle: entry.threadTitle,
          providerId: entry.providerId,
          runId: entry.runId,
          firstRecordedAt: marks[0]?.at ?? '',
          stageCount: marks.length,
          terminalStage,
          marks,
          submitToContextCompleteMs: diffMs(submitAt, getTraceStageAt(marks, 'workspace_context_completed')),
          contextAssemblyMs: diffMs(getTraceStageAt(marks, 'workspace_context_started'), getTraceStageAt(marks, 'workspace_context_completed')),
          submitToPromptAssembledMs: diffMs(submitAt, getTraceStageAt(marks, 'prompt_assembled')),
          submitToRunStartedMs: diffMs(submitAt, getTraceStageAt(marks, 'run_started')),
          submitToFirstDeltaMs: diffMs(submitAt, getTraceStageAt(marks, 'first_delta')),
          submitToFirstToolCallMs: diffMs(submitAt, getTraceStageAt(marks, 'first_tool_call')),
          submitToFirstToolResultMs: diffMs(submitAt, getTraceStageAt(marks, 'first_tool_result')),
          submitToTerminalMs: diffMs(
            submitAt,
            terminalStage ? getTraceStageAt(marks, terminalStage) : null
          )
        } satisfies ExportedRuntimeTraceDiagnostic;
      })
      .sort((left, right) => left.firstRecordedAt.localeCompare(right.firstRecordedAt));

    const failedRunDiagnostics: ExportedFailedRunDiagnostic[] = [...failedRunByKey.values()]
      .filter((entry) => Boolean(entry.failedAt))
      .sort((left, right) => left.failedAt.localeCompare(right.failedAt));

    return {
      providerEventDiagnostics,
      nativeProgressSnapshots,
      toolRuntimeDiagnostics,
      terminalCommandDiagnostics,
      runtimeTraceDiagnostics,
      failedRunDiagnostics
    };
  }

  private collectCollaborationDiagnostics() {
    return this.getCollaborationDiagnostics?.() ?? null;
  }
}
