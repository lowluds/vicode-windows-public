const COMMON_SHORT_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'do',
  'for',
  'go',
  'he',
  'if',
  'in',
  'is',
  'it',
  'me',
  'my',
  'no',
  'of',
  'on',
  'or',
  'so',
  'the',
  'to',
  'up',
  'us',
  'we',
  'yes'
]);

const SPLIT_TERM_REPAIRS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bsh\s+ad\s+cn\b/giu, replacement: 'shadcn' },
  { pattern: /\bopen\s+ai\b/giu, replacement: 'OpenAI' },
  { pattern: /\bnext\s+js\b/giu, replacement: 'Next.js' },
  { pattern: /\bjava\s+script\b/giu, replacement: 'JavaScript' },
  { pattern: /\btype\s+script\b/giu, replacement: 'TypeScript' },
  { pattern: /\btail\s+wind\b/giu, replacement: 'Tailwind' },
  { pattern: /\brad\s+ix\b/giu, replacement: 'Radix' }
];

function repairSplitLowercaseFragments(value: string) {
  return value.replace(/\b([a-z]{1,2})\s+([a-z]{1,2})\s+([a-z]{1,2})\b/gu, (match, first, second, third) => {
    const parts = [first, second, third].map((part) => String(part).toLowerCase());
    if (parts.some((part) => COMMON_SHORT_WORDS.has(part))) {
      return match;
    }
    return parts.join('');
  });
}

export function normalizeDisplayText(value: string | null | undefined) {
  if (!value) {
    return '';
  }

  let normalized = value.replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return '';
  }

  for (const repair of SPLIT_TERM_REPAIRS) {
    normalized = normalized.replace(repair.pattern, repair.replacement);
  }

  normalized = repairSplitLowercaseFragments(normalized);
  return normalized.replace(/\s+/gu, ' ').trim();
}
