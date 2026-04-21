import { describe, expect, it } from 'vitest';
import type { SkillDefinition } from '../../shared/domain';
import { findTranscriptSkillMentions, normalizeTranscriptMarkdownSource } from './transcript-markdown';

function createSkill(id: string, name: string, slug: string): SkillDefinition {
  return {
    id,
    name,
    description: `${name} description`,
    instructions: `${name} instructions`,
    origin: 'local',
    scope: 'global',
    providerTargets: [],
    enabled: true,
    projectId: null,
    metadata: { slug },
    path: null,
    createdAt: '2026-03-16T00:00:00.000Z',
    updatedAt: '2026-03-16T00:00:00.000Z'
  };
}

describe('findTranscriptSkillMentions', () => {
  const skills = [
    createSkill('skill-1', 'Chrome DevTools MCP', 'chrome-devtools-mcp'),
    createSkill('skill-2', 'Playwright Interactive', 'playwright-interactive')
  ];

  it('matches explicit $skill mentions for transcript rendering', () => {
    expect(findTranscriptSkillMentions('Use $chrome-devtools-mcp, then $playwright-interactive.', skills)).toEqual([
      {
        slug: 'chrome-devtools-mcp',
        startIndex: 4,
        nextIndex: 24
      },
      {
        slug: 'playwright-interactive',
        startIndex: 31,
        nextIndex: 54
      }
    ]);
  });

  it('matches plain skill slugs when the assistant is explicitly using them', () => {
    expect(
      findTranscriptSkillMentions(
        'Using chrome-devtools-mcp to inspect the app, then playwright-interactive to verify it.',
        skills
      )
    ).toEqual([
      {
        slug: 'chrome-devtools-mcp',
        startIndex: 6,
        nextIndex: 25
      },
      {
        slug: 'playwright-interactive',
        startIndex: 51,
        nextIndex: 73
      }
    ]);
  });

  it('does not convert bare slug text without a skill-use cue or $ prefix', () => {
    expect(findTranscriptSkillMentions('Use chrome-devtools-mcp in the browser.', skills)).toEqual([]);
  });
});

describe('normalizeTranscriptMarkdownSource', () => {
  it('rescues inline list formatting so markdown can render bullets', () => {
    expect(
      normalizeTranscriptMarkdownSource(
        'Here are some strong teams:- T1: South Korea. - Cloud9: North America. - G2: Europe.'
      )
    ).toBe('Here are some strong teams:\n- T1: South Korea.\n- Cloud9: North America.\n- G2: Europe.');
  });

  it('rescues emoji-led inline fact lists into readable bullets', () => {
    expect(
      normalizeTranscriptMarkdownSource(
        'Sure! Here are some fun facts about Mars:- 🌍 **The Red Planet:** Mars looks red due to iron oxide. - 🌙 **Moons:** Mars has Phobos and Deimos. - 🏔️ **Olympus Mons:** It is the tallest volcano in the solar system.'
      )
    ).toBe(
      'Sure! Here are some fun facts about Mars:\n- 🌍 **The Red Planet:** Mars looks red due to iron oxide.\n- 🌙 **Moons:** Mars has Phobos and Deimos.\n- 🏔️ **Olympus Mons:** It is the tallest volcano in the solar system.'
    );
  });

  it('does not inject empty bullets into existing markdown lists with bold labels', () => {
    expect(
      normalizeTranscriptMarkdownSource(
        [
          'Current Weather in Ottawa',
          '',
          'As of 12:40 AM EDT Monday, 20 April 2026 (Ottawa Macdonald-Cartier Intl Airport):',
          '',
          '- **Temperature:** 1.1C',
          '',
          '- **Condition:** Light snow shower',
          '',
          '- **Wind:** NW 18 km/h'
        ].join('\n')
      )
    ).toBe(
      [
        'Current Weather in Ottawa',
        '',
        'As of 12:40 AM EDT Monday, 20 April 2026 (Ottawa Macdonald-Cartier Intl Airport):',
        '- **Temperature:** 1.1C',
        '- **Condition:** Light snow shower',
        '- **Wind:** NW 18 km/h'
      ].join('\n')
    );
  });

  it('repairs ordered list markers that were split onto their own line', () => {
    expect(
      normalizeTranscriptMarkdownSource(
        [
          'Next Steps',
          '',
          'Would you like me to:',
          '',
          '1.',
          '',
          'Help you fine-tune a small model on some data?',
          '',
          '2.',
          '',
          'Build a simple transformer architecture from scratch in Python?',
          '',
          '3.',
          '',
          'Set up a RAG system with your own data?'
        ].join('\n')
      )
    ).toBe(
      [
        'Next Steps',
        '',
        'Would you like me to:',
        '',
        '1. Help you fine-tune a small model on some data?',
        '',
        '2. Build a simple transformer architecture from scratch in Python?',
        '',
        '3. Set up a RAG system with your own data?'
      ].join('\n')
    );
  });

  it('repairs bold ordered headings that were split after the numeric marker', () => {
    expect(
      normalizeTranscriptMarkdownSource(
        [
          '**1.',
          '',
          'Fine-tune an Existing Model (Recommended for beginners)**',
          '',
          '**2.',
          '',
          'Train a Small Model from Scratch**'
        ].join('\n')
      )
    ).toBe(
      [
        '1. **Fine-tune an Existing Model (Recommended for beginners)**',
        '',
        '2. **Train a Small Model from Scratch**'
      ].join('\n')
    );
  });

  it('preserves already-structured markdown without reworking it again in the renderer', () => {
    const source = [
      'What is Quantization in AI?',
      '',
      '### How It Works',
      '- Full precision (FP32): Each weight uses 32 bits',
      '- Quantized: Weights use fewer bits'
    ].join('\n');

    expect(normalizeTranscriptMarkdownSource(source)).toBe(source);
  });

  it('rescues jammed markdown headings and list items into readable blocks', () => {
    expect(
      normalizeTranscriptMarkdownSource(
        'What is Quantization in AI?### How It Works- Full precision (FP32): Each weight uses 32 bits - Quantized: Weights use fewer bits'
      )
    ).toBe(
      'What is Quantization in AI?\n\n### How It Works\n- Full precision (FP32): Each weight uses 32 bits\n- Quantized: Weights use fewer bits'
    );
  });

  it('preserves provider text instead of trying to repair fragmented words in the renderer', () => {
    expect(
      normalizeTranscriptMarkdownSource('This assistant reply mentions e-s ports, D ota 2, L oL, Ch ampion counts, and less hand-h olding.')
    ).toBe('This assistant reply mentions e-s ports, D ota 2, L oL, Ch ampion counts, and less hand-h olding.');
  });

  it('does not invent acronym joins in the renderer', () => {
    expect(
      normalizeTranscriptMarkdownSource('Modern L LMs like G PT and L La MA often appear in malformed replies.')
    ).toBe('Modern L LMs like G PT and L La MA often appear in malformed replies.');
  });

  it('does not perform general punctuation or parenthesis cleanup in the renderer', () => {
    expect(
      normalizeTranscriptMarkdownSource('Hello , world ( spaced ) and hand- holding should stay provider-owned.')
    ).toBe('Hello , world ( spaced ) and hand- holding should stay provider-owned.');
  });

  it('keeps ordered setup steps aligned instead of breaking bold step labels into bullets', () => {
    expect(
      normalizeTranscriptMarkdownSource(
        [
          'Steps to run your website:',
          '1. **Navigate to the project directory:**',
          'bash',
          'cd vibevox-replica',
          '2. **Install dependencies** (if not already installed):',
          'bash',
          'npm install',
          '3. **Start the development server:**',
          'bash',
          'npm run dev',
          '4. **Access your website:**',
          '- The development server will start and provide a local URL (typically http://localhost:5173)',
          '- Open this URL in your browser to see your VibeVox replica website'
        ].join('\n')
      )
    ).toBe(
      [
        'Steps to run your website:',
        '1. **Navigate to the project directory:**',
        '```bash',
        'cd vibevox-replica',
        '```',
        '2. **Install dependencies** (if not already installed):',
        '```bash',
        'npm install',
        '```',
        '3. **Start the development server:**',
        '```bash',
        'npm run dev',
        '```',
        '4. **Access your website:**',
        '- The development server will start and provide a local URL (typically http://localhost:5173)',
        '- Open this URL in your browser to see your VibeVox replica website'
      ].join('\n')
    );
  });

  it('adds shell highlighting to unlabeled command fences', () => {
    expect(
      normalizeTranscriptMarkdownSource(
        [
          '```',
          'npm run vicode -- publish --dir D:\\Projects\\MyProject',
          'pnpm install',
          '```'
        ].join('\n')
      )
    ).toBe(
      [
        '```bash',
        'npm run vicode -- publish --dir D:\\Projects\\MyProject',
        'pnpm install',
        '```'
      ].join('\n')
    );
  });

  it('adds http highlighting to unlabeled endpoint fences', () => {
    expect(
      normalizeTranscriptMarkdownSource(
        [
          '```',
          'POST /api/projects',
          'PATCH /api/projects/:id',
          '```'
        ].join('\n')
      )
    ).toBe(
      [
        '```http',
        'POST /api/projects',
        'PATCH /api/projects/:id',
        '```'
      ].join('\n')
    );
  });

  it('adds yaml highlighting to unlabeled frontmatter-like fences', () => {
    expect(
      normalizeTranscriptMarkdownSource(
        [
          '```',
          'title: Hello World',
          'slug: hello-world',
          '```'
        ].join('\n')
      )
    ).toBe(
      [
        '```yaml',
        'title: Hello World',
        'slug: hello-world',
        '```'
      ].join('\n')
    );
  });

  it('adds typescript highlighting to unlabeled code fences', () => {
    expect(
      normalizeTranscriptMarkdownSource(
        [
          '```',
          'type Awaited<T> = T extends Promise<infer U> ? U : T;',
          'interface ApiResponse<T> { data: T; status: number; }',
          'const response = await safeFetch<MyUser>(\'/api/user\');',
          '```'
        ].join('\n')
      )
    ).toBe(
      [
        '```ts',
        'type Awaited<T> = T extends Promise<infer U> ? U : T;',
        'interface ApiResponse<T> { data: T; status: number; }',
        'const response = await safeFetch<MyUser>(\'/api/user\');',
        '```'
      ].join('\n')
    );
  });

  it('adds python highlighting to unlabeled code fences', () => {
    expect(
      normalizeTranscriptMarkdownSource(
        [
          '```',
          'import time',
          'def retry(fn, attempts=3):',
          '    return fn()',
          '```'
        ].join('\n')
      )
    ).toBe(
      [
        '```python',
        'import time',
        'def retry(fn, attempts=3):',
        '    return fn()',
        '```'
      ].join('\n')
    );
  });
});
