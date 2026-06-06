import { describe, expect, it } from 'vitest';
import { normalizeAssistantVisibleTextChunk } from '../assistant-text-normalization';
import {
  detectAssistantTextQuality,
  findAssistantTextQualityIssues
} from './text-quality-detector';

describe('assistant text quality detector', () => {
  it('flags split-word artifacts as diagnostics without repairing visible text', () => {
    const issues = findAssistantTextQualityIssues('calcul ators and add ition should be readable.');

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'split_word_fragment' })
      ])
    );
    expect(normalizeAssistantVisibleTextChunk('calcul ators and add ition should be readable.')).toBe(
      'calcul ators and add ition should be readable.'
    );
  });

  it('summarizes RU-02 text quality artifacts as warnings', () => {
    expect(detectAssistantTextQuality('easy-to-s can app,focus app,consider add ition')).toMatchObject({
      severity: 'warning',
      issueCount: expect.any(Number)
    });
  });

  it('keeps normal acronyms, urls, headings, CJK-adjacent text, and short words clean', () => {
    const cleanSamples = [
      'R&D remains a common abbreviation.',
      'The reference is https://example.com/docs and it renders normally.',
      '### Key facts',
      'Use AI models when the task warrants it.',
      '你好 world can appear in multilingual output.',
      'It now fields teams across many games.',
      'Start with plain HTML for simplicity.',
      'Create the basic HTML, CSS, and JavaScript files.'
    ];

    for (const sample of cleanSamples) {
      expect(findAssistantTextQualityIssues(sample)).toEqual([]);
      expect(detectAssistantTextQuality(sample)).toMatchObject({
        severity: 'ok',
        issueCount: 0
      });
    }
  });
});
