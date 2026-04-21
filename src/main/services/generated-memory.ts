import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, win32 } from 'node:path';
import type {
  GeneratedMemoryCandidate,
  GeneratedMemoryCandidateKind,
  GeneratedMemoryEvidence,
  GeneratedMemoryItem,
  ThreadDetail,
  ThreadTurn,
  ThreadTurnRole
} from '../../shared/domain';
import { DatabaseService } from '../../storage/database';

const MIN_ELIGIBLE_TURNS = 2;
const MAX_CANDIDATES_PER_THREAD = 6;
const MIN_CLAUSE_LENGTH = 18;
const MAX_CLAUSE_LENGTH = 280;
const MAX_COMMAND_CLAUSE_LENGTH = 420;
const MAX_EXCERPT_LENGTH = 220;

const WORKSPACE_CONVENTION_PATTERN =
  /\b(canonical|source of truth|checked-in|checked in|workspace files?|repo docs?|agents\.md|soul\.md|user\.md|memory\.md|daily notes?)\b/iu;
const USER_PREFERENCE_PATTERN =
  /\b(prefer|preferences?|always|never|do not|don't|keep|avoid|concise|brief|verbose|format|style|tone|explain|tradeoffs?)\b/iu;
const KNOWN_PITFALL_PATTERN =
  /\b(avoid|pitfall|gotcha|legacy|do not use|don't use|wrong path|scope leak|stale|bleed|bleeding|breaks?|fails?)\b/iu;
const WORKFLOW_PREFERENCE_PATTERN =
  /\b(use|prefer|run|invoke|execute|workflow|script|default|should remain|keep using|workspace root)\b/iu;
const ENVIRONMENT_FACT_PATTERN =
  /\b(windows|powershell|pwsh|path|shell|terminal|env|environment|cwd|workspace root|trusted workspace|native module)\b/iu;
const ARCHITECTURE_FACT_PATTERN =
  /\b(architecture|stack|electron|react|vite|sqlite|preload|renderer|main process|provider adapter|supabase|tailwind|ipc)\b/iu;
const COMMAND_PATTERN = /`[^`]+`|\b(?:npm|pnpm|yarn|npx|node|pwsh|powershell)\s+[a-z0-9:_-]+/iu;

interface ExtractedCandidateDraft {
  kind: GeneratedMemoryCandidateKind;
  summary: string;
  detail: string;
  evidenceExcerpt: string;
  sourceTurnId: string;
  sourceRunId: string | null;
  role: Extract<ThreadTurnRole, 'user' | 'assistant'>;
  capturedAt: string;
  dedupeKey: string;
}

type DetachedGeneratedMemoryEvidence = Omit<GeneratedMemoryEvidence, 'id' | 'candidateId' | 'itemId'>;

function trimTrailingSeparators(value: string) {
  return value.replace(/[\\/]+$/gu, '');
}

export function normalizeGeneratedMemoryWorkspaceScopeKey(folderPath: string) {
  const normalized = win32.normalize(folderPath.replace(/\//gu, '\\'));
  const driveMatch = normalized.match(/^[a-z]:/iu);
  const withNormalizedDrive = driveMatch
    ? `${driveMatch[0].toUpperCase()}${normalized.slice(driveMatch[0].length)}`
    : normalized;
  const trimmed = trimTrailingSeparators(withNormalizedDrive);
  return trimmed || withNormalizedDrive;
}

function sanitizeArtifactSegment(value: string) {
  return value
    .replace(/[^a-z0-9._-]+/giu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48);
}

function buildWorkspaceScopeArtifactFolderName(workspaceScopeKey: string) {
  const scopeHash = createHash('sha1').update(workspaceScopeKey).digest('hex').slice(0, 12);
  const baseName = sanitizeArtifactSegment(win32.basename(workspaceScopeKey) || 'workspace') || 'workspace';
  return `${baseName}-${scopeHash}`;
}

export function getGeneratedMemoryScopeArtifactDir(artifactsRoot: string, workspaceScopeKey: string) {
  return join(artifactsRoot, buildWorkspaceScopeArtifactFolderName(workspaceScopeKey));
}

function trimExcerpt(value: string, maxLength = MAX_EXCERPT_LENGTH) {
  const normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function finalizeSentence(value: string) {
  const normalized = value.replace(/\s+/gu, ' ').trim().replace(/^[-*]\s+/u, '');
  if (!normalized) {
    return '';
  }
  const capitalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return /[.!?]$/u.test(capitalized) ? capitalized : `${capitalized}.`;
}

function normalizeCandidateClause(value: string) {
  let normalized = value.trim();
  normalized = normalized.replace(/^remember(?: this)?:\s*/iu, '');
  normalized = normalized.replace(/^understood[:,]?\s*/iu, '');
  normalized = normalized.replace(/^please\s+/iu, '');
  normalized = normalized.replace(/^i want you to\s+/iu, '');
  normalized = normalized.replace(/^i want\s+/iu, '');
  normalized = normalized.replace(/^we should\s+/iu, '');
  normalized = normalized.replace(/^you should\s+/iu, '');
  return finalizeSentence(normalized);
}

function splitCandidateClauses(value: string) {
  return value
    .replace(/\r\n/gu, '\n')
    .split(/\n+/u)
    .flatMap((line) => line.split(/(?<=[.!?])\s+|;\s+|\s+-\s+/u))
    .map((part) => part.trim().replace(/^[-*]\s+/u, ''))
    .map(normalizeCandidateClause)
    .filter(
      (part) =>
        part.length >= MIN_CLAUSE_LENGTH &&
        (
          part.length <= MAX_CLAUSE_LENGTH
          || (COMMAND_PATTERN.test(part) && part.length <= MAX_COMMAND_CLAUSE_LENGTH)
        )
    );
}

function normalizeDedupeSubject(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 120);
}

function createDedupeKey(kind: GeneratedMemoryCandidateKind, detail: string) {
  return createHash('sha1').update(`${kind}:${normalizeDedupeSubject(detail)}`).digest('hex');
}

function createItemIndexKey(kind: GeneratedMemoryCandidateKind, detail: string) {
  return createDedupeKey(kind, detail);
}

function formatCandidateSummary(kind: GeneratedMemoryCandidateKind, detail: string) {
  const prefix =
    kind === 'workspace_convention'
      ? 'Workspace convention'
      : kind === 'workflow_preference'
        ? 'Workflow preference'
        : kind === 'known_pitfall'
          ? 'Known pitfall'
          : kind === 'environment_fact'
            ? 'Environment fact'
            : kind === 'architecture_fact'
              ? 'Architecture fact'
              : 'Workspace user preference';
  return `${prefix}: ${trimExcerpt(detail, 96)}`;
}

function classifyClause(
  clause: string,
  role: Extract<ThreadTurnRole, 'user' | 'assistant'>
): GeneratedMemoryCandidateKind | null {
  if (
    clause.endsWith('?')
    || /^(what|how|when|where|why|who|which|can|could|should|would|do|does|did|is|are|am|will)\b/iu.test(clause)
  ) {
    return null;
  }

  if (role === 'user') {
    return USER_PREFERENCE_PATTERN.test(clause) ? 'user_preference_workspace_scoped' : null;
  }

  if (WORKSPACE_CONVENTION_PATTERN.test(clause)) {
    return 'workspace_convention';
  }
  if (KNOWN_PITFALL_PATTERN.test(clause)) {
    return 'known_pitfall';
  }
  if (WORKFLOW_PREFERENCE_PATTERN.test(clause) && (COMMAND_PATTERN.test(clause) || /workspace root|script|workflow|default/iu.test(clause))) {
    return 'workflow_preference';
  }
  if (ENVIRONMENT_FACT_PATTERN.test(clause)) {
    return 'environment_fact';
  }
  if (ARCHITECTURE_FACT_PATTERN.test(clause)) {
    return 'architecture_fact';
  }
  return null;
}

function isEligibleTurn(turn: ThreadTurn): turn is ThreadTurn & { role: 'user' | 'assistant' } {
  return (turn.role === 'user' || turn.role === 'assistant') && turn.content.trim().length > 0;
}

function toDetachedEvidence(entry: GeneratedMemoryEvidence): DetachedGeneratedMemoryEvidence {
  return {
    workspaceScopeKey: entry.workspaceScopeKey,
    projectId: entry.projectId,
    sourceThreadId: entry.sourceThreadId,
    sourceTurnIds: entry.sourceTurnIds,
    role: entry.role,
    excerpt: entry.excerpt,
    capturedAt: entry.capturedAt
  };
}

function mergeEvidence(
  existingEvidence: GeneratedMemoryEvidence[],
  nextEvidence: DetachedGeneratedMemoryEvidence[]
) {
  const merged = new Map<
    string,
    DetachedGeneratedMemoryEvidence
  >();

  for (const entry of existingEvidence) {
    merged.set(
      `${entry.sourceThreadId}|${entry.sourceTurnIds.join(',')}|${entry.role}|${entry.excerpt}`,
      toDetachedEvidence(entry)
    );
  }

  for (const entry of nextEvidence) {
    merged.set(
      `${entry.sourceThreadId}|${entry.sourceTurnIds.join(',')}|${entry.role}|${entry.excerpt}`,
      entry
    );
  }

  return [...merged.values()]
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
}

function formatKindLabel(kind: GeneratedMemoryCandidateKind) {
  return kind.replace(/_/gu, ' ');
}

function formatCountsByKind(entries: Array<{ kind: GeneratedMemoryCandidateKind }>) {
  const counts = new Map<GeneratedMemoryCandidateKind, number>();
  for (const entry of entries) {
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([kind, count]) => `- ${formatKindLabel(kind)}: ${count}`);
}

function formatSummaryArtifact(params: {
  workspaceScopeKey: string;
  candidates: GeneratedMemoryCandidate[];
  items: GeneratedMemoryItem[];
}) {
  const proposedCandidateCount = params.candidates.filter((candidate) => candidate.status === 'proposed').length;
  const consolidatedCandidateCount = params.candidates.filter((candidate) => candidate.status === 'consolidated').length;
  const rejectedCandidateCount = params.candidates.filter((candidate) => candidate.status === 'rejected').length;
  const expiredCandidateCount = params.candidates.filter((candidate) => candidate.status === 'expired').length;
  const lastConsolidationTime =
    params.items.length > 0
      ? [...params.items]
          .map((item) => item.updatedAt)
          .sort((left, right) => right.localeCompare(left))[0]
      : null;
  const lines = [
    '# Generated Memory Summary',
    '',
    `- Workspace scope: \`${params.workspaceScopeKey}\``,
    `- Generation status: shadow mode active (generate on, use off)`,
    `- Candidate rows: ${params.candidates.length}`,
    `- Proposed candidates: ${proposedCandidateCount}`,
    `- Consolidated candidates: ${consolidatedCandidateCount}`,
    `- Rejected candidates: ${rejectedCandidateCount}`,
    `- Expired candidates: ${expiredCandidateCount}`,
    `- Recallable consolidated items: ${params.items.length}`,
    `- Last consolidation time: ${lastConsolidationTime ?? 'not yet consolidated'}`,
    ''
  ];

  const candidateCounts = formatCountsByKind(params.candidates);
  if (candidateCounts.length > 0) {
    lines.push('## Candidate counts by kind', '', ...candidateCounts, '');
  }

  const itemCounts = formatCountsByKind(params.items);
  if (itemCounts.length > 0) {
    lines.push('## Recallable item counts by kind', '', ...itemCounts, '');
  }

  if (candidateCounts.length === 0 && itemCounts.length === 0) {
    lines.push('No generated-memory state recorded for this workspace yet.', '');
  }

  return lines.join('\n').trimEnd();
}

function formatItemsArtifact(items: GeneratedMemoryItem[]) {
  const lines = ['# Generated Memory Items', ''];
  if (items.length === 0) {
    lines.push('No recallable derived items yet. Shadow mode is still generating candidates only.');
    return lines.join('\n');
  }

  for (const item of items) {
    lines.push(`## ${item.summary}`, '');
    lines.push(`- Item ID: \`${item.id}\``);
    lines.push(`- Kind: ${formatKindLabel(item.kind)}`);
    lines.push(`- Authority: \`${item.authority}\``);
    lines.push(`- Evidence count: ${item.evidenceCount}`);
    lines.push(`- Source thread IDs: ${item.sourceThreadIds.map((id) => `\`${id}\``).join(', ')}`);
    lines.push(`- Disabled: ${item.disabledAt ? `yes (${item.disabledAt})` : 'no'}`);
    lines.push('', item.detail, '');
  }

  return lines.join('\n').trimEnd();
}

function formatEvidenceArtifact(params: {
  workspaceScopeKey: string;
  sourceThreadId: string;
  entries: GeneratedMemoryEvidence[];
  candidateIndex: Map<string, GeneratedMemoryCandidate>;
  itemIndex: Map<string, GeneratedMemoryItem>;
}) {
  const lines = [
    '# Generated Memory Evidence',
    '',
    `- Workspace scope: \`${params.workspaceScopeKey}\``,
    `- Source thread ID: \`${params.sourceThreadId}\``,
    ''
  ];

  for (const entry of params.entries) {
    const item = entry.itemId ? params.itemIndex.get(entry.itemId) ?? null : null;
    const candidate = entry.candidateId ? params.candidateIndex.get(entry.candidateId) ?? null : null;
    lines.push(`## ${item?.summary ?? candidate?.summary ?? 'Derived evidence'}`, '');
    if (item) {
      lines.push(`- Artifact subject: consolidated item`);
      lines.push(`- Item ID: \`${item.id}\``);
      lines.push(`- Kind: ${formatKindLabel(item.kind)}`);
      lines.push(`- Authority: \`${item.authority}\``);
      lines.push(`- Disabled: ${item.disabledAt ? `yes (${item.disabledAt})` : 'no'}`);
    } else if (candidate) {
      lines.push(`- Artifact subject: candidate`);
      lines.push(`- Candidate ID: \`${candidate.id}\``);
      lines.push(`- Kind: ${formatKindLabel(candidate.kind)}`);
      lines.push(`- Status: \`${candidate.status}\``);
    }
    lines.push(`- Role: \`${entry.role}\``);
    lines.push(`- Source turn IDs: ${entry.sourceTurnIds.map((id) => `\`${id}\``).join(', ')}`);
    lines.push(`- Captured at: ${entry.capturedAt}`);
    lines.push('', entry.excerpt, '');
  }

  return lines.join('\n').trimEnd();
}

function extractCandidateDrafts(thread: ThreadDetail) {
  const populatedTurns = thread.turns.filter(isEligibleTurn);
  const roles = new Set(populatedTurns.map((turn) => turn.role));
  if (populatedTurns.length < MIN_ELIGIBLE_TURNS || !roles.has('user') || !roles.has('assistant')) {
    return [];
  }

  const drafts = new Map<string, ExtractedCandidateDraft>();

  for (const turn of populatedTurns) {
    for (const clause of splitCandidateClauses(turn.content)) {
      const kind = classifyClause(clause, turn.role);
      if (!kind) {
        continue;
      }

      const detail = clause;
      const dedupeKey = createDedupeKey(kind, detail);
      if (drafts.has(dedupeKey)) {
        continue;
      }

      drafts.set(dedupeKey, {
        kind,
        summary: formatCandidateSummary(kind, detail),
        detail,
        evidenceExcerpt: trimExcerpt(clause),
        sourceTurnId: turn.id,
        sourceRunId: turn.runId,
        role: turn.role,
        capturedAt: turn.createdAt,
        dedupeKey
      });

      if (drafts.size >= MAX_CANDIDATES_PER_THREAD) {
        return [...drafts.values()];
      }
    }
  }

  return [...drafts.values()];
}

export class GeneratedMemoryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly artifactsRoot: string | null = null
  ) {}

  syncArtifactsForWorkspaceScope(workspaceScopeKey: string) {
    if (!this.artifactsRoot) {
      return;
    }

    const scopeDir = getGeneratedMemoryScopeArtifactDir(this.artifactsRoot, workspaceScopeKey);
    const evidenceDir = join(scopeDir, 'generated-memory-evidence');
    const candidates = this.db.listGeneratedMemoryCandidates(workspaceScopeKey);
    const items = this.db.listGeneratedMemoryItems(workspaceScopeKey);
    const candidateIndex = new Map(candidates.map((candidate) => [candidate.id, candidate] as const));
    const itemIndex = new Map(items.map((item) => [item.id, item] as const));
    const candidateIdsRepresentedByItems = new Set(items.flatMap((item) => item.sourceCandidateIds));

    rmSync(scopeDir, { recursive: true, force: true });
    mkdirSync(evidenceDir, { recursive: true });

    writeFileSync(
      join(scopeDir, 'generated-memory-summary.md'),
      `${formatSummaryArtifact({
        workspaceScopeKey,
        candidates,
        items
      })}\n`,
      'utf8'
    );
    writeFileSync(
      join(scopeDir, 'generated-memory-items.md'),
      `${formatItemsArtifact(items)}\n`,
      'utf8'
    );

    const evidenceByThread = new Map<string, GeneratedMemoryEvidence[]>();
    for (const item of items) {
      for (const entry of this.db.listGeneratedMemoryEvidenceForItem(item.id)) {
        const current = evidenceByThread.get(entry.sourceThreadId) ?? [];
        current.push(entry);
        evidenceByThread.set(entry.sourceThreadId, current);
      }
    }
    for (const candidate of candidates) {
      if (candidateIdsRepresentedByItems.has(candidate.id)) {
        continue;
      }
      for (const entry of this.db.listGeneratedMemoryEvidenceForCandidate(candidate.id)) {
        const current = evidenceByThread.get(entry.sourceThreadId) ?? [];
        current.push(entry);
        evidenceByThread.set(entry.sourceThreadId, current);
      }
    }

    for (const [sourceThreadId, entries] of evidenceByThread.entries()) {
      const fileName = `${sanitizeArtifactSegment(sourceThreadId) || 'thread'}.md`;
      writeFileSync(
        join(evidenceDir, fileName),
        `${formatEvidenceArtifact({
          workspaceScopeKey,
          sourceThreadId,
          entries: entries.sort((left, right) => left.capturedAt.localeCompare(right.capturedAt)),
          candidateIndex,
          itemIndex
        })}\n`,
        'utf8'
      );
    }
  }

  consolidateWorkspaceScope(workspaceScopeKey: string): GeneratedMemoryItem[] {
    const candidates = this.db
      .listGeneratedMemoryCandidates(workspaceScopeKey)
      .filter((candidate) => candidate.status !== 'rejected' && candidate.status !== 'expired');
    if (candidates.length === 0) {
      return [];
    }

    const existingItemsByKey = new Map(
      this.db.listGeneratedMemoryItems(workspaceScopeKey).map((item) => [createItemIndexKey(item.kind, item.detail), item] as const)
    );
    const consolidatedItems: GeneratedMemoryItem[] = [];

    for (const candidate of candidates) {
      const candidateEvidence = this.db.listGeneratedMemoryEvidenceForCandidate(candidate.id);
      if (candidateEvidence.length === 0) {
        continue;
      }

      const itemKey = createItemIndexKey(candidate.kind, candidate.detail);
      const existingItem = existingItemsByKey.get(itemKey) ?? null;
      const updatedAt = new Date().toISOString();
      const mergedItemEvidence = mergeEvidence(
        existingItem ? this.db.listGeneratedMemoryEvidenceForItem(existingItem.id) : [],
        candidateEvidence.map(toDetachedEvidence)
      );
      const item = this.db.upsertGeneratedMemoryItem({
        id: existingItem?.id,
        workspaceScopeKey,
        projectId: candidate.projectId,
        kind: candidate.kind,
        summary: candidate.summary,
        detail: candidate.detail,
        authority: 'derived_noncanonical',
        evidenceCount: mergedItemEvidence.length,
        sourceCandidateIds: [...new Set([...(existingItem?.sourceCandidateIds ?? []), candidate.id])],
        sourceThreadIds: [...new Set(mergedItemEvidence.map((entry) => entry.sourceThreadId))],
        createdAt: existingItem?.createdAt ?? candidate.createdAt,
        updatedAt,
        lastUsedAt: existingItem?.lastUsedAt ?? null,
        useCount: existingItem?.useCount ?? 0,
        disabledAt: existingItem?.disabledAt ?? null
      });
      this.db.replaceGeneratedMemoryEvidenceForItem(item.id, mergedItemEvidence);
      existingItemsByKey.set(itemKey, item);
      consolidatedItems.push(item);

      if (candidate.status !== 'consolidated') {
        this.db.upsertGeneratedMemoryCandidate({
          workspaceScopeKey,
          projectId: candidate.projectId,
          sourceThreadId: candidate.sourceThreadId,
          sourceRunId: candidate.sourceRunId,
          sourceTurnIds: candidate.sourceTurnIds,
          kind: candidate.kind,
          summary: candidate.summary,
          detail: candidate.detail,
          evidenceExcerpt: candidate.evidenceExcerpt,
          dedupeKey: candidate.dedupeKey,
          status: 'consolidated',
          createdAt: candidate.createdAt,
          updatedAt
        });
      }
    }

    return [...new Map(consolidatedItems.map((item) => [item.id, item] as const)).values()];
  }

  captureThreadCandidates(threadId: string, sourceRunId: string | null = null): GeneratedMemoryCandidate[] {
    const thread = this.db.getThread(threadId);
    const project = this.db.getProject(thread.projectId);
    if (!project.trusted || !project.folderPath) {
      return [];
    }

    const workspaceScopeKey = normalizeGeneratedMemoryWorkspaceScopeKey(project.folderPath);
    const drafts = extractCandidateDrafts(thread);
    if (drafts.length === 0) {
      return [];
    }

    const existingByDedupe = new Map(
      this.db.listGeneratedMemoryCandidates(workspaceScopeKey).map((candidate) => [candidate.dedupeKey, candidate] as const)
    );

    const persisted: GeneratedMemoryCandidate[] = [];
    for (const draft of drafts) {
      const existing = existingByDedupe.get(draft.dedupeKey) ?? null;
      const sourceTurnIds = [...new Set([...(existing?.sourceTurnIds ?? []), draft.sourceTurnId])];
      const updatedAt = new Date().toISOString();
      const candidate = this.db.upsertGeneratedMemoryCandidate({
        workspaceScopeKey,
        projectId: project.id,
        sourceThreadId: thread.id,
        sourceRunId: sourceRunId ?? draft.sourceRunId,
        sourceTurnIds,
        kind: draft.kind,
        summary: draft.summary,
        detail: draft.detail,
        evidenceExcerpt: draft.evidenceExcerpt,
        dedupeKey: draft.dedupeKey,
        status: existing?.status ?? 'proposed',
        createdAt: existing?.createdAt ?? updatedAt,
        updatedAt
      });
      const existingEvidence = existing ? this.db.listGeneratedMemoryEvidenceForCandidate(existing.id) : [];
      const mergedEvidence = mergeEvidence(existingEvidence, [
        {
          workspaceScopeKey,
          projectId: project.id,
          sourceThreadId: thread.id,
          sourceTurnIds: [draft.sourceTurnId],
          role: draft.role,
          excerpt: draft.evidenceExcerpt,
          capturedAt: draft.capturedAt
        }
      ]);
      this.db.replaceGeneratedMemoryEvidenceForCandidate(candidate.id, mergedEvidence);
      existingByDedupe.set(candidate.dedupeKey, candidate);
      persisted.push(candidate);
    }

    this.consolidateWorkspaceScope(workspaceScopeKey);
    this.syncArtifactsForWorkspaceScope(workspaceScopeKey);
    return persisted;
  }
}
