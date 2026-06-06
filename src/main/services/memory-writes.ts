import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ReviewItem, ThreadDetail } from '../../shared/domain';
import { normalizeDisplayText } from '../../shared/display-text';
import { DatabaseService } from '../../storage/database';
import { WorkspaceMemoryService } from './memory';

interface DailyNoteDraft {
  relativePath: string;
  targetPath: string;
  content: string;
  summary: string;
}

interface MemoryPromotionDraft {
  relativePath: string;
  targetPath: string;
  content: string;
  summary: string;
}

interface UserPreferenceDraft {
  relativePath: string;
  targetPath: string;
  content: string;
  summary: string;
}

export interface AutoAppliedMemoryWrite {
  job: ReturnType<DatabaseService['saveJob']>;
  relativePath: string;
  targetPath: string;
  summary: string;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function trimExcerpt(value: string, maxLength = 220) {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function latestTurnExcerpt(thread: ThreadDetail, role: 'user' | 'assistant') {
  const turn = [...thread.turns].reverse().find((item) => item.role === role && item.content.trim().length > 0);
  return turn ? trimExcerpt(turn.content) : '';
}

function recentUserRequestExcerpts(thread: ThreadDetail, maxEntries = 3) {
  return thread.turns
    .filter((turn) => turn.role === 'user' && turn.content.trim().length > 0)
    .slice(-maxEntries)
    .map((turn) => trimExcerpt(turn.content, 260))
    .filter(Boolean);
}

const USER_PREFERENCE_CLAUSE_PATTERN =
  /\b(prefer|preferences?|always|never|do not|don't|keep|avoid|concise|brief|verbose|explain|tradeoffs?|format|style|tone)\b/iu;
const DURABLE_MEMORY_CLAUSE_PATTERN =
  /\b(canonical|source of truth|remember|workflow|policy|default|durable|important|keep using|must|should)\b/iu;

function splitIntoMemoryClauses(value: string) {
  return value
    .replace(/\s+/gu, ' ')
    .split(/(?:[.;!?]\s+|,\s+|\s+-\s+|\band\b\s+)/iu)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function finalizeMemorySentence(value: string) {
  const normalized = value.replace(/\s+/gu, ' ').trim().replace(/^[-*]\s+/u, '');
  if (!normalized) {
    return '';
  }
  const capitalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return /[.!?]$/u.test(capitalized) ? capitalized : `${capitalized}.`;
}

function normalizeUserPreferenceClause(clause: string) {
  let normalized = clause.trim();
  normalized = normalized.replace(/^please\s+/iu, '');
  normalized = normalized.replace(/^i want you to\s+/iu, '');
  normalized = normalized.replace(/^i want\s+/iu, '');
  normalized = normalized.replace(/^you should\s+/iu, '');
  normalized = normalized.replace(/^we should\s+/iu, '');
  return finalizeMemorySentence(normalized);
}

function normalizeDurableMemoryClause(clause: string) {
  let normalized = clause.trim();
  normalized = normalized.replace(/^please\s+/iu, '');
  normalized = normalized.replace(/^i want you to\s+/iu, '');
  normalized = normalized.replace(/^i want\s+/iu, '');
  normalized = normalized.replace(/^we are\s+/iu, 'We are ');
  normalized = normalized.replace(/^that\s+workflow\s+should\s+remain\s+/iu, 'Keep ');
  normalized = normalized.replace(/^that\s+should\s+remain\s+/iu, 'Keep ');
  return finalizeMemorySentence(normalized);
}

function extractStructuredPreferenceEntry(thread: ThreadDetail) {
  const latestUserRequest = latestTurnExcerpt(thread, 'user');
  if (!latestUserRequest) {
    return null;
  }

  const candidates = splitIntoMemoryClauses(latestUserRequest)
    .filter((clause) => USER_PREFERENCE_CLAUSE_PATTERN.test(clause))
    .map((clause) => normalizeUserPreferenceClause(clause))
    .filter((clause) => clause.length > 0);

  return candidates[0] ?? null;
}

function extractStructuredDurableMemoryEntry(thread: ThreadDetail) {
  const latestUserRequest = latestTurnExcerpt(thread, 'user');
  const latestAssistantUpdate = latestTurnExcerpt(thread, 'assistant');
  const candidates = [latestUserRequest, latestAssistantUpdate]
    .flatMap((value) => splitIntoMemoryClauses(value))
    .filter((clause) => DURABLE_MEMORY_CLAUSE_PATTERN.test(clause))
    .map((clause) => normalizeDurableMemoryClause(clause))
    .filter((clause) => clause.length > 0);

  return candidates[0] ?? null;
}

function buildDailyNoteEntry(thread: ThreadDetail) {
  const capturedAt = new Date().toISOString();
  const latestUserRequest = latestTurnExcerpt(thread, 'user');
  const recentUserRequests = recentUserRequestExcerpts(thread);
  const normalizedThreadTitle = normalizeDisplayText(thread.title);
  const [datePart, timePart] = capturedAt.split('T');
  const timeUtc = timePart ? timePart.replace(/\.\d+Z$/u, '') : '00:00:00';

  const lines = [
    `## Session: ${datePart} ${timeUtc} UTC`,
    '',
    `- Thread: ${normalizedThreadTitle}`,
    `- Thread ID: ${thread.id}`,
    `- Provider: ${thread.providerId}`,
    `- Model: ${thread.modelId}`,
    '- Source: vicode',
    '',
    '### User Context',
    latestUserRequest ? `- Latest user request: ${latestUserRequest}` : '- Latest user request: (none)'
  ].filter((line): line is string => Boolean(line));

  if (recentUserRequests.length > 1) {
    lines.push('', '### Recent User Messages');
    for (const request of recentUserRequests) {
      lines.push(`- user: ${request}`);
    }
  }

  return lines.join('\n');
}

function buildMemoryPromotionEntry(thread: ThreadDetail) {
  const durableSignal = extractStructuredDurableMemoryEntry(thread);

  if (!durableSignal) {
    throw new Error(`Thread "${thread.title}" does not contain a durable memory candidate to promote.`);
  }

  return `- ${durableSignal}`;
}

function buildUserPreferenceEntry(thread: ThreadDetail) {
  const latestUserRequest = extractStructuredPreferenceEntry(thread);
  if (!latestUserRequest) {
    throw new Error(`Thread "${thread.title}" does not contain a user preference candidate to save.`);
  }

  return `- ${latestUserRequest}`;
}

function normalizeBullet(line: string) {
  return line.replace(/^\s*-\s*/u, '').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function hasBullet(markdown: string, bulletLine: string) {
  const target = normalizeBullet(bulletLine);
  return markdown
    .split(/\r?\n/u)
    .filter((line) => /^\s*-\s+/u.test(line))
    .some((line) => normalizeBullet(line) === target);
}

function appendUniqueBulletToSection(markdown: string, heading: string, bulletLine: string) {
  const trimmed = markdown.trimEnd();
  if (!trimmed) {
    return `${heading}\n${bulletLine}`;
  }
  if (hasBullet(trimmed, bulletLine)) {
    return trimmed;
  }

  const lines = trimmed.split(/\r?\n/u);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) {
    return `${trimmed}\n\n${heading}\n${bulletLine}`;
  }

  let insertIndex = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/u.test(lines[index] ?? '')) {
      insertIndex = index;
      break;
    }
  }

  const nextLines = [...lines];
  nextLines.splice(insertIndex, 0, bulletLine);
  return nextLines.join('\n').replace(/\n{3,}/gu, '\n\n');
}

function appendUniqueIndentedBullet(markdown: string, anchorLine: string, bulletLine: string) {
  const trimmed = markdown.trimEnd();
  if (!trimmed) {
    return `${anchorLine}\n  ${bulletLine}`;
  }
  if (hasBullet(trimmed, bulletLine)) {
    return trimmed;
  }

  const lines = trimmed.split(/\r?\n/u);
  const anchorIndex = lines.findIndex((line) => line.trim() === anchorLine.trim());
  if (anchorIndex === -1) {
    return `${trimmed}\n\n${anchorLine}\n  ${bulletLine}`;
  }

  let insertIndex = anchorIndex + 1;
  while (insertIndex < lines.length && (/^\s{2,}-\s+/u.test(lines[insertIndex] ?? '') || !(lines[insertIndex] ?? '').trim())) {
    insertIndex += 1;
  }

  const nextLines = [...lines];
  nextLines.splice(insertIndex, 0, `  ${bulletLine}`);
  return nextLines.join('\n').replace(/\n{3,}/gu, '\n\n');
}

export class MemoryWritesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly memory: WorkspaceMemoryService
  ) {}

  createDailyNoteReview(threadId: string) {
    const thread = this.db.getThread(threadId);
    const normalizedThreadTitle = normalizeDisplayText(thread.title);
    const project = this.db.getProject(thread.projectId);
    if (!project.folderPath) {
      throw new Error('Project checkpoint capture requires a project with a real workspace folder.');
    }

    const sourceId = `daily-note:${thread.id}`;
    const existing = this.db.findActiveJobForSource('manual', sourceId);
    if (existing) {
      const review = this.db.listPendingReviewItems().find((item) => item.jobId === existing.id);
      if (review) {
        return { job: existing, reviewItem: review, alreadyPending: true };
      }
      throw new Error(`Thread "${normalizedThreadTitle}" already has an active project checkpoint review.`);
    }

    const draft = this.buildDailyNoteDraft(project.folderPath, thread);
    const job = this.db.saveJob({
      projectId: project.id,
      sourceType: 'manual',
      sourceId,
      title: `Capture project checkpoint for "${normalizedThreadTitle}"`,
      status: 'waiting_for_review',
      threadId: thread.id
    });
    const reviewItem = this.db.addReviewItem({
      jobId: job.id,
      kind: 'manual_review',
      summary: draft.summary,
      details: {
        actionType: 'daily_note_capture',
        projectId: project.id,
        threadId: thread.id,
        threadTitle: normalizedThreadTitle,
        relativePath: draft.relativePath,
        targetPath: draft.targetPath,
        content: draft.content
      }
    });
    return { job, reviewItem, alreadyPending: false };
  }

  autoApplyDailyNote(threadId: string, sourceKey?: string): AutoAppliedMemoryWrite | null {
    const thread = this.db.getThread(threadId);
    const normalizedThreadTitle = normalizeDisplayText(thread.title);
    const project = this.db.getProject(thread.projectId);
    if (!project.folderPath) {
      throw new Error('Project checkpoint capture requires a project with a real workspace folder.');
    }

    const sourceId = sourceKey ? `daily-note:${thread.id}:${sourceKey}` : `daily-note:${thread.id}`;
    if (this.hasCompletedManualWrite(sourceId)) {
      return null;
    }

    const draft = this.buildDailyNoteDraft(project.folderPath, thread);
    this.writeDraft(project.id, draft.targetPath, draft.content);
    const job = this.db.saveJob({
      projectId: project.id,
      sourceType: 'manual',
      sourceId,
      title: `Auto-saved project checkpoint for "${normalizedThreadTitle}"`,
      status: 'completed',
      threadId: thread.id
    });
    return {
      job,
      relativePath: draft.relativePath,
      targetPath: draft.targetPath,
      summary: draft.summary
    };
  }

  createMemoryPromotionReview(threadId: string) {
    const thread = this.db.getThread(threadId);
    const normalizedThreadTitle = normalizeDisplayText(thread.title);
    const project = this.db.getProject(thread.projectId);
    if (!project.folderPath) {
      throw new Error('Memory promotion requires a project with a real workspace folder.');
    }

    const sourceId = `memory-promotion:${thread.id}`;
    const existing = this.db.findActiveJobForSource('manual', sourceId);
    if (existing) {
      const review = this.db.listPendingReviewItems().find((item) => item.jobId === existing.id);
      if (review) {
        return { job: existing, reviewItem: review, alreadyPending: true };
      }
      throw new Error(`Thread "${normalizedThreadTitle}" already has an active memory promotion review.`);
    }

    const draft = this.buildMemoryPromotionDraft(project.folderPath, thread);
    const job = this.db.saveJob({
      projectId: project.id,
      sourceType: 'manual',
      sourceId,
      title: `Save project memory for "${normalizedThreadTitle}"`,
      status: 'waiting_for_review',
      threadId: thread.id
    });
    const reviewItem = this.db.addReviewItem({
      jobId: job.id,
      kind: 'manual_review',
      summary: draft.summary,
      details: {
        actionType: 'memory_promotion',
        projectId: project.id,
        threadId: thread.id,
        threadTitle: normalizedThreadTitle,
        relativePath: draft.relativePath,
        targetPath: draft.targetPath,
        content: draft.content
      }
    });
    return { job, reviewItem, alreadyPending: false };
  }

  autoApplyMemoryPromotion(threadId: string): AutoAppliedMemoryWrite | null {
    const thread = this.db.getThread(threadId);
    const normalizedThreadTitle = normalizeDisplayText(thread.title);
    const project = this.db.getProject(thread.projectId);
    if (!project.folderPath) {
      throw new Error('Memory promotion requires a project with a real workspace folder.');
    }

    const sourceId = `memory-promotion:${thread.id}`;
    if (this.hasCompletedManualWrite(sourceId)) {
      return null;
    }

    const draft = this.buildMemoryPromotionDraft(project.folderPath, thread);
    this.writeDraft(project.id, draft.targetPath, draft.content);
    const job = this.db.saveJob({
      projectId: project.id,
      sourceType: 'manual',
      sourceId,
      title: `Auto-promoted durable memory for "${normalizedThreadTitle}"`,
      status: 'completed',
      threadId: thread.id
    });
    return {
      job,
      relativePath: draft.relativePath,
      targetPath: draft.targetPath,
      summary: draft.summary
    };
  }

  createUserPreferenceReview(threadId: string) {
    const thread = this.db.getThread(threadId);
    const normalizedThreadTitle = normalizeDisplayText(thread.title);
    const project = this.db.getProject(thread.projectId);
    if (!project.folderPath) {
      throw new Error('Preference capture requires a project with a real workspace folder.');
    }

    const sourceId = `user-preference:${thread.id}`;
    const existing = this.db.findActiveJobForSource('manual', sourceId);
    if (existing) {
      const review = this.db.listPendingReviewItems().find((item) => item.jobId === existing.id);
      if (review) {
        return { job: existing, reviewItem: review, alreadyPending: true };
      }
      throw new Error(`Thread "${normalizedThreadTitle}" already has an active preference review.`);
    }

    const draft = this.buildUserPreferenceDraft(project.folderPath, thread);
    const job = this.db.saveJob({
      projectId: project.id,
      sourceType: 'manual',
      sourceId,
      title: `Save project preference for "${normalizedThreadTitle}"`,
      status: 'waiting_for_review',
      threadId: thread.id
    });
    const reviewItem = this.db.addReviewItem({
      jobId: job.id,
      kind: 'manual_review',
      summary: draft.summary,
      details: {
        actionType: 'user_preference',
        projectId: project.id,
        threadId: thread.id,
        threadTitle: normalizedThreadTitle,
        relativePath: draft.relativePath,
        targetPath: draft.targetPath,
        content: draft.content
      }
    });
    return { job, reviewItem, alreadyPending: false };
  }

  autoApplyUserPreference(threadId: string): AutoAppliedMemoryWrite | null {
    const thread = this.db.getThread(threadId);
    const normalizedThreadTitle = normalizeDisplayText(thread.title);
    const project = this.db.getProject(thread.projectId);
    if (!project.folderPath) {
      throw new Error('Preference capture requires a project with a real workspace folder.');
    }

    const sourceId = `user-preference:${thread.id}`;
    if (this.hasCompletedManualWrite(sourceId)) {
      return null;
    }

    const draft = this.buildUserPreferenceDraft(project.folderPath, thread);
    this.writeDraft(project.id, draft.targetPath, draft.content);
    const job = this.db.saveJob({
      projectId: project.id,
      sourceType: 'manual',
      sourceId,
      title: `Auto-saved project preference for "${normalizedThreadTitle}"`,
      status: 'completed',
      threadId: thread.id
    });
    return {
      job,
      relativePath: draft.relativePath,
      targetPath: draft.targetPath,
      summary: draft.summary
    };
  }

  applyReview(reviewItem: ReviewItem) {
    const targetPath = String(reviewItem.details.targetPath ?? '');
    const projectId = String(reviewItem.details.projectId ?? '');
    if (!targetPath || !projectId) {
      throw new Error('Memory write review is missing write target details.');
    }

    const content = String(reviewItem.details.content ?? '').trim();
    this.writeDraft(projectId, targetPath, content);

    return targetPath;
  }

  private hasCompletedManualWrite(sourceId: string) {
    return this.db
      .listJobs()
      .some((job) => job.sourceType === 'manual' && job.sourceId === sourceId && job.status === 'completed');
  }

  private writeDraft(projectId: string, targetPath: string, content: string) {
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, `${content.trim()}\n`, 'utf8');

    const project = this.db.getProject(projectId);
    if (project.folderPath) {
      this.memory.refreshWorkspaceMemory(project.id, project.folderPath, project.trusted);
    }
  }

  private buildDailyNoteDraft(folderPath: string, thread: ThreadDetail): DailyNoteDraft {
    const date = todayIsoDate();
    const relativePath = join('memory', `${date}.md`);
    const targetPath = join(folderPath, relativePath);
    const newEntry = buildDailyNoteEntry(thread);
    const existing = existsSync(targetPath) ? readFileSync(targetPath, 'utf8').trim() : '';
    const content = existing ? `${existing}\n\n---\n\n${newEntry}` : `# Daily Memory Log\n\n${newEntry}`;

    return {
      relativePath,
      targetPath,
      content,
      summary: `Review project checkpoint for "${normalizeDisplayText(thread.title)}"`
    };
  }

  private buildMemoryPromotionDraft(folderPath: string, thread: ThreadDetail): MemoryPromotionDraft {
    const relativePath = 'MEMORY.md';
    const targetPath = join(folderPath, relativePath);
    const newEntry = buildMemoryPromotionEntry(thread);
    const existing = existsSync(targetPath) ? readFileSync(targetPath, 'utf8').trim() : '';
    const content = existing
      ? appendUniqueBulletToSection(existing, '## Durable Decisions', newEntry)
      : `# Durable Workspace Memory\n\n## Durable Decisions\n${newEntry}`;

    return {
      relativePath,
      targetPath,
      content,
      summary: `Review project memory for "${normalizeDisplayText(thread.title)}"`
    };
  }

  private buildUserPreferenceDraft(folderPath: string, thread: ThreadDetail): UserPreferenceDraft {
    const relativePath = 'USER.md';
    const targetPath = join(folderPath, relativePath);
    const newEntry = buildUserPreferenceEntry(thread);
    const existing = existsSync(targetPath) ? readFileSync(targetPath, 'utf8').trimEnd() : '';

    let content: string;
    if (!existing) {
      content = ['# User Preferences', '', '## Notes', '', '- Durable preferences:', `  ${newEntry}`].join('\n');
    } else if (existing.includes('- Durable preferences:')) {
      content = appendUniqueIndentedBullet(existing, '- Durable preferences:', newEntry);
    } else {
      content = `${existing}\n\n## Notes\n\n- Durable preferences:\n  ${newEntry}`;
    }

    return {
      relativePath,
      targetPath,
      content,
      summary: `Review project preference for "${normalizeDisplayText(thread.title)}"`
    };
  }
}
