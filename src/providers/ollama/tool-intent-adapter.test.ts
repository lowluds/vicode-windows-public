import { describe, expect, it } from 'vitest';
import type { ProviderModelToolDefinition } from '../types';
import {
  OLLAMA_TOOL_INTENT_ADAPTER_SOURCE,
  classifyOllamaToolIntentAdapterResponse,
  createOllamaToolIntentAdapterFormat
} from './tool-intent-adapter';

function createProviderTool(
  name: string,
  required: string[] = [],
  properties: Record<string, unknown> = {}
): ProviderModelToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      parameters: {
        type: 'object',
        properties,
        required
      }
    }
  };
}

function createWriteFileToolDefinition() {
  return createProviderTool(
    'write_file',
    ['path', 'content'],
    {
      path: { type: 'string' },
      content: { type: 'string' }
    }
  );
}

function createWriteFileEnvelope(content = 'adapter probe ok') {
  return {
    name: 'write_file',
    arguments: {
      path: 'adapter.txt',
      content
    }
  };
}

describe('Ollama local tool-intent adapter helper', () => {
  it('builds a one-tool JSON schema format from active tool definitions', () => {
    expect(createOllamaToolIntentAdapterFormat([createWriteFileToolDefinition()])).toEqual({
      type: 'object',
      properties: {
        name: {
          type: 'string',
          enum: ['write_file']
        },
        arguments: {
          type: 'object'
        },
        reason: {
          type: 'string'
        }
      },
      required: ['name', 'arguments'],
      additionalProperties: false
    });
  });

  it('accepts exact adapter JSON through the existing active-tool validation path', () => {
    expect(
      classifyOllamaToolIntentAdapterResponse(
        JSON.stringify({
          ...createWriteFileEnvelope('accepted adapter probe ok'),
          reason: 'The user asked for a file write.'
        }),
        [createWriteFileToolDefinition()]
      )
    ).toEqual({
      status: 'accepted',
      source: OLLAMA_TOOL_INTENT_ADAPTER_SOURCE,
      toolCalls: [createWriteFileEnvelope('accepted adapter probe ok')],
      sanitizedContent: ''
    });
  });

  it('rejects malformed or prose-wrapped adapter responses without executing them', () => {
    const toolDefinitions = [createWriteFileToolDefinition()];

    expect(
      classifyOllamaToolIntentAdapterResponse('I will use write_file now.', toolDefinitions)
    ).toEqual({
      status: 'rejected',
      reason: 'no_candidate',
      candidateToolName: null,
      toolCalls: [],
      sanitizedContent: 'I will use write_file now.'
    });
    expect(
      classifyOllamaToolIntentAdapterResponse('{"name":"write_file","arguments":', toolDefinitions)
    ).toEqual({
      status: 'rejected',
      reason: 'malformed_json',
      candidateToolName: null,
      toolCalls: [],
      sanitizedContent: '{"name":"write_file","arguments":'
    });
  });

  it('rejects inactive, incomplete, or multi-candidate adapter responses', () => {
    const toolDefinitions = [createWriteFileToolDefinition()];

    expect(
      classifyOllamaToolIntentAdapterResponse(
        JSON.stringify({
          name: 'delete_everything',
          arguments: {
            path: 'adapter.txt',
            content: 'unsafe'
          }
        }),
        toolDefinitions
      )
    ).toEqual({
      status: 'rejected',
      reason: 'inactive_tool',
      candidateToolName: 'delete_everything',
      toolCalls: [],
      sanitizedContent: JSON.stringify({
        name: 'delete_everything',
        arguments: {
          path: 'adapter.txt',
          content: 'unsafe'
        }
      })
    });

    expect(
      classifyOllamaToolIntentAdapterResponse(
        JSON.stringify({
          name: 'write_file',
          arguments: {
            path: 'adapter.txt'
          }
        }),
        toolDefinitions
      )
    ).toEqual({
      status: 'rejected',
      reason: 'missing_required_arguments',
      candidateToolName: 'write_file',
      toolCalls: [],
      sanitizedContent: JSON.stringify({
        name: 'write_file',
        arguments: {
          path: 'adapter.txt'
        }
      })
    });

    expect(
      classifyOllamaToolIntentAdapterResponse(
        JSON.stringify([
          createWriteFileEnvelope('first'),
          createWriteFileEnvelope('second')
        ]),
        toolDefinitions
      )
    ).toEqual({
      status: 'rejected',
      reason: 'multiple_candidates',
      candidateToolName: null,
      toolCalls: [],
      sanitizedContent: JSON.stringify([
        createWriteFileEnvelope('first'),
        createWriteFileEnvelope('second')
      ])
    });
  });
});
