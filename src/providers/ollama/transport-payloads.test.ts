import { describe, expect, it } from 'vitest';
import {
  buildOllamaChatImages,
  buildOllamaPlainChatRequestBody,
  buildOllamaPlainResponsesRequestBody,
  buildOllamaResponsesInput
} from './transport-payloads';

describe('Ollama transport payload helpers', () => {
  it('builds classic chat payloads with base64 image attachments', () => {
    expect(
      buildOllamaPlainChatRequestBody({
        modelId: 'qwen3-coder:30b',
        systemPrompt: 'System rules.',
        userPrompt: 'Inspect this image.',
        imageAttachments: [
          {
            id: 'img-1',
            name: 'diagram.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,ZmFrZQ=='
          }
        ]
      })
    ).toEqual({
      model: 'qwen3-coder:30b',
      stream: true,
      messages: [
        {
          role: 'system',
          content: 'System rules.'
        },
        {
          role: 'user',
          content: 'Inspect this image.',
          images: ['ZmFrZQ==']
        }
      ]
    });
  });

  it('builds Responses input payloads with provider-native image URLs', () => {
    expect(
      buildOllamaResponsesInput('Inspect this image.', [
        {
          id: 'img-1',
          name: 'diagram.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,ZmFrZQ=='
        }
      ])
    ).toEqual([
      {
        type: 'input_text',
        text: 'Inspect this image.'
      },
      {
        type: 'input_image',
        image_url: 'data:image/png;base64,ZmFrZQ==',
        detail: 'auto'
      }
    ]);
  });

  it('builds plain Responses request bodies', () => {
    expect(
      buildOllamaPlainResponsesRequestBody({
        modelId: 'gpt-oss:20b',
        instructions: 'System rules.',
        userPrompt: 'Summarize.',
        imageAttachments: null
      })
    ).toEqual({
      model: 'gpt-oss:20b',
      instructions: 'System rules.',
      input: 'Summarize.',
      stream: false
    });
  });

  it('rejects unsupported classic chat image attachment data URLs', () => {
    expect(() => buildOllamaChatImages([
      {
        id: 'img-1',
        name: 'bad.txt',
        mimeType: 'text/plain',
        dataUrl: 'data:text/plain;base64,ZmFrZQ=='
      }
    ])).toThrow('Unsupported image attachment format.');
  });
});
