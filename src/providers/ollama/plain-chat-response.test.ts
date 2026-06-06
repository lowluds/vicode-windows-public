import { describe, expect, it, vi } from 'vitest';
import { readOllamaPlainChatResponse } from './plain-chat-response';

function createStreamResponse(lines: string[]) {
  return new Response(lines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

describe('Ollama plain chat response parser', () => {
  it('streams visible assistant text while suppressing reasoning labels', async () => {
    const onDelta = vi.fn();

    const result = await readOllamaPlainChatResponse(
      createStreamResponse([
        JSON.stringify({ message: { content: 'THOUGHT: inspect first.\n\nVisible' } }),
        JSON.stringify({ message: { content: ' answer.' } })
      ]),
      {
        onDelta,
        onInfo: vi.fn()
      }
    );

    expect(result).toEqual({
      status: 'complete',
      content: 'Visible answer.'
    });
    expect(onDelta).toHaveBeenCalledWith('Visible');
    expect(onDelta).toHaveBeenCalledWith(' answer.');
  });

  it('surfaces provider error events before completion', async () => {
    const result = await readOllamaPlainChatResponse(
      createStreamResponse([
        JSON.stringify({ error: 'model unloaded' })
      ]),
      {
        onDelta: vi.fn(),
        onInfo: vi.fn()
      }
    );

    expect(result).toEqual({
      status: 'error',
      message: 'model unloaded'
    });
  });

  it('rejects leaked tool-call markup in plain chat output', async () => {
    const result = await readOllamaPlainChatResponse(
      createStreamResponse([
        JSON.stringify({
          message: {
            content: '<function_calls><invoke name="list_directory"></invoke></function_calls>'
          }
        })
      ]),
      {
        onDelta: vi.fn(),
        onInfo: vi.fn()
      }
    );

    expect(result).toEqual({
      status: 'error',
      message: 'Ollama emitted workspace tool-call markup instead of a final assistant reply. Retry the run after restarting Vicode.'
    });
  });

  it('reports malformed provider lines as info and continues parsing', async () => {
    const onInfo = vi.fn();

    const result = await readOllamaPlainChatResponse(
      createStreamResponse([
        'not-json',
        JSON.stringify({ message: { content: 'Recovered.' } })
      ]),
      {
        onDelta: vi.fn(),
        onInfo
      }
    );

    expect(result).toEqual({
      status: 'complete',
      content: 'Recovered.'
    });
    expect(onInfo).toHaveBeenCalledWith('not-json');
  });

  it('fails empty assistant output', async () => {
    const result = await readOllamaPlainChatResponse(
      createStreamResponse([
        JSON.stringify({ message: { content: '   ' } })
      ]),
      {
        onDelta: vi.fn(),
        onInfo: vi.fn()
      }
    );

    expect(result).toEqual({
      status: 'error',
      message: 'Ollama completed without producing assistant output.'
    });
  });
});
