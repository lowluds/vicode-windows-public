import { describe, expect, it, vi } from 'vitest';
import type { ProviderAdapter, ProviderRunHandle } from '../../providers/types';
import type { ProviderId, ProviderModel } from '../../shared/domain';
import { ProviderManager } from './provider-manager';
import { getProviderFallbackModels } from '../../providers/catalog';

function createProviderModel(id: string, label = id): ProviderModel {
  return { id, label, description: '' };
}

function createAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  const providerId = (overrides.id ?? 'openai') as ProviderId;
  return {
    id: providerId,
    label: providerId === 'gemini' ? 'Gemini' : providerId === 'ollama' ? 'Ollama' : 'OpenAI',
    listStaticModels: () => getProviderFallbackModels(providerId),
    getPlannerCapability: () => ({
      supported: true,
      executionMode: 'read-only',
      enforcement: 'hard-enforced'
    }),
    discoverApiModels: async () => null,
    discoverRuntimeModels: async () => null,
    detectInstall: async () => ({ installed: true, cliPath: 'codex.cmd' }),
    getAuthState: async () => ({ authState: 'disconnected', authMode: null, message: 'Disconnected' }),
    startAuth: async () => {},
    clearAuth: async () => {},
    discoverNativeSkills: async () => [],
    validateProjectContext: () => ({ valid: true }),
    startRun: async () =>
      ({
        runId: 'run-1',
        cancel: async () => {}
      }) satisfies ProviderRunHandle,
    ...overrides
  };
}

function createDb(overrides?: {
  threadContent?: string;
  rawDelta?: string;
}) {
  const threadContent =
    overrides?.threadContent ??
    'Sure! Here are some fun facts about Mars:- 🌍 **The Red Planet:** Mars looks red due to iron oxide. - 🌙 **Moons:** Mars has Phobos and Deimos. - 🏔️ **Olympus Mons:** It is the tallest volcano in the solar system. Let me know if you want more.';
  const rawDelta =
    overrides?.rawDelta ??
    'Sure! Here are some fun facts about Mars:- 🌍 **The Red Planet:** Mars looks red due to iron oxide. - 🌙 **Moons:** Mars has Phobos and Deimos. - 🏔️ **Olympus Mons:** It is the tallest volcano in the solar system. Let me know if you want more.';

  const thread = {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'New thread',
    providerId: 'ollama',
    modelId: 'qwen3-coder',
    executionPermission: 'default',
    status: 'draft',
    archived: false,
    lastMessageAt: '2026-03-14T00:00:00.000Z',
    createdAt: '2026-03-14T00:00:00.000Z',
    updatedAt: '2026-03-14T00:00:00.000Z',
    lastPreview: '',
    turns: [
      {
        id: 'turn-1',
        threadId: 'thread-1',
        role: 'assistant',
        content: threadContent,
        metadata: null,
        runId: 'run-1',
        createdAt: '2026-03-14T00:00:00.000Z'
      }
    ],
    rawOutput: [
      {
        id: 'event-1',
        threadId: 'thread-1',
        runId: 'run-1',
        eventType: 'delta',
        payload: {
          delta: rawDelta
        },
        createdAt: '2026-03-14T00:00:00.000Z'
      }
    ]
  };

  return {
    getProviderAccount: vi.fn(() => null),
    getPreferences: vi.fn(() => ({
      selectedProjectId: 'project-1',
      defaultProviderId: 'ollama',
      defaultModelByProvider: { ollama: 'qwen3-coder' },
      defaultReasoningEffortByProvider: { ollama: null },
      defaultThinkingByProvider: { ollama: false },
      defaultExecutionPermission: 'default',
      followUpBehavior: 'queue',
      generatedMemoryUseEnabled: false,
      generatedMemoryGenerationEnabled: true,
      appearanceMode: 'system',
      onboardingComplete: false,
      lastOpenedThreadId: null,
      microphoneAllowed: false
    })),
    getProviderModelCache: vi.fn(() => ({ models: [], updatedAt: null, source: null })),
    replaceProviderModels: vi.fn(),
    clearProviderModelCache: vi.fn(),
    getProject: vi.fn(() => ({
      id: 'project-1',
      name: 'Project',
      folderPath: null,
      trusted: true,
      defaultProviderId: 'ollama',
      defaultModelByProvider: { ollama: 'qwen3-coder' },
      createdAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z'
    })),
    getThread: vi.fn(() => thread)
  };
}

describe('provider-manager completion output', () => {
  const denseMars =
    'Sure! Here are some fun facts about Mars:- 🌍 **The Red Planet:** Mars looks red due to iron oxide. - 🌙 **Moons:** Mars has Phobos and Deimos. - 🏔️ **Olympus Mons:** It is the tallest volcano in the solar system. Let me know if you want more.';

  it('formats dense ollama completion text through the private provider formatter', () => {
    const manager = new ProviderManager(createDb() as never, {
      ollama: createAdapter({ id: 'ollama', label: 'Ollama' }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    } as never);

    expect((manager as any).formatProviderCompletionOutput('ollama', denseMars)).toBe(
      'Sure! Here are some fun facts about Mars:\n\n- 🌍 **The Red Planet:** Mars looks red due to iron oxide.\n\n- 🌙 **Moons:** Mars has Phobos and Deimos.\n\n- 🏔️ **Olympus Mons:** It is the tallest volcano in the solar system.\n\nLet me know if you want more.'
    );
  });

  it('resolves dense ollama completion output to the formatted final answer', () => {
    const manager = new ProviderManager(createDb() as never, {
      ollama: createAdapter({ id: 'ollama', label: 'Ollama' }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    } as never);

    expect((manager as any).resolveProviderCompletionOutput('ollama', 'thread-1', 'run-1', denseMars)).toBe(
      'Sure! Here are some fun facts about Mars:\n\n- 🌍 **The Red Planet:** Mars looks red due to iron oxide.\n\n- 🌙 **Moons:** Mars has Phobos and Deimos.\n\n- 🏔️ **Olympus Mons:** It is the tallest volcano in the solar system.\n\nLet me know if you want more.'
    );
  });

  it('does not schedule an ollama rewrite once the local formatter already produced readable structure', () => {
    const manager = new ProviderManager(createDb() as never, {
      ollama: createAdapter({ id: 'ollama', label: 'Ollama' }),
      gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
    } as never);

    const formatted = (manager as any).resolveProviderCompletionOutput('ollama', 'thread-1', 'run-1', denseMars);
    expect((manager as any).ollamaFinalAnswerFormatter.shouldRewrite(formatted)).toBe(false);
  });

  it('prefers corrected assistant-turn text over stale delta history when late repairs rewrote earlier spacing', () => {
    const manager = new ProviderManager(
      createDb({
        threadContent: 'The file is at D:\\DEV\\Vicode-Testing\\portfolite\\index.html.',
        rawDelta: 'The file is at D:\\DEV\\Vicode-Testing\\port fol ite\\index.html.'
      }) as never,
      {
        ollama: createAdapter({ id: 'ollama', label: 'Ollama' }),
        gemini: createAdapter({ id: 'gemini', label: 'Gemini' })
      } as never
    );

    expect(
      (manager as any).resolveProviderCompletionOutput(
        'openai',
        'thread-1',
        'run-1',
        'The file is at D:\\DEV\\Vicode-Testing\\port fol ite\\index.html.'
      )
    ).toBe('The file is at D:\\DEV\\Vicode-Testing\\portfolite\\index.html.');
  });
});
