import { OLLAMA_LIGHTWEIGHT_SMOKE_MODEL_ID } from '../../shared/providers';

export type ProviderModelToolCallFormat =
  | 'responses_function_call'
  | 'ollama_chat_tool_call'
  | 'openai_compatible_chat_tool_call';

export interface ProviderModelCapabilityProfile {
  supportsTools: boolean;
  supportsStreaming: boolean;
  toolCallFormat: ProviderModelToolCallFormat;
  preferredSmokeModel: string | null;
  needsTransportFallback: boolean;
}

export const OPENAI_COMPATIBLE_CHAT_CAPABILITY_PROFILE: ProviderModelCapabilityProfile = {
  supportsTools: true,
  supportsStreaming: false,
  toolCallFormat: 'openai_compatible_chat_tool_call',
  preferredSmokeModel: null,
  needsTransportFallback: false
};

export const OLLAMA_RESPONSES_CAPABILITY_PROFILE: ProviderModelCapabilityProfile = {
  supportsTools: true,
  supportsStreaming: false,
  toolCallFormat: 'responses_function_call',
  preferredSmokeModel: OLLAMA_LIGHTWEIGHT_SMOKE_MODEL_ID,
  needsTransportFallback: true
};

export const OLLAMA_CHAT_CAPABILITY_PROFILE: ProviderModelCapabilityProfile = {
  supportsTools: true,
  supportsStreaming: true,
  toolCallFormat: 'ollama_chat_tool_call',
  preferredSmokeModel: OLLAMA_LIGHTWEIGHT_SMOKE_MODEL_ID,
  needsTransportFallback: false
};
