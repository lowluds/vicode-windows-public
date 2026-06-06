import type { ProviderRunContext } from '../types';

export interface OllamaToolCallPayload {
  id?: string;
  function?: {
    name?: string;
    arguments?: Record<string, unknown> | string;
  };
}

export interface OllamaChatMessagePayload {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  images?: string[];
  tool_name?: string;
  tool_calls?: OllamaToolCallPayload[];
}

export interface OllamaResponsesInputMessage {
  role: 'user' | 'assistant';
  content: OllamaResponsesInputContent;
}

type OllamaResponsesInputContent =
  | string
  | Array<
      | {
          type: 'input_text';
          text: string;
        }
      | {
          type: 'input_image';
          image_url: string;
          detail: 'auto';
        }
    >;

function parseImageAttachmentDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) {
    throw new Error('Unsupported image attachment format.');
  }

  return {
    mimeType: match[1].toLowerCase(),
    base64: match[2]
  };
}

export function buildOllamaChatImages(imageAttachments: ProviderRunContext['imageAttachments']) {
  return (imageAttachments ?? []).map((attachment) => parseImageAttachmentDataUrl(attachment.dataUrl).base64);
}

export function buildOllamaResponsesInput(
  prompt: string,
  imageAttachments: ProviderRunContext['imageAttachments']
): OllamaResponsesInputContent {
  const attachments = imageAttachments ?? [];
  if (attachments.length === 0) {
    return prompt;
  }

  return [
    {
      type: 'input_text' as const,
      text: prompt
    },
    ...attachments.map((attachment) => ({
      type: 'input_image' as const,
      image_url: attachment.dataUrl,
      detail: 'auto' as const
    }))
  ];
}

export function buildOllamaPlainChatRequestBody(input: {
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  imageAttachments: ProviderRunContext['imageAttachments'];
}) {
  return {
    model: input.modelId,
    stream: true,
    messages: [
      {
        role: 'system' as const,
        content: input.systemPrompt
      },
      {
        role: 'user' as const,
        content: input.userPrompt,
        ...(input.imageAttachments?.length
          ? {
              images: buildOllamaChatImages(input.imageAttachments)
            }
          : {})
      }
    ]
  };
}

export function buildOllamaPlainResponsesRequestBody(input: {
  modelId: string;
  instructions: string;
  userPrompt: string;
  imageAttachments: ProviderRunContext['imageAttachments'];
}) {
  return {
    model: input.modelId,
    instructions: input.instructions,
    input: buildOllamaResponsesInput(input.userPrompt, input.imageAttachments),
    stream: false
  };
}
