import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertOutsideOperatorCodexHome, isInsideOperatorCodexHome } from './codex-app-boundary';

describe('Codex app boundary', () => {
  it('identifies descendants of the operator Codex home', () => {
    expect(isInsideOperatorCodexHome(join(homedir(), '.codex', 'sqlite', 'codex-dev.db'))).toBe(true);
    expect(isInsideOperatorCodexHome(join(homedir(), '.codex', 'skills', 'reviewer', 'SKILL.md'))).toBe(true);
    expect(isInsideOperatorCodexHome(join(homedir(), '.vicode', 'skills', 'reviewer', 'SKILL.md'))).toBe(false);
  });

  it('throws before write or delete operations target the operator Codex home', () => {
    expect(() =>
      assertOutsideOperatorCodexHome(join(homedir(), '.codex', 'automations', 'vicode', 'status.json'), 'write status')
    ).toThrow(/operator Codex app home/i);
  });
});
