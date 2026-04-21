import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { SkillDefinition } from '../../shared/domain';
import { getSkillCommandToken } from '../../shared/skills';
import { resolveSkillIcon } from '../components/skillIcons';
import { normalizeTranscriptMarkdownSource } from './transcript-markdown-normalization';

function normalizeSkillPath(value: string) {
  return decodeURIComponent(value).replace(/\\/g, '/').toLowerCase();
}

function buildSkillLookup(skills: SkillDefinition[]) {
  const tokens = new Map<string, SkillDefinition>();
  const paths = new Map<string, SkillDefinition>();

  for (const skill of skills) {
    tokens.set(getSkillCommandToken(skill).toLowerCase(), skill);
    if (typeof skill.path === 'string' && skill.path.trim()) {
      paths.set(normalizeSkillPath(skill.path), skill);
    }
  }

  return { tokens, paths };
}

export interface TranscriptSkillMention {
  slug: string;
  startIndex: number;
  nextIndex: number;
}

const explicitTranscriptSkillMentionPattern = /(^|[^A-Za-z0-9-])\$([a-z0-9][a-z0-9-]{1,63})(?=$|[^A-Za-z0-9-])/giu;
const contextualTranscriptSkillMentionPattern = /\b(?:using|then|with|and)\s+([a-z0-9][a-z0-9-]{1,63})(?=$|[^A-Za-z0-9-])/giu;

function byRange(left: TranscriptSkillMention, right: TranscriptSkillMention) {
  if (left.startIndex !== right.startIndex) {
    return left.startIndex - right.startIndex;
  }
  return right.nextIndex - left.nextIndex;
}

function hasOverlap(mentions: TranscriptSkillMention[], startIndex: number, nextIndex: number) {
  return mentions.some((mention) => startIndex < mention.nextIndex && nextIndex > mention.startIndex);
}

export function findTranscriptSkillMentions(text: string, skills: SkillDefinition[]): TranscriptSkillMention[] {
  if (!text || skills.length === 0) {
    return [];
  }

  const lookup = buildSkillLookup(skills);
  if (lookup.tokens.size === 0) {
    return [];
  }

  const mentions: TranscriptSkillMention[] = [];

  for (const match of text.matchAll(explicitTranscriptSkillMentionPattern)) {
    const prefix = match[1] ?? '';
    const slug = (match[2] ?? '').toLowerCase();
    const startIndex = match.index ?? 0;

    if (!lookup.tokens.has(slug)) {
      continue;
    }

    const tokenIndex = startIndex + prefix.length;
    const nextIndex = tokenIndex + slug.length + 1;
    mentions.push({
      slug,
      startIndex: tokenIndex,
      nextIndex
    });
  }

  for (const match of text.matchAll(contextualTranscriptSkillMentionPattern)) {
    const slug = (match[1] ?? '').toLowerCase();
    if (!lookup.tokens.has(slug)) {
      continue;
    }

    const matchText = match[0] ?? '';
    const mentionStartIndex = (match.index ?? 0) + Math.max(0, matchText.length - slug.length);
    const nextIndex = mentionStartIndex + slug.length;
    if (hasOverlap(mentions, mentionStartIndex, nextIndex)) {
      continue;
    }

    mentions.push({
      slug,
      startIndex: mentionStartIndex,
      nextIndex
    });
  }

  return mentions.sort(byRange);
}

function createSkillPill(document: Document, skill: SkillDefinition, token: string) {
  const pill = document.createElement('span');
  pill.className = 'skill-pill transcript-skill-pill';
  pill.setAttribute('data-skill-token', token);

  const icon = document.createElement('span');
  icon.className = 'skill-pill-icon';
  icon.setAttribute('aria-hidden', 'true');
  const Icon = resolveSkillIcon(skill);
  icon.innerHTML = renderToStaticMarkup(createElement(Icon, { size: 12 }));

  const label = document.createElement('span');
  label.className = 'skill-pill-label';
  label.textContent = skill.name;

  pill.append(icon, label);
  return pill;
}

function replaceSkillLinks(root: HTMLElement, skills: SkillDefinition[], lookup: ReturnType<typeof buildSkillLookup>) {
  const anchors = Array.from(root.querySelectorAll('a'));

  for (const anchor of anchors) {
    if (anchor.closest('code, pre, button')) {
      continue;
    }

    const rawHref = anchor.getAttribute('href') ?? '';
    const text = (anchor.textContent ?? '').trim();
    let skill: SkillDefinition | undefined;

    if (rawHref) {
      const normalizedHref = normalizeSkillPath(rawHref);
      skill = lookup.paths.get(normalizedHref);
      if (!skill) {
        skill = skills.find((candidate) => normalizedHref.endsWith(normalizeSkillPath(candidate.path)));
      }
    }

    if (!skill && text) {
      const normalizedText = text.replace(/^\$/u, '').toLowerCase();
      skill = lookup.tokens.get(normalizedText);
    }

    if (!skill) {
      continue;
    }

    const token = getSkillCommandToken(skill).toLowerCase();
    anchor.replaceWith(createSkillPill(root.ownerDocument, skill, token));
  }
}

function replaceSkillMentionsInHtml(html: string, skills: SkillDefinition[]) {
  if (!html || skills.length === 0) {
    return html;
  }

  const lookup = buildSkillLookup(skills);
  if (lookup.tokens.size === 0) {
    return html;
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const root = document.body.firstElementChild;
  if (!root) {
    return html;
  }

  replaceSkillLinks(root, skills, lookup);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    textNodes.push(currentNode as Text);
    currentNode = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const parentElement = textNode.parentElement;
    if (!parentElement) {
      continue;
    }

    const blockedAncestor = parentElement.closest('code, pre, a, button');
    if (blockedAncestor) {
      continue;
    }

    const text = textNode.textContent ?? '';
    const mentions = findTranscriptSkillMentions(text, skills);
    if (mentions.length === 0) {
      continue;
    }

    let lastIndex = 0;
    const fragment = document.createDocumentFragment();

    for (const mention of mentions) {
      const { slug, startIndex, nextIndex } = mention;
      const skill = lookup.tokens.get(slug);

      if (!skill) {
        continue;
      }

      if (startIndex > lastIndex) {
        fragment.append(text.slice(lastIndex, startIndex));
      }

      fragment.append(createSkillPill(document, skill, slug));
      lastIndex = nextIndex;
    }

    if (lastIndex < text.length) {
      fragment.append(text.slice(lastIndex));
    }
    textNode.replaceWith(fragment);
  }

  return root.innerHTML;
}

export { normalizeTranscriptMarkdownSource } from './transcript-markdown-normalization';

export function renderTranscriptMarkdown(source: string, skills: SkillDefinition[]) {
  const normalizedSource = normalizeTranscriptMarkdownSource(source);
  const html = DOMPurify.sanitize(
    marked.parse(normalizedSource, {
      gfm: true,
      breaks: true
    }) as string
  );
  return replaceSkillMentionsInHtml(html, skills);
}
