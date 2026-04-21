import { describe, expect, it } from 'vitest';
import {
  getAgentMentionState,
  getLastSkillMentionState,
  getSkillMentionState,
  getSlashCommandState,
  replaceAgentMention,
  replaceMentionWithToken
} from './composer-input';

describe('composer input helpers', () => {
  it('detects a skill mention after command text has been consumed', () => {
    const prompt = 'Refine this with $design-system and keep the footer tight';
    const caret = prompt.indexOf('$design-system') + '$design-system'.length;

    expect(getSkillMentionState(prompt, caret)).toEqual({
      query: 'design-system',
      start: prompt.indexOf('$design-system'),
      end: prompt.indexOf('$design-system') + '$design-system'.length
    });
  });

  it('detects a leading slash command while the user is typing it', () => {
    expect(getSlashCommandState('/plan', '/plan'.length)).toEqual({
      query: 'plan',
      start: 0,
      end: '/plan'.length
    });
  });

  it('does not treat later prompt text as part of a slash command', () => {
    expect(getSlashCommandState('/plan review the repo', '/plan review'.length)).toBeNull();
  });

  it('replaces a partial skill mention and keeps the caret after the inserted token', () => {
    const prompt = 'Use $des in this pass';
    const mention = getSkillMentionState(prompt, 'Use $des'.length);
    expect(mention).not.toBeNull();

    expect(replaceMentionWithToken(prompt, mention!, 'design-system')).toEqual({
      nextPrompt: 'Use $design-system in this pass',
      nextCaret: 'Use $design-system'.length
    });
  });

  it('finds the last valid skill mention in longer prompts', () => {
    const prompt = 'Review spacing with $layout and finish with $design-system';

    expect(getLastSkillMentionState(prompt)).toEqual({
      query: 'design-system',
      start: prompt.lastIndexOf('$design-system'),
      end: prompt.lastIndexOf('$design-system') + '$design-system'.length
    });
  });

  it('supports mixed slash-command and skill-token typing flows', () => {
    const slashPrompt = '/plan';
    const skillPrompt = 'Audit the shell with $skills';

    expect(getSlashCommandState(slashPrompt, slashPrompt.length)?.query).toBe('plan');
    expect(getSkillMentionState(skillPrompt, skillPrompt.length)).toEqual({
      query: 'skills',
      start: skillPrompt.indexOf('$skills'),
      end: skillPrompt.length
    });
  });

  it('detects and replaces agent mentions', () => {
    const prompt = 'Ask @smo for another pass';
    const mention = getAgentMentionState(prompt, 'Ask @smo'.length);
    expect(mention).toEqual({
      query: 'smo',
      start: prompt.indexOf('@smo'),
      end: prompt.indexOf('@smo') + '@smo'.length
    });
    expect(replaceAgentMention(prompt, mention!, 'smoke')).toEqual({
      nextPrompt: 'Ask @smoke for another pass',
      nextCaret: 'Ask @smoke'.length
    });
  });
});
