import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { AppEvent } from '../../shared/events';
import type {
  AgentExecutionConstraints,
  ExecutionPermission,
  ProviderId,
  ProviderReasoningEffort,
  SkillDefinition,
  ThreadDetail,
  ThreadStatus,
  VicodeBuildControllerEvent,
  VicodeBuildControllerEventKind,
  VicodeBuildLaneId,
  VicodeBuildLaneSnapshot,
  VicodeBuildPlanDraft,
  VicodeBuildSnapshot,
  VicodeBuildTicketSnapshot,
  VicodeBuildTeamId,
  VicodeBuildTeamSnapshot,
  VicodeBuildVerificationResult,
  VicodeBuildVerificationStep
} from '../../shared/domain';
import { getProviderMetadata } from '../../shared/providers';
import { DatabaseService } from '../../storage/database';
import { ProviderManager } from './provider-manager';

const execFileAsync = promisify(execFile);
const CONFIG_RELATIVE_PATH = join('.vicode', 'control', 'vicode-build-teams.json');
const ACTIVE_THREAD_STATUSES = new Set<ThreadStatus>(['queued', 'running', 'stopping']);
const TERMINAL_THREAD_STATUSES = new Set<ThreadStatus>(['completed', 'failed', 'aborted']);
const CONTROL_PLANE_PATH_PREFIXES = ['.vicode/control/', 'docs/engineering/'];
const TICKET_QUEUE_VERSION = 1;
const BUILD_TICKET_QUEUE_HELPER_PATH = join('.vicode', 'control', 'update_build_ticket_queue.py').replace(/\\/gu, '/');
const CONTROL_SUPPORT_FILE_PATHS = [
  'archive_noop_automation_runs.py',
  'check_automation_gate.py',
  'check_queue_health.py',
  'promote_control_plane_changes.py',
  'promote_product_work_changes.py',
  'select_claimable_ticket.py',
  'team_config.py',
  'ticket_state.py',
  'update_build_ticket_queue.py',
  'wake_automation.py',
  'write_automation_status.py'
].map((fileName) => join('.vicode', 'control', fileName).replace(/\\/gu, '/'));
const HANDOFF_DRIFT_RECOVERY_INTERVAL_MS = 30_000;
const RUN_STALL_THRESHOLDS_MS: Record<VicodeBuildLaneId, number> = {
  planner: 120_000,
  builder: 180_000,
  finisher: 120_000
};

type ConfigLane = {
  label: string;
  automationId: string;
  promptPath?: string;
  skillIds?: string[];
  providerId?: ProviderId;
  modelId?: string;
  reasoningEffort?: ProviderReasoningEffort | null;
  executionPermission?: ExecutionPermission;
  executionConstraints?: AgentExecutionConstraints | null;
};

type ConfigTeam = {
  id: VicodeBuildTeamId;
  label: string;
  goal?: string;
  worktreePath: string;
  heartbeatPath?: string | null;
  lanes: Record<VicodeBuildLaneId, ConfigLane>;
};

type LoadedContext = {
  projectId: string;
  projectRoot: string;
  configPath: string;
  teams: Array<ConfigTeam & { worktreeRoot: string }>;
};

type LaneState = ReturnType<DatabaseService['getVicodeBuildLaneState']>;
type ControllerEventRow = ReturnType<DatabaseService['listVicodeBuildEvents']>[number];

type LanePromptSpec = {
  providerId: ProviderId;
  modelId: string;
  prompt: string;
  promptSource: string;
  skillIds: string[];
  skillNames: string[];
  reasoningEffort: ProviderReasoningEffort | null;
  executionPermission: ExecutionPermission;
  executionConstraints: AgentExecutionConstraints;
};

type HeartbeatState = {
  path: string | null;
  absolutePath: string | null;
  status: string | null;
  summary: string | null;
  updatedAt: string | null;
  openItems: string[];
};

type TicketQueueState = {
  path: string | null;
  absolutePath: string | null;
  updatedAt: string | null;
  tickets: VicodeBuildTicketSnapshot[];
};

type LaneOutcome = {
  runId: string | null;
  status: 'completed' | 'failed' | 'aborted' | null;
  message: string | null;
  filesChanged: number;
  changedPaths: string[];
};

type LaneContext = {
  snapshot: VicodeBuildLaneSnapshot;
  thread: ThreadDetail | null;
  outcome: LaneOutcome;
};

type LaneQueueRunMarker = {
  signature: string | null;
  activeTicketId: string | null;
  startedAt: string | null;
};

type TicketProgressState = {
  touchedPaths: string[];
  remainingPaths: string[];
};

type PartialTicketStallInfo = {
  thread: ThreadDetail;
  activeTicket: VicodeBuildTicketSnapshot;
  progress: TicketProgressState;
  retryCount: number;
};

type LaneStallInfo = {
  ageMs: number;
  summary: string;
  detail: string;
  event: VicodeBuildControllerEvent;
};

type LaneEscalationInfo = {
  summary: string;
  detail: string;
};

type BuilderTicketScopeIssue = {
  sourceRootOnlyPaths: string[];
};

type PythonJsonResult = {
  ok: boolean;
  summary: string;
  detail: string | null;
  dirtyPaths: string[];
};

type VicodeBuildControlUpdate = {
  projectId: string;
  teamId: VicodeBuildTeamId;
  laneId: VicodeBuildLaneId;
  threadId: string | null;
};

function laneKey(teamId: VicodeBuildTeamId, laneId: VicodeBuildLaneId) {
  return `${teamId}:${laneId}`;
}

function slugifyBuildControlId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48) || 'build-plan';
}

function deriveBuildControlName(goal: string) {
  const trimmed = goal.trim();
  const sentence = trimmed.split(/[.!?]/u)[0]?.trim() ?? trimmed;
  if (!sentence) {
    return 'New Build Plan';
  }
  return sentence.length <= 60 ? sentence : `${sentence.slice(0, 57).trimEnd()}...`;
}

function normalizeForKeywordMatch(value: string) {
  return value.toLowerCase();
}

function inferGoalSkillIds(
  laneId: VicodeBuildLaneId,
  goal: string,
  availableSkills: SkillDefinition[]
) {
  const byName = new Map(
    availableSkills.map((skill) => [normalizeForKeywordMatch(skill.name), skill.id])
  );
  const goalText = normalizeForKeywordMatch(goal);
  const selected = new Set<string>();
  const maybeAddByName = (name: string) => {
    const skillId = byName.get(normalizeForKeywordMatch(name));
    if (skillId) {
      selected.add(skillId);
    }
  };

  maybeAddByName('Concise');
  if (laneId === 'planner') {
    maybeAddByName('Planner');
  }
  if (laneId === 'finisher') {
    maybeAddByName('Reviewer');
  }
  if (/\b(doc|docs|documentation|readme|worklog|writeup|brief)\b/u.test(goalText)) {
    maybeAddByName('Doc Writer');
  }
  if (/\b(explain|walkthrough|teach|teaching|understand)\b/u.test(goalText)) {
    maybeAddByName('Teacher');
  }
  if (/\b(pdf|export)\b/u.test(goalText)) {
    maybeAddByName('PDF Toolkit');
  }
  if (/\b(csv|spreadsheet|table|metrics)\b/u.test(goalText)) {
    maybeAddByName('Spreadsheet Analyst');
  }

  return [...selected];
}

function cleanPlanName(value: string) {
  return value
    .replace(/^[\s`"'*_#-]+/gu, '')
    .replace(/[\s`"'*_#-]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

const NON_ACTIONABLE_WORKSPACE_ENTRIES = new Set([
  '.git',
  '.vicode',
  'node_modules',
  'out',
  'dist',
  'release',
  'playwright-report',
  'test-results'
]);

function hasActionableWorkspaceContent(worktreeRoot: string) {
  if (!existsSync(worktreeRoot) || !statSync(worktreeRoot).isDirectory()) {
    return false;
  }

  return readdirSync(worktreeRoot, { withFileTypes: true }).some((entry) => {
    if (NON_ACTIONABLE_WORKSPACE_ENTRIES.has(entry.name)) {
      return false;
    }
    if (entry.name.startsWith('.')) {
      return false;
    }
    return true;
  });
}

const BUILD_PLAN_OVERLAP_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'to',
  'of',
  'for',
  'in',
  'on',
  'with',
  'inside',
  'into',
  'from',
  'that',
  'this',
  'it',
  'is',
  'be',
  'are',
  'or',
  'by',
  'up',
  'out',
  'one',
  'leave',
  'keep'
]);

function tokenizePlanGoal(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !BUILD_PLAN_OVERLAP_STOPWORDS.has(token))
  );
}

function computeGoalOverlapScore(left: string, right: string) {
  const leftTokens = tokenizePlanGoal(left);
  const rightTokens = tokenizePlanGoal(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  const intersectionSize = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const unionSize = new Set([...leftTokens, ...rightTokens]).size;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

function isGeneratedBuildPlan(team: ConfigTeam) {
  return (Object.keys(team.lanes) as VicodeBuildLaneId[]).every((laneId) =>
    team.lanes[laneId].automationId.startsWith('vicode-build-')
  );
}

function stripBuildPlanSetupPrefix(value: string) {
  return value.startsWith('Build plan setup / ')
    ? value.slice('Build plan setup / '.length).trim()
    : value.trim();
}

function extractGoalLine(content: string) {
  return content.match(/(?:^|\n)Goal:\s*(.+)$/imu)?.[1]?.trim() ?? null;
}

function extractGoalSentence(content: string) {
  const normalized = content.replace(/\r\n/gu, '\n').trim();
  if (!normalized) {
    return null;
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(goal|worktree|provider|model)\s*:/iu.test(line));
  const candidateLine = lines.find((line) => /^[A-Z0-9]/u.test(line)) ?? lines[0] ?? null;
  if (!candidateLine) {
    return null;
  }

  const firstSentence = candidateLine
    .split(/(?<=[.!?])\s+/u)[0]
    ?.replace(/^[-*]\s+/u, '')
    .trim();
  return firstSentence && firstSentence.length >= 12 ? firstSentence : candidateLine;
}

function isUsableBuildPlanName(value: string | null | undefined) {
  const trimmed = cleanPlanName(value ?? '');
  if (!trimmed) {
    return false;
  }
  if (trimmed.length > 80) {
    return false;
  }
  if (trimmed.includes('##') || trimmed.includes('```') || /(^|\s)[-*]\s/iu.test(trimmed)) {
    return false;
  }
  if (/^(maintenance|implementation|execution|project|build)\s+plan(?:\s+for\b.*)?$/iu.test(trimmed)) {
    return false;
  }
  return !/[`]/u.test(trimmed);
}

function decodeTomlBasicString(value: string) {
  return value
    .replace(/\\\\/gu, '\\')
    .replace(/\\"/gu, '"')
    .replace(/\\n/gu, '\n')
    .replace(/\\r/gu, '\r')
    .replace(/\\t/gu, '\t');
}

function extractTomlString(source: string, key: string) {
  const match = source.match(new RegExp(`^${key} = "((?:[^"\\\\]|\\\\.)*)"$`, 'm'));
  return match ? decodeTomlBasicString(match[1] ?? '') : null;
}

function isControlPlanePath(path: string) {
  const normalized = path.replace(/\\/gu, '/');
  return normalized === 'HEARTBEAT.md' || CONTROL_PLANE_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isPlanningArtifactPath(path: string) {
  const normalized = path.replace(/\\/gu, '/');
  return (
    normalized.startsWith('.vicode/control/build-heartbeats/') ||
    normalized.startsWith('.vicode/control/build-prompts/') ||
    normalized === '.vicode/control/vicode-build-teams.json'
  );
}

function plannerChangedNonPlanningArtifacts(outcome: LaneOutcome) {
  return (
    outcome.filesChanged > 0
    && outcome.changedPaths.length > 0
    && !outcome.changedPaths.every(isPlanningArtifactPath)
  );
}

function deriveLaneStatus(paused: boolean, thread: ThreadDetail | null): VicodeBuildLaneSnapshot['status'] {
  if (thread && ACTIVE_THREAD_STATUSES.has(thread.status)) {
    return 'running';
  }
  if (paused) {
    return 'paused';
  }
  if (!thread) {
    return 'idle';
  }

  switch (thread.status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'aborted':
      return 'cancelled';
    case 'draft':
    case 'archived':
    case 'auth_required':
    default:
      return 'idle';
  }
}

function friendlyLaneLabel(laneId: VicodeBuildLaneId) {
  switch (laneId) {
    case 'planner':
      return 'Planner';
    case 'builder':
      return 'Builder';
    case 'finisher':
      return 'Finisher';
  }
}

function buildDefaultLaneExecutionConstraints(
  laneId: VicodeBuildLaneId
): AgentExecutionConstraints {
  switch (laneId) {
    case 'planner':
      return {
        permissionMode: 'plan',
        toolPolicy: {
          preset: 'build_planner',
          allowedToolCallNames: [],
          disallowedToolCallNames: ['apply_patch']
        },
        maxTurns: 6,
        maxReasoningTokens: null,
        taskBudgetTokens: null,
        costBudgetUsd: null,
        maxDelegationDepth: 1,
        maxAutomaticRetries: 0,
        maxUnchangedHandoffs: 1,
        maxSiblingDelegates: 1
      };
    case 'builder':
      return {
        permissionMode: 'default',
        toolPolicy: {
          preset: 'builder',
          allowedToolCallNames: [],
          disallowedToolCallNames: []
        },
        maxTurns: 10,
        maxReasoningTokens: null,
        taskBudgetTokens: null,
        costBudgetUsd: null,
        maxDelegationDepth: 0,
        maxAutomaticRetries: 1,
        maxUnchangedHandoffs: 1,
        maxSiblingDelegates: 0
      };
    case 'finisher':
      return {
        permissionMode: 'plan',
        toolPolicy: {
          preset: 'finisher',
          allowedToolCallNames: [],
          disallowedToolCallNames: ['apply_patch', 'write_file', 'mkdir']
        },
        maxTurns: 6,
        maxReasoningTokens: null,
        taskBudgetTokens: null,
        costBudgetUsd: null,
        maxDelegationDepth: 0,
        maxAutomaticRetries: 0,
        maxUnchangedHandoffs: 1,
        maxSiblingDelegates: 0
      };
  }
}

function resolveLaneExecutionConstraints(
  laneId: VicodeBuildLaneId,
  lane: ConfigLane
) {
  return lane.executionConstraints ?? buildDefaultLaneExecutionConstraints(laneId);
}

function readRunMessage(value: unknown) {
  return value && typeof value === 'object' && typeof (value as { message?: unknown }).message === 'string'
    ? (value as { message: string }).message
    : null;
}

function deriveLaneOutcome(thread: ThreadDetail | null): LaneOutcome {
  if (!thread) {
    return {
      runId: null,
      status: null,
      message: null,
      filesChanged: 0,
      changedPaths: []
    };
  }

  const terminalEvent = [...thread.rawOutput].reverse().find((event) =>
    event.eventType === 'completed' || event.eventType === 'failed' || event.eventType === 'aborted'
  );

  if (!terminalEvent) {
    return {
      runId: null,
      status: null,
      message: null,
      filesChanged: 0,
      changedPaths: []
    };
  }

  const changeEvent = [...thread.rawOutput].reverse().find((event) => {
    if (event.runId !== terminalEvent.runId || event.eventType !== 'info') {
      return false;
    }

    const payload = event.payload as Record<string, unknown> | null;
    const activity = payload?.activity;
    return Boolean(
      activity
      && typeof activity === 'object'
      && 'changeArtifact' in activity
      && activity.changeArtifact
    );
  });

  const changeArtifact = (
    changeEvent?.payload as { activity?: { changeArtifact?: { summary?: { filesChanged?: unknown }, files?: Array<{ path?: unknown }> } } } | undefined
  )?.activity?.changeArtifact;

  const filesChanged =
    typeof changeArtifact?.summary?.filesChanged === 'number' && Number.isFinite(changeArtifact.summary.filesChanged)
      ? changeArtifact.summary.filesChanged
      : 0;
  const changedPaths = Array.isArray(changeArtifact?.files)
    ? changeArtifact.files
        .map((file) => (typeof file?.path === 'string' ? file.path : null))
        .filter((path): path is string => Boolean(path))
    : [];

  return {
    runId: terminalEvent.runId,
    status: terminalEvent.eventType,
    message: readRunMessage(terminalEvent.payload),
    filesChanged,
    changedPaths
  };
}

function deriveFinisherNextLane(outcome: LaneOutcome): VicodeBuildLaneId | null {
  if (outcome.filesChanged <= 0) {
    return null;
  }

  return outcome.changedPaths.every(isControlPlanePath) ? 'builder' : 'planner';
}

function derivePlannerNextLane(outcome: LaneOutcome): VicodeBuildLaneId | null {
  if (outcome.filesChanged <= 0) {
    return null;
  }

  return outcome.changedPaths.length > 0 && outcome.changedPaths.every(isPlanningArtifactPath)
    ? 'builder'
    : 'finisher';
}

function deriveNoopContinuationLane(
  laneId: VicodeBuildLaneId,
  heartbeatStatus: string | null
): VicodeBuildLaneId | null {
  const normalized = heartbeatStatus?.trim().toLowerCase() ?? null;
  if (normalized !== 'active') {
    return null;
  }

  if (laneId === 'builder' || laneId === 'finisher') {
    return 'planner';
  }

  return null;
}

function defaultRecommendedActionForIdleLane(laneId: VicodeBuildLaneId) {
  if (laneId === 'finisher') {
    return 'Wait for planner or builder to produce a promotable slice, then wake Finisher.';
  }

  return 'Wake this lane when you want the next bounded slice to start.';
}

function isHeartbeatTerminalStatus(status: string | null) {
  const normalized = status?.trim().toLowerCase() ?? null;
  return normalized === 'done' || normalized === 'completed';
}

function defaultTicketQueuePath(teamId: VicodeBuildTeamId) {
  return join('.vicode', 'control', 'build-tickets', `${teamId}.json`).replace(/\\/gu, '/');
}

function activeTicketForQueue(tickets: VicodeBuildTicketSnapshot[]) {
  return tickets.find((ticket) => ticket.status === 'in_progress') ?? null;
}

function unresolvedDependenciesForTicket(
  ticket: VicodeBuildTicketSnapshot,
  tickets: VicodeBuildTicketSnapshot[]
) {
  return ticket.dependencies.filter((dependencyId) => {
    const dependency = tickets.find((candidate) => candidate.id === dependencyId);
    return !dependency || dependency.status !== 'done';
  });
}

function ticketDependenciesSatisfied(
  ticket: VicodeBuildTicketSnapshot,
  tickets: VicodeBuildTicketSnapshot[]
) {
  return unresolvedDependenciesForTicket(ticket, tickets).length === 0;
}

function nextClaimableTicket(
  tickets: VicodeBuildTicketSnapshot[],
  laneId?: VicodeBuildLaneId
) {
  return (
    tickets.find(
      (ticket) =>
        ticket.status === 'todo'
        && (!laneId || ticket.ownerLane === laneId)
        && ticketDependenciesSatisfied(ticket, tickets)
    ) ?? null
  );
}

function hasDependencyBlockedOpenTickets(tickets: VicodeBuildTicketSnapshot[]) {
  return tickets.some(
    (ticket) =>
      ticket.status === 'todo'
      && ticket.dependencies.length > 0
      && !ticketDependenciesSatisfied(ticket, tickets)
  );
}

function summarizeTickets(tickets: VicodeBuildTicketSnapshot[]) {
  const activeTicket = activeTicketForQueue(tickets);
  if (activeTicket) {
    return `Active: ${activeTicket.title}`;
  }
  const claimable = nextClaimableTicket(tickets);
  if (claimable) {
    return `Ready: ${claimable.title}`;
  }
  const dependencyHeld = tickets.find(
    (ticket) => ticket.status === 'todo' && unresolvedDependenciesForTicket(ticket, tickets).length > 0
  );
  if (dependencyHeld) {
    const blockers = unresolvedDependenciesForTicket(dependencyHeld, tickets)
      .map((dependencyId) => tickets.find((ticket) => ticket.id === dependencyId)?.title ?? dependencyId)
      .join(', ');
    return `Waiting: ${dependencyHeld.title} depends on ${blockers}`;
  }
  const open = tickets.filter((ticket) => ticket.status === 'todo' || ticket.status === 'in_progress');
  if (open.length === 0) {
    return null;
  }
  return open.slice(0, 2).map((ticket) => ticket.title).join(' | ');
}

function firstDependencyHeldTicketForLane(
  tickets: VicodeBuildTicketSnapshot[],
  laneId: VicodeBuildLaneId
) {
  return (
    tickets.find(
      (ticket) =>
        ticket.ownerLane === laneId
        && ticket.status === 'todo'
        && unresolvedDependenciesForTicket(ticket, tickets).length > 0
    ) ?? null
  );
}

function describeDependencyHeldTicket(
  ticket: VicodeBuildTicketSnapshot,
  tickets: VicodeBuildTicketSnapshot[]
) {
  const blockers = unresolvedDependenciesForTicket(ticket, tickets)
    .map((dependencyId) => tickets.find((candidate) => candidate.id === dependencyId)?.title ?? dependencyId);
  if (blockers.length === 0) {
    return null;
  }
  return `"${ticket.title}" is waiting on ${blockers.join(', ')}`;
}

function summarizeDownstreamDependencyPressure(
  sourceLaneId: VicodeBuildLaneId,
  tickets: VicodeBuildTicketSnapshot[]
) {
  const activeSourceTicket = activeTicketForQueue(tickets);
  if (!activeSourceTicket || activeSourceTicket.ownerLane !== sourceLaneId) {
    return null;
  }

  const waitingDependents = tickets.filter(
    (ticket) =>
      ticket.status === 'todo'
      && unresolvedDependenciesForTicket(ticket, tickets).includes(activeSourceTicket.id)
  );
  if (waitingDependents.length === 0) {
    return null;
  }

  const dependentTitles = waitingDependents.map((ticket) => `"${ticket.title}"`).join(', ');
  return `${dependentTitles} ${waitingDependents.length === 1 ? 'is' : 'are'} waiting on "${activeSourceTicket.title}".`;
}

function describeVerificationQueueRelationship(tickets: VicodeBuildTicketSnapshot[]) {
  const dependencyHeld = tickets.find(
    (ticket) => ticket.status === 'todo' && unresolvedDependenciesForTicket(ticket, tickets).length > 0
  );
  if (dependencyHeld) {
    return describeDependencyHeldTicket(dependencyHeld, tickets);
  }

  const activeTicket = activeTicketForQueue(tickets);
  if (!activeTicket) {
    return null;
  }
  return summarizeDownstreamDependencyPressure(activeTicket.ownerLane, tickets);
}

function summarizeOwnedSlice(ticket: VicodeBuildTicketSnapshot | null) {
  if (!ticket) {
    return null;
  }
  const laneLabel = friendlyLaneLabel(ticket.ownerLane);
  const verificationSummary =
    ticket.verificationSteps.length > 0 ? ` Verify: ${ticket.verificationSteps.slice(0, 2).join(' | ')}` : '';
  const dependencySummary =
    ticket.dependencies.length > 0
      ? ` Depends on: ${ticket.dependencies.join(', ')}.`
      : '';
  if (ticket.summary) {
    return `${laneLabel} owns "${ticket.title}": ${ticket.summary}${dependencySummary}${verificationSummary}`.trim();
  }
  return `${laneLabel} owns "${ticket.title}".${dependencySummary}${verificationSummary}`.trim();
}

function formatChecklistSection(label: string, items: string[]) {
  if (items.length === 0) {
    return null;
  }

  return [
    `${label}:`,
    ...items.map((item) => `- ${item}`)
  ].join('\n');
}

function formatActiveTicketChecklist(ticket: VicodeBuildTicketSnapshot | null) {
  if (!ticket) {
    return null;
  }

  return [
    '## Active Ticket Contract',
    `Ticket: ${ticket.id} (${ticket.status})`,
    `Owner lane: ${friendlyLaneLabel(ticket.ownerLane)}`,
    ticket.summary ? `Summary: ${ticket.summary}` : null,
    formatChecklistSection('Dependencies', ticket.dependencies),
    formatChecklistSection('Target paths', ticket.targetPaths),
    formatChecklistSection('Acceptance criteria', ticket.acceptanceCriteria),
    formatChecklistSection('Verification steps', ticket.verificationSteps),
    formatChecklistSection('References / evidence', ticket.refs),
    ticket.stopWhen ? `Stop when: ${ticket.stopWhen}` : null
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function extractLikelyRepoPaths(value: string | null | undefined) {
  if (!value) {
    return [];
  }
  const matches = value.match(/(?:^|[\s("'`])((?:\.[\\/])?[\w.-]+(?:[\\/][\w .-]+)+)/gu) ?? [];
  const paths = matches
    .map((match) => match.trim().replace(/^[\s("'`]+/u, '').replace(/[)"'`,.:;!?]+$/u, ''))
    .filter((match) => match.includes('/') || match.includes('\\'))
    .map((match) => match.replace(/\\/gu, '/'));
  return [...new Set(paths)];
}

function ticketQueueSignature(tickets: VicodeBuildTicketSnapshot[]) {
  return JSON.stringify(
    tickets.map((ticket) => ({
      id: ticket.id,
      status: ticket.status,
      ownerLane: ticket.ownerLane,
      title: ticket.title,
      summary: ticket.summary ?? null,
      dependencies: ticket.dependencies,
      targetPaths: ticket.targetPaths,
      acceptanceCriteria: ticket.acceptanceCriteria,
      verificationSteps: ticket.verificationSteps,
      refs: ticket.refs,
      stopWhen: ticket.stopWhen ?? null
    }))
  );
}

function newestDailyNotePath(worktreeRoot: string) {
  const memoryDir = join(worktreeRoot, 'memory');
  if (!existsSync(memoryDir)) {
    return null;
  }

  const candidates = readdirSync(memoryDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  if (candidates.length === 0) {
    return null;
  }

  return join(memoryDir, candidates[0]!);
}

function listWorkspaceContractPaths(worktreeRoot: string) {
  const candidates = [
    join(worktreeRoot, 'AGENTS.md'),
    join(worktreeRoot, 'SOUL.md'),
    join(worktreeRoot, 'USER.md'),
    join(worktreeRoot, 'MEMORY.md'),
    newestDailyNotePath(worktreeRoot)
  ].filter((value): value is string => Boolean(value));

  return candidates.filter((path) => existsSync(path));
}

function nextLaneFromTicketQueue(tickets: VicodeBuildTicketSnapshot[], fallbackLaneId: VicodeBuildLaneId): VicodeBuildLaneId | null {
  const activeTicket = activeTicketForQueue(tickets);
  if (activeTicket && activeTicket.ownerLane !== fallbackLaneId) {
    return activeTicket.ownerLane;
  }

  const queuedTicket = nextClaimableTicket(tickets);
  if (queuedTicket) {
    return queuedTicket.ownerLane;
  }

  return null;
}

function hasBlockedTerminalQueue(tickets: VicodeBuildTicketSnapshot[]) {
  const hasActionableTicket = tickets.some((ticket) => ticket.status === 'todo' || ticket.status === 'in_progress');
  const hasBlockedTicket = tickets.some((ticket) => ticket.status === 'blocked');
  return !hasActionableTicket && hasBlockedTicket;
}

function hasResolvedTerminalQueue(tickets: VicodeBuildTicketSnapshot[]) {
  const hasActionableTicket = tickets.some((ticket) => ticket.status === 'todo' || ticket.status === 'in_progress');
  const hasBlockedTicket = tickets.some((ticket) => ticket.status === 'blocked');
  const hasDoneTicket = tickets.some((ticket) => ticket.status === 'done');
  return !hasActionableTicket && !hasBlockedTicket && hasDoneTicket;
}

function toControllerEvent(event: ControllerEventRow): VicodeBuildControllerEvent {
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

export class VicodeBuildControlService {
  private readonly codexHome: string;
  private readonly emitter = new EventEmitter();
  private readonly unsubscribeProviders: () => void;
  private readonly recoveryInterval: ReturnType<typeof setInterval>;

  constructor(
    private readonly db: DatabaseService,
    private readonly providers: ProviderManager,
    options?: {
      codexHome?: string;
    }
  ) {
    this.codexHome = options?.codexHome ?? join(os.homedir(), '.codex');
    this.unsubscribeProviders = this.providers.onEvent((event) => {
      void this.handleProviderEvent(event);
    });
    this.recoveryInterval = setInterval(() => {
      void this.sweepControllerRecovery();
    }, HANDOFF_DRIFT_RECOVERY_INTERVAL_MS);
    this.recoveryInterval.unref?.();
  }

  dispose() {
    clearInterval(this.recoveryInterval);
    this.unsubscribeProviders();
    this.emitter.removeAllListeners();
  }

  onControllerUpdate(listener: (event: VicodeBuildControlUpdate) => void) {
    this.emitter.on('controller-update', listener);
    return () => this.emitter.off('controller-update', listener);
  }

  getSnapshot(projectId: string | null): VicodeBuildSnapshot {
    const checkedAt = new Date().toISOString();
    const context = this.loadContext(projectId);
    if (!context.ok) {
      return {
        available: false,
        checkedAt,
        projectId,
        projectRoot: context.projectRoot,
        configPath: context.configPath,
        teams: [],
        recentEvents: [],
        note: context.note
      };
    }

    const recentEvents = this.db
      .listVicodeBuildEvents({ projectId: context.value.projectId, limit: 40 })
      .map(toControllerEvent);
    const laneStates = new Map(
      this.db
        .listVicodeBuildLaneStates(context.value.projectId)
        .map((state) => [laneKey(state.teamId as VicodeBuildTeamId, state.laneId as VicodeBuildLaneId), state])
    );
    const teams = context.value.teams
      .map((team) =>
        this.buildTeamSnapshot(context.value.projectId, context.value.projectRoot, team, laneStates, recentEvents)
      )
      .sort((left, right) => {
        const rightTime = right.lastActivityAt ? new Date(right.lastActivityAt).getTime() : 0;
        const leftTime = left.lastActivityAt ? new Date(left.lastActivityAt).getTime() : 0;
        return rightTime - leftTime;
      });

    return {
      available: true,
      checkedAt,
      projectId: context.value.projectId,
      projectRoot: context.value.projectRoot,
      configPath: context.value.configPath,
      teams,
      recentEvents: recentEvents.slice(0, 12),
      note: 'Vicode owns lane orchestration here. Prompts are repo-local and downstream handoffs happen through native Vicode run completion.'
    };
  }

  setTeamPaused(projectId: string, teamId: VicodeBuildTeamId, paused: boolean): VicodeBuildSnapshot {
    const context = this.requireContext(projectId);
    const team = context.teams.find((entry) => entry.id === teamId);
    if (!team) {
      throw new Error(`Unknown Vicode build team: ${teamId}`);
    }

    for (const laneId of Object.keys(team.lanes) as VicodeBuildLaneId[]) {
      this.db.saveVicodeBuildLaneState({
        projectId,
        teamId,
        laneId,
        paused
      });
      this.recordControllerEvent({
        projectId,
        teamId,
        laneId,
        kind: paused ? 'team_paused' : 'team_resumed',
        trigger: 'manual',
        summary: paused ? 'Team paused from Build Control.' : 'Team resumed from Build Control.'
      });
    }

    return this.getSnapshot(projectId);
  }

  async wakeLane(
    projectId: string,
    teamId: VicodeBuildTeamId,
    laneId: VicodeBuildLaneId
  ): Promise<VicodeBuildSnapshot> {
    const thread = await this.startLaneRun(projectId, teamId, laneId);
    this.recordControllerEvent({
      projectId,
      teamId,
      laneId,
      kind: 'manual_wake',
      trigger: 'manual',
      summary: 'Manual wake submitted from Build Control.',
      threadId: thread.id
    });
    return this.getSnapshot(projectId);
  }

  async retryLane(
    projectId: string,
    teamId: VicodeBuildTeamId,
    laneId: VicodeBuildLaneId
  ): Promise<VicodeBuildSnapshot> {
    const laneState = this.db.getVicodeBuildLaneState(projectId, teamId, laneId);
    const thread = this.resolveLaneThreadDetail(laneState.threadId);
    if (!thread) {
      return this.wakeLane(projectId, teamId, laneId);
    }

    const activeRunId = this.resolveActiveRunId(thread);
    if (ACTIVE_THREAD_STATUSES.has(thread.status)) {
      if (activeRunId) {
        await this.providers.stopRun(activeRunId);
      } else {
        this.db.updateThreadStatus(thread.id, 'aborted');
        this.db.appendTurn(
          thread.id,
          'status',
          'Build Control cleared a stale active lane state before retrying this run.',
          { laneControlMarker: `build-controller:${teamId}:${laneId}` }
        );
      }
    }

    await this.startLaneRun(projectId, teamId, laneId);
    this.recordControllerEvent({
      projectId,
      teamId,
      laneId,
      kind: 'manual_wake',
      trigger: 'manual',
      summary: `Retried ${friendlyLaneLabel(laneId)} after stopping the stalled run.`,
      detail: thread.title,
      threadId: thread.id,
      runId: activeRunId
    });
    return this.getSnapshot(projectId);
  }

  createPlan(
    projectId: string,
    input: {
      goal: string;
      name?: string;
      worktreePath?: string;
      providerId?: ProviderId;
      modelId?: string;
    }
  ): VicodeBuildSnapshot {
    const draft = this.writePlanScaffold(projectId, input);

    this.recordControllerEvent({
      projectId,
      teamId: draft.controlId,
      laneId: 'planner',
      kind: 'manual_wake',
      trigger: 'manual',
      summary: `Build plan "${draft.name}" was created from a goal prompt.`
    });

    return this.getSnapshot(projectId);
  }

  async createPlanFromThread(threadId: string): Promise<VicodeBuildSnapshot> {
    const thread = this.db.getThread(threadId);
    if (ACTIVE_THREAD_STATUSES.has(thread.status)) {
      throw new Error('Wait for the setup thread to finish its current run before creating the build plan.');
    }
    if (this.db.findVicodeBuildLaneByThread(threadId)) {
      throw new Error('This thread is already bound to a build-control lane.');
    }

    const planSeed = this.derivePlanSeedFromThread(thread);
    const draft = this.writePlanScaffold(thread.projectId, planSeed);
    this.db.clearThreadPlannerSession(thread.id);

    this.db.saveVicodeBuildLaneState({
      projectId: thread.projectId,
      teamId: draft.controlId,
      laneId: 'planner',
      threadId: thread.id,
      paused: false
    });

    this.recordControllerEvent({
      projectId: thread.projectId,
      teamId: draft.controlId,
      laneId: 'planner',
      kind: 'manual_wake',
      trigger: 'manual',
      summary: `Build plan "${draft.name}" was created from setup thread "${thread.title}".`,
      threadId: thread.id
    });

    await this.startLaneRun(thread.projectId, draft.controlId, 'planner');
    return this.getSnapshot(thread.projectId);
  }

  clearInactivePlans(projectId: string): VicodeBuildSnapshot {
    const context = this.requireContext(projectId);
    const recentEvents = this.db
      .listVicodeBuildEvents({ projectId: context.projectId, limit: 40 })
      .map(toControllerEvent);
    const laneStates = new Map(
      this.db
        .listVicodeBuildLaneStates(context.projectId)
        .map((state) => [laneKey(state.teamId as VicodeBuildTeamId, state.laneId as VicodeBuildLaneId), state])
    );
    const removableIds = new Set(
      context.teams
        .map((team) => this.buildTeamSnapshot(context.projectId, context.projectRoot, team, laneStates, recentEvents))
        .filter((team) => team.status !== 'active' && team.status !== 'waiting')
        .map((team) => team.teamId)
    );
    if (removableIds.size === 0) {
      return this.getSnapshot(projectId);
    }

    const retainedTeams = context.teams.filter((team) => !removableIds.has(team.id));
    for (const team of context.teams) {
      if (!removableIds.has(team.id)) {
        continue;
      }
      const heartbeatPath = team.heartbeatPath?.trim();
      if (heartbeatPath) {
        rmSync(resolve(context.projectRoot, heartbeatPath), { force: true });
        rmSync(resolve(team.worktreeRoot, heartbeatPath), { force: true });
      }
      rmSync(resolve(context.projectRoot, defaultTicketQueuePath(team.id)), { force: true });
      rmSync(resolve(team.worktreeRoot, defaultTicketQueuePath(team.id)), { force: true });
      rmSync(resolve(context.projectRoot, '.vicode', 'control', 'build-prompts', team.id), {
        recursive: true,
        force: true
      });
      rmSync(resolve(team.worktreeRoot, '.vicode', 'control', 'build-prompts', team.id), {
        recursive: true,
        force: true
      });
    }

    writeFileSync(
      context.configPath,
      JSON.stringify(
        {
          version: 3,
          controls: retainedTeams
        },
        null,
        2
      ),
      'utf-8'
    );

    return this.getSnapshot(projectId);
  }

  generatePlanDraft(
    projectId: string,
    goal: string,
    options?: {
      name?: string;
      worktreePath?: string;
      providerId?: ProviderId;
      modelId?: string;
    }
  ): VicodeBuildPlanDraft {
    const project = this.db.getProject(projectId);
    if (!project.folderPath) {
      throw new Error('The selected project does not have a workspace folder.');
    }

    const configPath = resolve(project.folderPath, CONFIG_RELATIVE_PATH);
    const teams = this.readConfigTeams(configPath);
    const providerId = options?.providerId ?? project.defaultProviderId;
    const modelId = options?.modelId?.trim() || project.defaultModelByProvider[providerId] || getProviderMetadata(providerId).defaultModelId;
    const enabledSkills = this.listEligibleBuildSkills(projectId, providerId);
    const name = options?.name?.trim() || deriveBuildControlName(goal);
    const worktreePath = options?.worktreePath?.trim() || '.';
    const duplicate = teams.find(
      (entry) =>
        entry.label.trim().toLowerCase() === name.trim().toLowerCase()
        && entry.worktreePath.trim() === worktreePath
    );
    if (duplicate) {
      throw new Error(`A build plan named "${duplicate.label}" already exists for ${worktreePath}. Open the existing plan instead of creating a duplicate.`);
    }
    const overlappingPlan = this.findOverlappingPlan(projectId, project.folderPath, goal, worktreePath);
    if (overlappingPlan) {
      const ownershipSummary = overlappingPlan.ownedSliceSummary ?? overlappingPlan.ticketSummary ?? overlappingPlan.heartbeatSummary;
      throw new Error(
        ownershipSummary
          ? `A similar active build plan is already in progress: "${overlappingPlan.label}". ${ownershipSummary} Open that plan instead of creating overlapping work.`
          : `A similar active build plan is already in progress: "${overlappingPlan.label}". Open that plan instead of creating overlapping work.`
      );
    }
    const baseId = slugifyBuildControlId(name);
    let controlId = baseId;
    let suffix = 2;
    while (teams.some((entry) => entry.id === controlId)) {
      controlId = `${baseId}-${suffix}`;
      suffix += 1;
    }

    const plannerPrompt = this.buildPlannerPrompt(goal, worktreePath);
    const builderPrompt = this.buildBuilderPrompt(goal, worktreePath);
    const finisherPrompt = this.buildFinisherPrompt(goal, worktreePath);
    const heartbeatPath = join('.vicode', 'control', 'build-heartbeats', `${controlId}.md`).replace(/\\/gu, '/');
    const laneSkillIds = {
      planner: inferGoalSkillIds('planner', goal, enabledSkills),
      builder: inferGoalSkillIds('builder', goal, enabledSkills),
      finisher: inferGoalSkillIds('finisher', goal, enabledSkills)
    } satisfies Record<VicodeBuildLaneId, string[]>;
    const skillNameById = new Map(enabledSkills.map((skill) => [skill.id, skill.name]));
    const laneSkillNames = {
      planner: laneSkillIds.planner.map((skillId) => skillNameById.get(skillId) ?? skillId),
      builder: laneSkillIds.builder.map((skillId) => skillNameById.get(skillId) ?? skillId),
      finisher: laneSkillIds.finisher.map((skillId) => skillNameById.get(skillId) ?? skillId)
    } satisfies Record<VicodeBuildLaneId, string[]>;

    return {
      controlId,
      name,
      goal: goal.trim(),
      worktreePath,
      heartbeatPath,
      providerId,
      modelId,
      reasoningEffort: 'medium',
      executionPermission: 'full_access',
      lanePrompts: {
        planner: plannerPrompt,
        builder: builderPrompt,
        finisher: finisherPrompt
      },
      laneSummaries: {
        planner: 'Define the next bounded slice and shape the implementation path.',
        builder: 'Implement the current slice directly against the target worktree.',
        finisher: 'Review, land, and hand off the slice or record the blocker.'
      },
      laneSkillIds,
      laneSkillNames
    };
  }

  private writePlanScaffold(
    projectId: string,
    input: {
      goal: string;
      name?: string;
      worktreePath?: string;
      providerId?: ProviderId;
      modelId?: string;
    }
  ) {
    const project = this.db.getProject(projectId);
    if (!project.folderPath) {
      throw new Error('The selected project does not have a workspace folder.');
    }

    const projectRoot = project.folderPath;
    const configPath = resolve(projectRoot, CONFIG_RELATIVE_PATH);
    const controlRoot = resolve(projectRoot, '.vicode', 'control');
    const teams = this.readConfigTeams(configPath);
    const draft = this.generatePlanDraft(projectId, input.goal, {
      name: input.name,
      worktreePath: input.worktreePath,
      providerId: input.providerId,
      modelId: input.modelId
    });
    const executionRoot = resolve(projectRoot, draft.worktreePath);
    if (!hasActionableWorkspaceContent(executionRoot)) {
      throw new Error(
        `Build plans need an actionable workspace. ${executionRoot} only contains controller artifacts or empty scaffolding right now. Open a real project root or dedicated worktree before starting a plan.`
      );
    }
    const promptDir = join('.vicode', 'control', 'build-prompts', draft.controlId);
    mkdirSync(resolve(executionRoot, promptDir), { recursive: true });
    mkdirSync(resolve(executionRoot, '.vicode', 'control', 'build-heartbeats'), { recursive: true });
    mkdirSync(resolve(executionRoot, '.vicode', 'control', 'build-tickets'), { recursive: true });
    this.ensureControlSupportFiles(projectRoot, executionRoot);

    writeFileSync(resolve(executionRoot, promptDir, 'planner.md'), draft.lanePrompts.planner, 'utf-8');
    writeFileSync(resolve(executionRoot, promptDir, 'builder.md'), draft.lanePrompts.builder, 'utf-8');
    writeFileSync(resolve(executionRoot, promptDir, 'finisher.md'), draft.lanePrompts.finisher, 'utf-8');
    writeFileSync(
      resolve(executionRoot, draft.heartbeatPath),
      this.buildHeartbeatTemplate(draft.goal, draft.worktreePath),
      'utf-8'
    );
    writeFileSync(
      resolve(executionRoot, defaultTicketQueuePath(draft.controlId)),
      this.buildTicketQueueTemplate(draft.goal),
      'utf-8'
    );

      teams.push({
        id: draft.controlId,
        label: draft.name,
        goal: draft.goal,
        worktreePath: draft.worktreePath,
        heartbeatPath: draft.heartbeatPath,
        lanes: {
          planner: this.createConfigLane(draft.controlId, 'planner', join(promptDir, 'planner.md'), 'medium', draft.laneSkillIds.planner, draft.providerId, draft.modelId),
          builder: this.createConfigLane(draft.controlId, 'builder', join(promptDir, 'builder.md'), 'medium', draft.laneSkillIds.builder, draft.providerId, draft.modelId),
          finisher: this.createConfigLane(draft.controlId, 'finisher', join(promptDir, 'finisher.md'), 'medium', draft.laneSkillIds.finisher, draft.providerId, draft.modelId)
        }
      });

    mkdirSync(controlRoot, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          version: 3,
          controls: teams
        },
        null,
        2
      ),
      'utf-8'
    );

    return draft;
  }

  private derivePlanSeedFromThread(thread: ThreadDetail) {
    if (thread.planner.pendingQuestionSet) {
      throw new Error('Answer the planner follow-up questions in this setup thread before creating the build plan.');
    }

    const activePlan = thread.planner.activePlan;
    if (!activePlan) {
      throw new Error('Generate a planner draft in this setup thread before creating the build plan.');
    }
    if (activePlan.status === 'superseded') {
      throw new Error('The latest planner draft in this thread was replaced. Regenerate the plan draft before creating the build plan.');
    }
    if (!activePlan.structuredPlan) {
      throw new Error('This setup thread does not have a structured planner draft yet. Ask the planner to produce the build plan artifact first.');
    }
    if (thread.planner.turnState !== 'plan_ready' && activePlan.status !== 'approved') {
      throw new Error('Wait for the setup thread to finish generating the planner draft before creating the build plan.');
    }

    const plannerRequestTurns = thread.turns.filter(
      (turn) =>
        turn.role === 'user'
        && (
          !turn.metadata
          || typeof turn.metadata !== 'object'
          || (turn.metadata as { plannerPhase?: unknown }).plannerPhase !== 'answer'
        )
    );
    const setupGoal = plannerRequestTurns
      .map((turn) => extractGoalLine(turn.content) ?? extractGoalSentence(turn.content))
      .find((value): value is string => Boolean(value));
    const goal = cleanPlanName(
      setupGoal
      ?? activePlan.structuredPlan.summary[0]
      ?? activePlan.structuredPlan.keyChanges[0]
      ?? activePlan.structuredPlan.title
    );
    if (!goal) {
      throw new Error('The structured planner draft is missing a usable goal summary for this build plan.');
    }

    const name = isUsableBuildPlanName(activePlan.structuredPlan.title)
      ? cleanPlanName(activePlan.structuredPlan.title)
      : deriveBuildControlName(goal);
    return {
      goal,
      name,
      worktreePath: '.',
      providerId: thread.providerId,
      modelId: thread.modelId
    };
  }

  async runVerification(projectId: string): Promise<VicodeBuildVerificationResult> {
    const context = this.requireContext(projectId);
    const steps: VicodeBuildVerificationStep[] = [];

    for (const team of context.teams) {
      const sourceRoot = team.worktreeRoot;
      const ticketQueue = this.readTicketQueueState(context.projectRoot, team);
      const checks: Array<{ id: string; label: string; args: string[] }> = [
        { id: 'queue-health', label: 'Queue health', args: ['.vicode/control/check_queue_health.py', '--json'] },
        { id: 'gate-research', label: 'Research gate', args: ['.vicode/control/check_automation_gate.py', '--lane', 'research', '--json'] },
        { id: 'gate-implement', label: 'Implement gate', args: ['.vicode/control/check_automation_gate.py', '--lane', 'implement', '--json'] },
        { id: 'archive-noop', label: 'No-op archive', args: ['.vicode/control/archive_noop_automation_runs.py', '--json'] },
        {
          id: 'promote-control',
          label: 'Control-plane promote dry run',
          args: ['.vicode/control/promote_control_plane_changes.py', '--source-root', sourceRoot, '--json']
        },
        {
          id: 'promote-product',
          label: 'Product promote dry run',
          args: ['.vicode/control/promote_product_work_changes.py', '--source-root', sourceRoot, '--json']
        }
      ];

      for (const check of checks) {
        const result = this.interpretVerificationResult(
          team,
          check.id,
          await this.runPythonJson(team.worktreeRoot, check.args),
          ticketQueue
        );
        steps.push({
          id: `${team.id}:${check.id}`,
          teamId: team.id,
          teamLabel: team.label,
          label: check.label,
          ok: result.ok,
          summary: result.summary,
          detail: result.detail
        });
      }
    }

    return {
      ok: steps.every((step) => step.ok),
      checkedAt: new Date().toISOString(),
      steps
    };
  }

  private interpretVerificationResult(
    team: ConfigTeam & { worktreeRoot: string },
    checkId: string,
    result: PythonJsonResult,
    ticketQueue: TicketQueueState
  ): PythonJsonResult {
    if (checkId === 'queue-health') {
      const queueRelationship = describeVerificationQueueRelationship(ticketQueue.tickets);
      if (queueRelationship) {
        return {
          ...result,
          detail: [result.detail, `Current bounded queue state: ${queueRelationship}.`]
            .filter((value): value is string => Boolean(value))
            .join(' ')
        };
      }
    }

    if (
      checkId === 'promote-control'
      && result.summary === 'source-dirty-overlap'
      && this.isExpectedPlanScaffoldOverlap(team.id, result.dirtyPaths)
    ) {
      return {
        ok: true,
        summary: 'scaffold-pending-review',
        detail:
          'Fresh build-plan control artifacts for this team are present in the source worktree. Control-plane promotion is correctly deferred until the lane finishes or review resolves those scaffold changes.',
        dirtyPaths: result.dirtyPaths
      };
    }

    return result;
  }

  private isExpectedPlanScaffoldOverlap(teamId: VicodeBuildTeamId, dirtyPaths: string[]) {
    if (dirtyPaths.length === 0) {
      return false;
    }

    const allowedPaths = new Set([
      '.vicode/control/vicode-build-teams.json',
      defaultTicketQueuePath(teamId).replace(/\\/gu, '/'),
      join('.vicode', 'control', 'build-heartbeats', `${teamId}.md`).replace(/\\/gu, '/'),
      join('.vicode', 'control', 'build-prompts', teamId, 'planner.md').replace(/\\/gu, '/'),
      join('.vicode', 'control', 'build-prompts', teamId, 'builder.md').replace(/\\/gu, '/'),
      join('.vicode', 'control', 'build-prompts', teamId, 'finisher.md').replace(/\\/gu, '/')
    ]);

    return dirtyPaths.every((path) => allowedPaths.has(path.replace(/\\/gu, '/')));
  }

  private buildTeamSnapshot(
    projectId: string,
    projectRoot: string,
    team: ConfigTeam & { worktreeRoot: string },
    laneStates: Map<string, LaneState>,
    recentEvents: VicodeBuildControllerEvent[]
  ): VicodeBuildTeamSnapshot {
    const laneContexts = new Map<VicodeBuildLaneId, LaneContext>();
    const heartbeat = this.readHeartbeatState(projectRoot, team);
    const ticketQueue = this.readTicketQueueState(projectRoot, team);
    const teamEvents = recentEvents.filter((event) => event.teamId === team.id);

    for (const laneId of Object.keys(team.lanes) as VicodeBuildLaneId[]) {
      const lane = team.lanes[laneId];
      const laneSkills = this.resolveLaneSkillBundle(projectId, lane);
      const state = laneStates.get(laneKey(team.id, laneId)) ?? {
        projectId: '',
        teamId: team.id,
        laneId,
        threadId: null,
        paused: false,
        updatedAt: new Date(0).toISOString()
      };
      const thread = this.resolveLaneThreadDetail(state.threadId);
      const outcome = deriveLaneOutcome(thread);
      laneContexts.set(laneId, {
        thread,
        outcome,
        snapshot: {
          laneId,
          label: lane.label,
          automationId: lane.automationId,
          status: deriveLaneStatus(state.paused, thread),
          paused: state.paused,
          worktreeRoot: team.worktreeRoot,
          skillIds: laneSkills.skillIds,
          skillNames: laneSkills.skillNames,
          lastRunAt: outcome.status ? this.resolveLatestRunTimestamp(thread, outcome.runId) : thread?.lastMessageAt ?? null,
          nextRunAt: null,
          threadId: thread?.id ?? null,
          threadTitle: thread?.title ?? null,
          threadStatus: thread?.status ?? null,
          lastPreview: thread?.lastPreview ?? null,
          blockedReason: null,
          recommendedAction: null,
          lastWakeAt: null,
          lastWakeReason: null,
          lastHandoffAt: null,
          lastHandoffSummary: null,
          executionConstraints: resolveLaneExecutionConstraints(laneId, lane),
          recentEvents: []
        }
      });
    }

    for (const [laneId, context] of laneContexts) {
      const laneEvents = recentEvents.filter((event) => event.teamId === team.id && event.laneId === laneId);
      const lastWake = laneEvents.find((event) => event.kind === 'manual_wake' || event.kind === 'auto_handoff') ?? null;
      const lastHandoff = laneEvents.find((event) => event.kind === 'auto_handoff' || event.kind === 'auto_handoff_skipped') ?? null;
      const queueStalled = laneEvents.find((event) => event.kind === 'queue_stalled') ?? null;
      const repeatedLoopHold = laneEvents.find(
        (event) =>
          event.kind === 'auto_handoff_skipped'
          && /repeated .* handoff|queue still has not advanced/iu.test(`${event.summary} ${event.detail ?? ''}`)
      ) ?? null;
      const runStalled = this.deriveLaneStallInfo(projectId, team.id, laneId, context, ticketQueue);
      const recoveredHandoff = this.findRecoveredDownstreamHandoff(laneId, teamEvents, laneContexts);
      const repeatedFailure = recoveredHandoff
        ? null
        : this.deriveLaneEscalationInfo(laneId, laneEvents, ticketQueue);
      context.snapshot.lastWakeAt = lastWake?.createdAt ?? null;
      context.snapshot.lastWakeReason = lastWake?.summary ?? null;
      context.snapshot.lastHandoffAt = lastHandoff?.createdAt ?? null;
      context.snapshot.lastHandoffSummary = lastHandoff?.summary ?? null;
      context.snapshot.recentEvents = (runStalled ? [runStalled.event, ...laneEvents] : laneEvents).slice(0, 3);
      context.snapshot.blockedReason = this.deriveBlockedReason(context, recoveredHandoff, ticketQueue);
      if (!context.snapshot.blockedReason && repeatedLoopHold) {
        context.snapshot.blockedReason = repeatedLoopHold.summary;
      }
      if (!context.snapshot.blockedReason && queueStalled) {
        context.snapshot.blockedReason = queueStalled.summary;
      }
      if (!context.snapshot.blockedReason && runStalled) {
        context.snapshot.blockedReason = runStalled.summary;
      }
      if (!context.snapshot.blockedReason && repeatedFailure) {
        context.snapshot.blockedReason = repeatedFailure.summary;
      }
      context.snapshot.recommendedAction = this.deriveRecommendedAction(
        laneId,
        context,
        laneContexts,
        recoveredHandoff,
        ticketQueue
      );
      if (repeatedLoopHold?.detail) {
        context.snapshot.recommendedAction = repeatedLoopHold.detail;
      }
      if (repeatedFailure) {
        context.snapshot.recommendedAction = repeatedFailure.detail;
      }
    }

    const lanes = (Object.keys(team.lanes) as VicodeBuildLaneId[]).map((laneId) => laneContexts.get(laneId)!.snapshot);
    const snapshotTickets = ticketQueue.tickets.map((ticket) => {
      const blockedByTicketIds = unresolvedDependenciesForTicket(ticket, ticketQueue.tickets);
      return {
        ...ticket,
        blockedByTicketIds,
        readyToClaim: ticket.status === 'todo' && blockedByTicketIds.length === 0,
        active: ticket.status === 'in_progress',
        ownerThreadId: laneContexts.get(ticket.ownerLane)?.snapshot.threadId ?? null
      };
    });
    const statuses = lanes.map((lane) => lane.status);
    const latestLaneActivity = lanes
      .flatMap((lane) => [lane.lastRunAt, lane.lastWakeAt, lane.lastHandoffAt].filter((value): value is string => Boolean(value)))
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
    const lastActivityAt = [latestLaneActivity, heartbeat.updatedAt, ticketQueue.updatedAt]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
    const activeTicket = snapshotTickets.find((ticket) => ticket.active) ?? null;
    const openTicketCount = snapshotTickets.filter((ticket) => ticket.status === 'todo' || ticket.status === 'in_progress').length;
    const blockedTicketCount = snapshotTickets.filter((ticket) => ticket.status === 'blocked').length;
    const dependencyHeldQueue = !activeTicket && hasDependencyBlockedOpenTickets(snapshotTickets);
    const hasLaneAttention = lanes.some((lane) => Boolean(lane.blockedReason) && (lane.status === 'running' || lane.status === 'failed' || lane.status === 'cancelled'));
    const hasLoopHold = lanes.some((lane) =>
      lane.recentEvents.some(
        (event) =>
          event.kind === 'auto_handoff_skipped'
          && /repeated .* handoff|queue still has not advanced/iu.test(`${event.summary} ${event.detail ?? ''}`)
      )
    );
    const overlapHoldEvent = recentEvents.find(
      (event) =>
        event.teamId === team.id
        && event.kind === 'auto_handoff_skipped'
        && /overlap|already-active|avoid duplicate|coordination hold/iu.test(`${event.summary ?? ''} ${event.detail ?? ''}`)
    );
    const isWaitingOnExistingSlice =
      heartbeat.status === 'paused'
      && openTicketCount > 0
      && Boolean(overlapHoldEvent);
    const hasTerminalBlockedQueue = openTicketCount === 0 && blockedTicketCount > 0;
    const teamStatus =
      statuses.every((status) => status === 'paused')
        ? 'paused'
        : isWaitingOnExistingSlice
          ? 'waiting'
        : dependencyHeldQueue
          ? 'waiting'
        : hasLoopHold
          ? 'attention'
        : hasTerminalBlockedQueue
          ? 'attention'
        : statuses.some((status) => status === 'running' || status === 'waiting_for_review')
          ? hasLaneAttention
            ? 'attention'
            : 'active'
          : statuses.some((status) => status === 'failed' || status === 'skipped' || status === 'cancelled')
            ? 'attention'
            : isHeartbeatTerminalStatus(heartbeat.status)
              ? 'idle'
              : 'idle';

      return {
        teamId: team.id,
        label: team.label,
        goal: team.goal ?? team.label,
        worktreeRoot: team.worktreeRoot,
        lastActivityAt,
        ticketQueuePath: ticketQueue.path,
        activeTicketTitle: activeTicket?.title ?? null,
        activeTicketOwnerLane: activeTicket?.ownerLane ?? null,
        ownedSliceSummary: summarizeOwnedSlice(activeTicket),
        openTicketCount,
        blockedTicketCount,
        ticketSummary: summarizeTickets(snapshotTickets),
      tickets: snapshotTickets.slice(0, 5),
      heartbeatPath: heartbeat.path,
      heartbeatStatus: heartbeat.status,
      heartbeatSummary: heartbeat.summary,
      heartbeatUpdatedAt: heartbeat.updatedAt,
      heartbeatOpenItems: heartbeat.openItems,
      status: teamStatus,
      lanes
    };
  }

  private deriveBlockedReason(
    context: LaneContext,
    recoveredHandoff: { targetLaneId: VicodeBuildLaneId; summary: string } | null,
    ticketQueue: TicketQueueState
  ) {
    if (recoveredHandoff) {
      return null;
    }
    if (context.snapshot.status === 'failed' || context.snapshot.status === 'cancelled') {
      const activeTicket = activeTicketForQueue(ticketQueue.tickets);
      const downstreamPressure = activeTicket && activeTicket.ownerLane === context.snapshot.laneId
        ? summarizeDownstreamDependencyPressure(context.snapshot.laneId, ticketQueue.tickets)
        : null;
      return [context.outcome.message ?? 'The last run ended before completing cleanly.', downstreamPressure]
        .filter((value): value is string => Boolean(value))
        .join(' ');
    }

    return null;
  }

  private deriveLaneStallInfo(
    projectId: string,
    teamId: VicodeBuildTeamId,
    laneId: VicodeBuildLaneId,
    context: LaneContext,
    ticketQueue: TicketQueueState
  ): LaneStallInfo | null {
    if (context.snapshot.status !== 'running' || !context.thread) {
      return null;
    }
    const thresholdMs = RUN_STALL_THRESHOLDS_MS[laneId];
    const activityAt = this.resolveLatestLaneActivityTimestamp(context.thread, context.outcome.runId);
    if (!activityAt) {
      return null;
    }
    const ageMs = Date.now() - new Date(activityAt).getTime();
    if (ageMs < thresholdMs) {
      return null;
    }
    const ageMinutes = Math.max(1, Math.round(ageMs / 60000));
    const activeTicket = activeTicketForQueue(ticketQueue.tickets);
    const downstreamPressure = activeTicket && activeTicket.ownerLane === laneId
      ? summarizeDownstreamDependencyPressure(laneId, ticketQueue.tickets)
      : null;
    const ticketSummary =
      activeTicket && activeTicket.ownerLane === laneId
        ? ` Active ticket: "${activeTicket.title}".`
        : '';
    const summary = `${friendlyLaneLabel(laneId)} has been running without a visible update for about ${ageMinutes} minute${ageMinutes === 1 ? '' : 's'}.${ticketSummary}`;
    const detail = [
      context.thread.lastPreview ? `Last visible preview: ${context.thread.lastPreview}` : 'Open the thread to inspect the current run output and retry the lane if it is truly stuck.',
      downstreamPressure
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ');
    return {
      ageMs,
      summary,
      detail,
      event: {
        id: `watchdog:${context.thread.id}:${laneId}`,
        projectId,
        teamId,
        laneId,
        kind: 'run_stalled',
        trigger: 'system',
        summary,
        detail,
        sourceLaneId: null,
        targetLaneId: null,
        threadId: context.thread.id,
        runId: context.outcome.runId,
        createdAt: activityAt
      }
    };
  }

  private deriveLaneEscalationInfo(
    laneId: VicodeBuildLaneId,
    laneEvents: VicodeBuildControllerEvent[],
    ticketQueue: TicketQueueState
  ): LaneEscalationInfo | null {
    const activeTicket = activeTicketForQueue(ticketQueue.tickets);
    if (!activeTicket || activeTicket.ownerLane !== laneId) {
      return null;
    }
    const disruptiveRuns = laneEvents.filter(
      (event) => event.kind === 'run_failed' || event.kind === 'run_stalled'
    );
    if (disruptiveRuns.length < 2) {
      return null;
    }
    return {
      summary: `${friendlyLaneLabel(laneId)} has already stalled or failed multiple times on the active ticket.`,
      detail: `Open the thread, split or rewrite "${activeTicket.title}", then retry ${friendlyLaneLabel(laneId).toLowerCase()} once the ticket is narrower.`
    };
  }

  private findRepeatedNonAdvancingHandoff(
    teamId: VicodeBuildTeamId,
    laneId: VicodeBuildLaneId,
    nextLaneId: VicodeBuildLaneId,
    recentEvents: VicodeBuildControllerEvent[],
    ticketQueue: TicketQueueState
  ) {
    const teamEvents = recentEvents.filter((event) => event.teamId === teamId);
    const latestSimilarHandoff = teamEvents.find(
      (event) =>
        event.kind === 'auto_handoff'
        && event.sourceLaneId === laneId
        && event.targetLaneId === nextLaneId
    );
    if (!latestSimilarHandoff) {
      return null;
    }

    const latestManualIntervention = teamEvents.find(
      (event) =>
        event.kind === 'manual_wake'
        || event.kind === 'team_resumed'
    );
    if (
      latestManualIntervention
      && new Date(latestManualIntervention.createdAt).getTime() > new Date(latestSimilarHandoff.createdAt).getTime()
    ) {
      return null;
    }

    const currentTicket =
      activeTicketForQueue(ticketQueue.tickets)
      ?? nextClaimableTicket(ticketQueue.tickets, nextLaneId)
      ?? firstDependencyHeldTicketForLane(ticketQueue.tickets, nextLaneId)
      ?? null;
    const waitingSummary = summarizeTickets(ticketQueue.tickets) ?? 'Queue still has not advanced.';

    return {
      summary: `Build Control held a repeated ${friendlyLaneLabel(laneId)} -> ${friendlyLaneLabel(nextLaneId)} handoff because the queue still has not advanced.`,
      detail: currentTicket
        ? `${waitingSummary} Rewrite, split, or block "${currentTicket.title}" with an exact unblock condition before waking ${friendlyLaneLabel(nextLaneId)} again.`
        : `${waitingSummary} Narrow the slice or block it explicitly before waking ${friendlyLaneLabel(nextLaneId)} again.`
    };
  }

  private findRecoverableHandoffDrift(
    projectId: string,
    projectRoot: string,
    team: ConfigTeam & { worktreeRoot: string },
    laneStates: Map<string, LaneState>
  ) {
    const ticketQueue = this.readTicketQueueState(projectRoot, team);
    const activeTicket = activeTicketForQueue(ticketQueue.tickets);
    if (!activeTicket) {
      return null;
    }
    const targetLaneId = activeTicket.ownerLane;
    const sourceCandidates = (Object.keys(team.lanes) as VicodeBuildLaneId[])
      .map((laneId) => {
        const state = laneStates.get(laneKey(team.id, laneId)) ?? null;
        const thread = this.resolveLaneThreadDetail(state?.threadId ?? null);
        if (!thread || !ACTIVE_THREAD_STATUSES.has(thread.status)) {
          return null;
        }
        return {
          laneId,
          state,
          thread
        };
      })
      .filter((entry): entry is { laneId: VicodeBuildLaneId; state: LaneState | null; thread: ThreadDetail } => Boolean(entry));

    if (sourceCandidates.length !== 1) {
      return null;
    }

    const source = sourceCandidates[0];
    if (source.laneId === targetLaneId) {
      return null;
    }

    const targetState = laneStates.get(laneKey(team.id, targetLaneId)) ?? null;
    const targetThread = this.resolveLaneThreadDetail(targetState?.threadId ?? null);
    if (targetThread && ACTIVE_THREAD_STATUSES.has(targetThread.status)) {
      return null;
    }

    const activityAt = this.resolveLatestLaneActivityTimestamp(source.thread, this.resolveActiveRunId(source.thread));
    if (!activityAt) {
      return null;
    }
    const thresholdMs = RUN_STALL_THRESHOLDS_MS[source.laneId];
    const ageMs = Date.now() - new Date(activityAt).getTime();
    if (ageMs < thresholdMs) {
      return null;
    }

    return {
      sourceLaneId: source.laneId,
      sourceThread: source.thread,
      targetLaneId,
      activeTicketTitle: activeTicket.title
    };
  }

  private findRecoverablePlannerStall(
    projectId: string,
    projectRoot: string,
    team: ConfigTeam & { worktreeRoot: string },
    laneStates: Map<string, LaneState>
  ) {
    const plannerState = laneStates.get(laneKey(team.id, 'planner')) ?? null;
    const plannerThread = this.resolveLaneThreadDetail(plannerState?.threadId ?? null);
    if (!plannerThread || !ACTIVE_THREAD_STATUSES.has(plannerThread.status)) {
      return null;
    }

    const ticketQueue = this.readTicketQueueState(projectRoot, team);
    const activeTicket = activeTicketForQueue(ticketQueue.tickets);
    if (!activeTicket || activeTicket.ownerLane !== 'planner') {
      return null;
    }

    const activityAt = this.resolveLatestLaneActivityTimestamp(plannerThread, this.resolveActiveRunId(plannerThread));
    if (!activityAt) {
      return null;
    }
    const ageMs = Date.now() - new Date(activityAt).getTime();
    if (ageMs < RUN_STALL_THRESHOLDS_MS.planner) {
      return null;
    }

    return {
      thread: plannerThread,
      activeTicketTitle: activeTicket.title
    };
  }

  private async sweepRecoverableHandoffs() {
    for (const project of this.db.listProjects()) {
      const context = this.loadContext(project.id);
      if (!context.ok) {
        continue;
      }
      const laneStates = new Map(
        this.db
          .listVicodeBuildLaneStates(project.id)
          .map((state) => [laneKey(state.teamId as VicodeBuildTeamId, state.laneId as VicodeBuildLaneId), state])
      );
      for (const team of context.value.teams) {
        const drift = this.findRecoverableHandoffDrift(project.id, context.value.projectRoot, team, laneStates);
        if (!drift) {
          continue;
        }

        const activeRunId = this.resolveActiveRunId(drift.sourceThread);
        if (ACTIVE_THREAD_STATUSES.has(drift.sourceThread.status)) {
          if (activeRunId) {
            await this.providers.stopRun(activeRunId);
          } else {
            this.db.updateThreadStatus(drift.sourceThread.id, 'aborted');
            this.db.appendTurn(
              drift.sourceThread.id,
              'status',
              `Build Control recovered a stalled handoff after ${friendlyLaneLabel(drift.sourceLaneId)} had already handed the queue to ${friendlyLaneLabel(drift.targetLaneId)}.`,
              { laneControlMarker: `build-controller:${team.id}:${drift.sourceLaneId}` }
            );
          }
        }

        const startedThread = await this.startLaneRun(project.id, team.id, drift.targetLaneId);
        this.recordControllerEvent({
          projectId: project.id,
          teamId: team.id,
          laneId: drift.targetLaneId,
          kind: 'auto_handoff',
          trigger: 'system',
          summary: `Recovered a stalled ${friendlyLaneLabel(drift.sourceLaneId).toLowerCase()} handoff and woke ${friendlyLaneLabel(drift.targetLaneId)}.`,
          detail: drift.activeTicketTitle,
          sourceLaneId: drift.sourceLaneId,
          targetLaneId: drift.targetLaneId,
          threadId: startedThread.id,
          runId: activeRunId
        });
      }
    }
  }

  private async sweepStalledPlannerPasses() {
    for (const project of this.db.listProjects()) {
      const context = this.loadContext(project.id);
      if (!context.ok) {
        continue;
      }
      const laneStates = new Map(
        this.db
          .listVicodeBuildLaneStates(project.id)
          .map((state) => [laneKey(state.teamId as VicodeBuildTeamId, state.laneId as VicodeBuildLaneId), state])
      );
      for (const team of context.value.teams) {
        const stalledPlanner = this.findRecoverablePlannerStall(project.id, context.value.projectRoot, team, laneStates);
        if (!stalledPlanner) {
          continue;
        }

        const activeRunId = this.resolveActiveRunId(stalledPlanner.thread);
        if (activeRunId) {
          await this.providers.stopRun(activeRunId);
        } else {
          this.db.updateThreadStatus(stalledPlanner.thread.id, 'aborted');
          this.db.appendTurn(
            stalledPlanner.thread.id,
            'status',
            'Build Control stopped a planner pass that exceeded its bounded timebox without advancing the queue.',
            { laneControlMarker: `build-controller:${team.id}:planner` }
          );
        }

        this.recordControllerEvent({
          projectId: project.id,
          teamId: team.id,
          laneId: 'planner',
          kind: 'run_failed',
          trigger: 'system',
          summary: 'Planner exceeded its bounded pass without advancing the queue.',
          detail: stalledPlanner.activeTicketTitle,
          sourceLaneId: 'planner',
          targetLaneId: null,
          threadId: stalledPlanner.thread.id,
          runId: activeRunId
        });
      }
    }
  }

  private async sweepRecoverablePartialTicketStalls() {
    for (const project of this.db.listProjects()) {
      const context = this.loadContext(project.id);
      if (!context.ok) {
        continue;
      }
      const laneStates = new Map(
        this.db
          .listVicodeBuildLaneStates(project.id)
          .map((state) => [laneKey(state.teamId as VicodeBuildTeamId, state.laneId as VicodeBuildLaneId), state])
      );
      const recentEvents = this.db
        .listVicodeBuildEvents({ projectId: project.id, limit: 60 })
        .map((controllerEvent) => toControllerEvent(controllerEvent));
      for (const team of context.value.teams) {
        const partialStall = this.findRecoverablePartialTicketStall(
          context.value.projectRoot,
          team,
          laneStates,
          recentEvents
        );
        if (!partialStall) {
          continue;
        }

        const activeRunId = this.resolveActiveRunId(partialStall.thread);
        if (activeRunId) {
          await this.providers.stopRun(activeRunId);
        } else {
          this.db.updateThreadStatus(partialStall.thread.id, 'aborted');
          this.db.appendTurn(
            partialStall.thread.id,
            'status',
            'Build Control stopped a stalled builder pass after it only partially completed the active ticket.',
            { laneControlMarker: `build-controller:${team.id}:builder` }
          );
        }

        const detail = [
          `Ticket id: ${partialStall.activeTicket.id}`,
          `Touched: ${partialStall.progress.touchedPaths.join(', ')}`,
          `Remaining: ${partialStall.progress.remainingPaths.join(', ')}`
        ].join(' | ');
        this.recordControllerEvent({
          projectId: project.id,
          teamId: team.id,
          laneId: 'builder',
          kind: 'run_stalled',
          trigger: 'system',
          summary: `Builder stalled after partial progress on "${partialStall.activeTicket.title}".`,
          detail,
          threadId: partialStall.thread.id,
          runId: activeRunId
        });

        if (partialStall.retryCount === 0) {
          const startedThread = await this.startLaneRun(project.id, team.id, 'builder', {
            recoveryNote: `The previous bounded pass updated ${partialStall.progress.touchedPaths.join(', ')} but did not finish ${partialStall.progress.remainingPaths.join(', ')}. Finish only the remaining targets or block the slice with an exact unblock condition. Do not re-audit already-touched files unless verification requires it.`
          });
          this.recordControllerEvent({
            projectId: project.id,
            teamId: team.id,
            laneId: 'builder',
            kind: 'manual_wake',
            trigger: 'system',
            summary: 'Build Control retried Builder to finish the remaining targets after a partial-progress stall.',
            detail,
            threadId: startedThread.id,
            runId: activeRunId
          });
          continue;
        }

        const queue = this.ensureTicketQueueFile(context.value.projectRoot, team);
        const nextTickets = this.upsertPlannerRecoveryTicket(
          queue.tickets,
          partialStall.activeTicket,
          partialStall.progress
        );
        this.writeTicketQueueState(context.value.projectRoot, team, nextTickets);
        const plannerThread = await this.startLaneRun(project.id, team.id, 'planner', {
          recoveryNote: `Builder stalled twice after partial progress on "${partialStall.activeTicket.title}". Touched: ${partialStall.progress.touchedPaths.join(', ')}. Remaining: ${partialStall.progress.remainingPaths.join(', ')}. Rewrite the remaining work into one narrower builder ticket or keep it blocked with an exact unblock condition.`
        });
        this.recordControllerEvent({
          projectId: project.id,
          teamId: team.id,
          laneId: 'planner',
          kind: 'auto_handoff',
          trigger: 'system',
          summary: 'Builder partial-progress stall was blocked and handed back to Planner for ticket rewrite.',
          detail,
          sourceLaneId: 'builder',
          targetLaneId: 'planner',
          threadId: plannerThread.id,
          runId: activeRunId
        });
      }
    }
  }

  private async sweepControllerRecovery() {
    await this.sweepRecoverableHandoffs();
    await this.sweepStalledPlannerPasses();
    await this.sweepRecoverablePartialTicketStalls();
  }

  private deriveRecommendedAction(
    laneId: VicodeBuildLaneId,
    context: LaneContext,
    laneContexts: Map<VicodeBuildLaneId, LaneContext>,
    recoveredHandoff: { targetLaneId: VicodeBuildLaneId; summary: string } | null,
    ticketQueue: TicketQueueState
  ) {
    if (context.snapshot.paused) {
      return 'Resume this team to allow native wakeups and downstream handoffs.';
    }

    if (recoveredHandoff) {
      const targetLane = laneContexts.get(recoveredHandoff.targetLaneId);
      if (targetLane?.snapshot.status === 'running') {
        return `${friendlyLaneLabel(recoveredHandoff.targetLaneId)} is already active on the recovered slice.`;
      }
      return recoveredHandoff.summary;
    }

    if (!context.thread) {
      return 'Wake this lane to create its dedicated thread.';
    }

    if (context.snapshot.blockedReason) {
      if (context.snapshot.status === 'running') {
        return 'Open thread to inspect the stalled run. If it is no longer making progress, stop it and wake this lane again.';
      }
      return 'Open thread, resolve the blocker, then wake this lane again.';
    }

    if (context.snapshot.status === 'running') {
      return 'Open thread to watch the active run.';
    }

    const claimableTicket = nextClaimableTicket(ticketQueue.tickets, laneId);
    if (claimableTicket) {
      return `Wake this lane to continue "${claimableTicket.title}".`;
    }

    const dependencyHeldTicket = firstDependencyHeldTicketForLane(ticketQueue.tickets, laneId);
    if (dependencyHeldTicket) {
      const blockers = unresolvedDependenciesForTicket(dependencyHeldTicket, ticketQueue.tickets)
        .map((dependencyId) => ticketQueue.tickets.find((ticket) => ticket.id === dependencyId)?.title ?? dependencyId)
        .join(', ');
      return `"${dependencyHeldTicket.title}" is waiting on ${blockers}. Keep the blocking slice moving before waking this lane again.`;
    }

    if (context.outcome.status !== 'completed') {
      return defaultRecommendedActionForIdleLane(laneId);
    }

    if ((laneId === 'planner' || laneId === 'builder' || laneId === 'finisher') && context.outcome.filesChanged <= 0) {
      if (laneId === 'builder' || laneId === 'finisher') {
        return 'No promotable slice landed. Planner should shape the next bounded slice.';
      }
      if (laneId === 'planner') {
        return 'Completed without file changes. Builder should pick up the next bounded slice only if the heartbeat changed meaningfully.';
      }
      return 'Completed without file changes. Review the heartbeat before waking another lane.';
    }

    if (laneId === 'planner' || laneId === 'builder') {
      const finisher = laneContexts.get('finisher');
      if (!finisher) {
        return 'Finisher should review the completed slice next.';
      }
      if (finisher.snapshot.status === 'running') {
        return 'Finisher is already reviewing the completed slice.';
      }
      return 'Finisher should review the completed slice next.';
    }

    const nextLaneId = deriveFinisherNextLane(context.outcome);
    if (!nextLaneId) {
      return 'No promotion landed. Review the thread before waking another lane.';
    }

    const nextLane = laneContexts.get(nextLaneId);
    const nextLabel = friendlyLaneLabel(nextLaneId);
    if (nextLane?.snapshot.status === 'running') {
      return `${nextLabel} is already active on the next slice.`;
    }
    return `${nextLabel} should take the next slice now.`;
  }

  private findRecoveredDownstreamHandoff(
    laneId: VicodeBuildLaneId,
    teamEvents: VicodeBuildControllerEvent[],
    laneContexts: Map<VicodeBuildLaneId, LaneContext>
  ) {
    const recoveryEvent = teamEvents.find(
      (event) => event.kind === 'auto_handoff' && event.sourceLaneId === laneId && Boolean(event.targetLaneId)
    );
    if (!recoveryEvent?.targetLaneId) {
      return null;
    }
    const targetLane = laneContexts.get(recoveryEvent.targetLaneId);
    if (!targetLane) {
      return null;
    }
    if (targetLane.snapshot.status !== 'running' && targetLane.snapshot.status !== 'waiting_for_review') {
      return null;
    }
    return {
      targetLaneId: recoveryEvent.targetLaneId,
      summary: recoveryEvent.summary
    };
  }

  private resolveLatestRunTimestamp(thread: ThreadDetail | null, runId: string | null) {
    if (!thread || !runId) {
      return thread?.lastMessageAt ?? null;
    }

    return [...thread.rawOutput].reverse().find((event) => event.runId === runId)?.createdAt ?? thread.lastMessageAt;
  }

  private resolveLatestLaneActivityTimestamp(thread: ThreadDetail | null, runId: string | null) {
    if (!thread) {
      return null;
    }

    const matchingRunEvents = runId
      ? thread.rawOutput.filter((event) => event.runId === runId)
      : thread.rawOutput;
    const latestRunEvent = [...matchingRunEvents]
      .reverse()
      .find((event) => typeof event.createdAt === 'string' && event.createdAt.trim().length > 0);
    const candidates = [latestRunEvent?.createdAt ?? null, thread.lastMessageAt ?? null]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());
    return candidates[0] ?? null;
  }

  private resolveActiveRunId(thread: ThreadDetail | null) {
    if (!thread || !ACTIVE_THREAD_STATUSES.has(thread.status)) {
      return null;
    }
    const terminalRunIds = new Set(
      thread.rawOutput
        .filter((event) => event.eventType === 'completed' || event.eventType === 'failed' || event.eventType === 'aborted')
        .map((event) => event.runId)
    );
    const activeEvent = [...thread.rawOutput].reverse().find((event) => !terminalRunIds.has(event.runId));
    return activeEvent?.runId ?? null;
  }

  private async startLaneRun(
    projectId: string,
    teamId: VicodeBuildTeamId,
    laneId: VicodeBuildLaneId,
    options?: { recoveryNote?: string }
  ) {
    const context = this.requireContext(projectId);
    const team = context.teams.find((entry) => entry.id === teamId);
    if (!team) {
      throw new Error(`Unknown Vicode build team: ${teamId}`);
    }
    const lane = team.lanes[laneId];
    if (!lane) {
      throw new Error(`Unknown lane ${laneId} for team ${teamId}`);
    }

    let heartbeat: HeartbeatState | null;
    let ticketQueue: TicketQueueState;
    let promptSpec: LanePromptSpec;
    let queueHelperPath: string;
    try {
      queueHelperPath = this.ensureControlSupportFiles(context.projectRoot, team.worktreeRoot);
      heartbeat = this.ensureHeartbeatFile(context.projectRoot, team);
      ticketQueue = this.claimLaneTicket(context.projectRoot, team, laneId);
      promptSpec = this.loadLanePromptSpec(projectId, context.projectRoot, team.worktreeRoot, laneId, lane);
      this.validateLaneExecutionArtifacts(context.projectRoot, team, laneId, promptSpec, heartbeat, ticketQueue, queueHelperPath);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Lane execution artifacts are missing or invalid.';
      this.recordControllerEvent({
        projectId,
        teamId,
        laneId,
        kind: 'config_mismatch',
        trigger: 'system',
        summary: `${friendlyLaneLabel(laneId)} could not start because its execution artifacts are not ready.`,
        detail
      });
      throw error;
    }
    const resolvedHeartbeat = heartbeat ?? this.readHeartbeatState(context.projectRoot, team);
    const laneState = this.db.getVicodeBuildLaneState(projectId, teamId, laneId);
    const thread = this.ensureLaneThread(projectId, context.projectRoot, team, laneId, laneState, promptSpec);

    this.db.saveVicodeBuildLaneState({
      projectId,
      teamId,
      laneId,
      threadId: thread.id,
      paused: false
    });

    if (ACTIVE_THREAD_STATUSES.has(thread.status)) {
      return thread;
    }

    this.db.appendTurn(
      thread.id,
      'status',
      `Lane run starting with ${ticketQueue.tickets.length} tracked tickets.`,
      {
        laneControlMarker: `build-controller:${team.id}:${laneId}`,
        buildQueueMarker: 'lane_run_start',
        buildQueuePath: ticketQueue.path,
        buildQueueSignature: ticketQueueSignature(ticketQueue.tickets),
        buildActiveTicketId: activeTicketForQueue(ticketQueue.tickets)?.id ?? null
      }
    );

    const lanePrompt = this.composeLanePrompt(
      promptSpec.prompt,
      team.label,
      lane.label,
      team.worktreeRoot,
      promptSpec.promptSource,
      resolvedHeartbeat,
      ticketQueue,
      promptSpec.skillNames,
      queueHelperPath,
      options?.recoveryNote ?? null
    );

    await this.providers.submitComposer({
      projectId,
      threadId: thread.id,
      prompt: lanePrompt,
      providerId: promptSpec.providerId,
      modelId: promptSpec.modelId,
      // Build-control lanes own queue mutation and handoff through normal execution.
      // Native planner mode can stall the planner lane before it advances the queue.
      runMode: 'default',
      reasoningEffort: promptSpec.reasoningEffort,
      executionPermission: promptSpec.executionPermission,
      executionConstraints: promptSpec.executionConstraints,
      skillIds: promptSpec.skillIds
    });

    return this.db.getThread(thread.id);
  }

  private ensureLaneThread(
    projectId: string,
    projectRoot: string,
    team: ConfigTeam & { worktreeRoot: string },
    laneId: VicodeBuildLaneId,
    laneState: LaneState,
    promptSpec: LanePromptSpec
  ) {
    const expectedTitle = this.buildLaneThreadTitle(team.label, friendlyLaneLabel(laneId));
    const current = this.resolveLaneThreadDetail(laneState.threadId);
    const thread =
      current && current.projectId === projectId && !current.archived
        ? current
        : this.db.createThread({
            projectId,
            title: expectedTitle,
            providerId: promptSpec.providerId,
            modelId: promptSpec.modelId,
            executionPermission: promptSpec.executionPermission
          });

    const titledThread = thread.title === expectedTitle ? thread : this.db.renameThread(thread.id, expectedTitle);
    const configuredThread = this.db.syncThreadRunConfiguration(titledThread.id, {
      providerId: promptSpec.providerId,
      modelId: promptSpec.modelId,
      executionPermission: promptSpec.executionPermission
    });

    const latestUserTurn = [...configuredThread.turns].reverse().find((turn) => turn.role === 'user');
    const expectedMarker = `build-controller:${team.id}:${laneId}`;
    if (latestUserTurn?.metadata?.laneControlMarker !== expectedMarker) {
      this.db.appendTurn(
        configuredThread.id,
        'status',
        `Lane thread bound to ${team.label} / ${friendlyLaneLabel(laneId)} at ${team.worktreeRoot}.`,
        {
          laneControlMarker: expectedMarker,
          worktreeRoot: team.worktreeRoot,
          projectRoot
        }
      );
    }

    return this.db.getThread(configuredThread.id);
  }

  private resolveLaneThreadDetail(threadId: string | null) {
    if (!threadId) {
      return null;
    }
    try {
      return this.db.getThread(threadId);
    } catch {
      return null;
    }
  }

  private buildLaneThreadTitle(teamLabel: string, laneLabel: string) {
    return `Vicode Build / ${teamLabel} / ${laneLabel}`;
  }

  private createConfigLane(
    controlId: string,
    laneId: VicodeBuildLaneId,
    promptPath: string,
    reasoningEffort: ProviderReasoningEffort,
    skillIds: string[],
    providerId: ProviderId,
    modelId: string
  ): ConfigLane {
    return {
      label: friendlyLaneLabel(laneId),
      automationId: `vicode-build-${controlId}-${laneId}`,
      promptPath: promptPath.replace(/\\/gu, '/'),
      skillIds,
      providerId,
      modelId,
      reasoningEffort,
      executionPermission: 'full_access'
    };
  }

  private buildHeartbeatTemplate(goal: string, worktreePath: string) {
    return [
      '# Build Heartbeat',
      '',
      `Goal: ${goal.trim()}`,
      `Worktree: ${worktreePath.trim() || '.'}`,
      'Status: active',
      'Summary: Build plan created. Update this summary as the lanes learn more. Use Status: done when the goal is complete, or blocked/paused when coordination should stop.',
      '',
      '## State Contract',
      '- Owner: planner',
      '- Current ticket: ticket-1',
      '- Evidence path: record concrete output files or thread refs when a ticket moves to done.',
      '- Exact unblock condition: required whenever status moves to blocked.',
      '',
      '## Active Checklist',
      '- [ ] Validate the current repository state before shaping the next slice.',
      '- [ ] Keep one bounded slice moving at a time through planner, builder, and finisher.',
      '- [ ] Record blockers and handoff notes in the active lane thread.',
      '',
      '## Blockers',
      '- None.'
    ].join('\n');
  }

  private buildTicketQueueTemplate(goal: string) {
    const now = new Date().toISOString();
    return JSON.stringify(
      {
        version: TICKET_QUEUE_VERSION,
        goal: goal.trim(),
        updatedAt: now,
        tickets: [
          {
            id: 'ticket-1',
            title: 'Validate the current repository state and identify the first bounded slice',
            status: 'in_progress',
            ownerLane: 'planner',
            summary: 'Bootstrap planner ticket. Validate the repo state and turn it into one concrete builder-ready slice before broader work begins.',
            dependencies: [],
            blockedByTicketIds: [],
            readyToClaim: false,
            active: true,
            targetPaths: [],
            acceptanceCriteria: [
              'Confirm the repository state that matters for the next slice.',
              'Shape one bounded next ticket with named target files or subsystem.'
            ],
            verificationSteps: [
              'Read the current heartbeat and queue before broad exploration.'
            ],
            refs: [],
            stopWhen: 'The next builder-ready slice can be written without guessing.',
            ownerThreadId: null,
            updatedAt: now
          }
        ]
      },
      null,
      2
    );
  }

  private buildPlannerPrompt(goal: string, worktreePath: string) {
    return [
      `Goal: ${goal.trim()}`,
      '',
      'You are the planner lane for this build plan.',
      `Target worktree: ${worktreePath}`,
      'Own the ticket queue for this build plan.',
      'Treat the heartbeat and ticket queue as the shared state contract for this build. Keep updates small, explicit, and auditable.',
      'Start with the current planner-owned ticket in the queue. Read that queue file and the current heartbeat before broader repo exploration.',
      'Do not enumerate other build-ticket files unless you find a concrete overlap that must be resolved.',
      'Mutate the queue through the run_command tool, executing python .vicode/control/update_build_ticket_queue.py so ticket state changes stay structured and valid.',
      'Treat the current planner ticket as a bounded planning pass, not an invitation to explore the whole repository.',
      'Validate only enough repository truth to shape one implementation slice: inspect the active ticket, the heartbeat, and only the files or tests needed for the next decision.',
      'Aim to finish this planner pass after one short targeted repo check. Do not keep researching once you have enough truth to split, block, or hand off.',
      'Avoid long repo-wide scans. If the next slice is still unclear after a short targeted check, split the ticket into a smaller planner follow-up instead of continuing broad research.',
      'When the current planner ticket is understood, either update it in place or create one new builder-owned todo ticket for the next bounded slice.',
        'Define or reprioritize one bounded next slice that moves the goal forward and leaves the builder with a concrete next action.',
        'Work from the current repository state instead of inventing scope.',
        'Prefer concrete implementation slices with clear verification.',
        'Keep at most 5 open tickets. Each ticket should be small, actionable, and tied to the build goal.',
        'Keep exactly one ticket in_progress at a time. Before you stop, update the queue so it reflects the active planner ticket or the next builder-ready ticket.',
        'A builder-ready ticket must name the target files or subsystem, the expected code change, and how the builder should verify it.',
      'Do not directly implement README, source, or product-doc changes from planner. If the repo needs those edits, shape a builder-owned ticket for them instead.',
      'Populate structured queue fields whenever you shape a real slice: dependencies, targetPaths, acceptanceCriteria, verificationSteps, refs, and stopWhen.',
      'Whenever a ticket becomes done or blocked, record concrete evidence, output paths, or exact unblock conditions in refs, summary, or heartbeat instead of leaving the state implicit.',
      'Use dependencies to keep follow-up tickets blocked until prerequisite work is done instead of waking the next lane early.',
        'Only hand builder files that exist under the target worktree. If the required change touches canonical source-root control artifacts that are outside the worktree, keep that work with planner or finisher instead of assigning it to builder.',
        'If you cannot name target files, expected code change, and verification after the short repo check, do not keep thinking. Split the ticket smaller or block it explicitly.',
        'If you only update planning artifacts such as the heartbeat or build prompts, make that planning pass explicit and hand the next concrete slice to the builder.',
      'If the planner ticket cannot produce a safe builder slice, mark that explicitly as blocked in the heartbeat and queue instead of looping on the same broad ticket.',
      'Do not stop at a broad summary. End with either a builder-ready slice, or a clear blocked reason in the heartbeat if progress cannot continue safely.',
      'If there is already a better immediate slice in progress, record that and do not create redundant plan churn.'
    ].join('\n');
  }

  private buildBuilderPrompt(goal: string, worktreePath: string) {
    return [
      `Goal: ${goal.trim()}`,
      '',
      'You are the builder lane for this build plan.',
      `Target worktree: ${worktreePath}`,
      'Implement exactly one in_progress or builder-owned ticket that directly advances the goal.',
      'Use the latest planner thread, heartbeat summary, and ticket queue as the contract for the current slice.',
      'Treat targetPaths, acceptanceCriteria, verificationSteps, refs, and stopWhen on the active ticket as the execution checklist for this run.',
      'Mutate the queue through the run_command tool, executing python .vicode/control/update_build_ticket_queue.py instead of hand-editing JSON.',
      'Do not create new tickets unless the planner explicitly left a split or blocker that must be written back into the queue.',
      'Exception: if this slice reveals exactly one concrete next bounded slice that cannot be safely completed inside the current ticket, you may add one follow-up todo ticket with dependencies, targetPaths, acceptanceCriteria, verificationSteps, refs, and stopWhen fully populated.',
      'When you mark work done, record the concrete evidence path, changed file, or thread reference in refs or the ticket summary so the next lane can audit it without re-deriving context.',
      'Do not edit canonical source-root control files that are not present in this worktree. If the active ticket points at files outside the worktree, stop and record that the slice must be rewritten or handed to finisher.',
      'Leave one short progress update in the thread if the slice will take longer than about a minute, so the controller can distinguish real work from a stall.',
      'Once the bounded slice is implemented, verified, and written back into the queue, stop promptly. Do not keep exploring after the current ticket is resolved.',
      'Stay within the repository conventions and verify the slice before stopping.',
      'If the slice is already landed or blocked, record that clearly in the thread.',
      'Do not drift into open-ended exploration. Finish a real implementation slice or explain the blocker precisely.'
    ].join('\n');
  }

  private buildFinisherPrompt(goal: string, worktreePath: string) {
    return [
      `Goal: ${goal.trim()}`,
      '',
      'You are the finisher lane for this build plan.',
      `Target worktree: ${worktreePath}`,
      'Resolve the current in_progress ticket in the queue before anything else.',
      'Mutate the queue through the run_command tool, executing python .vicode/control/update_build_ticket_queue.py instead of hand-editing JSON.',
      'Review the latest planner or builder slice, land what is safe, and resolve the active ticket state.',
      'Mark tickets done, blocked, or returned to planner based on the actual outcome.',
      'If a builder slice reveals a concrete follow-up that should continue automatically, add or reshape one queued ticket with explicit dependencies and evidence refs instead of leaving the next step implicit.',
      'If a ticket is blocked, write the exact unblock condition in the queue summary or refs and reflect it in the heartbeat.',
      'If there is nothing promotable, say why and stop.',
      'Prefer deterministic verification and concrete blocker reporting over broad summaries.'
    ].join('\n');
  }

  private formatWorkspaceContractGuidance(worktreeRoot: string) {
    const contractPaths = listWorkspaceContractPaths(worktreeRoot);
    if (contractPaths.length === 0) {
      return null;
    }

    return [
      `Workspace contract files: ${contractPaths.join(' | ')}`,
      'Use AGENTS.md as the operating contract. When completion or task meaning depends on project identity, user preference, or prior findings, consult SOUL.md, USER.md, MEMORY.md, and the newest daily note before broad repo work or before declaring a slice done.'
    ].join('\n');
  }

  private composeLanePrompt(
    basePrompt: string,
    teamLabel: string,
    laneLabel: string,
    worktreeRoot: string,
    promptSource: string,
    heartbeat: HeartbeatState,
    ticketQueue: TicketQueueState,
    skillNames: string[],
    queueHelperPath: string,
    recoveryNote: string | null
  ) {
    const normalizedPrompt = basePrompt
      .replace(/<repo-root>|<reverse-worktree>|<maintenance-worktree>|<openclaw-worktree>/gu, worktreeRoot);
    const strippedPrompt = normalizedPrompt
      .replace(/\s*If you finish with a real promotable[\s\S]*?Do not wake [^.]+\./gu, '')
      .trim();
    return [
      `You are running inside Vicode's native build controller as the ${laneLabel.toLowerCase()} lane for ${teamLabel}.`,
      `This lane owns a dedicated visible Vicode thread. External Codex cron automations are paused and must not be used for wakeups, timers, or scheduling.`,
      `Keep coordination visible in this thread. Leave concise handoff notes here when you finish a bounded slice, hit a blocker, or decide no action was needed.`,
      'The heartbeat and queue are the durable state contract for this build. Do not leave critical state only in prose.',
      this.formatWorkspaceContractGuidance(worktreeRoot),
      `Worktree root: ${worktreeRoot}`,
      `Prompt source: ${promptSource}`,
      heartbeat.absolutePath ? `Heartbeat file: ${heartbeat.absolutePath}` : 'Heartbeat file: none',
      heartbeat.summary ? `Heartbeat summary: ${heartbeat.summary}` : null,
      heartbeat.openItems.length > 0 ? `Heartbeat open checklist: ${heartbeat.openItems.join(' | ')}` : null,
      ticketQueue.absolutePath ? `Ticket queue: ${ticketQueue.absolutePath}` : 'Ticket queue: none',
      ticketQueue.tickets.length > 0 ? `Open tickets: ${summarizeTickets(ticketQueue.tickets) ?? 'none'}` : 'Open tickets: none',
      activeTicketForQueue(ticketQueue.tickets)
        ? `Current active ticket: ${activeTicketForQueue(ticketQueue.tickets)?.title ?? 'none'}`
        : 'Current active ticket: none',
      formatActiveTicketChecklist(activeTicketForQueue(ticketQueue.tickets)),
      `Ticket queue helper: ${queueHelperPath}`,
      ticketQueue.absolutePath
        ? `Use the run_command tool instead of hand-editing JSON. Read queue state by running: python "${queueHelperPath}" show --queue "${ticketQueue.absolutePath}" --json`
        : null,
      recoveryNote ? `Recovery guidance: ${recoveryNote}` : null,
      'Do not keep waking the same unchanged slice. If the queue, heartbeat, and active contract do not move after a bounded pass, narrow the ticket, block it with an exact unblock condition, or hand back one sharper follow-up instead of looping.',
      skillNames.length > 0 ? `Attached skills: ${skillNames.join(', ')}` : 'Attached skills: none',
      '',
      strippedPrompt
    ].filter((line): line is string => Boolean(line)).join('\n');
  }

  private loadLanePromptSpec(
    projectId: string,
    projectRoot: string,
    executionRoot: string,
    laneId: VicodeBuildLaneId,
    lane: ConfigLane
  ): LanePromptSpec {
    const promptPath = lane.promptPath
      ? this.resolveArtifactAbsolutePath(projectRoot, executionRoot, lane.promptPath)
      : null;
    const skillBundle = this.resolveLaneSkillBundle(projectId, lane);
    if (promptPath && existsSync(promptPath)) {
      const prompt = readFileSync(promptPath, 'utf-8').trim();
      if (!prompt) {
        throw new Error(`Lane prompt file is empty: ${promptPath}`);
      }
        return {
          providerId: lane.providerId ?? 'openai',
          modelId: lane.modelId ?? 'gpt-5.4',
          prompt,
          promptSource: promptPath,
          skillIds: skillBundle.skillIds,
          skillNames: skillBundle.skillNames,
          reasoningEffort: lane.reasoningEffort ?? 'medium',
          executionPermission: lane.executionPermission ?? 'full_access',
          executionConstraints: resolveLaneExecutionConstraints(laneId, lane)
        };
    }

    const automationPath = join(this.codexHome, 'automations', lane.automationId, 'automation.toml');
    if (!existsSync(automationPath)) {
      throw new Error(`Lane prompt definition not found: ${lane.automationId}`);
    }

    const source = readFileSync(automationPath, 'utf-8');
    const prompt = extractTomlString(source, 'prompt');
    const modelId = extractTomlString(source, 'model');
    const reasoningEffort = (extractTomlString(source, 'reasoning_effort') as ProviderReasoningEffort | null) ?? 'medium';

    if (!prompt || !modelId) {
      throw new Error(`Lane prompt definition is incomplete: ${lane.automationId}`);
    }

    return {
      providerId: lane.providerId ?? 'openai',
      modelId: lane.modelId ?? modelId,
      prompt,
      promptSource: automationPath,
      skillIds: skillBundle.skillIds,
      skillNames: skillBundle.skillNames,
      reasoningEffort: lane.reasoningEffort ?? reasoningEffort,
      executionPermission: lane.executionPermission ?? 'full_access',
      executionConstraints: resolveLaneExecutionConstraints(laneId, lane)
    };
  }

  private listEligibleBuildSkills(projectId: string, providerId: ProviderId) {
    return this.db
      .listSkills()
      .filter(
        (skill) =>
          skill.enabled
          && skill.providerTargets.includes(providerId)
          && (skill.scope === 'global' || skill.projectId === projectId)
      );
  }

  private resolveLaneSkillBundle(projectId: string, lane: ConfigLane) {
    const providerId = lane.providerId ?? 'openai';
    const eligibleSkills = this.listEligibleBuildSkills(projectId, providerId);
    const eligibleById = new Map(eligibleSkills.map((skill) => [skill.id, skill]));
    const requestedSkillIds = (lane.skillIds ?? []).filter((skillId) => eligibleById.has(skillId));
    const skillIds = requestedSkillIds.length > 0 ? requestedSkillIds : [];
    return {
      skillIds,
      skillNames: skillIds.map((skillId) => eligibleById.get(skillId)?.name ?? skillId)
    };
  }

  private ensureHeartbeatFile(projectRoot: string, team: ConfigTeam & { worktreeRoot: string }) {
    const relativePath = team.heartbeatPath?.trim();
    if (!relativePath) {
      return null;
    }
    const absolutePath = this.resolveArtifactAbsolutePath(projectRoot, team.worktreeRoot, relativePath);
    if (!existsSync(absolutePath)) {
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, this.buildHeartbeatTemplate(team.goal ?? team.label, team.worktreePath), 'utf-8');
    }
    return this.readHeartbeatState(projectRoot, team);
  }

  private ensureTicketQueueFile(projectRoot: string, team: ConfigTeam & { worktreeRoot: string }) {
    const relativePath = defaultTicketQueuePath(team.id);
    const absolutePath = this.resolveArtifactAbsolutePath(projectRoot, team.worktreeRoot, relativePath);
    if (!existsSync(absolutePath)) {
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, this.buildTicketQueueTemplate(team.goal ?? team.label), 'utf-8');
    }
    return this.readTicketQueueState(projectRoot, team);
  }

  private writeTicketQueueState(projectRoot: string, team: ConfigTeam & { worktreeRoot: string }, tickets: VicodeBuildTicketSnapshot[]) {
    const relativePath = defaultTicketQueuePath(team.id);
    const absolutePath = this.resolveArtifactAbsolutePath(projectRoot, team.worktreeRoot, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(
      absolutePath,
      JSON.stringify(
        {
          version: TICKET_QUEUE_VERSION,
          updatedAt: new Date().toISOString(),
          tickets
        },
        null,
        2
      ),
      'utf-8'
    );
    return this.readTicketQueueState(projectRoot, team);
  }

  private claimLaneTicket(projectRoot: string, team: ConfigTeam & { worktreeRoot: string }, laneId: VicodeBuildLaneId) {
    const queue = this.ensureTicketQueueFile(projectRoot, team);
    const activeTicket = activeTicketForQueue(queue.tickets);
    if (activeTicket || laneId === 'finisher') {
      return queue;
    }

    const nextLaneTicket = nextClaimableTicket(queue.tickets, laneId);
    if (!nextLaneTicket) {
      return queue;
    }

    const updatedAt = new Date().toISOString();
    const nextTickets = queue.tickets.map((ticket) =>
      ticket.id === nextLaneTicket.id
        ? {
            ...ticket,
            status: 'in_progress' as const,
            updatedAt
          }
        : ticket
    );
    return this.writeTicketQueueState(projectRoot, team, nextTickets);
  }

  private readLatestLaneQueueRunMarker(thread: ThreadDetail | null, teamId: VicodeBuildTeamId, laneId: VicodeBuildLaneId): LaneQueueRunMarker {
    if (!thread) {
      return { signature: null, activeTicketId: null, startedAt: null };
    }

    const marker = `build-controller:${teamId}:${laneId}`;
    const turn = [...thread.turns].reverse().find(
      (entry) =>
        entry.role === 'status'
        && entry.metadata?.laneControlMarker === marker
        && entry.metadata?.buildQueueMarker === 'lane_run_start'
    );

    if (!turn?.metadata) {
      return { signature: null, activeTicketId: null, startedAt: null };
    }

    return {
      signature: typeof turn.metadata.buildQueueSignature === 'string' ? turn.metadata.buildQueueSignature : null,
      activeTicketId: typeof turn.metadata.buildActiveTicketId === 'string' ? turn.metadata.buildActiveTicketId : null,
      startedAt: turn.createdAt
    };
  }

  private deriveTicketProgressSince(
    projectRoot: string,
    team: ConfigTeam & { worktreeRoot: string },
    ticket: VicodeBuildTicketSnapshot,
    startedAt: string | null
  ): TicketProgressState {
    if (!startedAt || ticket.targetPaths.length === 0) {
      return { touchedPaths: [], remainingPaths: ticket.targetPaths.slice() };
    }

    const startedAtMs = new Date(startedAt).getTime();
    const touchedPaths: string[] = [];
    const remainingPaths: string[] = [];

    for (const targetPath of ticket.targetPaths) {
      const absolutePath = this.resolveArtifactAbsolutePath(projectRoot, team.worktreeRoot, targetPath);
      if (existsSync(absolutePath) && statSync(absolutePath).mtime.getTime() >= startedAtMs) {
        touchedPaths.push(targetPath);
      } else {
        remainingPaths.push(targetPath);
      }
    }

    return { touchedPaths, remainingPaths };
  }

  private countPartialProgressRecoveryAttempts(
    teamId: VicodeBuildTeamId,
    laneId: VicodeBuildLaneId,
    ticketId: string,
    recentEvents: VicodeBuildControllerEvent[]
  ) {
    return recentEvents.filter(
      (event) =>
        event.teamId === teamId
        && event.laneId === laneId
        && event.kind === 'run_stalled'
        && event.summary.includes('partial progress')
        && `${event.detail ?? ''}`.includes(`Ticket id: ${ticketId}`)
    ).length;
  }

  private findRecoverablePartialTicketStall(
    projectRoot: string,
    team: ConfigTeam & { worktreeRoot: string },
    laneStates: Map<string, LaneState>,
    recentEvents: VicodeBuildControllerEvent[]
  ): PartialTicketStallInfo | null {
    const laneId: VicodeBuildLaneId = 'builder';
    const laneState = laneStates.get(laneKey(team.id, laneId)) ?? null;
    const thread = this.resolveLaneThreadDetail(laneState?.threadId ?? null);
    if (!thread || !ACTIVE_THREAD_STATUSES.has(thread.status)) {
      return null;
    }

    const ticketQueue = this.readTicketQueueState(projectRoot, team);
    const activeTicket = activeTicketForQueue(ticketQueue.tickets);
    if (!activeTicket || activeTicket.ownerLane !== laneId || activeTicket.targetPaths.length === 0) {
      return null;
    }

    const activityAt = this.resolveLatestLaneActivityTimestamp(thread, this.resolveActiveRunId(thread));
    if (!activityAt) {
      return null;
    }
    const ageMs = Date.now() - new Date(activityAt).getTime();
    if (ageMs < RUN_STALL_THRESHOLDS_MS[laneId]) {
      return null;
    }

    const queueMarker = this.readLatestLaneQueueRunMarker(thread, team.id, laneId);
    if (queueMarker.activeTicketId !== activeTicket.id) {
      return null;
    }

    const progress = this.deriveTicketProgressSince(projectRoot, team, activeTicket, queueMarker.startedAt);
    if (progress.touchedPaths.length === 0 || progress.remainingPaths.length === 0) {
      return null;
    }

    return {
      thread,
      activeTicket,
      progress,
      retryCount: this.countPartialProgressRecoveryAttempts(team.id, laneId, activeTicket.id, recentEvents)
    };
  }

  private upsertPlannerRecoveryTicket(
    tickets: VicodeBuildTicketSnapshot[],
    activeTicket: VicodeBuildTicketSnapshot,
    progress: TicketProgressState
  ) {
    const now = new Date().toISOString();
    const recoveryId = `${activeTicket.id}-planner-recovery`;
    const recoveryTicket: VicodeBuildTicketSnapshot = {
      id: recoveryId,
      title: `Rewrite stalled slice for ${activeTicket.title}`,
      status: 'in_progress',
      ownerLane: 'planner',
      summary:
        'Builder stalled after partial progress. Decide whether the remaining targets can be narrowed into one sharper builder ticket or should stay blocked with an exact unblock condition.',
      dependencies: [],
      blockedByTicketIds: [],
      readyToClaim: false,
      active: true,
      targetPaths: progress.remainingPaths.slice(),
      acceptanceCriteria: [
        'Rewrite the remaining work into one narrower builder-owned slice or keep it blocked with an exact unblock condition.',
        'Record the partial progress already landed so downstream lanes do not re-derive it.'
      ],
      verificationSteps: [
        'Read the current heartbeat, queue, and the touched target files before rewriting the remaining slice.'
      ],
      refs: [
        `Touched before stall: ${progress.touchedPaths.join(', ')}`,
        `Remaining targets: ${progress.remainingPaths.join(', ')}`
      ],
      stopWhen:
        'The remaining work is either handed back as one narrower builder ticket or explicitly blocked with an exact unblock condition.',
      ownerThreadId: null,
      updatedAt: now
    };

    const nextTickets = tickets.map((ticket) => {
      if (ticket.id === activeTicket.id) {
        return {
          ...ticket,
          status: 'blocked' as const,
          summary: `Builder stalled after partial progress. Touched: ${progress.touchedPaths.join(', ')}. Remaining: ${progress.remainingPaths.join(', ')}.`,
          refs: Array.from(
            new Set([
              ...ticket.refs,
              `Touched before stall: ${progress.touchedPaths.join(', ')}`,
              `Remaining targets: ${progress.remainingPaths.join(', ')}`
            ])
          ),
          updatedAt: now,
          active: false
        };
      }
      if (ticket.id === recoveryId) {
        return {
          ...recoveryTicket,
          refs: Array.from(new Set([...ticket.refs, ...recoveryTicket.refs])),
          updatedAt: now
        };
      }
      if (ticket.status === 'in_progress' && ticket.id !== activeTicket.id) {
        return { ...ticket, status: 'todo' as const, updatedAt: now, active: false };
      }
      return ticket;
    });

    if (!nextTickets.some((ticket) => ticket.id === recoveryId)) {
      nextTickets.push(recoveryTicket);
    }

    return nextTickets;
  }

  private readHeartbeatState(projectRoot: string, team: ConfigTeam & { worktreeRoot: string }): HeartbeatState {
    const relativePath = team.heartbeatPath?.trim();
    if (!relativePath) {
      return {
        path: null,
        absolutePath: null,
        status: null,
        summary: null,
        updatedAt: null,
        openItems: []
      };
    }

    const absolutePath = this.resolveArtifactAbsolutePath(projectRoot, team.worktreeRoot, relativePath);
    if (!existsSync(absolutePath)) {
      return {
        path: relativePath,
        absolutePath,
        status: 'missing',
        summary: 'Heartbeat file is missing.',
        updatedAt: null,
        openItems: []
      };
    }

    const content = readFileSync(absolutePath, 'utf-8');
    const status = content.match(/(?:^|\n)Status:\s*(.+)$/imu)?.[1]?.trim() ?? null;
    const summary = content.match(/(?:^|\n)Summary:\s*(.+)$/imu)?.[1]?.trim() ?? null;
    const openItems = [...content.matchAll(/^\s*-\s*\[\s\]\s+(.+)$/gmu)].map((match) => match[1]?.trim() ?? '').filter(Boolean);
    return {
      path: relativePath.replace(/\\/gu, '/'),
      absolutePath,
      status,
      summary,
      updatedAt: statSync(absolutePath).mtime.toISOString(),
      openItems
    };
  }

  private readTicketQueueState(projectRoot: string, team: ConfigTeam & { worktreeRoot: string }): TicketQueueState {
    const relativePath = defaultTicketQueuePath(team.id);
    const absolutePath = this.resolveArtifactAbsolutePath(projectRoot, team.worktreeRoot, relativePath);
    if (!existsSync(absolutePath)) {
      return {
        path: relativePath,
        absolutePath,
        updatedAt: null,
        tickets: []
      };
    }

    try {
      const parsed = JSON.parse(readFileSync(absolutePath, 'utf-8')) as {
        updatedAt?: string;
        tickets?: Array<{
          id?: string;
          title?: string;
          status?: string;
          ownerLane?: string;
          summary?: string | null;
          dependencies?: unknown;
          targetPaths?: unknown;
          acceptanceCriteria?: unknown;
          verificationSteps?: unknown;
          refs?: unknown;
          stopWhen?: string | null;
          updatedAt?: string | null;
        }>;
      };
      const tickets = (parsed.tickets ?? [])
        .map((ticket, index): VicodeBuildTicketSnapshot | null => {
          const title = ticket.title?.trim();
          const status = ticket.status?.trim();
          const ownerLane = ticket.ownerLane?.trim();
          if (!title || !status || !ownerLane) {
            return null;
          }
          if (!['todo', 'in_progress', 'done', 'blocked'].includes(status)) {
            return null;
          }
          if (!['planner', 'builder', 'finisher'].includes(ownerLane)) {
            return null;
          }
          return {
            id: ticket.id?.trim() || `ticket-${index + 1}`,
            title,
            status: status as VicodeBuildTicketSnapshot['status'],
            ownerLane: ownerLane as VicodeBuildLaneId,
            summary: ticket.summary?.trim() ?? null,
            dependencies: Array.isArray(ticket.dependencies)
              ? ticket.dependencies
                  .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                  .map((value) => value.trim())
              : [],
            blockedByTicketIds: [],
            readyToClaim: false,
            active: status === 'in_progress',
            targetPaths: Array.isArray(ticket.targetPaths)
              ? ticket.targetPaths
                  .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                  .map((value) => value.trim())
              : [],
            acceptanceCriteria: Array.isArray(ticket.acceptanceCriteria)
              ? ticket.acceptanceCriteria
                  .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                  .map((value) => value.trim())
              : [],
            verificationSteps: Array.isArray(ticket.verificationSteps)
              ? ticket.verificationSteps
                  .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                  .map((value) => value.trim())
              : [],
            refs: Array.isArray(ticket.refs)
              ? ticket.refs
                  .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                  .map((value) => value.trim())
              : [],
            stopWhen: ticket.stopWhen?.trim() ?? null,
            ownerThreadId: null,
            updatedAt: ticket.updatedAt?.trim() ?? null
          };
        })
        .filter((ticket): ticket is VicodeBuildTicketSnapshot => Boolean(ticket));
      return {
        path: relativePath,
        absolutePath,
        updatedAt: parsed.updatedAt?.trim() ?? statSync(absolutePath).mtime.toISOString(),
        tickets
      };
    } catch {
      return {
        path: relativePath,
        absolutePath,
        updatedAt: statSync(absolutePath).mtime.toISOString(),
        tickets: []
      };
    }
  }

  private resolveArtifactAbsolutePath(projectRoot: string, executionRoot: string, relativePath: string) {
    const normalizedPath = relativePath.replace(/\\/gu, '/');
    const executionPath = resolve(executionRoot, normalizedPath);
    if (existsSync(executionPath)) {
      return executionPath;
    }
    const projectPath = resolve(projectRoot, normalizedPath);
    if (existsSync(projectPath)) {
      return projectPath;
    }
    return executionPath;
  }

  private ensureControlSupportFiles(projectRoot: string, executionRoot: string) {
    for (const relativePath of CONTROL_SUPPORT_FILE_PATHS) {
      const targetPath = resolve(executionRoot, relativePath);
      if (existsSync(targetPath)) {
        continue;
      }

      const sourceCandidates = [resolve(projectRoot, relativePath), resolve(process.cwd(), relativePath)];
      const sourcePath = sourceCandidates.find((candidate) => existsSync(candidate)) ?? null;
      if (!sourcePath) {
        throw new Error(`Build control support file is missing at ${targetPath}.`);
      }
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, readFileSync(sourcePath, 'utf-8'), 'utf-8');
    }

    return resolve(executionRoot, BUILD_TICKET_QUEUE_HELPER_PATH);
  }

  private validateLaneExecutionArtifacts(
    projectRoot: string,
    team: ConfigTeam & { worktreeRoot: string },
    laneId: VicodeBuildLaneId,
    promptSpec: LanePromptSpec,
    heartbeat: HeartbeatState | null,
    ticketQueue: TicketQueueState,
    queueHelperPath: string
  ) {
    const requiredPaths = [
      promptSpec.promptSource,
      queueHelperPath,
      heartbeat?.absolutePath ?? null,
      ticketQueue.absolutePath
    ].filter((value): value is string => Boolean(value));
    const missingPaths = requiredPaths.filter((value) => !existsSync(value));
    if (missingPaths.length > 0) {
      throw new Error(
        `${friendlyLaneLabel(laneId)} is missing execution artifacts for ${team.worktreeRoot}: ${missingPaths.join(', ')}`
      );
    }

    const allowedRoots = [resolve(team.worktreeRoot), resolve(projectRoot), resolve(this.codexHome, 'automations')];
    const mismatchedPaths = requiredPaths.filter(
      (value) => !allowedRoots.some((rootPath) => resolve(value).startsWith(rootPath))
    );
    if (mismatchedPaths.length > 0) {
      throw new Error(
        `${friendlyLaneLabel(laneId)} resolved execution artifacts outside the project or worktree roots: ${mismatchedPaths.join(', ')}`
      );
    }

    if (laneId === 'builder') {
      const scopeIssue = this.validateBuilderTicketScope(projectRoot, team.worktreeRoot, ticketQueue);
      if (scopeIssue) {
        throw new Error(
          `Builder cannot safely start because the active ticket points at source-root files outside the worktree: ${scopeIssue.sourceRootOnlyPaths.join(', ')}. Rewrite the slice for worktree-local files or hand it to Finisher.`
        );
      }
    }
  }

  private validateBuilderTicketScope(projectRoot: string, worktreeRoot: string, ticketQueue: TicketQueueState): BuilderTicketScopeIssue | null {
    const activeTicket = activeTicketForQueue(ticketQueue.tickets);
    if (!activeTicket || activeTicket.ownerLane !== 'builder') {
      return null;
    }

    const referencedPaths = activeTicket.targetPaths.length > 0
      ? activeTicket.targetPaths
      : [
          ...extractLikelyRepoPaths(activeTicket.title),
          ...extractLikelyRepoPaths(activeTicket.summary)
        ];
    if (referencedPaths.length === 0) {
      return null;
    }

    const sourceRootOnlyPaths = referencedPaths.filter((relativePath) => {
      const normalizedPath = relativePath.replace(/\\/gu, '/').replace(/^\.\//u, '');
      const worktreePath = resolve(worktreeRoot, normalizedPath);
      if (existsSync(worktreePath)) {
        return false;
      }
      const projectPath = resolve(projectRoot, normalizedPath);
      return existsSync(projectPath);
    });

    if (sourceRootOnlyPaths.length === 0) {
      return null;
    }

    return {
      sourceRootOnlyPaths: [...new Set(sourceRootOnlyPaths)]
    };
  }

  private findOverlappingPlan(
    projectId: string,
    projectRoot: string,
    goal: string,
    worktreePath: string
  ): VicodeBuildTeamSnapshot | null {
    const context = this.loadContext(projectId);
    if (!context.ok) {
      return null;
    }
    const laneStates = new Map(
      this.db
        .listVicodeBuildLaneStates(projectId)
        .map((state) => [laneKey(state.teamId as VicodeBuildTeamId, state.laneId as VicodeBuildLaneId), state])
    );
    const recentEvents = this.db
      .listVicodeBuildEvents({ projectId, limit: 40 })
      .map(toControllerEvent);
    const candidateRoot = resolve(projectRoot, worktreePath);

    for (const team of context.value.teams) {
      if (!isGeneratedBuildPlan(team)) {
        continue;
      }
      const snapshot = this.buildTeamSnapshot(projectId, projectRoot, team, laneStates, recentEvents);
      const overlapScore = computeGoalOverlapScore(snapshot.goal, goal);
      const ownsWork =
        snapshot.openTicketCount > 0
        || Boolean(snapshot.heartbeatStatus && !isHeartbeatTerminalStatus(snapshot.heartbeatStatus));
      const sameExecutionRoot = resolve(snapshot.worktreeRoot) === candidateRoot;
      if (!ownsWork) {
        continue;
      }
      if (sameExecutionRoot || overlapScore >= 0.55) {
        return snapshot;
      }
    }
    return null;
  }

  private requireContext(projectId: string): LoadedContext {
    const loaded = this.loadContext(projectId);
    if (!loaded.ok) {
      throw new Error(loaded.note ?? 'Vicode build control is not available for this project.');
    }
    return loaded.value;
  }

  private loadContext(projectId: string | null):
    | { ok: true; value: LoadedContext }
    | { ok: false; note: string; projectRoot: string | null; configPath: string | null } {
    if (!projectId) {
      return { ok: false, note: 'Select the Vicode workspace to enable build control.', projectRoot: null, configPath: null };
    }
    const project = this.db.getProject(projectId);
    if (!project.folderPath) {
      return { ok: false, note: 'The selected project does not have a workspace folder.', projectRoot: null, configPath: null };
    }
    const configPath = resolve(project.folderPath, CONFIG_RELATIVE_PATH);
    if (!existsSync(configPath)) {
      return {
        ok: false,
        note: 'This workspace does not expose a Vicode build controller config yet.',
        projectRoot: project.folderPath,
        configPath
      };
    }
    const teams = this.readConfigTeams(configPath).map((team) => ({
      ...team,
      worktreeRoot: resolve(project.folderPath, team.worktreePath)
    }));
    return {
      ok: true,
      value: {
        projectId: project.id,
        projectRoot: project.folderPath,
        configPath,
        teams
      }
    };
  }

  private readConfigTeams(configPath: string) {
    if (!existsSync(configPath)) {
      return [] as ConfigTeam[];
    }

    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      teams?: ConfigTeam[];
      controls?: ConfigTeam[];
    };

    return (parsed.controls ?? parsed.teams ?? []).map((team) => ({
      ...team,
      goal: team.goal ?? team.label,
      heartbeatPath: team.heartbeatPath?.trim() ? team.heartbeatPath.replace(/\\/gu, '/') : null,
      worktreePath: team.worktreePath || '.',
      lanes: Object.fromEntries(
        Object.entries(team.lanes).map(([laneId, lane]) => [
          laneId,
          {
            ...lane,
            skillIds: Array.isArray(lane.skillIds) ? lane.skillIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0) : []
          }
        ])
      ) as ConfigTeam['lanes']
    }));
  }

  private async handleProviderEvent(event: AppEvent) {
    if (
      event.type !== 'run.status'
      || (event.status !== 'completed' && event.status !== 'failed' && event.status !== 'aborted')
    ) {
      return;
    }

    const laneState = this.db.findVicodeBuildLaneByThread(event.threadId);
    if (!laneState || laneState.paused) {
      return;
    }

    const thread = this.resolveLaneThreadDetail(event.threadId);
    const outcome = deriveLaneOutcome(thread);
    const laneId = laneState.laneId as VicodeBuildLaneId;
    const teamId = laneState.teamId as VicodeBuildTeamId;

    if (event.status === 'failed' || event.status === 'aborted' || outcome.status === 'failed' || outcome.status === 'aborted') {
      this.recordControllerEvent({
        projectId: laneState.projectId,
        teamId,
        laneId,
        kind: 'run_failed',
        trigger: 'system',
        summary: `${friendlyLaneLabel(laneId)} ended without a clean completion.`,
        detail: event.message ?? outcome.message,
        threadId: event.threadId,
        runId: event.runId
      });
      return;
    }

    if (outcome.status !== 'completed') {
      return;
    }

    this.recordControllerEvent({
      projectId: laneState.projectId,
      teamId,
      laneId,
      kind: 'run_completed',
      trigger: 'system',
      summary:
        outcome.filesChanged > 0
          ? `${friendlyLaneLabel(laneId)} completed with ${outcome.filesChanged} changed file${outcome.filesChanged === 1 ? '' : 's'}.`
          : `${friendlyLaneLabel(laneId)} completed without promotable changes.`,
      detail: outcome.message,
      threadId: event.threadId,
      runId: event.runId
    });

    let nextLaneId: VicodeBuildLaneId | null = null;
    let heartbeat: HeartbeatState | null = null;
    let heartbeatStatus: string | null = null;
    let ticketQueue: TicketQueueState | null = null;
    let queueChanged: boolean | null = null;
    let recentEvents: VicodeBuildControllerEvent[] = [];
    try {
      const context = this.requireContext(laneState.projectId);
      const team = context.teams.find((entry) => entry.id === teamId) ?? null;
      heartbeat = team ? this.readHeartbeatState(context.projectRoot, team) : null;
      heartbeatStatus = heartbeat?.status?.trim().toLowerCase() ?? null;
      ticketQueue = team ? this.readTicketQueueState(context.projectRoot, team) : null;
      recentEvents = this.db
        .listVicodeBuildEvents({ projectId: laneState.projectId, teamId, limit: 40 })
        .map((controllerEvent) => toControllerEvent(controllerEvent));
      const queueMarker = this.readLatestLaneQueueRunMarker(thread, teamId, laneId);
      if (ticketQueue && queueMarker.signature) {
        queueChanged = queueMarker.signature !== ticketQueueSignature(ticketQueue.tickets);
      }
    } catch {
      // If build-control context cannot be reloaded here, keep the handoff behavior unchanged.
    }

    if (queueChanged === false) {
      const currentActiveTicket = ticketQueue ? activeTicketForQueue(ticketQueue.tickets) : null;
      const downstreamPressure =
        ticketQueue && currentActiveTicket && currentActiveTicket.ownerLane === laneId
          ? summarizeDownstreamDependencyPressure(laneId, ticketQueue.tickets)
          : null;
      this.recordControllerEvent({
        projectId: laneState.projectId,
        teamId,
        laneId,
        kind: 'queue_stalled',
        trigger: 'system',
        summary:
          currentActiveTicket && currentActiveTicket.ownerLane === laneId
            ? `${friendlyLaneLabel(laneId)} completed without advancing "${currentActiveTicket.title}".`
            : `${friendlyLaneLabel(laneId)} completed without advancing the ticket queue.`,
        detail: [downstreamPressure, ticketQueue?.path ?? null].filter((value): value is string => Boolean(value)).join(' ') || null,
        threadId: event.threadId,
        runId: event.runId
      });
    }

    if (laneId === 'planner' && queueChanged === false && plannerChangedNonPlanningArtifacts(outcome)) {
      this.recordControllerEvent({
        projectId: laneState.projectId,
        teamId,
        laneId,
        kind: 'auto_handoff_skipped',
        trigger: 'automatic',
        summary: 'Planner changed non-control files without advancing the ticket queue.',
        detail: outcome.changedPaths.join(' | '),
        sourceLaneId: laneId,
        targetLaneId: null,
        threadId: event.threadId,
        runId: event.runId
      });
      return;
    }

    nextLaneId = ticketQueue ? nextLaneFromTicketQueue(ticketQueue.tickets, laneId) : null;
    if (!nextLaneId && laneId === 'finisher' && ticketQueue && hasBlockedTerminalQueue(ticketQueue.tickets)) {
      this.recordControllerEvent({
        projectId: laneState.projectId,
        teamId,
        laneId,
        kind: 'auto_handoff_skipped',
        trigger: 'automatic',
        summary: 'Finisher completed, but only blocked tickets remain in the queue.',
        detail: summarizeTickets(ticketQueue.tickets) ?? ticketQueue.path ?? null,
        sourceLaneId: laneId,
        targetLaneId: null,
        threadId: event.threadId,
        runId: event.runId
      });
      return;
    }
    if (!nextLaneId && laneId === 'finisher' && ticketQueue && hasResolvedTerminalQueue(ticketQueue.tickets)) {
      this.recordControllerEvent({
        projectId: laneState.projectId,
        teamId,
        laneId,
        kind: 'auto_handoff_skipped',
        trigger: 'automatic',
        summary: 'Finisher completed and the queue is fully resolved.',
        detail: summarizeTickets(ticketQueue.tickets) ?? ticketQueue.path ?? null,
        sourceLaneId: laneId,
        targetLaneId: null,
        threadId: event.threadId,
        runId: event.runId
      });
      return;
    }
    if (!nextLaneId && queueChanged === false && heartbeatStatus === 'active') {
      nextLaneId = 'planner';
    } else if (!nextLaneId && outcome.filesChanged <= 0) {
      nextLaneId = deriveNoopContinuationLane(laneId, heartbeatStatus);
    } else if (!nextLaneId && laneId === 'planner') {
      nextLaneId = derivePlannerNextLane(outcome);
    } else if (!nextLaneId && laneId === 'builder') {
      nextLaneId = 'finisher';
    } else if (!nextLaneId && laneId === 'finisher') {
      nextLaneId = deriveFinisherNextLane(outcome);
    }

    if (!nextLaneId) {
      return;
    }

    if (ticketQueue) {
      const repeatedLoop = this.findRepeatedNonAdvancingHandoff(
        teamId,
        laneId,
        nextLaneId,
        recentEvents,
        ticketQueue
      );
      if (repeatedLoop) {
        this.recordControllerEvent({
          projectId: laneState.projectId,
          teamId,
          laneId,
          kind: 'auto_handoff_skipped',
          trigger: 'automatic',
          summary: repeatedLoop.summary,
          detail: repeatedLoop.detail,
          sourceLaneId: laneId,
          targetLaneId: nextLaneId,
          threadId: event.threadId,
          runId: event.runId
        });
        return;
      }
    }

    if (heartbeatStatus === 'blocked' || heartbeatStatus === 'paused' || isHeartbeatTerminalStatus(heartbeatStatus)) {
      this.recordControllerEvent({
        projectId: laneState.projectId,
        teamId,
        laneId: nextLaneId,
        kind: 'auto_handoff_skipped',
        trigger: 'automatic',
        summary: `${friendlyLaneLabel(laneId)} completed, but the plan heartbeat is ${heartbeatStatus}.`,
        detail: heartbeat?.summary ?? heartbeat?.path ?? null,
        sourceLaneId: laneId,
        targetLaneId: nextLaneId,
        threadId: event.threadId,
        runId: event.runId
      });
      return;
    }

    const nextLaneState = this.db.getVicodeBuildLaneState(laneState.projectId, teamId, nextLaneId);
    if (nextLaneState.paused) {
      this.recordControllerEvent({
        projectId: laneState.projectId,
        teamId,
        laneId: nextLaneId,
        kind: 'auto_handoff_skipped',
        trigger: 'automatic',
        summary: `${friendlyLaneLabel(laneId)} completed, but ${friendlyLaneLabel(nextLaneId)} is paused.`,
        sourceLaneId: laneId,
        targetLaneId: nextLaneId,
        threadId: event.threadId,
        runId: event.runId
      });
      return;
    }

    const nextThread = this.resolveLaneThreadDetail(nextLaneState.threadId);
    if (nextThread && ACTIVE_THREAD_STATUSES.has(nextThread.status)) {
      this.recordControllerEvent({
        projectId: laneState.projectId,
        teamId,
        laneId: nextLaneId,
        kind: 'auto_handoff_skipped',
        trigger: 'automatic',
        summary: `${friendlyLaneLabel(laneId)} completed, but ${friendlyLaneLabel(nextLaneId)} is already active.`,
        sourceLaneId: laneId,
        targetLaneId: nextLaneId,
        threadId: nextThread.id,
        runId: event.runId
      });
      return;
    }

    try {
      const startedThread = await this.startLaneRun(
        laneState.projectId,
        teamId,
        nextLaneId
      );
      this.recordControllerEvent({
        projectId: laneState.projectId,
        teamId,
        laneId: nextLaneId,
        kind: 'auto_handoff',
        trigger: 'automatic',
        summary: `${friendlyLaneLabel(laneId)} completed and woke ${friendlyLaneLabel(nextLaneId)}.`,
        sourceLaneId: laneId,
        targetLaneId: nextLaneId,
        threadId: startedThread.id,
        runId: event.runId
      });
    } catch {
      this.recordControllerEvent({
        projectId: laneState.projectId,
        teamId,
        laneId: nextLaneId,
        kind: 'auto_handoff_skipped',
        trigger: 'automatic',
        summary: `${friendlyLaneLabel(laneId)} completed, but ${friendlyLaneLabel(nextLaneId)} could not be started.`,
        sourceLaneId: laneId,
        targetLaneId: nextLaneId,
        runId: event.runId
      });
    }
  }

  private recordControllerEvent(input: {
    projectId: string;
    teamId: VicodeBuildTeamId;
    laneId: VicodeBuildLaneId;
    kind: VicodeBuildControllerEventKind;
    trigger: VicodeBuildControllerEvent['trigger'];
    summary: string;
    detail?: string | null;
    sourceLaneId?: VicodeBuildLaneId | null;
    targetLaneId?: VicodeBuildLaneId | null;
    threadId?: string | null;
    runId?: string | null;
  }) {
    this.db.addVicodeBuildEvent(input);
    this.emitter.emit('controller-update', {
      projectId: input.projectId,
      teamId: input.teamId,
      laneId: input.laneId,
      threadId: input.threadId ?? null
    } satisfies VicodeBuildControlUpdate);
  }

  private async runPythonJson(cwd: string, args: string[]): Promise<PythonJsonResult> {
    try {
      const { stdout } = await execFileAsync('python', args, {
        cwd,
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '1'
        }
      });
      const parsed = JSON.parse(stdout) as Record<string, unknown>;
      const ok = Boolean(parsed.ok);
      const summary =
        typeof parsed.reason === 'string'
          ? parsed.reason
          : ok
            ? 'ok'
            : typeof parsed.message === 'string'
              ? parsed.message
              : 'failed';
      return {
        ok,
        summary,
        detail: typeof parsed.message === 'string' ? parsed.message : null,
        dirtyPaths: Array.isArray(parsed.dirty_paths) ? parsed.dirty_paths.filter((value): value is string => typeof value === 'string') : []
      };
    } catch (error) {
      const stdout =
        typeof error === 'object' && error && 'stdout' in error && typeof (error as { stdout?: unknown }).stdout === 'string'
          ? (error as { stdout: string }).stdout
          : '';
      if (stdout.trim().length > 0) {
        try {
          const parsed = JSON.parse(stdout) as Record<string, unknown>;
          const ok = Boolean(parsed.ok);
          const summary =
            typeof parsed.reason === 'string'
              ? parsed.reason
              : ok
                ? 'ok'
                : typeof parsed.message === 'string'
                  ? parsed.message
                  : 'failed';
          return {
            ok,
            summary,
            detail: typeof parsed.message === 'string' ? parsed.message : null,
            dirtyPaths: Array.isArray(parsed.dirty_paths) ? parsed.dirty_paths.filter((value): value is string => typeof value === 'string') : []
          };
        } catch {
          // Fall through to the generic failure shape when stdout is not JSON.
        }
      }

      const message = error instanceof Error ? error.message : 'Verification command failed.';
      return {
        ok: false,
        summary: 'command_failed',
        detail: message,
        dirtyPaths: []
      };
    }
  }
}
