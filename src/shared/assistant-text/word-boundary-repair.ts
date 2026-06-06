type AssistantTextBoundaryFinding =
  | 'split-word-fragment'
  | 'split-domain-fragment'
  | 'split-suffix-fragment'
  | 'split-acronym-fragment'
  | 'split-hyphen-fragment'
  | 'missing-space-after-acronym';

type AssistantTextBoundaryMode = 'spaced' | 'jammed';
type AssistantTextBoundaryAction = 'keep' | 'join' | 'space';

interface AssistantTextBoundaryDecision {
  action: AssistantTextBoundaryAction;
  finding: AssistantTextBoundaryFinding | null;
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
    'two',
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

const COMMON_COMPACT_TECHNICAL_TERMS = new Set([
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

function isCompactTechnicalSplit(left: string, right: string) {
  return COMMON_COMPACT_TECHNICAL_TERMS.has(`${left}${right}`.toLowerCase());
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

  if (leftPlainWord && rightPlainWord && isCompactTechnicalSplit(left, right)) {
    return { action: 'join', finding: 'split-acronym-fragment' };
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
    leftPlainWord
    && rightPlainWord
    && /^[A-Z]$/u.test(left)
    && (/^[A-Z]{2,4}$/u.test(right) || /^[A-Z][a-z]{1,3}$/u.test(right) || /^[a-z]{3,}$/u.test(right))
  ) {
    return { action: 'join', finding: 'split-acronym-fragment' };
  }

  if (
    leftPlainWord
    && rightPlainWord
    && isAcronym(left)
    && (/^[A-Z]{1,4}$/u.test(right) || /^[A-Z][a-z]{1,3}$/u.test(right))
  ) {
    return { action: 'join', finding: 'split-acronym-fragment' };
  }

  if (
    leftPlainWord
    && rightPlainWord
    && /^[A-Z]{2,}[a-z]{1,2}$/u.test(left)
    && isAcronym(right)
  ) {
    return { action: 'join', finding: 'split-acronym-fragment' };
  }

  if (/^[A-Za-z]+-[A-Za-z]$/u.test(leftToken) && /^[a-z]{2,}$/u.test(right)) {
    return { action: 'join', finding: 'split-hyphen-fragment' };
  }

  if (
    leftPlainWord
    && rightPlainWord
    && /^[A-Za-z]{2,24}$/u.test(left)
    && isContinuationFragment(rightLower)
  ) {
    return { action: 'join', finding: 'split-suffix-fragment' };
  }

  if (
    leftPlainWord
    && rightPlainWord
    && !isAcronym(left)
    && (
      (left.length <= 2 && /^[A-Za-z]+$/u.test(left) && /^[a-z][A-Za-z-]{2,}$/u.test(right))
      || (left.length <= 3 && /^[A-Z][a-z]+$/u.test(left) && /^[a-z][A-Za-z-]{1,7}$/u.test(right))
      || (left.length <= 5 && /^[A-Z][a-z]+$/u.test(left) && /^[a-z]{1,2}$/u.test(right))
      || (left.length <= 3 && /^[a-z]+$/u.test(left) && /^[a-z]{1,2}$/u.test(right))
    )
  ) {
    return { action: 'join', finding: 'split-word-fragment' };
  }

  if (
    leftPlainWord
    && rightPlainWord
    && !isAcronym(left)
    && !isAcronym(right)
    && !isCommonStandaloneWord(leftLower)
    && !isCommonStandaloneWord(rightLower)
    && /^[A-Z][a-z]{2,3}$/u.test(left)
    && /^[a-z]{3,4}$/u.test(right)
    && left.length + right.length <= 10
  ) {
    return { action: 'join', finding: 'split-word-fragment' };
  }

  if (
    leftPlainWord
    && rightPlainWord
    && !isAcronym(left)
    && !isAcronym(right)
    && !isCommonStandaloneWord(leftLower)
    && !isCommonStandaloneWord(rightLower)
    && /^[a-z]{3}$/u.test(left)
    && /^[a-z]{4,8}$/u.test(right)
    && left.length + right.length <= 11
  ) {
    return { action: 'join', finding: 'split-word-fragment' };
  }

  return { action: 'keep', finding: null };
}

export function repairSuspiciousTextBoundaries(content: string) {
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
