import { describe, expect, it } from 'vitest';
import {
  appendVoiceTranscript,
  normalizeVoiceTranscript
} from './voice-dictation';

describe('voice-dictation helpers', () => {
  it('normalizes collapsed transcript whitespace', () => {
    expect(normalizeVoiceTranscript('  hello   there \n general   kenobi  ')).toBe('hello there general kenobi');
  });

  it('appends transcript to an existing prompt with one space', () => {
    expect(appendVoiceTranscript('Make me a hero section.', 'add a glowing button')).toBe(
      'Make me a hero section. add a glowing button'
    );
  });

  it('uses transcript alone when the prompt is empty', () => {
    expect(appendVoiceTranscript('', 'hello world')).toBe('hello world');
  });
});
