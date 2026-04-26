import { describe, expect, it } from 'vitest';
import { promptRequiresAttachedWorkspace } from './workspace-run-guard';

describe('promptRequiresAttachedWorkspace', () => {
  it('flags file-writing prompts that expect a real workspace', () => {
    expect(
      promptRequiresAttachedWorkspace(
        'can you write me a simple message.txt inside the root directory'
      )
    ).toBe(true);
  });

  it('flags workspace-path questions that would otherwise hallucinate', () => {
    expect(promptRequiresAttachedWorkspace('give me full path')).toBe(true);
    expect(promptRequiresAttachedWorkspace('which workspace')).toBe(true);
    expect(promptRequiresAttachedWorkspace('what folder on my pc')).toBe(true);
  });

  it('allows generic instructional questions without a workspace', () => {
    expect(promptRequiresAttachedWorkspace('how do i write a txt file in python?')).toBe(
      false
    );
    expect(promptRequiresAttachedWorkspace('what is a workspace root?')).toBe(false);
  });

  it('does not force a workspace for plan-mode prompts', () => {
    expect(
      promptRequiresAttachedWorkspace(
        'plan the next slice for writing a txt file in the repo root',
        'plan'
      )
    ).toBe(false);
  });
});
