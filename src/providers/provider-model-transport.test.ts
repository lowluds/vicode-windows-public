import { describe, expect, it } from 'vitest';
import type {
  ProviderModelPromptPayload,
  ProviderModelTransport,
  ProviderModelTurnRequest
} from './types';
import { buildProviderModelTurnRequest } from './types';

describe('provider model transport contract', () => {
  it('lets a transport return normalized tool calls without importing the agent runtime', async () => {
    const transport: ProviderModelTransport = {
      async sendTurn(_request: ProviderModelTurnRequest) {
        return {
          text: '',
          toolCalls: [
            {
              name: 'read_file',
              arguments: {
                path: 'README.md'
              }
            }
          ],
          terminalState: 'completed'
        };
      }
    };

    const result = await transport.sendTurn({
      modelId: 'test-model',
      systemInstructions: 'Use tools when needed.',
      input: [
        {
          role: 'user',
          content: 'Read README.md'
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
          path: 'README.md'
        }
      }
    ]);
  });

  it('flattens provider-neutral prompt payloads for thin transports', async () => {
    const requests: ProviderModelTurnRequest[] = [];
    const transport: ProviderModelTransport = {
      async sendTurn(request: ProviderModelTurnRequest) {
        requests.push(request);
        return {
          text: 'ok',
          toolCalls: [],
          terminalState: 'completed'
        };
      }
    };
    const prompt: ProviderModelPromptPayload = {
      systemInstructions: 'Use Vicode tools when needed.',
      input: [
        {
          role: 'user',
          content: 'Inspect the workspace.'
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
    };

    await transport.sendTurn(buildProviderModelTurnRequest({
      modelId: 'test-model',
      prompt,
      signal: new AbortController().signal
    }));

    expect(requests[0]).toMatchObject({
      modelId: 'test-model',
      systemInstructions: 'Use Vicode tools when needed.',
      input: [
        {
          role: 'user',
          content: 'Inspect the workspace.'
        }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file'
          }
        }
      ]
    });
  });

  it('proves a second provider transport can share the same neutral payload boundary', async () => {
    class FakeSecondProviderTransport implements ProviderModelTransport {
      readonly requests: ProviderModelTurnRequest[] = [];

      async sendTurn(request: ProviderModelTurnRequest) {
        this.requests.push(request);
        return {
          text: '',
          toolCalls: [
            {
              name: 'search_text',
              arguments: {
                query: 'ProviderModelPromptPayload'
              }
            }
          ],
          terminalState: 'completed' as const
        };
      }
    }

    const transport = new FakeSecondProviderTransport();
    const result = await transport.sendTurn(buildProviderModelTurnRequest({
      modelId: 'future-provider-model',
      prompt: {
        systemInstructions: 'System instructions assembled by Vicode.',
        input: [
          {
            role: 'user',
            content: 'Search for the prompt payload type.'
          }
        ],
        contextSections: [
          {
            id: 'tool-boundary',
            title: 'Tool boundary',
            content: 'Provider transports normalize tool calls but do not execute them.',
            placement: 'system'
          }
        ],
        tools: {
          definitions: []
        },
        attachments: {}
      },
      signal: new AbortController().signal
    }));

    expect(transport.requests[0]?.modelId).toBe('future-provider-model');
    expect(result.toolCalls).toEqual([
      {
        name: 'search_text',
        arguments: {
          query: 'ProviderModelPromptPayload'
        }
      }
    ]);
  });
});
