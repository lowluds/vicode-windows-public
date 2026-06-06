import { describe, expect, it } from 'vitest';
import { cleanFinalAssistantDisplayText } from './final-display-cleanup';

describe('final assistant display cleanup', () => {
  it('applies safe structural cleanup without repairing internal word fragments', () => {
    expect(cleanFinalAssistantDisplayText('hello , world !')).toBe('hello, world!');
    expect(cleanFinalAssistantDisplayText('A\r\n\r\n\r\nB')).toBe('A\n\nB');
    expect(cleanFinalAssistantDisplayText('Amb iguous requirements')).toBe('Amb iguous requirements');
    expect(cleanFinalAssistantDisplayText('Tail wind CSS')).toBe('Tail wind CSS');
  });

  it('cleans markdown wrapper spacing and display-only control characters', () => {
    expect(cleanFinalAssistantDisplayText('Created ` audit-note.txt ` successfully.\u0007')).toBe(
      'Created `audit-note.txt` successfully.'
    );
  });

  it('keeps provider markup stripping opt-in', () => {
    const source = [
      'Thinking: inspect files first.',
      '<function_calls><invoke name="read_file"></invoke></function_calls>',
      'Final answer starts here.'
    ].join('\n');

    expect(cleanFinalAssistantDisplayText(source)).toContain('<function_calls>');
    expect(
      cleanFinalAssistantDisplayText(source, {
        stripXmlFunctionCallMarkup: true,
        stripReasoningLabels: true
      })
    ).toBe('Final answer starts here.');
  });
});
