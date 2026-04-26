import { describe, expect, it } from 'vitest';

import {
  COMPOSER_COMPACT_MIN_HEIGHT,
  COMPOSER_EXPANDED_MIN_HEIGHT,
  COMPOSER_EXPAND_PROMPT_THRESHOLD,
  resolveComposerMinHeight,
  shouldExpandComposerPrompt
} from './composer-layout';

describe('composer layout helpers', () => {
  it('keeps short prompts compact', () => {
    expect(shouldExpandComposerPrompt('Tight prompt')).toBe(false);
    expect(resolveComposerMinHeight('Tight prompt')).toBe(COMPOSER_COMPACT_MIN_HEIGHT);
  });

  it('expands once the prompt reaches the growth threshold', () => {
    const prompt = 'x'.repeat(COMPOSER_EXPAND_PROMPT_THRESHOLD);

    expect(shouldExpandComposerPrompt(prompt)).toBe(true);
    expect(resolveComposerMinHeight(prompt)).toBe(COMPOSER_EXPANDED_MIN_HEIGHT);
  });

  it('expands immediately for multiline prompts', () => {
    expect(shouldExpandComposerPrompt('Line one\nLine two')).toBe(true);
    expect(resolveComposerMinHeight('Line one\nLine two')).toBe(COMPOSER_EXPANDED_MIN_HEIGHT);
  });
});
