export type AssistantTextQualityIssueKind =
  | 'split_word_fragment'
  | 'split_domain_fragment'
  | 'split_acronym_fragment'
  | 'missing_space_after_acronym'
  | 'missing_space_after_punctuation'
  | 'jammed_ampersand'
  | 'broken_numeric_spacing'
  | 'broken_possessive_spacing';

export type AssistantTextQualitySeverity = 'ok' | 'warning';

export type SuspiciousAssistantTextPatternLabel =
  | 'split-word-fragment'
  | 'split-domain-fragment'
  | 'split-suffix-fragment'
  | 'split-acronym-fragment'
  | 'split-hyphen-fragment'
  | 'missing-space-after-acronym'
  | 'missing-space-after-punctuation'
  | 'split-year'
  | 'split-ordinal'
  | 'broken-possessive'
  | 'missing-space-after-apostrophe'
  | 'missing-space-after-ordinal'
  | 'missing-space-after-decade'
  | 'missing-space-before-quote'
  | 'jammed-ampersand';

export interface AssistantTextQualityIssue {
  kind: AssistantTextQualityIssueKind;
  label: SuspiciousAssistantTextPatternLabel;
  evidence: string;
}

export interface AssistantTextQualitySummary {
  severity: AssistantTextQualitySeverity;
  issueCount: number;
  issues: AssistantTextQualityIssue[];
}

const HARD_SUSPICIOUS_TEXT_PATTERNS: Array<{
  label: SuspiciousAssistantTextPatternLabel;
  kind: AssistantTextQualityIssueKind;
  pattern: RegExp;
}> = [
  { label: 'split-year', kind: 'broken_numeric_spacing', pattern: /\b\d(?:\s\d){2,}\b/u },
  { label: 'split-ordinal', kind: 'broken_numeric_spacing', pattern: /\b\d+\s(?:st|nd|rd|th)\b/iu },
  { label: 'broken-possessive', kind: 'broken_possessive_spacing', pattern: /\b[A-Za-z]+\s'(?=s\b)/u },
  {
    label: 'missing-space-after-apostrophe',
    kind: 'broken_possessive_spacing',
    pattern: /\b[A-Za-z]+['’](?:s|d|ll|re|ve|m|t)(?=[A-Za-z])/u
  },
  {
    label: 'missing-space-after-ordinal',
    kind: 'broken_numeric_spacing',
    pattern: /\b\d+(?:st|nd|rd|th)(?=[A-Za-z])/iu
  },
  { label: 'missing-space-after-decade', kind: 'broken_numeric_spacing', pattern: /\b\d{3,4}s(?=[A-Za-z])/u },
  { label: 'missing-space-before-quote', kind: 'missing_space_after_punctuation', pattern: /[A-Za-z0-9],["“]/u },
  {
    label: 'missing-space-after-punctuation',
    kind: 'missing_space_after_punctuation',
    pattern: /[a-z0-9][,;:](?=[A-Za-z])/u
  },
  {
    label: 'missing-space-after-acronym',
    kind: 'missing_space_after_acronym',
    pattern: /\b[A-Z]{2,6}[a-z]{3,24}\b/u
  }
];

const WORD_CONTINUATION_SUFFIXES = new Set([
  'action',
  'actions',
  'actoring',
  'ancing',
  'arded',
  'ational',
  'ationally',
  'ative',
  'ators',
  'ausal',
  'ate',
  'ed',
  'er',
  'ers',
  'es',
  'est',
  'iguous',
  'icking',
  'inement',
  'ing',
  'ism',
  'ist',
  'ists',
  'ition',
  'ization',
  'izations',
  'istic',
  'ity',
  'ive',
  'ives',
  'ized',
  'izes',
  'izing',
  'ly',
  'ment',
  'ness',
  'onym',
  'onymous',
  'onymity',
  'ulation'
]);

const COMMON_SHORT_WORDS = new Set([
  'a',
  'all',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'do',
  'for',
  'go',
  'has',
  'he',
  'her',
  'his',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'let',
  'me',
  'my',
  'no',
  'not',
  'now',
  'of',
  'on',
  'or',
  'our',
  'so',
  'the',
  'this',
  'that',
  'to',
  'too',
  'up',
  'us',
  'was',
  'we',
  'with',
  'what',
  'when',
  'where',
  'who',
  'why',
  'you',
  'your'
]);

const COMMON_STANDALONE_WORDS = new Set([
  ...COMMON_SHORT_WORDS,
  'about',
  'after',
  'also',
  'app',
  'apps',
  'asking',
  'both',
  'code',
  'common',
  'css',
  'data',
  'facts',
  'file',
  'files',
  'firmly',
  'html',
  'item',
  'items',
  'key',
  'keys',
  'model',
  'models',
  'now',
  'start',
  'team',
  'teams',
  'test',
  'tests',
  'use',
  'uses',
  'using',
  'well',
  'world'
]);

const COMPACT_TECHNICAL_TERMS = new Set([
  'api',
  'cli',
  'cpu',
  'css',
  'db',
  'git',
  'gpt',
  'gpu',
  'html',
  'http',
  'https',
  'ide',
  'ipc',
  'json',
  'jsx',
  'llm',
  'llms',
  'mcp',
  'npm',
  'ram',
  'sql',
  'tsx',
  'ui',
  'url',
  'urls',
  'ux',
  'vram',
  'xml'
]);

function stripEdgePunctuation(token: string) {
  return token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/gu, '');
}

function isPlainWord(value: string) {
  return /^[A-Za-z]+$/u.test(value);
}

function isAcronym(value: string) {
  return /^[A-Z]{2,6}$/u.test(value);
}

function isCompactTechnicalSplit(left: string, right: string) {
  return COMPACT_TECHNICAL_TERMS.has(`${left}${right}`.toLowerCase());
}

function pushUniqueIssue(issues: AssistantTextQualityIssue[], issue: AssistantTextQualityIssue | null) {
  if (!issue || issues.some((entry) => entry.label === issue.label)) {
    return;
  }
  issues.push(issue);
}

function issue(
  label: SuspiciousAssistantTextPatternLabel,
  kind: AssistantTextQualityIssueKind,
  evidence: string
): AssistantTextQualityIssue {
  return {
    kind,
    label,
    evidence: evidence.trim()
  };
}

function classifySpacedBoundary(leftToken: string, rightToken: string): AssistantTextQualityIssue | null {
  const left = stripEdgePunctuation(leftToken);
  const right = stripEdgePunctuation(rightToken);
  if (!left || !right) {
    return null;
  }

  const leftLower = left.toLowerCase();
  const rightLower = right.toLowerCase();
  const leftPlainWord = isPlainWord(left);
  const rightPlainWord = isPlainWord(right);
  const evidence = `${leftToken} ${rightToken}`;

  if (/[,.!?;:)]$/u.test(leftToken) || /^[([{"'“‘]/u.test(rightToken)) {
    return null;
  }

  if (leftPlainWord && rightPlainWord && isCompactTechnicalSplit(left, right)) {
    return issue('split-acronym-fragment', 'split_acronym_fragment', evidence);
  }

  if (
    leftPlainWord
    && rightPlainWord
    && (
      (/^[A-Z]$/u.test(left)
        && !COMMON_SHORT_WORDS.has(leftLower)
        && (/^[A-Z]{2,4}$/u.test(right) || /^[A-Z][a-z]{1,3}$/u.test(right) || /^[a-z]{3,}$/u.test(right)))
      || (isAcronym(left) && (/^[A-Z]{1,4}$/u.test(right) || /^[A-Z][a-z]{1,3}$/u.test(right)))
    )
    && !COMMON_SHORT_WORDS.has(rightLower)
  ) {
    return issue('split-acronym-fragment', 'split_acronym_fragment', evidence);
  }

  if (/^[A-Za-z]+(?:-[A-Za-z]+)*-[A-Za-z]$/u.test(leftToken) && /^[a-z]{2,}$/u.test(right)) {
    return issue('split-hyphen-fragment', 'split_word_fragment', evidence);
  }

  if (leftPlainWord && rightPlainWord && WORD_CONTINUATION_SUFFIXES.has(rightLower)) {
    return issue('split-suffix-fragment', 'split_word_fragment', evidence);
  }

  if (
    leftPlainWord
    && rightPlainWord
    && !isAcronym(left)
    && !COMMON_SHORT_WORDS.has(leftLower)
    && !COMMON_STANDALONE_WORDS.has(leftLower)
    && !COMMON_STANDALONE_WORDS.has(rightLower)
    && (
      (left.length <= 2 && /^[a-z]+$/u.test(left) && /^[a-z][A-Za-z-]{2,}$/u.test(right))
      || (left.length <= 3 && /^[A-Z][a-z]+$/u.test(left) && /^[a-z][A-Za-z-]{1,7}$/u.test(right))
      || (left.length <= 5 && /^[A-Z][a-z]+$/u.test(left) && /^[a-z]{1,2}$/u.test(right))
      || (left.length <= 3 && /^[a-z]+$/u.test(left) && /^[a-z]{1,2}$/u.test(right))
    )
  ) {
    return issue('split-word-fragment', 'split_word_fragment', evidence);
  }

  if (
    leftPlainWord
    && rightPlainWord
    && !isAcronym(left)
    && !isAcronym(right)
    && !COMMON_STANDALONE_WORDS.has(leftLower)
    && !COMMON_STANDALONE_WORDS.has(rightLower)
    && (
      (/^[A-Z][a-z]{2,4}$/u.test(left) && /^[a-z]{3,4}$/u.test(right) && left.length + right.length <= 10)
    )
  ) {
    return issue('split-word-fragment', 'split_word_fragment', evidence);
  }

  return null;
}

function classifyJammedAcronym(match: RegExpMatchArray): AssistantTextQualityIssue | null {
  const left = match[1] ?? '';
  const right = match[2] ?? '';
  const rightLower = right.toLowerCase();
  if (isAcronym(left) && /^[a-z]{3,}$/u.test(right) && !COMMON_SHORT_WORDS.has(rightLower)) {
    return issue('missing-space-after-acronym', 'missing_space_after_acronym', match[0] ?? '');
  }
  return null;
}

export function findAssistantTextQualityIssues(text: string): AssistantTextQualityIssue[] {
  if (!text.trim()) {
    return [];
  }

  const issues: AssistantTextQualityIssue[] = [];

  for (const check of HARD_SUSPICIOUS_TEXT_PATTERNS) {
    const match = check.pattern.exec(text);
    if (match) {
      pushUniqueIssue(issues, issue(check.label, check.kind, match[0] ?? check.label));
    }
    check.pattern.lastIndex = 0;
  }

  for (const match of text.matchAll(/\b([A-Za-z]+)&([A-Za-z]+)\b/gu)) {
    const left = match[1] ?? '';
    const right = match[2] ?? '';
    const looksLikeCompactAcronym = /^[A-Z]{1,3}$/u.test(left) && /^[A-Z]{1,3}$/u.test(right);
    if (!looksLikeCompactAcronym) {
      pushUniqueIssue(issues, issue('jammed-ampersand', 'jammed_ampersand', match[0] ?? ''));
      break;
    }
  }

  for (const line of text.split('\n')) {
    if (/^\s{0,3}#{1,6}\s+/u.test(line)) {
      continue;
    }

    const parts = line.split(/(\s+)/u);
    for (let index = 0; index < parts.length - 2; index += 1) {
      const left = parts[index];
      const whitespace = parts[index + 1];
      const right = parts[index + 2];

      if (!left || !right || !whitespace) {
        continue;
      }

      pushUniqueIssue(issues, classifySpacedBoundary(left, right));
    }
  }

  for (const match of text.matchAll(/\b([A-Z]{2,6})([a-z]{3,24})\b/gu)) {
    pushUniqueIssue(issues, classifyJammedAcronym(match));
  }

  if (
    /\bhttps?:\/\/[a-z0-9-]{2,24}\s+[a-z0-9-]{2,24}(?=(?:\s+[a-z0-9-]{2,24})*\.[a-z0-9-]{2,24}(?:[/?#]|\b|$))/u.test(text)
  ) {
    pushUniqueIssue(issues, issue('split-domain-fragment', 'split_domain_fragment', 'split URL or domain'));
  }

  if (
    /[\\/][A-Za-z0-9-]{2,24}\s+[A-Za-z0-9-]{2,24}(?=(?:\s+[A-Za-z0-9-]{2,24})*(?:[\\/]|$))/u.test(text)
  ) {
    pushUniqueIssue(issues, issue('split-domain-fragment', 'split_domain_fragment', 'split path segment'));
  }

  return issues;
}

export function findSuspiciousAssistantTextPatternLabels(text: string): SuspiciousAssistantTextPatternLabel[] {
  return findAssistantTextQualityIssues(text).map((entry) => entry.label);
}

export function computeAssistantTextQualityDebt(findings: string[]) {
  return findings.reduce((total, finding) => {
    switch (finding) {
      case 'split-domain-fragment':
        return total + 7;
      case 'split-acronym-fragment':
      case 'missing-space-after-acronym':
      case 'split-year':
      case 'split-ordinal':
      case 'broken-possessive':
      case 'missing-space-after-apostrophe':
      case 'missing-space-after-ordinal':
      case 'missing-space-after-decade':
      case 'missing-space-before-quote':
      case 'missing-space-after-punctuation':
        return total + 5;
      case 'split-suffix-fragment':
      case 'split-word-fragment':
      case 'split-hyphen-fragment':
        return total + 4;
      case 'jammed-ampersand':
        return total + 3;
      default:
        return total + 1;
    }
  }, 0);
}

export function detectAssistantTextQuality(text: string): AssistantTextQualitySummary {
  const issues = findAssistantTextQualityIssues(text);
  return {
    severity: issues.length > 0 ? 'warning' : 'ok',
    issueCount: issues.length,
    issues
  };
}
