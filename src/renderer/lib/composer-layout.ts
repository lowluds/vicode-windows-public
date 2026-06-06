export const COMPOSER_COMPACT_MIN_HEIGHT = 34;
export const COMPOSER_EXPANDED_MIN_HEIGHT = 48;
export const COMPOSER_EXPAND_PROMPT_THRESHOLD = 72;

export function shouldExpandComposerPrompt(prompt: string) {
  return prompt.includes('\n') || prompt.trim().length >= COMPOSER_EXPAND_PROMPT_THRESHOLD;
}

export function resolveComposerMinHeight(prompt: string) {
  return shouldExpandComposerPrompt(prompt) ? COMPOSER_EXPANDED_MIN_HEIGHT : COMPOSER_COMPACT_MIN_HEIGHT;
}
