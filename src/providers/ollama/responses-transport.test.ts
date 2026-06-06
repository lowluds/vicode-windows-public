import { describe, expect, it, vi } from 'vitest';
import { resolveModelSamplingProfile } from '../model-sampling-profile';
import { buildProviderModelTurnRequest } from '../types';
import { OllamaResponsesTransport } from './responses-transport';

function createTransport(response: Response) {
  const fetchWithRetry = vi.fn(async () => response);
  return {
    fetchWithRetry,
    transport: new OllamaResponsesTransport({
      apiKey: 'ollama-cloud-key',
      baseUrl: 'https://ollama.com',
      fetchWithRetry,
      timeoutMs: 1234
    })
  };
}

describe('OllamaResponsesTransport', () => {
  it('serializes flattened neutral prompt payloads to /v1/responses wire shape', async () => {
    const { fetchWithRetry, transport } = createTransport(
      new Response(
        JSON.stringify({
          output_text: 'Done.'
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );

    await transport.sendTurn(buildProviderModelTurnRequest({
      modelId: 'qwen3-coder',
      prompt: {
        systemInstructions: 'System',
        input: [
          {
            role: 'user',
            content: 'Inspect'
          }
        ],
        contextSections: [
          {
            id: 'workspace-root',
            title: 'Workspace root',
            content: 'C:\\workspace',
            placement: 'user'
          }
        ],
        tools: {
          definitions: [
            {
              type: 'function',
              function: {
                name: 'read_file',
                parameters: {
                  type: 'object'
                }
              }
            }
          ]
        },
        attachments: {}
      },
      signal: new AbortController().signal
    }));

    const body = JSON.parse(fetchWithRetry.mock.calls[0]?.[2].body as string);
    expect(body).toEqual({
      model: 'qwen3-coder',
      instructions: 'System',
      input: [
        {
          role: 'user',
          content: 'Inspect'
        }
      ],
      tools: [
        {
          type: 'function',
          name: 'read_file',
          parameters: {
            type: 'object'
          },
          strict: false
        }
      ],
      stream: false
    });
  });

  it('normalizes assistant text from /v1/responses payloads', async () => {
    const { transport } = createTransport(
      new Response(
        JSON.stringify({
          output_text: 'Final response.'
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );

    await expect(
      transport.sendTurn({
        modelId: 'qwen3-coder',
        systemInstructions: 'System',
        input: [
          {
            role: 'user',
            content: 'Hello'
          }
        ],
        tools: [],
        attachments: {},
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({
      text: 'Final response.',
      toolCalls: [],
      terminalState: 'completed'
    });
  });

  it('normalizes native function calls to canonical tool calls', async () => {
    const { transport } = createTransport(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'function_call',
              name: 'read_file',
              arguments: JSON.stringify({
                path: 'src/example.ts'
              }),
              call_id: 'provider-call-1'
            }
          ]
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );

    const result = await transport.sendTurn({
      modelId: 'qwen3-coder',
      systemInstructions: 'System',
      input: [
        {
          role: 'user',
          content: 'Read src/example.ts'
        }
      ],
      tools: [],
      attachments: {},
      signal: new AbortController().signal
    });

    expect(result.toolCalls).toEqual([
      {
        name: 'read_file',
        arguments: {
          path: 'src/example.ts'
        }
      }
    ]);
  });

  it('passes lane-based sampling options to /v1/responses when provided', async () => {
    const { fetchWithRetry, transport } = createTransport(
      new Response(
        JSON.stringify({
          output_text: 'Done.'
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );

    await transport.sendTurn({
      modelId: 'qwen3-coder',
      systemInstructions: 'System',
      input: [
        {
          role: 'user',
          content: 'Inspect'
        }
      ],
      tools: [],
      attachments: {},
      signal: new AbortController().signal,
      samplingProfile: resolveModelSamplingProfile({ lane: 'tool_loop' })
    });

    const body = JSON.parse(fetchWithRetry.mock.calls[0]?.[2].body as string);
    expect(body.options).toEqual({
      temperature: 0.2,
      top_p: 0.8,
      top_k: 20,
      repeat_penalty: 1.05
    });
  });

  it('serializes prior tool results as Responses function_call_output items on the next turn', async () => {
    const responses = [
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'function_call',
              name: 'read_file',
              arguments: JSON.stringify({
                path: 'index.html'
              }),
              call_id: 'provider-call-1'
            }
          ]
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      ),
      new Response(
        JSON.stringify({
          output_text: 'I read the file.'
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    ];
    const fetchWithRetry = vi.fn(async () => {
      const response = responses.shift();
      if (!response) {
        throw new Error('Unexpected extra request');
      }
      return response;
    });
    const transport = new OllamaResponsesTransport({
      apiKey: 'ollama-cloud-key',
      baseUrl: 'https://ollama.com',
      fetchWithRetry,
      timeoutMs: 1234
    });

    await transport.sendTurn({
      modelId: 'qwen3-coder',
      systemInstructions: 'System',
      input: [
        {
          role: 'user',
          content: 'Read index.html'
        }
      ],
      tools: [],
      attachments: {},
      signal: new AbortController().signal
    });
    await transport.sendTurn({
      modelId: 'qwen3-coder',
      systemInstructions: 'System',
      input: [
        {
          role: 'user',
          content: 'Read index.html'
        },
        {
          role: 'user',
          content: 'Tool result for read_file:\n<!doctype html>'
        }
      ],
      tools: [],
      attachments: {},
      signal: new AbortController().signal
    });

    const body = JSON.parse(fetchWithRetry.mock.calls[1]?.[2].body as string);
    expect(body.input).toEqual([
      {
        role: 'user',
        content: 'Read index.html'
      },
      {
        type: 'function_call',
        name: 'read_file',
        arguments: JSON.stringify({
          path: 'index.html'
        }),
        call_id: 'provider-call-1'
      },
      {
        type: 'function_call_output',
        call_id: 'provider-call-1',
        output: '<!doctype html>'
      }
    ]);
  });

  it('keeps malformed function-call arguments contained as an empty argument object', async () => {
    const { transport } = createTransport(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'function_call',
              name: 'search_text',
              arguments: '{not-json',
              call_id: 'provider-call-1'
            }
          ]
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );

    const result = await transport.sendTurn({
      modelId: 'qwen3-coder',
      systemInstructions: 'System',
      input: [
        {
          role: 'user',
          content: 'Search'
        }
      ],
      tools: [],
      attachments: {},
      signal: new AbortController().signal
    });

    expect(result.toolCalls).toEqual([
      {
        name: 'search_text',
        arguments: {}
      }
    ]);
  });

  it('returns provider errors as terminal turn results instead of executing tools', async () => {
    const { transport } = createTransport(
      new Response('history is not defined', {
        status: 500,
        headers: {
          'Content-Type': 'text/plain'
        }
      })
    );

    const result = await transport.sendTurn({
      modelId: 'qwen3-coder',
      systemInstructions: 'System',
      input: [
        {
          role: 'user',
          content: 'Read'
        }
      ],
      tools: [],
      attachments: {},
      signal: new AbortController().signal
    });

    expect(result).toMatchObject({
      text: '',
      toolCalls: [],
      terminalState: 'error',
      errorMessage: 'history is not defined'
    });
  });
});
