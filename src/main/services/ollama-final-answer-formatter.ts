import type { OllamaRuntime } from '../../providers/ollama/runtime';
import {
  findSuspiciousAssistantTextPatterns,
  repairSuspiciousWordSplits
} from '../../providers/text-normalization';

interface OllamaWrapUpSection {
  heading: string;
  bullets: string[];
}

interface OllamaWrapUpShape {
  lead: string;
  sections: OllamaWrapUpSection[];
  closing: string;
}

const REWRITE_TIMEOUT_MS = 20_000;
const MIN_REWRITE_LENGTH = 260;
const MAX_REWRITE_SOURCE_CHARS = 8_000;
const DENSE_SENTENCE_PATTERN = /[.?!](?:\s+|$)/gu;
const BULLET_LINE_PATTERN = /^\s*(?:[-*•]|\d+\.)\s+/u;
const MARKDOWN_HEADING_PATTERN = /^\s{0,3}(?:#{1,6}\s+\S+|\*\*[^*\n]{2,80}\*\*)\s*$/u;
const FOLLOW_UP_SENTENCE_START_PATTERN =
  /(Let me know|I can|If you'd like|If you would like|If you want|Tell me if|Happy to|I'?m happy to)\b/gu;
const WRAP_UP_LIST_ITEM_LEAD = String.raw`(?:\*\*|[A-Z0-9]|\p{Extended_Pictographic})`;
const WRAP_UP_CLOSING_PROMPT_PATTERN =
  /([.?!])\s+(Let me know if|If you'd like|If you want|Tell me if|I can also)\b/gu;
const DENSE_MARKDOWN_BLOCK_LANGUAGES =
  'bash|sh|shell|cmd|powershell|pwsh|python|json|yaml|yml|ts|tsx|js|jsx|sql';
const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lead: {
      type: 'string',
      description: 'A short opening summary paragraph. Use an empty string when no opening summary is needed.'
    },
    sections: {
      type: 'array',
      description: 'Readable groups of key points from the original answer.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          heading: {
            type: 'string',
            description: 'Short heading for this group. Use "Key Points" if a custom heading is not necessary.'
          },
          bullets: {
            type: 'array',
            items: {
              type: 'string'
            }
          }
        },
        required: ['heading', 'bullets']
      }
    },
    closing: {
      type: 'string',
      description: 'A brief closing sentence or follow-up prompt. Use an empty string when none is needed.'
    }
  },
  required: ['lead', 'sections', 'closing']
} as const;

function isDenseWrapUp(text: string) {
  const trimmed = text.trim();
  if (trimmed.length < MIN_REWRITE_LENGTH) {
    return false;
  }

  const lineCount = trimmed.split(/\r?\n/u).filter((line) => line.trim()).length;
  const bulletLineCount = trimmed.split(/\r?\n/u).filter((line) => /^\s*[-*•]\s+/u.test(line)).length;
  const sentenceCount = Array.from(trimmed.matchAll(DENSE_SENTENCE_PATTERN)).length;
  const inlineBulletHints = Array.from(trimmed.matchAll(/\s[-•]\s+(?=[A-Z0-9\p{Extended_Pictographic}])/gu)).length;
  const headingHints = Array.from(trimmed.matchAll(/\*\*[^*\n]{2,60}:\*\*/gu)).length;
  const longestLine = trimmed.split(/\r?\n/u).reduce((max, line) => Math.max(max, line.trim().length), 0);

  if (bulletLineCount >= 3 && lineCount >= 4) {
    return false;
  }

  return (
    (sentenceCount >= 4 && lineCount <= 2 && longestLine >= 220)
    || inlineBulletHints >= 2
    || (headingHints >= 2 && lineCount <= 2)
    || (/^\s*-\s+/u.test(trimmed) && longestLine >= 260)
  );
}

function hasProtectedStructure(text: string) {
  return /```/u.test(text) || /<function_calls>[\s\S]*?<\/function_calls>/iu.test(text);
}

function hasReadableStructure(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const nonEmptyLines = trimmed.split(/\r?\n/u).filter((line) => line.trim());
  const bulletLineCount = nonEmptyLines.filter((line) => BULLET_LINE_PATTERN.test(line)).length;
  const headingLineCount = nonEmptyLines.filter((line) => MARKDOWN_HEADING_PATTERN.test(line)).length;
  const paragraphBreakCount = Array.from(trimmed.matchAll(/\n\s*\n/gu)).length;
  const longestLine = nonEmptyLines.reduce((max, line) => Math.max(max, line.trim().length), 0);

  return (
    bulletLineCount >= 2
    || (headingLineCount >= 1 && (bulletLineCount >= 1 || paragraphBreakCount >= 1))
    || paragraphBreakCount >= 2
    || (nonEmptyLines.length >= 5 && longestLine < 160)
  );
}

function hasSuspiciousSplitWord(text: string) {
  const findings = findSuspiciousAssistantTextPatterns(text);
  const hardLabels = new Set([
    'split-year',
    'split-ordinal',
    'split-acronym-fragment',
    'broken-possessive',
    'missing-space-after-apostrophe',
    'missing-space-after-ordinal',
    'missing-space-after-decade',
    'missing-space-before-quote',
    'jammed-ampersand',
    'split-hyphen-fragment'
  ]);

  if (findings.some((label) => hardLabels.has(label))) {
    return true;
  }

  return findings.length >= 2;
}

function validateShape(value: unknown): OllamaWrapUpShape | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const lead = typeof (value as { lead?: unknown }).lead === 'string' ? (value as { lead: string }).lead.trim() : '';
  const closing = typeof (value as { closing?: unknown }).closing === 'string' ? (value as { closing: string }).closing.trim() : '';
  const rawSections = Array.isArray((value as { sections?: unknown }).sections) ? (value as { sections: unknown[] }).sections : [];
  const sections = rawSections
    .map((section) => {
      if (!section || typeof section !== 'object') {
        return null;
      }

      const heading =
        typeof (section as { heading?: unknown }).heading === 'string'
          ? (section as { heading: string }).heading.trim()
          : '';
      const bullets = Array.isArray((section as { bullets?: unknown }).bullets)
        ? (section as { bullets: unknown[] }).bullets
            .filter((bullet): bullet is string => typeof bullet === 'string')
            .map((bullet) => bullet.trim())
            .filter(Boolean)
        : [];
      if (!heading && bullets.length === 0) {
        return null;
      }

      return {
        heading: heading || 'Key Points',
        bullets
      } satisfies OllamaWrapUpSection;
    })
    .filter((section): section is OllamaWrapUpSection => Boolean(section));

  if (!lead && !closing && sections.length === 0) {
    return null;
  }

  return {
    lead,
    sections,
    closing
  };
}

function renderShape(shape: OllamaWrapUpShape) {
  const parts: string[] = [];

  if (shape.lead) {
    parts.push(shape.lead);
  }

  const multipleSections = shape.sections.length > 1;
  for (const section of shape.sections) {
    const lines: string[] = [];
    const heading = section.heading.trim();
    if (heading && (multipleSections || heading.toLowerCase() !== 'key points')) {
      lines.push(`**${heading}**`);
    }
    for (const bullet of section.bullets) {
      lines.push(`- ${bullet}`);
    }
    if (lines.length > 0) {
      parts.push(lines.join('\n'));
    }
  }

  if (shape.closing) {
    parts.push(shape.closing);
  }

  return normalizeWrapUpMarkdown(parts.join('\n\n').trim());
}

function normalizeReadablePromptSpacing(content: string, separator: 'space' | 'paragraph' = 'space') {
  if (!content) {
    return content;
  }

  const joiner = separator === 'paragraph' ? '\n\n' : ' ';
  return content.replace(
    /([A-Za-z0-9”")\]])(Let me know if|If you'd like|If you want|Tell me if|I can also|Want me to|Would you like me to|Need me to|Should I|Can I)\b/gu,
    `$1${joiner}$2`
  );
}

function normalizeWrapUpHeadingBreaksLegacy(source: string) {
  return source
    .replace(/([^#\n])(?=#{2,6}\s)/gu, '$1\n\n')
    .replace(
      new RegExp(`(#{2,6}\\s[^\\n]{2,160}?)(?=(?:${DENSE_MARKDOWN_BLOCK_LANGUAGES})#)`, 'giu'),
      '$1\n\n'
    )
    .replace(new RegExp(`\\b(${DENSE_MARKDOWN_BLOCK_LANGUAGES})#`, 'giu'), '$1\n#');
}

function shouldRecoverDenseWrapUp(source: string) {
  return (
    /(?:^|[^#\n])#{2,6}\s/u.test(source)
    || /(?:[:.!?]|[)\]}])\s*[-•●▪◦]\s+(?=(?:\*\*|[A-Z0-9]|\p{Extended_Pictographic}))/u.test(source)
    || /\s+[-•●▪◦]\s+(?=(?:\*\*|[A-Z0-9]|\p{Extended_Pictographic}))/u.test(source)
  );
}

function normalizeListLikeWrapUp(source: string) {
  let text = source;

  text = text.replace(/^(#{2,6}\s[^\n]+?)-\s*(?=[A-Z0-9])/gmu, '$1\n- ');
  text = text.replace(new RegExp(`([:!?])\\s*[-•●▪◦]\\s+(?=${WRAP_UP_LIST_ITEM_LEAD})`, 'gu'), '$1\n- ');
  text = text.replace(new RegExp(`([.])\\s*[-•●▪◦]\\s+(?=${WRAP_UP_LIST_ITEM_LEAD})`, 'gu'), '$1\n\n- ');
  text = text.replace(new RegExp(`([)\\]}])\\s*[-•●▪◦]\\s+(?=${WRAP_UP_LIST_ITEM_LEAD})`, 'gu'), '$1\n- ');
  text = text.replace(
    /([A-Za-z0-9)])-(?=\s+[A-Z][A-Za-z0-9-]{2,}:)/gu,
    '$1\n- '
  );
  text = text.replace(new RegExp(`\\s+[-•●▪◦]\\s+(?=${WRAP_UP_LIST_ITEM_LEAD})`, 'gu'), '\n- ');
  text = text.replace(/([a-z0-9])-(?=[A-Z][A-Za-z0-9]{2,}(?:-|Let me know if|If you'd like|If you want|Tell me if|I can also|Want me to|Would you like me to|Need me to|Should I|Can I))/gu, '$1\n- ');
  text = text.replace(/(?<!\n)(\*\*[^*\n]{2,60}:\*\*)/gu, '\n- $1');
  text = text.replace(/^- \s*\n-\s+(\*\*[^*\n]{2,60}:\*\*)/gmu, '- $1');
  text = text.replace(/^- ([^\nA-Za-z0-9]{1,6})\s*\n- (\*\*[^*\n]{2,60}:\*\*)/gmu, '- $1 $2');
  text = text.replace(/^- ([^\nA-Za-z0-9]{1,6})\s{2,}(\*\*[^*\n]{2,60}:\*\*)/gmu, '- $1 $2');
  text = text.replace(/\n{3,}/gu, '\n\n');

  return text.trim();
}

function normalizeWrapUpMarkdown(text: string) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/([^\n])\s*(#{2,6}\s+)/gu, '$1\n\n$2')
    .replace(/([^\n])\s*(\*\*[^*\n]{2,80}\*\*)\s*(?=(?:[-*•]|\d+\.)\s+)/gu, '$1\n\n$2\n')
    .replace(/(#{2,6}\s+[^\n#]+?)\s*(?=[-*•]\s+)/gu, '$1\n')
    .replace(/(\*\*[^*\n]{2,80}\*\*)\s*(?=\n?(?:[-*•]|\d+\.)\s+)/gu, '$1\n')
    .replace(/(\d+\.\s+[^\n]{6,}?[.?!])(?=\d+\.\s+)/gu, '$1\n\n')
    .replace(/([^\n])\n((?:[-*•]|\d+\.)\s+)/gu, '$1\n\n$2')
    .replace(/((?:[-*•]|\d+\.)\s+[^\n]{12,}[.?!])(?=(?:Let me know|I can|If you'd like|If you would like|If you want|Tell me if|Happy to|I'?m happy to)\b)/gu, '$1\n\n')
    .replace(FOLLOW_UP_SENTENCE_START_PATTERN, (match, _capture, offset, source) => {
      if (offset === 0) {
        return match;
      }
      const prefix = source.slice(0, offset);
      if (/\n\n$/u.test(prefix)) {
        return match;
      }
      if (/\n$/u.test(prefix)) {
        return `\n${match}`;
      }
      if (/[.?!]\s*$/u.test(prefix)) {
        return `\n\n${match}`;
      }
      return match;
    })
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export function formatOllamaFinalAnswerFallback(source: string) {
  let text = source.replace(/\r\n/g, '\n').trim();
  if (!text) {
    return '';
  }

  text = text
    .replace(/[ \t]+([,.;:!?])/gu, '$1')
    .replace(/([(\[{])\s+/gu, '$1')
    .replace(/\s+([)\]}])/gu, '$1')
    .replace(/([A-Za-z])-\s+([A-Za-z])/gu, '$1-$2')
    .replace(/`\s+([^`\n]+?)\s+`/gu, '`$1`');

  if (shouldRecoverDenseWrapUp(text)) {
    text = normalizeWrapUpHeadingBreaksLegacy(text);
    text = normalizeListLikeWrapUp(text);
  }
  text = repairSuspiciousWordSplits(text);
  text = text.replace(
    /([A-Za-z0-9)])(Yes|No|Here|This|That|These|Those|Want me to|Need me to|Should I|Can I)\b/gu,
    '$1\n\n$2'
  );
  text = text.replace(WRAP_UP_CLOSING_PROMPT_PATTERN, '$1\n\n$2');
  text = normalizeReadablePromptSpacing(text, 'paragraph');
  text = text.replace(/\n{3,}/gu, '\n\n');

  return normalizeWrapUpMarkdown(text.trim());
}

function clipRewriteSource(text: string) {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_REWRITE_SOURCE_CHARS) {
    return trimmed;
  }

  return `${trimmed.slice(0, MAX_REWRITE_SOURCE_CHARS).trimEnd()}\n\n[Truncated for rewrite budget]`;
}

export class OllamaFinalAnswerFormatter {
  constructor(private readonly runtime: OllamaRuntime) {}

  shouldRewrite(text: string) {
    const trimmed = text.trim();
    if (!trimmed || hasProtectedStructure(trimmed)) {
      return false;
    }

    const suspiciousFindings = findSuspiciousAssistantTextPatterns(trimmed);
    const normalizedFallback = formatOllamaFinalAnswerFallback(trimmed);

    if (hasReadableStructure(trimmed)) {
      return suspiciousFindings.some((label) => label !== 'split-hyphen-fragment' && label !== 'split-suffix-fragment');
    }

    if (suspiciousFindings.length > 0) {
      return true;
    }

    return normalizedFallback !== trimmed || isDenseWrapUp(trimmed);
  }

  async rewrite(modelId: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed || !this.shouldRewrite(trimmed)) {
      return null;
    }

    const normalizedFallback = formatOllamaFinalAnswerFallback(trimmed);

    const response = await this.runtime.fetch(
      '/api/chat',
      {
        method: 'POST',
        body: JSON.stringify({
          model: modelId,
          stream: false,
          format: JSON_SCHEMA,
          options: {
            temperature: 0
          },
          messages: [
            {
              role: 'system',
              content:
                'You rewrite assistant final answers into clean readable markdown-ready structure. Preserve the original facts, tone, and caveats. Do not add new claims. Break dense prose into short readable groups with concise bullets. Fix accidental split words or broken spacing such as mid-word spaces when they are clearly formatting errors.'
            },
            {
              role: 'user',
              content: [
                'Rewrite this assistant answer into a cleaner final wrap-up.',
                'Keep the content faithful to the original.',
                'Use short bullet points for dense facts.',
                'Return only JSON matching the provided schema.',
                '',
                'Original answer:',
                clipRewriteSource(trimmed)
              ].join('\n')
            }
          ]
        })
      },
      REWRITE_TIMEOUT_MS
    );

    if (!response.ok) {
      return normalizedFallback !== trimmed ? normalizedFallback : null;
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          message?: {
            content?: string;
          };
        }
      | null;
    const content = typeof payload?.message?.content === 'string' ? payload.message.content.trim() : '';
    if (!content) {
      return normalizedFallback !== trimmed ? normalizedFallback : null;
    }

    const parsed = validateShape(JSON.parse(content) as unknown);
    if (!parsed) {
      return normalizedFallback !== trimmed ? normalizedFallback : null;
    }

    const rendered = renderShape(parsed);
    if (!rendered) {
      return normalizedFallback !== trimmed ? normalizedFallback : null;
    }

    if (rendered === trimmed) {
      return normalizedFallback !== trimmed ? normalizedFallback : null;
    }

    return rendered;
  }
}
