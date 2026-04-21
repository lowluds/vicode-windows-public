import { describe, expect, it } from 'vitest';
import { createProviderReplyAssembly } from './provider-reply-assembly';

describe('provider-reply-assembly', () => {
  it('emits a replace update when a later snapshot corrects earlier malformed spacing', () => {
    let currentText = 'AImodels can still fail.';
    const persistedDeltas: string[] = [];
    const emittedDeltas: string[] = [];
    const emittedReplacements: string[] = [];

    const assembly = createProviderReplyAssembly({
      providerId: 'openai',
      readCurrentText: () => currentText,
      persistDelta: (delta) => {
        persistedDeltas.push(delta);
      },
      persistText: (text) => {
        currentText = text;
      },
      emitDelta: (delta) => {
        emittedDeltas.push(delta);
      },
      emitReplace: (text) => {
        emittedReplacements.push(text);
      }
    });

    assembly.handleSnapshot('AI models can still fail.');
    expect(currentText).toBe('AI models can still fail.');
    expect(emittedDeltas).toEqual([]);
    expect(persistedDeltas).toEqual([]);
    expect(emittedReplacements).toEqual(['AI models can still fail.']);
  });
});
