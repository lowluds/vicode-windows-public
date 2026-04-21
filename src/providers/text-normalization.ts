export interface AssistantTextNormalizationOptions {
  stripXmlFunctionCallMarkup?: boolean;
  stripReasoningLabels?: boolean;
  preserveLeadingBreaks?: boolean;
}

interface AssistantTextResolution {
  text: string;
  delta: string;
}

export interface AssistantTextDeltaResolution extends AssistantTextResolution {
  normalizedChunk: string;
  replace: boolean;
}

export interface AssistantTextSnapshotResolution extends AssistantTextResolution {
  snapshotText: string;
  replace: boolean;
}

export type AssistantTextBoundaryFinding =
  | 'split-word-fragment'
  | 'split-domain-fragment'
  | 'split-suffix-fragment'
  | 'split-acronym-fragment'
  | 'split-hyphen-fragment'
  | 'missing-space-after-acronym';

type AssistantTextBoundaryMode = 'spaced' | 'jammed';
type AssistantTextBoundaryAction = 'keep' | 'join' | 'space';
type AppendCandidateKind = 'direct' | 'spaced' | 'paragraph';

interface AssistantTextBoundaryDecision {
  action: AssistantTextBoundaryAction;
  finding: AssistantTextBoundaryFinding | null;
}

interface AssistantTextInspection {
  normalizedText: string;
  findings: string[];
  debt: number;
}

interface AssistantTextAppendBoundaryContext {
  trailingWord: string | null;
  leadingWord: string | null;
  trimmedCurrent: string;
  trimmedChunk: string;
  chunkStartsWithWhitespace: boolean;
  chunkStartsWithNewline: boolean;
  prefersParagraphBreak: boolean;
}

interface AssistantTextAppendCandidate {
  kind: AppendCandidateKind;
  text: string;
}

export interface AssistantVisibleTextReducer {
  normalize: (value: string) => string;
  inspect: (value: string) => AssistantTextInspection;
  appendDelta: (current: string, rawChunk: string) => AssistantTextDeltaResolution;
  preferText: (current: string, rawCandidate: string) => string;
  reconcileSnapshot: (
    current: string,
    currentSnapshot: string,
    rawSnapshot: string
  ) => AssistantTextSnapshotResolution;
}

const COMMON_SHORT_TITLECASE_WORDS = new Set([
  'And',
  'Are',
  'Big',
  'But',
  'Can',
  'For',
  'Has',
  'Her',
  'Here',
  'His',
  'How',
  'Low',
  'Not',
  'Old',
  'Red',
  'The',
  'This',
  'That',
  'Top',
  'Was',
  'What',
  'When',
  'Where',
  'Who',
  'Why',
  'You',
  'Your'
]);

const COMMON_SHORT_LOWERCASE_WORDS = new Set(
  [...COMMON_SHORT_TITLECASE_WORDS].map((word) => word.toLowerCase()).concat([
    'a',
    'add',
    'all',
    'an',
    'any',
    'as',
    'at',
    'be',
    'by',
    'do',
    'end',
    'far',
    'few',
    'go',
    'got',
    'he',
    'i',
    'if',
    'in',
    'is',
    'it',
    'let',
    'me',
    'my',
    'new',
    'no',
    'now',
    'of',
    'off',
    'on',
    'or',
    'our',
    'out',
    'own',
    'per',
    'put',
    'see',
    'set',
    'so',
    'to',
    'too',
    'up',
    'use',
    'us',
    'we',
    'yes'
  ])
);

const COMMON_STANDALONE_WORDS = new Set([
  ...COMMON_SHORT_LOWERCASE_WORDS,
  'about',
  'after',
  'also',
  'animated',
  'answer',
  'background',
  'basic',
  'before',
  'between',
  'block',
  'blocks',
  'border',
  'borders',
  'breakpoint',
  'breakpoints',
  'build',
  'building',
  'button',
  'buttons',
  'class',
  'classes',
  'cloud',
  'clouds',
  'code',
  'components',
  'content',
  'css',
  'custom',
  'data',
  'dark',
  'directly',
  'documentation',
  'each',
  'effect',
  'effects',
  'exact',
  'fact',
  'facts',
  'feature',
  'features',
  'file',
  'files',
  'folder',
  'folders',
  'follow',
  'footer',
  'form',
  'forms',
  'free',
  'frontend',
  'function',
  'functions',
  'fun',
  'generate',
  'gradient',
  'header',
  'headers',
  'html',
  'hover',
  'icon',
  'icons',
  'image',
  'images',
  'issue',
  'issues',
  'javascript',
  'key',
  'layout',
  'library',
  'libraries',
  'light',
  'line',
  'lines',
  'look',
  'message',
  'messages',
  'major',
  'mobile',
  'mode',
  'model',
  'models',
  'navigation',
  'online',
  'open',
  'output',
  'outputs',
  'page',
  'pages',
  'panel',
  'panels',
  'part',
  'parts',
  'placeholder',
  'project',
  'projects',
  'prompt',
  'prompts',
  'public',
  'reply',
  'replies',
  'responsive',
  'scroll',
  'section',
  'sections',
  'shader',
  'shadow',
  'shadows',
  'similar',
  'site',
  'sites',
  'smooth',
  'source',
  'standard',
  'starter',
  'style',
  'styles',
  'styling',
  'surface',
  'surfaces',
  'summary',
  'template',
  'templates',
  'text',
  'thread',
  'threads',
  'time',
  'title',
  'titles',
  'tool',
  'tools',
  'triggered',
  'well',
  'shell',
  'user',
  'users',
  'using',
  'visual',
  'website',
  'websites',
  'weight',
  'weights',
  'work',
  'workspace'
]);

const DISPLAY_WORD_CONTINUATION_SUFFIXES = new Set([
  'action',
  'actions',
  'actoring',
  'ancing',
  'arded',
  'ational',
  'ationally',
  'ative',
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

const JAMMED_FOLLOW_UP_PROMPT_PATTERN =
  /([A-Za-z0-9”")\]])(Let me know if|If you'd like|If you want|Tell me if|I can also|Want me to|Would you like me to|Need me to|Should I|Can I)\b/gu;

const HARD_SUSPICIOUS_TEXT_PATTERNS = [
  { label: 'split-year', pattern: /\b\d(?:\s\d){2,}\b/u },
  { label: 'split-ordinal', pattern: /\b\d+\s(?:st|nd|rd|th)\b/iu },
  { label: 'broken-possessive', pattern: /\b[A-Za-z]+\s'(?=s\b)/u },
  { label: 'missing-space-after-apostrophe', pattern: /\b[A-Za-z]+['’](?:s|d|ll|re|ve|m|t)(?=[A-Za-z])/u },
  { label: 'missing-space-after-ordinal', pattern: /\b\d+(?:st|nd|rd|th)(?=[A-Za-z])/iu },
  { label: 'missing-space-after-decade', pattern: /\b\d{3,4}s(?=[A-Za-z])/u },
  { label: 'missing-space-before-quote', pattern: /[A-Za-z0-9],["“]/u },
  { label: 'missing-space-after-acronym', pattern: /\b[A-Z]{2,6}[a-z]{3,24}\b/u }
] as const;

function pushUniqueFinding(findings: string[], value: string) {
  if (!findings.includes(value)) {
    findings.push(value);
  }
}

function stripEdgePunctuation(token: string) {
  return token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/gu, '');
}

function isPlainWord(value: string) {
  return /^[A-Za-z]+$/u.test(value);
}

function isAcronym(value: string) {
  return /^[A-Z]{2,6}$/u.test(value);
}

function isCommonShortWord(value: string) {
  return COMMON_SHORT_LOWERCASE_WORDS.has(value);
}

function isCommonStandaloneWord(value: string) {
  return COMMON_STANDALONE_WORDS.has(value);
}

function isContinuationFragment(value: string) {
  return DISPLAY_WORD_CONTINUATION_SUFFIXES.has(value);
}

function isContractionFragment(value: string) {
  return ['s', 't', 'd', 'll', 're', 've', 'm'].includes(value);
}

function classifyAssistantTextBoundary(
  leftToken: string,
  rightToken: string,
  mode: AssistantTextBoundaryMode
): AssistantTextBoundaryDecision {
  const left = stripEdgePunctuation(leftToken);
  const right = stripEdgePunctuation(rightToken);
  if (!left || !right) {
    return { action: 'keep', finding: null };
  }

  const leftLower = left.toLowerCase();
  const rightLower = right.toLowerCase();
  const leftPlainWord = isPlainWord(left);
  const rightPlainWord = isPlainWord(right);

  if (mode === 'jammed') {
    if (isAcronym(left) && /^[a-z]{3,}$/u.test(right) && !isCommonShortWord(rightLower)) {
      return { action: 'space', finding: 'missing-space-after-acronym' };
    }
    return { action: 'keep', finding: null };
  }

  if (
    isCommonShortWord(leftLower)
    || isCommonShortWord(rightLower)
    || isContractionFragment(leftLower)
    || isContractionFragment(rightLower)
  ) {
    return { action: 'keep', finding: null };
  }

  if (
    leftPlainWord &&
    rightPlainWord &&
    /^[A-Z]$/u.test(left) &&
    (/^[A-Z]{2,4}$/u.test(right) || /^[A-Z][a-z]{1,3}$/u.test(right) || /^[a-z]{3,}$/u.test(right))
  ) {
    return { action: 'join', finding: 'split-acronym-fragment' };
  }

  if (
    leftPlainWord &&
    rightPlainWord &&
    isAcronym(left) &&
    (/^[A-Z]{1,4}$/u.test(right) || /^[A-Z][a-z]{1,3}$/u.test(right))
  ) {
    return { action: 'join', finding: 'split-acronym-fragment' };
  }

  if (
    leftPlainWord &&
    rightPlainWord &&
    /^[A-Z]{2,}[a-z]{1,2}$/u.test(left) &&
    isAcronym(right)
  ) {
    return { action: 'join', finding: 'split-acronym-fragment' };
  }

  if (/^[A-Za-z]+-[A-Za-z]$/u.test(leftToken) && /^[a-z]{2,}$/u.test(right)) {
    return { action: 'join', finding: 'split-hyphen-fragment' };
  }

  if (
    leftPlainWord &&
    rightPlainWord &&
    /^[A-Za-z]{2,24}$/u.test(left) &&
    isContinuationFragment(rightLower)
  ) {
    return { action: 'join', finding: 'split-suffix-fragment' };
  }

  if (
    leftPlainWord &&
    rightPlainWord &&
    !isAcronym(left) &&
    (
      (left.length <= 2 && /^[A-Za-z]+$/u.test(left) && /^[a-z][A-Za-z-]{2,}$/u.test(right))
      || (left.length <= 3 && /^[A-Z][a-z]+$/u.test(left) && /^[a-z][A-Za-z-]{1,7}$/u.test(right))
      || (left.length <= 5 && /^[A-Z][a-z]+$/u.test(left) && /^[a-z]{1,2}$/u.test(right))
      || (left.length <= 3 && /^[a-z]+$/u.test(left) && /^[a-z]{1,2}$/u.test(right))
    )
  ) {
    return { action: 'join', finding: 'split-word-fragment' };
  }

  if (
    leftPlainWord &&
    rightPlainWord &&
    !isAcronym(left) &&
    !isAcronym(right) &&
    !isCommonStandaloneWord(leftLower) &&
    !isCommonStandaloneWord(rightLower) &&
    /^[A-Z][a-z]{2,3}$/u.test(left) &&
    /^[a-z]{3,4}$/u.test(right) &&
    left.length + right.length <= 10
  ) {
    return { action: 'join', finding: 'split-word-fragment' };
  }

  if (
    leftPlainWord &&
    rightPlainWord &&
    !isAcronym(left) &&
    !isAcronym(right) &&
    !isCommonStandaloneWord(leftLower) &&
    !isCommonStandaloneWord(rightLower) &&
    /^[a-z]{3}$/u.test(left) &&
    /^[a-z]{4,8}$/u.test(right) &&
    left.length + right.length <= 11
  ) {
    return { action: 'join', finding: 'split-word-fragment' };
  }

  return { action: 'keep', finding: null };
}

function findSuspiciousTextBoundaryFindings(text: string) {
  const findings: AssistantTextBoundaryFinding[] = [];
  const pushFinding = (value: AssistantTextBoundaryFinding | null) => {
    if (value && !findings.includes(value)) {
      findings.push(value);
    }
  };

  const parts = text.split(/(\s+)/u);
  for (let index = 0; index < parts.length - 2; index += 1) {
    const left = parts[index];
    const whitespace = parts[index + 1];
    const right = parts[index + 2];

    if (!left || !right || !whitespace || whitespace.includes('\n')) {
      continue;
    }

    pushFinding(classifyAssistantTextBoundary(left, right, 'spaced').finding);
  }

  for (const match of text.matchAll(/\b([A-Z]{2,6})([a-z]{3,24})\b/gu)) {
    pushFinding(classifyAssistantTextBoundary(match[1] ?? '', match[2] ?? '', 'jammed').finding);
  }

  if (
    /\bhttps?:\/\/[a-z0-9-]{2,24}\s+[a-z0-9-]{2,24}(?=(?:\s+[a-z0-9-]{2,24})*\.[a-z0-9-]{2,24}(?:[/?#]|\b|$))/u.test(text)
  ) {
    pushFinding('split-domain-fragment');
  }

  return findings;
}

function repairSuspiciousTextBoundaries(content: string) {
  const segments = content.split(/(```[\s\S]*?```)/gu);

  return segments
    .map((segment) => {
      if (segment.startsWith('```')) {
        return segment;
      }

      let repaired = segment;

      for (let pass = 0; pass < 4; pass += 1) {
        const next = repaired.replace(
          /\b(https?:\/\/[a-z0-9-]{2,24})[ \t]+([a-z0-9-]{2,24})(?=(?:[ \t]+[a-z0-9-]{2,24})*\.[a-z0-9-]{2,24}(?:[/?#]|\b|$))/gu,
          '$1$2'
        );
        if (next === repaired) {
          break;
        }
        repaired = next;
      }

      for (let pass = 0; pass < 4; pass += 1) {
        const next = repaired.replace(
          /([\\/])([A-Za-z0-9-]{2,24})[ \t]+([A-Za-z0-9-]{2,24})(?=(?:[ \t]+[A-Za-z0-9-]{2,24})*(?:[\\/]|$))/gu,
          '$1$2$3'
        );
        if (next === repaired) {
          break;
        }
        repaired = next;
      }

      repaired = repaired.replace(/\b([Kk]ey)\s+frames?\b/gu, (match, key) =>
        /s$/u.test(match) ? `${key}frames` : `${key}frame`
      );

      repaired = repaired.replace(
        /\b([A-Z]{2,6})([a-z]{3,24})\b/gu,
        (match, left, right) => {
          const decision = classifyAssistantTextBoundary(left, right, 'jammed');
          return decision.action === 'space' ? `${left} ${right}` : match;
        }
      );

      for (let pass = 0; pass < 4; pass += 1) {
        let changed = false;
        const next = repaired
          .split('\n')
          .map((line) => {
            if (/^\s{0,3}#{1,6}\s+/u.test(line)) {
              return line;
            }

            const parts = line.split(/([ \t]+)/u);
            const nextParts: string[] = [];

            for (let index = 0; index < parts.length; ) {
              const left = parts[index] ?? '';
              const whitespace = parts[index + 1];
              const right = parts[index + 2];

              if (
                typeof whitespace === 'string'
                && /^[ \t]+$/u.test(whitespace)
                && typeof right === 'string'
              ) {
                const decision = classifyAssistantTextBoundary(left, right, 'spaced');
                if (decision.action === 'join') {
                  nextParts.push(`${left}${right}`);
                  index += 3;
                  changed = true;
                  continue;
                }
              }

              nextParts.push(left);
              index += 1;
            }

            return nextParts.join('');
          })
          .join('\n')
          .replace(/^(\s{0,3}#{1,6})(?=\S)/gmu, '$1 ');

        if (!changed || next === repaired) {
          break;
        }
        repaired = next;
      }

      return repaired;
    })
    .join('');
}

function normalizeReadablePunctuationSpacing(content: string) {
  if (!content || /`/u.test(content)) {
    return content;
  }

  return content
    .replace(/([,;:])(?=(?:["“(\[])?[A-Za-z])/gu, '$1 ')
    .replace(/([.?!])(?=(?:["“(\[])?[A-Z])/gu, '$1 ')
    .replace(/([”")\]])(?=[A-Za-z])/gu, '$1 ');
}

function normalizeReadablePromptSpacing(content: string, separator: 'space' | 'paragraph' = 'space') {
  if (!content) {
    return content;
  }

  const joiner = separator === 'paragraph' ? '\n\n' : ' ';
  return content.replace(JAMMED_FOLLOW_UP_PROMPT_PATTERN, `$1${joiner}$2`);
}

function stripXmlFunctionCallMarkup(content: string) {
  return content.replace(/<function_calls>[\s\S]*?<\/function_calls>/giu, '');
}

function collectAssistantTextFindings(text: string) {
  const findings: string[] = [];

  for (const check of HARD_SUSPICIOUS_TEXT_PATTERNS) {
    if (check.pattern.test(text)) {
      findings.push(check.label);
    }
  }

  for (const match of text.matchAll(/\b([A-Za-z]+)&([A-Za-z]+)\b/gu)) {
    const left = match[1] ?? '';
    const right = match[2] ?? '';
    const looksLikeCompactAcronym =
      /^[A-Z]{1,3}$/u.test(left) &&
      /^[A-Z]{1,3}$/u.test(right);
    if (!looksLikeCompactAcronym) {
      pushUniqueFinding(findings, 'jammed-ampersand');
      break;
    }
  }

  for (const finding of findSuspiciousTextBoundaryFindings(text)) {
    pushUniqueFinding(findings, finding);
  }

  return findings;
}

function computeFindingDebt(findings: string[]) {
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

function normalizeAssistantVisibleTextCore(
  content: string,
  options: AssistantTextNormalizationOptions = {}
) {
  if (!content) {
    return '';
  }

  let normalized = content.replace(/\r\n/g, '\n');

  if (options.stripXmlFunctionCallMarkup) {
    normalized = stripXmlFunctionCallMarkup(normalized);
  }

  if (options.stripReasoningLabels) {
    normalized = normalized
      .split(/\r?\n/u)
      .filter((line) => !/^\s*(thought|thinking|internal reasoning|reasoning)\s*:/iu.test(line))
      .join('\n');
  }

  let collapsed = normalized
    .replace(/\n{3,}/gu, '\n\n')
    .split('\n')
    .map((line) => normalizeReadablePunctuationSpacing(line))
    .join('\n')
    .replace(JAMMED_FOLLOW_UP_PROMPT_PATTERN, '$1 $2');

  collapsed = repairSuspiciousTextBoundaries(collapsed);

  if (options.preserveLeadingBreaks) {
    return collapsed;
  }

  return collapsed.replace(/^\s*\n+/u, '');
}

function inspectAssistantVisibleText(
  value: string,
  options: AssistantTextNormalizationOptions = {}
): AssistantTextInspection {
  const normalizedText = normalizeAssistantVisibleTextCore(value, options);
  const findings = collectAssistantTextFindings(value);
  let debt = computeFindingDebt(findings);
  if (normalizedText !== value) {
    debt += 1;
  }
  return {
    normalizedText,
    findings,
    debt
  };
}

function compactComparableText(value: string) {
  return value.replace(/\s+/gu, '');
}

function endsWithOrderedListMarker(value: string) {
  return /(?:^|\n)\s*(?:\*\*)?\d+\.(?:\*\*)?$/u.test(value);
}

function createAppendBoundaryContext(current: string, chunk: string): AssistantTextAppendBoundaryContext {
  const trimmedCurrent = current.trimEnd();
  const trimmedChunk = chunk.replace(/^\s+/u, '');
  const trailingWord = trimmedCurrent.match(/([A-Za-z]{1,24})$/u)?.[1] ?? null;
  const leadingWord = trimmedChunk.match(/^([A-Za-z]{1,24})/u)?.[1] ?? null;
  const chunkStartsWithWhitespace = /^\s/u.test(chunk);
  const chunkStartsWithNewline = /^\n/u.test(chunk);
  const prefersParagraphBreak =
    chunkStartsWithWhitespace
    && !chunkStartsWithNewline
    && /[.?!]$/u.test(trimmedCurrent)
    && /^[A-Z"'`(\[]/u.test(trimmedChunk)
    && !endsWithOrderedListMarker(trimmedCurrent);

  return {
    trailingWord,
    leadingWord,
    trimmedCurrent,
    trimmedChunk,
    chunkStartsWithWhitespace,
    chunkStartsWithNewline,
    prefersParagraphBreak
  };
}

function buildAppendCandidates(current: string, chunk: string, context: AssistantTextAppendBoundaryContext) {
  const candidates: AssistantTextAppendCandidate[] = [];
  const seen = new Set<string>();
  const pushCandidate = (kind: AppendCandidateKind, text: string) => {
    if (!seen.has(text)) {
      candidates.push({ kind, text });
      seen.add(text);
    }
  };

  pushCandidate('direct', current + chunk);

  if (context.prefersParagraphBreak) {
    pushCandidate('paragraph', `${context.trimmedCurrent}\n\n${context.trimmedChunk}`);
  }

  if (current && context.trimmedChunk && !context.chunkStartsWithNewline) {
    pushCandidate('spaced', `${context.trimmedCurrent} ${context.trimmedChunk}`);
  }

  return candidates;
}

function scoreAppendCandidate(
  kind: AppendCandidateKind,
  candidateText: string,
  context: AssistantTextAppendBoundaryContext,
  options: AssistantTextNormalizationOptions
) {
  const inspection = inspectAssistantVisibleText(candidateText, {
    ...options,
    preserveLeadingBreaks: true
  });

  let score = inspection.debt * 10;

  if (kind === 'paragraph') {
    score += context.prefersParagraphBreak ? -3 : 8;
  }

  if (context.trailingWord && context.leadingWord && !context.chunkStartsWithNewline) {
    const leftLower = context.trailingWord.toLowerCase();
    const rightLower = context.leadingWord.toLowerCase();
    const spacedDecision = classifyAssistantTextBoundary(context.trailingWord, context.leadingWord, 'spaced');
    const jammedDecision = classifyAssistantTextBoundary(context.trailingWord, context.leadingWord, 'jammed');
    const strongJoin = spacedDecision.action === 'join';
    const strongSpace =
      jammedDecision.action === 'space'
      || isCommonShortWord(leftLower)
      || isCommonShortWord(rightLower)
      || isCommonStandaloneWord(leftLower)
      || isCommonStandaloneWord(rightLower)
      || isContractionFragment(leftLower)
      || isContractionFragment(rightLower);
    const mildJoin =
      !strongJoin
      && !strongSpace
      && (isContinuationFragment(rightLower) || rightLower.length <= 4 || leftLower.length <= 3);
    const mildSpace =
      !strongJoin
      && !strongSpace
      && leftLower.length >= 5
      && rightLower.length >= 5;

    if (kind === 'direct') {
      if (strongSpace) {
        score += 10;
      } else if (strongJoin) {
        score -= 3;
      } else if (mildSpace) {
        score += 5;
      } else if (mildJoin) {
        score -= 2;
      }
    }

    if (kind === 'spaced') {
      if (strongJoin) {
        score += 10;
      } else if (strongSpace) {
        score -= 2;
      } else if (mildJoin) {
        score += 4;
      } else if (mildSpace) {
        score -= 1;
      }
      if (context.chunkStartsWithWhitespace) {
        score += 1;
      }
    }
  }

  if (kind === 'direct' && context.chunkStartsWithWhitespace) {
    score -= 1;
  }

  return {
    score,
    text: inspection.normalizedText
  };
}

function chooseBestAppendText(
  current: string,
  normalizedChunk: string,
  options: AssistantTextNormalizationOptions = {}
) {
  if (!current) {
    return normalizeAssistantVisibleTextCore(normalizedChunk, options).replace(/^\s*\n+/u, '');
  }

  const context = createAppendBoundaryContext(current, normalizedChunk);
  const candidates = buildAppendCandidates(current, normalizedChunk, context);
  let bestScore = Number.POSITIVE_INFINITY;
  let bestText = current + normalizedChunk;

  for (const candidate of candidates) {
    const scored = scoreAppendCandidate(candidate.kind, candidate.text, context, options);
    if (scored.score < bestScore) {
      bestScore = scored.score;
      bestText = scored.text;
    }
  }

  return bestText;
}

function deriveAppendMutation(current: string, nextText: string) {
  if (!nextText || nextText === current) {
    return {
      delta: '',
      replace: false
    };
  }

  if (!current) {
    return {
      delta: nextText,
      replace: false
    };
  }

  if (nextText.startsWith(current)) {
    return {
      delta: nextText.slice(current.length),
      replace: false
    };
  }

  return {
    delta: '',
    replace: true
  };
}

export function createAssistantVisibleTextReducer(
  options: AssistantTextNormalizationOptions = {}
): AssistantVisibleTextReducer {
  return {
    normalize(value: string) {
      return normalizeAssistantVisibleTextCore(value, options);
    },

    inspect(value: string) {
      return inspectAssistantVisibleText(value, options);
    },

    appendDelta(current: string, rawChunk: string) {
      const normalizedChunk = normalizeAssistantVisibleTextCore(rawChunk, {
        ...options,
        preserveLeadingBreaks: current.length > 0
      });
      const joinableChunk =
        current.length === 0 ? normalizedChunk.replace(/^\s*\n+/u, '') : normalizedChunk;
      if (!joinableChunk) {
        return {
          text: current,
          delta: '',
          normalizedChunk: '',
          replace: false
        };
      }

      const text = chooseBestAppendText(current, joinableChunk, options);
      const mutation = deriveAppendMutation(current, text);
      return {
        text,
        delta: mutation.delta,
        normalizedChunk: joinableChunk,
        replace: mutation.replace
      };
    },

    preferText(current: string, rawCandidate: string) {
      const normalizedCandidate = normalizeAssistantVisibleTextCore(rawCandidate, options).trim();
      const currentText = current.trim();
      if (!normalizedCandidate) {
        return currentText;
      }
      if (!currentText) {
        return normalizedCandidate;
      }
      if (normalizedCandidate.startsWith(currentText)) {
        return normalizedCandidate;
      }
      if (currentText.startsWith(normalizedCandidate)) {
        return currentText;
      }

      if (compactComparableText(normalizedCandidate) === compactComparableText(currentText)) {
        const currentInspection = inspectAssistantVisibleText(currentText, {
          ...options,
          preserveLeadingBreaks: true
        });
        const candidateInspection = inspectAssistantVisibleText(normalizedCandidate, {
          ...options,
          preserveLeadingBreaks: true
        });

        if (candidateInspection.debt !== currentInspection.debt) {
          return candidateInspection.debt < currentInspection.debt ? normalizedCandidate : currentText;
        }

        const currentStable = currentInspection.normalizedText === currentText;
        const candidateStable = candidateInspection.normalizedText === normalizedCandidate;
        if (candidateStable !== currentStable) {
          return candidateStable ? normalizedCandidate : currentText;
        }

        return currentText;
      }

      return normalizedCandidate;
    },

    reconcileSnapshot(current: string, currentSnapshot: string, rawSnapshot: string) {
      if (!rawSnapshot) {
        return {
          text: current,
          delta: '',
          snapshotText: currentSnapshot,
          replace: false
        };
      }

      const nextSnapshot = rawSnapshot;
      if (!current) {
        const nextText = normalizeAssistantVisibleTextCore(rawSnapshot, options).trim();
        return {
          text: nextText,
          delta: nextText,
          snapshotText: nextSnapshot,
          replace: false
        };
      }

      if (currentSnapshot && nextSnapshot === currentSnapshot) {
        return {
          text: current,
          delta: '',
          snapshotText: nextSnapshot,
          replace: false
        };
      }

      if (currentSnapshot && nextSnapshot.startsWith(currentSnapshot)) {
        const rawDelta = nextSnapshot.slice(currentSnapshot.length);
        const appended = this.appendDelta(current, rawDelta);
        return {
          text: appended.text,
          delta: appended.delta,
          snapshotText: nextSnapshot,
          replace: appended.replace
        };
      }

      const preferredText = this.preferText(current, rawSnapshot);
      const mutation = deriveAppendMutation(current, preferredText);
      return {
        text: preferredText,
        delta: mutation.delta,
        snapshotText: nextSnapshot,
        replace: mutation.replace
      };
    }
  };
}

const defaultReducer = createAssistantVisibleTextReducer();

export function repairSuspiciousWordSplits(content: string) {
  return repairSuspiciousTextBoundaries(content);
}

export function findSuspiciousAssistantTextPatterns(text: string) {
  return collectAssistantTextFindings(text);
}

export function normalizeAssistantVisibleTextChunk(
  content: string,
  options: AssistantTextNormalizationOptions = {}
) {
  return options.stripXmlFunctionCallMarkup || options.stripReasoningLabels || options.preserveLeadingBreaks
    ? createAssistantVisibleTextReducer(options).normalize(content)
    : defaultReducer.normalize(content);
}

export function appendAssistantTextDelta(
  current: string,
  rawChunk: string,
  options: AssistantTextNormalizationOptions = {}
): AssistantTextDeltaResolution {
  return createAssistantVisibleTextReducer(options).appendDelta(current, rawChunk);
}

export function preferNormalizedAssistantText(
  current: string,
  rawCandidate: string,
  options: AssistantTextNormalizationOptions = {}
): string {
  return createAssistantVisibleTextReducer(options).preferText(current, rawCandidate);
}

export function reconcileAssistantTextSnapshot(
  current: string,
  currentSnapshot: string,
  rawSnapshot: string,
  options: AssistantTextNormalizationOptions = {}
): AssistantTextSnapshotResolution {
  return createAssistantVisibleTextReducer(options).reconcileSnapshot(current, currentSnapshot, rawSnapshot);
}
