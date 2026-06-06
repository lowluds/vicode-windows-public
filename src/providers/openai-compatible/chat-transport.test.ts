import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleChatTransport } from './chat-transport';

function createTransport(response: Response | ((url: string, init: RequestInit) => Promise<Response>), baseUrl = 'https://gateway.example/v1') {
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) =>
    typeof response === 'function' ? response(url, init) : response
  );
  return {
    fetchImpl,
    transport: new OpenAICompatibleChatTransport({
      apiKey: 'compatible-key',
      baseUrl,
      fetchImpl: fetchImpl as never,
      timeoutMs: 1234
    })
  };
}

function createRequest(overrides: Partial<Parameters<OpenAICompatibleChatTransport['sendTurn']>[0]> = {}) {
  return {
    modelId: 'compatible-coder',
    systemInstructions: 'System instructions',
    input: [
      {
        role: 'user' as const,
        content: 'Inspect the repo.'
      }
    ],
    tools: [],
    attachments: {},
    signal: new AbortController().signal,
    ...overrides
  };
}

describe('OpenAICompatibleChatTransport', () => {
  it('serializes neutral turns to the OpenAI-compatible chat completions shape', async () => {
    const { fetchImpl, transport } = createTransport(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Done.'
              }
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

    await transport.sendTurn(createRequest({
      input: [
        {
          role: 'user',
          content: 'Inspect'
        },
        {
          role: 'assistant',
          content: 'I will inspect.'
        }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a workspace file.',
            parameters: {
              type: 'object',
              properties: {
                path: {
                  type: 'string'
                }
              }
            }
          }
        }
      ]
    }));

    const url = fetchImpl.mock.calls[0]?.[0];
    const init = fetchImpl.mock.calls[0]?.[1];
    const body = JSON.parse(init?.body as string);

    expect(url).toBe('https://gateway.example/v1/chat/completions');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer compatible-key',
      'Content-Type': 'application/json'
    });
    expect(body).toEqual({
      model: 'compatible-coder',
      messages: [
        {
          role: 'system',
          content: 'System instructions'
        },
        {
          role: 'user',
          content: 'Inspect'
        },
        {
          role: 'assistant',
          content: 'I will inspect.'
        }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a workspace file.',
            parameters: {
              type: 'object',
              properties: {
                path: {
                  type: 'string'
                }
              }
            }
          }
        }
      ],
      tool_choice: 'auto',
      stream: false
    });
  });

  it('normalizes assistant text and tool calls from chat completion choices', async () => {
    const { transport } = createTransport(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'read_file',
                      arguments: JSON.stringify({
                        path: 'src/example.ts'
                      })
                    }
                  }
                ]
              }
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

    await expect(transport.sendTurn(createRequest())).resolves.toMatchObject({
      text: '',
      toolCalls: [
        {
          name: 'read_file',
          arguments: {
            path: 'src/example.ts'
          }
        }
      ],
      terminalState: 'completed'
    });
  });

  it('returns Vicode tool results to the matching compatible tool call id', async () => {
    const responses = [
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'read_file',
                      arguments: JSON.stringify({
                        path: 'src/example.ts'
                      })
                    }
                  }
                ]
              }
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
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Read complete.'
              }
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
    ];
    const { fetchImpl, transport } = createTransport(async () => responses.shift()!);

    await transport.sendTurn(createRequest());
    await transport.sendTurn(createRequest({
      input: [
        {
          role: 'user',
          content: 'Read src/example.ts'
        },
        {
          role: 'user',
          content: 'Tool result for read_file:\nfile contents'
        }
      ]
    }));

    const body = JSON.parse(fetchImpl.mock.calls[1]?.[1].body as string);
    expect(body.messages).toEqual([
      {
        role: 'system',
        content: 'System instructions'
      },
      {
        role: 'user',
        content: 'Read src/example.ts'
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'read_file',
              arguments: JSON.stringify({
                path: 'src/example.ts'
              })
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: 'file contents'
      }
    ]);
  });

  it('serializes image attachments into the first user chat message', async () => {
    const { fetchImpl, transport } = createTransport(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Image inspected.'
              }
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

    await transport.sendTurn(createRequest({
      input: [
        {
          role: 'user',
          content: 'Build a page like this image.'
        },
        {
          role: 'user',
          content: 'Second user reminder.'
        }
      ],
      attachments: {
        imageAttachments: [
          {
            id: 'image-1',
            name: 'reference.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,ZmFrZQ=='
          }
        ]
      }
    }));

    const body = JSON.parse(fetchImpl.mock.calls[0]?.[1].body as string);
    expect(body.messages).toEqual([
      {
        role: 'system',
        content: 'System instructions'
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Build a page like this image.'
          },
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/png;base64,ZmFrZQ=='
            }
          }
        ]
      },
      {
        role: 'user',
        content: 'Second user reminder.'
      }
    ]);
  });

  it('normalizes provider errors and empty payloads as terminal turn results', async () => {
    const { transport } = createTransport(
      new Response(
        JSON.stringify({
          error: {
            message: 'Invalid compatible key.'
          }
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );

    await expect(transport.sendTurn(createRequest())).resolves.toMatchObject({
      text: '',
      toolCalls: [],
      terminalState: 'error',
      errorMessage: 'Invalid compatible key.'
    });
  });

  it('redacts compatible API keys from provider error bodies', async () => {
    const { transport } = createTransport(
      new Response('Gateway rejected Authorization: Bearer compatible-key', {
        status: 502,
        headers: {
          'Content-Type': 'text/plain'
        }
      })
    );

    await expect(transport.sendTurn(createRequest())).resolves.toMatchObject({
      text: '',
      toolCalls: [],
      terminalState: 'error',
      errorMessage: 'Gateway rejected Authorization: Bearer [REDACTED]'
    });
  });

  it('returns malformed JSON responses as terminal provider errors', async () => {
    const { transport } = createTransport(
      new Response('{not valid json', {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      })
    );

    await expect(transport.sendTurn(createRequest())).resolves.toMatchObject({
      text: '',
      toolCalls: [],
      terminalState: 'error',
      errorMessage: 'OpenAI-compatible chat endpoint returned malformed JSON.'
    });
  });
});
