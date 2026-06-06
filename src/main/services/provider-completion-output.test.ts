import { describe, expect, it } from 'vitest';
import {
  formatProviderCompletionOutput,
  resolveProviderCompletionText,
  resolveProviderCompletionOutput
} from './provider-completion-output';

describe('provider-completion-output', () => {
  const denseMars =
    'Sure! Here are some fun facts about Mars:- 🌍 **The Red Planet:** Mars looks red due to iron oxide. - 🌙 **Moons:** Mars has Phobos and Deimos. - 🏔️ **Olympus Mons:** It is the tallest volcano in the solar system. Let me know if you want more.';

  it('formats ollama completion text through the shared safe cleanup seam', () => {
    expect(formatProviderCompletionOutput('ollama', denseMars)).toBe(denseMars);
    expect(formatProviderCompletionOutput('ollama', 'hello , world !')).toBe('hello, world!');
  });

  it('resolves dense ollama completion output without model-powered restructuring', () => {
    expect(
      resolveProviderCompletionOutput({
        providerId: 'ollama',
        output: denseMars,
        streamedDeltaOutput: denseMars,
        assistantTurnOutput: denseMars
      })
    ).toBe(denseMars);
  });

  it('keeps resolved assistant text separate from provider-specific completion formatting', () => {
    expect(
      resolveProviderCompletionText({
        providerId: 'ollama',
        output: denseMars,
        streamedDeltaOutput: denseMars,
        assistantTurnOutput: denseMars
      })
    ).toBe(denseMars);
  });

  it('prefers corrected assistant-turn text over stale delta history when late repairs rewrote earlier spacing', () => {
    expect(
      resolveProviderCompletionOutput({
        providerId: 'openai',
        output: 'The file is at D:\\DEV\\Vicode-Testing\\port fol ite\\index.html.',
        streamedDeltaOutput: 'The file is at D:\\DEV\\Vicode-Testing\\port fol ite\\index.html.',
        assistantTurnOutput: 'The file is at D:\\DEV\\Vicode-Testing\\portfolite\\index.html.'
      })
    ).toBe('The file is at D:\\DEV\\Vicode-Testing\\portfolite\\index.html.');
  });
});
