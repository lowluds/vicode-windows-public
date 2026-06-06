import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OllamaAdapter } from './adapter';
import {
  createAgentRuntime,
  createCallbacks,
  createContext,
  createRuntime,
  createStreamResponse
} from './adapter-test-helpers';

describe('OllamaAdapter transport', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to the plain chat transport when no trusted workspace is active', async () => {
    const runtime = createRuntime({
      fetch: vi.fn(async () =>
        createStreamResponse([
          {
            message: {
              content: 'Plain chat response.'
            }
          }
        ])
      )
    });
    const agentRuntime = createAgentRuntime();
    const adapter = new OllamaAdapter(runtime, agentRuntime);
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        folderPath: null
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Plain chat response.');
    });

    expect(agentRuntime.executeToolCall).not.toHaveBeenCalled();
    const fetchMock = runtime.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      tools?: unknown[];
      messages?: Array<Record<string, unknown>>;
    };
    expect(payload.tools).toBeUndefined();
    expect(payload.messages?.[0]?.role).toBe('system');
    expect(String(payload.messages?.[0]?.content ?? '')).toContain(
      'Answer directly and concisely.'
    );
  });

  it('reconstructs readable spacing across adjacent Ollama text chunks', async () => {
    const runtime = createRuntime({
      fetch: vi.fn(async () =>
        createStreamResponse([
          {
            message: {
              content: 'Hey!I\'m doing'
            }
          },
          {
            message: {
              content: 'well,thanks'
            }
          },
          {
            message: {
              content: 'for asking.How are'
            }
          },
          {
            message: {
              content: 'you?'
            }
          }
        ])
      )
    });
    const adapter = new OllamaAdapter(runtime, createAgentRuntime());
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        folderPath: null,
        trusted: false
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith("Hey! I'm doing well, thanks for asking. How are you?");
    });
  });

  it('does not insert spaces into sentence-initial mid-word continuations', async () => {
    const runtime = createRuntime({
      fetch: vi.fn(async () =>
        createStreamResponse([
          {
            message: {
              content: 'Ref'
            }
          },
          {
            message: {
              content: 'inement complete.'
            }
          }
        ])
      )
    });
    const adapter = new OllamaAdapter(runtime, createAgentRuntime());
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        folderPath: null,
        trusted: false
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Refinement complete.');
    });
  });

  it('keeps simple trusted workspace replies in plain chat without forcing workspace tools', async () => {
    const runtime = createRuntime({
      fetch: vi.fn(async () =>
        createStreamResponse([
          {
            message: {
              content: 'Hello there.'
            }
          }
        ])
      )
    });
    const agentRuntime = createAgentRuntime();
    const adapter = new OllamaAdapter(runtime, agentRuntime);
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        prompt: 'hello'
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Hello there.');
    });

    expect(agentRuntime.executeToolCall).not.toHaveBeenCalled();
    const fetchMock = runtime.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      tools?: unknown[];
      messages?: Array<{ role?: string; content?: string }>;
    };
    expect(payload.tools).toBeUndefined();
    expect(payload.messages?.[1]?.content).toBe('hello');
  });

  it('keeps one-word acknowledgements in plain chat for trusted workspaces', async () => {
    const runtime = createRuntime({
      fetch: vi.fn(async () =>
        createStreamResponse([
          {
            message: {
              content: 'Glad to hear it.'
            }
          }
        ])
      )
    });
    const agentRuntime = createAgentRuntime();
    const adapter = new OllamaAdapter(runtime, agentRuntime);
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        prompt: 'nice'
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Glad to hear it.');
    });

    expect(agentRuntime.executeToolCall).not.toHaveBeenCalled();
    const fetchMock = runtime.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      tools?: unknown[];
      messages?: Array<{ role?: string; content?: string }>;
    };
    expect(payload.tools).toBeUndefined();
    expect(payload.messages?.[1]?.content).toBe('nice');
  });

  it('does not run a second-pass rewrite for dense local Ollama final answers', async () => {
    const runtime = createRuntime({
      fetch: vi
        .fn()
        .mockResolvedValueOnce(
          createStreamResponse([
            {
              message: {
                content:
                  '- **Founded:** 2000 by Victor Goossens and Joy Hoogeveen. Official website launched in 2001 and moved to teamliquid.net in 2002. Expanded into multi-game esports in 2012, merged with Team Curse in 2015, sold controlling interest to Axiomatic Gaming in 2016, won major titles in Dota 2, League of Legends, and Counter-Strike, and now fields teams across many games.'
              }
            }
          ])
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              message: {
                content: JSON.stringify({
                  lead: 'Team Liquid started in 2000 and grew from a StarCraft community into a multi-title esports organization.',
                  sections: [
                    {
                      heading: 'Milestones',
                      bullets: [
                        'Founded in 2000 by Victor Goossens and Joy Hoogeveen.',
                        'Official website launched in 2001 and the organization moved to teamliquid.net in 2002.',
                        'Expanded into broader esports in 2012 and merged with Team Curse in 2015.'
                      ]
                    }
                  ],
                  closing: 'I can also break this down by game or era if you want.'
                })
              }
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json'
              }
            }
          )
        )
    });
    const adapter = new OllamaAdapter(runtime, createAgentRuntime());
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        folderPath: null,
        trusted: false
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith(
        '- **Founded:** 2000 by Victor Goossens and Joy Hoogeveen. Official website launched in 2001 and moved to teamliquid.net in 2002. Expanded into multi-game esports in 2012, merged with Team Curse in 2015, sold controlling interest to Axiomatic Gaming in 2016, won major titles in Dota 2, League of Legends, and Counter-Strike, and now fields teams across many games.'
      );
    });

    expect((runtime.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('skips final-answer rewriting for already readable local Ollama replies', async () => {
    const runtime = createRuntime({
      fetch: vi.fn(async () =>
        createStreamResponse([
          {
            message: {
              content: 'Difference Engine work started in the 1820s.\n\n**Timeline**\n- Analytical Engine design followed in the 1830s.'
            }
          }
        ])
      )
    });
    const adapter = new OllamaAdapter(runtime, createAgentRuntime());
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        folderPath: null,
        trusted: false
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith(
        'Difference Engine work started in the 1820s.\n\n**Timeline**\n- Analytical Engine design followed in the 1830s.'
      );
    });

    expect((runtime.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('retries one transient local server error before failing the plain chat path', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Internal Server Error' }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json'
          }
        })
      )
      .mockResolvedValueOnce(
        createStreamResponse([
          {
            message: {
              content: 'Recovered plain chat response.'
            }
          }
        ])
      );
    const adapter = new OllamaAdapter(createRuntime({ fetch: fetchMock }), createAgentRuntime());
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        prompt: 'hello'
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Recovered plain chat response.');
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('surfaces classic plain chat transport errors instead of attempting a self fallback', async () => {
    const runtime = createRuntime({
      fetch: vi.fn(async () => {
        throw new Error('history is not defined');
      })
    });
    const adapter = new OllamaAdapter(runtime);
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        folderPath: null,
        trusted: false,
        ollamaTransportMode: 'chat'
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalledWith('history is not defined');
    });
    expect(runtime.fetch).toHaveBeenCalledTimes(1);
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it('surfaces classic tool-loop transport errors instead of attempting a self fallback', async () => {
    const runtime = createRuntime({
      fetch: vi.fn(async () => {
        throw new Error('history is not defined');
      })
    });
    const adapter = new OllamaAdapter(runtime, createAgentRuntime());
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        ollamaTransportMode: 'chat'
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalledWith('history is not defined');
    });
    expect(runtime.fetch).toHaveBeenCalledTimes(1);
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it('does not surface a user-visible info event for ignored reasoning effort hints', async () => {
    const runtime = createRuntime({
      fetch: vi.fn(async () =>
        createStreamResponse([
          {
            message: {
              content: 'Plain chat response.'
            }
          }
        ])
      )
    });
    const adapter = new OllamaAdapter(runtime, createAgentRuntime());
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        prompt: 'hello',
        reasoningEffort: 'high'
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Plain chat response.');
    });

    expect(callbacks.onInfo.mock.calls.flat().some((message) => String(message).includes('not wired'))).toBe(false);
  });

  it('routes Ollama API-key contexts through the local chat API without bearer auth', async () => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe('/api/chat');
      expect(init?.headers ?? {}).not.toEqual(expect.objectContaining({ Authorization: expect.any(String) }));

      return createStreamResponse([
        {
          message: {
            content: 'Local Ollama response.'
          }
        }
      ]);
    });
    const runtime = createRuntime({ fetch: fetchMock });
    const adapter = new OllamaAdapter(runtime);
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        folderPath: null,
        apiKey: 'ollama-cloud-key'
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Local Ollama response.');
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a clearer message when the local Ollama stream is terminated mid-run', async () => {
    const adapter = new OllamaAdapter(createRuntime({
      fetch: vi.fn(async () => {
        throw new Error('terminated');
      })
    }));
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        modelId: 'deepseek-v3.2'
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalledWith(
        'The local Ollama runtime terminated the response stream before a final answer was returned.'
      );
    });
  });

  it('surfaces a clearer message when local Ollama cannot be reached', async () => {
    const runtime = createRuntime({
      fetch: vi.fn(async () => {
        throw new Error('fetch failed');
      })
    });
    const adapter = new OllamaAdapter(runtime);
    const callbacks = createCallbacks();

    await adapter.startRun(createContext(), callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalledWith(
        'Failed to reach the local Ollama runtime. Start Ollama or check that it is reachable, then retry.'
      );
    });
  });

  it('surfaces the local-runtime message when an API-key context cannot be reached', async () => {
    const adapter = new OllamaAdapter(createRuntime({
      fetch: vi.fn(async () => {
        throw new TypeError('fetch failed');
      })
    }));
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        modelId: 'deepseek-v3.2'
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalledWith(
        'Failed to reach the local Ollama runtime. Start Ollama or check that it is reachable, then retry.'
      );
    });
  });

  it('uses /v1/responses for plain chat when the experimental transport flag is enabled', async () => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe('/v1/responses');
      const payload = JSON.parse(String(init?.body ?? '{}')) as {
        model?: string;
        input?: string;
        instructions?: string;
      };
      expect(payload.model).toBe('qwen3-coder:30b');
      expect(payload.input).toBe('Inspect the workspace.');
      expect(payload.instructions).toContain('Answer directly and concisely.');

      return new Response(
        JSON.stringify({
          output_text: 'Responses transport ready.'
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    });

    const adapter = new OllamaAdapter(createRuntime({ fetch: fetchMock }));
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        trusted: false,
        folderPath: null,
        ollamaTransportMode: 'responses'
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Responses transport ready.');
    });
    expect(callbacks.onDelta).toHaveBeenCalledWith('Responses transport ready.');
  });

  it('falls back to classic chat when local /v1/responses rejects a plain run', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('history is not defined', {
          status: 500,
          headers: {
            'Content-Type': 'text/plain'
          }
        })
      )
      .mockResolvedValueOnce(
        createStreamResponse([
          {
            message: {
              content: 'Classic chat fallback ready.'
            }
          }
        ])
      );
    const runtime = createRuntime({ fetch: fetchMock });
    const adapter = new OllamaAdapter(runtime);
    const callbacks = createCallbacks();

    await adapter.startRun(
      createContext({
        folderPath: null,
        trusted: false,
        ollamaTransportMode: 'responses'
      }),
      callbacks
    );

    await vi.waitFor(() => {
      expect(callbacks.onComplete).toHaveBeenCalledWith('Classic chat fallback ready.');
    });

    expect(callbacks.onInfo).toHaveBeenCalledWith(
      'Ollama /v1/responses was unavailable for this run. Falling back to the classic local chat transport.'
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/responses');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/chat');
  });
});
