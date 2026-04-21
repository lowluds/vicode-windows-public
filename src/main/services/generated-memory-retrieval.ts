import type {
  GeneratedMemoryCandidateKind,
  GeneratedMemoryItemAuthority
} from '../../shared/domain';
import { DatabaseService } from '../../storage/database';
import { normalizeGeneratedMemoryWorkspaceScopeKey } from './generated-memory';

const DEFAULT_MAX_RESULTS = 3;
const LIVE_RECALL_ALLOWED_KINDS = new Set<GeneratedMemoryCandidateKind>(['known_pitfall']);
const GENERIC_QUERY_TERMS = new Set([
  'and',
  'the',
  'for',
  'from',
  'with',
  'into',
  'about',
  'should',
  'remember',
  'this',
  'that',
  'these',
  'those',
  'what',
  'which',
  'after',
  'before',
  'change',
  'changes',
  'choose',
  'first',
  'current',
  'active',
  'workspace',
  'thread',
  'project'
]);

const WORKFLOW_INTENT_TERMS = new Set([
  'validate',
  'validation',
  'verify',
  'verification',
  'command',
  'commands',
  'check',
  'checks',
  'test',
  'tests',
  'smoke',
  'run',
  'running',
  'step',
  'steps'
]);

const PITFALL_INTENT_TERMS = new Set([
  'avoid',
  'trap',
  'traps',
  'pitfall',
  'pitfalls',
  'wrong',
  'careful',
  'watch'
]);

const ARCHITECTURE_INTENT_TERMS = new Set([
  'file',
  'files',
  'module',
  'modules',
  'owner',
  'owns',
  'owned',
  'belongs',
  'assembly',
  'assembled',
  'prompt',
  'bridge',
  'typing',
  'architecture'
]);

const DOCS_INTENT_TERMS = new Set([
  'write',
  'draft',
  'docs',
  'document',
  'documentation',
  'note',
  'notes',
  'summary',
  'report',
  'integration',
  'guide',
  'guidance',
  'source',
  'backed',
  'pointers',
  'pointer'
]);

const PREFERENCE_INTENT_TERMS = new Set([
  'preference',
  'preferences',
  'tone',
  'format',
  'style',
  'status',
  'docs',
  'note',
  'summary'
]);

const ENVIRONMENT_INTENT_TERMS = new Set([
  'env',
  'environment',
  'install',
  'auth',
  'path',
  'runtime',
  'cli',
  'shell',
  'terminal',
  'setup',
  'model'
]);

function tieBreakPriority(kind: GeneratedMemoryCandidateKind) {
  return kind === 'user_preference_workspace_scoped' ? 1 : 0;
}

export interface GeneratedMemoryContextBlock {
  itemId: string;
  kind: GeneratedMemoryCandidateKind;
  label: 'Generated Workspace Recall (Derived, Non-Canonical)';
  summary: string;
  detail: string;
  authority: GeneratedMemoryItemAuthority;
  sourceThreadIds: string[];
  evidenceCount: number;
  score: number;
  retrievalReason: {
    kindGate: string[];
    matchedTerms: string[];
    rank: number;
  };
}

export interface RetrieveGeneratedMemoryInput {
  projectId: string;
  folderPath: string | null;
  trusted: boolean;
  query: string;
  maxResults?: number;
}

function normalizeQueryTerms(query: string) {
  return [
    ...new Set(
      (query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(
        (term) => !GENERIC_QUERY_TERMS.has(term)
      )
    )
  ];
}

function collectMatchedTerms(queryTerms: string[], value: string) {
  const haystack = value.toLowerCase();
  return queryTerms.filter((term) => haystack.includes(term));
}

interface QueryIntentSignals {
  workflowIntent: boolean;
  pitfallIntent: boolean;
  architectureIntent: boolean;
  docsIntent: boolean;
  preferenceIntent: boolean;
  environmentIntent: boolean;
}

function getQueryIntentSignals(normalizedQuery: string, queryTerms: string[]): QueryIntentSignals {
  return {
    workflowIntent:
      hasAnyTerm(queryTerms, WORKFLOW_INTENT_TERMS) ||
      matchesPhrase(normalizedQuery, ['first command', 'run first', 'first step']),
    pitfallIntent:
      hasAnyTerm(queryTerms, PITFALL_INTENT_TERMS) ||
      matchesPhrase(normalizedQuery, ['avoid doing', 'known trap', 'known traps']),
    architectureIntent:
      hasAnyTerm(queryTerms, ARCHITECTURE_INTENT_TERMS) ||
      matchesPhrase(normalizedQuery, ['which file', 'what file', 'where does', 'belongs in']),
    docsIntent:
      hasAnyTerm(queryTerms, DOCS_INTENT_TERMS) ||
      matchesPhrase(normalizedQuery, ['code pointers', 'source-backed']),
    preferenceIntent:
      hasAnyTerm(queryTerms, PREFERENCE_INTENT_TERMS) ||
      matchesPhrase(normalizedQuery, ['answer shape', 'writing style']),
    environmentIntent:
      hasAnyTerm(queryTerms, ENVIRONMENT_INTENT_TERMS) ||
      matchesPhrase(normalizedQuery, ['runtime model', 'cli auth'])
  };
}

function hasAnyTerm(queryTerms: string[], allowedTerms: Set<string>) {
  return queryTerms.some((term) => allowedTerms.has(term));
}

function matchesPhrase(query: string, phrases: string[]) {
  return phrases.some((phrase) => query.includes(phrase));
}

function getKindGateSignals(
  kind: GeneratedMemoryCandidateKind,
  signals: QueryIntentSignals
) {
  switch (kind) {
    case 'workflow_preference':
      return [
        ...(signals.workflowIntent ? ['workflow_intent'] : []),
        ...(signals.docsIntent ? ['docs_intent'] : []),
        ...(signals.environmentIntent ? ['environment_intent'] : [])
      ];
    case 'known_pitfall':
      return [
        ...(signals.workflowIntent ? ['workflow_intent'] : []),
        ...(signals.pitfallIntent ? ['pitfall_intent'] : []),
        ...(signals.environmentIntent ? ['environment_intent'] : [])
      ];
    case 'architecture_fact':
      return signals.architectureIntent ? ['architecture_intent'] : [];
    case 'workspace_convention':
      return [
        ...(signals.architectureIntent ? ['architecture_intent'] : []),
        ...(signals.docsIntent ? ['docs_intent'] : [])
      ];
    case 'environment_fact':
      return [
        ...(signals.environmentIntent ? ['environment_intent'] : []),
        ...(signals.workflowIntent ? ['workflow_intent'] : [])
      ];
    case 'user_preference_workspace_scoped':
      return [
        ...(signals.preferenceIntent ? ['preference_intent'] : []),
        ...(signals.docsIntent ? ['docs_intent'] : [])
      ];
    default:
      return [];
  }
}

function scoreValue(queryTerms: string[], value: string) {
  if (queryTerms.length === 0) {
    return 0;
  }

  const haystack = value.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (haystack.includes(term)) {
      score += 1;
    }
  }
  return score;
}

export class GeneratedMemoryRetrievalService {
  constructor(private readonly db: DatabaseService) {}

  retrieveRelevantMemory(input: RetrieveGeneratedMemoryInput): GeneratedMemoryContextBlock[] {
    if (!input.trusted || !input.folderPath || !input.query.trim()) {
      return [];
    }

    const normalizedQuery = input.query.trim().toLowerCase();
    const queryTerms = normalizeQueryTerms(input.query);
    if (queryTerms.length === 0) {
      return [];
    }
    const queryIntentSignals = getQueryIntentSignals(normalizedQuery, queryTerms);

    const workspaceScopeKey = normalizeGeneratedMemoryWorkspaceScopeKey(input.folderPath);
    return this.db
      .listGeneratedMemoryItems(workspaceScopeKey)
      .filter((item) => item.disabledAt == null)
      .filter((item) => LIVE_RECALL_ALLOWED_KINDS.has(item.kind))
      .map((item) => ({
        item,
        kindGate: getKindGateSignals(item.kind, queryIntentSignals)
      }))
      .filter((entry) => entry.kindGate.length > 0)
      .map((item) => ({
        item: item.item,
        kindGate: item.kindGate,
        matchedTerms: collectMatchedTerms(
          queryTerms,
          [item.item.summary, item.item.detail].filter(Boolean).join('\n')
        ),
        score: scoreValue(queryTerms, [item.item.summary, item.item.detail].filter(Boolean).join('\n'))
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (tieBreakPriority(left.item.kind) !== tieBreakPriority(right.item.kind)) {
          return tieBreakPriority(left.item.kind) - tieBreakPriority(right.item.kind);
        }
        return right.item.updatedAt.localeCompare(left.item.updatedAt);
      })
      .slice(0, input.maxResults ?? DEFAULT_MAX_RESULTS)
      .map(({ item, score, kindGate, matchedTerms }, index) => ({
        itemId: item.id,
        kind: item.kind,
        label: 'Generated Workspace Recall (Derived, Non-Canonical)',
        summary: item.summary,
        detail: item.detail,
        authority: item.authority,
        sourceThreadIds: item.sourceThreadIds,
        evidenceCount: item.evidenceCount,
        score,
        retrievalReason: {
          kindGate,
          matchedTerms,
          rank: index + 1
        }
      }));
  }
}
