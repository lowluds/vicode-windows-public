import { describe, expect, it, vi } from 'vitest';
import { RetiredProviderAdapter } from './retired-adapter';
import type { ProviderRunCallbacks, ProviderRunContext } from './types';

function createRunContext(providerId: 'openai' | 'gemini' | 'qwen' | 'kimi'): ProviderRunContext {
  return {
    threadId: 'thread-1',
    runId: `run-${providerId}`,
    prompt: 'hello',
    modelId:
      providerId === 'openai'
        ? 'gpt-5'
        : providerId === 'gemini'
          ? 'gemini-2.5-pro'
          : providerId === 'qwen'
            ? 'qwen3.5-plus'
            : 'kimi-k2-thinking',
    folderPath: 'C:\\workspace',
    trusted: true,
    apiKey: null,
    runMode: 'normal',
    executionPermission: 'default'
  };
}

function createCallbacks(): ProviderRunCallbacks {
  return {
    onStart: vi.fn(),
    onDelta: vi.fn(),
    onInfo: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onAbort: vi.fn()
  };
}

describe('RetiredProviderAdapter', () => {
  it.each([
    ['openai', 'OpenAI CLI has been retired'],
    ['gemini', 'Gemini CLI has been retired'],
    ['qwen', 'Qwen CLI has been retired'],
    ['kimi', 'Kimi CLI has been retired']
  ] as const)('reports %s as unavailable', async (providerId, message) => {
    const adapter = new RetiredProviderAdapter(providerId);

    await expect(adapter.detectInstall()).resolves.toEqual({ installed: false, cliPath: null });
    await expect(adapter.getAuthState(null)).resolves.toMatchObject({
      authState: 'missing_cli',
      authMode: null,
      message: expect.stringContaining(message)
    });
    expect(adapter.validateProjectContext('C:\\workspace', true)).toMatchObject({
      valid: false,
      message: expect.stringContaining(message)
    });
    await expect(adapter.startAuth('cli')).rejects.toThrow(message);
  });

  it('fails a retired run with a clear message without producing assistant text', async () => {
    const adapter = new RetiredProviderAdapter('qwen');
    const callbacks = createCallbacks();

    const handle = await adapter.startRun(createRunContext('qwen'), callbacks);

    expect(handle.runId).toBe('run-qwen');
    expect(callbacks.onStart).toHaveBeenCalledOnce();
    expect(callbacks.onDelta).not.toHaveBeenCalled();
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledWith(expect.stringContaining('Qwen CLI has been retired'));
  });
});
