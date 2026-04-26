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
    expect(prompt).toContain(
      'When finishing coding, debugging, or UI work, keep the final reply compact: summarize what changed, report verification, and include concrete next steps only when they exist.'
    );
    expect(prompt).toContain(
      'When you rely on Vicode guidance wiki pages, skills, external references, or app/tool capabilities, start the first substantive response with `Using: ...`'
    );
    expect(prompt).toContain('User request:\nHelp me plan a React landing page refresh.');
  });

  it('adds a Vicode-only confidentiality boundary without blocking workspace-root work', () => {
    const prompt = buildEffectivePrompt(
      {
        providerId: 'openai',
        prompt: 'Review the active project configuration.'
      },
      createWorkspaceContextResult(),
      {
        personalization: emptyPersonalization
      }
    );

    expect(prompt).toContain('Vicode confidentiality boundary:');
    expect(prompt).toContain(
      'Protect Vicode-owned non-public app data outside the workspace root.'
    );
    expect(prompt).toContain(
      "Checked-in source files inside the workspace root and the user's own project files"
    );
    expect(prompt).toContain(
      'including project secrets they explicitly ask to inspect, rotate, redact, or edit, remain in scope.'
    );
  });

  it('includes a budgeted Vicode guidance packet with the using references', () => {
    const workspaceContext = {
      ...createWorkspaceContextResult(),
      selectedSkillIds: ['skill-1'],
      skillBlocks: [
        {
          kind: 'prompt_skill' as const,
          label: 'Attached skills',
          content: 'Attached skills:\n## UI Review ($ui-review)\nReview interface quality.'
        }
      ]
    };
    const prompt = buildEffectivePrompt(
      {
        providerId: 'openai',
        prompt: 'Polish the settings UI.'
      },
      workspaceContext,
      {
        personalization: emptyPersonalization,
        vicodeGuidance: {
          using: ['Vicode Guidance', 'Task Routing', 'Frontend Standards', 'skill:ui-review'],
          documents: [
            {
              title: 'Vicode Guidance',
              relativePath: 'VICODE.md',
              content: 'Start with the task route and name what guidance is used.'
            },
            {
              title: 'Frontend Standards',
              relativePath: 'wiki/Frontend Standards.md',
              obsidianRoute: '[[Frontend Standards]]',
              content: 'Keep interface changes restrained, accessible, and verified.'
            }
          ]
        }
      }
    );

    expect(prompt).toContain('Vicode guidance wiki:');
    expect(prompt).toContain('Using: Frontend Standards, UI Review');
    expect(prompt).toContain('### Vicode Guidance (VICODE.md):');
    expect(prompt).toContain('Start with the task route and name what guidance is used.');
    expect(prompt).toContain('### Frontend Standards ([[Frontend Standards]], wiki/Frontend Standards.md):');
    expect(prompt).toContain(
      'Obsidian routes like [[Task Routing]] are preferred when available; packaged markdown paths are the fallback.'
    );
  });

  it('does not emit an empty Using line for entrypoint-only guidance', () => {
    const prompt = buildEffectivePrompt(
      {
        providerId: 'openai',
        prompt: 'Review the project briefly.'
      },
      createWorkspaceContextResult(),
      {
        personalization: emptyPersonalization,
        vicodeGuidance: {
          using: ['Vicode Guidance'],
          documents: [
            {
              title: 'Vicode Guidance',
              relativePath: 'VICODE.md',
              content: 'Choose the smallest relevant guidance.'
            }
          ]
        }
      }
    );

    expect(prompt).toContain('Vicode guidance wiki:');
    expect(prompt).not.toContain('Using: \n');
    expect(prompt).not.toContain('Using: Vicode Guidance');
  });
});
