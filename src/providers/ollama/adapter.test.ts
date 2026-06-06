import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaAdapter } from './adapter';
import {
  createAgentRuntime,
  createCallbacks,
  createContext,
  createRuntime,
  createStreamResponse
} from './adapter-test-helpers';

describe('OllamaAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps direct trusted workspace adapter runs on the plain chat compatibility path', async () => {
    const runtime = createRuntime({
      fetch: vi.fn(async () =>
        createStreamResponse([
          {
            message: {
              content: 'Plain compatibility answer.'
            }
          }
        ])
      )
    });
    const agentRuntime = createAgentRuntime();
    const adapter = new OllamaAdapter(runtime, agentRuntime);
    const callbacks = createCallbacks();

    await adapter.startRun(createContext(), callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Plain compatibility answer.');
    });

    const fetchMock = runtime.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      messages?: Array<Record<string, unknown>>;
      tools?: unknown[];
    };

    expect(callbacks.onStart).toHaveBeenCalledTimes(1);
    expect(agentRuntime.executeToolCall).not.toHaveBeenCalled();
    expect(payload.tools).toBeUndefined();
    expect(payload.messages?.at(-1)?.content).toBe('Inspect the workspace.');
  });

  it('fails plain chat runs that complete without assistant-visible output', async () => {
    const runtime = createRuntime({
      fetch: vi.fn(async () =>
        createStreamResponse([
          {
            message: {
              content: '   '
            }
          }
        ])
      )
    });
    const adapter = new OllamaAdapter(runtime, createAgentRuntime());
    const callbacks = createCallbacks();

    await adapter.startRun(createContext(), callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalledWith('Ollama completed without producing assistant output.');
    });

    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it('fails plain chat runs that emit XML tool-call markup instead of assistant text', async () => {
    const runtime = createRuntime({
      fetch: vi.fn(async () =>
        createStreamResponse([
          {
            message: {
              content: '<function_calls><invoke name=\"list_directory\"><parametername=\"path\"string=\"true\"></parameter></invoke></function_calls>'
            }
          }
        ])
      )
    });
    const adapter = new OllamaAdapter(runtime, createAgentRuntime());
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        trusted: false,
        folderPath: null
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalledWith(
        'Ollama emitted workspace tool-call markup instead of a final assistant reply. Retry the run after restarting Vicode.'
      );
    });

    expect(callbacks.onComplete).not.toHaveBeenCalled();
    expect(callbacks.onDelta).not.toHaveBeenCalled();
  });

  it('suppresses THOUGHT-style chatter from plain local chat output', async () => {
    const runtime = createRuntime({
      fetch: vi.fn(async () =>
        createStreamResponse([
          {
            message: {
                content: 'THOUGHT: I should inspect this first.\n\nLocal answer.'
            }
          }
        ])
      )
    });
    const adapter = new OllamaAdapter(runtime, createAgentRuntime());
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        prompt: 'Say hello.',
        trusted: false,
        folderPath: null
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Local answer.');
    });

    expect(callbacks.onDelta).toHaveBeenCalledWith('Local answer.');
    expect(callbacks.onDelta).not.toHaveBeenCalledWith(expect.stringContaining('THOUGHT:'));
  });
});
