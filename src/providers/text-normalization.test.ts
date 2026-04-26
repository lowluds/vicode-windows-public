import { describe, expect, it } from 'vitest';
import {
  appendAssistantTextDelta,
  findSuspiciousAssistantTextPatterns,
  normalizeAssistantVisibleTextChunk,
  preferNormalizedAssistantText,
  reconcileAssistantTextSnapshot
} from './text-normalization';

describe('provider text normalization', () => {
  it('removes Ollama-style xml tool markup and reasoning labels before joining text', () => {
    const normalized = normalizeAssistantVisibleTextChunk(
      'Thinking: inspect files first.\n<function_calls><invoke name="read_file"></invoke></function_calls>\nFinal answer starts here.',
      {
        stripXmlFunctionCallMarkup: true,
        stripReasoningLabels: true
      }
    );

    expect(normalized).toBe('Final answer starts here.');
  });

  it('returns a shared normalized delta with readable word spacing between chunks', () => {
    const first = appendAssistantTextDelta('Yes,', '“the 21st night of September”');
    expect(first.text).toBe('Yes, “the 21st night of September”');
    expect(first.delta).toBe(' “the 21st night of September”');

    const second = appendAssistantTextDelta(first.text, 'is a poetic line.');
    expect(second.text).toBe('Yes, “the 21st night of September” is a poetic line.');
    expect(second.delta).toBe(' is a poetic line.');
  });

  it('inserts readable spaces between adjacent lowercase word chunks without splitting continuations', () => {
    const greeting = appendAssistantTextDelta('Hey!', "I'm doing");
    expect(greeting.text).toBe("Hey! I'm doing");
    expect(greeting.delta).toBe(" I'm doing");

    const first = appendAssistantTextDelta(greeting.text, 'well,thanks');
    expect(first.text).toBe("Hey! I'm doing well, thanks");
    expect(first.delta).toBe(' well, thanks');

    const second = appendAssistantTextDelta(first.text, 'for asking.How are');
    expect(second.text).toBe("Hey! I'm doing well, thanks for asking. How are");
    expect(second.delta).toBe(' for asking. How are');

    const third = appendAssistantTextDelta(second.text, 'you?');
    expect(third.text).toBe("Hey! I'm doing well, thanks for asking. How are you?");
    expect(third.delta).toBe(' you?');

    const continuation = appendAssistantTextDelta('Ref', 'inement complete.');
    expect(continuation.text).toBe('Refinement complete.');
    expect(continuation.delta).toBe('inement complete.');

    const geminiContinuation = appendAssistantTextDelta('Gem', 'ini shell regression chat passed.');
    expect(geminiContinuation.text).toBe('Gemini shell regression chat passed.');
    expect(geminiContinuation.delta).toBe('ini shell regression chat passed.');

    const ambiguousContinuation = appendAssistantTextDelta('Amb', 'iguous requirements');
    expect(ambiguousContinuation.text).toBe('Ambiguous requirements');
    expect(ambiguousContinuation.delta).toBe('iguous requirements');

    const agenticFirst = appendAssistantTextDelta('', 'Agent');
    const agenticSecond = appendAssistantTextDelta(agenticFirst.text, 'ic');
    const agenticThird = appendAssistantTextDelta(agenticSecond.text, 'workflows with tool use');
    expect(agenticThird.text).toBe('Agentic workflows with tool use');
    expect(agenticThird.delta).toBe(' workflows with tool use');

    const acronymBoundary = appendAssistantTextDelta('10GB VRAM', 'while retaining near-full functionality.');
    expect(acronymBoundary.text).toBe('10GB VRAM while retaining near-full functionality.');
    expect(acronymBoundary.delta).toBe(' while retaining near-full functionality.');

    const technicalFragment = appendAssistantTextDelta('m', 'cp: hello-world');
    expect(technicalFragment.text).toBe('mcp: hello-world');
    expect(technicalFragment.delta).toBe('cp: hello-world');
  });

  it('promotes separate prose blocks into paragraph breaks when a later chunk starts a new sentence block', () => {
    const next = appendAssistantTextDelta('Created hello.txt.', ' Added a friendly greeting.');
    expect(next.text).toBe('Created hello.txt.\n\nAdded a friendly greeting.');
    expect(next.delta).toBe('\n\nAdded a friendly greeting.');
  });

  it('does not turn ordered list item continuations into paragraph breaks', () => {
    const first = appendAssistantTextDelta('', '1.');
    expect(first.text).toBe('1.');

    const second = appendAssistantTextDelta(first.text, ' Help you fine-tune a small model on some data?');
    expect(second.text).toBe('1. Help you fine-tune a small model on some data?');
    expect(second.delta).toBe(' Help you fine-tune a small model on some data?');

    const boldFirst = appendAssistantTextDelta('', '**1.');
    expect(boldFirst.text).toBe('**1.');

    const boldSecond = appendAssistantTextDelta(
      boldFirst.text,
      ' Fine-tune an Existing Model (Recommended for beginners)**'
    );
    expect(boldSecond.text).toBe('**1. Fine-tune an Existing Model (Recommended for beginners)**');
    expect(boldSecond.delta).toBe(' Fine-tune an Existing Model (Recommended for beginners)**');
  });

  it('preserves markdown section boundaries when later chunks start with blank lines', () => {
    const first = appendAssistantTextDelta('', 'What is Quantization in AI?');
    expect(first.text).toBe('What is Quantization in AI?');

    const second = appendAssistantTextDelta(first.text, '\n\n### How It Works\n- Full precision (FP32): Each weight uses 32 bits');
    expect(second.text).toBe(
      'What is Quantization in AI?\n\n### How It Works\n- Full precision (FP32): Each weight uses 32 bits'
    );
    expect(second.delta).toBe('\n\n### How It Works\n- Full precision (FP32): Each weight uses 32 bits');

    const third = appendAssistantTextDelta(second.text, '\nOriginal weight: 0.84756293 (32-bit float)');
    expect(third.text).toBe(
      'What is Quantization in AI?\n\n### How It Works\n- Full precision (FP32): Each weight uses 32 bits\nOriginal weight: 0.84756293 (32-bit float)'
    );
    expect(third.delta).toBe('\nOriginal weight: 0.84756293 (32-bit float)');
  });

  it('no-ops when normalization strips the whole chunk', () => {
    const next = appendAssistantTextDelta('Current text', '<function_calls></function_calls>', {
      stripXmlFunctionCallMarkup: true
    });

    expect(next.text).toBe('Current text');
    expect(next.delta).toBe('');
    expect(next.normalizedChunk).toBe('');
  });

  it('reconciles full assistant snapshots through the shared delta contract', () => {
    expect(reconcileAssistantTextSnapshot('Yes,', 'Yes,', 'Yes,“the 21st night of September”')).toEqual({
      text: 'Yes, “the 21st night of September”',
      delta: ' “the 21st night of September”',
      snapshotText: 'Yes,“the 21st night of September”',
      replace: false
    });
  });

  it('prefers the existing normalized assistant text when a later snapshot only differs by spacing', () => {
    expect(
      preferNormalizedAssistantText(
        'Yes, “the 21st night of September”',
        'Yes,“the 21st night of September”'
      )
    ).toBe('Yes, “the 21st night of September”');
  });

  it('prefers the cleaner snapshot when compact text matches but the current text still has split-word artifacts', () => {
    expect(
      preferNormalizedAssistantText(
        'Amb iguous requirements or design decisions',
        'Ambiguous requirements or design decisions'
      )
    ).toBe('Ambiguous requirements or design decisions');
  });

  it('keeps the current streamed text when a later snapshot only compacts readable word spacing', () => {
    expect(
      preferNormalizedAssistantText(
        "Hey! I'm doing well, thanks for asking. How are you?",
        "Hey!I'm doingwell,thanksfor asking.How areyou?"
      )
    ).toBe("Hey! I'm doing well, thanks for asking. How are you?");
  });

  it('detects generic suspicious fragment patterns in malformed assistant prose', () => {
    expect(
      findSuspiciousAssistantTextPatterns(
        'Most modern L LMs (e.g., G PT, L La MA) use transformers. This ev okes why malformed spacing is distracting.'
      )
    ).toEqual(
      expect.arrayContaining([
        'split-acronym-fragment'
      ])
    );
  });

  it('repairs longer split word fragments in inline assistant prose', () => {
    expect(normalizeAssistantVisibleTextChunk('Amb iguous requirements or design decisions')).toBe(
      'Ambiguous requirements or design decisions'
    );
    expect(normalizeAssistantVisibleTextChunk('Complex multi-file ref actoring')).toBe(
      'Complex multi-file refactoring'
    );
    expect(normalizeAssistantVisibleTextChunk('Quant ization keeps 7B local models practical.')).toBe(
      'Quantization keeps 7B local models practical.'
    );
    expect(normalizeAssistantVisibleTextChunk('Agent ic workflows with tool use')).toBe(
      'Agentic workflows with tool use'
    );
    expect(normalizeAssistantVisibleTextChunk('h ello world')).toBe('hello world');
    expect(normalizeAssistantVisibleTextChunk('m cp: hello-world')).toBe('mcp: hello-world');
    expect(normalizeAssistantVisibleTextChunk('AImodels can still fail if VRAMwhile loading is too limited.')).toBe(
      'AI models can still fail if VRAM while loading is too limited.'
    );
    expect(
      normalizeAssistantVisibleTextChunk(
        'The site is built in Framer and uses Tail wind CSS key frames for mim icking the look.'
      )
    ).toBe(
      'The site is built in Framer and uses Tailwind CSS keyframes for mimicking the look.'
    );
    expect(
      normalizeAssistantVisibleTextChunk(
        'I cannot replicate https://port fol ite.framer.website/ exactly without the original source.'
      )
    ).toBe(
      'I cannot replicate https://portfolite.framer.website/ exactly without the original source.'
    );
    expect(normalizeAssistantVisibleTextChunk('Dec orative animated cloud elements with blur effects')).toBe(
      'Decorative animated cloud elements with blur effects'
    );
    expect(normalizeAssistantVisibleTextChunk('Glass Morph ism Design')).toBe(
      'Glass Morphism Design'
    );
    expect(normalizeAssistantVisibleTextChunk('Respons ive design with mobile breakpoints')).toBe(
      'Responsive design with mobile breakpoints'
    );
    expect(normalizeAssistantVisibleTextChunk('It now fields teams across many games.')).toBe(
      'It now fields teams across many games.'
    );
    expect(normalizeAssistantVisibleTextChunk('### Key facts')).toBe('### Key facts');
  });

  it('marks snapshot-driven whole-text repairs as replacements when later snapshots correct earlier spacing', () => {
    const reconciled = reconcileAssistantTextSnapshot(
      'Open https://port fol',
      'Open https://port fol',
      'Open https://portfolite.framer.website/'
    );

    expect(reconciled.text).toBe('Open https://portfolite.framer.website/');
    expect(reconciled.delta).toBe('');
    expect(reconciled.replace).toBe(true);
  });

  it('does not flag normal sentence-start capitals or hyphenated dates as malformed fragments', () => {
    expect(
      findSuspiciousAssistantTextPatterns(
        'Babbage began developing the Difference Engine in the 1820s and the Analytical Engine in the 1830s, both firmly within the 1800s. Historical records confirm his key work spanned the early to mid-19th century.'
      )
    ).toEqual([]);
  });

  it('treats compact all-caps ampersand abbreviations as valid while still flagging jammed prose', () => {
    expect(findSuspiciousAssistantTextPatterns('R&D remains a common abbreviation.')).toEqual([]);
    expect(findSuspiciousAssistantTextPatterns('Earth, Wind&Fire made the line iconic.')).toEqual(
      expect.arrayContaining(['jammed-ampersand'])
    );
  });

  it('flags split word fragments that previously slipped through the detector', () => {
    expect(findSuspiciousAssistantTextPatterns('Amb iguous requirements')).toEqual(
      expect.arrayContaining(['split-suffix-fragment'])
    );
    expect(findSuspiciousAssistantTextPatterns('Complex multi-file ref actoring')).toEqual(
      expect.arrayContaining(['split-suffix-fragment'])
    );
    expect(findSuspiciousAssistantTextPatterns('Agent ic workflows with tool use')).toEqual(
      expect.arrayContaining(['split-word-fragment'])
    );
    expect(findSuspiciousAssistantTextPatterns('m cp: hello-world')).toEqual(
      expect.arrayContaining(['split-acronym-fragment'])
    );
    expect(findSuspiciousAssistantTextPatterns('AImodel output can still jam words together.')).toEqual(
      expect.arrayContaining(['missing-space-after-acronym'])
    );
    expect(findSuspiciousAssistantTextPatterns('VRAMwhile loading the model, throughput drops.')).toEqual(
      expect.arrayContaining(['missing-space-after-acronym'])
    );
    expect(findSuspiciousAssistantTextPatterns('Tail wind CSS key frames can still break readability.')).toEqual(
      expect.arrayContaining(['split-word-fragment'])
    );
    expect(findSuspiciousAssistantTextPatterns('The demo lives at https://port fol ite.framer.website/.')).toEqual(
      expect.arrayContaining(['split-domain-fragment'])
    );
  });

});
