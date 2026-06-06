import type { AssistantTextNormalizationOptions } from './types';

export interface AssistantFinalDisplayCleanupOptions {
  stripXmlFunctionCallMarkup?: boolean;
  stripReasoningLabels?: boolean;
  preserveOuterWhitespace?: boolean;
}

const ANSI_ESCAPE_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/gu;
const DISPLAY_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
const XML_FUNCTION_CALL_MARKUP_PATTERN = /<function_calls>[\s\S]*?<\/function_calls>/giu;
const REASONING_LABEL_PATTERN = /^\s*(thought|thinking|internal reasoning|reasoning)\s*:/iu;
const JAMMED_FOLLOW_UP_PROMPT_PATTERN =
  /([A-Za-z0-9”")\]])(Let me know if|If you'd like|If you want|Tell me if|I can also|Want me to|Would you like me to|Need me to|Should I|Can I)\b/gu;

function stripDisplayControlCharacters(content: string) {
  return content
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(DISPLAY_CONTROL_PATTERN, '');
}

function stripXmlFunctionCallMarkup(content: string) {
  return content.replace(XML_FUNCTION_CALL_MARKUP_PATTERN, '');
}

function stripReasoningLabelLines(content: string) {
  return content
    .split('\n')
    .filter((line) => !REASONING_LABEL_PATTERN.test(line))
    .join('\n');
}

function cleanInlineDisplaySpacing(content: string) {
  return content
    .replace(/`\s+([^`\n]+?)\s+`/gu, '`$1`')
    .replace(/[ \t]+([,.;:!?])/gu, '$1')
    .replace(/([(\[{])\s+/gu, '$1')
    .replace(/\s+([)\]}])/gu, '$1');
}

function cleanOutsideFencedCode(content: string) {
  return content
    .split(/(```[\s\S]*?```)/gu)
    .map((segment) => (segment.startsWith('```') ? segment : cleanInlineDisplaySpacing(segment)))
    .join('');
}

export function cleanFinalAssistantDisplayText(
  source: string,
  options: AssistantFinalDisplayCleanupOptions = {}
) {
  let text = stripDisplayControlCharacters(source.replace(/\r\n/g, '\n'));

  if (options.stripXmlFunctionCallMarkup) {
    text = stripXmlFunctionCallMarkup(text);
  }

  if (options.stripReasoningLabels) {
    text = stripReasoningLabelLines(text);
  }

  const cleaned = cleanOutsideFencedCode(text).replace(/\n{3,}/gu, '\n\n');
  return options.preserveOuterWhitespace ? cleaned : cleaned.trim();
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

export function normalizeAssistantVisibleDisplayText(
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
    normalized = stripReasoningLabelLines(normalized);
  }

  const collapsed = normalized
    .replace(/\n{3,}/gu, '\n\n')
    .split('\n')
    .map((line) => normalizeReadablePunctuationSpacing(line))
    .join('\n')
    .replace(JAMMED_FOLLOW_UP_PROMPT_PATTERN, '$1 $2');

  if (options.preserveLeadingBreaks) {
    return collapsed;
  }

  return collapsed.replace(/^\s*\n+/u, '');
}
