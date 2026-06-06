import { describe, expect, it } from 'vitest';
import { appendAssistantStreamChunk } from './stream-assembler';

describe('assistant stream assembler', () => {
  it('appends cleaned chunks exactly without inventing boundary spaces or word repairs', () => {
    expect(appendAssistantStreamChunk('Ref', 'inement complete.')).toMatchObject({
      text: 'Refinement complete.',
      delta: 'inement complete.',
      normalizedChunk: 'inement complete.',
      replace: false
    });
    expect(appendAssistantStreamChunk('exactly two', ' short sentences.').text).toBe(
      'exactly two short sentences.'
    );
    expect(appendAssistantStreamChunk('exactly two', 'short sentences.').text).toBe(
      'exactly twoshort sentences.'
    );
    expect(appendAssistantStreamChunk('', 'calcul ators').text).toBe('calcul ators');
  });

  it('applies safe chunk cleanup while preserving explicit boundary whitespace', () => {
    expect(appendAssistantStreamChunk('hello', ' , world !')).toMatchObject({
      text: 'hello, world!',
      delta: ', world!',
      normalizedChunk: ', world!',
      replace: false
    });
    expect(appendAssistantStreamChunk('exactly two', ' short sentences.')).toMatchObject({
      delta: ' short sentences.',
      normalizedChunk: ' short sentences.'
    });
  });
});
