import { describe, expect, it } from 'vitest';
import { normalizeDisplayText } from './display-text';

describe('normalizeDisplayText', () => {
  it('repairs split product names and collapses whitespace', () => {
    expect(normalizeDisplayText('  Premium React Landing Page with sh ad cn UI and Hero Rhythm  '))
      .toBe('Premium React Landing Page with shadcn UI and Hero Rhythm');
  });

  it('repairs common split framework names', () => {
    expect(normalizeDisplayText('next js with tail wind and type script'))
      .toBe('Next.js with Tailwind and TypeScript');
  });

  it('does not merge common short words', () => {
    expect(normalizeDisplayText('go to ui')).toBe('go to ui');
  });
});
