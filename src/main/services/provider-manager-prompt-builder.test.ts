import { describe, expect, it } from 'vitest';
import type { PersonalizationSettings } from '../../shared/domain';
import { buildEffectivePrompt } from './provider-manager-prompt-builder';
import type { WorkspaceContextResult } from './workspace-context';

const emptyPersonalization: PersonalizationSettings = {
  globalInstructions: '',
  providerInstructions: {
    openai: '',
    gemini: '',
    qwen: '',
    ollama: '',
    kimi: ''
  },
  useWorkspaceInstructions: true
};

function createWorkspaceContextResult(): WorkspaceContextResult {
  return {
    folderPath: null,
    trusted: false,
    providerId: 'openai',
    blocks: [],
    memoryBlocks: [],
    generatedMemoryBlocks: [],
    skillBlocks: [],
    runtimeSkillResources: [],
    selectedSkillIds: [],
    mentionedSkillIds: [],
    diagnostics: {
      durationMs: 0,
      workspaceInstructionReadMs: 0,
      skillResolutionMs: 0,
      runtimeSkillResolutionMs: 0,
      memoryRetrievalMs: 0,
      generatedMemoryRetrievalMs: 0,
      blockCount: 0,
      memoryBlockCount: 0,
      generatedMemoryBlockCount: 0,
      skillBlockCount: 0,
      runtimeSkillResourceCount: 0
    }
  };
}

describe('buildEffectivePrompt', () => {
  it('adds a no-emoji response-style rule even without workspace context', () => {
    const prompt = buildEffectivePrompt(
      {
        providerId: 'openai',
        prompt: 'Help me plan a React landing page refresh.'
      },
      createWorkspaceContextResult(),
      {
        personalization: emptyPersonalization
      }
    );

    expect(prompt).toContain('Response style defaults:');
    expect(prompt).toContain(
      'Do not use emojis in assistant replies unless the user explicitly asks for them.'
    );
    expect(prompt).toContain('User request:\nHelp me plan a React landing page refresh.');
  });
});
