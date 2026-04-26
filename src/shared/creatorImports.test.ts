import { describe, expect, it } from 'vitest';
import {
  buildPluginCreatorPrompt,
  buildSkillCreatorPrompt
} from './creatorImports';

describe('creatorImports', () => {
  it('keeps skill creator drafts empty so the composer can show the attached creator chip', () => {
    expect(buildSkillCreatorPrompt()).toBe('');
  });

  it('keeps plugin creator drafts empty so the composer can show the attached creator chip', () => {
    expect(buildPluginCreatorPrompt()).toBe('');
  });
});
