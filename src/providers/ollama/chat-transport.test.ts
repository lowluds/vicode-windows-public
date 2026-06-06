import { describe, expect, it, vi } from 'vitest';
import { resolveModelSamplingProfile } from '../model-sampling-profile';
import { OllamaChatTransport } from './chat-transport';

function createStreamResponse(events: unknown[]) {
  return new Response(events.map((event) => JSON.stringify(event)).join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

function createTransport(response: Response) {
  const fetchWithRetry = vi.fn(async () => response);
  return {
    fetchWithRetry,
    transport: new OllamaChatTransport({
      apiKey: null,
      baseUrl: 'http://127.0.0.1:11434',
      fetchWithRetry,
      timeoutMs: 1234
    })
  };
}

function createWriteFileToolDefinition() {
  return {
    type: 'function' as const,
    function: {
      name: 'write_file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content']
      }
    }
  };
}

describe('OllamaChatTransport', () => {
  it('serializes flattened neutral turns to /api/chat wire shape', async () => {
    const { fetchWithRetry, transport } = createTransport(
      createStreamResponse([
        {
          message: {
            content: 'Done.'
          }
        }
      ])
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
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            parameters: {
              type: 'object'
            }
          }
        }
      ],
      attachments: {},
      signal: new AbortController().signal
    });

    const body = JSON.parse(fetchWithRetry.mock.calls[0]?.[2].body as string);
    expect(fetchWithRetry.mock.calls[0]?.[1]).toBe('/api/chat');
    expect(body).toEqual({
      model: 'qwen3-coder',
      stream: true,
      messages: [
        {
          role: 'system',
          content: 'System'
        },
        {
          role: 'user',
          content: 'Inspect'
        }
      ],
      tools: [
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
    });
  });

  it('requests Ollama thinking and returns compact thinking activity separate from answer text', async () => {
    const { fetchWithRetry, transport } = createTransport(
      createStreamResponse([
        {
          message: {
            thinking: 'I should inspect the relevant file first.'
          }
        },
        {
          message: {
            thinking: ' Then I can run the focused test.'
          }
        },
        {
          message: {
            content: 'Done.'
          }
        }
      ])
    );

    const result = await transport.sendTurn({
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
      thinkingEnabled: true
    });

    const body = JSON.parse(fetchWithRetry.mock.calls[0]?.[2].body as string);
    expect(body.think).toBe(true);
    expect(result.text).toBe('Done.');
    expect(result.infoMessages).toEqual([
      {
        message: 'I should inspect the relevant file first. Then I can run the focused test.',
        activity: {
          kind: 'thinking',
          summary: 'I should inspect the relevant file first. Then I can run the focused test.',
          text: 'I should inspect the relevant file first. Then I can run the focused test.',
          providerEventType: 'ollama_chat_message_thinking'
        }
      }
    ]);
  });

  it('normalizes streamed assistant text and structured tool calls', async () => {
    const { transport } = createTransport(
      createStreamResponse([
        {
          message: {
            content: 'I will inspect.'
          }
        },
        {
          message: {
            tool_calls: [
              {
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
      ])
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

    expect(result.text).toBe('I will inspect.');
    expect(result.toolCalls).toEqual([
      {
        name: 'read_file',
        arguments: {
          path: 'src/example.ts'
        }
      }
    ]);
    expect(result.toolCallContractViolation).toBeNull();
  });

  it('normalizes exact JSON tool calls split across streamed content chunks', async () => {
    const { transport } = createTransport(
      createStreamResponse([
        {
          message: {
            content: '{"name":"write_file",'
          }
        },
        {
          message: {
            content: '"arguments":{"path":"g5-stream-probe.txt",'
          }
        },
        {
          message: {
            content: '"content":"g5 stream local tool probe ok"}}'
          }
        }
      ])
    );

    const result = await transport.sendTurn({
      modelId: 'qwen2.5-coder:14b-instruct-q6_K',
      systemInstructions: 'System',
      input: [
        {
          role: 'user',
          content: 'Write g5-stream-probe.txt'
        }
      ],
      tools: [],
      attachments: {},
      signal: new AbortController().signal
    });

    expect(result.toolCalls).toEqual([
      {
        name: 'write_file',
        arguments: {
          path: 'g5-stream-probe.txt',
          content: 'g5 stream local tool probe ok'
        }
      }
    ]);
    expect(result.toolCallContractViolation).toBeNull();
    expect(result.providerDiagnostics).toEqual(
      expect.objectContaining({
        source: 'ollama_chat_json',
        itemType: 'write_file',
        paths: ['g5-stream-probe.txt']
      })
    );
  });

  it('normalizes strict fenced JSON tool calls split across streamed content chunks', async () => {
    const { transport } = createTransport(
      createStreamResponse([
        {
          message: {
            content: '```json\n'
          }
        },
        {
          message: {
            content: '{"name":"write_file","arguments":{"path":"g5-fenced-probe.txt",'
          }
        },
        {
          message: {
            content: '"content":"g5 fenced local tool probe ok"}}\n```'
          }
        }
      ])
    );

    const result = await transport.sendTurn({
      modelId: 'qwen2.5-coder:14b-instruct-q6_K',
      systemInstructions: 'System',
      input: [
        {
          role: 'user',
          content: 'Write g5-fenced-probe.txt'
        }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'write_file',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: { type: 'string' }
              },
              required: ['path', 'content']
            }
          }
        }
      ],
      attachments: {},
      signal: new AbortController().signal
    });

    expect(result.toolCalls).toEqual([
      {
        name: 'write_file',
        arguments: {
          path: 'g5-fenced-probe.txt',
          content: 'g5 fenced local tool probe ok'
        }
      }
    ]);
    expect(result.toolCallContractViolation).toBeNull();
    expect(result.providerDiagnostics).toEqual(
      expect.objectContaining({
        source: 'ollama_chat_json',
        itemType: 'write_file',
        paths: ['g5-fenced-probe.txt']
      })
    );
  });

  it('normalizes exact unlabeled fenced JSON tool calls split across streamed content chunks', async () => {
    const { transport } = createTransport(
      createStreamResponse([
        {
          message: {
            content: '```\n'
          }
        },
        {
          message: {
            content: '{"name":"write_file","arguments":{"path":"g5-unlabeled-fence-probe.txt",'
          }
        },
        {
          message: {
            content: '"content":"g5 unlabeled fence local tool probe ok"}}\n```'
          }
        }
      ])
    );

    const result = await transport.sendTurn({
      modelId: 'mistral:7b',
      systemInstructions: 'System',
      input: [
        {
          role: 'user',
          content: 'Write g5-unlabeled-fence-probe.txt'
        }
      ],
      tools: [createWriteFileToolDefinition()],
      attachments: {},
      signal: new AbortController().signal
    });

    expect(result.toolCalls).toEqual([
      {
        name: 'write_file',
        arguments: {
          path: 'g5-unlabeled-fence-probe.txt',
          content: 'g5 unlabeled fence local tool probe ok'
        }
      }
    ]);
    expect(result.toolCallContractViolation).toBeNull();
    expect(result.providerDiagnostics).toEqual(
      expect.objectContaining({
        source: 'ollama_chat_json',
        itemType: 'write_file',
        paths: ['g5-unlabeled-fence-probe.txt']
      })
    );
  });

  it('surfaces recoverable tool-call contract violations from accumulated streamed content', async () => {
    const { transport } = createTransport(
      createStreamResponse([
        {
          message: {
            content: 'I will call the tool now:\n```json\n'
          }
        },
        {
          message: {
            content: '{"name":"write_file","arguments":{"path":"g5-recoverable-probe.txt",'
          }
        },
        {
          message: {
            content: '"content":"g5 recoverable local tool probe ok"}}\n```'
          }
        }
      ])
    );

    const result = await transport.sendTurn({
      modelId: 'qwen2.5-coder:14b-instruct-q6_K',
      systemInstructions: 'System',
      input: [
        {
          role: 'user',
          content: 'Write g5-recoverable-probe.txt'
        }
      ],
      tools: [createWriteFileToolDefinition()],
      attachments: {},
      signal: new AbortController().signal
    });

    expect(result.toolCalls).toEqual([]);
    expect(result.providerDiagnostics).toBeNull();
    expect(result.toolCallContractViolation).toEqual({
      providerId: 'ollama',
      reason: 'surrounding_prose',
      candidateToolName: 'write_file',
      recoverable: true
    });
  });

  it('returns context-window usage from the final Ollama chat event', async () => {
    const { transport } = createTransport(
      createStreamResponse([
        {
          message: {
            content: 'Done.'
          }
        },
        {
          done: true,
          prompt_eval_count: 4096,
          eval_count: 256
        }
      ])
    );

    await expect(
      transport.sendTurn({
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
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({
      contextWindowUsage: {
        usedTokens: 4352,
        inputTokens: 4096,
        outputTokens: 256,
        providerEventType: 'ollama_chat_context_window_usage'
      }
    });
  });

  it('passes lane-based sampling options to /api/chat when provided', async () => {
    const { fetchWithRetry, transport } = createTransport(
      createStreamResponse([
        {
          message: {
            content: 'Done.'
          }
        }
      ])
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

  it('serializes prior tool results as Ollama tool-role messages on the next turn', async () => {
    const responses = [
      createStreamResponse([
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: 'read_file',
                  arguments: JSON.stringify({
                    path: 'index.html'
                  })
                }
              }
            ]
          }
        }
      ]),
      createStreamResponse([
        {
          message: {
            content: 'I read the file.'
          }
        }
      ])
    ];
    const fetchWithRetry = vi.fn(async () => {
      const response = responses.shift();
      if (!response) {
        throw new Error('Unexpected extra request');
      }
      return response;
    });
    const transport = new OllamaChatTransport({
      apiKey: null,
      baseUrl: 'http://127.0.0.1:11434',
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
    expect(body.messages).toEqual([
      {
        role: 'system',
        content: 'System'
      },
      {
        role: 'user',
        content: 'Read index.html'
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            function: {
              name: 'read_file',
              arguments: {
                path: 'index.html'
              }
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_name: 'read_file',
        content: '<!doctype html>'
      }
    ]);
  });

  it('normalizes XML fallback tool calls and malformed argument objects', async () => {
    const { transport } = createTransport(
      createStreamResponse([
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: 'search_text',
                  arguments: '{not-json'
                }
              }
            ],
            content: '<function_calls><invoke name="read_file"><parameter name="path">README.md</parameter></invoke></function_calls>'
          }
        }
      ])
    );

    const result = await transport.sendTurn({
      modelId: 'qwen3-coder',
      systemInstructions: 'System',
      input: [
        {
          role: 'user',
          content: 'Use tools'
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
      },
      {
        name: 'read_file',
        arguments: {
          path: 'README.md'
        }
      }
    ]);
  });

  it('returns provider errors as terminal turn results', async () => {
    const { transport } = createTransport(
      new Response('local model failed', {
        status: 500,
        headers: {
          'Content-Type': 'text/plain'
        }
      })
    );

    await expect(
      transport.sendTurn({
        modelId: 'qwen3-coder',
        systemInstructions: 'System',
        input: [],
        tools: [],
        attachments: {},
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({
      text: '',
      toolCalls: [],
      terminalState: 'error',
      errorMessage: 'local model failed'
    });
  });

  it('reports empty streamed bodies as terminal errors and passes abort signals to fetch', async () => {
    const signal = new AbortController().signal;
    const { fetchWithRetry, transport } = createTransport(
      new Response(null, {
        status: 200
      })
    );

    const result = await transport.sendTurn({
      modelId: 'qwen3-coder',
      systemInstructions: 'System',
      input: [],
      tools: [],
      attachments: {},
      signal
    });

    expect(result).toMatchObject({
      text: '',
      toolCalls: [],
      terminalState: 'error',
      errorMessage: 'Ollama returned an empty chat response.'
    });
    expect(fetchWithRetry.mock.calls[0]?.[2].signal).toBe(signal);
  });
});
