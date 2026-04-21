import { describe, expect, it } from 'vitest';
import { deriveRunActivityInfo } from './run-activity';

describe('deriveRunActivityInfo', () => {
  it('classifies web search progress lines', () => {
    expect(deriveRunActivityInfo('openai', 'Searching web for hero section patterns')).toEqual({
      kind: 'web_search',
      phase: 'started',
      query: 'hero section patterns',
      summary: 'Searching web for hero section patterns'
    });
    expect(deriveRunActivityInfo('openai', 'Searched web for hero section patterns')).toEqual({
      kind: 'web_search',
      phase: 'completed',
      query: 'hero section patterns',
      summary: 'Searched web for hero section patterns'
    });
  });

  it('classifies compact terminal summaries', () => {
    expect(deriveRunActivityInfo('openai', 'Running npm test')).toEqual({
      kind: 'terminal_command',
      phase: 'started',
      command: 'npm test',
      summary: 'Running npm test'
    });
    expect(deriveRunActivityInfo('openai', 'Background terminal finished with npm test')).toEqual({
      kind: 'terminal_command',
      phase: 'completed',
      command: 'npm test',
      summary: 'Background terminal finished with npm test'
    });
    expect(deriveRunActivityInfo('openai', 'Started background terminal with npm test')).toEqual({
      kind: 'terminal_command',
      phase: 'started',
      command: 'npm test',
      summary: 'Background terminal running with npm test'
    });
  });

  it('classifies Gemini skill and extension loading lines as skill activity', () => {
    expect(deriveRunActivityInfo('gemini', 'Loading extension: superpowers')).toEqual({
      kind: 'skill',
      summary: 'superpowers',
      text: 'superpowers'
    });
    expect(deriveRunActivityInfo('gemini', 'Loaded skill: concise')).toEqual({
      kind: 'skill',
      summary: 'concise',
      text: 'concise'
    });
  });
});
