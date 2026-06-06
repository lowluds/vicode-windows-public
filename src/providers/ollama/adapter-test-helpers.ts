import { vi } from 'vitest';
import type { AgentRuntime } from '../agent-runtime';
import type { ProviderRunCallbacks, ProviderRunContext } from '../types';
import type { OllamaRuntime } from './runtime';

export function createRuntime(overrides: Partial<OllamaRuntime> = {}): OllamaRuntime {
  return {
    baseUrl: 'http://127.0.0.1:11434',
    fetch: vi.fn(),
    listTags: vi.fn(async () => null),
    showModel: vi.fn(async () => null),
    detectInstall: vi.fn(async () => ({
      installed: false,
      cliPath: null
    })),
    getStatus: vi.fn(async () => ({
      installed: false,
      cliPath: null,
      reachable: false,
      baseUrl: 'http://127.0.0.1:11434',
      tags: null
    })),
    start: vi.fn(async () => {}),
    ...overrides
  };
}

export function createCallbacks(): ProviderRunCallbacks {
  return {
    onStart: vi.fn(),
    onDelta: vi.fn(),
    onInfo: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onAbort: vi.fn()
  };
}

export function createContext(overrides: Partial<ProviderRunContext> = {}): ProviderRunContext {
  const base: ProviderRunContext = {
    threadId: 'thread-1',
    runId: 'run-1',
    prompt: 'Inspect the workspace.',
    sourcePrompt: 'Inspect the workspace.',
    modelId: 'qwen3-coder:30b',
    reasoningEffort: null,
    thinkingEnabled: false,
    folderPath: 'C:\\workspace',
    trusted: true,
    apiKey: null,
    runMode: 'default',
    executionPermission: 'default',
    runtimeSkillResources: []
  };

  return {
    ...base,
    ...overrides,
    sourcePrompt: overrides.sourcePrompt ?? overrides.prompt ?? base.sourcePrompt
  };
}

export function createStreamResponse(events: unknown[]) {
  return new Response(events.map((event) => JSON.stringify(event)).join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

export function createAgentRuntime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    executeToolCall: vi.fn(async () => ({
      toolName: 'read_file',
      content: 'export const value = 1;\n'
    })),
    hasNativeWebResearch: vi.fn(() => false),
    ...overrides
  };
}
