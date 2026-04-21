import { describe, expect, it } from 'vitest';
import {
  buildNativeComposerCommandPrompt,
  parseLeadingNativeComposerCommand,
  resolveNativePlanCommand,
  searchNativeComposerCommands
} from './nativeCommands';

describe('nativeCommands', () => {
  it('parses a leading slash command with body text', () => {
    expect(parseLeadingNativeComposerCommand('/review inspect this diff')).toEqual({
      command: expect.objectContaining({ id: 'review', token: 'review' }),
      body: 'inspect this diff'
    });
  });

  it('parses autonomous-builds aliases to the same command', () => {
    expect(parseLeadingNativeComposerCommand('/autonomous-builds ship the docs')).toEqual({
      command: expect.objectContaining({ id: 'autonomous-builds', token: 'autonomous-builds' }),
      body: 'ship the docs'
    });
    expect(parseLeadingNativeComposerCommand('/build-plan ship the docs')).toEqual({
      command: expect.objectContaining({ id: 'autonomous-builds', token: 'autonomous-builds' }),
      body: 'ship the docs'
    });
    expect(parseLeadingNativeComposerCommand('/auto-build ship the docs')).toEqual({
      command: expect.objectContaining({ id: 'autonomous-builds', token: 'autonomous-builds' }),
      body: 'ship the docs'
    });
  });

  it('keeps review prompt shaping intact', () => {
    expect(buildNativeComposerCommandPrompt('review', 'this PR')).toContain('Review the following with a senior engineer mindset.');
  });

  it('shapes build-app requests into a concrete builder brief', () => {
    const prompt = buildNativeComposerCommandPrompt('build-app', 'Create a tiny counter website.');
    expect(prompt).toContain('Turn the request below into a concrete build brief for a small app or website');
    expect(prompt).toContain('create or update real files instead of pseudocode');
    expect(prompt).toContain('Create a tiny counter website.');
  });

  it('rejects unsupported native plan commands without rewriting the prompt', () => {
    const result = resolveNativePlanCommand({
      body: 'Build a tiny marketing site for a coffee roaster.',
      plannerSupported: false,
      providerLabel: 'Ollama'
    });

    expect(result).toEqual({
      kind: 'unsupported',
      nextMode: 'default',
      prompt: 'Build a tiny marketing site for a coffee roaster.',
      toastMessage: 'Ollama does not support native Plan mode yet. /plan is disabled for this provider.'
    });
  });

  it('prioritizes direct token matches ahead of description-only matches', () => {
    expect(searchNativeComposerCommands('plan').map((command) => command.id)[0]).toBe('plan');
  });

  it('surfaces slash-command aliases in search results', () => {
    expect(searchNativeComposerCommands('build-plan').map((command) => command.id)[0]).toBe('autonomous-builds');
  });
});
