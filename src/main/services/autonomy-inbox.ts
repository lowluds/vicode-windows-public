import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AutonomyDelegationProfile, AutonomyInboxItem, Project } from '../../shared/domain';
import { DatabaseService } from '../../storage/database';

const HEARTBEAT_FILE_NAME = 'HEARTBEAT.md';
const HEARTBEAT_TASK_PATTERN = /^\s*[-*]\s+\[\s\]\s+(.+?)\s*$/u;
const HEARTBEAT_ROLE_PATTERN = /^\[(?<role>[a-z0-9_-]+)\]\s+(?<task>.+)$/iu;
const HEARTBEAT_SECTION_PATTERN = /^\s{2,}(?<label>Goal|Why now|Scope|Acceptance|Verify|Refs|Stop when|Notes):\s*(?<value>.*)$/iu;
const HEARTBEAT_SECTION_ITEM_PATTERN = /^\s{4,}[-*]\s+(.+?)\s*$/u;

interface ParsedHeartbeatBlock {
  rawTask: string;
  detailLines: string[];
  blockContent: string;
}

interface ParsedHeartbeatTask {
  role: string | null;
  task: string;
  delegationProfile: AutonomyDelegationProfile;
  goal: string | null;
  whyNow: string | null;
  scope: string | null;
  acceptance: string[];
  verify: string[];
  refs: string[];
  stopWhen: string | null;
  notes: string[];
}

function normalizeRoleLabel(role: string) {
  return role
    .trim()
    .replace(/[_-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/\b\p{L}/gu, (match) => match.toUpperCase());
}

function resolveDelegationProfile(role: string | null): AutonomyDelegationProfile {
  const normalized = role?.trim().toLowerCase() ?? '';
  switch (normalized) {
    case 'research':
      return 'research';
    case 'review':
    case 'reviewer':
    case 'qa':
    case 'verify':
    case 'verification':
      return 'verify';
    case 'cleanup':
    case 'codebase':
    case 'implement':
    case 'implementation':
    case 'builder':
    case 'fixer':
      return 'implement';
    case 'director':
    case 'lead':
    case 'triage':
    default:
      return 'heartbeat';
  }
}

function parseHeartbeatTask(rawTask: string) {
  const match = HEARTBEAT_ROLE_PATTERN.exec(rawTask.trim());
  if (!match?.groups) {
    return {
      role: null,
      task: rawTask.trim(),
      delegationProfile: 'heartbeat' as AutonomyDelegationProfile
    };
  }

  const role = match.groups.role.trim();
  const task = match.groups.task.trim();
  return {
    role,
    task,
    delegationProfile: resolveDelegationProfile(role)
  };
}

function extractHeartbeatBlocks(content: string): ParsedHeartbeatBlock[] {
  const lines = content.split(/\r?\n/gu);
  const blocks: ParsedHeartbeatBlock[] = [];
  let current: ParsedHeartbeatBlock | null = null;

  for (const line of lines) {
    const taskMatch = HEARTBEAT_TASK_PATTERN.exec(line);
    if (taskMatch?.[1]) {
      if (current) {
        blocks.push(current);
      }
      current = {
        rawTask: taskMatch[1].trim(),
        detailLines: [],
        blockContent: line.trim()
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    if (/^\s{2,}\S/iu.test(line)) {
      current.detailLines.push(line);
      current.blockContent += `\n${line}`;
    }
  }

  if (current) {
    blocks.push(current);
  }

  return blocks;
}

function appendSectionValue(collection: string[], value: string) {
  const normalized = value.trim();
  if (normalized) {
    collection.push(normalized);
  }
}

function parseHeartbeatTicket(block: ParsedHeartbeatBlock): ParsedHeartbeatTask {
  const base = parseHeartbeatTask(block.rawTask);
  const acceptance: string[] = [];
  const verify: string[] = [];
  const refs: string[] = [];
  const notes: string[] = [];
  let goal: string | null = null;
  let whyNow: string | null = null;
  let scope: string | null = null;
  let stopWhen: string | null = null;
  let activeList: string[] | null = null;

  for (const line of block.detailLines) {
    const sectionMatch = HEARTBEAT_SECTION_PATTERN.exec(line);
    if (sectionMatch?.groups) {
      const label = sectionMatch.groups.label.trim().toLowerCase();
      const value = sectionMatch.groups.value.trim();
      activeList = null;

      switch (label) {
        case 'goal':
          goal = value || null;
          break;
        case 'why now':
          whyNow = value || null;
          break;
        case 'scope':
          scope = value || null;
          break;
        case 'acceptance':
          if (value) {
            appendSectionValue(acceptance, value);
          }
          activeList = acceptance;
          break;
        case 'verify':
          if (value) {
            appendSectionValue(verify, value);
          }
          activeList = verify;
          break;
        case 'refs':
          if (value) {
            appendSectionValue(refs, value);
          }
          activeList = refs;
          break;
        case 'stop when':
          stopWhen = value || null;
          break;
        case 'notes':
          if (value) {
            appendSectionValue(notes, value);
          }
          activeList = notes;
          break;
        default:
          break;
      }
      continue;
    }

    const sectionItemMatch = HEARTBEAT_SECTION_ITEM_PATTERN.exec(line);
    if (sectionItemMatch?.[1] && activeList) {
      appendSectionValue(activeList, sectionItemMatch[1]);
    }
  }

  return {
    ...base,
    goal,
    whyNow,
    scope,
    acceptance,
    verify,
    refs,
    stopWhen,
    notes
  };
}

function hashTask(projectId: string, content: string) {
  return createHash('sha1')
    .update(`${projectId}\n${content.trim()}`)
    .digest('hex')
    .slice(0, 16);
}

function normalizeTaskTitle(task: string) {
  const trimmed = task.trim().replace(/\s+/gu, ' ');
  if (!trimmed) {
    return 'Heartbeat task';
  }
  return trimmed.length > 72 ? `${trimmed.slice(0, 69).trimEnd()}...` : trimmed;
}

function buildHeartbeatPrompt(ticket: ParsedHeartbeatTask) {
  const task = ticket.task.trim();
  const role = ticket.role ? normalizeRoleLabel(ticket.role) : null;
  const normalizedRole = ticket.role?.trim().toLowerCase() ?? '';
  const roleRules =
    normalizedRole === 'research'
      ? [
          '- gather the minimum evidence needed before changing code',
          '- cite the exact source files or docs you used in the final summary'
        ]
      : ['review', 'reviewer', 'qa', 'verify', 'verification'].includes(normalizedRole)
        ? [
            '- review the current implementation and note concrete findings before editing',
            '- keep findings specific, truthful, and tied to the current code'
          ]
        : ['cleanup', 'codebase'].includes(normalizedRole)
          ? [
              '- remove or simplify stale material only when it is clearly superseded',
              '- do not widen the task into unrelated feature work'
            ]
          : [
              '- keep the work scoped to the next highest-value ticket',
              '- update the relevant queue or docs only when it directly supports this ticket'
            ];

  return [
    'Work on the following ticket from HEARTBEAT.md.',
    '',
    role ? `Assigned role: ${role}` : null,
    `Ticket: ${task}`,
    '',
    ticket.goal ? `Goal: ${ticket.goal}` : null,
    ticket.whyNow ? `Why now: ${ticket.whyNow}` : null,
    ticket.scope ? `Scope: ${ticket.scope}` : null,
    ticket.acceptance.length > 0 ? 'Acceptance criteria:' : null,
    ...ticket.acceptance.map((item) => `- ${item}`),
    ticket.verify.length > 0 ? 'Verification:' : null,
    ...ticket.verify.map((item) => `- ${item}`),
    ticket.refs.length > 0 ? 'References:' : null,
    ...ticket.refs.map((item) => `- ${item}`),
    ticket.stopWhen ? `Stop when: ${ticket.stopWhen}` : null,
    ticket.notes.length > 0 ? 'Notes:' : null,
    ...ticket.notes.map((item) => `- ${item}`),
    '',
    'Rules:',
    '- keep the work bounded to this task',
    '- do not invent parallel systems or fake progress',
    '- use delegated context only',
    '- do not edit HEARTBEAT.md automatically',
    '- verify any meaningful changes before finishing',
    ...roleRules,
    '- end with a short summary of what changed, what was verified, and what still remains'
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

export class AutonomyInboxService {
  constructor(private readonly db: DatabaseService) {}

  listProjectItems(project: Project): AutonomyInboxItem[] {
    if (!project.trusted || !project.folderPath) {
      return [];
    }

    const heartbeatPath = join(project.folderPath, HEARTBEAT_FILE_NAME);
    if (!existsSync(heartbeatPath)) {
      return [];
    }

    const content = readFileSync(heartbeatPath, 'utf8');
    if (!content.trim()) {
      return [];
    }

    const jobs = this.db.listJobs().filter((job) => job.projectId === project.id && job.sourceType === 'future_system');
    const blocks = extractHeartbeatBlocks(content);

    return blocks.flatMap((block) => {
      const parsed = parseHeartbeatTicket(block);
      const key = `heartbeat:${project.id}:${hashTask(project.id, block.blockContent)}`;
      const latestJob = jobs.find((job) => job.sourceId === key) ?? null;
      if (latestJob && latestJob.status !== 'failed' && latestJob.status !== 'cancelled') {
        return [];
      }

      const normalizedTitle = normalizeTaskTitle(parsed.task);
      const title = parsed.role ? `${normalizeRoleLabel(parsed.role)}: ${normalizedTitle}` : normalizedTitle;

      return [
        {
          key,
          projectId: project.id,
          threadId: latestJob?.threadId ?? null,
          title,
          prompt: buildHeartbeatPrompt(parsed),
          source: 'heartbeat_file',
          delegationProfile: parsed.delegationProfile,
          sourcePath: heartbeatPath
        } satisfies AutonomyInboxItem
      ];
    });
  }

  selectNextProjectItem(project: Project): AutonomyInboxItem | null {
    return this.listProjectItems(project)[0] ?? null;
  }
}
