import { describe, expect, it, vi } from 'vitest';
import {
  formatDiagnosticFinalAnswerFallback,
  OllamaFinalAnswerFormatter
} from './ollama-final-answer-formatter';

function createRuntime(responsePayload: unknown) {
  return {
    baseUrl: 'http://127.0.0.1:11434',
    fetch: vi.fn(async () =>
      new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })),
    listTags: vi.fn(),
    showModel: vi.fn(),
    detectInstall: vi.fn(),
    getStatus: vi.fn(),
    start: vi.fn()
  };
}

describe('OllamaFinalAnswerFormatter', () => {
  it('formats dense wrap-up fact blobs into readable bullets and closing paragraphs', () => {
    expect(
      formatDiagnosticFinalAnswerFallback(
        'Sure! Here are some fun facts about Mars:- 🌍 **The Red Planet:** Mars looks red due to iron oxide. - 🌙 **Moons:** Mars has Phobos and Deimos. - 🏔️ **Olympus Mons:** It is the tallest volcano in the solar system. Let me know if you want more.'
      )
    ).toBe(
      'Sure! Here are some fun facts about Mars:\n\n- 🌍 **The Red Planet:** Mars looks red due to iron oxide.\n\n- 🌙 **Moons:** Mars has Phobos and Deimos.\n\n- 🏔️ **Olympus Mons:** It is the tallest volcano in the solar system.\n\nLet me know if you want more.'
    );
  });

  it('rescues jammed markdown headings and bullets in malformed wrap-up blobs', () => {
    expect(
      formatDiagnosticFinalAnswerFallback(
        'What is Quantization in AI?### How It Works- Full precision (FP32): Each weight uses 32 bits - Quantized: Weights use fewer bits'
      )
    ).toBe(
      'What is Quantization in AI?\n\n### How It Works\n\n- Full precision (FP32): Each weight uses 32 bits\n\n- Quantized: Weights use fewer bits'
    );
  });

  it('repairs jammed follow-up prompts and titlecase list separators in wrap-up text', () => {
    expect(
      formatDiagnosticFinalAnswerFallback(
        'Other top coding models (for context): Claude Code (Anthropic)- GPT-4o / o1 (OpenAI)- DeepSeek Coder-StarCoder-CodeLlamaWant me to look up the most current coding model benchmarks?'
      )
    ).toBe(
      'Other top coding models (for context): Claude Code (Anthropic)\n\n- GPT-4o / o1 (OpenAI)\n\n- DeepSeek Coder\n\n- StarCoder\n\n- CodeLlama\n\nWant me to look up the most current coding model benchmarks?'
    );
  });

  it('preserves a single leading bullet instead of splitting it into an empty bullet plus a heading bullet', () => {
    expect(
      formatDiagnosticFinalAnswerFallback(
        '- **Founded:** 2000 by Victor Goossens and Joy Hoogeveen. Official website launched in 2001 and moved to teamliquid.net in 2002.'
      )
    ).toBe(
      '- **Founded:** 2000 by Victor Goossens and Joy Hoogeveen. Official website launched in 2001 and moved to teamliquid.net in 2002.'
    );
  });

  it('keeps hyphenated proper nouns intact while still formatting dense wrap-ups', () => {
    expect(
      formatDiagnosticFinalAnswerFallback(
        '- **Founded:** 2000 by Victor Goossens and Joy Hoogeveen. It won major titles in Dota 2, League of Legends, and Counter-Strike, and now fields teams across many games.'
      )
    ).toBe(
      '- **Founded:** 2000 by Victor Goossens and Joy Hoogeveen. It won major titles in Dota 2, League of Legends, and Counter-Strike, and now fields teams across many games.'
    );
  });

  it('strips standalone bullet separator lines from malformed summary sections', () => {
    expect(
      formatDiagnosticFinalAnswerFallback(
        [
          'Technical Advantages:',
          '',
          '-',
          '',
          'Open AI-compatible API',
          '',
          '- Easy migration from existing OpenAI integrations',
          '',
          '-'
        ].join('\n')
      )
    ).toBe(
      [
        'Technical Advantages:',
        '',
        'Open AI-compatible API',
        '',
        '- Easy migration from existing OpenAI integrations'
      ].join('\n')
    );
  });

  it('keeps structural wrap-up formatting lightweight and avoids rewriting split words inline', () => {
    expect(
      formatDiagnosticFinalAnswerFallback(
        'Created ` audit-note.txt ` successfully.\n\nContractions like *don\'t* can still arrive malformed as pron oun fragments.'
      )
    ).toBe(
      "Created `audit-note.txt` successfully.\n\nContractions like *don't* can still arrive malformed as pron oun fragments."
    );
  });

  it('preserves compact technical fragments in short fallback output', () => {
    expect(formatDiagnosticFinalAnswerFallback('m cp: hello-world')).toBe('m cp: hello-world');
  });

  it('skips short or already readable answers', async () => {
    const runtime = createRuntime({
      message: {
        content: JSON.stringify({
          lead: 'Summary',
          sections: [{ heading: 'Key Points', bullets: ['One'] }],
          closing: ''
        })
      }
    });
    const formatter = new OllamaFinalAnswerFormatter(runtime);

    expect(formatter.shouldRewrite('Short answer.')).toBe(false);
    expect(await formatter.rewrite('qwen3', 'Short answer.')).toBeNull();
    expect(runtime.fetch).not.toHaveBeenCalled();
  });

  it('rewrites dense Ollama wrap-ups into readable markdown sections', async () => {
    const runtime = createRuntime({
      message: {
        content: JSON.stringify({
          lead: 'Team Liquid started in 2000 and grew from a StarCraft community into a multi-title esports organization.',
          sections: [
            {
              heading: 'Milestones',
              bullets: [
                'Founded in 2000 by Victor Goossens and Joy Hoogeveen.',
                'Official website launched in 2001 and the organization moved to teamliquid.net in 2002.',
                'Expanded into broader esports in 2012 and merged with Team Curse in 2015.'
              ]
            },
            {
              heading: 'Later Growth',
              bullets: [
                'Axiomatic Gaming acquired a controlling interest in 2016.',
                'The organization won major titles in Dota 2, League of Legends, and Counter-Strike during the late 2010s.',
                'It now fields teams across multiple competitive games and regions.'
              ]
            }
          ],
          closing: 'I can also break this down by game or era if you want.'
        })
      }
    });
    const formatter = new OllamaFinalAnswerFormatter(runtime);
    const rewritten = await formatter.rewrite(
      'qwen3',
      '- **Founded:** 2000 by Victor Goossens and Joy Hoogeveen. Official website launched in 2001 and moved to teamliquid.net in 2002. Expanded into multi-game esports in 2012, merged with Team Curse in 2015, sold controlling interest to Axiomatic Gaming in 2016, won major titles in Dota 2, League of Legends, and Counter-Strike, and now fields teams across many games.'
    );

    expect(rewritten).toBe(
      'Team Liquid started in 2000 and grew from a StarCraft community into a multi-title esports organization.\n\n**Milestones**\n\n- Founded in 2000 by Victor Goossens and Joy Hoogeveen.\n\n- Official website launched in 2001 and the organization moved to teamliquid.net in 2002.\n\n- Expanded into broader esports in 2012 and merged with Team Curse in 2015.\n\n**Later Growth**\n\n- Axiomatic Gaming acquired a controlling interest in 2016.\n\n- The organization won major titles in Dota 2, League of Legends, and Counter-Strike during the late 2010s.\n\n- It now fields teams across multiple competitive games and regions.\n\nI can also break this down by game or era if you want.'
    );
    expect(runtime.fetch).toHaveBeenCalledOnce();
  });

  it('falls back cleanly when Ollama returns invalid structured output', async () => {
    const runtime = createRuntime({
      message: {
        content: '{"lead":42}'
      }
    });
    const formatter = new OllamaFinalAnswerFormatter(runtime);

    await expect(
      formatter.rewrite(
        'qwen3',
        'This is a long dense answer. It keeps going without enough separation. It mentions several facts. It should be reformatted into bullets for readability.'
      )
    ).resolves.toBeNull();
  });

  it('normalizes inline markdown headings when the structured rewrite output is invalid', async () => {
    const runtime = createRuntime({
      message: {
        content: '{"lead":42}'
      }
    });
    const formatter = new OllamaFinalAnswerFormatter(runtime);

    await expect(
      formatter.rewrite(
        'qwen3',
        "Based on research from Wikipedia and other trusted sources, here's what I found about the Great Wall of China:### Key facts- Length: 21,196.18 km.\n- Age: Construction began in the 7th century BCE.### Cool facts- Not visible from space with the naked eye."
      )
    ).resolves.toBe(
      "Based on research from Wikipedia and other trusted sources, here's what I found about the Great Wall of China:\n\n### Key facts\n\n- Length: 21,196.18 km.\n\n- Age: Construction began in the 7th century BCE.\n\n### Cool facts\n\n- Not visible from space with the naked eye."
    );
  });

  it('normalizes bold headings, numbered lists, and jammed closing follow-up text in the fallback path', async () => {
    const runtime = createRuntime({
      message: {
        content: '{"lead":42}'
      }
    });
    const formatter = new OllamaFinalAnswerFormatter(runtime);

    await expect(
      formatter.rewrite(
        'qwen3',
        'Here is the overview.**Key takeaways**1. First point with context.2. Second point with more detail.I can break this into implementation steps next.'
      )
    ).resolves.toBe(
      'Here is the overview.\n\n**Key takeaways**\n\n1. First point with context.\n\n2. Second point with more detail.\n\nI can break this into implementation steps next.'
    );
  });

  it('rewrites suspicious split-word answers even when the prose is not just one dense blob', async () => {
    const runtime = createRuntime({
      message: {
        content: JSON.stringify({
          lead: 'Here is the cleaned comparison.',
          sections: [
            {
              heading: 'Key Points',
              bullets: [
                'Champion count differs between the two games.',
                'Pacing and complexity vary.',
                'Esports support and learning curve also differ.'
              ]
            }
          ],
          closing: 'I can break down any category further if you want.'
        })
      }
    });
    const formatter = new OllamaFinalAnswerFormatter(runtime);

    expect(
      formatter.shouldRewrite(
        'Here’s a concise comparison.\n\nHero/Ch ampion Count - one game has more characters.\nP acing & Complexity - the other is deeper.\nCommunity - less hand-h olding overall.'
      )
    ).toBe(true);
  });

  it('flags malformed conversational answers with acronym and fragment spacing issues', () => {
    const runtime = createRuntime({
      message: {
        content: JSON.stringify({
          lead: '',
          sections: [],
          closing: ''
        })
      }
    });
    const formatter = new OllamaFinalAnswerFormatter(runtime);

    expect(
      formatter.shouldRewrite(
        'I can provide a high-level overview of how large language models (LL Ms) are created. Most modern L LMs (e.g., G PT, L La MA) use transformers. This uns up ervised phase teaches grammar and autore gressive prediction.'
      )
    ).toBe(true);
  });

  it('leaves ordinary paragraph answers alone unless they are genuinely malformed', () => {
    const runtime = createRuntime({
      message: {
        content: JSON.stringify({
          lead: 'Cleaned response.',
          sections: [{ heading: 'Key Points', bullets: ['One concise point.'] }],
          closing: ''
        })
      }
    });
    const formatter = new OllamaFinalAnswerFormatter(runtime);

    expect(
      formatter.shouldRewrite(
        'Babbage began developing the Difference Engine in the 1820s and the Analytical Engine in the 1830s, both firmly within the 1800s.'
      )
    ).toBe(false);
    expect(formatter.shouldRewrite('```ts\nconsole.log(\"hello\")\n```')).toBe(false);
  });
});
