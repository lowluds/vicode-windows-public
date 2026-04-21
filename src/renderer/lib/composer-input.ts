export interface SkillMentionState {
  query: string;
  start: number;
  end: number;
}

export interface AgentMentionState {
  query: string;
  start: number;
  end: number;
}

export interface SlashCommandState {
  query: string;
  start: number;
  end: number;
}

function getSymbolMentionState(prompt: string, caret: number, symbol: '$' | '@') {
  if (caret < 0 || caret > prompt.length) {
    return null;
  }

  const beforeCaret = prompt.slice(0, caret);
  const mentionIndex = beforeCaret.lastIndexOf(symbol);
  if (mentionIndex === -1) {
    return null;
  }

  const prefix = mentionIndex === 0 ? '' : beforeCaret[mentionIndex - 1];
  if (prefix && !/\s/.test(prefix)) {
    return null;
  }

  const query = beforeCaret.slice(mentionIndex + 1);
  if (!/^[a-z0-9-]*$/i.test(query)) {
    return null;
  }

  let end = caret;
  while (end < prompt.length && /[a-z0-9-]/i.test(prompt[end] ?? '')) {
    end += 1;
  }

  return { query: query.toLowerCase(), start: mentionIndex, end };
}

export function getSkillMentionState(prompt: string, caret: number): SkillMentionState | null {
  return getSymbolMentionState(prompt, caret, '$');
}

export function getAgentMentionState(prompt: string, caret: number): AgentMentionState | null {
  return getSymbolMentionState(prompt, caret, '@');
}

export function getLastSkillMentionState(prompt: string): SkillMentionState | null {
  for (let mentionIndex = prompt.lastIndexOf('$'); mentionIndex !== -1; mentionIndex = prompt.lastIndexOf('$', mentionIndex - 1)) {
    const prefix = mentionIndex === 0 ? '' : prompt[mentionIndex - 1] ?? '';
    if (prefix && !/\s/.test(prefix)) {
      continue;
    }

    let end = mentionIndex + 1;
    while (end < prompt.length && /[a-z0-9-]/i.test(prompt[end] ?? '')) {
      end += 1;
    }

    const query = prompt.slice(mentionIndex + 1, end);
    if (!/^[a-z0-9-]*$/i.test(query)) {
      continue;
    }

    return {
      query: query.toLowerCase(),
      start: mentionIndex,
      end
    };
  }

  return null;
}

export function replaceMentionWithToken(prompt: string, mention: SkillMentionState, token: string) {
  const before = prompt.slice(0, mention.start);
  const after = prompt.slice(mention.end);
  const insertion = `$${token}`;
  const needsTrailingSpace = after.length === 0 || !/^[\s.,!?;:)]/u.test(after);
  const nextPrompt = `${before}${insertion}${needsTrailingSpace ? ' ' : ''}${after}`;
  const nextCaret = before.length + insertion.length + (needsTrailingSpace ? 1 : 0);
  return { nextPrompt, nextCaret };
}

export function replaceAgentMention(prompt: string, mention: AgentMentionState, token: string) {
  const before = prompt.slice(0, mention.start);
  const after = prompt.slice(mention.end);
  const insertion = `@${token}`;
  const needsTrailingSpace = after.length === 0 || !/^[\s.,!?;:)]/u.test(after);
  const nextPrompt = `${before}${insertion}${needsTrailingSpace ? ' ' : ''}${after}`;
  const nextCaret = before.length + insertion.length + (needsTrailingSpace ? 1 : 0);
  return { nextPrompt, nextCaret };
}

export function getSlashCommandState(prompt: string, caret: number): SlashCommandState | null {
  if (caret < 0 || caret > prompt.length) {
    return null;
  }

  const beforeCaret = prompt.slice(0, caret);
  const trimmedBefore = beforeCaret.trimStart();
  if (!trimmedBefore.startsWith('/')) {
    return null;
  }

  if (/[\s\r\n]/u.test(trimmedBefore.slice(1))) {
    return null;
  }

  const leadingWhitespaceLength = beforeCaret.length - trimmedBefore.length;
  const query = trimmedBefore.slice(1).toLowerCase();
  if (!/^[a-z-]*$/i.test(query)) {
    return null;
  }

  let end = leadingWhitespaceLength + 1 + query.length;
  while (end < prompt.length && /[a-z-]/i.test(prompt[end] ?? '')) {
    end += 1;
  }

  return {
    query,
    start: leadingWhitespaceLength,
    end
  };
}
